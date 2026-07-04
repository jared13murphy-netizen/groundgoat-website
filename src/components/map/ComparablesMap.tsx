'use client'

import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { ringsToGeometry, largestRing } from '@/lib/polygonRings'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ComparablesMap.css'
import { TILE_URL, TILE_ATTRIBUTION, GLYPH_URL, LABEL_TILE_URL } from './mapConstants'
import { countyCentroids } from '@/data/countyCentroids'
import { normalizeTownship } from '../../utils/normalizeTownship'
import Tract3DModal from '@/components/Tract3DModal'
import { addRegridLayer, fetchRegridConfig, type RegridConfig } from './regridLayer'
import {
  buildRegridParcelFilter,
  REGRID_PARCEL_LAYER_IDS,
  type RegridFilterInput,
} from '@/lib/regridParcelFilter'
import type { FilterState as CompFilterState } from '@/components/ComparablesFilterPanel'
import { formatAcres } from '@/lib/format'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface ComparablePin {
  id: string
  county: string
  state: string
  latitude?: number | null
  longitude?: number | null
  price_per_acre?: number | null
  total_acres?: number | null
  tract_number?: number | null
  company_name?: string | null
  auction_date?: string | null
  is_same_county?: boolean
}

interface StateSale {
  id: string
  tract_id?: string | null
  latitude: number | null
  longitude: number | null
  price_per_acre: number | null
  total_acres: number | null
  sale_price: number | null
  county: string
  state: string
  township: string | null
  auction_date: string | null
  company_name: string | null
  polygon_coordinates?: number[][] | number[][][] | null
  tillable_acres?: number | null
  soil_rating?: number | null
  source_url?: string | null
}

interface SaleDetail {
  id: string
  tractId?: string | null
  auctionDate?: string | null
  totalAcres?: number | null
  companyName?: string | null
  salePrice?: number | null
  pricePerAcre?: number | null
  county: string
  state: string
  township?: string | null
  tillableAcres?: number | null
  soilRating?: number | null
  polygonCoordinates?: number[][] | number[][][] | null
  sourceUrl?: string | null
}

interface ComparablesMapProps {
  comparables: ComparablePin[]
  stateSales?: StateSale[]
  subjectCounty: string
  subjectState: string
  subjectLatitude?: number | null
  subjectLongitude?: number | null
  subjectAcres?: number | null
  subjectPolygon?: number[][] | null
  height?: string
  selectedIds?: Set<string>
  toggleSelection?: (item: any) => void
  visibleIds?: Set<string>
  /** When provided, the Regrid parcel layer (fill+line+label) is
   *  also filtered by tile-native fields (acreage, sale date, sale
   *  price, sold status). Mirrors the Web Explore behavior. */
  filters?: CompFilterState
}


/**
 * Adapter — maps the Comparables filter state into the universal
 * RegridFilterInput shape consumed by buildRegridParcelFilter.
 * Surface-specific because each map's filter UI is different.
 */
function compFiltersToRegrid(
  filters: CompFilterState | undefined,
  subjectState: string,
): RegridFilterInput {
  if (!filters) return {}
  // Map the dateRange preset into from/to. Mirrors what Web Explore's
  // resolveDateWindow does — kept local to avoid pulling in
  // ExploreMap's unrelated dependencies.
  let saleDateFrom: string | null = null
  const today = new Date()
  if (filters.dateRange && filters.dateRange !== 'all' && filters.dateRange !== 'upcoming') {
    const months = filters.dateRange === '1month' ? 1
      : filters.dateRange === '6months' ? 6
      : filters.dateRange === '1year' ? 12
      : filters.dateRange === '18months' ? 18
      : filters.dateRange === '2years' ? 24
      : 0
    if (months > 0) {
      const from = new Date(today)
      from.setMonth(today.getMonth() - months)
      saleDateFrom = from.toISOString().split('T')[0]
    }
  }
  const acresMin = filters.acreageMin ? parseFloat(filters.acreageMin) : NaN
  const acresMax = filters.acreageMax ? parseFloat(filters.acreageMax) : NaN
  return {
    acresMin: Number.isFinite(acresMin) ? acresMin : null,
    acresMax: Number.isFinite(acresMax) ? acresMax : null,
    saleDateFrom,
    saleDateTo: null,
    upcomingOnly: filters.dateRange === 'upcoming',
    stateAbbr: subjectState || null,
    countyNames: null,
    soldOnly: filters.statuses?.includes('sold') || false,
  }
}

function getCountyCentroid(county: string, state: string): [number, number] | null {
  const key = `${county}, ${state}`
  return countyCentroids[key] || null
}

// Shared click-arbitration guard (task #26 — one click, one panel). Mirrors
// the same idiom used in ExploreMap.tsx's clickClaimedByLayers: filter to
// layers that currently exist, then check queryRenderedFeatures once.
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

function formatCurrency(amount: number | null | undefined): string {
  if (!amount) return '—'
  return '$' + Math.round(amount).toLocaleString('en-US')
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ComparablesMap({
  comparables,
  stateSales = [],
  subjectCounty,
  subjectState,
  subjectLatitude,
  subjectLongitude,
  subjectAcres,
  subjectPolygon,
  height = '500px',
  selectedIds = new Set<string>(),
  toggleSelection,
  visibleIds,
  filters,
}: ComparablesMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const markerElementsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [show3DViewer, setShow3DViewer] = useState(false)
  const [regridConfig, setRegridConfig] = useState<RegridConfig | null>(null)
  // Tracks when the map's `load` event has fired so we can mount the
  // Regrid layer after the basemap is ready (separate from the main
  // map-build useEffect which is concerned with comp markers + tract
  // polygons).
  const [mapReady, setMapReady] = useState(false)

  // Fetch Regrid tile-URL config once on mount.
  useEffect(() => {
    let cancelled = false
    fetchRegridConfig().then(cfg => {
      if (!cancelled && cfg) setRegridConfig(cfg)
    })
    return () => { cancelled = true }
  }, [])

  // Mount the Regrid vector-tile layer once both the map and the
  // config are ready. Cleanup on unmount.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !regridConfig) return
    // Tract polygons paint ON TOP of Regrid so the auction / sold
    // outlines remain visible.
    const cleanup = addRegridLayer(map, regridConfig, {
      beforeId: 'tract-polygon-fill',
      // 11 matches the mobile comp map (REGRID_MIN_ZOOM) so parcels +
      // the "+" appear at the same zoom users see them on mobile.
      minZoom: 11,
      // Label text (owner/acres/$/date) stays gated at 14 — same as
      // ExploreMap's REGRID_LABEL_MIN_ZOOM split. Boundaries/fill/"+"
      // appear at 11; dense text only once zoomed in further.
      labelMinZoom: 14,
    })

    // Parcel "+" button: REMOVED 2026-07-04 (one-dot-layer task). This used
    // to be a live Regrid-tile SymbolLayer ('parcel-plus', minzoom 11)
    // drawing a pink "+" for every priced parcel, handing off from the
    // durable-dot layer below at z11 — the durable layer is a
    // write-through-synced COPY of the exact same Regrid parcel-sale data
    // (see the durable-dot section below), so the live layer was fully
    // redundant once the durable layer's zoom cap is lifted. Removing it
    // outright (rather than gating by mode, as ExploreMap.tsx's shared
    // explore/comp component does) matches this file's mobile counterpart
    // (ComparablesMapView.js), which had the same dedicated always-comp
    // live "+" layer and removed it the same way.
    return () => {
      cleanup()
    }
  }, [mapReady, regridConfig])

  // Keep the Regrid fill/line/label filter in sync with the comparables
  // filter panel. Tile-native filters only (acreage, sale date, sold);
  // DB-native filters (soil rating, % tillable) require the future
  // /api/regrid/filter-uuids endpoint — see
  // project_regrid_tile_filterability_plan.md Phase E.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const expr = buildRegridParcelFilter(compFiltersToRegrid(filters, subjectState))
    for (const id of REGRID_PARCEL_LAYER_IDS) {
      if (map.getLayer(id)) {
        try { map.setFilter(id, expr as any) } catch {/* layer torn down */}
      }
    }
  }, [
    mapReady,
    subjectState,
    filters?.acreageMin,
    filters?.acreageMax,
    filters?.dateRange,
    filters?.statuses,
  ])

  // ── Durable-table parcel-sale dots — THE ONLY sale "+" layer on this map
  // (owner directive 2026-07-04: "the dots should never change... as soon
  // as I'm zoomed in enough to see dots, they should never go away no
  // matter how much I zoom in"). Reads our own durable copy of the same
  // parcel data (backend /api/map/parcel-sale-dots — a write-through-synced
  // copy of the exact same Regrid parcel-sale data the removed live
  // 'parcel-plus' layer used to read from tiles) at every zoom >=
  // DURABLE_DOT_MIN_ZOOM, no upper bound. Replaces the two-layer design
  // (this layer capped at z11 handing off to the live 'parcel-plus'
  // Regrid-tile layer, now removed above) — that handoff produced a
  // visible pop (different rendering pipeline, tile-load latency) exactly
  // at the boundary. At high zoom the viewport is tiny so the row count
  // fetched stays small on its own; no row cap is ever applied (owner
  // standing rule). Renders with the SAME pink "+" plus-icon affordance the
  // live layer used, so there's no visual change from the user's
  // perspective — only the seam is gone. Clicking one follows this map's
  // existing add-to-report flow (setSelectedSale), same as the removed
  // live "+" did.
  // Fade only on the way OUT (zooming below DURABLE_DOT_MIN_ZOOM): opacity
  // interpolates 0 at z8.8 to fully opaque at z9.3. Above z9.3 the style is
  // 100% constant at every zoom.
  const DURABLE_DOT_SOURCE = 'parcel-sale-dots-durable'
  const DURABLE_DOT_LAYER = 'parcel-sale-dots-durable-plus'
  const DURABLE_DOT_MIN_ZOOM = 9
  const DURABLE_DOT_MIN_ACRES = 10 // owner rule: never show parcel dots under 10 acres

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    if (!map.getSource(DURABLE_DOT_SOURCE)) {
      map.addSource(DURABLE_DOT_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    }
    if (!map.getLayer(DURABLE_DOT_LAYER)) {
      map.addLayer({
        id: DURABLE_DOT_LAYER,
        type: 'symbol',
        source: DURABLE_DOT_SOURCE,
        // No maxzoom — this is now the only sale-"+" layer at every zoom.
        minzoom: DURABLE_DOT_MIN_ZOOM,
        layout: {
          'text-field': '+',
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 8, 18, 14, 28],
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#E91E8C',
          'text-halo-width': 3.2,
          'text-halo-blur': 0.4,
          'text-opacity': ['interpolate', ['linear'], ['zoom'], 8.8, 0, 9.3, 1],
        },
      })
    }

    const onClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (!f || f.geometry.type !== 'Point') return
      // Task #26: this layer's z9-11 range overlaps the (uncapped)
      // tract-polygon-fill layer — the subject tract always wins.
      if (clickClaimedByLayers(map, e.point, ['tract-polygon-fill'])) return
      const [lng, lat] = f.geometry.coordinates as [number, number]
      const p: any = f.properties || {}
      const acres = p.acres != null ? Number(p.acres) : null
      const salePrice = p.saleprice != null ? Number(p.saleprice) : null
      const ppa = salePrice != null && acres != null && acres > 0 ? salePrice / acres : null
      // Same add-to-report shape the PLUS layer's onPlusClick builds —
      // id is the durable dot's ll_uuid.
      setSelectedSale({
        id: String(p.id ?? `${lng},${lat}`),
        auctionDate: typeof p.saledate === 'string' ? p.saledate.slice(0, 10) : null,
        totalAcres: acres,
        salePrice,
        pricePerAcre: ppa,
        county: subjectCounty,
        state: subjectState,
        companyName: null,
      })
      // Owner spec 2026-07-02: strong zoom-in ALONGSIDE the modal on every map.
      map.easeTo({ center: [lng, lat], zoom: 14.5, duration: 900 })
    }
    const setPointer = () => { map.getCanvas().style.cursor = 'pointer' }
    const clearPointer = () => { map.getCanvas().style.cursor = '' }
    map.on('click', DURABLE_DOT_LAYER, onClick)
    map.on('mouseenter', DURABLE_DOT_LAYER, setPointer)
    map.on('mouseleave', DURABLE_DOT_LAYER, clearPointer)

    return () => {
      try {
        if (!map.getStyle()) return
        map.off('click', DURABLE_DOT_LAYER, onClick)
        map.off('mouseenter', DURABLE_DOT_LAYER, setPointer)
        map.off('mouseleave', DURABLE_DOT_LAYER, clearPointer)
        if (map.getLayer(DURABLE_DOT_LAYER)) map.removeLayer(DURABLE_DOT_LAYER)
        if (map.getSource(DURABLE_DOT_SOURCE)) map.removeSource(DURABLE_DOT_SOURCE)
      } catch {/* map already torn down */}
    }
  }, [mapReady, subjectCounty, subjectState])

  // Fetch durable dots on moveend at every zoom >= DURABLE_DOT_MIN_ZOOM, no
  // upper bound (mirrors the Web Explore map's durable-dot fetch in
  // ExploreMap.tsx). Viewport-bounded at every zoom, same debounce; at deep
  // zoom the viewport is tiny so the row count stays small on its own.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let gen = 0

    const runFetch = async () => {
      const z = map.getZoom()
      if (z < DURABLE_DOT_MIN_ZOOM) return
      if (!map.getSource(DURABLE_DOT_SOURCE)) return
      const regridInput = compFiltersToRegrid(filters, subjectState)
      if (regridInput.upcomingOnly) {
        // "Upcoming" can't match recorded past sales — same rule the
        // live Regrid sale-dot filter uses.
        (map.getSource(DURABLE_DOT_SOURCE) as maplibregl.GeoJSONSource)
          .setData({ type: 'FeatureCollection', features: [] })
        return
      }
      const myGen = ++gen
      try {
        const bounds = map.getBounds()
        const qs = new URLSearchParams({
          min_lat: String(bounds.getSouth()),
          max_lat: String(bounds.getNorth()),
          min_lng: String(bounds.getWest()),
          max_lng: String(bounds.getEast()),
        })
        const res = await fetchWithAuth(`${API_URL}/api/map/parcel-sale-dots?${qs.toString()}`)
        if (!res.ok) return
        const data = await res.json()
        if (myGen !== gen) return // stale — a newer fetch superseded this one
        const dots: any[] = data?.dots || []
        const filtered = dots.filter(d => {
          if (d.lat == null || d.lng == null) return false
          if (d.acres == null || d.acres < DURABLE_DOT_MIN_ACRES) return false
          if (regridInput.saleDateFrom && (!d.saledate || d.saledate < regridInput.saleDateFrom)) return false
          return true
        })
        const fc: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: filtered.map(d => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
            properties: { id: d.id, saleprice: d.saleprice, saledate: d.saledate, acres: d.acres },
          })),
        }
        const src = map.getSource(DURABLE_DOT_SOURCE) as maplibregl.GeoJSONSource | undefined
        if (src) src.setData(fc)
      } catch {/* transient fetch failure — next moveend retries */}
    }

    const onMoveEnd = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(runFetch, 500)
    }

    onMoveEnd()
    map.on('moveend', onMoveEnd)
    return () => {
      map.off('moveend', onMoveEnd)
      if (debounceTimer) clearTimeout(debounceTimer)
    }
  }, [mapReady, subjectState, filters?.dateRange, filters?.acreageMin, filters?.acreageMax, filters?.statuses])

  useEffect(() => {
    if (!mapContainerRef.current) return

    // Determine subject pin coordinates
    let subjectLng: number
    let subjectLat: number

    if (subjectLatitude && subjectLongitude) {
      subjectLat = subjectLatitude
      subjectLng = subjectLongitude
    } else {
      const centroid = getCountyCentroid(subjectCounty, subjectState)
      if (centroid) {
        [subjectLat, subjectLng] = centroid
      } else {
        subjectLat = 40.0
        subjectLng = -89.5
      }
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
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
      center: [subjectLng, subjectLat],
      zoom: 9,
      maxZoom: 16,
      transformRequest: (url: string) => {
        if (url.includes(`${API_URL}/api/regrid/tile/`)) {
          const token = localStorage.getItem('auth_token')
          return { url, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        }
        return { url }
      },
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      setMapReady(true)
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

      // Add state boundaries (bolder than counties)
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

      // Add county name labels
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

      // Add tract polygon boundaries (filtered by visibleIds when provided).
      // ringsToGeometry handles single-ring OR multi-polygon tracts.
      const polygonFeatures: any[] = []
      for (const sale of stateSales) {
        if (visibleIds && !visibleIds.has(String(sale.id)) && !visibleIds.has(String(sale.tract_id))) continue
        const geom = ringsToGeometry(sale.polygon_coordinates)
        if (geom) {
          polygonFeatures.push({ type: 'Feature', properties: { id: sale.id }, geometry: geom })
        }
      }

      // Add subject tract polygon
      const subjGeom = ringsToGeometry(subjectPolygon)
      if (subjGeom) {
        polygonFeatures.push({
          type: 'Feature',
          properties: { id: 'subject', isSubject: true },
          geometry: subjGeom,
        })
      }

      if (polygonFeatures.length > 0) {
        map.addSource('tract-polygons', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: polygonFeatures },
        })
        map.addLayer({
          id: 'tract-polygon-fill',
          type: 'fill',
          source: 'tract-polygons',
          paint: {
            'fill-color': '#E91E8C',
            // Bumped 0.08 → 0.20 for visibility against Regrid parcels
            'fill-opacity': 0.20,
          },
        })
        map.addLayer({
          id: 'tract-polygon-line',
          type: 'line',
          source: 'tract-polygons',
          paint: {
            'line-color': '#E91E8C',
            'line-width': ['case', ['==', ['get', 'isSubject'], true], 4, 3],
            'line-opacity': 1.0,
          },
        })
        // Push tract polygon layers to top after Regrid loads (Regrid
        // uses beforeId='tract-polygon-fill' on init, but if Regrid
        // attached first that no-ops; this fixes either ordering).
        if (map.getLayer('regrid-parcels-fill')) {
          map.moveLayer('tract-polygon-fill')
          map.moveLayer('tract-polygon-line')
        }

        // Click anywhere on a tract polygon (not just the pin) opens the tract
        // modal — never the Regrid parcel popup underneath. The map is fully
        // rebuilt (map.remove()) whenever data changes, so this handler is torn
        // down with it; no separate off() needed.
        map.on('click', 'tract-polygon-fill', (e: maplibregl.MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id
          if (id == null || id === 'subject') return
          const sale = stateSales.find(
            s => String(s.id) === String(id) || String(s.tract_id) === String(id),
          )
          if (!sale) return
          setSelectedSale({
            id: sale.id,
            tractId: sale.tract_id || sale.id,
            auctionDate: sale.auction_date,
            totalAcres: sale.total_acres,
            companyName: sale.company_name,
            salePrice: sale.sale_price,
            pricePerAcre: sale.price_per_acre,
            county: sale.county,
            state: sale.state,
            township: sale.township,
            tillableAcres: sale.tillable_acres,
            soilRating: sale.soil_rating,
            polygonCoordinates: sale.polygon_coordinates,
            sourceUrl: sale.source_url,
          })
        })
        map.on('mouseenter', 'tract-polygon-fill', () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', 'tract-polygon-fill', () => { map.getCanvas().style.cursor = '' })
      }

      // Bounds: fit to comparable pins + subject (not all state sales)
      const comparableIds = new Set(comparables.map(c => String(c.id)))
      const allCoords: [number, number][] = [[subjectLng, subjectLat]]

      // Helper: calculate polygon centroid
      const getPolygonCentroid = (coords: number[][]): [number, number] | null => {
        if (!coords || coords.length < 3) return null
        let sumLng = 0, sumLat = 0
        for (const [lng, lat] of coords) {
          sumLng += lng
          sumLat += lat
        }
        return [sumLng / coords.length, sumLat / coords.length]
      }

      // Create markers for sold tracts with boundaries only
      // When visibleIds is provided, only show tracts in that set
      markerElementsRef.current.clear()
      // Accumulate per-county counts of the comp dots we actually render
      // (post-filter, with boundaries) so we can show one count bubble
      // per county when zoomed too far out to see the individual dots.
      const countyAgg = new Map<string, { state: string; county: string; count: number; sumLng: number; sumLat: number }>()
      for (const sale of stateSales) {
        // Skip tracts not in visible set (when filtering is active)
        if (visibleIds && !visibleIds.has(String(sale.id)) && !visibleIds.has(String(sale.tract_id))) continue
        // Skip tracts without boundary data (single ring OR multi-polygon)
        const _ring = largestRing(sale.polygon_coordinates)
        if (!_ring) continue

        // Use the largest ring's centroid for marker placement
        let markerLng = sale.longitude
        let markerLat = sale.latitude
        const centroid = getPolygonCentroid(_ring)
        if (centroid) {
          markerLng = centroid[0]
          markerLat = centroid[1]
        }
        if (!markerLat || !markerLng) continue

        if (sale.county && sale.state) {
          const ckey = `${sale.state}-${sale.county}`
          const cur = countyAgg.get(ckey) || { state: sale.state, county: sale.county, count: 0, sumLng: 0, sumLat: 0 }
          cur.count += 1
          cur.sumLng += markerLng
          cur.sumLat += markerLat
          countyAgg.set(ckey, cur)
        }

        const el = createMarkerElement(
          sale.price_per_acre || null,
          sale.total_acres || null,
          selectedIds.has(String(sale.id))
        )
        markerElementsRef.current.set(String(sale.id), el)

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([markerLng, markerLat])
          .addTo(map)

        // Track comparable coords for bounds fitting
        if (comparableIds.has(String(sale.id))) {
          allCoords.push([markerLng, markerLat])
        }

        // Click to open modal
        el.addEventListener('click', () => {
          setSelectedSale({
            id: sale.id,
            tractId: sale.tract_id || sale.id,
            auctionDate: sale.auction_date,
            totalAcres: sale.total_acres,
            companyName: sale.company_name,
            salePrice: sale.sale_price,
            pricePerAcre: sale.price_per_acre,
            county: sale.county,
            state: sale.state,
            township: sale.township,
            tillableAcres: sale.tillable_acres,
            soilRating: sale.soil_rating,
            polygonCoordinates: sale.polygon_coordinates,
            sourceUrl: sale.source_url,
          })
        })

        markersRef.current.push(marker)
      }

      // Create subject marker last so it renders on top
      const subjectEl = createSubjectMarkerElement(subjectAcres || null)
      const subjectMarker = new maplibregl.Marker({ element: subjectEl })
        .setLngLat([subjectLng, subjectLat])
        .addTo(map)
      markersRef.current.push(subjectMarker)

      // Fit to bounds if we have multiple points
      if (allCoords.length > 1) {
        const bounds = new maplibregl.LngLatBounds()
        for (const coord of allCoords) {
          bounds.extend(coord as [number, number])
        }
        map.fitBounds(bounds, { padding: 60, maxZoom: 12 })
      }

      // COUNTY COUNT BUBBLES — when the user zooms out past the point
      // where individual comp dots are legible (z9, matching the explore
      // map's tract tier), replace the dots with one bubble per county:
      // the number on top, "tracts" beneath (labeled so the user knows
      // we're counting tracts, not parcels, yet). Bubbles are derived
      // from the comps actually on the map, so the number always matches
      // the dots they stand in for. Clicking a bubble drills into that
      // county.
      const COMP_TRACT_MIN_ZOOM = 9
      const bubbleMarkers: maplibregl.Marker[] = []
      const buildBubbles = () => {
        countyAgg.forEach(v => {
          if (!v.count) return
          const lng = v.sumLng / v.count
          const lat = v.sumLat / v.count
          const el = document.createElement('div')
          el.style.cssText = [
            'display:flex', 'flex-direction:column', 'align-items:center',
            'justify-content:center', 'min-width:42px', 'height:42px',
            'padding:3px 9px', 'border-radius:21px', 'background:#E91E8C',
            'border:2px solid #fff', 'box-shadow:0 2px 6px rgba(0,0,0,0.45)',
            'color:#fff', 'cursor:pointer', 'font-family:inherit',
            'box-sizing:border-box', 'white-space:nowrap',
          ].join(';')
          el.innerHTML =
            `<div style="font-size:15px;font-weight:700;line-height:1;">${v.count}</div>` +
            `<div style="font-size:8px;font-weight:600;line-height:1.1;letter-spacing:0.5px;` +
            `text-transform:uppercase;opacity:0.92;margin-top:1px;">tracts</div>`
          el.addEventListener('click', () => {
            map.easeTo({ center: [lng, lat], zoom: 10, duration: 700 })
          })
          bubbleMarkers.push(
            new maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat([lng, lat])
              .addTo(map),
          )
        })
      }
      const removeBubbles = () => {
        bubbleMarkers.forEach(m => m.remove())
        bubbleMarkers.length = 0
      }
      let bubblesShown = false
      const syncCountyBubbles = () => {
        const show = map.getZoom() < COMP_TRACT_MIN_ZOOM && countyAgg.size > 0
        if (show === bubblesShown) return
        bubblesShown = show
        // Swap the comp dots for the count bubbles (subject pin stays).
        markerElementsRef.current.forEach(el => { el.style.display = show ? 'none' : '' })
        if (show) buildBubbles()
        else removeBubbles()
      }
      syncCountyBubbles()
      map.on('zoom', syncCountyBubbles)
    })

    return () => {
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
      map.remove()
      mapRef.current = null
    }
  }, [comparables, stateSales, subjectCounty, subjectState, subjectLatitude, subjectLongitude, subjectAcres, subjectPolygon, visibleIds])

  // Update marker styles when selectedIds changes (without recreating map)
  useEffect(() => {
    markerElementsRef.current.forEach((el, id) => {
      const label = el.querySelector('.comp-marker-label') as HTMLElement
      const pin = el.querySelector('.comp-marker-pin') as HTMLElement
      if (!label || !pin) return
      if (selectedIds.has(id)) {
        label.classList.add('selected')
        pin.classList.add('selected')
      } else {
        label.classList.remove('selected')
        pin.classList.remove('selected')
      }
    })
  }, [selectedIds])

  return (
    <div className="comparables-map-container" style={{ height }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="sale-modal-overlay" onClick={() => setSelectedSale(null)}>
          <div className="sale-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="sale-modal-header">
              <h3 className="sale-modal-title">Tract Sale</h3>
              <button className="sale-modal-close" onClick={() => setSelectedSale(null)}>✕</button>
            </div>
            <div className="sale-modal-body">
              <div className="sale-modal-row">
                <span className="sale-modal-label">Date Sold</span>
                <span className="sale-modal-value">{formatDate(selectedSale.auctionDate)}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Sold Acres</span>
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
              <div className="sale-modal-row">
                <span className="sale-modal-label">Total Sale Price</span>
                <span className="sale-modal-value">{formatCurrency(selectedSale.salePrice)}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Price/Acre</span>
                <span className="sale-modal-value">
                  {selectedSale.pricePerAcre ? formatCurrency(selectedSale.pricePerAcre) + '/ac' : '—'}
                </span>
              </div>
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
              {selectedSale.tillableAcres && (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Tillable Acres</span>
                  <span className="sale-modal-value">{formatAcres(selectedSale.tillableAcres)} ac</span>
                </div>
              )}
              {selectedSale.tillableAcres && selectedSale.pricePerAcre && selectedSale.totalAcres && (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">$/Tillable Acre</span>
                  <span className="sale-modal-value">{formatCurrency((selectedSale.pricePerAcre * selectedSale.totalAcres) / selectedSale.tillableAcres)}/ac</span>
                </div>
              )}
              {selectedSale.soilRating && selectedSale.pricePerAcre && (
                <div className="sale-modal-row" style={{ borderBottom: 'none' }}>
                  <span className="sale-modal-label">$/Soil Rating</span>
                  <span className="sale-modal-value">{formatCurrency(selectedSale.pricePerAcre / selectedSale.soilRating)}</span>
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

            {/* Add / Remove from email list */}
            {toggleSelection && (() => {
              const isInList = selectedIds.has(selectedSale.id)
              return (
                <button
                  className={`sale-modal-action-btn ${isInList ? 'remove' : ''}`}
                  onClick={() => {
                    toggleSelection({ id: selectedSale.id })
                    setSelectedSale(null)
                  }}
                >
                  {isInList ? '− Remove from Report' : '+ Add to Report'}
                </button>
              )
            })()}
          </div>
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
  isSelected: boolean = false
): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'

  const label = document.createElement('div')
  label.className = `comp-marker-label${isSelected ? ' selected' : ''}`

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

  const pin = document.createElement('div')
  pin.className = `comp-marker-pin comparable${isSelected ? ' selected' : ''}`
  container.appendChild(pin)

  return container
}

function createSubjectMarkerElement(acres: number | null): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'

  const label = document.createElement('div')
  label.className = 'comp-marker-label subject'

  const priceEl = document.createElement('div')
  priceEl.className = 'comp-marker-price'
  priceEl.style.color = '#F58CDE'
  priceEl.textContent = 'Subject Tract'
  label.appendChild(priceEl)

  if (acres) {
    const acresEl = document.createElement('div')
    acresEl.className = 'comp-marker-acres'
    acresEl.textContent = `${formatAcres(acres)} ac`
    label.appendChild(acresEl)
  }

  container.appendChild(label)

  const pin = document.createElement('div')
  pin.className = 'comp-marker-pin subject'
  container.appendChild(pin)

  return container
}
