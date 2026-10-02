import { SOIL_FILTER_ENABLED, TILLABLE_FILTER_ENABLED } from '@/lib/featureFlags'

// Number shown on the Filters button badge: how many filter CONTROLS differ
// from their defaults (owner, 2026-10-02). A min/max pair is one control, a
// multi-select is one control. Empty string / null / [] means "not set".
// `defaultDateRange` is the untouched date sentinel (ExploreMap's
// DEFAULT_DATE_RANGE), which is not '' so it is passed in.
type FilterLike = Record<string, any>

const isSet = (v: unknown) => {
  if (Array.isArray(v)) return v.length > 0
  return v !== '' && v !== null && v !== undefined
}

export function countActiveFilters(f: FilterLike, defaultDateRange: string): number {
  const pairs: Array<[string, string, boolean]> = [
    ['soilRatingMin', 'soilRatingMax', SOIL_FILTER_ENABLED],
    ['pricePerSoilRatingMin', 'pricePerSoilRatingMax', SOIL_FILTER_ENABLED],
    ['acreageMin', 'acreageMax', true],
    ['pctTillableMin', 'pctTillableMax', TILLABLE_FILTER_ENABLED],
    ['tillableAcresMin', 'tillableAcresMax', TILLABLE_FILTER_ENABLED],
    ['pricePerAcreMin', 'pricePerAcreMax', true],
    ['salePriceMin', 'salePriceMax', true],
    ['askingPriceMin', 'askingPriceMax', true],
    ['cornersMin', 'cornersMax', true],
  ]
  const singles = [
    'stateFilter', 'countyFilters', 'townshipFilters', 'statuses', 'landTypes',
    'listingType', 'companyName', 'buyer', 'seller', 'hasHouse', 'hasBuildings',
    'hasPolygon', 'keyword',
  ]
  let n = 0
  if ((f.dateRange && f.dateRange !== defaultDateRange) || isSet(f.dateFrom) || isSet(f.dateTo)) n++
  for (const k of singles) if (isSet(f[k])) n++
  for (const [a, b, enabled] of pairs) if (enabled && (isSet(f[a]) || isSet(f[b]))) n++
  if (isSet(f.nearLat) && isSet(f.nearLng) && isSet(f.radiusMiles)) n++
  return n
}
