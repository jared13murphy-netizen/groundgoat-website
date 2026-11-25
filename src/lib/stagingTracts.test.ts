/**
 * Standalone test for the staged-tract helpers the admin staging pages share
 * (plain script, Node 22+ strips TS types natively). Run with:
 *   node src/lib/stagingTracts.test.ts
 */
import assert from 'node:assert/strict'
import {
  tractUid, findTractIndex, replaceTractInScrapedData, withoutDeletedTracts,
  addPendingDeletes, clearPendingDeletes, buildStagingPatchBody, removedTractUids,
  swapKeys, swapTractObjects, findOriginalTract, RowRereadGate,
  BOUNDARY_KEYS, TILLABLE_WORK_KEYS, withoutResponseOnlyTractKeys,
} from './stagingTracts.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const A = () => ({
  _uid: 'a', _tillable_rev: 3, tract_number: 1, acres: 80,
  polygon_coordinates: [[0, 0], [1, 0], [1, 1]],
  tillable_polygon: [[['A']]], tillable_polygon_source: 'workshop',
  tillable_clu_selection: { 1: true }, tillable_manual_polygons: ['mA'],
  staff_land_cover: { v: 1, polygons: [{ cls: 'timber', geometry: 'gA' }], acres: { timber: 4 } },
  computed: { tillable_acres: 70, nccpi: 61 }, chosen: { tillable_acres: 'computed' },
  manual: { tillable_acres: 75 }, has_tract_image: true,
})
const B = () => ({
  _uid: 'b', _tillable_rev: 1, tract_number: 2, acres: 40,
  polygon_coordinates: [[5, 5], [6, 5], [6, 6]], polygon_holes: [[[5.1, 5.1]]],
  description: 'north forty',
})

test('tractUid: only a non-empty string counts', () => {
  assert.equal(tractUid({ _uid: 'x' }), 'x')
  assert.equal(tractUid({ _uid: '' }), null)
  assert.equal(tractUid({ _uid: 7 }), null)
  assert.equal(tractUid({}), null)
  assert.equal(tractUid(null), null)
})

test('findTractIndex: uid wins over a shifted index', () => {
  const ts = [B(), A()]
  assert.equal(findTractIndex(ts, 'a', 0), 1)
})

test('findTractIndex: falls back to the index only when that slot is not another tract', () => {
  assert.equal(findTractIndex([{ tract_number: 1 }, { tract_number: 2 }], null, 1), 1)
  // uid given, not found, slot has no uid (page has not re-read it yet) → index
  assert.equal(findTractIndex([{ tract_number: 1 }], 'new', 0), 0)
  // uid given, not found, slot holds a DIFFERENT uid → not this tract
  assert.equal(findTractIndex([A()], 'zzz', 0), -1)
  assert.equal(findTractIndex([A()], null, 4), -1)
  assert.equal(findTractIndex(null, 'a', 0), -1)
})

test('replaceTractInScrapedData: the server tract REPLACES the stale copy', () => {
  const stale = { ...A(), _tillable_rev: 2, tillable_polygon: 'OLD', computed: { tillable_acres: 10, nccpi: 99, soil_rating: 5 }, manual: { tillable_acres: 75, soil_rating: 80 } }
  const server = { ...A(), _tillable_rev: 4, computed: { tillable_acres: 71 }, manual: {} } as any
  delete server.has_tract_image
  const out = replaceTractInScrapedData({ listing: { x: 1 }, tracts: [B(), stale] }, server, { uid: 'a', index: 0 })
  assert.equal(out.tracts[0]._uid, 'b', 'index 0 was a different tract — untouched')
  const t = out.tracts[1]
  assert.equal(t._tillable_rev, 4)
  assert.deepEqual(t.computed, { tillable_acres: 71 }, 'stale nccpi / soil_rating are gone')
  assert.deepEqual(t.manual, {}, 'manual the server removed is not kept')
  assert.deepEqual(t.tillable_polygon, [[['A']]])
  assert.equal(t.has_tract_image, true, 'page-local key survives')
  assert.deepEqual(out.listing, { x: 1 })
})

test('replaceTractInScrapedData: does not mutate, and is a no-op when the tract is not found', () => {
  const sd = { tracts: [A()] }
  const out = replaceTractInScrapedData(sd, { _uid: 'zzz', acres: 1 }, { index: 0 })
  assert.deepEqual(out.tracts, sd.tracts)
  const out2 = replaceTractInScrapedData(sd, { _uid: 'a', acres: 1 })
  assert.equal(sd.tracts[0].acres, 80)
  assert.equal(out2.tracts[0].acres, 1)
  assert.deepEqual(replaceTractInScrapedData(sd, null).tracts, sd.tracts)
})

test('replaceTractInScrapedData: falls back to index for a tract with no uid yet', () => {
  const out = replaceTractInScrapedData({ tracts: [{ tract_number: 9 }] }, { _uid: 'n', tract_number: 9, acres: 3 }, { index: 0 })
  assert.equal(out.tracts[0]._uid, 'n')
})

test('withoutDeletedTracts drops only queued uids', () => {
  const out = withoutDeletedTracts({ tracts: [A(), B(), { tract_number: 3 }] }, ['b'])
  assert.deepEqual(out.tracts.map((t: any) => t.tract_number), [1, 3])
  assert.equal(withoutDeletedTracts({ tracts: [A()] }, undefined).tracts.length, 1)
})

test('pending deletes: queue, de-dupe, clear only what was sent', () => {
  let p = addPendingDeletes({}, 7, ['a', null, undefined, ''])
  assert.deepEqual(p, { 7: ['a'] })
  assert.equal(addPendingDeletes(p, 7, ['a']), p, 'no change → same object')
  p = addPendingDeletes(p, 7, ['b'])
  p = addPendingDeletes(p, 8, ['c'])
  // 'b' was queued while the PATCH carrying only 'a' was in flight
  p = clearPendingDeletes(p, 7, ['a'])
  assert.deepEqual(p, { 7: ['b'], 8: ['c'] })
  p = clearPendingDeletes(p, 7, ['b'])
  assert.deepEqual(p, { 8: ['c'] })
  assert.equal(clearPendingDeletes(p, 99, ['x']), p)
})

test('buildStagingPatchBody: lists deleted uids, never one still in the document', () => {
  const sd = { tracts: [A()] }
  assert.deepEqual(buildStagingPatchBody(sd, undefined), { scraped_data: sd })
  assert.deepEqual(buildStagingPatchBody(sd, []), { scraped_data: sd })
  assert.deepEqual(buildStagingPatchBody(sd, ['b', 'a'], { auction_date: null }),
    { scraped_data: sd, auction_date: null, deleted_tract_uids: ['b'] })
})

test('buildStagingPatchBody: engine_shapes (response-only) is never sent back', () => {
  const a = { ...A(), engine_shapes: 'missing' }
  const b = B()
  const sd = { listing: { title: 'x' }, tracts: [a, b] }
  const body = buildStagingPatchBody(sd, ['zzz']) as any
  assert.equal('engine_shapes' in body.scraped_data.tracts[0], false)
  assert.deepEqual(body.scraped_data.tracts[0], A())
  assert.equal(body.scraped_data.tracts[1], b, 'a tract without the key is not copied')
  assert.deepEqual(body.scraped_data.listing, { title: 'x' })
  assert.deepEqual(body.deleted_tract_uids, ['zzz'])
  // the page's own copy keeps the badge value
  assert.equal(a.engine_shapes, 'missing')
  assert.equal((sd.tracts[0] as any).engine_shapes, 'missing')
  assert.equal(JSON.stringify(body).includes('engine_shapes'), false)
  // a key held as undefined (cleared after a boundary save) is dropped too
  const body2 = buildStagingPatchBody({ tracts: [{ ...B(), engine_shapes: undefined }] }, undefined) as any
  assert.equal('engine_shapes' in body2.scraped_data.tracts[0], false)
})

test('withoutResponseOnlyTractKeys: same object when there is nothing to strip', () => {
  const sd = { tracts: [A(), B()] }
  assert.equal(withoutResponseOnlyTractKeys(sd), sd)
  assert.equal(withoutResponseOnlyTractKeys(null), null)
  const noTracts = { listing: {} }
  assert.equal(withoutResponseOnlyTractKeys(noTracts), noTracts)
})

test('removedTractUids: tracts in before but not after (uid-less ones cannot be named)', () => {
  assert.deepEqual(removedTractUids([A(), B(), { tract_number: 3 }], [B()]), ['a'])
  assert.deepEqual(removedTractUids([A()], [A(), { tract_number: 2 }]), [])
})

test('swapKeys (Swap Polygons): only the boundary moves; uid, rev and tillable work stay', () => {
  const [na, nb] = swapKeys(A(), B(), BOUNDARY_KEYS)
  assert.deepEqual(na.polygon_coordinates, B().polygon_coordinates)
  assert.deepEqual(nb.polygon_coordinates, A().polygon_coordinates)
  assert.equal(na._uid, 'a'); assert.equal(nb._uid, 'b')
  assert.equal(na._tillable_rev, 3); assert.equal(nb._tillable_rev, 1)
  for (const k of TILLABLE_WORK_KEYS) {
    assert.deepEqual(na[k], (A() as any)[k], `${k} stays on A`)
    assert.equal(k in nb, false, `${k} is not invented on B`)
  }
  assert.equal(na.acres, 80)
})

test('swapKeys: a key missing on one side is swapped as explicit null, not dropped', () => {
  const [na, nb] = swapKeys(A(), B(), BOUNDARY_KEYS)
  // A had no polygon_holes; B did. After the swap A has them and B must
  // carry an explicit null (the server keeps keys the client omits).
  assert.deepEqual(na.polygon_holes, B().polygon_holes)
  assert.equal('polygon_holes' in nb, true)
  assert.equal(nb.polygon_holes, null)
  // missing on both → stays missing
  const [x, y] = swapKeys({ a: 1 }, { a: 2 }, ['nope'])
  assert.equal('nope' in x, false); assert.equal('nope' in y, false)
})

test('staff_land_cover (Map It-style Workshop) is a tillable work key: never moved, never invented', () => {
  assert.equal((TILLABLE_WORK_KEYS as readonly string[]).includes('staff_land_cover'), true)
  const [na, nb] = swapKeys(A(), B(), ['staff_land_cover', ...BOUNDARY_KEYS])
  assert.deepEqual(na.staff_land_cover, A().staff_land_cover)
  assert.equal('staff_land_cover' in nb, false)
  // "Swap Everything" carries it with the tract object, like the rest
  const [sa, sb] = swapTractObjects(A(), B())
  assert.equal('staff_land_cover' in sa, false)
  assert.deepEqual(sb.staff_land_cover, A().staff_land_cover)
})

test('swapKeys never moves server-owned keys even if asked to', () => {
  const [na, nb] = swapKeys(A(), B(), ['_uid', '_tillable_rev', 'tillable_polygon', 'description'])
  assert.equal(na._uid, 'a'); assert.equal(nb._uid, 'b')
  assert.deepEqual(na.tillable_polygon, [[['A']]])
  assert.equal(na.description, 'north forty'); assert.equal(nb.description, null)
})

test('swapTractObjects (Swap Everything): objects trade places, tract number stays with the slot', () => {
  const [na, nb] = swapTractObjects(A(), B())
  assert.equal(na._uid, 'b'); assert.equal(nb._uid, 'a')
  assert.equal(na.tract_number, 1); assert.equal(nb.tract_number, 2)
  assert.equal(nb._tillable_rev, 3)
  assert.deepEqual(nb.tillable_polygon, [[['A']]], 'tillable work travels with its tract')
  assert.equal(na.description, 'north forty')
  const [m] = swapTractObjects({ _uid: 'p' }, { _uid: 'q', tract_number: 4 })
  assert.equal(m.tract_number, null, 'a missing number becomes explicit null')
})

test('findOriginalTract: by uid — duplicate tract numbers cannot cross records', () => {
  const originals = [{ ...A(), tract_number: 1 }, { ...B(), tract_number: 1 }]
  assert.equal(findOriginalTract(originals, { _uid: 'b', _src_index: 1, tract_number: 1 })?.acres, 40)
  assert.equal(findOriginalTract(originals, { _uid: 'a', _src_index: 0, tract_number: 1 })?.acres, 80)
  // number edited in the modal → still the same tract
  assert.equal(findOriginalTract(originals, { _uid: 'b', _src_index: 1, tract_number: 77 })?.acres, 40)
  // a uid that no longer exists matches nothing (never falls back to the number)
  assert.equal(findOriginalTract(originals, { _uid: 'gone', tract_number: 1 }), null)
})

test('findOriginalTract: uid-less tracts match by source position, then by a unique number', () => {
  const originals = [{ tract_number: 1, acres: 10 }, { tract_number: 1, acres: 20 }, A()]
  assert.equal(findOriginalTract(originals, { _src_index: 1, tract_number: 1 })?.acres, 20)
  // a uid-less row never claims a tract that HAS a uid
  assert.equal(findOriginalTract(originals, { _src_index: 2, tract_number: 1 }), null)
  // row added in the modal
  assert.equal(findOriginalTract(originals, { _src_index: -1, tract_number: 1 }), null)
  // no position known: number only when exactly one uid-less tract has it
  assert.equal(findOriginalTract(originals, { tract_number: 1 }), null)
  assert.equal(findOriginalTract([{ tract_number: 5, acres: 9 }, A()], { tract_number: 5 })?.acres, 9)
})

test('RowRereadGate: a clean re-read applies', () => {
  const g = new RowRereadGate()
  g.startPatch(1); assert.equal(g.finishPatch(1), false)
  const t = g.startReread(1)
  assert.equal(g.finishReread(1, t), 'apply')
})

test('RowRereadGate: only the latest re-read applies', () => {
  const g = new RowRereadGate()
  const t1 = g.startReread(1)
  const t2 = g.startReread(1)
  assert.equal(g.finishReread(1, t1), 'superseded')
  assert.equal(g.finishReread(1, t2), 'apply')
  // rows are independent
  const a = g.startReread(1); const b = g.startReread(2)
  assert.equal(g.finishReread(2, b), 'apply'); assert.equal(g.finishReread(1, a), 'apply')
})

test('RowRereadGate: an edit PATCHed while a re-read is in flight drops it and re-reads after the PATCH', () => {
  const g = new RowRereadGate()
  const t = g.startReread(1)
  g.startPatch(1)                       // local edit + its PATCH
  assert.equal(g.finishReread(1, t), 'edited', 'response predates the edit')
  assert.equal(g.finishPatch(1), true, 'one more re-read once the PATCH is done')
  const t2 = g.startReread(1)
  assert.equal(g.finishReread(1, t2), 'apply')
  assert.equal(g.finishPatch(1), false)
})

test('RowRereadGate: PATCH that starts AND finishes while the re-read is still in flight', () => {
  const g = new RowRereadGate()
  const t = g.startReread(1)
  g.startPatch(1)
  assert.equal(g.finishPatch(1), true, 're-read still in flight predates this PATCH')
  const t2 = g.startReread(1)
  assert.equal(g.finishReread(1, t), 'superseded')
  assert.equal(g.finishReread(1, t2), 'apply')
})

test('RowRereadGate: waits for the LAST of several PATCHes', () => {
  const g = new RowRereadGate()
  const t = g.startReread(1)
  g.startPatch(1); g.startPatch(1)
  assert.equal(g.finishReread(1, t), 'edited')
  assert.equal(g.finishPatch(1), false)
  assert.equal(g.finishPatch(1), true)
  assert.equal(g.finishPatch(1), false, 'owed re-read is handed out once')
})

test('RowRereadGate: an unsaved in-memory edit also blocks the re-read; next PATCH re-reads', () => {
  const g = new RowRereadGate()
  const t = g.startReread(1)
  g.noteEdit(1)
  assert.equal(g.finishReread(1, t), 'edited')
  g.startPatch(1)
  assert.equal(g.finishPatch(1), true)
})

test('RowRereadGate: a failed re-read neither applies nor leaves a count behind', () => {
  const g = new RowRereadGate()
  const t = g.startReread(1)
  assert.equal(g.finishReread(1, t, true), 'failed')
  g.startPatch(1)
  assert.equal(g.finishPatch(1), false)
  g.forget(1)
  assert.equal(g.finishReread(1, g.startReread(1)), 'apply')
})

console.log(`\n${passed} passed`)
