/**
 * summarizeComps — the one comp-report summary. Pins the SAME fixture the
 * backend (comps_summary.SHARED_FIXTURE) and the app pin, so the three
 * implementations cannot drift. No test harness in this repo: run with
 *   node src/lib/compAverages.test.ts
 */
import assert from 'node:assert/strict'
import { summarizeComps, computeCompAverages } from './compAverages.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}
const near = (a: number | null, b: number, tol = 0.01) => {
  assert.ok(a !== null && Math.abs(a - b) <= tol, `${a} !~ ${b}`)
}

const FIXTURE = [
  { sale_price: 300000, total_acres: 40, tillable_acres: 20, soil_rating: 100 },
  { price_per_acre: 6000, total_acres: 80, tillable_acres: 60, soil_rating: 110 },
  { sale_price: 240000, total_acres: 60, tillable_acres: 40, soil_rating: 90 },
]

test('shared fixture values', () => {
  const s = summarizeComps(FIXTURE)
  assert.equal(s.count, 3)
  assert.equal(s.totalAcres, 180)
  assert.equal(s.totalTillable, 120)
  near(s.pctTillable, 66.667)
  assert.equal(s.totalSale, 1_020_000)
  near(s.avgPricePerAcre, 5666.67)
  near(s.avgPricePerTillable, 8500)
  near(s.avgPricePerSoil, 1_020_000 / (100 * 40 + 110 * 80 + 90 * 60), 0.0001)
  assert.equal(s.avgAcres, 60)
  assert.equal(s.avgTillable, 40)
  near(s.soilRating, (100 * 20 + 110 * 60 + 90 * 40) / 120) // not the plain mean 100
  assert.equal(s.ratedCount, 3)
})

test('camelCase and string inputs read the same', () => {
  const s = summarizeComps([
    { salePrice: '300000', totalAcres: '40', tillableAcres: '20', soilRating: '100' },
    { pricePerAcre: 6000, totalAcres: 80, tillableAcres: 60, soilRating: 110 },
    { salePrice: 240000, totalAcres: 60, tillableAcres: 40, soilRating: 90 },
  ])
  near(s.avgPricePerAcre, 5666.67)
  near(s.soilRating, 101.667)
})

test('comps without tillable acres do not rate', () => {
  const s = summarizeComps([
    { total_acres: 40, tillable_acres: 0, soil_rating: 150 },
    { total_acres: 40, tillable_acres: 40, soil_rating: 100 },
  ])
  assert.equal(s.soilRating, 100)
  assert.equal(s.ratedCount, 1)
  assert.equal(s.totalSale, null)
  assert.equal(s.avgPricePerAcre, null)
  assert.equal(s.pctTillable, 50)
})

test('empty', () => {
  const s = summarizeComps([])
  assert.equal(s.count, 0)
  assert.equal(s.totalAcres, null)
  assert.equal(s.soilRating, null)
})

test('computeCompAverages mirrors summarizeComps', () => {
  const a = computeCompAverages(FIXTURE)
  near(a.avgPricePerAcre, 5666.67)
  near(a.avgSoilRating, 101.667)
})

console.log(`${passed} passed`)
