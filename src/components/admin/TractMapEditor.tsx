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
  Maximize2, Minimize2, Crosshair, Camera, Sparkles,
} from 'lucide-react'
import { polygonPerimeterFeet, formatPerimeter } from '@/lib/polygonGeometry'

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
  /** Source-image comparison view for the right pane. Magic-lab
   *  captures the most-comparable image from whichever Stage 2 path
   *  produced the polygon (Land ID screenshot, PDF aerial, etc.).
   *  These three fields together describe what to render — kind tells
   *  us img vs iframe, base64 / url provide the content. Per user
   *  2026-05-25: "make sure you add an image on the right so I can
   *  compare the drawn polygon to the image from the website." */
  sourceImageBase64?: string | null
  sourceImageUrl?: string | null
  sourceImageKind?: string | null
  /** Center fallback when no polygon and no listing-level coord. */
  latitude?: number | null
  longitude?: number | null
  /** Auctioneer-published acres for this tract (from tract.scraped.acres
   *  or top-level tract.acres). When present, the "Align" overlay
   *  button appears whenever the drawn polygon's area differs from
   *  this value by >1% — clicking it scales the polygon about its
   *  centroid by sqrt(scraped/drawn) so the area matches exactly.
   *  Per user 2026-05-26: faster than re-drawing vertices when the
   *  shape is right but the size is off. */
  scrapedAcres?: number | null
  /** Height of the editor strip in pixels. Default 320. */
  editorHeight?: number
  /** Called with the updated tract dict after a successful save or
   *  delete. Parent should merge into its local staging state so the
   *  card re-renders with the new polygon + regenerated image. */
  onUpdate?: (updatedTract: any) => void
  /** Called LIVE on every polygon edit (vertex drag, Align, Undo, new
   *  vertex). Per user 2026-05-26: as the user adjusts the polygon,
   *  the Computed acres in the TractDataCompare card should update in
   *  real time, not just on Save. The parent should patch
   *  tract.computed.acres so the radio rows reflect the live shape. */
  onPolygonChange?: (points: [number, number][], gisAcres: number) => void
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
  /** The auction / PT listing URL. When no source image is available,
   *  the right pane shows a "Capture Screenshot" button that hits the
   *  scraper's /api/staging/{id}/capture-source-image endpoint. On
   *  success the screenshot is displayed immediately for this session. */
  listingUrl?: string | null
  /** State abbreviation or full name — forwarded to the Vision extraction
   *  endpoint to help the PLSS section lookup pick the right principal
   *  meridian (e.g. IL has both the 3rd and 4th PM). Improves accuracy for
   *  GIS-printed map images that carry a PLSS section label. */
  listingState?: string | null
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

/** Extract the first ring of a tillablePolygon prop as a flat Pt[] with the
 *  closing duplicate removed — same normalization as normalizeInitialPolygon.
 *  Used when displaying existing tillable vertices for inline editing. */
function normalizeTillableToRing(tillable: Pt[] | Pt[][] | null | undefined): Pt[] {
  if (!tillable || !Array.isArray(tillable) || tillable.length === 0) return []
  const isMultiRing = Array.isArray((tillable as any)[0]?.[0])
  const ring: Pt[] = isMultiRing ? (tillable as Pt[][])[0] : (tillable as Pt[])
  if (!ring || ring.length < 3) return []
  return normalizeInitialPolygon(ring)
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
  sourceImageBase64,
  sourceImageUrl,
  sourceImageKind,
  latitude,
  longitude,
  scrapedAcres,
  editorHeight = 320,
  onUpdate,
  onPolygonChange,
  onToggleTillable,
  onComputeTillable,
  listingUrl,
  listingState,
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
  const [deletingTillable, setDeletingTillable] = useState(false)
  // Compute Tillable button loading state — only relevant when
  // tillablePolygon is null (Stage 5 hasn't run yet) OR the user
  // edited the tract polygon and wants to recompute.
  const [computingTillable, setComputingTillable] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  // Full-screen editor — when true, the whole editor pops out as a
  // fixed full-viewport overlay. The map instance is preserved (CSS
  // resize only) — we just call map.resize() after toggle so MapLibre
  // re-reads its container dimensions. Per user 2026-05-26: the inline
  // map is too small to accurately draw new polygons.
  const [fullscreen, setFullscreen] = useState(false)
  // Tillable draw mode — per user 2026-05-26: even after Delete
  // Tillable, the user wants to draw a new tillable shape by hand
  // because magic-lab's auto-detect is sometimes wrong. When true:
  //   - Map clicks add to tillableDrawPoints (NOT points)
  //   - Vertex drag updates tillableDrawPoints
  //   - The green overlay is the live tillableDrawPoints (not the
  //     stored tillablePolygon)
  //   - Save Tillable button POSTs polygon → /api/.../tillable
  const [drawTillableMode, setDrawTillableMode] = useState(false)
  const [tillableDrawPoints, setTillableDrawPoints] = useState<Pt[]>([])
  // Live soil-rating preview (server lookup, debounced). When the
  // tillable polygon changes the parent's onPolygonChange + a local
  // debouncer hits the server for area-weighted soil rating.
  const [tillablePreview, setTillablePreview] = useState<{
    acres: number | null
    soil_rating: number | null
    soil_rating_type: string | null
    loading: boolean
  } | null>(null)
  const [savingTillable, setSavingTillable] = useState(false)
  // Capture-screenshot state — populated when user clicks "Capture Screenshot"
  // in the right pane. Lets us show the result immediately without a full
  // page reload. capturedSourceImage persists until the component unmounts.
  const [capturedSourceImage, setCapturedSourceImage] = useState<string | null>(null)
  const [capturingSource, setCapturingSource] = useState(false)
  // Non-null while the user is dragging vertices on an EXISTING tillable
  // polygon (not in draw-new mode). Starts null, gets set on first drag.
  // Cleared on Save, Delete, or when tillablePolygon prop changes.
  const [editedTillablePoints, setEditedTillablePoints] = useState<Pt[] | null>(null)
  // Ref mirror so the map's load-closure drag handlers can read the
  // latest tillablePolygon prop without stale capture.
  const tillablePolygonRef = useRef(tillablePolygon)
  useEffect(() => { tillablePolygonRef.current = tillablePolygon }, [tillablePolygon])

  // Upload Image — user picks a local aerial/PDF/map image; Claude Vision
  // extracts the tract boundary from it and loads the polygon onto the map
  // for review/editing before saving. The image shows in the right pane
  // (priority 0) while extraction runs; cleared by the × button.
  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [extractingFromImage, setExtractingFromImage] = useState(false)
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  // Upload panel — shown when user clicks "Upload Image". Has URL input
  // (Land ID extraction) and paste/drop/pick image zone.
  const [showUploadPanel, setShowUploadPanel] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [extractingUrl, setExtractingUrl] = useState(false)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // For IntersectionObserver — observes the outer wrapper so the map
  // mounts as soon as the user scrolls the tract into view.
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  // Tracks which vertex (if any) is currently being dragged. Used by
  // the vertex-drag handlers to know which index to update on each
  // mousemove. null when no drag in progress. Per user 2026-05-26:
  // clicking a vertex was just panning the map — we never wired the
  // mousedown→mousemove→mouseup dance to actually move the vertex.
  const draggingVertexIdx = useRef<number | null>(null)
  // Tracks whether the active drag is on a TILLABLE vertex (green) vs
  // a tract vertex (pink). Set by mousedown handlers based on which
  // layer received the event. The mousemove handler reads this to
  // decide whether to update tillableDrawPoints or points.
  const draggingTillableVertex = useRef<boolean>(false)
  // ── Undo history stacks ──
  // Per user 2026-05-26: Undo was always popping the LAST vertex
  // regardless of the actual previous action — moving a vertex then
  // clicking Undo did nothing, then a second Undo deleted a different
  // vertex. Now every action snapshots the pre-action state onto the
  // history stack and Undo pops one snapshot back.
  // Actions that push: add-vertex (click), vertex drag (first move
  // only, not every mousemove), Align, Clear, Cancel resets clear
  // history. Separate stacks for tract vs tillable so Undo in either
  // mode only walks back through that mode's edits.
  const pointsHistory = useRef<Pt[][]>([])
  const tillableHistory = useRef<Pt[][]>([])
  // True once we've snapshotted the pre-drag state for the current
  // drag — prevents 100 mousemove events from pushing 100 snapshots.
  const dragHistoryPushed = useRef(false)
  // Ref mirror of drawTillableMode so map event handlers (which
  // capture the value at mount time inside the load closure) see the
  // latest value without us having to rebind every toggle.
  const drawTillableModeRef = useRef<boolean>(false)
  useEffect(() => {
    drawTillableModeRef.current = drawTillableMode
  }, [drawTillableMode])
  // Tracks whether the most recent mousedown was on a vertex — used to
  // suppress the `click` handler's "add a new vertex" path, otherwise
  // every vertex click would stack a new vertex on top of the existing
  // one (the click event fires after mouseup if the cursor barely
  // moved).
  const recentVertexInteraction = useRef<boolean>(false)

  // Reset working state if the parent passes a different polygon (e.g.,
  // after a successful save on a different tract that updated this
  // tract's data via shared listings state). Also clears the undo
  // history — a fresh polygon means the previous history is no longer
  // meaningful.
  useEffect(() => {
    setPoints(normalizeInitialPolygon(initialPolygon))
    setDirty(false)
    pointsHistory.current = []
  }, [initialPolygon])

  // When the stored tillable polygon changes (e.g., after Save or Delete),
  // discard any in-progress vertex edits — the prop is now the source of truth.
  useEffect(() => {
    setEditedTillablePoints(null)
    tillableHistory.current = []
  }, [tillablePolygon])

  // While the upload panel is open, Ctrl+V / Cmd+V pastes the clipboard
  // image directly into the extraction flow — same UX as the full-page
  // upload-boundary-tract screen.
  useEffect(() => {
    if (!showUploadPanel) return
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items || [])
        .find(it => it.type.startsWith('image/'))
      if (!item) return
      const blob = item.getAsFile()
      if (blob) {
        setShowUploadPanel(false)
        handleImageUpload(blob)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // handleImageUpload is stable enough for this purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUploadPanel])

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
      // Per user 2026-05-26: tillable polygon is its OWN polygon —
      // independent vertices drawn in green so the user can see both
      // the tract (pink) and the tillable (green) at the same time.
      // Separate source so click/drag handlers can target each one.
      map.addSource('tillable-verts', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
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
        paint: { 'line-color': '#16a34a', 'line-width': 3 },
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
      // Green vertices for the tillable polygon — same dot shape but
      // green stroke so they're visually distinct from the pink tract
      // vertices. Only populated when in draw-tillable mode.
      map.addLayer({
        id: 'tillable-verts', type: 'circle', source: 'tillable-verts',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#16a34a',
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

      // ── Vertex hover cursor (both tract + tillable verts) ──
      map.on('mouseenter', 'verts', () => {
        map.getCanvas().style.cursor = 'move'
      })
      map.on('mouseleave', 'verts', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('mouseenter', 'tillable-verts', () => {
        map.getCanvas().style.cursor = 'move'
      })
      map.on('mouseleave', 'tillable-verts', () => {
        map.getCanvas().style.cursor = ''
      })

      // ── Vertex drag (per user 2026-05-26) ──
      // mousedown on a vertex feature → capture index, disable map
      // pan, attach mousemove + one-shot mouseup. setPoints during
      // move updates the polygon shape live (the setData effect on
      // points fires every frame). On mouseup we restore map pan and
      // detach handlers.
      const _onVertexDrag = (mev: maplibregl.MapMouseEvent) => {
        if (draggingVertexIdx.current == null) return
        const idx = draggingVertexIdx.current
        const { lng, lat } = mev.lngLat
        if (draggingTillableVertex.current) {
          if (drawTillableModeRef.current) {
            // Drawing a NEW tillable polygon — update draw points
            setTillableDrawPoints(prev => {
              if (!dragHistoryPushed.current) {
                tillableHistory.current.push(prev.map(p => [...p] as Pt))
                dragHistoryPushed.current = true
              }
              return prev.map((p, i) => i === idx ? [lng, lat] : p)
            })
          } else {
            // Editing EXISTING tillable polygon vertices inline.
            // Initialize from the prop on first drag of this session.
            setEditedTillablePoints(prev => {
              const base = prev ?? normalizeTillableToRing(tillablePolygonRef.current)
              if (!dragHistoryPushed.current) {
                tillableHistory.current.push(base.map(p => [...p] as Pt))
                dragHistoryPushed.current = true
              }
              return base.map((p, i) => i === idx ? [lng, lat] : p)
            })
          }
        } else {
          setPoints(prev => {
            if (!dragHistoryPushed.current) {
              pointsHistory.current.push(prev.map(p => [...p] as Pt))
              dragHistoryPushed.current = true
            }
            return prev.map((p, i) => i === idx ? [lng, lat] : p)
          })
          setDirty(true)
        }
      }
      const _onVertexUp = () => {
        draggingVertexIdx.current = null
        map.dragPan.enable()
        map.off('mousemove', _onVertexDrag)
        setTimeout(() => { recentVertexInteraction.current = false }, 0)
      }
      // Tract vertex (pink) drag — only active when NOT in tillable
      // draw mode. In tillable mode the tract verts are hidden so this
      // shouldn't fire anyway, but guard for safety.
      map.on('mousedown', 'verts', (ev: any) => {
        if (drawTillableModeRef.current) return
        const feature = ev.features?.[0]
        if (!feature) return
        const idx = (feature.properties as any)?.idx
        if (typeof idx !== 'number') return
        ev.preventDefault()
        draggingVertexIdx.current = idx
        draggingTillableVertex.current = false
        recentVertexInteraction.current = true
        dragHistoryPushed.current = false
        map.dragPan.disable()
        map.on('mousemove', _onVertexDrag)
        map.once('mouseup', _onVertexUp)
      })
      // Tillable vertex (green) drag — only meaningful when in
      // tillable draw mode (the layer is empty otherwise).
      map.on('mousedown', 'tillable-verts', (ev: any) => {
        const feature = ev.features?.[0]
        if (!feature) return
        const idx = (feature.properties as any)?.idx
        if (typeof idx !== 'number') return
        ev.preventDefault()
        draggingVertexIdx.current = idx
        draggingTillableVertex.current = true
        recentVertexInteraction.current = true
        dragHistoryPushed.current = false
        map.dragPan.disable()
        map.on('mousemove', _onVertexDrag)
        map.once('mouseup', _onVertexUp)
      })

      // Touch support — mirrors the mouse handlers so the editor works
      // on iPad / touchscreen laptops. MapLibre's touchstart event
      // doesn't carry `features` directly, so we use
      // queryRenderedFeatures at the touch point.
      const _onTouchDrag = (tev: any) => {
        if (draggingVertexIdx.current == null) return
        const idx = draggingVertexIdx.current
        const touch = tev.points?.[0] || tev.point
        if (!touch) return
        const lngLat = map.unproject(touch)
        if (draggingTillableVertex.current) {
          if (drawTillableModeRef.current) {
            setTillableDrawPoints(prev => {
              if (!dragHistoryPushed.current) {
                tillableHistory.current.push(prev.map(p => [...p] as Pt))
                dragHistoryPushed.current = true
              }
              return prev.map((p, i) => i === idx ? [lngLat.lng, lngLat.lat] : p)
            })
          } else {
            setEditedTillablePoints(prev => {
              const base = prev ?? normalizeTillableToRing(tillablePolygonRef.current)
              if (!dragHistoryPushed.current) {
                tillableHistory.current.push(base.map(p => [...p] as Pt))
                dragHistoryPushed.current = true
              }
              return base.map((p, i) => i === idx ? [lngLat.lng, lngLat.lat] : p)
            })
          }
        } else {
          setPoints(prev => {
            if (!dragHistoryPushed.current) {
              pointsHistory.current.push(prev.map(p => [...p] as Pt))
              dragHistoryPushed.current = true
            }
            return prev.map((p, i) => i === idx ? [lngLat.lng, lngLat.lat] : p)
          })
          setDirty(true)
        }
      }
      const _onTouchEnd = () => {
        draggingVertexIdx.current = null
        map.dragPan.enable()
        map.off('touchmove', _onTouchDrag)
        setTimeout(() => { recentVertexInteraction.current = false }, 0)
      }
      map.on('touchstart', 'verts', (ev: any) => {
        if (drawTillableModeRef.current) return
        const feature = ev.features?.[0]
        if (!feature) return
        const idx = (feature.properties as any)?.idx
        if (typeof idx !== 'number') return
        ev.preventDefault()
        draggingVertexIdx.current = idx
        draggingTillableVertex.current = false
        recentVertexInteraction.current = true
        dragHistoryPushed.current = false
        map.dragPan.disable()
        map.on('touchmove', _onTouchDrag)
        map.once('touchend', _onTouchEnd)
      })
      map.on('touchstart', 'tillable-verts', (ev: any) => {
        const feature = ev.features?.[0]
        if (!feature) return
        const idx = (feature.properties as any)?.idx
        if (typeof idx !== 'number') return
        ev.preventDefault()
        draggingVertexIdx.current = idx
        draggingTillableVertex.current = true
        recentVertexInteraction.current = true
        dragHistoryPushed.current = false
        map.dragPan.disable()
        map.on('touchmove', _onTouchDrag)
        map.once('touchend', _onTouchEnd)
      })
    })

    // Click to add a vertex (same UX as boundary-draw page) — but
    // skip when the click landed on an existing vertex, otherwise
    // every vertex click would stack a new vertex on top.
    map.on('click', (ev) => {
      if (recentVertexInteraction.current) return
      const layersToCheck = ['verts', 'tillable-verts'].filter(
        l => map.getLayer(l) != null
      )
      const hits = map.queryRenderedFeatures(ev.point, { layers: layersToCheck })
      if (hits.length > 0) return
      const { lng, lat } = ev.lngLat
      if (drawTillableModeRef.current) {
        setTillableDrawPoints(prev => {
          tillableHistory.current.push(prev.map(p => [...p] as Pt))
          return [...prev, [lng, lat]]
        })
      } else {
        setPoints(prev => {
          pointsHistory.current.push(prev.map(p => [...p] as Pt))
          return [...prev, [lng, lat]]
        })
        setDirty(true)
      }
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

  // Update map sources on points / tillable change.
  // - drawn: tract polygon outline + fill (pink) — always reflects points
  // - verts: tract polygon vertices (pink stroke) — always reflects points
  // - tillable: tillable polygon outline + fill (green) — handled in the
  //   separate effect below
  // - tillable-verts: tillable polygon vertices (green stroke) — only
  //   populated while drawTillableMode is true; empty otherwise so the
  //   green dots don't linger after Save.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const drawSrc = map.getSource('drawn') as maplibregl.GeoJSONSource | undefined
    const vertSrc = map.getSource('verts') as maplibregl.GeoJSONSource | undefined
    if (drawSrc) drawSrc.setData(buildDrawGeo(points))
    if (vertSrc) vertSrc.setData(buildVertexGeo(points))
  }, [points])

  // Update tillable-verts in three situations:
  //   1. Drawing new: show live tillableDrawPoints (green, in draw mode)
  //   2. Editing existing: show tillable polygon vertices (green, when shown)
  //      — uses editedTillablePoints if dirty, else normalizes from prop
  //   3. Otherwise: empty (no green dots cluttering the map)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const tvSrc = map.getSource('tillable-verts') as maplibregl.GeoJSONSource | undefined
    if (!tvSrc) return
    if (drawTillableMode) {
      tvSrc.setData(buildVertexGeo(tillableDrawPoints))
    } else if (tillablePolygon && showTillable) {
      // Existing tillable is visible — show its vertices so user can drag them
      const editPts = editedTillablePoints ?? normalizeTillableToRing(tillablePolygon)
      tvSrc.setData(buildVertexGeo(editPts))
    } else {
      tvSrc.setData({ type: 'FeatureCollection', features: [] })
    }
  }, [drawTillableMode, tillableDrawPoints, tillablePolygon, showTillable, editedTillablePoints])

  // ── Mode-aware layer styling ──
  // Per user 2026-05-26 (revised): both tract dots (pink) and tillable
  // dots (green) stay visible in tillable draw mode — user wants to
  // see both polygons clearly. The tract polygon is dimmed (fill +
  // line opacity dropped) so the green tillable on top stands out.
  // The tillable layers are always visibility:visible — explicit
  // because earlier maplibre quirks were leaving the layer hidden in
  // some race conditions where the green polygon outline never drew.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    try {
      // ALWAYS show tract verts (pink) — user wants to see both.
      map.setLayoutProperty('verts', 'visibility', 'visible')
      // Always show tillable layers — the source data effect controls
      // whether they're empty (no polygon) or populated.
      map.setLayoutProperty('tillable-fill', 'visibility', 'visible')
      map.setLayoutProperty('tillable-line', 'visibility', 'visible')
      map.setLayoutProperty('tillable-verts', 'visibility', 'visible')
      if (drawTillableMode) {
        // Dim the tract polygon so the green tillable on top reads
        // clearly. The outline stays at 50% so the user can still
        // see where the tract boundary is as a reference.
        map.setPaintProperty('drawn-fill', 'fill-opacity', 0.10)
        map.setPaintProperty('drawn-line', 'line-opacity', 0.5)
      } else {
        map.setPaintProperty('drawn-fill', 'fill-opacity', 0.25)
        map.setPaintProperty('drawn-line', 'line-opacity', 1.0)
      }
    } catch {
      // Map not fully loaded yet — the load handler sets the initial
      // styling so this'll catch up on the next mode toggle.
    }
  }, [drawTillableMode])

  // ── Live polygon-change callback ──
  // Per user 2026-05-26: as the user drags vertices / clicks Align /
  // adds vertices, push the new GIS acres up so TractDataCompare's
  // Computed row reflects the live shape instead of the stale magic-lab
  // result. Parent owns staging state; we just fire the callback with
  // the current points + acres. Debounced to one fire per animation
  // frame so a drag doesn't spam the parent with state updates.
  //
  // CRITICAL: deps are [points] ONLY — not [points, onPolygonChange].
  // The parent passes an inline arrow function so its reference changes
  // on every parent render. Including it in deps caused an infinite
  // re-render loop (effect fires → setListings → new fn ref → effect
  // fires again), which froze the staging UI's radio buttons since
  // React couldn't settle a render before the next state update came
  // in. Latest callback captured via ref instead.
  const onPolygonChangeRef = useRef(onPolygonChange)
  useEffect(() => {
    onPolygonChangeRef.current = onPolygonChange
  }, [onPolygonChange])
  useEffect(() => {
    const cb = onPolygonChangeRef.current
    if (!cb) return
    if (points.length < 3) {
      cb(points, 0)
      return
    }
    const handle = requestAnimationFrame(() => {
      cb(points, gisAcres(points))
    })
    return () => cancelAnimationFrame(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points])

  // Update tillable overlay:
  //   - Draw mode: render live tillableDrawPoints (green, in-progress)
  //   - Editing existing: render editedTillablePoints if dirty (live)
  //   - Normal view: render stored tillablePolygon iff showTillable
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const tillSrc = map.getSource('tillable') as maplibregl.GeoJSONSource | undefined
    if (!tillSrc) return
    if (drawTillableMode) {
      // While drawing a new tillable, show the in-progress shape.
      // Mirror buildDrawGeo: render a LineString for 1–2 points so the
      // connecting line is visible from the second click onward (the
      // tillable-line layer renders both LineString and Polygon edges).
      // Only switch to a closed Polygon once we have ≥3 vertices.
      if (tillableDrawPoints.length === 0) {
        tillSrc.setData({ type: 'FeatureCollection', features: [] })
      } else if (tillableDrawPoints.length < 3) {
        tillSrc.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature', properties: {},
            geometry: { type: 'LineString', coordinates: tillableDrawPoints },
          }],
        })
      } else {
        tillSrc.setData(buildTillableGeo(tillableDrawPoints))
      }
    } else if (editedTillablePoints !== null) {
      // Editing existing tillable vertices — render the live edited shape
      tillSrc.setData(
        editedTillablePoints.length >= 3
          ? buildTillableGeo(editedTillablePoints)
          : { type: 'FeatureCollection', features: [] }
      )
    } else {
      tillSrc.setData(
        showTillable
          ? buildTillableGeo(tillablePolygon)
          : { type: 'FeatureCollection', features: [] }
      )
    }
  }, [showTillable, tillablePolygon, drawTillableMode, tillableDrawPoints, editedTillablePoints])

  // ===========================================================
  // Actions
  // ===========================================================
  // ── Undo via history stack (per user 2026-05-26) ──
  // Pops the most recent pre-action snapshot. Works for every action
  // type that pushed to history: add-vertex, vertex drag, Align, Clear.
  // Previously this was `slice(0, -1)` which always dropped the last
  // vertex regardless of what the user actually just did — moving a
  // vertex then undoing did nothing, then a second undo would delete
  // a different vertex.
  const handleUndo = () => {
    const prev = pointsHistory.current.pop()
    if (prev === undefined) {
      setStatus('Nothing to undo')
      return
    }
    setPoints(prev)
    setDirty(true)
  }
  const handleClear = () => {
    setPoints(prev => {
      pointsHistory.current.push(prev.map(p => [...p] as Pt))
      return []
    })
    setDirty(true)
  }
  const handleCancel = () => {
    // Cancel discards all in-flight edits → wipe the undo history too,
    // there's nothing meaningful to undo back to.
    pointsHistory.current = []
    setPoints(normalizeInitialPolygon(initialPolygon))
    setDirty(false)
    setStatus(null)
  }
  // ── Draw-tillable handlers (per user 2026-05-26) ──
  // Start a fresh tillable polygon. Seeds the drawing points with the
  // tract polygon's vertices when one exists so the user can start by
  // matching the tract outline and then trim away non-tillable bits
  // (water, woods, buildings) — faster than starting from scratch.
  // Start fresh — empty tillable polygon. Per user 2026-05-26 (revised):
  // seeding with tract vertices was confusing because the new green
  // polygon overlapped the pink tract polygon at identical coords,
  // making it look like only the tract was there. User wants to draw
  // a clean new shape by clicking. The "Seed from tract" option lives
  // as a separate button so it's an explicit choice.
  const handleStartTillableDraw = () => {
    setDrawTillableMode(true)
    setTillableDrawPoints([])
    tillableHistory.current = []
    setTillablePreview(null)
    setStatus('Tillable draw mode — click on the map to add vertices (need at least 3). Use Seed from Tract to start with the tract outline.')
  }
  // Optional: seed the current tillable drawing with the tract polygon's
  // vertices. Useful when the tillable is "tract minus a few cutouts"
  // and the user wants to trim instead of draw from scratch.
  const handleSeedTillableFromTract = () => {
    if (points.length < 3) return
    setTillableDrawPoints(prev => {
      tillableHistory.current.push(prev.map(p => [...p] as Pt))
      return points.map(p => [...p] as Pt)
    })
  }
  const handleCancelTillableDraw = () => {
    setDrawTillableMode(false)
    setTillableDrawPoints([])
    tillableHistory.current = []
    setTillablePreview(null)
    setStatus(null)
  }
  const handleClearTillableDraw = () => {
    setTillableDrawPoints(prev => {
      tillableHistory.current.push(prev.map(p => [...p] as Pt))
      return []
    })
    setTillablePreview(null)
  }
  // Tillable Undo: pops the tillable history stack. Same fix as the
  // tract Undo — was previously slice(0,-1) which only worked for the
  // add-vertex case and ignored drag/Clear actions.
  const handleUndoTillableDraw = () => {
    const prev = tillableHistory.current.pop()
    if (prev === undefined) {
      setStatus('Nothing to undo in this tillable draw')
      return
    }
    setTillableDrawPoints(prev)
  }
  // ── Handlers for editing an EXISTING tillable polygon's vertices ──
  // These fire when the user drags a green vertex in non-draw mode.
  const handleUndoEditedTillable = () => {
    const prev = tillableHistory.current.pop()
    if (prev === undefined) {
      setStatus('Nothing to undo')
      return
    }
    setEditedTillablePoints(prev)
  }
  const handleSaveEditedTillable = async () => {
    const pts = editedTillablePoints
    if (!pts || pts.length < 3) {
      setStatus('✗ Need at least 3 points to save a tillable polygon')
      return
    }
    setSavingTillable(true)
    setStatus(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/staging/${stagingId}/tracts/${tractIndex}/tillable`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon: pts }),
        }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setStatus(
        `✓ Tillable saved (${data.acres?.toFixed(2) ?? '—'} ac` +
        (data.soil_rating != null
          ? `, ${data.soil_rating.toFixed(1)} ${data.soil_rating_type})`
          : ')')
      )
      // editedTillablePoints will be cleared by the tillablePolygon
      // prop change effect once the parent calls onUpdate.
      if (onUpdate && data.tract) {
        onUpdate({
          ...data.tract,
          tillable_polygon: data.tract.tillable_polygon,
        })
      }
    } catch (e: any) {
      setStatus(`✗ Save tillable failed: ${e.message || e}`)
    } finally {
      setSavingTillable(false)
    }
  }

  const handleSaveTillable = async () => {
    if (tillableDrawPoints.length < 3) {
      setStatus('✗ Need at least 3 points to save a tillable polygon')
      return
    }
    setSavingTillable(true)
    setStatus(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/staging/${stagingId}/tracts/${tractIndex}/tillable`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon: tillableDrawPoints }),
        }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setStatus(
        `✓ Tillable saved (${data.acres?.toFixed(2) ?? '—'} ac` +
        (data.soil_rating != null
          ? `, ${data.soil_rating.toFixed(1)} ${data.soil_rating_type})`
          : ')')
      )
      // Exit draw mode + push the updated tract up to the parent so
      // the stored tillablePolygon prop refreshes and renders the
      // green overlay from the new shape. Clear history — save is a
      // commit point, no need to undo back through pre-save drafts.
      setDrawTillableMode(false)
      setTillableDrawPoints([])
      tillableHistory.current = []
      setTillablePreview(null)
      if (onUpdate && data.tract) {
        onUpdate({
          ...data.tract,
          // Make sure the green overlay shows immediately
          tillable_polygon: data.tract.tillable_polygon,
        })
      }
    } catch (e: any) {
      setStatus(`✗ Save tillable failed: ${e.message || e}`)
    } finally {
      setSavingTillable(false)
    }
  }

  // ── Live tillable preview (debounced) ──
  // While the user is drawing a tillable polygon, hit the preview
  // endpoint to get area-weighted soil rating + GIS acres. Debounce
  // 500ms after the polygon stops changing so we don't fire on every
  // mousemove of a drag. Acres are computed client-side for instant
  // feedback; soil rating waits for server response.
  useEffect(() => {
    if (!drawTillableMode) {
      setTillablePreview(null)
      return
    }
    if (tillableDrawPoints.length < 3) {
      setTillablePreview({
        acres: 0, soil_rating: null, soil_rating_type: null, loading: false,
      })
      return
    }
    // Instant client-side acres
    const localAcres = gisAcres(tillableDrawPoints)
    setTillablePreview(prev => ({
      acres: localAcres,
      soil_rating: prev?.soil_rating ?? null,
      soil_rating_type: prev?.soil_rating_type ?? null,
      loading: true,
    }))
    // Server-side soil rating, debounced
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(
          `${SCRAPER_URL}/api/staging/${stagingId}/tracts/${tractIndex}/tillable-preview`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ polygon: tillableDrawPoints }),
          }
        )
        const data = await res.json()
        if (data.success) {
          setTillablePreview({
            acres: data.acres ?? localAcres,
            soil_rating: data.soil_rating,
            soil_rating_type: data.soil_rating_type,
            loading: false,
          })
        } else {
          setTillablePreview({
            acres: localAcres, soil_rating: null, soil_rating_type: null, loading: false,
          })
        }
      } catch {
        setTillablePreview({
          acres: localAcres, soil_rating: null, soil_rating_type: null, loading: false,
        })
      }
    }, 500)
    return () => clearTimeout(handle)
  }, [tillableDrawPoints, drawTillableMode, stagingId, tractIndex])

  // ── Capture source image on demand ──
  // Calls the scraper's capture-source-image endpoint which takes a
  // Playwright screenshot (Land ID embed first, then listing page).
  // Stores the result immediately in local state for this session; also
  // persists to the staging DB so future page loads show it too.
  const handleCaptureSourceImage = async () => {
    setCapturingSource(true)
    setStatus(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/staging/${stagingId}/capture-source-image`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setCapturedSourceImage(data.source_image_base64)
      setStatus(`✓ Screenshot captured (${data.source_image_kind})`)
    } catch (e: any) {
      setStatus(`✗ Capture failed: ${e.message || e}`)
    } finally {
      setCapturingSource(false)
    }
  }

  // ── Upload Image: extract boundary via Claude Vision ──
  // User picks any aerial/PDF/map image from their computer. The component
  // sends it to the scraper's vision-upload endpoint together with the
  // tract's stored lat/lng/acres so Vision can anchor the extracted polygon
  // geographically. On success the polygon is loaded onto the map ready to
  // edit and Save. The uploaded image stays visible in the right pane as a
  // visual reference while the user fine-tunes the vertices.
  const handleImageUpload = async (file: File) => {
    // Claude Vision does not support HEIC/HEIF (iPhone photo format). Convert
    // to JPEG using the browser's native image decoder before sending. This
    // works on macOS/Safari which can decode HEIC natively.
    const isHeic =
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      file.name.toLowerCase().endsWith('.heic') ||
      file.name.toLowerCase().endsWith('.heif')
    if (isHeic) {
      try {
        const objectUrl = URL.createObjectURL(file)
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image()
          el.onload = () => resolve(el)
          el.onerror = () =>
            reject(new Error('Could not decode HEIC — save the image as JPEG or PNG and try again'))
          el.src = objectUrl
        })
        URL.revokeObjectURL(objectUrl)
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92)
        const jpegBlob = await (await fetch(jpegDataUrl)).blob()
        const jpegFile = new File(
          [jpegBlob],
          file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'),
          { type: 'image/jpeg' }
        )
        // Recurse with the converted JPEG — no HEIC path this time
        handleImageUpload(jpegFile)
        return
      } catch (e: any) {
        setStatus(`✗ ${e.message || 'HEIC conversion failed'}`)
        return
      }
    }

    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = async () => {
      const b64 = reader.result as string
      setUploadedImage(b64)
      setExtractingFromImage(true)
      setStatus('Extracting boundary from image…')
      try {
        const res = await fetch(
          `${SCRAPER_URL}/api/admin/tracts/vision-upload/extract-boundary-from-image`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_base64: b64,
              lat: latitude,
              lng: longitude,
              acres: scrapedAcres,
              state: listingState,
            }),
          }
        )
        const data = await res.json()
        if (!res.ok || !data.success) {
          throw new Error(data.error || `HTTP ${res.status}`)
        }
        const poly = data.polygon as [number, number][]
        if (!poly || poly.length < 3) throw new Error('No polygon returned from Vision')
        // Snapshot the pre-extract polygon so Undo reverts cleanly
        pointsHistory.current.push(points.map(p => [...p] as Pt))
        setPoints(poly as Pt[])
        setDirty(true)
        const matchLabel = data.acreage_match ?? 'unknown'
        const confLabel = data.vision_confidence ?? '?'
        const acLabel = data.extracted_acres
          ? `${Number(data.extracted_acres).toFixed(1)} ac`
          : '?'
        setStatus(
          `✓ Extracted ${acLabel} (${matchLabel} match, ${confLabel} confidence) — ` +
          `review the polygon on the map, adjust vertices if needed, then Save.`
        )
      } catch (e: any) {
        setStatus(`✗ Extraction failed: ${e.message || e}`)
      } finally {
        setExtractingFromImage(false)
      }
    }
  }

  // ── URL extract: pull Land ID polygon from an auction page URL ──
  // User pastes any auction listing URL into the upload panel's URL field.
  // Backend fetches the page, finds the Land ID iframe hash, pulls the
  // GeoJSON, and returns the polygon whose acreage best matches this tract.
  const handleUrlExtract = async () => {
    const url = urlInput.trim()
    if (!url) return
    setExtractingUrl(true)
    setShowUploadPanel(false)
    setStatus('Fetching Land ID map from URL…')
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/vision-upload/extract-boundary-from-url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, acres: scrapedAcres }),
        }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const poly = data.polygon as [number, number][]
      if (!poly || poly.length < 3) throw new Error('No polygon returned')
      pointsHistory.current.push(points.map(p => [...p] as Pt))
      setPoints(poly as Pt[])
      setDirty(true)
      const matchLabel = data.acreage_match ?? 'unknown'
      const acLabel = data.extracted_acres
        ? `${Number(data.extracted_acres).toFixed(1)} ac`
        : '?'
      setStatus(
        `✓ Extracted from URL — ${acLabel} (${matchLabel} match). ` +
        `Review polygon on the map, then Save.`
      )
      setUrlInput('')
    } catch (e: any) {
      setStatus(`✗ URL extraction failed: ${e.message || e}`)
    } finally {
      setExtractingUrl(false)
    }
  }

  // ── Align: scale polygon about its centroid so its area matches
  //    the auctioneer-published acres. Per user 2026-05-26: when the
  //    shape is right but the size is off (computed says 13.56 but
  //    scraped says 13.86), this is one click instead of redrawing
  //    every vertex. Area scales with the square of linear dimension,
  //    so the scale factor is sqrt(target / current). ──
  const handleAlign = () => {
    if (points.length < 3) return
    const target = Number(scrapedAcres)
    const current = gisAcres(points)
    if (!isFinite(target) || target <= 0 || current <= 0) return
    const factor = Math.sqrt(target / current)
    if (!isFinite(factor) || factor <= 0) return
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length
    setPoints(prev => {
      // Snapshot pre-Align so Undo reverts cleanly.
      pointsHistory.current.push(prev.map(p => [...p] as Pt))
      return prev.map(([x, y]) => [
        cx + (x - cx) * factor,
        cy + (y - cy) * factor,
      ]) as Pt[]
    })
    setDirty(true)
    setStatus(
      `✓ Aligned to ${target.toFixed(2)} ac (was ${current.toFixed(2)} ac)`
    )
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

  // After fullscreen toggles, the container's CSS dimensions change.
  // MapLibre needs an explicit resize() to refresh its internal canvas
  // size — otherwise the map stays the inline size inside the larger
  // fullscreen overlay. Re-fit to polygon if one exists so the larger
  // editor frames the work properly.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Defer to after the CSS layout settles. Two ticks: the first
    // catches the parent's resize, the second after fonts/scrollbars
    // settle on slower machines.
    const t1 = setTimeout(() => {
      try { map.resize() } catch {}
      if (points.length >= 3) {
        try {
          const bounds = new maplibregl.LngLatBounds()
          for (const p of points) bounds.extend(p as [number, number])
          map.fitBounds(bounds, { padding: 40, duration: 0, maxZoom: 18 })
        } catch {}
      }
    }, 60)
    const t2 = setTimeout(() => { try { map.resize() } catch {} }, 300)
    return () => { clearTimeout(t1); clearTimeout(t2) }
    // points intentionally excluded — only re-run on fullscreen change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullscreen])

  // ESC key exits fullscreen — standard modal UX.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const handleDeleteTillable = async () => {
    if (!window.confirm(
      'Delete this tract\'s tillable polygon? The tract polygon stays. ' +
      'You can then redraw the tillable shape manually or click ' +
      '"Compute Tillable" to re-run the auto-detect.'
    )) return
    setDeletingTillable(true)
    setStatus(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/staging/${stagingId}/tracts/${tractIndex}/tillable`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setStatus('✓ Tillable deleted — click Draw Tillable to add a new one')
      setEditedTillablePoints(null)
      tillableHistory.current = []
      if (onUpdate && data.tract) {
        // The server pops tillable_polygon + tillable_acres from the
        // tract dict before returning, so spreading data.tract over
        // ts[idx] in the parent merger leaves the OLD keys untouched —
        // the green overlay never goes away. Explicitly null the keys
        // here so the parent's spread-merge actually clears them.
        onUpdate({
          ...data.tract,
          tillable_polygon: null,
          tillable_acres: null,
          computed: {
            ...(data.tract.computed || {}),
            tillable_acres: null,
          },
        })
      }
    } catch (e: any) {
      setStatus(`✗ Delete tillable failed: ${e.message || e}`)
    } finally {
      setDeletingTillable(false)
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
      if (onUpdate && data.tract) {
        // Explicitly null the keys the server wiped — same reason as
        // handleDeleteTillable: parent uses spread-merge so missing
        // keys don't clear old values.
        onUpdate({
          ...data.tract,
          polygon_coordinates: null,
          polygon_holes: null,
          tillable_polygon: null,
          tillable_acres: null,
          tract_image_base64: null,
          has_tract_image: false,
        })
      }
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

  // In fullscreen mode the editor pops out as a fixed full-viewport
  // overlay (covers the rest of the staging page). The map container
  // stretches to fill the available height (viewport minus the toolbar
  // and source-image strip). Same component instance — MapLibre is
  // resized in-place via the useEffect above.
  const wrapperClass = fullscreen
    ? 'fixed inset-0 z-50 bg-gg-gray-900 border-0 rounded-none overflow-hidden mb-0 flex flex-col'
    : 'w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg overflow-hidden mb-2'
  // When fullscreen, the map fills the viewport (minus ~120px reserved
  // for the toolbar + status). When inline, use the editorHeight prop.
  const mapHeight = fullscreen ? 'calc(100vh - 120px)' : editorHeight

  return (
    <div ref={wrapperRef} className={wrapperClass}>
      {/* Map + image side-by-side. Stacks vertically on small screens. */}
      <div className={`flex flex-col md:flex-row ${fullscreen ? 'flex-1 min-h-0' : ''}`}>
        {/* LEFT: interactive map (~60% on md+). The container is
            always in the DOM (so IntersectionObserver has something
            to observe) but MapLibre only mounts after first
            visibility — until then this is just an empty div with the
            right dimensions. */}
        <div className={`${fullscreen ? 'md:w-2/3' : 'md:w-3/5'} w-full relative bg-gg-gray-800`}>
          <div
            ref={containerRef}
            style={{ width: '100%', height: mapHeight }}
            className={hasBeenVisible ? '' : 'flex items-center justify-center'}
          >
            {!hasBeenVisible && (
              <span className="text-xs text-gg-gray-500">Map loads on scroll</span>
            )}
          </div>
          {/* Align overlay button — appears whenever the drawn polygon
              area differs from the scraped acres at the hundredth-of-
              an-acre level. Per user 2026-05-26 update: even a tiny
              gap matters, so we compare rounded-to-2-decimals values
              not a percent threshold. One click scales the polygon
              about its centroid to match the scraped value exactly. */}
          {(() => {
            const target = Number(scrapedAcres)
            if (!isFinite(target) || target <= 0) return null
            if (points.length < 3) return null
            const cur = drawnAcres
            if (cur <= 0) return null
            // Round both to 2 decimal places — show the button unless
            // they're identical to the hundredth.
            const rTarget = Math.round(target * 100) / 100
            const rCur = Math.round(cur * 100) / 100
            if (rTarget === rCur) return null
            const dir = cur > target ? 'shrink' : 'expand'
            const diffAc = Math.abs(rCur - rTarget).toFixed(2)
            return (
              <button
                onClick={handleAlign}
                title={`${dir === 'shrink' ? 'Shrink' : 'Expand'} polygon to match scraped acres exactly (${target.toFixed(2)} ac). Currently drawn: ${cur.toFixed(2)} ac (${diffAc} ac ${dir === 'shrink' ? 'too big' : 'too small'}).`}
                className="absolute top-2 left-2 z-10 px-2.5 py-1.5 text-xs font-semibold bg-gg-pink hover:bg-gg-pink-light text-white rounded shadow-lg flex items-center gap-1.5 backdrop-blur-sm"
              >
                <Crosshair size={14} />
                Align to {target.toFixed(2)} ac
                <span className="opacity-70 text-[10px]">
                  ({dir === 'shrink' ? '−' : '+'}{diffAc} ac)
                </span>
              </button>
            )
          })()}
        </div>
        {/* RIGHT: comparison source image (~40% on md+).
            Per user 2026-05-26: "I HAVE to have an image on the right."
            Render priority:
              1. capturedSourceImage — just taken via Capture button
              2. sourceImageBase64 — Land ID/PDF/aerial b64 from pipeline
              3. sourceImageUrl (pdf/sub_page) — iframe (browsers render)
              4. sourceImageUrl (other, not land_id_url) — <img src>
              5. tractImageBase64 — satellite+polygon overlay we generated
              6. Capture Screenshot button (with listing URL link) + spinner
            land_id_url is deliberately skipped for iframe (X-Frame blocked)
            and falls straight to step 5/6 so the user isn't left with a
            blank white rectangle.
        */}
        <div className={`${fullscreen ? 'md:w-1/3' : 'md:w-2/5'} w-full bg-gg-gray-800 border-l border-gg-gray-700 flex items-center justify-center relative overflow-hidden`}>
          {/* Priority 0: upload panel — shown when user clicks "Upload Image".
              Offers URL input (Land ID extraction) and paste/drop/pick image
              zone, matching the upload-boundary-tract page UX. The panel
              fills the right pane; × or clicking Upload Image again closes it. */}
          {showUploadPanel ? (
            <div className="absolute inset-0 bg-gg-gray-800 flex flex-col gap-3 p-4 overflow-y-auto z-10">
              <div className="flex items-center justify-between flex-shrink-0">
                <span className="text-sm font-semibold text-white">Upload Image or URL</span>
                <button
                  onClick={() => setShowUploadPanel(false)}
                  className="text-gg-gray-400 hover:text-white text-xl leading-none px-1"
                >×</button>
              </div>
              {/* URL section */}
              <div className="text-[10px] text-gg-gray-400 uppercase tracking-wider font-semibold flex-shrink-0">
                Auction URL with a Land ID map
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <input
                  type="url"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && urlInput.trim()) handleUrlExtract()
                  }}
                  placeholder="https://…"
                  disabled={extractingUrl || extractingFromImage}
                  className="flex-1 min-w-0 px-2 py-1.5 bg-gg-gray-900 border border-gg-gray-700 rounded text-xs text-white placeholder-gg-gray-500 focus:outline-none focus:border-gg-pink disabled:opacity-50"
                />
                <button
                  onClick={handleUrlExtract}
                  disabled={extractingUrl || !urlInput.trim()}
                  className="px-2.5 py-1.5 bg-gg-pink hover:bg-gg-pink/85 disabled:opacity-50 text-white text-xs font-semibold rounded flex items-center gap-1 flex-shrink-0"
                >
                  {extractingUrl
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Sparkles size={12} />}
                  {extractingUrl ? 'Fetching…' : 'Extract'}
                </button>
              </div>
              {/* Divider */}
              <div className="flex items-center gap-2 text-[10px] text-gg-gray-600 flex-shrink-0">
                <div className="flex-1 border-t border-gg-gray-700" />
                <span>or</span>
                <div className="flex-1 border-t border-gg-gray-700" />
              </div>
              {/* Image drop/paste/pick zone */}
              <div className="text-[10px] text-gg-gray-400 uppercase tracking-wider font-semibold flex-shrink-0">
                Paste, drop, or pick an image
              </div>
              <label
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault()
                  const file = e.dataTransfer.files?.[0]
                  if (file) { setShowUploadPanel(false); handleImageUpload(file) }
                }}
                className="flex-1 min-h-[80px] border-2 border-dashed border-gg-gray-700 rounded-lg flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-gg-pink/50 transition-colors p-3"
              >
                <ImageIcon size={24} className="text-gg-gray-500" />
                <div className="text-center text-xs text-gg-gray-400">
                  <div className="font-medium">Paste, drop, or click to pick</div>
                  <div className="text-[10px] text-gg-gray-500 mt-0.5">
                    Auction screenshot, GIS export, or PDF boundary map
                  </div>
                </div>
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) { setShowUploadPanel(false); handleImageUpload(file) }
                    e.target.value = ''
                  }}
                />
              </label>
            </div>
          /* Priority 1: user-uploaded image + Vision extraction overlay.
             Shows as soon as the user picks/drops/pastes a file and stays
             visible after extraction completes so the polygon can be compared
             against the image used to extract it. */
          ) : uploadedImage ? (
            <>
              <img
                src={uploadedImage}
                alt="Uploaded image for boundary extraction"
                style={{ maxHeight: mapHeight }}
                className="w-full h-full object-contain"
              />
              {extractingFromImage && (
                <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-2">
                  <Loader2 size={28} className="animate-spin text-white" />
                  <span className="text-xs text-white">Extracting boundary…</span>
                  <span className="text-[10px] text-white/70">
                    Claude Vision is tracing the polygon — may take 15–30 s
                  </span>
                </div>
              )}
              <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                {extractingFromImage ? 'extracting…' : 'uploaded'}
              </span>
              <button
                onClick={() => setUploadedImage(null)}
                className="absolute top-1 left-1 px-1.5 py-0.5 text-[10px] bg-black/60 hover:bg-black/80 text-white rounded"
                title="Clear uploaded image"
              >
                ×
              </button>
            </>
          /* Priority 2: just-captured screenshot (this session) */
          ) : capturedSourceImage ? (
            <>
              <img
                src={`data:image/jpeg;base64,${capturedSourceImage}`}
                alt={`Tract ${tractIndex + 1} captured screenshot`}
                style={{ maxHeight: mapHeight }}
                className="w-full h-full object-contain"
              />
              <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                captured
              </span>
            </>
          /* Priority 2: base64 source image from pipeline */
          ) : sourceImageBase64 ? (
            <>
              <img
                src={`data:image/jpeg;base64,${sourceImageBase64}`}
                alt={`Tract ${tractIndex + 1} source reference`}
                style={{ maxHeight: mapHeight }}
                className="w-full h-full object-contain"
              />
              {sourceImageKind && (
                <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                  {sourceImageKind}
                </span>
              )}
            </>
          /* Priority 3: PDF or sub-page — iframeable */
          ) : sourceImageUrl && (sourceImageKind === 'pdf' || sourceImageKind === 'sub_page') ? (
            <>
              <iframe
                src={sourceImageUrl}
                style={{ width: '100%', height: mapHeight, border: 0 }}
                title={`Tract ${tractIndex + 1} source`}
              />
              <a
                href={sourceImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded hover:bg-black/80"
                title="Open source in new tab"
              >
                {sourceImageKind} ↗
              </a>
            </>
          /* Priority 4: other URL — load as <img> (aerial CDN images etc.) */
          ) : sourceImageUrl && sourceImageKind !== 'land_id_url' ? (
            <>
              <img
                src={sourceImageUrl}
                alt={`Tract ${tractIndex + 1} source reference`}
                style={{ maxHeight: mapHeight }}
                className="w-full h-full object-contain"
              />
              {sourceImageKind && (
                <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                  {sourceImageKind}
                </span>
              )}
            </>
          /* Priority 5: satellite+polygon overlay we generated */
          ) : tractImageBase64 ? (
            <>
              <img
                src={`data:image/png;base64,${tractImageBase64}`}
                alt={`Tract ${tractIndex + 1} satellite reference`}
                style={{ maxHeight: mapHeight }}
                className="w-full h-full object-contain"
              />
              <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-black/60 text-white rounded">
                satellite overlay
              </span>
            </>
          /* Priority 6: nothing yet — offer Capture button */
          ) : (
            <div className="flex flex-col items-center gap-3 text-gg-gray-400 py-8 px-4 text-center">
              {capturingSource ? (
                <>
                  <Loader2 size={28} className="animate-spin text-gg-gray-400" />
                  <span className="text-xs">Taking screenshot…</span>
                  <span className="text-[10px] text-gg-gray-600">Opening listing page with Playwright — may take 10–20 s</span>
                </>
              ) : (
                <>
                  <Camera size={28} />
                  <button
                    onClick={handleCaptureSourceImage}
                    className="px-3 py-1.5 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 text-white rounded flex items-center gap-1.5"
                    title="Take a Playwright screenshot of the listing page and store it here"
                  >
                    <Camera size={12} /> Capture Screenshot
                  </button>
                  {listingUrl && (
                    <a
                      href={listingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-gg-gray-500 hover:text-gg-gray-300 underline break-all"
                      title="Open the listing page in a new tab"
                    >
                      {listingUrl.replace(/^https?:\/\//, '').substring(0, 60)}
                      {listingUrl.length > 66 ? '…' : ''}
                    </a>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Toolbar — full-width below the map + image. */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gg-gray-800 border-t border-gg-gray-700">
        <div className="flex flex-col gap-0.5 text-xs text-gg-gray-300">
          {drawTillableMode ? (
            <>
              {/* Per user 2026-05-26: green-300 was unreadable on the
                  light toolbar background. Bumped to green-700 + bold
                  + small green-tinted bg pill so the readout pops on
                  either light or dark backgrounds. */}
              <div className="flex items-center gap-3">
                <span className="px-2 py-0.5 rounded bg-green-700 text-white font-bold text-xs">
                  Drawing Tillable
                </span>
                <span className="text-gg-gray-700">
                  ({tillableDrawPoints.length} vertices)
                </span>
                {tillablePreview?.acres != null && tillablePreview.acres > 0 && (
                  <span className="text-green-700 font-bold">
                    Tillable: {tillablePreview.acres.toFixed(2)} ac
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                {tillablePreview?.loading ? (
                  <span className="text-gg-gray-700">
                    <Loader2 className="inline animate-spin" size={10} /> Computing soil rating…
                  </span>
                ) : tillablePreview?.soil_rating != null ? (
                  <span className="text-green-700 font-bold">
                    Soil: {tillablePreview.soil_rating.toFixed(1)}
                    {tillablePreview.soil_rating_type ? ` ${tillablePreview.soil_rating_type}` : ''}
                  </span>
                ) : tillableDrawPoints.length >= 3 ? (
                  <span className="text-gg-gray-600">Soil rating: not available for this state</span>
                ) : (
                  <span className="text-gg-gray-600">Click on the map to add vertices…</span>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3">
                <span>Click the map to add vertices ({points.length} so far)</span>
                {points.length >= 3 && (
                  <span className="text-gg-pink font-semibold">Drawn: {drawnAcres.toFixed(2)} ac</span>
                )}
              </div>
              {/* Perimeter — recalculated live from current polygon
                  points so it updates as the user adds/removes/edits
                  vertices. */}
              {points.length >= 3 && (
                <div className="text-gg-pink font-semibold">
                  Perimeter: {formatPerimeter(polygonPerimeterFeet(points))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {/* Tillable toggle — show/hide if Stage 5 already computed,
              compute if it hasn't run yet. Per user 2026-05-25:
              "Only show tract polygon first, then a button to draw
              tillable polygons using the Hybrid approach." */}
          {/* Full-screen toggle — pops the editor out as a fixed
              full-viewport overlay. Per user 2026-05-26: the inline
              map is too small to accurately draw new polygons; needs a
              way to expand to the full window for precise editing. */}
          {/* Upload Image — opens an inline panel in the right pane with
              both a URL input (Land ID map extraction) and a paste/drop/
              pick image zone. Matches the upload-boundary-tract page UX. */}
          <button
            onClick={() => setShowUploadPanel(prev => !prev)}
            disabled={extractingFromImage || extractingUrl}
            className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
              showUploadPanel
                ? 'bg-gg-pink hover:bg-gg-pink/85 text-white'
                : 'bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40'
            }`}
            title="Open the upload panel — paste/drop/pick an image or enter an auction URL to extract the tract boundary"
          >
            {(extractingFromImage || extractingUrl)
              ? <Loader2 className="animate-spin" size={12} />
              : <ImageIcon size={12} />}
            {extractingFromImage ? 'Extracting…' : extractingUrl ? 'Fetching…' : 'Upload Image'}
          </button>
          <button
            onClick={() => setFullscreen(prev => !prev)}
            className="px-2 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 rounded flex items-center gap-1"
            title={fullscreen ? 'Exit full screen (Esc)' : 'Open full-screen editor'}
          >
            {fullscreen
              ? (<><Minimize2 size={12} /> Exit Full Screen</>)
              : (<><Maximize2 size={12} /> Full Screen</>)}
          </button>
          {/* Tillable toolbar — three modes per user 2026-05-26:
              A. Drawing a new tillable polygon (drawTillableMode=true):
                 Save / Undo / Clear / Cancel
              B. Tillable exists, not drawing: Show/Hide, Delete, Draw New
              C. No tillable yet, not drawing: Draw Tillable + Compute */}
          {drawTillableMode ? (
            <>
              {/* Per user 2026-05-26: Draw Tillable starts EMPTY so
                  the new shape is clearly separate from the tract.
                  Use Seed from Tract when the tillable is "tract minus
                  a few cutouts" and you'd rather trim than draw fresh. */}
              {points.length >= 3 && (
                <button
                  onClick={handleSeedTillableFromTract}
                  disabled={savingTillable}
                  className="px-2 py-1 text-xs bg-green-700/80 hover:bg-green-700 text-white disabled:opacity-40 rounded flex items-center gap-1"
                  title="Replace current tillable drawing with the tract polygon's vertices, then trim non-tillable parts"
                >
                  <Sprout size={12} /> Seed from Tract
                </button>
              )}
              <button
                onClick={handleUndoTillableDraw}
                disabled={tillableDrawPoints.length === 0 || savingTillable}
                className="px-2 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40 rounded flex items-center gap-1"
              >
                <RotateCcw size={12} /> Undo
              </button>
              <button
                onClick={handleClearTillableDraw}
                disabled={tillableDrawPoints.length === 0 || savingTillable}
                className="px-2 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40 rounded flex items-center gap-1"
              >
                <RotateCcw size={12} /> Clear
              </button>
              <button
                onClick={handleCancelTillableDraw}
                disabled={savingTillable}
                className="px-2 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40 rounded"
              >
                Cancel Draw
              </button>
              <button
                onClick={handleSaveTillable}
                disabled={tillableDrawPoints.length < 3 || savingTillable}
                className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-40 rounded flex items-center gap-1"
                title={tillableDrawPoints.length < 3
                  ? 'Add at least 3 vertices first'
                  : 'Save this tillable polygon and recompute soil rating'}
              >
                {savingTillable ? <Loader2 className="animate-spin" size={12} /> : <Save size={12} />}
                {savingTillable ? 'Saving…' : 'Save Tillable'}
              </button>
            </>
          ) : tillablePolygon ? (
            <>
              <button
                onClick={() => onToggleTillable?.(!showTillable)}
                className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                  showTillable
                    ? 'bg-green-600 hover:bg-green-700 text-white'
                    : 'bg-gg-gray-700 hover:bg-gg-gray-600'
                }`}
                title={showTillable
                  ? 'Hide the green tillable overlay'
                  : 'Show tillable polygon and allow vertex editing'}
              >
                {showTillable
                  ? (<><EyeOff size={12} /> Hide Tillable</>)
                  : (<><Sprout size={12} /> Show Tillable</>)}
              </button>
              {/* Inline vertex-edit controls — appear as soon as the user
                  drags a green tillable vertex (editedTillablePoints goes
                  non-null on first drag). Per user 2026-05-26: tillable
                  polygon should be editable without needing to delete and
                  redraw from scratch. */}
              {editedTillablePoints !== null && (
                <>
                  <button
                    onClick={handleUndoEditedTillable}
                    disabled={savingTillable}
                    className="px-2 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40 rounded flex items-center gap-1"
                    title="Undo last tillable vertex move"
                  >
                    <RotateCcw size={12} /> Undo
                  </button>
                  <button
                    onClick={handleSaveEditedTillable}
                    disabled={savingTillable}
                    className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 text-white font-semibold disabled:opacity-40 rounded flex items-center gap-1"
                    title="Save the adjusted tillable polygon and recompute soil rating"
                  >
                    {savingTillable ? <Loader2 className="animate-spin" size={12} /> : <Save size={12} />}
                    {savingTillable ? 'Saving…' : 'Save Tillable'}
                  </button>
                </>
              )}
              <button
                onClick={handleDeleteTillable}
                disabled={saving || deleting || deletingTillable}
                className="px-2 py-1 text-xs bg-red-600/70 hover:bg-red-600 text-white disabled:opacity-40 rounded flex items-center gap-1"
                title="Wipe the tillable polygon only (keeps tract polygon). Use Draw Tillable to draw a new one."
              >
                {deletingTillable ? <Loader2 className="animate-spin" size={12} /> : <Trash2 size={12} />}
                Delete Tillable
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleStartTillableDraw}
                className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-1"
                title={points.length >= 3
                  ? 'Draw the tillable polygon by hand (seeded with tract polygon)'
                  : 'Draw the tillable polygon by hand (click on the map to add vertices)'}
              >
                <Sprout size={12} /> Draw Tillable
              </button>
              {onComputeTillable && (
                <button
                  onClick={async () => {
                    setComputingTillable(true)
                    try { await onComputeTillable() }
                    finally { setComputingTillable(false) }
                  }}
                  disabled={computingTillable || points.length < 3}
                  className="px-2 py-1 text-xs bg-green-600/60 hover:bg-green-600 text-white disabled:opacity-40 rounded flex items-center gap-1"
                  title={points.length < 3
                    ? 'Need a saved tract polygon first'
                    : 'Auto-compute hybrid tillable (FTW + CDL + NHD subtract + sliver merge)'}
                >
                  {computingTillable
                    ? <Loader2 className="animate-spin" size={12} />
                    : <Sprout size={12} />}
                  {computingTillable ? 'Computing…' : 'Auto Tillable'}
                </button>
              )}
            </>
          )}
          {/* Tract-polygon buttons — hidden in tillable draw mode so
              the user can't accidentally edit the tract while drawing
              the tillable. The tillable section above provides its own
              Undo/Clear/Cancel/Save. */}
          {!drawTillableMode && (
            <>
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
            disabled={saving || deleting || deletingTillable}
            className="px-2 py-1 text-xs bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 rounded flex items-center gap-1"
            title="Delete the tract polygon, tillable polygon, and image (server-side wipe)"
          >
            {deleting ? <Loader2 className="animate-spin" size={12} /> : <Trash2 size={12} />}
            Delete Tract
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
            </>
          )}
        </div>
      </div>

      {/* Status line — visible after save/delete attempts.
          Per user 2026-05-26: the previous semi-transparent bg
          (bg-green-900 at /30 alpha) was too washed out — bumped to
          solid panels with high-contrast white text + a click-to-
          dismiss so stale success messages don't linger. */}
      {status && (
        <div
          onClick={() => setStatus(null)}
          className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${
            status.startsWith('✓')
              ? 'bg-green-700 text-white border-t border-green-600'
              : 'bg-red-700 text-white border-t border-red-600'
          }`}
          title="Click to dismiss"
        >
          <span>{status}</span>
          <span className="text-xs opacity-70 ml-3">Dismiss ×</span>
        </div>
      )}
    </div>
  )
}
