/**
 * THE price rules for a tract or comp row (owner 11/17): every screen, modal,
 * panel and report shows the same price, $/acre, $/tillable acre and
 * $/rating point. The backend computes them once (price_display.tract_rates /
 * tract_price_fields, comps_summary.ppta_ok / pprating_ok) and sends them on
 * every tract payload; this module is the mirror for the few rows a client
 * builds itself, and the one place the display decision is read.
 *
 *   $/tillable acre — only when tillable >= 1 ac AND >= 25% of the acres
 *                     (the parcel panel's rule, parcelDetailFields).
 *   $/rating point  — only when tillable >= 25% of the acres.
 *
 * Zero local imports on purpose (see tillable.ts): runnable with
 * `node --experimental-strip-types src/lib/priceRules.test.ts`.
 */

export const MIN_TILL_FOR_PPTA = 1
export const MIN_TILL_SHARE = 0.25

type Num = number | string | null | undefined

function num(v: Num): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function shareOk(till: Num, acres: Num): boolean {
  const t = num(till), a = num(acres)
  return t !== null && a !== null && a > 0 && t / a >= MIN_TILL_SHARE
}

/** $/tillable acre is shown for this row. */
export function pptaOk(till: Num, acres: Num): boolean {
  const t = num(till)
  return t !== null && t >= MIN_TILL_FOR_PPTA && shareOk(t, acres)
}

/** $/rating point is shown for this row. */
export function ppratingOk(till: Num, acres: Num): boolean {
  return shareOk(till, acres)
}

export interface TractRates {
  pricePerAcre: number | null
  pricePerTillableAcre: number | null
  pricePerSoilRating: number | null
}

const cents = (n: number) => Math.round(n * 100) / 100

/** Mirror of backend price_display.tract_rates — for client-built rows only;
 *  API rows already carry these values. */
export function tractRates(t: {
  sale_price?: Num; total_acres?: Num; tillable_acres?: Num; soil_rating?: Num
}): TractRates {
  const sale = num(t.sale_price), acres = num(t.total_acres)
  const till = num(t.tillable_acres), rating = num(t.soil_rating)
  const out: TractRates = { pricePerAcre: null, pricePerTillableAcre: null, pricePerSoilRating: null }
  if (sale === null || sale <= 0) return out
  if (acres !== null && acres > 0) out.pricePerAcre = cents(sale / acres)
  if (till !== null && till > 0 && pptaOk(till, acres)) out.pricePerTillableAcre = cents(sale / till)
  if (out.pricePerAcre !== null && rating !== null && rating > 0 && ppratingOk(till, acres)) {
    out.pricePerSoilRating = cents(out.pricePerAcre / rating)
  }
  return out
}

/** A rate the row carries, gated by the rule (a stale stored copy on an
 *  older payload must not print where the rule shows a dash). */
export function gatedPpta(value: Num, till: Num, acres: Num): number | null {
  const v = num(value)
  return v !== null && v > 0 && pptaOk(till, acres) ? v : null
}

export function gatedPprating(value: Num, till: Num, acres: Num): number | null {
  const v = num(value)
  return v !== null && v > 0 && ppratingOk(till, acres) ? v : null
}

export type PriceMode = 'per_acre' | 'total'
export type PriceBasis = 'sold' | 'asking' | null

/** What one tract shows, read from the backend's display fields
 *  (tract_price_fields). `fallbackMode` is the client's tractPriceMode(t) for
 *  older payloads without price_mode. Never divides a listing's asking price
 *  by one tract's acres. */
export interface ResolvedTractPrice {
  basis: PriceBasis
  /** 'listing' = a multi-tract listing's asking figures shown on one tract */
  scope: 'tract' | 'listing'
  mode: PriceMode
  pricePerAcre: number | null
  pricePerTillableAcre: number | null
  pricePerSoilRating: number | null
  totalPrice: number | null
  listingTractCount: number | null
}

export function resolveTractPrice(t: any, fallbackMode: PriceMode): ResolvedTractPrice {
  const sale = num(t?.sale_price ?? t?.salePrice)
  const acres = t?.total_acres ?? t?.totalAcres
  const till = t?.tillable_acres ?? t?.tillableAcres
  const hasDisplay = t && ('display_price_per_acre' in t || 'price_scope' in t || 'display_total_price' in t)
  const mode: PriceMode = t?.price_mode === 'total' || t?.price_mode === 'per_acre' ? t.price_mode : fallbackMode
  if (hasDisplay) {
    return {
      basis: (t.price_basis === 'sold' || t.price_basis === 'asking') ? t.price_basis : null,
      scope: t.price_scope === 'listing' ? 'listing' : 'tract',
      mode,
      pricePerAcre: num(t.display_price_per_acre),
      pricePerTillableAcre: num(t.display_price_per_tillable_acre),
      pricePerSoilRating: num(t.display_price_per_soil_rating),
      totalPrice: num(t.display_total_price),
      listingTractCount: num(t.listing_tract_count),
    }
  }
  if (sale !== null && sale > 0) {
    const r = tractRates({ sale_price: sale, total_acres: acres, tillable_acres: till, soil_rating: t?.soil_rating ?? t?.soilRating })
    return {
      basis: 'sold', scope: 'tract', mode,
      pricePerAcre: num(t?.price_per_acre ?? t?.pricePerAcre) ?? r.pricePerAcre,
      pricePerTillableAcre: r.pricePerTillableAcre,
      pricePerSoilRating: r.pricePerSoilRating,
      totalPrice: sale, listingTractCount: null,
    }
  }
  return {
    basis: null, scope: 'tract', mode,
    pricePerAcre: null, pricePerTillableAcre: null, pricePerSoilRating: null,
    totalPrice: null, listingTractCount: null,
  }
}

/** "Asking Price" / "Sale Price", plus the whole-listing note for scope 'listing'. */
export function totalLabelFor(p: Pick<ResolvedTractPrice, 'basis' | 'scope' | 'listingTractCount'>): string {
  const base = p.basis === 'asking' ? 'Asking Price' : 'Sale Price'
  if (p.scope !== 'listing') return base
  return p.listingTractCount && p.listingTractCount > 1
    ? `${base} (whole listing, ${p.listingTractCount} tracts)` : `${base} (whole listing)`
}
