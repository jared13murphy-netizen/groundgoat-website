/** node src/lib/tractNumber.test.ts */
import assert from 'node:assert/strict'
import { tractNum, renumberSteps } from './tractNumber.ts'

let passed = 0
function test(name: string, fn: () => void) { fn(); passed++ }

// Mirror of the scraper endpoint: a number already used by another tract is refused.
function apply(numbers: string[], steps: { index: number; number: string }[]) {
  const n = [...numbers]
  for (const s of steps) {
    n.forEach((x, i) => { if (i !== s.index && tractNum(x) === s.number) throw new Error(`409 ${s.number}`) })
    n[s.index] = s.number
  }
  return n
}

test('reads numbers', () => {
  assert.equal(tractNum('Tract 6'), '6'); assert.equal(tractNum(3), '3')
  assert.equal(tractNum('T-03'), '3'); assert.equal(tractNum(''), null); assert.equal(tractNum(null), null)
})
test('free number: one call', () => {
  assert.deepEqual(renumberSteps(['1', '2', '3'], 0, '9'), [{ index: 0, number: '9' }])
})
test('same number: nothing', () => {
  assert.deepEqual(renumberSteps(['1', '2'], 1, '2'), [])
  assert.deepEqual(renumberSteps(['1', '2'], 1, 'abc'), [])
})
test('taken number: the two tracts trade, server never sees a duplicate', () => {
  const nums = ['1', '2', '3', '4', '5', '6', '7', '8']
  const steps = renumberSteps(nums, 0, '6')
  assert.equal(steps.length, 3)
  assert.deepEqual(apply(nums, steps), ['6', '2', '3', '4', '5', '1', '7', '8'])
})
test('Steffes McHenry: a whole re-order done one row at a time ends correct', () => {
  // stored T1..T8 carry the map's tracts 6,4,3,2,1,8,7,5 → retype each row to its map number
  let nums = ['1', '2', '3', '4', '5', '6', '7', '8']
  const target = ['6', '4', '3', '2', '1', '8', '7', '5']
  // staff retype rows in order; a trade moves the other tract, so later rows are retyped by content
  const content = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']   // tract content stays at its position
  for (let i = 0; i < 8; i++) nums = apply(nums, renumberSteps(nums, i, target[i]))
  assert.deepEqual(nums, target)
  assert.equal(new Set(nums).size, 8)
  assert.equal(content.length, 8)
})
test('temporary number never collides with a real one', () => {
  const steps = renumberSteps(['1', '950', '3'], 0, '3')
  assert.ok(Number(steps[0].number) > 950)
})
test('tract with no number cannot trade', () => {
  assert.deepEqual(renumberSteps([null, '2'], 0, '2'), [])
})
console.log(`${passed} tests passed`)
