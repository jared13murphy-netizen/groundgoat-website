'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol as PMTilesProtocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ComparablesMap.css'
import './TractMap.css'
import type { ApiMapTract, MapTractsResponse, OwnerParcelsResponse } from './exploreMapTypes'
import { normalizeTownship } from '../../utils/normalizeTownship'
import {
  buildExplorePolygonGeoJSON,
  buildExplorePointGeoJSON,
  buildTodayPointGeoJSON,
} from './exploreMapTransform'
import {
  MAP_CENTER,
  MAP_INITIAL_ZOOM,
  TILE_URL,
  TILE_ATTRIBUTION,
  GLYPH_URL,
  LABEL_TILE_URL,
  STATUS_COLORS,
  derivePinStatus,
} from './mapConstants'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { formatAcres } from '@/lib/format'
import { SOIL_FILTER_ENABLED, TILLABLE_FILTER_ENABLED } from '@/lib/featureFlags'
import { shouldHideParcelDotsForFilters } from '@/lib/parcelDotsFilterGate'
import { toRings as toTractRings, ringsToGeometry, pointInBoundary } from '@/lib/polygonRings'
import Tract3DModal from '@/components/Tract3DModal'
import GroundTruthPanel from '@/components/portal/GroundTruthPanel'
import NdviPanel from '@/components/portal/NdviPanel'
import LandDetailPanel, { type LandDetailClickData } from './LandDetailPanel'
import { countyCentroids } from '@/data/countyCentroids'
import { getCountiesForState } from '@/data/counties'
import { STATE_ABBR, STATE_BOUNDS } from './mapConstants'
// buildRegridParcelFilter / RegridFilterInput are no longer imported here:
// the Regrid parcel layers are unfiltered by design as of 2026-07-30 (see
// the setFilter effect below). Only the layer-id list is still needed.
import { REGRID_PARCEL_LAYER_IDS } from '@/lib/regridParcelFilter'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// Empty FeatureCollection used to initialize native GeoJSON sources
// before their setData effects fire.
const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

// Native marker layers, bottom-to-top. Lifted to the top of the stack
// (in this order) whenever the tract-polygon layers are moved to the top
// elsewhere, so pins/labels always render ABOVE the polygon fills.
const MARKER_LAYERS_BOTTOM_TO_TOP = [
  'county-labels',
  'county-count-circles',
  'county-count-labels',
  // Regrid sale "+"/dot markers sit BELOW the tract pins (task #26 z-order
  // invariant: tract always wins the click when both are under the point).
  // parcel-sale-dots-durable-circle (the continuous durable dot layer,
  // owner directive 2026-07-04) is listed first so it ends up just below
  // parcel-sale-pin-plus — same relative order the two had before, now
  // both guaranteed to stay above tract-polygon-fill/-line whenever those
  // get lifted (previously this list didn't include the durable layer at
  // all, so it could drift below a freshly-lifted tract polygon).
  // Each dot's companion "+" SYMBOL layer is listed immediately above its
  // own circle so the glyph paints on top of the (opaque) circle instead of
  // being covered by it — parcel-sale-dots-durable-symbol here, and
  // tract-pin-plus at the top of the tract-pin group below.
  'parcel-sale-dots-durable-circle',
  'parcel-sale-dots-durable-symbol',
  'parcel-sale-pin-plus',
  'tract-pin-circles',
  'tract-pin-labels',
  'tract-pin-plus',
  // Today's-auction green dots sit ABOVE the regular pins (pulse halo first,
  // then the solid core on top of its own halo).
  'today-pin-pulse',
  'today-pin-core',
  // Owner "show on map" chat-search dots — distinct blue, sits above
  // everything else so a searched owner's parcels are never hidden
  // under a freshly-lifted tract polygon.
  'owner-parcels-dots',
]
function liftMarkerLayers(map: maplibregl.Map) {
  for (const id of MARKER_LAYERS_BOTTOM_TO_TOP) {
    if (map.getLayer(id)) {
      try { map.moveLayer(id) } catch {/* mid-teardown */}
    }
  }
}

// Shared click-arbitration guard (task #26 — one click, one panel). Every
// map layer whose onClick can open a detail panel MUST check whether a
// HIGHER-priority layer also sits under the click point before opening its
// own panel; if so it defers to that layer's own handler. Priority order
// (highest first): tract (pin or polygon) > sale dot > parcel fill >
// overlays. Existence-filters layerIds first (queryRenderedFeatures throws
// on a layer id that isn't currently registered), then does one
// queryRenderedFeatures call. Used by BOTH the Regrid parcel-fill onClick
// and the parcel-sale-pin-plus onClick so the two guards can't drift.
// EVERY sale-dot layer, in one place. The priority order documented above is
// "tract > sale dot > parcel fill", but the durable dot's two layers were
// missing from the parcel-fill guard and from the comp-popup auto-close
// guard — only the older `parcel-sale-pin-plus` was listed. So a click on a
// durable dot ran BOTH handlers: the dot's own handler opened the comp
// popup, then the parcel-fill handler (which never deferred) immediately
// ran setCompPopup(null) and opened LandDetailPanel over the top. The
// symptom the owner reported 2026-08-05 — clicking a "+" in comp mode gives
// the parcel panel, which has no "Add to Report" button, so a comparable
// cannot be added at all.
//
// Same omission the z-order list above had to fix ("previously this list
// didn't include the durable layer at all"). Anything that needs to defer to
// a sale dot must use THIS constant, never a hand-written subset.
const SALE_DOT_LAYERS = [
  'parcel-sale-pin-plus',
  'parcel-sale-dots-durable-circle',
  'parcel-sale-dots-durable-symbol',
]

function clickClaimedByLayers(
  map: maplibregl.Map,
  point: maplibregl.PointLike,
  layerIds: string[],
): boolean {
  const existing = layerIds.filter(id => map.getLayer(id))
  if (!existing.length) return false
  try {
    return map.queryRenderedFeatures(point, { layers: existing }).length > 0
  } catch {
    return false // layer torn down mid-click
  }
}

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

// Data-driven `circle-color` for the native tract-pin-circles layer.
// A MapLibre `match` over the `status` property using the EXACT same
// PIN_COLORS the old DOM pins used. Built once from PIN_COLORS so the
// two can never drift. Fallback = DEFAULT_PIN_COLOR (NULL/unknown).
function buildPinColorMatchExpression(): any {
  const expr: any[] = ['match', ['get', 'status']]
  for (const [status, color] of Object.entries(PIN_COLORS)) {
    expr.push(status, color)
  }
  expr.push(DEFAULT_PIN_COLOR)
  return expr
}

// ───────────────────────────────────────────────────────────────
// Dark rounded-pill sprite used behind county/state names. MapLibre
// symbol layers have no native text-background, so we register a
// 9-slice stretchable image and draw it with icon-image +
// icon-text-fit:'both'. The `content` + `stretchX/Y` describe the
// non-corner regions so corners stay crisp while the middle stretches.
// Matches the dark .aem-county-square look (dark fill, pink border).
// ───────────────────────────────────────────────────────────────
function makePillSprite(opts: { border: string }): {
  image: { width: number; height: number; data: Uint8Array }
  options: any
} {
  const W = 32
  const H = 32
  const r = 8
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const inset = 1.5
  const x = inset
  const y = inset
  const w = W - inset * 2
  const h = H - inset * 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fillStyle = 'rgba(15,15,18,0.86)'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = opts.border
  ctx.stroke()
  const img = ctx.getImageData(0, 0, W, H)
  return {
    image: { width: W, height: H, data: new Uint8Array(img.data.buffer) },
    options: {
      pixelRatio: 2,
      // The stretchable middle band (everything but the rounded corners).
      content: [r + 2, r + 2, W - r - 2, H - r - 2],
      stretchX: [[r + 2, W - r - 2]],
      stretchY: [[r + 2, H - r - 2]],
    },
  }
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
  // Ring-shape-agnostic: a tract has a boundary if polygon_coordinates
  // normalizes to at least one ring with >=3 points, whether it's a
  // single flat ring or a multi-piece list of rings. A raw
  // `.length < 3` check on the outer array wrongly rejected multi-ring
  // tracts (2 rings < 3 → dropped from the map entirely).
  if (!toTractRings(t.polygon_coordinates).some(r => r.length >= 3)) {
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
// 3-tier zoom bands. State tier uses DOM SVG silhouette badges
// (z ≤ STATE_TIER_MAX). County tier uses native symbol layer
// (COUNTY_TIER_MIN..TRACT_TIER_MIN). Tract tier uses native
// circle+symbol layers (z ≥ TRACT_TIER_MIN).
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
  polygonCoordinates?: [number, number][] | [number, number][][] | null
  saleStatus?: string | null
  listingType?: string | null
  askingPrice?: number | null
  // 'sold' when pricePerAcre is sale-based, 'asking' when it's asking-based.
  // Always rendered as a tag so the two can never be confused.
  priceBasis?: 'sold' | 'asking' | null
  landType?: string | null
  landTypes?: string[] | null
  pctTillable?: number | null
  pricePerTillableAcre?: number | null
  pricePerSoilRating?: number | null
  sourceUrl?: string | null
  // Recorded county-recorder deed(s) folded into this tract because a
  // Regrid parcel-sale-dot's centroid sits inside the tract's own
  // polygon (comp-map coincident-dot collapse — see
  // recomputeCoincidentDeeds below). Undefined/empty = no underlying
  // deed, omit the section entirely.
  deeds?: RecordedDeed[]
}

// One county-recorder deed transfer folded under a GG tract because its
// Regrid parcel-sale-dot centroid landed inside the tract's polygon.
// acres/saleprice/saledate/pricePerAcre come straight off the durable dot
// payload (instant); owner is read synchronously off the live Regrid
// TILE feature at the dot's point (queryRenderedFeatures — see
// recomputeCoincidentDeeds) and is null + ownerLoading=true until that
// tile is loaded. (NOT /api/regrid/parcel?ll_uuid= — verified live to
// 404 for every durable-dot uuid.)
export interface RecordedDeed {
  ll_uuid: string
  saleprice: number | null
  saledate: string | null
  acres: number | null
  owner: string | null
  ownerLoading: boolean
}

// Value-equality for two Set<string>s — used by recomputeCoincidentDeeds
// to detect "nothing actually changed" so a repeat pass (idle/sourcedata
// retry with no new information) can skip every map mutation instead of
// re-running setData/setFeatureState unconditionally (AUDIT FIX, HIGH:
// an unconditional setData inside an idle-driven recompute re-fired
// 'idle' itself, an infinite idle -> recompute -> setData -> idle loop).
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const v of Array.from(a)) {
    if (!b.has(v)) return false
  }
  return true
}

// Value-equality for two deed lists (same order, same field values).
// durableDotsByIdRef / tractMapRef are both append-only accumulators
// (Map iteration order is insertion order and never reshuffles), so the
// SAME set of coincident dots always produces its per-tract array in the
// SAME relative order across recompute passes — a plain index-wise
// compare is safe, no need to sort or key-match first.
function recordedDeedsEqual(a: RecordedDeed[] | undefined, b: RecordedDeed[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.ll_uuid !== y.ll_uuid ||
      x.saleprice !== y.saleprice ||
      x.saledate !== y.saledate ||
      x.acres !== y.acres ||
      x.owner !== y.owner ||
      x.ownerLoading !== y.ownerLoading
    ) return false
  }
  return true
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
  if (SOIL_FILTER_ENABLED && filters.soilRatingMin) params.soil_rating_min = filters.soilRatingMin
  if (SOIL_FILTER_ENABLED && filters.soilRatingMax) params.soil_rating_max = filters.soilRatingMax
  if (filters.acreageMin) params.acreage_min = filters.acreageMin
  if (filters.acreageMax) params.acreage_max = filters.acreageMax
  // Gated (unlike soil): the control is hidden, so a lingering value the user
  // can't see or clear must not keep filtering — it would blank the parcel
  // dots and drop the county circles to tract-only counts.
  if (TILLABLE_FILTER_ENABLED && filters.pctTillableMin) params.pct_tillable_min = filters.pctTillableMin
  if (TILLABLE_FILTER_ENABLED && filters.pctTillableMax) params.pct_tillable_max = filters.pctTillableMax
  if (filters.landTypes?.length > 0) params.land_types = filters.landTypes.join(',')
  // Chat-driven additions
  if (filters.listingType) params.listing_type = filters.listingType
  if (filters.pricePerAcreMin) params.price_per_acre_min = filters.pricePerAcreMin
  if (filters.pricePerAcreMax) params.price_per_acre_max = filters.pricePerAcreMax
  if (filters.salePriceMin) params.sale_price_min = filters.salePriceMin
  if (filters.salePriceMax) params.sale_price_max = filters.salePriceMax
  if (filters.askingPriceMin) params.asking_price_min = filters.askingPriceMin
  if (filters.askingPriceMax) params.asking_price_max = filters.askingPriceMax
  if (SOIL_FILTER_ENABLED && filters.pricePerSoilRatingMin) params.price_per_soil_rating_min = filters.pricePerSoilRatingMin
  if (SOIL_FILTER_ENABLED && filters.pricePerSoilRatingMax) params.price_per_soil_rating_max = filters.pricePerSoilRatingMax
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
  ]
  // Acreage floor + the user's Acreage filter range. The baseline floor
  // (minAcres) hides tiny non-comp parcels; the user's acreageMin/Max
  // from the Filters panel narrows further. We fold the user's min into
  // the floor (take the larger) and apply the user's max as a ceiling.
  // Without this the "+" comp pins ignored the Acreage filter entirely
  // even though the parcel labels/fill respected it.
  const userAcresMin = filters.acreageMin ? parseFloat(filters.acreageMin) : NaN
  const userAcresMax = filters.acreageMax ? parseFloat(filters.acreageMax) : NaN
  const effectiveMin = Math.max(
    minAcres > 0 ? minAcres : 0,
    Number.isFinite(userAcresMin) ? userAcresMin : 0,
  )
  const hasMaxAcres = Number.isFinite(userAcresMax)
  // The parcel's acreage value, guarding against maplibre's to-number(null)
  // → 0 (see the ['has', ...] note above): falls back through ll_gisacre →
  // gisacre, and yields -1 when neither is present so any active acre
  // guard fails (we don't want acreage-less parcels passing a max/min).
  const acreVal: any = ['case',
    ['has', 'll_gisacre'], ['to-number', ['get', 'll_gisacre']],
    ['has', 'gisacre'], ['to-number', ['get', 'gisacre']],
    -1,
  ]
  if (effectiveMin > 0) {
    expr.push(['any', ['has', 'll_gisacre'], ['has', 'gisacre']])
    expr.push(['>=', acreVal, effectiveMin])
  }
  if (hasMaxAcres) {
    expr.push(['any', ['has', 'll_gisacre'], ['has', 'gisacre']])
    expr.push(['<=', acreVal, userAcresMax])
  }
  // Date window — apply from/to when the user set a timeframe preset,
  // otherwise no date floor. (This used to be described as matching the
  // parcel LABEL layer; since 2026-07-30 the label/fill/line layers carry
  // no user filter at all, so the dots are now the only thing a date
  // window narrows.)
  //
  // There is intentionally NO hardcoded 3-year floor anymore. The old
  // floor hid every parcel whose sale was older than 3 years even though
  // its sale-date label was still drawn on the map — so on "All time"
  // (almost all sales > 3 yrs old) the dots vanished entirely while the
  // labels showed. The dots must mark every priced parcel the labels do.
  if (from) {
    expr.push(['>=', ['coalesce', ['get', 'saledate'], ''], from])
  }
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

// Canvas-drawn pink dot used as the Regrid parcel-sale marker icon. We
// use a SYMBOL layer with this icon (one per polygon centroid) instead
// of a `circle` layer — a circle layer bound to a polygon source draws a
// dot at every vertex, which traced the parcel boundary lines with dots.
// The pink fill + white ring deliberately matches the Sold tract HTML
// pins (.comp-marker-pin, background #f58cde) so the two look identical
// on the explore map. In comparables mode we overlay a white "+" on top.
const PARCEL_SALE_DOT_IMAGE = 'parcel-sale-dot'
function ensureParcelSaleDotImage(map: maplibregl.Map) {
  if (map.hasImage(PARCEL_SALE_DOT_IMAGE)) return
  const size = 36 // rendered at pixelRatio 2 → 18px at icon-size 1
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const c = size / 2
  ctx.beginPath()
  ctx.arc(c, c, c - 4, 0, Math.PI * 2)
  ctx.fillStyle = '#f58cde' // == PIN_COLORS.sold
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  const img = ctx.getImageData(0, 0, size, size)
  try { map.addImage(PARCEL_SALE_DOT_IMAGE, img, { pixelRatio: 2 }) } catch {/* added by a racing call */}
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
  /** Task #26 (one click, one panel): fires whenever this map opens its
      own parcel/land detail panel (setLandDetail non-null). In portalMode
      the Tract Detail slide-out lives in the PARENT page's own state
      (selectedTract, driven by onTractSelected) — this map has no way to
      close that panel itself, so the parent must be told to close it. */
  onLandDetailOpen?: () => void
  onToggleReport?: (tract: SaleDetail) => void
  onView3DTerrain?: (tractId: string, tractName: string) => void
  isInReport?: (tractId: string) => boolean
  reportIds?: Set<string>
  onFiltersApplied?: (filters: { stateFilter: string; countyFilters: string[] }) => void
  zoomToLocation?: { lat: number; lng: number; zoom: number } | null
  /** Fit the map to a polygon's bounds. Bumped via `nonce` so the same
      coords retrigger if the user clicks the same listing/tract twice.
      `coords` is a single ring OR a list of rings (multi-piece tract) —
      see toRings in @/lib/polygonRings. */
  zoomToBoundsSignal?: { coords: [number, number][] | [number, number][][]; nonce: number } | null
  /** Polygon to overlay even if the tract isn't in the map's filter
      set — set when the user picks a tract from a slide-out so its
      boundary always shows up after a zoom-to-tract action. Same
      single-ring-or-list-of-rings shape as zoomToBoundsSignal.coords. */
  pinnedTractPolygon?: { id: string; coords: [number, number][] | [number, number][][] } | null
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
  /** Fires when the post-chat-search wide-bbox tract fetch settles with
      no usable result — either zero matches (kind 'info') or the fetch
      itself failing (kind 'err') — after the chat-filter call itself
      already succeeded and the user saw a "Filters applied" toast.
      Without this the map silently never updates and the user has no
      idea the search didn't actually load results. Not called for
      AbortError (a superseded query). kind defaults to 'err' when
      omitted by an older caller. */
  onChatSearchError?: (message: string, kind?: 'info' | 'err') => void
  /** Owner "show on map" chat-search result. Renders `dots` as a
      distinct-blue native circle layer, zooms to `bbox`, and shows a
      dismissible chip built from `reply`. `nonce` retriggers the
      fitBounds even if the same owner is searched twice in a row. */
  ownerParcelsResult?: { data: OwnerParcelsResponse; reply: string; nonce: number } | null
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

// ── CDL_PALETTE — USDA Cropland Data Layer code → {name, color} ─────────────
// Source: USDA NASS official CDL legend + audubon_FSA_fields.html color mapping.
// Code 0 / null = no data → rendered transparent (handled in buildCropColorExpr).
const CDL_PALETTE: Record<number, { name: string; color: string }> = {
  1:   { name: 'Corn',                  color: '#FFD400' },
  2:   { name: 'Cotton',                color: '#FF2626' },
  3:   { name: 'Rice',                  color: '#00A8E2' },
  4:   { name: 'Sorghum',               color: '#FF9E0C' },
  5:   { name: 'Soybeans',              color: '#267000' },
  6:   { name: 'Sunflower',             color: '#FFFF00' },
  10:  { name: 'Peanuts',               color: '#267000' },
  11:  { name: 'Tobacco',               color: '#70A800' },
  12:  { name: 'Sweet Corn',            color: '#FFA8A8' },
  13:  { name: 'Pop/Orn Corn',          color: '#FFD400' },
  14:  { name: 'Mint',                  color: '#7AF5CA' },
  21:  { name: 'Barley',                color: '#E2007C' },
  22:  { name: 'Durum Wheat',           color: '#B56B00' },
  23:  { name: 'Spring Wheat',          color: '#D8B56B' },
  24:  { name: 'Winter Wheat',          color: '#A87000' },
  25:  { name: 'Other Small Grains',    color: '#D2CCC2' },
  26:  { name: 'Dbl Crop WinWht/Soybeans', color: '#D1FF00' },
  27:  { name: 'Rye',                   color: '#AC007C' },
  28:  { name: 'Oats',                  color: '#A05989' },
  29:  { name: 'Millet',                color: '#70A800' },
  30:  { name: 'Speltz',                color: '#D2CCC2' },
  31:  { name: 'Canola',                color: '#D1FF00' },
  32:  { name: 'Flaxseed',              color: '#7F7FFF' },
  33:  { name: 'Safflower',             color: '#BFBF77' },
  34:  { name: 'Rape Seed',             color: '#D1FF00' },
  35:  { name: 'Mustard',               color: '#D1FF00' },
  36:  { name: 'Alfalfa',               color: '#FFA8E3' },
  37:  { name: 'Other Hay/Non Alfalfa', color: '#A5F28C' },
  38:  { name: 'Camelina',              color: '#D1FF00' },
  39:  { name: 'Buckwheat',             color: '#D2CCC2' },
  41:  { name: 'Sugarbeets',            color: '#A800E4' },
  42:  { name: 'Dry Beans',             color: '#A87000' },
  43:  { name: 'Potatoes',              color: '#702600' },
  44:  { name: 'Other Crops',           color: '#CC9999' },
  45:  { name: 'Sugarcane',             color: '#267000' },
  46:  { name: 'Sweet Potatoes',        color: '#702600' },
  47:  { name: 'Misc Vegs & Fruits',    color: '#FF6666' },
  48:  { name: 'Watermelons',           color: '#FF6666' },
  49:  { name: 'Onions',                color: '#FFCC66' },
  50:  { name: 'Cucumbers',             color: '#FF6666' },
  51:  { name: 'Chick Peas',            color: '#D2CCC2' },
  52:  { name: 'Lentils',               color: '#D2CCC2' },
  53:  { name: 'Peas',                  color: '#267000' },
  54:  { name: 'Tomatoes',              color: '#FF6666' },
  55:  { name: 'Caneberries',           color: '#FF6666' },
  56:  { name: 'Hops',                  color: '#267000' },
  57:  { name: 'Herbs',                 color: '#267000' },
  58:  { name: 'Clover/Wildflowers',    color: '#A5F28C' },
  59:  { name: 'Sod/Grass Seed',        color: '#A5F28C' },
  61:  { name: 'Fallow/Idle Cropland',  color: '#BFBF77' },
  63:  { name: 'Forest',                color: '#93CC93' },
  64:  { name: 'Shrubland',             color: '#C6D69C' },
  65:  { name: 'Barren',                color: '#CCBEA3' },
  81:  { name: 'Clouds/No Data',        color: '#999999' },
  82:  { name: 'Developed',             color: '#D3D3D3' },
  83:  { name: 'Water',                 color: '#4970A3' },
  87:  { name: 'Wetlands',              color: '#7CB3D6' },
  111: { name: 'Open Water',            color: '#4970A3' },
  112: { name: 'Perennial Ice/Snow',    color: '#E8E8E8' },
  121: { name: 'Developed/Open Space',  color: '#D3D3D3' },
  122: { name: 'Developed/Low Intensity', color: '#D3D3D3' },
  123: { name: 'Developed/Med Intensity', color: '#D3D3D3' },
  124: { name: 'Developed/High Intensity', color: '#D3D3D3' },
  131: { name: 'Barren',                color: '#CCBEA3' },
  141: { name: 'Deciduous Forest',      color: '#93CC93' },
  142: { name: 'Evergreen Forest',      color: '#93CC93' },
  143: { name: 'Mixed Forest',          color: '#93CC93' },
  152: { name: 'Shrubland',             color: '#C6D69C' },
  176: { name: 'Grassland/Pasture',     color: '#E8FFBF' },
  190: { name: 'Woody Wetlands',        color: '#7CAFAF' },
  195: { name: 'Herbaceous Wetlands',   color: '#7CB3D6' },
}

// Legend rows shown in the CSB overlay legend (ordered for ag relevance).
const CDL_LEGEND_ROWS: { code: number; name: string; color: string }[] = [
  { code: 1,   name: 'Corn',                  color: '#FFD400' },
  { code: 5,   name: 'Soybeans',              color: '#267000' },
  { code: 24,  name: 'Winter Wheat',          color: '#A87000' },
  { code: 23,  name: 'Spring Wheat',          color: '#D8B56B' },
  { code: 36,  name: 'Alfalfa',               color: '#FFA8E3' },
  { code: 37,  name: 'Other Hay',             color: '#A5F28C' },
  { code: 176, name: 'Grassland/Pasture',     color: '#E8FFBF' },
  { code: 61,  name: 'Fallow/Idle',           color: '#BFBF77' },
  { code: -1,  name: 'Other Crops',           color: '#999999' },
]

/** Build a MapLibre fill-color expression for the CSB fields layer keyed on cdlYYYY. */
function buildCropColorExpr(year: number): any {
  const prop = `cdl${year}`
  // Use 'case': code 0 or null → transparent; otherwise match against palette.
  const matchExpr: any[] = ['match', ['coalesce', ['get', prop], 0]]
  for (const [code, { color }] of Object.entries(CDL_PALETTE)) {
    matchExpr.push(Number(code), color)
  }
  // match fallback: unknown codes → Other Crops color.
  matchExpr.push('#999999')
  // Outer case: zero/null → transparent; non-zero → matched color.
  return [
    'case',
    ['<=', ['coalesce', ['get', prop], 0], 0],
    'rgba(0,0,0,0)',
    matchExpr,
  ]
}

// ── OverlayButton — mutually-exclusive overlay row in the Layers panel ──────
function OverlayButton({
  active,
  label,
  swatchGradient,
  swatchColor,
  onClick,
}: {
  active: boolean
  label: string
  swatchGradient?: string
  swatchColor?: string
  onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const base: Record<string, string | number> = active
    ? {
        background: 'linear-gradient(135deg,#E91E8C 0%,#c4186f 100%)',
        border: '1px solid #E91E8C',
        color: '#fff',
        boxShadow: '0 2px 10px rgba(233,30,140,0.40)',
      }
    : hovered
    ? {
        background: 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.22)',
        color: 'rgba(255,255,255,0.80)',
      }
    : {
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.15)',
        color: 'rgba(255,255,255,0.55)',
      }
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 32,
        borderRadius: 7,
        padding: '0 9px',
        fontSize: 11,
        fontWeight: 500,
        cursor: 'pointer',
        gap: 7,
        transition: 'background 0.12s, border-color 0.12s, color 0.12s',
        ...base,
      }}
    >
      <span style={{
        width: 12,
        height: 12,
        borderRadius: 3,
        flexShrink: 0,
        ...(swatchGradient ? { background: swatchGradient } : { backgroundColor: swatchColor }),
      }} />
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 10, opacity: active ? 1 : 0, transition: 'opacity 0.12s' }}>✓</span>
    </div>
  )
}

export default function ExploreMap({ height = 'calc(100vh - 220px)', homeState, homeCounty, portalMode = false, externalFilterOpen, onFilterOpenChange, onViewListing, onTractSelected, onLandDetailOpen, onToggleReport, onView3DTerrain, isInReport, reportIds, onFiltersApplied, zoomToLocation, zoomToBoundsSignal, pinnedTractPolygon, subjectTractId, subjectTractLocation, resetFiltersSignal, applyExternalFilters, chatSearchStartSignal, chatSearchEndSignal, onChatSearchError, ownerParcelsResult, comparableVisibleIds, neighborParcels, neighborsLoading }: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const stateMarkersRef = useRef<maplibregl.Marker[]>([])
  const countyMarkersRef = useRef<maplibregl.Marker[]>([])
  // Today's-auction green dots — DOM markers (2D only) so they paint above
  // the state silhouette DOM badges (DOM always paints above the GL canvas,
  // which is why the native today-pin-core/today-pin-pulse GL layer sat
  // BEHIND the silhouettes). The GL layer is kept for 3D mode, where the
  // silhouettes are already suppressed. See the today-marker build effect
  // and the 3D toggle effect for the show/hide wiring.
  const todayMarkersRef = useRef<maplibregl.Marker[]>([])
  // Filter-active per-county count bubbles (number + "tracts" label),
  // shown when zoomed too low for individual tract dots.
  const countyCountMarkersRef = useRef<maplibregl.Marker[]>([])
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Debounce timer + request-generation counter for the durable-dots
  // fetch (z9-10 gap), mirroring debounceTimerRef's pattern above so a
  // stale in-flight response can never overwrite a newer one.
  const durableDotsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const durableDotsGenRef = useRef(0)
  // Accumulator keyed by dot id (ll_uuid): dots must never reload once
  // loaded (owner rule). Each viewport fetch MERGES into this map instead
  // of replacing the layer, so panning off-screen and back shows the same
  // dots instantly instead of blinking/refetching. Cleared only when the
  // filter changes (see the fetch effect's dependency array below) — a
  // changed filter changes which parcels qualify, so the old union is stale.
  const durableDotsByIdRef = useRef<Map<string, GeoJSON.Feature>>(new Map())
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
  // Generation counter for the shared tract result set (tractMapRef /
  // `tracts`). Bumped every time tractMapRef is reset — chat search,
  // filter-panel apply/reset, comp-mode toggle, state/county/township
  // quick-filter clicks. Every async tract fetch (loadTractsForBounds
  // AND the chat-search wide-bbox fetch) captures the generation it
  // started under and discards its response if a NEWER reset has since
  // superseded it. Without this, a slow/stale fetch kicked off BEFORE a
  // filter change (the initial page-load fetch, or a moveend fetch
  // queued right before the user submits a Goat Search) can resolve
  // AFTER the newer search has narrowed the map and silently re-merge
  // unfiltered tracts back into the results — root cause of the
  // 2026-07-09 incident where an Illinois/seller/status-filtered chat
  // search briefly showed tracts scattered across a much wider area.
  const tractsGenRef = useRef(0)
  // Chat-search: when true, the cell-loader pauses (we run a single
  // wide query instead) and the chat-search animation overlays the map.
  const [chatSearching, setChatSearching] = useState(false)
  // Owner addition (2026-07-09): warn the user the search may take a few
  // extra seconds when it's NOT county-scoped (state-wide or nationwide
  // bbox) — reuses the same hasCountyFilter check the dots-bbox-scoping
  // fix above already computes. Defaults false so the very first frame
  // of the overlay (fired by chatSearchStartSignal, before we even know
  // the parsed filters yet) doesn't flash the warning; the
  // applyExternalFilters effect below sets the real value once it knows.
  const [chatSearchLargeArea, setChatSearchLargeArea] = useState(false)
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
      // Clear any "large search" copy left over from a previous search
      // until the applyExternalFilters effect knows this one's actual
      // county scope — avoids a stale flash of the warning.
      setChatSearchLargeArea(false)
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

  // Owner "show on map" chat search: chip text shown while the
  // owner's parcel dots are on the map. Cleared by the X button (which
  // also empties the owner-parcels source) or by a subsequent regular
  // filter search.
  const [ownerParcelsChip, setOwnerParcelsChip] = useState<{ owner: string; count: number; totalAcres: number; reply: string } | null>(null)
  const clearOwnerParcels = () => {
    setOwnerParcelsChip(null)
    const map = mapRef.current
    const src = map?.getSource('owner-parcels') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(EMPTY_FC)
  }
  // The setData/fitBounds effect for ownerParcelsResult lives further
  // down, right after `mapLoaded` is declared (it reads that state).
  // Owner-search-only display gate (owner bug report 2026-07-24): a
  // search like "show me parcels owned by X" must show ONLY the owner's
  // blue dots — every tract-pin and sold-parcel pink-dot layer has to
  // disappear while the chip is up, or the two result sets visually
  // blend. Derived directly from ownerParcelsChip (single source of
  // truth) so restoration falls out of clearOwnerParcels going to null —
  // called both by the chip's own X button and, already, by a subsequent
  // regular filter search inside the applyExternalFilters effect below.
  // Green today-pin layers are deliberately excluded everywhere this is
  // read: owner canon says today's auctions always show.
  const ownerSearchActive = !!ownerParcelsChip
  // Mirror for use inside fetchDurableDotsForBounds's moveend re-assert,
  // which is a stable useCallback ([] deps) and can't close over state.
  const ownerSearchActiveRef = useRef(false)
  ownerSearchActiveRef.current = ownerSearchActive

  // Pull the live soils-overlay coverage list from the backend once on
  // mount. If the request fails the seed defaults stay in place so
  // the existing 4-pilot experience is preserved.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/map/county-overlay/coverage`)
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        if (Array.isArray(data?.counties) && data.counties.length > 0) {
          setOverlayCoverage(
            data.counties
              .filter((c: any) => c && typeof c.state === 'string' && typeof c.county === 'string')
              .map((c: any) => ({ state: c.state, county: c.county }))
          )
        }
      } catch {
        /* keep defaults */
      }
    })()
    return () => { cancelled = true }
  }, [])
  const subjectTractIdRef = useRef<string | null>(null)
  subjectTractIdRef.current = subjectTractId || null

  // ─────────────────────────────────────────────────────────────────
  // Coincident-deed collapse (comp map only): when a Regrid durable
  // sale-dot's centroid falls inside a comp tract's own polygon, the
  // dot + its floating Regrid owner/$/date label are hidden and the
  // underlying parcel deed(s) are folded into that tract's click panel
  // instead (CompInlinePopup / PortalTractDetail "Recorded Deeds"
  // section below). MOBILE PARITY: ComparablesMapView.js should mirror
  // this exact algorithm — point-in-polygon of each parcel-sale-dot's
  // (lat,lng) against every loaded tract's polygon_coordinates rings,
  // via the same pointInBoundary ray-cast (no turf dep on either
  // platform), and read owner/path the same tile-query way (see
  // recomputeCoincidentDeeds below — NOT the /api/regrid/parcel
  // endpoint, which 404s for every durable-dot ll_uuid in production).
  // ─────────────────────────────────────────────────────────────────
  // tractId -> the deed(s) folded into that tract. React state (not a
  // ref) because it feeds the CompInlinePopup/PortalTractDetail panel
  // directly; the set is small (bounded by dots that actually coincide
  // with a tract) so re-render cost is negligible.
  const [tractDeeds, setTractDeeds] = useState<Map<string, RecordedDeed[]>>(new Map())
  // Mirror of tractDeeds for the tract-click handler below, which is
  // registered in a useEffect keyed on [mapLoaded, portalMode,
  // onTractSelected] — tractDeeds isn't in that deps list (recreating
  // the handler on every deed resolution would be wasteful), so the
  // handler reads this ref instead of the stale state closure.
  const tractDeedsRef = useRef<Map<string, RecordedDeed[]>>(new Map())
  useEffect(() => { tractDeedsRef.current = tractDeeds }, [tractDeeds])
  // ll_uuids currently suppressed from the durable-dot layer (coincident
  // with some tract). Read inside fetchDurableDotsForBounds's useCallback
  // ([] deps), so it must be a ref, not state.
  const suppressedDeedUuidsRef = useRef<Set<string>>(new Set())
  // ll_uuids whose Regrid TILE feature we've already found (and read
  // owner from) at least once — skips re-querying queryRenderedFeatures
  // every recompute pass once resolved, and avoids a dot that's since
  // scrolled off-screen (tile unloaded) flickering back to the loading
  // skeleton. Cleared on comp-mode exit alongside the feature-state
  // un-suppression below.
  const resolvedDeedUuidsRef = useRef<Set<string>>(new Set())
  // Ground truth of feature-state we've actually SET on the
  // 'regrid-parcels' source (dotSuppressed=true), diffed every recompute
  // in recomputeCoincidentDeeds so a label that stops qualifying gets
  // its feature-state REMOVED (AUDIT FIX, HIGH: this was previously a
  // one-way ratchet — set but never cleared, so a hidden label stayed
  // blank all session, including after leaving comp mode). Keyed by the
  // Regrid tile's own `path` id (the source's promoteId target), not
  // ll_uuid.
  const suppressedPathsRef = useRef<Set<string>>(new Set())
  // ll_uuid -> last-known Regrid tile `path` for that parcel — kept so a
  // deed can still be un-suppressed correctly even on a pass where its
  // tile can't be re-queried (e.g. panned off-screen).
  const deedPathByUuidRef = useRef<Map<string, string>>(new Map())
  // Mirror of regridConfig (declared further below) for use inside
  // recomputeCoincidentDeeds, which is a stable useCallback ([] deps)
  // and can't close over the state value directly without going stale.
  const regridConfigRef = useRef<{ source_layer?: string } | null>(null)
  // Last SaleDetail handed to the parent via onTractSelected (portalMode
  // — PortalTractDetail). Unlike CompInlinePopup (a piece of THIS
  // component's own state, so a useEffect can patch it directly),
  // PortalTractDetail's data lives in the PARENT's state (/access
  // page.tsx `selectedTract`) — the only way to refresh it is to call
  // onTractSelected AGAIN with updated deeds. This ref remembers what we
  // last sent so the live-refresh effect below can do that.
  const lastPortalSaleRef = useRef<SaleDetail | null>(null)

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

  // Owner "show on map" chat search: push dots into the owner-parcels
  // source (added once in the map-init block) and zoom to their bbox.
  //
  // Empty result (owner directive 2026-08-04: "If a search yields no
  // results, then the map should not be filtered.") must never touch
  // the map at all — this shape is shared by owner lookup, a
  // locate_place geocode miss, and a lookup_parcel zero match, so this
  // one early-return covers all three. Concretely that means: never
  // call setOwnerParcelsChip (which is what flips ownerSearchActive and
  // hides every tract-pin/parcel-dot layer above), never touch the
  // owner-parcels source, never move the camera. If a PREVIOUS owner
  // search is still active (chip already set, layers already hidden),
  // this leaves it exactly as-is — a deliberate choice not to silently
  // drop the user out of a filter they applied on purpose. The
  // zero-result toast (MapChatPanel.tsx) is the only feedback the user
  // gets for this search.
  useEffect(() => {
    if (!ownerParcelsResult) return
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const { data, reply } = ownerParcelsResult
    if (!data.dots || data.dots.length === 0) return
    const features = data.dots.map(d => ({
      type: 'Feature' as const,
      properties: { id: d.id, acres: d.acres },
      geometry: { type: 'Point' as const, coordinates: [d.lng, d.lat] },
    }))
    const src = map.getSource('owner-parcels') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData({ type: 'FeatureCollection', features })
    setOwnerParcelsChip({ owner: data.owner, count: data.count, totalAcres: data.total_acres, reply })
    if (data.bbox) {
      map.fitBounds(data.bbox, { padding: 100, duration: 900, maxZoom: 14 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerParcelsResult?.nonce, mapLoaded])

  // Live coverage list — counties whose soils / soils-csb / tillable
  // overlays the backend can serve. Replaces the previous hardcoded
  // 4-county list so adding a county is a backend-only deploy.
  // Defaults to the 4 pilots in case the /coverage endpoint fails so
  // the existing experience never degrades.
  const [overlayCoverage, setOverlayCoverage] = useState<
    Array<{ state: string; county: string }>
  >([
    { state: 'IL', county: 'Hancock' },
    { state: 'IL', county: 'Adams'   },
    { state: 'IA', county: 'Lee'     },
    { state: 'MO', county: 'Clark'   },
  ])

  // 3-tier marker counts and silhouette geometry. Counts come from
  // dedicated server-side aggregation endpoints (filter-aware) so
  // the badges show accurate numbers regardless of what's been
  // loaded into the cell-loader. Silhouette paths + bboxes are
  // loaded once from /data/us-states.json on mount.
  const [stateCounts, setStateCounts] = useState<
    Array<{ state: string; count: number }>
  >([])
  const [countyCounts, setCountyCounts] = useState<
    Array<{ state: string; county: string; count: number; lat: number; lng: number; dot_count?: number }>
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
  // State-tier + county-tier count fetch in flight (the state-tract-counts
  // and county-tract-counts effects below, which back the pink circle
  // badges at z<=9). Owner report 2026-08-04: applying a 4-county IL filter
  // at z6-8 left the county circles taking "a LONG time" to appear with NO
  // loading indicator — `dotsLoading` below only ever fires at
  // z>=DURABLE_DOT_MIN_ZOOM (9), so the entire state/county-tier zoom band
  // had no feedback at all. Tracked the same way as durableDotsInflightRef
  // (a plain in-flight counter, immune to fetch supersession) but WITHOUT
  // the dot fetch's map-idle-wait — circle layers here draw at most a few
  // hundred features, so there's no render-settle worth waiting for; the
  // fetch resolving is close enough to "done" for this signal.
  const [countCountsLoading, setCountCountsLoading] = useState(false)
  const countCountsInflightRef = useRef(0)
  // Durable parcel-sale-dot fetch in flight (fetchDurableDotsForBounds) —
  // drives the centered "Loading Ground" wordmark below alongside `loading`
  // so pan/zoom dot fetches, not just the tract fetch, show feedback.
  const [dotsLoading, setDotsLoading] = useState(false)
  // Count of durable-dot fetches actually in flight. The badge is driven off
  // this count (see fetchDurableDotsForBounds' finally), NOT off the fetch
  // generation: the old gen-gated clear was skipped whenever a fetch was
  // superseded, and its replacement is often a gated-out zoom/no-source early
  // return that bumps the gen but never clears — so `dotsLoading` stuck true
  // for ~45s (owner 2026-07-27) even though the fetch itself is ~0.35s. A
  // counter clears reliably the moment no fetch is in flight.
  const durableDotsInflightRef = useRef(0)
  // Anti-flicker layer on top of `dotsLoading` (owner spec 2026-08-04 restyle).
  // `dotsLoading` itself flips true the instant a durable-dot fetch starts and
  // false once the counter above hits 0 AND the map has settled — that logic
  // is untouched. Healthy fetches are ~350ms, well under blink-visibility, so:
  //   - the PILL doesn't show until `dotsLoading` has been true for 400ms
  //     (a fetch that finishes before then never shows anything)
  //   - once shown, it stays up at least 500ms so it can't strobe
  // This effect only reacts to actual false<->true transitions of
  // `dotsLoading` (React bails on a same-value setState re-render), and
  // `dotsLoading` itself already coalesces overlapping/superseded fetches
  // into a single true..false session via the inflight counter — so this
  // stays a single show/hide cycle per session, not per fetch.
  //
  // 2026-08-04: `badgeLoading` widens the trigger to `dotsLoading ||
  // countCountsLoading` — same single delay/min-visible/hard-cap pipeline,
  // now fed by whichever fetch is actually relevant. It's one OR'd boolean,
  // not a second parallel mechanism: which source is "relevant" at the
  // current zoom is decided at render time (see the REGRID_MIN_ZOOM ceiling
  // on the pill JSX below), not here — `countCountsLoading` can only ever be
  // true when a state/county-count fetch is genuinely in flight, and that
  // fetch never runs at the dot tier's zoom the way `dotsLoading` never runs
  // below it, so the two barely overlap in practice.
  const badgeLoading = dotsLoading || countCountsLoading
  const [dotsLoadingVisible, setDotsLoadingVisible] = useState(false)
  const dotsLoadingShowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dotsLoadingHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dotsLoadingShownAtRef = useRef(0)
  useEffect(() => {
    if (badgeLoading) {
      // Starting a new session — cancel any hide-delay left over from a
      // session that had already shown the pill (shouldn't happen given the
      // counter coalescing above, but cheap to guard so the pill can't be
      // yanked away mid-load).
      if (dotsLoadingHideTimerRef.current) {
        clearTimeout(dotsLoadingHideTimerRef.current)
        dotsLoadingHideTimerRef.current = null
      }
      dotsLoadingShowTimerRef.current = setTimeout(() => {
        dotsLoadingShowTimerRef.current = null
        dotsLoadingShownAtRef.current = Date.now()
        setDotsLoadingVisible(true)
      }, 400)
    } else {
      if (dotsLoadingShowTimerRef.current) {
        // Fetch finished before the 400ms show-delay elapsed — the pill
        // never appeared, nothing to hide.
        clearTimeout(dotsLoadingShowTimerRef.current)
        dotsLoadingShowTimerRef.current = null
        return
      }
      // Pill is visible (or its show timer already fired) — enforce the
      // 500ms minimum-visible floor before hiding it.
      const elapsed = Date.now() - dotsLoadingShownAtRef.current
      const remaining = 500 - elapsed
      if (remaining <= 0) {
        setDotsLoadingVisible(false)
      } else {
        dotsLoadingHideTimerRef.current = setTimeout(() => {
          dotsLoadingHideTimerRef.current = null
          setDotsLoadingVisible(false)
        }, remaining)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [badgeLoading])
  // Unmount safety — don't fire a setState after the map unmounts.
  useEffect(() => {
    return () => {
      if (dotsLoadingShowTimerRef.current) clearTimeout(dotsLoadingShowTimerRef.current)
      if (dotsLoadingHideTimerRef.current) clearTimeout(dotsLoadingHideTimerRef.current)
    }
  }, [])
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  // Inline popup ON THE MAP (comparables mode only). Click a tract pin
  // in comp mode opens this; click outside (anywhere else on the map) or
  // the X / Esc closes it. Distinct from `selectedSale` (the sidebar/modal
  // flow used outside comp mode). Wired in the tract-pin click effect.
  const [compPopup, setCompPopup] = useState<{
    sale: SaleDetail
    pos: { x: number; y: number }
    // For Regrid "+" parcels (no tract marker to re-project from on pan),
    // we stash the click lng/lat so onMove can keep the popup anchored.
    lngLat?: [number, number]
  } | null>(null)
  // Keep an OPEN CompInlinePopup's deeds live as owner resolution lands.
  // saleData.deeds (built at click time in the tract-pin/-polygon handler
  // below) is a snapshot read off tractDeedsRef — without this effect, a
  // popup opened before the Regrid tile finishes loading (owner read
  // synchronously off queryRenderedFeatures — see recomputeCoincidentDeeds)
  // would show the "Owner unknown"/skeleton state forever, even after the
  // tile loads, since compPopup.sale is otherwise never touched again
  // after the click. Re-syncs from tractDeeds (state, so this effect
  // re-runs on every recompute) whenever the popup's own tract has an
  // entry.
  useEffect(() => {
    setCompPopup(prev => {
      if (!prev || !prev.sale.tractId) return prev
      const deeds = tractDeeds.get(prev.sale.tractId)
      if (deeds === prev.sale.deeds) return prev
      return { ...prev, sale: { ...prev.sale, deeds } }
    })
  }, [tractDeeds])
  // Mirror of the effect above, for PortalTractDetail (AUDIT FIX,
  // MEDIUM: this was missing entirely — a PortalTractDetail opened
  // before the tile resolved never updated). PortalTractDetail's data
  // lives in the PARENT's state (/access page.tsx `selectedTract`), so
  // the only way to refresh it is re-invoking onTractSelected with an
  // updated `deeds` — lastPortalSaleRef remembers what we last sent (see
  // its declaration above) so we can patch just that field. Guarded on
  // portalMode/onTractSelected so this is a no-op everywhere else.
  useEffect(() => {
    if (!portalMode || !onTractSelected) return
    const prevSale = lastPortalSaleRef.current
    if (!prevSale || !prevSale.tractId) return
    const deeds = tractDeeds.get(prevSale.tractId)
    if (deeds === prevSale.deeds) return
    const updated: SaleDetail = { ...prevSale, deeds }
    lastPortalSaleRef.current = updated
    onTractSelected(updated)
  }, [tractDeeds, portalMode, onTractSelected])
  const [show3DViewer, setShow3DViewer] = useState(false)
  // Unified land-detail panel (replaces both the Regrid parcel popup and
  // the soil/crop popup). A single click collects features from all visible
  // tile layers and passes them here as bucketed props.
  const [landDetail, setLandDetail] = useState<LandDetailClickData | null>(null)

  // Entering or exiting comparables mode invalidates the bbox tract
  // cache — the sold-only filter (and the eventual sale_status change)
  // means previously-cached cells return different data. Without this,
  // the user could enter comp mode but the markers still show the
  // pre-filter set (and stay as plain pins, not + buttons).
  useEffect(() => {
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    tractsGenRef.current++
    setTracts([])
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
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      // Don't close if the click landed on a popup-opening layer — that
      // layer's own handler is opening (or switching to) a popup. Without
      // these guards, clicking a tract pin / Regrid "+" while a popup is
      // open would both open the new one and immediately close it.
      //   - parcel-sale-pin-plus: Regrid sale "+" markers
      //   - tract-pin-circles: native tract pins (replaces the old DOM
      //     marker's stopPropagation, which native layers can't do)
      const guardLayers = [...SALE_DOT_LAYERS, 'tract-pin-circles']
        .filter(id => map.getLayer(id))
      if (guardLayers.length) {
        try {
          if (map.queryRenderedFeatures(e.point, { layers: guardLayers }).length) return
        } catch {/* layer gone */}
      }
      setCompPopup(null)
    }
    const onMove = () => {
      setCompPopup(prev => {
        if (!prev) return prev
        // Every comp-popup (native tract pin click AND Regrid "+" parcel)
        // now stashes the click lng/lat, so we re-project straight from it
        // to keep the popup anchored on pan/zoom — no marker lookup needed.
        if (prev.lngLat) {
          const p = map.project(prev.lngLat)
          return { ...prev, pos: { x: p.x, y: p.y } }
        }
        return prev
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

  // ── Layer control panel state ──────────────────────────────────────
  // layerPanelOpen: whether the layers panel is visible.
  // baseOverlay: radio-exclusive base overlay ('crops' = Crops by Year CDL,
  //   'ssurgo' = soil types SSURGO, 'nccpi' = NCCPI productivity overlay,
  //   'fsa' = FSA coverage + CLU field lines, null = none).
  //   Toggling one off turns the others off.
  // terrain3DOn: independent 3D pitch toggle.
  const [layerPanelOpen, setLayerPanelOpen] = useState(false)
  const [baseOverlay, setBaseOverlay] = useState<'crops' | 'csb' | 'ssurgo' | 'nccpi' | 'fsa' | null>(null)
  const [selectedCropYear, setSelectedCropYear] = useState<number>(2024)
  const [terrain3DOn, setTerrain3DOn] = useState(false)
  const [terrainExaggeration, setTerrainExaggeration] = useState(1.3)

  // Filter options — fetched once on mount, always shows ALL available states/counties
  const [filterOptions, setFilterOptions] = useState<{ states: string[]; counties_by_state: Record<string, string[]>; townships_by_county: Record<string, string[]> }>({ states: [], counties_by_state: {}, townships_by_county: {} })

  useEffect(() => {
    fetch(`${API_URL}/api/map/filter-options`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setFilterOptions(data) })
      .catch(() => {})
  }, [])

  // Filter state. Declared here (ABOVE the today's-tracts fetch effect
  // below, out of its usual reading-order position) because that effect
  // now depends on `appliedFilters` — a hook referenced in an effect's
  // closure/dep-array must already be initialized by the time that
  // effect statement runs during the component's render pass, or React
  // throws a TDZ "Cannot access before initialization" error.
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
  const [filterOpen, setFilterOpenInternal] = useState(false)
  // Filters to layer on top of appliedFilters the next time the panel
  // opens — see the re-seed effect below. Set by the state badge's
  // "Filter" link so the panel opens with that state already selected.
  const pendingFilterSeedRef = useRef<Partial<FilterState> | null>(null)
  const filtersRef = useRef<FilterState>(INITIAL_FILTERS)
  // Apply-atomic model: `filters` is the DRAFT the panel edits live;
  // `appliedFilters` is the committed snapshot that drives every
  // indicator (count bubbles, Filter-button dot, durable-dot refetch).
  // The two only converge at the same handful of commit points where
  // filtersRef.current is assigned today (Apply, Reset, chat-search
  // commit, external reset) — see each site below. Editing the panel
  // must NEVER touch this.
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(INITIAL_FILTERS)

  // Fetch today's auction tracts on mount and re-fetch every 10 minutes so
  // the dots roll over correctly when the user keeps the tab open past
  // midnight (Central Time). Today's green dots are currently ALWAYS-ON
  // (unfiltered) — making them respect the applied filter is a decoupled
  // follow-up that needs the /api/map/tracts/today backend endpoint to
  // accept filter params first (sending them now would be inert and add a
  // blank→repopulate flicker on every Apply). Mount + 10-min refresh only.
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

  // Mutable ref so the unified map-click handler always reads the
  // current overlay without being torn down/re-created on every change.
  const baseOverlayRef = useRef<'crops' | 'csb' | 'ssurgo' | 'nccpi' | 'fsa' | null>(null)
  // Keep baseOverlayRef in sync with baseOverlay state.
  useEffect(() => { baseOverlayRef.current = baseOverlay }, [baseOverlay])

  // Serialized filter params used by the new state/county count
  // endpoints (and any future filter-aware fetcher). Apply-atomic model
  // (owner spec, 2026-07-25): keyed on appliedFilters, NOT the draft
  // `filters` the panel edits — count bubbles must not move until the
  // user hits Apply. Re-computes whenever appliedFilters changes, which
  // causes the count effects below to re-fire automatically.
  const filterParamString = useMemo(() => {
    return new URLSearchParams(buildFilterParams(appliedFilters)).toString()
  }, [appliedFilters])

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
  //
  // Clear-then-fetch (2026-07-09 incident): previously this effect left
  // whatever counts were already in state untouched until the new fetch
  // resolved, and a thrown fetch error (network blip, CORS, timeout) was
  // silently swallowed with no fallback — so a filtered chat search that
  // hit either case left the PREVIOUS (often unfiltered/nationwide) pink
  // count bubbles on screen indefinitely, contradicting the toast that
  // honestly reported zero matches. The tract-pin path already avoids
  // this by calling setTracts([]) the instant a filter changes (see
  // tractsGenRef); mirror that here so the count bubbles obey the same
  // "always reflect the active search" rule at every zoom level — they
  // now go blank the moment the filter changes and land on blank (never
  // stale) if the refetch fails outright.
  useEffect(() => {
    let cancel = false
    setStateCounts([])
    // Loading-badge bookkeeping (owner report 2026-08-04) — see
    // countCountsInflightRef's declaration up top for why this is a plain
    // in-flight counter rather than a gen-gated flag: a superseded fetch
    // (rapid filter changes) must still decrement so the badge can't stick.
    countCountsInflightRef.current += 1
    setCountCountsLoading(true)
    fetchWithAuth(`${API_URL}/api/map/state-tract-counts?${filterParamString}`)
      .then(r => r.ok ? r.json() : { states: [] })
      .then(d => { if (!cancel) setStateCounts(d.states || []) })
      .catch(() => { if (!cancel) setStateCounts([]) })
      .finally(() => {
        countCountsInflightRef.current = Math.max(0, countCountsInflightRef.current - 1)
        if (countCountsInflightRef.current === 0) setCountCountsLoading(false)
      })
    return () => { cancel = true }
  }, [filterParamString])

  // Filter-aware county-tier counts (scoped to selected state(s) when set).
  // Same clear-then-fetch / never-stale-on-error rule as the state-tier
  // effect above. Shares countCountsInflightRef with the state-tier fetch
  // above — they're siblings (both back pink circle-tier badges below
  // DURABLE_DOT_MIN_ZOOM) and this endpoint is the one the owner's 2026-08-04
  // report was actually about (4-county IL filter, z6-8, no loading feedback
  // while it ran).
  useEffect(() => {
    let cancel = false
    setCountyCounts([])
    countCountsInflightRef.current += 1
    setCountCountsLoading(true)
    const stateScope = appliedFilters.stateFilter ? `state=${appliedFilters.stateFilter}&` : ''
    fetchWithAuth(`${API_URL}/api/map/county-tract-counts?${stateScope}${filterParamString}`)
      .then(r => r.ok ? r.json() : { counties: [] })
      .then(d => { if (!cancel) setCountyCounts(d.counties || []) })
      .catch(() => { if (!cancel) setCountyCounts([]) })
      .finally(() => {
        countCountsInflightRef.current = Math.max(0, countCountsInflightRef.current - 1)
        if (countCountsInflightRef.current === 0) setCountCountsLoading(false)
      })
    return () => { cancel = true }
  }, [filterParamString, appliedFilters.stateFilter])

  // Admin parcel-overlay state. Lights up the map with every parcel
  // (boundary + owner + acres). Visible only to groundgoat_admin users.
  // The legacy pmtiles toggle is hard-disabled (the JSX gate is `false`),
  // superseded by the always-on Regrid layer.
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
  // States that have a pre-built _soils.pmtiles archive on the tile server.
  // Used for both the Soil Types (ssurgo) and NCCPI overlays.
  const SOIL_PMTILES_STATES = [
    'AL','AR','AZ','CA','CO','CT','DE','FL','GA','IA','ID','IL','IN','KS','KY',
    'LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM',
    'NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA',
    'WI','WV','WY',
  ]
  const FSA_PMTILES_STATES = [
    'AR','AZ','CA','CO','CT','DE','GA','HI','IA','ID','IL','IN','KS','KY',
    'LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ',
    'NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA',
    'VT','WA','WI','WV','WY',
  ]
  const [isAdmin, setIsAdmin] = useState(false)
  // Layers-panel entitlement, from /api/auth/me's can_use_layers —
  // firm_admin / firm_user / premium_state / staff, NOT basic_state
  // (owner 2026-07-30). Backed by get_layers_entitlement() server-side,
  // the same rule that decides Goat Search and the mobile Layers button,
  // so the three can't drift. The admin OR is a deploy-order fallback:
  // this frontend can ship before the backend starts sending the field.
  const [canUseLayers, setCanUseLayers] = useState(false)
  const layersEnabled = canUseLayers || isAdmin
  // Pilot-owner gate for the parcel-enrichment overlay (Hancock IL
  // tillable + PI). STAYS admin-only — this is R&D scratch (the Hancock
  // tillable pilot and the /api/tiles/parcels endpoint, which 404s for
  // non-admins), NOT part of the customer Layers panel. Do not fold it
  // into layersEnabled.
  const isEnrichmentPilot = isAdmin
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
        setCanUseLayers(Boolean(me?.can_use_layers))
        // The tile-server discovery fetch that used to live here has
        // been removed. It populated `adminParcelStates`, which fed
        // the "Show Parcels" admin toggle — but that toggle has been
        // force-OFF for months (JSX gate `false && isAdmin && ...` in
        // the render below, since the always-on Regrid layer
        // superseded the state_parcels pmtiles overlay). Calling
        // `fetch(${TILES_BASE_URL}/)` on every admin map load was
        // therefore dead work, and the tile server's index route
        // doesn't serve CORS headers — so the call produced a noisy
        // console error on every admin session for no functional
        // reason. If we ever re-enable the pmtiles overlay, restore
        // this block AND fix CORS on the tile server.
      } catch {
        /* not fatal */
      }
    })()
    return () => { cancelled = true }
  }, [])

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
      setAppliedFilters(INITIAL_FILTERS)
      loadedCellsRef.current = new Set()
      tractMapRef.current = new Map()
      tractsGenRef.current++
      setTracts([])
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

    // A regular filter search superseded any owner-parcels dots from a
    // prior "show me X's parcels" query — clear them so stale blue dots
    // don't linger under an unrelated result set.
    clearOwnerParcels()

    const base = clearUnspecified ? INITIAL_FILTERS : filtersRef.current
    const nextFilters = { ...base, ...incoming }
    setFilters(nextFilters)
    filtersRef.current = nextFilters
    // Chat commits instantly (out of scope for Apply-atomic — see task
    // spec) — but indicators still key off appliedFilters, so commit it
    // here too or count bubbles/Filter-button dot would silently lag a
    // chat search until the next manual Apply.
    setAppliedFilters(nextFilters)

    // Clear current tract markers / cache so the new results render fresh
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    tractsGenRef.current++
    // Capture the generation THIS search owns. Any tract fetch that was
    // already in flight when the reset above ran (the mount-time initial
    // load, a moveend cell fetch queued right before the user hit Send,
    // or a manual filter-panel action) is now stale — it will see
    // tractsGenRef.current has moved on and will discard its response
    // instead of merging unfiltered rows back into the just-cleared set.
    const myGen = tractsGenRef.current
    setTracts([])

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

    // TIMING FIX (owner complaint 2026-07-09): parcel-sale dots used to
    // load ~10s after tracts because the dots fetch only ever fired off
    // the map's 'moveend' event, and chat search's fitBounds only fires
    // 'moveend' AFTER this tract fetch resolves + a 900ms camera
    // animation — dots were serialized behind tracts, not parallel with
    // them. Fire the SAME qbbox at fetchDurableDotsForBounds right here,
    // alongside the tract fetch kickoff below, so both requests start
    // together. bypassZoomGate: true because we already know the
    // search's target area regardless of the camera's CURRENT zoom (the
    // camera hasn't moved yet — fitBounds happens once tracts resolve).
    //
    // CODE AUDITOR FIX (gen race, 2026-07-09): this effect owns the dots
    // lifecycle for the whole duration of a chat search — clear the
    // accumulator HERE (so stale dots from the previous filter set don't
    // linger) before calling fetchDurableDotsForBounds, which captures
    // the gen this fetch's response will be checked against. The moveend
    // effect below (which also re-runs on this same setFilters-triggered
    // render, since its deps include filters.*) is guarded to skip BOTH
    // its own clear/gen-bump AND its fetch kickoff while chatSearching is
    // true — it used to only guard the kickoff, which still let it bump
    // durableDotsGenRef out from under this fetch's already-captured gen
    // a beat later (same commit, before either fetch resolves), silently
    // discarding this response as "stale" and falling back to the old
    // slow moveend-driven path. See that effect for the matching half of
    // this fix.
    //
    // REGRESSION FIX (owner 2026-07-09, "sold farmland in Hancock County
    // Illinois" hung the overlay 45s): a county-filtered search still
    // queried the FULL STATE bbox here (qbbox = STATE_BOUNDS, since bbox
    // picking predates county awareness) — for Hancock County, IL that's
    // ~198K parcel-sale dots. The overlay used to only wait on the tract
    // fetch (below); a later commit made it also await this dots fetch,
    // so the whole-state dots payload blocked the "no loading state over
    // 5s" rule. Two changes: (1) the overlay no longer waits on dots at
    // all, see the .finally() below — dots always stream in the
    // background, whatever bbox they're scoped to; (2) when the search
    // includes countyFilters, don't fire the upfront whole-state fetch
    // here — there's no county-boundary/bbox dataset client-side to
    // scope it tightly (countyCentroids, used for the camera pan above,
    // only has point centroids, not extents). Instead the county-scoped
    // fetch is fired from inside the tract-fetch .then() below, using the
    // ACCEPTED tracts' bbox padded ~20% — that's already computed there
    // for fitBounds, guaranteed small (just the results about to be on
    // screen), and needs no new lookup table. Non-county searches
    // (state-only / nationwide) keep the original upfront parallel fetch
    // since a state bbox (or smaller) was never the slow case.
    const hasCountyFilter = (nextFilters.countyFilters?.length ?? 0) > 0
    // Same signal drives the "large searches take longer" overlay copy —
    // county-scoped searches are small/fast and never show it.
    setChatSearchLargeArea(!hasCountyFilter)
    durableDotsByIdRef.current.clear()
    // CODE AUDITOR FIX (2026-07-09): clearing the JS accumulator above
    // isn't enough on its own — the rendered GeoJSONSource still holds
    // the PREVIOUS search's dots until something calls setData again.
    // For a county-filtered search that ends with zero accepted tracts,
    // neither dots-fetch path below ever fires (the upfront fetch is
    // skipped for county searches, and the accepted-bbox fetch only
    // fires inside the `accepted.length > 0` branch), so the old dots
    // stayed on screen next to a "No tracts matched" toast. Clear the
    // source atomically right alongside the accumulator so there's never
    // a stale-dots gap, regardless of which path (or neither) re-fills it.
    ;(map.getSource(DURABLE_DOT_SOURCE) as maplibregl.GeoJSONSource)?.setData(EMPTY_FC)
    // A stale search's coincident-deed fold must not linger into the new
    // result set (new tracts, new dots — the old suppression/panel data
    // no longer applies to either) — un-suppress everything, including
    // any Regrid labels already hidden, not just the local bookkeeping.
    // fetchDurableDotsForBounds below will re-derive both once the fresh
    // dots land.
    clearAllDeedSuppression()
    if (!hasCountyFilter) {
      fetchDurableDotsForBounds(
        { south: qSouth, north: qNorth, west: qWest, east: qEast },
        { bypassZoomGate: true },
      )
    }

    // Single wide-bbox query with the new filter set. The backend always
    // returns every matching tract in the bbox (no limit/cap applies).
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
    const url = `${API_URL}/api/map/tracts?min_lat=${qSouth}&max_lat=${qNorth}&min_lng=${qWest}&max_lng=${qEast}&include_polygons=true${extra ? '&' + extra : ''}`

    const ac = new AbortController()
    fetchWithAuth(url, { signal: ac.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: MapTractsResponse) => {
        // A newer reset (another chat search, a manual filter-panel
        // action, comp-mode toggle, etc.) superseded this fetch while it
        // was in flight — tractMapRef / loadedCellsRef now belong to that
        // newer generation. Discard silently instead of merging this
        // response's rows into it; the fresher generation's own fetch
        // owns the map now.
        if (myGen !== tractsGenRef.current) return

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

        // The fetch succeeded, so we have ALL matches in the queried bbox
        // (the backend never caps results) — pre-mark every 0.5° cell
        // inside the queried bbox as loaded so the post-fitBounds moveend
        // doesn't waste round-trips re-fetching ground we've already covered.
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

            // County-scoped dots (see the hasCountyFilter branch above):
            // fire it now that we have a tight bbox, padded 20% per side
            // so it comfortably covers the fitBounds view (which itself
            // adds screen-space padding) without ever ballooning back up
            // to state size. Background fetch — NOT awaited, doesn't
            // block or extend the chatSearching overlay.
            if (hasCountyFilter) {
              const latPad = (maxLat - minLat) * 0.2 || 0.05
              const lngPad = (maxLng - minLng) * 0.2 || 0.05
              fetchDurableDotsForBounds(
                {
                  south: minLat - latPad, north: maxLat + latPad,
                  west: minLng - lngPad, east: maxLng + lngPad,
                },
                { bypassZoomGate: true },
              )
            }
          }
        } else {
          // Zero-result honesty (owner rule: wrong/misleading data is
          // never acceptable — a silently empty map after a search reads
          // as "still loading" or "broken", not "no matches"). Surface
          // an honest toast. Seller/buyer are called out specifically
          // because coverage is partial today, not because the search
          // itself did anything wrong.
          const askedSellerOrBuyer = !!(nextFilters.seller || nextFilters.buyer)
          onChatSearchError?.(
            askedSellerOrBuyer
              ? 'No tracts matched that search. Note: seller/buyer names are only on file for a portion of our auction results so far — full coverage is coming.'
              : 'No tracts matched that search.',
            'info'
          )
        }
      })
      .catch(e => {
        // Same staleness guard as the success path — a newer reset already
        // owns the map, so a failure here belongs to a superseded search
        // and shouldn't surface an error toast for what the user isn't
        // even looking at anymore.
        if (e.name !== 'AbortError' && myGen === tractsGenRef.current) {
          console.error('chat search load:', e)
          onChatSearchError?.('Search worked but the map couldn\'t load results — try again.', 'err')
        }
      })
      .finally(() => {
        // Same staleness guard again: search A's fetch settling (success,
        // failure, or abort) must not stop the searching-overlay for a
        // newer search B that's still in flight — that would re-arm the
        // moveend cell-loader mid-search-B, before B's own camera-fit has
        // happened. Only the generation that currently owns the map is
        // allowed to turn the overlay off.
        //
        // REGRESSION FIX (owner 2026-07-09, HARD RULE: no user-facing
        // loading state may ever exceed 5s): a prior commit made this
        // ALSO wait on the dots fetch ("tracts and parcel-sale dots must
        // appear together") so the overlay wouldn't drop before both
        // landed. For a state-wide dots query (~198K rows, county-filter
        // case above didn't exist yet) that fetch alone took ~45s,
        // hanging the overlay for that whole time. Dots are visually
        // secondary (small background points vs. the tract polygons/list
        // the user is waiting on) and fetchDurableDotsForBounds already
        // streams them in and paints the source directly — nothing here
        // needs to await it. Overlay now stops purely on the tract
        // fetch's own settle, same as before that commit; dots still
        // fetch in parallel/background (see above) and simply appear
        // whenever they land.
        if (myGen === tractsGenRef.current) stopChatSearchingSoon()
      })

    return () => ac.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyExternalFilters?.nonce])

  // Zoom to location from parent (portal mode).
  // Depends on mapLoaded because mapRef.current is only assigned inside the
  // map 'load' handler — a deep-link (e.g. the staging "View on Map" button)
  // sets zoomToLocation before the map finishes loading, so without the
  // mapLoaded dependency the flyTo would be skipped and never retried. When
  // the map finishes loading this effect re-runs with the still-set target.
  useEffect(() => {
    if (zoomToLocation && mapRef.current && mapLoaded) {
      mapRef.current.flyTo({
        center: [zoomToLocation.lng, zoomToLocation.lat],
        zoom: zoomToLocation.zoom,
        duration: 1500,
      })
    }
  }, [zoomToLocation, mapLoaded])

  // Fit map to polygon bounds (e.g. when the user picks a listing or
  // tract from a slide-out pane). Computes the bbox client-side so we
  // never zoom past the polygon. `nonce` lets the same coords retrigger.
  useEffect(() => {
    if (!zoomToBoundsSignal?.coords?.length) return
    const map = mapRef.current
    if (!map) return
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    // Ring-aware: coords may be a single flat ring or a multi-piece list of
    // rings. toTractRings normalizes either shape to a list of rings so the
    // bbox spans ALL pieces of a multi-ring tract (previously this
    // destructured each top-level element as [lng, lat] directly, so for a
    // multi-ring tract every "point" was actually a whole ring/array, the
    // typeof guard skipped all of them, and fitBounds silently never fired).
    for (const ring of toTractRings(zoomToBoundsSignal.coords)) {
      for (const [lng, lat] of ring) {
        if (typeof lng !== 'number' || typeof lat !== 'number') continue
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
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

  // Apply-atomic model (owner spec, 2026-07-25): when the panel OPENS,
  // re-seed the draft `filters` from the committed `appliedFilters` so the
  // panel always reflects what's actually live on the map. Without this,
  // draft edits abandoned via the X (closed without Apply) would linger and
  // silently get committed on a later Apply — there'd be no way to tell a
  // stale unapplied edit from the live filter. Mirrors the mobile panels'
  // re-seed keyed on `visible` (ExploreFilterPanel.js, ResultsScreen.js).
  // Keyed on filterOpen ONLY — it must NOT re-run while the panel is open
  // (that would wipe the user's in-progress edits mid-session).
  //
  // OWNER BUG (2026-07-31): a state badge's "Filter" link sets the draft
  // state and THEN opens the panel — and this effect, running on the
  // open, overwrote that draft with appliedFilters, so the panel slid out
  // with no state selected. The re-seed itself is correct and stays; the
  // badge click now leaves its selection in pendingFilterSeedRef and the
  // re-seed layers it ON TOP of appliedFilters. The ref is cleared on
  // every open AND close, so a seed can never leak into a later opening.
  useEffect(() => {
    if (filterOpen) {
      const seed = pendingFilterSeedRef.current
      setFilters(seed ? { ...appliedFilters, ...seed } : appliedFilters)
    }
    pendingFilterSeedRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterOpen])

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

  // Apply-atomic model (owner spec, 2026-07-25): the ONE place a draft
  // filter edit is allowed to touch the map. Everything the panel changed
  // while open (state/county/township chips, range fields, etc. — all
  // draft-only now, see the chip onClicks below) takes effect here, all
  // at once: commit draft→applied, wipe every layer, fly to the target
  // location, refetch. Nothing about this list is optional — a partial
  // clear would leave stale dots/tracts from the PRE-apply filter mixed
  // with the new set.
  const applyFilters = () => {
    clearOwnerParcels()

    // a. Commit: draft becomes the applied snapshot every indicator reads.
    filtersRef.current = filters
    setAppliedFilters(filters)

    // b. CLEAR everything off the map — tract layer, durable parcel-sale
    // dots, and today's green dots — before firing any refetch, so there
    // is never a frame where old-filter dots sit next to new-filter tracts.
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    tractsGenRef.current++
    setTracts([])
    durableDotsByIdRef.current.clear()
    const durableSrc = mapRef.current?.getSource(DURABLE_DOT_SOURCE)
    if (durableSrc && 'setData' in durableSrc) {
      (durableSrc as maplibregl.GeoJSONSource).setData(EMPTY_FC)
    }
    // Today's green dots are always-on (unfiltered) for now — do NOT clear
    // them on Apply (would blank then repopulate = flicker). They become
    // filter-aware only once the backend today endpoint accepts params.

    const map = mapRef.current
    const inCompMode = !!subjectTractIdRef.current

    // c. FLY-TO. Comp mode keeps the camera on the subject tract — never
    // yank it to a state/county filter (owner guardrail). Explore mode:
    // county filter wins (existing centroid-based fly, unchanged); else
    // a state-only filter fits across the selected states' STATE_BOUNDS
    // (this branch used to live in the state chip's onClick — it now
    // only fires here, on Apply, per the atomic model).
    let targetBounds: { min_lat: number; max_lat: number; min_lng: number; max_lng: number } | null = null
    if (!inCompMode && map && filters.countyFilters.length > 0 && filters.stateFilter) {
      // Picked counties may belong to different states (rare but
      // possible via Goat Search). Build "County, ST" keys per the
      // countyCentroids file format.
      const states = filters.stateFilter.split(',').filter(Boolean)
      const lookups: [number, number][] = []
      for (const county of filters.countyFilters) {
        for (const st of states) {
          const key = `${county}, ${st}`
          const c = countyCentroids[key]
          if (c) { lookups.push(c); break }  // [lat, lng]
        }
      }
      if (lookups.length === 1) {
        // Single county. Build an explicit county-sized bbox around the
        // centroid and fitBounds to it (like the multi-county/state-only
        // branches below) instead of a bare easeTo + relying on its
        // moveend to trigger the refetch at the end of this function.
        // LIVE BUG (2026-07-25): the old easeTo-only approach sometimes
        // never moved the camera at all — its moveend either didn't fire
        // in time or was superseded by something else — so the
        // `!targetBounds` fetch below ran at the STALE pre-apply
        // viewport (e.g. IA+Adams County apply kept fetching central
        // Illinois). fitBounds + an explicit targetBounds makes both the
        // camera move and the refetch deterministic and independent of
        // moveend timing, and guarantees a real fly-to even when the
        // county has zero results (no empty-result fitBounds elsewhere
        // can "win" a race against a fetch that was never queued here).
        const [lat, lng] = lookups[0]
        const pad = 0.35
        const bounds: [[number, number], [number, number]] = [
          [lng - pad, lat - pad],
          [lng + pad, lat + pad],
        ]
        map.fitBounds(bounds, { padding: 60, duration: 1000, maxZoom: 11 })
        targetBounds = { min_lat: lat - pad, max_lat: lat + pad, min_lng: lng - pad, max_lng: lng + pad }
      } else if (lookups.length > 1) {
        // Multiple counties — fit across each county's FOOTPRINT, not
        // its centroid.
        //
        // OWNER BUG (2026-07-31): filtering IL + Knox & Warren zoomed in
        // far past both counties. The old code fitted the box spanning
        // the two CENTROIDS — for Knox [40.9322, -90.2128] and Warren
        // [40.8478, -90.6117] that's 0.40° x 0.08°, a sliver thinner
        // than one county — and 80px of padding can't recover the ~0.2°
        // of county still hanging off each edge. The old comment claimed
        // "centroids are interior points so padding keeps each county's
        // edges on screen"; that was simply wrong.
        //
        // We have no per-county bbox data (countyCentroids is centroids
        // only), so expand each centroid by the SAME ±0.35° half-county
        // pad the single-county branch above already uses, then fit the
        // union. Two adjacent IL counties now frame with margin instead
        // of overshooting. maxZoom mirrors the single-county branch so a
        // duplicate/degenerate selection can't punch through it either.
        const pad = 0.35
        let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90
        for (const [lat, lng] of lookups) {
          if (lng - pad < minLng) minLng = lng - pad
          if (lat - pad < minLat) minLat = lat - pad
          if (lng + pad > maxLng) maxLng = lng + pad
          if (lat + pad > maxLat) maxLat = lat + pad
        }
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 80, duration: 1000, maxZoom: 11 })
        targetBounds = { min_lat: minLat, max_lat: maxLat, min_lng: minLng, max_lng: maxLng }
      }
    } else if (!inCompMode && map && filters.stateFilter) {
      // State-only filter (no county narrowing) — fit across every
      // selected state's bounds. Moved from the state chip's onClick
      // (was: instant-apply on chip click); same STATE_BOUNDS math.
      const states = filters.stateFilter.split(',').filter(Boolean)
      let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90
      for (const s of states) {
        const b = STATE_BOUNDS[s]
        if (b) {
          if (b[0][0] < minLng) minLng = b[0][0]
          if (b[0][1] < minLat) minLat = b[0][1]
          if (b[1][0] > maxLng) maxLng = b[1][0]
          if (b[1][1] > maxLat) maxLat = b[1][1]
        }
      }
      if (minLng < 180) {
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, duration: 1000 })
        targetBounds = { min_lat: minLat, max_lat: maxLat, min_lng: minLng, max_lng: maxLng }
      }
    }

    // Refetch tracts for whichever viewport the user is about to see.
    // Single-county/multi-county/state-only all set targetBounds above,
    // so this always fires a manual load at the destination the camera
    // is flying to — never dependent on moveend timing. Only comp-mode/
    // no-location-filter cases fall through to the current viewport.
    if (!targetBounds && map) {
      const bounds = map.getBounds()
      targetBounds = {
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lng: bounds.getWest(),
        max_lng: bounds.getEast(),
      }
    }
    if (targetBounds) loadTractsForBounds(targetBounds)

    setFilterOpen(false)
    onFiltersApplied?.({ stateFilter: filters.stateFilter, countyFilters: filters.countyFilters })
  }

  const resetFilters = () => {
    clearOwnerParcels()
    setFilters(INITIAL_FILTERS)
    filtersRef.current = INITIAL_FILTERS
    setAppliedFilters(INITIAL_FILTERS)
    // Clear cached data so it refetches without filters
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    tractsGenRef.current++
    setTracts([])
    // Atomic reset (owner spec): clear durable dots the same way Apply
    // does, so nothing from the old filter lingers. Today's green dots are
    // always-on (unfiltered) — leave them in place (clearing would flicker).
    durableDotsByIdRef.current.clear()
    const durableSrc = mapRef.current?.getSource(DURABLE_DOT_SOURCE)
    if (durableSrc && 'setData' in durableSrc) {
      (durableSrc as maplibregl.GeoJSONSource).setData(EMPTY_FC)
    }
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

  const currentTier = currentZoomTier(currentZoom)

  // Drives both the "Clear search" affordance and the county-tier
  // pink-count-bubble/plain-name-label swap below — a filter this list
  // misses means the bubble layer silently stays on plain county names
  // (or "Clear search" stays hidden) even though a search narrowed the
  // results. Must cover every field buildFilterParams sends, chat-only
  // fields included (2026-07-09 audit: countyFilters, near*/radiusMiles,
  // corners*, and pricePerSoilRating* were missing).
  // Apply-atomic model (owner spec, 2026-07-25): reads appliedFilters,
  // NOT the draft `filters` — this indicator must not move while the
  // panel is being edited, only on Apply/Reset/chat-search commit.
  const hasActiveFilters = appliedFilters.dateRange !== 'all' || appliedFilters.stateFilter !== '' ||
    appliedFilters.countyFilters.length > 0 ||
    appliedFilters.townshipFilters.length > 0 ||
    (SOIL_FILTER_ENABLED && (appliedFilters.soilRatingMin !== '' || appliedFilters.soilRatingMax !== '' ||
      appliedFilters.pricePerSoilRatingMin !== '' || appliedFilters.pricePerSoilRatingMax !== '')) ||
    appliedFilters.acreageMin !== '' || appliedFilters.acreageMax !== '' ||
    (TILLABLE_FILTER_ENABLED && (appliedFilters.pctTillableMin !== '' || appliedFilters.pctTillableMax !== '')) ||
    appliedFilters.statuses.length > 0 ||
    appliedFilters.landTypes.length > 0 ||
    appliedFilters.listingType !== '' ||
    appliedFilters.pricePerAcreMin !== '' || appliedFilters.pricePerAcreMax !== '' ||
    appliedFilters.salePriceMin !== '' || appliedFilters.salePriceMax !== '' ||
    appliedFilters.askingPriceMin !== '' || appliedFilters.askingPriceMax !== '' ||
    (appliedFilters.nearLat !== '' && appliedFilters.nearLng !== '' && appliedFilters.radiusMiles !== '') ||
    appliedFilters.cornersMin !== '' || appliedFilters.cornersMax !== '' ||
    appliedFilters.companyName !== '' || appliedFilters.buyer !== '' || appliedFilters.seller !== '' ||
    appliedFilters.hasHouse !== null || appliedFilters.hasBuildings !== null ||
    appliedFilters.hasPolygon !== null || appliedFilters.keyword !== ''

  const polygonGeoJSON = useMemo(() => {
    const fc = buildExplorePolygonGeoJSON(tracts)
    // Overlay the user's currently-pinned tract polygon (clicked from a
    // slide-out) regardless of whether it passed isAcceptableMapTract.
    // Some listings have tracts whose status would normally exclude them
    // from the upcoming/auctions filter (e.g. one tract already sold);
    // when the user explicitly clicks that tract, they expect to see the
    // boundary draw. We dedupe by id so we don't render twice if it's
    // already in the filtered set.
    // Ring-aware: pinnedTractPolygon.coords may be a single flat ring or a
    // multi-piece list of rings. ringsToGeometry normalizes+closes every
    // ring and returns a Polygon (1 ring) or MultiPolygon (>1 ring) — the
    // previous code always wrapped the raw coords as a single ring, which
    // silently dropped multi-ring tracts (outer array length < 3 rings) and
    // would have corrupted 3+ ring tracts (each ring treated as one point).
    const pinnedGeometry = pinnedTractPolygon?.coords ? ringsToGeometry(pinnedTractPolygon.coords) : null
    if (pinnedGeometry && pinnedTractPolygon) {
      const existingIds = new Set(
        fc.features.map((f: any) => f.properties?.tractId ?? f.id),
      )
      if (!existingIds.has(pinnedTractPolygon.id)) {
        (fc.features as any[]).push({
          type: 'Feature',
          id: pinnedTractPolygon.id,
          geometry: pinnedGeometry,
          properties: {
            tractId: pinnedTractPolygon.id,
            status: 'pinned',
          },
        })
      }
    }
    return fc
  }, [tracts, pinnedTractPolygon])

  // ── Native tract-pin GeoJSON (drives the tract-pin-circles/labels
  // layers via setData). One Point per tract with status / pre-formatted
  // priceLabel-acres label / tractId + the co-located offset spiral.
  // EXCLUDES today's-auction tracts (rendered by the native today-pin layer)
  // and the subject tract (its own highlight in comp mode), matching the
  // old DOM loop's `continue` guards exactly.
  const tractPinGeoJSON = useMemo(() => {
    const todayIds = new Set(todayTracts.map(t => t.id))
    const visible = tracts.filter(t => {
      if (todayIds.has(t.id)) return false
      if (subjectTractId && t.id === subjectTractId) return false
      return true
    })
    return buildExplorePointGeoJSON(visible)
  }, [tracts, todayTracts, subjectTractId])

  // Today's-auction green dots as a native GL GeoJSON FC (true lat/lng, no
  // clustering) — drives the today-pin-core / today-pin-pulse circle layers.
  const todayPinGeoJSON = useMemo(
    () => buildTodayPointGeoJSON(todayTracts),
    [todayTracts],
  )

  // ── County COUNT bubbles GeoJSON (filter-active). One Point per county
  // with a matching count + real polygon centroid from the
  // /county-tract-counts endpoint.
  //
  // Position (owner complaint 2026-07-09): the backend used to anchor this
  // at avg(matched-tract lat/lng), which skews toward wherever the search
  // results happen to cluster inside the county (reported: bottom-right
  // corner of Hancock County, IL for a "sold" search). The backend now
  // returns the real county-polygon centroid (ST_Centroid over Soils DB
  // county_boundaries) instead — see get_county_tract_counts /
  // _get_county_dot_counts_and_centroids in ground-goat-backend main.py.
  // Nothing to change here beyond consuming c.lat/c.lng as before.
  //
  // Count (owner complaint 2026-07-09): must be tracts + sold PARCELS
  // combined, not tracts alone. dot_count is additive on the backend
  // response (count itself stays tract-only for the mobile app, which
  // reads the same endpoint and still labels it "tracts" — see backend
  // comment) so this combines them client-side for the website's own
  // (word-free) bubble label.
  const countyCountGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    return {
      type: 'FeatureCollection',
      features: countyCounts
        // Include parcel-ONLY counties (tract count 0 but dot_count > 0, e.g.
        // Greene IN) — the backend now returns them so the circle shows
        // wherever sold-parcel dots render, per "the circle must equal the
        // dots underneath." Was `c.count` alone, which dropped them.
        .filter(c => (c.count || c.dot_count) && c.lat != null && c.lng != null)
        .map(c => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [c.lng, c.lat] },
          properties: {
            count: c.count + (c.dot_count || 0),
            state: c.state,
            county: c.county,
          },
        })),
    }
  }, [countyCounts])

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

    // Capture the generation this fetch started under. If a filter
    // reset / chat search / comp-mode toggle bumps tractsGenRef while
    // this request is in flight, the response below is stale — it was
    // built from a filter set that's no longer current — and must be
    // discarded rather than merged into (or cached against) the newer
    // generation's result set. See tractsGenRef's declaration for the
    // 2026-07-09 incident this guards against.
    const myGen = tractsGenRef.current

    // Did this fetch return a complete result? Only then do we mark the
    // cell as fully loaded. Failed fetches and capped results stay
    // un-cached so future moveends can retry. Without this, a transient
    // network error or a dense cell that hits the limit silently leaves
    // a region permanently empty on the map.
    let cellComplete = false
    try {
      setLoading(true)
      const filterParams = buildFilterParams(filtersRef.current)
      // In comparables mode, only show sold tracts. Force this
      // unconditionally (not just when unset) — comp mode is an
      // invariant, not a default: a Live/Listed status pill left active
      // from the explore map must not leak a non-sold status into the
      // comp query, since there is no server-side sold-only enforcement
      // on /api/map/tracts.
      if (subjectTractIdRef.current) {
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
        // A newer reset superseded this fetch while it was in flight —
        // its filters (and tractMapRef itself) are no longer current.
        // Discard the response instead of merging stale rows into the
        // newer generation's result set or marking this cell "loaded"
        // under filters it was never actually fetched with.
        if (data.tracts && myGen === tractsGenRef.current) {
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
      if (cellComplete && myGen === tractsGenRef.current) loadedCellsRef.current.add(gridKey)
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
      // Cap VRAM consumption from unbounded tile caching during heavy
      // terrain panning — without this the tile cache grows until the
      // GPU runs out of memory and loses the WebGL context.
      maxTileCacheSize: 200,
      transformRequest: (url: string) => {
        if (url.includes(`${API_URL}/api/tiles/soils/`) || url.includes(`${API_URL}/api/tiles/soils-full/`) || url.includes(`${API_URL}/api/tiles/csb-fields/`) || url.includes(`${API_URL}/api/tiles/nccpi/`) || url.includes(`${API_URL}/api/tiles/parcel-labels/`) || url.includes(`${API_URL}/api/regrid/tile/`)) {
          const token = localStorage.getItem('auth_token')
          return { url, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        }
        return { url }
      },
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    // WebGL context-loss recovery. Without preventDefault() the browser
    // marks the canvas permanently lost; with it, the driver can restore
    // the context. On restore, trigger a full style repaint so tiles
    // and terrain re-upload cleanly instead of leaving a black canvas.
    const canvas = map.getCanvas()
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault()
      console.warn('[ExploreMap] WebGL context lost — waiting for restore')
    })
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[ExploreMap] WebGL context restored — repainting')
      try {
        // Re-trigger a render pass so MapLibre re-uploads all GPU resources.
        map.triggerRepaint()
      } catch {/* map may be mid-destroy */}
    })

    map.on('load', () => {
      mapRef.current = map
      setMapLoaded(true)

      // ── Terrain DEM source (Terrarium encoding) ──────────────────
      // Added here once so the 3D terrain effect can reference it.
      // Public tiles — no auth header needed.
      // minzoom:5 prevents MapLibre from requesting DEM tiles at continental
      // scales where terrain is not meaningfully visible; maxzoom:15 matches the
      // native AWS Terrarium tile resolution (z16 returns 404s) — using the real
      // max eliminates the overzoom/stair-step/curtain artifacts that appeared
      // under the tilted 3D camera when zoomed past the old z13 cap.
      map.addSource('terrarium-dem', {
        type: 'raster-dem',
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        encoding: 'terrarium',
        minzoom: 5,
        maxzoom: 15,
        tileSize: 256,
      })

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

      // ── Register stretchable dark-pill sprite (county labels) ──────
      // MapLibre has no native text-background, so a 9-slice pill image
      // is drawn behind the name via icon-image + icon-text-fit:'both'.
      try {
        if (!map.hasImage('aem-pill-county')) {
          const p = makePillSprite({ border: '#f58cde' })
          map.addImage('aem-pill-county', p.image as any, p.options)
        }
      } catch {/* image already added by a racing call */}

      // ── Native marker GeoJSON sources (driven by setData effects) ───
      map.addSource('tract-pins', { type: 'geojson', data: EMPTY_FC })
      map.addSource('county-counts', { type: 'geojson', data: EMPTY_FC })

      // County NAME labels — restyled dark pill. Only between the
      // county tier and the tract tier; text-allow-overlap:false declutters
      // automatically. Hidden via setLayoutProperty when a filter is active
      // (the county-COUNT bubbles show instead).
      map.addLayer({
        id: 'county-labels',
        type: 'symbol',
        source: 'counties',
        minzoom: COUNTY_TIER_MIN,
        maxzoom: TRACT_TIER_MIN,
        layout: {
          'text-field': ['get', 'NAME'],
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 9, 13],
          'text-anchor': 'center',
          'text-max-width': 8,
          'text-allow-overlap': false,
          'icon-image': 'aem-pill-county',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [3, 7, 3, 7],
          'icon-allow-overlap': false,
          'icon-optional': false,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.4)',
          'text-halo-width': 0.6,
        },
      })

      // County COUNT bubbles (filter-active): pink circle + number.
      // Visibility toggled by setLayoutProperty(hasActiveFilters).
      map.addLayer({
        id: 'county-count-circles',
        type: 'circle',
        source: 'county-counts',
        maxzoom: TRACT_TIER_MIN,
        layout: { visibility: 'none' },
        paint: {
          'circle-color': '#E91E8C',
          'circle-radius': 16,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: 'county-count-labels',
        type: 'symbol',
        source: 'county-counts',
        maxzoom: TRACT_TIER_MIN,
        layout: {
          visibility: 'none',
          // Owner rule (2026-07-09): number only, no "TRACTS" word — the
          // count is now tracts + sold parcel-sale dots combined (see
          // countyCountGeoJSON above), so labeling it "tracts" would be
          // wrong as well as unwanted.
          // number-format adds thousands separators (1,402); small values
          // like 6 render unchanged.
          'text-field': ['number-format', ['get', 'count'], {}],
          'text-font': ['Open Sans Bold'],
          'text-size': 11,
          'text-anchor': 'center',
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#ffffff' },
      })

      // ── Tract pins (the crux) — circles + price/acres labels. Both
      // gated minzoom:TRACT_TIER_MIN. Driven by setData from the
      // tractPinGeoJSON memo; layers are NEVER recreated.
      map.addLayer({
        id: 'tract-pin-circles',
        type: 'circle',
        source: 'tract-pins',
        minzoom: TRACT_TIER_MIN,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 7],
          'circle-color': buildPinColorMatchExpression(),
          'circle-stroke-color': [
            'case',
            ['boolean', ['feature-state', 'highlighted'], false], '#E91E8C',
            '#ffffff',
          ],
          'circle-stroke-width': [
            'case',
            ['boolean', ['feature-state', 'highlighted'], false], 3,
            2,
          ],
        },
      })
      map.addLayer({
        id: 'tract-pin-labels',
        type: 'symbol',
        source: 'tract-pins',
        minzoom: TRACT_TIER_MIN,
        layout: {
          'text-field': ['get', 'pinLabel'],
          'text-font': ['Open Sans Bold'],
          'text-size': 11,
          'text-anchor': 'bottom',
          'text-offset': [0, -0.7],
          'text-allow-overlap': false,
          'text-optional': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.85)',
          'text-halo-width': 1.4,
        },
      })
      // Comp-mode-only "+" glyph on the SAME source/points as
      // tract-pin-circles — companion symbol layer, exactly the
      // DURABLE_DOT_PLUS_LAYER pattern (see that layer's comment), so
      // tract comps match parcel comps and mobile's comp map (both show
      // "+"). Explore mode never shows this — tract-pin-labels' own
      // price/acre text is untouched in both modes; this just adds the
      // "+" on top of the pin in comp mode. No separate click handler —
      // it sits on tract-pin-circles' existing point, whose onClick
      // (below) already opens the Add-to-Report popup in comp mode.
      // No zoom-gating change: TRACT_TIER_MIN is fine here (tract pins
      // use GG's own polygon data, not Regrid tiles, so they don't have
      // the "+" -without-an-outline problem the parcel dots had).
      map.addLayer({
        id: 'tract-pin-plus',
        type: 'symbol',
        source: 'tract-pins',
        minzoom: TRACT_TIER_MIN,
        layout: {
          'text-field': '+',
          'text-font': ['Open Sans Bold'],
          'text-size': 10, // matches DURABLE_DOT_PLUS_LAYER's sizing
          'text-anchor': 'center',
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'visibility': subjectTractIdRef.current ? 'visible' : 'none',
        },
        paint: {
          'text-color': '#ffffff',
        },
      })

      // ── Today's-auction green dots — NATIVE GL layer (replaces the old DOM
      // markers + JS clustering). Rendered as circle layers so every dot sits
      // EXACTLY on its stored lat/lng at every zoom (no cluster-centroid drift)
      // and stays fully opaque in 3D (DOM markers faded behind the terrain mesh).
      // Visible at ALL zooms (no minzoom) so today's auctions are always shown.
      map.addSource('today-pins', { type: 'geojson', data: EMPTY_FC })
      // Pulsing halo behind the core — the "live / auctioning now" affordance.
      // Radius + opacity are animated by the rAF effect below (only while there
      // are today dots). GL layer so the dot POSITION stays shader-exact at
      // every zoom; the pulse is the one thing that needs animation.
      map.addLayer({
        id: 'today-pin-pulse',
        type: 'circle',
        source: 'today-pins',
        paint: {
          'circle-color': '#22C55E',
          'circle-radius': 8,
          'circle-opacity': 0.35,
          'circle-stroke-width': 0,
        },
      })
      // Solid green core dot.
      map.addLayer({
        id: 'today-pin-core',
        type: 'circle',
        source: 'today-pins',
        paint: {
          'circle-color': '#16A34A',
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 5, 9, 6, 14, 8],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })

      // ── Owner "show on map" dots — chat search for a specific
      // owner's parcels ("show me William Sullivan's parcels near
      // Carthage IL"). Distinct blue (matches parcel-sale-dots-durable-
      // circle's every-zoom native-layer pattern) so it never reads as
      // an auction (green pulse) or a sold parcel (pink #f58cde).
      // Static — no pulse, since pulse means "live today" elsewhere on
      // this map. No minzoom: visible at every zoom so a wide owner
      // bbox doesn't vanish when the fitBounds lands on a zoomed-out
      // view. Driven by setData only; never recreated (see the
      // ownerParcelsResult effect above, right after mapLoaded).
      map.addSource('owner-parcels', { type: 'geojson', data: EMPTY_FC })
      map.addLayer({
        id: 'owner-parcels-dots',
        type: 'circle',
        source: 'owner-parcels',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 4, 14, 7],
          'circle-color': '#2D8CFF',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 1.5,
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

    map.on('zoomend', () => {
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
        // Created lazily (first polygon batch), so the owner-search gate's
        // effect may already have run — stamp the current gate state here
        // or a search-in-progress would show polygons the pins are hiding.
        layout: { visibility: ownerSearchActiveRef.current ? 'none' : 'visible' },
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
        layout: { visibility: ownerSearchActiveRef.current ? 'none' : 'visible' },
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
      // Keep native marker layers (pins/labels/today pulse) above the
      // polygons we just lifted.
      liftMarkerLayers(map)
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
        ? `${formatAcres(acresNum)} ac`
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
      if (props.acres != null) rows.push(`<div style="color:#6b7280;">${formatAcres(Number(props.acres))} ac</div>`)
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
  // boundaries render at zoom >= REGRID_MIN_ZOOM; owner/acres/$/date
  // text labels stay gated higher at REGRID_LABEL_MIN_ZOOM so dense
  // text doesn't clutter the map at browse zoom. Clicking a parcel
  // pops a panel with the full Premium Schema record from our
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
  // Map Phase 3 (2026-07-02): lowered 12 → 11 for parity with mobile —
  // Regrid serves NO tiles below z11 (verified against their CDN), so
  // 12 was one zoom level of pure dead air where the source was
  // "active" but every tile request came back empty. z9-10 (below
  // Regrid's real floor) is now covered by a SEPARATE durable-table
  // dot layer (see PARCEL_SALE_DOT_DURABLE_LAYER below) instead of
  // trying to push the Regrid source itself down to z9.
  const REGRID_MIN_ZOOM = 11
  // Label sub-layers. OWNER, 2026-07-31, in two rounds:
  //   - at 14 for everything: "a little too far in"
  //   - tried 11 (matching mobile explore, which runs the owner name
  //     alongside the boundaries): "that zoom level is too far out now"
  //   - settled on 12 (owner's call, after seeing 13 deployed).
  //
  // So: an owner-name-only layer covers 12 -> 14, and the full four-part
  // label (owner + acres + $/ac + sale date) takes over at 14. maxzoom on
  // the owner layer equals the combined layer's minzoom, so the handoff is
  // exact and the name is never drawn twice.
  //
  // NOTE this is deliberately NOT mobile-identical: mobile explore starts
  // its owner label at REGRID_MIN_ZOOM (11). The owner reviewed both and
  // chose 11 on mobile / 12 on web — a phone viewport holds far fewer
  // parcels at a given zoom, so the same number reads as much denser on a
  // desktop map. Don't "fix" this to match without asking.
  const REGRID_LABEL_MIN_ZOOM = 14
  const REGRID_OWNER_LABEL_MIN_ZOOM = 12
  const [regridConfig, setRegridConfig] = useState<{
    tile_url_template: string
    // Custom-source tiles name their MVT layer with the source UUID;
    // default tile uses 'parcels'. Optional so older backend responses
    // (without this field) still type-check.
    source_layer?: string
    is_sandbox: boolean
    has_token: boolean
    attribution: string
    // State-plan gate (basic_state / premium_state subscribers).
    // unlimited=true → no filter; otherwise show only parcels whose
    // path starts with /us/<abbrev>/ for one of these.
    unlimited?: boolean
    subscribed_state_abbrevs?: string[]
  } | null>(null)
  regridConfigRef.current = regridConfig

  // Memoized MapLibre filter expression for the state-plan gate.
  // null = unlimited (no filter applied). The tile carries
  // `path` = "/us/<state>/<county>/..." in lowercase; slice(4,6)
  // yields the 2-letter state.
  const regridStateFilter = useMemo<any | null>(() => {
    if (!regridConfig || regridConfig.unlimited) return null
    const states = (regridConfig.subscribed_state_abbrevs || []).map((s) => s.toLowerCase())
    if (states.length === 0) return null
    return ['in', ['slice', ['get', 'path'], 4, 6], ['literal', states]]
  }, [regridConfig])

  useEffect(() => {
    let cancelled = false
    const fetchConfig = async () => {
      try {
        // header_auth=1 → backend returns a clean tile_url_template with
        // no embedded ?t= token; auth is sent via Authorization header in
        // transformRequest instead. Accept as long as tile_url_template is
        // present — has_token will be false in this mode.
        const res = await fetchWithAuth(`${API_URL}/api/regrid/config?header_auth=1`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data?.tile_url_template) {
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
    const OWNER_LABEL_LAYER = 'regrid-parcels-owner-label'
    // Label TEXT comes from our own soils DB (see LABEL_LAYER below).
    const PARCEL_LABEL_SOURCE = 'parcel-labels'

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
      // Source maxzoom 14: MapLibre over-zooms (reuses) z=14 tiles
      // for zooms 15-21. Vector parcel boundaries scale without
      // quality loss. Cuts tile fetches ~75% vs the old maxzoom:21
      // (each additional zoom level beyond 14 was a fresh tile fetch).
      maxzoom: 14,
      // `path` is the feature identity used for hover (task #24):
      // custom Regrid tile layers never carry ll_uuid on the tile
      // features themselves (only on the click-fetch record), so
      // promoting ll_uuid left setFeatureState permanently unmatched
      // at z>=12 in production. `path` is present on every feature
      // in both tile sources and is stable per-parcel.
      promoteId: { [sourceLayer]: 'path' },
      // Required attribution per Schedule A §7. Surfaces in the
      // built-in attribution control at the bottom of the map.
      attribution: 'Parcel data &copy; <a href="https://regrid.com" target="_blank" rel="noopener">Regrid</a>',
    } as any)

    // Label-text source: one POINT per parcel, straight out of our
    // regrid_parcels table, carrying owner / ll_gisacre / saleprice /
    // saledate. Separate from the Regrid source above so outlines keep
    // coming from Regrid (unchanged, still cached) while the words on the
    // map come from the same rows the popup and comp report read.
    //
    // minzoom matches REGRID_LABEL_MIN_ZOOM — the endpoint returns an empty
    // tile below z14 anyway, so requesting them would be pure waste. No
    // maxzoom over-zoom trick here: points are cheap, and reusing a z14 tile
    // at z20 would place labels using stale geometry after an edit.
    if (!map.getSource(PARCEL_LABEL_SOURCE)) {
      map.addSource(PARCEL_LABEL_SOURCE, {
        type: 'vector',
        tiles: [`${API_URL}/api/tiles/parcel-labels/{z}/{x}/{y}.mvt`],
        // OWNER floor (12), not the full-label floor (14) — the owner-only
        // layer renders from z12 and reads this same source.
        minzoom: REGRID_OWNER_LABEL_MIN_ZOOM,
        maxzoom: 22,
      } as any)
    }

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
      ...(regridStateFilter ? { filter: regridStateFilter } : {}),
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
      ...(regridStateFilter ? { filter: regridStateFilter } : {}),
      paint: {
        'line-color': '#000000',
        'line-width': 2.2,
        'line-opacity': 0.85,
      },
    }, beforeId)

    // Owner + acres label — read from OUR soils DB, not from the Regrid
    // tile (owner, 2026-08-05: "the tile label text has to match the parcel
    // data ALWAYS... this should always read from cached data when cached
    // data is available in the soils DB").
    //
    // Regrid still draws the outlines above; only the text moved. Their tile
    // bakes in its own sale fields, which lag our cached copy — verified
    // against the Van Buren County IA assessor, where our table had a
    // $61,000 1987 sale that Regrid's tile carried no trace of, so the label
    // printed nothing while the popup showed the sale. Same row now feeds
    // both, so they cannot disagree.
    //
    // PARCEL_LABEL_SOURCE serves POINTS (one per parcel, ST_PointOnSurface)
    // rather than polygons — measured 1,076 bytes for a z14 tile against
    // 1,083 kB for the equivalent full-polygon tile. It also fixes the
    // duplicate-label problem noted below for free: one point per parcel
    // instead of one per clipped polygon piece.
    //
    // regridStateFilter is deliberately NOT applied here. It filtered
    // client-side on `path`, which this source doesn't emit — and doesn't
    // need to, because /api/tiles/parcel-labels scopes by the caller's
    // subscribed states server-side, which is the stronger guarantee.
    map.addLayer({
      id: LABEL_LAYER,
      type: 'symbol',
      source: PARCEL_LABEL_SOURCE,
      'source-layer': 'parcel-labels',
      minzoom: REGRID_LABEL_MIN_ZOOM,
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
        // Label sits AT the parcel's geometric centroid — the point
        // feature we emit per-uuid is already the area-weighted
        // centroid of all the parcel's clipped pieces, so anchor at
        // center with no offset.
        'text-anchor': 'center',
        'text-justify': 'center',
        'text-max-width': 9,
        'text-line-height': 1.15,
        // Regrid labels MUST NOT overlap each other — at low zoom
        // the map otherwise turns into a wall of white text. With
        // allow-overlap=false MapLibre drops the labels that would
        // collide; as the user zooms in, more parcels gain enough
        // space and the dropped labels reappear. ignore-placement=
        // false means Regrid labels also reserve their footprint
        // so the soil-rating labels (which are set to
        // text-ignore-placement=true below) can't overdraw them.
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-padding': 4,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4,
        // Comp-map coincident-dot collapse: a parcel whose sale dot sits
        // inside a GG tract's polygon has its owner/acres/$-acre/date
        // label folded into that tract's click panel instead (see
        // recomputeCoincidentDeeds above — reads owner/path straight off
        // this SAME tile source's rendered features, synchronously). We
        // can't FILTER this layer by ll_uuid — confirmed unreliable on
        // custom Regrid tile features (see the promoteId comment in this
        // same effect, which hit the identical wall for hover-
        // highlighting and switched to `path`) — so suppression is
        // feature-state driven instead, keyed on the same `path` id
        // promoteId already uses.
        // The label's placement footprint is still reserved even at
        // opacity 0 (allow-overlap/ignore-placement stay false above),
        // which is an accepted trade-off: the tract's own pink polygon
        // already visually dominates that spot, so it's very unlikely to
        // be the label that would've won the space anyway.
        'text-opacity': [
          'case',
          ['boolean', ['feature-state', 'dotSuppressed'], false], 0,
          1,
        ],
      },
    }, beforeId)

    // Owner-name-only label for z12 -> 14, so the name shows up before
    // the full four-part label does (owner 2026-07-31; see
    // the REGRID_OWNER_LABEL_MIN_ZOOM comment for how 13 was landed on).
    // maxzoom here is the same number as the combined layer's minzoom,
    // so the two hand off precisely and the owner name is never rendered
    // twice. Deliberately owner-only: acres/$-ac/date stay at 14 because
    // dense multi-line text over thousands of parcels is what costs
    // collision detection at the wider zooms.
    map.addLayer({
      id: OWNER_LABEL_LAYER,
      type: 'symbol',
      // Same soils-DB source as LABEL_LAYER. If this one stayed on the
      // Regrid tile, the owner name would still be stale between z12-14 —
      // the exact mismatch this change exists to remove (Regrid showed
      // "Rotenburger, Dennis L" where the county and our table both say
      // Jarid). State scoping is server-side here, so no client filter.
      source: PARCEL_LABEL_SOURCE,
      'source-layer': 'parcel-labels',
      minzoom: REGRID_OWNER_LABEL_MIN_ZOOM,
      maxzoom: REGRID_LABEL_MIN_ZOOM,
      layout: {
        'text-field': ['coalesce', ['get', 'owner'], 'Coming Soon'],
        'text-font': ['Open Sans Bold'],
        'text-size': 11,
        'text-max-width': 9,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': '#ffffff',
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4,
        // Same comp-map coincident-dot suppression as the combined layer.
        'text-opacity': [
          'case',
          ['boolean', ['feature-state', 'dotSuppressed'], false], 0,
          1,
        ],
      },
    }, beforeId)

    // Push tract polygons to the TOP of the layer stack — if Regrid
    // arrived after tract-polygon-* mounted, beforeId above missed
    // and Regrid landed on top. moveLayer (no second arg) lifts the
    // tract layers above everything.
    if (map.getLayer('tract-polygon-fill')) map.moveLayer('tract-polygon-fill')
    if (map.getLayer('tract-polygon-line')) map.moveLayer('tract-polygon-line')
    // Keep native marker layers above the polygons we just lifted.
    liftMarkerLayers(map)

    // Hover highlight — track which feature is under the cursor so
    // the fill brightens on hover. `path` promotion above (NOT ll_uuid,
    // which custom Regrid tiles never populate on tile features) means
    // setFeatureState targets the parcel reliably even across tiles.
    let hoveredPath: string | null = null
    const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      map.getCanvas().style.cursor = 'pointer'
      const newPath = (e.features[0].properties as any)?.path as string | undefined
      if (!newPath || newPath === hoveredPath) return
      if (hoveredPath) {
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer: sourceLayer, id: hoveredPath },
          { hover: false },
        )
      }
      hoveredPath = newPath
      map.setFeatureState(
        { source: SOURCE_ID, sourceLayer: sourceLayer, id: hoveredPath },
        { hover: true },
      )
    }
    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      if (hoveredPath) {
        map.setFeatureState(
          { source: SOURCE_ID, sourceLayer: sourceLayer, id: hoveredPath },
          { hover: false },
        )
        hoveredPath = null
      }
    }

    // Click — open the unified LandDetailPanel. Query all overlay layers
    // at the click point so the panel can show soil + crop data alongside
    // the parcel data without a competing anchored Popup.
    const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (!f) return
      // If the click also landed on a top-of-stack pin, that layer's own
      // handler opens its popup. Don't ALSO open the detail panel or the
      // user gets two stacked cards.
      // A tract ALWAYS wins over the parcel underneath it: if the click also
      // landed on a tract pin OR a tract polygon, that layer's own handler opens
      // the tract details. Never open the parcel/land panel for land that has a
      // tract on top of it.
      // Sale dots outrank the parcel fill (see SALE_DOT_LAYERS): all three
      // sale-dot layers must be here, not just parcel-sale-pin-plus.
      const topPinLayers = [...SALE_DOT_LAYERS, 'tract-pin-circles', 'tract-polygon-fill']
      if (clickClaimedByLayers(map, e.point, topPinLayers)) return
      const parcelProps: any = f.properties || {}
      const ll_uuid = (parcelProps.ll_uuid as string | undefined) || null

      // Also query soil layers and CSB at the same point so the panel
      // gets point-specific soil type and crop history.
      // Per-state PMTiles layers: soils-full-fill-{ST} and explore-nccpi-fill-{ST}.
      const soilLayerIds = [
        'parcel-enrichment-ssurgo-soils-fill',
        ...SOIL_PMTILES_STATES.map(st => `soils-full-fill-${st}`),
        ...SOIL_PMTILES_STATES.map(st => `explore-nccpi-fill-${st}`),
      ].filter(id => map.getLayer(id))
      const csbLayerIds = ['csb-fields-fill'].filter(id => map.getLayer(id))

      let soilProps: Record<string, any> | null = null
      let csbProps: Record<string, any> | null = null
      try {
        if (soilLayerIds.length) {
          const soilFeats = map.queryRenderedFeatures(e.point, { layers: soilLayerIds })
          if (soilFeats.length) soilProps = soilFeats[0].properties || {}
        }
        if (csbLayerIds.length) {
          const csbFeats = map.queryRenderedFeatures(e.point, { layers: csbLayerIds })
          if (csbFeats.length) csbProps = csbFeats[0].properties || {}
        }
      } catch {/* layers torn down mid-click */}

      // One click, one panel (task #26): opening the parcel/land panel
      // must close any tract or comp popup left open from a previous click,
      // AND (portalMode) tell the parent to close its Tract Detail slide-out.
      setSelectedSale(null)
      setCompPopup(null)
      onLandDetailOpen?.()
      setLandDetail({
        parcelProps,
        soilProps,
        csbProps,
        ll_uuid,
        // Bug fix 2026-07-15: custom Regrid tiles carry neither ll_uuid
        // nor a centroid on ordinary parcel-fill clicks — the raw click
        // point is the only reliable report target LandDetailPanel can
        // fall back to (fetchData's lat/lng lookup + the footer's
        // reportPoint gate).
        clickLng: e.lngLat.lng,
        clickLat: e.lngLat.lat,
        activeOverlay: baseOverlayRef.current,
        source: 'parcel',
      })
    }

    map.on('mousemove', FILL_LAYER, onMove)
    map.on('mouseleave', FILL_LAYER, onLeave)
    map.on('click', FILL_LAYER, onClick)

    // NOTE: previously had a dedup pump that wrote one Point per
    // ll_uuid into a separate GeoJSON source so the label layer
    // would render only one label per parcel. After multiple bug
    // rounds where labels silently disappeared on prod, we abandoned
    // the dedup approach in favour of binding the label symbol
    // directly to the Regrid vector tile source above. Multi-tile
    // parcels now show one label per clipped piece — visible
    // duplicates on a few large parcels are the cost of reliable
    // rendering on every parcel.

    // NO-COVERAGE FALLBACK (owner, 2026-08-05: "if I haven't cached the
    // data, then you're supposed to use Regrid's API").
    //
    // regrid_parcels doesn't cover the whole country. Where we hold nothing
    // — Oklahoma, for one — /api/tiles/parcel-labels returns Regrid's own
    // cached tile bytes instead, which carry Regrid's layer name rather than
    // 'parcel-labels'. With no layer bound to that name the labels simply
    // vanished there, which is how this first shipped and broke.
    //
    // So each label gets a twin, identical except for the source-layer it
    // reads. Exactly one of a pair ever has features for a given tile — the
    // endpoint emits our layer OR Regrid's, never both — so there is no
    // double-labelling, and cached data wins wherever it exists.
    //
    // Cloned from the specs added above rather than duplicating those large
    // layout/paint blocks, so the two can never drift apart.
    for (const baseId of [LABEL_LAYER, OWNER_LABEL_LAYER]) {
      const spec: any = (map.getStyle()?.layers || []).find((l: any) => l.id === baseId)
      if (!spec || map.getLayer(`${baseId}-regrid`)) continue
      map.addLayer({ ...spec, id: `${baseId}-regrid`, 'source-layer': sourceLayer } as any)
    }

    return () => {
      try {
        if (!map.getStyle()) return
        map.off('mousemove', FILL_LAYER, onMove)
        map.off('mouseleave', FILL_LAYER, onLeave)
        map.off('click', FILL_LAYER, onClick)
        for (const id of [`${OWNER_LABEL_LAYER}-regrid`, `${LABEL_LAYER}-regrid`, OWNER_LABEL_LAYER, LABEL_LAYER, LINE_LAYER, FILL_LAYER]) {
          if (map.getLayer(id)) map.removeLayer(id)
        }
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
        // Both label layers are removed above, so this is safe to drop too.
        if (map.getSource(PARCEL_LABEL_SOURCE)) map.removeSource(PARCEL_LABEL_SOURCE)
      } catch {
        // map already torn down
      }
    }
  }, [mapLoaded, regridConfig])

  // ─────────────────────────────────────────────────────────────────
  // Parcel-with-sale markers. One pink dot over every Regrid parcel in
  // the USA where the vector tile reports saleprice > 0. NO API calls —
  // we read straight off the same Regrid vector source we already loaded
  // for the parcel boundary layer. Coverage = every parcel in Regrid's
  // nationwide dataset.
  //
  // TWO visual modes on the SAME symbol layer:
  //   • Explore map (default): pink dot only, styled to match the Sold
  //     tract HTML pins (#f58cde, white ring).
  //   • Comparables mode (subjectTractId set): the pink dot + a white "+"
  //     overlaid on top, so admin can scan the area for comps.
  // The mode is driven off subjectTractId — same trigger the HTML tract
  // markers use to flip between labeled-pin and "+"-button form.
  // ─────────────────────────────────────────────────────────────────
  const PARCEL_SALE_PLUS_LAYER = 'parcel-sale-pin-plus'
  // Acreage floor: only parcels with a recorded sale AND >= 10 acres
  // (ll_gisacre, gisacre fallback) get a marker. Per user spec.
  const PARCEL_MIN_SALE_ACRES = 10
  // icon-size for the dot image (36px @ pixelRatio 2 = 18px base).
  // RESTORED 2026-07-26 (audit fix — see PARCEL_SALE_PLUS_LAYER's addLayer
  // below): a maplibre `circle` layer bound to this POLYGON source draws a
  // dot at every ring vertex of every parcel, not one dot per parcel. Only
  // a `symbol` layer with 'point' placement renders exactly one icon per
  // feature (at its point-on-surface), so the layer is back to type
  // 'symbol' and these icon-size constants are back in use.
  const PARCEL_DOT_ICON_SIZE = 0.78  // ≈14px — matches the 14px sold pin
  const PARCEL_COMP_ICON_SIZE = 1.2  // ≈22px — matches the comp "+" button
  // Re-enabled 2026-05-31. The original placement bug (pins landing on
  // neighboring parcels) came from a -42px text-translate that has since
  // been removed — the marker now sits AT the polygon centroid.
  //
  // DISABLED 2026-08-03 (owner bug report): this layer reads straight off
  // the live Regrid vector tile and its only filter is
  // buildRegridSaleDotFilter (saleprice/acreage/saledate/price — no
  // location fields at all) plus regridStateFilter (the subscription
  // state gate, not the user's county/state filter choice). Once zoomed
  // to REGRID_MIN_ZOOM (11) — exactly where Regrid's parcel boundary
  // lines start rendering — this layer took over from DURABLE_DOT_LAYER
  // (capped to maxzoom REGRID_MIN_ZOOM below) and showed pink dots for
  // EVERY county/state, ignoring an active county filter (e.g. McDonough
  // County, IL). Mobile hit the identical bug 2026-07-26 and fixed it the
  // next day by reverting to a single sale-dot layer — the durable one,
  // fed by /api/map/parcel-sale-dots with the same buildFilterParams the
  // tract fetch uses, uncapped (no maxzoom) — see ExploreMapView.js's
  // "THE ONLY sale-dot layer again" comment. Website never got that
  // revert. Porting it here: this flag now disables
  // PARCEL_SALE_PLUS_LAYER entirely (its mount/filter-sync/mode-sync
  // effects below all early-return on this flag), and DURABLE_DOT_LAYER /
  // DURABLE_DOT_PLUS_LAYER are uncapped again so they keep rendering
  // (filter-correct) above z11 instead of handing off to this layer.
  const REGRID_SALE_PINS_ENABLED = false

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !regridConfig?.tile_url_template) return
    if (!REGRID_SALE_PINS_ENABLED) return

    // Bulletproof the dot icon against style reloads. MapLibre clears all
    // addImage() images whenever the style reloads (basemap switch, etc.),
    // but this effect's deps don't re-fire on a style reload — so the
    // icon would silently go missing. On the explore map the marker is
    // icon-only, so a missing icon = NO dots at all (in comp mode the "+"
    // text still renders, which is why comp mode looked fine while
    // explore showed nothing). styleimagemissing re-creates the dot on
    // demand any time MapLibre asks for it.
    const onStyleImageMissing = (ev: { id: string }) => {
      if (ev.id === PARCEL_SALE_DOT_IMAGE) ensureParcelSaleDotImage(map)
    }
    map.on('styleimagemissing', onStyleImageMissing)

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

      // IMPORTANT: this is a SYMBOL layer (icon at the polygon centroid),
      // NOT a circle layer. A maplibre `circle` layer bound to a POLYGON
      // source renders a dot at every vertex of every parcel — that
      // produced strings of pink dots tracing the boundary lines. A
      // symbol layer with the default 'point' placement renders exactly
      // ONE marker at each polygon's label anchor, inside its parcel.
      //
      // The icon is the pink dot (matches the Sold tract pins). In
      // comparables mode we overlay a white "+" via text-field (set by
      // the mode-sync effect below) and bump icon-size up to the comp
      // "+"-button size.
      //
      // allow-overlap + ignore-placement are ON so EVERY priced parcel
      // shows a marker — per user spec "all parcels that have a price
      // should have a pin/+". Collision de-cluttering was hiding most of
      // them, which read as "not enough plus signs".
      ensureParcelSaleDotImage(map)
      const inCompModeNow = !!subjectTractIdRef.current
      if (!map.getLayer(PARCEL_SALE_PLUS_LAYER)) {
        // Compose the sale filter with the state-plan gate so basic_state
        // / premium_state subscribers don't see sale dots outside their
        // states either.
        const composedFilter: any = regridStateFilter
          ? ['all', filterExpr, regridStateFilter]
          : filterExpr
        map.addLayer({
          id: PARCEL_SALE_PLUS_LAYER,
          // RESTORED 2026-07-26 (owner: "pink dots come from what's on the
          // map" — every displayed sold parcel, owner+$/acre+saledate label
          // included, must have a dot). Was hidden 2026-07-04 ('visibility':
          // 'none', see git history) because DURABLE_DOT_LAYER was uncapped
          // and this layer would double-render the same parcels at
          // z>=REGRID_MIN_ZOOM. Fixed here by zoom-partitioning instead of
          // hiding: DURABLE_DOT_LAYER's maxzoom is now capped to
          // REGRID_MIN_ZOOM (see its setLayerZoomRange call below), so the
          // two layers never overlap — durable owns z9-11, this layer owns
          // z>=11, matching the live Regrid tile floor.
          //
          // AUDIT FIX 2026-07-26 round 2: a same-day change briefly swapped
          // this to a plain `circle` layer (styled like DURABLE_DOT_LAYER)
          // to visually match the durable dot with no seam at the zoom
          // boundary. That is WRONG — this source (REGRID_SOURCE /
          // 'regrid-parcels') is POLYGON geometry, and a maplibre `circle`
          // layer bound to a polygon source draws a circle at EVERY RING
          // VERTEX of every feature, not one dot per parcel — it rendered a
          // ring of dots tracing each parcel's boundary instead of a single
          // marker. Reverted to 'symbol': a symbol layer with the default
          // 'point' placement renders exactly ONE icon at each polygon's
          // point-on-surface. Kept everything else from that change
          // (un-hidden, minzoom: REGRID_MIN_ZOOM, the durable-layer zoom
          // cap, the coincident-deed opacity suppression) — see icon-opacity
          // / text-opacity in paint below for the suppression, now
          // expressed in symbol-layer terms since a symbol layer has no
          // circle paint.
          type: 'symbol',
          source: REGRID_SOURCE,
          'source-layer': sourceLayer,
          minzoom: REGRID_MIN_ZOOM,
          filter: composedFilter,
          layout: {
            'icon-image': PARCEL_SALE_DOT_IMAGE,
            'icon-size': inCompModeNow ? PARCEL_COMP_ICON_SIZE : PARCEL_DOT_ICON_SIZE,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            // "+" only in comp mode; empty string = dot only on explore.
            'text-field': inCompModeNow ? '+' : '',
            'text-font': ['Open Sans Bold'],
            'text-size': ['interpolate', ['linear'], ['zoom'], 12, 13, 16, 17],
            'text-allow-overlap': true,
            'text-ignore-placement': true,
            // No 'visibility': 'none' here (AUDIT FIX 2026-07-26, kept from
            // the reverted change) — DURABLE_DOT_LAYER is now zoom-capped
            // to REGRID_MIN_ZOOM instead, so the two layers partition by
            // zoom rather than one of them being permanently hidden.
          },
          paint: {
            'text-color': '#ffffff',
            // Coincident-deed suppression (BUG FIX 2026-07-26, kept from
            // the reverted change, re-expressed for a symbol layer): this
            // layer shares the SAME 'regrid-parcels' source/source-layer —
            // and therefore the same `path`-promoted feature id — as the
            // Regrid label layer above, which already hides a parcel's
            // label via 'dotSuppressed' feature-state whenever its sale is
            // folded into a tract's Recorded Deeds panel instead
            // (recomputeCoincidentDeeds sets/clears this feature-state,
            // keyed on `path`). Symbol layers have no circle-opacity —
            // icon-opacity/text-opacity are the equivalent, covering both
            // the dot icon and the comp-mode "+" glyph so a suppressed
            // parcel never shows either. Explore mode is unaffected:
            // recomputeCoincidentDeeds only ever sets dotSuppressed when
            // subjectTractIdRef is set (comp mode), and clears it all on
            // comp-mode exit (clearAllDeedSuppression), so every
            // standalone sold-parcel dot in explore mode keeps opacity 1.
            'icon-opacity': [
              'case',
              ['boolean', ['feature-state', 'dotSuppressed'], false], 0,
              1,
            ],
            'text-opacity': [
              'case',
              ['boolean', ['feature-state', 'dotSuppressed'], false], 0,
              1,
            ],
          },
        })
      }
    }
    mount()

    // Click — open the SAME full parcel-detail popup the parcel boundary
    // opens (address, township, property use, last sale, etc.), per user:
    // the dot should show the detailed card, not the lighter sale-only one.
    // We fetch the full Premium Schema record from our backend cache (which
    // hits Regrid only on a cache miss), showing a loading card immediately.
    //
    // ONE popup at a time: we keep a single instance and remove the
    // previous before opening a new one, so rapid clicks don't stack
    // multiple cards on the map. The 'regrid-parcel-popup' className
    // applies the styled-card CSS (transparent content box, no default
    // white padding) — without it the dark header overflowed maplibre's
    // default popup box and looked broken.
    let activePopup: maplibregl.Popup | null = null
    const onPinClick = async (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (!f) return
      // A tract ALWAYS wins over the sale-dot underneath it (task #26
      // priority: tract pin/polygon > sale dot > parcel fill > overlays).
      // If the click also landed on a tract pin or tract polygon, that
      // layer's own onClick (below) opens the tract details — don't ALSO
      // open the parcel/comp popup here.
      if (clickClaimedByLayers(map, e.point, ['tract-pin-circles', 'tract-polygon-fill'])) return
      const props: any = f.properties || {}
      const ll_uuid = props.ll_uuid as string | undefined
      const lng = e.lngLat.lng
      const lat = e.lngLat.lat

      // COMP MODE: the "+" is a comparable-picker, so open the same inline
      // CompInlinePopup the HTML tract "+" uses — it has the "Add to Report"
      // button (the raw parcel-detail maplibre popup has no such button).
      // EXPLORE MODE (no subject tract): fall through to the rich parcel
      // detail popup below.
      if (subjectTractIdRef.current) {
        if (activePopup) { try { activePopup.remove() } catch {/* gone */} activePopup = null }

        // Build the report-ready SaleDetail the SAME way the mobile app
        // does (ComparablesMapView.buildParcelSale): start from the tile
        // pin's lightweight props, then fetch the authoritative Premium
        // Schema record from /api/regrid/parcel and merge in the richer
        // fields (tillable acres, soil rating, exact acreage/price). The
        // website report panels read camelCase fields, so we populate
        // those; they derive the snake_case email payload themselves.
        const parcelId = ll_uuid || props.path || `parcel:${lng.toFixed(6)},${lat.toFixed(6)}`
        const toNum = (v: any): number | null => {
          if (v == null || v === '') return null
          const n = Number(v)
          return Number.isFinite(n) ? n : null
        }
        const buildParcelSale = (rec: any | null): SaleDetail => {
          const acres = (rec ? (toNum(rec.ll_gisacre) ?? toNum(rec.gisacre)) : null)
            ?? toNum(props.ll_gisacre) ?? toNum(props.gisacre)
          const salePrice = (rec ? toNum(rec.saleprice) : null) ?? toNum(props.saleprice)
          const saleDateRaw = (rec && rec.saledate) || props.saledate || null
          const ppa = (salePrice != null && acres != null && acres > 0)
            ? salePrice / acres : null
          const tillable = rec ? toNum(rec.tillable_acres) : null
          const soil = rec ? toNum(rec.soil_rating) : null
          const pctTillable = (tillable != null && acres != null && acres > 0)
            ? (tillable / acres) * 100 : null
          const owner = (rec && rec.owner) || props.owner || null
          return {
            // ll_uuid is the stable Regrid parcel id; report toggle/dedupe
            // keys off sale.id. Fall back to coords if the tile lacks a uuid.
            id: parcelId,
            listingId: null,
            tractId: null,
            auctionDate: typeof saleDateRaw === 'string' ? saleDateRaw.slice(0, 10) : null,
            totalAcres: acres,
            tillableAcres: tillable,
            soilRating: soil,
            pctTillable,
            companyName: owner,
            salePrice,
            pricePerAcre: ppa,
            county: (rec ? rec.county : null) || props.county || props.county_name || '',
            state: (rec ? (rec.state2 || rec.state) : null) || props.state || props.state_abbr || '',
            township: null,
            saleStatus: 'sold',
          }
        }

        // Show the popup immediately with pin-derived values (responsive),
        // then upgrade it once the authoritative record resolves.
        const point = map.project(e.lngLat)
        // One click, one panel (task #26): comp popup replaces any open
        // tract modal / land-detail panel from a previous click.
        setSelectedSale(null)
        setLandDetail(null)
        setCompPopup({ sale: buildParcelSale(null), pos: { x: point.x, y: point.y }, lngLat: [lng, lat] })

        ;(async () => {
          try {
            const qs = new URLSearchParams()
            if (ll_uuid) qs.set('ll_uuid', ll_uuid)
            else { qs.set('lat', String(lat)); qs.set('lng', String(lng)) }
            const res = await fetchWithAuth(`${API_URL}/api/regrid/parcel?${qs.toString()}`)
            if (!res.ok) return
            const data = await res.json()
            const rec = data?.parcel
            if (!rec) return
            const enriched = buildParcelSale(rec)
            // Only patch if the user is still looking at THIS parcel's popup.
            setCompPopup(prev => (prev && prev.sale.id === parcelId)
              ? { ...prev, sale: enriched } : prev)
          } catch {/* keep the pin-derived popup */}
        })()
        return
      }

      // Explore mode: open the unified LandDetailPanel (no competing Popup).
      // One click, one panel (task #26): clear any open tract modal / comp
      // popup left over from a previous click, AND (portalMode) tell the
      // parent to close its Tract Detail slide-out.
      setSelectedSale(null)
      setCompPopup(null)
      onLandDetailOpen?.()
      setLandDetail({
        parcelProps: props,
        soilProps: null,
        csbProps: null,
        ll_uuid: ll_uuid || null,
        // Bug fix 2026-07-15: this "+" pin's tile props don't reliably
        // carry ll_uuid either — same click-point fallback as the
        // FILL_LAYER handler above (lat/lng are already read into
        // local vars a few lines up for the comp-mode branch).
        clickLng: lng,
        clickLat: lat,
        activeOverlay: baseOverlayRef.current,
        source: 'parcel',
      })
    }
    const setPointer = () => { map.getCanvas().style.cursor = 'pointer' }
    const clearPointer = () => { map.getCanvas().style.cursor = '' }
    map.on('mouseenter', PARCEL_SALE_PLUS_LAYER, setPointer)
    map.on('mouseleave', PARCEL_SALE_PLUS_LAYER, clearPointer)
    map.on('click', PARCEL_SALE_PLUS_LAYER, onPinClick)

    return () => {
      if (timer) clearTimeout(timer)
      if (activePopup) { try { activePopup.remove() } catch {/* gone */} activePopup = null }
      try {
        map.off('styleimagemissing', onStyleImageMissing)
        if (!map.getStyle()) return
        map.off('mouseenter', PARCEL_SALE_PLUS_LAYER, setPointer)
        map.off('mouseleave', PARCEL_SALE_PLUS_LAYER, clearPointer)
        map.off('click', PARCEL_SALE_PLUS_LAYER, onPinClick)
        if (map.getLayer(PARCEL_SALE_PLUS_LAYER)) map.removeLayer(PARCEL_SALE_PLUS_LAYER)
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
    // Apply-atomic model: read appliedFilters (NOT the draft `filters`) so
    // this layer's filter only changes on Apply — the twin of the parcel
    // boundary/fill/label filter effect below. (Layer is currently always
    // hidden, but keep it consistent so a future re-enable can't leak.)
    const saleExpr: any = buildRegridSaleDotFilter(appliedFilters, PARCEL_MIN_SALE_ACRES)
    // Compose the state-plan gate so sale dots also respect the
    // subscriber's allowed state(s).
    const expr: any = regridStateFilter ? ['all', saleExpr, regridStateFilter] : saleExpr
    if (map.getLayer(PARCEL_SALE_PLUS_LAYER)) {
      try { map.setFilter(PARCEL_SALE_PLUS_LAYER, expr) } catch {/* layer torn down */}
    }
  }, [mapLoaded, regridStateFilter, appliedFilters.dateRange, appliedFilters.dateFrom, appliedFilters.dateTo, appliedFilters.salePriceMin, appliedFilters.salePriceMax, appliedFilters.acreageMin, appliedFilters.acreageMax])

  // RESTORED 2026-07-26 (audit fix — see PARCEL_SALE_PLUS_LAYER's addLayer
  // above, reverted back to a 'symbol' layer): this layer's icon-size and
  // text-field are set once at addLayer() time from inCompModeNow, which
  // is only read at layer-creation time — so this effect keeps them in
  // sync any time subjectTractId changes after that (mode flips between
  // explore's plain dot and comp mode's dot + "+" without recreating the
  // layer). The layer is un-hidden now (no more 'visibility': 'none'), so
  // this toggle is live again, not the dead/no-op branch it was when the
  // layer was permanently hidden.
  useEffect(() => {
    if (!REGRID_SALE_PINS_ENABLED) return
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!map.getLayer(PARCEL_SALE_PLUS_LAYER)) return
    const inComp = !!subjectTractId
    try {
      map.setLayoutProperty(PARCEL_SALE_PLUS_LAYER, 'text-field', inComp ? '+' : '')
      map.setLayoutProperty(PARCEL_SALE_PLUS_LAYER, 'icon-size', inComp ? PARCEL_COMP_ICON_SIZE : PARCEL_DOT_ICON_SIZE)
    } catch {/* layer torn down */}
  }, [mapLoaded, subjectTractId])

  // ─────────────────────────────────────────────────────────────────
  // Durable-table parcel-sale dots — THE ONLY sale-dot layer in EXPLORE
  // mode (owner directive 2026-07-04: "the dots should never change... as
  // soon as I'm zoomed in enough to see dots, they should never go away no
  // matter how much I zoom in"). Reads OUR OWN durable copy of parcel-sale
  // data (backend /api/map/parcel-sale-dots → regrid_parcels on the Soils
  // DB, kept fresh by a write-through sync on every Regrid tile fetch)
  // instead of Regrid tiles directly, at every zoom >= DURABLE_DOT_MIN_ZOOM
  // in explore mode — no upper bound. Replaces the two-layer design
  // shipped 2026-07-02 (this layer capped at z11 handing off to the live
  // PARCEL_SALE_PLUS_LAYER Regrid-tile layer) — that handoff produced a
  // visible pop (different rendering pipeline, tile-load latency) exactly
  // at the boundary. At high zoom the viewport is tiny so the row count
  // fetched stays small on its own; no row cap is ever applied (owner
  // standing rule).
  //
  // COMP MODE (AUDIT FIX 2026-07-04 round 2): this layer's onClick
  // branches on subjectTractIdRef.current to open the same comp
  // add-to-report popup PARCEL_SALE_PLUS_LAYER's onPinClick used to open,
  // so PARCEL_SALE_PLUS_LAYER is now hidden unconditionally (both modes —
  // see its mode-sync effect above) to avoid double-rendering the same
  // parcels at z>=REGRID_MIN_ZOOM.
  //
  // COMP MODE MINZOOM (OWNER RULING 2026-07-25, supersedes the 2026-07-11
  // comp-mode z11 floor): tract dots and parcel-sale dots must appear at
  // the SAME zoom on every map. Comp mode now shares explore's
  // DURABLE_DOT_MIN_ZOOM (9) floor instead of REGRID_MIN_ZOOM (11) — set
  // via setLayerZoomRange in the mode-sync effect right below the mount
  // effect. Below z11 the Regrid parcel-boundary layer still renders
  // nothing (empirically 204 at z10, and that tile floor stays put — see
  // REGRID_MIN_ZOOM's own comment), so a dot at z9-10.99 in comp mode has
  // no outline under it yet; the click handler below compensates by
  // zooming to REGRID_MIN_ZOOM before opening the popup ("zoom to it +
  // open" per owner decision) instead of gating the dot's visibility.
  // This layer also carries a companion symbol layer,
  // DURABLE_DOT_PLUS_LAYER, with a white "+" text-field visible ONLY in
  // comp mode — plain pink circles read as "no dots" per the bug report.
  //
  // Fade only on the way OUT (zooming below DURABLE_DOT_MIN_ZOOM), which
  // now applies identically in both modes since comp mode's floor matches
  // explore's: circle-opacity/circle-stroke-opacity interpolate 0 at z8.8
  // to fully opaque at z9.3. Above z9.3 the style is 100% constant — same
  // radius/color/stroke at every zoom.
  //
  // Styled identical to the live sale-dot pin (#f58cde pink, white
  // ring) so there's no visual seam between explore and comp mode.
  //
  // Click behavior branches on comp mode (AUDIT FIX 2026-07-04 round 2 —
  // the owner directive has no comp-mode exception, so this layer is now
  // uncapped and click-correct in BOTH modes, not just explore):
  //   EXPLORE: opens the unified LandDetailPanel (unchanged).
  //   COMP: opens the SAME inline CompInlinePopup that PARCEL_SALE_PLUS_LAYER's
  //   onPinClick opens (buildParcelSale/setCompPopup), so a click here has
  //   IDENTICAL behavior to clicking the "+" pin used to have at z>=11 —
  //   the durable payload's `id` IS the ll_uuid, so /api/regrid/parcel
  //   resolves the full record the same way.
  // ─────────────────────────────────────────────────────────────────
  const DURABLE_DOT_SOURCE = 'parcel-sale-dots-durable'
  const DURABLE_DOT_LAYER = 'parcel-sale-dots-durable-circle'
  // Comp-mode-only "+" glyph, symbol layer on the SAME source/points as
  // DURABLE_DOT_LAYER — mirrors mobile's ComparablesMapView.js durable-dot
  // pattern (parcel-sale-dots-durable-symbol). Explore mode never shows
  // this (visibility toggled by the mode-sync effect below); comp mode
  // needs it so a comp dot reads as "tap to add" instead of a plain pink
  // circle (bug report: "reads as no dots"). No separate click handler —
  // it sits exactly on top of DURABLE_DOT_LAYER's circle at the same
  // point, so that layer's existing onClick (below) already fires for
  // clicks on the glyph.
  const DURABLE_DOT_PLUS_LAYER = 'parcel-sale-dots-durable-symbol'
  const DURABLE_DOT_MIN_ZOOM = 9
  const DURABLE_DOT_MIN_ACRES = 10 // owner rule: never show parcel dots under 10 acres

  // Selected comps recolour their dot (owner, 2026-08-05: "when I add a
  // parcel to the report, the plus sign icon used to change to blue but
  // that's not working anymore"). The web dot's circle-color was a hardcoded
  // pink with no selected state at all, so nothing could ever recolour it —
  // mobile has had this since launch (ComparablesMapView.js ~2097:
  // `['case', ['==', ['get','selected'], 1], '#16A34A', '#E91E8C']`).
  //
  // Driven by a paint expression rather than a `selected` feature property,
  // because these features live in the append-only durableDotsByIdRef
  // accumulator — baking selection into them would mean rebuilding and
  // re-pushing the whole union on every add/remove. setPaintProperty
  // recolours in place and touches no data.
  //
  // Colour matches mobile (#16A34A) so the two platforms agree; the owner
  // remembered it as blue, so this is the one thing to confirm.
  const DURABLE_DOT_COLOR = '#f58cde'
  const DURABLE_DOT_SELECTED_COLOR = '#16A34A'

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const ids = Array.from(selectedIds)
    const colorExpr: any = ids.length
      ? ['case', ['in', ['get', 'id'], ['literal', ids]],
         DURABLE_DOT_SELECTED_COLOR, DURABLE_DOT_COLOR]
      : DURABLE_DOT_COLOR
    // DURABLE_DOT_LAYER is the only circle layer that renders comp dots —
    // parcel-sale-pin-plus is a symbol ("+" glyph) drawn on top of it and
    // has no circle-color to set.
    if (!map.getLayer(DURABLE_DOT_LAYER)) return
    try { map.setPaintProperty(DURABLE_DOT_LAYER, 'circle-color', colorExpr) }
    catch {/* layer torn down mid-update */}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, mapLoaded, subjectTractId])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    if (!map.getSource(DURABLE_DOT_SOURCE)) {
      map.addSource(DURABLE_DOT_SOURCE, { type: 'geojson', data: EMPTY_FC })
    }
    // OWNER RULING 2026-07-25 (supersedes the 2026-07-11 comp-mode z11
    // floor): comp mode now shares explore's DURABLE_DOT_MIN_ZOOM (9)
    // floor for the dot itself — tract dots and parcel-sale dots must
    // appear at the same zoom everywhere. Below REGRID_MIN_ZOOM (11) the
    // Regrid parcel-boundary layer still renders nothing (empirically 204
    // at z10), so a comp dot at z9-10.99 has no parcel outline under it
    // yet and can't be opened in place; the click handler below zooms to
    // REGRID_MIN_ZOOM first, then opens ("zoom to it + open"). Retained
    // as a variable (rather than inlining DURABLE_DOT_MIN_ZOOM below)
    // since the "+" glyph layer further down still branches on comp mode.
    const inCompModeAtMount = !!subjectTractIdRef.current
    // Captured BEFORE addLayer() below — the click-handler registration
    // further down must run exactly once (on first mount), but it used
    // to share this same `!map.getLayer(DURABLE_DOT_LAYER)` check, which
    // would now always read false there since the layer was just added
    // a few lines above it.
    const isFirstMount = !map.getLayer(DURABLE_DOT_LAYER)
    if (isFirstMount) {
      map.addLayer({
        id: DURABLE_DOT_LAYER,
        type: 'circle',
        source: DURABLE_DOT_SOURCE,
        // No maxzoom — uncapped in BOTH explore and comp mode. The owner
        // directive ("dots should never change... never go away no matter
        // how much I zoom in") has no comp-mode exception, and the
        // 2026-07-25 ruling extends that to minzoom too: DURABLE_DOT_MIN_ZOOM
        // now applies in BOTH modes (was REGRID_MIN_ZOOM in comp mode —
        // see the mode-sync effect below, kept in sync there for symmetry
        // even though it's now a constant across the mode flip).
        minzoom: DURABLE_DOT_MIN_ZOOM,
        paint: {
          // Matches ensureParcelSaleDotImage: #f58cde fill, white ring.
          'circle-color': DURABLE_DOT_COLOR,
          'circle-radius': 6,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-opacity': ['interpolate', ['linear'], ['zoom'], 8.8, 0, 9.3, 1],
          'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 8.8, 0, 9.3, 1],
        },
      })
    }
    if (!map.getLayer(DURABLE_DOT_PLUS_LAYER)) {
      map.addLayer({
        id: DURABLE_DOT_PLUS_LAYER,
        type: 'symbol',
        source: DURABLE_DOT_SOURCE,
        // OWNER RULING 2026-07-25: the "+" must show whenever the dot
        // shows, so this layer now shares DURABLE_DOT_MIN_ZOOM with
        // DURABLE_DOT_LAYER (was pinned to REGRID_MIN_ZOOM). It's still
        // ONLY ever visible in comp mode (layout.visibility gated below),
        // just no longer gated to a higher zoom than the dot itself.
        minzoom: DURABLE_DOT_MIN_ZOOM,
        layout: {
          'text-field': '+',
          'text-font': ['Open Sans Bold'],
          'text-size': 10, // sized to sit inside the 6px-radius / 12px dot
          'text-allow-overlap': true,
          'text-ignore-placement': true,
          'visibility': inCompModeAtMount ? 'visible' : 'none',
        },
        paint: {
          'text-color': '#ffffff',
        },
      })
    }
    if (isFirstMount) {
      let activePopup: maplibregl.Popup | null = null
      const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const f = e.features?.[0]
        if (!f || f.geometry.type !== 'Point') return
        // Task #26: this layer's minzoom (9) overlaps tract-pin-circles'
        // (minzoom TRACT_TIER_MIN=9) — a tract pin can sit directly over a
        // durable dot at those zooms. Tract always wins; defer to its own
        // onClick (tract-pin-circles / tract-polygon-fill handler).
        if (clickClaimedByLayers(map, e.point, ['tract-pin-circles', 'tract-polygon-fill'])) return
        const [lng, lat] = f.geometry.coordinates as [number, number]
        const props: any = f.properties || {}
        const ll_uuid = props.id as string | undefined

        if (subjectTractIdRef.current) {
          // OWNER RULING 2026-07-25 ("zoom to it + open"): the dot now
          // shows as low as z9 in comp mode (see the mount effect above),
          // but the Regrid parcel-boundary tile it should sit on still
          // only renders at REGRID_MIN_ZOOM (11). Tapping a dot below that
          // zoom first eases the camera to REGRID_MIN_ZOOM on that dot,
          // then falls straight through to the same popup logic that runs
          // unchanged at z>=11 today — no separate code path, just an
          // extra camera move ahead of it.
          if (map.getZoom() < REGRID_MIN_ZOOM) {
            map.easeTo({ center: [lng, lat], zoom: REGRID_MIN_ZOOM, duration: 900 })
          }
          // COMP MODE: same inline CompInlinePopup + buildParcelSale shape
          // PARCEL_SALE_PLUS_LAYER's onPinClick builds (see that handler
          // above) — parity is required now that this layer is the sole
          // comp-mode dot display at every zoom, not just z9-11.
          if (activePopup) { try { activePopup.remove() } catch {/* gone */} activePopup = null }
          const parcelId = ll_uuid || `parcel:${lng.toFixed(6)},${lat.toFixed(6)}`
          const toNum = (v: any): number | null => {
            if (v == null || v === '') return null
            const n = Number(v)
            return Number.isFinite(n) ? n : null
          }
          const buildDurableSale = (rec: any | null): SaleDetail => {
            const acres = (rec ? (toNum(rec.ll_gisacre) ?? toNum(rec.gisacre)) : null) ?? toNum(props.acres)
            const salePrice = (rec ? toNum(rec.saleprice) : null) ?? toNum(props.saleprice)
            const saleDateRaw = (rec && rec.saledate) || props.saledate || null
            const ppa = (salePrice != null && acres != null && acres > 0) ? salePrice / acres : null
            const tillable = rec ? toNum(rec.tillable_acres) : null
            const soil = rec ? toNum(rec.soil_rating) : null
            const pctTillable = (tillable != null && acres != null && acres > 0)
              ? (tillable / acres) * 100 : null
            const owner = (rec && rec.owner) || null
            return {
              id: parcelId,
              listingId: null,
              tractId: null,
              auctionDate: typeof saleDateRaw === 'string' ? saleDateRaw.slice(0, 10) : null,
              totalAcres: acres,
              tillableAcres: tillable,
              soilRating: soil,
              pctTillable,
              companyName: owner,
              salePrice,
              pricePerAcre: ppa,
              county: (rec ? rec.county : null) || '',
              state: (rec ? (rec.state2 || rec.state) : null) || '',
              township: null,
              saleStatus: 'sold',
            }
          }
          const point = map.project(e.lngLat)
          setSelectedSale(null)
          setLandDetail(null)
          setCompPopup({ sale: buildDurableSale(null), pos: { x: point.x, y: point.y }, lngLat: [lng, lat] })
          ;(async () => {
            try {
              const qs = new URLSearchParams()
              if (ll_uuid) qs.set('ll_uuid', ll_uuid)
              else { qs.set('lat', String(lat)); qs.set('lng', String(lng)) }
              const res = await fetchWithAuth(`${API_URL}/api/regrid/parcel?${qs.toString()}`)
              if (!res.ok) return
              const data = await res.json()
              const rec = data?.parcel
              if (!rec) return
              const enriched = buildDurableSale(rec)
              setCompPopup(prev => (prev && prev.sale.id === parcelId)
                ? { ...prev, sale: enriched } : prev)
            } catch {/* keep the pin-derived popup */}
          })()
          return
        }

        // EXPLORE MODE: open the unified LandDetailPanel (unchanged). The
        // durable payload's `id` IS the ll_uuid — /api/regrid/parcel
        // accepts it directly, so LandDetailPanel's own fetchData resolves
        // the full record itself.
        // One click, one panel: clear any open tract modal / comp popup,
        // AND (portalMode) tell the parent to close its Tract Detail slide-out.
        setSelectedSale(null)
        setCompPopup(null)
        onLandDetailOpen?.()
        setLandDetail({
          parcelProps: { ll_uuid: props.id, centroid_lat: lat, centroid_lng: lng },
          soilProps: null,
          csbProps: null,
          ll_uuid: props.id || null,
          // ll_uuid is already guaranteed here, but every 'parcel'-source
          // setLandDetail call carries the click point for consistency.
          clickLng: lng,
          clickLat: lat,
          activeOverlay: baseOverlayRef.current,
          source: 'parcel',
        })
        // Owner spec 2026-07-02: strong zoom-in ALONGSIDE the details panel
        // (not either/or) — z14.5 puts the parcel + its labels on screen.
        map.easeTo({ center: [lng, lat], zoom: 14.5, duration: 900 })
      }
      const setPointer = () => { map.getCanvas().style.cursor = 'pointer' }
      const clearPointer = () => { map.getCanvas().style.cursor = '' }
      map.on('click', DURABLE_DOT_LAYER, onClick)
      map.on('mouseenter', DURABLE_DOT_LAYER, setPointer)
      map.on('mouseleave', DURABLE_DOT_LAYER, clearPointer)
    }

    return () => {
      try {
        if (!map.getStyle()) return
        if (map.getLayer(DURABLE_DOT_PLUS_LAYER)) map.removeLayer(DURABLE_DOT_PLUS_LAYER)
        if (map.getLayer(DURABLE_DOT_LAYER)) map.removeLayer(DURABLE_DOT_LAYER)
        if (map.getSource(DURABLE_DOT_SOURCE)) map.removeSource(DURABLE_DOT_SOURCE)
      } catch {/* map already torn down */}
    }
  }, [mapLoaded])

  // Keep the durable-dot "+" glyph in sync with comp mode, on every
  // subjectTractId change (mount always happens in whatever mode is
  // active at the time, captured above as inCompModeAtMount — this effect
  // covers a mode flip on an already-mounted map). OWNER RULING 2026-07-25:
  // DURABLE_DOT_LAYER's zoom range stays at the DURABLE_DOT_MIN_ZOOM=9
  // floor in BOTH modes now (was raised to REGRID_MIN_ZOOM=11 in comp
  // mode — see the mount effect above for the superseded rationale and
  // the click handler for how comp mode now handles the sub-z11 gap
  // instead: zoom to it, then open). setLayerZoomRange is still called
  // here every mode flip for symmetry with the "+" glyph's visibility
  // toggle below, even though the range itself no longer varies by mode.
  // Goat Search / filter-panel gate (owner bug report 2026-07-21): a
  // search that constrains LISTINGS/TRACTS can NEVER be satisfied by a
  // raw Regrid sale parcel — see shouldHideParcelDotsForFilters'
  // docstring (src/lib/parcelDotsFilterGate.ts) for the full field-list
  // rationale and the future-evolution note (delete a field from that
  // ONE shared list, not from every map, once the backend endpoint
  // understands it). FilterState's field names match ParcelDotsGateInput
  // 1:1 (both mirror get_map_parcel_sale_dots' query params), so this is
  // a direct pass-through — no per-map adapter needed here. This effect
  // reacts to the SAME filter fields the moveend-fetch effect below
  // reacts to, and re-applies visibility on every one of their changes,
  // not just on mount, so panning after a search can't un-hide them.
  // Owner-search gate (see ownerSearchActive above) ORs in here so the
  // durable/parcel-sale dot layers hide for the SAME reason a
  // filter-panel search would hide them, and restore correctly the
  // instant ownerSearchActive goes false again — one boolean, one
  // effect, no separate restore path to keep in sync.
  // Apply-atomic model (owner spec 2026-07-25): the durable-dot HIDE gate
  // reads appliedFilters, NOT the draft `filters` the panel edits — the
  // pink dots must not vanish/reappear while the user is mid-edit; they
  // only change on Apply, same as every other layer.
  const hideParcelDotsForFilters = shouldHideParcelDotsForFilters(appliedFilters) || ownerSearchActive

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const inComp = !!subjectTractId
    try {
      if (map.getLayer(DURABLE_DOT_LAYER)) {
        // UNCAPPED 2026-08-03 (owner bug report — reverts the 2026-07-26
        // cap): PARCEL_SALE_PLUS_LAYER (the live-tile dot layer that used
        // to own z>=REGRID_MIN_ZOOM) is now disabled — see
        // REGRID_SALE_PINS_ENABLED above — because its filter is
        // location-blind and showed unfiltered dots for every county past
        // z11. This durable layer is the only sale-dot layer again, so it
        // must render past REGRID_MIN_ZOOM too, same as mobile's uncapped
        // parcel-sale-dots-durable-circle (ExploreMapView.js).
        map.setLayerZoomRange(DURABLE_DOT_LAYER, DURABLE_DOT_MIN_ZOOM, 24)
        map.setLayoutProperty(DURABLE_DOT_LAYER, 'visibility', hideParcelDotsForFilters ? 'none' : 'visible')
      }
      if (map.getLayer(DURABLE_DOT_PLUS_LAYER)) {
        // Same uncap as DURABLE_DOT_LAYER above — this "+" glyph sits on
        // the same source/points and must stay in sync with it at every
        // zoom now that the live-tile handoff no longer exists.
        map.setLayerZoomRange(DURABLE_DOT_PLUS_LAYER, DURABLE_DOT_MIN_ZOOM, 24)
        map.setLayoutProperty(DURABLE_DOT_PLUS_LAYER, 'visibility', (inComp && !hideParcelDotsForFilters) ? 'visible' : 'none')
      }
      // AUDIT FIX 2026-07-26: PARCEL_SALE_PLUS_LAYER (the live-tile dot
      // layer that owns z>=REGRID_MIN_ZOOM) was never wired to this gate —
      // a Listed/Live status filter or an active owner search hid
      // DURABLE_DOT_LAYER at z9-11 but left this layer's sold-parcel dots
      // showing at z>=11, the exact zoom band real usage happens in. Same
      // boolean, same reasoning as DURABLE_DOT_LAYER above: hide on a
      // status filter that excludes sold parcels, or while an owner search
      // is active (matches mobile's ExploreMapView.js, which already gates
      // its live-tile layer on hideDurableDotsForFilters || ownerSearchActive).
      if (map.getLayer(PARCEL_SALE_PLUS_LAYER)) {
        map.setLayoutProperty(PARCEL_SALE_PLUS_LAYER, 'visibility', hideParcelDotsForFilters ? 'none' : 'visible')
      }
    } catch {/* layer torn down */}
  }, [
    mapLoaded, subjectTractId, hideParcelDotsForFilters,
    appliedFilters.soilRatingMin, appliedFilters.soilRatingMax,
    appliedFilters.pctTillableMin, appliedFilters.pctTillableMax,
    appliedFilters.landTypes, appliedFilters.listingType,
    appliedFilters.pricePerAcreMin, appliedFilters.pricePerAcreMax,
    appliedFilters.askingPriceMin, appliedFilters.askingPriceMax,
    appliedFilters.pricePerSoilRatingMin, appliedFilters.pricePerSoilRatingMax,
    appliedFilters.nearLat, appliedFilters.nearLng, appliedFilters.radiusMiles,
    appliedFilters.cornersMin, appliedFilters.cornersMax,
    appliedFilters.companyName, appliedFilters.buyer, appliedFilters.seller,
    appliedFilters.hasHouse, appliedFilters.hasBuildings, appliedFilters.hasPolygon, appliedFilters.keyword,
  ])

  // LIVE-VERIFIED FINDING (production, 8/8 durable-dot uuids): the async
  // /api/regrid/parcel?ll_uuid= lookup 404s for EVERY durable-dot uuid —
  // that endpoint's cache/live-Regrid/durable-fallback chain is keyed off
  // a different parcel universe than parcel_sale_dots. It is NOT used for
  // owner/path resolution any more (removed). Instead, owner + `path` are
  // read SYNCHRONOUSLY off the live Regrid TILE feature at the dot's own
  // point (queryRenderedFeatures against 'regrid-parcels-fill') — verified
  // live to carry `owner`, `path`, `saleprice`, `saledate`, `gisacre`/
  // `ll_gisacre`, `parcelnumb` (no ll_uuid, which is exactly why the
  // hover-highlight effect above promotes `path`, not `ll_uuid`, as this
  // source's feature id). No network call, no race — just needs the tile
  // covering that point to be loaded, which it normally is at comp zoom
  // (>=REGRID_MIN_ZOOM=11). MOBILE PARITY: ComparablesMapView.js should
  // read owner/path the same way — query the live Regrid tile at the
  // dot's projected point — NOT call the parcel-detail endpoint for this.
  //
  // (suppressedPathsRef / deedPathByUuidRef / resolvedDeedUuidsRef are
  // declared up near tractDeeds, at the top of the component.)

  // Un-suppress every currently-hidden Regrid label and reset all deed
  // bookkeeping. Called from THREE places: comp-mode exit
  // (recomputeCoincidentDeeds below), a chat search applying a new
  // filter set, and a filter-panel change (both further below) — any of
  // these invalidates the previous coincident-deed fold, and the labels
  // it hid must actually come back (AUDIT FIX, HIGH: dotSuppressed used
  // to be a one-way ratchet — set but never cleared here, so hidden
  // labels stayed blank all session, including leaking past comp-mode
  // exit into explore mode).
  const clearAllDeedSuppression = useCallback(() => {
    const map = mapRef.current
    if (map) {
      const sourceLayer = regridConfigRef.current?.source_layer || 'parcels'
      for (const path of Array.from(suppressedPathsRef.current)) {
        try {
          map.removeFeatureState({ source: 'regrid-parcels', sourceLayer, id: path }, 'dotSuppressed')
        } catch {/* source torn down */}
      }
    }
    suppressedPathsRef.current = new Set()
    suppressedDeedUuidsRef.current = new Set()
    resolvedDeedUuidsRef.current = new Set()
    deedPathByUuidRef.current = new Map()
    setTractDeeds(new Map())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-derive the coincident-deed set from the two live accumulators
  // (durableDotsByIdRef, tractMapRef) and push the result to both the
  // durable-dot GL source (suppressing coincident dots) and tractDeeds
  // state (feeding the click panel). Called with no arguments — always
  // reads the CURRENT ref contents rather than taking them as params, so
  // it can't go stale no matter which of the several triggers fired
  // (dots merged, tracts loaded, subjectTractId changed, sourcedata retry
  // for a tile that wasn't loaded yet).
  //
  // IDEMPOTENT BY DESIGN (AUDIT FIX, HIGH): this function used to call
  // setData/setTractDeeds/setFeatureState UNCONDITIONALLY every time it
  // ran. Combined with the (now-removed) 'idle' retry listener, that was
  // an infinite loop — setData on a GL source briefly un-idles the map,
  // which re-fires 'idle', which called this again, which called setData
  // again. Every branch below now diffs the freshly-computed result
  // against what's ACTUALLY committed (suppressedDeedUuidsRef/
  // suppressedPathsRef/tractDeedsRef) and skips the corresponding
  // mutation when nothing changed — a repeat call with no new
  // information now does ZERO setState/setData/setFeatureState calls.
  // Comp-map-only: explore mode always shows every dot (spec constraint).
  const recomputeCoincidentDeeds = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource(DURABLE_DOT_SOURCE) as maplibregl.GeoJSONSource | undefined
    const sourceLayer = regridConfigRef.current?.source_layer || 'parcels'

    if (!subjectTractIdRef.current) {
      // Explore mode (or comp mode just exited via subjectTractId->null)
      // — nothing should ever stay suppressed here, so un-hide any label
      // still hidden from a just-exited comp mode (AUDIT FIX), then
      // ALWAYS push the full accumulated dot set to the source. BUG FIX
      // (2026-07-13, owner: explore map showing no parcel-sale dots):
      // this used to setData ONLY inside the `size > 0` un-suppress
      // branch, so a fresh explore-mode fetch (nothing ever suppressed,
      // size always 0) populated durableDotsByIdRef but never reached
      // the GL source — dots were fetched and silently dropped. No loop
      // risk: nothing listens on DURABLE_DOT_SOURCE's own data event to
      // re-call this (see call sites: the two fetch call sites, the
      // tracts/subjectTractId effect, and the comp-mode-only sourcedata
      // listener gated on the 'regrid-parcels' source, none of which
      // fire off this source's setData).
      if (suppressedDeedUuidsRef.current.size > 0 || suppressedPathsRef.current.size > 0) {
        clearAllDeedSuppression()
      }
      if (src) {
        src.setData({
          type: 'FeatureCollection',
          features: Array.from(durableDotsByIdRef.current.values()),
        })
      }
      return
    }

    // tract.polygon_coordinates is fetched via include_polygons=true on
    // every tract bounds request (both explore and comp mode), so every
    // tract currently in tractMapRef has boundary data to test against —
    // no separate polygon fetch needed here.
    const tractList = Array.from(tractMapRef.current.values()).filter(t => t.polygon_coordinates)
    const newDeeds = new Map<string, RecordedDeed[]>()
    const newSuppressedUuids = new Set<string>()
    const newSuppressedPaths = new Set<string>()

    for (const dotFeature of Array.from(durableDotsByIdRef.current.values())) {
      if (dotFeature.geometry.type !== 'Point') continue
      const [lng, lat] = dotFeature.geometry.coordinates as [number, number]
      for (const t of tractList) {
        if (!pointInBoundary([lng, lat], t.polygon_coordinates)) continue
        const props = dotFeature.properties as any
        const uuid = props.id as string
        newSuppressedUuids.add(uuid)

        // Owner + path: read straight off the live Regrid TILE feature —
        // synchronous, no /api/regrid/parcel call (see comment above).
        let owner: string | null = null
        let path: string | null = null
        let tileFound = false
        if (resolvedDeedUuidsRef.current.has(uuid)) {
          // Already found the tile feature on a prior pass — reuse the
          // owner we read then instead of re-querying every recompute
          // (and so a dot that's scrolled off-screen, tile unloaded,
          // doesn't flicker back to the loading skeleton).
          tileFound = true
          outer: for (const list of Array.from(tractDeedsRef.current.values())) {
            for (const d of list) {
              if (d.ll_uuid === uuid) { owner = d.owner; break outer }
            }
          }
        } else {
          try {
            const point = map.project([lng, lat])
            const feats = map.queryRenderedFeatures(point, { layers: ['regrid-parcels-fill'] })
            if (feats.length) {
              tileFound = true
              const tileProps: any = feats[0].properties || {}
              owner = tileProps.owner || null
              path = tileProps.path || null
              resolvedDeedUuidsRef.current.add(uuid)
            }
          } catch {/* map mid-teardown / layer not ready yet */}
        }
        if (path) deedPathByUuidRef.current.set(uuid, path)
        const knownPath = path || deedPathByUuidRef.current.get(uuid) || null
        if (knownPath) newSuppressedPaths.add(knownPath)

        const list = newDeeds.get(t.id) || []
        list.push({
          ll_uuid: uuid,
          saleprice: props.saleprice ?? null,
          saledate: props.saledate ?? null,
          acres: props.acres ?? null,
          owner,
          // Pending ONLY until the tile feature itself is found — once
          // found, even a parcel with no `owner` property shows the
          // static "Owner unknown" text (below), never a perpetual
          // skeleton just because the tile happens to lack that field.
          ownerLoading: !tileFound,
        })
        newDeeds.set(t.id, list)
        break // a dot belongs to at most one tract — first containing match wins
      }
    }

    // --- Idempotency gate ------------------------------------------
    // Compare each of the three "did anything actually change" signals
    // independently, then only touch the piece(s) that did.
    const uuidsChanged = !setsEqual(newSuppressedUuids, suppressedDeedUuidsRef.current)
    const pathsChanged = !setsEqual(newSuppressedPaths, suppressedPathsRef.current)

    // Reference-stability pass: reuse the PREVIOUS array for any tract
    // whose deed list is unchanged BY VALUE, so the CompInlinePopup/
    // PortalTractDetail live-refresh effects' `deeds === prev.sale.deeds`
    // guards correctly see "no change" and don't re-invoke
    // setCompPopup/onTractSelected on every tick (AUDIT FIX, HIGH — part
    // of the same infinite-loop report: a fresh array reference every
    // pass, even with identical content, churned those two effects too).
    const prevTractDeeds = tractDeedsRef.current
    const stableDeeds = new Map<string, RecordedDeed[]>()
    let tractDeedsChanged = newDeeds.size !== prevTractDeeds.size
    for (const [tractId, deeds] of Array.from(newDeeds.entries())) {
      const prevList = prevTractDeeds.get(tractId)
      if (prevList && recordedDeedsEqual(prevList, deeds)) {
        stableDeeds.set(tractId, prevList)
      } else {
        stableDeeds.set(tractId, deeds)
        tractDeedsChanged = true
      }
    }
    if (!tractDeedsChanged) {
      for (const tractId of Array.from(prevTractDeeds.keys())) {
        if (!stableDeeds.has(tractId)) { tractDeedsChanged = true; break }
      }
    }

    if (!uuidsChanged && !pathsChanged && !tractDeedsChanged) {
      // Nothing changed at all — a bare retry (sourcedata) with no new
      // information (e.g. a tile finished loading for a parcel that
      // isn't even one of ours). Skip EVERY mutation below so this can
      // never itself trigger another 'sourcedata'/'idle' cycle.
      return
    }

    suppressedDeedUuidsRef.current = newSuppressedUuids
    if (tractDeedsChanged) setTractDeeds(stableDeeds)

    if (pathsChanged) {
      // Diff feature-state against what's ACTUALLY set right now: add
      // newly-suppressed paths, REMOVE ones that no longer qualify
      // (AUDIT FIX, HIGH — previously one-way; a label stayed hidden
      // forever once suppressed, even after its dot no longer coincided
      // with any tract).
      for (const path of Array.from(newSuppressedPaths)) {
        if (!suppressedPathsRef.current.has(path)) {
          try {
            map.setFeatureState({ source: 'regrid-parcels', sourceLayer, id: path }, { dotSuppressed: true })
          } catch {/* source torn down */}
        }
      }
      for (const path of Array.from(suppressedPathsRef.current)) {
        if (!newSuppressedPaths.has(path)) {
          try {
            map.removeFeatureState({ source: 'regrid-parcels', sourceLayer, id: path }, 'dotSuppressed')
          } catch {/* source torn down */}
        }
      }
      suppressedPathsRef.current = newSuppressedPaths
    }

    if (uuidsChanged && src) {
      const features = Array.from(durableDotsByIdRef.current.values())
        .filter(f => !newSuppressedUuids.has((f.properties as any)?.id))
      src.setData({ type: 'FeatureCollection', features })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Shared durable-dots fetch, parameterized by explicit bounds so it can
  // be called two ways:
  //   1. Viewport pans (moveend effect below) — debounced, zoom-gated,
  //      uses the current camera bounds.
  //   2. A chat search's OWN target bbox (chat-search-apply effect,
  //      "AI chat applied filters" above) — immediate, no debounce, no
  //      zoom-gate — fired in PARALLEL with the tract fetch instead of
  //      waiting for fitBounds' 'moveend' to settle.
  //
  // TIMING FIX (owner complaint 2026-07-09): tracts loaded instantly but
  // parcel-sale dots appeared ~10s later. Root cause: the dots fetch only
  // ever fired off 'moveend', and chat search's fitBounds only fires
  // 'moveend' AFTER the tract fetch resolves + a 900ms camera animation —
  // so dots were serialized behind tracts (tract-fetch latency + 900ms
  // animation + this effect's own 500ms debounce), not fetched in
  // parallel with them. Extracting this as a bounds-parameterized
  // function lets the chat-search effect call it directly, using the
  // SAME qbbox the tract fetch uses, at the same moment — see that
  // effect for the call site.
  const fetchDurableDotsForBounds = useCallback(async (
    bounds: { south: number; north: number; west: number; east: number },
    opts?: { bypassZoomGate?: boolean },
  ) => {
    const map = mapRef.current
    if (!map) return
    // OWNER RULING 2026-07-25: comp mode's floor now matches explore's —
    // DURABLE_DOT_MIN_ZOOM (9) in BOTH modes (was REGRID_MIN_ZOOM=11 in
    // comp mode — see the mount effect above). Gating the fetch itself
    // (not just the layer's minzoom) avoids firing bbox requests below
    // the zoom range the layer will actually render.
    const zoomFloor = DURABLE_DOT_MIN_ZOOM
    if (!opts?.bypassZoomGate && map.getZoom() < zoomFloor) return
    // CEILING REMOVED 2026-08-03 (owner bug report — reverts the
    // 2026-07-26 ceiling): that cap assumed PARCEL_SALE_PLUS_LAYER (live
    // Regrid-tile dots) took over at z>=REGRID_MIN_ZOOM, but that layer's
    // filter is location-blind (buildRegridSaleDotFilter has no
    // county/state check) — it showed EVERY county's dots once zoomed
    // in far enough to see Regrid's parcel lines, ignoring an active
    // county filter. PARCEL_SALE_PLUS_LAYER is now disabled
    // (REGRID_SALE_PINS_ENABLED = false) and DURABLE_DOT_LAYER is
    // uncapped again, so this fetch must keep running above
    // REGRID_MIN_ZOOM too, or panning at high zoom would stop
    // accumulating dots for the layer that's now rendering there.
    if (!map.getSource(DURABLE_DOT_SOURCE)) return
    // Defensive re-assertion (owner ask 2026-07-21): visibility is set by
    // the dedicated filter-reactive effect above, but every moveend/pan-
    // triggered call into this function re-checks it too, so a stale
    // 'visible' state can never survive a pan even if something else
    // touched this layer's layout between renders.
    try {
      // Owner-search gate (owner bug report 2026-07-24): OR'd in via the
      // ref, not the ownerSearchActive const, since this is a stable
      // useCallback([] deps) that can't close over state — see
      // ownerSearchActiveRef's declaration up near ownerParcelsChip.
      // Panning during an owner search must never resurrect these dots.
      const hideForFilters = shouldHideParcelDotsForFilters(filtersRef.current) || ownerSearchActiveRef.current
      const inComp = !!subjectTractIdRef.current
      if (map.getLayer(DURABLE_DOT_LAYER)) {
        map.setLayoutProperty(DURABLE_DOT_LAYER, 'visibility', hideForFilters ? 'none' : 'visible')
      }
      if (map.getLayer(DURABLE_DOT_PLUS_LAYER)) {
        map.setLayoutProperty(DURABLE_DOT_PLUS_LAYER, 'visibility', (inComp && !hideForFilters) ? 'visible' : 'none')
      }
    } catch {/* layer torn down */}
    const { from, to, upcomingOnly } = resolveDateWindow(filtersRef.current)
    if (upcomingOnly) {
      // Same rule as buildRegridSaleDotFilter: "upcoming" can't match
      // recorded past sales — nothing can qualify, so clear BOTH the
      // layer and the accumulator (unlike a plain zoom-out/pan, this is
      // a real "no dots qualify" state, not a viewport gap).
      durableDotsByIdRef.current.clear()
      // Coincident-deed suppression must reset in lockstep — with the
      // accumulator empty, recomputeCoincidentDeeds clears tractDeeds and
      // writes the (now-empty) source data in one pass instead of a raw
      // setData(EMPTY_FC) that would leave stale folded deeds in the panel.
      recomputeCoincidentDeeds()
      return
    }
    const gen = ++durableDotsGenRef.current
    // Balanced increment/decrement guard for the in-flight counter that drives
    // the "Loading Ground" badge. Set true only once the increment below runs,
    // so a throw before it can't cause a spurious decrement in the finally.
    let counted = false
    try {
      // Task #30: dots used to ignore the filter panel entirely (bbox
      // only) — filtering to a county/township or a non-Sold status
      // still showed dots everywhere. buildFilterParams already
      // produces the same location/status/acreage/price/date params
      // the tract fetch sends; the backend now understands them for
      // this endpoint too (see get_map_parcel_sale_dots in main.py).
      const filterParams = buildFilterParams(filtersRef.current)
      const qs = new URLSearchParams({
        min_lat: String(bounds.south),
        max_lat: String(bounds.north),
        min_lng: String(bounds.west),
        max_lng: String(bounds.east),
        ...filterParams,
      })
      // has_polygon is a tract-only concept (dots have no polygon) —
      // strip it so it doesn't silently no-op server-side.
      qs.delete('has_polygon')
      // Only the actual network fetch drives the loading indicator — every
      // early return above (no map, zoom gate, no source, upcomingOnly) is
      // BEFORE this point and never sets it, so a superseded/gated call can
      // never leave the wordmark stuck on. finally below always clears it
      // for the latest generation, covering the early `return`s after this
      // line (!res.ok, stale gen) as well as the success path.
      durableDotsInflightRef.current += 1
      counted = true
      setDotsLoading(true)
      const res = await fetchWithAuth(`${API_URL}/api/map/parcel-sale-dots?${qs.toString()}`)
      if (!res.ok) return
      const data = await res.json()
      if (gen !== durableDotsGenRef.current) return // stale — a newer fetch OR filter change superseded this one
      const dots: any[] = data?.dots || []
      const filtered = dots.filter(d => {
        if (d.lat == null || d.lng == null) return false
        if (d.acres == null || d.acres < DURABLE_DOT_MIN_ACRES) return false
        if (from && (!d.saledate || d.saledate < from)) return false
        if (to && (!d.saledate || d.saledate > to)) return false
        return true
      })
      // Accumulate across pans; reset on filter change (owner: dots must
      // never reload once loaded). Merge this viewport's dots into the
      // id-keyed accumulator, then render the ENTIRE union — not just
      // what this fetch returned — so dots already loaded off-screen
      // never disappear/re-fetch when panned back into view.
      // CODE AUDITOR FIX (round 2): re-check gen immediately before the
      // merge, not only right after the response arrives — a filter
      // change bumps durableDotsGenRef too (see the moveend effect and
      // the chat-search effect below), so this guard also catches a
      // stale PRE-filter-change fetch that would otherwise pollute the
      // just-cleared accumulator with dots that no longer qualify.
      if (gen !== durableDotsGenRef.current) return
      for (const d of filtered) {
        durableDotsByIdRef.current.set(d.id, {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
          properties: { id: d.id, saleprice: d.saleprice, saledate: d.saledate, acres: d.acres },
        })
      }
      // recomputeCoincidentDeeds owns pushing the (possibly suppressed)
      // feature set to the GL source — see its definition above for why
      // a raw setData here would miss the comp-map coincident-dot fold.
      recomputeCoincidentDeeds()
    } catch {/* transient fetch failure — next moveend (or the caller) retries */}
    finally {
      // Clear the "Loading Ground" badge off the IN-FLIGHT COUNTER, not the
      // fetch generation. The old clear was gen-gated (`gen === current`), so a
      // superseded fetch skipped it entirely and relied on its replacement to
      // own the badge — but that replacement is often a gated-out zoom/no-source
      // early return that bumps the gen and never clears, leaving the badge
      // stuck ~45s (owner 2026-07-27) even though the fetch is ~0.35s. The
      // counter clears the moment NO durable fetch is in flight — reliably,
      // regardless of supersession. We still wait for the map's next 'idle' so
      // the badge covers the dot RENDER (not just the fetch — a dense county can
      // draw up to ~10k dots), with a hard cap so it can never stick, and a
      // final in-flight recheck so a fetch that starts mid-wait keeps it up.
      // `counted` keeps the increment/decrement balanced even if a throw landed
      // before the increment above.
      if (counted) {
        durableDotsInflightRef.current = Math.max(0, durableDotsInflightRef.current - 1)
        if (durableDotsInflightRef.current === 0) {
          const map = mapRef.current
          if (!map) {
            setDotsLoading(false)
          } else {
            let done = false
            const clearBadge = () => {
              if (done) return
              done = true
              try { map.off('idle', clearBadge) } catch {/* map torn down */}
              clearTimeout(cap)
              // A newer fetch may have started while we waited for 'idle' —
              // only drop the badge if nothing is in flight now.
              if (durableDotsInflightRef.current === 0) setDotsLoading(false)
            }
            // 9s hard cap (owner 2026-07-30 raised this from 5s and set mobile's
            // 12s to the same number, so the two surfaces match). This cap only
            // starts once the counter hit 0 — the
            // fetch(es) are already DONE, so it bounds only the render-settle
            // wait (GL circle layers draw in ms, so 'idle' virtually always
            // fires first); it never truncates an in-flight load. The debounced
            // (500ms) moveend fetch (~0.35s each) can't overlap, so the counter
            // returns to 0 between settles and this cap applies per settle.
            const cap = setTimeout(clearBadge, 9000)
            map.once('idle', clearBadge)
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch durable dots on moveend at every zoom >= DURABLE_DOT_MIN_ZOOM, no
  // upper bound, in BOTH explore and comp mode (AUDIT FIX 2026-07-04 round
  // 2 — the owner directive has no comp-mode exception). At high zoom the
  // viewport is tiny so the row count fetched stays small on its own, and
  // no row cap is ever applied (owner standing rule).
  // No cache cells (unlike tract loading) — the payload is tiny points,
  // so one bbox request per settle is cheap. Applies the SAME saledate
  // windowing the live Regrid sale-dot filter uses (resolveDateWindow),
  // relevant only while PARCEL_SALE_PLUS_LAYER still exists as a
  // (now-hidden) layer in comp mode — see that layer's mode-sync effect.
  //
  // Debounced + generation-guarded the same way handleMoveEnd debounces
  // loadTractsForBounds above: rapid pan/zoom fires many moveends, and
  // without a debounce + staleness guard a slow early response could
  // land AFTER a fresher one and overwrite the dot layer with outdated
  // bounds' data. durableDotsGenRef increments on every actual fetch
  // kickoff; a response only applies if it's still the latest generation.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // CODE AUDITOR FIX (gen race, 2026-07-09): while a chat search is in
    // flight, the chat-search-apply effect already cleared the
    // accumulator and captured its OWN gen inside fetchDurableDotsForBounds
    // (see that effect — it fires FIRST, since it's declared earlier and
    // its setFilters call is what triggers THIS effect's re-run in the
    // same commit). If this effect unconditionally cleared + bumped the
    // gen again here, it would invalidate that already-in-flight,
    // correctly-scoped fetch: React flushes this effect's body
    // synchronously, well before either fetch's network response
    // arrives, so durableDotsGenRef would already have moved past the
    // chat fetch's captured gen by the time that response lands — its
    // staleness check (`gen !== durableDotsGenRef.current`) would then
    // discard a perfectly good result as "stale," dots would never
    // populate from the parallel fetch, and the only thing left to
    // populate them would be the OLD moveend-after-fitBounds path —
    // exactly the ~10s-lag behavior this was supposed to fix. (The
    // previous version of this guard only skipped the fetch KICKOFF
    // below, not this clear/bump — that was the bug: the bump still ran.)
    //
    // So: skip the clear + gen-bump entirely while chatSearchingRef is
    // true — the chat effect already did its own clear before calling
    // fetchDurableDotsForBounds, so no stale dots survive. Off a normal
    // (non-chat) filter-panel change, chatSearchingRef is false and this
    // runs exactly as before: clear, bump, debounced viewport fetch.
    if (!chatSearchingRef.current) {
      // Accumulate across pans; reset on filter change (owner: dots must
      // never reload once loaded). This effect's own re-run (its deps are
      // the filter fields below) IS the filter-change signal, so clearing
      // the accumulator here — once per effect run, before the first fetch
      // — drops the old union exactly when the qualifying set can differ.
      durableDotsByIdRef.current.clear()
      // Same rationale as the chat-search-apply clear above: a filter
      // change invalidates the old coincident-deed fold too (different
      // dots/tracts may qualify now) — un-suppress any hidden labels,
      // not just the local bookkeeping.
      clearAllDeedSuppression()
      // CODE AUDITOR FIX (round 2): bumping the gen ONLY at fetch kickoff
      // (below) doesn't protect against a fetch that was in flight from the
      // PREVIOUS filter — that response's gen was already "latest" the
      // instant it fired, so the staleness check at response-time passed
      // and it merged filter-violating dots into the just-cleared
      // accumulator. Bumping here too, on every effect re-run (= every
      // filter change), immediately invalidates any older in-flight fetch's
      // captured gen before it ever gets to the merge step.
      durableDotsGenRef.current++
    }

    const fetchDurableDots = () => {
      if (durableDotsDebounceRef.current) clearTimeout(durableDotsDebounceRef.current)
      durableDotsDebounceRef.current = setTimeout(() => {
        const b = map.getBounds()
        fetchDurableDotsForBounds({ south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() })
      }, 500)
    }

    // TIMING FIX (owner complaint 2026-07-09): a chat search already owns
    // the dots fetch for this filter change (see the chat-search-apply
    // effect, which fires fetchDurableDotsForBounds immediately with its
    // own qbbox, in parallel with the tract fetch). Firing the debounced
    // viewport-based fetch here TOO would race it — the map's camera is
    // still at its PRE-search position/zoom when this effect runs (the
    // fitBounds animation hasn't started yet), so this fetch would either
    // no-op (zoom < DURABLE_DOT_MIN_ZOOM) or fetch the wrong region. Skip
    // the initial kickoff during an active chat search; 'moveend' stays
    // registered so once fitBounds' animation completes AND the search
    // has settled, a normal pan resumes the usual debounced-refresh
    // behavior with no missed refresh (this is a harmless top-up fetch
    // against the already-populated set, not a second source of truth).
    if (!chatSearchingRef.current) {
      fetchDurableDots()
    }
    map.on('moveend', fetchDurableDots)
    return () => {
      map.off('moveend', fetchDurableDots)
      if (durableDotsDebounceRef.current) clearTimeout(durableDotsDebounceRef.current)
    }
  }, [
    // Apply-atomic model (owner spec, 2026-07-25): every field below reads
    // appliedFilters, NOT the draft `filters` — this effect's body reads
    // filtersRef.current (which only moves at Apply/Reset/chat-commit),
    // so its dep array must match: durable dots refetch ONLY on Apply,
    // never while the panel is being edited. If this drifted back to
    // `filters.*`, editing the draft would clear+refetch dots again,
    // which is exactly the "nothing until Apply" rule this whole
    // rearchitecture exists to enforce.
    mapLoaded,
    appliedFilters.dateRange, appliedFilters.dateFrom, appliedFilters.dateTo,
    appliedFilters.stateFilter, appliedFilters.countyFilters, appliedFilters.townshipFilters,
    appliedFilters.statuses,
    appliedFilters.acreageMin, appliedFilters.acreageMax,
    appliedFilters.salePriceMin, appliedFilters.salePriceMax,
    // The rest of buildFilterParams' surface (2026-07-09 audit): without
    // these, a chat search that changes ONLY e.g. seller/listingType (no
    // state/status/date/county/acreage/price change) never clears the
    // accumulator — stale dots from the PREVIOUS filter set keep
    // rendering, unfiltered, until some other dimension happens to
    // change too. The backend endpoint itself doesn't understand
    // seller/buyer/companyName/listingType yet (parcel_sale_dots has no
    // such columns — see get_map_parcel_sale_dots in ground-goat-backend
    // main.py), so those specific fields can't actually narrow this
    // layer server-side, but re-running on every filter change at least
    // stops old, no-longer-matching dots from lingering on screen.
    appliedFilters.landTypes, appliedFilters.listingType,
    appliedFilters.pctTillableMin, appliedFilters.pctTillableMax,
    appliedFilters.soilRatingMin, appliedFilters.soilRatingMax,
    appliedFilters.pricePerAcreMin, appliedFilters.pricePerAcreMax,
    appliedFilters.askingPriceMin, appliedFilters.askingPriceMax,
    appliedFilters.pricePerSoilRatingMin, appliedFilters.pricePerSoilRatingMax,
    appliedFilters.nearLat, appliedFilters.nearLng, appliedFilters.radiusMiles,
    appliedFilters.cornersMin, appliedFilters.cornersMax,
    appliedFilters.companyName, appliedFilters.buyer, appliedFilters.seller,
    appliedFilters.hasHouse, appliedFilters.hasBuildings, appliedFilters.keyword,
    fetchDurableDotsForBounds,
  ])

  // Re-run the coincident-deed fold whenever the loaded tract set changes
  // (new tract polygons arrive as the user pans, so a dot fetched BEFORE
  // its overlapping tract's polygon loaded needs a second pass once that
  // polygon shows up) or comp mode toggles on/off (subjectTractId). The
  // durable-dots effects above already call recomputeCoincidentDeeds every
  // time the DOT side of the pair changes; this is the TRACT side.
  useEffect(() => {
    recomputeCoincidentDeeds()
  }, [tracts, subjectTractId, recomputeCoincidentDeeds])

  // Retry the owner TILE lookup (see recomputeCoincidentDeeds) once the
  // Regrid tile covering a coincident dot's point finishes loading — a
  // dot can be detected (point-in-polygon needs only the tract polygon +
  // the dot's own lat/lng, both already in hand) before its tile has
  // actually loaded, so the very first recompute pass for it leaves
  // owner pending (ownerLoading:true, ONLY acres/$/date shown).
  //
  // AUDIT FIX (HIGH — infinite idle loop): this used to ALSO listen on
  // 'idle' as a catch-all, unconditionally calling recompute on every
  // idle tick. recomputeCoincidentDeeds calls src.setData, and a GL
  // source setData briefly leaves the map "not idle" and then re-fires
  // 'idle' once it settles — idle -> recompute -> setData -> idle was an
  // infinite loop for the entire time comp mode was active (continuous
  // repaint/CPU churn + a React re-render every tick). recompute is now
  // idempotent on its own (see its diff-by-value guards), which alone
  // breaks the loop, but 'idle' fires far more often than genuinely
  // useful here, so it's removed entirely rather than relying only on
  // the idempotency check to make each tick a no-op. Listening ONLY on
  // 'sourcedata' for the specific source we care about, AND only while
  // something is still actually pending, means this effect goes
  // completely quiet once every coincident deed has resolved. Comp-mode-
  // only; doesn't even attach in explore mode.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !subjectTractId) return
    const hasPendingOwner = () => {
      for (const list of Array.from(tractDeedsRef.current.values())) {
        if (list.some(d => d.ownerLoading)) return true
      }
      return false
    }
    const onSourceData = (e: maplibregl.MapSourceDataEvent) => {
      if (e.sourceId !== 'regrid-parcels' || !e.isSourceLoaded) return
      if (!hasPendingOwner()) return
      recomputeCoincidentDeeds()
    }
    map.on('sourcedata', onSourceData)
    return () => {
      map.off('sourcedata', onSourceData)
    }
  }, [mapLoaded, subjectTractId, recomputeCoincidentDeeds])

  // Regrid parcel fill / line / label layers.
  //
  // OWNER DECISION 2026-07-30: parcel tiles and their owner/acres labels
  // are BASE MAP REFERENCE, not search results. They must ALWAYS draw once
  // the user zooms past REGRID_MIN_ZOOM, whether or not each parcel would
  // satisfy the active filter or Goat Search. Only the DOTS answer to the
  // filter (see shouldHideParcelDotsForFilters + the durable-dot effects).
  //
  // Before this, buildRegridParcelFilter(appliedFilters) was pushed onto
  // these three layers, so filtering blanked the parcel grid underneath —
  // e.g. the "Upcoming" preset set upcomingOnly and hid EVERY parcel (a
  // recorded sale can't match a future auction), leaving the user zoomed
  // in on bare satellite with no boundaries to orient by.
  //
  // regridStateFilter STAYS. It is not a user filter — it's the
  // subscription state gate, and a subscriber must never see parcels
  // outside the states they pay for.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const expr: any = regridStateFilter ?? null
    for (const id of REGRID_PARCEL_LAYER_IDS) {
      if (map.getLayer(id)) {
        try { map.setFilter(id, expr as any) } catch {/* layer torn down */}
      }
    }
  }, [mapLoaded, regridStateFilter])

  // ─────────────────────────────────────────────────────────────────
  // Parcel-enrichment overlay (Hancock IL pilot)
  //
  // Toggles a green tillable-acres overlay + a per-parcel PI choropleth
  // (red→amber→green for low/mid/high productivity). Data comes from
  // /api/map/parcel-enrichment which 404s for everyone except me
  // (jmurphy@groundgoat.com) AND when the backend ENABLE_PARCEL_ENRICHMENT
  // flag is set. The button is also hidden for non-pilot accounts so
  // the unfinished feature doesn't appear in the UI for customers.
  //
  // Fetching is bbox-scoped + debounced on viewport changes; results
  // are stored as a single GeoJSON FeatureCollection swapped into the
  // tillable + parcel-fill sources via setData (no source/layer
  // teardown — much smoother than rebuilding on every pan).
  // ─────────────────────────────────────────────────────────────────
  const [enrichmentOverlay, setEnrichmentOverlay] = useState<boolean>(() => {
    try { return localStorage.getItem('gg_enrichment_overlay') === '1' } catch { return false }
  })
  // Which cropland / soil source feeds the visual:
  //   • 'cdl'        — USDA CDL 2024+2025 union, per-parcel intersected (default)
  //   • 'worldcover' — ESA WorldCover 2021 raw cropland polygons at 10 m
  //   • 'ssurgo'     — SSURGO mukey polygons clipped to FSA CLU + ≥65% CDL coverage
  //   • 'ssurgo_csb' — SSURGO clipped to FSA CLU + ≥65% CSB cropland coverage
  //                    (uses USDA Crop Sequence Boundaries instead of CDL for
  //                     the classification; should exclude waterway / house FSAs
  //                     that the CDL rule misclassifies as tillable)
  // Persisted in localStorage so the operator's last choice sticks
  // across reloads. WorldCover + SSURGO blobs are lazy-loaded.
  const [tillableSource, setTillableSource] = useState<'cdl' | 'worldcover' | 'ssurgo' | 'ssurgo_csb'>(() => {
    try {
      const v = localStorage.getItem('gg_tillable_source')
      // WorldCover toggle was removed from the cycle (slow lazy-load,
      // not the visual we want). If a user has it persisted, reset
      // to CDL on next load. The 'worldcover' type stays in the union
      // so the underlying WorldCover layers / visibility checks still
      // compile — they just never become visible because the toggle
      // can't land on 'worldcover' anymore.
      if (v === 'ssurgo') return 'ssurgo'
      if (v === 'ssurgo_csb') return 'ssurgo_csb'
      return 'cdl'
    } catch { return 'cdl' }
  })
  const worldcoverLoadedRef = useRef<boolean>(false)
  const ssurgoLoadedRef = useRef<boolean>(false)
  const ssurgoCsbLoadedRef = useRef<boolean>(false)
  // Cache of the latest viewport's enrichment payload, keyed loosely
  // by bbox-rounded so we don't refetch on micro-pans.
  const enrichmentLastBboxRef = useRef<string>('')
  const enrichmentAvailableRef = useRef<boolean>(true)

  // Tiny inline toast — used when user enables Soil Maps but the
  // current zoom is below the soils-layer minzoom (6). The soils
  // overlay won't render until they zoom in, so we tell them.
  const [zoomToast, setZoomToast] = useState<string | null>(null)
  const zoomToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showZoomToast = useCallback((msg: string) => {
    setZoomToast(msg)
    if (zoomToastTimerRef.current) clearTimeout(zoomToastTimerRef.current)
    zoomToastTimerRef.current = setTimeout(() => setZoomToast(null), 4000)
  }, [])

  // Persistent toast: shown while an overlay is active AND zoom is below its useful min.
  const [zoomTooFar, setZoomTooFar] = useState<string | null>(null)
  // Loading spinner: shown while overlay tiles are still fetching.
  const [overlayLoading, setOverlayLoading] = useState<string | null>(null)

  // Track overlay tile loading state.
  const overlayLoadingRef = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !baseOverlay) {
      setOverlayLoading(null)
      overlayLoadingRef.current = null
      return
    }
    // Determine which source IDs to watch for this overlay.
    const watchSources: string[] = (() => {
      switch (baseOverlay) {
        case 'ssurgo': return ['parcel-enrichment-ssurgo-soils']
        case 'crops': return ['csb-fields']
        case 'nccpi': return SOIL_PMTILES_STATES.map(st => `explore-nccpi-${st}`)
        case 'fsa': return FSA_PMTILES_STATES.map(st => `explore-fsa-${st}`)
        default: return []
      }
    })()
    if (watchSources.length === 0) return

    const overlayLabel = (() => {
      switch (baseOverlay) {
        case 'ssurgo': return 'Soil Types'
        case 'nccpi': return 'NCCPI'
        case 'fsa': return 'FSA'
        case 'crops': return 'Crops'
        default: return 'Overlay'
      }
    })()

    // Check if already loaded.
    const allLoaded = () => watchSources.every(sid => {
      const src = map.getSource(sid) as any
      return !src || map.isSourceLoaded(sid)
    })

    // Listeners registered when tiles are actually in-flight.
    let loadListenersActive = false
    const onData = (e: any) => {
      if (!watchSources.includes(e.sourceId)) return
      if (allLoaded()) {
        setOverlayLoading(null)
        overlayLoadingRef.current = null
      }
    }
    const onIdle = () => {
      if (allLoaded()) {
        setOverlayLoading(null)
        overlayLoadingRef.current = null
      }
    }
    const attachLoadListeners = () => {
      if (loadListenersActive) return
      loadListenersActive = true
      map.on('sourcedata', onData)
      map.on('idle', onIdle)
    }
    const detachLoadListeners = () => {
      if (!loadListenersActive) return
      loadListenersActive = false
      map.off('sourcedata', onData)
      map.off('idle', onIdle)
    }

    // Re-evaluate loading state when the user zooms or pans into range.
    // This handles the case where the overlay was enabled below its minzoom,
    // so no tiles were loading at effect setup time — they start loading only
    // after the user zooms in past the source minzoom.
    const checkLoadState = () => {
      if (allLoaded()) {
        // Nothing in-flight: hide spinner, detach load listeners.
        setOverlayLoading(null)
        overlayLoadingRef.current = null
        detachLoadListeners()
      } else {
        // Tiles are now loading — show spinner and wait for them to finish.
        setOverlayLoading(overlayLabel)
        overlayLoadingRef.current = overlayLabel
        attachLoadListeners()
      }
    }

    if (!allLoaded()) {
      // Tiles already loading at setup time — start spinner immediately.
      setOverlayLoading(overlayLabel)
      overlayLoadingRef.current = overlayLabel
      attachLoadListeners()
    }
    // Whether or not tiles are loading now, register zoom/move listeners so
    // we catch the transition when the user zooms past the source's minzoom.
    map.on('zoomend', checkLoadState)
    map.on('moveend', checkLoadState)

    return () => {
      map.off('zoomend', checkLoadState)
      map.off('moveend', checkLoadState)
      detachLoadListeners()
      setOverlayLoading(null)
      overlayLoadingRef.current = null
    }
  }, [baseOverlay, mapLoaded])

  // Sync baseOverlay (layer panel radio) → enrichmentOverlay / tillableSource.
  // This is separate from the soilMapsOpen effect so the layer panel
  // can drive the overlay independently of the nav-bar button.
  // 'nccpi'/'fsa'/null = categorical soils fill off.
  useEffect(() => {
    if (baseOverlay === 'crops' || baseOverlay === 'csb') {
      setEnrichmentOverlay(true)
      setTillableSource('ssurgo_csb')
    } else if (baseOverlay === 'ssurgo') {
      setEnrichmentOverlay(true)
      setTillableSource('ssurgo')
    } else {
      // null, 'nccpi', or 'fsa' = categorical soils fill off
      setEnrichmentOverlay(false)
    }
  }, [baseOverlay])

  // When the coverage list grows (e.g. the live fetch returns more
  // counties than the seed defaults), invalidate the per-variant
  // "already loaded" gates so the consumer effects re-fetch with the
  // expanded list. Without this, the soils/soils-csb/worldcover effects
  // bail on the first run with only the 4 pilots and never pick up
  // newly-deployed counties like McDonough.
  useEffect(() => {
    ssurgoLoadedRef.current = false
    ssurgoCsbLoadedRef.current = false
    worldcoverLoadedRef.current = false
    enrichmentAvailableRef.current = true
  }, [overlayCoverage])

  // Persist toggle state to localStorage.
  useEffect(() => {
    try { localStorage.setItem('gg_enrichment_overlay', enrichmentOverlay ? '1' : '0') } catch {}
  }, [enrichmentOverlay])
  useEffect(() => {
    try { localStorage.setItem('gg_tillable_source', tillableSource) } catch {}
  }, [tillableSource])

  // Register the source + layers (empty at first). They sit visible:false
  // until the toggle is on, so we can swap data with setData without
  // re-adding layers on every toggle flip.
  //
  // ONLY two layers now:
  //   • green fill on the tillable polygons (parcel ∩ CSB cropland),
  //     so trees / water / buildings show the satellite underneath.
  //   • red lines on the FSA 2008 CLU field outlines.
  //
  // The earlier per-parcel PI choropleth was painting WHOLE parcels
  // (including obvious wooded/water portions) — that's what the user
  // was correctly calling out. Removed entirely; PI lives in the
  // click-popup now, not on the map fill.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!layersEnabled) return

    const SRC_TILLABLE = 'parcel-enrichment-tillable'
    const SRC_TILLABLE_WC = 'parcel-enrichment-tillable-worldcover'
    const SRC_FSA = 'parcel-enrichment-fsa-clu'
    const SRC_LABELS = 'parcel-enrichment-labels'
    const SRC_LABELS_WC = 'parcel-enrichment-labels-worldcover'
    const SRC_SOILS = 'parcel-enrichment-ssurgo-soils'
    const LYR_TILL_FILL = 'parcel-enrichment-tillable-fill'
    const LYR_TILL_FILL_WC = 'parcel-enrichment-tillable-worldcover-fill'
    const LYR_FSA_LINE = 'parcel-enrichment-fsa-clu-line'
    const LYR_LABELS = 'parcel-enrichment-labels-text'
    const LYR_LABELS_WC = 'parcel-enrichment-labels-worldcover-text'
    const LYR_SOILS_FILL = 'parcel-enrichment-ssurgo-soils-fill'
    const LYR_SOILS_LINE = 'parcel-enrichment-ssurgo-soils-line'
    const LYR_SOILS_LABEL = 'parcel-enrichment-ssurgo-soils-label'

    if (!map.getSource(SRC_TILLABLE)) {
      map.addSource(SRC_TILLABLE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
    if (!map.getSource(SRC_TILLABLE_WC)) {
      map.addSource(SRC_TILLABLE_WC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
    if (!map.getSource(SRC_FSA)) {
      map.addSource(SRC_FSA, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
    if (!map.getSource(SRC_LABELS)) {
      map.addSource(SRC_LABELS, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
    if (!map.getSource(SRC_LABELS_WC)) {
      map.addSource(SRC_LABELS_WC, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
    }
    if (!map.getSource(SRC_SOILS)) {
      // Vector tile source backed by the FastAPI MVT endpoint. Each
      // tile only ships the soil polygons in that tile's bounds, so
      // 316 counties is no different from 1 county on the client side.
      // Replaces the old fetch-every-county GeoJSON merge that crashed
      // browsers past ~6 counties.
      // Source minzoom 10 sits between the tract-pin tier
      // (TRACT_TIER_MIN=9) and the Regrid tier (REGRID_MIN_ZOOM=11).
      // Layers fade their opacity from 0 → full across z=10 → z=11.5,
      // so the overlay smoothly materializes as the user zooms in
      // rather than popping on. Source minzoom matches the fade
      // start so tiles are pre-fetched in the fade-in window.
      // Empirical cost per MVT tile at central-IL bounds:
      //   z=8 → 12 MB, 8.0s server-time per tile (~16 in a viewport)
      //   z=9 → 2.8 MB, 0.6s
      //   z=10 → 76 KB, 70ms       ← chosen (fade start)
      //   z=11 → 45 KB, 70ms
      //   z=12 → 23 KB, 60ms
      map.addSource(SRC_SOILS, {
        type: 'vector',
        tiles: [`${API_URL}/api/tiles/soils/{z}/{x}/{y}.mvt`],
        minzoom: 6,
        maxzoom: 16,
      })
    }
    // ── Per-state PMTiles sources for Soil Types + NCCPI overlays ───
    // Register pmtiles protocol if not already done (the admin parcel
    // overlay effect also registers it, but may not have run yet if
    // the user isn't an admin or adminParcelOverlay is off).
    const w = window as any
    if (!w.__ggPmtilesRegistered) {
      maplibregl.addProtocol('pmtiles', new PMTilesProtocol().tile as any)
      w.__ggPmtilesRegistered = true
    }
    // Track per-state source/layer IDs so cleanup can remove them all.
    const soilPmSourceIds: string[] = []
    const soilPmLayerIds: string[] = []
    const nccpiPmSourceIds: string[] = []
    const nccpiPmLayerIds: string[] = []
    const soilsFullFillLayerIds: string[] = []

    for (const st of SOIL_PMTILES_STATES) {
      // ── Soil Types (ssurgo / all-land) ────────────────────────────
      // Each state gets its own pmtiles source + fill + line layers.
      // source-layer must be 'soils' (matches the pmtiles archive).
      const soilSrcId = `soils-full-${st}`
      const soilFillId = `soils-full-fill-${st}`
      const soilLineId = `soils-full-line-${st}`
      if (!map.getSource(soilSrcId)) {
        map.addSource(soilSrcId, {
          type: 'vector',
          url: `pmtiles://${TILES_BASE_URL}/tiles/${st}_soils.pmtiles`,
        } as any)
      }
      soilPmSourceIds.push(soilSrcId)
      if (!map.getLayer(soilFillId)) {
        map.addLayer({
          id: soilFillId,
          type: 'fill',
          source: soilSrcId,
          'source-layer': 'soils',
          minzoom: 6,
          layout: {
            visibility: (enrichmentOverlay && tillableSource === 'ssurgo') ? 'visible' : 'none',
          },
          paint: {
            // 16-color categorical palette keyed on mukey % 16.
            // mukey is a STRING in PMTiles-encoded vector tiles — wrap
            // with to-number so the % operator works correctly.
            'fill-color': [
              'step',
              ['%', ['to-number', ['get', 'mukey'], 0], 16],
              '#c94040',   // 0  — red (dark)
              1,  '#d4753a', // 1  — orange (dark)
              2,  '#c4b030', // 2  — yellow (dark)
              3,  '#5aaa2e', // 3  — lime (dark)
              4,  '#29a068', // 4  — teal (dark)
              5,  '#2878c8', // 5  — blue (dark)
              6,  '#6050c0', // 6  — violet (dark)
              7,  '#b03890', // 7  — magenta (dark)
              8,  '#e06060', // 8  — red (light)
              9,  '#e0a060', // 9  — orange (light)
              10, '#d8d055', // 10 — yellow (light)
              11, '#80cc55', // 11 — lime (light)
              12, '#50c090', // 12 — teal (light)
              13, '#5598e0', // 13 — blue (light)
              14, '#9080d8', // 14 — violet (light)
              15, '#d060b0', // 15 — magenta (light)
            ],
            'fill-opacity': [
              'interpolate', ['linear'], ['zoom'],
              6, 0,
              7, 0.60,
            ],
          },
        })
      }
      soilPmLayerIds.push(soilFillId)
      soilsFullFillLayerIds.push(soilFillId)
      if (!map.getLayer(soilLineId)) {
        map.addLayer({
          id: soilLineId,
          type: 'line',
          source: soilSrcId,
          'source-layer': 'soils',
          minzoom: 6,
          layout: {
            visibility: (enrichmentOverlay && tillableSource === 'ssurgo') ? 'visible' : 'none',
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': 'rgba(0,0,0,0.12)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 1.2],
          },
        })
      }
      soilPmLayerIds.push(soilLineId)

      // ── NCCPI productivity choropleth ──────────────────────────────
      // Same per-state pmtiles archive — different paint keyed on the
      // 'nccpi' property (0..1 float). source-layer is 'soils' (same
      // archive). nccpi is a STRING in encoded tiles — wrap with
      // to-number to guarantee the interpolate expression works.
      const nccpiSrcId = `explore-nccpi-${st}`
      const nccpiFillId = `explore-nccpi-fill-${st}`
      const nccpiLineId = `explore-nccpi-line-${st}`
      if (!map.getSource(nccpiSrcId)) {
        map.addSource(nccpiSrcId, {
          type: 'vector',
          url: `pmtiles://${TILES_BASE_URL}/tiles/${st}_soils.pmtiles`,
        } as any)
      }
      nccpiPmSourceIds.push(nccpiSrcId)
      if (!map.getLayer(nccpiFillId)) {
        map.addLayer({
          id: nccpiFillId,
          type: 'fill',
          source: nccpiSrcId,
          'source-layer': 'soils',
          minzoom: 6,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': ['interpolate', ['linear'], ['to-number', ['get', 'nccpi'], 0],
              0,   '#d73027',
              25,  '#fc8d59',
              50,  '#fee08b',
              75,  '#91cf60',
              100, '#1a9850',
            ],
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 7, 0.65],
          },
        })
      }
      nccpiPmLayerIds.push(nccpiFillId)
      if (!map.getLayer(nccpiLineId)) {
        map.addLayer({
          id: nccpiLineId,
          type: 'line',
          source: nccpiSrcId,
          'source-layer': 'soils',
          minzoom: 6,
          layout: {
            visibility: 'none',
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': 'rgba(0,0,0,0.12)',
            'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 1.2],
          },
        })
      }
      nccpiPmLayerIds.push(nccpiLineId)
    }

    // ── Per-state PMTiles sources for FSA overlay ─────────────────────
    const fsaPmSourceIds: string[] = []
    const fsaPmLayerIds: string[] = []
    for (const st of FSA_PMTILES_STATES) {
      const fsaSrcId = `explore-fsa-${st}`
      const fsaLineId = `explore-fsa-line-${st}`
      if (!map.getSource(fsaSrcId)) {
        map.addSource(fsaSrcId, {
          type: 'vector',
          url: `pmtiles://${TILES_BASE_URL}/tiles/${st.toUpperCase()}_fsa.pmtiles`,
          maxzoom: 14,
        } as any)
      }
      fsaPmSourceIds.push(fsaSrcId)
      if (!map.getLayer(fsaLineId)) {
        map.addLayer({
          id: fsaLineId,
          type: 'line',
          source: fsaSrcId,
          'source-layer': 'fsa',
          minzoom: 6,
          layout: {
            visibility: 'none',
            'line-join': 'round',
            'line-cap': 'round',
          },
          paint: {
            'line-color': '#22d3ee',
            'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 10, 0.8, 14, 1.5],
            'line-opacity': 0.9,
          },
        })
      }
      fsaPmLayerIds.push(fsaLineId)
      // TODO: grey no-data fill for AL, FL, AK — not in the 2008 CLU release
    }

    // Tillable polygons — solid green so the eye reads "this portion
    // of the parcel is farmed". Anything NOT in this source (trees,
    // water, buildings, roads) just shows the satellite imagery.
    // Two parallel sources/layers — the operator picks CDL or
    // WorldCover via the data-source toggle; only one is visible at
    // a time. WorldCover uses a slightly different shade so a quick
    // glance tells the operator which is active.
    if (!map.getLayer(LYR_TILL_FILL)) {
      map.addLayer({
        id: LYR_TILL_FILL,
        type: 'fill',
        source: SRC_TILLABLE,
        layout: {
          visibility: (enrichmentOverlay && tillableSource === 'cdl') ? 'visible' : 'none',
        },
        paint: {
          'fill-color': '#00e64d',
          'fill-opacity': 0.55,
          'fill-outline-color': 'rgba(0,200,60,0.9)',
        },
      })
    }
    if (!map.getLayer(LYR_TILL_FILL_WC)) {
      map.addLayer({
        id: LYR_TILL_FILL_WC,
        type: 'fill',
        source: SRC_TILLABLE_WC,
        layout: {
          visibility: (enrichmentOverlay && tillableSource === 'worldcover') ? 'visible' : 'none',
        },
        paint: {
          // Slightly more teal so it's obvious when the operator is
          // looking at WorldCover vs CDL.
          'fill-color': '#00ccff',
          'fill-opacity': 0.55,
          'fill-outline-color': 'rgba(0,160,200,0.9)',
        },
      })
    }
    // SSURGO mukey polygons — Land ID-style soil-type view. Each
    // mukey is a real vector polygon coloured by a hash of its
    // string so we get stable distinct earth-tone shades without
    // any per-mukey palette work. A subtle outline plus a musym
    // text label make the visual match Surety / Land ID / Beacon
    // soil reports.
    //
    // Toggled separately from the green tillable fill via the
    // `tillableSource === 'ssurgo'` selection in the data-source
    // toggle. Same Soils button turns the whole overlay on/off.
    if (!map.getLayer(LYR_SOILS_FILL)) {
      map.addLayer({
        id: LYR_SOILS_FILL,
        type: 'fill',
        source: SRC_SOILS,
        'source-layer': 'soils',
        minzoom: 10,
        layout: {
          // Clipped (FSA + ≥65% CDL) SSURGO fill now drives ONLY the
          // 'csb' / Tillable Ground overlay (tillableSource ==='ssurgo_csb').
          // The all-land soils-full-fill below drives Soil Types ('ssurgo').
          visibility: (enrichmentOverlay && tillableSource === 'ssurgo_csb') ? 'visible' : 'none',
        },
        paint: {
          // Map mukey → a full-360° 16-color categorical palette so every
          // soil map unit gets a visually distinct, stable color. Using a
          // fixed step palette (mukey % 16) avoids HSL-concat expression
          // fragility and is tsc-clean.
          // 16 colors: 8 primary hues × 2 lightness levels (~45% and ~63%)
          // spanning the full hue wheel — red, orange, yellow, lime, teal,
          // blue, violet, magenta at saturated, readable values.
          'fill-color': [
            'step',
            ['%', ['to-number', ['get', 'mukey']], 16],
            '#c94040',   // 0  — red (dark)
            1,  '#d4753a', // 1  — orange (dark)
            2,  '#c4b030', // 2  — yellow (dark)
            3,  '#5aaa2e', // 3  — lime (dark)
            4,  '#29a068', // 4  — teal (dark)
            5,  '#2878c8', // 5  — blue (dark)
            6,  '#6050c0', // 6  — violet (dark)
            7,  '#b03890', // 7  — magenta (dark)
            8,  '#e06060', // 8  — red (light)
            9,  '#e0a060', // 9  — orange (light)
            10, '#d8d055', // 10 — yellow (light)
            11, '#80cc55', // 11 — lime (light)
            12, '#50c090', // 12 — teal (light)
            13, '#5598e0', // 13 — blue (light)
            14, '#9080d8', // 14 — violet (light)
            15, '#d060b0', // 15 — magenta (light)
          ],
          // Fade in from invisible at z=10 to 60% opacity at z=11.5.
          // The smooth ramp means zooming in/out animates the overlay
          // in/out instead of popping on at a hard threshold.
          'fill-opacity': [
            'interpolate', ['linear'], ['zoom'],
            10, 0,
            11.5, 0.60,
          ],
        },
      })
    }
    if (!map.getLayer(LYR_SOILS_LINE)) {
      map.addLayer({
        id: LYR_SOILS_LINE,
        type: 'line',
        source: SRC_SOILS,
        'source-layer': 'soils',
        minzoom: 10,
        layout: {
          visibility: (enrichmentOverlay && tillableSource === 'ssurgo_csb') ? 'visible' : 'none',
          'line-join': 'round',
          'line-cap': 'round',
        },
        paint: {
          'line-color': 'rgba(0,0,0,0.12)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 1.2],
        },
      })
    }
    if (!map.getLayer(LYR_SOILS_LABEL)) {
      map.addLayer({
        id: LYR_SOILS_LABEL,
        type: 'symbol',
        source: SRC_SOILS,
        'source-layer': 'soils',
        layout: {
          visibility: (enrichmentOverlay && tillableSource === 'ssurgo_csb') ? 'visible' : 'none',
          'text-field': ['coalesce', ['get', 'musym'], ''],
          'text-font': ['Open Sans Bold'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            13, 9,
            15, 11,
            17, 13,
          ],
          'text-anchor': 'center',
          'text-allow-overlap': false,
          'text-ignore-placement': true,
          'text-padding': 2,
        },
        paint: {
          'text-color': '#1a1207',
          'text-halo-color': 'rgba(255, 250, 235, 0.9)',
          'text-halo-width': 1.4,
          // Fade labels in z=12.5 → z=13.5 so they don't pop at the
          // hard minzoom boundary (matches the fill/line fade pattern).
          'text-opacity': [
            'interpolate', ['linear'], ['zoom'],
            12.5, 0,
            13.5, 1,
          ],
          'text-halo-blur': 0.3,
        },
        // Layer minzoom matches the fade-in floor so labels can render
        // (transparently) at z=12.5 and ramp to full by z=13.5.
        minzoom: 12.5,
      })
    }
    // ── CSB crop-field vector tile source + fill layer ────────────
    // Backed by the /api/tiles/csb-fields/{z}/{x}/{y}.mvt endpoint.
    // source-layer: 'csb_fields'. Properties: csbid, acres,
    // cdl2017..cdl2024 (USDA CDL integer codes; 0/null = no data).
    // Auth header is attached via transformRequest above.
    const SRC_CSB_FIELDS = 'csb-fields'
    const LYR_CSB_FIELDS_FILL = 'csb-fields-fill'
    if (!map.getSource(SRC_CSB_FIELDS)) {
      map.addSource(SRC_CSB_FIELDS, {
        type: 'vector',
        tiles: [`${API_URL}/api/tiles/csb-fields/{z}/{x}/{y}.mvt`],
        minzoom: 10,
        maxzoom: 14,
      })
    }
    if (!map.getLayer(LYR_CSB_FIELDS_FILL)) {
      map.addLayer({
        id: LYR_CSB_FIELDS_FILL,
        type: 'fill',
        source: SRC_CSB_FIELDS,
        'source-layer': 'csb_fields',
        minzoom: 10,
        layout: { visibility: 'none' },
        paint: {
          // Initial fill-color for the default year (2024).
          // On year-selector change, setPaintProperty updates this in-place
          // without any tile refetch. See the selectedCropYear effect below.
          'fill-color': buildCropColorExpr(2024),
          'fill-opacity': 0.65,
          // Subtle hairline so field edges read cleanly over satellite.
          'fill-outline-color': 'rgba(255,255,255,0.25)',
        },
      })
    }

    // ── CSB fields click → LandDetailPanel ──────────────────────────
    // When a CSB crop field is clicked we open the panel with the crop
    // data pre-populated. If a Regrid parcel fill is also under the
    // click, the parcel fill's onClick fires first (it sits on top in
    // the layer stack) and already calls setLandDetail with the parcel
    // props + csb data from queryRenderedFeatures. In that case the
    // CSB field handler sees a non-empty landDetail already set and
    // can safely skip. We use the same "query regrid to check for
    // parcel" approach as onSoilsFullClick.
    const onCsbFieldClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const csbProps: any = e.features[0].properties || {}
      // Task #26: CSB (minzoom 10, uncapped) overlaps tract layers
      // (minzoom 9) and the sale-dot layers (durable, uncapped in explore
      // mode; parcel-sale-pin-plus, comp-mode-only "+" pin) at the same
      // click point. All of those outrank CSB in the priority chain (tract
      // > sale dot > parcel fill > overlays) — if any is under the click,
      // its own handler owns the panel.
      const regridLayer = 'regrid-parcels-fill'
      let hasParcel = false
      try {
        if (map.getLayer(regridLayer)) {
          hasParcel = map.queryRenderedFeatures(e.point, { layers: [regridLayer] }).length > 0
        }
      } catch {/* layer torn down */}
      if (hasParcel) return
      if (clickClaimedByLayers(map, e.point, [
        'tract-pin-circles', 'tract-polygon-fill',
        'parcel-sale-pin-plus', DURABLE_DOT_LAYER, DURABLE_DOT_PLUS_LAYER,
      ])) return

      // One click, one panel: clear any open tract modal / comp popup,
      // AND (portalMode) tell the parent to close its Tract Detail slide-out.
      setSelectedSale(null)
      setCompPopup(null)
      onLandDetailOpen?.()
      setLandDetail({
        parcelProps: null,
        soilProps: null,
        csbProps,
        ll_uuid: null,
        // No parcel underlies an overlay-only click — no report to offer,
        // so no click point either (footer stays hidden, as before).
        clickLng: null,
        clickLat: null,
        activeOverlay: baseOverlayRef.current,
        source: 'overlay',
      })
    }
    map.on('click', LYR_CSB_FIELDS_FILL, onCsbFieldClick)
    map.on('mouseenter', LYR_CSB_FIELDS_FILL, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', LYR_CSB_FIELDS_FILL, () => { map.getCanvas().style.cursor = '' })

    // FSA 2008 Common Land Unit field outlines.
    // Kept as an invisible layer so the source data stays loaded for any
    // downstream consumer, but the red lines are no longer drawn on the
    // map (user-requested 2026-05-29). The actual field boundaries are
    // still used server-side to clip the soil polygons before bake.
    if (!map.getLayer(LYR_FSA_LINE)) {
      map.addLayer({
        id: LYR_FSA_LINE,
        type: 'line',
        source: SRC_FSA,
        layout: { visibility: enrichmentOverlay ? 'visible' : 'none' },
        paint: {
          'line-color': '#d63333',
          'line-width': 1.0,
          'line-opacity': 0,
        },
      })
    }
    // Per-parcel soil-rating label, centered at the parcel centroid.
    // One symbol per parcel showing the rating-type + score
    // (e.g. "PI 132.4", "CSR2 74.5", "NCCPI 81.2"). Hidden below
    // zoom 14 to avoid clutter at county-scale views — the labels
    // are useful when the operator is actually looking at fields.
    // Shared label-layer paint/layout. We define it twice (one per
    // source) so we can flip them independently when the CDL ↔
    // WorldCover toggle changes — only the active source shows.
    const labelLayoutBase: any = {
      'text-field': ['concat',
        ['get', 'rt'], ' ',
        ['to-string', ['get', 'r']],
      ],
      'text-font': ['Open Sans Bold'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        13, 11,
        15, 13,
        17, 15,
      ],
      'text-anchor': 'center',
      // Soil-rating labels still dedupe AMONG THEMSELVES (no two PI
      // labels overlap), but they must not BLOCK the Regrid parcel
      // labels which are the primary identifier. ignore-placement=true
      // means soil labels don't reserve a collision footprint, so
      // MapLibre will happily draw the Regrid label on top.
      'text-allow-overlap': false,
      'text-ignore-placement': true,
      'text-padding': 2,
      'symbol-sort-key': ['*', -1, ['get', 'r']],
    }
    const labelPaintBase: any = {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.85)',
      'text-halo-width': 1.6,
      'text-halo-blur': 0.4,
    }
    if (!map.getLayer(LYR_LABELS)) {
      map.addLayer({
        id: LYR_LABELS,
        type: 'symbol',
        source: SRC_LABELS,
        layout: {
          ...labelLayoutBase,
          visibility: (enrichmentOverlay && tillableSource === 'cdl') ? 'visible' : 'none',
        },
        paint: labelPaintBase,
        minzoom: 13.5,
      })
    }
    if (!map.getLayer(LYR_LABELS_WC)) {
      map.addLayer({
        id: LYR_LABELS_WC,
        type: 'symbol',
        source: SRC_LABELS_WC,
        layout: {
          ...labelLayoutBase,
          visibility: (enrichmentOverlay && tillableSource === 'worldcover') ? 'visible' : 'none',
        },
        paint: labelPaintBase,
        minzoom: 13.5,
      })
    }

    // ── Soil Types (all-land) click → LandDetailPanel ──────────────
    // The Regrid parcel fill layer may or may not be under the click
    // (Soil Types is visible over all land, not just parcels). When
    // both are hit, the parcel fill layer's own onClick fires first
    // and calls setLandDetail with parcel context. When ONLY the soil
    // polygon is hit (no Regrid parcel), we open the panel with soil
    // context only so the user still gets the muname/musym info.
    const onSoilsFullClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const soilProps: any = e.features[0].properties || {}
      // Query whether the Regrid fill also underlies this point. If so,
      // the parcel fill onClick already fired (higher z-order) — don't
      // double-open a panel.
      const regridLayer = 'regrid-parcels-fill'
      let hasParcel = false
      try {
        if (map.getLayer(regridLayer)) {
          hasParcel = map.queryRenderedFeatures(e.point, { layers: [regridLayer] }).length > 0
        }
      } catch {/* layer torn down */}
      if (hasParcel) return  // parcel click already handled it
      // Task #26: soils fill spans all zooms — also defer to tract layers
      // and the sale-dot layers (both outrank overlays in priority).
      if (clickClaimedByLayers(map, e.point, [
        'tract-pin-circles', 'tract-polygon-fill',
        'parcel-sale-pin-plus', DURABLE_DOT_LAYER, DURABLE_DOT_PLUS_LAYER,
      ])) return

      // One click, one panel: clear any open tract modal / comp popup,
      // AND (portalMode) tell the parent to close its Tract Detail slide-out.
      setSelectedSale(null)
      setCompPopup(null)
      onLandDetailOpen?.()
      setLandDetail({
        parcelProps: null,
        soilProps,
        csbProps: null,
        ll_uuid: null,
        // No parcel underlies an overlay-only click — no report to offer,
        // so no click point either (footer stays hidden, as before).
        clickLng: null,
        clickLat: null,
        activeOverlay: baseOverlayRef.current,
        source: 'overlay',
      })
    }
    // Bind the soilsFullClick handler to every per-state fill layer.
    for (const fillId of soilsFullFillLayerIds) {
      map.on('click', fillId, onSoilsFullClick)
      map.on('mouseenter', fillId, () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', fillId, () => { map.getCanvas().style.cursor = '' })
    }

    return () => {
      try {
        if (!map.getStyle()) return
        for (const fillId of soilsFullFillLayerIds) {
          map.off('click', fillId, onSoilsFullClick)
        }
        map.off('click', LYR_CSB_FIELDS_FILL, onCsbFieldClick)
        for (const id of [
          LYR_LABELS, LYR_LABELS_WC, LYR_FSA_LINE,
          LYR_TILL_FILL, LYR_TILL_FILL_WC,
          LYR_SOILS_LABEL, LYR_SOILS_LINE, LYR_SOILS_FILL,
          LYR_CSB_FIELDS_FILL,
          ...soilPmLayerIds,
          ...nccpiPmLayerIds,
          ...fsaPmLayerIds,
        ]) {
          if (map.getLayer(id)) map.removeLayer(id)
        }
        for (const id of [
          SRC_TILLABLE, SRC_TILLABLE_WC, SRC_FSA,
          SRC_LABELS, SRC_LABELS_WC, SRC_SOILS,
          SRC_CSB_FIELDS,
          ...soilPmSourceIds,
          ...nccpiPmSourceIds,
          ...fsaPmSourceIds,
        ]) {
          if (map.getSource(id)) map.removeSource(id)
        }
      } catch {/* map torn down */}
    }
  }, [mapLoaded, layersEnabled])

  // Toggle layer visibility when the user flips the overlay button.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!layersEnabled) return
    const vis = enrichmentOverlay ? 'visible' : 'none'
    // FSA always follows the overall toggle. Tillable + labels each
    // have CDL and WorldCover variants — only the matching pair is
    // visible at a time.
    if (map.getLayer('parcel-enrichment-fsa-clu-line')) {
      try { map.setLayoutProperty('parcel-enrichment-fsa-clu-line', 'visibility', vis) } catch {/* */}
    }
    const cdlVis = (enrichmentOverlay && tillableSource === 'cdl') ? 'visible' : 'none'
    const wcVis  = (enrichmentOverlay && tillableSource === 'worldcover') ? 'visible' : 'none'
    // 'ssurgo_csb' previously showed the clipped SSURGO fill — that is now
    // REPLACED by the CSB fields layer (csb-fields-fill). The old clipped
    // SSURGO layers (parcel-enrichment-ssurgo-soils-*) are kept hidden.
    const soilsVis = 'none'  // clipped SSURGO layers never shown anymore
    const soilsFullVis = (enrichmentOverlay && tillableSource === 'ssurgo') ? 'visible' : 'none'
    // CSB crop-field fill: visible when baseOverlay === 'crops' (or legacy 'csb').
    const csbFieldsVis = (baseOverlay === 'crops' || baseOverlay === 'csb') ? 'visible' : 'none'
    for (const [id, v] of [
      ['parcel-enrichment-tillable-fill', cdlVis],
      ['parcel-enrichment-labels-text', cdlVis],
      ['parcel-enrichment-tillable-worldcover-fill', wcVis],
      ['parcel-enrichment-labels-worldcover-text', wcVis],
      ['parcel-enrichment-ssurgo-soils-fill', soilsVis],
      ['parcel-enrichment-ssurgo-soils-line', soilsVis],
      ['parcel-enrichment-ssurgo-soils-label', soilsVis],
      ['csb-fields-fill', csbFieldsVis],
    ] as const) {
      if (map.getLayer(id)) {
        try { map.setLayoutProperty(id, 'visibility', v) } catch {/* */}
      }
    }
    // Per-state PMTiles Soil Types layers — toggle visibility as a group.
    for (const st of SOIL_PMTILES_STATES) {
      for (const id of [`soils-full-fill-${st}`, `soils-full-line-${st}`]) {
        if (map.getLayer(id)) {
          try { map.setLayoutProperty(id, 'visibility', soilsFullVis) } catch {/* */}
        }
      }
    }
  }, [enrichmentOverlay, tillableSource, baseOverlay, mapLoaded, layersEnabled])

  // Toggle NCCPI layer visibility — iterate over per-state pmtiles layers.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const nccpiOn = baseOverlay === 'nccpi'
    const nccpiVis = nccpiOn ? 'visible' : 'none'
    for (const st of SOIL_PMTILES_STATES) {
      const fillId = `explore-nccpi-fill-${st}`
      const lineId = `explore-nccpi-line-${st}`
      try {
        if (map.getLayer(fillId)) map.setLayoutProperty(fillId, 'visibility', nccpiVis)
        if (map.getLayer(lineId)) map.setLayoutProperty(lineId, 'visibility', nccpiVis)
      } catch {/* layer not ready */}
    }
    if (nccpiOn && map.getZoom() < 6) {
      showZoomToast('Zoom in to view NCCPI')
    }
  }, [baseOverlay, mapLoaded, showZoomToast])

  // Toggle FSA overlay layer visibility — iterate over per-state pmtiles layers.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const fsaOn = baseOverlay === 'fsa'
    const fsaVis = fsaOn ? 'visible' : 'none'
    for (const st of FSA_PMTILES_STATES) {
      const lineId = `explore-fsa-line-${st}`
      try {
        if (map.getLayer(lineId)) map.setLayoutProperty(lineId, 'visibility', fsaVis)
      } catch {/* layer not ready */}
    }
    if (fsaOn && map.getZoom() < 6) {
      showZoomToast('Zoom in to view FSA field boundaries')
    }
  }, [baseOverlay, mapLoaded, showZoomToast])

  // Persistent "zoom in" toast — shows while an overlay is active AND
  // the current zoom is below the overlay's min useful zoom.
  // Clears automatically when the user zooms in enough or turns off the overlay.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const checkZoom = () => {
      if (!baseOverlay) { setZoomTooFar(null); return }
      const zoom = map.getZoom()
      const minZooms: Record<string, number> = {
        ssurgo: 6,
        nccpi: 6,
        crops: 10,
        csb: 10,
        fsa: 6,
      }
      const minZ = minZooms[baseOverlay]
      if (minZ !== undefined && zoom < minZ) {
        const labels: Record<string, string> = {
          ssurgo: 'Soil Types',
          nccpi: 'NCCPI',
          crops: 'Crops by Year',
          csb: 'Crops by Year',
          fsa: 'FSA',
        }
        setZoomTooFar(`Zoom in to see ${labels[baseOverlay] ?? baseOverlay}`)
      } else {
        setZoomTooFar(null)
      }
    }

    checkZoom()
    map.on('zoom', checkZoom)
    return () => {
      map.off('zoom', checkZoom)
      setZoomTooFar(null)
    }
  }, [baseOverlay, mapLoaded])

  // Recolor the CSB fields layer when the selected crop year changes.
  // setPaintProperty recolors in-place — no tile refetch.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!map.getLayer('csb-fields-fill')) return
    try {
      map.setPaintProperty('csb-fields-fill', 'fill-color', buildCropColorExpr(selectedCropYear))
    } catch {/* layer not ready */}
  }, [selectedCropYear, mapLoaded])

  // ── 3D Terrain — all-zoom implementation ────────────────────────────
  //
  // Design goals:
  //   • 3D works at ANY zoom (no hard gate, no "zoom in" toast).
  //   • Exaggeration scales by zoom so continental view is subtle and
  //     close-up view is full-strength — prevents the visual absurdity
  //     of mountains looking like needles at z=4.
  //   • No feedback loop: zoom handlers call map.setTerrain() directly
  //     and NEVER call React setState, so they cannot re-trigger effects.
  //   • DEM source has minzoom:5/maxzoom:15 (set at addSource time) —
  //     z15 is the native AWS Terrarium max (z16 404s); using it prevents
  //     overzoom/curtain artifacts under the tilted 3D camera at close zoom.
  //   • Max pitch is clamped by zoom so the horizon doesn't pull in a
  //     huge tile footprint at continental scale.
  //
  // Zoom-scale factor: ramps from 0.25 at z<=4 up to 1.0 at z>=10.
  // The user's slider (1.0–3.0) is the base; effective = base × factor.

  /** Compute the zoom-scaled terrain exaggeration (never setState). */
  const computeEffectiveExaggeration = useCallback((baseExag: number, zoom: number): number => {
    // Linear ramp: 0.25 at z=4 or below, 1.0 at z=10 or above.
    const factor = Math.min(1.0, Math.max(0.25, (zoom - 4) / (10 - 4) * (1.0 - 0.25) + 0.25))
    return baseExag * factor
  }, [])

  // Ref for current exaggeration value so the zoom handler can read it
  // without being part of its dependency array (avoids re-registering on
  // every slider tick).
  const terrainExaggerationRef = useRef(terrainExaggeration)
  useEffect(() => { terrainExaggerationRef.current = terrainExaggeration }, [terrainExaggeration])

  // Ref for terrain on/off so the zoom handler can read it without
  // closing over stale state.
  const terrain3DOnRef = useRef(terrain3DOn)
  useEffect(() => { terrain3DOnRef.current = terrain3DOn }, [terrain3DOn])

  // 3D terrain toggle effect.
  // When turning ON: apply terrain immediately at any zoom, then easeTo pitch.
  // When turning OFF: clear terrain, reset pitch + bearing.
  // terrainExaggeration intentionally NOT in dep array — slider changes are
  // handled by the separate slider effect so easeTo doesn't re-fire.
  //
  // NOTE: county labels and tract pins are native GPU GeoJSON layers —
  // MapLibre draws them on the 3D terrain mesh for free, nothing to
  // suppress. The State silhouettes are DOM markers; hide those while 3D is
  // active so they don't reproject incorrectly on the terrain mesh. Today's
  // green dots have TWO renderers now (DOM marker in 2D so they paint above
  // the state silhouettes; native GL circle layer in 3D so they stay opaque
  // on the terrain mesh instead of fading like other DOM markers) — flip
  // between them here, same place the silhouette DOM markers are toggled.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    try {
      if (terrain3DOn) {
        if (map.getSource('terrarium-dem')) {
          const eff = computeEffectiveExaggeration(terrainExaggeration, map.getZoom())
          map.setTerrain({ source: 'terrarium-dem', exaggeration: eff })
        }
        // Clamp pitch based on zoom: shallower at low zoom reduces horizon footprint.
        const z = map.getZoom()
        const targetPitch = z < 6 ? 30 : z < 9 ? 40 : 45
        map.easeTo({ pitch: targetPitch, duration: 600 })
        // Suppress state silhouette DOM markers in 3D mode (big shapes that
        // distort on the terrain mesh).
        stateMarkersRef.current.forEach(m => {
          const el = m.getElement()
          if (el) el.style.display = 'none'
        })
        // Today's-auction dots: hide the DOM markers, show the GL layer.
        todayMarkersRef.current.forEach(m => {
          const el = m.getElement()
          if (el) el.style.display = 'none'
        })
        if (map.getLayer('today-pin-pulse')) map.setLayoutProperty('today-pin-pulse', 'visibility', 'visible')
        if (map.getLayer('today-pin-core')) map.setLayoutProperty('today-pin-core', 'visibility', 'visible')
      } else {
        map.setTerrain(null)
        map.easeTo({ pitch: 0, bearing: 0, duration: 600 })
        // Restore state silhouette DOM markers when leaving 3D mode.
        stateMarkersRef.current.forEach(m => {
          const el = m.getElement()
          if (el) el.style.display = ''
        })
        // Today's-auction dots: restore the DOM markers, hide the GL layer
        // (also the correct initial 2D state on mount — this branch runs
        // once mapLoaded flips true since terrain3DOn defaults to false).
        todayMarkersRef.current.forEach(m => {
          const el = m.getElement()
          if (el) el.style.display = ''
        })
        if (map.getLayer('today-pin-pulse')) map.setLayoutProperty('today-pin-pulse', 'visibility', 'none')
        if (map.getLayer('today-pin-core')) map.setLayoutProperty('today-pin-core', 'visibility', 'none')
      }
    } catch {/* map not ready */}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain3DOn, mapLoaded])

  // Slider effect: re-apply terrain with new base exaggeration (no easeTo).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !terrain3DOn) return
    try {
      if (map.getSource('terrarium-dem')) {
        const eff = computeEffectiveExaggeration(terrainExaggeration, map.getZoom())
        map.setTerrain({ source: 'terrarium-dem', exaggeration: eff })
      }
    } catch {/* map not ready */}
  }, [terrainExaggeration, terrain3DOn, mapLoaded, computeEffectiveExaggeration])

  // Zoom handler: update terrain exaggeration once per zoom gesture (on
  // zoomend) so the scale factor stays correct after the user zooms.
  // Firing on every 'zoom' frame called setTerrain 60×/sec, re-uploading
  // the terrain mesh to the GPU on each call — the primary crash trigger.
  // Reads refs — NEVER calls setState — so it cannot trigger a React
  // re-render loop.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const onZoomEnd = () => {
      if (!terrain3DOnRef.current) return
      try {
        if (map.getSource('terrarium-dem')) {
          const eff = computeEffectiveExaggeration(terrainExaggerationRef.current, map.getZoom())
          map.setTerrain({ source: 'terrarium-dem', exaggeration: eff })
        }
      } catch {/* map not ready */}
    }
    map.on('zoomend', onZoomEnd)
    return () => { map.off('zoomend', onZoomEnd) }
  }, [mapLoaded, computeEffectiveExaggeration])

  // ─────────────────────────────────────────────────────────────────
  // Enforce canonical map-layer stack order.
  //
  // Bottom → top:
  //   1. MapLibre basemap (implicit, managed by the style)
  //   2. Soil Map (green tillable fill — CDL + WorldCover variants)
  //   3. FSA red lines
  //   4. Soil Map Labels (PI / CSR2 / NCCPI)
  //   5. Regrid parcel boundaries (fill + line)
  //   6. Regrid parcel labels (owner / acres / sale date)
  //   7. Tract polygons + dots (auction listings — anchored above,
  //      stay on top automatically because we moveLayer everything
  //      below to BEFORE 'tract-polygon-fill')
  //
  // Without this, ordering would depend on which effect mounted
  // first — e.g. Regrid labels could end up under the green soil
  // fill, or FSA lines could cover the soil-rating labels.
  // ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapLoaded) return
    const map = mapRef.current
    if (!map) return
    // Defer one frame so any addLayer calls just triggered by the
    // effects above have a chance to finish before we re-order.
    const t = window.setTimeout(() => {
      let style: any
      try { style = map.getStyle() } catch { return }
      if (!style) return
      // Bottom-to-top in the desired stack. Moving each one BEFORE
      // tract-polygon-fill (or to the top if tracts haven't mounted)
      // means the LAST one moved ends up closest to the anchor —
      // i.e. just below tracts — which is exactly Regrid Parcel
      // Labels per the spec above.
      const desiredBottomToTop = [
        // SSURGO soil polygons (Land ID-style) — fill + outline
        // share the same z-slot as the green tillable; only one
        // is visible at a time depending on the data-source toggle.
        'parcel-enrichment-ssurgo-soils-fill',
        // Per-state PMTiles Soil Types (soils-full-{ST}) — same z-slot.
        // Only one of the soil fills is visible at a time.
        ...SOIL_PMTILES_STATES.map(st => `soils-full-fill-${st}`),
        ...SOIL_PMTILES_STATES.map(st => `soils-full-line-${st}`),
        'parcel-enrichment-ssurgo-soils-line',
        // Per-state PMTiles NCCPI choropleth — only one overlay visible at a time.
        // Must be reordered below tracts too, else it floats over tract
        // polygons + Regrid labels.
        ...SOIL_PMTILES_STATES.map(st => `explore-nccpi-fill-${st}`),
        ...SOIL_PMTILES_STATES.map(st => `explore-nccpi-line-${st}`),
        // Crops by Year (CSB crop-field fill) — field-level, minzoom 10.
        // Only one base overlay visible at a time.
        'csb-fields-fill',
        // FSA CLU field lines — per-state PMTiles, above NCCPI and CSB.
        ...FSA_PMTILES_STATES.map(st => `explore-fsa-line-${st}`),
        'parcel-enrichment-tillable-fill',
        'parcel-enrichment-tillable-worldcover-fill',
        'parcel-enrichment-fsa-clu-line',
        // Soil-type musym labels (SSURGO) sit above FSA but below
        // Regrid labels.
        'parcel-enrichment-ssurgo-soils-label',
        'parcel-enrichment-labels-text',
        'parcel-enrichment-labels-worldcover-text',
        'regrid-parcels-fill',
        'regrid-parcels-line',
        'regrid-parcels-label',
      ]
      const tractAnchor = map.getLayer('tract-polygon-fill') ? 'tract-polygon-fill' : undefined
      for (const id of desiredBottomToTop) {
        if (!map.getLayer(id)) continue
        try { map.moveLayer(id, tractAnchor) } catch {/* mid-teardown */}
      }
      // Native marker layers must sit ABOVE the tract polygons (which are
      // themselves moved to the top elsewhere). Lift them so the pulsing
      // today dots end up the single most-prominent thing on the map —
      // matching the old z-order (today > tract pins > county/state).
      liftMarkerLayers(map)
    }, 50)
    return () => window.clearTimeout(t)
  }, [
    mapLoaded, regridConfig, isEnrichmentPilot,
    enrichmentOverlay, tillableSource,
    baseOverlay,
    // Deliberately NOT including tracts.length — that state changes
    // every viewport tick and would cause our reorder to thrash
    // (potentially racing with the Regrid label refresh). Tracts get
    // added with no beforeId by default so they naturally stack on
    // top of whatever we've already ordered.
  ])

  // ONE-SHOT county-wide fetch when the overlay turns on.
  //
  // Previously this re-fetched on every moveend, replacing the entire
  // GeoJSON source each time — which caused the strobing "glitch" on
  // pan/zoom. Now we pull the WHOLE county once, cache in the source,
  // and let MapLibre's GPU handle the pan/zoom. No more glitch.
  //
  // Today's coverage:
  //   • Hancock IL  — Bulletin 811 PI
  //   • Lee IA      — CSR2 (Corn Suitability Rating, mapunit.iacornsr)
  //   • Clark MO    — NCCPI v3 (component-weighted overall score × 100)
  //
  // All three are fired in parallel and merged into shared GeoJSON
  // sources so the operator can pan between them without separate
  // toggle flips. Add more counties by appending to ENRICHMENT_COUNTIES
  // and running scripts/county_pipeline.py for each.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!isEnrichmentPilot || !enrichmentOverlay) return
    if (!enrichmentAvailableRef.current) return  // backend 404'd; don't keep retrying

    const COUNTIES = overlayCoverage

    let cancelled = false

    const fetchCounty = async (state: string, county: string): Promise<{
      tillable: any[]; fsa: any[]; labels: any[]; got404: boolean; got503: boolean;
    }> => {
      // Pre-baked single-blob endpoint — backend ships gzipped, the
      // browser caches public-1d. After the first fetch, all
      // subsequent toggle-ons are instant from disk cache. The
      // browser handles Content-Encoding: gzip transparently.
      try {
        const res = await fetchWithAuth(
          `${API_URL}/api/map/county-overlay/${state}/${encodeURIComponent(county)}`
        )
        if (res.status === 404) {
          return { tillable: [], fsa: [], labels: [], got404: true, got503: false }
        }
        if (res.status === 503) {
          // Bake still warming on the backend. Frontend won't loop;
          // the user can hit the toggle again in a few seconds.
          return { tillable: [], fsa: [], labels: [], got404: false, got503: true }
        }
        if (!res.ok) {
          return { tillable: [], fsa: [], labels: [], got404: false, got503: false }
        }
        const data = await res.json()
        return {
          tillable: data?.tillable?.features || [],
          fsa: data?.fsa_clu?.features || [],
          labels: (data?.labels?.features || []).map((f: any) => ({
            ...f,
            properties: {
              ...(f.properties || {}),
              // Bake the display string here so the label expression
              // doesn't have to do a to-string round-trip per render.
              r: typeof f.properties?.r === 'number'
                ? f.properties.r.toFixed(1)
                : f.properties?.r,
            },
          })),
          got404: false, got503: false,
        }
      } catch {
        return { tillable: [], fsa: [], labels: [], got404: false, got503: false }
      }
    }

    ;(async () => {
      const results = await Promise.all(
        COUNTIES.map(c => fetchCounty(c.state, c.county))
      )
      if (cancelled) return
      // Don't latch enrichmentAvailableRef off when SOME counties 404
      // (newer counties may only have soils-csb data, no legacy
      // tillable/fsa overlay). Only kill the loop if EVERY county
      // 404'd — meaning the backend is missing all coverage.
      if (results.length > 0 && results.every(r => r.got404)) {
        enrichmentAvailableRef.current = false
        return
      }
      // 503 = bake still warming. Don't latch enrichmentAvailableRef
      // off — just render whatever DID load and let a retry click
      // pick up the missing county.
      const tillableFeats = results.flatMap(r => r.tillable)
      const fsaFeats = results.flatMap(r => r.fsa)
      const labelFeats = results.flatMap(r => r.labels)
      const tSrc = map.getSource('parcel-enrichment-tillable') as any
      const fSrc = map.getSource('parcel-enrichment-fsa-clu') as any
      const lSrc = map.getSource('parcel-enrichment-labels') as any
      if (tSrc?.setData) tSrc.setData({ type: 'FeatureCollection', features: tillableFeats })
      if (fSrc?.setData) fSrc.setData({ type: 'FeatureCollection', features: fsaFeats })
      if (lSrc?.setData) lSrc.setData({ type: 'FeatureCollection', features: labelFeats })
    })()

    return () => { cancelled = true }
  }, [mapLoaded, isEnrichmentPilot, enrichmentOverlay, overlayCoverage])

  // Lazy-fetch the WorldCover blob the first time the operator
  // switches the data-source toggle. Each county is ~7–12MB gzipped
  // and ships straight from the backend's in-memory cache (the
  // committed pre-bake under data/county_overlay_worldcover/). After
  // the first fetch the browser caches the response for a day, so
  // re-toggling is instant.
  useEffect(() => {
    if (!isEnrichmentPilot) return
    if (tillableSource !== 'worldcover') return
    if (worldcoverLoadedRef.current) return
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const COUNTIES = overlayCoverage.map(c => `${c.state}/${c.county}`)
    let cancelled = false

    ;(async () => {
      const tillableOut: any[] = []
      const labelsOut: any[] = []
      try {
        const results = await Promise.all(COUNTIES.map(async key => {
          const res = await fetchWithAuth(
            `${API_URL}/api/map/county-overlay/${key}/worldcover`
          )
          if (!res.ok) return { tillable: [], labels: [] }
          const data = await res.json()
          return {
            tillable: data?.tillable?.features || [],
            labels: (data?.labels?.features || []).map((f: any) => ({
              ...f,
              properties: {
                ...(f.properties || {}),
                r: typeof f.properties?.r === 'number'
                  ? f.properties.r.toFixed(1)
                  : f.properties?.r,
              },
            })),
          }
        }))
        for (const r of results) {
          tillableOut.push(...r.tillable)
          labelsOut.push(...r.labels)
        }
      } catch { /* silent */ }
      if (cancelled) return
      const tSrc = map.getSource('parcel-enrichment-tillable-worldcover') as any
      const lSrc = map.getSource('parcel-enrichment-labels-worldcover') as any
      if (tSrc?.setData) tSrc.setData({ type: 'FeatureCollection', features: tillableOut })
      if (lSrc?.setData) lSrc.setData({ type: 'FeatureCollection', features: labelsOut })
      worldcoverLoadedRef.current = true
    })()

    return () => { cancelled = true }
  }, [tillableSource, isEnrichmentPilot, mapLoaded, overlayCoverage])

  // Lazy-fetch the SSURGO (Land ID-style) soil polygons the first
  // time the data-source toggle hits 'ssurgo' OR 'ssurgo_csb'.
  // Same lazy-load pattern as the WorldCover blob above; the soils
  // blob is the heaviest of the three (~10-15MB gzipped) since
  // SSURGO ships 20K+ vector polygons per county.
  //
  // 'ssurgo'     → /soils endpoint (FSA + ≥65% CDL coverage)
  // 'ssurgo_csb' → /soils-csb endpoint (FSA + ≥65% CSB cropland
  //                coverage, with non-cropland CSB sub-regions
  //                punched as smooth internal holes — should
  //                exclude waterway / house FSAs that CDL keeps)
  //
  // The two variants share the same MapLibre source + layers, so
  // switching between them only re-fetches; layers stay registered.
  // SSURGO soils overlay now uses a vector tile source — MapLibre
  // fetches /api/tiles/soils/{z}/{x}/{y}.mvt automatically based on
  // viewport. No per-county GeoJSON fetch + merge needed. The source
  // was added once in the map-init block above. The per-county
  // fetch + Promise.allSettled loop was removed when the overlay
  // went MVT-only to scale past ~6 counties.

  // ── Native tract-pin source: setData only (NEVER recreate the layer).
  // The tract-pin-circles / tract-pin-labels layers were registered once
  // in map-init; here we just push fresh data whenever the memo changes.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const src = map.getSource('tract-pins') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(tractPinGeoJSON)
  }, [mapLoaded, tractPinGeoJSON])

  // Keep tract-pin-plus's "+" visibility in sync with comp mode, on every
  // subjectTractId change (map-init only sets the INITIAL visibility from
  // subjectTractIdRef.current — this covers a mode flip on an
  // already-mounted map, same as the DURABLE_DOT_PLUS_LAYER mode-sync
  // effect above). tract-pin-labels' price/acre text is never touched —
  // explore mode's label is unchanged, comp mode just adds the "+" on top.
  // ownerSearchActive ANDs in here too (owner bug report 2026-07-24): an
  // owner-parcels search must hide the "+" glyph the same as every other
  // tract-pin layer, even in comp mode — see ownerSearchActive's
  // declaration up near ownerParcelsChip for the single-source-of-truth
  // rationale.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!map.getLayer('tract-pin-plus')) return
    try {
      map.setLayoutProperty('tract-pin-plus', 'visibility', (subjectTractId && !ownerSearchActive) ? 'visible' : 'none')
    } catch {/* layer torn down */}
  }, [mapLoaded, subjectTractId, ownerSearchActive])

  // Owner-search-only display gate, tract-pin-circles/-labels half (owner
  // bug report 2026-07-24): these two layers have no other visibility
  // effect (they're 'visible' from map-init and never toggled elsewhere),
  // so this is their sole source of truth. Hides both while
  // ownerSearchActive is true and restores 'visible' the instant it goes
  // false — see ownerSearchActive's declaration up near ownerParcelsChip.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    try {
      if (map.getLayer('tract-pin-circles')) {
        map.setLayoutProperty('tract-pin-circles', 'visibility', ownerSearchActive ? 'none' : 'visible')
      }
      if (map.getLayer('tract-pin-labels')) {
        map.setLayoutProperty('tract-pin-labels', 'visibility', ownerSearchActive ? 'none' : 'visible')
      }
      // The pink tract polygon fill/outline must hide with the pins —
      // they're the same "pink tract" visual as far as an owner search
      // is concerned (mobile gates its tract-polygon layers the same way).
      if (map.getLayer('tract-polygon-fill')) {
        map.setLayoutProperty('tract-polygon-fill', 'visibility', ownerSearchActive ? 'none' : 'visible')
      }
      if (map.getLayer('tract-polygon-line')) {
        map.setLayoutProperty('tract-polygon-line', 'visibility', ownerSearchActive ? 'none' : 'visible')
      }
    } catch {/* layer torn down */}
  }, [mapLoaded, ownerSearchActive])

  // ── Tract-pin interactions (click → detail/comp popup; hover cursor).
  // Wired ONCE per mapLoaded. Reads the full SaleDetail from
  // tractMapRef.current (keyed by tractId) so the GeoJSON feature stays
  // lean. Mirrors the old DOM onClick downstream logic exactly:
  //   comp mode  → setCompPopup
  //   portalMode → onTractSelected
  //   otherwise  → setSelectedSale
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const tractId = (f.properties?.tractId as string) || ''
      const tract = tractMapRef.current.get(tractId)
      if (!tract) return

      // Same display-price-per-acre + basis rule as the old DOM loop.
      const isPrivateTreaty = (tract.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = (tract.sale_status || '').toLowerCase() === 'pending'
      const markerPpa = (isPrivateTreaty || isPending) && tract.asking_price && tract.total_acres
        ? tract.asking_price / tract.total_acres
        : tract.price_per_acre
      const markerBasis: 'sold' | 'asking' | null =
        ((isPrivateTreaty || isPending) && tract.asking_price && tract.total_acres)
          ? 'asking'
          : (tract.price_per_acre ? 'sold' : null)

      const saleData: SaleDetail = {
        id: tract.id,
        listingId: tract.listing_id,
        tractId: tract.id,
        auctionDate: tract.auction_date,
        totalAcres: tract.total_acres,
        tillableAcres: tract.tillable_acres,
        companyName: tract.company_name,
        salePrice: tract.sale_price,
        pricePerAcre: markerPpa,
        priceBasis: markerBasis,
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
        // Coincident recorded deed(s) — see recomputeCoincidentDeeds. Read
        // from the ref (not the `tractDeeds` state directly) because this
        // handler is registered in an effect that doesn't re-run on every
        // deed resolution.
        deeds: tractDeedsRef.current.get(tract.id),
      }

      // Task #26 (one click, one panel): tract is top priority — it wins
      // over any sale-dot or parcel/overlay panel already open from a
      // previous click.
      setLandDetail(null)
      if (subjectTractIdRef.current) {
        // Comp mode — inline popup anchored at the clicked feature's
        // projected pixel position. e.originalEvent already prevented the
        // map 'click' that would close the popup (layer click fires first;
        // we stash the lngLat so onMove keeps it anchored).
        const point = e.point
        setCompPopup({
          sale: saleData,
          pos: { x: point.x, y: point.y },
          lngLat: [e.lngLat.lng, e.lngLat.lat],
        })
      } else if (portalMode && onTractSelected) {
        lastPortalSaleRef.current = saleData
        onTractSelected(saleData)
      } else {
        setCompPopup(null)
        setSelectedSale(saleData)
      }
    }

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const onLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('click', 'tract-pin-circles', onClick)
    map.on('mouseenter', 'tract-pin-circles', onEnter)
    map.on('mouseleave', 'tract-pin-circles', onLeave)
    // Same handler on the tract POLYGON fill — clicking anywhere on a tract
    // boundary (not just the pin) opens the tract details. Polygon features
    // carry properties.tractId (buildExplorePolygonGeoJSON), so onClick resolves
    // the tract identically.
    map.on('click', 'tract-polygon-fill', onClick)
    map.on('mouseenter', 'tract-polygon-fill', onEnter)
    map.on('mouseleave', 'tract-polygon-fill', onLeave)
    return () => {
      map.off('click', 'tract-pin-circles', onClick)
      map.off('mouseenter', 'tract-pin-circles', onEnter)
      map.off('mouseleave', 'tract-pin-circles', onLeave)
      map.off('click', 'tract-polygon-fill', onClick)
      map.off('mouseenter', 'tract-polygon-fill', onEnter)
      map.off('mouseleave', 'tract-polygon-fill', onLeave)
    }
  }, [mapLoaded, portalMode, onTractSelected])

  // Quick lookup of today's tracts by id. Today's tracts are fetched
  // separately (/api/map/tracts/today) and are NOT in tractMapRef, so the
  // today-pin click handler resolves the full tract from here.
  const todayTractsByIdRef = useRef<Map<string, ApiMapTract>>(new Map())
  useEffect(() => {
    todayTractsByIdRef.current = new Map(todayTracts.map(t => [t.id, t]))
  }, [todayTracts])

  // Push today's-auction points into the native today-pins source. Each dot
  // sits on its true stored lat/lng at every zoom (no cluster-centroid drift,
  // the bug that dragged a Kansas dot to Texas when zoomed out), and being a
  // GL circle layer it stays fully opaque in 3D (DOM markers faded behind the
  // terrain mesh).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const src = map.getSource('today-pins') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(todayPinGeoJSON)
  }, [mapLoaded, todayPinGeoJSON])

  // Pulse the today-pin halo (radius + fade) via rAF — restores the "live"
  // pulse the old DOM markers had, now on the GL layer (whose dot position is
  // shader-exact at every zoom). Only runs while there are today dots, so the
  // map isn't perpetually repainting for nothing.
  const hasTodayDots = todayTracts.length > 0
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !hasTodayDots) return
    let raf = 0
    const PERIOD = 1600 // ms per pulse
    const step = (ts: number) => {
      const phase = (ts % PERIOD) / PERIOD // 0..1
      const radius = 6 + phase * 16        // 6 → 22 px
      const opacity = 0.45 * (1 - phase)   // 0.45 → 0
      if (map.getLayer('today-pin-pulse')) {
        try {
          map.setPaintProperty('today-pin-pulse', 'circle-radius', radius)
          map.setPaintProperty('today-pin-pulse', 'circle-opacity', opacity)
        } catch {/* mid-teardown */}
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [mapLoaded, hasTodayDots])

  // Shared today-pin click dispatch. A green dot represents the WHOLE
  // auction (not a single tract), so a click opens the full Listing Details
  // — except in the firm portal, where onTractSelected keeps the portal flow
  // intact. (Per user 2026-06-05.) Extracted to a callback so BOTH the GL
  // today-pin-core layer (3D mode) and the DOM today-marker (2D mode, added
  // below so the dots paint above the state silhouettes) resolve a click
  // identically.
  const handleTodayPinClick = useCallback((tractId: string) => {
    const tract = todayTractsByIdRef.current.get(tractId)
    if (!tract) return

    if (portalMode && onTractSelected) {
      const isPrivateTreaty = (tract.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = (tract.sale_status || '').toLowerCase() === 'pending'
      const ppa = (isPrivateTreaty || isPending) && tract.asking_price && tract.total_acres
        ? tract.asking_price / tract.total_acres
        : tract.price_per_acre ?? null
      const ppaBasis: 'sold' | 'asking' | null =
        ((isPrivateTreaty || isPending) && tract.asking_price && tract.total_acres)
          ? 'asking'
          : (tract.price_per_acre ? 'sold' : null)
      // Task #26 (one click, one panel): tract is top priority — opening
      // the portal Tract Detail panel must close the parcel/land panel
      // and any comp popup left over from a previous click.
      setLandDetail(null)
      setCompPopup(null)
      setSelectedSale(null)
      const todaySaleData: SaleDetail = {
        id: tract.id,
        listingId: tract.listing_id,
        tractId: tract.id,
        auctionDate: tract.auction_date,
        totalAcres: tract.total_acres,
        tillableAcres: tract.tillable_acres,
        companyName: tract.company_name,
        salePrice: tract.sale_price,
        pricePerAcre: ppa,
        priceBasis: ppaBasis,
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
        deeds: tractDeedsRef.current.get(tract.id),
      }
      lastPortalSaleRef.current = todaySaleData
      onTractSelected(todaySaleData)
      return
    }
    if (tract.listing_id) {
      window.location.href = `/listings/${tract.listing_id}`
    }
  }, [portalMode, onTractSelected])

  // today-pin-core interactions — GL layer path, active in 3D mode (the DOM
  // today-marker below handles clicks in 2D).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const tractId = (f.properties?.tractId as string) || ''
      handleTodayPinClick(tractId)
    }

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const onLeave = () => { map.getCanvas().style.cursor = '' }

    map.on('click', 'today-pin-core', onClick)
    map.on('mouseenter', 'today-pin-core', onEnter)
    map.on('mouseleave', 'today-pin-core', onLeave)
    return () => {
      map.off('click', 'today-pin-core', onClick)
      map.off('mouseenter', 'today-pin-core', onEnter)
      map.off('mouseleave', 'today-pin-core', onLeave)
    }
  }, [mapLoaded, handleTodayPinClick])

  // Today's-auction green dots — DOM marker path, active in 2D mode. Built
  // from the SAME todayPinGeoJSON that feeds the today-pins GL source above
  // (identical per-tract lng/lat, including the co-location fan-out for
  // stacked auctions), so the DOM dot and the GL dot never disagree on
  // position. Uses plain marker.setLngLat per tract — no clustering, no
  // manual projection — which is why the state-name badges (also DOM
  // markers) don't drift on zoom; this follows the same pattern. Mirrors the
  // today-pins source-update effect's deps (mapLoaded, todayPinGeoJSON).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    todayMarkersRef.current.forEach(m => m.remove())
    todayMarkersRef.current = []

    for (const feature of todayPinGeoJSON.features) {
      const geom = feature.geometry
      if (!geom || geom.type !== 'Point') continue
      const [lng, lat] = geom.coordinates as [number, number]
      const tractId = (feature.properties?.tractId as string) || ''

      const el = document.createElement('div')
      el.className = 'gg-today-dot-shell'
      // 3D mode uses the GL layer instead (stays opaque on the terrain
      // mesh) — if this effect rebuilds while 3D is active (today dots
      // refetched), keep the new markers hidden until 2D is restored.
      if (terrain3DOnRef.current) el.style.display = 'none'

      const halo = document.createElement('div')
      halo.className = 'gg-today-dot-halo'
      el.appendChild(halo)

      const core = document.createElement('div')
      core.className = 'gg-today-dot-core'
      el.appendChild(core)

      // Click/hover mirror the today-pin-core GL layer's behavior exactly
      // (via the shared handleTodayPinClick callback) so switching between
      // 2D DOM markers and 3D GL circles never changes what a click does.
      el.addEventListener('click', () => handleTodayPinClick(tractId))
      el.addEventListener('mouseenter', () => { map.getCanvas().style.cursor = 'pointer' })
      el.addEventListener('mouseleave', () => { map.getCanvas().style.cursor = '' })

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map)
      todayMarkersRef.current.push(marker)
    }

    return () => {
      todayMarkersRef.current.forEach(m => m.remove())
      todayMarkersRef.current = []
    }
  }, [mapLoaded, todayPinGeoJSON, handleTodayPinClick])

  // ── Report-highlight (portal mode): drive the tract-pin-circles pink
  // stroke via setFeatureState({highlighted}) instead of mutating DOM.
  // Re-applies on every reportIds change AND after the source reloads
  // (tractPinGeoJSON dep) since setData clears feature-state.
  const prevHighlightedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!map.getSource('tract-pins')) return
    // Clear previously-highlighted features that are no longer selected.
    const next = (portalMode && reportIds) ? reportIds : new Set<string>()
    prevHighlightedRef.current.forEach(id => {
      if (!next.has(id)) {
        try { map.setFeatureState({ source: 'tract-pins', id }, { highlighted: false }) } catch {}
      }
    })
    next.forEach(id => {
      try { map.setFeatureState({ source: 'tract-pins', id }, { highlighted: true }) } catch {}
    })
    prevHighlightedRef.current = new Set(next)
  }, [mapLoaded, portalMode, reportIds, tractPinGeoJSON])

  // ── Comparable-visibility: a layer `filter` on both tract-pin layers
  // restricts to the comparable panel's visible IDs. null = show all.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    if (!map.getLayer('tract-pin-circles')) return
    const filter = comparableVisibleIds
      ? (['in', ['get', 'tractId'], ['literal', Array.from(comparableVisibleIds)]] as any)
      : null
    try {
      map.setFilter('tract-pin-circles', filter)
      map.setFilter('tract-pin-labels', filter)
    } catch {/* layer not ready */}
  }, [mapLoaded, comparableVisibleIds])

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
      background: rgba(14,165,233,0.2);
      border: 2px solid #0EA5E9;
      color: #0EA5E9;
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
      border: 2px solid #0EA5E9;
      animation: subjectPulse 2s ease-out infinite;
    `
    pinContainer.appendChild(ring)

    // Second ring (delayed)
    const ring2 = document.createElement('div')
    ring2.style.cssText = `
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid #0EA5E9;
      animation: subjectPulse 2s ease-out 1s infinite;
    `
    pinContainer.appendChild(ring2)

    // Main pin
    const pin = document.createElement('div')
    pin.style.cssText = `
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #0EA5E9;
      border: 3px solid #fff;
      box-shadow: 0 0 0 4px rgba(14,165,233,0.4), 0 0 20px 6px rgba(14,165,233,0.5);
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
  // ─────────────────────────────────────────────────────────────

  // STATE BADGES — silhouette + count, sized to the projected bbox
  // of each state so the silhouette sits over its real on-map
  // footprint. Inner sized inline; resize wired to map "move" so
  // badges stay locked to their footprints during pan/zoom.
  //
  // FADE BAND: once the live zoom crosses FADE_START the badges
  // fade out smoothly (opacity driven by the real-time "zoom" event,
  // NOT by React state so there's no per-frame setState). The per-frame
  // bbox resize is suppressed above FADE_START — that resize is the
  // root cause of the mid-zoom glitch. Badges are fully gone at
  // FADE_END (≤ STATE_TIER_MAX=6), so the glitch zone is never reached.
  const FADE_START = 5.0   // fully opaque at or below this zoom
  const FADE_END   = 5.8   // fully transparent at or above this zoom

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    fadeOutAndRemove(stateMarkersRef.current)
    stateMarkersRef.current = []
    // Owner screenshot (2026-07-10): a filter or Goat Search result
    // overlaps the state silhouettes/labels/Filter-badges/goat icons at
    // low zoom, cluttering the map on top of the actual result bubbles.
    // Reuse the SAME hasActiveFilters signal the county count-bubble
    // layer gates on (line ~6317) so the two stay consistent — hide the
    // whole silhouette overlay whenever a filter/search is active, show
    // it again once cleared. Doesn't touch the result bubbles/pins.
    if (currentTier !== 'state' || hasActiveFilters) return

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
          const seed = { stateFilter: state, countyFilters: [], townshipFilters: [] }
          // Direct set covers the panel-already-open case (the re-seed
          // effect is keyed on filterOpen and won't run); the ref covers
          // the normal closed -> open case, where it would otherwise be
          // overwritten by appliedFilters.
          pendingFilterSeedRef.current = seed
          setFilters(prev => ({ ...prev, ...seed }))
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

    // Per-frame move handler: resize badges to their projected bbox
    // ONLY when zoom is below the fade threshold. Above FADE_START the
    // badges are fading/gone and re-stretching them every frame is what
    // causes the mid-zoom glitch — skip it entirely.
    const onMove = () => {
      const z = map.getZoom()
      if (z < FADE_START) {
        for (const { inner, bbox } of sized) sizeBadge(inner, bbox)
      }
    }
    map.on('move', onMove)

    // Live-zoom opacity: drive fade via direct DOM style manipulation
    // on the inner badge element. No React setState — that would cause
    // a per-frame re-render and a perf regression.
    const allInners = stateMarkersRef.current.map(m => {
      const shell = m.getElement()
      return shell?.firstElementChild as HTMLElement | null
    })
    const onZoomLive = () => {
      const z = map.getZoom()
      let opacity: number
      if (z <= FADE_START) {
        opacity = 1
      } else if (z >= FADE_END) {
        opacity = 0
      } else {
        opacity = 1 - (z - FADE_START) / (FADE_END - FADE_START)
      }
      for (const inner of allInners) {
        if (inner) inner.style.opacity = String(opacity)
      }
    }
    map.on('zoom', onZoomLive)

    return () => {
      map.off('move', onMove)
      map.off('zoom', onZoomLive)
      fadeOutAndRemove(stateMarkersRef.current)
      stateMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCounts, mapLoaded, currentTier, stateSilhouettes, stateBboxes, hasActiveFilters])

  // ── County COUNT bubbles (filter-active): setData + click. Visibility
  // is toggled by the hasActiveFilters effect below (setLayoutProperty),
  // and the county-NAME labels are hidden in the same effect so the two
  // never stack on a centroid.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const src = map.getSource('county-counts') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(countyCountGeoJSON)
  }, [mapLoaded, countyCountGeoJSON])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const onClick = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const geom = f.geometry as GeoJSON.Point
      map.easeTo({ center: geom.coordinates as [number, number], zoom: 10, duration: 800 })
    }
    const onEnter = () => { map.getCanvas().style.cursor = 'pointer' }
    const onLeave = () => { map.getCanvas().style.cursor = '' }
    map.on('click', 'county-count-circles', onClick)
    map.on('mouseenter', 'county-count-circles', onEnter)
    map.on('mouseleave', 'county-count-circles', onLeave)
    return () => {
      map.off('click', 'county-count-circles', onClick)
      map.off('mouseenter', 'county-count-circles', onEnter)
      map.off('mouseleave', 'county-count-circles', onLeave)
    }
  }, [mapLoaded])

  // ── Filter-aware visibility swap (no layer recreation): when a filter
  // is active, show the pink county-COUNT bubbles and HIDE the plain
  // county-NAME labels; otherwise the reverse. Native minzoom/maxzoom on
  // each layer still governs the tier within these visibility states.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const countVis = hasActiveFilters ? 'visible' : 'none'
    // Owner 2026-07-27: county NAME badges must stay visible even when a
    // filter is active (was hidden here so only the count circles showed).
    // Their own minzoom/maxzoom tier still governs WHEN they appear; this
    // only stops the filter state from suppressing them.
    const nameVis = 'visible'
    for (const [id, v] of [
      ['county-count-circles', countVis],
      ['county-count-labels', countVis],
      ['county-labels', nameVis],
    ] as const) {
      if (map.getLayer(id)) {
        try { map.setLayoutProperty(id, 'visibility', v) } catch {/* */}
      }
    }
    // Owner 2026-07-27: when the count circle is showing (filter active),
    // the name pill and the circle share the county centroid and collide —
    // text-allow-overlap:false then suppressed the NAME entirely (numbered
    // county showed no name). Push the name pill BELOW the circle and let it
    // overlap so it always renders under the number. No filter → no circle →
    // name centered at the centroid as before.
    if (map.getLayer('county-labels')) {
      try {
        map.setLayoutProperty('county-labels', 'text-offset', hasActiveFilters ? [0, 2.4] : [0, 0])
        map.setLayoutProperty('county-labels', 'text-allow-overlap', hasActiveFilters)
        map.setLayoutProperty('county-labels', 'icon-allow-overlap', hasActiveFilters)
      } catch {/* */}
    }
  }, [mapLoaded, hasActiveFilters])

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

      {/* "Loading Ground" pill — owner-approved restyle 2026-08-04, widened
          2026-08-04 to also cover the county/state count-badge fetch. Shown
          whenever EITHER durable parcel-sale dots (`dotsLoading`, set from
          inside fetchDurableDotsForBounds — covers pan/zoom, not just a
          filter Apply) OR the state/county-tier count fetch
          (`countCountsLoading`, set from the state-tract-counts /
          county-tract-counts effects — covers Apply at the circle tiers) are
          loading. The two are OR'd into one `badgeLoading` boolean feeding
          the SAME anti-flicker pipeline (see its declaration near
          `dotsLoading`) — there's still exactly one pill mechanism.

          Owner report 2026-08-04: applying a 4-county IL filter at z6-8 (the
          county-circle tier, BELOW DURABLE_DOT_MIN_ZOOM) took "a LONG time"
          with no loading indicator at all — `dotsLoading` alone never fires
          below z9, so that entire zoom band had zero feedback. The two raw
          signals are naturally close to zoom-exclusive by how their fetches
          are triggered (dots never fetch below z9; the count fetch is what
          renders at/below z9), so a single REGRID_MIN_ZOOM(11) ceiling below
          — unchanged, restored 2026-08-04 after the badge was firing
          continuously through z13-z20 — is enough to keep the pill out of
          the parcel-tier zoom range without needing a separate floor per
          source.

          The old full-viewport dim+blur scrim is gone — it was
          pointerEvents:none (blocked nothing) and only washed out the map;
          the pill alone now carries contrast. Repositioned to the top-center
          toast slot this file already uses for the "zoom in to view soil
          maps" hint (see zoomToast below) — same top:72/left:50%/
          translateX(-50%) anchoring and role="status" aria-live="polite".

          Anti-flicker: `dotsLoadingVisible` (not `badgeLoading` directly)
          gates render — see the effect near the dotsLoading state decl for
          the 400ms show-delay / 500ms minimum-visible logic. Healthy fetches
          (~350ms) never show the pill at all.

          Shimmer text keeps the website's pink/white/pink gradient sweep
          (owner explicitly prefers this over mobile's solid-pink-plus-shine-
          bar) but now only animates under prefers-reduced-motion:
          no-preference — reduced-motion users get static pink text. */}
      {dotsLoadingVisible
        && currentZoom < REGRID_MIN_ZOOM && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 20,
            background: 'rgba(20,20,20,0.82)',
            backdropFilter: 'blur(4px)',
            padding: '8px 18px',
            borderRadius: 9999,
            boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
          }}
        >
          <style>{`
            @keyframes ggLoadingShimmer {
              0%   { background-position: 200% center; }
              100% { background-position: -200% center; }
            }
            .gg-loading-shimmer-text {
              font-size: 13px;
              font-weight: 700;
              color: #ff6bc4;
            }
            @media (prefers-reduced-motion: no-preference) {
              .gg-loading-shimmer-text {
                background-image: linear-gradient(100deg, rgba(236,72,153,0.65) 0%, #ffffff 42%, #ff9ed6 58%, rgba(236,72,153,0.65) 100%);
                background-size: 200% auto;
                background-clip: text;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                color: transparent;
                animation: ggLoadingShimmer 1.6s linear infinite;
              }
            }
          `}</style>
          <span className="gg-loading-shimmer-text">Loading Ground</span>
        </div>
      )}

      {/* Inline toast — fades in/out, used today only for the
          "zoom in to view soil maps" hint when the user enables Soil
          Maps below the soils minzoom. Auto-dismisses in 4s.
          top: 72 keeps it clear of the portal top menu bar (~56-64px)
          so the message reads cleanly instead of overlapping the nav. */}
      {zoomToast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            background: 'rgba(20, 25, 30, 0.92)',
            color: 'white',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
            backdropFilter: 'blur(4px)',
          }}
        >
          {zoomToast}
        </div>
      )}

      {/* Persistent toast: visible while an overlay is active and the map
          is zoomed out too far to render it. Clears automatically on zoom-in
          or overlay toggle. White bg / black text per spec. */}
      {zoomTooFar && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 72,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999,
            background: '#ffffff',
            color: '#111111',
            padding: '10px 20px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 20px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.12)',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
          }}
        >
          {zoomTooFar}
        </div>
      )}

      {/* Loading spinner: shown while overlay tiles are still being fetched.
          Positioned below the zoom toast (top: 120) to avoid overlap. */}
      {overlayLoading && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'absolute',
            top: 120,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1001,
            background: 'rgba(20, 25, 30, 0.92)',
            color: 'white',
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            pointerEvents: 'none',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{
            width: 14,
            height: 14,
            border: '2px solid rgba(255,255,255,0.3)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
            flexShrink: 0,
          }} />
          {`Loading ${overlayLoading}…`}
        </div>
      )}

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

      {/* Unified land-detail slide-out panel. Replaces the old anchored
          Regrid parcel popup + the soil/crop popup. Docked to the right
          edge so it never overlaps map content. */}
      <LandDetailPanel
        clickData={landDetail}
        onClose={() => setLandDetail(null)}
      />

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
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}
          >
            <span>✨ Searching the map…</span>
            {/* Owner addition (2026-07-09): only for state-wide/nationwide
                searches (hasCountyFilter false, see the dots-bbox-scoping
                fix above) — county-scoped searches are already fast and
                never show this. Secondary line, same font family, smaller
                and lighter than the pill's primary text — no new visual
                language. */}
            {chatSearchLargeArea && (
              <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.75 }}>
                Large searches cover a lot of ground — this can take a few extra seconds.
              </span>
            )}
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
      {false && isAdmin && (
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

      {/* Soil overlay toggles are in the in-map Layer Panel below. */}

      {/* Layers Button */}
      {layersEnabled && (
        <button
          onClick={() => setLayerPanelOpen(v => !v)}
          title="Layers"
          style={{
            position: 'absolute',
            bottom: 60,
            left: 16,
            zIndex: 400, // above the fixed logo (z-[390] in access/page.tsx) so the toggle stays clickable above it
            width: 36,
            height: 36,
            borderRadius: 6,
            border: 'none',
            backgroundColor: (baseOverlay !== null || terrain3DOn)
              ? '#E91E8C'
              : 'rgba(0,0,0,0.75)',
            color: '#fff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
          }}
        >
          {/* Layers stack icon */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
        </button>
      )}

      {/* Layer Control Panel */}
      {layersEnabled && layerPanelOpen && (
        <div style={{
          position: 'absolute',
          bottom: 100,
          left: 16,
          zIndex: 401, // above the fixed Ground Goat logo (z-[390] in access/page.tsx) so the panel never renders behind it
          background: 'linear-gradient(175deg, #2a2a2a 0%, #1a1a1a 35%, #111111 70%, #0a0a0a 100%)',
          boxShadow: '0 0 0 0.5px rgba(255,255,255,0.06) inset, 0 1px 0 rgba(255,255,255,0.10) inset, 0 20px 60px rgba(0,0,0,0.85), 0 8px 24px rgba(0,0,0,0.70), 0 2px 8px rgba(0,0,0,0.50)',
          border: '0.5px solid rgba(255,255,255,0.14)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderRadius: 12,
          width: 220,
          padding: '12px 0 8px',
        }}>
          {/* ── Overlays (mutually-exclusive buttons) ── */}
          <div style={{ padding: '0 10px 6px', color: 'rgba(255,255,255,0.40)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Overlays
          </div>
          <div style={{ padding: '0 10px 4px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {([
              {
                key: 'ssurgo' as const,
                label: 'Soil Types',
                swatchGradient: 'linear-gradient(to right,#c94040,#c4b030,#29a068,#2878c8,#b03890)',
              },
              {
                key: 'crops' as const,
                label: 'Crops by Year',
                swatchGradient: 'linear-gradient(to right,#FFD400,#267000,#A87000,#FFA8E3)',
              },
              {
                key: 'nccpi' as const,
                label: 'NCCPI',
                swatchGradient: 'linear-gradient(to right,#d73027,#fee08b,#1a9850)',
              },
              {
                key: 'fsa' as const,
                label: 'FSA',
                swatchColor: '#22d3ee',
              },
            ] as Array<{ key: 'crops' | 'ssurgo' | 'csb' | 'nccpi' | 'fsa'; label: string; swatchGradient?: string; swatchColor?: string }>).map(({ key, label, swatchGradient, swatchColor }) => {
              const active = baseOverlay === key
              return (
                <OverlayButton
                  key={key}
                  active={active}
                  label={label}
                  swatchGradient={swatchGradient}
                  swatchColor={swatchColor}
                  onClick={() => {
                    setBaseOverlay(active ? null : key)
                    // The persistent zoomTooFar toast handles all overlay
                    // zoom-gate messaging — no duplicate showZoomToast here.
                  }}
                />
              )
            })}
          </div>

          {/* NCCPI legend — shown only when nccpi overlay is active */}
          {baseOverlay === 'nccpi' && (
            <div style={{ padding: '2px 10px 4px' }}>
              <div style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
                {[['#d73027','0'],['#fc8d59','25'],['#fee08b','50'],['#91cf60','75'],['#1a9850','100']].map(([c, l]) => (
                  <div key={l} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ height: 5, background: c, borderRadius: 2 }} />
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 8 }}>{l}</span>
                  </div>
                ))}
              </div>
              <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8, textAlign: 'center' }}>Low → High productivity</div>
            </div>
          )}

          {/* FSA legend — shown only when fsa overlay is active */}
          {baseOverlay === 'fsa' && (
            <div style={{ padding: '2px 10px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 12, height: 3, borderRadius: 1, background: '#22d3ee', flexShrink: 0, marginTop: 1 }} />
                <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10 }}>FSA field boundary</span>
              </div>
              <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9, marginTop: 2 }}>2008 snapshot · Not available in AL, FL, AK</span>
            </div>
          )}

          {/* ── CSB year selector + crop legend — Crops by Year only ── */}
          <div style={{
            maxHeight: (baseOverlay === 'crops' || baseOverlay === 'csb') ? 300 : 0,
            opacity: (baseOverlay === 'crops' || baseOverlay === 'csb') ? 1 : 0,
            overflow: 'hidden',
            transition: 'max-height 0.18s ease, opacity 0.18s ease',
          }}>
            {/* Year chip row — subordinate to Tillable Ground button */}
            <div style={{ padding: '4px 10px 0', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {[2017,2018,2019,2020,2021,2022,2023,2024].map(yr => {
                const sel = selectedCropYear === yr
                return (
                  <div
                    key={yr}
                    onClick={() => setSelectedCropYear(yr)}
                    style={{
                      height: 22,
                      padding: '0 6px',
                      borderRadius: 5,
                      fontSize: 10,
                      fontWeight: 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      background: sel ? 'rgba(233,30,140,0.25)' : 'rgba(255,255,255,0.05)',
                      border: sel ? '1px solid rgba(233,30,140,0.70)' : '1px solid rgba(255,255,255,0.15)',
                      color: sel ? '#f9a8d4' : 'rgba(255,255,255,0.50)',
                      transition: 'background 0.12s, border-color 0.12s, color 0.12s',
                    }}
                    onMouseEnter={e => {
                      if (!sel) {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.10)'
                        ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.22)'
                        ;(e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.80)'
                      }
                    }}
                    onMouseLeave={e => {
                      if (!sel) {
                        (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'
                        ;(e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.15)'
                        ;(e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.50)'
                      }
                    }}
                  >
                    {yr}
                  </div>
                )
              })}
            </div>
            {/* Divider */}
            <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '6px 0' }} />
            {/* Crop legend header */}
            <div style={{ padding: '0 10px 6px', color: 'rgba(255,255,255,0.40)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              Crop Types
            </div>
            {/* Crop legend rows */}
            {CDL_LEGEND_ROWS.map(({ code, name, color }) => (
              <div key={code} style={{ display: 'flex', alignItems: 'center', height: 22, padding: '0 10px', gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, backgroundColor: color, border: '1px solid rgba(255,255,255,0.20)' }} />
                <span style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10, fontWeight: 500 }}>{name}</span>
              </div>
            ))}
            <div style={{ height: 4 }} />
          </div>

          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '6px 0' }} />

          {/* ── Terrain (independent) ── */}
          <div style={{ padding: '0 10px 6px', color: 'rgba(255,255,255,0.40)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Terrain
          </div>
          <div
            onClick={() => setTerrain3DOn(v => !v)}
            style={{ display: 'flex', alignItems: 'center', height: 36, padding: '0 12px', cursor: 'pointer', gap: 8 }}
          >
            <span style={{ width: 14, height: 14, borderRadius: 2, flexShrink: 0, backgroundColor: '#60a5fa', border: '1px solid rgba(255,255,255,0.2)' }} />
            <span style={{ flex: 1, color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>3D Terrain</span>
            <span style={{
              width: 28, height: 16, borderRadius: 8, flexShrink: 0,
              background: terrain3DOn ? '#E91E8C' : 'rgba(255,255,255,0.18)',
              position: 'relative', transition: 'background 0.15s',
            }}>
              <span style={{
                position: 'absolute', top: 2, left: terrain3DOn ? 12 : 2, width: 12, height: 12,
                borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
              }} />
            </span>
          </div>
          {terrain3DOn && (
            <div style={{ display: 'flex', alignItems: 'center', height: 32, padding: '0 12px', gap: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 9, flexShrink: 0 }}>Flat</span>
              <input
                type="range"
                min={1.0}
                max={3.0}
                step={0.1}
                value={terrainExaggeration}
                onChange={e => setTerrainExaggeration(Number(e.target.value))}
                style={{ flex: 1, accentColor: '#60a5fa', cursor: 'pointer' }}
              />
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9, flexShrink: 0, minWidth: 28, textAlign: 'right' }}>{terrainExaggeration.toFixed(1)}×</span>
            </div>
          )}

          <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '6px 0' }} />

          {/* ── Tract Status Legend (non-togglable) ── */}
          <div style={{ padding: '0 10px 6px', color: 'rgba(255,255,255,0.40)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>
            Tract Status
          </div>
          {[
            { label: 'Sold',            color: '#f58cde' },
            { label: 'Auction',         color: '#2563eb' },
            { label: 'Listed',          color: '#eab308' },
            { label: "Today's Auctions", color: '#22c55e' },
            { label: 'No Sale',         color: '#9ca3af' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', height: 36, padding: '0 10px', gap: 8 }}>
              <span style={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: color, flexShrink: 0, border: '1.5px solid rgba(255,255,255,0.5)' }} />
              <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>{label}</span>
            </div>
          ))}
        </div>
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
                  { label: 'Listed', value: 'listed' },
                  { label: 'Live', value: 'auction,live,pending' },
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
                            // Apply-atomic model (owner spec, 2026-07-25): draft-only.
                            // No filtersRef write, no cache clear, no camera move —
                            // the map doesn't react until Apply commits this draft
                            // (see applyFilters, which now owns the state-bounds
                            // fitBounds logic that used to fire right here).
                            const current = filters.stateFilter ? filters.stateFilter.split(',') : []
                            const next = isActive ? current.filter(s => s !== st) : [...current, st]
                            const newFilters = { ...filters, stateFilter: next.join(','), countyFilters: [], townshipFilters: [] }
                            setFilters(newFilters)
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
                // Show ALL counties in the state (static canonical list), not just
                // counties that happen to have a GG listing — so the admin can
                // navigate to any county (e.g. to compare against Regrid tiles).
                // Fall back to the data-derived list only if the static list is
                // somehow empty for this state code.
                const stateCounties = getCountiesForState(st)
                const list = stateCounties.length > 0 ? stateCounties : (filterOptions.counties_by_state[st] || [])
                list.forEach(c => countySet.add(c))
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
                              // Draft-only (Apply-atomic model) — see state chip above.
                              const newCounties = isActive
                                ? filters.countyFilters.filter(c => c !== county)
                                : [...filters.countyFilters, county]
                              const newFilters = { ...filters, countyFilters: newCounties, townshipFilters: [] }
                              setFilters(newFilters)
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
                            // Draft-only (Apply-atomic model) — see state chip above.
                            const newTownships = isActive
                              ? filters.townshipFilters.filter(t => t !== twp)
                              : [...filters.townshipFilters, twp]
                            const newFilters = { ...filters, townshipFilters: newTownships }
                            setFilters(newFilters)
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
              // Soil/PI rating filter intentionally hidden until soil data
              // is cleaned up nationwide (many states have unreliable
              // ratings). SOIL_FILTER_ENABLED = false hides the control;
              // the filter state + buildFilterParams plumbing is left
              // intact so re-enabling is a one-line flag flip.
              ...(SOIL_FILTER_ENABLED && filters.stateFilter ? [{
                label: filters.stateFilter === 'IL' ? 'PI Rating' :
                       filters.stateFilter === 'IN' ? 'WAPI' :
                       filters.stateFilter === 'IA' ? 'CSR2' : 'Soil Rating',
                minKey: 'soilRatingMin' as keyof FilterState,
                maxKey: 'soilRatingMax' as keyof FilterState
              }] : []),
              { label: 'Acreage', minKey: 'acreageMin' as keyof FilterState, maxKey: 'acreageMax' as keyof FilterState },
              // % Tillable hidden behind TILLABLE_FILTER_ENABLED (2026-07-27):
              // parcels carry no tillable data, so it blanks the parcel dots
              // and drops the county circles to tract-only counts.
              ...(TILLABLE_FILTER_ENABLED ? [{ label: '% Tillable', minKey: 'pctTillableMin' as keyof FilterState, maxKey: 'pctTillableMax' as keyof FilterState }] : []),
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

            {/* Buildings filter intentionally removed until the
                has_buildings tract data is cleaned up. The hasBuildings
                filter state + buildFilterParams plumbing is left intact
                (defaults to null = no-op) so re-enabling is UI-only. */}
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

      {/* Legend — migrated into the Layer Control Panel above.
          A compact fallback dot-legend is shown when the panel is
          closed AND the pilot overlay is not available, so non-pilot
          users still see the tract status key. */}
      {!layersEnabled && (
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
            { label: 'Sold',            color: '#f58cde' },
            { label: 'Auction',         color: '#2563eb' },
            { label: 'Listed',          color: '#eab308' },
            { label: "Today's Auctions", color: '#22c55e' },
            { label: 'No Sale',         color: '#9ca3af' },
          ].map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{
                width: 10, height: 10, borderRadius: '50%',
                backgroundColor: color, border: '1.5px solid #fff',
                display: 'inline-block',
              }} />
              <span style={{ color: '#fff', fontSize: 11, fontWeight: 500 }}>{label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Sale Detail Modal — styling shared via ComparablesMap.css */}
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
                  <span className="sale-modal-label">
                    Price/Acre
                    {selectedSale.priceBasis && (
                      <span className={`ml-1 text-[9px] font-semibold uppercase px-1 py-0.5 rounded ${selectedSale.priceBasis === 'sold' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600'}`}>
                        {selectedSale.priceBasis === 'sold' ? 'Sold' : 'Asking'}
                      </span>
                    )}
                  </span>
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
                  <span className="sale-modal-label">
                    $/Tillable Acre
                    {selectedSale.priceBasis && (
                      <span className={`ml-1 text-[9px] font-semibold uppercase px-1 py-0.5 rounded ${selectedSale.priceBasis === 'sold' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600'}`}>
                        {selectedSale.priceBasis === 'sold' ? 'Sold' : 'Asking'}
                      </span>
                    )}
                  </span>
                  <span className="sale-modal-value">{formatCurrency((selectedSale.pricePerAcre * selectedSale.totalAcres) / selectedSale.tillableAcres)}/ac</span>
                </div>
              ) : null}
              {selectedSale.soilRating && selectedSale.pricePerAcre ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">
                    $/Soil Rating
                    {selectedSale.priceBasis && (
                      <span className={`ml-1 text-[9px] font-semibold uppercase px-1 py-0.5 rounded ${selectedSale.priceBasis === 'sold' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600'}`}>
                        {selectedSale.priceBasis === 'sold' ? 'Sold' : 'Asking'}
                      </span>
                    )}
                  </span>
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

// Polygon centroid + (unsigned) area in degree². Used to dedupe
// Regrid tile-clipped parcels into one label per parcel: we group
// the clipped pieces by ll_uuid, compute (centroid, area) for each
// piece, then take the area-weighted average of the centroids to
// get the parcel's "true" centroid even when it spans tiles.
// Formula is the standard shoelace-based polygon centroid — handles
// arbitrary convex/concave shapes correctly.
function _polygonCentroidAndArea(geom: any): { centroid: [number, number]; area: number } {
  if (!geom) return { centroid: [0, 0], area: 0 }
  if (geom.type === 'Polygon') {
    const ring = geom.coordinates?.[0]
    if (!ring || ring.length < 4) return { centroid: [0, 0], area: 0 }
    return _ringCentroidAndArea(ring)
  }
  if (geom.type === 'MultiPolygon') {
    let totalA = 0, sx = 0, sy = 0
    for (const poly of geom.coordinates || []) {
      const ring = poly?.[0]
      if (!ring || ring.length < 4) continue
      const { centroid, area } = _ringCentroidAndArea(ring)
      if (area > 0) {
        sx += centroid[0] * area
        sy += centroid[1] * area
        totalA += area
      }
    }
    if (totalA <= 0) return { centroid: [0, 0], area: 0 }
    return { centroid: [sx / totalA, sy / totalA], area: totalA }
  }
  return { centroid: [0, 0], area: 0 }
}

function _ringCentroidAndArea(ring: number[][]): { centroid: [number, number]; area: number } {
  let A = 0, cx = 0, cy = 0
  // Iterate vertex pairs around the ring. Assumes first == last (typical
  // closed GeoJSON); if not, the last-to-first segment is still
  // accounted for by the modulo on the index.
  const n = ring.length - 1
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    A += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  A /= 2
  if (Math.abs(A) < 1e-15) {
    // Degenerate ring — fall back to the first vertex so we at least
    // emit a sensible label position.
    return { centroid: [ring[0][0], ring[0][1]], area: 0 }
  }
  return { centroid: [cx / (6 * A), cy / (6 * A)], area: Math.abs(A) }
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

// Build the optional "Soil & Tillable" section appended to the popup
// when /api/parcel-enrichment/by-uuid returns data (pilot only). The
// section is positioned BELOW the existing detail strips so it adds
// information without rewriting the main popup body. Returns '' when
// no enrichment is available — safe to concat unconditionally.
function _enrichmentPopupSection(enrich: any): string {
  if (!SOIL_FILTER_ENABLED) return ''
  if (!enrich || typeof enrich !== 'object') return ''
  const ratingType = (enrich.soil_rating_type || 'PI').toUpperCase()
  const rating = enrich.soil_rating
  const tillable = enrich.tillable_acres
  const pct = enrich.pct_tillable
  const cover = enrich.dominant_landcover
  const soils: Array<{ mukey?: string; soil?: string; acres?: number; pi?: number }> = Array.isArray(enrich.soils) ? enrich.soils : []
  // Hide entirely when there's nothing to show.
  if (rating == null && tillable == null && !cover && soils.length === 0) return ''

  const headlineRows: string[] = []
  if (rating != null) headlineRows.push(_detailRow(`Soil Rating (${ratingType})`, String(rating)))
  if (tillable != null) headlineRows.push(_detailRow(
    'Tillable Acres',
    `${Number(tillable).toFixed(1)} ac${pct != null ? ` (${Number(pct).toFixed(0)}%)` : ''}`,
  ))
  if (cover) headlineRows.push(_detailRow('Land Cover', String(cover).replace(/(^|[\s-])\S/g, m => m.toUpperCase())))

  // Per-soil breakdown — show up to 5 patches sorted by acres desc.
  // Already pre-sorted server-side; cap here defensively.
  const soilRows = soils.slice(0, 5).map(s => {
    const name = s.soil ? String(s.soil) : (s.mukey ? `Mukey ${s.mukey}` : 'Soil')
    const ac = (typeof s.acres === 'number') ? `${formatAcres(s.acres)} ac` : ''
    const pi = (typeof s.pi === 'number') ? `${ratingType} ${s.pi}` : ''
    const suffix = [ac, pi].filter(Boolean).join(' · ')
    return _detailRow(name, suffix)
  })

  return (
    _section(`Soil & Tillable (${ratingType})`, headlineRows) +
    (soilRows.length ? _section('Soils — by acreage', soilRows) : '') +
    `<div style="height:8px;"></div>`
  )
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
// Recorded-deed sale dates render as plain MM/DD/YYYY (per spec) — a
// county-recorder date, not the "Jul 13, 2026" style FMT_DATE_COMP uses
// for the tract's own auction date. Parsed as a plain YYYY-MM-DD string
// (no `new Date()`/timezone conversion — these are date-only Regrid
// values, not timestamps).
const FMT_DEED_DATE_COMP = (iso: string | null | undefined) => {
  if (!iso) return null
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [, y, mo, d] = m
  return `${mo}/${d}/${y}`
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

      {/* Recorded Deeds — comp-map coincident-dot collapse (see
          recomputeCoincidentDeeds above). A Regrid parcel sale-dot whose
          centroid sits inside THIS tract's polygon is hidden from the
          map and its deed folded in here instead — a tract can have
          multiple underlying deeds, so every one renders as its own row.
          Amber "County Record" styling (never pink) keeps this
          county-recorder $/acre from ever being read as the tract's own
          auction sold price/acre in the hero stats above. acres/$-acre/
          date render instantly from the durable-dot payload; only OWNER
          waits on the Regrid tile at the dot's point being loaded
          (skeleton pulse until recomputeCoincidentDeeds finds it —
          never blocks the rest of the row). */}
      {sale.deeds && sale.deeds.length > 0 && (
        <div style={{
          padding: '0 16px 14px',
          maxHeight: 150,
          overflowY: 'auto',
        }}>
          <div style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8,
            textTransform: 'uppercase', color: '#B45309',
            marginBottom: 6,
          }}>
            Recorded deed{sale.deeds.length > 1 ? 's' : ''} on this parcel
          </div>
          {sale.deeds.map((deed) => {
            const ppa = deed.saleprice && deed.acres ? Math.round(deed.saleprice / deed.acres) : null
            const dateStr = FMT_DEED_DATE_COMP(deed.saledate)
            return (
              <div
                key={deed.ll_uuid}
                style={{
                  background: '#FFFBEB',
                  border: '1px solid #FDE68A',
                  borderRadius: 8,
                  padding: '7px 9px',
                  marginBottom: 6,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  {deed.owner ? (
                    <span style={{
                      fontSize: 12, fontWeight: 700, color: '#1a1a1a',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{deed.owner}</span>
                  ) : deed.ownerLoading ? (
                    <span style={{
                      display: 'inline-block', width: 90, height: 11, borderRadius: 4,
                      background: '#FDE68A', opacity: 0.7,
                    }} />
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#999' }}>Owner unknown</span>
                  )}
                  <span style={{
                    flexShrink: 0, fontSize: 8, fontWeight: 700, letterSpacing: 0.6,
                    textTransform: 'uppercase', color: '#B45309',
                    border: '1px solid #FCD34D', borderRadius: 999, padding: '2px 6px',
                  }}>
                    County record
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 3, fontSize: 11, color: '#78716C' }}>
                  {deed.acres != null && <span>{FMT_NUM_COMP(deed.acres)} ac</span>}
                  {ppa != null && <span style={{ color: '#B45309', fontWeight: 600 }}>{FMT_USD_COMP(ppa)}/ac <span style={{ color: '#a8a29e', fontWeight: 400 }}>(recorded)</span></span>}
                  {dateStr && <span>{dateStr}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Action row — Add to Report is the primary CTA (filled pink).
          3D and Details are subtle secondary buttons, each shown ONLY
          when it has something to open (owner report 2026-07-28: on a
          parcel they rendered but did nothing).

          A comparable is either one of OUR TRACTS (from a listing) or a
          raw Regrid PARCEL. buildParcelSale / buildDurableSale both set
          `tractId: null` and `listingId: null`, so on a parcel:
            - onView3D early-returns (it needs sale.tractId)
            - onViewDetails has no listingId and, for a parcel, no
              sourceUrl either — so it early-returns too
          Gating on the exact fields each handler requires means the
          buttons can never again appear without working. Add to Report
          stays visible for both kinds — a parcel IS a valid comparable. */}
      <div style={{
        display: 'flex',
        gap: 8,
        padding: '10px 12px 12px',
        borderTop: '1px solid rgba(0,0,0,0.06)',
        background: '#fff',
      }}>
        {sale.tractId ? (
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
        ) : null}
        {(sale.listingId || sale.sourceUrl) ? (
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
        ) : null}
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
