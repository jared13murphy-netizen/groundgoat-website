/**
 * Standalone test for the staff land-cover helpers (plain script, Node 22+
 * strips TS types natively). Run with:
 *   node src/lib/staffLandCover.test.ts
 */
import assert from 'node:assert/strict'
import {
  openRing, closeRing, geometryToPolys, polysToGeometry, pointInPolys, polysAcres,
  tractBoundaryGeometry, readLandCoverLoad, cleanApiShapes, apiShapesToEditor,
  orderEditedLast, landCoverPayload, savedShapesOf, soilRequestBody, soilText,
  cleanFsaFields, fsaFieldAt, shapesInField, fieldStillTicked, pruneTickedFields,
  fsaFieldClick, oldWorkshopRequested,
  type Pt, type FsaField,
} from './staffLandCover.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const sq = (x: number, y: number, d = 0.01): Pt[] => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]]
const closed = (r: Pt[]) => [...r, r[0]]
const poly = (...rings: Pt[][]) => ({ type: 'Polygon', coordinates: rings.map(closed) })
let seq = 0
const mk = () => `t${++seq}`

// ── rings ───────────────────────────────────────────────────────────

test('openRing / closeRing round-trip, and are idempotent', () => {
  const r = sq(0, 0)
  assert.deepEqual(openRing(closed(r)), r)
  assert.deepEqual(openRing(r), r)
  assert.deepEqual(closeRing(r), closed(r))
  assert.deepEqual(closeRing(closed(r)), closed(r))
  assert.deepEqual(openRing(null), [])
  assert.deepEqual(openRing([[1, 2], ['x', 3], [4, 5]]), [[1, 2], [4, 5]])
})

test('Polygon with holes ⇄ [outer, ...holes] open rings', () => {
  const outer = sq(0, 0, 0.1); const hole = sq(0.02, 0.02, 0.01)
  const polys = geometryToPolys(poly(outer, hole))
  assert.deepEqual(polys, [[outer, hole]])
  assert.deepEqual(polysToGeometry(polys), poly(outer, hole))
})

test('MultiPolygon ⇄ several polys; one part goes back as a Polygon', () => {
  const a = sq(0, 0); const b = sq(1, 1)
  const mp = { type: 'MultiPolygon', coordinates: [[closed(a)], [closed(b)]] }
  assert.deepEqual(geometryToPolys(mp), [[a], [b]])
  assert.deepEqual(polysToGeometry([[a], [b]]), mp)
  assert.equal(polysToGeometry([[a]]).type, 'Polygon')
  assert.equal(polysToGeometry([]), null)
  assert.equal(polysToGeometry([[[[0, 0], [1, 1]]]]), null)
})

test('a bad outer ring drops the polygon; a bad hole drops only the hole', () => {
  const outer = sq(0, 0, 0.1)
  assert.deepEqual(geometryToPolys({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }), [])
  assert.deepEqual(geometryToPolys({ type: 'Polygon', coordinates: [closed(outer), [[0, 0], [1, 1]]] }), [[outer]])
  assert.deepEqual(geometryToPolys({ type: 'Point', coordinates: [0, 0] }), [])
  assert.deepEqual(geometryToPolys(null), [])
})

test('pointInPolys respects holes; polysAcres subtracts them', () => {
  const outer = sq(0, 0, 0.1); const hole = sq(0.04, 0.04, 0.02)
  assert.equal(pointInPolys([0.01, 0.01], [[outer, hole]]), true)
  assert.equal(pointInPolys([0.05, 0.05], [[outer, hole]]), false)
  assert.equal(pointInPolys([0.5, 0.5], [[outer, hole]]), false)
  const whole = polysAcres([[outer]]); const holed = polysAcres([[outer, hole]])
  assert.ok(whole > 0 && holed < whole)
  assert.ok(Math.abs((whole - holed) - polysAcres([[hole]])) < 1e-6)
})

// ── boundary ────────────────────────────────────────────────────────

test('tractBoundaryGeometry: one ring, several pieces, holes cut from the right piece', () => {
  const a = sq(0, 0, 0.1); const b = sq(1, 1, 0.1); const hole = sq(1.02, 1.02, 0.01)
  assert.deepEqual(tractBoundaryGeometry(a), poly(a))
  assert.deepEqual(tractBoundaryGeometry(closed(a)), poly(a))
  const g = tractBoundaryGeometry([a, b], [hole])
  assert.equal(g.type, 'MultiPolygon')
  assert.deepEqual(geometryToPolys(g), [[a], [b, hole]])
  // a hole outside every piece is ignored
  assert.deepEqual(geometryToPolys(tractBoundaryGeometry(a, [sq(5, 5)])), [[a]])
  assert.equal(tractBoundaryGeometry(null), null)
  assert.equal(tractBoundaryGeometry([]), null)
  assert.equal(tractBoundaryGeometry([[0, 0], [1, 1]]), null)
})

// ── load ────────────────────────────────────────────────────────────

const tract = { uid: 'u1', tillable_rev: 4, state: 'IA', polygon: sq(0, 0, 0.1), polygon_holes: null, total_acres: 160.2, reported_acres: '158' }
const shapeT = { cls: 'tillable', geometry: poly(sq(0, 0, 0.05)), acres: 40 }
const shapeW = { cls: 'water', geometry: poly(sq(0.06, 0.06, 0.02)), acres: 5 }

test('load: staff origin opens exactly what was saved', () => {
  const r = readLandCoverLoad({ tract, origin: 'staff', needs_normalize: false, shapes: [shapeT, shapeW], soil_rating: 72.3, soil_rating_type: 'CSR2', engine_covered: true })
  assert.equal(r.origin, 'staff')
  assert.equal(r.shapes!.length, 2)
  assert.equal(r.needsNormalize, false)
  assert.equal(r.uid, 'u1'); assert.equal(r.tillableRev, 4); assert.equal(r.state, 'IA')
  assert.equal(r.totalAcres, 160.2); assert.equal(r.reportedAcres, 158)
  assert.equal(r.soilRating, 72.3); assert.equal(r.soilRatingType, 'CSR2')
  assert.equal(r.error, null)
  assert.equal(r.boundary.type, 'Polygon')
})

test('load: a staff save of NOTHING opens blank and never asks the engine', () => {
  const r = readLandCoverLoad({ tract, origin: 'staff', shapes: [] })
  assert.deepEqual(r.shapes, [])
})

test('load: legacy origin is fitted once (needs_normalize)', () => {
  const r = readLandCoverLoad({ tract, origin: 'legacy', needs_normalize: true, shapes: [shapeT] })
  assert.equal(r.origin, 'legacy'); assert.equal(r.needsNormalize, true)
  // nothing to fit → no fit
  assert.equal(readLandCoverLoad({ tract, origin: 'legacy', needs_normalize: true, shapes: [] }).needsNormalize, false)
})

test('load: engine origin opens the engine shapes', () => {
  const r = readLandCoverLoad({ tract, origin: 'engine', needs_normalize: false, shapes: [shapeT, shapeW], engine_covered: true })
  assert.equal(r.origin, 'engine'); assert.equal(r.shapes!.length, 2); assert.equal(r.needsNormalize, false)
})

test('load: origin none asks the engine unless the server says it is not covered', () => {
  assert.equal(readLandCoverLoad({ tract, origin: 'none', shapes: null, engine_covered: null }).shapes, null)
  assert.equal(readLandCoverLoad({ tract, origin: 'none', shapes: null, engine_covered: true }).shapes, null)
  assert.deepEqual(readLandCoverLoad({ tract, origin: 'none', shapes: null, engine_covered: false }).shapes, [])
  // an unknown origin is treated as none
  assert.equal(readLandCoverLoad({ tract, origin: 'weird', shapes: [shapeT] }).origin, 'none')
  assert.equal(readLandCoverLoad({ tract, origin: 'weird', shapes: [shapeT] }).shapes, null)
})

test('load: no boundary → nothing to edit, with the server error', () => {
  const r = readLandCoverLoad({ tract: { ...tract, polygon: null }, origin: 'none', shapes: null, error: 'Tract has no boundary polygon' })
  assert.equal(r.boundary, null); assert.deepEqual(r.shapes, []); assert.equal(r.error, 'Tract has no boundary polygon')
  assert.equal(readLandCoverLoad({}).error, 'Tract has no boundary polygon')
  assert.equal(readLandCoverLoad(null).boundary, null)
})

test('cleanApiShapes drops unknown classes and non-polygons', () => {
  const out = cleanApiShapes([shapeT, { cls: 'waterway', geometry: poly(sq(0, 0)) }, { cls: 'timber', geometry: { type: 'Point', coordinates: [0, 0] } }, null, 7])
  assert.equal(out.length, 1); assert.equal(out[0].cls, 'tillable'); assert.equal(out[0].acres, 40)
  assert.deepEqual(cleanApiShapes(null), [])
})

test('apiShapesToEditor: one editor shape per polygon part, holes kept', () => {
  const a = sq(0, 0); const b = sq(1, 1); const hole = sq(1.002, 1.002, 0.002)
  const mp = { type: 'MultiPolygon', coordinates: [[closed(a)], [closed(b), closed(hole)]] }
  const out = apiShapesToEditor([{ cls: 'timber', geometry: mp }, shapeW as any], mk)
  assert.equal(out.length, 3)
  assert.deepEqual(out[0].polys, [[a]]); assert.deepEqual(out[1].polys, [[b, hole]])
  assert.equal(out[0].cls, 'timber'); assert.equal(out[2].cls, 'water')
  assert.equal(new Set(out.map((s) => s.id)).size, 3)
  assert.deepEqual(apiShapesToEditor(null, mk), [])
})

// ── save ────────────────────────────────────────────────────────────

const ed = (id: string, cls: string, ...polys: Pt[][][]) => ({ id, cls, polys })

test('orderEditedLast: the edited shape moves to the end, the rest keep order', () => {
  const list = [ed('a', 'tillable'), ed('b', 'timber'), ed('c', 'water')]
  assert.deepEqual(orderEditedLast(list, 'a').map((s) => s.id), ['b', 'c', 'a'])
  assert.deepEqual(orderEditedLast(list, 'c').map((s) => s.id), ['a', 'b', 'c'])
  assert.deepEqual(orderEditedLast(list, null).map((s) => s.id), ['a', 'b', 'c'])
  assert.deepEqual(orderEditedLast(list, 'zz').map((s) => s.id), ['a', 'b', 'c'])
  assert.notEqual(orderEditedLast(list, null), list)
})

test('landCoverPayload: closed GeoJSON, edited last, empty shapes dropped', () => {
  const outer = sq(0, 0, 0.1); const hole = sq(0.02, 0.02, 0.01)
  const body = landCoverPayload([
    ed('a', 'tillable', [outer, hole]),
    ed('b', 'timber', [sq(1, 1)], [sq(2, 2)]),
    ed('c', 'water'),
    ed('d', 'waterway', [sq(3, 3)]),
  ], 'a')
  assert.equal(body.length, 2)
  assert.equal(body[0].cls, 'timber'); assert.equal(body[0].geometry.type, 'MultiPolygon')
  assert.equal(body[1].cls, 'tillable'); assert.deepEqual(body[1].geometry, poly(outer, hole))
  assert.deepEqual(Object.keys(body[1]).sort(), ['cls', 'geometry'])
})

test('landCoverPayload: no shapes is a valid save (an empty list)', () => {
  assert.deepEqual(landCoverPayload([]), [])
})

test('payload → API → editor round-trips the rings', () => {
  const outer = sq(0, 0, 0.1); const hole = sq(0.02, 0.02, 0.01)
  const back = apiShapesToEditor(landCoverPayload([ed('a', 'pasture', [outer, hole])]) as any, mk)
  assert.deepEqual(back.map((s) => [s.cls, s.polys]), [['pasture', [[outer, hole]]]])
})

test('savedShapesOf reads tract.staff_land_cover.polygons', () => {
  assert.equal(savedShapesOf({ ok: true })!, null)
  assert.deepEqual(savedShapesOf({ tract: { staff_land_cover: { polygons: [] } } }), [])
  assert.equal(savedShapesOf({ tract: { staff_land_cover: { polygons: [shapeT, { cls: 'x' }] } } })!.length, 1)
})

// ── soil ────────────────────────────────────────────────────────────

test('soil: NO request when there is no tillable piece', () => {
  assert.equal(soilRequestBody([]), null)
  assert.equal(soilRequestBody(null), null)
  assert.equal(soilRequestBody([null, { type: 'Point', coordinates: [0, 0] }]), null)
})

test('soil: tillable pieces go as manual_polygons (Polygons) with selections []', () => {
  const a = sq(0, 0); const b = sq(1, 1)
  const body = soilRequestBody([poly(a), { type: 'MultiPolygon', coordinates: [[closed(a)], [closed(b)]] }])!
  assert.deepEqual(body.selections, [])
  assert.equal(body.manual_polygons.length, 3)
  assert.ok(body.manual_polygons.every((g) => g.type === 'Polygon'))
})

test('soilText', () => {
  assert.equal(soilText(72.3, 'CSR2'), '72.3 (CSR2)')
  assert.equal(soilText(61, null), '61')
  assert.equal(soilText(null, 'CSR2'), 'no rating')
  assert.equal(soilText(undefined, null, '—'), '—')
})

// ── FSA fields ──────────────────────────────────────────────────────

const F1: FsaField = { fsa_clu_id: 1, geometry: poly(sq(0, 0, 0.01)), acres_within_tract: null }
const F2: FsaField = { fsa_clu_id: 2, geometry: poly(sq(0.02, 0, 0.01)) }
const BIG: FsaField = { fsa_clu_id: 9, geometry: poly(sq(-0.01, -0.01, 0.05)) }
const inF1: Pt = [0.005, 0.005]

test('cleanFsaFields keeps fields with an id and a polygon', () => {
  const out = cleanFsaFields([F1, { fsa_clu_id: 'x', geometry: F1.geometry }, { fsa_clu_id: 3 }, { fsa_clu_id: '4', geometry: F2.geometry }])
  assert.deepEqual(out.map((f) => f.fsa_clu_id), [1, 4])
  assert.deepEqual(cleanFsaFields(undefined), [])
})

test('fsaFieldAt picks the smallest field under the point', () => {
  assert.equal(fsaFieldAt([BIG, F1, F2], inF1)!.fsa_clu_id, 1)
  assert.equal(fsaFieldAt([BIG, F1, F2], [0.035, 0.035])!.fsa_clu_id, 9)
  assert.equal(fsaFieldAt([F1, F2], [0.5, 0.5]), null)
})

test('field click on bare ground adds the field', () => {
  const r = fsaFieldClick({ enabled: true, toolActive: false, point: inF1, fields: [F1, F2], shapes: [], ticked: [] })
  assert.equal(r.action, 'add')
  assert.equal(r.action === 'add' && r.field.fsa_clu_id, 1)
})

test('field click on a non-tillable shape adds the field (tillable drawn last wins)', () => {
  const timber = ed('s1', 'timber', [sq(0, 0, 0.01)])
  assert.equal(fsaFieldClick({ enabled: true, toolActive: false, point: inF1, fields: [F1], shapes: [timber], ticked: [] }).action, 'add')
})

test('field click on ground that is already tillable is left to the editor', () => {
  const till = ed('s1', 'tillable', [sq(-0.01, -0.01, 0.05)])
  assert.equal(fsaFieldClick({ enabled: true, toolActive: false, point: inF1, fields: [F1], shapes: [till], ticked: [] }).action, 'pass')
})

test('clicking a field this session ticked removes the shapes that tick made', () => {
  const made = ed('s7', 'tillable', [sq(0, 0, 0.01)])
  const other = ed('s8', 'tillable', [sq(0.02, 0, 0.01)])
  const r = fsaFieldClick({ enabled: true, toolActive: false, point: inF1, fields: [F1, F2], shapes: [made, other], ticked: [1] })
  assert.equal(r.action, 'remove')
  assert.deepEqual(r.action === 'remove' && r.shapeIds, ['s7'])
})

test('a ticked field still removes after the server clipped it by a hair', () => {
  const clipped = ed('n1', 'tillable', [[[0.000004, 0], [0.01, 0], [0.01, 0.010004], [0, 0.01]] as Pt[]])
  assert.equal(fsaFieldClick({ enabled: true, toolActive: false, point: inF1, fields: [F1], shapes: [clipped], ticked: [1] }).action, 'remove')
})

test('no field click while a tool is armed, with the overlay off, or off every field', () => {
  const base = { point: inF1, fields: [F1], shapes: [], ticked: [] as number[] }
  assert.equal(fsaFieldClick({ ...base, enabled: true, toolActive: true }).action, 'pass')
  assert.equal(fsaFieldClick({ ...base, enabled: false, toolActive: false }).action, 'pass')
  assert.equal(fsaFieldClick({ ...base, enabled: true, toolActive: false, point: [0.5, 0.5] }).action, 'pass')
})

test('a tick whose shape is gone is forgotten: the next click adds again', () => {
  assert.deepEqual(pruneTickedFields([1, 2], [F1, F2], [ed('s', 'tillable', [sq(0.02, 0, 0.01)])]), [2])
  assert.deepEqual(pruneTickedFields([1, 77], [F1], []), [])
  assert.equal(fsaFieldClick({ enabled: true, toolActive: false, point: inF1, fields: [F1], shapes: [], ticked: [1] }).action, 'add')
})

test('a small hand-drawn tillable patch inside a ticked-then-emptied field is not the tick', () => {
  const patch = ed('p', 'tillable', [sq(0.001, 0.001, 0.002)])
  assert.equal(fieldStillTicked([patch], F1), false)
  assert.equal(shapesInField([patch], F1).length, 1)
  // …so a click on the patch is a normal editor click
  assert.equal(fsaFieldClick({ enabled: true, toolActive: false, point: [0.002, 0.002], fields: [F1], shapes: [patch], ticked: [1] }).action, 'pass')
})

test('shapesInField ignores other classes and shapes reaching outside the field', () => {
  const timber = ed('a', 'timber', [sq(0, 0, 0.01)])
  const wide = ed('b', 'tillable', [sq(0, 0, 0.03)])
  assert.deepEqual(shapesInField([timber, wide], F1), [])
})

// ── feature switch ──────────────────────────────────────────────────

test('oldWorkshopRequested', () => {
  assert.equal(oldWorkshopRequested('?oldworkshop=1'), true)
  assert.equal(oldWorkshopRequested('?tab=x&oldworkshop=true'), true)
  assert.equal(oldWorkshopRequested('oldworkshop=1'), true)
  assert.equal(oldWorkshopRequested('?oldworkshop=0'), false)
  assert.equal(oldWorkshopRequested('?oldworkshop'), false)
  assert.equal(oldWorkshopRequested('?notoldworkshop=1'), false)
  assert.equal(oldWorkshopRequested(''), false)
  assert.equal(oldWorkshopRequested(null), false)
})

console.log(`\n${passed} tests passed`)
