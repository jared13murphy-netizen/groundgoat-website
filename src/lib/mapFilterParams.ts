// ONE place that decides how the map's soil / tillable / $-per-soil-point
// filters reach the backend and the filter panel (Goat Search audit,
// 2026-11-17 — owner: "I cannot have wrong data").
//
// The bug this replaces: buildFilterParams sent soil_rating_min/max and the
// three tillable pairs only when EXACTLY ONE parcel-data registry state was
// selected, and never sent price_per_soil_rating_min/max at all (it sat
// behind SOIL_FILTER_ENABLED, which is false). So "land in Adams County IL
// and Lee County IA with soil rating over 80 and over 90% tillable" told the
// user the filters were applied while the map, county circles and state
// badges ignored them. The mobile app already forwards soil and $/soil
// point unconditionally (ground-goat-mobile ExploreFilterPanel.js
// buildFilterParams).
//
// Why sending them is always safe (backend main.py):
//  - /api/map/tracts and _build_map_tract_filter_conditions (state/county
//    count badges) filter soil on the state's NATIVE rating when exactly
//    one state is scoped and on NCCPI otherwise; $/soil point the same way
//    (price_per_soil_rating vs price_per_nccpi). pct_tillable and
//    tillable_acres are plain tract columns, valid in every state.
//  - /api/map/parcel-sale-dots and the county dot counts apply these only
//    where parcel data can express them (registry states, one state for
//    soil). Anywhere else they mark dots unrepresentable (dot_count=None,
//    tract-only counts) rather than applying them with the wrong scale,
//    and shouldHideParcelDotsForFilters hides the dots on this side.
// So the params are always sent, and the panel always shows a control for
// any value that is set, so nothing filters invisibly.

export type ParcelDataFilterFields = {
  stateFilter: string
  soilRatingMin: string
  soilRatingMax: string
  pctTillableMin: string
  pctTillableMax: string
  tillableAcresMin: string
  tillableAcresMax: string
  pricePerSoilRatingMin: string
  pricePerSoilRatingMax: string
}

type RangeKey = Exclude<keyof ParcelDataFilterFields, 'stateFilter'>

/** FilterState field -> backend query param, for every pair this helper owns. */
export const PARCEL_DATA_FILTER_PARAMS: ReadonlyArray<readonly [RangeKey, string]> = [
  ['soilRatingMin', 'soil_rating_min'],
  ['soilRatingMax', 'soil_rating_max'],
  ['pctTillableMin', 'pct_tillable_min'],
  ['pctTillableMax', 'pct_tillable_max'],
  ['tillableAcresMin', 'tillable_acres_min'],
  ['tillableAcresMax', 'tillable_acres_max'],
  ['pricePerSoilRatingMin', 'price_per_soil_rating_min'],
  ['pricePerSoilRatingMax', 'price_per_soil_rating_max'],
]

const isSet = (v: unknown) => v !== '' && v !== null && v !== undefined

/** States in the comma-joined stateFilter, upper-cased, blanks dropped. */
export function selectedStates(stateFilter: string | null | undefined): string[] {
  return (stateFilter || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
}

/**
 * Registry-gated scope: the single selected state when it is listed in
 * /api/regrid/config's parcel_data_states, else null. Only decides whether
 * PARCEL dots can express these filters (shouldHideParcelDotsForFilters)
 * and whether the soil / % tillable / land-type controls show by default.
 * It no longer decides whether a param is SENT.
 */
export function resolveParcelDataScope(stateFilter: string, parcelDataStates?: string[] | null): string | null {
  if (!parcelDataStates || parcelDataStates.length === 0) return null
  const selected = selectedStates(stateFilter)
  if (selected.length !== 1) return null
  const registry = new Set(parcelDataStates.map(s => s.toUpperCase()))
  return registry.has(selected[0]) ? selected[0] : null
}

/** Query params for every soil / tillable / $-per-soil-point value that is set. */
export function parcelDataFilterParams(f: Partial<ParcelDataFilterFields>): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, param] of PARCEL_DATA_FILTER_PARAMS) {
    const v = f[key]
    if (isSet(v)) params[param] = String(v)
  }
  return params
}

/** Is either end of this pair set? */
export function pairSet(f: Partial<ParcelDataFilterFields>, min: RangeKey, max: RangeKey): boolean {
  return isSet(f[min]) || isSet(f[max])
}

/** Any soil / tillable / $-per-soil-point value set (counts as an active filter). */
export function anyParcelDataFilterSet(f: Partial<ParcelDataFilterFields>): boolean {
  return PARCEL_DATA_FILTER_PARAMS.some(([key]) => isSet(f[key]))
}

export type ParcelDataControl = {
  label: string
  minKey: RangeKey
  maxKey: RangeKey
}

/**
 * Range controls the filter panel shows. `draft` is the panel's working
 * copy, `applied` what the map is using now; a pair set in either keeps its
 * control visible so a Goat Search value is always shown and clearable
 * (and does not vanish mid-edit). The default visibility rules are
 * unchanged: soil and % tillable show for a registry state (or behind their
 * feature flags); tillable acres and $/soil point have no default control
 * (chat-only) and appear only when set. `flags` carries featureFlags.ts's
 * SOIL_FILTER_ENABLED / TILLABLE_FILTER_ENABLED (passed in so this module
 * has no imports and runs under plain `node --experimental-strip-types`).
 */
export function parcelDataControls(
  draft: Partial<ParcelDataFilterFields>,
  applied: Partial<ParcelDataFilterFields>,
  scope: string | null,
  flags: { soil: boolean; tillable: boolean } = { soil: false, tillable: false },
): { soil: ParcelDataControl | null; tillable: ParcelDataControl[] } {
  const setIn = (min: RangeKey, max: RangeKey) => pairSet(draft, min, max) || pairSet(applied, min, max)
  // Backend rule (main.py soil block): native rating for exactly one state,
  // NCCPI otherwise. Say which, so "80" is never read on the wrong scale.
  const crossState = selectedStates(draft.stateFilter).length !== 1
  const showSoil = (flags.soil && !!draft.stateFilter) || !!scope || setIn('soilRatingMin', 'soilRatingMax')
  const showPps = setIn('pricePerSoilRatingMin', 'pricePerSoilRatingMax')
  const soil = showSoil
    ? { label: crossState ? 'Soil Rating (NCCPI)' : 'Soil Rating', minKey: 'soilRatingMin' as const, maxKey: 'soilRatingMax' as const }
    : null
  const tillable: ParcelDataControl[] = []
  if (flags.tillable || !!scope || setIn('pctTillableMin', 'pctTillableMax')) {
    tillable.push({ label: '% Tillable', minKey: 'pctTillableMin', maxKey: 'pctTillableMax' })
  }
  if (flags.tillable || setIn('tillableAcresMin', 'tillableAcresMax')) {
    tillable.push({ label: 'Tillable Acres', minKey: 'tillableAcresMin', maxKey: 'tillableAcresMax' })
  }
  if (showPps) {
    tillable.push({
      label: crossState ? '$ / Soil Rating (NCCPI)' : '$ / Soil Rating',
      minKey: 'pricePerSoilRatingMin', maxKey: 'pricePerSoilRatingMax',
    })
  }
  return { soil, tillable }
}
