// One price per tract row on every website surface (owner 11/17). A row built
// from an API tract carries `price` (the backend's tract_price_fields, read
// through resolveTractPrice); a row built some other way (parcel, saved
// tract) falls back to its own sale figures under the same rules. Renderers
// call rowPrice(row) and nothing else, so Tract Detail, comp cards, the map
// modal, saved reports and pins cannot disagree.
import { resolveTractPrice, totalLabelFor, type ResolvedTractPrice } from './priceRules'
import { tractPriceMode } from './priceDisplay'

export type { ResolvedTractPrice }
export { totalLabelFor }

/** From an API tract payload (snake_case). */
export function apiTractPrice(t: any): ResolvedTractPrice {
  return resolveTractPrice(t, tractPriceMode(t || {}))
}

type Row = {
  price?: ResolvedTractPrice | null
  salePrice?: number | null
  pricePerAcre?: number | null
  totalAcres?: number | null
  tillableAcres?: number | null
  soilRating?: number | null
  pricePerTillableAcre?: number | null
  pricePerSoilRating?: number | null
  landType?: string | null
  landTypes?: string[] | null
}

/** From a report/detail row (camelCase). */
export function rowPrice(row: Row): ResolvedTractPrice {
  if (row.price) return row.price
  const mode = tractPriceMode({ total_acres: row.totalAcres ?? null, land_type: row.landType ?? null, land_types: row.landTypes ?? null })
  const r = resolveTractPrice({
    sale_price: row.salePrice ?? null,
    total_acres: row.totalAcres ?? null,
    tillable_acres: row.tillableAcres ?? null,
    soil_rating: row.soilRating ?? null,
    price_per_acre: row.pricePerAcre ?? null,
  }, mode)
  if (r.basis === null && row.pricePerAcre) {
    // A row with only a $/acre (older saved rows): show it, under the rules.
    return { ...r, basis: 'sold', pricePerAcre: row.pricePerAcre,
      totalPrice: row.totalAcres ? row.pricePerAcre * row.totalAcres : null }
  }
  return r
}
