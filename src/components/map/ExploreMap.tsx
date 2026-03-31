'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './TractMap.css'
import type { ApiMapTract, MapTractsResponse } from './exploreMapTypes'
import {
  buildExplorePointGeoJSON,
  buildExplorePolygonGeoJSON,
  buildExploreStateAggregates,
} from './exploreMapTransform'
import { buildExplorePopupHTML } from './tractPopup'
import {
  MAP_CENTER,
  MAP_INITIAL_ZOOM,
  TILE_URL,
  TILE_ATTRIBUTION,
  GLYPH_URL,
  ZOOM_TIER_1_MAX,
  ZOOM_TIER_3_MIN,
} from './mapConstants'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Status color match expressions for MapLibre paint properties
const STATUS_FILL_MATCH: maplibregl.ExpressionSpecification = [
  'match', ['get', 'status'],
  'listed', '#2563EB',
  'active', '#2563EB',
  'live', '#16A34A',
  'sold', '#22c55e',
  'pending', '#f59e0b',
  'no_sale', '#6B7280',
  '#888888',
]

const STATUS_BORDER_MATCH: maplibregl.ExpressionSpecification = [
  'match', ['get', 'status'],
  'listed', '#1D4ED8',
  'active', '#1D4ED8',
  'live', '#15803D',
  'sold', '#16a34a',
  'pending', '#d97706',
  'no_sale', '#4B5563',
  '#555555',
]

const STATUS_OPACITY_MATCH: maplibregl.ExpressionSpecification = [
  'match', ['get', 'status'],
  'listed', 0.25,
  'active', 0.25,
  'live', 0.30,
  'sold', 0.20,
  'pending', 0.20,
  'no_sale', 0.15,
  0.20,
]

const STATUS_LEGEND = [
  { label: 'Sold', color: '#22c55e' },
  { label: 'Listed', color: '#2563EB' },
  { label: 'Pending', color: '#f59e0b' },
  { label: 'No Sale', color: '#6B7280' },
]

interface ExploreMapProps {
  height?: string
}

export default function ExploreMap({ height = 'calc(100vh - 220px)' }: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const stateMarkersRef = useRef<maplibregl.Marker[]>([])
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedCellsRef = useRef<Set<string>>(new Set())
  const tractMapRef = useRef<Map<string, ApiMapTract>>(new Map())

  const [tracts, setTracts] = useState<ApiMapTract[]>([])
  const [currentZoom, setCurrentZoom] = useState(MAP_INITIAL_ZOOM)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(['sold', 'listed', 'active', 'live', 'pending', 'no_sale']))

  // Filter tracts by status
  const filteredTracts = useMemo(() => {
    return tracts.filter(t => statusFilter.has(t.sale_status || 'listed'))
  }, [tracts, statusFilter])

  const pointGeoJSON = useMemo(() => buildExplorePointGeoJSON(filteredTracts), [filteredTracts])
  const polygonGeoJSON = useMemo(() => buildExplorePolygonGeoJSON(filteredTracts), [filteredTracts])
  const stateAggregates = useMemo(() => buildExploreStateAggregates(filteredTracts), [filteredTracts])

  // Load tracts for a bounding box
  const loadTractsForBounds = useCallback(async (bounds: {
    min_lat: number; max_lat: number; min_lng: number; max_lng: number
  }) => {
    const { min_lat, max_lat, min_lng, max_lng } = bounds

    // Grid-cell caching (0.1-degree cells)
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
          },
        ],
        glyphs: GLYPH_URL,
      },
      center: MAP_CENTER,
      zoom: MAP_INITIAL_ZOOM,
      maxZoom: 18,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      mapRef.current = map
      setMapLoaded(true)

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

  // Add/update sources and layers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Update or add point source
    const pointSource = map.getSource('tract-points') as maplibregl.GeoJSONSource
    if (pointSource) {
      pointSource.setData(pointGeoJSON)
    } else {
      map.addSource('tract-points', {
        type: 'geojson',
        data: pointGeoJSON,
        cluster: true,
        clusterMaxZoom: ZOOM_TIER_3_MIN - 1,
        clusterRadius: 50,
      })

      // Cluster circles
      map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: 'tract-points',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#f58cde',
          'circle-radius': [
            'step', ['get', 'point_count'],
            18,
            10, 22,
            50, 28,
            100, 35,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'tract-points',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['Open Sans Bold'],
          'text-size': 13,
        },
        paint: {
          'text-color': '#ffffff',
        },
      })

      // Unclustered points
      map.addLayer({
        id: 'tract-points-exact',
        type: 'circle',
        source: 'tract-points',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 7,
          'circle-color': STATUS_FILL_MATCH,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
          'circle-stroke-opacity': 0.9,
        },
        minzoom: ZOOM_TIER_3_MIN,
      })

      // Price/acre labels at high zoom
      map.addLayer({
        id: 'tract-labels',
        type: 'symbol',
        source: 'tract-points',
        filter: ['!', ['has', 'point_count']],
        layout: {
          'text-field': [
            'case',
            ['>', ['get', 'pricePerAcre'], 0],
            ['concat',
              '$',
              ['number-format', ['get', 'pricePerAcre'], { 'max-fraction-digits': 0 }],
              '/ac',
            ],
            '',
          ],
          'text-font': ['Open Sans Bold'],
          'text-size': 11,
          'text-offset': [0, -1.8],
          'text-anchor': 'bottom',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 1.5,
        },
        minzoom: 12,
      })
    }

    // Update or add polygon source
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
          'fill-color': STATUS_FILL_MATCH,
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false],
            0.45,
            STATUS_OPACITY_MATCH,
          ],
        },
        minzoom: ZOOM_TIER_3_MIN,
      })

      map.addLayer({
        id: 'tract-polygon-border',
        type: 'line',
        source: 'tract-polygons',
        paint: {
          'line-color': STATUS_BORDER_MATCH,
          'line-width': 2,
        },
        minzoom: ZOOM_TIER_3_MIN,
      })

      // Setup interactions
      setupInteractions(map)
    }
  }, [mapLoaded, pointGeoJSON, polygonGeoJSON])

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

  function setupInteractions(map: maplibregl.Map) {
    let hoveredPolygonId: string | number | null = null

    // Polygon hover
    map.on('mousemove', 'tract-polygon-fill', (e) => {
      if (e.features && e.features.length > 0) {
        map.getCanvas().style.cursor = 'pointer'
        if (hoveredPolygonId !== null) {
          map.setFeatureState(
            { source: 'tract-polygons', id: hoveredPolygonId },
            { hover: false }
          )
        }
        hoveredPolygonId = e.features[0].id ?? null
        if (hoveredPolygonId !== null) {
          map.setFeatureState(
            { source: 'tract-polygons', id: hoveredPolygonId },
            { hover: true }
          )
        }
      }
    })

    map.on('mouseleave', 'tract-polygon-fill', () => {
      map.getCanvas().style.cursor = ''
      if (hoveredPolygonId !== null) {
        map.setFeatureState(
          { source: 'tract-polygons', id: hoveredPolygonId },
          { hover: false }
        )
        hoveredPolygonId = null
      }
    })

    // Cursor for interactive layers
    for (const layerId of ['cluster-circles', 'tract-points-exact']) {
      map.on('mouseenter', layerId, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', layerId, () => {
        map.getCanvas().style.cursor = ''
      })
    }

    // Cluster click — zoom in
    map.on('click', 'cluster-circles', async (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ['cluster-circles'] })
      if (!features.length) return

      const clusterId = features[0].properties.cluster_id
      const source = map.getSource('tract-points') as maplibregl.GeoJSONSource

      try {
        const zoom = await source.getClusterExpansionZoom(clusterId)
        const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number]
        map.easeTo({ center: coords, zoom: zoom + 0.5, duration: 500 })
      } catch {
        // Ignore errors
      }
    })

    // Tract point click — show popup
    const showTractPopup = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features || !e.features.length) return
      const feature = e.features[0]
      const coords = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number]
      const props = feature.properties

      popupRef.current?.remove()

      popupRef.current = new maplibregl.Popup({ className: 'tract-popup', maxWidth: '320px' })
        .setLngLat(coords)
        .setHTML(buildExplorePopupHTML(props))
        .addTo(map)
    }

    map.on('click', 'tract-points-exact', showTractPopup)

    // Polygon click — show popup
    map.on('click', 'tract-polygon-fill', (e) => {
      if (!e.features || !e.features.length) return
      const feature = e.features[0]
      const props = feature.properties

      popupRef.current?.remove()

      popupRef.current = new maplibregl.Popup({ className: 'tract-popup', maxWidth: '320px' })
        .setLngLat(e.lngLat)
        .setHTML(buildExplorePopupHTML(props))
        .addTo(map)
    })
  }

  function toggleStatus(status: string) {
    setStatusFilter(prev => {
      const next = new Set(prev)
      if (next.has(status)) {
        // Don't allow deselecting all
        if (next.size > 1) next.delete(status)
      } else {
        next.add(status)
      }
      return next
    })
  }

  return (
    <div className="relative" style={{ height }}>
      <div
        ref={containerRef}
        className="tract-map-container"
        style={{ height: '100%' }}
      />

      {/* Loading indicator */}
      {loading && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-black/80 backdrop-blur-sm text-white text-sm px-4 py-2 rounded-full flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Loading tracts...
          </div>
        </div>
      )}

      {/* Status filter chips */}
      <div className="absolute top-4 left-4 z-10 flex gap-2">
        {STATUS_LEGEND.map(({ label, color }) => {
          const statusKey = label.toLowerCase().replace(' ', '_')
          const isActive = statusFilter.has(statusKey)
          return (
            <button
              key={statusKey}
              onClick={() => toggleStatus(statusKey)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                isActive
                  ? 'bg-black/80 text-white backdrop-blur-sm'
                  : 'bg-black/40 text-white/50 backdrop-blur-sm'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  backgroundColor: color,
                  opacity: isActive ? 1 : 0.3,
                }}
              />
              {label}
            </button>
          )
        })}
      </div>

      {/* Tract count */}
      <div className="absolute bottom-4 right-4 z-10">
        <div className="bg-black/80 backdrop-blur-sm text-white/70 text-xs px-3 py-1.5 rounded-full">
          {filteredTracts.length.toLocaleString()} tracts
        </div>
      </div>
    </div>
  )
}
