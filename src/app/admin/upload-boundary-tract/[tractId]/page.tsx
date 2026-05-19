'use client'

/**
 * Upload-Boundary admin page — paste an auction-website screenshot
 * and let Claude Vision extract the tract boundary automatically.
 *
 * Flow:
 *   1. Page loads tract context (acres, county, lat/lng)
 *   2. Admin pastes/drops/picks an image with the boundary highlighted
 *   3. Click "Extract with Claude Vision" (or Surety Extract / inline Draw)
 *   4. Backend calls Vision, returns lat/lng polygon
 *   5. Polygon renders on satellite map with acreage check
 *   6. Click Save Boundary → POST /save-draft writes the polygon to
 *      proposed_polygon + proposed_status='ready_for_review', then we
 *      redirect to /admin/missing-boundaries?listing_id=…&focus_tract=…
 *      so the admin can finish Align → Tillable → Align Tillable →
 *      Soil Rating → Approve using the same workflow as Auto-Extract.
 *      (Per user 2026-05-19: upload-image and draw-boundary should
 *      produce a DRAFT and route through missing-boundaries for the
 *      rest of the steps, not commit to live data here.)
 *
 * This page is the auto path. The standalone /admin/boundary-draw-tract/[id]
 * route now redirects straight to /admin/missing-boundaries with the
 * tract focused — see that page for the click-to-draw fallback.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ArrowLeft, Sparkles, Save, Loader2, RotateCcw, ImageIcon } from 'lucide-react'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'

type Pt = [number, number]

function buildPolyGeo(points: Pt[]) {
  if (points.length < 3) return { type: 'FeatureCollection', features: [] } as any
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

// Find the closest edge of `polygon` to point (lng, lat) and return the
// pixel-space insert index + the projected lat/lng on that edge.
// Used for click-on-edge to insert a new vertex at the clicked location.
function findClosestEdgeInsert(
  polygon: Pt[], lng: number, lat: number, project: (p: Pt) => { x: number; y: number }
): { insertAt: number; point: Pt } | null {
  if (polygon.length < 2) return null
  const tgt = project([lng, lat])
  let best = { insertAt: -1, dist: Infinity, point: [lng, lat] as Pt }
  for (let i = 0; i < polygon.length; i++) {
    const a = project(polygon[i])
    const b = project(polygon[(i + 1) % polygon.length])
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    if (len2 === 0) continue
    let t = ((tgt.x - a.x) * dx + (tgt.y - a.y) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const px = a.x + t * dx, py = a.y + t * dy
    const d = Math.hypot(tgt.x - px, tgt.y - py)
    if (d < best.dist) {
      // Project the midpoint back to lng/lat by linear interp on the polygon points
      const lng_i = polygon[i][0] + t * (polygon[(i + 1) % polygon.length][0] - polygon[i][0])
      const lat_i = polygon[i][1] + t * (polygon[(i + 1) % polygon.length][1] - polygon[i][1])
      best = { insertAt: i + 1, dist: d, point: [lng_i, lat_i] }
    }
  }
  if (best.insertAt < 0 || best.dist > 12) return null  // 12px snap radius
  return { insertAt: best.insertAt, point: best.point }
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

export default function UploadBoundaryTractPage() {
  const params = useParams()
  const router = useRouter()
  const tractId = String(params.tractId)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [tract, setTract] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  // When backend extract returns 422 needs_precise_anchor we surface
  // an inline form for the admin to enter the right street address or
  // direct lat/lng. Per user 2026-05-19: never silently fall back to a
  // city/ZIP centroid — fail loudly so the admin can fix it.
  const [needsAnchor, setNeedsAnchor] = useState<{
    listing_title?: string
    listing_source_url?: string
    listing_county?: string
    listing_state?: string
    listing_address?: string
    message?: string
  } | null>(null)
  const [anchorAddress, setAnchorAddress] = useState<string>('')
  const [anchorLat, setAnchorLat] = useState<string>('')
  const [anchorLng, setAnchorLng] = useState<string>('')
  const [savingAnchor, setSavingAnchor] = useState<boolean>(false)
  const [urlInput, setUrlInput] = useState<string>('')
  const [extractingUrl, setExtractingUrl] = useState<boolean>(false)
  const [suretyUrlInput, setSuretyUrlInput] = useState<string>('')
  const [extractingSurety, setExtractingSurety] = useState<boolean>(false)
  const [polygon, setPolygon] = useState<Pt[]>([])
  // Polygon edit history for Cmd+Z undo. Push the polygon BEFORE each
  // mutation; pop on undo. Capped at 50 to avoid unbounded growth.
  const polygonHistoryRef = useRef<Pt[][]>([])
  const draggingVertexRef = useRef<number | null>(null)
  // Polygon-body drag: when non-null, holds the lng/lat of the cursor
  // at the previous mousemove tick so we can compute deltas.
  const draggingPolygonRef = useRef<{ lng: number; lat: number } | null>(null)
  // Lock down ALL map interactions during a drag — just disabling
  // dragPan wasn't enough (per user 2026-05-19r: "the map zooms and
  // moves around so it's impossible to get it right"). Trackpad
  // gestures, scrollZoom, doubleClickZoom, boxZoom, dragRotate, and
  // keyboard all need to be off so the canvas stays put while the
  // admin precisely places a vertex.
  const lockMapForDrag = (m: maplibregl.Map) => {
    try { m.dragPan.disable() } catch {}
    try { m.scrollZoom.disable() } catch {}
    try { m.boxZoom.disable() } catch {}
    try { m.doubleClickZoom.disable() } catch {}
    try { (m as any).touchZoomRotate?.disable?.() } catch {}
    try { (m as any).dragRotate?.disable?.() } catch {}
    try { (m as any).keyboard?.disable?.() } catch {}
  }
  const unlockMapAfterDrag = (m: maplibregl.Map) => {
    try { m.dragPan.enable() } catch {}
    try { m.scrollZoom.enable() } catch {}
    try { m.boxZoom.enable() } catch {}
    try { m.doubleClickZoom.enable() } catch {}
    try { (m as any).touchZoomRotate?.enable?.() } catch {}
    try { (m as any).dragRotate?.enable?.() } catch {}
    try { (m as any).keyboard?.enable?.() } catch {}
  }
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [extractMeta, setExtractMeta] = useState<{
    extracted_acres?: number
    expected_acres?: number
    acreage_match?: 'good' | 'loose' | 'off' | null
    confidence?: 'high' | 'medium' | 'low'
    notes?: string
    tract_label_matched?: string | null
    projection_method?: string | null
    polygon_source?: string | null
    boundary_color?: string | null
    boundary_center_from_image?: [number, number] | null
    // Surety pipeline classification
    map_type?: 'per_tract_tillable' | 'per_tract_full' | 'multi_tract_overview' | 'unknown'
    polygon_kind?: 'tillable' | 'full' | 'multi' | 'unknown'
    anchor_method?: 'map_center_dms' | 'section_center' | null
    listing_tillable_acres?: number | null
    listing_total_acres?: number | null
    acreage_delta_tillable?: number | null
    acreage_delta_total?: number | null
  } | null>(null)

  // Load tract details. The scraper endpoint wraps the row under a
  // `tract` key (`{success, tract: {...}}`), so we unwrap to match the
  // existing /admin/boundary-draw-tract page's behavior.
  useEffect(() => {
    let cancelled = false
    fetch(`${SCRAPER_URL}/api/admin/tracts/${tractId}/details`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (!body.success) throw new Error(body.error)
        setTract(body.tract)

        // Pre-populate the editor with the Auto-Extract proposed
        // polygon when one is waiting for review. Admin can drag-
        // correct it and Save — no need to re-paste image URLs.
        const proposed = body.tract?.proposed_polygon
        if (Array.isArray(proposed) && proposed.length >= 3
            && body.tract?.proposed_status === 'ready_for_review') {
          const pts: Pt[] = proposed.map((p: any) => [Number(p[0]), Number(p[1])])
          setPolygon(pts)
          polygonHistoryRef.current = [[...pts]]
          setExtractMeta({
            extracted_acres: body.tract.proposed_acres,
            expected_acres: body.tract.total_acres,
            confidence: 'medium',
            notes: 'Pre-loaded from Auto-Extract proposed polygon. Drag to correct any drift, then Save.',
            polygon_source: 'auto_extract',
            projection_method: (body.tract.proposed_extraction_meta || {}).anchor_method,
          })
        }
      })
      .catch(e => { if (!cancelled) setError(String(e.message || e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tractId])

  // Init map once tract is loaded. Tract may not have its own lat/lng
  // (common for missing-boundaries tracts) — fall back to the parent
  // listing's coordinates so the map still has something to center on.
  useEffect(() => {
    if (!tract || !containerRef.current || mapRef.current) return
    // Centroid resolution order:
    //   1. tract.latitude/longitude (already-saved tract)
    //   2. centroid of proposed_polygon (Auto-Extract waiting for review)
    //   3. listing centroid (parent fall-back)
    let lat = Number(tract.latitude)
    let lng = Number(tract.longitude)
    const proposed = tract.proposed_polygon
    if ((!Number.isFinite(lat) || !lat) && Array.isArray(proposed) && proposed.length >= 3) {
      const cy = proposed.reduce((s: number, p: any) => s + Number(p[1]), 0) / proposed.length
      const cx = proposed.reduce((s: number, p: any) => s + Number(p[0]), 0) / proposed.length
      if (Number.isFinite(cy) && Number.isFinite(cx)) { lat = cy; lng = cx }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) {
      lat = Number(tract.listing_latitude)
      lng = Number(tract.listing_longitude)
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng)) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION } },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
      center: [lng, lat],
      zoom: 16,
      // Boundary-editor UX hardening: kill interactions that can
      // recenter/rotate the map on accidental input mid-edit.
      // Per user 2026-05-19u.
      doubleClickZoom: false,
      boxZoom: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      // If we pre-populated the editor with a proposed polygon, fit
      // the map to it instead of showing a tight zoom at the centroid.
      const pre = polygonRef.current
      if (pre && pre.length >= 3) {
        const lngs = pre.map(p => p[0])
        const lats = pre.map(p => p[1])
        map.fitBounds(
          [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
          { padding: 60, duration: 0 },
        )
      }
      map.addSource('vision-poly', { type: 'geojson', data: buildPolyGeo([]) })
      map.addLayer({
        id: 'vision-fill', type: 'fill', source: 'vision-poly',
        paint: { 'fill-color': '#E91E8C', 'fill-opacity': 0.18 },
      })
      map.addLayer({
        id: 'vision-line', type: 'line', source: 'vision-poly',
        paint: { 'line-color': '#E91E8C', 'line-width': 2.5 },
      })
      // Draggable vertex handles
      map.addSource('vision-vertices', { type: 'geojson', data: buildVertexGeo([]) })
      map.addLayer({
        id: 'vision-vertex', type: 'circle', source: 'vision-vertices',
        paint: {
          'circle-radius': 6,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#E91E8C',
          'circle-stroke-width': 2,
        },
      })

      // Vertex drag: mousedown on a vertex starts a drag; the
      // window-level move/up handlers (registered in a separate effect)
      // do the actual movement so the cursor can leave the canvas.
      map.on('mousedown', 'vision-vertex', (e) => {
        e.preventDefault()
        const f = e.features?.[0]
        const idx = f?.properties?.idx
        if (typeof idx === 'number') {
          draggingVertexRef.current = idx
          map.getCanvas().style.cursor = 'grabbing'
          // Lock down every map interaction so the canvas can't pan,
          // zoom, or scroll-zoom out from under the cursor while the
          // admin is precisely positioning a vertex. Per user 2026-
          // 05-19r.
          lockMapForDrag(map)
          polygonHistoryRef.current.push(polygonRef.current)
          if (polygonHistoryRef.current.length > 50) polygonHistoryRef.current.shift()
        }
      })
      map.on('mouseenter', 'vision-vertex', () => { map.getCanvas().style.cursor = 'grab' })
      map.on('mouseleave', 'vision-vertex', () => {
        if (draggingVertexRef.current === null
            && draggingPolygonRef.current === null) {
          map.getCanvas().style.cursor = ''
        }
      })

      // Polygon body drag: mousedown on the FILL (anywhere inside the
      // polygon, but not on a vertex) starts a translation drag. All
      // vertices move together by the lat/lng delta of cursor movement.
      map.on('mousedown', 'vision-fill', (e) => {
        // Skip if mousedown is also on a vertex — vertex drag wins
        const vertexHits = map.queryRenderedFeatures(e.point, { layers: ['vision-vertex'] })
        if (vertexHits.length > 0) return
        e.preventDefault()
        draggingPolygonRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat }
        map.getCanvas().style.cursor = 'grabbing'
        lockMapForDrag(map)
        polygonHistoryRef.current.push(polygonRef.current)
        if (polygonHistoryRef.current.length > 50) polygonHistoryRef.current.shift()
      })
      map.on('mouseenter', 'vision-fill', (e) => {
        // Don't override the vertex-grab cursor
        const vertexHits = map.queryRenderedFeatures(e.point, { layers: ['vision-vertex'] })
        if (vertexHits.length === 0 && draggingVertexRef.current === null) {
          map.getCanvas().style.cursor = 'move'
        }
      })
      map.on('mouseleave', 'vision-fill', () => {
        if (draggingVertexRef.current === null
            && draggingPolygonRef.current === null) {
          map.getCanvas().style.cursor = ''
        }
      })

      // Click on the polygon line to INSERT a new vertex at the click
      // location. Alt-click on a vertex DELETES it.
      map.on('click', 'vision-line', (e) => {
        const poly = polygonRef.current
        if (poly.length < 2) return
        const proj = (p: Pt) => {
          const px = map.project([p[0], p[1]])
          return { x: px.x, y: px.y }
        }
        const ins = findClosestEdgeInsert(poly, e.lngLat.lng, e.lngLat.lat, proj)
        if (!ins) return
        polygonHistoryRef.current.push(poly)
        if (polygonHistoryRef.current.length > 50) polygonHistoryRef.current.shift()
        const next = [...poly]
        next.splice(ins.insertAt, 0, [e.lngLat.lng, e.lngLat.lat])
        setPolygon(next)
      })
      map.on('click', 'vision-vertex', (e) => {
        if (!(e.originalEvent as MouseEvent).altKey) return
        const f = e.features?.[0]
        const idx = f?.properties?.idx
        if (typeof idx !== 'number') return
        const poly = polygonRef.current
        if (poly.length <= 3) return  // never let it drop below a triangle
        polygonHistoryRef.current.push(poly)
        if (polygonHistoryRef.current.length > 50) polygonHistoryRef.current.shift()
        setPolygon(poly.filter((_, i) => i !== idx))
      })
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [tract])

  // Mirror polygon state into a ref so the map event handlers above
  // (which close over the initial empty array) always see the live
  // polygon. Without this, drag/click handlers would always operate
  // on the polygon-state-at-map-init time.
  const polygonRef = useRef<Pt[]>([])
  useEffect(() => { polygonRef.current = polygon }, [polygon])

  // Window-level mousemove/mouseup to handle drag even when the cursor
  // leaves the vertex (which fires too quickly to track via mapbox events).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onMove = (e: MouseEvent) => {
      const rect = map.getCanvas().getBoundingClientRect()
      const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top])

      // Vertex drag: move just one vertex
      const idx = draggingVertexRef.current
      if (idx !== null) {
        const next = [...polygonRef.current]
        if (idx < next.length) {
          next[idx] = [ll.lng, ll.lat]
          setPolygon(next)
        }
        return
      }

      // Polygon-body drag: translate every vertex by the lat/lng delta
      const start = draggingPolygonRef.current
      if (start !== null) {
        const dLng = ll.lng - start.lng
        const dLat = ll.lat - start.lat
        const next = polygonRef.current.map(([x, y]) => [x + dLng, y + dLat] as Pt)
        draggingPolygonRef.current = { lng: ll.lng, lat: ll.lat }
        setPolygon(next)
      }
    }
    const onUp = () => {
      if (draggingVertexRef.current !== null
          || draggingPolygonRef.current !== null) {
        draggingVertexRef.current = null
        draggingPolygonRef.current = null
        map.getCanvas().style.cursor = ''
        unlockMapAfterDrag(map)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [tract])

  // Cmd/Ctrl + Z = undo
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        const hist = polygonHistoryRef.current
        if (hist.length > 0) {
          e.preventDefault()
          const prev = hist.pop()!
          setPolygon(prev)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Update polygon overlay. The setData calls are cheap — they just
  // refresh the GeoJSON in the source. The fitBounds is the expensive
  // one and it ONLY fires when a brand-new polygon arrives (empty →
  // non-empty), NOT on every edit. Per user 2026-05-19v: the map
  // was "trying to always keep the polygon centered" as vertices
  // got dragged — which is exactly what this useEffect was doing
  // before. After a new polygon lands (e.g. Surety extract success,
  // upload-image extract success, prior boundary loaded from the
  // tract details), we refit ONCE; subsequent vertex / body drags
  // just update the GeoJSON and leave the camera alone.
  const prevPolygonLenRef = useRef(0)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource('vision-poly') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(buildPolyGeo(polygon))
    const vsrc = map.getSource('vision-vertices') as maplibregl.GeoJSONSource | undefined
    if (vsrc) vsrc.setData(buildVertexGeo(polygon))
    // Refit only when transitioning from "no polygon" to "polygon".
    const wasEmpty = prevPolygonLenRef.current === 0
    const nowHas = polygon.length >= 3
    if (wasEmpty && nowHas) {
      const lngs = polygon.map(p => p[0])
      const lats = polygon.map(p => p[1])
      map.fitBounds([
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ], { padding: 60, duration: 600, maxZoom: 17 })
    }
    prevPolygonLenRef.current = polygon.length
  }, [polygon])

  // Listen for paste anywhere on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (!blob) continue
          const reader = new FileReader()
          reader.onload = () => setImageDataUrl(String(reader.result))
          reader.readAsDataURL(blob)
          e.preventDefault()
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const onFilePicked = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setImageDataUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) onFilePicked(file)
  }

  const extract = async () => {
    if (!imageDataUrl) return
    setExtracting(true); setStatusMsg(null); setPolygon([]); setExtractMeta(null)
    polygonHistoryRef.current = []  // clear undo history on a fresh extract
    try {
      // POST the uploaded image to the per-tract extraction endpoint.
      // The scraper's existing path (when given a real tract UUID) does:
      //   1. Vision reads Boundary Center DMS + scale bar + PLSS label
      //      from the auction image's footer (single Opus call).
      //   2. OpenCV color-extracts the highlighted boundary line for
      //      the actual drawn polygon shape.
      //   3. Snap-to-line refinement walks along the drawn pixels.
      //   4. Pixel→lat/lng projection anchored on the printed Boundary
      //      Center, scaled by the scale bar (or acreage as fallback).
      // This produces accurate polygons that match the auctioneer's
      // hand-drawn boundary (Surety, Wheeler, Halderman, etc.).
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/extract-boundary-from-image`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_base64: imageDataUrl,
          }),
        }
      )
      const body = await res.json()
      // Special case: backend refused to project because it has no
      // precise anchor. Show the inline address/lat-lng form instead
      // of an error toast — this is the recoverable case where the
      // admin can supply the correct location.
      if (res.status === 422 && body?.error_code === 'needs_precise_anchor') {
        setNeedsAnchor({
          listing_title: body.listing_title,
          listing_source_url: body.listing_source_url,
          listing_county: body.listing_county,
          listing_state: body.listing_state,
          listing_address: body.listing_address,
          message: body.error,
        })
        setAnchorAddress(body.listing_address || '')
        setStatusMsg(null)
        return
      }
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const poly: Pt[] = (body.polygon || []).map((p: any) => [Number(p[0]), Number(p[1])])
      if (poly.length < 3) throw new Error('Vision returned an empty polygon')
      setPolygon(poly)
      setExtractMeta({
        extracted_acres: body.extracted_acres,
        expected_acres: body.expected_acres,
        acreage_match: body.acreage_match,
        confidence: body.vision_confidence,
        notes: body.vision_notes,
        tract_label_matched: body.tract_label_matched,
        projection_method: body.projection_method,
        polygon_source: body.polygon_source,
        boundary_color: body.boundary_color,
        boundary_center_from_image: body.boundary_center_from_image,
      })
      setStatusMsg(null)
    } catch (e: any) {
      setStatusMsg(`✗ Extract failed: ${e.message || e}`)
    } finally {
      setExtracting(false)
    }
  }

  // Admin submits the anchor (address OR explicit lat/lng) when the
  // backend refused to project for lack of precise location data.
  const saveAnchor = async () => {
    setSavingAnchor(true); setStatusMsg(null)
    try {
      const body: any = {}
      const addr = anchorAddress.trim()
      const lat = anchorLat.trim()
      const lng = anchorLng.trim()
      if (lat && lng) {
        body.latitude = Number(lat)
        body.longitude = Number(lng)
        if (!Number.isFinite(body.latitude) || !Number.isFinite(body.longitude)) {
          setStatusMsg('✗ Latitude / longitude must be numeric')
          setSavingAnchor(false)
          return
        }
      } else if (addr) {
        body.address = addr
      } else {
        setStatusMsg('✗ Enter a street address OR lat/lng')
        setSavingAnchor(false)
        return
      }
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/set-anchor`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        setStatusMsg(`✗ ${data.error || `HTTP ${res.status}`}`)
        return
      }
      setNeedsAnchor(null)
      setStatusMsg(`✓ Anchor set to (${data.latitude.toFixed(5)}, ${data.longitude.toFixed(5)}). Re-running extract…`)
      // Re-run extraction now that the anchor is fixed
      setTimeout(() => extract(), 400)
    } catch (e: any) {
      setStatusMsg(`✗ Set-anchor failed: ${e.message || e}`)
    } finally {
      setSavingAnchor(false)
    }
  }

  const extractFromUrl = async () => {
    const url = urlInput.trim()
    if (!url) return
    if (!/^https?:\/\//.test(url)) {
      setStatusMsg('✗ URL must start with http:// or https://')
      return
    }
    setExtractingUrl(true); setStatusMsg(null); setPolygon([]); setExtractMeta(null)
    polygonHistoryRef.current = []
    try {
      // Backend fetches the URL, scans the HTML for a Land ID iframe,
      // pulls the GeoJSON via Land ID's API, and picks the polygon
      // whose acreage best matches this tract's expected total.
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/extract-boundary-from-url`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const poly: Pt[] = (body.polygon || []).map((p: any) => [Number(p[0]), Number(p[1])])
      if (poly.length < 3) throw new Error('Land ID returned an empty polygon')
      setPolygon(poly)
      setExtractMeta({
        extracted_acres: body.extracted_acres,
        expected_acres: body.expected_acres,
        acreage_match: body.acreage_match,
        confidence: body.vision_confidence,
        notes: body.vision_notes,
        tract_label_matched: body.tract_label_matched,
        projection_method: body.projection_method,
        polygon_source: body.polygon_source,
        boundary_color: body.boundary_color,
        boundary_center_from_image: body.boundary_center_from_image,
      })
      setStatusMsg(null)
    } catch (e: any) {
      setStatusMsg(`✗ URL extract failed: ${e.message || e}`)
    } finally {
      setExtractingUrl(false)
    }
  }

  const extractFromSurety = async () => {
    console.log('[SuretyExtract] clicked, url:', suretyUrlInput)
    const url = suretyUrlInput.trim()
    if (!url) {
      setStatusMsg('✗ Paste a Surety image URL first')
      return
    }
    if (!/^https?:\/\//.test(url)) {
      setStatusMsg('✗ URL must start with http:// or https://')
      return
    }
    setExtractingSurety(true)
    setStatusMsg('⟳ Surety extract: sending request to backend…')
    setPolygon([])
    setExtractMeta(null)
    polygonHistoryRef.current = []
    // 90-second client-side timeout so a hung backend doesn't leave
    // the UI in "Extracting…" forever (per user 2026-05-19w: "I just
    // click the button and nothing happens").
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 90_000)
    try {
      // Backend fetches the Surety per-tract JPG, OCRs the composition
      // table via Claude Vision, traces the outer boundary, snaps to
      // SSURGO via composition matching, and returns the polygon.
      console.log('[SuretyExtract] POST', `${SCRAPER_URL}/api/admin/tracts/${tractId}/extract-boundary-from-surety`)
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/extract-boundary-from-surety`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url }),
          signal: controller.signal,
        }
      )
      console.log('[SuretyExtract] response status:', res.status)
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`)
      const poly: Pt[] = (body.polygon || []).map((p: any) => [Number(p[0]), Number(p[1])])
      if (poly.length < 3) throw new Error('Surety pipeline returned empty polygon')
      setPolygon(poly)
      setExtractMeta({
        extracted_acres: body.extracted_acres,
        expected_acres: body.expected_acres,
        acreage_match: body.acreage_match,
        confidence: body.confidence,
        notes: body.notes,
        projection_method: body.projection_method,
        polygon_source: body.polygon_source,
        map_type: body.map_type,
        polygon_kind: body.polygon_kind,
        anchor_method: body.anchor_method,
        listing_tillable_acres: body.listing_tillable_acres,
        listing_total_acres: body.listing_total_acres,
        acreage_delta_tillable: body.acreage_delta_tillable,
        acreage_delta_total: body.acreage_delta_total,
      })
      // No need to fitBounds here — the polygon-overlay useEffect
      // sees the empty→non-empty transition and fits automatically.
      const kindLabel =
        body.polygon_kind === 'tillable' ? 'TILLABLE polygon' :
        body.polygon_kind === 'full' ? 'FULL TRACT polygon' :
        body.polygon_kind === 'multi' ? 'MULTI-TRACT polygon (overview)' :
        'polygon (kind unknown)'
      setStatusMsg(
        `✓ Surety extracted a ${kindLabel} — ${body.confidence}-confidence, ` +
        `snap cost ${body.snap_cost?.toFixed(2)}, anchor: ${body.anchor_method}. ` +
        `Drag vertices to fix drift, then Save.`
      )
    } catch (e: any) {
      console.error('[SuretyExtract] error:', e)
      const msg = e?.name === 'AbortError'
        ? '✗ Surety extract timed out after 90s — backend hung. Check Railway logs.'
        : `✗ Surety extract failed: ${e.message || e}`
      setStatusMsg(msg)
    } finally {
      clearTimeout(timeoutId)
      setExtractingSurety(false)
    }
  }

  const save = async () => {
    if (polygon.length < 3) return
    setSaving(true); setStatusMsg(null)
    try {
      const isTillable = extractMeta?.polygon_kind === 'tillable'

      // Tillable polygon: legacy path — write to tillable column + recompute
      // soil rating immediately. (Rare on this page; tillable is normally
      // drawn from the missing-boundaries screen.)
      if (isTillable) {
        const res = await fetch(
          `${SCRAPER_URL}/api/admin/tracts/${tractId}/save-tillable-polygon`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              polygon,
              map_type: extractMeta?.map_type,
              confidence: extractMeta?.confidence,
            }),
          }
        )
        const body = await res.json()
        if (!res.ok || !body.success) throw new Error(body.error || 'save failed')
        setStatusMsg(
          `✓ Tillable polygon saved! ${body.tillable_acres}ac` +
          (body.soil_rating != null
            ? ` · ${body.soil_rating_type}: ${body.soil_rating}` : '') +
          '. Returning…'
        )
        setTimeout(() => router.push('/admin/missing-boundaries'), 1500)
        return
      }

      // Full-tract polygon: save as a DRAFT (proposed_polygon) and bounce
      // back to /admin/missing-boundaries with the tract focused, so the
      // admin can Align → draw Tillable → Align Tillable → Soil Rating →
      // Approve using the same workflow as Auto-Extract.
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/save-draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            polygon,
            total_acres: gisAcres(polygon),
            source: 'upload_image',
          }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'save failed')

      const listingId = tract?.listing_id
      const qs = new URLSearchParams()
      if (listingId) qs.set('listing_id', String(listingId))
      qs.set('focus_tract', String(tractId))

      setStatusMsg(`✓ Draft saved (${gisAcres(polygon).toFixed(1)}ac). Returning to missing-boundaries to finish…`)
      setTimeout(() => {
        router.push(`/admin/missing-boundaries?${qs.toString()}`)
      }, 900)
    } catch (e: any) {
      setStatusMsg(`✗ Save failed: ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setImageDataUrl(null); setPolygon([]); setExtractMeta(null); setStatusMsg(null)
  }

  if (loading) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <Loader2 className="animate-spin" size={28} />
    </div>
  )
  if (error || !tract) return (
    <div className="min-h-screen bg-black text-white p-8">
      <p className="text-red-400">{error || 'Tract not found'}</p>
      <button onClick={() => router.back()} className="mt-4 text-gg-pink underline">Back</button>
    </div>
  )

  const computedAcres = gisAcres(polygon)
  const matchColor =
    extractMeta?.acreage_match === 'good' ? 'text-emerald-400' :
    extractMeta?.acreage_match === 'loose' ? 'text-amber-400' :
    extractMeta?.acreage_match === 'off' ? 'text-red-400' : 'text-gg-gray-400'

  return (
    <div className="fixed inset-0 z-[100] bg-black text-white flex flex-col">
      {/* Header — flex-shrink-0 so it never compresses against the body */}
      <div className="border-b border-gg-gray-800 px-4 py-3 flex items-center gap-3 bg-gg-gray-900 flex-shrink-0">
        <button
          onClick={() => router.back()}
          className="p-1 text-gg-gray-400 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{tract.title || 'Tract'}</div>
          {(() => {
            const lat = Number(tract.latitude ?? tract.listing_latitude)
            const lng = Number(tract.longitude ?? tract.listing_longitude)
            const haveCoord = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)
            return (
              <div className="text-xs text-gg-gray-400 truncate">
                {tract.county}, {tract.state}
                {tract.total_acres ? ` · ${tract.total_acres} ac` : ''}
                {haveCoord ? ` · centroid (${lat.toFixed(4)}, ${lng.toFixed(4)})` : ' · no centroid yet'}
              </div>
            )
          })()}
        </div>
        <a
          href={`/admin/boundary-draw-tract/${tractId}`}
          className="text-xs px-3 py-1.5 rounded bg-gg-gray-800 hover:bg-gg-gray-700 text-gg-gray-300 flex-shrink-0"
          title="Switch to manual draw"
        >
          Draw manually instead
        </a>
      </div>

      {/* Body: two-column layout — min-h-0 lets flex children shrink past content */}
      <div className="flex flex-1 min-h-0">
        {/* Left: image upload + controls */}
        <div className="flex-1 min-w-0 border-r border-gg-gray-800 flex flex-col p-4 gap-3 overflow-y-auto">
          {/* Surety per-tract soil-map URL — the 5-step pipeline.
              Backend fetches the JPG, runs Vision composition OCR,
              traces the outer polygon, snaps to SSURGO via composition
              matching. Returns the polygon for drag-correct. Use this
              for Sullivan / AgriData / Surety-style soil maps. */}
          <div className="text-xs text-gg-gray-400 uppercase tracking-wider font-semibold">
            Surety per-tract soil-map image URL
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={suretyUrlInput}
              onChange={(e) => setSuretyUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !extractingSurety && suretyUrlInput.trim()) {
                  extractFromSurety()
                }
              }}
              placeholder="https://...Surety...Tract_1_Soils...jpg"
              disabled={extractingSurety}
              className="flex-1 min-w-0 px-3 py-2 bg-gg-gray-900 border border-gg-gray-800 rounded-lg text-sm text-white placeholder-gg-gray-500 focus:outline-none focus:border-gg-pink disabled:opacity-50"
            />
            <button
              onClick={extractFromSurety}
              disabled={extractingSurety || !suretyUrlInput.trim()}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-gg-pink hover:bg-gg-pink/85 disabled:opacity-50 text-white font-semibold rounded-lg transition flex-shrink-0"
              title="Run the 5-step Surety pipeline on this image"
            >
              {extractingSurety ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {extractingSurety ? 'Extracting…' : 'Surety Extract'}
            </button>
          </div>

          <div className="border-t border-gg-gray-800 my-1" />

          {/* URL extract — for auction listings with a Land ID iframe.
              Backend fetches the page, finds the Land ID map hash, pulls
              the GeoJSON, and returns the polygon whose acreage best
              matches this tract. Skips the image upload entirely. */}
          <div className="text-xs text-gg-gray-400 uppercase tracking-wider font-semibold">
            Or paste an auction URL with a Land ID map
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !extractingUrl && urlInput.trim()) {
                  extractFromUrl()
                }
              }}
              placeholder="https://www.trophypa.com/p/..."
              disabled={extractingUrl}
              className="flex-1 min-w-0 px-3 py-2 bg-gg-gray-900 border border-gg-gray-800 rounded-lg text-sm text-white placeholder-gg-gray-500 focus:outline-none focus:border-gg-pink disabled:opacity-50"
            />
            <button
              onClick={extractFromUrl}
              disabled={extractingUrl || !urlInput.trim()}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-gg-pink hover:bg-gg-pink/85 disabled:opacity-50 text-white font-semibold rounded-lg transition flex-shrink-0"
              title="Fetch the page, find the Land ID map, extract the polygon"
            >
              {extractingUrl ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {extractingUrl ? 'Fetching…' : 'Extract'}
            </button>
          </div>

          <div className="border-t border-gg-gray-800 my-1" />

          <div className="text-xs text-gg-gray-400 uppercase tracking-wider font-semibold">
            1. Paste auction-website image
          </div>
          {!imageDataUrl ? (
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="flex-1 min-h-[400px] border-2 border-dashed border-gg-gray-700 rounded-lg flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-gg-pink/50 transition-colors p-8"
            >
              <ImageIcon size={36} className="text-gg-gray-500" />
              <div className="text-center">
                <div className="font-medium">Paste, drop, or click to pick</div>
                <div className="text-xs text-gg-gray-400 mt-1">
                  Auction screenshot, GIS export, or PDF boundary map.<br />
                  Vision works best when the image has printed coordinates and a scale bar.
                </div>
              </div>
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFilePicked(e.target.files[0])}
              />
            </label>
          ) : (
            <div className="flex-1 flex flex-col gap-3 min-h-0">
              <div className="rounded-lg border border-gg-gray-800 overflow-hidden bg-black flex-1 min-h-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageDataUrl} alt="Auction screenshot" className="w-full h-full object-contain" />
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={extract}
                  disabled={extracting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-gg-pink hover:bg-gg-pink/85 disabled:opacity-50 text-white font-semibold rounded-lg transition"
                >
                  {extracting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {extracting ? 'Extracting…' : polygon.length > 0 ? 'Re-extract' : 'Extract with Claude Vision'}
                </button>
                <button
                  onClick={reset}
                  disabled={extracting || saving}
                  className="px-4 py-3 bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-50 text-gg-gray-300 rounded-lg"
                  title="Clear image and start over"
                >
                  <RotateCcw size={16} />
                </button>
              </div>

              {/* Needs-precise-anchor prompt — appears when backend
                  refuses to project because it can't tell where the
                  property is. Admin enters a street address or
                  explicit lat/lng; clicking Save geocodes, persists,
                  and re-runs Vision. */}
              {needsAnchor && (
                <div className="rounded-lg border border-amber-500/60 bg-amber-500/10 p-3 flex flex-col gap-2 text-sm">
                  <div className="font-semibold text-amber-300">
                    ⚠ Precise location required
                  </div>
                  <div className="text-amber-100/80 text-xs leading-snug">
                    We don&apos;t have a verified street address or lat/lng
                    for this {needsAnchor.listing_county
                      ? `tract in ${needsAnchor.listing_county} County, ${needsAnchor.listing_state}`
                      : 'tract'}.
                    Enter the address from the listing page (the
                    geocoder needs a specific street — city or ZIP
                    centroids are not accepted because they drop the
                    polygon miles from the actual farm).
                  </div>
                  {needsAnchor.listing_source_url && (
                    <a
                      href={needsAnchor.listing_source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-amber-200 underline truncate"
                    >
                      Open listing page →
                    </a>
                  )}
                  <input
                    value={anchorAddress}
                    onChange={(e) => setAnchorAddress(e.target.value)}
                    placeholder={`e.g. "Wood Station Road, ${needsAnchor.listing_county || 'X'} County, ${needsAnchor.listing_state || 'ST'}"`}
                    className="bg-black border border-gg-gray-700 rounded px-2 py-1.5 text-white text-sm"
                  />
                  <div className="text-xs text-gg-gray-400">
                    — or supply lat/lng directly:
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={anchorLat}
                      onChange={(e) => setAnchorLat(e.target.value)}
                      placeholder="lat (e.g. 38.9446)"
                      className="flex-1 bg-black border border-gg-gray-700 rounded px-2 py-1.5 text-white text-sm"
                    />
                    <input
                      value={anchorLng}
                      onChange={(e) => setAnchorLng(e.target.value)}
                      placeholder="lng (e.g. -90.1254)"
                      className="flex-1 bg-black border border-gg-gray-700 rounded px-2 py-1.5 text-white text-sm"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={saveAnchor}
                      disabled={savingAnchor}
                      className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-500/85 disabled:opacity-50 text-white text-sm rounded font-semibold"
                    >
                      {savingAnchor ? 'Saving…' : 'Save anchor & re-extract'}
                    </button>
                    <button
                      onClick={() => setNeedsAnchor(null)}
                      className="px-3 py-2 bg-gg-gray-800 hover:bg-gg-gray-700 text-gg-gray-300 text-sm rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Extract result summary */}
          {extractMeta && (
            <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-gg-gray-400">Extracted acres</span>
                <span className={`font-semibold ${matchColor}`}>
                  {extractMeta.extracted_acres?.toFixed(1) || '—'} ac
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gg-gray-400">Expected acres</span>
                <span>{extractMeta.expected_acres?.toFixed(1) || '—'} ac</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gg-gray-400">Acreage match</span>
                <span className={`font-medium ${matchColor}`}>
                  {extractMeta.acreage_match === 'good' && '✓ within 30%'}
                  {extractMeta.acreage_match === 'loose' && '⚠ within 60% — verify on map'}
                  {extractMeta.acreage_match === 'off' && '✗ way off — Vision may have misidentified the boundary'}
                  {!extractMeta.acreage_match && '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gg-gray-400">Vision confidence</span>
                <span className="capitalize">{extractMeta.confidence || '—'}</span>
              </div>
              {extractMeta.tract_label_matched && (
                <div className="flex items-center justify-between">
                  <span className="text-gg-gray-400">Matched tract</span>
                  <span className="text-emerald-400">{extractMeta.tract_label_matched}</span>
                </div>
              )}
              {extractMeta.projection_method && (
                <div className="flex items-center justify-between">
                  <span className="text-gg-gray-400">Projected via</span>
                  <span className={extractMeta.projection_method === 'auction_image_georeference' ? 'text-emerald-400' : 'text-amber-400'}>
                    {extractMeta.projection_method === 'auction_image_georeference'
                      ? 'image georeference (most accurate)'
                      : 'satellite landmark match'}
                  </span>
                </div>
              )}
              {extractMeta.polygon_source && (
                <div className="flex items-center justify-between">
                  <span className="text-gg-gray-400">Polygon shape from</span>
                  <span className={
                    extractMeta.polygon_source === 'vision_snapped_to_line'
                      ? 'text-emerald-400'
                      : extractMeta.polygon_source === 'opencv_color_extraction'
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                  }>
                    {extractMeta.polygon_source === 'vision_snapped_to_line'
                      ? `Vision + skeleton-walk on ${extractMeta.boundary_color || 'line'} (most accurate)`
                      : extractMeta.polygon_source === 'opencv_color_extraction'
                        ? `OpenCV color trace (${extractMeta.boundary_color || 'detected color'})`
                        : 'Vision vertex estimate'}
                  </span>
                </div>
              )}
              {extractMeta.notes && (
                <div className="text-xs text-gg-gray-400 mt-2 pt-2 border-t border-gg-gray-800">
                  {extractMeta.notes}
                </div>
              )}
            </div>
          )}

          {/* Save row */}
          {polygon.length >= 3 && (
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg transition"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? 'Saving…' : `Save boundary (${computedAcres.toFixed(1)} ac)`}
            </button>
          )}

          {statusMsg && (
            <div className={`text-sm rounded p-2 ${
              statusMsg.startsWith('✓')
                ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700/50'
                : 'bg-red-900/30 text-red-300 border border-red-700/50'
            }`}>
              {statusMsg}
            </div>
          )}
        </div>

        {/* Right: satellite map.
            Container uses explicit width/height instead of `absolute
            inset-0` because absolute children don't contribute to a
            flex parent's intrinsic size — the parent collapsed to 0px
            and the map rendered into a hidden viewport. */}
        <div className="flex-1 min-w-0 relative">
          <div className="absolute top-3 left-3 bg-gg-gray-900/85 backdrop-blur rounded-lg px-3 py-2 z-10 pointer-events-none">
            <div className="text-[10px] text-gg-gray-400 uppercase tracking-wider font-semibold">2. Result</div>
            <div className="text-xs text-gg-gray-300 mt-0.5">
              {polygon.length === 0
                ? 'Boundary will appear here after extraction'
                : `${polygon.length} vertices · ${computedAcres.toFixed(1)} ac`}
            </div>
          </div>
          {polygon.length > 0 && (
            <div className="absolute bottom-3 left-3 bg-gg-gray-900/85 backdrop-blur rounded-lg px-3 py-2 z-10 pointer-events-none text-[11px] text-gg-gray-300 leading-relaxed">
              <div className="text-[10px] text-gg-gray-400 uppercase tracking-wider font-semibold mb-1">Edit</div>
              <div>Drag a vertex to move it</div>
              <div>Drag inside the polygon to move all of it</div>
              <div>Click on the line to add a vertex</div>
              <div>Alt+click a vertex to delete</div>
              <div>⌘Z to undo</div>
            </div>
          )}
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        </div>
      </div>
    </div>
  )
}
