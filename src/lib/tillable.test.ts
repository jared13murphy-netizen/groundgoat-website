/**
 * Standalone smoke test for formatTillable — this repo has no jest/vitest
 * harness configured (see polygonCentroid.test.ts), so this is a plain
 * runnable script (Node 22+ strips TS types natively). Run with:
 *   node src/lib/tillable.test.ts
 */
import assert from 'node:assert/strict'
import { formatTillable } from './tillable.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

test('tillable + total present -> acres and pct both computed', () => {
  const r = formatTillable(100, 52, null)
  assert.equal(r.acresText, '52 ac')
  assert.equal(r.pctText, '52%')
  assert.equal(r.inlineText, '52 ac · 52%')
})

test('API pct_tillable is preferred over the locally-computed value', () => {
  // API says 53% (its own rounding/derivation) even though 52/100 = 52%.
  const r = formatTillable(100, 52, 53)
  assert.equal(r.pctText, '53%')
})

test('tillable missing, falls back to total * pct/100 for the acres text', () => {
  const r = formatTillable(200, null, 75)
  assert.equal(r.acresText, '150 ac')
  assert.equal(r.pctText, '75%')
  assert.equal(r.inlineText, '150 ac · 75%')
})

test('genuine 0% tillable is not treated as missing', () => {
  const r = formatTillable(100, 0, null)
  assert.equal(r.acresText, '0 ac')
  assert.equal(r.pctText, '0%')
})

test('total missing/zero hides the percent but still shows acres', () => {
  const a = formatTillable(null, 40, null)
  assert.equal(a.acresText, '40 ac')
  assert.equal(a.pctText, null)
  assert.equal(a.inlineText, '40 ac')

  const b = formatTillable(0, 40, 40)
  assert.equal(b.acresText, '40 ac')
  assert.equal(b.pctText, null)
})

test('nothing to resolve -> em dash, no percent', () => {
  const r = formatTillable(null, null, null)
  assert.equal(r.acresText, '—')
  assert.equal(r.pctText, null)
  assert.equal(r.inlineText, '—')
})

test('tolerates API-string DECIMAL fields (pydantic serializes Decimal as string)', () => {
  const r = formatTillable('100.00', '59.94', null)
  assert.equal(r.acresText, '59.94 ac')
  assert.equal(r.pctText, '60%')
})

console.log(`\n${passed} passed`)
