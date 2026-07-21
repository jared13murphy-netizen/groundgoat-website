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
 * must keep showing dots, so acreage/date/state/county/township/status
 * are DELIBERATELY EXCLUDED from the hide-list below.
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
  return !!(
    input.soilRatingMin || input.soilRatingMax ||
    input.pctTillableMin || input.pctTillableMax ||
    (input.landTypes && input.landTypes.length > 0) ||
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
