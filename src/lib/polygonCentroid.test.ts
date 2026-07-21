/**
 * Standalone smoke test for polygonCentroid — this repo has no
 * jest/vitest harness configured, so this is a plain runnable script
 * (Node 22+ strips TS types natively). Run with:
 *   node src/lib/polygonCentroid.test.ts
 * Mirrors ground-goat-backend/tests/test_tract_polygon_centroid.py so the
 * client util is verified against the exact same fixtures as the backend
 * algorithm it ports.
 */
import assert from 'node:assert/strict'
import { polygonAreaCentroid, resolveTractDotLngLat } from './polygonCentroid.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

test('square centroid is its center', () => {
  const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const result = polygonAreaCentroid(square)
  assert.ok(result)
  const [lng, lat] = result!
  assert.ok(Math.abs(lng - 0.5) < 1e-9)
  assert.ok(Math.abs(lat - 0.5) < 1e-9)
})

test('square centroid unaffected by uneven vertex density', () => {
  const square: [number, number][] = [
    [0, 0], [0.25, 0], [0.5, 0], [0.75, 0], [1, 0],
    [1, 1], [0, 1],
  ]
  const result = polygonAreaCentroid(square)
  assert.ok(result)
  const [lng, lat] = result!
  assert.ok(Math.abs(lng - 0.5) < 1e-9)
  assert.ok(Math.abs(lat - 0.5) < 1e-9)
})

test('L-shape centroid is pulled off the bounding-box center', () => {
  const lShape: [number, number][] = [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]
  const result = polygonAreaCentroid(lShape)
  assert.ok(result)
  const [lng, lat] = result!
  const totalArea = 3 + 2
  const expectedLng = (3 * 1.5 + 2 * 0.5) / totalArea
  const expectedLat = (3 * 0.5 + 2 * 2.0) / totalArea
  assert.ok(Math.abs(lng - expectedLng) < 1e-6)
  assert.ok(Math.abs(lat - expectedLat) < 1e-6)
  // Not the naive bounding-box center (1.5, 1.5)
  assert.ok(Math.abs(lng - 1.5) > 0.1 || Math.abs(lat - 1.5) > 0.1)
})

test('nested single-ring multi-polygon shape unwraps correctly', () => {
  const squareNested = [[[0, 0], [1, 0], [1, 1], [0, 1]]]
  const result = polygonAreaCentroid(squareNested)
  assert.ok(result)
  const [lng, lat] = result!
  assert.ok(Math.abs(lng - 0.5) < 1e-9)
  assert.ok(Math.abs(lat - 0.5) < 1e-9)
})

test('multi-ring (disjoint pieces) weights by area, not simple average', () => {
  const bigSquare: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]] // area 100, center (5,5)
  const smallSquare: [number, number][] = [[20, 20], [21, 20], [21, 21], [20, 21]] // area 1, center (20.5,20.5)
  const result = polygonAreaCentroid([bigSquare, smallSquare])
  assert.ok(result)
  const [lng, lat] = result!
  const expected = (100 * 5 + 1 * 20.5) / 101
  assert.ok(Math.abs(lng - expected) < 1e-6)
  assert.ok(Math.abs(lat - expected) < 1e-6)
})

test('degenerate (collinear) polygon falls back to vertex average', () => {
  const collinear: [number, number][] = [[0, 0], [1, 1], [2, 2]]
  const result = polygonAreaCentroid(collinear)
  assert.ok(result)
  const [lng, lat] = result!
  assert.ok(Math.abs(lng - 1.0) < 1e-9)
  assert.ok(Math.abs(lat - 1.0) < 1e-9)
})

test('fewer than 3 points returns null', () => {
  assert.equal(polygonAreaCentroid([[0, 0], [1, 1]]), null)
  assert.equal(polygonAreaCentroid([]), null)
  assert.equal(polygonAreaCentroid(null), null)
})

test('clockwise winding gives same centroid as counter-clockwise', () => {
  const ccw: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const cw: [number, number][] = [[0, 0], [0, 1], [1, 1], [1, 0]]
  const rCcw = polygonAreaCentroid(ccw)
  const rCw = polygonAreaCentroid(cw)
  assert.ok(rCcw && rCw)
  assert.ok(Math.abs(rCcw![0] - rCw![0]) < 1e-9)
  assert.ok(Math.abs(rCcw![1] - rCw![1]) < 1e-9)
})

test('real Failoni polygon centroid matches backend fixture (~[-89.772, 39.100])', () => {
  // Same fixture as ground-goat-backend/tests/test_tract_polygon_centroid.py
  // ::test_real_failoni_polygon_centroid_not_the_stale_geocode — tract 4 of
  // the Failoni Estate listing (Macoupin County, IL). Every tract on this
  // listing shared one stale scraped geocode (39.2420653, -89.925212) ~9
  // miles from this tract's real boundary; the centroid must come from the
  // polygon, not that stale point.
  const failoniTract4Polygon: [number, number][] = [
    [-89.7742819066669, 39.102672448525865],
    [-89.7719589832543, 39.10270283641485],
    [-89.77194538166323, 39.10094539792885],
    [-89.76964336165304, 39.10102832658236],
    [-89.76956311000902, 39.097926809435734],
    [-89.77251913191364, 39.09787569714568],
    [-89.7725395342935, 39.09881515547203],
    [-89.77415132230759, 39.098825711111786],
    [-89.77409011516764, 39.096630103716],
    [-89.77417852548074, 39.0966248257305],
  ]
  const result = polygonAreaCentroid(failoniTract4Polygon)
  assert.ok(result)
  const [lng, lat] = result!
  assert.ok(Math.abs(lat - 39.10) < 0.02)
  assert.ok(Math.abs(lng - -89.774) < 0.02)
  assert.ok(Math.abs(lat - 39.2420653) > 0.1) // nowhere near the stale shared geocode
})

test('resolveTractDotLngLat prefers stored lat/lng over polygon centroid', () => {
  const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const result = resolveTractDotLngLat(39.5, -89.5, square)
  assert.deepEqual(result, [-89.5, 39.5])
})

test('resolveTractDotLngLat falls back to polygon centroid when stored coord missing', () => {
  const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const result = resolveTractDotLngLat(null, null, square)
  assert.ok(result)
  assert.ok(Math.abs(result![0] - 0.5) < 1e-9)
  assert.ok(Math.abs(result![1] - 0.5) < 1e-9)
})

test('resolveTractDotLngLat returns null with no stored coord and no usable polygon', () => {
  assert.equal(resolveTractDotLngLat(null, undefined, [[0, 0], [1, 1]]), null)
  assert.equal(resolveTractDotLngLat(undefined, undefined, null), null)
})

console.log(`\n${passed} passed`)
