/**
 * Standalone smoke test (no jest/vitest harness in this repo). Run with:
 *   node src/lib/savedTractLandTypes.test.ts
 */
import assert from 'node:assert/strict'
import { savedTractNeedsEngine } from './savedTractLandTypes.ts'

let passed = 0
function test(name: string, fn: () => void) { fn(); passed++; console.log(`ok - ${name}`) }

const sq = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }
const report = { source: 'report' }

test('report-saved tract never drawn in Map It goes to the engine', () => {
  assert.equal(savedTractNeedsEngine([], report), true)
  assert.equal(savedTractNeedsEngine(undefined, report), true)
  assert.equal(savedTractNeedsEngine([{ geometry: null }], report), true)
})
test('saved polygons always open as saved', () => {
  assert.equal(savedTractNeedsEngine([{ geometry: sq }], report), false)
  assert.equal(savedTractNeedsEngine([{ geometry: sq }], {}), false)
})
test('a report tract saved once in Map It keeps its (even empty) drawing', () => {
  assert.equal(savedTractNeedsEngine([], { source: 'report', land_types_saved: true }), false)
})
test('a Map It tract with no polygons is never re-run through the engine', () => {
  assert.equal(savedTractNeedsEngine([], {}), false)
  assert.equal(savedTractNeedsEngine([], null), false)
})

console.log(`\n${passed} passed`)
