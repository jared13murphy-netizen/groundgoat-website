/**
 * Standalone test for the staging engine-shapes badge helpers (plain script,
 * Node 22+ strips TS types natively). Run with:
 *   node src/lib/engineShapes.test.ts
 */
import assert from 'node:assert/strict'
import {
  stateAbbr, tractStateAbbr, isEngineStateTract, engineShapesStatus, engineShapesProblem,
  engineShapesBadge, engineShapesSummary, engineShapesChecklistItems, ENGINE_BADGE_CLASS,
  withEngineShapesAfterBoundaryUpdate, withEngineShapesAfterWorkshopSave, ENGINE_STATES, listingEngineState,
} from './engineShapes.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const RING = [[-90, 40], [-90, 41], [-89, 41]]

test('nine engine states', () => {
  assert.deepEqual([...ENGINE_STATES].sort(), ['IA', 'IL', 'IN', 'KS', 'KY', 'MN', 'MO', 'NE', 'WI'])
})

test('stateAbbr: codes and full names, any case; junk is empty', () => {
  assert.equal(stateAbbr('il'), 'IL')
  assert.equal(stateAbbr(' Iowa '), 'IA')
  assert.equal(stateAbbr('NORTH DAKOTA'), 'ND')
  assert.equal(stateAbbr('Narnia'), '')
  assert.equal(stateAbbr(null), '')
  assert.equal(stateAbbr(17), '')
})

test('tractStateAbbr: county dict, then tract, then the listing (backend order)', () => {
  assert.equal(tractStateAbbr({ county: { state_abbr: 'KS' }, state: 'Ohio' }, 'IL'), 'KS')
  assert.equal(tractStateAbbr({ county: 'Adams', state_full: 'Ohio' }, 'IL'), 'OH')
  assert.equal(tractStateAbbr({ state: 'tx' }, 'Illinois'), 'TX')
  assert.equal(tractStateAbbr({}, 'Illinois'), 'IL')
  assert.equal(tractStateAbbr(null, undefined), '')
  assert.equal(isEngineStateTract({}, 'Minnesota'), true)
  assert.equal(isEngineStateTract({ state: 'TX' }, 'Minnesota'), false)
  assert.equal(isEngineStateTract({}, null), false)
})

test('listingEngineState: state_full, else state', () => {
  assert.equal(listingEngineState({ listing: { state_full: 'Iowa', state: 'IA' } }), 'Iowa')
  assert.equal(listingEngineState({ listing: { state: 'IA' } }), 'IA')
  assert.equal(listingEngineState({ listing: {} }), null)
  assert.equal(listingEngineState(null), null)
})

test('engineShapesStatus: undefined / unknown values are "unknown" (null)', () => {
  assert.equal(engineShapesStatus({ engine_shapes: 'ok' }), 'ok')
  assert.equal(engineShapesStatus({}), null)
  assert.equal(engineShapesStatus({ engine_shapes: 'something_new' }), null)
  assert.equal(engineShapesStatus({ engine_shapes: null }), null)
  assert.equal(engineShapesStatus(null), null)
})

test('badge: label + tone per status', () => {
  const b = (s: string, st = 'IL') => engineShapesBadge({ engine_shapes: s }, st)
  assert.deepEqual([b('ok')!.label, b('ok')!.tone], ['Engine shapes', 'green'])
  assert.deepEqual([b('missing')!.label, b('missing')!.tone], ['Engine shapes missing', 'red'])
  assert.deepEqual([b('no_boundary')!.label, b('no_boundary')!.tone], ["No boundary — engine can't run", 'amber'])
  assert.deepEqual([b('empty')!.label, b('empty')!.tone], ['Engine: nothing to draw', 'gray'])
  assert.deepEqual([b('no_data')!.label, b('no_data')!.tone], ['Engine: no data here', 'gray'])
  assert.equal(b('not_engine_state'), null)
})

test('badge: nothing for an older backend, and nothing for no_boundary outside the nine states', () => {
  assert.equal(engineShapesBadge({}, 'IL'), null)
  assert.equal(engineShapesBadge({ engine_shapes: 'no_boundary' }, 'Texas'), null)
  assert.equal(engineShapesBadge({ engine_shapes: 'no_boundary' }, null), null)
  assert.equal(engineShapesBadge({ engine_shapes: 'no_boundary', state: 'TX' }, 'IL'), null)
})

test('badge classes are solid fills', () => {
  for (const cls of Object.values(ENGINE_BADGE_CLASS)) {
    assert.match(cls, /^bg-[a-z]+-\d00 text-(white|black)$/)
  }
})

test('problem: missing always, no_boundary only in the nine states', () => {
  assert.equal(engineShapesProblem({ engine_shapes: 'missing' }, 'IL'), 'missing')
  assert.equal(engineShapesProblem({ engine_shapes: 'no_boundary' }, 'IL'), 'no_boundary')
  assert.equal(engineShapesProblem({ engine_shapes: 'no_boundary' }, 'TX'), null)
  assert.equal(engineShapesProblem({ engine_shapes: 'empty' }, 'IL'), null)
  assert.equal(engineShapesProblem({ engine_shapes: 'ok' }, 'IL'), null)
  assert.equal(engineShapesProblem({}, 'IL'), null)
})

test('summary: counts problems over the tracts in the mapped states', () => {
  const tracts = [
    { engine_shapes: 'ok' }, { engine_shapes: 'ok' }, { engine_shapes: 'empty' }, { engine_shapes: 'no_data' },
    { engine_shapes: 'no_boundary' }, { engine_shapes: 'missing' },
  ]
  assert.equal(
    engineShapesSummary(tracts, 'Illinois'),
    '2 of 6 tracts in our mapped states have no engine shapes (1 no boundary, 1 engine missing)',
  )
  assert.equal(
    engineShapesSummary([{ engine_shapes: 'missing' }], 'IL'),
    '1 of 1 tract in our mapped states has no engine shapes (1 engine missing)',
  )
  assert.equal(
    engineShapesSummary([{ engine_shapes: 'no_boundary' }, { engine_shapes: 'no_boundary' }, { engine_shapes: 'ok' }], 'IA'),
    '2 of 3 tracts in our mapped states have no engine shapes (2 no boundary)',
  )
})

test('summary: nothing when all ok / not applicable / unknown', () => {
  assert.equal(engineShapesSummary([{ engine_shapes: 'ok' }, { engine_shapes: 'empty' }, { engine_shapes: 'no_data' }], 'IL'), null)
  assert.equal(engineShapesSummary([{ engine_shapes: 'not_engine_state' }, { engine_shapes: 'no_boundary' }], 'Texas'), null)
  assert.equal(engineShapesSummary([{}, {}], 'IL'), null)
  assert.equal(engineShapesSummary(null, 'IL'), null)
  // A tract outside the nine states is not counted in "of N".
  assert.equal(
    engineShapesSummary([{ engine_shapes: 'missing' }, { engine_shapes: 'not_engine_state' }, { engine_shapes: 'no_boundary', state: 'TX' }], 'IL'),
    '1 of 1 tract in our mapped states has no engine shapes (1 engine missing)',
  )
})

test('checklist items: one per problem tract, tract number or position', () => {
  const items = engineShapesChecklistItems([
    { tract_number: 1, engine_shapes: 'ok' },
    { tract_number: 3, engine_shapes: 'missing' },
    { engine_shapes: 'no_boundary' },
    { tract_number: 9, engine_shapes: 'empty' },
  ], 'IL')
  assert.deepEqual(items.map((i) => i.message), [
    'Tract 3 — engine shapes missing',
    'Tract 3 — no boundary, engine shapes required',
  ])
  assert.deepEqual(items.map((i) => i.code), ['engine_shapes_missing', 'engine_shapes_no_boundary'])
  assert.ok(items.every((i) => i.scope === 'tract'))
  assert.deepEqual(engineShapesChecklistItems([{ engine_shapes: 'no_boundary' }], 'TX'), [])
  assert.deepEqual(engineShapesChecklistItems(undefined, 'IL'), [])
})

test('boundary update: the old value never survives a boundary change', () => {
  const old = { tract_number: 1, engine_shapes: 'no_boundary' }
  // boundary drawn → unknown until the row is read again
  const drawn = { ...old, ...withEngineShapesAfterBoundaryUpdate({ polygon_coordinates: RING, boundary_valid: true }) }
  assert.equal(engineShapesStatus(drawn), null)
  assert.equal(engineShapesBadge(drawn, 'IL'), null)
  // multi-ring boundary counts as a boundary
  const multi = { engine_shapes: 'ok', ...withEngineShapesAfterBoundaryUpdate({ polygon_coordinates: [RING, RING] }) }
  assert.equal(engineShapesStatus(multi), null)
  // boundary cleared → no_boundary (the backend rule)
  const cleared = { engine_shapes: 'ok', ...withEngineShapesAfterBoundaryUpdate({ polygon_coordinates: null }) }
  assert.equal(engineShapesStatus(cleared), 'no_boundary')
  // the server's own value wins when it sends one
  const sent = { ...old, ...withEngineShapesAfterBoundaryUpdate({ polygon_coordinates: RING, engine_shapes: 'missing' }) }
  assert.equal(engineShapesStatus(sent), 'missing')
  // an update that does not touch the boundary changes nothing
  const u = { tract_image_base64: 'x' }
  assert.equal(withEngineShapesAfterBoundaryUpdate(u), u)
  assert.equal(engineShapesStatus({ engine_shapes: 'ok', ...withEngineShapesAfterBoundaryUpdate(u) }), 'ok')
})

test('workshop save: staff cover makes it ok; otherwise the last read value is kept', () => {
  const ws = (server: Record<string, any>, page: unknown): Record<string, any> => withEngineShapesAfterWorkshopSave(server, page)
  const cover = { v: 1, polygons: [] }
  assert.equal(ws({ _uid: 'a', staff_land_cover: cover }, { engine_shapes: 'missing' }).engine_shapes, 'ok')
  assert.equal(ws({ _uid: 'a', staff_land_cover: cover }, { engine_shapes: 'empty' }).engine_shapes, 'ok')
  assert.equal(ws({ _uid: 'a' }, { engine_shapes: 'missing' }).engine_shapes, 'missing')
  // never invents a status outside the nine states / without a boundary
  assert.equal(ws({ staff_land_cover: cover }, { engine_shapes: 'not_engine_state' }).engine_shapes, 'not_engine_state')
  assert.equal(ws({ staff_land_cover: cover }, { engine_shapes: 'no_boundary' }).engine_shapes, 'no_boundary')
  // older backend: still unknown
  const t = { _uid: 'a', staff_land_cover: cover }
  assert.equal(ws(t, {}), t)
  // the server's own value wins
  assert.equal(ws({ engine_shapes: 'empty', staff_land_cover: cover }, { engine_shapes: 'missing' }).engine_shapes, 'empty')
})

console.log(`\n${passed} passed`)
