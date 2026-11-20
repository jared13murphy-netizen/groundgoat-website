/**
 * parcelFigures — the website displays the server's parcel figures and print
 * strings (figures.display) and never computes or formats them; without
 * `figures` every figure is "—" (no fallback). No test harness: run with
 *   node src/lib/parcelFigures.test.ts
 */
import assert from 'node:assert/strict'
import {
  parcelFigures, fromServerFigures, findServerFigures, savedTractFigures,
  parcelRowFields, rowPctTillable, figDisplay, figShown, rowDisplay, rowCells, compositionText, ratingText, DASH,
  fmtFigMoney, fmtFigAcres, fmtFigPct, fmtFigRating, perRatingLabel, figText, UPDATING,
} from './parcelFigures.ts'

let passed = 0
function test(name: string, fn: () => void) { fn(); passed++; console.log(`ok - ${name}`) }

const DISPLAY = {
  acres: '40.12', tillable_acres: '36.50', timber_acres: '2.10', water_acres: '0.40', pasture_acres: '0.00',
  pond_acres: '0.40', price: '$257,931', price_per_acre: '$6,429', price_per_tillable_acre: '$7,067',
  price_per_rating: '$49', pct_tillable: '91%', rating: '131.2', rating_label: 'PI', sale_date: '03/14/2025',
}

const SERVER = {
  price: 257931, price_source: 'split', regrid_saleprice: 1400820, saledate: '2025-03-14',
  acres: 40.12, tillable_acres: 36.5, pct_tillable: 0.9097, timber_acres: 2.1, pct_timber: 0.0523,
  water_acres: 0.4, pct_water: 0.01, pasture_acres: 0, pct_pasture: 0, pond_acres: 0.4, pct_pond: 0.01,
  rating: 131.24, rating_label: 'PI',
  price_per_acre: 6428.99, price_per_tillable_acre: 7066.6, price_per_rating: 48.99,
  remeasuring: false, land_types: ['Farm'],
  display: DISPLAY, price_mode: 'per_acre', updating: false,
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

test('NO fallback: a payload without figures is all dashes, tile/record numbers ignored', () => {
  const f = parcelFigures({ saleprice: 1400820, parcel_sale_price: 257931, ll_gisacre: 40, gisacre: 41, tillable_acres: 36 }, { tillable_acres: 36, soil_rating: 130 })
  assert.equal(f.fromServer, false)
  assert.equal(f.price, null)
  assert.equal(f.acres, null)
  assert.equal(f.pricePerAcre, null)
  assert.equal(f.display, null)
  assert.equal(figDisplay(f, 'price_per_acre'), DASH)
  assert.equal(figDisplay(f, 'acres'), '—')
})

test('display strings are read verbatim — never reformatted', () => {
  // Deliberately NOT what a client formatter would print for the numbers.
  const f = parcelFigures({ figures: { ...SERVER, acres: 40.12, display: { ...DISPLAY, acres: '40.1200 ac!' , price_per_acre: '$1' } } })
  assert.equal(figDisplay(f, 'acres'), '40.1200 ac!')
  assert.equal(figDisplay(f, 'price_per_acre'), '$1')
  assert.equal(figDisplay(f, 'rating'), '131.2')
})

test('a missing display key is a dash; a rating of "0.0" is shown, not a dash', () => {
  const f = parcelFigures({ figures: { ...SERVER, rating: 0, display: { rating: '0.0' } } })
  assert.equal(f.rating, 0)
  assert.equal(figDisplay(f, 'rating'), '0.0')
  assert.equal(figShown(figDisplay(f, 'rating')), true)
  assert.equal(figDisplay(f, 'price'), DASH)
  assert.equal(figShown(DASH), false)
  assert.equal(figShown(''), false)
})

test('price_mode and updating come from the server', () => {
  const t = fromServerFigures({ ...SERVER, price_mode: 'total' } as any)
  assert.equal(t.priceMode, 'total')
  assert.equal(fromServerFigures({ ...SERVER, price_mode: 'weird' } as any).priceMode, null)
  assert.equal(fromServerFigures({ ...SERVER, updating: true } as any).remeasuring, true)
  const r = parcelRowFields(t, 'per_acre') as any
  assert.equal(r.price.mode, 'total') // the server's mode beats the client fallback
  assert.equal((parcelRowFields(fromServerFigures(SERVER as any), 'total') as any).price.mode, 'per_acre')
})

test('report row carries the print strings; rowDisplay/rowCells read them verbatim', () => {
  const row = { ...parcelRowFields(fromServerFigures(SERVER as any), 'per_acre'), tractId: null } as any
  assert.equal(rowDisplay(row, 'price'), '$257,931')
  const c = rowCells(row, 'Sale Price')!
  assert.equal(c.acres, '40.12')
  assert.equal(c.priceLabel, '$/Acre')
  assert.equal(c.priceValue, '$6,429')
  assert.equal(c.tillable, '91%')
  assert.equal(c.rating, '131.2')
  assert.equal(c.sale, '$257,931')
  assert.equal(c.pricePerTillable, '$7,067')
  assert.equal(c.pricePerRating, '$49')
  assert.equal(c.date, '03/14/2025')
})

test('price_mode total: the card shows the total price under the "Sale Price" label', () => {
  const row = { ...parcelRowFields(fromServerFigures({ ...SERVER, price_mode: 'total' } as any), 'per_acre'), tractId: null } as any
  const c = rowCells(row, 'Sale Price')!
  assert.equal(c.priceLabel, 'Sale Price')
  assert.equal(c.priceValue, '$257,931')
})

test('a parcel row with no display is dashes; a tract row keeps its own formatting (null)', () => {
  assert.equal(rowCells({ figuresDisplay: null, tractId: null, savedId: null }, 'x')!.acres, DASH)
  assert.equal(rowCells({ figuresDisplay: null, tractId: 't1' }, 'x'), null)
  assert.equal(rowCells({ figuresDisplay: null, tractId: null, savedId: 's1' }, 'x'), null)
  assert.equal(rowDisplay({ tractId: 't1' }, 'price'), null)
})

test('composition + rating text join the server strings only', () => {
  const f = fromServerFigures(SERVER as any)
  assert.equal(compositionText(f, 'tillable'), '36.50 ac (91%)')
  assert.equal(compositionText(f, 'timber'), '2.10 ac')
  assert.equal(ratingText(f, 'Soil Rating'), 'PI 131.2')
  const u = fromServerFigures({ ...SERVER, updating: true, display: { ...DISPLAY, tillable_acres: UPDATING, pct_tillable: UPDATING, rating: UPDATING } } as any)
  assert.equal(compositionText(u, 'tillable'), UPDATING)
  assert.equal(ratingText(u, 'PI'), UPDATING)
  assert.equal(compositionText(emptyish(), 'tillable'), '—')
  assert.equal(ratingText(emptyish(), 'Soil Rating'), 'Soil Rating —')
})

function emptyish() { return parcelFigures({}) }

console.log(`\n${passed} passed`)
