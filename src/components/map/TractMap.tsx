'use client'

import { useRef, useEffect, useState, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './TractMap.css'
import type { TractMapProps } from './mapTypes'
import {
  transformListingsToMapTracts,
  buildPointGeoJSON,
  buildPolygonGeoJSON,
  buildStateAggregates,
} from './mapTransform'
import {
  MAP_CENTER,
  MAP_INITIAL_ZOOM,
  TILE_URL,
  TILE_ATTRIBUTION,
  GLYPH_URL,
  ZOOM_TIER_1_MAX,
  ZOOM_TIER_3_MIN,
} from './mapConstants'
import { buildTractPopupHTML } from './tractPopup'

// Status color match expression for MapLibre paint properties
const STATUS_FILL_MATCH: maplibregl.ExpressionSpecification = [
  'match', ['get', 'status'],
  'listed', '#2563EB',
  'active', '#2563EB',
  'live', '#16A34A',
  'sold', '#DC2626',
  'pending', '#DC2626',
  'no_sale', '#6B7280',
  '#888888',
]

const STATUS_BORDER_MATCH: maplibregl.ExpressionSpecification = [
  'match', ['get', 'status'],
  'listed', '#1D4ED8',
  'active', '#1D4ED8',
  'live', '#15803D',
  'sold', '#B91C1C',
  'pending', '#B91C1C',
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

export default function TractMap({ listings, height = '600px', filters }: TractMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const stateMarkersRef = useRef<maplibregl.Marker[]>([])
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const [currentZoom, setCurrentZoom] = useState(MAP_INITIAL_ZOOM)
  const [mapLoaded, setMapLoaded] = useState(false)

  // Transform data
  const tracts = useMemo(
    () => transformListingsToMapTracts(listings, filters),
    [listings, filters]
  )

  const pointGeoJSON = useMemo(() => buildPointGeoJSON(tracts), [tracts])
  const polygonGeoJSON = useMemo(() => buildPolygonGeoJSON(tracts), [tracts])
  const stateAggregates = useMemo(() => buildStateAggregates(tracts), [tracts])

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
    })

    map.on('zoom', () => {
      setCurrentZoom(map.getZoom())
    })

    return () => {
      map.remove()
      mapRef.current = null
      setMapLoaded(false)
    }
  }, [])

  // Add/update sources and layers when map loads or data changes
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

      // --- Tier 2: Cluster layers ---
      map.addLayer({
        id: 'cluster-circles',
        type: 'circle',
        source: 'tract-points',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#f58cde',
          'circle-radius': [
            'step', ['get', 'point_count'],
            18,   // default
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

      // --- Tier 3: Unclustered point layers ---
      // Points for tracts with exact lat/lng (solid circles)
      map.addLayer({
        id: 'tract-points-exact',
        type: 'circle',
        source: 'tract-points',
        filter: [
          'all',
          ['!', ['has', 'point_count']],
          ['any',
            ['==', ['get', 'dataResolution'], 'point'],
            ['==', ['get', 'dataResolution'], 'polygon'],
          ],
        ],
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

      // Points for tracts at county centroid (hollow/outlined)
      map.addLayer({
        id: 'tract-points-centroid',
        type: 'circle',
        source: 'tract-points',
        filter: [
          'all',
          ['!', ['has', 'point_count']],
          ['==', ['get', 'dataResolution'], 'centroid'],
        ],
        paint: {
          'circle-radius': 7,
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': STATUS_FILL_MATCH,
          'circle-opacity': 0.7,
          'circle-stroke-opacity': 0.7,
        },
        minzoom: ZOOM_TIER_3_MIN,
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

      // Polygon fill
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

      // Polygon border
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

      // --- Interactions ---
      setupInteractions(map)
    }
  }, [mapLoaded, pointGeoJSON, polygonGeoJSON])

  // Manage state card markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Remove old markers
    stateMarkersRef.current.forEach(m => m.remove())
    stateMarkersRef.current = []

    for (const agg of stateAggregates) {
      const el = document.createElement('div')
      el.innerHTML = `
        <div class="state-card">
          <div class="state-card-name">${agg.state}</div>
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

    // Set initial visibility
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
    for (const layerId of ['cluster-circles', 'tract-points-exact', 'tract-points-centroid']) {
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

      // Close any existing popup
      popupRef.current?.remove()

      popupRef.current = new maplibregl.Popup({ className: 'tract-popup', maxWidth: '320px' })
        .setLngLat(coords)
        .setHTML(buildTractPopupHTML(props))
        .addTo(map)
    }

    map.on('click', 'tract-points-exact', showTractPopup)
    map.on('click', 'tract-points-centroid', showTractPopup)

    // Polygon click — show popup
    map.on('click', 'tract-polygon-fill', (e) => {
      if (!e.features || !e.features.length) return
      const feature = e.features[0]
      const props = feature.properties

      popupRef.current?.remove()

      popupRef.current = new maplibregl.Popup({ className: 'tract-popup', maxWidth: '320px' })
        .setLngLat(e.lngLat)
        .setHTML(buildTractPopupHTML(props))
        .addTo(map)
    })
  }

  return (
    <div
      ref={containerRef}
      className="tract-map-container"
      style={{ height }}
    />
  )
}
