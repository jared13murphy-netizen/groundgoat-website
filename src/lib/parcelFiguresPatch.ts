// The patch a parcel report row takes from /api/parcel-enrichment/by-uuid —
// the ONE parcel record (regrid_parcels) the detail panel and the PDF read.
//
// Owner 11/17 (Hancock IL comps): a figure the one record does not have is a
// dash on every surface, so an explicit null in the response CLEARS the row's
// copy instead of leaving whatever number the row was built with (the comp
// card kept 57.214 while the panel and the PDF said 55.39). A key the
// response does not carry at all leaves the row alone.
import type { TractSaleData } from '@/components/portal/PortalTractDetail'

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function figuresPatch(f: any): Partial<TractSaleData> {
  const patch: Partial<TractSaleData> = {}
  if (!f || typeof f !== 'object') return patch
  const p = patch as any
  if ('tillable_acres' in f) p.tillableAcres = num(f.tillable_acres)
  if ('pct_tillable' in f) p.pctTillable = num(f.pct_tillable)
  if ('soil_rating' in f) p.soilRating = num(f.soil_rating)
  if ('soil_rating_type' in f) p.soilRatingType = f.soil_rating_type ? String(f.soil_rating_type) : null
  return patch
}
