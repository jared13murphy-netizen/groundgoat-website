'use client'

/**
 * TractMapEditor — inline polygon viewer + editor for staging cards.
 *
 * Per user 2026-05-24 (redesigned): mirrors the magic-lab visual pattern.
 * Each tract gets its own header above the tract details box:
 *
 *   ┌───────────────────────────────────┬─────────────────┐
 *   │                                   │                 │
 *   │   Interactive MapLibre map        │   Tract image   │
 *   │   (editable polygon, ~60% wide)   │   (static       │
 *   │                                   │    reference,   │
 *   │                                   │    ~40% wide)   │
 *   │                                   │                 │
 *   └───────────────────────────────────┴─────────────────┘
 *   ┌──────────── toolbar ─────────────────────────────────┐
 *   │ N vertices • X ac    Undo Clear Delete Cancel Save  │
 *   └─────────────────────────────────────────────────────┘
 *
 * LAZY MOUNT via IntersectionObserver — MapLibre instances are WebGL
 * contexts; browsers cap them (typically 8-16). A staging page with
 * 20 listings × 2 tracts each = 40 maps. We use IntersectionObserver
 * to only initialize the map when the card scrolls into view (and
 * keep it mounted thereafter, since tearing down on scroll-away
 * would cause flicker). This caps active WebGL contexts to
 * ~roughly-what's-on-screen rather than the whole list.
 *
 * Two write paths:
 *   - Save: POST /api/staging/{id}/tracts/{idx}/save-boundary
 *     (existing scraper endpoint — recomputes GIS acres, re-enriches)
 *   - Delete: DELETE /api/staging/{id}/tracts/{idx}/boundary
 *     (new endpoint shipped in scraper commit 5252d69 — wipes the
 *      geometric fields so the user can redraw cleanly)
 *
 * Edit mechanics (click-to-add, no drag — same UX as the dedicated
 * /admin/boundary-draw page so users only have to learn one pattern):
 *   - Click empty map → add vertex
 *   - ≥3 vertices → polygon closes automatically (pink fill)
 *   - Undo / Clear / Delete / Cancel / Save buttons in the toolbar
 */

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Save, RotateCcw, Trash2, Loader2, ImageIcon, Sprout, EyeOff,
} from 'lucide-react'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'

type Pt = [number, number]    // [lng, lat]

interface TractMapEditorProps {
  stagingId: number
  tractIndex: number
  /** Existing polygon, if any. null/empty → user draws from scratch. */
  initialPolygon: Pt[] | null
  /** Tillable polygon (single ring) or array of rings from magic-lab
   *  Stage 5. When non-null + showTillable=true, drawn as a green
   *  overlay on top of the pink tract polygon. */
  tillablePolygon?: Pt[] | Pt[][] | null
  /** Whether to render the tillable polygon. Toggled by the
   *  Show/Hide Tillable button in the toolbar. */
  showTillable?: boolean
  /** Tract satellite + polygon overlay image (base64). Shown on the
   *  right pane as the static reference. */
  tractImageBase64?: string | null
  /** Center fallback when no polygon and no listing-level coord. */
  latitude?: number | null
  longitude?: number | null
  /** Height of the editor strip in pixels. Default 320. */
  editorHeight?: number
  /** Called with the updated tract dict after a successful save or
   *  delete. Parent should merge into its local staging state so the
   *  card re-renders with the new polygon + regenerated image. */
  onUpdate?: (updatedTract: any) => void
  /** Called when the user clicks "Show Tillable" / "Hide Tillable".
   *  Parent owns the showTillable state so the comparison panel can
   *  reflect what's visible. */
  onToggleTillable?: (next: boolean) => void
  /** Called when the user clicks "Compute Tillable" — only shown
   *  when tillablePolygon is missing or the tract polygon was edited
   *  after the last Stage 5 run. Parent should call the scraper's
   *  recompute endpoint and update tract.tillable_polygon /
   *  tract.computed.* with the response. */
  onComputeTillable?: () => Promise<void> | void
}

// ---------------------------------------------------------------------------
// GeoJSON helpers — copied verbatim from /admin/boundary-draw so polygons
// render identically across surfaces.
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

function normalizeInitialPolygon(poly: Pt[] | null | undefined): Pt[] {
  if (!Array.isArray(poly) || poly.length < 3) return []
  const first = poly[0]
  const last = poly[poly.length - 1]
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    return poly.slice(0, -1) as Pt[]
  }
  return [...poly] as Pt[]
}

/** Build a GeoJSON FeatureCollection for the tillable polygon overlay.
 *  Tillable can be a single ring (Pt[]) or an array of rings (Pt[][])
 *  per the magic-lab Stage 5 hybrid output. Returns an empty FC if
 *  tillablePolygon is null / empty / unparseable so the source-update
 *  effect can safely setData() without erroring. */
function buildTillableGeo(tillable: Pt[] | Pt[][] | null | undefined): any {
  if (!tillable || !Array.isArray(tillable) || tillable.length === 0) {
    return { type: 'FeatureCollection', features: [] }
  }
  // Detect single-ring vs multi-ring shape. Single ring: first element
  // is [lng, lat] (a Pt). Multi-ring: first element is itself an array.
  const isMultiRing = Array.isArray((tillable as any)[0]?.[0])
  const rings: Pt[][] = isMultiRing
    ? (tillable as Pt[][])
    : [tillable as Pt[]]
  const features = rings
    .filter(r => Array.isArray(r) && r.length >= 3)
    .map(r => {
      const closed = [...r]
      const f = closed[0]
      const l = closed[closed.length - 1]
      if (f[0] !== l[0] || f[1] !== l[1]) closed.push(f)
      return {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closed] },
      }
    })
  return { type: 'FeatureCollection', features }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TractMapEditor({
  stagingId,
  tractIndex,
  initialPolygon,
  tillablePolygon,
  showTillable = false,
  tractImageBase64,
  latitude,
  longitude,
  editorHeight = 320,
  onUpdate,
  onToggleTillable,
  onComputeTillable,
}: TractMapEditorProps) {
  // Working polygon state — what's being edited on the map. Diverges
  // from initialPolygon while the user is drawing/clearing; reset on
  // Cancel or after a successful Save.
  const [points, setPoints] = useState<Pt[]>(
    () => normalizeInitialPolygon(initialPolygon)
  )
  // True once any modification has been made — controls whether the
  // Cancel/Save toolbar is enabled.
  const [dirty, setDirty] = useState(false)
  // True after the IntersectionObserver fires once. The map mounts on
  // the first intersection and stays mounted thereafter (re-mounting
  // on scroll-away → scroll-back would cause flicker + re-fetch tiles).
  const [hasBeenVisible, setHasBeenVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Compute Tillable button loading state — only relevant when
  // tillablePolygon is null (Stage 5 hasn't run yet) OR the user
  // edited the tract polygon and wants to recompute.
  const [computingTillable, setComputingTillable] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // For IntersectionObserver — observes the outer wrapper so the map
  // mounts as soon as the user scrolls the tract into view.
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  // Reset working state if the parent passes a different polygon (e.g.,
  // after a successful save on a different tract that updated this
  // tract's data via shared listings state).
  useEffect(() => {
    setPoints(normalizeInitialPolygon(initialPolygon))
    setDirty(false)
  }, [initialPolygon])

  // ===========================================================
  // IntersectionObserver — mount the MapLibre instance the FIRST
  // time the tract scrolls into the viewport. We use rootMargin so
  // it pre-loads just before becoming visible (smoother scroll).
  // ===========================================================
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || hasBeenVisible) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setHasBeenVisible(true)
          observer.disconnect()
          break
        }
      }
    }, { rootMargin: '200px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasBeenVisible])

  // ===========================================================
  // Map lifecycle — mount once after first visibility, tear down
  // on unmount (e.g., listing removed from staging).
  // ===========================================================
  useEffect(() => {
    if (!hasBeenVisible) return
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
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      map.addSource('drawn', { type: 'geojson', data: buildDrawGeo(points) })
      map.addSource('verts', { type: 'geojson', data: buildVertexGeo(points) })
      // Tillable source — empty FC unless showTillable=true. Per user
      // 2026-05-25 UX: show tract polygon by default, tillable only
      // when the user clicks the toggle. Magic-lab Stage 5 hybrid
      // (FTW + CDL + NHD subtract + sliver merge).
      map.addSource('tillable', {
        type: 'geojson',
        data: showTillable
          ? buildTillableGeo(tillablePolygon)
          : { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: 'drawn-fill', type: 'fill', source: 'drawn',
        paint: { 'fill-color': '#f58cde', 'fill-opacity': 0.25 },
        filter: ['==', '$type', 'Polygon'],
      })
      map.addLayer({
        id: 'drawn-line', type: 'line', source: 'drawn',
        paint: { 'line-color': '#f58cde', 'line-width': 3 },
      })
      // Tillable rendered ON TOP of the tract polygon, semi-transparent
      // green so user can see the tract underneath. Same color pattern
      // as the magic-lab probe result panel (Cropland legend swatch).
      map.addLayer({
        id: 'tillable-fill', type: 'fill', source: 'tillable',
        paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.35 },
      })
      map.addLayer({
        id: 'tillable-line', type: 'line', source: 'tillable',
        paint: { 'line-color': '#16a34a', 'line-width': 2 },
      })
      map.addLayer({
        id: 'verts', type: 'circle', source: 'verts',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#f58cde',
        },
      })

      // Frame the polygon if we have one.
      if (points.length >= 3) {
        const bounds = new maplibregl.LngLatBounds()
        for (const p of points) bounds.extend(p as [number, number])
        try {
          map.fitBounds(bounds, { padding: 30, duration: 0, maxZoom: 17 })
        } catch {}
      }
    })

    // Click to add a vertex (same UX as boundary-draw page).
    map.on('click', (ev) => {
      const { lng, lat } = ev.lngLat
      setPoints(prev => [...prev, [lng, lat]])
      setDirty(true)
    })

    // Force re-measure once layout settles. Maps inside flex/grid
    // children sometimes init before their final size is known.
    const t1 = setTimeout(() => map.resize(), 50)
    const t2 = setTimeout(() => map.resize(), 250)
    const t3 = setTimeout(() => map.resize(), 1000)

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      try { map.remove() } catch {}
      mapRef.current = null
    }
    // points intentionally NOT in deps — surgical updates via the
    // setData effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBeenVisible])

  // Update map sources on points change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const drawSrc = map.getSource('drawn') as maplibregl.GeoJSONSource | undefined
    const vertSrc = map.getSource('verts') as maplibregl.GeoJSONSource | undefined
    if (drawSrc) drawSrc.setData(buildDrawGeo(points))
    if (vertSrc) vertSrc.setData(buildVertexGeo(points))
  }, [points])

  // Update tillable overlay when user toggles visibility or the
  // tillable polygon itself changes (e.g. after re-running Stage 5).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const tillSrc = map.getSource('tillable') as maplibregl.GeoJSONSource | undefined
    if (!tillSrc) return
    tillSrc.setData(
      showTillable
        ? buildTillableGeo(tillablePolygon)
        : { type: 'FeatureCollection', features: [] }
    )
  }, [showTillable, tillablePolygon])

  // ===========================================================
  // Actions
  // ===========================================================
  const handleUndo = () => {
    setPoints(prev => prev.slice(0, -1))
    setDirty(true)
  }
  const handleClear = () => {
    setPoints([])
    setDirty(true)
  }
  const handleCancel = () => {
    setPoints(normalizeInitialPolygon(initialPolygon))
    setDirty(false)
    setStatus(null)
  }

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
      setDirty(false)
      if (onUpdate && data.tract) onUpdate(data.tract)
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
      setDirty(false)
      if (onUpdate && data.tract) onUpdate(data.tract)
    } catch (e: any) {
      setStatus(`✗ Delete failed: ${e.message || e}`)
    } finally {
      setDeleting(false)
    }
  }

  // ===========================================================
  // Render — magic-lab style: map left ~60%, image right ~40%,
  // toolbar below.
  // ===========================================================
  const drawnAcres = gisAcres(points)

  return (
    <div ref={wrapperRef} className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg overflow-hidden mb-2">
      {/* Map + image side-by-side. Stacks vertically on small screens. */}
      <div className="flex flex-col md:flex-row">
        {/* LEFT: interactive map (~60% on md+). The container is
            always in the DOM (so IntersectionObserver has something
            to observe) but MapLibre only mounts after first
            visibility — until then this is just an empty div with the
            right dimensions. */}
        <div className="md:w-3/5 w-full relative bg-gg-gray-800">
          <div
            ref={containerRef}
            style={{ width: '100%', height: editorHeight }}
            className={hasBeenVisible ? '' : 'flex items-center justify-center'}
          >
            {!hasBeenVisible && (
              <span className="text-xs text-gg-gray-500">Map loads on scroll</span>
            )}
          </div>
        </div>
        {/* RIGHT: static tract image reference (~40% on md+). Mirrors
            magic-lab's right pane. If the auto-rendered tract image
            isn't available (e.g., scraper hasn't generated one yet),
            show a placeholder so the layout doesn't collapse. */}
        <div className="md:w-2/5 w-full bg-gg-gray-800 border-l border-gg-gray-700 flex items-center justify-center relative">
          {tractImageBase64 ? (
            <img
              src={`data:image/png;base64,${tractImageBase64}`}
              alt={`Tract ${tractIndex + 1} reference`}
              style={{ maxHeight: editorHeight }}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-gg-gray-500 py-8">
              <ImageIcon size={32} />
              <span className="text-xs">No tract image yet</span>
              <span className="text-[10px] text-gg-gray-600">Save a polygon to generate one</span>
            </div>
          )}
        </div>
      </div>

      {/* Toolbar — full-width below the map + image. */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gg-gray-800 border-t border-gg-gray-700">
        <div className="flex items-center gap-3 text-xs text-gg-gray-300">
          <span>Click the map to add vertices ({points.length} so far)</span>
          {points.length >= 3 && (
            <span className="text-gg-pink font-semibold">Drawn: {drawnAcres.toFixed(2)} ac</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Tillable toggle — show/hide if Stage 5 already computed,
              compute if it hasn't run yet. Per user 2026-05-25:
              "Only show tract polygon first, then a button to draw
              tillable polygons using the Hybrid approach." */}
          {tillablePolygon ? (
            <button
              onClick={() => onToggleTillable?.(!showTillable)}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                showTillable
                  ? 'bg-green-600 hover:bg-green-700 text-white'
                  : 'bg-gg-gray-700 hover:bg-gg-gray-600'
              }`}
              title={showTillable
                ? 'Hide the green tillable overlay'
                : 'Show magic-lab hybrid tillable (FTW + CDL + NHD subtract)'}
            >
              {showTillable
                ? (<><EyeOff size={12} /> Hide Tillable</>)
                : (<><Sprout size={12} /> Show Tillable</>)}
            </button>
          ) : onComputeTillable ? (
            <button
              onClick={async () => {
                setComputingTillable(true)
                try { await onComputeTillable() }
                finally { setComputingTillable(false) }
              }}
              disabled={computingTillable || points.length < 3}
              className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white disabled:opacity-40 rounded flex items-center gap-1"
              title={points.length < 3
                ? 'Need a saved tract polygon first'
                : 'Compute hybrid tillable (FTW + CDL + NHD subtract + sliver merge) for this tract'}
            >
              {computingTillable
                ? <Loader2 className="animate-spin" size={12} />
                : <Sprout size={12} />}
              {computingTillable ? 'Computing…' : 'Compute Tillable'}
            </button>
          ) : null}
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
            <RotateCcw size={12} /> Clear
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
            onClick={handleCancel}
            disabled={!dirty || saving || deleting}
            className="px-2 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40 rounded flex items-center gap-1"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={points.length < 3 || !dirty || saving || deleting}
            className="px-3 py-1 text-xs bg-gg-pink hover:bg-gg-pink-light text-white font-semibold disabled:opacity-40 rounded flex items-center gap-1"
          >
            {saving ? <Loader2 className="animate-spin" size={12} /> : <Save size={12} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Status line — visible after save/delete attempts. */}
      {status && (
        <div className={`px-3 py-1.5 text-xs ${status.startsWith('✓') ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}`}>
          {status}
        </div>
      )}
    </div>
  )
}
