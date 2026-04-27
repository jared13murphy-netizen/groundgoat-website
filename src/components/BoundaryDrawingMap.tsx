'use client'

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'

interface Props {
  initialLat: number
  initialLng: number
  initialZoom?: number
  initialPolygon?: number[][] | null  // existing polygon to display
  onPolygonChange: (polygon: number[][] | null, computedAcres: number | null) => void
}

const NAIP_TILE_URL =
  'https://services.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/tile/{z}/{y}/{x}'

const FALLBACK_SAT_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'naip': {
      type: 'raster',
      tiles: [NAIP_TILE_URL],
      tileSize: 256,
      attribution: 'USDA NAIP',
    },
    'world-imagery': {
      type: 'raster',
      tiles: [FALLBACK_SAT_TILE_URL],
      tileSize: 256,
      attribution: 'Esri World Imagery',
    },
  },
  layers: [
    { id: 'world-imagery', type: 'raster', source: 'world-imagery' },
    { id: 'naip', type: 'raster', source: 'naip', paint: { 'raster-opacity': 0.95 } },
  ],
}

// Spherical area in acres using equirectangular approximation. Same formula
// the backend uses (tract_enrichment_service._polygon_area_acres).
function computeAcres(coords: number[][]): number {
  const n = coords.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += coords[i][0] * coords[j][1]
    area -= coords[j][0] * coords[i][1]
  }
  area = Math.abs(area) / 2
  const midLat = coords.reduce((s, c) => s + c[1], 0) / n
  const m2PerDeg2 = 111320 * Math.cos((midLat * Math.PI) / 180) * 111320
  const acresPerM2 = 0.000247105
  return area * m2PerDeg2 * acresPerM2
}

export default function BoundaryDrawingMap({
  initialLat,
  initialLng,
  initialZoom = 16,
  initialPolygon,
  onPolygonChange,
}: Props) {
  const mapContainer = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const drawRef = useRef<any>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!mapContainer.current) return

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: STYLE,
      center: [initialLng, initialLat],
      zoom: initialZoom,
    })
    mapRef.current = map

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: { polygon: true, trash: true },
      defaultMode: 'draw_polygon',
    })
    drawRef.current = draw

    // MapboxDraw expects a Mapbox-compatible API surface; MapLibre is mostly
    // compatible but a few internal property names differ. The cast to any
    // is the standard workaround used in the wild.
    map.addControl(draw as any, 'top-left')

    map.on('load', () => {
      setReady(true)
      if (initialPolygon && initialPolygon.length >= 3) {
        // Add existing polygon for editing
        const closed = initialPolygon[0] === initialPolygon[initialPolygon.length - 1]
          ? initialPolygon
          : [...initialPolygon, initialPolygon[0]]
        draw.add({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [closed] },
        } as any)
        // Switch to direct_select so user can adjust
        const featureId = draw.getAll().features[0]?.id
        if (featureId) draw.changeMode('direct_select', { featureId: String(featureId) })
      }
    })

    const handleChange = () => {
      const all = draw.getAll()
      const first = all.features[0]
      if (!first || first.geometry.type !== 'Polygon') {
        onPolygonChange(null, null)
        return
      }
      const ring = (first.geometry as any).coordinates[0] as number[][]
      if (!ring || ring.length < 4) {
        onPolygonChange(null, null)
        return
      }
      // Drop the auto-closing repeat vertex for the callback shape;
      // backend will re-close.
      const open = ring.slice(0, -1)
      const acres = computeAcres(open)
      onPolygonChange(open, acres)
    }

    map.on('draw.create' as any, handleChange)
    map.on('draw.update' as any, handleChange)
    map.on('draw.delete' as any, () => onPolygonChange(null, null))

    return () => {
      map.remove()
      mapRef.current = null
      drawRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="relative">
      <div ref={mapContainer} className="w-full h-[600px] rounded-lg overflow-hidden" />
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-gg-gray-900/70 rounded-lg pointer-events-none">
          <div className="text-white">Loading map…</div>
        </div>
      )}
    </div>
  )
}
