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
  const [show3DViewer, setShow3DViewer] = useState(false)
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
  // Default ON for admins — parcels show automatically when zoomed in
  // past z13. Toggle preference is persisted in localStorage so a
  // deliberate "hide" stays hidden on the next visit.
  const [adminParcelOverlay, setAdminParcelOverlay] = useState(() => {
    if (typeof window === 'undefined') return true
    const v = localStorage.getItem('gg_admin_parcel_overlay')
    return v == null ? true : v === '1'
  })
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
          'fill-opacity': 0.08,
        },
      })
      map.addLayer({
        id: 'tract-polygon-line',
        type: 'line',
        source: 'tract-polygons',
        minzoom: TRACT_TIER_MIN,
        paint: {
          'line-color': '#E91E8C',
          'line-width': 2,
          'line-opacity': 0.8,
        },
      })
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
  const REGRID_MIN_ZOOM = 14
  const [regridConfig, setRegridConfig] = useState<{
    tile_url_template: string
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

    map.addSource(SOURCE_ID, {
      type: 'vector',
      tiles: [regridConfig.tile_url_template],
      minzoom: REGRID_MIN_ZOOM,
      maxzoom: 21,
      // ll_uuid is the stable Regrid parcel UUID we want to use for
      // setFeatureState (hover highlight) and click → API lookup.
      promoteId: { parcels: 'll_uuid' },
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
      'source-layer': 'parcels',
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
      'source-layer': 'parcels',
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
      'source-layer': 'parcels',
      minzoom: REGRID_MIN_ZOOM,
      layout: {
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
                'min-fraction-digits': 1, 'max-fraction-digits': 1,
              }],
              ' ac',
            ]],
            ['case',
              ['has', 'gisacre'],
              ['concat', '\n', ['concat',
                ['number-format', ['get', 'gisacre'], {
                  'min-fraction-digits': 1, 'max-fraction-digits': 1,
                }],
                ' ac',
              ]],
              '',
            ],
          ],
          { 'font-scale': 0.85 },
        ],
        'text-font': ['Open Sans Regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          14, 10,
          16, 12,
          18, 14,
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
    }, beforeId)

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
          { source: SOURCE_ID, sourceLayer: 'parcels', id: hoveredUuid },
          { hover: false },
        )
      }
      hoveredUuid = newUuid
      map.setFeatureState(
        { source: SOURCE_ID, sourceLayer: 'parcels', id: hoveredUuid },
        { hover: true },
      )
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      if (hoveredUuid) {
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer: 'parcels', id: hoveredUuid },
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

      const el = createMarkerElement(
        markerPpa,
        tract.total_acres,
        tract.sale_status,
        isAuctionToday,
      )

      // Z-order by status: live (today) > auction > sold > no_sale > listed.
      // The live tier is set to a very high z so the pulse sits above the
      // state + county badges and any other pin.
      // Stashed in a dataset so the report-highlight effect can restore it.
      const isLive = isAuctionToday
      const statusZ = String(getStatusPinZ(tract.sale_status, isLive))
      el.dataset.statusZ = statusZ
      el.style.zIndex = statusZ

      // Click to open modal or slide-out (portal mode)
      el.addEventListener('click', () => {
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
  }, [mapLoaded, tracts, todayTracts])

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

      {/* Admin Parcel Overlay Toggle — appears only for groundgoat_admin
          users when zoomed in past the parcel-detail threshold. Shows
          every parcel (boundary + owner + acres) sourced from free state
          GIS clearinghouses. Bottom-right placement (per user) so it's
          out of the way of the filter button group. */}
      {isAdmin && currentZoom >= ADMIN_PARCEL_MIN_ZOOM && (
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
          backgroundColor: '#111',
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
            <button
              onClick={() => setFilterOpen(false)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 22, cursor: 'pointer' }}
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
): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'
  const isLive = isAuctionToday

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
  pin.className = 'comp-marker-pin comparable'
  pin.style.backgroundColor = isLive ? '#22c55e' : getStatusPinColor(status)
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

function _fmtMoney(n: any): string {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  if (!isFinite(v)) return '—'
  return '$' + Math.round(v).toLocaleString('en-US')
}

function _fmtAcres(n: any): string {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' ac'
}

function _fmtDate(s: any): string {
  if (!s) return '—'
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

// Header block: owner (bold), acres directly beneath, then optional
// situs + county/state lines. Used by all three popup states.
function _regridHeaderHTML(opts: {
  owner: string
  acres: string | null
  address: string
  countyState: string
}): string {
  const { owner, acres, address, countyState } = opts
  return `
    <div class="regrid-popup-owner">${_esc(owner)}</div>
    ${acres ? `<div class="regrid-popup-acres">${acres}</div>` : ''}
    ${address ? `<div class="regrid-popup-addr">${_esc(address)}</div>` : ''}
    ${countyState ? `<div class="regrid-popup-addr regrid-popup-addr-sub">${_esc(countyState)}</div>` : ''}
  `
}

function _regridLoadingHTML(tileProps: any): string {
  // Tile fields don't carry acres — header just has owner + address
  // until the API call lands.
  return `
    <div class="regrid-popup">
      ${_regridHeaderHTML({
        owner: tileProps?.owner || 'Loading…',
        acres: null,
        address: tileProps?.address || '',
        countyState: '',
      })}
      <div class="regrid-popup-loading">Loading parcel details…</div>
    </div>
  `
}

function _regridFallbackHTML(tileProps: any): string {
  // API failed — show just what the tile carried. No parcel-ID row,
  // no attribution line (those live in the map's attribution control).
  return `
    <div class="regrid-popup">
      ${_regridHeaderHTML({
        owner: tileProps?.owner || 'Unknown',
        acres: null,
        address: tileProps?.address || '',
        countyState: '',
      })}
    </div>
  `
}

function _regridPopupHTML(record: any): string {
  const gisacre = record?.ll_gisacre ?? record?.gisacre
  const deeded = record?.deeded_acres
  const saleprice = record?.saleprice
  const saledate = record?.saledate
  const parval = record?.parval
  const landval = record?.landval
  const improvval = record?.improvval
  const yearbuilt = record?.yearbuilt
  const usedesc = _esc(record?.usedesc || record?.usecode || '')
  const zoning = _esc(record?.zoning_description || record?.zoning || '')
  const buildings = record?.ll_bldg_count
  const bldgSqft = record?.ll_bldg_footprint_sqft
  const mailadd = _esc(record?.mailadd || '')

  const row = (label: string, value: string) =>
    `<div class="regrid-popup-row"><span>${label}</span><span>${value}</span></div>`

  const county = record?.county || ''
  const state = record?.state2 || record?.state || ''
  const countyState = [county, state].filter(Boolean).join(', ')

  return `
    <div class="regrid-popup">
      ${_regridHeaderHTML({
        owner: record?.owner || 'Unknown',
        acres: gisacre ? _fmtAcres(gisacre) : null,
        address: record?.address || '',
        countyState,
      })}
      ${(deeded && deeded !== gisacre) || usedesc || zoning ? `
        <div class="regrid-popup-section">
          ${deeded && deeded !== gisacre ? row('Deeded Acres', _fmtAcres(deeded)) : ''}
          ${usedesc ? row('Use', usedesc) : ''}
          ${zoning ? row('Zoning', zoning) : ''}
        </div>` : ''}
      ${(saleprice || saledate) ? `
        <div class="regrid-popup-section">
          <div class="regrid-popup-section-title">Last Sale</div>
          ${saleprice ? row('Price', _fmtMoney(saleprice)) : ''}
          ${saledate ? row('Date', _fmtDate(saledate)) : ''}
        </div>` : ''}
      ${(parval || landval || improvval) ? `
        <div class="regrid-popup-section">
          <div class="regrid-popup-section-title">Assessed Value</div>
          ${parval ? row('Total', _fmtMoney(parval)) : ''}
          ${landval ? row('Land', _fmtMoney(landval)) : ''}
          ${improvval ? row('Improvements', _fmtMoney(improvval)) : ''}
        </div>` : ''}
      ${(buildings || bldgSqft || yearbuilt) ? `
        <div class="regrid-popup-section">
          <div class="regrid-popup-section-title">Buildings</div>
          ${buildings ? row('Count', String(buildings)) : ''}
          ${bldgSqft ? row('Footprint', `${Math.round(bldgSqft).toLocaleString()} sq ft`) : ''}
          ${yearbuilt ? row('Year Built', String(yearbuilt)) : ''}
        </div>` : ''}
      ${mailadd ? `
        <div class="regrid-popup-section">
          <div class="regrid-popup-section-title">Mailing Address</div>
          <div class="regrid-popup-mailadd">${mailadd}</div>
        </div>` : ''}
    </div>
  `
}
