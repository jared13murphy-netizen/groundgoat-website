import { toNum } from './format'
// Shared comp-report averaging helper.
//
// OWNER RULE: the three PRICE averages (avg $/acre, avg $/tillable-acre,
// avg $/soil-rating) must be ACRE-WEIGHTED — SUM(sale_price) / SUM(denominator)
// — not a naive mean-of-ratios. A 2-acre comp must not count equally with a
// 500-acre comp. This mirrors the backend's weighting rule.
//
// The plain-quantity averages (avg acres, avg tillable acres, avg soil
// rating) stay SIMPLE MEANS (sum/len) — do not weight those.
//
// Call sites across the site use different field-name shapes (snake_case
// from API payloads, camelCase from TractSaleData), so every accessor here
// reads both.

export interface CompAverageInput {
  price_per_acre?: number | null
  pricePerAcre?: number | null
  total_acres?: number | null
  totalAcres?: number | null
  tillable_acres?: number | null
  tillableAcres?: number | null
  soil_rating?: number | null
  soilRating?: number | null
}

export interface CompAverages {
  avgPricePerAcre: number | null
  avgPricePerTillable: number | null
  avgPricePerSoil: number | null
  avgAcres: number | null
  avgTillable: number | null
  avgSoilRating: number | null
}

// Every accessor coerces through toNum. The API serialises DECIMAL columns as
// JSON strings (see lib/format.ts), and the weighted sums below accumulate
// with `+=` — so a string denominator would CONCATENATE rather than add:
// 0 += "99.00" -> "099.00" -> "099.0041.28" -> NaN after the divide. Every
// average in every comp report would read NaN or, worse, a plausible-looking
// wrong number.
//
// Today's comparables endpoints happen to cast with float() before returning,
// so this has never fired in production. That is luck, not design — it holds
// only until someone adds a comp field that skips the cast. Coercing here
// makes the helper correct regardless of what the endpoint sends.

function pricePerAcreOf(c: CompAverageInput): number | null | undefined {
  return toNum(c.price_per_acre ?? c.pricePerAcre)
}

function totalAcresOf(c: CompAverageInput): number | null | undefined {
  return toNum(c.total_acres ?? c.totalAcres)
}

function tillableAcresOf(c: CompAverageInput): number | null | undefined {
  return toNum(c.tillable_acres ?? c.tillableAcres)
}

function soilRatingOf(c: CompAverageInput): number | null | undefined {
  return toNum(c.soil_rating ?? c.soilRating)
}

/**
 * Acre-weighted averages for comp-report price metrics, plus the simple-mean
 * quantity averages, from a single pass over the comps. Every divide is
 * guarded — a metric is null unless its weighted denominator sums to > 0.
 *
 * avg $/acre          = SUM(price_per_acre_i * total_acres_i) / SUM(total_acres_i)
 * avg $/tillable-acre  = SUM(price_per_acre_i * total_acres_i) / SUM(tillable_acres_i)
 * avg $/soil-rating    = SUM(price_per_acre_i * total_acres_i) / SUM(soil_rating_i * total_acres_i)
 *
 * A comp contributes to a given metric only when its numerator (price_per_acre
 * and total_acres) and that metric's denominator field are both present and
 * truthy (0/null/undefined all mean "not reported," matching the existing
 * call sites' filtering).
 */
export function computeCompAverages(comps: CompAverageInput[]): CompAverages {
  let acreNumerator = 0
  let acreDenominator = 0
  let tillableNumerator = 0
  let tillableDenominator = 0
  let soilNumerator = 0
  let soilDenominator = 0

  for (const c of comps) {
    const price = pricePerAcreOf(c)
    const acres = totalAcresOf(c)
    const tillable = tillableAcresOf(c)
    const soil = soilRatingOf(c)
    const saleAmount = price && acres ? price * acres : null

    if (saleAmount && acres) {
      acreNumerator += saleAmount
      acreDenominator += acres
    }
    if (saleAmount && tillable) {
      tillableNumerator += saleAmount
      tillableDenominator += tillable
    }
    if (saleAmount && soil && acres) {
      soilNumerator += saleAmount
      soilDenominator += soil * acres
    }
  }

  const withAcres = comps.filter(c => totalAcresOf(c))
  const withTillable = comps.filter(c => tillableAcresOf(c))
  const withSoil = comps.filter(c => soilRatingOf(c) && pricePerAcreOf(c))

  return {
    avgPricePerAcre: acreDenominator > 0 ? acreNumerator / acreDenominator : null,
    avgPricePerTillable: tillableDenominator > 0 ? tillableNumerator / tillableDenominator : null,
    avgPricePerSoil: soilDenominator > 0 ? soilNumerator / soilDenominator : null,
    avgAcres: withAcres.length
      ? withAcres.reduce((s, c) => s + (totalAcresOf(c) || 0), 0) / withAcres.length
      : null,
    avgTillable: withTillable.length
      ? withTillable.reduce((s, c) => s + (tillableAcresOf(c) || 0), 0) / withTillable.length
      : null,
    avgSoilRating: withSoil.length
      ? withSoil.reduce((s, c) => s + (soilRatingOf(c) || 0), 0) / withSoil.length
      : null,
  }
}
