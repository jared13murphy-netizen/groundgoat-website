/**
 * When a tract's price is shown per acre and when as a lump sum (owner 11/4).
 *
 * A 0.28-acre commercial lot that sold for $117,000 read as "$417,857 $/Acre"
 * on the tract card, which looks inflated and means nothing to a farmer.
 * Rule (acres first, land types second — a tract can be several types):
 *   • under SMALL_TRACT_ACRES → the total price;
 *   • at or above, with ANY agricultural land type → $/Acre;
 *   • at or above, with NO agricultural type at all → the total price.
 * A listing shows $/Acre if any of its tracts does, else the total.
 */
export const SMALL_TRACT_ACRES = 10
export const AG_LAND_TYPES = new Set(['Farm', 'Pasture', 'Timber', 'CRP', 'Recreational', 'Hunting', 'Vacant Land'])

export type PriceMode = 'per_acre' | 'total'

type Typed = { total_acres?: number | string | null; land_type?: string | null; land_types?: string[] | null }

export function landTypesOf(t: Typed): string[] {
  const out: string[] = []
  if (t.land_type) out.push(String(t.land_type))
  if (Array.isArray(t.land_types)) for (const x of t.land_types) if (x && !out.includes(String(x))) out.push(String(x))
  return out
}

export function tractPriceMode(t: Typed): PriceMode {
  const acres = Number(t.total_acres)
  if (!Number.isFinite(acres) || acres <= 0) return 'total'
  if (acres < SMALL_TRACT_ACRES) return 'total'
  const types = landTypesOf(t)
  if (types.length && !types.some(x => AG_LAND_TYPES.has(x))) return 'total'
  return 'per_acre'
}

export function listingPriceMode(l: Typed & { tracts?: Typed[] | null }): PriceMode {
  if (Array.isArray(l.tracts) && l.tracts.length) {
    return l.tracts.some(t => tractPriceMode(t) === 'per_acre') ? 'per_acre' : 'total'
  }
  return tractPriceMode(l)
}

/** The lump-sum figure for 'total' mode: sale price wins, else asking. */
export function totalPriceOf(t: { sale_price?: number | string | null; asking_price?: number | string | null }): number | null {
  for (const v of [t.sale_price, t.asking_price]) {
    const n = Number(v)
    if (v != null && v !== '' && Number.isFinite(n) && n > 0) return n
  }
  return null
}

/** Label for the lump-sum stat, by basis. */
export function totalPriceLabel(basis: 'sold' | 'asking' | null | undefined): string {
  return basis === 'asking' ? 'Asking Price' : 'Sale Price'
}
