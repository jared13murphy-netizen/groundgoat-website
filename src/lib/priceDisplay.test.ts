/**
 * Price display mode (owner 11/4): small or non-ag tracts show the total,
 * labelled Sale/Asking Price, never $/Acre. Mirrors the app's
 * src/utils/priceDisplay.test.mjs. No test harness in this repo: run with
 *   node src/lib/priceDisplay.test.ts
 */
import assert from 'node:assert/strict'
import { tractPriceMode, listingPriceMode, totalPriceOf, totalPriceLabel } from './priceDisplay.ts'

assert.equal(tractPriceMode({ total_acres: 0.28, land_type: 'Commercial' }), 'total')
assert.equal(tractPriceMode({ total_acres: 40, land_types: ['Farm', 'Residential'] }), 'per_acre')
assert.equal(tractPriceMode({ total_acres: 9.9, land_type: 'Farm' }), 'total')
assert.equal(tractPriceMode({ total_acres: 10, land_type: 'Farm' }), 'per_acre')
assert.equal(tractPriceMode({ total_acres: 25, land_types: ['Residential', 'Commercial'] }), 'total')
assert.equal(tractPriceMode({ total_acres: 80 }), 'per_acre')
assert.equal(listingPriceMode({ tracts: [{ total_acres: 0.28, land_type: 'Commercial' }, { total_acres: 27.69, land_type: 'Farm' }] }), 'per_acre')
assert.equal(listingPriceMode({ tracts: [{ total_acres: 0.28, land_type: 'Commercial' }] }), 'total')
assert.equal(totalPriceOf({ sale_price: '117000', asking_price: 150000 }), 117000)
assert.equal(totalPriceOf({}), null)
assert.equal(totalPriceLabel('asking'), 'Asking Price')
assert.equal(totalPriceLabel('sold'), 'Sale Price')
console.log('priceDisplay ok')
