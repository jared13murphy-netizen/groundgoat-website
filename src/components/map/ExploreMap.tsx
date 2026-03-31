'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ComparablesMap.css'
import './TractMap.css'
import type { ApiMapTract, MapTractsResponse } from './exploreMapTypes'
import {
  buildExplorePolygonGeoJSON,
  buildExploreStateAggregates,
} from './exploreMapTransform'
import {
  MAP_CENTER,
  MAP_INITIAL_ZOOM,
  TILE_URL,
  TILE_ATTRIBUTION,
  GLYPH_URL,
  ZOOM_TIER_1_MAX,
  STATUS_COLORS,
} from './mapConstants'
import fetchWithAuth from '@/lib/fetchWithAuth'
import Tract3DModal from '@/components/Tract3DModal'
import { countyCentroids } from '@/data/countyCentroids'
import { STATE_ABBR } from './mapConstants'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Pin colors by sale status (matching mobile app)
const PIN_COLORS: Record<string, string> = {
  sold: '#22c55e',
  listed: '#3b82f6',
  active: '#3b82f6',
  live: '#16a34a',
  pending: '#f59e0b',
  no_sale: '#6b7280',
}
const DEFAULT_PIN_COLOR = '#DC2626'

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
  return acres.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface SaleDetail {
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
}

interface ExploreMapProps {
  height?: string
  homeState?: string
  homeCounty?: string
}

export default function ExploreMap({ height = 'calc(100vh - 220px)', homeState, homeCounty }: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const stateMarkersRef = useRef<maplibregl.Marker[]>([])
  const tractMarkersRef = useRef<maplibregl.Marker[]>([])
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedCellsRef = useRef<Set<string>>(new Set())
  const tractMapRef = useRef<Map<string, ApiMapTract>>(new Map())

  const [tracts, setTracts] = useState<ApiMapTract[]>([])
  const [currentZoom, setCurrentZoom] = useState(MAP_INITIAL_ZOOM)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [show3DViewer, setShow3DViewer] = useState(false)

  const polygonGeoJSON = useMemo(() => buildExplorePolygonGeoJSON(tracts), [tracts])
  const stateAggregates = useMemo(() => buildExploreStateAggregates(tracts), [tracts])

  // Load tracts for a bounding box
  const loadTractsForBounds = useCallback(async (bounds: {
    min_lat: number; max_lat: number; min_lng: number; max_lng: number
  }) => {
    const { min_lat, max_lat, min_lng, max_lng } = bounds

    const gridKey = `${Math.floor(min_lat * 10)},${Math.floor(min_lng * 10)},${Math.floor(max_lat * 10)},${Math.floor(max_lng * 10)}`
    if (loadedCellsRef.current.has(gridKey)) return
    loadedCellsRef.current.add(gridKey)

    try {
      setLoading(true)
      const url = `${API_URL}/api/map/tracts?min_lat=${min_lat}&max_lat=${max_lat}&min_lng=${min_lng}&max_lng=${max_lng}&limit=500`
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data: MapTractsResponse = await response.json()
        if (data.tracts) {
          data.tracts.forEach(t => {
            tractMapRef.current.set(t.id, t)
          })
          setTracts(Array.from(tractMapRef.current.values()))
        }
      }
    } catch (err) {
      console.error('Failed to load map tracts:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Handle map move — debounced viewport loading
  const handleMoveEnd = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      const map = mapRef.current
      if (!map) return
      const bounds = map.getBounds()
      loadTractsForBounds({
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lng: bounds.getWest(),
        max_lng: bounds.getEast(),
      })
    }, 500)
  }, [loadTractsForBounds])

  // Calculate initial center from home county
  const initialCenter = useMemo((): [number, number] => {
    if (homeState && homeCounty) {
      const stateAbbr = STATE_ABBR[homeState] || homeState
      const key = `${homeCounty}, ${stateAbbr}`
      const centroid = countyCentroids[key]
      if (centroid) {
        return [centroid[1], centroid[0]] // [lng, lat] — countyCentroids stores [lat, lng]
      }
    }
    return MAP_CENTER
  }, [homeState, homeCounty])

  const initialZoom = homeState && homeCounty ? 9 : MAP_INITIAL_ZOOM

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
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
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
      map.addLayer({
        id: 'tract-polygon-fill',
        type: 'fill',
        source: 'tract-polygons',
        paint: {
          'fill-color': '#E91E8C',
          'fill-opacity': 0.08,
        },
      })
      map.addLayer({
        id: 'tract-polygon-line',
        type: 'line',
        source: 'tract-polygons',
        paint: {
          'line-color': '#E91E8C',
          'line-width': 2,
          'line-opacity': 0.8,
        },
      })
    }
  }, [mapLoaded, polygonGeoJSON])

  // Create/update HTML markers for tracts
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Remove old tract markers
    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []

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

    for (const tract of tracts) {
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

      const el = createMarkerElement(
        tract.price_per_acre,
        tract.total_acres,
        tract.sale_status
      )

      // Click to open modal
      el.addEventListener('click', () => {
        setSelectedSale({
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
        })
      })

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([markerLng, markerLat])
        .addTo(map)

      tractMarkersRef.current.push(marker)
    }
  }, [mapLoaded, tracts])

  // Manage state card markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    stateMarkersRef.current.forEach(m => m.remove())
    stateMarkersRef.current = []

    for (const agg of stateAggregates) {
      const el = document.createElement('div')
      el.innerHTML = `
        <div class="state-card">
          <div class="state-card-name">${agg.state}</div>
          <div class="state-card-count">${agg.count} tract${agg.count !== 1 ? 's' : ''}</div>
        </div>
      `
      el.addEventListener('click', () => {
        map.fitBounds(agg.bounds, { padding: 50, duration: 1000 })
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([agg.centerLng, agg.centerLat])
        .addTo(map)

      stateMarkersRef.current.push(marker)
    }

    updateStateCardVisibility(map.getZoom())
  }, [mapLoaded, stateAggregates])

  // Toggle state card visibility on zoom
  useEffect(() => {
    updateStateCardVisibility(currentZoom)
  }, [currentZoom])

  function updateStateCardVisibility(zoom: number) {
    const visible = zoom <= ZOOM_TIER_1_MAX
    stateMarkersRef.current.forEach(m => {
      m.getElement().style.display = visible ? 'block' : 'none'
    })
  }

  const getStatusLabel = (status: string | null | undefined) => {
    if (!status) return 'Unknown'
    switch (status.toLowerCase()) {
      case 'sold': return 'Sold'
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

      {/* Tract count */}
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
          { label: 'Sold', color: '#22c55e' },
          { label: 'Listed', color: '#3b82f6' },
          { label: 'Pending', color: '#f59e0b' },
          { label: 'No Sale', color: '#6b7280' },
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
              <div className="sale-modal-row">
                <span className="sale-modal-label">Listing Company</span>
                <span className="sale-modal-value">{selectedSale.companyName || '—'}</span>
              </div>
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
                <span className="sale-modal-value">{selectedSale.township || '—'}</span>
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
                <div className="sale-modal-row" style={{ borderBottom: 'none' }}>
                  <span className="sale-modal-label">$/Soil Rating</span>
                  <span className="sale-modal-value">{formatCurrency(selectedSale.pricePerAcre / selectedSale.soilRating)}</span>
                </div>
              ) : null}
            </div>

            {/* View 3D Terrain */}
            {selectedSale.polygonCoordinates && selectedSale.polygonCoordinates.length > 2 && (
              <button
                className="sale-modal-action-btn"
                style={{ backgroundColor: '#E91E8C', color: '#fff', marginBottom: '8px' }}
                onClick={() => setShow3DViewer(true)}
              >
                🏔 View 3D Terrain
              </button>
            )}

            {/* View Listing */}
            {selectedSale.listingId && (
              <a
                href={`/listings/${selectedSale.listingId}`}
                className="sale-modal-action-btn"
                style={{ textDecoration: 'none', marginBottom: '16px' }}
              >
                View Listing →
              </a>
            )}
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
  status: string | null,
): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'

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

  const pin = document.createElement('div')
  pin.className = 'comp-marker-pin comparable'
  pin.style.backgroundColor = getStatusPinColor(status)
  container.appendChild(pin)

  return container
}
