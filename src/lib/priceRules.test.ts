/** priceRules — run: node --experimental-strip-types src/lib/priceRules.test.ts */
import assert from 'node:assert/strict'
import { pptaOk, ppratingOk, tractRates, gatedPpta, resolveTractPrice, totalLabelFor } from './priceRules.ts'

let passed = 0
function test(name: string, fn: () => void) { fn(); passed++; console.log(`ok - ${name}`) }

test('ppta gate: >= 1 ac and >= 25%', () => {
  assert.equal(pptaOk(null, 10), false)
  assert.equal(pptaOk(0.9, 2), false)        // < 1 ac
  assert.equal(pptaOk(5, 40), false)          // 12.5%
  assert.equal(pptaOk(10, 40), true)          // exactly 25%
  assert.equal(pptaOk('30', '40'), true)
  assert.equal(pptaOk(10, null), false)
})

test('rating gate: >= 25% only', () => {
  assert.equal(ppratingOk(0.5, 1), true)
  assert.equal(ppratingOk(5, 40), false)
  assert.equal(ppratingOk(null, 40), false)
})

test('tractRates mirrors backend tract_rates', () => {
  const r = tractRates({ sale_price: 1737400, total_acres: 120, tillable_acres: 110, soil_rating: 80 })
  assert.equal(r.pricePerAcre, 14478.33)
  assert.equal(r.pricePerTillableAcre, 15794.55)
  assert.equal(r.pricePerSoilRating, 180.98)
  const timber = tractRates({ sale_price: 190000, total_acres: 38.9, tillable_acres: 0.5, soil_rating: 60 })
  assert.equal(timber.pricePerTillableAcre, null)
  assert.equal(timber.pricePerSoilRating, null)
  assert.deepEqual(tractRates({ sale_price: null, total_acres: 10 }), { pricePerAcre: null, pricePerTillableAcre: null, pricePerSoilRating: null })
})

test('gated stored copy', () => {
  assert.equal(gatedPpta(500000, 0.3, 40), null)
  assert.equal(gatedPpta(9000, 30, 40), 9000)
})

test('resolveTractPrice reads backend display fields; never splits asking', () => {
  const multi = { sale_price: null, asking_price: null, listing_asking_price: 2000000, listing_tract_count: 2,
    total_acres: 80, price_basis: 'asking', price_scope: 'listing', price_mode: 'per_acre',
    display_price_per_acre: 10000, display_total_price: 2000000 }
  const p = resolveTractPrice(multi, 'per_acre')
  assert.equal(p.pricePerAcre, 10000)
  assert.equal(p.scope, 'listing')
  assert.equal(totalLabelFor(p), 'Asking Price (whole listing, 2 tracts)')
  const small = resolveTractPrice({ sale_price: 117000, total_acres: 0.28, price_basis: 'sold', price_mode: 'total',
    display_price_per_acre: 417857.14, display_total_price: 117000 }, 'per_acre')
  assert.equal(small.mode, 'total')
  assert.equal(small.totalPrice, 117000)
  assert.equal(totalLabelFor(small), 'Sale Price')
  // old payload without display fields: sale rates, gated
  const old = resolveTractPrice({ sale_price: 400000, total_acres: 40, tillable_acres: 2, price_per_tillable_acre: 200000 }, 'per_acre')
  assert.equal(old.pricePerAcre, 10000)
  assert.equal(old.pricePerTillableAcre, null)
})

console.log(`${passed} passed`)
