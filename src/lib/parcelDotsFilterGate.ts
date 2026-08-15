/**
 * Shared "should the parcel-sale-dots layer be hidden right now" gate.
 * Used by every map that renders the durable parcel-sale dot layer
 * (source 'parcel-sale-dots-durable', fed by GET /api/map/parcel-sale-dots)
 * AND supports search/filtering:
 *   - Web Explore Map   (src/components/map/ExploreMap.tsx)
 *   - Web Comp Map      (comp mode inside src/components/map/ExploreMap.tsx)
 *   - Mobile Explore Map, Mobile Comp Map — mirrored as a .js file, see below.
 *
 * OWNER BUG (2026-07-21): a Goat Search or filter-panel search that
 * constrains LISTINGS/TRACTS — farmland land_type, soil rating (PI),
 * price, pct-tillable, listing type, buyer/seller/company, keyword, a
 * near-place radius, corner count, house/building presence, etc. — can
 * NEVER be satisfied by a raw Regrid sale parcel: a parcel_sale_dots row
 * carries none of those attributes. GET /api/map/parcel-sale-dots
 * (ground-goat-backend main.py, get_map_parcel_sale_dots) only accepts
 * state_abbr / county_name / township / sale_status / date_from /
 * date_to / acreage_min / acreage_max / sale_price_min / sale_price_max
 * as query params — every OTHER filter field is silently ignored
 * server-side, so a listing/tract-targeted search still returns (and,
 * without this gate, the map still shows) every unfiltered sold parcel
 * in the viewport.
 *
 * A search that targets PARCELS themselves — acreage, sale price/date,
 * state/county/township, an owner-name lookup, a parcel-number lookup —
 * must keep showing dots, so acreage/date/state/county/township are
 * DELIBERATELY EXCLUDED from the hide-list below.
 *
 * STATUS is the ONE exception (owner bug 2026-07-25): every parcel_sale_dots
 * row is a completed SALE, so it can only ever satisfy a 'sold' status. A
 * status filter that does NOT include 'sold' (Listed / Live / Auction /
 * Pending) matches zero parcels and MUST hide the layer — otherwise the
 * previously-loaded sold dots linger under a Listed/Live filter. A status
 * filter that DOES include 'sold' (or no status filter at all) keeps the
 * dots. This mirrors get_map_parcel_sale_dots' backend short-circuit
 * (returns zero dots when 'sold' isn't among the requested statuses). See
 * statusFilterExcludesSold below.
 *
 * FUTURE EVOLUTION: this list is a mirror of what the backend endpoint
 * does NOT understand today, not a permanent business rule. When the
 * nationwide parcel soil/land-type project (project_nationwide_soil_data,
 * project_regrid_csb_backlog — see backend CLAUDE.md-adjacent memory)
 * lands and get_map_parcel_sale_dots starts accepting soil_rating_min/max
 * and/or land_type, this is the ONE place to update: delete the
 * corresponding field(s) from the list below (soilRatingMin/Max first,
 * pctTillableMin/Max and landTypes if/when those follow). Every map
 * importing this helper picks up the change automatically — no per-map
 * edits, no fetch/plumbing rewrite (the fetch calls already send these
 * fields today; the backend just ignores them until it's updated).
 *
 * REGISTRY-GATED EXCEPTION (2026-08-15, step 3 of registry-gated map
 * filters): the backend now understands soilRatingMin/Max, pctTillableMin/
 * Max, and landTypes, but ONLY for states listed in GET /api/regrid/config's
 * parcel_data_states — everywhere else those params are still silently
 * ignored server-side, so the three fields above must keep hiding dots
 * there. Callers pass the resolved `parcelDataScope` (the single state the
 * CURRENT filter state is scoped to, or null) through this input; when it's
 * set, soilRating(Min/Max), pctTillable(Min/Max), and landTypes are
 * excluded from the hide check below because the backend actually honors
 * them for that state. This is additive to the block above, not a
 * replacement — once a field's backend support goes nationwide, delete it
 * from the checks below same as before.
 * Mobile parity: apply the identical parcelDataScope carve-out to the .js
 * twin (ground-goat-mobile/src/utils/parcelDotsFilterGate.js) when that map
 * gets its own registry-gated filter UI — the two files must stay in
 * lockstep or web/mobile will disagree about when dots should hide.
 *
 * Each map has its own local filter-state shape, so each one defines a
 * tiny adapter mapping its own state into ParcelDotsGateInput and calls
 * shouldHideParcelDotsForFilters — same "one builder, one adapter per
 * map" pattern as buildRegridParcelFilter in regridParcelFilter.ts.
 *
 * Mobile parity: this file is duplicated as a `.js` at
 * ground-goat-mobile/src/utils/parcelDotsFilterGate.js. Update both
 * together — see that file's header comment.
 */

export interface ParcelDotsGateInput {
  soilRatingMin?: string | number | null
  soilRatingMax?: string | number | null
  pctTillableMin?: string | number | null
  pctTillableMax?: string | number | null
  landTypes?: string[] | null
  listingType?: string | null
  pricePerAcreMin?: string | number | null
  pricePerAcreMax?: string | number | null
  askingPriceMin?: string | number | null
  askingPriceMax?: string | number | null
  pricePerSoilRatingMin?: string | number | null
  pricePerSoilRatingMax?: string | number | null
  nearLat?: string | number | null
  nearLng?: string | number | null
  radiusMiles?: string | number | null
  cornersMin?: string | number | null
  cornersMax?: string | number | null
  companyName?: string | null
  buyer?: string | null
  seller?: string | null
  hasHouse?: boolean | null
  hasBuildings?: boolean | null
  hasPolygon?: boolean | null
  keyword?: string | null
  // Sale-status pills (Listed / Live / Sold). Values are comma-joined
  // (e.g. 'auction,live,pending'). Parcel dots hide when this is set to a
  // non-'sold' status — see statusFilterExcludesSold.
  statuses?: Array<string | null | undefined> | null
  // Registry-gated map filters (2026-08-15) — the single state the CURRENT
  // filter state is scoped to (the applied state filter resolves to exactly
  // one state AND that state is in GET /api/regrid/config's
  // parcel_data_states), or null/undefined otherwise. When set, the backend
  // actually understands soilRatingMin/Max, pctTillableMin/Max, and
  // landTypes for this query, so those three fields are excluded from the
  // hide check below — see the REGISTRY-GATED EXCEPTION note above.
  parcelDataScope?: string | null
}

/**
 * True when a status filter is active and NONE of its statuses is 'sold'.
 * Parcel-sale dots are all sold comps, so such a filter (Listed / Live /
 * Auction / Pending) can never match a parcel and the layer must hide.
 * Pill values are comma-joined, so split before checking. No status
 * filter (or one that includes 'sold') → false, dots stay.
 */
function statusFilterExcludesSold(statuses?: Array<string | null | undefined> | null): boolean {
  if (!statuses || statuses.length === 0) return false
  const flat = statuses
    .flatMap(s => String(s ?? '').split(','))
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  return flat.length > 0 && !flat.includes('sold')
}

/**
 * True when ANY active filter field targets an attribute a raw
 * parcel-sale dot can't carry — the durable parcel-sale-dots layer
 * (circle + symbol) should be hidden while this is true. False means
 * every active filter is one /api/map/parcel-sale-dots already
 * understands (or no filter is active at all), so parcel dots should
 * stay visible.
 */
export function shouldHideParcelDotsForFilters(input: ParcelDotsGateInput): boolean {
  // Registry-gated exception: within parcelDataScope the backend actually
  // understands these three fields, so they must NOT trigger a hide.
  const registryScoped = !!input.parcelDataScope
  return !!(
    statusFilterExcludesSold(input.statuses) ||
    (!registryScoped && (input.soilRatingMin || input.soilRatingMax)) ||
    (!registryScoped && (input.pctTillableMin || input.pctTillableMax)) ||
    (!registryScoped && input.landTypes && input.landTypes.length > 0) ||
    input.listingType ||
    input.pricePerAcreMin || input.pricePerAcreMax ||
    input.askingPriceMin || input.askingPriceMax ||
    input.pricePerSoilRatingMin || input.pricePerSoilRatingMax ||
    input.nearLat || input.nearLng || input.radiusMiles ||
    input.cornersMin || input.cornersMax ||
    input.companyName || input.buyer || input.seller ||
    input.hasHouse != null || input.hasBuildings != null ||
    input.hasPolygon != null || input.keyword
  )
}
