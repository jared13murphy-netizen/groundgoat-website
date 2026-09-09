'use client'

/**
 * The map half of /map-portfolio.
 *
 * Every saved tract is drawn at once with its name on it. Picking a
 * project — from the panel, or by clicking a tract on the map — narrows
 * the map to that project's tracts and frames them.
 *
 * Land-type polygons are NOT drawn here. At portfolio zoom they are
 * smaller than the outline stroke, and a firm with a few hundred tracts
 * would be shipping tens of megabytes to draw them. Outlines and names
 * are what this view is for; the detail lives in Configure Map.
 */
import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addRegridLayer, buildRegridStateFilter, fetchRegridConfig } from '@/components/map/regridLayer'
import { addPlaceLabels } from '@/components/map/placeLabels'
import {
  GLYPH_URL, MAP_CENTER, MAP_INITIAL_ZOOM, TILE_ATTRIBUTION, TILE_URL,
} from '@/components/map/mapConstants'
import type { PortfolioTract } from '@/lib/configurableMapping'

const API_URL = process.env.NEXT_PUBLIC_API_URL
  || 'https://practical-serenity-production.up.railway.app'

const SRC = 'pf-tracts'
const SRC_LABEL = 'pf-labels'

function bboxOf(coords: any): [[number, number], [number, number]] | null {
  let w = 180, s = 90, e = -180, n = -90, seen = false
  const walk = (a: any) => {
    if (typeof a?.[0] === 'number' && typeof a?.[1] === 'number') {
      seen = true
      w = Math.min(w, a[0]); e = Math.max(e, a[0])
      s = Math.min(s, a[1]); n = Math.max(n, a[1])
      return
    }
    if (Array.isArray(a)) a.forEach(walk)
  }
  walk(coords)
  return seen ? [[w, s], [e, n]] : null
}

export default function PortfolioMap({
  tracts, selectedProject, selectedTract, onPick,
}: {
  tracts: PortfolioTract[]
  selectedProject: string | null
  selectedTract: string | null
  onPick: (projectId: string, tractId: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const readyRef = useRef(false)
  const pickRef = useRef(onPick); pickRef.current = onPick
  // The click handler is registered once, so it cannot close over state.
  const tractsRef = useRef<PortfolioTract[]>([]); tractsRef.current = tracts
  // Frame a project only when the SELECTION changes — not on every data
  // refresh, which would yank the camera back while someone is panning.
  const framedRef = useRef<string | null | undefined>(undefined)
  // The map finishes loading after the first render, and the tracts
  // arrive later still. Whichever lands last runs the current paint.
  const paintRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: GLYPH_URL,
        sources: {
          sat: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION },
        },
        // maxzoom 19 is where ArcGIS World Imagery actually stops. Past
        // it the server answers with a "Map data not yet available"
        // placeholder tile; declaring the ceiling makes MapLibre
        // over-zoom the deepest real tile instead of asking for one that
        // does not exist. The Explore map has always done this.
        layers: [
          { id: 'sat', type: 'raster', source: 'sat', minzoom: 0, maxzoom: 19 },
        ],
      },
      center: MAP_CENTER,
      zoom: MAP_INITIAL_ZOOM,
      // Matches the Explore map. Without the ceiling you can zoom past
      // the imagery; without the cache cap, heavy panning grows the tile
      // cache until the GPU loses the WebGL context.
      maxZoom: 18,
      maxTileCacheSize: 200,
      attributionControl: false,
      transformRequest: (url: string) => {
        if (url.includes(`${API_URL}/api/regrid/tile/`)) {
          const token = localStorage.getItem('auth_token')
          return { url, headers: token ? { Authorization: `Bearer ${token}` } : {} }
        }
        return { url }
      },
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right')

    let removePlaceLabels: (() => void) | null = null
    map.on('load', async () => {
      map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any })
      map.addSource(SRC_LABEL, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any })

      removePlaceLabels = addPlaceLabels(map)
      const cfg = await fetchRegridConfig()
      if (cfg) {
        addRegridLayer(map, cfg, { minZoom: 11, labelMinZoom: 14, interactive: false })
        const f = buildRegridStateFilter(cfg)
        if (f) for (const l of ['regrid-parcels-fill', 'regrid-parcels-line', 'regrid-parcels-label']) {
          if (map.getLayer(l)) map.setFilter(l, f)
        }
      }

      // A tract in the chosen project reads solid; the rest stay faint
      // so the whole portfolio is still legible around it.
      map.addLayer({
        id: 'pf-fill', type: 'fill', source: SRC,
        paint: {
          'fill-color': '#f58cde',
          'fill-opacity': [
            'case',
            ['boolean', ['get', 'focus'], false], 0.52,
            ['boolean', ['get', 'active'], false], 0.30,
            0.10,
          ],
        },
      })
      map.addLayer({
        id: 'pf-line', type: 'line', source: SRC,
        paint: {
          'line-color': '#ffffff',
          'line-width': [
            'case',
            ['boolean', ['get', 'focus'], false], 4,
            ['boolean', ['get', 'active'], false], 2.5,
            1.2,
          ],
          'line-opacity': ['case', ['boolean', ['get', 'active'], false], 0.95, 0.5],
        },
      })

      if (!map.hasImage('pf-badge')) {
        const W = 48, H = 36, R = 12
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H
        const g = cv.getContext('2d')!
        const pill = () => {
          g.beginPath()
          g.moveTo(R + 1, 2); g.lineTo(W - R - 1, 2)
          g.quadraticCurveTo(W - 2, 2, W - 2, R + 2)
          g.lineTo(W - 2, H - R - 2)
          g.quadraticCurveTo(W - 2, H - 2, W - R - 1, H - 2)
          g.lineTo(R + 1, H - 2)
          g.quadraticCurveTo(2, H - 2, 2, H - R - 2)
          g.lineTo(2, R + 2)
          g.quadraticCurveTo(2, 2, R + 1, 2)
          g.closePath()
        }
        pill(); g.fillStyle = 'rgba(8,8,10,0.86)'; g.fill()
        pill(); g.lineWidth = 2.5; g.strokeStyle = '#f58cde'; g.stroke()
        map.addImage('pf-badge', g.getImageData(0, 0, W, H) as any, {
          pixelRatio: 2,
          stretchX: [[R + 2, W - R - 2]],
          stretchY: [[R + 2, H - R - 2]],
          content: [R - 2, 5, W - R + 2, H - 5],
        })
      }
      map.addLayer({
        id: 'pf-label', type: 'symbol', source: SRC_LABEL,
        layout: {
          'icon-image': 'pf-badge',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [2, 7, 2, 7],
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': 12,
          'text-max-width': 12,
          // Two tracts drawn on the SAME ground put their badges on the
          // same pixel, and MapLibre draws one and drops the other —
          // with no sort key it picks whichever it reached first, so a
          // tract you had just selected could stay hidden behind its
          // twin. Lower key is placed first and wins the collision.
          'symbol-sort-key': ['case', ['boolean', ['get', 'focus'], false], 0, 1],
        },
        paint: { 'text-color': '#ffffff' },
      })

      // Clicking any tract selects the project it belongs to — the same
      // thing as picking that project in the panel.
      const pick = (e: any) => {
        const f = e.features?.[0]
        const pid = f?.properties?.projectId
        const tid = f?.properties?.tractId
        if (pid) pickRef.current(String(pid), tid ? String(tid) : '')
      }
      map.on('click', 'pf-fill', pick)
      map.on('click', 'pf-label', pick)
      for (const l of ['pf-fill', 'pf-label']) {
        map.on('mouseenter', l, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', l, () => { map.getCanvas().style.cursor = '' })
      }
      readyRef.current = true
      paintRef.current?.()
    })

    return () => {
      try { removePlaceLabels?.() } catch { /* style already gone */ }
      try { map.remove() } catch { /* already torn down */ }
      mapRef.current = null
      readyRef.current = false
    }
  }, [])

  // Paint whatever is currently in scope.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const paint = () => {
      const shown = selectedProject
        ? tracts.filter((t) => t.project_id === selectedProject)
        : tracts
      const feats = shown.filter((t) => t.boundary).map((t) => ({
        type: 'Feature', geometry: t.boundary,
        properties: {
          projectId: t.project_id, tractId: t.id,
          active: !selectedProject || t.project_id === selectedProject,
          focus: t.id === selectedTract,
        },
      }))
      const labels = shown.filter((t) => t.label_point).map((t) => ({
        type: 'Feature', geometry: t.label_point,
        properties: {
          projectId: t.project_id, tractId: t.id,
          name: t.name || 'Untitled', focus: t.id === selectedTract,
        },
      }))
      ;(map.getSource(SRC) as maplibregl.GeoJSONSource)?.setData(
        { type: 'FeatureCollection', features: feats } as any)
      ;(map.getSource(SRC_LABEL) as maplibregl.GeoJSONSource)?.setData(
        { type: 'FeatureCollection', features: labels } as any)

      // `shown.length` matters: the first paint runs before the tracts
      // have arrived, and framing on that empty pass used to spend the
      // guard, so the real data never moved the camera.
      if (framedRef.current !== selectedProject && shown.length) {
        framedRef.current = selectedProject
        const bb = bboxOf(shown.map((t) => t.boundary?.coordinates).filter(Boolean))
        if (bb) map.fitBounds(bb, { padding: 80, maxZoom: 15, duration: 700 })
      }
    }
    paintRef.current = paint
    if (readyRef.current) paint()
  }, [tracts, selectedProject, selectedTract])

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
}
