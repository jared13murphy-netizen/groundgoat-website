/**
 * Owner 11/17: a parcel report row re-reads its figures from the one parcel
 * record; an explicit null is a dash, never the row's old copy.
 *   node --experimental-strip-types src/lib/parcelFiguresPatch.test.ts
 */
import assert from 'node:assert/strict'
import { figuresPatch } from './parcelFiguresPatch.ts'

let passed = 0
function test(name: string, fn: () => void) { fn(); passed++; console.log(`ok - ${name}`) }

test('one-record figures replace the row copy (Sullivan 57.214 -> 55.39)', () => {
  const p = figuresPatch({ tillable_acres: 55.39278030395508, pct_tillable: 66.93415832519531, soil_rating: 135.42, soil_rating_type: 'PI' })
  assert.equal(p.tillableAcres, 55.39278030395508)
  assert.equal(p.pctTillable, 66.93415832519531)
  assert.equal(p.soilRating, 135.42)
  assert.equal(p.soilRatingType, 'PI')
})

test('explicit null clears the row figure (a dash, never a second number)', () => {
  const p = figuresPatch({ tillable_acres: null, pct_tillable: null, soil_rating: null, soil_rating_type: null })
  assert.deepEqual(p, { tillableAcres: null, pctTillable: null, soilRating: null, soilRatingType: null })
})

test('absent keys / no body leave the row alone', () => {
  assert.deepEqual(figuresPatch({ owner: 'x' }), {})
  assert.deepEqual(figuresPatch(null), {})
})

test('$/till on the row follows the patched tillable', () => {
  const row = { totalAcres: 82.82, pricePerAcre: 899186 / 82.82, tillableAcres: 57.214 }
  Object.assign(row, figuresPatch({ tillable_acres: 55.39278030395508 }))
  assert.equal(Math.round((row.pricePerAcre * row.totalAcres) / row.tillableAcres), 16233)
})

console.log(`\n${passed} passed`)
