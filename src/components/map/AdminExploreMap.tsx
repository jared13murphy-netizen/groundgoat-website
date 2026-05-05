'use client'

/**
 * AdminExploreMap — three-tier zoom replacement for ExploreMap.
 *
 * Lives at the bottom of /admin/dashboard so we can iterate without
 * touching the customer-facing map. Will replace ExploreMap once
 * approved.
 *
 * Tier strategy (driven by zoom level):
 *   • z 0–STATE_TIER_MAX (≈6)        → state badges:
 *       white goat icon + tract count + "Start Filtering" link
 *   • z STATE_TIER_MAX–COUNTY_TIER_MAX (≈10) → county squares:
 *       rounded square with county name + tract count
 *   • z >= TRACT_TIER_MIN (10+)      → individual tract pins
 *       (price-per-acre / acres bubble, copied from ExploreMap)
 *
 * Counts at the state and county tier come from new aggregation
 * endpoints (filter-aware), so they refresh whenever the user
 * applies a filter or runs a Goat Search query. Tract pins are
 * loaded by the existing /api/map/tracts bbox endpoint.
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
import { Filter, X } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Zoom thresholds. Slightly fuzzy boundaries keep transitions smooth.
const STATE_TIER_MAX = 6     // state badges visible up to this zoom
const COUNTY_TIER_MIN = 6    // county squares appear at this zoom
const COUNTY_TIER_MAX = 10   // county squares hidden past this zoom
const TRACT_TIER_MIN = 10    // tract pins appear at this zoom
const POLYGON_TIER_MIN = 13  // tract polygons drawn at this zoom
const PARCEL_TIER_MIN = 13   // WI admin parcel overlay (vector tiles) at this zoom

const PIN_COLORS: Record<string, string> = {
  sold: '#f58cde',
  auction: '#2563eb',
  listed: '#eab308',
  active: '#eab308',
  live: '#22c55e',
  pending: '#eab308',
  no_sale: '#9ca3af',
}
function pinColor(status: string | null): string {
  if (!status) return '#eab308'
  return PIN_COLORS[status.toLowerCase()] || '#eab308'
}
function fmt$(n: number | null | undefined): string {
  if (!n) return '—'
  return '$' + Math.round(n).toLocaleString('en-US')
}
function fmtAc(n: number | null | undefined): string {
  if (!n) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

// Same FilterState shape as ExploreMap so the chat panel and the filter
// panel can share fields. TODO (Phase 2): extract into a shared types
// module that both maps import.
interface FilterState {
  dateRange: string
  dateFrom: string
  dateTo: string
  stateFilter: string
  countyFilters: string[]
  statuses: string[]
  acreageMin: string
  acreageMax: string
  pctTillableMin: string
  pctTillableMax: string
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
  keyword: string
}
const INITIAL_FILTERS: FilterState = {
  dateRange: 'all',
  dateFrom: '',
  dateTo: '',
  stateFilter: '',
  countyFilters: [],
  statuses: [],
  acreageMin: '',
  acreageMax: '',
  pctTillableMin: '',
  pctTillableMax: '',
  listingType: '',
  pricePerAcreMin: '',
  pricePerAcreMax: '',
  salePriceMin: '',
  salePriceMax: '',
  askingPriceMin: '',
  askingPriceMax: '',
  companyName: '',
  buyer: '',
  seller: '',
  keyword: '',
}

function buildFilterParams(f: FilterState): Record<string, string> {
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
  if (f.statuses.length > 0) p.sale_status = f.statuses.join(',')
  if (f.stateFilter) p.state_abbr = f.stateFilter
  if (f.countyFilters.length > 0) p.county_name = f.countyFilters.join(',')
  if (f.acreageMin) p.acreage_min = f.acreageMin
  if (f.acreageMax) p.acreage_max = f.acreageMax
  if (f.pctTillableMin) p.pct_tillable_min = f.pctTillableMin
  if (f.pctTillableMax) p.pct_tillable_max = f.pctTillableMax
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

export default function AdminExploreMap({
  height = '700px',
  isAdmin = true,
}: AdminExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [currentZoom, setCurrentZoom] = useState(4)

  // Tier data
  const [stateCounts, setStateCounts] = useState<Array<{ state: string; count: number }>>([])
  const [countyCounts, setCountyCounts] = useState<
    Array<{ state: string; county: string; count: number; lat: number; lng: number }>
  >([])
  const tractMapRef = useRef<Map<string, ApiMapTract>>(new Map())
  const [tractRefresh, setTractRefresh] = useState(0)

  // Filter state
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
  const filtersRef = useRef(filters)
  useEffect(() => { filtersRef.current = filters }, [filters])
  const [filterPanelOpen, setFilterPanelOpen] = useState(false)

  // Marker pools (DOM markers, separate per tier)
  const stateMarkersRef = useRef<maplibregl.Marker[]>([])
  const countyMarkersRef = useRef<maplibregl.Marker[]>([])
  const tractMarkersRef = useRef<maplibregl.Marker[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filterParamString = useMemo(() => {
    const p = buildFilterParams(filters)
    const usp = new URLSearchParams(p)
    return usp.toString()
  }, [filters])

  // Init map once
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
      mapRef.current = map
      setMapLoaded(true)
      setCurrentZoom(map.getZoom())
    })
    map.on('zoom', () => {
      setCurrentZoom(map.getZoom())
    })
    map.on('moveend', () => {
      // Tract loader fires only at high zoom. Debounced.
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        if (map.getZoom() < TRACT_TIER_MIN) return
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
  }, [])

  // Load state counts whenever filters change
  useEffect(() => {
    let cancelled = false
    const url = `${API_URL}/api/map/state-tract-counts?${filterParamString}`
    fetchWithAuth(url)
      .then(r => r.ok ? r.json() : { states: [] })
      .then(data => {
        if (cancelled) return
        setStateCounts(data.states || [])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [filterParamString])

  // Load county counts whenever filters change OR a state is selected.
  // We always fetch counties for the selected state(s); if no state
  // filter is active and the user is at county zoom, fetch all counties
  // (server scopes by visible viewport via state param when present).
  useEffect(() => {
    let cancelled = false
    const stateScope = filters.stateFilter ? `state=${filters.stateFilter}&` : ''
    const url = `${API_URL}/api/map/county-tract-counts?${stateScope}${filterParamString}`
    fetchWithAuth(url)
      .then(r => r.ok ? r.json() : { counties: [] })
      .then(data => {
        if (cancelled) return
        setCountyCounts(data.counties || [])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [filterParamString, filters.stateFilter])

  // Load tract details for the current viewport (high zoom only).
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
      // Replace, not merge — at this zoom the viewport is small enough
      // that re-fetching all visible tracts is cheap. Avoids stale
      // tracts hanging around when the user pans far.
      const next = new Map<string, ApiMapTract>()
      for (const t of data.tracts) next.set(t.id, t)
      tractMapRef.current = next
      setTractRefresh(x => x + 1)
    } catch {}
  }, [filterParamString])

  // Re-fetch tracts when filters change (only at high zoom)
  useEffect(() => {
    if (!mapLoaded) return
    const map = mapRef.current
    if (!map) return
    if (map.getZoom() >= TRACT_TIER_MIN) {
      loadTractsForViewport()
    }
  }, [filterParamString, mapLoaded, loadTractsForViewport])

  // ─────────────────────────────────────────────────────────────
  // STATE BADGES (z 0–STATE_TIER_MAX)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Always rebuild — count or filters may have changed.
    stateMarkersRef.current.forEach(m => m.remove())
    stateMarkersRef.current = []

    if (currentZoom >= STATE_TIER_MAX + 0.5) return  // hidden past tier

    for (const { state, count } of stateCounts) {
      if (count === 0) continue
      const bounds = STATE_BOUNDS[state]
      if (!bounds) continue
      const lng = (bounds[0][0] + bounds[1][0]) / 2
      const lat = (bounds[0][1] + bounds[1][1]) / 2

      const el = document.createElement('div')
      el.className = 'admin-explore-state-badge'
      el.innerHTML = `
        <img src="/goat-icon-white.png" alt="" class="admin-explore-state-goat" />
        <div class="admin-explore-state-count">${count.toLocaleString()}</div>
        <div class="admin-explore-state-name">${STATE_NAMES[state] || state}</div>
        <div class="admin-explore-state-link">Start Filtering →</div>
      `
      el.addEventListener('click', () => {
        // Apply state filter, open filter panel, AND zoom to the state.
        setFilters(prev => ({ ...prev, stateFilter: state }))
        setFilterPanelOpen(true)
        map.fitBounds(bounds as any, {
          padding: 60,
          maxZoom: 7.5,
          duration: 800,
        })
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([lng, lat])
        .addTo(map)
      stateMarkersRef.current.push(marker)
    }
  }, [stateCounts, mapLoaded, currentZoom])

  // ─────────────────────────────────────────────────────────────
  // COUNTY SQUARES (z COUNTY_TIER_MIN–COUNTY_TIER_MAX)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    countyMarkersRef.current.forEach(m => m.remove())
    countyMarkersRef.current = []

    if (currentZoom < COUNTY_TIER_MIN || currentZoom >= COUNTY_TIER_MAX + 0.5) return

    for (const c of countyCounts) {
      if (!c.count || c.lat == null || c.lng == null) continue

      const el = document.createElement('div')
      el.className = 'admin-explore-county-square'
      el.innerHTML = `
        <div class="admin-explore-county-name">${c.county}</div>
        <div class="admin-explore-county-count">${c.count.toLocaleString()} tracts</div>
      `
      el.addEventListener('click', () => {
        // Zoom to county at z 9.5 — close enough to read, far enough
        // to see neighboring counties for context.
        map.easeTo({ center: [c.lng, c.lat], zoom: 9.5, duration: 700 })
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([c.lng, c.lat])
        .addTo(map)
      countyMarkersRef.current.push(marker)
    }
  }, [countyCounts, mapLoaded, currentZoom])

  // ─────────────────────────────────────────────────────────────
  // TRACT PINS (z TRACT_TIER_MIN+) — same look as ExploreMap
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []

    if (currentZoom < TRACT_TIER_MIN) return

    for (const t of Array.from(tractMapRef.current.values())) {
      if (!t.latitude || !t.longitude) continue
      const isPT = (t.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = (t.sale_status || '').toLowerCase() === 'pending'
      const ppa = (isPT || isPending) && t.asking_price && t.total_acres
        ? t.asking_price / t.total_acres
        : t.price_per_acre

      const el = document.createElement('div')
      el.className = 'comp-marker'
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
  }, [tractRefresh, mapLoaded, currentZoom])

  // ─────────────────────────────────────────────────────────────
  // ADMIN PARCEL OVERLAY (WI vector tiles via pmtiles, z 13+)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !isAdmin) return

    const w = window as any
    if (!w.__ggPmtilesRegistered) {
      maplibregl.addProtocol('pmtiles', new PMTilesProtocol().tile as any)
      w.__ggPmtilesRegistered = true
    }

    const sourceId = 'admin-parcels-WI'
    const fillId = 'admin-parcels-WI-fill'
    const lineId = 'admin-parcels-WI-line'
    const TILES_BASE_URL =
      process.env.NEXT_PUBLIC_PMTILES_BASE_URL ||
      'https://ground-goat-tiles-production.up.railway.app'

    if (!map.getSource(sourceId)) {
      try {
        map.addSource(sourceId, {
          type: 'vector',
          url: `pmtiles://${TILES_BASE_URL}/wi.pmtiles`,
        })
        map.addLayer({
          id: fillId,
          type: 'fill',
          source: sourceId,
          'source-layer': 'parcels',
          minzoom: PARCEL_TIER_MIN,
          paint: {
            'fill-color': '#888',
            'fill-opacity': 0.05,
          },
        })
        map.addLayer({
          id: lineId,
          type: 'line',
          source: sourceId,
          'source-layer': 'parcels',
          minzoom: PARCEL_TIER_MIN,
          paint: {
            'line-color': '#fff',
            'line-width': 0.5,
            'line-opacity': 0.5,
          },
        })
      } catch (e) {
        console.warn('[AdminExploreMap] pmtiles source add failed', e)
      }
    }

    return () => {
      try {
        if (!map.getStyle()) return
        if (map.getLayer(lineId)) map.removeLayer(lineId)
        if (map.getLayer(fillId)) map.removeLayer(fillId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {}
    }
  }, [mapLoaded, isAdmin])

  const totalCount = stateCounts.reduce((acc, s) => acc + s.count, 0)
  const tier =
    currentZoom < STATE_TIER_MAX ? 'States'
      : currentZoom < COUNTY_TIER_MAX ? 'Counties'
      : currentZoom < POLYGON_TIER_MIN ? 'Tracts (pins)'
      : 'Tracts (pins + parcels)'

  // Apply chat-driven filters from MapChatPanel
  const handleApplyChatFilters = useCallback(
    (incoming: Record<string, any>, clearUnspecified: boolean) => {
      setFilters(prev => {
        const base = clearUnspecified ? INITIAL_FILTERS : prev
        return { ...base, ...incoming } as FilterState
      })
      setFilterPanelOpen(true)
    }, []
  )

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

      {/* Filter toggle (top-left, below tier) */}
      <button
        onClick={() => setFilterPanelOpen(o => !o)}
        className="absolute top-12 left-3 bg-gg-pink hover:bg-gg-pink/90 text-white text-sm px-3 py-1.5 rounded-md z-10 flex items-center gap-1.5 shadow-lg"
      >
        <Filter size={14} />
        Filters
      </button>

      {/* Filter panel (slide-out, top-right) */}
      {filterPanelOpen && (
        <FilterPanel
          filters={filters}
          setFilters={setFilters}
          stateCounts={stateCounts}
          onClose={() => setFilterPanelOpen(false)}
        />
      )}

      {/* Goat Search (bottom-right, copies the existing chat panel) */}
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
        .admin-explore-state-badge {
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
          padding: 8px 14px 10px;
          background: rgba(15, 15, 18, 0.78);
          border: 1.5px solid #f58cde;
          border-radius: 14px;
          backdrop-filter: blur(6px);
          box-shadow: 0 8px 24px rgba(245, 140, 222, 0.18);
          transition: transform 0.15s ease, box-shadow 0.15s ease;
          user-select: none;
        }
        .admin-explore-state-badge:hover {
          transform: translateY(-2px) scale(1.04);
          box-shadow: 0 12px 32px rgba(245, 140, 222, 0.32);
        }
        .admin-explore-state-goat {
          width: 56px;
          height: 56px;
          object-fit: contain;
          margin-bottom: 2px;
          filter: drop-shadow(0 2px 6px rgba(245, 140, 222, 0.45));
        }
        .admin-explore-state-count {
          font-family: ui-sans-serif, system-ui, sans-serif;
          font-weight: 700;
          font-size: 22px;
          color: #fff;
          line-height: 1;
        }
        .admin-explore-state-name {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.7);
          letter-spacing: 0.05em;
          text-transform: uppercase;
          margin-top: 2px;
        }
        .admin-explore-state-link {
          font-size: 10px;
          color: #f58cde;
          margin-top: 6px;
          font-weight: 600;
          letter-spacing: 0.03em;
        }
        .admin-explore-county-square {
          background: rgba(15, 15, 18, 0.85);
          border: 1.5px solid #f58cde;
          border-radius: 10px;
          padding: 6px 10px;
          cursor: pointer;
          backdrop-filter: blur(4px);
          box-shadow: 0 6px 18px rgba(245, 140, 222, 0.22);
          min-width: 90px;
          text-align: center;
          transition: transform 0.15s, box-shadow 0.15s;
          user-select: none;
        }
        .admin-explore-county-square:hover {
          transform: scale(1.05);
          box-shadow: 0 10px 26px rgba(245, 140, 222, 0.4);
        }
        .admin-explore-county-name {
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          line-height: 1.1;
        }
        .admin-explore-county-count {
          font-size: 10px;
          color: #f58cde;
          margin-top: 2px;
        }
      `}</style>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────
// FilterPanel — slide-out, mirrors the most-used filters in ExploreMap.
// TODO (Phase 2): extract into shared component, used by ExploreMap too.
// ───────────────────────────────────────────────────────────────
function FilterPanel({
  filters,
  setFilters,
  stateCounts,
  onClose,
}: {
  filters: FilterState
  setFilters: (fn: (p: FilterState) => FilterState) => void
  stateCounts: Array<{ state: string; count: number }>
  onClose: () => void
}) {
  const update = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    setFilters(p => ({ ...p, [k]: v }))

  const states = stateCounts
    .filter(s => s.count > 0)
    .map(s => s.state)
    .sort()

  return (
    <div className="absolute top-3 right-16 bg-gg-black/95 border border-gg-gray-700 rounded-xl p-4 z-20 shadow-2xl w-72 max-h-[640px] overflow-y-auto backdrop-blur">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-white font-semibold text-sm">Filters</h3>
        <button onClick={onClose} className="text-gg-gray-400 hover:text-white">
          <X size={16} />
        </button>
      </div>

      <FilterRow label="State">
        <select
          value={filters.stateFilter}
          onChange={e => update('stateFilter', e.target.value)}
          className="filter-select"
        >
          <option value="">All states</option>
          {states.map(s => (
            <option key={s} value={s}>{STATE_NAMES[s] || s}</option>
          ))}
        </select>
      </FilterRow>

      <FilterRow label="Type">
        <select
          value={filters.listingType}
          onChange={e => update('listingType', e.target.value)}
          className="filter-select"
        >
          <option value="">All types</option>
          <option value="auction">Auction</option>
          <option value="private_treaty">Private Treaty</option>
        </select>
      </FilterRow>

      <FilterRow label="Status">
        <div className="flex flex-wrap gap-1">
          {(['sold', 'pending', 'listed', 'live', 'no_sale'] as const).map(s => (
            <button
              key={s}
              onClick={() =>
                update('statuses',
                  filters.statuses.includes(s)
                    ? filters.statuses.filter(x => x !== s)
                    : [...filters.statuses, s]
                )
              }
              className={
                'px-2 py-0.5 rounded text-xs ' +
                (filters.statuses.includes(s)
                  ? 'bg-gg-pink text-white'
                  : 'bg-gg-gray-800 text-gg-gray-300')
              }
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </FilterRow>

      <FilterRow label="Date">
        <select
          value={filters.dateRange}
          onChange={e => update('dateRange', e.target.value)}
          className="filter-select"
        >
          <option value="all">All time</option>
          <option value="upcoming">Upcoming</option>
          <option value="1month">Last month</option>
          <option value="6months">Last 6 months</option>
          <option value="1year">Last year</option>
          <option value="2years">Last 2 years</option>
          <option value="custom">Custom range…</option>
        </select>
      </FilterRow>

      {filters.dateRange === 'custom' && (
        <>
          <FilterRow label="From">
            <input
              type="date"
              value={filters.dateFrom}
              onChange={e => update('dateFrom', e.target.value)}
              className="filter-input"
            />
          </FilterRow>
          <FilterRow label="To">
            <input
              type="date"
              value={filters.dateTo}
              onChange={e => update('dateTo', e.target.value)}
              className="filter-input"
            />
          </FilterRow>
        </>
      )}

      <FilterRow label="Acres">
        <div className="flex gap-1">
          <input
            type="number"
            placeholder="min"
            value={filters.acreageMin}
            onChange={e => update('acreageMin', e.target.value)}
            className="filter-input"
          />
          <input
            type="number"
            placeholder="max"
            value={filters.acreageMax}
            onChange={e => update('acreageMax', e.target.value)}
            className="filter-input"
          />
        </div>
      </FilterRow>

      <FilterRow label="$/acre">
        <div className="flex gap-1">
          <input
            type="number"
            placeholder="min"
            value={filters.pricePerAcreMin}
            onChange={e => update('pricePerAcreMin', e.target.value)}
            className="filter-input"
          />
          <input
            type="number"
            placeholder="max"
            value={filters.pricePerAcreMax}
            onChange={e => update('pricePerAcreMax', e.target.value)}
            className="filter-input"
          />
        </div>
      </FilterRow>

      <button
        onClick={() => setFilters(_ => INITIAL_FILTERS)}
        className="text-gg-pink text-xs hover:underline mt-2"
      >
        Clear all filters
      </button>

      <style jsx>{`
        .filter-select,
        .filter-input {
          width: 100%;
          background: #1a1a20;
          border: 1px solid #2a2a32;
          border-radius: 6px;
          padding: 4px 8px;
          color: #fff;
          font-size: 12px;
        }
        .filter-select:focus,
        .filter-input:focus {
          outline: none;
          border-color: #f58cde;
        }
      `}</style>
    </div>
  )
}

function FilterRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-2">
      <label className="block text-xs text-gg-gray-400 mb-1">{label}</label>
      {children}
    </div>
  )
}
