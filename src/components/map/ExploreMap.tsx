'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol as PMTilesProtocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ComparablesMap.css'
import './TractMap.css'
import type { ApiMapTract, MapTractsResponse } from './exploreMapTypes'
import { normalizeTownship } from '../../utils/normalizeTownship'
import {
  buildExplorePolygonGeoJSON,
} from './exploreMapTransform'
import {
  MAP_CENTER,
  MAP_INITIAL_ZOOM,
  TILE_URL,
  TILE_ATTRIBUTION,
  GLYPH_URL,
  LABEL_TILE_URL,
  STATUS_COLORS,
} from './mapConstants'
import fetchWithAuth from '@/lib/fetchWithAuth'
import Tract3DModal from '@/components/Tract3DModal'
import GroundTruthPanel from '@/components/portal/GroundTruthPanel'
import NdviPanel from '@/components/portal/NdviPanel'
import { countyCentroids } from '@/data/countyCentroids'
import { STATE_ABBR, STATE_BOUNDS } from './mapConstants'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Pin colors by sale status (matching mobile app)
const PIN_COLORS: Record<string, string> = {
  sold: '#f58cde',
  auction: '#2563eb',  // Royal blue for upcoming auctions
  listed: '#eab308',
  active: '#eab308',
  live: '#22c55e',
  pending: '#eab308',
  no_sale: '#9ca3af',
}
const DEFAULT_PIN_COLOR = '#eab308' // Yellow for NULL/unknown status (= listed)

// Draw order on the map — higher value = drawn on top.
// "live" here means "auctioning today" — those pins sit above EVERYTHING
// (including the state + county badges) so the pulsing dots are always
// the most prominent thing on the map.
const PIN_Z_ORDER: Record<string, number> = {
  live:    10000,
  auction: 40,
  sold:    30,
  no_sale: 20,
  listed:  10,
  active:  10,
  pending: 10,
}
const DEFAULT_PIN_Z = 10

/**
 * Return true when the tract's auction is happening on the current local
 * date. Used to decide whether to render the green pulsing dot. We compare
 * by Y/M/D in the user's local timezone so a tract auctioning in any zone
 * "today" lights up while the user is browsing today.
 *
 * Plain YYYY-MM-DD strings are intentionally parsed as local dates — the
 * default `new Date('YYYY-MM-DD')` parses as UTC midnight, which silently
 * shifts to the previous day for western timezones.
 */
function isAuctionDateToday(d: unknown): boolean {
  if (!d) return false
  const s = String(d).trim()
  if (!s) return false
  let date: Date
  const plain = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (plain) {
    date = new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3]))
  } else {
    date = new Date(s)
  }
  if (isNaN(date.getTime())) return false
  const now = new Date()
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function getStatusPinColor(status: string | null): string {
  if (!status) return DEFAULT_PIN_COLOR
  return PIN_COLORS[status.toLowerCase()] || DEFAULT_PIN_COLOR
}

function getStatusPinZ(status: string | null, isLive: boolean): number {
  if (isLive) return PIN_Z_ORDER.live
  if (!status) return DEFAULT_PIN_Z
  return PIN_Z_ORDER[status.toLowerCase()] ?? DEFAULT_PIN_Z
}

/**
 * Decide whether a tract returned by the API should actually render on the
 * map. Used by BOTH the cell-loader (viewport pans/zooms) and the chat-search
 * wide-query path so the two stay in lock-step.
 *
 * Rules in order:
 *   1. Must have a real polygon (≥3 points). Tracts without boundaries get
 *      dropped — otherwise we'd render markers at county centroids that look
 *      like phantom dots that "move" when re-renders shuffle co-located
 *      offsets.
 *   2. Auction-style listings whose date is in the past and where no result
 *      was ever recorded (sale_status is null/'auction'/'listed') are stale —
 *      hide them. The auction happened; we just don't have an outcome.
 *   3. With the "upcoming" date filter: hide post-sale statuses
 *      (sold/pending/no_sale).
 *   4. Default: show anything with a sale_status, OR a listed/live listing,
 *      OR a future auction date.
 */
function isAcceptableMapTract(t: ApiMapTract, isUpcomingFilter: boolean, now: Date): boolean {
  if (!t.polygon_coordinates || !Array.isArray(t.polygon_coordinates) || t.polygon_coordinates.length < 3) {
    return false
  }
  const isAuctionListing = t.listing_type === 'auction'
  const auctionInPast = !!t.auction_date && new Date(t.auction_date as string) < now
  const unfinalized = !t.sale_status || ['auction', 'listed'].includes(t.sale_status)
  if (isAuctionListing && auctionInPast && unfinalized) return false

  if (isUpcomingFilter) {
    const postSaleStatuses = ['sold', 'pending', 'no_sale']
    return !t.sale_status || !postSaleStatuses.includes(t.sale_status)
  }
  const isListed = t.listing_status === 'listed' || t.listing_status === 'live'
  const hasFutureAuction = !!t.auction_date && new Date(t.auction_date as string) >= now
  return !!(t.sale_status || isListed || hasFutureAuction)
}

function formatCurrency(amount: number | null | undefined): string {
  if (!amount) return '—'
  return '$' + Math.round(amount).toLocaleString('en-US')
}

// ───────────────────────────────────────────────────────────────
// 3-tier zoom system (state silhouettes / county squares / tract
// pins). Hard-gated: only one tier's markers are visible at a time
// so the map never gets visually crowded.
// ───────────────────────────────────────────────────────────────
const STATE_TIER_MAX = 6
const COUNTY_TIER_MIN = 6
const COUNTY_TIER_MAX = 9
const TRACT_TIER_MIN = 9

type ZoomTier = 'state' | 'county' | 'tract'
function currentZoomTier(z: number): ZoomTier {
  if (z <= STATE_TIER_MAX) return 'state'
  if (z <= COUNTY_TIER_MAX) return 'county'
  return 'tract'
}

// Full-name → 2-letter abbr lookup for ALL US states. Used to match
// /data/us-states.json features (keyed by `properties.NAME`) to the
// state-counts API rows (keyed by 2-letter abbr).
const ALL_STATE_NAME_TO_ABBR: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR',
  California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  'District of Columbia': 'DC',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS',
  Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD',
  Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE',
  Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC',
  'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
}
let _ABBR_TO_NAME: Record<string, string> | null = null
function abbrToName(abbr: string): string {
  if (!_ABBR_TO_NAME) {
    _ABBR_TO_NAME = {}
    for (const [name, a] of Object.entries(ALL_STATE_NAME_TO_ABBR)) {
      _ABBR_TO_NAME[a] = name
    }
  }
  return _ABBR_TO_NAME[abbr] || abbr
}

// Bbox of a state Feature (Polygon or MultiPolygon). Returns
// [[minLng, minLat], [maxLng, maxLat]] or null. Used both for the
// marker centroid and for sizing each badge to match the state's
// actual on-map extent at the current zoom.
function featureBbox(
  feature: any,
): [[number, number], [number, number]] | null {
  if (!feature?.geometry?.coordinates) return null
  const geom = feature.geometry
  let minLng = Infinity, minLat = Infinity
  let maxLng = -Infinity, maxLat = -Infinity
  const visit = (ring: number[][]) => {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) visit(ring as number[][])
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly as number[][][]) visit(ring)
    }
  } else {
    return null
  }
  if (!isFinite(minLng) || !isFinite(minLat)) return null
  return [[minLng, minLat], [maxLng, maxLat]]
}

// SVG path that STRETCHES across a 100×100 viewBox (no aspect-ratio
// centering). Combined with preserveAspectRatio="none" + a container
// sized to the projected bbox in pixels, the silhouette ends up
// perfectly aligned over the actual state on the map.
function featureToSvgPath(feature: any): string | null {
  if (!feature?.geometry?.coordinates) return null
  const geom = feature.geometry
  const rings: number[][][] = []
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) rings.push(ring as number[][])
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      for (const ring of poly as number[][][]) rings.push(ring)
    }
  } else {
    return null
  }
  if (!rings.length) return null
  let minLng = Infinity, minLat = Infinity
  let maxLng = -Infinity, maxLat = -Infinity
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
  }
  const w = maxLng - minLng
  const h = maxLat - minLat
  if (w <= 0 || h <= 0) return null
  const sx = 100 / w
  const sy = 100 / h
  const parts: string[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    const cmds: string[] = []
    for (let i = 0; i < ring.length; i++) {
      const [lng, lat] = ring[i]
      const x = (lng - minLng) * sx
      const y = (maxLat - lat) * sy
      cmds.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    cmds.push('Z')
    parts.push(cmds.join(' '))
  }
  return parts.join(' ')
}

// Fade-out then remove a batch of markers. Adds the .aem-leaving
// class to the INNER badge (not the maplibre shell, which holds the
// translate transform that positions the marker). 380ms later we
// call .remove().
function fadeOutAndRemove(markers: maplibregl.Marker[]): void {
  if (!markers.length) return
  const snapshot = [...markers]
  for (const m of snapshot) {
    const shell = m.getElement()
    const inner = shell?.firstElementChild as HTMLElement | null
    if (inner) inner.classList.add('aem-leaving')
  }
  setTimeout(() => {
    for (const m of snapshot) {
      try { m.remove() } catch {}
    }
  }, 380)
}

function formatAcres(acres: number | null | undefined): string {
  if (!acres) return '—'
  return acres.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export interface SaleDetail {
  id: string
  listingId?: string | null
  tractId?: string | null
  auctionDate?: string | null
  totalAcres?: number | null
  tillableAcres?: number | null
  companyName?: string | null
  salePrice?: number | null
  pricePerAcre?: number | null
  county: string
  state: string
  township?: string | null
  soilRating?: number | null
  polygonCoordinates?: [number, number][] | null
  saleStatus?: string | null
  listingType?: string | null
  askingPrice?: number | null
  landType?: string | null
  landTypes?: string[] | null
  pctTillable?: number | null
  pricePerTillableAcre?: number | null
  pricePerSoilRating?: number | null
  sourceUrl?: string | null
}

interface FilterState {
  // dateRange is the coarse preset ('all' | 'upcoming' | '1month' | '6months' |
  // '1year' | '18months' | '2years' | 'custom'). When set to 'custom' the
  // dateFrom / dateTo strings (YYYY-MM-DD) drive the auction/sale-date filter.
  dateRange: string
  dateFrom: string
  dateTo: string
  stateFilter: string
  countyFilters: string[]
  townshipFilters: string[]
  soilRatingMin: string
  soilRatingMax: string
  acreageMin: string
  acreageMax: string
  pctTillableMin: string
  pctTillableMax: string
  statuses: string[]
  landTypes: string[]
  // Chat-driven filters (no UI control yet — surfaced via Goat Search).
  // Empty string / null / [] means "not set".
  listingType: string                // 'auction' | 'private_treaty' | ''
  pricePerAcreMin: string
  pricePerAcreMax: string
  salePriceMin: string
  salePriceMax: string
  askingPriceMin: string
  askingPriceMax: string
  pricePerSoilRatingMin: string
  pricePerSoilRatingMax: string
  // Radius search (chat-only). Set together; partial values are ignored.
  nearLat: string
  nearLng: string
  radiusMiles: string
  // Tract shape (chat-only). Polygon vertex count.
  cornersMin: string
  cornersMax: string
  companyName: string
  buyer: string
  seller: string
  hasHouse: boolean | null
  hasBuildings: boolean | null
  hasPolygon: boolean | null
  keyword: string
}

const INITIAL_FILTERS: FilterState = {
  dateRange: 'all',
  dateFrom: '',
  dateTo: '',
  stateFilter: '',
  countyFilters: [],
  townshipFilters: [],
  soilRatingMin: '',
  soilRatingMax: '',
  acreageMin: '',
  acreageMax: '',
  pctTillableMin: '',
  pctTillableMax: '',
  statuses: [],
  landTypes: [],
  listingType: '',
  pricePerAcreMin: '',
  pricePerAcreMax: '',
  salePriceMin: '',
  salePriceMax: '',
  askingPriceMin: '',
  askingPriceMax: '',
  pricePerSoilRatingMin: '',
  pricePerSoilRatingMax: '',
  nearLat: '',
  nearLng: '',
  radiusMiles: '',
  cornersMin: '',
  cornersMax: '',
  companyName: '',
  buyer: '',
  seller: '',
  hasHouse: null,
  hasBuildings: null,
  hasPolygon: null,
  keyword: '',
}

// States and counties are now built dynamically from loaded tract data


function buildFilterParams(filters: FilterState) {
  const params: Record<string, string> = {}
  if (filters.dateRange === 'custom') {
    // Explicit user-entered window — only set the bounds we actually have
    // so a one-sided range (e.g. "since March 2024", no end date) works.
    if (filters.dateFrom) params.date_from = filters.dateFrom
    if (filters.dateTo) params.date_to = filters.dateTo
  } else if (filters.dateRange === 'upcoming') {
    params.date_from = new Date().toISOString().split('T')[0]
  } else if (filters.dateRange !== 'all') {
    const months = filters.dateRange === '1month' ? 1
      : filters.dateRange === '6months' ? 6
      : filters.dateRange === '1year' ? 12
      : filters.dateRange === '18months' ? 18
      : 24
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - months)
    params.date_from = cutoff.toISOString().split('T')[0]
    // Also bound the upper end at today — without this, a "last 6 months"
    // query lets future-dated upcoming auctions through because the API
    // filter is just `auction_datetime >= cutoff` with no ceiling.
    params.date_to = new Date().toISOString().split('T')[0]
  }
  if (filters.statuses?.length > 0) params.sale_status = filters.statuses.flatMap(s => s.split(',')).join(',')
  if (filters.stateFilter) params.state_abbr = filters.stateFilter
  if (filters.countyFilters?.length > 0) params.county_name = filters.countyFilters.join(',')
  if (filters.townshipFilters?.length > 0) params.township = filters.townshipFilters.join(',')
  if (filters.soilRatingMin) params.soil_rating_min = filters.soilRatingMin
  if (filters.soilRatingMax) params.soil_rating_max = filters.soilRatingMax
  if (filters.acreageMin) params.acreage_min = filters.acreageMin
  if (filters.acreageMax) params.acreage_max = filters.acreageMax
  if (filters.pctTillableMin) params.pct_tillable_min = filters.pctTillableMin
  if (filters.pctTillableMax) params.pct_tillable_max = filters.pctTillableMax
  if (filters.landTypes?.length > 0) params.land_types = filters.landTypes.join(',')
  // Chat-driven additions
  if (filters.listingType) params.listing_type = filters.listingType
  if (filters.pricePerAcreMin) params.price_per_acre_min = filters.pricePerAcreMin
  if (filters.pricePerAcreMax) params.price_per_acre_max = filters.pricePerAcreMax
  if (filters.salePriceMin) params.sale_price_min = filters.salePriceMin
  if (filters.salePriceMax) params.sale_price_max = filters.salePriceMax
  if (filters.askingPriceMin) params.asking_price_min = filters.askingPriceMin
  if (filters.askingPriceMax) params.asking_price_max = filters.askingPriceMax
  if (filters.pricePerSoilRatingMin) params.price_per_soil_rating_min = filters.pricePerSoilRatingMin
  if (filters.pricePerSoilRatingMax) params.price_per_soil_rating_max = filters.pricePerSoilRatingMax
  // Radius search: only forward when all three are present
  if (filters.nearLat && filters.nearLng && filters.radiusMiles) {
    params.near_lat = filters.nearLat
    params.near_lng = filters.nearLng
    params.radius_miles = filters.radiusMiles
  }
  if (filters.cornersMin) params.corners_min = filters.cornersMin
  if (filters.cornersMax) params.corners_max = filters.cornersMax
  if (filters.companyName) params.company_name = filters.companyName
  if (filters.buyer) params.buyer = filters.buyer
  if (filters.seller) params.seller = filters.seller
  if (filters.hasHouse !== null) params.has_house = String(filters.hasHouse)
  if (filters.hasBuildings !== null) params.has_buildings = String(filters.hasBuildings)
  // Always exclude tracts without polygon boundaries from the map.
  // Pins/badges/county counts only reflect tracts the user can
  // actually see outlined. Backend predicate is
  // Tract.polygon_coordinates.isnot(None).
  params.has_polygon = 'true'
  if (filters.keyword) params.keyword = filters.keyword
  return params
}

// Translate the filter-panel dateRange into the same {from, to} window
// buildFilterParams sends to the backend. Returned dates are YYYY-MM-DD
// strings; either side can be undefined when the active preset is open-
// ended (e.g. 'upcoming' has no upper bound). Both undefined → no date
// constraint (the 'all' preset).
function resolveDateWindow(filters: FilterState): {
  from?: string
  to?: string
  upcomingOnly: boolean
} {
  if (filters.dateRange === 'custom') {
    return { from: filters.dateFrom || undefined, to: filters.dateTo || undefined, upcomingOnly: false }
  }
  if (filters.dateRange === 'upcoming') {
    return { from: new Date().toISOString().split('T')[0], to: undefined, upcomingOnly: true }
  }
  if (filters.dateRange === 'all') {
    return { from: undefined, to: undefined, upcomingOnly: false }
  }
  const months = filters.dateRange === '1month' ? 1
    : filters.dateRange === '6months' ? 6
    : filters.dateRange === '1year' ? 12
    : filters.dateRange === '18months' ? 18
    : 24
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  return {
    from: cutoff.toISOString().split('T')[0],
    to: new Date().toISOString().split('T')[0],
    upcomingOnly: false,
  }
}

// Maplibre filter expression for the Regrid parcel-sale + pin layers.
// Mirrors the backend date filter so the dots respect the user's
// dateRange preset. Regrid's `saledate` is YYYY-MM-DD, so string lexical
// comparison matches chronological ordering. Missing saledate is
// coalesced to a sentinel that fails any active date check — so under
// "Last 6 months" we only show dots whose sale we can prove falls in
// the window.
function buildRegridSaleDotFilter(filters: FilterState, minAcres: number): any[] {
  const { from, to, upcomingOnly } = resolveDateWindow(filters)
  // "Upcoming auctions" can't match recorded past sales — return a
  // constant-false expression so all parcel dots vanish.
  if (upcomingOnly) return ['==', ['literal', 1], ['literal', 0]]
  // Why the explicit ['has', ...] guards instead of coalesce: maplibre's
  // to-number(null) returns 0, not null, so a coalesce chain like
  // [coalesce, to-number(get ll_gisacre), to-number(get gisacre), 0]
  // never falls through — if ll_gisacre is missing the first term is 0
  // (not null), coalesce takes it, and the parcel fails 0 >= 20 even
  // though gisacre is populated. Matches the pattern the parcel-label
  // layer above uses for the same fields.
  const expr: any[] = [
    'all',
    ['has', 'saleprice'],
    ['>', ['to-number', ['get', 'saleprice']], 0],
    ['any', ['has', 'll_gisacre'], ['has', 'gisacre']],
    ['>=',
      ['case',
        ['has', 'll_gisacre'], ['to-number', ['get', 'll_gisacre']],
        ['has', 'gisacre'], ['to-number', ['get', 'gisacre']],
        0,
      ],
      minAcres,
    ],
  ]
  // HARDCODED 3-year floor on the dot layer per user spec
  // ("sale date is within the last 3 years"). This applies even when
  // the user picks "All time" in the filter panel — the panel filter
  // affects backend listings + tract pins, but the Regrid pink + dots
  // are always capped at 3 years of sales. If the user picks a
  // tighter window (e.g. "Last 6 months"), we narrow further by
  // taking the LATER of (3-year floor, user's `from`).
  const threeYearFloor = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 3)
    return d.toISOString().split('T')[0]
  })()
  const effectiveFrom = from && from > threeYearFloor ? from : threeYearFloor
  expr.push(['>=', ['coalesce', ['get', 'saledate'], ''], effectiveFrom])
  if (to) {
    expr.push(['<=', ['coalesce', ['get', 'saledate'], '9999-12-31'], to])
  }
  // Sale price min/max from the filter panel. Skip when the input is
  // empty/non-numeric so the user clearing the field re-shows
  // everything. The expression already requires saleprice > 0 above,
  // so we don't need to re-check for presence here.
  const priceMin = filters.salePriceMin ? parseFloat(filters.salePriceMin) : NaN
  const priceMax = filters.salePriceMax ? parseFloat(filters.salePriceMax) : NaN
  if (Number.isFinite(priceMin)) {
    expr.push(['>=', ['to-number', ['get', 'saleprice']], priceMin])
  }
  if (Number.isFinite(priceMax)) {
    expr.push(['<=', ['to-number', ['get', 'saleprice']], priceMax])
  }
  return expr
}

interface ExploreMapProps {
  height?: string
  homeState?: string
  homeCounty?: string
  portalMode?: boolean
  externalFilterOpen?: boolean
  onFilterOpenChange?: (open: boolean) => void
  onViewListing?: (listingId: string) => void
  onTractSelected?: (tract: SaleDetail) => void
  onToggleReport?: (tract: SaleDetail) => void
  onView3DTerrain?: (tractId: string, tractName: string) => void
  isInReport?: (tractId: string) => boolean
  reportIds?: Set<string>
  onFiltersApplied?: (filters: { stateFilter: string; countyFilters: string[] }) => void
  zoomToLocation?: { lat: number; lng: number; zoom: number } | null
  /** Fit the map to a polygon's bounds. Bumped via `nonce` so the same
      coords retrigger if the user clicks the same listing/tract twice. */
  zoomToBoundsSignal?: { coords: [number, number][]; nonce: number } | null
  /** Polygon to overlay even if the tract isn't in the map's filter
      set — set when the user picks a tract from a slide-out so its
      boundary always shows up after a zoom-to-tract action. */
  pinnedTractPolygon?: { id: string; coords: [number, number][] } | null
  subjectTractId?: string | null
  subjectTractLocation?: { lat: number; lng: number } | null
  resetFiltersSignal?: number
  /** AI chat hook: when this object changes, merge its keys into the
      current FilterState. Pass a fresh object each call (not just a
      changed property of the same object). */
  applyExternalFilters?: { filters: Partial<FilterState>; clearUnspecified?: boolean; nonce: number } | null
  /** Bumped externally when the user submits a chat query. Triggers
      the map's search animation immediately, BEFORE the
      applyExternalFilters payload arrives (which can take 1-2s for the
      Claude tool-use call to come back). */
  chatSearchStartSignal?: number
  /** Fires when the chat-filter response arrives (any shape). Needed
      so analytics responses (which never apply filters and never run
      the wide-bbox query) can still stop the loading animation. */
  chatSearchEndSignal?: number
  comparableVisibleIds?: Set<string> | null
  neighborParcels?: {
    geometry: [number, number][]
    owner: string
    acres: number | null
    apn: string
    source?: string
    county?: string | null
    state?: string | null
    township?: string | null
    // The fields below are returned by the API but currently not shown in
    // the popup. Left in the type so they're available when we re-enable
    // additional rows in the future.
    soil_rating?: number | null
    tillable_acres?: number | null
    sale_price?: number | null
    sale_date?: string | null
    last_transfer_date?: string | null
    assessed_value_total?: number | null
    assessed_value_land?: number | null
    assessed_value_improvement?: number | null
    assessed_value_ag?: number | null
    annual_tax?: number | null
    use_code?: string | null
    use_description?: string | null
    zoning?: string | null
  }[] | null
  neighborsLoading?: boolean
}

export default function ExploreMap({ height = 'calc(100vh - 220px)', homeState, homeCounty, portalMode = false, externalFilterOpen, onFilterOpenChange, onViewListing, onTractSelected, onToggleReport, onView3DTerrain, isInReport, reportIds, onFiltersApplied, zoomToLocation, zoomToBoundsSignal, pinnedTractPolygon, subjectTractId, subjectTractLocation, resetFiltersSignal, applyExternalFilters, chatSearchStartSignal, chatSearchEndSignal, comparableVisibleIds, neighborParcels, neighborsLoading }: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const stateMarkersRef = useRef<maplibregl.Marker[]>([])
  const countyMarkersRef = useRef<maplibregl.Marker[]>([])
  const tractMarkersRef = useRef<maplibregl.Marker[]>([])
  const tractMarkerElementsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  // Today's auctions are rendered as a native MapLibre GeoJSON layer
  // (see the useEffect below) — no per-marker DOM refs needed.
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Cells we've FULLY loaded (got all matching tracts back, didn't hit
  // the per-cell 1000 cap). Future moveends won't re-fetch these.
  const loadedCellsRef = useRef<Set<string>>(new Set())
  // Cells currently being fetched. Prevents duplicate concurrent
  // requests when many moveend events overlap. A cell only graduates
  // into `loadedCellsRef` if its fetch SUCCEEDED and wasn't capped.
  // Failed / capped fetches drop out of `loadingCellsRef` without
  // being added to `loadedCellsRef`, so a future moveend can retry.
  const loadingCellsRef = useRef<Set<string>>(new Set())
  const tractMapRef = useRef<Map<string, ApiMapTract>>(new Map())
  // Chat-search: when true, the cell-loader pauses (we run a single
  // wide query instead) and the chat-search animation overlays the map.
  const [chatSearching, setChatSearching] = useState(false)
  // Mirror state in a ref so handleMoveEnd (which is created via useCallback
  // before the state's first render) can read it without re-creating.
  const chatSearchingRef = useRef(false)
  useEffect(() => { chatSearchingRef.current = chatSearching }, [chatSearching])
  // Tracks the moment the animation began so we can enforce a minimum
  // display time — even very fast searches need to FEEL like something
  // happened, not flash.
  const chatSearchStartedAtRef = useRef(0)
  const CHAT_ANIM_MIN_MS = 900
  const stopChatSearchingSoon = () => {
    const elapsed = Date.now() - chatSearchStartedAtRef.current
    if (elapsed >= CHAT_ANIM_MIN_MS) {
      setChatSearching(false)
    } else {
      setTimeout(() => setChatSearching(false), CHAT_ANIM_MIN_MS - elapsed)
    }
  }

  // Start the animation the moment the user submits a chat query —
  // fires BEFORE the chat-filter response arrives (which can take 1-2s)
  // so the user sees feedback immediately.
  useEffect(() => {
    if (chatSearchStartSignal && chatSearchStartSignal > 0) {
      chatSearchStartedAtRef.current = Date.now()
      setChatSearching(true)
    }
  }, [chatSearchStartSignal])
  // Stop the animation when the chat panel signals the response
  // arrived. Filter responses ALSO stop via the wide-bbox completion
  // path, which is fine — stopChatSearchingSoon is idempotent.
  useEffect(() => {
    if (chatSearchEndSignal && chatSearchEndSignal > 0) {
      stopChatSearchingSoon()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSearchEndSignal])
  const subjectTractIdRef = useRef<string | null>(null)
  subjectTractIdRef.current = subjectTractId || null

  const [tracts, setTracts] = useState<ApiMapTract[]>([])
  // Today's auction tracts — kept in a SEPARATE state from the bounds-based
  // `tracts` because:
  //   - the bounds loader doesn't fetch below z≈8.5 (TRACT_TIER_MIN), so
  //     at country/state zoom there'd be no green dots without this
  //   - filter changes and chat-search wipe `tractMapRef`, but today's
  //     auctions should stay visible regardless of filters
  // Rendered as separate markers in their own useEffect below.
  const [todayTracts, setTodayTracts] = useState<ApiMapTract[]>([])
  const [currentZoom, setCurrentZoom] = useState(MAP_INITIAL_ZOOM)
  const [mapLoaded, setMapLoaded] = useState(false)

  // 3-tier marker counts and silhouette geometry. Counts come from
  // dedicated server-side aggregation endpoints (filter-aware) so
  // the badges show accurate numbers regardless of what's been
  // loaded into the cell-loader. Silhouette paths + bboxes are
  // loaded once from /data/us-states.json on mount.
  const [stateCounts, setStateCounts] = useState<
    Array<{ state: string; count: number }>
  >([])
  const [countyCounts, setCountyCounts] = useState<
    Array<{ state: string; county: string; count: number; lat: number; lng: number }>
  >([])
  // Full nationwide county centroid list (3,221 entries). Loaded once
  // from /data/county-centroids.json so we can render a badge for every
  // county, not just counties returned by the tract-counts API.
  const [allCountyCentroids, setAllCountyCentroids] = useState<
    Array<{ state: string; county: string; lng: number; lat: number }>
  >([])
  const [stateSilhouettes, setStateSilhouettes] = useState<Record<string, string>>({})
  const [stateCentroids, setStateCentroids] = useState<Record<string, [number, number]>>({})
  const [stateBboxes, setStateBboxes] = useState<
    Record<string, [[number, number], [number, number]]>
  >({})
  const [loading, setLoading] = useState(false)
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  // Inline popup ON THE MAP (comparables mode only). Click a + marker
  // opens this; click outside (anywhere else on the map) or the X /
  // Esc closes it. Distinct from `selectedSale` (the sidebar/modal flow
  // used outside comp mode). See createMarkerElement asPlusButton.
  const [compPopup, setCompPopup] = useState<{
    sale: SaleDetail
    pos: { x: number; y: number }
  } | null>(null)
  const [show3DViewer, setShow3DViewer] = useState(false)

  // Entering or exiting comparables mode invalidates the bbox tract
  // cache — the sold-only filter (and the eventual sale_status change)
  // means previously-cached cells return different data. Without this,
  // the user could enter comp mode but the markers still show the
  // pre-filter set (and stay as plain pins, not + buttons).
  useEffect(() => {
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    setTracts([])
    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []
    // Trigger a re-fetch by simulating a moveend from current bounds.
    const map = mapRef.current
    if (map && mapLoaded) {
      const b = map.getBounds()
      loadTractsForBounds({
        min_lat: b.getSouth(),
        max_lat: b.getNorth(),
        min_lng: b.getWest(),
        max_lng: b.getEast(),
      }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectTractId])

  // Comp-mode popup lifecycle effects: map-click closes (clicks on a
  // + marker DOM don't bubble to the canvas, so this only fires for
  // empty-map clicks). Pan/zoom re-projects the lat/lng so the popup
  // tracks its anchor pin. Both are gated on compPopup being open so
  // they're a no-op outside comp mode.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !compPopup) return
    const onMapClick = () => setCompPopup(null)
    const onMove = () => {
      setCompPopup(prev => {
        if (!prev) return prev
        // Re-project from sale's lat/lng. SaleDetail's polygonCoordinates
        // can be missing — fall back to the lng/lat we projected from
        // originally by reading off the marker element (kept in
        // tractMarkerElementsRef). Simpler: use the polygon centroid
        // or the lat/lng we stored when opening.
        const tid = prev.sale.tractId
        if (!tid) return prev
        // Read the marker's lng/lat by querying MapLibre's marker — we
        // stashed elements keyed by tract id earlier. Resolve from the
        // current tractMarkers list.
        const marker = tractMarkersRef.current.find(m => {
          const el = m.getElement() as HTMLDivElement
          return el.dataset.tractId === tid
        })
        if (!marker) return prev
        const ll = marker.getLngLat()
        const p = map.project(ll)
        return { sale: prev.sale, pos: { x: p.x, y: p.y } }
      })
    }
    map.on('click', onMapClick)
    map.on('move', onMove)
    return () => {
      map.off('click', onMapClick)
      map.off('move', onMove)
    }
  }, [compPopup])
  const [soilData, setSoilData] = useState<{ map_units: any[]; avg_slope?: number } | null>(null)
  const [elevationData, setElevationData] = useState<{ min_ft: number; max_ft: number; relief_ft: number; avg_slope_pct: number } | null>(null)
  const [soilLoading, setSoilLoading] = useState(false)

  // Filter options — fetched once on mount, always shows ALL available states/counties
  const [filterOptions, setFilterOptions] = useState<{ states: string[]; counties_by_state: Record<string, string[]>; townships_by_county: Record<string, string[]> }>({ states: [], counties_by_state: {}, townships_by_county: {} })

  useEffect(() => {
    fetch(`${API_URL}/api/map/filter-options`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setFilterOptions(data) })
      .catch(() => {})
  }, [])

  // Fetch today's auction tracts on mount and re-fetch every 10 minutes so
  // the dots roll over correctly when the user keeps the tab open past
  // midnight (Central Time).
  useEffect(() => {
    let cancelled = false
    const fetchToday = async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/map/tracts/today`)
        if (!res.ok) return
        const data: { count: number; tracts: ApiMapTract[] } = await res.json()
        if (!cancelled && Array.isArray(data?.tracts)) {
          setTodayTracts(data.tracts)
        }
      } catch {
        // Silent: this is a non-critical enrichment layer. If it fails the
        // map still renders everything else.
      }
    }
    fetchToday()
    const interval = setInterval(fetchToday, 10 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  // Filter state
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
  const [filterOpen, setFilterOpenInternal] = useState(false)
  const filtersRef = useRef<FilterState>(INITIAL_FILTERS)

  // Serialized filter params used by the new state/county count
  // endpoints (and any future filter-aware fetcher). Re-computes
  // whenever `filters` change, which causes the count effects below
  // to re-fire automatically.
  const filterParamString = useMemo(() => {
    return new URLSearchParams(buildFilterParams(filters)).toString()
  }, [filters])

  const currentTier = currentZoomTier(currentZoom)

  // Load nationwide county centroids ONCE so the county-tier badges
  // can render for every U.S. county.
  useEffect(() => {
    let cancelled = false
    fetch('/data/county-centroids.json')
      .then(r => (r.ok ? r.json() : []))
      .then((data: any) => {
        if (cancelled || !Array.isArray(data)) return
        setAllCountyCentroids(data)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Load state silhouettes + bboxes ONCE on mount from us-states.json.
  // Used to render the silhouette badges with bbox-projected sizing.
  useEffect(() => {
    let cancelled = false
    fetch('/data/us-states.json')
      .then(r => r.ok ? r.json() : null)
      .then((geo: any) => {
        if (cancelled || !geo?.features) return
        const paths: Record<string, string> = {}
        const centroids: Record<string, [number, number]> = {}
        const bboxes: Record<string, [[number, number], [number, number]]> = {}
        for (const feat of geo.features) {
          const abbr = ALL_STATE_NAME_TO_ABBR[feat?.properties?.NAME]
          if (!abbr) continue
          const path = featureToSvgPath(feat)
          if (path) paths[abbr] = path
          const bbox = featureBbox(feat)
          if (bbox) {
            bboxes[abbr] = bbox
            centroids[abbr] = [
              (bbox[0][0] + bbox[1][0]) / 2,
              (bbox[0][1] + bbox[1][1]) / 2,
            ]
          }
        }
        setStateSilhouettes(paths)
        setStateCentroids(centroids)
        setStateBboxes(bboxes)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Filter-aware state-tier counts. Auto-refetches when filters
  // change, so silhouette badges stay accurate to the user's filter
  // set across the entire DB (not just the cell-loader's loaded set).
  useEffect(() => {
    let cancel = false
    fetchWithAuth(`${API_URL}/api/map/state-tract-counts?${filterParamString}`)
      .then(r => r.ok ? r.json() : { states: [] })
      .then(d => { if (!cancel) setStateCounts(d.states || []) })
      .catch(() => {})
    return () => { cancel = true }
  }, [filterParamString])

  // Filter-aware county-tier counts (scoped to selected state(s) when set).
  useEffect(() => {
    let cancel = false
    const stateScope = filters.stateFilter ? `state=${filters.stateFilter}&` : ''
    fetchWithAuth(`${API_URL}/api/map/county-tract-counts?${stateScope}${filterParamString}`)
      .then(r => r.ok ? r.json() : { counties: [] })
      .then(d => { if (!cancel) setCountyCounts(d.counties || []) })
      .catch(() => {})
    return () => { cancel = true }
  }, [filterParamString, filters.stateFilter])

  // Admin parcel-overlay state. Lights up the map with every parcel
  // (boundary + owner + acres). Visible only to groundgoat_admin users;
  // the toggle button only appears when currentZoom >= ADMIN_PARCEL_MIN_ZOOM
  // so we never paint a wall of names at low zoom.
  //
  // Architecture: pre-rendered vector tiles (.pmtiles) hosted on the
  // ground-goat-tiles Railway service, one archive per state. The
  // pmtiles JS library wraps the archive as a vector source for
  // MapLibre, which fetches only the tiles in view via HTTP range
  // requests. Same UX as Camo Ag: no loading spinner, no flash on
  // pan, no row caps. Replaces the old per-bbox GeoJSON fetch loop.
  const ADMIN_PARCEL_MIN_ZOOM = 13
  const TILES_BASE_URL =
    process.env.NEXT_PUBLIC_TILES_URL ||
    'https://ground-goat-tiles-production.up.railway.app'
  const [isAdmin, setIsAdmin] = useState(false)
  // Force-OFF: the legacy state_parcels pmtiles overlay (with its own
  // hover popups) is superseded by the always-on Regrid layer. We keep
  // the code path around for emergency fallback, but hard-disable the
  // toggle so the noisy hover popups never show.
  const [adminParcelOverlay, setAdminParcelOverlay] = useState(false)
  // List of state codes that have a .pmtiles file on the tile server.
  // Populated from the tile server's listing endpoint; hydrated from
  // localStorage immediately for instant button render on subsequent
  // sessions.
  const [adminParcelStates, setAdminParcelStates] = useState<string[]>([])

  // One-time admin check + tile-coverage fetch.
  //
  // We hydrate adminParcelStates from localStorage immediately so the
  // "Show Parcels" button can appear without waiting for the network
  // round-trip. The tile server call refreshes the value in the
  // background — if a new state's tiles have shipped, the layer
  // automatically picks them up.
  useEffect(() => {
    let cancelled = false

    try {
      const cached = localStorage.getItem('gg_admin_parcel_states')
      if (cached) {
        const arr = JSON.parse(cached)
        if (Array.isArray(arr) && arr.every(s => typeof s === 'string')) {
          setAdminParcelStates(arr)
        }
      }
    } catch {/* ignore */}

    ;(async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/auth/me`)
        if (!res.ok) return
        const me = await res.json()
        if (cancelled) return
        const admin = me?.account_type === 'groundgoat_admin'
        setIsAdmin(admin)
        if (!admin) return
        // Tile-server lists files like ["WI.pmtiles","FL.pmtiles"].
        // Strip the extension to get the state codes. CORS is allowed
        // on the tile server so this works cross-origin without a token.
        const tileRes = await fetch(`${TILES_BASE_URL}/`).catch(() => null)
        if (!tileRes || !tileRes.ok) return
        const tileData = await tileRes.json()
        if (cancelled) return
        const states: string[] = (tileData?.available ?? [])
          .filter((f: string) => typeof f === 'string' && f.endsWith('.pmtiles'))
          .map((f: string) => f.replace(/\.pmtiles$/, ''))
          .filter((s: string) => /^[A-Z]{2}$/.test(s))
        setAdminParcelStates(states)
        try {
          localStorage.setItem('gg_admin_parcel_states', JSON.stringify(states))
        } catch {/* ignore */}
      } catch {
        /* not fatal — overlay just won't appear */
      }
    })()
    return () => { cancelled = true }
  }, [TILES_BASE_URL])

  // Sync external filter open state (portal mode)
  useEffect(() => {
    if (externalFilterOpen !== undefined) {
      setFilterOpenInternal(externalFilterOpen)
    }
  }, [externalFilterOpen])

  // Reset filters from parent (e.g. when launching Find Comparables)
  useEffect(() => {
    if (resetFiltersSignal && resetFiltersSignal > 0) {
      setFilters(INITIAL_FILTERS)
      filtersRef.current = INITIAL_FILTERS
      loadedCellsRef.current = new Set()
      tractMapRef.current = new Map()
      setTracts([])
      tractMarkersRef.current.forEach(m => m.remove())
      tractMarkersRef.current = []
      stateMarkersRef.current.forEach(m => m.remove())
      stateMarkersRef.current = []
      // Refetch tracts for current viewport
      const map = mapRef.current
      if (map) {
        setTimeout(() => {
          const bounds = map.getBounds()
          const south = bounds.getSouth()
          const north = bounds.getNorth()
          const west = bounds.getWest()
          const east = bounds.getEast()
          const cellSize = 0.5
          const startLat = Math.floor(south * 2) / 2
          const startLng = Math.floor(west * 2) / 2
          for (let lat = startLat; lat < north; lat += cellSize) {
            for (let lng = startLng; lng < east; lng += cellSize) {
              loadTractsForBounds({
                min_lat: Math.max(lat, south),
                max_lat: Math.min(lat + cellSize, north),
                min_lng: Math.max(lng, west),
                max_lng: Math.min(lng + cellSize, east),
              })
            }
          }
        }, 100)
      }
    }
  }, [resetFiltersSignal])

  // AI chat applied filters: ONE single wide query, no camera moves
  // up front, then snap-fit to whatever results actually came back.
  // Replaces the previous "zoom out → cell-load every 0.5° cell → fit"
  // dance, which fired hundreds of API calls and made the camera lurch
  // mid-search.
  useEffect(() => {
    if (!applyExternalFilters) return
    const { filters: incoming, clearUnspecified } = applyExternalFilters

    const base = clearUnspecified ? INITIAL_FILTERS : filtersRef.current
    const nextFilters = { ...base, ...incoming }
    setFilters(nextFilters)
    filtersRef.current = nextFilters

    // Clear current tract markers / cache so the new results render fresh
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    setTracts([])
    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []

    const map = mapRef.current
    if (!map) return

    // The user already pressed Send → chatSearchStartSignal fired and
    // the animation is already up. Just make sure the start time is set
    // (in case applyExternalFilters fires without a preceding start
    // signal, e.g. the "Clear search" button).
    if (!chatSearching) {
      chatSearchStartedAtRef.current = Date.now()
      setChatSearching(true)
    }

    // Pick the query bbox without moving the camera. State filter →
    // that state's bounds; otherwise continental US (capture matches
    // anywhere). The user's current viewport is irrelevant — we want
    // EVERY match, then we'll fit-to-results.
    const stateFit = (incoming as any).stateFilter as string | undefined
    let qbbox: [[number, number], [number, number]]
    if (stateFit && STATE_BOUNDS[stateFit]) {
      qbbox = STATE_BOUNDS[stateFit]
    } else {
      qbbox = [[-125, 24], [-66, 50]]
    }
    const [[qWest, qSouth], [qEast, qNorth]] = qbbox

    // Single wide-bbox query with the new filter set. limit=2000 caps
    // any single query — enough for almost any natural-language search.
    // include_polygons=true is required: isAcceptableMapTract rejects
    // any tract whose polygon_coordinates is null, and chat-search
    // pre-marks every cell in the queried bbox as "loaded" so the
    // cell-loader won't refetch. Without polygons here, every chat
    // result is silently dropped and the user sees zero pins — even
    // though the count badges (which come from a different endpoint)
    // claim matches exist.
    const filterParams = buildFilterParams(nextFilters)
    const extra = Object.entries(filterParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
    const url = `${API_URL}/api/map/tracts?min_lat=${qSouth}&max_lat=${qNorth}&min_lng=${qWest}&max_lng=${qEast}&limit=2000&include_polygons=true${extra ? '&' + extra : ''}`

    const ac = new AbortController()
    fetchWithAuth(url, { signal: ac.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: MapTractsResponse) => {
        const result = data.tracts || []
        // Apply the same accept-rules as the cell-loader so the chat path
        // doesn't accidentally render stale auctions, polygon-less tracts,
        // or anything else the cell-loader would have hidden. Without this
        // step, "Clear search" + a continental-US wide query renders
        // phantom dots from past auctions that vanish on refresh.
        const isUpcomingFilter = nextFilters.dateRange === 'upcoming'
        const now = new Date()
        const accepted: ApiMapTract[] = []
        for (const t of result) {
          if (t.id && isAcceptableMapTract(t, isUpcomingFilter, now)) {
            tractMapRef.current.set(t.id, t)
            accepted.push(t)
          }
        }
        setTracts(Array.from(tractMapRef.current.values()))

        // If the wide query wasn't capped, we have ALL matches — pre-mark
        // every 0.5° cell inside the queried bbox as loaded so the post-
        // fitBounds moveend doesn't waste round-trips re-fetching ground
        // we've already covered. If the query WAS capped (2000 rows),
        // there could be more matches we didn't see — leave cells
        // un-cached so the cell-loader can fill them in on demand.
        const CHAT_LIMIT = 2000
        if (result.length < CHAT_LIMIT) {
          const r = (v: number) => Math.round(v * 2) / 2
          const cellSize = 0.5
          const startLat = Math.floor(qSouth * 2) / 2
          const startLng = Math.floor(qWest * 2) / 2
          for (let lat = startLat; lat < qNorth; lat += cellSize) {
            for (let lng = startLng; lng < qEast; lng += cellSize) {
              const minLat = Math.max(lat, qSouth)
              const maxLat = Math.min(lat + cellSize, qNorth)
              const minLng = Math.max(lng, qWest)
              const maxLng = Math.min(lng + cellSize, qEast)
              const gridKey = `${r(minLat)},${r(minLng)},${r(maxLat)},${r(maxLng)}`
              loadedCellsRef.current.add(gridKey)
            }
          }
        }

        // Snap-fit camera to the bounding box of actual ACCEPTED results
        // (not raw API rows — those can include polygon-less tracts whose
        // lat/lng would skew the bbox).
        if (accepted.length > 0) {
          const lats: number[] = []
          const lngs: number[] = []
          for (const t of accepted) {
            if (typeof t.latitude === 'number' && typeof t.longitude === 'number') {
              lats.push(t.latitude); lngs.push(t.longitude)
            }
          }
          if (lats.length > 0) {
            let minLat = Math.min(...lats), maxLat = Math.max(...lats)
            let minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
            if (minLat === maxLat) { minLat -= 0.05; maxLat += 0.05 }
            if (minLng === maxLng) { minLng -= 0.05; maxLng += 0.05 }
            map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
              padding: 100, duration: 900, maxZoom: 12,
            })
          }
        }
      })
      .catch(e => { if (e.name !== 'AbortError') console.error('chat search load:', e) })
      .finally(() => { stopChatSearchingSoon() })

    return () => ac.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyExternalFilters?.nonce])

  // Zoom to location from parent (portal mode)
  useEffect(() => {
    if (zoomToLocation && mapRef.current) {
      mapRef.current.flyTo({
        center: [zoomToLocation.lng, zoomToLocation.lat],
        zoom: zoomToLocation.zoom,
        duration: 1500,
      })
    }
  }, [zoomToLocation])

  // Fit map to polygon bounds (e.g. when the user picks a listing or
  // tract from a slide-out pane). Computes the bbox client-side so we
  // never zoom past the polygon. `nonce` lets the same coords retrigger.
  useEffect(() => {
    if (!zoomToBoundsSignal?.coords?.length) return
    const map = mapRef.current
    if (!map) return
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    for (const [lng, lat] of zoomToBoundsSignal.coords) {
      if (typeof lng !== 'number' || typeof lat !== 'number') continue
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }
    if (!Number.isFinite(minLng)) return
    map.fitBounds(
      [[minLng, minLat], [maxLng, maxLat]],
      { padding: 80, duration: 1200, maxZoom: 16 },
    )
  }, [zoomToBoundsSignal?.nonce])

  const setFilterOpen = (open: boolean) => {
    setFilterOpenInternal(open)
    onFilterOpenChange?.(open)
  }

  // Selection / report state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedTracts, setSelectedTracts] = useState<SaleDetail[]>([])
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  // Fetch soil & elevation data when a tract is selected
  useEffect(() => {
    if (!selectedSale?.tractId) return
    setSoilData(null)
    setElevationData(null)
    setSoilLoading(true)

    Promise.all([
      fetchWithAuth(`${API_URL}/api/tracts/${selectedSale.tractId}/soil-data`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchWithAuth(`${API_URL}/api/tracts/${selectedSale.tractId}/elevation`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([soil, elevation]) => {
      if (soil) {
        setSoilData({
          map_units: soil.soil_map_units || [],
          avg_slope: soil.elevation_stats?.avg_slope_pct,
        })
      }
      if (elevation?.elevation_stats) {
        setElevationData({
          min_ft: elevation.elevation_stats.min_ft,
          max_ft: elevation.elevation_stats.max_ft,
          relief_ft: elevation.elevation_stats.relief_ft,
          avg_slope_pct: elevation.elevation_stats.avg_slope_pct,
        })
      }
      setSoilLoading(false)
    })
  }, [selectedSale?.tractId])

  const toggleSelection = (tract: SaleDetail) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(tract.id)) {
        next.delete(tract.id)
        setSelectedTracts(prev => prev.filter(t => t.id !== tract.id))
      } else {
        next.add(tract.id)
        setSelectedTracts(prev => [...prev, tract])
      }
      return next
    })
  }

  const handleEmailReport = async () => {
    setSendingEmail(true)
    try {
      const comparables = selectedTracts.map(t => ({
        county: t.county,
        state: t.state,
        tract_number: '—',
        total_acres: t.totalAcres?.toString() || '—',
        tillable_acres: t.tillableAcres?.toString() || null,
        pct_tillable: t.pctTillable?.toString() || null,
        soil_rating: t.soilRating?.toString() || null,
        price_per_acre: t.pricePerAcre?.toString() || null,
        price_per_tillable_acre: t.pricePerTillableAcre?.toString() || null,
        price_per_soil_rating: t.pricePerSoilRating?.toString() || null,
        sale_price: t.salePrice?.toString() || null,
        auction_datetime: t.auctionDate || null,
        company_name: t.companyName || null,
      }))
      const resp = await fetchWithAuth(`${API_URL}/api/comparables/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comparables }),
      })
      if (resp.ok) {
        setEmailSent(true)
        setTimeout(() => setEmailSent(false), 3000)
      }
    } catch (err) {
      console.error('Failed to email report:', err)
    } finally {
      setSendingEmail(false)
    }
  }

  const applyFilters = () => {
    filtersRef.current = filters
    // Clear cached data so it refetches with new filters
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    setTracts([])
    // Remove existing markers
    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []
    stateMarkersRef.current.forEach(m => m.remove())
    stateMarkersRef.current = []
    // Refetch current viewport
    const map = mapRef.current
    if (map) {
      const bounds = map.getBounds()
      loadTractsForBounds({
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lng: bounds.getWest(),
        max_lng: bounds.getEast(),
      })
    }
    setFilterOpen(false)
    onFiltersApplied?.({ stateFilter: filters.stateFilter, countyFilters: filters.countyFilters })
  }

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS)
    filtersRef.current = INITIAL_FILTERS
    // Clear cached data so it refetches without filters
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    setTracts([])
    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []
    stateMarkersRef.current.forEach(m => m.remove())
    stateMarkersRef.current = []
    const map = mapRef.current
    if (map) {
      const bounds = map.getBounds()
      loadTractsForBounds({
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lng: bounds.getWest(),
        max_lng: bounds.getEast(),
      })
    }
    setFilterOpen(false)
    onFiltersApplied?.({ stateFilter: '', countyFilters: [] })
  }

  const hasActiveFilters = filters.dateRange !== 'all' || filters.stateFilter !== '' ||
    filters.townshipFilters.length > 0 ||
    filters.soilRatingMin !== '' || filters.soilRatingMax !== '' ||
    filters.acreageMin !== '' || filters.acreageMax !== '' ||
    filters.pctTillableMin !== '' || filters.pctTillableMax !== '' ||
    filters.statuses.length > 0 ||
    filters.landTypes.length > 0 ||
    filters.listingType !== '' ||
    filters.pricePerAcreMin !== '' || filters.pricePerAcreMax !== '' ||
    filters.salePriceMin !== '' || filters.salePriceMax !== '' ||
    filters.askingPriceMin !== '' || filters.askingPriceMax !== '' ||
    filters.companyName !== '' || filters.buyer !== '' || filters.seller !== '' ||
    filters.hasHouse !== null || filters.hasBuildings !== null ||
    filters.hasPolygon !== null || filters.keyword !== ''

  const polygonGeoJSON = useMemo(() => {
    const fc = buildExplorePolygonGeoJSON(tracts)
    // Overlay the user's currently-pinned tract polygon (clicked from a
    // slide-out) regardless of whether it passed isAcceptableMapTract.
    // Some listings have tracts whose status would normally exclude them
    // from the upcoming/auctions filter (e.g. one tract already sold);
    // when the user explicitly clicks that tract, they expect to see the
    // boundary draw. We dedupe by id so we don't render twice if it's
    // already in the filtered set.
    if (pinnedTractPolygon?.coords && pinnedTractPolygon.coords.length >= 3) {
      const existingIds = new Set(
        fc.features.map((f: any) => f.properties?.tractId ?? f.id),
      )
      if (!existingIds.has(pinnedTractPolygon.id)) {
        const coords = [...pinnedTractPolygon.coords]
        const first = coords[0]
        const last = coords[coords.length - 1]
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push([first[0], first[1]])
        }
        ;(fc.features as any[]).push({
          type: 'Feature',
          id: pinnedTractPolygon.id,
          geometry: { type: 'Polygon', coordinates: [coords] },
          properties: {
            tractId: pinnedTractPolygon.id,
            status: 'pinned',
          },
        })
      }
    }
    return fc
  }, [tracts, pinnedTractPolygon])

  // Load tracts for a bounding box
  const CELL_LIMIT = 1000
  const loadTractsForBounds = useCallback(async (bounds: {
    min_lat: number; max_lat: number; min_lng: number; max_lng: number
  }) => {
    const { min_lat, max_lat, min_lng, max_lng } = bounds

    // Skip the tract API call if we're below the tract-pin zoom.
    // Tract pins / polygons don't render below z=9 (TRACT_TIER_MIN),
    // so loading them at state/county tier is wasted Railway compute,
    // wasted bandwidth, and a stalled "Loading…" affordance for data
    // the user can't see yet. 8.5 = small preload margin so the data
    // is already in the local cache the instant pins appear at z=9.
    const map = mapRef.current
    if (map && map.getZoom() < 8.5) return

    // Use precise bounds rounded to 0.5 degrees for cache keys
    const r = (v: number) => Math.round(v * 2) / 2
    const gridKey = `${r(min_lat)},${r(min_lng)},${r(max_lat)},${r(max_lng)}`
    // Already loaded with a complete (non-capped) result — skip.
    if (loadedCellsRef.current.has(gridKey)) return
    // Already in flight — skip duplicate concurrent fetch.
    if (loadingCellsRef.current.has(gridKey)) return
    loadingCellsRef.current.add(gridKey)

    // Did this fetch return a complete result? Only then do we mark the
    // cell as fully loaded. Failed fetches and capped results stay
    // un-cached so future moveends can retry. Without this, a transient
    // network error or a dense cell that hits the limit silently leaves
    // a region permanently empty on the map.
    let cellComplete = false
    try {
      setLoading(true)
      const filterParams = buildFilterParams(filtersRef.current)
      // In comparables mode, only show sold tracts
      if (subjectTractIdRef.current && !filterParams.sale_status) {
        filterParams.sale_status = 'sold'
      }
      const extraParams = Object.entries(filterParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      // Always request polygons — isAcceptableMapTract filters out tracts
      // without polygon_coordinates (used for centroid + boundary draws),
      // so omitting polygons would render an empty map. The earlier "skip
      // polygons at low zoom" optimization broke pin rendering and is
      // reverted; the real perf bottleneck is DB-side I/O contention,
      // not response size.
      const url = `${API_URL}/api/map/tracts?min_lat=${min_lat}&max_lat=${max_lat}&min_lng=${min_lng}&max_lng=${max_lng}&limit=${CELL_LIMIT}&include_polygons=true${extraParams ? '&' + extraParams : ''}`
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data: MapTractsResponse = await response.json()
        if (data.tracts) {
          // Cap detection: if we got exactly CELL_LIMIT rows, the bbox
          // probably has more matches we didn't see. Keep the cell
          // un-cached so a deeper zoom can re-query and pick them up.
          cellComplete = data.tracts.length < CELL_LIMIT
          const isUpcomingFilter = filtersRef.current.dateRange === 'upcoming'
          const now = new Date()
          for (const t of data.tracts) {
            if (isAcceptableMapTract(t, isUpcomingFilter, now)) {
              tractMapRef.current.set(t.id, t)
            }
          }
          setTracts(Array.from(tractMapRef.current.values()))
        }
      }
    } catch (err) {
      console.error('Failed to load map tracts:', err)
      // cellComplete stays false → cell will retry on next moveend.
    } finally {
      loadingCellsRef.current.delete(gridKey)
      if (cellComplete) loadedCellsRef.current.add(gridKey)
      setLoading(false)
    }
  }, [])

  // Handle map move — debounced viewport loading with sub-cell splitting
  const handleMoveEnd = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      const map = mapRef.current
      if (!map) return
      // While a chat search is in flight, skip cell loads — the chat
      // handler does ONE wide query and then snap-fits the camera. The
      // resulting fitBounds fires moveend, which would otherwise queue
      // up hundreds of redundant cell loads.
      if (chatSearchingRef.current) return
      const bounds = map.getBounds()
      const south = bounds.getSouth()
      const north = bounds.getNorth()
      const west = bounds.getWest()
      const east = bounds.getEast()

      // Split viewport into 0.5 degree cells (~35 miles) and load each
      const cellSize = 0.5
      const startLat = Math.floor(south * 2) / 2
      const startLng = Math.floor(west * 2) / 2
      for (let lat = startLat; lat < north; lat += cellSize) {
        for (let lng = startLng; lng < east; lng += cellSize) {
          loadTractsForBounds({
            min_lat: Math.max(lat, south),
            max_lat: Math.min(lat + cellSize, north),
            min_lng: Math.max(lng, west),
            max_lng: Math.min(lng + cellSize, east),
          })
        }
      }
    }, 500)
  }, [loadTractsForBounds])

  // Calculate initial center from home county or, falling back, the
  // home state's bbox center. Initial zoom is set to land in state
  // tier (z <= STATE_TIER_MAX) whenever a home state is known, so
  // the user opens the map already seeing their state's silhouette
  // badge instead of dropping into the tract tier.
  const initialCenter = useMemo((): [number, number] => {
    if (homeState && homeCounty) {
      const stateAbbr = STATE_ABBR[homeState] || homeState
      const key = `${homeCounty}, ${stateAbbr}`
      const centroid = countyCentroids[key]
      if (centroid) {
        return [centroid[1], centroid[0]] // [lng, lat] — countyCentroids stores [lat, lng]
      }
    }
    if (homeState) {
      const stateAbbr = STATE_ABBR[homeState] || homeState
      const bounds = STATE_BOUNDS[stateAbbr]
      if (bounds) {
        return [
          (bounds[0][0] + bounds[1][0]) / 2,
          (bounds[0][1] + bounds[1][1]) / 2,
        ]
      }
    }
    return MAP_CENTER
  }, [homeState, homeCounty])

  const initialZoom = homeState ? 5 : MAP_INITIAL_ZOOM

  // Initialize map
  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [TILE_URL],
            tileSize: 256,
            attribution: TILE_ATTRIBUTION,
          },
          'city-labels': {
            type: 'raster',
            tiles: [LABEL_TILE_URL],
            tileSize: 256,
          },
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19,
          },
          {
            id: 'city-label-tiles',
            type: 'raster',
            source: 'city-labels',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
        glyphs: GLYPH_URL,
      },
      center: initialCenter,
      zoom: initialZoom,
      maxZoom: 18,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      mapRef.current = map
      setMapLoaded(true)

      // Add county boundaries
      map.addSource('counties', {
        type: 'geojson',
        data: '/data/us-counties.json',
      })
      map.addLayer({
        id: 'county-borders',
        type: 'line',
        source: 'counties',
        paint: {
          'line-color': '#888888',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.1, 5, 0.3, 7, 0.6, 10, 1.0],
          'line-opacity': 0.35,
        },
      })

      // State boundaries
      map.addSource('states', {
        type: 'geojson',
        data: '/data/us-states.json',
      })
      map.addLayer({
        id: 'state-borders',
        type: 'line',
        source: 'states',
        paint: {
          'line-color': '#bbbbbb',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 5, 1.5, 7, 2.0, 10, 2.5],
          'line-opacity': 0.6,
        },
      })

      // County name labels
      map.addLayer({
        id: 'county-labels',
        type: 'symbol',
        source: 'counties',
        minzoom: 7,
        layout: {
          'text-field': ['get', 'NAME'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 10, 14],
          'text-anchor': 'center',
          'text-max-width': 8,
        },
        paint: {
          'text-color': '#555555',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
          'text-opacity': 0.75,
        },
      })

      // Initial load
      const bounds = map.getBounds()
      loadTractsForBounds({
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lng: bounds.getWest(),
        max_lng: bounds.getEast(),
      })
    })

    map.on('zoom', () => {
      setCurrentZoom(map.getZoom())
    })

    map.on('moveend', handleMoveEnd)

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      map.remove()
      mapRef.current = null
      setMapLoaded(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Add/update polygon source
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const polySource = map.getSource('tract-polygons') as maplibregl.GeoJSONSource
    if (polySource) {
      polySource.setData(polygonGeoJSON)
    } else {
      map.addSource('tract-polygons', {
        type: 'geojson',
        data: polygonGeoJSON,
      })
      // minzoom matches TRACT_TIER_MIN so polygon outlines only render
      // when tract pins do — at the state/county tiers there's no
      // benefit to drawing thousands of tiny pink squares behind the
      // badges, and it adds visual noise + paint cost for nothing.
      map.addLayer({
        id: 'tract-polygon-fill',
        type: 'fill',
        source: 'tract-polygons',
        minzoom: TRACT_TIER_MIN,
        paint: {
          'fill-color': '#E91E8C',
          // Bumped 0.08 → 0.20 per user 2026-05-15 — when zoomed in
          // far enough to see Regrid parcel borders, the tract pink
          // was barely visible against the black grid.
          'fill-opacity': 0.20,
        },
      })
      map.addLayer({
        id: 'tract-polygon-line',
        type: 'line',
        source: 'tract-polygons',
        minzoom: TRACT_TIER_MIN,
        paint: {
          'line-color': '#E91E8C',
          'line-width': 3,
          'line-opacity': 1.0,
        },
      })
      // Always push the tract polygon to the TOP of the layer stack
      // after creation, even if Regrid was added after us (its
      // beforeId guard misses when Regrid mounts first).
      if (map.getLayer('regrid-parcels-fill')) {
        map.moveLayer('tract-polygon-fill')
        map.moveLayer('tract-polygon-line')
      }
    }
  }, [mapLoaded, polygonGeoJSON])

  // Render neighboring parcels overlay
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    // map.getLayer dereferences map.style internally — guard against
    // a map that's mid-teardown (e.g. cross-route navigation racing
    // with this effect re-running).
    if (!map.getStyle()) return

    // Remove existing neighbor layers/source
    if (map.getLayer('neighbor-polygon-label')) map.removeLayer('neighbor-polygon-label')
    if (map.getLayer('neighbor-polygon-fill')) map.removeLayer('neighbor-polygon-fill')
    if (map.getLayer('neighbor-polygon-line')) map.removeLayer('neighbor-polygon-line')
    if (map.getSource('neighbor-parcels')) map.removeSource('neighbor-parcels')

    if (!neighborParcels || neighborParcels.length === 0) return

    // Build GeoJSON FeatureCollection. Owner and acres go in as separate
    // properties — the symbol layer's `format` expression composes them
    // into a two-line label at render time. Done this way (instead of a
    // pre-baked "Owner\nAcres" string) so we can style the acres line at a
    // smaller font scale and skip the second line entirely when acres is
    // missing without re-baking the source.
    const features = neighborParcels.map((p, i) => {
      const acresNum = typeof p.acres === 'number'
        ? p.acres
        : (p.acres != null ? Number(p.acres) : NaN)
      const acresStr = !isNaN(acresNum) && acresNum > 0
        ? `${acresNum.toFixed(1)} ac`
        : ''
      const ownerStr = (p.owner || 'Coming Soon').trim()
      return {
        type: 'Feature' as const,
        properties: {
          owner: ownerStr,
          acres_str: acresStr,
          county: p.county || '',
          state: p.state || '',
          township: p.township || '',
          source: p.source || '',
          index: i,
        },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [p.geometry],
        },
      }
    })

    map.addSource('neighbor-parcels', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    })

    // Fill: ambient 8% so the parcel grid reads at a glance, but light
    // enough that the imagery still shines through. Hover bumps to brand
    // pink at 25% so the active parcel "lights up" against the blue.
    map.addLayer({
      id: 'neighbor-polygon-fill',
      type: 'fill',
      source: 'neighbor-parcels',
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          '#E91E8C',
          '#60A5FA',
        ],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          0.25,
          0.08,
        ],
      },
    })

    // Outline: solid (not dashed — dashes read as "tentative"). Lighter
    // blue-400 so it sits comfortably on green/brown aerial without
    // tinting the whole scene cyan.
    map.addLayer({
      id: 'neighbor-polygon-line',
      type: 'line',
      source: 'neighbor-parcels',
      paint: {
        'line-color': '#60A5FA',
        'line-width': 1.5,
        'line-opacity': 0.85,
      },
    })

    // Always-on owner + acres label. MapLibre auto-places the label at
    // the polygon's pole-of-inaccessibility (most-interior point), which
    // beats the geometric centroid for L- and U-shaped parcels.
    // `text-allow-overlap: false` lets MapLibre drop labels that would
    // collide so the map stays readable when zoomed out. Min zoom 11 so
    // we don't paint a wall of names at the lowest zoom levels.
    map.addLayer({
      id: 'neighbor-polygon-label',
      type: 'symbol',
      source: 'neighbor-parcels',
      minzoom: 11,
      layout: {
        // Two-line owner + acres label, explicitly composed via `format`.
        // The acres section drops out (zero-length string) when no acreage
        // came back from Regrid — single-line owner only in that case. The
        // acres line renders at 0.85× scale so the owner stays the visual
        // anchor. Empty-string `format` sections render nothing, including
        // the leading newline.
        'text-field': [
          'format',
          ['get', 'owner'], { 'font-scale': 1.0 },
          [
            'case',
            ['>', ['length', ['coalesce', ['get', 'acres_str'], '']], 0],
            ['concat', '\n', ['get', 'acres_str']],
            '',
          ],
          { 'font-scale': 0.85 },
        ],
        'text-font': ['Open Sans Regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          11, 10,
          14, 12,
          17, 14,
        ],
        'text-anchor': 'center',
        'text-justify': 'center',
        'text-max-width': 9,
        'text-line-height': 1.15,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 2,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4,
      },
    })

    // Hover popup for neighbor parcels
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'neighbor-popup',
    })

    const onMouseMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const props = e.features[0].properties
      map.getCanvas().style.cursor = 'pointer'
      // Attribution: Regrid TOS requires crediting them when their data is
      // displayed. We only show it when the parcel actually came from Regrid
      // (either a live call or a cached Regrid row).
      const src = (props.source || '').toString()
      const attribution = src.includes('regrid')
        ? `<div style="color:#9ca3af;font-size:10px;margin-top:6px;padding-top:6px;border-top:1px solid #e5e7eb;">Parcel data by <a href="https://regrid.com" target="_blank" rel="noopener noreferrer" style="color:#6b7280;text-decoration:underline;">Regrid</a></div>`
        : ''
      // Popup content: owner, acres, plus county and township when
      // available (nice-to-have — they often won't be populated for
      // parcels coming from local cache rather than a live Regrid call).
      const rows: string[] = []
      if (props.acres) rows.push(`<div style="color:#6b7280;">${props.acres} ac</div>`)
      if (props.county) {
        const cs = `${props.county} County${props.state ? `, ${props.state}` : ''}`
        rows.push(`<div style="color:#6b7280;">${cs}</div>`)
      }
      if (props.township) {
        const tw = /township/i.test(props.township) ? props.township : `${props.township} Township`
        rows.push(`<div style="color:#6b7280;">${tw}</div>`)
      }

      popup
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-size:12px;color:#111;background:#fff;padding:10px 14px;border-radius:10px;min-width:160px;max-width:240px;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
            <div style="font-weight:600;margin-bottom:4px;">${props.owner}</div>
            ${rows.join('')}
            ${attribution}
          </div>
        `)
        .addTo(map)
    }

    const onMouseLeave = () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    }

    map.on('mousemove', 'neighbor-polygon-fill', onMouseMove)
    map.on('mouseleave', 'neighbor-polygon-fill', onMouseLeave)

    return () => {
      map.off('mousemove', 'neighbor-polygon-fill', onMouseMove)
      map.off('mouseleave', 'neighbor-polygon-fill', onMouseLeave)
      popup.remove()
    }
  }, [mapLoaded, neighborParcels])

  // ─────────────────────────────────────────────────────────────────
  // Admin parcel overlay — vector tiles via pmtiles.
  //
  // For each state that has a .pmtiles archive on the tile server we
  // add a vector source + 3 layers (fill / line / owner+acres label).
  // MapLibre + the pmtiles JS library handle everything else: the
  // browser fetches just the tiles in view via HTTP range requests,
  // caches them, and renders. No fetch loop, no GeoJSON, no flash.
  //
  // We register the pmtiles protocol once per page (via a module-level
  // ref) since maplibregl.addProtocol is global. Re-registering would
  // throw.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!isAdmin || !adminParcelOverlay) return
    if (adminParcelStates.length === 0) return

    // Register pmtiles protocol once. Stash on window so a remount
    // after a hot-reload doesn't try to re-register and throw.
    const w = window as any
    if (!w.__ggPmtilesRegistered) {
      maplibregl.addProtocol('pmtiles', new PMTilesProtocol().tile as any)
      w.__ggPmtilesRegistered = true
    }

    const sourceIds: string[] = []
    const layerIds: string[] = []
    const popup = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, className: 'neighbor-popup',
    })
    let hoveredKey: string | null = null  // 'WI:1234' style, source+id

    for (const st of adminParcelStates) {
      const sourceId = `admin-parcels-${st}`
      const fillId = `admin-parcel-fill-${st}`
      const lineId = `admin-parcel-line-${st}`
      const labelId = `admin-parcel-label-${st}`

      map.addSource(sourceId, {
        type: 'vector',
        url: `pmtiles://${TILES_BASE_URL}/tiles/${st}.pmtiles`,
        promoteId: { parcels: 'id' },
      } as any)
      sourceIds.push(sourceId)

      map.addLayer({
        id: fillId,
        type: 'fill',
        source: sourceId,
        'source-layer': 'parcels',
        minzoom: ADMIN_PARCEL_MIN_ZOOM,
        paint: {
          'fill-color': '#EC4899',  // brand pink-500
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.22,
            0.06,
          ],
        },
      })
      layerIds.push(fillId)

      map.addLayer({
        id: lineId,
        type: 'line',
        source: sourceId,
        'source-layer': 'parcels',
        minzoom: ADMIN_PARCEL_MIN_ZOOM,
        paint: {
          'line-color': '#000000',
          'line-width': 2.2,
          'line-opacity': 0.85,
        },
      })
      layerIds.push(lineId)

      map.addLayer({
        id: labelId,
        type: 'symbol',
        source: sourceId,
        'source-layer': 'parcels',
        minzoom: ADMIN_PARCEL_MIN_ZOOM,
        layout: {
          'text-field': [
            'format',
            // Owner name (bold, full size). Parcels without an
            // owner_name in state_parcels fall back to "Coming Soon"
            // so the label communicates "we know about this parcel,
            // we just don't have the owner yet" instead of an empty
            // tile.
            ['coalesce', ['get', 'owner'], 'Coming Soon'], {
              'font-scale': 1.0,
              'text-font': ['literal', ['Open Sans Bold']],
            },
            // Acres on its own line below the owner. Always shown
            // when present (matches user expectation: "I want acres
            // to show directly on the map under the owner name").
            [
              'case',
              ['has', 'acres'],
              [
                'concat',
                '\n',
                ['concat', ['number-format', ['get', 'acres'], { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }], ' ac'],
              ],
              '',
            ],
            { 'font-scale': 0.85 },
          ],
          'text-font': ['Open Sans Regular'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            13, 10,
            15, 12,
            17, 14,
          ],
          'text-anchor': 'center',
          'text-justify': 'center',
          'text-max-width': 9,
          'text-line-height': 1.15,
          'text-allow-overlap': false,
          'text-ignore-placement': false,
          'text-padding': 2,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.4,
          'text-halo-blur': 0.4,
        },
      })
      layerIds.push(labelId)
    }

    // Hover handlers — bind to every state's fill layer at once.
    // The popup always shows when a feature is under the cursor; the
    // hover-color fill only kicks in when the feature has an id we
    // can target with setFeatureState. (MVT features sometimes come
    // through without an id — promoteId on the source helps but isn't
    // a guarantee, so we treat hover-color as best-effort.)
    const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const f = e.features[0]
      const props: any = f.properties || {}
      const fid = (f as any).id
      const sid = (f as any).source as string | undefined
      map.getCanvas().style.cursor = 'pointer'

      // Hover fill color (best-effort — only works when fid + sid are
      // both available and stable across pans).
      if (sid && fid != null) {
        const key = `${sid}:${fid}`
        if (hoveredKey && hoveredKey !== key) {
          const [prevSid, prevIdStr] = hoveredKey.split(':')
          map.setFeatureState(
            { source: prevSid, sourceLayer: 'parcels', id: prevIdStr },
            { hover: false },
          )
        }
        hoveredKey = key
        map.setFeatureState(
          { source: sid, sourceLayer: 'parcels', id: fid },
          { hover: true },
        )
      }

      // Popup: owner, acres, plus county and township when available.
      // No owner_2 or PID — those add noise. County/township are
      // nice-to-haves: render only if the tile actually carries them.
      const owner = props.owner || 'Coming Soon'
      const rows: string[] = []
      if (props.acres != null) rows.push(`<div style="color:#6b7280;">${Number(props.acres).toFixed(2)} ac</div>`)
      if (props.county) {
        const cs = `${props.county} County${props.state ? `, ${props.state}` : ''}`
        rows.push(`<div style="color:#6b7280;">${cs}</div>`)
      }
      if (props.township) {
        const tw = /township/i.test(props.township) ? props.township : `${props.township} Township`
        rows.push(`<div style="color:#6b7280;">${tw}</div>`)
      }

      popup
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="font-size:12px;color:#111;background:#fff;padding:10px 14px;border-radius:10px;min-width:160px;max-width:260px;box-shadow:0 4px 12px rgba(0,0,0,0.15);">
            <div style="font-weight:600;margin-bottom:4px;">${owner}</div>
            ${rows.join('')}
          </div>
        `)
        .addTo(map)
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      if (hoveredKey) {
        const [prevSid, prevIdStr] = hoveredKey.split(':')
        map.setFeatureState(
          { source: prevSid, sourceLayer: 'parcels', id: prevIdStr },
          { hover: false },
        )
        hoveredKey = null
      }
      popup.remove()
    }
    const fillLayerIds = adminParcelStates.map(s => `admin-parcel-fill-${s}`)
    for (const id of fillLayerIds) {
      map.on('mousemove', id, onMove)
      map.on('mouseleave', id, onLeave)
    }

    return () => {
      // Cleanup is best-effort. If the map is mid-teardown, getLayer
      // dereferences a now-undefined .style and throws — bubbling that
      // up unmounts the whole route tree and shows Next.js's red error
      // page. Wrap in try/catch + an early style check.
      try {
        if (!map.getStyle()) return
        for (const id of fillLayerIds) {
          map.off('mousemove', id, onMove)
          map.off('mouseleave', id, onLeave)
        }
        popup.remove()
        for (const id of layerIds) {
          if (map.getLayer(id)) map.removeLayer(id)
        }
        for (const id of sourceIds) {
          if (map.getSource(id)) map.removeSource(id)
        }
      } catch (err) {
        // map already torn down — nothing to clean up.
      }
    }
  }, [mapLoaded, isAdmin, adminParcelOverlay, adminParcelStates, TILES_BASE_URL])

  // ─────────────────────────────────────────────────────────────────
  // Regrid nationwide parcels — vector tiles from tiles.regrid.com.
  //
  // Replaces the per-state pmtiles overlay for all logged-in users:
  // boundaries, owner name, and acreage labels render at zoom ≥ 14
  // (REGRID_MIN_ZOOM) for every parcel in the country. Clicking a
  // parcel pops a panel with the full Premium Schema record from our
  // /api/regrid/parcel cache.
  //
  // Cost-shape:
  //  - Vector tiles: cheap (~$0.00075 each pre-paid), MapLibre caches
  //    them client-side so panning is mostly free.
  //  - Record fetches on click: expensive (~$0.1125 each pre-paid) —
  //    handled by the backend cache so repeat clicks within 30 days
  //    are free.
  //
  // The tile URL template (with token baked in) comes from the
  // /api/regrid/config endpoint; we fetch it on map mount so the
  // token never appears in the frontend bundle.
  // ─────────────────────────────────────────────────────────────────
  // Bumped down 14 → 12 per user 2026-05-18 — previously parcels
  // didn't appear until the user was nearly fully zoomed in. Regrid's
  // CDN serves real data at z=11+ (z=12 tiles are ~130KB vs ~8KB at
  // z=14, so heavier but still well within budget for a single view).
  // If this becomes too slow at scale, raise back to 13.
  const REGRID_MIN_ZOOM = 12
  const [regridConfig, setRegridConfig] = useState<{
    tile_url_template: string
    // Custom-source tiles name their MVT layer with the source UUID;
    // default tile uses 'parcels'. Optional so older backend responses
    // (without this field) still type-check.
    source_layer?: string
    is_sandbox: boolean
    has_token: boolean
    attribution: string
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchConfig = async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/regrid/config`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data?.tile_url_template && data?.has_token) {
          setRegridConfig(data)
        }
      } catch {
        // Silent — Regrid is enrichment. The map still works without it.
      }
    }
    fetchConfig()
    return () => { cancelled = true }
  }, [])

  // Register the Regrid source + layers when both the map and the
  // config are ready. Tear down on unmount.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !regridConfig?.tile_url_template) return

    const SOURCE_ID = 'regrid-parcels'
    const FILL_LAYER = 'regrid-parcels-fill'
    const LINE_LAYER = 'regrid-parcels-line'
    const LABEL_LAYER = 'regrid-parcels-label'

    if (map.getSource(SOURCE_ID)) return

    // Custom Regrid sources name their internal MVT layer after the
    // source UUID (not 'parcels' like the default endpoint). Backend
    // ships the actual name in regridConfig.source_layer; fall back
    // to 'parcels' for the legacy default tile path.
    const sourceLayer = regridConfig.source_layer || 'parcels'

    map.addSource(SOURCE_ID, {
      type: 'vector',
      tiles: [regridConfig.tile_url_template],
      minzoom: REGRID_MIN_ZOOM,
      maxzoom: 21,
      // ll_uuid is the stable Regrid parcel UUID we want to use for
      // setFeatureState (hover highlight) and click → API lookup.
      promoteId: { [sourceLayer]: 'll_uuid' },
      // Required attribution per Schedule A §7. Surfaces in the
      // built-in attribution control at the bottom of the map.
      attribution: 'Parcel data &copy; <a href="https://regrid.com" target="_blank" rel="noopener">Regrid</a>',
    } as any)

    // Insert Regrid BELOW the existing tract polygons (the auction /
    // sold listings) so those remain visually on top — per product
    // requirement. If the tract-polygon layer isn't present yet (it
    // mounts lazily when bounds tracts arrive), we fall back to
    // appending at the top of the stack and it'll get the right order
    // on the next re-render of either effect.
    const beforeId = map.getLayer('tract-polygon-fill') ? 'tract-polygon-fill' : undefined

    // Fill: nearly-invisible, exists purely so clicks register on the
    // parcel polygon. State_parcels uses pink @ 6%; we'll match.
    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': sourceLayer,
      minzoom: REGRID_MIN_ZOOM,
      paint: {
        'fill-color': '#EC4899',
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], 0.22,
          0.06,
        ],
      },
    }, beforeId)

    // Boundary lines — match the state_parcel look exactly: solid
    // black, slightly thicker than 1px so they read at all zooms.
    map.addLayer({
      id: LINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      'source-layer': sourceLayer,
      minzoom: REGRID_MIN_ZOOM,
      paint: {
        'line-color': '#000000',
        'line-width': 2.2,
        'line-opacity': 0.85,
      },
    }, beforeId)

    // Owner + acres label — same composition as state_parcels: owner
    // bold on top, acres in smaller text below, white text with a
    // black halo so it reads on both satellite and street basemaps.
    map.addLayer({
      id: LABEL_LAYER,
      type: 'symbol',
      source: SOURCE_ID,
      'source-layer': sourceLayer,
      minzoom: REGRID_MIN_ZOOM,
      layout: {
        // Four segments: owner (bold) → acres → $/acre → sale date.
        // Total sale price was removed 2026-05-26 — the per-acre
        // figure is what buyers compare on. Each conditional segment
        // evaluates to '' when its underlying property is missing so
        // a parcel without sale data shows just owner + acres.
        // All non-owner rows are 1.0 scale (bumped from 0.85) so the
        // numbers are legible at browse zoom.
        'text-field': [
          'format',
          ['coalesce', ['get', 'owner'], 'Coming Soon'], {
            'font-scale': 1.0,
            'text-font': ['literal', ['Open Sans Bold']],
          },
          [
            'case',
            ['has', 'll_gisacre'],
            ['concat', '\n', ['concat',
              ['number-format', ['get', 'll_gisacre'], {
                'locale': 'en-US',
                'min-fraction-digits': 0, 'max-fraction-digits': 2,
              }],
              ' ac',
            ]],
            ['case',
              ['has', 'gisacre'],
              ['concat', '\n', ['concat',
                ['number-format', ['get', 'gisacre'], {
                  'locale': 'en-US',
                  'min-fraction-digits': 0, 'max-fraction-digits': 2,
                }],
                ' ac',
              ]],
              '',
            ],
          ],
          { 'font-scale': 1.0 },
          // Price per acre — saleprice / acres when both > 0. Guard
          // against divide-by-zero on the denominator.
          ['case',
            ['all',
              ['has', 'saleprice'],
              ['>', ['to-number', ['get', 'saleprice']], 0],
              ['any', ['has', 'll_gisacre'], ['has', 'gisacre']],
              ['>', ['to-number', ['coalesce', ['get', 'll_gisacre'], ['get', 'gisacre']]], 0],
            ],
            ['concat', '\n$/Acre: $',
              ['number-format',
                // Round the divide before formatting so we never
                // surface decimals like "$370,692.152". max-fraction-
                // digits=0 was already in place, but in practice some
                // upstream values produce a sub-cent residue that
                // number-format rounds inconsistently — round() ahead
                // of time makes the integer floor explicit.
                ['round', ['/',
                  ['to-number', ['get', 'saleprice']],
                  ['to-number', ['coalesce', ['get', 'll_gisacre'], ['get', 'gisacre']]],
                ]],
                {
                  'locale': 'en-US',
                  'min-fraction-digits': 0,
                  'max-fraction-digits': 0,
                },
              ],
            ],
            '',
          ],
          { 'font-scale': 1.0 },
          // Sale date — custom tile returns ISO datetime; first 10
          // chars are YYYY-MM-DD either way. length >= 10 guard
          // prevents "//" output on malformed values.
          ['case',
            ['all',
              ['has', 'saledate'],
              ['>=', ['length', ['get', 'saledate']], 10],
            ],
            ['concat', '\nSale Date: ',
              ['slice', ['get', 'saledate'], 5, 7], '/',
              ['slice', ['get', 'saledate'], 8, 10], '/',
              ['slice', ['get', 'saledate'], 0, 4],
            ],
            '',
          ],
          { 'font-scale': 1.0 },
        ],
        'text-font': ['Open Sans Regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          14, 10,
          16, 12,
          18, 14,
        ],
        // Anchor label at its TOP edge so the multi-line block sits
        // BELOW the polygon centroid. The pin (parcel-sale-pin layers
        // mounted in a separate effect) is placed AT the centroid
        // with no translate. Result: pin always lands inside the
        // parcel it represents, label appears just below the pin.
        // Earlier 42px upward translate on the pin caused it to drift
        // onto adjacent parcels for small lots.
        'text-anchor': 'top',
        'text-justify': 'center',
        'text-offset': [0, 1.6],
        'text-max-width': 9,
        'text-line-height': 1.15,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 2,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4,
      },
    }, beforeId)

    // Push tract polygons to the TOP of the layer stack — if Regrid
    // arrived after tract-polygon-* mounted, beforeId above missed
    // and Regrid landed on top. moveLayer (no second arg) lifts the
    // tract layers above everything.
    if (map.getLayer('tract-polygon-fill')) map.moveLayer('tract-polygon-fill')
    if (map.getLayer('tract-polygon-line')) map.moveLayer('tract-polygon-line')

    // Hover highlight — track which feature is under the cursor so
    // the fill brightens on hover. ll_uuid promotion above means
    // setFeatureState targets the parcel reliably even across tiles.
    let hoveredUuid: string | null = null
    const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      map.getCanvas().style.cursor = 'pointer'
      const newUuid = (e.features[0].properties as any)?.ll_uuid as string | undefined
      if (!newUuid || newUuid === hoveredUuid) return
      if (hoveredUuid) {
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer: sourceLayer, id: hoveredUuid },
          { hover: false },
        )
      }
      hoveredUuid = newUuid
      map.setFeatureState(
        { source: SOURCE_ID, sourceLayer: sourceLayer, id: hoveredUuid },
        { hover: true },
      )
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      if (hoveredUuid) {
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer: sourceLayer, id: hoveredUuid },
          { hover: false },
        )
        hoveredUuid = null
      }
    }

    // Click — fetch the full Premium Schema record from our backend
    // cache (which calls Regrid only on cache miss) and open a popup.
    const onClick = async (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (!f) return
      const props: any = f.properties || {}
      const ll_uuid = props.ll_uuid as string | undefined
      const lng = e.lngLat.lng
      const lat = e.lngLat.lat

      // Loading popup so the user sees immediate feedback.
      const popup = new maplibregl.Popup({
        closeButton: true, closeOnClick: true, maxWidth: '320px',
        className: 'regrid-parcel-popup',
      })
        .setLngLat(e.lngLat)
        .setHTML(_regridLoadingHTML(props))
        .addTo(map)

      try {
        const qs = new URLSearchParams()
        if (ll_uuid) qs.set('ll_uuid', ll_uuid)
        else { qs.set('lat', String(lat)); qs.set('lng', String(lng)) }
        const res = await fetchWithAuth(`${API_URL}/api/regrid/parcel?${qs.toString()}`)
        if (!res.ok) {
          popup.setHTML(_regridFallbackHTML(props))
          return
        }
        const data = await res.json()
        popup.setHTML(_regridPopupHTML(data?.parcel || props))
      } catch {
        popup.setHTML(_regridFallbackHTML(props))
      }
    }

    map.on('mousemove', FILL_LAYER, onMove)
    map.on('mouseleave', FILL_LAYER, onLeave)
    map.on('click', FILL_LAYER, onClick)

    return () => {
      try {
        if (!map.getStyle()) return
        map.off('mousemove', FILL_LAYER, onMove)
        map.off('mouseleave', FILL_LAYER, onLeave)
        map.off('click', FILL_LAYER, onClick)
        for (const id of [LABEL_LAYER, LINE_LAYER, FILL_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id)
        }
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
      } catch {
        // map already torn down
      }
    }
  }, [mapLoaded, regridConfig])

  // ─────────────────────────────────────────────────────────────────
  // Parcel-with-sale dots. Pink "+" pin over every Regrid parcel in
  // the USA where the vector tile reports saleprice > 0 AND the parcel
  // is ≥ 20 acres. NO API calls — we read straight off the same Regrid
  // vector source we already loaded for the parcel boundary layer.
  // Coverage = every parcel in Regrid's nationwide dataset.
  //
  // The 20-acre floor uses ll_gisacre (Regrid's "land-legal" acreage)
  // with gisacre as a fallback — same field-precedence the label layer
  // above uses.
  // ─────────────────────────────────────────────────────────────────
  const PARCEL_SALE_BG_LAYER = 'parcel-sale-pin-bg'
  const PARCEL_SALE_PLUS_LAYER = 'parcel-sale-pin-plus'
  const PARCEL_MIN_SALE_ACRES = 20
  // Feature flag — the parcel-sale-pin layers (pink dot + white "+")
  // are disabled per user 2026-05-26 until the placement is right.
  // Pins were appearing in the wrong locations relative to their
  // parcels. Labels (owner / acres / $/acre / sale date) on the
  // boundary layer already convey the sale info, so disabling the
  // pins is a clean removal — re-enable by flipping this flag once
  // we've figured out reliable per-parcel placement.
  const REGRID_SALE_PINS_ENABLED = false

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !regridConfig?.tile_url_template) return
    if (!REGRID_SALE_PINS_ENABLED) return

    // The Regrid source itself is added by the layer-mount effect
    // above. We piggyback on it — but the source might not exist yet
    // (its effect runs on the same render). Wait one tick if missing.
    let timer: any = null
    const REGRID_SOURCE = 'regrid-parcels'
    // Same source_layer plumbing as the boundary-layer mount above —
    // custom Regrid tiles name the layer with the source UUID
    // instead of 'parcels'.
    const sourceLayer = regridConfig.source_layer || 'parcels'

    const mount = () => {
      if (!map.getSource(REGRID_SOURCE)) {
        timer = setTimeout(mount, 50)
        return
      }
      // saleprice > 0 AND (ll_gisacre >= 20 OR gisacre >= 20), with
      // an optional saledate window from the user's timeframe filter.
      // The expression is computed against the LIVE filter state (not
      // the captured render-time value) so that if the user already had
      // a filter applied when the map mounted, the layers come up with
      // the right expression. A separate effect below keeps both
      // layers in sync as the filter changes.
      const filterExpr: any = buildRegridSaleDotFilter(filtersRef.current, PARCEL_MIN_SALE_ACRES)

      // Pin sits AT the polygon centroid (no translate). The LABEL
      // is anchored 'top' + text-offset 1.6em so it grows DOWN from
      // the centroid, leaving the pin visible directly above the
      // label. Earlier we lifted the pin -42px which pushed it onto
      // neighboring parcels for any lot smaller than ~80px tall —
      // i.e. most 20-acre parcels at z=14. Keeping the pin at the
      // centroid guarantees it stays inside the parcel it
      // represents, no matter how small the lot.
      if (!map.getLayer(PARCEL_SALE_BG_LAYER)) {
        map.addLayer({
          id: PARCEL_SALE_BG_LAYER,
          type: 'circle',
          source: REGRID_SOURCE,
          'source-layer': sourceLayer,
          minzoom: REGRID_MIN_ZOOM,
          filter: filterExpr,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 8, 16, 14],
            'circle-color': '#f58cde',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        })
      }
      if (!map.getLayer(PARCEL_SALE_PLUS_LAYER)) {
        map.addLayer({
          id: PARCEL_SALE_PLUS_LAYER,
          type: 'symbol',
          source: REGRID_SOURCE,
          'source-layer': sourceLayer,
          minzoom: REGRID_MIN_ZOOM,
          filter: filterExpr,
          layout: {
            'text-field': '+',
            'text-font': ['Open Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 13, 16, 19],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
          },
          paint: {
            'text-color': '#ffffff',
          },
        })
      }
    }
    mount()

    // Click — show a popup with whatever sale info Regrid embedded in
    // the tile properties. No backend round-trip needed; if the user
    // wants the full Premium record they can still click the parcel
    // boundary which opens the existing detail popup.
    const onPinClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (!f) return
      const props: any = f.properties || {}
      const acres = props.ll_gisacre ?? props.gisacre ?? null
      new maplibregl.Popup({ closeButton: true, closeOnClick: true, maxWidth: '300px' })
        .setLngLat(e.lngLat)
        .setHTML(_parcelSalePopupHTML({
          sale_price: props.saleprice ? Number(props.saleprice) : null,
          sale_date: props.saledate || null,
          total_acres: acres ? Number(acres) : null,
          price_per_acre: (props.saleprice && acres && Number(acres) > 0)
            ? Number(props.saleprice) / Number(acres)
            : null,
          owner: props.owner || null,
          address: props.address || null,
          county: props.county || null,
          state: props.state || null,
        }))
        .addTo(map)
    }
    const setPointer = () => { map.getCanvas().style.cursor = 'pointer' }
    const clearPointer = () => { map.getCanvas().style.cursor = '' }
    map.on('mouseenter', PARCEL_SALE_BG_LAYER, setPointer)
    map.on('mouseleave', PARCEL_SALE_BG_LAYER, clearPointer)
    map.on('click', PARCEL_SALE_BG_LAYER, onPinClick)
    map.on('click', PARCEL_SALE_PLUS_LAYER, onPinClick)

    return () => {
      if (timer) clearTimeout(timer)
      try {
        if (!map.getStyle()) return
        map.off('mouseenter', PARCEL_SALE_BG_LAYER, setPointer)
        map.off('mouseleave', PARCEL_SALE_BG_LAYER, clearPointer)
        map.off('click', PARCEL_SALE_BG_LAYER, onPinClick)
        map.off('click', PARCEL_SALE_PLUS_LAYER, onPinClick)
        for (const id of [PARCEL_SALE_PLUS_LAYER, PARCEL_SALE_BG_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id)
        }
      } catch {/* map already torn down */}
    }
  }, [mapLoaded, regridConfig])

  // Keep the Regrid sale-pin layers' filter in sync with the timeframe
  // preset. Without this, the pink + dots showed every historical sale
  // forever — even when the user picked "Last 6 months" — because the
  // maplibre filter is set at addLayer() time and isn't reactive.
  useEffect(() => {
    if (!REGRID_SALE_PINS_ENABLED) return
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const expr = buildRegridSaleDotFilter(filters, PARCEL_MIN_SALE_ACRES)
    for (const id of [PARCEL_SALE_BG_LAYER, PARCEL_SALE_PLUS_LAYER]) {
      if (map.getLayer(id)) {
        try { map.setFilter(id, expr as any) } catch {/* layer torn down */}
      }
    }
  }, [mapLoaded, filters.dateRange, filters.dateFrom, filters.dateTo, filters.salePriceMin, filters.salePriceMax])

  // Create/update HTML markers for tracts
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Remove old tract markers
    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []
    tractMarkerElementsRef.current.clear()

    // Helper: polygon centroid
    const getPolygonCentroid = (coords: [number, number][]): [number, number] | null => {
      if (!coords || coords.length < 3) return null
      let sumLng = 0, sumLat = 0
      for (const [lng, lat] of coords) {
        sumLng += lng
        sumLat += lat
      }
      return [sumLng / coords.length, sumLat / coords.length]
    }

    // Track co-located tracts for offset spacing
    const coordCounts: Record<string, number> = {}

    for (const tract of tracts) {
      // Skip tracts already rendered by the always-on today-auctions
      // GPU layer — duplicates would just stack on top of those dots.
      if (todayTractsByIdRef.current.has(tract.id)) continue

      // In comp mode, the subject tract has its own dedicated marker
      // (rendered separately below). Skip it here so we don't stack
      // a "+" button on top of the subject highlight — and so the
      // subject can't be Add-to-Report'd via this loop's click path.
      if (subjectTractIdRef.current && tract.id === subjectTractIdRef.current) continue

      // Get marker position
      let markerLng = tract.longitude
      let markerLat = tract.latitude
      if (tract.polygon_coordinates && tract.polygon_coordinates.length > 2) {
        const centroid = getPolygonCentroid(tract.polygon_coordinates)
        if (centroid) {
          markerLng = centroid[0]
          markerLat = centroid[1]
        }
      }
      if (!markerLat || !markerLng) continue

      // Offset co-located tracts so they don't stack
      const coordKey = `${markerLat.toFixed(4)},${markerLng.toFixed(4)}`
      const index = coordCounts[coordKey] || 0
      coordCounts[coordKey] = index + 1
      if (index > 0) {
        const offset = 0.003
        const angle = index * (2 * Math.PI / 6)
        markerLng += offset * Math.cos(angle)
        markerLat += offset * Math.sin(angle)
      }

      // Display price-per-acre rule: private-treaty (status='listed') and
      // pending auctions show asking_price/total_acres. Sold tracts show
      // their recorded price_per_acre. Falls back to whichever is set.
      const isPrivateTreaty = (tract.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = (tract.sale_status || '').toLowerCase() === 'pending'
      const markerPpa = (isPrivateTreaty || isPending) && tract.asking_price && tract.total_acres
        ? tract.asking_price / tract.total_acres
        : tract.price_per_acre

      // "Auctioning today" — green pin + pulsing ring + top-of-stack z-order.
      // Replaces the older listing_status === 'live' rule so the prominent
      // visual treatment reflects WHEN the auction is, not the realtime
      // status flag (which was noisy).
      const isAuctionToday = isAuctionDateToday(tract.auction_date)

      // In comparables mode (subjectTractId set), render every comparable
      // tract as a "+" button instead of the regular labeled pin so
      // admin can scan the area and click in for sale details.
      const inCompMode = !!subjectTractIdRef.current
      const el = createMarkerElement(
        markerPpa,
        tract.total_acres,
        tract.sale_status,
        isAuctionToday,
        inCompMode,
      )

      // Z-order by status: live (today) > auction > sold > no_sale > listed.
      // The live tier is set to a very high z so the pulse sits above the
      // state + county badges and any other pin.
      // Stashed in a dataset so the report-highlight effect can restore it.
      const isLive = isAuctionToday
      const statusZ = String(getStatusPinZ(tract.sale_status, isLive))
      el.dataset.statusZ = statusZ
      el.style.zIndex = statusZ

      // Click to open modal / slide-out (regular mode) or inline
      // popup on the map (comparables mode).
      el.addEventListener('click', (e) => {
        const saleData: SaleDetail = {
          id: tract.id,
          listingId: tract.listing_id,
          tractId: tract.id,
          auctionDate: tract.auction_date,
          totalAcres: tract.total_acres,
          tillableAcres: tract.tillable_acres,
          companyName: tract.company_name,
          salePrice: tract.sale_price,
          pricePerAcre: tract.price_per_acre,
          county: tract.county,
          state: tract.state,
          township: tract.township,
          soilRating: tract.soil_rating,
          polygonCoordinates: tract.polygon_coordinates,
          saleStatus: tract.sale_status,
          listingType: tract.listing_type,
          askingPrice: tract.asking_price,
          landType: tract.land_type,
          landTypes: tract.land_types,
          pctTillable: tract.pct_tillable,
          pricePerTillableAcre: tract.price_per_tillable_acre,
          pricePerSoilRating: tract.price_per_soil_rating,
          sourceUrl: tract.source_url,
        }
        if (subjectTractIdRef.current) {
          // Comp mode: inline popup on the map, anchored at marker
          // pixel position. Stop propagation so the map's click
          // doesn't immediately close the popup we just opened.
          e.stopPropagation()
          const map = mapRef.current
          if (!map) return
          const point = map.project([markerLng, markerLat])
          setCompPopup({ sale: saleData, pos: { x: point.x, y: point.y } })
        } else if (portalMode && onTractSelected) {
          onTractSelected(saleData)
        } else {
          setSelectedSale(saleData)
        }
      })

      // Store element ref for highlight updates
      el.dataset.tractId = tract.id
      tractMarkerElementsRef.current.set(tract.id, el)

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([markerLng, markerLat])
        .addTo(map)

      tractMarkersRef.current.push(marker)
    }
    // `todayTracts` is in the deps so the loop re-runs after today's
    // tracts arrive — that's when the dedup ref gets populated and we
    // need to drop today tracts from the DOM-marker render.
    // `subjectTractId` in deps so the markers re-render when admin
    // enters/exits comparables mode — without this the effect only
    // fires when tracts/todayTracts/mapLoaded changes, and entering
    // comp mode (a state change with no data refetch) left every
    // marker stuck in regular pin form.
  }, [mapLoaded, tracts, todayTracts, subjectTractId])

  // Quick lookup of today's tracts by id for cluster-click handling.
  const todayTractsByIdRef = useRef<Map<string, ApiMapTract>>(new Map())
  useEffect(() => {
    todayTractsByIdRef.current = new Map(todayTracts.map(t => [t.id, t]))
  }, [todayTracts])

  // DOM-marker refs so we can tear down between renders.
  const todayMarkersRef = useRef<maplibregl.Marker[]>([])

  // Always-on today's-auctions DOM markers, with JS-side proximity
  // clustering. We use DOM markers (not a native GeoJSON layer) so the
  // pulsing dots can sit ABOVE the state-badge DOM markers via z-index —
  // a native canvas layer would paint UNDER the badges. Clustering is
  // done in JS: at each map view we group tracts within a pixel radius
  // and render one marker per group. Click a multi-tract cluster to
  // zoom into it; click a single-tract marker to open the tract modal.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Bounding-box center, not vertex-average. Vertex-average gets biased
    // toward whichever side of the polygon has more vertices — for these
    // parcels it ends up ~80 m north of the visual middle. Bbox center
    // lands the dot squarely in the visual middle of each parcel.
    const getPolygonCentroid = (coords: [number, number][]): [number, number] | null => {
      if (!coords || coords.length < 3) return null
      let minLng = Infinity, maxLng = -Infinity
      let minLat = Infinity, maxLat = -Infinity
      for (const [lng, lat] of coords) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
      return [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
    }

    type PreparedTract = {
      tract: ApiMapTract
      lng: number
      lat: number
      ppa: number | null
    }

    // Pre-compute geographic coords + price-per-acre for every today tract.
    const prepared: PreparedTract[] = []
    for (const tract of todayTracts) {
      let lng = tract.longitude as number | null
      let lat = tract.latitude as number | null
      if (tract.polygon_coordinates && tract.polygon_coordinates.length > 2) {
        const c = getPolygonCentroid(tract.polygon_coordinates as [number, number][])
        if (c) { lng = c[0]; lat = c[1] }
      }
      if (lat == null || lng == null) continue
      const isPrivateTreaty = (tract.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = (tract.sale_status || '').toLowerCase() === 'pending'
      const ppa = (isPrivateTreaty || isPending) && tract.asking_price && tract.total_acres
        ? tract.asking_price / tract.total_acres
        : tract.price_per_acre ?? null
      prepared.push({ tract, lng, lat, ppa: ppa ?? null })
    }

    // Tight cluster radius — tracts that are genuinely close on screen merge,
    // but tracts hundreds of km apart never merge into a single cluster.
    // A 4-tract auction within ~1 km of itself stays merged at every zoom
    // up to ~12 (where 1 km projects to ~14 px); tracts in different states
    // never merge because their pixel distance is always > 25 at any zoom
    // you'd actually browse.
    const CLUSTER_RADIUS_PX = 25

    const render = () => {
      // Tear down old markers before each re-render.
      todayMarkersRef.current.forEach(m => m.remove())
      todayMarkersRef.current = []

      // Project all tracts to screen pixels at the current view.
      const points = prepared.map(p => ({
        ...p,
        screen: map.project([p.lng, p.lat]),
      }))

      // Greedy proximity grouping: walk in order, group any later point
      // within CLUSTER_RADIUS_PX of an already-chosen seed.
      const used = new Set<string>()
      const groups: PreparedTract[][] = []
      const r2 = CLUSTER_RADIUS_PX * CLUSTER_RADIUS_PX
      for (const seed of points) {
        if (used.has(seed.tract.id)) continue
        const group: PreparedTract[] = [seed]
        used.add(seed.tract.id)
        for (const other of points) {
          if (used.has(other.tract.id)) continue
          const dx = other.screen.x - seed.screen.x
          const dy = other.screen.y - seed.screen.y
          if (dx * dx + dy * dy <= r2) {
            group.push(other)
            used.add(other.tract.id)
          }
        }
        groups.push(group)
      }

      for (const group of groups) {
        // Geographic center of the group — single tract uses its own coord.
        let centerLng = 0, centerLat = 0
        for (const g of group) { centerLng += g.lng; centerLat += g.lat }
        centerLng /= group.length
        centerLat /= group.length

        const lead = group[0]
        const isCluster = group.length > 1

        // Today's-auction marker — pin fills the element so MapLibre's
        // default 'center' anchor lands the green dot exactly on the
        // lat/lng pixel at every zoom.
        const el = createTodayMarkerElement(
          lead.ppa,
          lead.tract.total_acres,
        )
        const statusZ = String(getStatusPinZ(lead.tract.sale_status, true))
        el.dataset.statusZ = statusZ
        el.style.zIndex = statusZ
        el.dataset.tractId = lead.tract.id

        el.addEventListener('click', () => {
          if (isCluster) {
            // Zoom in by ~2 levels (capped at 13) so the cluster breaks.
            const next = Math.min(map.getZoom() + 2.5, 13)
            map.easeTo({ center: [centerLng, centerLat], zoom: next, duration: 500 })
            return
          }
          const tract = lead.tract
          const saleData: SaleDetail = {
            id: tract.id,
            listingId: tract.listing_id,
            tractId: tract.id,
            auctionDate: tract.auction_date,
            totalAcres: tract.total_acres,
            tillableAcres: tract.tillable_acres,
            companyName: tract.company_name,
            salePrice: tract.sale_price,
            pricePerAcre: tract.price_per_acre,
            county: tract.county,
            state: tract.state,
            township: tract.township,
            soilRating: tract.soil_rating,
            polygonCoordinates: tract.polygon_coordinates,
            saleStatus: tract.sale_status,
            listingType: tract.listing_type,
            askingPrice: tract.asking_price,
            landType: tract.land_type,
            landTypes: tract.land_types,
            pctTillable: tract.pct_tillable,
            pricePerTillableAcre: tract.price_per_tillable_acre,
            pricePerSoilRating: tract.price_per_soil_rating,
            sourceUrl: tract.source_url,
          }
          if (portalMode && onTractSelected) {
            onTractSelected(saleData)
          } else {
            setSelectedSale(saleData)
          }
        })

        // Default 'center' anchor is now correct because createMarkerElement
        // returns a 14×14 element with the pin centered inside it. The label
        // floats absolutely above the pin and the pulse ring floats absolutely
        // around it — neither pushes the element's geometric center off of
        // the pin's center.
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([centerLng, centerLat])
          .addTo(map)
        todayMarkersRef.current.push(marker)
      }
    }

    render()
    map.on('moveend', render)
    map.on('zoomend', render)
    return () => {
      map.off('moveend', render)
      map.off('zoomend', render)
      todayMarkersRef.current.forEach(m => m.remove())
      todayMarkersRef.current = []
    }
  }, [mapLoaded, todayTracts, portalMode, onTractSelected])

  // Highlight report-selected markers in portal mode
  useEffect(() => {
    if (!portalMode || !reportIds) return
    tractMarkerElementsRef.current.forEach((el, tractId) => {
      const pin = el.querySelector('.comp-marker-pin') as HTMLDivElement | null
      if (!pin) return
      if (reportIds.has(tractId)) {
        // Selected markers float above everything else, including live pins.
        el.style.zIndex = '100'
        pin.style.boxShadow = '0 0 0 3px #E91E8C, 0 0 12px 2px rgba(233,30,140,0.6)'
        pin.style.border = '2px solid #E91E8C'
      } else {
        // Restore the status-based z stashed when the marker was created.
        el.style.zIndex = el.dataset.statusZ || ''
        pin.style.boxShadow = ''
        pin.style.border = ''
      }
    })
  }, [portalMode, reportIds])

  // Show/hide markers based on comparable panel's visible IDs
  useEffect(() => {
    if (!comparableVisibleIds) {
      // No filtering — show all markers
      tractMarkerElementsRef.current.forEach((el) => {
        el.style.display = ''
      })
      return
    }
    tractMarkerElementsRef.current.forEach((el, tractId) => {
      el.style.display = comparableVisibleIds.has(tractId) ? '' : 'none'
    })
  }, [comparableVisibleIds])

  // Create dedicated subject tract marker in comparables mode
  const subjectMarkerRef = useRef<maplibregl.Marker | null>(null)
  useEffect(() => {
    const map = mapRef.current
    // Remove previous subject marker
    if (subjectMarkerRef.current) {
      subjectMarkerRef.current.remove()
      subjectMarkerRef.current = null
    }
    if (!portalMode || !subjectTractLocation || !map) return

    // Create a prominent subject tract marker
    const el = document.createElement('div')
    el.style.display = 'flex'
    el.style.flexDirection = 'column'
    el.style.alignItems = 'center'
    el.style.zIndex = '50'

    // Label
    const label = document.createElement('div')
    label.textContent = 'SUBJECT TRACT'
    label.style.cssText = `
      background: rgba(245,140,222,0.2);
      border: 2px solid #F58CDE;
      color: #F58CDE;
      font-size: 11px;
      font-weight: 800;
      padding: 3px 10px;
      border-radius: 6px;
      margin-bottom: 4px;
      white-space: nowrap;
      letter-spacing: 0.5px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.5);
      backdrop-filter: blur(4px);
    `
    el.appendChild(label)

    // Pin with pulsing ring
    const pinContainer = document.createElement('div')
    pinContainer.style.cssText = 'position: relative; width: 24px; height: 24px;'

    // Pulsing ring
    const ring = document.createElement('div')
    ring.style.cssText = `
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid #F58CDE;
      animation: subjectPulse 2s ease-out infinite;
    `
    pinContainer.appendChild(ring)

    // Second ring (delayed)
    const ring2 = document.createElement('div')
    ring2.style.cssText = `
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid #F58CDE;
      animation: subjectPulse 2s ease-out 1s infinite;
    `
    pinContainer.appendChild(ring2)

    // Main pin
    const pin = document.createElement('div')
    pin.style.cssText = `
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #F58CDE;
      border: 3px solid #fff;
      box-shadow: 0 0 0 4px rgba(245,140,222,0.4), 0 0 20px 6px rgba(245,140,222,0.5);
      position: relative;
      z-index: 1;
    `
    pinContainer.appendChild(pin)
    el.appendChild(pinContainer)

    // Add CSS animation if not already present
    if (!document.getElementById('subject-pulse-style')) {
      const style = document.createElement('style')
      style.id = 'subject-pulse-style'
      style.textContent = `
        @keyframes subjectPulse {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `
      document.head.appendChild(style)
    }

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([subjectTractLocation.lng, subjectTractLocation.lat])
      .addTo(map)

    subjectMarkerRef.current = marker

    return () => {
      marker.remove()
      subjectMarkerRef.current = null
    }
  }, [portalMode, subjectTractLocation])

  // ─────────────────────────────────────────────────────────────
  // 3-tier zoom system: state silhouettes → county squares → tract
  // pins. Hard-gated so only one tier's markers are in the DOM at
  // any zoom. Each tier's effect tears down its own markers (with
  // fade-out) and rebuilds when its data or the active tier changes.
  // Tract pins (existing) are toggled via display: none in a
  // separate effect so we don't pay the cost of recreating their
  // click/report-highlight wiring on every zoom change.
  // ─────────────────────────────────────────────────────────────

  // STATE BADGES — silhouette + count, sized to the projected bbox
  // of each state so the silhouette sits over its real on-map
  // footprint. Inner sized inline; resize wired to map "move" so
  // badges stay locked to their footprints during pan/zoom.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    fadeOutAndRemove(stateMarkersRef.current)
    stateMarkersRef.current = []
    if (currentTier !== 'state') return

    const sized: Array<{
      inner: HTMLElement
      bbox: [[number, number], [number, number]]
    }> = []
    const MIN_BADGE_PX = 70
    const SHRINK_FACTOR = 0.92

    const sizeBadge = (
      inner: HTMLElement,
      bbox: [[number, number], [number, number]],
    ) => {
      const tl = map.project([bbox[0][0], bbox[1][1]])
      const br = map.project([bbox[1][0], bbox[0][1]])
      const w = Math.max(MIN_BADGE_PX, Math.abs(br.x - tl.x) * SHRINK_FACTOR)
      const h = Math.max(MIN_BADGE_PX, Math.abs(br.y - tl.y) * SHRINK_FACTOR)
      inner.style.width = `${w}px`
      inner.style.height = `${h}px`
    }

    // Render a badge for EVERY state with a known silhouette/centroid,
    // not just states that have tracts in the DB. Once the Regrid API
    // is wired up we'll have data for every state, so badges should
    // appear nationwide regardless of current tract count.
    const allStates = Array.from(new Set<string>([
      ...Object.keys(stateSilhouettes),
      ...Object.keys(stateCentroids),
      ...stateCounts.map(s => s.state),
    ]))
    for (const state of allStates) {
      let lng: number | undefined
      let lat: number | undefined
      const c = stateCentroids[state]
      if (c) {
        lng = c[0]; lat = c[1]
      } else {
        const bounds = STATE_BOUNDS[state]
        if (!bounds) continue
        lng = (bounds[0][0] + bounds[1][0]) / 2
        lat = (bounds[0][1] + bounds[1][1]) / 2
      }

      const silhouettePath = stateSilhouettes[state]
      const bbox = stateBboxes[state]
      const maskId = `aem-cut-${state}`
      const blurId = `aem-blur-${state}`

      const el = document.createElement('div')
      el.className = 'aem-marker-shell'
      const inner = document.createElement('div')
      inner.className = 'aem-state-badge'
      // Hovering shadow: render the silhouette TWICE inside one SVG.
      // First copy is a translated + blurred shadow, masked so only
      // the part OUTSIDE the silhouette draws. Second copy is the
      // 62%-opacity silhouette on top. Result: shadow appears only
      // along the bottom-right edge, silhouette stays see-through,
      // state appears to lift off the map.
      inner.innerHTML = `
        <svg class="aem-state-shape" viewBox="0 0 100 100"
             preserveAspectRatio="none">
          ${silhouettePath ? `
            <defs>
              <mask id="${maskId}" maskUnits="userSpaceOnUse"
                    x="-50" y="-50" width="200" height="200">
                <rect x="-50" y="-50" width="200" height="200" fill="white"/>
                <path d="${silhouettePath}" fill="black"/>
              </mask>
              <filter id="${blurId}" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="1.5"/>
              </filter>
            </defs>
            <g mask="url(#${maskId})" pointer-events="none">
              <path d="${silhouettePath}"
                    fill="rgba(0,0,0,0.92)"
                    transform="translate(3 4)"
                    filter="url(#${blurId})"
                    stroke="none"/>
            </g>
            <path d="${silhouettePath}"
                  fill="rgba(10,10,12,0.62)"
                  stroke="none" />
          ` : '<rect x="2" y="2" width="96" height="96" rx="6" fill="rgba(10,10,12,0.62)"/>'}
        </svg>
        <div class="aem-state-overlay">
          <img src="/goat-icon-white.png" alt="" class="aem-state-goat" />
          <div class="aem-state-name">${abbrToName(state)}</div>
          <a class="aem-state-link" data-action="filter">Filter</a>
        </div>
      `
      el.appendChild(inner)

      el.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement
        const isFilterLink = target?.closest('[data-action="filter"]')
        ev.stopPropagation()
        if (isFilterLink) {
          setFilters(prev => ({
            ...prev, stateFilter: state, countyFilters: [], townshipFilters: [],
          }))
          setFilterOpen(true)
        }
        map.easeTo({ center: [lng!, lat!], zoom: 7, duration: 900 })
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map)
      stateMarkersRef.current.push(marker)
      if (bbox) {
        sized.push({ inner, bbox })
        sizeBadge(inner, bbox)
      } else {
        inner.style.width = '100px'
        inner.style.height = '100px'
      }
    }

    const onMove = () => {
      for (const { inner, bbox } of sized) sizeBadge(inner, bbox)
    }
    map.on('move', onMove)

    return () => {
      map.off('move', onMove)
      fadeOutAndRemove(stateMarkersRef.current)
      stateMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCounts, mapLoaded, currentTier, stateSilhouettes, stateBboxes])

  // COUNTY SQUARES — only built when in county tier.
  // Renders a badge for EVERY county in the visible viewport (not just
  // counties returned by the tract-counts API). Re-clipped to viewport
  // on every map move so we never have more than ~hundreds of DOM
  // markers at a time even though the full dataset has ~3,221.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (currentTier !== 'county' || allCountyCentroids.length === 0) {
      fadeOutAndRemove(countyMarkersRef.current)
      countyMarkersRef.current = []
      return
    }

    // Track currently-rendered counties by `STATE-COUNTY` key so we
    // can incrementally add/remove on pan instead of full rebuild.
    const rendered = new Map<string, maplibregl.Marker>()

    const renderForBounds = () => {
      const bounds = map.getBounds()
      const w = bounds.getWest(), e = bounds.getEast()
      const s = bounds.getSouth(), n = bounds.getNorth()
      // Small margin so badges that are partly off-screen still attach.
      const mw = (e - w) * 0.05
      const mh = (n - s) * 0.05
      const visibleKeys = new Set<string>()

      for (const c of allCountyCentroids) {
        if (c.lng < w - mw || c.lng > e + mw) continue
        if (c.lat < s - mh || c.lat > n + mh) continue
        const key = `${c.state}-${c.county}`
        visibleKeys.add(key)
        if (rendered.has(key)) continue
        const el = document.createElement('div')
        el.className = 'aem-marker-shell'
        const inner = document.createElement('div')
        inner.className = 'aem-county-square'
        inner.innerHTML = `<div class="aem-county-name">${c.county}</div>`
        el.appendChild(inner)
        el.addEventListener('click', () => {
          map.easeTo({ center: [c.lng, c.lat], zoom: 10, duration: 800 })
        })
        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
          .setLngLat([c.lng, c.lat])
          .addTo(map)
        rendered.set(key, marker)
      }

      // Remove any rendered markers no longer visible.
      const keysToRemove: string[] = []
      rendered.forEach((marker, key) => {
        if (!visibleKeys.has(key)) {
          marker.remove()
          keysToRemove.push(key)
        }
      })
      keysToRemove.forEach(k => rendered.delete(k))
      // Keep the ref in sync for cleanup + fade-out helpers.
      const stillVisible: maplibregl.Marker[] = []
      rendered.forEach(m => stillVisible.push(m))
      countyMarkersRef.current = stillVisible
    }

    renderForBounds()
    map.on('moveend', renderForBounds)

    return () => {
      map.off('moveend', renderForBounds)
      const all: maplibregl.Marker[] = []
      rendered.forEach(m => all.push(m))
      fadeOutAndRemove(all)
      rendered.clear()
      countyMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allCountyCentroids, mapLoaded, currentTier])

  // TRACT PIN VISIBILITY — toggle existing tract pins by tier.
  // Pins are created/maintained by their own effect (downstream);
  // we just hide them when not in tract tier so state silhouettes
  // and county squares aren't competing with them.
  useEffect(() => {
    const visible = currentTier === 'tract'
    tractMarkersRef.current.forEach(m => {
      const el = m.getElement()
      if (el) el.style.display = visible ? '' : 'none'
    })
  }, [currentTier, tracts])

  const getStatusLabel = (status: string | null | undefined) => {
    if (!status) return 'Unknown'
    switch (status.toLowerCase()) {
      case 'sold': return 'Sold'
      case 'auction': return 'Auction'
      case 'listed': return 'Listed'
      case 'active': return 'Active'
      case 'pending': return 'Pending'
      case 'no_sale': return 'No Sale'
      case 'live': return 'Live'
      default: return status
    }
  }

  return (
    <div className="comparables-map-container" style={{ height }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Comparables-mode inline popup — click a + marker → opens here.
          Sits absolutely positioned over the map. Closes on map click
          (handled in the marker-loop effect), Esc, or the X button. */}
      {compPopup && (
        <CompInlinePopup
          sale={compPopup.sale}
          pos={compPopup.pos}
          isSelected={!!(reportIds && reportIds.has(compPopup.sale.id))}
          onClose={() => setCompPopup(null)}
          onView3D={() => {
            if (onView3DTerrain && compPopup.sale.tractId) {
              const tractName = `${compPopup.sale.county || ''}${compPopup.sale.state ? ', ' + compPopup.sale.state : ''}`.trim() || 'Tract'
              onView3DTerrain(compPopup.sale.tractId, tractName)
            }
          }}
          onViewDetails={() => {
            // Open the slide-out pane on the left (same UX as the normal
            // /access tract-pin → View Listing flow). Parent /access page
            // wires onViewListing to its PortalTractDetail sidebar.
            if (onViewListing && compPopup.sale.listingId) {
              onViewListing(compPopup.sale.listingId)
              setCompPopup(null)
            } else if (compPopup.sale.sourceUrl) {
              window.open(compPopup.sale.sourceUrl, '_blank', 'noopener,noreferrer')
            }
          }}
          onAddToReport={() => {
            if (onToggleReport) onToggleReport(compPopup.sale as any)
            setCompPopup(null)
          }}
        />
      )}

      {/* Goat Search animation overlay — renders while a chat-driven
          search is in flight. Pure visual sugar; pointer-events:none so
          the map under it stays interactive. No dimming/blur — keeps
          the map fully visible. */}
      {chatSearching && (
        <div
          style={{
            position: 'absolute', inset: 0,
            pointerEvents: 'none', zIndex: 8,
            overflow: 'hidden',
          }}
        >
          {/* Radar-pulse rings expanding from center */}
          {[0, 0.6, 1.2].map(delay => (
            <div
              key={delay}
              style={{
                position: 'absolute',
                top: '50%', left: '50%',
                width: 80, height: 80,
                marginLeft: -40, marginTop: -40,
                border: '2px solid rgba(245, 140, 222, 0.8)',
                borderRadius: '50%',
                animation: 'goatPulse 1.8s ease-out infinite',
                animationDelay: `${delay}s`,
                opacity: 0,
              }}
            />
          ))}
          {/* Sparkles drifting up at random horizontal positions */}
          {[12, 27, 41, 58, 73, 87].map((leftPct, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${leftPct}%`, bottom: -10,
                width: 6, height: 6,
                background: 'rgba(245, 140, 222, 0.95)',
                borderRadius: '50%',
                boxShadow: '0 0 12px rgba(245, 140, 222, 0.9)',
                animation: 'goatSparkle 2.2s ease-in infinite',
                animationDelay: `${i * 0.18}s`,
                opacity: 0,
              }}
            />
          ))}
          {/* Centered "Searching the map…" pill */}
          <div
            style={{
              position: 'absolute',
              top: 24, left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.78)',
              border: '1px solid rgba(245, 140, 222, 0.45)',
              padding: '8px 18px',
              borderRadius: 9999,
              color: '#fff', fontSize: 13, fontWeight: 600,
              backdropFilter: 'blur(8px)',
              filter: 'drop-shadow(0 3px 10px rgba(0,0,0,0.5))',
              animation: 'goatPillShine 2s ease-in-out infinite',
            }}
          >
            ✨ Searching the map…
          </div>
          <style>{`
            @keyframes goatPulse {
              0%   { opacity: 0; transform: scale(0.4); }
              30%  { opacity: 0.9; }
              100% { opacity: 0; transform: scale(8); }
            }
            @keyframes goatSparkle {
              0%   { opacity: 0; transform: translateY(0) scale(0.5); }
              30%  { opacity: 1; transform: translateY(-30vh) scale(1); }
              100% { opacity: 0; transform: translateY(-90vh) scale(0.3); }
            }
            @keyframes goatPillShine {
              0%, 100% { box-shadow: 0 0 0 rgba(245,140,222,0.0); }
              50%      { box-shadow: 0 0 22px rgba(245,140,222,0.55); }
            }
          `}</style>
        </div>
      )}

      {/* Loading indicator */}
      {loading && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(4px)',
          color: '#fff',
          fontSize: 13,
          padding: '8px 16px',
          borderRadius: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{
            width: 16,
            height: 16,
            border: '2px solid rgba(255,255,255,0.3)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          Loading tracts...
        </div>
      )}

      {/* Neighbors loading pill — shows while the scraper fetches + enriches.
          First-time views in a fresh area can take 5-10s for soil/tillable
          enrichment; this gives the user explicit feedback that work is
          happening. Tints blue to match the Neighbors pin color. */}
      {neighborsLoading && (
        <div style={{
          position: 'absolute',
          top: loading ? 56 : 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          background: 'rgba(37, 99, 235, 0.92)',
          backdropFilter: 'blur(4px)',
          color: '#fff',
          fontSize: 13,
          padding: '8px 16px',
          borderRadius: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          boxShadow: '0 4px 12px rgba(37, 99, 235, 0.25)',
        }}>
          <div style={{
            width: 16,
            height: 16,
            border: '2px solid rgba(255,255,255,0.35)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          Loading neighbors...
        </div>
      )}

      {/* Admin Parcel Overlay Toggle — DISABLED. Superseded by the
          always-on Regrid layer. Set the JSX gate to `false` so the
          button never renders, but keep the surrounding code intact in
          case we ever need to re-enable a state_parcels fallback. */}
      {false && isAdmin && currentZoom >= ADMIN_PARCEL_MIN_ZOOM && (
        <button
          onClick={() => setAdminParcelOverlay(v => {
            const next = !v
            try { localStorage.setItem('gg_admin_parcel_overlay', next ? '1' : '0') } catch {}
            return next
          })}
          style={{
            position: 'absolute',
            bottom: 24,
            right: 16,
            zIndex: 10,
            height: 40,
            padding: '0 14px',
            borderRadius: 8,
            border: 'none',
            backgroundColor: adminParcelOverlay ? '#F59E0B' : 'rgba(0,0,0,0.85)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}
          title={
            adminParcelStates.length > 0
              ? `Show every parcel (${adminParcelStates.join(', ')}) — admin only`
              : 'Show every parcel — admin only'
          }
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="3" y1="9"  x2="21" y2="9"  />
            <line x1="3" y1="15" x2="21" y2="15" />
            <line x1="9"  y1="3" x2="9"  y2="21" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
          {adminParcelOverlay ? 'Parcels' : 'Show parcels'}
        </button>
      )}

      {/* Filter Button */}
      <button
        onClick={() => setFilterOpen(!filterOpen)}
        style={{
          position: 'absolute',
          top: portalMode ? 70 : 120,
          right: 10,
          zIndex: 10,
          width: 36,
          height: 36,
          borderRadius: 6,
          border: 'none',
          backgroundColor: hasActiveFilters ? '#E91E8C' : 'rgba(0,0,0,0.75)',
          color: '#fff',
          fontSize: 18,
          cursor: 'pointer',
          display: portalMode ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        }}
        title="Filters"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      </button>

      {/* Filter Panel */}
      {filterOpen && (
        <div style={{
          position: portalMode ? 'fixed' : 'absolute',
          top: 0,
          right: 0,
          width: portalMode ? 480 : 320,
          height: '100%',
          backgroundColor: '#000',
          zIndex: portalMode ? 520 : 100,
          overflowY: 'auto',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>Filters</span>
            {/* Match the canonical pane close-button style used by
                PortalListPanel etc. — 32×32 rounded square with
                bg-white/5 + hover-white/10. Inline-styled because the
                Filters pane doesn't use Tailwind. */}
            <button
              onClick={() => setFilterOpen(false)}
              aria-label="Close"
              style={{
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(255,255,255,0.05)',
                border: 'none', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#888', fontSize: 18, lineHeight: 1,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.10)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)' }}
            >
              ✕
            </button>
          </div>

          <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
            {/* Date Range */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Status</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                {[
                  { label: 'Listed', value: 'active' },
                  { label: 'Live', value: 'live,pending' },
                  { label: 'Sold', value: 'sold' },
                ].map(opt => {
                  const isActive = filters.statuses.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setFilters(f => ({
                          ...f,
                          statuses: isActive
                            ? f.statuses.filter(s => s !== opt.value)
                            : [...f.statuses, opt.value]
                        }))
                      }}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 20,
                        border: `1px solid ${isActive ? '#E91E8C' : 'rgba(255,255,255,0.2)'}`,
                        backgroundColor: isActive ? 'rgba(233,30,140,0.2)' : 'transparent',
                        color: isActive ? '#E91E8C' : '#BBBBBB',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Date Range</div>
              {[
                { label: 'Upcoming', value: 'upcoming' },
                { label: 'Last month', value: '1month' },
                { label: 'Last 6 months', value: '6months' },
                { label: 'Last 1 year', value: '1year' },
                { label: 'Last 18 months', value: '18months' },
                { label: 'Last 2 years', value: '2years' },
                { label: 'All time', value: 'all' },
                { label: 'Custom range…', value: 'custom' },
              ].map(opt => (
                <div
                  key={opt.value}
                  onClick={() => setFilters(f => ({
                    ...f,
                    dateRange: opt.value,
                    // Leaving 'custom' clears the date inputs so the user
                    // doesn't get silent stale filtering after switching back.
                    dateFrom: opt.value === 'custom' ? f.dateFrom : '',
                    dateTo: opt.value === 'custom' ? f.dateTo : '',
                  }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%',
                    border: `2px solid ${filters.dateRange === opt.value ? '#E91E8C' : 'rgba(255,255,255,0.3)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {filters.dateRange === opt.value && (
                      <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#E91E8C' }} />
                    )}
                  </div>
                  <span style={{ color: '#BBBBBB', fontSize: 14 }}>{opt.label}</span>
                </div>
              ))}

              {/* Custom-range date inputs — only visible when the radio is on
                  'custom'. Either bound can be left blank for a one-sided
                  window (e.g. "since March 2024" with no end). */}
              {filters.dateRange === 'custom' && (
                <div style={{ marginTop: 10, marginLeft: 28, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>From</label>
                    <input
                      type="date"
                      value={filters.dateFrom}
                      onChange={(e) => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.15)',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        color: '#fff',
                        fontSize: 13,
                        colorScheme: 'dark',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>To</label>
                    <input
                      type="date"
                      value={filters.dateTo}
                      onChange={(e) => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.15)',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        color: '#fff',
                        fontSize: 13,
                        colorScheme: 'dark',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* State Filter — from API (all states with boundary data) */}
            {(() => {
              const states = filterOptions.states
              if (states.length === 0) return null
              return (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>State</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {states.map(st => {
                      const activeStates = filters.stateFilter ? filters.stateFilter.split(',') : []
                      const isActive = activeStates.includes(st)
                      return (
                        <button
                          key={st}
                          onClick={() => {
                            const current = filters.stateFilter ? filters.stateFilter.split(',') : []
                            const next = isActive ? current.filter(s => s !== st) : [...current, st]
                            const newFilters = { ...filters, stateFilter: next.join(','), countyFilters: [], townshipFilters: [] }
                            setFilters(newFilters)
                            filtersRef.current = newFilters

                            // Always clear everything and reload with the new filter
                            loadedCellsRef.current = new Set()
                            tractMapRef.current = new Map()
                            setTracts([])
                            tractMarkersRef.current.forEach(m => m.remove())
                            tractMarkersRef.current = []

                            if (next.length > 0) {
                              // Load each selected state's bounds individually
                              let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90
                              for (const s of next) {
                                const b = STATE_BOUNDS[s]
                                if (b) {
                                  if (b[0][0] < minLng) minLng = b[0][0]
                                  if (b[0][1] < minLat) minLat = b[0][1]
                                  if (b[1][0] > maxLng) maxLng = b[1][0]
                                  if (b[1][1] > maxLat) maxLat = b[1][1]
                                  // Load this state's tracts
                                  loadTractsForBounds({ min_lat: b[0][1], max_lat: b[1][1], min_lng: b[0][0], max_lng: b[1][0] })
                                }
                              }
                              if (minLng < 180) {
                                mapRef.current?.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, duration: 1000 })
                              }
                            } else if (mapRef.current) {
                              const bounds = mapRef.current.getBounds()
                              loadTractsForBounds({ min_lat: bounds.getSouth(), max_lat: bounds.getNorth(), min_lng: bounds.getWest(), max_lng: bounds.getEast() })
                            }
                          }}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 20,
                            border: `1px solid ${isActive ? '#E91E8C' : 'rgba(255,255,255,0.2)'}`,
                            backgroundColor: isActive ? 'rgba(233,30,140,0.2)' : 'transparent',
                            color: isActive ? '#E91E8C' : '#BBBBBB',
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {st}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* County Filter — from API for selected state(s) */}
            {filters.stateFilter && (() => {
              const activeStates = filters.stateFilter.split(',').filter(Boolean).map(s => s.toUpperCase())
              const countySet = new Set<string>()
              activeStates.forEach(st => {
                const stateCounties = filterOptions.counties_by_state[st] || []
                stateCounties.forEach(c => countySet.add(c))
              })
              const counties = Array.from(countySet).sort()
              if (counties.length === 0) return null
              return (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                    County{filters.countyFilters.length > 0 ? ` (${filters.countyFilters.length} selected)` : ''}
                  </div>
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {counties.map(county => {
                        const isActive = filters.countyFilters.includes(county)
                        return (
                          <button
                            key={county}
                            onClick={() => {
                              const newCounties = isActive
                                ? filters.countyFilters.filter(c => c !== county)
                                : [...filters.countyFilters, county]
                              const newFilters = { ...filters, countyFilters: newCounties, townshipFilters: [] }
                              setFilters(newFilters)
                              filtersRef.current = newFilters
                              loadedCellsRef.current = new Set()
                              tractMapRef.current = new Map()
                              setTracts([])
                              tractMarkersRef.current.forEach(m => m.remove())
                              tractMarkersRef.current = []
                              if (mapRef.current) {
                                const bounds = mapRef.current.getBounds()
                                loadTractsForBounds({ min_lat: bounds.getSouth(), max_lat: bounds.getNorth(), min_lng: bounds.getWest(), max_lng: bounds.getEast() })
                              }
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 14,
                              border: `1px solid ${isActive ? '#E91E8C' : 'rgba(255,255,255,0.15)'}`,
                              backgroundColor: isActive ? 'rgba(233,30,140,0.2)' : 'transparent',
                              color: isActive ? '#E91E8C' : '#BBBBBB',
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            {county}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Township — only show when county is selected, derived from API data */}
            {filters.countyFilters.length > 0 && (() => {
              const st = filters.stateFilter?.toUpperCase()
              const townshipSet = new Set<string>()
              if (st && filterOptions.townships_by_county) {
                filters.countyFilters.forEach(county => {
                  const key = `${st}|${county}`
                  const twps = filterOptions.townships_by_county[key]
                  if (twps) twps.forEach(t => townshipSet.add(t))
                })
              }
              const townships = Array.from(townshipSet).sort()

              if (townships.length === 0) return null

              return (
                <div style={{ marginBottom: 20 }}>
                  <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                    Township{filters.townshipFilters.length > 0 ? ` (${filters.townshipFilters.length} selected)` : ''}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                    {townships.map(twp => {
                      const isActive = filters.townshipFilters.includes(twp)
                      return (
                        <button
                          key={twp}
                          onClick={() => {
                            const newTownships = isActive
                              ? filters.townshipFilters.filter(t => t !== twp)
                              : [...filters.townshipFilters, twp]
                            const newFilters = { ...filters, townshipFilters: newTownships }
                            setFilters(newFilters)
                            filtersRef.current = newFilters
                            loadedCellsRef.current = new Set()
                            tractMapRef.current = new Map()
                            setTracts([])
                            tractMarkersRef.current.forEach(m => m.remove())
                            tractMarkersRef.current = []
                            if (mapRef.current) {
                              const bounds = mapRef.current.getBounds()
                              loadTractsForBounds({ min_lat: bounds.getSouth(), max_lat: bounds.getNorth(), min_lng: bounds.getWest(), max_lng: bounds.getEast() })
                            }
                          }}
                          style={{
                            padding: '4px 10px',
                            borderRadius: 14,
                            border: `1px solid ${isActive ? '#E91E8C' : 'rgba(255,255,255,0.15)'}`,
                            backgroundColor: isActive ? 'rgba(233,30,140,0.2)' : 'transparent',
                            color: isActive ? '#E91E8C' : '#BBBBBB',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          {twp}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })()}

            {/* Range filters */}
            {[
              ...(filters.stateFilter ? [{
                label: filters.stateFilter === 'IL' ? 'PI Rating' :
                       filters.stateFilter === 'IN' ? 'WAPI' :
                       filters.stateFilter === 'IA' ? 'CSR2' : 'Soil Rating',
                minKey: 'soilRatingMin' as keyof FilterState,
                maxKey: 'soilRatingMax' as keyof FilterState
              }] : []),
              { label: 'Acreage', minKey: 'acreageMin' as keyof FilterState, maxKey: 'acreageMax' as keyof FilterState },
              { label: '% Tillable', minKey: 'pctTillableMin' as keyof FilterState, maxKey: 'pctTillableMax' as keyof FilterState },
            ].map(({ label, minKey, maxKey }) => (
              <div key={label} style={{ marginBottom: 20 }}>
                <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>{label}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters[minKey] as string}
                    onChange={e => setFilters(f => ({ ...f, [minKey]: e.target.value }))}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.15)',
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      color: '#fff', fontSize: 14, outline: 'none',
                    }}
                  />
                  <span style={{ color: '#999999', fontSize: 13 }}>to</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters[maxKey] as string}
                    onChange={e => setFilters(f => ({ ...f, [maxKey]: e.target.value }))}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.15)',
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      color: '#fff', fontSize: 14, outline: 'none',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            gap: 10,
          }}>
            <button
              onClick={resetFilters}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)',
                backgroundColor: 'transparent',
                color: '#BBBBBB',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reset
            </button>
            <button
              onClick={applyFilters}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10,
                border: 'none',
                backgroundColor: '#E91E8C',
                color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Tract count */}
      {!portalMode && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 10,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(4px)',
          color: 'rgba(255,255,255,0.7)',
          fontSize: 12,
          padding: '6px 12px',
          borderRadius: 9999,
        }}>
          {tracts.length.toLocaleString()} tracts
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 10,
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(4px)',
        borderRadius: 8,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {[
          { label: 'Sold', color: '#f58cde' },
          { label: 'Auction', color: '#2563eb' },
          { label: 'Listed', color: '#eab308' },
          { label: "Today's Auctions", color: '#22c55e' },
          { label: 'No Sale', color: '#9ca3af' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: color,
              border: '1.5px solid #fff',
              display: 'inline-block',
            }} />
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Sale Detail Modal — same as ComparablesMap */}
      {selectedSale && (
        <div className="sale-modal-overlay" onClick={() => setSelectedSale(null)}>
          <div className="sale-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="sale-modal-header">
              <h3 className="sale-modal-title">Tract Sale</h3>
              <button className="sale-modal-close" onClick={() => setSelectedSale(null)}>✕</button>
            </div>
            <div className="sale-modal-body">
              <div className="sale-modal-row">
                <span className="sale-modal-label">Status</span>
                <span className="sale-modal-value">{getStatusLabel(selectedSale.saleStatus)}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Date</span>
                <span className="sale-modal-value">{formatDate(selectedSale.auctionDate)}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Acres</span>
                <span className="sale-modal-value">
                  {selectedSale.totalAcres ? formatAcres(selectedSale.totalAcres) + ' ac' : '—'}
                </span>
              </div>
              {selectedSale.companyName && (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Listing Company</span>
                  <span className="sale-modal-value">{selectedSale.companyName}</span>
                </div>
              )}
              {selectedSale.salePrice ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Total Sale Price</span>
                  <span className="sale-modal-value">{formatCurrency(selectedSale.salePrice)}</span>
                </div>
              ) : null}
              {selectedSale.pricePerAcre ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Price/Acre</span>
                  <span className="sale-modal-value">{formatCurrency(selectedSale.pricePerAcre)}/ac</span>
                </div>
              ) : null}
              <div className="sale-modal-row">
                <span className="sale-modal-label">County</span>
                <span className="sale-modal-value">{selectedSale.county || '—'}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">State</span>
                <span className="sale-modal-value">{selectedSale.state || '—'}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Township</span>
                <span className="sale-modal-value">{normalizeTownship(selectedSale.township) || '—'}</span>
              </div>
              {selectedSale.tillableAcres ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Tillable Acres</span>
                  <span className="sale-modal-value">{formatAcres(selectedSale.tillableAcres)} ac</span>
                </div>
              ) : null}
              {selectedSale.tillableAcres && selectedSale.pricePerAcre && selectedSale.totalAcres ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">$/Tillable Acre</span>
                  <span className="sale-modal-value">{formatCurrency((selectedSale.pricePerAcre * selectedSale.totalAcres) / selectedSale.tillableAcres)}/ac</span>
                </div>
              ) : null}
              {selectedSale.soilRating && selectedSale.pricePerAcre ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">$/Soil Rating</span>
                  <span className="sale-modal-value">{formatCurrency(selectedSale.pricePerAcre / selectedSale.soilRating)}</span>
                </div>
              ) : null}

              {/* Soil & Land Data Section */}
              {soilLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0' }}>
                  <div style={{
                    width: 16, height: 16,
                    border: '2px solid #e0e0e0', borderTopColor: '#E91E8C',
                    borderRadius: '50%', animation: 'spin 1s linear infinite',
                  }} />
                  <span style={{ color: '#999', fontSize: 13 }}>Loading soil & land data...</span>
                </div>
              )}
              {!soilLoading && (soilData || elevationData) && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color: '#1a1a1a', fontSize: 16, fontWeight: 700, marginBottom: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
                    Soil & Land Data
                  </div>
                  {elevationData && elevationData.min_ft != null && (
                    <div className="sale-modal-row">
                      <span className="sale-modal-label">Elevation</span>
                      <span className="sale-modal-value">
                        {Math.round(elevationData.min_ft)} - {Math.round(elevationData.max_ft)} ft
                        {elevationData.relief_ft > 0 ? ` (${Math.round(elevationData.relief_ft)} ft relief)` : ''}
                      </span>
                    </div>
                  )}
                  {elevationData?.avg_slope_pct != null && (
                    <div className="sale-modal-row">
                      <span className="sale-modal-label">Avg Slope</span>
                      <span className="sale-modal-value">{elevationData.avg_slope_pct}%</span>
                    </div>
                  )}
                  {soilData?.map_units && soilData.map_units.length > 0 && (
                    soilData.map_units.map((unit: any, idx: number) => (
                      <div key={idx} style={{ padding: '10px 0', borderBottom: '1px solid #eee' }}>
                        <div style={{ color: '#1a1a1a', fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                          {unit.name || unit.musym || 'Unknown'}
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          {unit.nccpi != null && <span style={{ color: '#999', fontSize: 12 }}>NCCPI: {unit.nccpi}</span>}
                          {unit.drainage_class && <span style={{ color: '#999', fontSize: 12 }}>{unit.drainage_class}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Ground Truth — USDA NASS county yields, cash rent, state
                  landvalue. Same gating surface as Soil & Land Data above:
                  the page-level role gate decides who reaches this modal at
                  all (ALLOWED_ROLES on /listings + /access). The panel
                  itself self-hides when the tract has no resolved
                  state/county or no NASS data exists. */}
              {selectedSale.tractId && (
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #eee' }}>
                  <GroundTruthPanel tractId={selectedSale.tractId} theme="light" />
                </div>
              )}

              {/* NDVI — Sentinel-2 vegetation history. Self-hides when
                  no observations have been ingested yet for this tract. */}
              {selectedSale.tractId && (
                <div style={{ marginTop: 16 }}>
                  <NdviPanel tractId={selectedSale.tractId} theme="light" />
                </div>
              )}
            </div>

            {/* View 3D Terrain */}
            {selectedSale.polygonCoordinates && selectedSale.polygonCoordinates.length > 2 ? (
              <button
                className="sale-modal-action-btn"
                style={{ backgroundColor: '#E91E8C', color: '#fff', marginBottom: '8px' }}
                onClick={() => setShow3DViewer(true)}
              >
                🏔 View 3D Terrain
              </button>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px 20px', color: '#999', fontSize: 13, fontStyle: 'italic' }}>
                No map boundaries available
              </div>
            )}

            {/* View Listing */}
            {selectedSale.listingId && (
              portalMode && onViewListing ? (
                <button
                  className="sale-modal-action-btn"
                  style={{ marginBottom: '8px' }}
                  onClick={() => {
                    onViewListing(selectedSale.listingId!)
                    setSelectedSale(null)
                  }}
                >
                  View Listing →
                </button>
              ) : (
                <a
                  href={`/listings/${selectedSale.listingId}`}
                  className="sale-modal-action-btn"
                  style={{ textDecoration: 'none', marginBottom: '8px' }}
                >
                  View Listing →
                </a>
              )
            )}

            {/* View Details (external link to source) */}
            {selectedSale.companyName && selectedSale.sourceUrl && (
              <button
                className="sale-modal-action-btn"
                style={{
                  backgroundColor: 'transparent',
                  color: '#E91E8C',
                  border: '1px solid #E91E8C',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
                onClick={() => window.open(selectedSale.sourceUrl!, '_blank')}
              >
                View Details
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            )}

            {/* Add to Report */}
            <button
              className="sale-modal-action-btn"
              style={{
                backgroundColor: selectedIds.has(selectedSale.id) ? 'rgba(233,30,140,0.08)' : 'rgba(0,0,0,0.05)',
                color: selectedIds.has(selectedSale.id) ? '#E91E8C' : '#333',
                border: selectedIds.has(selectedSale.id) ? '1px solid #E91E8C' : '1px solid rgba(0,0,0,0.15)',
                marginBottom: '16px',
              }}
              onClick={() => {
                toggleSelection(selectedSale)
                setSelectedSale(null)
              }}
            >
              {selectedIds.has(selectedSale.id) ? '− Remove from Report' : '+ Add to Report'}
            </button>
          </div>
        </div>
      )}

      {/* Floating Report Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 12,
          backgroundColor: '#E91E8C', borderRadius: 30, padding: '12px 24px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 500, cursor: 'pointer',
        }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
            {selectedIds.size} Selected
          </span>
          <button
            onClick={() => {
              const reportData = {
                comparables: selectedTracts.map(t => ({
                  id: t.id,
                  county: t.county,
                  state: t.state,
                  total_acres: t.totalAcres,
                  tillable_acres: t.tillableAcres,
                  soil_rating: t.soilRating,
                  price_per_acre: t.pricePerAcre,
                  sale_price: t.salePrice,
                  auction_date: t.auctionDate,
                  company_name: t.companyName,
                })),
              }
              sessionStorage.setItem('exploreReport', JSON.stringify(reportData))
              window.location.href = '/listings/report'
            }}
            style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 20,
              padding: '8px 16px', color: '#fff', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Create Report
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setSelectedTracts([]) }}
            style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer', fontSize: 18,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* 3D Terrain Viewer */}
      <Tract3DModal
        tractId={selectedSale?.tractId || selectedSale?.id || ''}
        tractName={`${selectedSale?.county || ''}, ${selectedSale?.state || ''}`}
        isOpen={show3DViewer}
        onClose={() => setShow3DViewer(false)}
      />
    </div>
  )
}

function createMarkerElement(
  pricePerAcre: number | null,
  acres: number | null,
  status: string | null,
  isAuctionToday: boolean,
  // When true, render the marker as a + button instead of a colored
  // dot — used in comparables mode (subjectTractId set). Click opens
  // the inline sale-info popup instead of the sidebar.
  asPlusButton: boolean = false,
): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'
  const isLive = isAuctionToday

  // In comp-mode + button: skip the price/acres label (popup shows it).
  if (!asPlusButton) {
    const label = document.createElement('div')
    label.className = 'comp-marker-label'

    if (pricePerAcre) {
      const priceEl = document.createElement('div')
      priceEl.className = 'comp-marker-price'
      priceEl.textContent = `${formatCurrency(pricePerAcre)}/ac`
      label.appendChild(priceEl)
    }
    if (acres) {
      const acresEl = document.createElement('div')
      acresEl.className = 'comp-marker-acres'
      acresEl.textContent = `${formatAcres(acres)} ac`
      label.appendChild(acresEl)
    }
    container.appendChild(label)
  }

  // Pulsing ring for live auctions
  if (isLive) {
    const pulseRing = document.createElement('div')
    pulseRing.style.cssText = `
      position: absolute;
      bottom: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid #22c55e;
      animation: livePulse 1.5s ease-out infinite;
    `
    container.appendChild(pulseRing)
    container.style.position = 'relative'

    // Add CSS animation if not already present
    if (!document.getElementById('live-pulse-style')) {
      const style = document.createElement('style')
      style.id = 'live-pulse-style'
      style.textContent = `
        @keyframes livePulse {
          0% { transform: translateX(-50%) scale(1); opacity: 0.8; }
          100% { transform: translateX(-50%) scale(2.5); opacity: 0; }
        }
      `
      document.head.appendChild(style)
    }
  }

  const pin = document.createElement('div')
  if (asPlusButton) {
    // Comp-mode "+" button — pseudo-element bars for pixel-perfect
    // centering. See .comp-marker-pin.plus-btn in ComparablesMap.css.
    pin.className = 'comp-marker-pin plus-btn'
  } else {
    pin.className = 'comp-marker-pin comparable'
    pin.style.backgroundColor = isLive ? '#22c55e' : getStatusPinColor(status)
  }
  container.appendChild(pin)

  return container
}

/**
 * Specialized marker for the always-on "today's auctions" green dots.
 * Returns a 14×14 element where the pin fills the entire box and the
 * label is absolute-positioned ABOVE it. This makes the element's
 * geometric center IDENTICAL to the pin's center, so MapLibre's default
 * 'center' anchor lands the green dot exactly at the lat/lng pixel —
 * no more constant-pixel-offset south of the real position at low zoom.
 *
 * Kept SEPARATE from createMarkerElement so the regular sales pins keep
 * their original flex-column layout untouched.
 */
function createTodayMarkerElement(
  pricePerAcre: number | null,
  acres: number | null,
): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'
  container.style.cssText = [
    'position: relative',
    'width: 14px',
    'height: 14px',
    'cursor: pointer',
  ].join(';')

  const label = document.createElement('div')
  label.className = 'comp-marker-label'
  label.style.cssText = [
    'position: absolute',
    'bottom: 100%',
    'left: 50%',
    'transform: translateX(-50%)',
    'margin-bottom: 6px',
    'pointer-events: none',
  ].join(';')

  if (pricePerAcre) {
    const priceEl = document.createElement('div')
    priceEl.className = 'comp-marker-price'
    priceEl.textContent = `${formatCurrency(pricePerAcre)}/ac`
    label.appendChild(priceEl)
  }
  if (acres) {
    const acresEl = document.createElement('div')
    acresEl.className = 'comp-marker-acres'
    acresEl.textContent = `${formatAcres(acres)} ac`
    label.appendChild(acresEl)
  }
  if (label.childElementCount > 0) {
    container.appendChild(label)
  }

  // Pulse ring — centered on the pin.
  const pulseRing = document.createElement('div')
  pulseRing.style.cssText = [
    'position: absolute',
    'top: 50%',
    'left: 50%',
    'width: 24px',
    'height: 24px',
    'border-radius: 50%',
    'border: 2px solid #22c55e',
    'animation: livePulseToday 1.5s ease-out infinite',
    'transform: translate(-50%, -50%)',
  ].join(';')
  container.appendChild(pulseRing)

  if (!document.getElementById('live-pulse-today-style')) {
    const style = document.createElement('style')
    style.id = 'live-pulse-today-style'
    style.textContent = `
      @keyframes livePulseToday {
        0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.8; }
        100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
      }
    `
    document.head.appendChild(style)
  }

  // Pin fills the entire container so the element's center == pin's center.
  const pin = document.createElement('div')
  pin.className = 'comp-marker-pin comparable'
  pin.style.cssText = [
    'position: absolute',
    'inset: 0',
    'width: 14px',
    'height: 14px',
    'border-radius: 50%',
    'border: 2px solid #ffffff',
    'background-color: #22c55e',
    'box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4)',
  ].join(';')
  container.appendChild(pin)

  return container
}

// ── Regrid parcel popup helpers ─────────────────────────────────────
// The popup renders inside a MapLibre Popup, so we build HTML strings
// instead of React. Three states:
//  - LOADING: skeleton showing the values we already have from the
//    vector tile (owner, address, parcelnumb) while the full record
//    streams in.
//  - SUCCESS: the rich Premium Schema record.
//  - FALLBACK: tile-only data when the API call fails.

function _fmtMoney(n: any): string | null {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  // Treat $0 the same as missing — a recorded $0 deed (family
  // transfer, LLC restructure, inheritance, quitclaim) isn't a market
  // sale price. Returning null lets the popup builder omit the row.
  if (!isFinite(v) || v === 0) return null
  return '$' + Math.round(v).toLocaleString('en-US')
}

function _fmtAcres(n: any): string | null {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  if (!isFinite(v) || v <= 0) return null
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' ac'
}

// "schuyler" → "Schuyler". Regrid stores county names lowercase; the
// header looks unprofessional that way.
function _titleCase(s: string): string {
  if (!s) return ''
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function _fmtDate(s: any): string | null {
  if (!s) return null
  const d = new Date(String(s))
  if (isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function _esc(s: any): string {
  if (s === null || s === undefined) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}

// ── New popup design — matches the comp-report "+" popup ─────────────
// Inline styles so the popup is fully self-contained (the old class-
// based CSS is gone — see ComparablesMap.css). Identical builder to
// the one in regridLayer.ts; the two copies coexist because ExploreMap
// mounts its OWN Regrid layer rather than using the shared helper. If
// you change one, change both — or fold into a shared module.

const _INSTRUMENT_LABELS: Record<string, string> = {
  WD: 'Warranty Deed', SWD: 'Special Warranty Deed', GWD: 'General Warranty Deed',
  QC: 'Quit Claim', QCD: 'Quit Claim Deed',
  TR: 'Trust Transfer', TRD: 'Trust Deed', TRUST: 'Trust Transfer',
  GFT: 'Gift Deed', GD: 'Gift Deed',
  TXD: 'Tax Deed', TAX: 'Tax Deed',
  CFD: 'Contract for Deed',
  PR: 'Personal Representative Deed', PRD: 'Personal Representative Deed',
  EXE: "Executor's Deed", ADM: "Administrator's Deed", SHF: "Sheriff's Deed",
  REL: 'Release', CD: 'Correction Deed',
  FORE: 'Foreclosure', AUC: 'Auction', ML: 'MLS',
}
function _fmtSaleType(raw: any): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  const code = s.toUpperCase().replace(/[^A-Z]/g, '')
  return _INSTRUMENT_LABELS[code] || s
}
function _firstNonEmpty(...vals: any[]): any {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}

const _POPUP_WIDTH = 320

function _popupShell(inner: string): string {
  return `<div style="background:#fff;color:#1a1a1a;width:${_POPUP_WIDTH}px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${inner}</div>`
}

function _popupHeader(opts: {
  label: string
  owner: string
  // Up to 3 subhead lines. Caller composes them (street, city/state/zip,
  // township, county) and passes only the non-empty ones.
  subheadLines: string[]
}): string {
  const { label, owner, subheadLines } = opts
  return `
    <div style="padding:14px 38px 12px 16px;background:linear-gradient(135deg,#1f1f23 0%,#2a2a30 100%);color:#fff;">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#F58CDE;margin-bottom:4px;">${_esc(label)}</div>
      <div style="font-size:14px;font-weight:700;line-height:1.3;color:#fff;word-wrap:break-word;">${_esc(owner)}</div>
      ${subheadLines.map((line, i) => {
        const isLast = i === subheadLines.length - 1
        const color = isLast ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.65)'
        const sz = isLast ? 11 : 12
        return `<div style="font-size:${sz}px;color:${color};margin-top:${i === 0 ? 4 : 2}px;line-height:1.3;">${_esc(line)}</div>`
      }).join('')}
    </div>
  `
}

function _detailRow(label: string, value: string): string {
  return `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:5px 0;font-size:12.5px;border-bottom:1px solid rgba(0,0,0,0.04);">
      <span style="color:#888;font-weight:500;">${_esc(label)}</span>
      <span style="color:#1a1a1a;font-weight:600;text-align:right;">${_esc(value)}</span>
    </div>
  `
}

function _section(title: string, rows: string[]): string {
  if (!rows.length) return ''
  return `
    <div style="padding:12px 16px 4px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#E91E8C;margin-bottom:4px;">${_esc(title)}</div>
      ${rows.join('')}
    </div>
  `
}

function _regridLoadingHTML(tileProps: any): string {
  const sub = tileProps?.address ? [tileProps.address] : []
  return _popupShell(
    _popupHeader({
      label: 'Parcel',
      owner: tileProps?.owner || 'Loading…',
      subheadLines: sub,
    }) +
    `<div style="padding:14px 16px;font-style:italic;color:rgba(0,0,0,0.5);font-size:12px;">Loading parcel details…</div>`,
  )
}

function _regridFallbackHTML(tileProps: any): string {
  const sub = tileProps?.address ? [tileProps.address] : []
  return _popupShell(_popupHeader({
    label: 'Parcel',
    owner: tileProps?.owner || 'Unknown',
    subheadLines: sub,
  }))
}

// Compact popup for a + pin on a Regrid parcel that has a saleprice.
// Mirrors the data the /api/map/parcels-with-sales endpoint returns.
function _parcelSalePopupHTML(p: any): string {
  const fmtMoney = (n: any) => {
    if (n === null || n === undefined) return '—'
    const v = Number(n)
    if (!isFinite(v)) return '—'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v)
  }
  const fmtDate = (s: any) => {
    if (!s) return '—'
    const d = new Date(s)
    if (isNaN(d.getTime())) return _esc(s)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  }
  const fmtAc = (n: any) => {
    if (n === null || n === undefined) return '—'
    const v = Number(n)
    if (!isFinite(v)) return '—'
    return v.toFixed(1) + ' ac'
  }
  const sub: string[] = []
  if (p?.address) sub.push(p.address)
  const locParts: string[] = []
  if (p?.county) locParts.push(p.county)
  if (p?.state) locParts.push(p.state)
  if (locParts.length) sub.push(locParts.join(', '))
  const rows: string[] = []
  rows.push(`<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:13px;"><span style="color:rgba(0,0,0,0.6);">Sale price</span><span style="font-weight:600;">${_esc(fmtMoney(p?.sale_price))}</span></div>`)
  rows.push(`<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:13px;"><span style="color:rgba(0,0,0,0.6);">Sale date</span><span>${_esc(fmtDate(p?.sale_date))}</span></div>`)
  if (p?.price_per_acre) {
    rows.push(`<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:13px;"><span style="color:rgba(0,0,0,0.6);">Price/acre</span><span>${_esc(fmtMoney(p.price_per_acre))}</span></div>`)
  }
  if (p?.total_acres) {
    rows.push(`<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:13px;"><span style="color:rgba(0,0,0,0.6);">Acres</span><span>${_esc(fmtAc(p.total_acres))}</span></div>`)
  }
  return _popupShell(
    _popupHeader({ label: 'Parcel sale', owner: p?.owner || 'Unknown', subheadLines: sub }) +
    `<div style="padding:8px 16px 14px;">${rows.join('')}</div>`,
  )
}

// Regrid puts the civil township as the 4th segment of the `path`
// property: "/us/<state>/<county>/<TOWNSHIP_SLUG>/<id>". Pull it
// out + title-case so "barnett" → "Barnett".
function _extractTownship(record: any): string {
  const path: unknown = record?.path
  if (typeof path !== 'string') return ''
  const parts = path.split('/').filter(Boolean)  // ['us','il','de-witt','barnett','5630']
  if (parts.length < 5) return ''
  const slug = parts[3] || ''
  if (!slug || slug === parts[2]) return ''  // avoid duplicating county
  return _titleCase(slug.replace(/-/g, ' '))
}

function _regridPopupHTML(record: any): string {
  const gisacre: number | null = record?.ll_gisacre ?? record?.gisacre ?? null
  const deeded = record?.deeded_acres
  const saleprice = record?.saleprice
  const saledate = record?.saledate
  const parval = record?.parval
  const landval = record?.landval
  const improvval = record?.improvval
  const yearbuilt = record?.yearbuilt
  // Use code → readable description. Regrid's `usedesc` is the human
  // label; `usecode` is the assessor code (numeric, useless to users).
  // If we only have a code, skip the row entirely rather than show a
  // mystery number. We DO accept usedesc values that happen to be
  // numeric strings only if they aren't a bare integer (some Regrid
  // datasets put a code there).
  const usedescRaw = record?.usedesc
  const usedesc = (typeof usedescRaw === 'string' && usedescRaw.trim() && !/^\d+$/.test(usedescRaw.trim()))
    ? usedescRaw.trim() : ''
  const zoningRaw = record?.zoning_description || record?.zoning || ''
  // Hide non-informative zoning values like "No Zoning", "NONE", "".
  const zoning = (typeof zoningRaw === 'string' && zoningRaw.trim() && !/^(no zoning|none|n\/a|na)$/i.test(zoningRaw.trim()))
    ? zoningRaw.trim() : ''
  const buildings = record?.ll_bldg_count
  const bldgSqft = record?.ll_bldg_footprint_sqft

  // Ownership history — Standard schema fields per Regrid Data
  // Dictionary v16. `previous_owner` is the prior grantor;
  // `last_ownership_transfer_date` covers any ownership change
  // (including non-arms-length transfers that lack a recorded
  // saleprice).
  const previousOwner = (typeof record?.previous_owner === 'string' && record.previous_owner.trim())
    ? record.previous_owner.trim() : ''
  const lastTransferDate = record?.last_ownership_transfer_date

  // Sale type / deed instrument — Regrid field naming varies wildly
  // across datasets. Cast a wide net; map common codes to labels via
  // _fmtSaleType, and otherwise show whatever string the field has.
  const saleType = _fmtSaleType(_firstNonEmpty(
    record?.salestype, record?.saletype, record?.sale_type,
    record?.recordtype, record?.record_type,
    record?.instrument, record?.instrumtyp, record?.instrumenttype,
    record?.legaldoc, record?.transrec, record?.deed_type,
    record?.deedtype, record?.s1deedtype, record?.deed,
  ))

  const county = _titleCase(record?.county || '')
  const state = record?.state2 || record?.state || ''
  // Append "County" to the county name when both are present
  // ("Schuyler, IL" → "Schuyler County, IL").
  const countyState = county
    ? `${county} County${state ? ', ' + state : ''}`
    : (state || '')

  // Township — extracted from the Regrid `path` field (more reliable
  // than the `city` slug, which Regrid sometimes reuses for the
  // township in rural areas but not consistently).
  const township = _extractTownship(record)

  // Build address subhead lines:
  //   - line 1: street address (when present)
  //   - line 2: "City, ST ZIP" using situs city (scity) → falls back
  //             to city slug → falls back to township
  //   - line 3: "<Township> Township" (when we have a township and
  //             it's NOT already the city we just printed)
  //   - line 4: "<County> County, ST"
  const street = (typeof record?.address === 'string' && record.address.trim())
    ? record.address.trim() : ''
  const cityRaw = record?.scity || record?.city || ''
  const cityLabel = typeof cityRaw === 'string' && cityRaw.trim()
    ? _titleCase(cityRaw.trim().replace(/-/g, ' '))
    : ''
  const zip = record?.szip5 || record?.szip || ''
  const cityLine = [cityLabel, state, zip].filter(Boolean).join(cityLabel && state ? ', ' : ' ')
    .replace(`${state}, ${zip}`, `${state} ${zip}`)  // "City, ST ZIP" not "City, ST, ZIP"
  const townshipLine = (township && township !== cityLabel) ? `${township} Township` : ''
  const subheadLines = [street, cityLine, townshipLine, countyState]
    .filter(s => s && s.trim())

  // Hero stat strip — only cells with values render
  const acresLabel = _fmtAcres(gisacre)
  const priceLabel = _fmtMoney(saleprice)
  const validSalePrice = typeof saleprice === 'number' && saleprice > 0
  const ppa = (validSalePrice && typeof gisacre === 'number' && gisacre > 0)
    ? saleprice / gisacre : null
  const ppaLabel = ppa != null ? '$' + Math.round(ppa).toLocaleString('en-US') : null

  const heroCells: { label: string; value: string; emphasize?: boolean }[] = []
  if (acresLabel) heroCells.push({ label: 'Acres', value: acresLabel })
  if (ppaLabel) heroCells.push({ label: '$ / Acre', value: ppaLabel, emphasize: true })
  if (priceLabel) heroCells.push({ label: 'Sale Price', value: priceLabel })

  const heroHTML = heroCells.length === 0 ? '' : (() => {
    const cellHTML = heroCells.map((c, i) => {
      const isFirst = i === 0
      const isLast = i === heroCells.length - 1
      const align = isFirst && !c.emphasize ? 'left'
        : isLast && !c.emphasize ? 'right'
        : 'center'
      return `
        <div style="flex:${c.emphasize ? 1.4 : 1};text-align:${align};border-left:${isFirst ? 'none' : '1px solid rgba(0,0,0,0.06)'};padding-left:${isFirst ? 0 : 8}px;padding-right:${isLast ? 0 : 8}px;">
          <div style="font-size:9.5px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${c.emphasize ? '#E91E8C' : '#888'};">${_esc(c.label)}</div>
          <div style="font-size:${c.emphasize ? 19 : 15}px;font-weight:${c.emphasize ? 800 : 700};color:#1a1a1a;margin-top:2px;letter-spacing:${c.emphasize ? -0.3 : 0}px;">${_esc(c.value)}</div>
        </div>
      `
    }).join('')
    return `<div style="display:flex;padding:14px 16px 12px;border-bottom:1px solid rgba(0,0,0,0.06);background:#fafbfc;">${cellHTML}</div>`
  })()

  // Detail sections — each filtered to populated rows only
  const lastSaleRows: string[] = []
  const dateStr = _fmtDate(saledate)
  if (dateStr) lastSaleRows.push(_detailRow('Sale Date', dateStr))
  if (saleType) lastSaleRows.push(_detailRow('Sale Type', saleType))
  // Last Transfer — only show when it's MEANINGFULLY different from
  // the sale date (avoids "Sale Date: Feb 2016 / Last Transfer: Feb
  // 2016" duplication). When there's no saleprice/saledate but a
  // transfer date exists, this is the only ownership-change signal.
  const lastTransferStr = _fmtDate(lastTransferDate)
  if (lastTransferStr && lastTransferStr !== dateStr) {
    lastSaleRows.push(_detailRow('Last Transfer', lastTransferStr))
  }
  if (previousOwner) lastSaleRows.push(_detailRow('Previous Owner', previousOwner))

  const propertyRows: string[] = []
  if (deeded && deeded !== gisacre && _fmtAcres(deeded)) {
    propertyRows.push(_detailRow('Deeded Acres', _fmtAcres(deeded)!))
  }
  if (usedesc) propertyRows.push(_detailRow('Use', String(usedesc)))
  if (zoning) propertyRows.push(_detailRow('Zoning', String(zoning)))

  const assessedRows: string[] = []
  if (_fmtMoney(parval)) assessedRows.push(_detailRow('Total', _fmtMoney(parval)!))
  if (_fmtMoney(landval)) assessedRows.push(_detailRow('Land', _fmtMoney(landval)!))
  if (_fmtMoney(improvval)) assessedRows.push(_detailRow('Improvements', _fmtMoney(improvval)!))

  const buildingRows: string[] = []
  if (buildings) buildingRows.push(_detailRow('Count', String(buildings)))
  if (bldgSqft) buildingRows.push(_detailRow('Footprint', `${Math.round(bldgSqft).toLocaleString()} sq ft`))
  if (yearbuilt) buildingRows.push(_detailRow('Year Built', String(yearbuilt)))

  // Add bottom padding to whatever the final visible section is so the
  // popup doesn't end flush against the last row.
  const bottomPad = `<div style="height:10px;"></div>`

  return _popupShell(
    _popupHeader({
      label: 'Parcel',
      owner: record?.owner || 'Unknown',
      subheadLines,
    }) +
    heroHTML +
    _section('Last Sale', lastSaleRows) +
    _section('Property', propertyRows) +
    _section('Assessed Value', assessedRows) +
    _section('Buildings', buildingRows) +
    bottomPad,
  )
}


// =====================================================================
// CompInlinePopup — Click-driven popup that opens when admin taps a "+"
// marker in comparables mode. Anchored at pixel-position of the marker
// (caller projects lat/lng → pixels). Three horizontal action buttons.
// X closes; Esc closes; 3D/Details stay open; Add to Report closes.
// =====================================================================

const FMT_USD_COMP = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const FMT_NUM_COMP = (n: number | null | undefined, digits = 1) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const FMT_DATE_COMP = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

function CompInlinePopup({
  sale, pos, isSelected,
  onClose, onView3D, onViewDetails, onAddToReport,
}: {
  sale: SaleDetail
  pos: { x: number; y: number }
  isSelected: boolean
  onClose: () => void
  onView3D: () => void
  onViewDetails: () => void
  onAddToReport: () => void
}) {
  // Esc closes the popup
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Anchor above the pin unless near the top of the viewport, then
  // anchor below. Clamp horizontally too.
  const POPUP_WIDTH = 300
  const ABOVE_HEIGHT = 340
  const showBelow = pos.y < ABOVE_HEIGHT
  const clampedX = typeof window !== 'undefined' ? Math.max(
    POPUP_WIDTH / 2 + 8,
    Math.min(pos.x, window.innerWidth - POPUP_WIDTH / 2 - 8),
  ) : pos.x

  const ppa = sale.pricePerAcre
  const rating = sale.soilRating

  // Headline = the property location/owner. Subhead = sale date.
  const locationLine = [sale.county, sale.state].filter(Boolean).join(', ') || 'Tract sale'
  const ownerLine = sale.companyName || null

  // Hero stats — only include cells that have a real value. The hero
  // row collapses gracefully (1/2/3 columns) so a tract missing one
  // figure (e.g. private sale w/ no salePrice) doesn't show a dash.
  const heroStats: { label: string; value: string; emphasize?: boolean }[] = []
  if (sale.totalAcres != null) {
    heroStats.push({ label: 'Acres', value: FMT_NUM_COMP(sale.totalAcres) })
  }
  if (ppa != null) {
    heroStats.push({ label: '$ / Acre', value: `$${FMT_NUM_COMP(ppa, 0)}`, emphasize: true })
  }
  if (sale.salePrice != null) {
    const priceLabel = sale.salePrice >= 1_000_000
      ? `$${(sale.salePrice / 1_000_000).toFixed(2)}M`
      : `$${(sale.salePrice / 1000).toFixed(0)}K`
    heroStats.push({ label: 'Sale price', value: priceLabel })
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: clampedX,
        top: pos.y,
        transform: showBelow
          ? 'translate(-50%, 22px)'
          : 'translate(-50%, calc(-100% - 22px))',
        background: '#fff',
        color: '#111',
        borderRadius: 14,
        boxShadow: '0 18px 48px rgba(0,0,0,0.32), 0 2px 6px rgba(0,0,0,0.08)',
        width: POPUP_WIDTH,
        zIndex: 1000,
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
      // Stop clicks inside the popup from bubbling to the map and
      // triggering the close-on-map-click handler.
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header — gradient band with location + close button. The
          pink/charcoal palette mirrors the rest of the site. */}
      <div style={{
        padding: '14px 16px 12px',
        background: 'linear-gradient(135deg, #1f1f23 0%, #2a2a30 100%)',
        color: '#fff',
        position: 'relative',
      }}>
        <div style={{
          display: 'flex', alignItems: 'flex-start',
          justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 1.2,
              textTransform: 'uppercase', color: '#F58CDE',
              marginBottom: 4,
            }}>
              Comparable sale
            </div>
            <div style={{
              fontSize: 16, fontWeight: 700, lineHeight: 1.25,
              color: '#fff',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {locationLine}
            </div>
            {sale.township && (
              <div style={{
                fontSize: 12, color: 'rgba(255,255,255,0.65)',
                marginTop: 2,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {sale.township}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              // Flex centering + an explicit text-align fixes the
              // visually-off "×" glyph (the character has a baseline
              // offset so plain text-centering leaves it slightly
              // low and right of true center).
              background: 'rgba(255,255,255,0.08)', border: 'none', cursor: 'pointer',
              fontSize: 18, lineHeight: 1, color: 'rgba(255,255,255,0.85)',
              padding: 0, width: 26, height: 26, borderRadius: 13,
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              textAlign: 'center',
            }}
          >×</button>
        </div>
      </div>

      {/* Hero stat — price / acre dominates when present. Empty cells
          are skipped entirely so we never show a "—" placeholder. */}
      {heroStats.length > 0 && (
        <div style={{
          display: 'flex',
          padding: '14px 16px 12px',
          borderBottom: '1px solid rgba(0,0,0,0.06)',
          background: '#fafbfc',
        }}>
          {heroStats.map((stat, i) => {
            const isFirst = i === 0
            const isLast = i === heroStats.length - 1
            return (
              <div
                key={stat.label}
                style={{
                  flex: stat.emphasize ? 1.4 : 1,
                  textAlign: isFirst && !stat.emphasize ? 'left'
                    : isLast && !stat.emphasize ? 'right'
                    : 'center',
                  borderLeft: isFirst ? 'none' : '1px solid rgba(0,0,0,0.06)',
                  paddingLeft: isFirst ? 0 : 8,
                  paddingRight: isLast ? 0 : 8,
                }}
              >
                <div style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8,
                  textTransform: 'uppercase',
                  color: stat.emphasize ? '#E91E8C' : '#888',
                }}>{stat.label}</div>
                <div style={{
                  fontSize: stat.emphasize ? 19 : 15,
                  fontWeight: stat.emphasize ? 800 : 700,
                  color: '#1a1a1a',
                  marginTop: 2,
                  letterSpacing: stat.emphasize ? -0.3 : 0,
                }}>{stat.value}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Secondary detail rows — each is rendered only when its value
          is present. Hides the whole section if nothing qualifies. */}
      {(sale.auctionDate || rating != null || ownerLine) && (
        <div style={{ padding: '12px 16px 14px' }}>
          {sale.auctionDate && (
            <CompPopupRow label="Sale date" value={FMT_DATE_COMP(sale.auctionDate)} />
          )}
          {rating != null && (
            <CompPopupRow label="Soil rating" value={FMT_NUM_COMP(rating)} />
          )}
          {ownerLine && (
            <CompPopupRow label="Owner" value={ownerLine} truncate />
          )}
        </div>
      )}

      {/* Action row — Add to Report is the primary CTA (filled pink).
          3D and Details are subtle secondary buttons. */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '10px 12px 12px',
        borderTop: '1px solid rgba(0,0,0,0.06)',
        background: '#fff',
      }}>
        <button
          onClick={onView3D}
          style={compPopupSecondaryBtn}
          title="View 3D terrain map"
          onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f7'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.18)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)' }}
        >
          <span style={{ fontSize: 14 }}>🏔</span>
          <span>3D</span>
        </button>
        <button
          onClick={onViewDetails}
          style={compPopupSecondaryBtn}
          title="View full listing details"
          onMouseEnter={(e) => { e.currentTarget.style.background = '#f5f5f7'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.18)' }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)' }}
        >
          <span style={{ fontSize: 14 }}>🔎</span>
          <span>Details</span>
        </button>
        <button
          onClick={onAddToReport}
          title={isSelected ? 'Remove from report' : 'Add to report'}
          style={{
            ...compPopupPrimaryBtn,
            background: isSelected
              ? 'linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)'
              : 'linear-gradient(135deg, #F58CDE 0%, #E91E8C 100%)',
            boxShadow: isSelected
              ? '0 4px 14px rgba(46, 125, 50, 0.35)'
              : '0 4px 14px rgba(233, 30, 140, 0.4)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.filter = 'brightness(1.05)' }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.filter = 'brightness(1)' }}
        >
          <span style={{ fontSize: 14 }}>{isSelected ? '✓' : '＋'}</span>
          <span>{isSelected ? 'Added' : 'Add to Report'}</span>
        </button>
      </div>
    </div>
  )
}

// One label/value row inside the popup body. Kept as a sub-component so
// the popup JSX above stays scannable.
function CompPopupRow({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      gap: 12, padding: '5px 0', fontSize: 12.5,
      borderBottom: '1px solid rgba(0,0,0,0.04)',
    }}>
      <span style={{ color: '#888', fontWeight: 500 }}>{label}</span>
      <span style={{
        color: '#1a1a1a', fontWeight: 600, textAlign: 'right',
        ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 } : {}),
      }}>{value}</span>
    </div>
  )
}

const compPopupSecondaryBtn: React.CSSProperties = {
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
  padding: '8px 10px',
  border: '1px solid rgba(0,0,0,0.12)',
  borderRadius: 8,
  background: '#fff',
  color: '#1a1a1a',
  fontSize: 12.5,
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
}

const compPopupPrimaryBtn: React.CSSProperties = {
  flex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '8px 12px',
  border: 'none',
  borderRadius: 8,
  color: '#fff',
  fontSize: 13,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'transform 0.15s, filter 0.15s, box-shadow 0.15s',
  letterSpacing: 0.2,
}
