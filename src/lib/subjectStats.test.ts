/**
 * Standalone smoke test for subjectTillableAcres — this repo has no
 * jest/vitest harness configured (see polygonCentroid.test.ts), so this is
 * a plain runnable script (Node 22+ strips TS types natively). Run with:
 *   node src/lib/subjectStats.test.ts
 *
 * Covers the null-vs-0 bug this helper was extracted to fix: a genuine 0
 * (0% tillable) must resolve to the number 0, never null — only missing
 * data (nothing to compute from) should resolve to null.
 */
import assert from 'node:assert/strict'
import { subjectTillableAcres } from './subjectStats.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

test('tillable_acres present wins outright, even when 0', () => {
  assert.equal(subjectTillableAcres(100, 0, 50), 0)
  assert.equal(subjectTillableAcres(100, 42.5, null), 42.5)
})

test('tillable_acres null, pct 0 -> falls back to total * 0/100 = 0, not null', () => {
  assert.equal(subjectTillableAcres(100, null, 0), 0)
})

test('tillable_acres and total_acres both null/undefined -> null regardless of pct', () => {
  assert.equal(subjectTillableAcres(null, null, 50), null)
  assert.equal(subjectTillableAcres(undefined, undefined, undefined), null)
})

test('tillable_acres null, pct null -> null (nothing to compute from)', () => {
  assert.equal(subjectTillableAcres(100, null, null), null)
  assert.equal(subjectTillableAcres(100, undefined, undefined), null)
})

test('tillable_acres null, falls back to total * pct/100', () => {
  assert.equal(subjectTillableAcres(200, null, 75), 150)
})

test('tolerates API-string DECIMAL fields (pydantic serializes Decimal as string)', () => {
  assert.equal(subjectTillableAcres('100.00', '0.00', null), 0)
  assert.equal(subjectTillableAcres('200', null, '75'), 150)
})

console.log(`\n${passed} passed`)
