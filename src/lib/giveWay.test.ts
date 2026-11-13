/**
 * Map It: deleting a dot must not move any other dot (owner 11/13).
 * No test harness in this repo: run with
 *   node --import ./scripts/ts-alias.mjs src/lib/giveWay.test.ts
 *
 * The fixture is a real engine-classified parcel (/us/il/white/mill-shoals/16615:
 * tillable, timber and water meeting along raster edges) with one dot removed
 * from the tillable polygon, plus the two REAL server answers for that state,
 * recorded from the production PostGIS (GEOS 3.12) on 11/13:
 *   - `normalize`: the old full clean-up (/geometry/normalize), which the
 *     editor ran after every delete;
 *   - `giveWay`:   the new /geometry/give-way answer.
 *
 * Measured on 17 real parcels before the fix: dots far from the deleted one
 * moved up to 1.2 m and user dots vanished; with the fix, 0 (see the PR).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyGiveWay, dropSpeckRings, explodeShapes, pointInBoundary, stripInsertedVertices, type Shape } from '@/lib/cmShapes'

type Pt = [number, number]
const M = (a: Pt, b: Pt) => {
  const k = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180)
  return Math.hypot((a[0] - b[0]) * k, a[1] - b[1]) * 111320
}
const pts = (sh: Shape[]): Pt[] => sh.flatMap((s) => s.polys.flatMap((rings) => rings.flat())) as Pt[]

/** For every dot inside the boundary before the clean-up: how far away is
 *  the nearest dot after it? 0 = kept exactly. */
function displacement(before: Shape[], after: Shape[], boundary: Pt[][][]) {
  const A = pts(after)
  return pts(before).filter((p) => pointInBoundary(p, boundary))
    .map((p) => Math.min(...A.map((q) => M(p, q))))
}

const fx = JSON.parse(readFileSync(new URL('./__fixtures__/giveWay-delete-dot.json', import.meta.url), 'utf8'))

// The old clean-up reproduces the bug on this exact state …
{
  const after = stripInsertedVertices(explodeShapes(fx.normalize.polygons), fx.before)
  const moved = displacement(fx.before, after, fx.boundary).filter((d) => d > 0.01)
  assert.ok(moved.length > 0, 'fixture should reproduce dots moving with the old clean-up')
}

// … and the give-way answer keeps every other dot where it was (< 1 cm).
{
  const after = applyGiveWay(fx.before, fx.editedId, fx.giveWay)
  const d = displacement(fx.before, after, fx.boundary)
  assert.equal(d.filter((x) => x > 0.01).length, 0, `dots moved: max ${Math.max(...d).toFixed(3)} m`)
  // the edited shape keeps its id (stays selected)
  assert.ok(after.some((s) => s.id === fx.editedId))
  // shapes the server left alone are the very same objects
  const unchanged = fx.giveWay.others.filter((o: any) => !o.changed).length
  const others = fx.before.filter((s: Shape) => s.id !== fx.editedId)
  assert.ok(unchanged > 0)
  assert.equal(others.filter((s: Shape) => after.includes(s)).length, unchanged)
}

// Unit: identity, order, cut, consumed, clipped edited shape.
{
  const sq = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  const geo = (r: Pt[]) => ({ type: 'Polygon', coordinates: [[...r, r[0]]] })
  const a: Shape = { id: 'a', cls: 'water', polys: [[sq(5, 0, 10, 5)]] }
  const e: Shape = { id: 'e', cls: 'tillable', polys: [[sq(0, 0, 7, 5)]] }
  const b: Shape = { id: 'b', cls: 'other', polys: [[sq(6, 1, 6.5, 1.5)]] }
  const c: Shape = { id: 'c', cls: 'timber', polys: [[sq(0, 5, 10, 10)]] }
  const shapes = [a, e, b, c]

  // nothing overlapped, edited inside: the SAME array contents back
  const same = applyGiveWay(shapes, 'e', {
    edited: { cls: 'tillable', changed: false, geometry: null },
    others: [{ cls: 'water', changed: false }, { cls: 'other', changed: false }, { cls: 'timber', changed: false }],
  })
  assert.deepEqual(same.map((s) => s.id), ['a', 'e', 'b', 'c'])
  same.forEach((s, i) => assert.equal(s, shapes[i]))

  // water cut back to x>=7, the small 'other' swallowed, timber untouched
  const cut = applyGiveWay(shapes, 'e', {
    edited: { cls: 'tillable', changed: false, geometry: null },
    others: [
      { cls: 'water', changed: true, geometry: geo(sq(7, 0, 10, 5)) },
      { cls: 'other', changed: true, geometry: null },
      { cls: 'timber', changed: false },
    ],
  })
  assert.deepEqual(cut.map((s) => s.cls), ['water', 'tillable', 'timber'])
  assert.equal(cut[1], e)
  assert.equal(cut[2], c)
  assert.deepEqual(cut[0].polys, [[sq(7, 0, 10, 5)]])

  // edited shape clipped to the boundary keeps its id
  const clipped = applyGiveWay([e], 'e', {
    edited: { cls: 'tillable', changed: true, geometry: geo(sq(0, 0, 6, 5)) }, others: [],
  })
  assert.equal(clipped.length, 1)
  assert.equal(clipped[0].id, 'e')
  assert.deepEqual(clipped[0].polys, [[sq(0, 0, 6, 5)]])

  // edited shape entirely outside the boundary goes away
  assert.equal(applyGiveWay([e, c], 'e', {
    edited: { cls: 'tillable', changed: true, geometry: null }, others: [{ cls: 'timber', changed: false }],
  }).map((s) => s.id).join(), 'c')
}

// Unit: rounding debris — a hole folded onto itself, a sub-square-metre hole
// (real case 11/13: an 83 ac tillable polygon carried a 3-point hole that
// PostGIS rejected as "Too few points", so its dots vanished on the next edit).
{
  const outer: Pt[] = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]]
  const folded: Pt[] = [[0.005, 0.005], [0.005, 0.005], [0.006, 0.006]]
  const speck: Pt[] = [[0.002, 0.002], [0.002000005, 0.002], [0.002, 0.002000005]]
  const real: Pt[] = [[0.003, 0.003], [0.004, 0.003], [0.004, 0.004]]
  const [sh] = dropSpeckRings([{ id: 'x', cls: 'tillable', polys: [[outer, folded, speck, real]] }])
  assert.deepEqual(sh.polys, [[outer, real]])
  assert.equal(dropSpeckRings([{ id: 'y', cls: 'water', polys: [[[[1, 1], [1, 1], [2, 2]]]] }]).length, 0)
}

console.log('giveWay.test.ts: ok')
