/**
 * parcelFigures — the website displays the server's parcel figures and never
 * computes them; without `figures` (old API) it falls back to the pre-11/19
 * parcel-panel derivation. No test harness in this repo: run with
 *   node src/lib/parcelFigures.test.ts
 */
import assert from 'node:assert/strict'
import {
  parcelFigures, fromServerFigures, legacyParcelFigures, findServerFigures, savedTractFigures,
  parcelRowFields, rowPctTillable,
  fmtFigMoney, fmtFigAcres, fmtFigPct, fmtFigRating, perRatingLabel, figText, UPDATING,
} from './parcelFigures.ts'

let passed = 0
function test(name: string, fn: () => void) { fn(); passed++; console.log(`ok - ${name}`) }

const SERVER = {
  price: 257931, price_source: 'split', regrid_saleprice: 1400820, saledate: '2025-03-14',
  acres: 40.12, tillable_acres: 36.5, pct_tillable: 0.9097, timber_acres: 2.1, pct_timber: 0.0523,
  water_acres: 0.4, pct_water: 0.01, pasture_acres: 0, pct_pasture: 0, pond_acres: 0.4, pct_pond: 0.01,
  rating: 131.24, rating_label: 'PI',
  price_per_acre: 6428.99, price_per_tillable_acre: 7066.6, price_per_rating: 48.99,
  remeasuring: false, land_types: ['Farm'],
}

test('server figures are read as sent — never re-derived', () => {
  // Deliberately inconsistent with price ÷ acres: the client must not "fix" it.
  const f = parcelFigures({ saleprice: 1, ll_gisacre: 1, figures: { ...SERVER, price_per_acre: 1234 } })
  assert.equal(f.fromServer, true)
  assert.equal(f.price, 257931)
  assert.equal(f.priceSource, 'split')
  assert.equal(f.regridSalePrice, 1400820)
  assert.equal(f.acres, 40.12)
  assert.equal(f.pricePerAcre, 1234)
  assert.equal(f.pricePerTillableAcre, 7066.6)
  assert.equal(f.pricePerRating, 48.99)
  assert.equal(f.ratingLabel, 'PI')
  assert.deepEqual(f.landTypes, ['Farm'])
})

test('server percents (0..1) become 0-100 for display', () => {
  const f = fromServerFigures(SERVER as any)
  assert.ok(Math.abs(f.pctTillable! - 90.97) < 1e-9)
  assert.equal(fmtFigPct(f.pctTillable), '91%')
  assert.equal(fmtFigPct(f.pctTimber), '5%')
})

test('enrichment figures win over the record copy', () => {
  const f = parcelFigures({ figures: { ...SERVER, price: 1 } }, { figures: SERVER })
  assert.equal(f.price, 257931)
  assert.equal(findServerFigures(null, undefined, { figures: [1] }), null)
})

test('numeric strings (DECIMAL columns) are coerced', () => {
  const f = fromServerFigures({ price: '1000', acres: '10.5', pct_tillable: '0.5', rating_label: 'csr2' } as any)
  assert.equal(f.price, 1000)
  assert.equal(f.acres, 10.5)
  assert.equal(f.pctTillable, 50)
  assert.equal(f.ratingLabel, 'CSR2')
})

test('unknown rating label → null → "$/Soil Rating"', () => {
  assert.equal(fromServerFigures({ rating_label: 'point' } as any).ratingLabel, null)
  assert.equal(perRatingLabel(null), '$/Soil Rating')
  assert.equal(perRatingLabel('CSR2'), '$/CSR2')
})

test('OLD API: pre-11/19 derivation, unchanged (allocated share, floors)', () => {
  const rec = { saleprice: 1400820, parcel_sale_price: 257931, deed_parcel_count: 9, ll_gisacre: 40, gisacre: 41 }
  const f = parcelFigures(rec, { tillable_acres: 36, pct_tillable: 90, soil_rating: 130, soil_rating_type: 'PI' })
  assert.equal(f.fromServer, false)
  assert.equal(f.price, 257931)
  assert.equal(f.priceSource, 'split')
  assert.equal(f.acres, 40)
  assert.equal(f.pricePerAcre, 257931 / 40)
  assert.equal(f.pricePerTillableAcre, 257931 / 36)
  assert.equal(f.pricePerRating, 257931 / 40 / 130)
  assert.equal(f.pctTillable, 90) // passes through in the old unit
})

test('OLD API: $/tillable and $/rating hide below 25% tillable', () => {
  const f = legacyParcelFigures({ saleprice: 190000, ll_gisacre: 38.9 }, { tillable_acres: 2, soil_rating: 120 })
  assert.equal(f.pricePerTillableAcre, null)
  assert.equal(f.pricePerRating, null)
  assert.ok(f.pricePerAcre! > 0)
})

test('OLD API: tile props are the fallback record', () => {
  const f = parcelFigures(null, null, { gisacre: 12.5, saleprice: 50000 })
  assert.equal(f.acres, 12.5)
  assert.equal(f.pricePerAcre, 4000)
})

test('remeasuring → "Updating…" on tillable/timber/water/rating only', () => {
  const f = fromServerFigures({ ...SERVER, remeasuring: true } as any)
  assert.equal(figText(f, 'tillable', fmtFigAcres(f.tillableAcres)), UPDATING)
  assert.equal(figText(f, 'rating', fmtFigRating(f.rating)), UPDATING)
  assert.equal(figText(f, null, fmtFigMoney(f.price)), '$257,931')
  assert.equal(UPDATING, 'Updating…')
})

test('display rounding: whole dollars, acres 2dp, whole %, rating 1dp', () => {
  assert.equal(fmtFigMoney(6428.99), '$6,429')
  assert.equal(fmtFigMoney(0), null)
  assert.equal(fmtFigAcres(38.694), '38.69')
  assert.equal(fmtFigAcres(1234.5), '1,234.50')
  assert.equal(fmtFigPct(90.5), '91%')
  assert.equal(fmtFigRating(131.24), '131.2')
})

test('report row from server figures carries the server rates (rowPrice reads them)', () => {
  const r = parcelRowFields(fromServerFigures(SERVER as any), 'per_acre') as any
  assert.equal(r.salePrice, 257931)
  assert.equal(r.totalAcres, 40.12)
  assert.equal(r.serverFigures, true)
  assert.equal(r.price.pricePerAcre, 6428.99)
  assert.equal(r.price.pricePerTillableAcre, 7066.6)
  assert.equal(r.price.pricePerSoilRating, 48.99)
  assert.equal(r.price.basis, 'sold')
})

test('report row from the old API has no `price` (rowPrice works as before)', () => {
  const r = parcelRowFields(legacyParcelFigures({ saleprice: 1000, ll_gisacre: 10 }), 'per_acre') as any
  assert.equal(r.price, undefined)
  assert.equal(r.pricePerAcre, 100)
})

test('rowPctTillable: server rows never derive; other rows keep the fallback', () => {
  assert.equal(rowPctTillable({ pctTillable: null, tillableAcres: 5, totalAcres: 10, serverFigures: true }), null)
  assert.equal(rowPctTillable({ pctTillable: null, tillableAcres: 5, totalAcres: 10 }), 50)
  assert.equal(rowPctTillable({ pctTillable: 42, tillableAcres: 5, totalAcres: 10 }), 42)
})

test('saved tract: server figures, else the old numbers', () => {
  assert.equal(savedTractFigures({ acres: 80, tillable_acres: 60, figures: SERVER }).acres, 40.12)
  const old = savedTractFigures({ acres: 80, tillable_acres: 60, soil: { rating: 120, rating_type: 'CSR2' } })
  assert.equal(old.pctTillable, 75)
  assert.equal(old.ratingLabel, 'CSR2')
  assert.equal(savedTractFigures(null).acres, null)
})

console.log(`\n${passed} passed`)
