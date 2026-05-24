'use client'

/**
 * TractMapEditor — inline polygon viewer + editor for staging cards.
 *
 * Per user 2026-05-24: each tract on the Auction Staging and PT
 * Staging screens needs an inline MapLibre map (parity with
 * /admin/magic-lab) plus the ability to edit/delete the polygon
 * without leaving the staging page.
 *
 * LAZY MOUNT — the MapLibre instance only spins up when the user
 * clicks "Edit Map". Each map is a WebGL context and browsers cap
 * concurrent contexts (typically 8-16). A 20-listing staging page
 * with 2 tracts each would crash the tab if all 40 maps mounted at
 * once. So in preview mode we render the static `tract_image_base64`
 * thumbnail (or a placeholder if missing). The map only mounts when
 * the user explicitly enters edit mode.
 *
 * Two write paths:
 *   - Save: POST /api/staging/{id}/tracts/{idx}/save-boundary
 *     (existing endpoint — validates polygon >=3 points, recomputes
 *      GIS acres, re-enriches tract data)
 *   - Delete: DELETE /api/staging/{id}/tracts/{idx}/boundary
 *     (new endpoint shipped in scraper commit 5252d69 — wipes the
 *      geometric fields so the user can redraw cleanly)
 *
 * Edit mechanics mirror the dedicated /admin/boundary-draw page:
 *   click empty map → add vertex
 *   ≥3 vertices → polygon closes automatically
 *   Undo button removes last vertex
 *   Clear button removes all vertices
 *   Delete button wipes the saved polygon (server-side)
 *   Save button persists the current polygon
 *   Cancel reverts working state to the loaded polygon
 */

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Save, RotateCcw, Trash2, Loader2, Pencil, X, ImageIcon,
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'

type Pt = [number, number]    // [lng, lat]

interface TractMapEditorProps {
  stagingId: number
  tractIndex: number
  /** Existing polygon, if any. null/empty → user is drawing from scratch. */
  initialPolygon: Pt[] | null
  /** Tract satellite image (base64) shown as the preview thumbnail. */
  tractImageBase64?: string | null
  /** Tract center (used to position the map when no polygon exists). */
  latitude?: number | null
  longitude?: number | null
  /** Pixel size of the preview thumbnail. Defaults to 96. */
  thumbnailSize?: number
  /** Pixel height of the live map editor. Defaults to 360. */
  editorHeight?: number
  /** Called with the updated tract dict after save or delete. The
   *  parent should merge this into its local staging state so the
   *  card reflects the change immediately. */
  onUpdate?: (updatedTract: any) => void
}

// ---------------------------------------------------------------------------
// GeoJSON helpers — copied verbatim from /admin/boundary-draw/[stagingId]/page.tsx
// so the inline editor renders polygons exactly the same way as the
// dedicated full-page editor.
// ---------------------------------------------------------------------------

function buildDrawGeo(points: Pt[]) {
  if (points.length === 0) {
    return { type: 'FeatureCollection', features: [] } as any
  }
  if (points.length < 3) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: points },
      }],
    } as any
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[...points, points[0]]],
      },
    }],
  } as any
}

function buildVertexGeo(points: Pt[]) {
  return {
    type: 'FeatureCollection',
    features: points.map((p, i) => ({
      type: 'Feature',
      properties: { idx: i },
      geometry: { type: 'Point', coordinates: p },
    })),
  } as any
}

function gisAcres(points: Pt[]): number {
  if (points.length < 3) return 0
  let area = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % n]
    area += x1 * y2 - x2 * y1
  }
  area = Math.abs(area) / 2
  const centerLat = points.reduce((s, p) => s + p[1], 0) / n
  const latMiles = 69.0
  const lngMiles = 69.0 * Math.cos(centerLat * Math.PI / 180)
  return area * latMiles * lngMiles * 640
}

// Drop the closing-duplicate vertex if the caller passed a closed ring.
// The editor's working state expects an open list (last point != first).
function normalizeInitialPolygon(poly: Pt[] | null | undefined): Pt[] {
  if (!Array.isArray(poly) || poly.length < 3) return []
  const first = poly[0]
  const last = poly[poly.length - 1]
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    return poly.slice(0, -1) as Pt[]
  }
  return [...poly] as Pt[]
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TractMapEditor({
  stagingId,
  tractIndex,
  initialPolygon,
  tractImageBase64,
  latitude,
  longitude,
  thumbnailSize = 96,
  editorHeight = 360,
  onUpdate,
}: TractMapEditorProps) {
  const [mode, setMode] = useState<'preview' | 'edit'>('preview')
  const [points, setPoints] = useState<Pt[]>(
    () => normalizeInitialPolygon(initialPolygon)
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  // Reset working state if the initial polygon changes (parent updated
  // the data after a successful save/delete in a different component,
  // or the user navigated to a different tract).
  useEffect(() => {
    setPoints(normalizeInitialPolygon(initialPolygon))
  }, [initialPolygon])

  // ===========================================================
  // Map lifecycle — initialize ONLY when entering edit mode.
  // Tear down when leaving edit mode so we don't leak WebGL.
  // ===========================================================
  useEffect(() => {
    if (mode !== 'edit') return
    const container = containerRef.current
    if (!container) return

    // Center: existing polygon centroid > tract lat/lng > fallback.
    let centerLng = -93.5
    let centerLat = 41.9
    let initZoom = 14
    if (points.length >= 3) {
      centerLng = points.reduce((s, p) => s + p[0], 0) / points.length
      centerLat = points.reduce((s, p) => s + p[1], 0) / points.length
      initZoom = 16
    } else if (longitude != null && latitude != null) {
      centerLng = Number(longitude)
      centerLat = Number(latitude)
      initZoom = 16
    }

    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          imagery: {
            type: 'raster',
            tiles: [TILE_URL],
            tileSize: 256,
            attribution: TILE_ATTRIBUTION,
          },
        },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
      },
      center: [centerLng, centerLat],
      zoom: initZoom,
    })
    mapRef.current = map

    map.on('load', () => {
      // The "drawn" source holds the in-progress polygon (or polyline).
      // The "verts" source renders draggable vertex circles. Vertex
      // dragging is intentionally NOT wired up here — matches the
      // dedicated boundary-draw page UX (click-to-add, undo to remove,
      // clear to reset, redraw if you need to move a vertex).
      map.addSource('drawn', { type: 'geojson', data: buildDrawGeo(points) })
      map.addSource('verts', { type: 'geojson', data: buildVertexGeo(points) })
      map.addLayer({
        id: 'drawn-fill', type: 'fill', source: 'drawn',
        paint: { 'fill-color': '#f58cde', 'fill-opacity': 0.25 },
        filter: ['==', '$type', 'Polygon'],
      })
      map.addLayer({
        id: 'drawn-line', type: 'line', source: 'drawn',
        paint: { 'line-color': '#f58cde', 'line-width': 3 },
      })
      map.addLayer({
        id: 'verts', type: 'circle', source: 'verts',
        paint: {
          'circle-radius': 7,
          'circle-color': '#f58cde',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#000',
        },
      })

      // If we already have a polygon, frame it.
      if (points.length >= 3) {
        const bounds = new maplibregl.LngLatBounds()
        for (const p of points) bounds.extend(p as [number, number])
        try {
          map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 17 })
        } catch {}
      }
    })

    // Click to add a vertex. (Same UX as boundary-draw — no drag.)
    map.on('click', (ev) => {
      const { lng, lat } = ev.lngLat
      setPoints(prev => [...prev, [lng, lat]])
    })

    // Force re-measure once layout settles. Maps inside flex/grid
    // children sometimes initialize before their final size is known.
    const t1 = setTimeout(() => map.resize(), 50)
    const t2 = setTimeout(() => map.resize(), 250)
    const t3 = setTimeout(() => map.resize(), 1000)

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      try { map.remove() } catch {}
      mapRef.current = null
    }
    // points intentionally NOT in deps — we don't want to rebuild
    // the map every click. The "Update map data on points change"
    // effect below handles that surgically via setData().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  // Update map sources on points change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const drawSrc = map.getSource('drawn') as maplibregl.GeoJSONSource | undefined
    const vertSrc = map.getSource('verts') as maplibregl.GeoJSONSource | undefined
    if (drawSrc) drawSrc.setData(buildDrawGeo(points))
    if (vertSrc) vertSrc.setData(buildVertexGeo(points))
  }, [points])

  // ===========================================================
  // Actions
  // ===========================================================
  const handleEnterEdit = () => {
    setStatus(null)
    setMode('edit')
  }

  const handleCancelEdit = () => {
    setStatus(null)
    setPoints(normalizeInitialPolygon(initialPolygon))
    setMode('preview')
  }

  const handleUndo = () => setPoints(prev => prev.slice(0, -1))
  const handleClear = () => setPoints([])

  const handleSave = async () => {
    if (points.length < 3) {
      setStatus('Need at least 3 points to save a boundary')
      return
    }
    setSaving(true)
    setStatus(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/staging/${stagingId}/tracts/${tractIndex}/save-boundary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon: points }),
        }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setStatus(
        data.gis_acres
          ? `✓ Saved. GIS acres: ${data.gis_acres}`
          : '✓ Saved'
      )
      // Parent gets the merged tract back so it can refresh the card.
      if (onUpdate && data.tract) onUpdate(data.tract)
      // After a successful save, drop back to preview so the new image
      // (regenerated server-side) shows. Small delay so the success
      // toast is visible.
      setTimeout(() => setMode('preview'), 800)
    } catch (e: any) {
      setStatus(`✗ Save failed: ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(
      'Delete this tract polygon? This wipes the polygon, tillable shape, ' +
      'and tract image so you can redraw cleanly. The tract\'s scraped ' +
      'acres/county/etc. are kept.'
    )) return
    setDeleting(true)
    setStatus(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/staging/${stagingId}/tracts/${tractIndex}/boundary`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setStatus('✓ Polygon deleted')
      setPoints([])
      if (onUpdate && data.tract) onUpdate(data.tract)
      setTimeout(() => setMode('preview'), 600)
    } catch (e: any) {
      setStatus(`✗ Delete failed: ${e.message || e}`)
    } finally {
      setDeleting(false)
    }
  }

  // ===========================================================
  // Render
  // ===========================================================

  // PREVIEW MODE — compact thumbnail + Edit Map button.
  // Renders inline in the tract card row. No MapLibre instance.
  if (mode === 'preview') {
    const sz = thumbnailSize
    return (
      <div className="flex-shrink-0 relative group" style={{ width: sz, height: sz }}>
        {tractImageBase64 ? (
          <img
            src={`data:image/png;base64,${tractImageBase64}`}
            alt={`Tract ${tractIndex + 1}`}
            className="w-full h-full rounded object-cover border border-gg-gray-700"
          />
        ) : (
          <div
            className="w-full h-full rounded flex items-center justify-center border border-gg-gray-700 text-gg-gray-500 bg-gg-gray-800"
            title="No polygon yet"
          >
            <ImageIcon size={20} />
          </div>
        )}
        {/* Edit button — overlay icon that's visible on hover. The
            whole thumbnail is also clickable to enter edit mode. */}
        <button
          onClick={handleEnterEdit}
          className="absolute inset-0 flex items-center justify-center bg-black/0 hover:bg-black/40 text-white opacity-0 hover:opacity-100 transition-opacity rounded"
          title="Edit / draw boundary"
        >
          <Pencil size={20} />
        </button>
      </div>
    )
  }

  // EDIT MODE — full-width map editor with toolbar.
  // Mounts the MapLibre instance only while in this mode.
  const drawnAcres = gisAcres(points)
  return (
    <div className="col-span-full w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg overflow-hidden mt-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gg-gray-800 border-b border-gg-gray-700">
        <div className="flex items-center gap-3 text-xs text-gg-gray-300">
          <span>Click the map to add vertices ({points.length} so far)</span>
          {points.length >= 3 && (
            <span className="text-gg-pink">Drawn: {drawnAcres.toFixed(2)} ac</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleUndo}
            disabled={points.length === 0 || saving || deleting}
            className="px-2 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40 rounded flex items-center gap-1"
          >
            <RotateCcw size={12} /> Undo
          </button>
          <button
            onClick={handleClear}
            disabled={points.length === 0 || saving || deleting}
            className="px-2 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40 rounded flex items-center gap-1"
          >
            <Trash2 size={12} /> Clear
          </button>
          <button
            onClick={handleDelete}
            disabled={saving || deleting}
            className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 rounded flex items-center gap-1"
            title="Delete the saved polygon entirely (wipes server-side)"
          >
            {deleting ? <Loader2 className="animate-spin" size={12} /> : <Trash2 size={12} />}
            Delete
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={saving || deleting}
            className="px-2 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40 rounded flex items-center gap-1"
          >
            <X size={12} /> Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={points.length < 3 || saving || deleting}
            className="px-3 py-1 text-xs bg-gg-pink hover:bg-gg-pink-light text-white font-semibold disabled:opacity-40 rounded flex items-center gap-1"
          >
            {saving ? <Loader2 className="animate-spin" size={12} /> : <Save size={12} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Status line */}
      {status && (
        <div className={`px-3 py-1.5 text-xs ${status.startsWith('✓') ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>
          {status}
        </div>
      )}

      {/* The map. Lazy-mounted via the useEffect on `mode`. */}
      <div
        ref={containerRef}
        style={{ width: '100%', height: editorHeight }}
      />
    </div>
  )
}
