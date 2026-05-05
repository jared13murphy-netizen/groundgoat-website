'use client'

/**
 * AdminFastMap — progressive-disclosure map for the admin dashboard.
 *
 * Eventually replaces ExploreMap. For now it lives at the bottom of
 * /admin/dashboard so we can iterate without disrupting the customer
 * experience.
 *
 * Architecture differs from ExploreMap in one critical way:
 *   ExploreMap creates a `new maplibregl.Marker({ element: el })` per
 *   tract. With 50K tracts that's 50K DOM nodes — the browser chokes
 *   on layout/paint as you pan/zoom.
 *
 * Here we use NATIVE MapLibre layers (heatmap, circle, symbol) which
 * render on the GPU. DOM price-bubble markers only kick in at zoom
 * >= PIN_ZOOM_THRESHOLD when there are at most a few dozen tracts
 * visible.
 *
 * Layer plan:
 *   z 0–HEATMAP_FADE_OUT_ZOOM      → heatmap (density)
 *   z CLUSTER_MIN_ZOOM–CLUSTER_MAX → clustered count bubbles
 *   z PIN_ZOOM_THRESHOLD+          → DOM price-bubble pins + polygons
 *
 * State_parcels overlay (from the tile server) is intentionally not
 * wired up yet — the user wants the perf foundation first, parcels
 * dropped in later as another vector source.
 */

import { useRef, useEffect, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ComparablesMap.css'
import './TractMap.css'
import type { ApiMapTract, MapTractsResponse } from './exploreMapTypes'
import {
  TILE_URL,
  TILE_ATTRIBUTION,
  GLYPH_URL,
} from './mapConstants'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Zoom thresholds. These tune the user experience — the fades between
// layers are GPU-driven so the user just sees one continuous map that
// reveals more detail as they zoom in.
const HEATMAP_FADE_OUT_ZOOM = 8       // heatmap visible until here
const CLUSTER_MIN_ZOOM = 6            // clusters appear here
const CLUSTER_MAX_ZOOM = 12           // clusters fully replaced by points by this zoom
const PIN_ZOOM_THRESHOLD = 12         // DOM price-bubble pins above this
const POLYGON_ZOOM_THRESHOLD = 13     // tract polygons above this

// Pin colors — shared with ExploreMap
const PIN_COLORS: Record<string, string> = {
  sold: '#f58cde',
  auction: '#2563eb',
  listed: '#eab308',
  active: '#eab308',
  live: '#22c55e',
  pending: '#eab308',
  no_sale: '#9ca3af',
}
const DEFAULT_PIN_COLOR = '#eab308'

function getStatusPinColor(status: string | null): string {
  if (!status) return DEFAULT_PIN_COLOR
  return PIN_COLORS[status.toLowerCase()] || DEFAULT_PIN_COLOR
}

function formatCurrency(amount: number | null | undefined): string {
  if (!amount) return '—'
  return '$' + Math.round(amount).toLocaleString('en-US')
}

function formatAcres(acres: number | null | undefined): string {
  if (!acres) return '—'
  return acres.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
}

// Same admission rule ExploreMap uses — drop tracts without polygons,
// finished auctions with no recorded result, etc.
function isAcceptableMapTract(t: ApiMapTract, now: Date): boolean {
  // For points/heatmap we don't strictly need polygons — a tract can
  // contribute to density even without a drawn shape — but ExploreMap
  // hides them, so until parity is reached we follow the same rule.
  if (
    !t.polygon_coordinates ||
    !Array.isArray(t.polygon_coordinates) ||
    t.polygon_coordinates.length < 3
  ) {
    // Allow point-only tracts at low zoom (heatmap + clusters), since
    // a parcel without a drawn polygon still represents a sale.
    if (!t.latitude || !t.longitude) return false
  }
  const isAuctionListing = t.listing_type === 'auction'
  const auctionInPast =
    !!t.auction_date && new Date(t.auction_date as string) < now
  const unfinalized =
    !t.sale_status || ['auction', 'listed'].includes(t.sale_status)
  if (isAuctionListing && auctionInPast && unfinalized) return false
  const isListed =
    t.listing_status === 'listed' || t.listing_status === 'live'
  const hasFutureAuction =
    !!t.auction_date && new Date(t.auction_date as string) >= now
  return !!(t.sale_status || isListed || hasFutureAuction)
}

function getPolygonCentroid(
  coords: [number, number][],
): [number, number] | null {
  if (!coords || coords.length < 3) return null
  let sumLng = 0
  let sumLat = 0
  for (const [lng, lat] of coords) {
    sumLng += lng
    sumLat += lat
  }
  return [sumLng / coords.length, sumLat / coords.length]
}

function getTractPoint(t: ApiMapTract): [number, number] | null {
  if (t.polygon_coordinates && t.polygon_coordinates.length >= 3) {
    const c = getPolygonCentroid(t.polygon_coordinates)
    if (c) return c
  }
  if (t.latitude && t.longitude) return [t.longitude, t.latitude]
  return null
}

interface AdminFastMapProps {
  height?: string
}

export default function AdminFastMap({ height = '700px' }: AdminFastMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [currentZoom, setCurrentZoom] = useState<number>(4)
  const [tractCount, setTractCount] = useState(0)
  const [loading, setLoading] = useState(false)

  // Canonical store: id → tract. Re-built into a GeoJSON
  // FeatureCollection whenever it grows.
  const tractMapRef = useRef<Map<string, ApiMapTract>>(new Map())
  const loadedCellsRef = useRef<Set<string>>(new Set())
  const loadingCellsRef = useRef<Set<string>>(new Set())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // DOM marker pool — only populated when zoom is high enough to need them.
  const pinMarkersRef = useRef<maplibregl.Marker[]>([])

  // Push the canonical tract map into the source as a FeatureCollection.
  const pushTractsToSource = useCallback(() => {
    const map = mapRef.current
    if (!map || !map.getSource('tract-points')) return
    const features: GeoJSON.Feature[] = []
    for (const t of tractMapRef.current.values()) {
      const point = getTractPoint(t)
      if (!point) continue
      const isPrivateTreaty =
        (t.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = (t.sale_status || '').toLowerCase() === 'pending'
      const ppa =
        (isPrivateTreaty || isPending) && t.asking_price && t.total_acres
          ? t.asking_price / t.total_acres
          : t.price_per_acre
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: point },
        properties: {
          id: t.id,
          status: (t.sale_status || '').toLowerCase(),
          listing_status: t.listing_status,
          listing_type: t.listing_type,
          color: getStatusPinColor(t.sale_status),
          ppa: ppa || 0,
          acres: t.total_acres || 0,
          // weight: density contribution. Tracts with bigger acreage
          // count more on the heatmap (capped) — a single 1000-ac tract
          // is more market-significant than a single 5-ac parcel.
          weight: Math.min(1, (t.total_acres || 5) / 200),
        },
      })
    }
    const source = map.getSource('tract-points') as maplibregl.GeoJSONSource
    source.setData({ type: 'FeatureCollection', features })
    setTractCount(features.length)
  }, [])

  // Load tracts in a bbox cell. Same caching scheme as ExploreMap so a
  // pan back to a region we've already seen is free.
  const loadTractsForBounds = useCallback(
    async (bounds: {
      min_lat: number
      max_lat: number
      min_lng: number
      max_lng: number
    }) => {
      const { min_lat, max_lat, min_lng, max_lng } = bounds
      const r = (v: number) => Math.round(v * 2) / 2
      const gridKey = `${r(min_lat)},${r(min_lng)},${r(max_lat)},${r(max_lng)}`
      if (loadedCellsRef.current.has(gridKey)) return
      if (loadingCellsRef.current.has(gridKey)) return
      loadingCellsRef.current.add(gridKey)

      // include_polygons only above POLYGON_ZOOM_THRESHOLD. At low zoom
      // we just need a centroid for the heatmap and clusters; sending
      // polygon WKT bloats the payload 10–50×.
      const map = mapRef.current
      const z = map ? map.getZoom() : 0
      const includePolygons = z >= POLYGON_ZOOM_THRESHOLD

      let cellComplete = false
      try {
        setLoading(true)
        const url =
          `${API_URL}/api/map/tracts?` +
          `min_lat=${min_lat}&max_lat=${max_lat}` +
          `&min_lng=${min_lng}&max_lng=${max_lng}` +
          `&limit=1000&include_polygons=${includePolygons}`
        const response = await fetchWithAuth(url)
        if (response.ok) {
          const data: MapTractsResponse = await response.json()
          if (data.tracts) {
            cellComplete = data.tracts.length < 1000
            const now = new Date()
            for (const t of data.tracts) {
              if (isAcceptableMapTract(t, now)) {
                tractMapRef.current.set(t.id, t)
              }
            }
            pushTractsToSource()
          }
        }
      } catch (err) {
        console.error('[AdminFastMap] cell load failed:', err)
      } finally {
        loadingCellsRef.current.delete(gridKey)
        if (cellComplete) loadedCellsRef.current.add(gridKey)
        setLoading(false)
      }
    },
    [pushTractsToSource],
  )

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
      // Single GeoJSON source backs ALL three native layers. Clustering
      // is enabled — MapLibre maintains a parallel cluster index that
      // we use for the cluster bubble layer.
      map.addSource('tract-points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterRadius: 50,
      })

      // ── Heatmap layer (low zoom). MapLibre's native heatmap is GPU-
      // accelerated and stays smooth at any tract count. We weight by
      // tract acreage so big sales count more.
      map.addLayer({
        id: 'tract-heatmap',
        type: 'heatmap',
        source: 'tract-points',
        maxzoom: HEATMAP_FADE_OUT_ZOOM,
        paint: {
          'heatmap-weight': ['get', 'weight'],
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            0, 0.5,
            6, 1.2,
          ],
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            0, 8,
            4, 18,
            6, 30,
            8, 40,
          ],
          'heatmap-opacity': [
            'interpolate', ['linear'], ['zoom'],
            HEATMAP_FADE_OUT_ZOOM - 1, 0.85,
            HEATMAP_FADE_OUT_ZOOM, 0,
          ],
          // Pink-leaning palette — keeps the brand color present even
          // at the macro view, and contrasts with the OSM gray.
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,0,0)',
            0.2, 'rgba(91,33,182,0.45)',   // deep purple
            0.4, 'rgba(220,38,127,0.65)',  // magenta
            0.6, 'rgba(245,140,222,0.8)',  // gg-pink
            0.8, 'rgba(253,224,71,0.9)',   // yellow-hot
            1, 'rgba(255,255,255,1)',      // hot core
          ],
        },
      })

      // ── Cluster bubbles. Larger clusters = bigger + warmer.
      map.addLayer({
        id: 'tract-clusters',
        type: 'circle',
        source: 'tract-points',
        filter: ['has', 'point_count'],
        minzoom: CLUSTER_MIN_ZOOM,
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#7c3aed', 10,
            '#db2777', 50,
            '#f58cde', 200,
            '#fde047',
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            14, 10,
            18, 50,
            24, 200,
            32,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': [
            'interpolate', ['linear'], ['zoom'],
            CLUSTER_MIN_ZOOM, 0,
            CLUSTER_MIN_ZOOM + 1, 0.95,
          ],
        },
      })

      map.addLayer({
        id: 'tract-cluster-counts',
        type: 'symbol',
        source: 'tract-points',
        filter: ['has', 'point_count'],
        minzoom: CLUSTER_MIN_ZOOM,
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': ['Open Sans Regular'],
          'text-size': 13,
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.2,
        },
      })

      // ── Individual point dots. These sit between cluster zoom and
      // pin zoom, giving the user a smooth "the cluster split into
      // individual properties" moment.
      map.addLayer({
        id: 'tract-points-dot',
        type: 'circle',
        source: 'tract-points',
        filter: ['!', ['has', 'point_count']],
        minzoom: CLUSTER_MIN_ZOOM,
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': [
            'interpolate', ['linear'], ['zoom'],
            CLUSTER_MIN_ZOOM, 3,
            CLUSTER_MAX_ZOOM, 6,
            PIN_ZOOM_THRESHOLD, 7,
          ],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
          // Fade the dots OUT once DOM pins take over at PIN_ZOOM_THRESHOLD,
          // so we don't double-render every tract.
          'circle-opacity': [
            'interpolate', ['linear'], ['zoom'],
            PIN_ZOOM_THRESHOLD - 0.5, 1,
            PIN_ZOOM_THRESHOLD + 0.5, 0,
          ],
          'circle-stroke-opacity': [
            'interpolate', ['linear'], ['zoom'],
            PIN_ZOOM_THRESHOLD - 0.5, 1,
            PIN_ZOOM_THRESHOLD + 0.5, 0,
          ],
        },
      })

      // Click a cluster → zoom to expand it
      map.on('click', 'tract-clusters', (e) => {
        if (!e.features || e.features.length === 0) return
        const feat = e.features[0]
        if (feat.geometry.type !== 'Point') return
        const clusterId = feat.properties?.cluster_id
        const src = map.getSource('tract-points') as maplibregl.GeoJSONSource
        if (clusterId == null || !src.getClusterExpansionZoom) return
        src.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({
            center: feat.geometry.type === 'Point'
              ? (feat.geometry.coordinates as [number, number])
              : map.getCenter(),
            zoom,
          })
        }).catch(() => {})
      })

      // Hover cursor for clusters and points
      const setPointer = () => { map.getCanvas().style.cursor = 'pointer' }
      const clearPointer = () => { map.getCanvas().style.cursor = '' }
      map.on('mouseenter', 'tract-clusters', setPointer)
      map.on('mouseleave', 'tract-clusters', clearPointer)
      map.on('mouseenter', 'tract-points-dot', setPointer)
      map.on('mouseleave', 'tract-points-dot', clearPointer)

      mapRef.current = map
      setMapLoaded(true)
      setCurrentZoom(map.getZoom())
    })

    map.on('zoom', () => {
      setCurrentZoom(map.getZoom())
    })

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      pinMarkersRef.current.forEach(m => m.remove())
      pinMarkersRef.current = []
      try { map.remove() } catch {}
      mapRef.current = null
      setMapLoaded(false)
    }
  }, [])

  // Bbox-bound load on moveend, debounced. Same 0.5° grid as ExploreMap.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const handleMoveEnd = () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = setTimeout(() => {
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
      }, 300)
    }

    map.on('moveend', handleMoveEnd)
    // Kick off the initial fetch
    handleMoveEnd()

    return () => {
      map.off('moveend', handleMoveEnd)
    }
  }, [mapLoaded, loadTractsForBounds])

  // DOM price-bubble pins ONLY at high zoom. Above PIN_ZOOM_THRESHOLD
  // the viewport rarely contains more than ~80 tracts, so the DOM
  // overhead is fine. Below that threshold we skip this entirely.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    if (currentZoom < PIN_ZOOM_THRESHOLD) {
      pinMarkersRef.current.forEach(m => m.remove())
      pinMarkersRef.current = []
      return
    }

    const bounds = map.getBounds()
    const inView = (lng: number, lat: number) =>
      lng >= bounds.getWest() &&
      lng <= bounds.getEast() &&
      lat >= bounds.getSouth() &&
      lat <= bounds.getNorth()

    pinMarkersRef.current.forEach(m => m.remove())
    pinMarkersRef.current = []

    for (const tract of tractMapRef.current.values()) {
      const pt = getTractPoint(tract)
      if (!pt) continue
      const [lng, lat] = pt
      if (!inView(lng, lat)) continue

      const isPrivateTreaty =
        (tract.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = (tract.sale_status || '').toLowerCase() === 'pending'
      const ppa =
        (isPrivateTreaty || isPending) && tract.asking_price && tract.total_acres
          ? tract.asking_price / tract.total_acres
          : tract.price_per_acre

      const el = document.createElement('div')
      el.className = 'comp-marker'
      const label = document.createElement('div')
      label.className = 'comp-marker-label'
      if (ppa) {
        const priceEl = document.createElement('div')
        priceEl.className = 'comp-marker-price'
        priceEl.textContent = `${formatCurrency(ppa)}/ac`
        label.appendChild(priceEl)
      }
      if (tract.total_acres) {
        const acresEl = document.createElement('div')
        acresEl.className = 'comp-marker-acres'
        acresEl.textContent = `${formatAcres(tract.total_acres)} ac`
        label.appendChild(acresEl)
      }
      el.appendChild(label)
      const pin = document.createElement('div')
      pin.className = 'comp-marker-pin comparable'
      pin.style.backgroundColor = getStatusPinColor(tract.sale_status)
      el.appendChild(pin)

      el.addEventListener('click', () => {
        if (tract.listing_id) {
          window.open(`/listings/${tract.listing_id}`, '_blank')
        }
      })

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map)
      pinMarkersRef.current.push(marker)
    }
  }, [mapLoaded, currentZoom, tractCount])

  const tier =
    currentZoom < HEATMAP_FADE_OUT_ZOOM
      ? 'Heatmap'
      : currentZoom < PIN_ZOOM_THRESHOLD
        ? 'Clusters'
        : 'Pins'

  return (
    <div className="relative">
      <div ref={containerRef} style={{ height, borderRadius: 12 }} />
      <div className="absolute top-3 left-3 bg-gg-black/80 text-white text-xs px-3 py-1.5 rounded-md backdrop-blur z-10 pointer-events-none">
        <span className="text-gg-pink font-semibold">{tier}</span>
        <span className="text-gg-gray-400 mx-2">·</span>
        <span>z {currentZoom.toFixed(1)}</span>
        <span className="text-gg-gray-400 mx-2">·</span>
        <span>{tractCount.toLocaleString()} tracts loaded</span>
        {loading && (
          <>
            <span className="text-gg-gray-400 mx-2">·</span>
            <span className="text-gg-pink animate-pulse">loading…</span>
          </>
        )}
      </div>
    </div>
  )
}
