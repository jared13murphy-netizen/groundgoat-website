// ONE comp-report summary for every surface on the site (owner 2026-10-27):
// the Comparable Sales slide-out on /access (both portal report panels), the
// two /listings report pages, and — through the same formulas — the PDF and
// spreadsheet the backend builds (ground-goat-backend/comps_summary.py) and
// the app (ground-goat-mobile/src/utils/compAverages.js). All three pin the
// same fixture in their tests so they cannot drift.
//
// OWNER RULES
// - The three PRICE averages are ACRE-WEIGHTED — SUM(sale) / SUM(denominator)
//   — never a mean of each comp's own ratio (a 2-acre comp must not count the
//   same as a 500-acre comp).
// - The SOIL RATING is weighted by each comp's TILLABLE ACRES — "calculated
//   based on the tillable polygons of each parcel or tract" — never a plain
//   mean. A comp with no tillable acres or no rating does not rate; the
//   surface says how many did ("7 of 9 rated").
// - TOTALS sit beside the averages: total acres, total tillable acres (+ %),
//   total sale dollars.
//
// PARCEL ROWS (owner 11/19): the inputs are the server's per-parcel figures
// (price, Regrid acres, tillable acres, rating — src/lib/parcelFigures.ts);
// this module only AGGREGATES them, with the same weighting as before:
// $/acre = SUM(price)/SUM(acres), $/till = SUM(price)/SUM(tillable) over rows
// passing the 1 ac / 25% rule, $/rating = SUM(price)/SUM(rating × acres),
// rating = SUM(rating × tillable)/SUM(tillable). No per-parcel figure is
// computed here except saleOf's $/acre × acres for rows with no price.
//
// Field names: call sites send snake_case (API payloads) or camelCase
// (TractSaleData), so every accessor reads both. Every accessor coerces
// through toNum — DECIMAL columns arrive as JSON strings and `+=` on a
// string concatenates.

export interface CompAverageInput {
  sale_price?: number | string | null
  salePrice?: number | string | null
  price_per_acre?: number | string | null
  pricePerAcre?: number | string | null
  total_acres?: number | string | null
  totalAcres?: number | string | null
  tillable_acres?: number | string | null
  tillableAcres?: number | string | null
  soil_rating?: number | string | null
  soilRating?: number | string | null
  /** Parcel rows (owner 11/19): every figure above is the server's per-parcel
   *  value (src/lib/parcelFigures.ts). A parcel being re-measured shows
   *  "Updating…", so its tillable acres and rating stay out of the totals and
   *  averages until the server has the new numbers. */
  remeasuring?: boolean | null
}

export interface CompSummary {
  count: number
  totalAcres: number | null
  totalTillable: number | null
  /** totalTillable / totalAcres × 100 */
  pctTillable: number | null
  totalSale: number | null
  /** comps that contributed to soilRating (rating AND tillable acres > 0) */
  ratedCount: number
  avgPricePerAcre: number | null
  avgPricePerTillable: number | null
  avgPricePerSoil: number | null
  avgAcres: number | null
  avgTillable: number | null
  /** tillable-acre-weighted soil rating */
  soilRating: number | null
}

/** Kept for existing call sites; identical numbers to summarizeComps. */
export interface CompAverages {
  avgPricePerAcre: number | null
  avgPricePerTillable: number | null
  avgPricePerSoil: number | null
  avgAcres: number | null
  avgTillable: number | null
  /** tillable-weighted (owner 2026-10-27) — was a plain mean before */
  avgSoilRating: number | null
}

// Local copy of lib/format's toNum so this module has no imports and the
// node-runnable test (compAverages.test.ts) can load it directly.
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

function nonneg(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : null
}
function pos(v: number | string | null | undefined): number | null {
  const n = toNum(v)
  return n !== null && n !== undefined && Number.isFinite(n) && n > 0 ? n : null
}

function saleOf(c: CompAverageInput): number | null {
  const sale = pos(c.sale_price ?? c.salePrice)
  if (sale) return sale
  const ppa = pos(c.price_per_acre ?? c.pricePerAcre)
  const acres = pos(c.total_acres ?? c.totalAcres)
  return ppa && acres ? ppa * acres : null
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null
}

export function summarizeComps(comps: CompAverageInput[]): CompSummary {
  let count = 0
  let totAcres = 0, totTill = 0, saleSum = 0
  let anySale = false, anyAcres = false, anyTill = false
  let ppaNum = 0, ppaDen = 0, pptaNum = 0, pptaDen = 0, ppsrNum = 0, ppsrDen = 0
  let acresCount = 0, tillCount = 0
  let soilNum = 0, soilDen = 0, rated = 0

  for (const c of comps || []) {
    count++
    const acres = pos(c.total_acres ?? c.totalAcres)
    const till = c.remeasuring ? null : pos(c.tillable_acres ?? c.tillableAcres)
    const soil = c.remeasuring ? null : pos(c.soil_rating ?? c.soilRating)
    const sale = saleOf(c)
    if (acres) { totAcres += acres; acresCount++; anyAcres = true }
    // a MEASURED 0 counts in Avg Tillable (ties out to total ÷ comps; server comps_summary 11/20)
    const till0 = c.remeasuring ? null : nonneg(c.tillable_acres ?? c.tillableAcres)
    if (till0 != null) { totTill += till0; tillCount++; if (till0 > 0) anyTill = true }
    if (sale) {
      anySale = true
      saleSum += sale
      if (acres) { ppaNum += sale; ppaDen += acres }
      // ONE rule (owner 11/17, = priceRules.ts pptaOk/ppratingOk and backend
      // comps_summary): $/till only when tillable >= 1 ac AND >= 25% of the
      // acres; $/rating only when tillable >= 25%. Copied, not imported (this
      // module stays import-free for its node-runnable test).
      const share = (till && acres) ? till / acres : 0
      if (till && till >= 1 && share >= 0.25) { pptaNum += sale; pptaDen += till }
      if (soil && acres && share >= 0.25) { ppsrNum += sale; ppsrDen += soil * acres }
    }
    if (soil && till) { soilNum += soil * till; soilDen += till; rated++ }
  }

  return {
    count,
    totalAcres: anyAcres ? totAcres : null,
    totalTillable: anyTill ? totTill : null,
    pctTillable: totAcres > 0 ? (totTill / totAcres) * 100 : null,
    totalSale: anySale ? saleSum : null,
    ratedCount: rated,
    avgPricePerAcre: ratio(ppaNum, ppaDen),
    avgPricePerTillable: ratio(pptaNum, pptaDen),
    avgPricePerSoil: ratio(ppsrNum, ppsrDen),
    avgAcres: acresCount ? totAcres / acresCount : null,
    avgTillable: tillCount ? totTill / tillCount : null,
    soilRating: ratio(soilNum, soilDen),
  }
}

export function computeCompAverages(comps: CompAverageInput[]): CompAverages {
  const s = summarizeComps(comps)
  return {
    avgPricePerAcre: s.avgPricePerAcre,
    avgPricePerTillable: s.avgPricePerTillable,
    avgPricePerSoil: s.avgPricePerSoil,
    avgAcres: s.avgAcres,
    avgTillable: s.avgTillable,
    avgSoilRating: s.soilRating,
  }
}
