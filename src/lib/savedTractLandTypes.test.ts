/**
 * Standalone smoke test (no jest/vitest harness in this repo). Run with:
 *   node src/lib/savedTractLandTypes.test.ts
 */
import assert from 'node:assert/strict'
import { savedTractNeedsEngine } from './savedTractLandTypes.ts'

let passed = 0
function test(name: string, fn: () => void) { fn(); passed++; console.log(`ok - ${name}`) }

const sq = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }

test('report-saved tract (no polygons) goes to the engine', () => {
  assert.equal(savedTractNeedsEngine([]), true)
})
test('missing polygons field goes to the engine', () => {
  assert.equal(savedTractNeedsEngine(undefined), true)
  assert.equal(savedTractNeedsEngine(null), true)
})
test('polygons without geometry go to the engine', () => {
  assert.equal(savedTractNeedsEngine([{ geometry: null }]), true)
})
test('a Map It drawing keeps its stored polygons', () => {
  assert.equal(savedTractNeedsEngine([{ geometry: sq }]), false)
  assert.equal(savedTractNeedsEngine([{ geometry: null }, { geometry: sq }]), false)
})

console.log(`\n${passed} passed`)
