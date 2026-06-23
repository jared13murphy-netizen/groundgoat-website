/**
 * Shared MapLibre filter expression builder for the Regrid parcel
 * fill / line / label layers. Used by all 4 maps:
 *   - Web Explore Map
 *   - Web Comp Map
 *   - Mobile Explore Map
 *   - Mobile Comp Map
 *
 * Each map has its own filter UI shape, so each one defines a small
 * adapter that maps its own state into `RegridFilterInput` and calls
 * `buildRegridParcelFilter`. That way the FILTER LOGIC lives in one
 * place; only the per-surface UI plumbing differs.
 *
 * Field source-of-truth (Regrid vector tile):
 *   acreage   → ll_gisacre (fallback gisacre)
 *   sale date → saledate
 *   sale price → saleprice
 *   state     → state2 (defensive: tile may not include it)
 *   county    → county (defensive: tile may not include it)
 *
 * Filters that REQUIRE a DB lookup (soil rating, % tillable,
 * status=live/listed, township) are NOT in this builder — see
 * project_regrid_tile_filterability_plan.md Phase E for the
 * /api/regrid/filter-uuids approach.
 *
 * Mobile parity: this file is duplicated as a `.js` for the mobile
 * app at ground-goat-mobile/src/lib/regridParcelFilter.js. Update
 * both together. (React Native MapLibre rejects some expression
 * shapes — keep this minimal and avoid `number-format` etc.)
 */

export interface RegridFilterInput {
  /** Minimum acreage (inclusive). Empty / null / NaN = no min. */
  acresMin?: number | null
  /** Maximum acreage (inclusive). Empty / null / NaN = no max. */
  acresMax?: number | null
  /** Minimum sale price (inclusive). Implies saleprice > 0. */
  salePriceMin?: number | null
  /** Maximum sale price (inclusive). Implies saleprice > 0. */
  salePriceMax?: number | null
  /** Earliest sale date in YYYY-MM-DD. Implies saleprice > 0. */
  saleDateFrom?: string | null
  /** Latest sale date in YYYY-MM-DD. Implies saleprice > 0. */
  saleDateTo?: string | null
  /** When true, hide every parcel (recorded sales can't match a future
   *  auction). The Explore Map's "Upcoming" preset sets this. */
  upcomingOnly?: boolean
  /** Two-letter state abbr (e.g. "IL"). Defensive — no-op if tile
   *  has no state2 field. */
  stateAbbr?: string | null
  /** County names. Defensive — no-op if tile has no county field. */
  countyNames?: string[] | null
  /** When true, restrict to sold parcels (saleprice > 0). Implied
   *  by any sale-price or sale-date filter, so callers don't need
   *  to set this in addition. */
  soldOnly?: boolean
  /** Tri-state buildings filter, keyed on the Regrid `ll_bldg_count`
   *  field baked into the custom tile (2026-06-01).
   *    null/undefined → no filter (show all parcels)
   *    true           → only parcels with a building (count > 0)
   *    false          → only parcels with NO building (count == 0)
   *  Defensive: when the tile lacks ll_bldg_count the clause no-ops so
   *  parcels aren't silently hidden. */
  hasBuildings?: boolean | null
}

const FAR_FUTURE = '9999-12-31'

/**
 * Build the MapLibre filter expression. Returns `true` when no filter
 * input is active (so MapLibre shows every parcel by default).
 *
 * The `as any` return type works around MapLibre's filter expression
 * being a recursive tuple type — typing it precisely is more noise
 * than it's worth, and `setFilter` accepts any expression at runtime.
 */
export function buildRegridParcelFilter(input: RegridFilterInput): any {
  const parts: any[] = ['all']

  // Acreage. Use ll_gisacre when present, fall back to gisacre. We
  // CAN'T use coalesce here because to-number(null) = 0, which would
  // make the coalesce always pick the first term. Use case + has.
  const acresExpr: any = [
    'case',
    ['has', 'll_gisacre'], ['to-number', ['get', 'll_gisacre']],
    ['has', 'gisacre'], ['to-number', ['get', 'gisacre']],
    -1,
  ]
  if (input.acresMin != null && Number.isFinite(input.acresMin)) {
    parts.push(['>=', acresExpr, input.acresMin])
  }
  if (input.acresMax != null && Number.isFinite(input.acresMax)) {
    parts.push(['<=', acresExpr, input.acresMax])
  }

  // State — defensive guard so the filter no-ops on tiles that don't
  // include state2.
  if (input.stateAbbr) {
    parts.push([
      'any',
      ['!', ['has', 'state2']],
      ['==', ['get', 'state2'], input.stateAbbr],
    ])
  }

  // County — same defensive pattern. Match any of the selected counties.
  if (input.countyNames && input.countyNames.length > 0) {
    parts.push([
      'any',
      ['!', ['has', 'county']],
      [
        'match',
        ['downcase', ['coalesce', ['get', 'county'], '']],
        input.countyNames.map(c => c.toLowerCase()),
        true,
        false,
      ],
    ])
  }

  // "Upcoming" preset on Explore Map — recorded past sales can never
  // match a future-dated auction, so hide every Regrid parcel.
  if (input.upcomingOnly) {
    return ['==', ['literal', 1], ['literal', 0]]
  }

  // Any sale-related filter implies the parcel must HAVE a sale.
  const needsSale = (
    !!input.saleDateFrom ||
    !!input.saleDateTo ||
    (input.salePriceMin != null && Number.isFinite(input.salePriceMin)) ||
    (input.salePriceMax != null && Number.isFinite(input.salePriceMax)) ||
    !!input.soldOnly
  )
  if (needsSale) {
    parts.push(['has', 'saleprice'])
    parts.push(['>', ['to-number', ['get', 'saleprice']], 0])
  }

  // Sale date window.
  if (input.saleDateFrom) {
    parts.push(['>=', ['coalesce', ['get', 'saledate'], ''], input.saleDateFrom])
  }
  if (input.saleDateTo) {
    parts.push(['<=', ['coalesce', ['get', 'saledate'], FAR_FUTURE], input.saleDateTo])
  }

  // Sale price min/max.
  if (input.salePriceMin != null && Number.isFinite(input.salePriceMin)) {
    parts.push(['>=', ['to-number', ['get', 'saleprice']], input.salePriceMin])
  }
  if (input.salePriceMax != null && Number.isFinite(input.salePriceMax)) {
    parts.push(['<=', ['to-number', ['get', 'saleprice']], input.salePriceMax])
  }

  // Buildings (ll_bldg_count). The custom tile populates this on every
  // parcel (0 = none, >0 = has a building). Guard with `has` so the
  // clause no-ops on any tile that lacks the field rather than hiding
  // every parcel.
  if (input.hasBuildings === true) {
    parts.push(['has', 'll_bldg_count'])
    parts.push(['>', ['to-number', ['get', 'll_bldg_count']], 0])
  } else if (input.hasBuildings === false) {
    parts.push(['has', 'll_bldg_count'])
    parts.push(['==', ['to-number', ['get', 'll_bldg_count']], 0])
  }

  return parts.length === 1 ? true : parts
}

/**
 * Layer IDs that this filter is applied to. Exported so callers can
 * loop through them when calling `map.setFilter`.
 */
export const REGRID_PARCEL_LAYER_IDS = [
  'regrid-parcels-fill',
  'regrid-parcels-line',
  'regrid-parcels-label',
] as const
