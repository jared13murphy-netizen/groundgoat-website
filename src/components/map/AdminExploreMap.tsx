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
const COUNTY_TIER_MAX = 10
const TRACT_TIER_MIN = 9   // lowered from 10 → tracts load when user clicks
                            // a county and we ease to z 9.5
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

// Tier classification — drives CSS transitions on each marker via a
// data-tier attribute. The marker DOM stays mounted at all zoom
// levels; only this attribute changes, so CSS transitions fire.
function currentZoomTier(z: number): 'state' | 'county' | 'tract' {
  if (z <= STATE_TIER_MAX) return 'state'
  if (z <= COUNTY_TIER_MAX) return 'county'
  return 'tract'
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

  // (state silhouettes are rendered as a map fill+line layer — see
  // map.on('load') below; no client-side SVG path generation needed.)

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
      // State silhouettes as a MAP LAYER (not as a fixed-size SVG inside
      // a DOM badge). This way the silhouette is THE state shape on the
      // map — guaranteed-correct alignment at every zoom level.
      // Two layers stacked:
      //   • base fill+line: every state, dim — the user sees the
      //     silhouette of every state in the country
      //   • "hot" fill+line: only states that have matching tracts —
      //     brighter pink outline + slightly brighter fill. setFilter
      //     swaps the highlighted set when filters change.
      // Both layers are scoped to maxzoom: STATE_TIER_MAX + 0.5 so they
      // disappear when the user moves into the county tier.
      map.addSource('admin-states', {
        type: 'geojson', data: '/data/us-states.json',
      })
      map.addLayer({
        id: 'admin-states-fill',
        type: 'fill',
        source: 'admin-states',
        maxzoom: STATE_TIER_MAX + 0.5,
        paint: {
          'fill-color': '#0a0a0c',
          'fill-opacity': 0.6,
        },
      })
      map.addLayer({
        id: 'admin-states-line',
        type: 'line',
        source: 'admin-states',
        maxzoom: STATE_TIER_MAX + 0.5,
        paint: {
          'line-color': 'rgba(255,255,255,0.18)',
          'line-width': 1,
        },
      })
      // Brighter "hot" layer — populated below via setFilter once the
      // state-counts data arrives.
      map.addLayer({
        id: 'admin-states-fill-hot',
        type: 'fill',
        source: 'admin-states',
        maxzoom: STATE_TIER_MAX + 0.5,
        paint: { 'fill-color': '#1a1a22', 'fill-opacity': 0.82 },
        filter: ['in', ['get', 'NAME'], ['literal', []]] as any,
      })
      map.addLayer({
        id: 'admin-states-line-hot',
        type: 'line',
        source: 'admin-states',
        maxzoom: STATE_TIER_MAX + 0.5,
        paint: { 'line-color': '#f58cde', 'line-width': 2.2, 'line-opacity': 1 },
        filter: ['in', ['get', 'NAME'], ['literal', []]] as any,
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

  // Keep the "hot" state silhouette layer in sync with which states
  // currently have matching tracts. /data/us-states.json keys features
  // by `properties.NAME` (full name, e.g. "Illinois"), not the 2-letter
  // abbr we use elsewhere — so we translate via STATE_NAMES.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return
    const fullNames = stateCounts
      .filter(s => s.count > 0)
      .map(s => STATE_NAMES[s.state])
      .filter(Boolean)
    try {
      if (map.getLayer('admin-states-fill-hot')) {
        map.setFilter('admin-states-fill-hot',
          ['in', ['get', 'NAME'], ['literal', fullNames]] as any)
      }
      if (map.getLayer('admin-states-line-hot')) {
        map.setFilter('admin-states-line-hot',
          ['in', ['get', 'NAME'], ['literal', fullNames]] as any)
      }
    } catch {}
  }, [stateCounts, mapLoaded])

  // ─────────────────────────────────────────────────────────────
  // Tract loader (high zoom only)
  // ─────────────────────────────────────────────────────────────
  const loadTractsForViewport = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    const z = map.getZoom()
    if (z < TRACT_TIER_MIN) return
    const b = map.getBounds()
    const includePolygons = z >= POLYGON_TIER_MIN
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
    stateMarkersRef.current.forEach(m => m.remove())
    stateMarkersRef.current = []
    if (currentTier !== 'state') return

    for (const { state, count } of stateCounts) {
      if (count === 0) continue
      const bounds = STATE_BOUNDS[state]
      if (!bounds) continue
      const lng = (bounds[0][0] + bounds[1][0]) / 2
      const lat = (bounds[0][1] + bounds[1][1]) / 2

      const el = document.createElement('div')
      el.className = 'aem-state-badge'
      el.innerHTML = `
        <img src="/goat-icon-white.png" alt="" class="aem-state-goat" />
        <div class="aem-state-count">${count.toLocaleString()}</div>
        <a class="aem-state-link" data-action="filter">Start Filtering →</a>
      `

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
        // Both clicks zoom past STATE_TIER_MAX so the next tier appears.
        map.fitBounds(bounds as any, { padding: 60, maxZoom: 7.5, duration: 900 })
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map)
      stateMarkersRef.current.push(marker)
    }
    // Cleanup runs when tier or data changes — guarantees no orphans.
    return () => {
      stateMarkersRef.current.forEach(m => m.remove())
      stateMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateCounts, mapLoaded, currentTier])

  // COUNTY SQUARES — only built when in county tier.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    countyMarkersRef.current.forEach(m => m.remove())
    countyMarkersRef.current = []
    if (currentTier !== 'county') return

    for (const c of countyCounts) {
      if (!c.count || c.lat == null || c.lng == null) continue
      const el = document.createElement('div')
      el.className = 'aem-county-square'
      el.innerHTML = `
        <div class="aem-county-name">${c.county}</div>
        <div class="aem-county-count">${c.count.toLocaleString()}</div>
      `
      el.addEventListener('click', () => {
        // Past COUNTY_TIER_MAX so tract pins appear.
        map.easeTo({ center: [c.lng, c.lat], zoom: 9.5, duration: 800 })
      })
      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([c.lng, c.lat])
        .addTo(map)
      countyMarkersRef.current.push(marker)
    }
    return () => {
      countyMarkersRef.current.forEach(m => m.remove())
      countyMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countyCounts, mapLoaded, currentTier])

  // TRACT PINS — only built when in tract tier.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []
    if (currentTier !== 'tract') return

    for (const t of Array.from(tractMapRef.current.values())) {
      if (!t.latitude || !t.longitude) continue
      const isPT = (t.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = (t.sale_status || '').toLowerCase() === 'pending'
      const ppa = (isPT || isPending) && t.asking_price && t.total_acres
        ? t.asking_price / t.total_acres
        : t.price_per_acre

      const el = document.createElement('div')
      el.className = 'comp-marker aem-tract-pin'
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
      el.appendChild(label)
      const pin = document.createElement('div')
      pin.className = 'comp-marker-pin comparable'
      pin.style.backgroundColor = pinColor(t.sale_status)
      el.appendChild(pin)
      el.addEventListener('click', () => {
        if (t.listing_id) window.open(`/listings/${t.listing_id}`, '_blank')
      })
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([t.longitude, t.latitude])
        .addTo(map)
      tractMarkersRef.current.push(marker)
    }
    return () => {
      tractMarkersRef.current.forEach(m => m.remove())
      tractMarkersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tractRefresh, mapLoaded, currentTier])

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
           data-tier transitions, no scale transforms — those caused
           badges to scale up to 1.4× during zoom and look like they
           were sliding across the map. Keeping it simple: opacity
           fades from 0 to 1 over 350ms on mount, that's it. Exit
           animation is just .remove() (instant — fine because the
           old tier is teared down before the new tier appears). */
        @keyframes aem-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        .aem-state-badge,
        .aem-county-square,
        .aem-tract-pin {
          animation: aem-fade-in 0.35s ease-out forwards;
        }

        /* ── State badge overlay (goat + count + Start Filtering) ──
           The state SHAPE is rendered as a map fill+line layer below
           the marker — this badge just sits at the state's centroid
           and shows the count, link, and goat on top of the dark fill. */
        .aem-state-badge {
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          user-select: none;
          padding: 4px 6px;
        }
        .aem-state-badge:hover .aem-state-link {
          background: #f58cde;
          color: #fff;
        }
        .aem-state-goat {
          width: 36px;
          height: 36px;
          object-fit: contain;
          filter: drop-shadow(0 1px 6px rgba(245, 140, 222, 0.85));
        }
        .aem-state-count {
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-weight: 800;
          font-size: 18px;
          color: #fff;
          line-height: 1;
          margin-top: 2px;
          text-shadow: 0 1px 4px rgba(0, 0, 0, 0.95),
                       0 0 8px rgba(0, 0, 0, 0.6);
        }
        .aem-state-link {
          font-size: 9px;
          color: #f58cde;
          margin-top: 4px;
          font-weight: 700;
          letter-spacing: 0.04em;
          cursor: pointer;
          text-decoration: none;
          padding: 3px 6px;
          border-radius: 4px;
          background: rgba(0, 0, 0, 0.65);
          transition: background 0.15s ease, color 0.15s ease;
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
