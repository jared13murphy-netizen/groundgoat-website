'use client'

/**
 * AdminExploreMap — three-tier zoom replacement for ExploreMap.
 *
 * Lives at the bottom of /admin/dashboard so we can iterate without
 * touching the customer-facing map. Will replace ExploreMap once
 * approved.
 *
 * Tiers:
 *   z <= STATE_TIER_MAX (6)    → state silhouettes (filled state polygons
 *                                from us-states.json) + small goat-icon
 *                                count overlay + "Start Filtering" link
 *   z 6–10  (county tier)      → rounded county squares with name + count
 *   z >= 9 (TRACT_TIER_MIN)    → individual price-bubble tract pins
 *   z >= 13                    → WI parcel overlay (admin-only, pmtiles)
 *
 * Counts at the state and county tiers come from the new
 * /api/map/state-tract-counts and /api/map/county-tract-counts
 * aggregation endpoints (filter-aware). Tract pins are loaded by the
 * existing /api/map/tracts bbox endpoint.
 */

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol as PMTilesProtocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ComparablesMap.css'
import './TractMap.css'
import type { ApiMapTract, MapTractsResponse } from './exploreMapTypes'
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  GLYPH_URL,
  STATE_BOUNDS,
  STATE_NAMES,
} from './mapConstants'
import fetchWithAuth from '@/lib/fetchWithAuth'
import MapChatPanel from '@/components/portal/MapChatPanel'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const STATE_TIER_MAX = 6
const COUNTY_TIER_MIN = 6
const COUNTY_TIER_MAX = 9   // lowered from 10 — county-click zoom of 9.5
                             // now lands in tract tier (z > 9)
const TRACT_TIER_MIN = 9
const POLYGON_TIER_MIN = 13
const PARCEL_TIER_MIN = 13

const PIN_COLORS: Record<string, string> = {
  sold: '#f58cde',
  auction: '#2563eb',
  listed: '#eab308',
  active: '#eab308',
  live: '#22c55e',
  pending: '#eab308',
  no_sale: '#9ca3af',
}
function pinColor(s: string | null) { return s ? (PIN_COLORS[s.toLowerCase()] || '#eab308') : '#eab308' }
function fmt$(n: number | null | undefined) { return n ? '$' + Math.round(n).toLocaleString('en-US') : '—' }
function fmtAc(n: number | null | undefined) {
  return n ? n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'
}

// FilterState shape mirrors ExploreMap so we can drop it into the same
// MapChatPanel without translation. Phase 2 will extract this into a
// shared types module.
interface FilterState {
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
  listingType: string
  pricePerAcreMin: string
  pricePerAcreMax: string
  salePriceMin: string
  salePriceMax: string
  askingPriceMin: string
  askingPriceMax: string
  companyName: string
  buyer: string
  seller: string
  hasHouse: boolean | null
  hasBuildings: boolean | null
  hasPolygon: boolean | null
  keyword: string
}
const INITIAL_FILTERS: FilterState = {
  dateRange: 'all', dateFrom: '', dateTo: '',
  stateFilter: '', countyFilters: [], townshipFilters: [],
  soilRatingMin: '', soilRatingMax: '',
  acreageMin: '', acreageMax: '', pctTillableMin: '', pctTillableMax: '',
  statuses: [], landTypes: [],
  listingType: '',
  pricePerAcreMin: '', pricePerAcreMax: '',
  salePriceMin: '', salePriceMax: '',
  askingPriceMin: '', askingPriceMax: '',
  companyName: '', buyer: '', seller: '',
  hasHouse: null, hasBuildings: null, hasPolygon: null,
  keyword: '',
}

// Full-name → 2-letter abbr lookup for ALL US states. Used to match
// /data/us-states.json features (keyed by `properties.NAME`) to the
// state-counts API rows (keyed by 2-letter abbr). The mapConstants
// STATE_NAMES export only has 12 Midwest states — without this, every
// other state would fall back to a rectangle silhouette.
// Used to display the state name under the goat icon on each badge.
// Built once from the full lookup below.
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

// Tier classification.
function currentZoomTier(z: number): 'state' | 'county' | 'tract' {
  if (z <= STATE_TIER_MAX) return 'state'
  if (z <= COUNTY_TIER_MAX) return 'county'
  return 'tract'
}

// Bbox center of a state Feature (Polygon or MultiPolygon). Returns
// [lng, lat] or null. Used as the marker centroid when STATE_BOUNDS
// doesn't have the state (mapConstants only covers 26 states).
function featureBboxCenter(feature: any): [number, number] | null {
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
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
}


// Convert a state GeoJSON Feature (Polygon or MultiPolygon) into an
// SVG `d` path string normalized to a 100×100 viewBox so it renders
// the same size regardless of the state's actual geographic extent.
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
  const scale = 100 / Math.max(w, h)
  const offsetX = (100 - w * scale) / 2
  const offsetY = (100 - h * scale) / 2
  const parts: string[] = []
  for (const ring of rings) {
    if (ring.length < 3) continue
    const cmds: string[] = []
    for (let i = 0; i < ring.length; i++) {
      const [lng, lat] = ring[i]
      const x = (lng - minLng) * scale + offsetX
      const y = (maxLat - lat) * scale + offsetY  // SVG y grows down
      cmds.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    cmds.push('Z')
    parts.push(cmds.join(' '))
  }
  return parts.join(' ')
}


// Fade-out then remove a batch of markers. Adds the .aem-leaving
// class to the INNER badge element (not the maplibre shell, which
// holds the translate transform that positions the marker on the
// map — adding a transform animation to the shell would clobber
// maplibre's positioning and the markers would all stack at the
// map's origin). 380ms later we call .remove().
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


function buildFilterParams(f: FilterState) {
  const p: Record<string, string> = {}
  if (f.dateRange === 'custom') {
    if (f.dateFrom) p.date_from = f.dateFrom
    if (f.dateTo) p.date_to = f.dateTo
  } else if (f.dateRange === 'upcoming') {
    p.date_from = new Date().toISOString().slice(0, 10)
  } else if (f.dateRange !== 'all') {
    const months = f.dateRange === '1month' ? 1
      : f.dateRange === '6months' ? 6
      : f.dateRange === '1year' ? 12
      : f.dateRange === '18months' ? 18
      : f.dateRange === '2years' ? 24 : 0
    if (months > 0) {
      const d = new Date()
      d.setMonth(d.getMonth() - months)
      p.date_from = d.toISOString().slice(0, 10)
    }
  }
  if (f.statuses.length > 0) p.sale_status = f.statuses.flatMap(s => s.split(',')).join(',')
  if (f.stateFilter) p.state_abbr = f.stateFilter
  if (f.countyFilters.length > 0) p.county_name = f.countyFilters.join(',')
  if (f.townshipFilters.length > 0) p.township = f.townshipFilters.join(',')
  if (f.soilRatingMin) p.soil_rating_min = f.soilRatingMin
  if (f.soilRatingMax) p.soil_rating_max = f.soilRatingMax
  if (f.acreageMin) p.acreage_min = f.acreageMin
  if (f.acreageMax) p.acreage_max = f.acreageMax
  if (f.pctTillableMin) p.pct_tillable_min = f.pctTillableMin
  if (f.pctTillableMax) p.pct_tillable_max = f.pctTillableMax
  if (f.landTypes.length > 0) p.land_types = f.landTypes.join(',')
  if (f.listingType) p.listing_type = f.listingType
  if (f.pricePerAcreMin) p.price_per_acre_min = f.pricePerAcreMin
  if (f.pricePerAcreMax) p.price_per_acre_max = f.pricePerAcreMax
  if (f.salePriceMin) p.sale_price_min = f.salePriceMin
  if (f.salePriceMax) p.sale_price_max = f.salePriceMax
  if (f.askingPriceMin) p.asking_price_min = f.askingPriceMin
  if (f.askingPriceMax) p.asking_price_max = f.askingPriceMax
  if (f.companyName) p.company_name = f.companyName
  if (f.buyer) p.buyer = f.buyer
  if (f.seller) p.seller = f.seller
  if (f.keyword) p.keyword = f.keyword
  return p
}

interface AdminExploreMapProps {
  height?: string
  isAdmin?: boolean
}

export default function AdminExploreMap({ height = '700px', isAdmin = true }: AdminExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(4)

  const [stateCounts, setStateCounts] = useState<Array<{ state: string; count: number }>>([])
  const [countyCounts, setCountyCounts] = useState<
    Array<{ state: string; county: string; count: number; lat: number; lng: number }>
  >([])
  const tractMapRef = useRef<Map<string, ApiMapTract>>(new Map())
  const [tractRefresh, setTractRefresh] = useState(0)

  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
  const filtersRef = useRef(filters)
  useEffect(() => { filtersRef.current = filters }, [filters])
  const [filterOpen, setFilterOpen] = useState(false)

  const [filterOptions, setFilterOptions] = useState<{
    states: string[]
    counties_by_state: Record<string, string[]>
    townships_by_county: Record<string, string[]>
  }>({ states: [], counties_by_state: {}, townships_by_county: {} })

  // Refs for DOM markers per tier
  const stateMarkersRef = useRef<maplibregl.Marker[]>([])
  const countyMarkersRef = useRef<maplibregl.Marker[]>([])
  const tractMarkersRef = useRef<maplibregl.Marker[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filterParamString = useMemo(() => {
    return new URLSearchParams(buildFilterParams(filters)).toString()
  }, [filters])

  // Public filter-options API (states/counties/townships catalog)
  useEffect(() => {
    fetch(`${API_URL}/api/map/filter-options`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setFilterOptions(data) })
      .catch(() => {})
  }, [])

  // Silhouette SVG paths + centroid lookup, both indexed by state
  // abbr. Loaded once on mount from /data/us-states.json. Keyed by
  // feature.NAME (full state name) translated to abbr via the
  // 50-state lookup defined above.
  const [stateSilhouettes, setStateSilhouettes] = useState<Record<string, string>>({})
  const [stateCentroids, setStateCentroids] = useState<Record<string, [number, number]>>({})

  useEffect(() => {
    let cancelled = false
    fetch('/data/us-states.json')
      .then(r => r.ok ? r.json() : null)
      .then((geo: any) => {
        if (cancelled || !geo?.features) return
        // Use the full 50-state lookup (NOT mapConstants STATE_NAMES,
        // which only has 12 Midwest states).
        const paths: Record<string, string> = {}
        const centroids: Record<string, [number, number]> = {}
        for (const feat of geo.features) {
          const abbr = ALL_STATE_NAME_TO_ABBR[feat?.properties?.NAME]
          if (!abbr) continue
          const path = featureToSvgPath(feat)
          if (path) paths[abbr] = path
          // Compute centroid from polygon bbox — accurate enough for
          // marker placement and works for ALL 50 states (mapConstants
          // STATE_BOUNDS only has 26).
          const c = featureBboxCenter(feat)
          if (c) centroids[abbr] = c
        }
        setStateSilhouettes(paths)
        setStateCentroids(centroids)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // ─────────────────────────────────────────────────────────────
  // Init map + state-silhouette + WI parcel layers
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION },
        },
        layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
        glyphs: GLYPH_URL,
      },
      center: [-92, 41],
      zoom: 4,
      maxZoom: 18,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      // No map-level state silhouette layers — the silhouette is the
      // BADGE itself (rendered as inline SVG inside the marker DOM).
      // See the state-badge useEffect below.

      // Tract polygon source + layers — pink fill outline of every
      // tract that has polygon_coordinates. Visible at TRACT_TIER_MIN
      // and up so the user sees boundaries the moment they cross
      // into the tract tier. Source data is updated by the
      // pushTractPolygonsToSource effect below whenever tract data
      // changes.
      map.addSource('tract-polygons', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'tract-polygons-fill',
        type: 'fill',
        source: 'tract-polygons',
        minzoom: TRACT_TIER_MIN,
        paint: {
          'fill-color': '#f58cde',
          'fill-opacity': 0.18,
        },
      })
      map.addLayer({
        id: 'tract-polygons-line',
        type: 'line',
        source: 'tract-polygons',
        minzoom: TRACT_TIER_MIN,
        paint: {
          'line-color': '#f58cde',
          'line-width': 2,
          'line-opacity': 0.9,
        },
      })

      // WI parcel overlay (admin-only, vector tiles via pmtiles, z 13+)
      if (isAdmin) {
        const w = window as any
        if (!w.__ggPmtilesRegistered) {
          maplibregl.addProtocol('pmtiles', new PMTilesProtocol().tile as any)
          w.__ggPmtilesRegistered = true
        }
        try {
          const TILES_BASE_URL =
            process.env.NEXT_PUBLIC_PMTILES_BASE_URL ||
            'https://ground-goat-tiles-production.up.railway.app'
          map.addSource('admin-parcels-WI', {
            type: 'vector', url: `pmtiles://${TILES_BASE_URL}/wi.pmtiles`,
          })
          map.addLayer({
            id: 'admin-parcels-WI-fill', type: 'fill',
            source: 'admin-parcels-WI', 'source-layer': 'parcels',
            minzoom: PARCEL_TIER_MIN,
            paint: { 'fill-color': '#888', 'fill-opacity': 0.05 },
          })
          map.addLayer({
            id: 'admin-parcels-WI-line', type: 'line',
            source: 'admin-parcels-WI', 'source-layer': 'parcels',
            minzoom: PARCEL_TIER_MIN,
            paint: { 'line-color': '#fff', 'line-width': 0.5, 'line-opacity': 0.5 },
          })
        } catch (e) {
          console.warn('[AdminExploreMap] pmtiles add failed', e)
        }
      }

      mapRef.current = map
      setMapLoaded(true)
      setCurrentZoom(map.getZoom())
    })
    map.on('zoom', () => setCurrentZoom(map.getZoom()))
    map.on('moveend', () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        if (!mapRef.current) return
        if (mapRef.current.getZoom() < TRACT_TIER_MIN) return
        loadTractsForViewport()
      }, 250)
    })

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      stateMarkersRef.current.forEach(m => m.remove())
      countyMarkersRef.current.forEach(m => m.remove())
      tractMarkersRef.current.forEach(m => m.remove())
      stateMarkersRef.current = []
      countyMarkersRef.current = []
      tractMarkersRef.current = []
      try { map.remove() } catch {}
      mapRef.current = null
      setMapLoaded(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin])

  // (state silhouettes now live inside each badge marker as inline SVG;
  // see stateSilhouetteSvg below)

  // ─────────────────────────────────────────────────────────────
  // Aggregation fetches
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancel = false
    fetchWithAuth(`${API_URL}/api/map/state-tract-counts?${filterParamString}`)
      .then(r => r.ok ? r.json() : { states: [] })
      .then(d => { if (!cancel) setStateCounts(d.states || []) })
      .catch(() => {})
    return () => { cancel = true }
  }, [filterParamString])

  useEffect(() => {
    let cancel = false
    const stateScope = filters.stateFilter ? `state=${filters.stateFilter}&` : ''
    fetchWithAuth(`${API_URL}/api/map/county-tract-counts?${stateScope}${filterParamString}`)
      .then(r => r.ok ? r.json() : { counties: [] })
      .then(d => { if (!cancel) setCountyCounts(d.counties || []) })
      .catch(() => {})
    return () => { cancel = true }
  }, [filterParamString, filters.stateFilter])


  // ─────────────────────────────────────────────────────────────
  // Tract loader (high zoom only)
  // ─────────────────────────────────────────────────────────────
  const loadTractsForViewport = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    const z = map.getZoom()
    if (z < TRACT_TIER_MIN) return
    const b = map.getBounds()
    // Always include polygons in the tract tier — boundaries are
    // expected to be visible the moment tract pins appear, not held
    // back until z 13. Payload is fine since the bbox is small at
    // this zoom and the API caps at 2000 rows.
    const includePolygons = z >= TRACT_TIER_MIN
    const url = `${API_URL}/api/map/tracts?` +
      `min_lat=${b.getSouth()}&max_lat=${b.getNorth()}` +
      `&min_lng=${b.getWest()}&max_lng=${b.getEast()}` +
      `&limit=2000&include_polygons=${includePolygons}` +
      (filterParamString ? `&${filterParamString}` : '')
    try {
      const r = await fetchWithAuth(url)
      if (!r.ok) return
      const data: MapTractsResponse = await r.json()
      if (!data.tracts) return
      const next = new Map<string, ApiMapTract>()
      for (const t of data.tracts) next.set(t.id, t)
      tractMapRef.current = next
      setTractRefresh(x => x + 1)
    } catch {}
  }, [filterParamString])

  useEffect(() => {
    if (!mapLoaded) return
    const map = mapRef.current
    if (!map) return
    if (map.getZoom() >= TRACT_TIER_MIN) loadTractsForViewport()
  }, [filterParamString, mapLoaded, loadTractsForViewport])

  // ─────────────────────────────────────────────────────────────
  // Tier gating. Hard rule: at any zoom, ONLY ONE tier's markers
  // exist in the DOM. No overlap possible.
  //
  //   z <= STATE_TIER_MAX        → state badges only
  //   STATE_TIER_MAX < z <= COUNTY_TIER_MAX → county squares only
  //   z > COUNTY_TIER_MAX        → tract pins only
  //
  // Each tier effect rebuilds when the relevant data OR the
  // current tier changes. Fade-in is a one-shot CSS keyframe on
  // marker mount; fade-out is just removal.
  // ─────────────────────────────────────────────────────────────
  const currentTier = currentZoomTier(currentZoom)

  // STATE BADGES
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Always tear down first — guarantees no leftovers from a prior tier.
    fadeOutAndRemove(stateMarkersRef.current)
    stateMarkersRef.current = []
    if (currentTier !== 'state') return

    for (const { state, count } of stateCounts) {
      if (count === 0) continue
      // Prefer the 50-state centroid we computed from us-states.json;
      // fall back to mapConstants STATE_BOUNDS (26 states) for safety.
      let lng: number | undefined
      let lat: number | undefined
      const c = stateCentroids[state]
      if (c) {
        lng = c[0]
        lat = c[1]
      } else {
        const bounds = STATE_BOUNDS[state]
        if (!bounds) continue
        lng = (bounds[0][0] + bounds[1][0]) / 2
        lat = (bounds[0][1] + bounds[1][1]) / 2
      }

      const silhouettePath = stateSilhouettes[state]

      // OUTER shell — maplibre sets transform: translate(x, y) on this
      // to position the marker. NO css animations / transforms here
      // (they'd clobber maplibre's positioning).
      const el = document.createElement('div')
      el.className = 'aem-marker-shell'

      // INNER badge — animations + sizing live here. CSS keyframes
      // can use transform: scale/blur/etc. without affecting where
      // the marker sits on the map.
      const inner = document.createElement('div')
      inner.className = 'aem-state-badge'
      inner.innerHTML = `
        <svg class="aem-state-shape" viewBox="0 0 100 100"
             preserveAspectRatio="xMidYMid meet">
          ${silhouettePath ? `
            <path d="${silhouettePath}"
                  fill="rgba(10,10,12,0.62)"
                  stroke="none" />
          ` : '<rect x="2" y="2" width="96" height="96" rx="6" fill="rgba(10,10,12,0.62)"/>'}
        </svg>
        <div class="aem-state-overlay">
          <img src="/goat-icon-white.png" alt="" class="aem-state-goat" />
          <div class="aem-state-name">${abbrToName(state)}</div>
          <div class="aem-state-count">${count.toLocaleString()}</div>
          <a class="aem-state-link" data-action="filter">Start Filtering →</a>
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
        // easeTo with explicit zoom (NOT fitBounds) so the final zoom
        // ALWAYS lands past STATE_TIER_MAX (6). fitBounds + maxZoom for
        // small states like Iowa settles at z 5.5–6, which is still
        // state tier — the user clicks but state badges stay visible.
        // zoom: 7 guarantees we cross into county tier so badges fade
        // out and county squares fade in.
        map.easeTo({ center: [lng!, lat!], zoom: 7, duration: 900 })
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map)
      stateMarkersRef.current.push(marker)
    }
    // Cleanup runs when tier or data changes — fade out, then remove.
    return () => {
      fadeOutAndRemove(stateMarkersRef.current)
      stateMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCounts, mapLoaded, currentTier, stateSilhouettes])

  // COUNTY SQUARES — only built when in county tier.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    fadeOutAndRemove(countyMarkersRef.current)
    countyMarkersRef.current = []
    if (currentTier !== 'county') return

    for (const c of countyCounts) {
      if (!c.count || c.lat == null || c.lng == null) continue
      // Shell + inner pattern (see state badges above for why).
      const el = document.createElement('div')
      el.className = 'aem-marker-shell'
      const inner = document.createElement('div')
      inner.className = 'aem-county-square'
      inner.innerHTML = `
        <div class="aem-county-name">${c.county}</div>
        <div class="aem-county-count">${c.count.toLocaleString()}</div>
      `
      el.appendChild(inner)
      el.addEventListener('click', () => {
        // zoom 10 lands past COUNTY_TIER_MAX (9) so the county
        // square fades out and tract pins + polygons fade in. Tight
        // enough that individual tracts are readable; loose enough
        // that neighboring counties stay visible.
        map.easeTo({ center: [c.lng, c.lat], zoom: 10, duration: 800 })
      })
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([c.lng, c.lat])
        .addTo(map)
      countyMarkersRef.current.push(marker)
    }
    return () => {
      fadeOutAndRemove(countyMarkersRef.current)
      countyMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countyCounts, mapLoaded, currentTier])

  // TRACT PINS — only built when in tract tier.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    fadeOutAndRemove(tractMarkersRef.current)
    tractMarkersRef.current = []
    if (currentTier !== 'tract') return

    for (const t of Array.from(tractMapRef.current.values())) {
      if (!t.latitude || !t.longitude) continue
      const isPT = (t.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = (t.sale_status || '').toLowerCase() === 'pending'
      const ppa = (isPT || isPending) && t.asking_price && t.total_acres
        ? t.asking_price / t.total_acres
        : t.price_per_acre

      // Shell + inner pattern: outer is maplibre-positioned, inner has
      // the comp-marker visual + animation class. Without this the
      // fade-in keyframe's scale transform clobbers maplibre's
      // translate and the pin lands at the map origin.
      const el = document.createElement('div')
      el.className = 'aem-marker-shell'
      const inner = document.createElement('div')
      inner.className = 'comp-marker aem-tract-pin'
      const label = document.createElement('div')
      label.className = 'comp-marker-label'
      if (ppa) {
        const p = document.createElement('div')
        p.className = 'comp-marker-price'
        p.textContent = `${fmt$(ppa)}/ac`
        label.appendChild(p)
      }
      if (t.total_acres) {
        const a = document.createElement('div')
        a.className = 'comp-marker-acres'
        a.textContent = `${fmtAc(t.total_acres)} ac`
        label.appendChild(a)
      }
      inner.appendChild(label)
      const pin = document.createElement('div')
      pin.className = 'comp-marker-pin comparable'
      pin.style.backgroundColor = pinColor(t.sale_status)
      inner.appendChild(pin)
      el.appendChild(inner)
      el.addEventListener('click', () => {
        if (t.listing_id) window.open(`/listings/${t.listing_id}`, '_blank')
      })
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([t.longitude, t.latitude])
        .addTo(map)
      tractMarkersRef.current.push(marker)
    }
    return () => {
      fadeOutAndRemove(tractMarkersRef.current)
      tractMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tractRefresh, mapLoaded, currentTier])

  // ─────────────────────────────────────────────────────────────
  // TRACT POLYGONS — push the current tract data into the
  // tract-polygons GeoJSON source. The fill+line layers (added in
  // map.on('load')) are gated to TRACT_TIER_MIN, so they only
  // render once the user is zoomed in enough.
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const src = map.getSource('tract-polygons') as
      | maplibregl.GeoJSONSource
      | undefined
    if (!src) return
    const features: GeoJSON.Feature[] = []
    for (const t of Array.from(tractMapRef.current.values())) {
      const ring = t.polygon_coordinates
      if (!ring || ring.length < 3) continue
      // GeoJSON requires the ring to be closed (first vertex == last).
      const closed = ring[0][0] === ring[ring.length - 1][0]
        && ring[0][1] === ring[ring.length - 1][1]
        ? ring : [...ring, ring[0]]
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [closed] },
        properties: { id: t.id, status: t.sale_status },
      })
    }
    src.setData({ type: 'FeatureCollection', features })
  }, [tractRefresh, mapLoaded])

  // Apply chat-driven filter args from MapChatPanel
  const handleApplyChatFilters = useCallback(
    (incoming: Record<string, any>, clearUnspecified: boolean) => {
      setFilters(prev => {
        const base = clearUnspecified ? INITIAL_FILTERS : prev
        return { ...base, ...incoming } as FilterState
      })
      setFilterOpen(true)
    }, []
  )

  // ─────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────
  const totalCount = stateCounts.reduce((acc, s) => acc + s.count, 0)
  const tier =
    currentZoom <= STATE_TIER_MAX ? 'States'
      : currentZoom <= COUNTY_TIER_MAX ? 'Counties'
      : currentZoom < POLYGON_TIER_MIN ? 'Tracts'
      : 'Tracts + parcels'

  return (
    <div className="relative" style={{ height }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: 12 }} />

      {/* Tier indicator (top-left) */}
      <div className="absolute top-3 left-3 bg-gg-black/85 text-white text-xs px-3 py-1.5 rounded-md backdrop-blur z-10 pointer-events-none">
        <span className="text-gg-pink font-semibold">{tier}</span>
        <span className="text-gg-gray-400 mx-2">·</span>
        <span>z {currentZoom.toFixed(1)}</span>
        <span className="text-gg-gray-400 mx-2">·</span>
        <span>{totalCount.toLocaleString()} tracts</span>
      </div>

      {/* Filter panel — copied from ExploreMap so the look is identical */}
      {filterOpen && (
        <FilterPanel
          filters={filters}
          setFilters={setFilters}
          filterOptions={filterOptions}
          onClose={() => setFilterOpen(false)}
          onApply={() => {
            // Re-fetch tracts at high zoom; aggregations update via the
            // filterParamString memo automatically.
            if (mapRef.current && mapRef.current.getZoom() >= TRACT_TIER_MIN) {
              loadTractsForViewport()
            }
            setFilterOpen(false)
          }}
          onReset={() => {
            setFilters(INITIAL_FILTERS)
            setFilterOpen(false)
          }}
        />
      )}

      {/* Goat Search */}
      <div className="absolute bottom-3 right-3 z-10">
        <MapChatPanel
          onApplyFilters={handleApplyChatFilters}
          currentFilters={filters as any}
          hasActiveFilters={
            !!(filters.stateFilter || filters.statuses.length || filters.listingType)
          }
        />
      </div>

      <style jsx global>{`
        /* One-shot fade-in animation when a marker mounts. No
           Fade-in on mount, fade-out on tier-leave. The .aem-leaving
           class is added by fadeOutAndRemove() in the cleanup just
           before .remove() is called via setTimeout. So when the user
           clicks a state badge: state markers get .aem-leaving (fade
           out 380ms while scaling up + blurring), county markers
           mount with the fade-in keyframe (fade in + scale up). The
           two run simultaneously → buttery cross-fade. */
        @keyframes aem-fade-in {
          from {
            opacity: 0;
            transform: scale(0.7);
            filter: blur(6px);
          }
          to {
            opacity: 1;
            transform: scale(1);
            filter: blur(0);
          }
        }
        @keyframes aem-fade-out {
          from {
            opacity: 1;
            transform: scale(1);
            filter: blur(0);
          }
          to {
            opacity: 0;
            transform: scale(1.18);
            filter: blur(8px);
          }
        }
        /* Outer shell — maplibre sets transform: translate() on this
           to position the marker. NO transforms or animations here
           or maplibre's positioning gets clobbered. */
        .aem-marker-shell {
          will-change: transform;
        }
        /* Inner badges get the fade-in / fade-out keyframes. */
        .aem-state-badge,
        .aem-county-square,
        .aem-tract-pin {
          animation: aem-fade-in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }
        .aem-leaving {
          animation: aem-fade-out 0.38s cubic-bezier(0.4, 0, 0.2, 1) forwards !important;
          pointer-events: none !important;
        }

        /* ── State badge: SVG silhouette as background, goat + count
              + Start Filtering centered on top.
              Container is 70×70; the SVG fills the container; the
              .aem-state-overlay is absolutely positioned and centered
              over the silhouette. */
        .aem-state-badge {
          position: relative;
          width: 100px;
          height: 100px;
          cursor: pointer;
          user-select: none;
          filter: drop-shadow(0 4px 14px rgba(245, 140, 222, 0.4));
        }
        .aem-state-shape {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          pointer-events: none;
          overflow: visible;
        }
        .aem-state-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1px;
        }
        .aem-state-badge:hover .aem-state-link {
          background: #f58cde;
          color: #fff;
        }
        .aem-state-goat {
          width: 30px;
          height: 30px;
          object-fit: contain;
          filter: drop-shadow(0 1px 5px rgba(245, 140, 222, 0.9));
        }
        .aem-state-name {
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-weight: 600;
          font-size: 9px;
          color: rgba(255, 255, 255, 0.85);
          line-height: 1;
          margin-top: 2px;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          text-shadow: 0 1px 3px rgba(0, 0, 0, 0.95);
          white-space: nowrap;
        }
        .aem-state-count {
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-weight: 800;
          font-size: 14px;
          color: #fff;
          line-height: 1;
          margin-top: 2px;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.95);
        }
        .aem-state-link {
          font-size: 9px;
          color: #f58cde;
          margin-top: 3px;
          font-weight: 700;
          letter-spacing: 0.03em;
          cursor: pointer;
          text-decoration: none;
          padding: 2px 5px;
          border-radius: 4px;
          background: rgba(0, 0, 0, 0.72);
          transition: background 0.15s ease, color 0.15s ease;
          white-space: nowrap;
        }
        .aem-state-link:hover {
          color: #fff;
          background: #f58cde;
        }

        /* ── County squares: smaller than v1 ─────────────────── */
        .aem-county-square {
          background: rgba(15, 15, 18, 0.86);
          border: 1.5px solid #f58cde;
          border-radius: 8px;
          padding: 3px 7px;
          cursor: pointer;
          backdrop-filter: blur(4px);
          box-shadow: 0 4px 14px rgba(245, 140, 222, 0.22);
          min-width: 50px;
          text-align: center;
          user-select: none;
        }
        .aem-county-square:hover {
          box-shadow: 0 8px 22px rgba(245, 140, 222, 0.45);
        }
        .aem-county-name {
          font-size: 10px;
          font-weight: 700;
          color: #fff;
          line-height: 1.05;
        }
        .aem-county-count {
          font-size: 9px;
          color: #f58cde;
          margin-top: 1px;
          font-weight: 600;
        }
      `}</style>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────
// FilterPanel — pixel-faithful copy of ExploreMap's filter slide-out.
// Self-contained (doesn't reach into ExploreMap-specific refs); driven
// by props. TODO Phase 2: extract into shared component used by both.
// ───────────────────────────────────────────────────────────────
function FilterPanel({
  filters, setFilters, filterOptions, onClose, onApply, onReset,
}: {
  filters: FilterState
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>
  filterOptions: { states: string[]; counties_by_state: Record<string, string[]>; townships_by_county: Record<string, string[]> }
  onClose: () => void
  onApply: () => void
  onReset: () => void
}) {
  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width: 320, height: '100%',
      backgroundColor: '#111', zIndex: 100, overflowY: 'auto',
      boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}>
        <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>Filters</span>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 22, cursor: 'pointer' }}>
          ✕
        </button>
      </div>

      <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
        {/* Status */}
        <div style={{ marginBottom: 24 }}>
          <SectionLabel>Status</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
            {[
              { label: 'Listed', value: 'active' },
              { label: 'Live', value: 'live,pending' },
              { label: 'Sold', value: 'sold' },
            ].map(opt => {
              const isActive = filters.statuses.includes(opt.value)
              return (
                <button key={opt.value}
                  onClick={() => setFilters(f => ({
                    ...f,
                    statuses: isActive ? f.statuses.filter(s => s !== opt.value) : [...f.statuses, opt.value],
                  }))}
                  style={pillStyle(isActive)}>
                  {opt.label}
                </button>
              )
            })}
          </div>

          <SectionLabel>Date Range</SectionLabel>
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
            <div key={opt.value}
              onClick={() => setFilters(f => ({
                ...f, dateRange: opt.value,
                dateFrom: opt.value === 'custom' ? f.dateFrom : '',
                dateTo: opt.value === 'custom' ? f.dateTo : '',
              }))}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer' }}>
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                border: `2px solid ${filters.dateRange === opt.value ? '#E91E8C' : 'rgba(255,255,255,0.3)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                {filters.dateRange === opt.value && (
                  <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#E91E8C' }} />
                )}
              </div>
              <span style={{ color: '#BBBBBB', fontSize: 14 }}>{opt.label}</span>
            </div>
          ))}

          {filters.dateRange === 'custom' && (
            <div style={{ marginTop: 10, marginLeft: 28, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <DateField label="From" value={filters.dateFrom} onChange={v => setFilters(f => ({ ...f, dateFrom: v }))} />
              <DateField label="To" value={filters.dateTo} onChange={v => setFilters(f => ({ ...f, dateTo: v }))} />
            </div>
          )}
        </div>

        {/* State */}
        {filterOptions.states.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <SectionLabel>State</SectionLabel>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {filterOptions.states.map(st => {
                const activeStates = filters.stateFilter ? filters.stateFilter.split(',') : []
                const isActive = activeStates.includes(st)
                return (
                  <button key={st}
                    onClick={() => {
                      const cur = filters.stateFilter ? filters.stateFilter.split(',') : []
                      const next = isActive ? cur.filter(s => s !== st) : [...cur, st]
                      setFilters(f => ({ ...f, stateFilter: next.join(','), countyFilters: [], townshipFilters: [] }))
                    }}
                    style={pillStyle(isActive)}>
                    {st}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* County */}
        {filters.stateFilter && (() => {
          const activeStates = filters.stateFilter.split(',').filter(Boolean).map(s => s.toUpperCase())
          const set = new Set<string>()
          activeStates.forEach(st => (filterOptions.counties_by_state[st] || []).forEach(c => set.add(c)))
          const counties = Array.from(set).sort()
          if (!counties.length) return null
          return (
            <div style={{ marginBottom: 24 }}>
              <SectionLabel>County{filters.countyFilters.length > 0 ? ` (${filters.countyFilters.length} selected)` : ''}</SectionLabel>
              <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 8 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {counties.map(county => {
                    const isActive = filters.countyFilters.includes(county)
                    return (
                      <button key={county}
                        onClick={() => setFilters(f => ({
                          ...f,
                          countyFilters: isActive ? f.countyFilters.filter(c => c !== county) : [...f.countyFilters, county],
                          townshipFilters: [],
                        }))}
                        style={smallPillStyle(isActive)}>
                        {county}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })()}

        {/* Township */}
        {filters.countyFilters.length > 0 && (() => {
          const st = filters.stateFilter?.toUpperCase()
          const set = new Set<string>()
          if (st) {
            filters.countyFilters.forEach(county => {
              const twps = filterOptions.townships_by_county[`${st}|${county}`]
              if (twps) twps.forEach(t => set.add(t))
            })
          }
          const townships = Array.from(set).sort()
          if (!townships.length) return null
          return (
            <div style={{ marginBottom: 20 }}>
              <SectionLabel>Township{filters.townshipFilters.length > 0 ? ` (${filters.townshipFilters.length} selected)` : ''}</SectionLabel>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 160, overflowY: 'auto' }}>
                {townships.map(twp => {
                  const isActive = filters.townshipFilters.includes(twp)
                  return (
                    <button key={twp}
                      onClick={() => setFilters(f => ({
                        ...f,
                        townshipFilters: isActive ? f.townshipFilters.filter(t => t !== twp) : [...f.townshipFilters, twp],
                      }))}
                      style={smallPillStyle(isActive)}>
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
            label: filters.stateFilter === 'IL' ? 'PI Rating'
              : filters.stateFilter === 'IN' ? 'WAPI'
              : filters.stateFilter === 'IA' ? 'CSR2' : 'Soil Rating',
            minKey: 'soilRatingMin' as keyof FilterState, maxKey: 'soilRatingMax' as keyof FilterState,
          }] : []),
          { label: 'Acreage', minKey: 'acreageMin' as keyof FilterState, maxKey: 'acreageMax' as keyof FilterState },
          { label: '% Tillable', minKey: 'pctTillableMin' as keyof FilterState, maxKey: 'pctTillableMax' as keyof FilterState },
        ].map(({ label, minKey, maxKey }) => (
          <div key={label} style={{ marginBottom: 20 }}>
            <SectionLabel>{label}</SectionLabel>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <input type="number" placeholder="Min"
                value={filters[minKey] as string}
                onChange={e => setFilters(f => ({ ...f, [minKey]: e.target.value }))}
                style={rangeInputStyle} />
              <span style={{ color: '#999999', fontSize: 13 }}>to</span>
              <input type="number" placeholder="Max"
                value={filters[maxKey] as string}
                onChange={e => setFilters(f => ({ ...f, [maxKey]: e.target.value }))}
                style={rangeInputStyle} />
            </div>
          </div>
        ))}
      </div>

      <div style={{
        padding: '16px 20px', borderTop: '1px solid rgba(255,255,255,0.1)',
        display: 'flex', gap: 10,
      }}>
        <button onClick={onReset}
          style={{
            flex: 1, padding: '12px 0', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'transparent',
            color: '#BBBBBB', fontSize: 14, fontWeight: 600, cursor: 'pointer',
          }}>
          Reset
        </button>
        <button onClick={onApply}
          style={{
            flex: 1, padding: '12px 0', borderRadius: 10, border: 'none',
            backgroundColor: '#E91E8C', color: '#fff',
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>
          Apply
        </button>
      </div>
    </div>
  )
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div style={{
    color: '#CCCCCC', fontSize: 12, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10,
  }}>{children}</div>
)
const pillStyle = (isActive: boolean): React.CSSProperties => ({
  padding: '6px 14px', borderRadius: 20,
  border: `1px solid ${isActive ? '#E91E8C' : 'rgba(255,255,255,0.2)'}`,
  backgroundColor: isActive ? 'rgba(233,30,140,0.2)' : 'transparent',
  color: isActive ? '#E91E8C' : '#BBBBBB',
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
})
const smallPillStyle = (isActive: boolean): React.CSSProperties => ({
  padding: '4px 10px', borderRadius: 14,
  border: `1px solid ${isActive ? '#E91E8C' : 'rgba(255,255,255,0.15)'}`,
  backgroundColor: isActive ? 'rgba(233,30,140,0.2)' : 'transparent',
  color: isActive ? '#E91E8C' : '#BBBBBB',
  fontSize: 12, fontWeight: 500, cursor: 'pointer',
})
const rangeInputStyle: React.CSSProperties = {
  flex: 1, padding: '8px 12px', borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.15)',
  backgroundColor: 'rgba(255,255,255,0.05)',
  color: '#fff', fontSize: 14, outline: 'none',
}

const DateField = ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={{ color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
    <input type="date" value={value} onChange={e => onChange(e.target.value)}
      style={{
        padding: '6px 10px', borderRadius: 8,
        border: '1px solid rgba(255,255,255,0.15)',
        backgroundColor: 'rgba(255,255,255,0.05)',
        color: '#fff', fontSize: 13, colorScheme: 'dark',
      }} />
  </div>
)
