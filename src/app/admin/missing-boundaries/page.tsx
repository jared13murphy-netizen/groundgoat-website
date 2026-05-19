'use client'

// Force dynamic rendering — without this, Next.js statically generates
// the HTML at build time and caches it with a 1-year TTL, so even after
// a redeploy the served HTML references the OLD JS bundle hash. Admin
// pages should never be cached at the edge.
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, ExternalLink, MapPin, Trash2 } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import fetchWithAuth from '@/lib/fetchWithAuth'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const API_URL = 'https://practical-serenity-production.up.railway.app'
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '© Esri, Maxar, Earthstar Geographics'

// Per-tract colors for full polygon outline. Cycled in tract_number order.
const TRACT_COLORS = ['#ff3b3b', '#3b9fff', '#ffd83b', '#a83bff', '#3bffa8', '#ff7a3b']

type ExtractedTract = {
  tract_id: string
  tract_number: number | null
  acres?: number
  tillable_acres?: number | null
  soil_rating?: number | null
  soil_rating_type?: string | null
  identification_method?: string
  polygon_coordinates?: number[][] | null
  tillable_polygon?: number[][] | null
}

// Ramer-Douglas-Peucker line simplification for [lng, lat] coords.
// Removes near-collinear vertices so dragging straight-edge boundaries
// works (a rectangular tract shouldn't have 80 vertex handles).
function _perpDistance(p: number[], a: number[], b: number[]): number {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay)
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}
function simplifyPolygon(points: number[][], epsilon = 0.00008): number[][] {
  // epsilon in degrees ≈ 9m at mid-US latitudes. Big enough to
  // collapse near-collinear noise, small enough to preserve real
  // corners (>30° bends).
  if (points.length < 4) return points
  // Detect closed-ring: drop trailing duplicate before simplifying,
  // re-close after.
  const closed = points[0][0] === points[points.length - 1][0]
              && points[0][1] === points[points.length - 1][1]
  const open = closed ? points.slice(0, -1) : points
  // Iterative DP via stack
  const keep = new Array(open.length).fill(false)
  keep[0] = true
  keep[open.length - 1] = true
  const stack: [number, number][] = [[0, open.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let maxDist = 0, maxIdx = -1
    for (let i = s + 1; i < e; i++) {
      const d = _perpDistance(open[i], open[s], open[e])
      if (d > maxDist) { maxDist = d; maxIdx = i }
    }
    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = true
      stack.push([s, maxIdx], [maxIdx, e])
    }
  }
  const result = open.filter((_, i) => keep[i])
  return closed ? [...result, result[0]] : result
}

type EditableTract = ExtractedTract & {
  // Current tract polygon — mutated by vertex/body drag
  current_polygon?: number[][]
  // Tillable polygons — ARRAY of rings. Sometimes a tract has
  // multiple discrete cropland fields with timber between them.
  // Each entry is a closed ring [[lng,lat], ...].
  current_tillable_polygons?: number[][][]
  current_tillable_acres?: number | null
  current_soil_rating?: number | null
  current_soil_rating_type?: string | null
  current_polygon_acres?: number | null
  current_no_cropland?: boolean
  override_total_acres?: number | null
  override_tillable_acres?: number | null
  override_soil_rating?: number | null
}

// Normalize an arbitrary "tillable_polygon" field (from backend or
// existing DB) into the unified array-of-rings shape.
//   New format:        [[[lng,lat],...], [[lng,lat],...]]  (array of rings)
//   Legacy single:     [[lng,lat], ...]                    (one ring)
//   null / empty:      []
function normalizeTillablePolygons(tp: any): number[][][] {
  if (!tp) return []
  if (!Array.isArray(tp) || tp.length === 0) return []
  // Detect: if tp[0] is itself a ring of points (its first element is
  // also an array of 2 numbers), then tp is the new multi-ring shape.
  // Otherwise tp itself is a single ring → wrap it.
  const first = tp[0]
  if (Array.isArray(first) && first.length > 0 && Array.isArray(first[0])) {
    return tp as number[][][]
  }
  return [tp as number[][]]
}

// Cosine-corrected GIS acreage from a lng/lat polygon. Same math as
// the upload-boundary-tract page uses for boundary validation.
function gisAcres(points: number[][]): number {
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

// Scale a polygon's vertices around its centroid so its GIS area
// becomes targetAcres. Returns the new polygon. Uses uniform linear
// scaling (sqrt(target/current)). Cosine-corrected math matches
// gisAcres() above.
function scalePolygonToAcres(polygon: number[][], targetAcres: number): number[][] {
  if (polygon.length < 3 || targetAcres <= 0) return polygon
  const currentAcres = gisAcres(polygon)
  if (currentAcres <= 0) return polygon
  const scale = Math.sqrt(targetAcres / currentAcres)
  if (!Number.isFinite(scale) || scale <= 0) return polygon
  const cx = polygon.reduce((s, p) => s + p[0], 0) / polygon.length
  const cy = polygon.reduce((s, p) => s + p[1], 0) / polygon.length
  return polygon.map(([x, y]) => [
    cx + (x - cx) * scale,
    cy + (y - cy) * scale,
  ])
}

function EditableExtractMap({
  tracts,
  lockedTractIds,
  onPolygonChange,
  onTillableSubpolygonChange,
  onTillableDragEnd,
  onMoveAllTractPolygons,
  // Click-to-draw polygon (tract OR tillable). When `drawingTractId`
  // is set, map clicks call `onAppendDraftVertex(lng, lat)` instead
  // of doing anything else. `drawingKind` picks visual style + which
  // polygon the Finish callback replaces/appends. Existing vertex
  // drags are disabled until the user clicks Finish or Cancel in the
  // per-tract panel.
  drawingTractId,
  drawingKind,
  draftVertices,
  onAppendDraftVertex,
  onFinishDraw,
}: {
  tracts: EditableTract[]
  // Tracts whose tract polygon is locked — vertex circles hide,
  // mousedown is ignored. Used after Align Total Acres.
  lockedTractIds: Set<string>
  onPolygonChange: (tractId: string, newPolygon: number[][]) => void
  // tillableIdx = which sub-polygon (0..N-1) is being edited
  onTillableSubpolygonChange: (tractId: string, tillableIdx: number, newRing: number[][]) => void
  // Fires once on mouseup after a tillable drag — used to auto-Calculate
  onTillableDragEnd: (tractId: string) => void
  onMoveAllTractPolygons: (deltaLng: number, deltaLat: number) => void
  drawingTractId: string | null
  drawingKind: 'tract' | 'tillable' | null
  draftVertices: number[][]
  onAppendDraftVertex: (lng: number, lat: number) => void
  onFinishDraw: () => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [moveAllMode, setMoveAllMode] = useState(false)
  const tractsRef = useRef(tracts)
  const onChangeRef = useRef(onPolygonChange)
  const onTillableSubChangeRef = useRef(onTillableSubpolygonChange)
  const onTillableDragEndRef = useRef(onTillableDragEnd)
  const onMoveAllRef = useRef(onMoveAllTractPolygons)
  const moveAllModeRef = useRef(moveAllMode)
  const lockedRef = useRef(lockedTractIds)
  // Draw-mode refs — handlers attached once on map load and look at
  // these to decide whether to forward a click as a draft vertex.
  const drawingTractIdRef = useRef(drawingTractId)
  const drawingKindRef = useRef(drawingKind)
  const onAppendDraftVertexRef = useRef(onAppendDraftVertex)
  const onFinishDrawRef = useRef(onFinishDraw)
  tractsRef.current = tracts
  onChangeRef.current = onPolygonChange
  onTillableSubChangeRef.current = onTillableSubpolygonChange
  onTillableDragEndRef.current = onTillableDragEnd
  onMoveAllRef.current = onMoveAllTractPolygons
  moveAllModeRef.current = moveAllMode
  lockedRef.current = lockedTractIds
  drawingTractIdRef.current = drawingTractId
  drawingKindRef.current = drawingKind
  onAppendDraftVertexRef.current = onAppendDraftVertex
  onFinishDrawRef.current = onFinishDraw

  // Drag state. The 'kind' field distinguishes which of the TWO
  // polygons per tract is being dragged: the full tract polygon
  // (red border, white vertex circles) or the tillable polygon
  // (green fill, green-stroke vertex circles).
  // 'kind: all_tracts' is the Move-All mode: dragging the map
  // translates every tract polygon together (used when there's a
  // consistent offset across all tracts).
  const draggingRef = useRef<{
    type: 'vertex' | 'body' | 'move_all'
    kind: 'tract' | 'tillable' | 'all_tracts'
    tractId?: string
    tillableIdx?: number  // which sub-polygon (only for kind='tillable')
    vertexIdx?: number
    lastLng?: number
    lastLat?: number
  } | null>(null)

  // Lock down ALL map interactions during a polygon / vertex drag.
  // Just disabling dragPan isn't enough — scrollZoom, doubleClick-
  // Zoom, boxZoom, touchZoomRotate, and dragRotate can still fire
  // and cause the map to pan/zoom while the admin is trying to drag
  // a vertex precisely. Per user 2026-05-19r: "the map zooms and
  // moves around so it's impossible to get it right."
  const lockMap = (m: maplibregl.Map) => {
    try { m.dragPan.disable() } catch {}
    try { m.scrollZoom.disable() } catch {}
    try { m.boxZoom.disable() } catch {}
    try { m.doubleClickZoom.disable() } catch {}
    try { (m as any).touchZoomRotate?.disable?.() } catch {}
    try { (m as any).dragRotate?.disable?.() } catch {}
    try { (m as any).keyboard?.disable?.() } catch {}
  }
  const unlockMap = (m: maplibregl.Map) => {
    try { m.dragPan.enable() } catch {}
    try { m.scrollZoom.enable() } catch {}
    try { m.boxZoom.enable() } catch {}
    try { m.doubleClickZoom.enable() } catch {}
    try { (m as any).touchZoomRotate?.enable?.() } catch {}
    try { (m as any).dragRotate?.enable?.() } catch {}
    try { (m as any).keyboard?.enable?.() } catch {}
  }

  // Build features for a tract's polygon + vertex handles
  const buildPolyGeo = (polygon: number[][]) => {
    if (polygon.length < 3) return { type: 'FeatureCollection', features: [] }
    const closed = [...polygon]
    if (JSON.stringify(closed[0]) !== JSON.stringify(closed[closed.length - 1])) {
      closed.push(closed[0])
    }
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closed] },
      }],
    } as any
  }
  const buildVertexGeo = (polygon: number[][], tractId: string) => ({
    type: 'FeatureCollection',
    features: polygon.map((p, i) => ({
      type: 'Feature',
      properties: { idx: i, tractId },
      geometry: { type: 'Point', coordinates: p },
    })),
  } as any)

  // Multi-polygon variants for tillable. Each sub-polygon becomes one
  // Feature with a tillable_idx property so the mousedown/drag
  // handlers know which sub-polygon to mutate.
  const buildMultiTillableGeo = (tillables: number[][][]) => ({
    type: 'FeatureCollection',
    features: tillables.map((ring, idx) => {
      if (!ring || ring.length < 3) return null
      const closed = [...ring]
      if (JSON.stringify(closed[0]) !== JSON.stringify(closed[closed.length - 1])) {
        closed.push(closed[0])
      }
      return {
        type: 'Feature',
        properties: { tillable_idx: idx },
        geometry: { type: 'Polygon', coordinates: [closed] },
      }
    }).filter(Boolean),
  } as any)
  const buildMultiTillableVertexGeo = (tillables: number[][][], tractId: string) => {
    const features: any[] = []
    tillables.forEach((ring, tIdx) => {
      ring.forEach((p, vIdx) => {
        features.push({
          type: 'Feature',
          properties: { idx: vIdx, tractId, tillable_idx: tIdx },
          geometry: { type: 'Point', coordinates: p },
        })
      })
    })
    return { type: 'FeatureCollection', features } as any
  }

  // Trigger map init when tracts first arrives with polygon data.
  // Previously the dep array was [] so the effect only ran once on
  // mount — at that moment editStateByTract was still empty (it gets
  // synced from autoExtractResultByListing in a separate effect that
  // fires later), so the map saw 0 tracts and bailed.
  //
  // STICKY hasData: once true, never flips back to false. Without
  // this, deleting the LAST tract polygon would re-run the [hasData]
  // useEffect with hasData=false, the cleanup would call map.remove()
  // and the entire map would disappear (black canvas) — even though
  // we want the admin to keep working in that map (e.g. about to
  // draw a replacement polygon). Per user 2026-05-19i: "the entire
  // map goes black after I click OK on the confirmation pop up."
  const hasAnyDataNow = tracts.some(t => t.current_polygon && t.current_polygon.length >= 3)
  const hasDataRef = useRef(false)
  if (hasAnyDataNow) hasDataRef.current = true
  const hasData = hasDataRef.current || hasAnyDataNow

  useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) return  // Only init once
    const usable = tractsRef.current.filter(
      t => t.current_polygon && t.current_polygon.length >= 3
    )
    if (usable.length === 0) return

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (const t of usable) {
      for (const [lng, lat] of t.current_polygon!) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          imagery: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION },
        },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
      },
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      zoom: 14,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      const labels: any[] = []
      for (let i = 0; i < usable.length; i++) {
        const t = usable[i]
        const color = TRACT_COLORS[i % TRACT_COLORS.length]
        const fullId = `full_${t.tract_id}`
        const tilId = `til_${t.tract_id}`
        const vertId = `vert_${t.tract_id}`

        // Full polygon — fill + line + vertex handles
        map.addSource(fullId, { type: 'geojson', data: buildPolyGeo(t.current_polygon!) })
        map.addLayer({ id: `${fullId}_fill`, type: 'fill', source: fullId,
          paint: { 'fill-color': color, 'fill-opacity': 0.12 } })
        map.addLayer({ id: `${fullId}_line`, type: 'line', source: fullId,
          paint: { 'line-color': color, 'line-width': 3 } })

        // Tillable polygons (array — tract may have multiple cropland
        // sub-areas separated by timber). All sub-polygons live in one
        // source; each feature has a tillable_idx property.
        const tilGeo = t.current_tillable_polygons && t.current_tillable_polygons.length
          ? buildMultiTillableGeo(t.current_tillable_polygons)
          : { type: 'FeatureCollection', features: [] } as any
        map.addSource(tilId, { type: 'geojson', data: tilGeo })
        map.addLayer({ id: `${tilId}_fill`, type: 'fill', source: tilId,
          paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.40 } })
        // Line layer for tillable so admin can click an edge to add a
        // vertex (same pattern as the tract polygon).
        map.addLayer({ id: `${tilId}_line`, type: 'line', source: tilId,
          paint: { 'line-color': '#16a34a', 'line-width': 2 } })

        // Vertex handles for drag — tract polygon (white fill, tract-color stroke)
        map.addSource(vertId, { type: 'geojson', data: buildVertexGeo(t.current_polygon!, t.tract_id) })
        map.addLayer({
          id: `${vertId}_circle`, type: 'circle', source: vertId,
          paint: {
            'circle-radius': 6, 'circle-color': '#ffffff',
            'circle-stroke-color': color, 'circle-stroke-width': 2,
          },
        })

        // Vertex handles for ALL tillable sub-polygons (one source,
        // each vertex has tillable_idx + vertex idx).
        const tilVertId = `tilvert_${t.tract_id}`
        const tilVertGeo = t.current_tillable_polygons && t.current_tillable_polygons.length
          ? buildMultiTillableVertexGeo(t.current_tillable_polygons, t.tract_id)
          : { type: 'FeatureCollection', features: [] } as any
        map.addSource(tilVertId, { type: 'geojson', data: tilVertGeo })
        map.addLayer({
          id: `${tilVertId}_circle`, type: 'circle', source: tilVertId,
          paint: {
            'circle-radius': 5, 'circle-color': '#dcfce7',
            'circle-stroke-color': '#15803d', 'circle-stroke-width': 2,
          },
        })

        // Label
        const cx = t.current_polygon!.reduce((s, p) => s + p[0], 0) / t.current_polygon!.length
        const cy = t.current_polygon!.reduce((s, p) => s + p[1], 0) / t.current_polygon!.length
        labels.push({ type: 'Feature',
          properties: { label: `T${t.tract_number ?? '?'}`, color },
          geometry: { type: 'Point', coordinates: [cx, cy] } })

        // Wire TRACT vertex drag (right-click → delete vertex when not locked)
        map.on('mousedown', `${vertId}_circle`, (e: any) => {
          if (drawingTractIdRef.current) return  // draw mode locks out editing
          const f = e.features?.[0]
          if (!f) return
          if (lockedRef.current.has(f.properties.tractId)) return
          // Right-click (button=2) deletes the vertex instead of dragging.
          // Requires the polygon to retain at least 3 vertices.
          if (e.originalEvent && e.originalEvent.button === 2) {
            e.preventDefault()
            const tract = tractsRef.current.find(x => x.tract_id === f.properties.tractId)
            if (!tract?.current_polygon) return
            if (tract.current_polygon.length <= 3) return
            const idx = f.properties.idx
            const newPoly = tract.current_polygon.filter((_, i) => i !== idx)
            onChangeRef.current(f.properties.tractId, newPoly)
            return
          }
          e.preventDefault()
          draggingRef.current = {
            type: 'vertex', kind: 'tract',
            tractId: f.properties.tractId,
            vertexIdx: f.properties.idx,
          }
          map.getCanvas().style.cursor = 'grabbing'
          lockMap(map)
        })
        map.on('mouseenter', `${vertId}_circle`, () => { map.getCanvas().style.cursor = 'grab' })
        map.on('mouseleave', `${vertId}_circle`, () => {
          if (!draggingRef.current) map.getCanvas().style.cursor = ''
        })

        // Wire TILLABLE vertex drag (green vertices). Each vertex
        // feature carries tillable_idx (which sub-polygon) + idx
        // (which vertex within that sub-polygon).
        // Right-click → delete vertex (polygon needs ≥3 remaining).
        map.on('mousedown', `${tilVertId}_circle`, (e: any) => {
          if (drawingTractIdRef.current) return  // draw mode locks out editing
          const f = e.features?.[0]
          if (!f) return
          if (e.originalEvent && e.originalEvent.button === 2) {
            e.preventDefault()
            const tract = tractsRef.current.find(x => x.tract_id === f.properties.tractId)
            const tIdx = f.properties.tillable_idx
            const ring = tract?.current_tillable_polygons?.[tIdx]
            if (!ring || ring.length <= 3) return
            const idx = f.properties.idx
            const newRing = ring.filter((_, i) => i !== idx)
            onTillableSubChangeRef.current(f.properties.tractId, tIdx, newRing)
            onTillableDragEndRef.current(f.properties.tractId)
            return
          }
          e.preventDefault()
          draggingRef.current = {
            type: 'vertex', kind: 'tillable',
            tractId: f.properties.tractId,
            tillableIdx: f.properties.tillable_idx,
            vertexIdx: f.properties.idx,
          }
          map.getCanvas().style.cursor = 'grabbing'
          lockMap(map)
        })
        map.on('mouseenter', `${tilVertId}_circle`, () => { map.getCanvas().style.cursor = 'grab' })
        map.on('mouseleave', `${tilVertId}_circle`, () => {
          if (!draggingRef.current) map.getCanvas().style.cursor = ''
        })

        // Wire tract polygon body drag (mousedown on FILL, not on any vertex)
        // Locked tracts ignore body drag.
        map.on('mousedown', `${fullId}_fill`, (e: any) => {
          if (drawingTractIdRef.current) return  // draw mode locks out editing
          if (lockedRef.current.has(t.tract_id)) return
          // Skip if mousedown is on a vertex of EITHER polygon
          const vertexHits = map.queryRenderedFeatures(e.point, {
            layers: [`${vertId}_circle`, `${tilVertId}_circle`],
          })
          if (vertexHits.length > 0) return
          e.preventDefault()
          const f = e.features?.[0]
          if (!f) return
          draggingRef.current = {
            type: 'body', kind: 'tract', tractId: t.tract_id,
            lastLng: e.lngLat.lng, lastLat: e.lngLat.lat,
          }
          map.getCanvas().style.cursor = 'grabbing'
          lockMap(map)
        })

        // Click on tract polygon LINE (edge) inserts a new vertex at
        // the click point — only when not locked. Skipped if the click
        // is on an existing vertex (which already handles its own logic).
        map.on('click', `${fullId}_line`, (e: any) => {
          if (drawingTractIdRef.current) return  // draw mode handles clicks
          if (lockedRef.current.has(t.tract_id)) return
          const vertexHits = map.queryRenderedFeatures(e.point, {
            layers: [`${vertId}_circle`],
          })
          if (vertexHits.length > 0) return
          const tract = tractsRef.current.find(x => x.tract_id === t.tract_id)
          if (!tract?.current_polygon) return
          const click = [e.lngLat.lng, e.lngLat.lat]
          // Find which edge is closest to the click — insert vertex
          // between its two endpoints.
          const poly = tract.current_polygon
          let bestIdx = 0
          let bestDist = Infinity
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i]
            const b = poly[(i + 1) % poly.length]
            // Distance from click to segment a-b (planar approx is fine here)
            const ax = a[0], ay = a[1], bx = b[0], by = b[1]
            const dx = bx - ax, dy = by - ay
            const len2 = dx * dx + dy * dy
            const tParam = len2 > 0
              ? Math.max(0, Math.min(1, ((click[0] - ax) * dx + (click[1] - ay) * dy) / len2))
              : 0
            const px = ax + tParam * dx
            const py = ay + tParam * dy
            const d = Math.hypot(click[0] - px, click[1] - py)
            if (d < bestDist) { bestDist = d; bestIdx = i }
          }
          const newPoly = [
            ...poly.slice(0, bestIdx + 1),
            click,
            ...poly.slice(bestIdx + 1),
          ]
          onChangeRef.current(t.tract_id, newPoly)
        })

        // Wire tillable polygon body drag (mousedown on tillable
        // fill). The clicked feature carries tillable_idx so only the
        // sub-polygon under the cursor moves.
        map.on('mousedown', `${tilId}_fill`, (e: any) => {
          if (drawingTractIdRef.current) return  // draw mode locks out editing
          // Skip if on any vertex
          const vertexHits = map.queryRenderedFeatures(e.point, {
            layers: [`${vertId}_circle`, `${tilVertId}_circle`],
          })
          if (vertexHits.length > 0) return
          const f = e.features?.[0]
          if (!f) return
          e.preventDefault()
          draggingRef.current = {
            type: 'body', kind: 'tillable', tractId: t.tract_id,
            tillableIdx: f.properties.tillable_idx,
            lastLng: e.lngLat.lng, lastLat: e.lngLat.lat,
          }
          map.getCanvas().style.cursor = 'grabbing'
          lockMap(map)
        })

        // Click on tillable polygon LINE inserts a vertex into the
        // clicked sub-polygon (same pattern as the tract polygon).
        map.on('click', `${tilId}_line`, (e: any) => {
          if (drawingTractIdRef.current) return  // draw mode handles clicks
          const vertexHits = map.queryRenderedFeatures(e.point, {
            layers: [`${tilVertId}_circle`],
          })
          if (vertexHits.length > 0) return
          const f = e.features?.[0]
          if (!f) return
          const tIdx = f.properties.tillable_idx
          const tract = tractsRef.current.find(x => x.tract_id === t.tract_id)
          const ring = tract?.current_tillable_polygons?.[tIdx]
          if (!ring) return
          const click = [e.lngLat.lng, e.lngLat.lat]
          let bestIdx = 0
          let bestDist = Infinity
          for (let i = 0; i < ring.length; i++) {
            const a = ring[i]
            const b = ring[(i + 1) % ring.length]
            const ax = a[0], ay = a[1], bx = b[0], by = b[1]
            const dx = bx - ax, dy = by - ay
            const len2 = dx * dx + dy * dy
            const tParam = len2 > 0
              ? Math.max(0, Math.min(1, ((click[0] - ax) * dx + (click[1] - ay) * dy) / len2))
              : 0
            const px = ax + tParam * dx
            const py = ay + tParam * dy
            const d = Math.hypot(click[0] - px, click[1] - py)
            if (d < bestDist) { bestDist = d; bestIdx = i }
          }
          const newRing = [
            ...ring.slice(0, bestIdx + 1),
            click,
            ...ring.slice(bestIdx + 1),
          ]
          onTillableSubChangeRef.current(t.tract_id, tIdx, newRing)
          onTillableDragEndRef.current(t.tract_id)
        })
      }

      // Layer ordering: by default each tract's layers were added in
      // sequence, so tract N's fill is drawn ON TOP of tract (N-1)'s
      // tillable. That makes a freshly-added tillable area invisible /
      // unclickable when it overlaps a neighbor's fill. Promote ALL
      // tillable + vertex layers to the top in this order:
      //   tract fills (bottom — already there)
      //   tract lines (already there)
      //   tillable fills/lines (next, above all tract fills)
      //   tract + tillable vertex circles (top — grabable)
      for (const t of usable) {
        const tilId = `til_${t.tract_id}`
        if (map.getLayer(`${tilId}_fill`)) map.moveLayer(`${tilId}_fill`)
        if (map.getLayer(`${tilId}_line`)) map.moveLayer(`${tilId}_line`)
      }
      for (const t of usable) {
        const vertId = `vert_${t.tract_id}`
        const tilVertId = `tilvert_${t.tract_id}`
        if (map.getLayer(`${vertId}_circle`)) map.moveLayer(`${vertId}_circle`)
        if (map.getLayer(`${tilVertId}_circle`)) map.moveLayer(`${tilVertId}_circle`)
      }

      map.addSource('labels', { type: 'geojson', data: { type: 'FeatureCollection', features: labels } as any })
      map.addLayer({
        id: 'labels', type: 'symbol', source: 'labels',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 16, 'text-anchor': 'center',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 2 },
      })

      // Draft-polygon sources: rendered while the admin is in
      // click-to-draw mode for a tillable polygon. The draft has TWO
      // visual layers: a dashed line connecting the placed vertices
      // (closes back to the first vertex), and lime-yellow circles
      // marking each placed vertex. Filled re-renders happen in the
      // separate `drawingTractId / draftVertices` effect below.
      map.addSource('draft_line', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any })
      map.addLayer({
        id: 'draft_line', type: 'line', source: 'draft_line',
        paint: {
          'line-color': '#facc15', 'line-width': 2.5,
          'line-dasharray': [2, 2],
        },
      })
      map.addSource('draft_verts', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any })
      map.addLayer({
        id: 'draft_verts', type: 'circle', source: 'draft_verts',
        paint: {
          'circle-radius': 6, 'circle-color': '#facc15',
          'circle-stroke-color': '#854d0e', 'circle-stroke-width': 2,
        },
      })

      // Map-wide click handler — only fires when in draw mode. Click
      // adds a vertex. The handler is wired ONCE on map load and uses
      // refs to read the latest draw state on each click.
      map.on('click', (e: any) => {
        if (!drawingTractIdRef.current) return
        // If the click hit an existing polygon layer it would also
        // fire the layer-specific click handlers above — but those
        // all early-return on `drawingTractIdRef.current`, so the
        // click here is the only one that mutates state.
        onAppendDraftVertexRef.current(e.lngLat.lng, e.lngLat.lat)
      })
      map.on('dblclick', (e: any) => {
        if (!drawingTractIdRef.current) return
        // MapLibre will also have just registered the dblclick as a
        // zoom — disable that here.
        e.preventDefault()
        onFinishDrawRef.current()
      })

      const padLng = (maxLng - minLng) * 0.15
      const padLat = (maxLat - minLat) * 0.15
      map.fitBounds(
        [[minLng - padLng, minLat - padLat], [maxLng + padLng, maxLat + padLat]],
        { padding: 30, duration: 0 },
      )

      // MOVE-ALL mode: any mousedown on the map background (not on a
      // vertex) starts a translation that moves ALL tract polygons
      // together. The map's built-in pan stays disabled while in this
      // mode.
      map.on('mousedown', (e: any) => {
        if (!moveAllModeRef.current) return
        if (draggingRef.current) return
        e.preventDefault()
        draggingRef.current = {
          type: 'move_all', kind: 'all_tracts',
          lastLng: e.lngLat.lng, lastLat: e.lngLat.lat,
        }
        map.getCanvas().style.cursor = 'grabbing'
        lockMap(map)
      })
    })

    // Window-level mousemove/mouseup so the drag works even if cursor
    // leaves the map briefly. Dispatches to the tract or tillable
    // change callback based on which polygon's handles were grabbed.
    const onMouseMove = (ev: MouseEvent) => {
      const drag = draggingRef.current
      if (!drag || !mapRef.current) return
      const rect = (mapRef.current.getCanvas() as any).getBoundingClientRect()
      const lngLat = mapRef.current.unproject([ev.clientX - rect.left, ev.clientY - rect.top])

      // Move-All: translate every tract polygon by the same delta
      if (drag.type === 'move_all' && drag.lastLng !== undefined && drag.lastLat !== undefined) {
        const dLng = lngLat.lng - drag.lastLng
        const dLat = lngLat.lat - drag.lastLat
        draggingRef.current = { ...drag, lastLng: lngLat.lng, lastLat: lngLat.lat }
        onMoveAllRef.current(dLng, dLat)
        return
      }

      if (!drag.tractId) return
      const allTracts = tractsRef.current
      const t = allTracts.find(x => x.tract_id === drag.tractId)
      if (!t) return

      // Pick the source ring based on which polygon was grabbed. For
      // tillable, drag.tillableIdx narrows down WHICH sub-polygon.
      let sourcePoly: number[][] | undefined | null = null
      if (drag.kind === 'tract') {
        sourcePoly = t.current_polygon
      } else if (drag.kind === 'tillable') {
        const tils = t.current_tillable_polygons || []
        if (drag.tillableIdx == null || drag.tillableIdx >= tils.length) return
        sourcePoly = tils[drag.tillableIdx]
      }
      if (!sourcePoly) return

      let newPoly: number[][] | null = null
      if (drag.type === 'vertex' && drag.vertexIdx !== undefined) {
        newPoly = sourcePoly.map((p, i) =>
          i === drag.vertexIdx ? [lngLat.lng, lngLat.lat] : p
        )
      } else if (drag.type === 'body' && drag.lastLng !== undefined && drag.lastLat !== undefined) {
        const dLng = lngLat.lng - drag.lastLng
        const dLat = lngLat.lat - drag.lastLat
        newPoly = sourcePoly.map(p => [p[0] + dLng, p[1] + dLat])
        draggingRef.current = { ...drag, lastLng: lngLat.lng, lastLat: lngLat.lat }
      }
      if (!newPoly) return
      if (drag.kind === 'tract') {
        onChangeRef.current(drag.tractId, newPoly)
      } else if (drag.kind === 'tillable' && drag.tillableIdx != null) {
        onTillableSubChangeRef.current(drag.tractId, drag.tillableIdx, newPoly)
      }
    }
    const onMouseUp = () => {
      const drag = draggingRef.current
      if (drag && mapRef.current) {
        mapRef.current.getCanvas().style.cursor = ''
        unlockMap(mapRef.current)
        // After a tillable drag ends, fire the auto-Calculate callback
        // so the parent can recompute acres + soil rating without admin
        // clicking Calculate.
        if (drag.kind === 'tillable' && drag.tractId) {
          onTillableDragEndRef.current(drag.tractId)
        }
      }
      draggingRef.current = null
    }
    // Suppress browser context menu so right-click can be used to
    // delete vertices without showing a menu.
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (containerRef.current && containerRef.current.contains(target)) {
        e.preventDefault()
      }
    }
    window.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('contextmenu', onContextMenu)
      map.remove(); mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData])

  // Re-render layers when polygons change (without remounting the map)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const labels: any[] = []
    for (let i = 0; i < tracts.length; i++) {
      const t = tracts[i]
      const color = TRACT_COLORS[i % TRACT_COLORS.length]
      const fullSrc = map.getSource(`full_${t.tract_id}`) as maplibregl.GeoJSONSource | undefined
      const tilSrc = map.getSource(`til_${t.tract_id}`) as maplibregl.GeoJSONSource | undefined
      const vertSrc = map.getSource(`vert_${t.tract_id}`) as maplibregl.GeoJSONSource | undefined
      const tilVertSrc = map.getSource(`tilvert_${t.tract_id}`) as maplibregl.GeoJSONSource | undefined
      if (fullSrc) {
        fullSrc.setData(t.current_polygon
          ? buildPolyGeo(t.current_polygon)
          : { type: 'FeatureCollection', features: [] } as any)
      }
      // Locked tracts hide their vertex circles so admin can't drag
      // them. They're still drawn (red border + fill) for reference.
      const isLocked = lockedTractIds.has(t.tract_id)
      if (vertSrc) {
        vertSrc.setData(t.current_polygon && !isLocked
          ? buildVertexGeo(t.current_polygon, t.tract_id)
          : { type: 'FeatureCollection', features: [] } as any)
      }
      const tils = t.current_tillable_polygons || []
      if (tilSrc) {
        tilSrc.setData(tils.length
          ? buildMultiTillableGeo(tils)
          : { type: 'FeatureCollection', features: [] } as any)
      }
      if (tilVertSrc) {
        tilVertSrc.setData(tils.length
          ? buildMultiTillableVertexGeo(tils, t.tract_id)
          : { type: 'FeatureCollection', features: [] } as any)
      }
      // Re-compute label centroid from the CURRENT polygon so labels
      // move with the polygon when admin drags it.
      if (t.current_polygon && t.current_polygon.length >= 3) {
        const cx = t.current_polygon.reduce((s, p) => s + p[0], 0) / t.current_polygon.length
        const cy = t.current_polygon.reduce((s, p) => s + p[1], 0) / t.current_polygon.length
        labels.push({
          type: 'Feature',
          properties: { label: `T${t.tract_number ?? '?'}`, color },
          geometry: { type: 'Point', coordinates: [cx, cy] },
        })
      }
    }
    const labelsSrc = map.getSource('labels') as maplibregl.GeoJSONSource | undefined
    if (labelsSrc) {
      labelsSrc.setData({ type: 'FeatureCollection', features: labels } as any)
    }
  }, [tracts, lockedTractIds])

  // Re-render the draft polygon (the in-progress click-to-draw shape)
  // each time the admin places a new vertex. Draft line closes back
  // to the first vertex once there are 3+ points so the user can see
  // the polygon taking shape; below that it's just a path / a single
  // dot for the first click. Color depends on what we're drawing:
  // red for a tract polygon redraw, yellow for tillable.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Recolor the draft layers based on what we're drawing. Safe to
    // call even when the layer doesn't exist yet (try/catch below).
    try {
      if (map.getLayer('draft_line')) {
        const lineColor = drawingKind === 'tract' ? '#ff3b3b' : '#facc15'
        map.setPaintProperty('draft_line', 'line-color', lineColor)
      }
      if (map.getLayer('draft_verts')) {
        const fillColor = drawingKind === 'tract' ? '#ff3b3b' : '#facc15'
        const strokeColor = drawingKind === 'tract' ? '#7f1d1d' : '#854d0e'
        map.setPaintProperty('draft_verts', 'circle-color', fillColor)
        map.setPaintProperty('draft_verts', 'circle-stroke-color', strokeColor)
      }
    } catch {}
    // Wrap source lookups + setData in try/catch — calling setData
    // mid-style-update can throw, and a thrown setData on the LINE
    // source would block the VERT source from being updated (which is
    // exactly the bug user reported: count was incrementing but no
    // circles or line appeared).
    let lineSrc: maplibregl.GeoJSONSource | undefined
    let vertSrc: maplibregl.GeoJSONSource | undefined
    try {
      lineSrc = map.getSource('draft_line') as maplibregl.GeoJSONSource | undefined
      vertSrc = map.getSource('draft_verts') as maplibregl.GeoJSONSource | undefined
    } catch {
      return
    }
    if (!lineSrc || !vertSrc) return

    if (!drawingTractId || draftVertices.length === 0) {
      try { lineSrc.setData({ type: 'FeatureCollection', features: [] } as any) } catch {}
      try { vertSrc.setData({ type: 'FeatureCollection', features: [] } as any) } catch {}
      return
    }

    const pts = draftVertices.slice()

    // LINE: only renderable with 2+ vertices. A 1-vertex LineString
    // is invalid GeoJSON; setData() will throw and abort this whole
    // effect, leaving the vertex circles un-rendered. So we ONLY set
    // the line when there are 2+ pts. With 3+ pts we also close back
    // to the first vertex so the in-progress polygon is visible.
    try {
      if (pts.length >= 2) {
        const closed = pts.length >= 3 ? [...pts, pts[0]] : pts
        lineSrc.setData({
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: closed },
          }],
        } as any)
      } else {
        // 1 point — clear any prior line
        lineSrc.setData({ type: 'FeatureCollection', features: [] } as any)
      }
    } catch {}

    // VERTEX CIRCLES: render for every placed point (even the first).
    try {
      vertSrc.setData({
        type: 'FeatureCollection',
        features: pts.map((p, i) => ({
          type: 'Feature',
          properties: { idx: i },
          geometry: { type: 'Point', coordinates: p },
        })),
      } as any)
    } catch {}

    // Make sure draft layers paint on top of everything else.
    try {
      if (map.getLayer('draft_line')) map.moveLayer('draft_line')
      if (map.getLayer('draft_verts')) map.moveLayer('draft_verts')
    } catch {}
  }, [drawingTractId, drawingKind, draftVertices])

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-[650px] rounded border border-gg-gray-700 overflow-hidden bg-black" />
      {/* Move-All toggle — top-left over the map */}
      <button
        onClick={() => setMoveAllMode(v => !v)}
        className={`absolute top-1.5 left-1.5 text-[11px] px-2 py-1 rounded border transition-colors ${
          moveAllMode
            ? 'bg-amber-500/40 border-amber-400 text-amber-100'
            : 'bg-black/70 border-gg-gray-700 text-white hover:bg-black/85'
        }`}
        title="When on, dragging anywhere on the map moves ALL tract polygons together by the same offset. Use this when every tract is off by the same amount (consistent N/S/E/W drift)."
      >
        {moveAllMode ? '⊕ Move-All ON (drag map)' : '⊕ Move All Tracts'}
      </button>
      <div className="absolute bottom-1.5 left-1.5 text-[10px] text-white bg-black/60 px-2 py-1 rounded pointer-events-none">
        {drawingTractId ? (
          <>
            <strong className={drawingKind === 'tract' ? 'text-red-300' : 'text-yellow-300'}>
              DRAW MODE — {drawingKind === 'tract' ? 'TRACT polygon' : 'TILLABLE polygon'}
            </strong>{' '}
            · click to add a vertex · ⌘/Ctrl-Z to undo · Enter/dbl-click/Finish to close · ESC cancels
          </>
        ) : (
          <>
            <strong>Drag</strong> any circle to move a vertex · drag inside polygon to move it · scroll to zoom
            <br />
            <span className="inline-block w-2.5 h-2.5 align-middle mr-1 rounded-full bg-white border-2" style={{ borderColor: '#ff3b3b' }} /> tract vertex
            {' · '}
            <span className="inline-block w-2.5 h-2.5 align-middle mr-1 rounded-full" style={{ background: '#dcfce7', border: '2px solid #15803d' }} /> tillable vertex
            {' · '}
            <span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={{ background: '#ff3b3b' }} /> tract
            {' · '}
            <span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={{ background: '#22c55e', opacity: 0.6 }} /> tillable
          </>
        )}
      </div>
    </div>
  )
}

type Item = {
  tract_id: string
  tract_number: number | null
  total_acres: number | null
  land_type: string | null
  has_image: boolean
  listing_id: string
  title: string | null
  county: string | null
  state: string | null
  auction_datetime: string | null
  primary_image_url: string | null
  brochure_url: string | null
  source_url: string | null
  company_name: string | null
  boundary_status?: 'missing' | 'wrong' | 'ok'
  // Scraped values from the auction listing (ground truth for verification)
  scraped_tillable_acres?: number | null
  scraped_soil_rating?: number | null
  scraped_soil_rating_type?: string | null
  // Team member this listing has been assigned to (Isaac/Haley/Truly/
  // Brandt/Jared). Null/empty when unassigned.
  assigned_to?: string | null
}

type StateCount = { state: string; total: number; missing: number; wrong: number }
type CompanyCount = { company: string; total: number; missing: number; wrong: number }
type AssigneeCount = { person: string; listings: number }

function formatDate(iso: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export default function MissingBoundariesPage() {
  const [items, setItems] = useState<Item[]>([])
  const [byState, setByState] = useState<StateCount[]>([])
  const [byCompany, setByCompany] = useState<CompanyCount[]>([])
  const [byAssignee, setByAssignee] = useState<AssigneeCount[]>([])
  const [deletingListingId, setDeletingListingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Per-listing auto-extract state. Keyed by listing_id.
  const [autoExtractRunningId, setAutoExtractRunningId] = useState<string | null>(null)
  const [autoExtractResultByListing, setAutoExtractResultByListing] = useState<
    Record<string, {
      succeeded: any[]; failed: any[]; image_url?: string;
      image_url_reason?: string; map_type?: string;
      anchor_method?: string; error?: string;
      skipped?: boolean; skipped_reason?: string;
    }>
  >({})
  const [approvingTractId, setApprovingTractId] = useState<string | null>(null)
  const [approveAllRunningId, setApproveAllRunningId] = useState<string | null>(null)
  const [rejectingTractId, setRejectingTractId] = useState<string | null>(null)
  // Tracks which tracts have been approved IN THIS SESSION so the card
  // can show a green "Approved" badge instead of just disappearing
  // from the bottom list. The card stays visible so admin sees what
  // they just confirmed.
  const [approvedTractIds, setApprovedTractIds] = useState<Set<string>>(new Set())
  // Edit state per tract: current_polygon = whatever the admin has dragged
  // it to. current_tillable_polygons/acres/soil_rating = last result from
  // Calculate. The approve call ships these as overrides.
  const [editStateByTract, setEditStateByTract] = useState<Record<string, EditableTract>>({})
  const [calculatingTractId, setCalculatingTractId] = useState<string | null>(null)
  // Tracts whose tract polygon is LOCKED — vertex handles hide,
  // mousedown handlers ignore. Toggled on by Align Total Acres click
  // (so an admin doesn't accidentally drag a perfectly-aligned tract);
  // toggled off via the Unlock button.
  const [lockedTractIds, setLockedTractIds] = useState<Set<string>>(new Set())
  // CLICK-TO-DRAW state. When `drawingTractId` is non-null, the map
  // is in draw mode for that tract: clicks add vertices to the draft
  // polygon (stored in `draftVertices`), existing vertex/edge handlers
  // are inert, and Finish/Cancel buttons appear in the tract panel.
  // `drawingKind` picks the target: 'tract' (replaces the tract
  // polygon when finished) or 'tillable' (appends a new tillable
  // sub-polygon when finished).
  const [drawingTractId, setDrawingTractId] = useState<string | null>(null)
  const [drawingKind, setDrawingKind] = useState<'tract' | 'tillable' | null>(null)
  const [draftVertices, setDraftVertices] = useState<number[][]>([])
  // Debounced save-draft timers keyed by tract_id. Each drag/edit
  // bumps the timer; whichever edit lands last gets persisted ~800ms
  // after the admin stops touching it.
  const saveDraftTimersRef = useRef<Record<string, any>>({})
  // POST current edit state to the backend so refresh/device switch
  // doesn't lose work. Best-effort — failures log but don't alert.
  const saveDraftNow = useCallback(async (tractId: string, fields: any) => {
    try {
      await fetch(`${SCRAPER_URL}/api/admin/tracts/${tractId}/save-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
    } catch (e) {
      console.warn('save-draft failed for', tractId, e)
    }
  }, [])
  const scheduleSaveDraft = useCallback((tractId: string, fields: any) => {
    const timers = saveDraftTimersRef.current
    if (timers[tractId]) clearTimeout(timers[tractId])
    timers[tractId] = setTimeout(() => {
      saveDraftNow(tractId, fields)
      delete timers[tractId]
    }, 800)
  }, [saveDraftNow])
  const [stateFilter, setStateFilter] = useState<string>('')
  const [companyFilter, setCompanyFilter] = useState<string>('')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing' | 'wrong' | 'ok'>('all')
  // URL query support: ?listing_id=xxx (focus on one listing) and
  // ?focus_tract=xxx (auto-scroll to that tract's card). Used by the
  // boundary-draw-tract redirect so an admin lands here with the full
  // Align / Tillable / Soil Rating workflow available for one tract.
  const [listingIdFilter, setListingIdFilter] = useState<string>('')
  const [focusTractId, setFocusTractId] = useState<string>('')
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const lid = params.get('listing_id') || ''
    const ftid = params.get('focus_tract') || ''
    if (lid) setListingIdFilter(lid)
    if (ftid) setFocusTractId(ftid)
  }, [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [geocodeStatus, setGeocodeStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const qs = new URLSearchParams()
        if (stateFilter) qs.set('state', stateFilter)
        if (statusFilter !== 'all') qs.set('status', statusFilter)
        if (companyFilter) qs.set('company', companyFilter)
        if (assigneeFilter) qs.set('assigned_to', assigneeFilter)
        if (listingIdFilter) qs.set('listing_id', listingIdFilter)
        const url = `${SCRAPER_URL}/api/admin/missing-boundary-tracts${qs.toString() ? '?' + qs.toString() : ''}`
        setLoading(true)
        const res = await fetch(url)
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) {
          setItems(data.items || [])
          if (Array.isArray(data.by_state)) setByState(data.by_state)
          if (Array.isArray(data.by_company)) setByCompany(data.by_company)
          if (Array.isArray(data.by_assignee)) setByAssignee(data.by_assignee)
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [stateFilter, statusFilter, companyFilter, assigneeFilter, listingIdFilter])

  // Geocode pass: ensure every active listing has a lat/lng so the
  // boundary editor opens centered on the right township. This runs
  // ONCE on mount, DEFERRED 8 seconds AFTER mount so the items list
  // renders first and the scraper's single gunicorn worker isn't
  // hogged while the admin is just trying to see their queue.
  //
  // Was firing on every filter change which blocked the worker for
  // 30s+ on slow geocode crawls and the missing-boundary-tracts
  // fetch queued behind it. Per user 2026-05-19s: "When I sort IL
  // and then Isaac, it takes over 30 seconds to load."
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      setGeocodeStatus('Geocoding listings in background…')
      fetch(`${SCRAPER_URL}/api/admin/geocode-missing-listings`, { method: 'POST' })
        .then(r => r.json())
        .then(body => {
          if (cancelled) return
          if (body.success) {
            setGeocodeStatus(`Geocoded ${body.geocoded}/${body.processed} listings`)
          } else {
            setGeocodeStatus(`Geocode failed: ${body.error || 'unknown'}`)
          }
        })
        .catch(e => {
          if (!cancelled) setGeocodeStatus(`Geocode failed: ${e.message || e}`)
        })
    }, 8000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [])

  // After items load, auto-scroll to the focus_tract card if one was
  // requested via the URL (boundary-draw-tract redirects here with
  // ?focus_tract=xxx). The DOM element is keyed by `tract-card-{id}`.
  useEffect(() => {
    if (!focusTractId || loading) return
    const el = document.getElementById(`tract-card-${focusTractId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // Brief flash to draw the eye
      el.classList.add('ring-2', 'ring-yellow-400', 'ring-offset-2', 'ring-offset-black')
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-yellow-400', 'ring-offset-2', 'ring-offset-black')
      }, 2500)
    }
  }, [focusTractId, loading, items])

  // When admin lands here via the boundary-draw-tract redirect (URL
  // carries ?focus_tract=xxx&listing_id=lid), the per-listing map
  // doesn't render until Auto-Extract has been triggered for that
  // listing — so the admin sees no map and reports "no map pops up."
  // Auto-trigger Auto-Extract ONCE per listing in this case. The
  // backend path is idempotent: when proposed_polygon already exists
  // it returns the saved drafts, otherwise it runs fresh extraction.
  // Either way the inline map appears so the admin can immediately
  // Delete / Redraw / Draw a new tract.
  const autoExtractedListingsRef = useRef(new Set<string>())
  useEffect(() => {
    if (!focusTractId || !listingIdFilter || loading) return
    if (autoExtractedListingsRef.current.has(listingIdFilter)) return
    if (autoExtractResultByListing[listingIdFilter]) return  // already done
    autoExtractedListingsRef.current.add(listingIdFilter)
    runAutoExtract(listingIdFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTractId, listingIdFilter, loading, items])

  // Delete a listing (cascades to tracts via FK ON DELETE CASCADE).
  // Triple-checks before issuing the DELETE — accidental click is a
  // hard-to-undo destructive operation. The native window.confirm
  // requires explicit user assent and blocks the UI thread until
  // the user clicks Cancel or OK.
  const deleteListing = async (listingId: string, title: string | null,
                                company: string | null,
                                tractCount: number) => {
    const niceTitle = (title || '(untitled)').slice(0, 80)
    const msg = (
      `Delete this listing PERMANENTLY?\n\n` +
      `Title: ${niceTitle}\n` +
      `Company: ${company || '—'}\n` +
      `${tractCount} tract${tractCount === 1 ? '' : 's'} will also be deleted.\n\n` +
      `This cannot be undone.`
    )
    if (!window.confirm(msg)) return
    setDeletingListingId(listingId)
    setDeleteError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/listings/${listingId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          detail = body.detail || body.message || detail
        } catch {}
        throw new Error(detail)
      }
      // Remove from local state immediately so the UI updates without
      // needing a full reload.
      setItems(prev => prev.filter(it => it.listing_id !== listingId))
    } catch (e: any) {
      setDeleteError(`Delete failed: ${e.message || e}`)
    } finally {
      setDeletingListingId(null)
    }
  }

  const runAutoExtract = async (listingId: string, force = false) => {
    setAutoExtractRunningId(listingId)
    setAutoExtractResultByListing(prev => {
      const next = { ...prev }; delete next[listingId]; return next
    })
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/listings/${listingId}/auto-extract`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) {
        setAutoExtractResultByListing(prev => ({
          ...prev,
          [listingId]: {
            succeeded: [], failed: [],
            error: body.error || `HTTP ${res.status}`,
            image_url: body.image_url,
          },
        }))
      } else if (body.skipped) {
        // Endpoint refused to re-run because tracts already have
        // proposed_* values waiting for review. Surface this clearly
        // and offer a Force button.
        setAutoExtractResultByListing(prev => ({
          ...prev,
          [listingId]: {
            succeeded: [], failed: [],
            skipped: true,
            skipped_reason: body.reason || 'already extracted',
          },
        }))
      } else {
        setAutoExtractResultByListing(prev => ({
          ...prev,
          [listingId]: {
            succeeded: body.succeeded || [],
            failed: body.failed || [],
            image_url: body.image_url,
            image_url_reason: body.image_url_reason,
            map_type: body.map_type,
            anchor_method: body.anchor_method,
          },
        }))
      }
    } catch (e: any) {
      setAutoExtractResultByListing(prev => ({
        ...prev,
        [listingId]: { succeeded: [], failed: [], error: e.message || String(e) },
      }))
    } finally {
      setAutoExtractRunningId(null)
    }
  }

  const approveTract = async (tractId: string, listingId: string) => {
    // Require admin to have clicked Calculate first — otherwise we'd
    // be saving stale tillable/rating values that don't match the
    // drag-corrected polygon. Exception: no_cropland flag means
    // Calculate DID run and found zero cropland — that's a valid
    // state (tillable_acres == 0, not NULL).
    const edit = editStateByTract[tractId]
    if (edit && edit.current_polygon
        && edit.current_tillable_acres == null
        && !edit.current_no_cropland) {
      if (!window.confirm('Tillable acres are blank — Align Total Acres first (or Align Tillable). Approve anyway with no tillable / soil rating?')) return
    }
    setApprovingTractId(tractId)
    try {
      const payload: any = {}
      if (edit?.current_polygon) payload.polygon = edit.current_polygon
      // Multi-tillable: send array. Backend stores it as JSONB and
      // unions all rings when computing soil rating.
      const tils = edit?.current_tillable_polygons || []
      if (tils.length === 1) {
        payload.tillable_polygon = tils[0]  // legacy single-ring shape
      } else if (tils.length > 1) {
        payload.tillable_polygons = tils
      }
      // Admin-verified acres OVERRIDE polygon-derived values when set
      // — per user 2026-05-12: 'tract/tillable acres must EXACTLY
      // match the auction URL.'
      const finalTotal = edit?.override_total_acres ?? null
      const finalTillable = edit?.override_tillable_acres ?? edit?.current_tillable_acres ?? null
      const finalRating = edit?.override_soil_rating ?? edit?.current_soil_rating ?? null
      if (finalTotal != null) payload.total_acres = finalTotal
      if (finalTillable != null) payload.tillable_acres = finalTillable
      if (finalRating != null) payload.soil_rating = finalRating
      if (edit?.current_soil_rating_type) payload.soil_rating_type = edit.current_soil_rating_type
      if (edit?.current_no_cropland) payload.no_cropland = true

      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/approve-proposed`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      )
      const body = await res.json()
      if (res.ok && body.success) {
        // Mark approved (card shows green Approved badge) AND remove
        // from the bottom missing-boundaries list. Keeping the card
        // visible gives admin clear visual confirmation of what just
        // got committed.
        setApprovedTractIds(prev => {
          const next = new Set(prev)
          next.add(tractId)
          return next
        })
        setItems(prev => prev.filter(it => it.tract_id !== tractId))
      } else {
        alert(`Approve failed: ${body.error || `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      alert(`Approve error: ${e.message || e}`)
    } finally {
      setApprovingTractId(null)
    }
  }

  // Initialize edit state when Auto-Extract returns results for a listing.
  // current_tillable_polygons is INTENTIONALLY left empty so the map
  // shows ONLY the tract polygon on first load. Admin verifies the
  // tract shape first, then clicks Align Total Acres — that handler
  // calls /recalculate-from-polygon which derives the tillable
  // (Surety per-tract image → CSB → CDL) and populates it.
  // Per user 2026-05-15: prefers this two-stage flow so the tillable
  // polygon doesn't get in the way of verifying the tract boundary.
  useEffect(() => {
    const updates: Record<string, EditableTract> = {}
    for (const lid of Object.keys(autoExtractResultByListing)) {
      const result = autoExtractResultByListing[lid]
      for (const t of result.succeeded || []) {
        if (!editStateByTract[t.tract_id]) {
          const simplified = t.polygon_coordinates
            ? simplifyPolygon(t.polygon_coordinates)
            : undefined
          const listingTract = items.find(it => it.tract_id === t.tract_id)
          updates[t.tract_id] = {
            ...t,
            current_polygon: simplified,
            current_tillable_polygons: [],
            current_tillable_acres: null,
            current_soil_rating: null,
            current_soil_rating_type: null,
            current_polygon_acres: t.acres ?? null,
            override_total_acres: listingTract?.total_acres ?? null,
            override_tillable_acres: listingTract?.scraped_tillable_acres ?? null,
            override_soil_rating: null,
          }
        }
      }
    }
    if (Object.keys(updates).length > 0) {
      setEditStateByTract(prev => ({ ...prev, ...updates }))
    }
  }, [autoExtractResultByListing, editStateByTract])

  const onTractPolygonChange = (tractId: string, newPolygon: number[][]) => {
    setEditStateByTract(prev => {
      const existing = prev[tractId]
      if (!existing) return prev
      return {
        ...prev,
        [tractId]: {
          ...existing,
          current_polygon: newPolygon,
          // Tract polygon drag invalidates everything (tillable will be
          // re-derived from this new shape on next Calculate)
          current_tillable_polygons: [],
          current_tillable_acres: null,
          current_soil_rating: null,
          current_polygon_acres: null,
          current_no_cropland: false,
        },
      }
    })
    // Debounced persist so refresh doesn't lose in-progress drag work.
    scheduleSaveDraft(tractId, {
      polygon: newPolygon,
      tillable_polygons: [],  // explicitly clear stale tillable
    })
  }

  // Admin-edited tillable polygon (separate green vertex handles).
  // Invalidates only the SOIL RATING — tract polygon + tract acres stay.
  // Calculate uses this admin-edited tillable directly instead of
  // re-deriving from CDL.
  // Admin types a new total/tillable acres or soil rating. We just
  // record the override — it gets applied on Approve (and used by the
  // Align buttons to scale the polygon to match).
  const onOverrideTotalAcres = (tractId: string, val: string) => {
    const num = val === '' ? null : Number(val)
    setEditStateByTract(prev => ({
      ...prev, [tractId]: { ...prev[tractId], override_total_acres: num },
    }))
  }
  const onOverrideTillableAcres = (tractId: string, val: string) => {
    const num = val === '' ? null : Number(val)
    setEditStateByTract(prev => ({
      ...prev, [tractId]: { ...prev[tractId], override_tillable_acres: num },
    }))
  }
  const onOverrideSoilRating = (tractId: string, val: string) => {
    const num = val === '' ? null : Number(val)
    setEditStateByTract(prev => ({
      ...prev, [tractId]: { ...prev[tractId], override_soil_rating: num },
    }))
  }

  // Scale the tract polygon around its centroid so its GIS acres
  // matches override_total_acres exactly. Invalidates tillable
  // (admin needs to re-Calculate after the tract resize).
  // Align Total Acres: scale the tract polygon to the target acres,
  // lock it, then AUTO-derive the tillable polygon + tillable acres
  // from CDL. Admin no longer has to click Calculate — the tillable
  // appears as soon as Align finishes. Soil rating is left blank
  // until the admin clicks Align on the Tillable row (so the rating
  // matches the listing's published tillable acres exactly).
  const alignTractAcres = async (tractId: string) => {
    const edit = editStateByTract[tractId]
    if (!edit?.current_polygon) return
    const target = edit.override_total_acres
    if (target == null || !Number.isFinite(target) || target <= 0) {
      alert('Set the target Total Acres before clicking Align.')
      return
    }
    const newPoly = scalePolygonToAcres(edit.current_polygon, target)
    setEditStateByTract(prev => ({
      ...prev, [tractId]: {
        ...prev[tractId],
        current_polygon: newPoly,
        current_polygon_acres: target,
        // Tract changed → tillable + soil rating stale (will be
        // refreshed by the recalc call below).
        current_tillable_polygons: [],
        current_tillable_acres: null,
        current_soil_rating: null,
        current_no_cropland: false,
      },
    }))
    // Auto-lock — admin's signal that the tract shape is final.
    setLockedTractIds(prev => {
      const next = new Set(prev)
      next.add(tractId)
      return next
    })
    // Auto-derive tillable polygon + acres from CDL. Reuses the
    // /recalculate-from-polygon endpoint (no admin tillable in body,
    // so backend runs the CDL inverse-mask pipeline).
    setCalculatingTractId(tractId)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/recalculate-from-polygon`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon: newPoly }),
        }
      )
      const body = await res.json()
      if (res.ok && body.success) {
        const newTils = normalizeTillablePolygons(
          body.tillable_polygons ?? body.tillable_polygon,
        )
        setEditStateByTract(prev => ({
          ...prev, [tractId]: {
            ...prev[tractId],
            current_tillable_polygons: newTils,
            current_tillable_acres: body.tillable_acres ?? null,
            // Soil rating left null on purpose — admin should Align
            // Tillable (which uses the published tillable acres) before
            // we compute it, so the rating matches the auction URL.
            current_soil_rating: null,
            current_soil_rating_type: body.soil_rating_type ?? null,
            current_no_cropland: !!body.no_cropland,
          },
        }))
        saveDraftNow(tractId, {
          polygon: newPoly,
          total_acres: target,
          tillable_polygons: newTils,
          tillable_acres: body.tillable_acres ?? null,
        })
      } else {
        // Save the tract polygon even if CDL fails — admin can still
        // proceed with Add Tillable Area manually.
        saveDraftNow(tractId, {
          polygon: newPoly,
          total_acres: target,
          tillable_polygons: [],
        })
      }
    } catch (e) {
      console.warn('alignTractAcres CDL fetch failed:', e)
      saveDraftNow(tractId, {
        polygon: newPoly,
        total_acres: target,
        tillable_polygons: [],
      })
    } finally {
      setCalculatingTractId(null)
    }
  }

  const lockTract = (tractId: string) => {
    setLockedTractIds(prev => {
      const next = new Set(prev)
      next.add(tractId)
      return next
    })
  }
  const unlockTract = (tractId: string) => {
    setLockedTractIds(prev => {
      const next = new Set(prev)
      next.delete(tractId)
      return next
    })
  }

  // Align Tillable across N sub-polygons: scale each ring around its
  // own centroid by the SAME factor so their combined area matches
  // override_tillable_acres exactly. Each sub-polygon keeps its
  // relative size/shape — only the global size is corrected.
  // Align Tillable Acres: scale every sub-polygon around its own
  // centroid by the same factor so combined GIS acres == target,
  // then call the backend to refresh soil rating against the new
  // tillable shape (admin no longer has to click Calculate again).
  const alignTillableAcres = async (tractId: string) => {
    const edit = editStateByTract[tractId]
    const tils = edit?.current_tillable_polygons || []
    if (tils.length === 0) {
      alert('Click Calculate first (or add a tillable area), then align.')
      return
    }
    const target = edit?.override_tillable_acres
    if (target == null || !Number.isFinite(target) || target <= 0) {
      alert('Set the target Tillable Acres before clicking Align.')
      return
    }
    // Sum current GIS acres across all sub-polygons
    let totalCurrent = 0
    for (const ring of tils) totalCurrent += gisAcres(ring)
    if (totalCurrent <= 0) {
      alert('Tillable polygons have no area — can\'t scale.')
      return
    }
    const scale = Math.sqrt(target / totalCurrent)
    const scaledTils = tils.map(ring => {
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
      const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
      return ring.map(([x, y]) => [
        cx + (x - cx) * scale,
        cy + (y - cy) * scale,
      ])
    })
    // Update the map shape immediately so admin sees the scaled rings,
    // and mark rating as recomputing.
    setEditStateByTract(prev => ({
      ...prev, [tractId]: {
        ...prev[tractId],
        current_tillable_polygons: scaledTils,
        current_tillable_acres: target,
        current_soil_rating: null,
      },
    }))
    if (!edit.current_polygon) return
    // Re-derive soil rating against the new tillable. Reuse the
    // calculate-from-polygon endpoint, sending the scaled polygons
    // directly so the backend skips CDL re-derivation.
    setCalculatingTractId(tractId)
    try {
      const payload: any = { polygon: edit.current_polygon }
      if (scaledTils.length === 1) payload.tillable_polygon = scaledTils[0]
      else payload.tillable_polygons = scaledTils
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/recalculate-from-polygon`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) {
        alert(`Soil rating recalc failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      setEditStateByTract(prev => ({
        ...prev,
        [tractId]: {
          ...prev[tractId],
          // Keep the scaled tillable + target acres (don't overwrite
          // with backend-rounded values that may drift from `target`).
          current_soil_rating: body.soil_rating ?? null,
          current_soil_rating_type: body.soil_rating_type ?? null,
        },
      }))
      // Persist tillable + recomputed rating to proposed_* — refresh-safe.
      saveDraftNow(tractId, {
        tillable_polygons: scaledTils,
        tillable_acres: target,
        soil_rating: body.soil_rating ?? null,
        soil_rating_type: body.soil_rating_type ?? null,
      })
    } catch (e: any) {
      alert(`Soil rating recalc error: ${e.message || e}`)
    } finally {
      setCalculatingTractId(null)
    }
  }

  // Move-All: translate EVERY tract polygon (and its tillable, if any)
  // SCOPED TO THIS LISTING by the same (dLng, dLat). Invalidates the
  // soil rating + computed tillable values since the shape moved.
  const onMoveAllTractPolygons = (listingId: string, dLng: number, dLat: number) => {
    const tractIdsInListing = new Set(
      (autoExtractResultByListing[listingId]?.succeeded || [])
        .map((t: any) => t.tract_id),
    )
    setEditStateByTract(prev => {
      const next = { ...prev }
      for (const key of Object.keys(next)) {
        if (!tractIdsInListing.has(key)) continue
        const e = next[key]
        if (!e.current_polygon) continue
        next[key] = {
          ...e,
          current_polygon: e.current_polygon.map(p => [p[0] + dLng, p[1] + dLat]),
          // Translate every tillable sub-polygon by the same delta
          current_tillable_polygons: (e.current_tillable_polygons || []).map(
            ring => ring.map(p => [p[0] + dLng, p[1] + dLat]),
          ),
          current_tillable_acres: null,
          current_soil_rating: null,
          current_no_cropland: false,
        }
      }
      return next
    })
  }

  // Admin dragged one sub-polygon of the tillable. Replace that index
  // in current_tillable_polygons and invalidate downstream values.
  // Fires once per mousemove during a drag — debounced auto-Calculate
  // + save-draft below handle the persist + recompute on mouseup.
  const onTillableSubpolygonChange = (tractId: string, tillableIdx: number, newRing: number[][]) => {
    setEditStateByTract(prev => {
      const existing = prev[tractId]
      if (!existing) return prev
      const tils = (existing.current_tillable_polygons || []).slice()
      if (tillableIdx < 0 || tillableIdx >= tils.length) return prev
      tils[tillableIdx] = newRing
      return {
        ...prev,
        [tractId]: {
          ...existing,
          current_tillable_polygons: tils,
          // Soil rating goes stale because tillable shape changed
          current_soil_rating: null,
          // Tillable acres go stale too (admin will see ⚠ until Calculate)
          current_tillable_acres: null,
        },
      }
    })
  }

  // Auto-Calculate-on-mouseup: when admin finishes dragging a tillable
  // polygon (vertex, body, or via add/delete), recompute tillable acres
  // + soil rating against the new shape so they see results without
  // clicking Calculate. Also persists the result to proposed_*.
  const autoCalculateTillable = useCallback(async (tractId: string) => {
    // Read the LATEST edit state (post-drag) instead of capturing stale
    // closure values.
    setEditStateByTract(prev => {
      const e = prev[tractId]
      if (!e?.current_polygon) return prev
      const tils = e.current_tillable_polygons || []
      if (tils.length === 0) return prev
      // Fire and forget the recalc + persist
      ;(async () => {
        setCalculatingTractId(tractId)
        try {
          const payload: any = { polygon: e.current_polygon }
          if (tils.length === 1) payload.tillable_polygon = tils[0]
          else payload.tillable_polygons = tils
          const res = await fetch(
            `${SCRAPER_URL}/api/admin/tracts/${tractId}/recalculate-from-polygon`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }
          )
          const body = await res.json()
          if (res.ok && body.success) {
            setEditStateByTract(prev2 => ({
              ...prev2,
              [tractId]: {
                ...prev2[tractId],
                current_tillable_acres: body.tillable_acres ?? null,
                current_soil_rating: body.soil_rating ?? null,
                current_soil_rating_type: body.soil_rating_type ?? null,
              },
            }))
            saveDraftNow(tractId, {
              tillable_polygons: tils,
              tillable_acres: body.tillable_acres ?? null,
              soil_rating: body.soil_rating ?? null,
              soil_rating_type: body.soil_rating_type ?? null,
            })
          }
        } catch (e2) {
          console.warn('auto-calc tillable failed:', e2)
        } finally {
          setCalculatingTractId(null)
        }
      })()
      return prev
    })
  }, [saveDraftNow])

  // Delete one sub-polygon (e.g. admin decides one of the auto-detected
  // tillable areas is actually timber). Invalidates downstream values.
  const deleteTillableSubpolygon = (tractId: string, tillableIdx: number) => {
    setEditStateByTract(prev => {
      const existing = prev[tractId]
      if (!existing) return prev
      const tils = (existing.current_tillable_polygons || []).slice()
      if (tillableIdx < 0 || tillableIdx >= tils.length) return prev
      tils.splice(tillableIdx, 1)
      return {
        ...prev,
        [tractId]: {
          ...existing,
          current_tillable_polygons: tils,
          current_soil_rating: null,
          current_tillable_acres: null,
        },
      }
    })
    // Persist the deletion so it survives refresh
    setTimeout(() => {
      setEditStateByTract(prev => {
        const e = prev[tractId]
        if (e) {
          saveDraftNow(tractId, {
            tillable_polygons: e.current_tillable_polygons || [],
            tillable_acres: null,
          })
        }
        return prev
      })
    }, 0)
  }

  // Add a new tillable sub-polygon as a small square around the tract
  // centroid. Admin then drags vertices to shape it. Invalidates
  // downstream values.
  const addTillableSubpolygon = (tractId: string) => {
    setEditStateByTract(prev => {
      const existing = prev[tractId]
      if (!existing || !existing.current_polygon) return prev
      const poly = existing.current_polygon
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length
      // Size the seed at ~30% of the tract bbox so the new area is
      // immediately visible (10% was too small to spot in practice).
      const minLng = Math.min(...poly.map(p => p[0]))
      const maxLng = Math.max(...poly.map(p => p[0]))
      const minLat = Math.min(...poly.map(p => p[1]))
      const maxLat = Math.max(...poly.map(p => p[1]))
      const hLng = (maxLng - minLng) * 0.3
      const hLat = (maxLat - minLat) * 0.3
      const seedRing: number[][] = [
        [cx - hLng, cy - hLat],
        [cx + hLng, cy - hLat],
        [cx + hLng, cy + hLat],
        [cx - hLng, cy + hLat],
      ]
      const tils = (existing.current_tillable_polygons || []).slice()
      tils.push(seedRing)
      return {
        ...prev,
        [tractId]: {
          ...existing,
          current_tillable_polygons: tils,
          current_soil_rating: null,
          current_tillable_acres: null,
          current_no_cropland: false,
        },
      }
    })
    // Persist immediately so the new seed survives refresh
    setTimeout(() => {
      setEditStateByTract(prev => {
        const e = prev[tractId]
        if (e?.current_tillable_polygons) {
          saveDraftNow(tractId, {
            tillable_polygons: e.current_tillable_polygons,
            tillable_acres: null,
          })
        }
        return prev
      })
    }, 0)
  }

  // CLICK-TO-DRAW. Shared infrastructure for two kinds of polygon
  // redraws:
  //   'tillable' → append a new ring to current_tillable_polygons.
  //                Preserves existing rings (multi-region tillable).
  //   'tract'    → REPLACE current_polygon entirely. Use when
  //                auto-extract produced a bad tract polygon (e.g.
  //                Wheeler-style monochrome maps where the color
  //                trace gets confused) and the admin wants to redo
  //                the boundary from scratch.
  // Map clicks (handled inside TractEditMap) call appendDraftVertex.
  // Finish reads drawingKind to decide which polygon to update.
  const startDrawTillable = (tractId: string) => {
    setDrawingTractId(tractId)
    setDrawingKind('tillable')
    setDraftVertices([])
  }
  const startDrawTract = (tractId: string) => {
    setDrawingTractId(tractId)
    setDrawingKind('tract')
    setDraftVertices([])
  }

  // Delete the tract polygon WITHOUT entering draw mode. Useful when
  // the admin wants the wrong polygon off the screen first, then
  // decides separately whether to draw / upload / abandon.
  // Per user 2026-05-19h: "I need to be able to delete it prior to
  // drawing a new one."
  const deleteTractPolygon = (tractId: string) => {
    if (!window.confirm(
      'Delete this tract polygon? You can draw a new one or upload an '
      + 'image afterwards. This clears the tillable + soil rating too '
      + 'since they only make sense relative to a tract.'
    )) return
    setEditStateByTract(prev => {
      const existing = prev[tractId]
      if (!existing) return prev
      return {
        ...prev,
        [tractId]: {
          ...existing,
          current_polygon: undefined,
          current_polygon_acres: null,
          current_tillable_polygons: [],
          current_tillable_acres: null,
          current_soil_rating: null,
          current_no_cropland: false,
        },
      }
    })
    // Lock state is per-tract — make sure the tract is unlocked so
    // the admin can re-shape after re-drawing.
    setLockedTractIds(prev => {
      const next = new Set(prev)
      next.delete(tractId)
      return next
    })
    // Persist immediately so a refresh doesn't bring the old polygon
    // back from the saved draft.
    setTimeout(() => {
      saveDraftNow(tractId, {
        polygon: null,
        tillable_polygons: [],
        tillable_acres: null,
      })
    }, 0)
  }
  const appendDraftVertex = useCallback((lng: number, lat: number) => {
    setDraftVertices(v => [...v, [lng, lat]])
  }, [])
  // Pop the LAST vertex off the draft. Used by the ↩ Undo button +
  // Ctrl/Cmd-Z shortcut so the admin can take back a misplaced click
  // without restarting the whole polygon.
  const undoLastDraftVertex = useCallback(() => {
    setDraftVertices(v => v.length > 0 ? v.slice(0, -1) : v)
  }, [])
  const cancelDrawTillable = useCallback(() => {
    setDrawingTractId(null)
    setDrawingKind(null)
    setDraftVertices([])
  }, [])
  const finishDrawTillable = useCallback(() => {
    // Need at least 3 vertices to make a polygon. Anything less
    // gets treated as a Cancel.
    if (!drawingTractId || draftVertices.length < 3) {
      setDrawingTractId(null)
      setDrawingKind(null)
      setDraftVertices([])
      return
    }
    const tractId = drawingTractId
    const kind = drawingKind
    const ring = draftVertices.slice()

    if (kind === 'tract') {
      // REPLACE the tract polygon. Tillable + soil rating are now
      // stale relative to the new boundary — clear them so the admin
      // re-runs Align Total Acres / Tillable.
      setEditStateByTract(prev => {
        const existing = prev[tractId]
        if (!existing) return prev
        return {
          ...prev,
          [tractId]: {
            ...existing,
            current_polygon: ring,
            current_polygon_acres: null,
            current_tillable_polygons: [],
            current_tillable_acres: null,
            current_soil_rating: null,
            current_no_cropland: false,
          },
        }
      })
      setTimeout(() => {
        setEditStateByTract(prev => {
          const e = prev[tractId]
          if (e) {
            saveDraftNow(tractId, {
              polygon: e.current_polygon,
              tillable_polygons: [],
              tillable_acres: null,
            })
          }
          return prev
        })
      }, 0)
    } else {
      // APPEND tillable sub-polygon (multi-region tillable).
      setEditStateByTract(prev => {
        const existing = prev[tractId]
        if (!existing) return prev
        const tils = [...(existing.current_tillable_polygons || []), ring]
        return {
          ...prev,
          [tractId]: {
            ...existing,
            current_tillable_polygons: tils,
            current_tillable_acres: null,
            current_soil_rating: null,
            current_no_cropland: false,
          },
        }
      })
      setTimeout(() => {
        setEditStateByTract(prev => {
          const e = prev[tractId]
          if (e) {
            saveDraftNow(tractId, {
              tillable_polygons: e.current_tillable_polygons || [],
              tillable_acres: null,
            })
          }
          return prev
        })
      }, 0)
    }
    setDrawingTractId(null)
    setDrawingKind(null)
    setDraftVertices([])
  }, [drawingTractId, drawingKind, draftVertices, saveDraftNow])

  // Draw-mode keyboard shortcuts:
  //   ESC          → cancel current draw
  //   Ctrl/Cmd-Z   → undo last placed vertex
  //   Enter        → finish (when ≥3 verts)
  // Only active while a tract is being drawn so they don't interfere
  // with normal page input (e.g. typing in the Total ac field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!drawingTractId) return
      // Ignore when focus is in a form field so typing isn't hijacked.
      const tag = (document.activeElement?.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (e.key === 'Escape') {
        e.preventDefault()
        cancelDrawTillable()
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undoLastDraftVertex()
      } else if (e.key === 'Enter' && draftVertices.length >= 3) {
        e.preventDefault()
        finishDrawTillable()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawingTractId, draftVertices.length, cancelDrawTillable, undoLastDraftVertex, finishDrawTillable])

  // (calculateTract removed 2026-05-14 — Align Total Acres auto-derives
  // the tillable polygon, Align Tillable auto-derives the soil rating,
  // and the drag-end handler auto-Calculates on tillable changes. No
  // manual Calculate button is needed in the new workflow.)

  const rejectProposed = async (tractId: string, listingId: string) => {
    if (!window.confirm('Reject this proposed boundary? It will be discarded. Live data is NOT changed; tract stays on the list so you can re-extract / upload / draw.')) return
    setRejectingTractId(tractId)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/reject-proposed`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      )
      const body = await res.json()
      if (res.ok && body.success) {
        // Remove this tract from the local extracted-results list
        setAutoExtractResultByListing(prev => {
          const cur = prev[listingId]
          if (!cur) return prev
          return {
            ...prev,
            [listingId]: {
              ...cur,
              succeeded: cur.succeeded.filter((t: any) => t.tract_id !== tractId),
            },
          }
        })
      } else {
        alert(`Reject failed: ${body.error || `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      alert(`Reject error: ${e.message || e}`)
    } finally {
      setRejectingTractId(null)
    }
  }

  const approveAllTracts = async (listingId: string) => {
    setApproveAllRunningId(listingId)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/listings/${listingId}/approve-all-proposed`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      )
      const body = await res.json()
      if (res.ok && body.success) {
        const approvedIds = new Set<string>(
          (body.approved || []).map((x: any) => x.tract_id as string),
        )
        // Mark each card so it shows the green Approved badge
        setApprovedTractIds(prev => {
          const next = new Set(prev)
          approvedIds.forEach(id => next.add(id))
          return next
        })
        setItems(prev => prev.filter(it => !approvedIds.has(it.tract_id)))
        if (body.errors && body.errors.length > 0) {
          alert(`Approved ${body.n_approved}; ${body.errors.length} failed (check those tracts).`)
        }
      } else {
        alert(`Approve-all failed: ${body.error || `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      alert(`Approve-all error: ${e.message || e}`)
    } finally {
      setApproveAllRunningId(null)
    }
  }

  // Group by listing_id so multiple tracts on the same auction show together
  const grouped: Record<string, Item[]> = {}
  for (const it of items) {
    if (!grouped[it.listing_id]) grouped[it.listing_id] = []
    grouped[it.listing_id].push(it)
  }
  const listingIds = Object.keys(grouped).sort((a, b) => {
    const da = grouped[a][0].auction_datetime || ''
    const db = grouped[b][0].auction_datetime || ''
    return da.localeCompare(db)
  })

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white pt-24 pb-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Missing Boundaries</h1>
            <p className="text-sm text-gg-gray-400 mt-1">
              Lists every tract on any listing that has at least one missing
              or wrong boundary. Tracts that pass validation get a green
              <span className="text-emerald-300"> Correct</span> badge —
              spot-check those too, since if one tract on a listing is wrong
              the others often are.
            </p>
          </div>
          <div className="text-sm text-gg-gray-400 text-right">
            <div>{loading ? '…' : `${items.length} tract${items.length === 1 ? '' : 's'} across ${listingIds.length} listing${listingIds.length === 1 ? '' : 's'}`}</div>
            {geocodeStatus && (
              <div className="text-xs text-gg-gray-500 mt-1">{geocodeStatus}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="text-xs text-gg-gray-400 uppercase tracking-wide">State:</label>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-gg-pink"
          >
            <option value="">All states ({byState.reduce((s, x) => s + x.total, 0)})</option>
            {byState.map((s) => (
              <option key={s.state} value={s.state}>
                {s.state} ({s.total} — {s.missing} missing, {s.wrong} wrong)
              </option>
            ))}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Company:</label>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-gg-pink max-w-xs"
          >
            <option value="">
              All companies ({byCompany.reduce((s, x) => s + x.total, 0)})
            </option>
            {byCompany.map((c) => (
              <option key={c.company} value={c.company}>
                {c.company} ({c.total})
              </option>
            ))}
          </select>

          {/* Team assignment filter — each missing-boundaries listing
              is assigned to one of Isaac / Haley / Truly / Brandt /
              Jared so the work splits across the team (Jared gets
              roughly half what the others get). Pick a name to see
              only that admin's queue. Per user 2026-05-19p. */}
          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Assigned:</label>
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-gg-pink"
          >
            <option value="">
              All ({byAssignee.reduce((s, x) => s + x.listings, 0)})
            </option>
            {byAssignee.map((a) => (
              <option key={a.person} value={a.person === 'Unassigned' ? 'unassigned' : a.person}>
                {a.person} ({a.listings})
              </option>
            ))}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Type:</label>
          <div className="inline-flex rounded overflow-hidden border border-gg-gray-700">
            {(['all', 'missing', 'wrong', 'ok'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setStatusFilter(opt)}
                className={`px-3 py-1 text-xs ${statusFilter === opt ? 'bg-gg-pink/30 text-gg-pink' : 'bg-gg-gray-900 text-gg-gray-300 hover:bg-gg-gray-800'}`}
              >
                {opt === 'all' ? 'All' : opt === 'missing' ? 'Missing' : opt === 'wrong' ? 'Wrong' : 'Correct'}
              </button>
            ))}
          </div>

          {companyFilter && (
            <button
              onClick={() => setCompanyFilter('')}
              className="text-xs text-gg-pink underline hover:no-underline"
            >
              Clear company filter
            </button>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-gg-gray-400">
            <Loader2 className="animate-spin" size={18} /> Loading…
          </div>
        )}
        {error && (
          <div className="bg-red-900/40 border border-red-600 rounded p-3 text-red-300">
            {error}
          </div>
        )}
        {deleteError && (
          <div className="bg-red-900/40 border border-red-600 rounded p-3 text-red-300 mb-3 flex items-center justify-between gap-3">
            <span>{deleteError}</span>
            <button
              onClick={() => setDeleteError(null)}
              className="text-xs px-2 py-1 text-red-200 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-6 text-gg-gray-400">
            🎉 Every upcoming auction tract already has a boundary. Nothing to draw.
          </div>
        )}

        <div className="space-y-4">
          {listingIds.map((lid) => {
            const tracts = grouped[lid]
            const head = tracts[0]
            return (
              <div key={lid} className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-gg-gray-800 flex items-start gap-4">
                  {head.primary_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={head.primary_image_url}
                      alt=""
                      className="w-20 h-20 object-cover rounded border border-gg-gray-700 flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="font-semibold text-white truncate">{head.title || '(untitled)'}</h2>
                      {head.assigned_to ? (
                        <span
                          className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gg-pink/20 text-gg-pink border border-gg-pink/40 flex-shrink-0"
                          title={`Assigned to ${head.assigned_to}`}
                        >
                          {head.assigned_to}
                        </span>
                      ) : (
                        <span
                          className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full bg-gg-gray-800 text-gg-gray-400 border border-gg-gray-700 flex-shrink-0"
                          title="No assignee yet"
                        >
                          Unassigned
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gg-gray-400">
                      {head.company_name && <span>{head.company_name}</span>}
                      <span className="flex items-center gap-1"><MapPin size={11} />{head.county}, {head.state}</span>
                      <span>Auction: {formatDate(head.auction_datetime)}</span>
                      {head.source_url && (
                        <a
                          href={head.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gg-pink hover:underline flex items-center gap-1"
                        >
                          Source <ExternalLink size={10} />
                        </a>
                      )}
                      {head.brochure_url && (
                        <a
                          href={head.brochure_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gg-pink hover:underline flex items-center gap-1"
                        >
                          Brochure <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteListing(lid, head.title, head.company_name, tracts.length)}
                    disabled={deletingListingId === lid}
                    className="text-xs px-3 py-1.5 rounded bg-red-500/15 hover:bg-red-500/25 disabled:opacity-50 text-red-300 border border-red-500/40 transition-colors flex items-center gap-1.5 flex-shrink-0 self-start"
                    title="Delete this listing and all its tracts. Confirmation required."
                  >
                    {deletingListingId === lid ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> Deleting…
                      </>
                    ) : (
                      <>
                        <Trash2 size={12} /> Delete Listing
                      </>
                    )}
                  </button>
                </div>

                {/* Auto-extract: the software finds the Surety overview
                    image, runs the multi-tract pipeline, derives tillable
                    via CDL, and computes soil rating — all in one click.
                    Admin reviews the results and approves per-tract (or
                    Approve All for the whole listing). */}
                <div className="px-4 py-3 border-b border-gg-gray-800 bg-gg-gray-950/40">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-gg-gray-400 mb-1.5">
                        Auto-Extract Boundaries
                      </div>
                      <div className="text-[11px] text-gg-gray-400 mb-2">
                        Software fetches the listing source, finds the Surety overview map,
                        extracts polygons + tillable + soil rating for all tracts. You review and approve.
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => runAutoExtract(lid)}
                          disabled={autoExtractRunningId === lid}
                          className="px-3 py-1.5 text-xs rounded bg-gg-pink/30 hover:bg-gg-pink/50 disabled:opacity-50 text-gg-pink border border-gg-pink/40"
                        >
                          {autoExtractRunningId === lid ? 'Extracting…' : 'Auto-Extract'}
                        </button>
                        {autoExtractResultByListing[lid]?.skipped && (
                          <button
                            onClick={() => runAutoExtract(lid, true)}
                            disabled={autoExtractRunningId === lid}
                            className="px-3 py-1.5 text-xs rounded bg-amber-500/25 hover:bg-amber-500/40 disabled:opacity-50 text-amber-200 border border-amber-500/40"
                          >
                            {autoExtractRunningId === lid ? 'Re-extracting…' : '↻ Force Re-Extract'}
                          </button>
                        )}
                        {autoExtractResultByListing[lid]?.succeeded?.length > 0 && (
                          <button
                            onClick={() => approveAllTracts(lid)}
                            disabled={approveAllRunningId === lid}
                            className="px-3 py-1.5 text-xs rounded bg-emerald-500/25 hover:bg-emerald-500/40 disabled:opacity-50 text-emerald-200 border border-emerald-500/40"
                          >
                            {approveAllRunningId === lid ? 'Approving All…' : `✓ Approve All (${autoExtractResultByListing[lid].succeeded.length})`}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {autoExtractResultByListing[lid] && (
                    <div className="mt-3 text-xs">
                      {autoExtractResultByListing[lid].error && (
                        <div className="bg-red-900/30 border border-red-700 rounded p-2 text-red-300">
                          ✗ {autoExtractResultByListing[lid].error}
                          {autoExtractResultByListing[lid].image_url && (
                            <div className="mt-1 text-[10px] text-gg-gray-400">
                              Tried image: <a href={autoExtractResultByListing[lid].image_url} target="_blank" rel="noreferrer" className="text-gg-pink hover:underline">{autoExtractResultByListing[lid].image_url}</a>
                            </div>
                          )}
                        </div>
                      )}
                      {autoExtractResultByListing[lid].skipped && (
                        <div className="bg-amber-900/30 border border-amber-700 rounded p-2 text-amber-200">
                          ⚠ Already extracted previously. Click <strong>Force Re-Extract</strong> to run again, or open each tract via the "Review on map" link to approve.
                          <div className="text-[10px] text-gg-gray-400 mt-1">
                            {autoExtractResultByListing[lid].skipped_reason}
                          </div>
                        </div>
                      )}
                      {autoExtractResultByListing[lid].succeeded?.length > 0 && (
                        <div>
                          <div className="text-emerald-300 mb-1.5">
                            ✓ Extracted {autoExtractResultByListing[lid].succeeded.length} tract{autoExtractResultByListing[lid].succeeded.length === 1 ? '' : 's'} via {autoExtractResultByListing[lid].anchor_method} anchor
                            {autoExtractResultByListing[lid].image_url && (
                              <>
                                {' '}from{' '}
                                <a href={autoExtractResultByListing[lid].image_url} target="_blank" rel="noreferrer" className="underline hover:no-underline">overview map</a>
                              </>
                            )}
                          </div>

                          {/* Editable inline map — drag vertices or
                              the polygon body to align. The map source
                              comes from editStateByTract (admin-mutable),
                              not the auto-extract result (immutable). */}
                          <div className="mb-2">
                            <EditableExtractMap
                              tracts={(autoExtractResultByListing[lid].succeeded as any[])
                                .map(t => editStateByTract[t.tract_id])
                                .filter(Boolean) as EditableTract[]}
                              lockedTractIds={lockedTractIds}
                              onPolygonChange={onTractPolygonChange}
                              onTillableSubpolygonChange={onTillableSubpolygonChange}
                              onTillableDragEnd={autoCalculateTillable}
                              onMoveAllTractPolygons={(dLng, dLat) => onMoveAllTractPolygons(lid, dLng, dLat)}
                              drawingTractId={drawingTractId}
                              drawingKind={drawingKind}
                              draftVertices={draftVertices}
                              onAppendDraftVertex={appendDraftVertex}
                              onFinishDraw={finishDrawTillable}
                            />
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                            {[...autoExtractResultByListing[lid].succeeded]
                              .sort((a: any, b: any) => {
                                // Sort by tract_number ascending so cards
                                // match the order admin expects (1, 2, 3, ...).
                                // Tracts without a number sink to the bottom.
                                const an = a.tract_number ?? 9999
                                const bn = b.tract_number ?? 9999
                                return an - bn
                              })
                              .map((t: any) => {
                              const e = editStateByTract[t.tract_id]
                              const listingTract = tracts.find(it => it.tract_id === t.tract_id)
                              // ALWAYS prefer live GIS acres over any
                              // cached value. Priority:
                              //   1. While drawing a TRACT polygon for
                              //      this tract: the in-progress draft
                              //      (so admin sees acres update as they
                              //      place each vertex — per user
                              //      2026-05-19m: "Drawn doesn't auto-
                              //      calculate correctly as I draw").
                              //   2. The committed current_polygon.
                              //   3. Cached current_polygon_acres OR
                              //      t.acres (stale fallbacks).
                              const isDrawingThisTract =
                                drawingTractId === t.tract_id
                                && drawingKind === 'tract'
                                && draftVertices.length >= 3
                              const computedTotal = isDrawingThisTract
                                ? gisAcres(draftVertices)
                                : (e?.current_polygon && e.current_polygon.length >= 3
                                    ? gisAcres(e.current_polygon)
                                    : (e?.current_polygon_acres ?? t.acres))
                              const isApproved = approvedTractIds.has(t.tract_id)
                              return (
                                <div
                                  key={t.tract_id}
                                  id={`tract-card-${t.tract_id}`}
                                  className={`rounded-md px-2.5 py-2 border-2 shadow-sm transition-all ${
                                    isApproved
                                      ? 'bg-emerald-900/30 border-emerald-500/70 shadow-emerald-900/30'
                                      : 'bg-gg-gray-900 border-gg-gray-500 shadow-black/40'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="font-medium flex items-center gap-1.5">
                                      Tract {t.tract_number ?? '?'}
                                      {isApproved && (
                                        <span
                                          className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/30 text-emerald-200 border border-emerald-500/60"
                                          title="Saved to the live database. The tract has been removed from the missing-boundaries list."
                                        >
                                          ✓ Approved
                                        </span>
                                      )}
                                    </span>
                                    <span className="text-[10px] text-gg-gray-400">{t.identification_method}</span>
                                  </div>

                                  {/* Editable Total Acres row */}
                                  <div className="flex items-center gap-1.5 text-[11px] mb-1">
                                    <label className="text-gg-gray-400 w-16 flex-shrink-0">Total ac:</label>
                                    <input
                                      type="number" step="0.01"
                                      value={e?.override_total_acres ?? ''}
                                      onChange={(ev) => onOverrideTotalAcres(t.tract_id, ev.target.value)}
                                      className="w-20 px-1 py-0.5 bg-gg-gray-950 border border-gg-gray-700 rounded text-white text-[11px] focus:outline-none focus:border-gg-pink"
                                      placeholder="—"
                                    />
                                    {/* Match indicator — green ✓ when the input value equals
                                        the GIS-drawn area within 0.05 ac. */}
                                    {e?.override_total_acres != null && computedTotal != null &&
                                     Math.abs(Number(e.override_total_acres) - Number(computedTotal)) <= 0.05 && (
                                      <span className="text-emerald-400 font-bold text-[12px]" title="Drawn polygon matches the target acreage">✓</span>
                                    )}
                                    <span className="text-gg-gray-500 text-[10px]">
                                      (drawn: {computedTotal != null ? Number(computedTotal).toFixed(2) : '—'})
                                    </span>
                                    <button
                                      onClick={() => alignTractAcres(t.tract_id)}
                                      disabled={lockedTractIds.has(t.tract_id)}
                                      className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 hover:bg-blue-500/35 disabled:opacity-30 text-blue-200 border border-blue-500/40"
                                      title="Scale tract polygon to match Total ac exactly, then lock it"
                                    >
                                      Align
                                    </button>
                                    {lockedTractIds.has(t.tract_id) ? (
                                      <button
                                        onClick={() => unlockTract(t.tract_id)}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 border border-amber-500/40"
                                        title="Unlock so you can re-shape the tract polygon"
                                      >
                                        🔓 Unlock
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => lockTract(t.tract_id)}
                                        className="text-[10px] px-1.5 py-0.5 rounded bg-gg-gray-800 hover:bg-gg-gray-700 text-gg-gray-300 border border-gg-gray-700"
                                        title="Lock the tract polygon to prevent accidental edits"
                                      >
                                        🔒 Lock
                                      </button>
                                    )}
                                  </div>

                                  {/* Tract-polygon redraw row — appears when
                                      auto-extract produced a wrong polygon and
                                      the admin wants to redo it from scratch.
                                      Clicking ✏ Redraw enters draw mode for
                                      this tract (existing tract polygon is
                                      visible as a guide until Finish replaces
                                      it). Per user 2026-05-19g: monochrome
                                      Surety maps (Wheeler/Vock) break the
                                      color-trace; admin needs an inline
                                      redraw — same UX as the tillable draw. */}
                                  <div className="flex items-center gap-1.5 text-[10px] mb-1 pl-[68px]">
                                    {drawingTractId === t.tract_id && drawingKind === 'tract' ? (
                                      <>
                                        <span className="px-1.5 py-0.5 rounded bg-red-500/20 border border-red-500/50 text-red-200 font-semibold">
                                          ✏ Drawing tract… {draftVertices.length} {draftVertices.length === 1 ? 'point' : 'points'}
                                        </span>
                                        <button
                                          onClick={undoLastDraftVertex}
                                          disabled={draftVertices.length === 0}
                                          className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/40 disabled:opacity-40 text-amber-200 border border-amber-500/40"
                                          title="Remove the last placed vertex (Ctrl/Cmd-Z also works)"
                                        >
                                          ↩ Undo
                                        </button>
                                        <button
                                          onClick={finishDrawTillable}
                                          disabled={draftVertices.length < 3}
                                          className="px-1.5 py-0.5 rounded bg-emerald-500/25 hover:bg-emerald-500/40 disabled:opacity-40 text-emerald-200 border border-emerald-500/50"
                                          title="Close the polygon and REPLACE the tract boundary (Enter also works)"
                                        >
                                          ✓ Finish
                                        </button>
                                        <button
                                          onClick={cancelDrawTillable}
                                          className="px-1.5 py-0.5 rounded bg-gg-gray-700/40 hover:bg-gg-gray-700/70 text-gg-gray-300 border border-gg-gray-600"
                                          title="Discard the in-progress drawing (ESC also works)"
                                        >
                                          ✕ Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        {e?.current_polygon && (
                                          <button
                                            onClick={() => deleteTractPolygon(t.tract_id)}
                                            disabled={drawingTractId != null}
                                            className="px-1.5 py-0.5 rounded bg-red-600/15 hover:bg-red-600/35 disabled:opacity-40 text-red-200 border border-red-600/50"
                                            title="Delete the current tract polygon. Use this when auto-extract drew the wrong boundary — clear it out, then click Draw Tract / Upload Image / etc. to start fresh."
                                          >
                                            🗑 Delete
                                          </button>
                                        )}
                                        <button
                                          onClick={() => startDrawTract(t.tract_id)}
                                          disabled={drawingTractId != null}
                                          className="px-1.5 py-0.5 rounded bg-red-500/15 hover:bg-red-500/30 disabled:opacity-40 text-red-300 border border-red-500/40"
                                          title={e?.current_polygon
                                            ? "Click on the map to trace a new tract boundary. The current polygon stays visible as a guide; clicking Finish REPLACES it. (Use Delete first if you want a clean slate.)"
                                            : "Click on the map to trace the tract boundary."}
                                        >
                                          ✏ {e?.current_polygon ? 'Redraw' : 'Draw'} Tract
                                        </button>
                                      </>
                                    )}
                                  </div>

                                  {/* Editable Tillable Acres row */}
                                  <div className="flex items-center gap-1.5 text-[11px] mb-1">
                                    <label className="text-gg-gray-400 w-16 flex-shrink-0">Tillable:</label>
                                    <input
                                      type="number" step="0.01"
                                      value={e?.override_tillable_acres ?? ''}
                                      onChange={(ev) => onOverrideTillableAcres(t.tract_id, ev.target.value)}
                                      className="w-20 px-1 py-0.5 bg-gg-gray-950 border border-gg-gray-700 rounded text-white text-[11px] focus:outline-none focus:border-gg-pink"
                                      placeholder="—"
                                    />
                                    {/* Match indicator — within 0.05 ac. Also fires when
                                        both are 0 (admin set "0" and tract has no cropland). */}
                                    {e?.override_tillable_acres != null && e?.current_tillable_acres != null &&
                                     Math.abs(Number(e.override_tillable_acres) - Number(e.current_tillable_acres)) <= 0.05 && (
                                      <span className="text-emerald-400 font-bold text-[12px]" title="Drawn tillable polygon matches the target acreage">✓</span>
                                    )}
                                    <span className={`text-[10px] ${e?.current_no_cropland ? 'text-gg-gray-500 italic' : 'text-gg-gray-500'}`}>
                                      (calc: {e?.current_no_cropland ? '0 (no cropland)' : (e?.current_tillable_acres != null ? `${e.current_tillable_acres}` : '—')})
                                    </span>
                                    <button
                                      onClick={() => alignTillableAcres(t.tract_id)}
                                      disabled={calculatingTractId === t.tract_id}
                                      className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 hover:bg-blue-500/35 disabled:opacity-50 text-blue-200 border border-blue-500/40"
                                      title="Scale tillable polygon(s) to match Tillable ac, then re-compute soil rating"
                                    >
                                      {calculatingTractId === t.tract_id ? '…' : 'Align'}
                                    </button>
                                  </div>

                                  {/* Multi-tillable: show each sub-area
                                      with a Delete button + an "Add
                                      Area" button. Use when the tract
                                      has separate cropland fields split
                                      by timber. */}
                                  {(e?.current_tillable_polygons?.length ?? 0) > 1 && (
                                    <div className="flex items-center flex-wrap gap-1 text-[10px] mb-1 pl-[68px]">
                                      <span className="text-gg-gray-500">Areas:</span>
                                      {(e?.current_tillable_polygons || []).map((_, idx) => (
                                        <span key={idx} className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded bg-green-500/15 border border-green-500/40 text-green-300">
                                          #{idx + 1}
                                          <button
                                            onClick={() => deleteTillableSubpolygon(t.tract_id, idx)}
                                            className="ml-0.5 hover:text-red-300"
                                            title={`Remove tillable area #${idx + 1}`}
                                          >
                                            ✕
                                          </button>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1.5 text-[10px] mb-1 pl-[68px]">
                                    {drawingTractId === t.tract_id && drawingKind === 'tillable' ? (
                                      <>
                                        <span className="px-1.5 py-0.5 rounded bg-yellow-500/20 border border-yellow-500/50 text-yellow-200 font-semibold">
                                          ✏ Drawing… {draftVertices.length} {draftVertices.length === 1 ? 'point' : 'points'}
                                        </span>
                                        <button
                                          onClick={undoLastDraftVertex}
                                          disabled={draftVertices.length === 0}
                                          className="px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/40 disabled:opacity-40 text-amber-200 border border-amber-500/40"
                                          title="Remove the last placed vertex (Ctrl/Cmd-Z also works)"
                                        >
                                          ↩ Undo
                                        </button>
                                        <button
                                          onClick={finishDrawTillable}
                                          disabled={draftVertices.length < 3}
                                          className="px-1.5 py-0.5 rounded bg-emerald-500/25 hover:bg-emerald-500/40 disabled:opacity-40 text-emerald-200 border border-emerald-500/50"
                                          title="Close the polygon and add it to this tract's tillable area(s). Then click Align Tillable to scale to the published acres. (Enter also works)"
                                        >
                                          ✓ Finish
                                        </button>
                                        <button
                                          onClick={cancelDrawTillable}
                                          className="px-1.5 py-0.5 rounded bg-gg-gray-700/40 hover:bg-gg-gray-700/70 text-gg-gray-300 border border-gg-gray-600"
                                          title="Discard the in-progress drawing (ESC also works)"
                                        >
                                          ✕ Cancel
                                        </button>
                                      </>
                                    ) : (
                                      <>
                                        <button
                                          onClick={() => startDrawTillable(t.tract_id)}
                                          disabled={drawingTractId != null}
                                          className="px-1.5 py-0.5 rounded bg-yellow-500/15 hover:bg-yellow-500/30 disabled:opacity-40 text-yellow-200 border border-yellow-500/40"
                                          title="Click on the map to place vertices of a new tillable polygon. Double-click (or Finish) to close it. Can be repeated to add multi-region tillable."
                                        >
                                          ✏ Draw Tillable
                                        </button>
                                        <button
                                          onClick={() => addTillableSubpolygon(t.tract_id)}
                                          disabled={drawingTractId != null}
                                          className="px-1.5 py-0.5 rounded bg-green-500/15 hover:bg-green-500/30 disabled:opacity-40 text-green-300 border border-green-500/40"
                                          title="Add a default-rectangle tillable area near the tract center — drag its vertices into shape"
                                        >
                                          + Add Box
                                        </button>
                                        {(e?.current_tillable_polygons?.length ?? 0) === 1 && (
                                          <button
                                            onClick={() => deleteTillableSubpolygon(t.tract_id, 0)}
                                            disabled={drawingTractId != null}
                                            className="px-1.5 py-0.5 rounded bg-red-500/15 hover:bg-red-500/30 disabled:opacity-40 text-red-300 border border-red-500/40"
                                            title="Remove the tillable polygon (use if this tract has no cropland)"
                                          >
                                            ✕ Remove
                                          </button>
                                        )}
                                      </>
                                    )}
                                  </div>

                                  {/* Editable Soil Rating row */}
                                  <div className="flex items-center gap-1.5 text-[11px] mb-1">
                                    <label className="text-gg-gray-400 w-16 flex-shrink-0">
                                      {e?.current_soil_rating_type || t.soil_rating_type || 'Rating'}:
                                    </label>
                                    <input
                                      type="number" step="0.1"
                                      value={e?.override_soil_rating ?? ''}
                                      onChange={(ev) => onOverrideSoilRating(t.tract_id, ev.target.value)}
                                      className="w-20 px-1 py-0.5 bg-gg-gray-950 border border-gg-gray-700 rounded text-white text-[11px] focus:outline-none focus:border-gg-pink"
                                      placeholder="—"
                                    />
                                    {/* Match indicator — soil rating tolerance ±0.5 since
                                        PI/CSR2 are integers in practice and our calc rounds
                                        to 1 decimal. */}
                                    {e?.override_soil_rating != null && e?.current_soil_rating != null &&
                                     Math.abs(Number(e.override_soil_rating) - Number(e.current_soil_rating)) <= 0.5 && (
                                      <span className="text-emerald-400 font-bold text-[12px]" title="Computed rating matches the target value">✓</span>
                                    )}
                                    <span className="text-gg-gray-500 text-[10px]">
                                      (calc: {e?.current_no_cropland ? 'N/A' : (e?.current_soil_rating ?? '—')})
                                    </span>
                                  </div>

                                  {listingTract && (listingTract.total_acres != null || listingTract.scraped_tillable_acres != null || listingTract.scraped_soil_rating != null) && (
                                    <div className="text-[10px] text-gg-gray-500 mb-1">
                                      Scraped: {listingTract.total_acres != null ? `${listingTract.total_acres}ac` : '—'} · {listingTract.scraped_tillable_acres != null ? `${listingTract.scraped_tillable_acres}ac till` : '—'} · {listingTract.scraped_soil_rating ?? '—'} {listingTract.scraped_soil_rating_type || ''}
                                    </div>
                                  )}

                                  {calculatingTractId === t.tract_id && (
                                    <div className="text-[10px] text-blue-300 mb-1">
                                      ↻ Recalculating tillable + rating…
                                    </div>
                                  )}
                                  {isApproved && (
                                    <div className="text-[11px] text-emerald-300 mt-1 mb-1">
                                      ✓ Saved to live database — this tract is no longer in the missing-boundaries queue.
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <button
                                      onClick={() => approveTract(t.tract_id, lid)}
                                      disabled={isApproved || approvingTractId === t.tract_id || rejectingTractId === t.tract_id || calculatingTractId === t.tract_id}
                                      className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/25 hover:bg-emerald-500/40 disabled:opacity-30 disabled:cursor-not-allowed text-emerald-200 border border-emerald-500/40"
                                    >
                                      {isApproved ? '✓ Approved' : (approvingTractId === t.tract_id ? 'Approving…' : '✓ Approve')}
                                    </button>
                                    <button
                                      onClick={() => rejectProposed(t.tract_id, lid)}
                                      disabled={isApproved || approvingTractId === t.tract_id || rejectingTractId === t.tract_id}
                                      className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/35 disabled:opacity-30 disabled:cursor-not-allowed text-red-300 border border-red-500/40"
                                      title="Discard this proposed boundary. Tract stays on the list."
                                    >
                                      {rejectingTractId === t.tract_id ? 'Rejecting…' : '✗ Reject'}
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {autoExtractResultByListing[lid].failed?.length > 0 && (
                        <div className="mt-2 bg-amber-900/30 border border-amber-700 rounded p-2 text-amber-200">
                          ⚠ {autoExtractResultByListing[lid].failed.length} tract{autoExtractResultByListing[lid].failed.length === 1 ? '' : 's'} could not be matched. Use Upload Image / Draw Boundary for those.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="divide-y divide-gg-gray-800">
                  {tracts.map((t) => (
                    <div key={t.tract_id} className="px-4 py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Tract thumbnail — current image_base64 if any.
                            Image endpoint returns 404 when not yet stored,
                            in which case onError swaps in a placeholder. */}
                        {t.has_image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${SCRAPER_URL}/api/admin/tracts/${t.tract_id}/image`}
                            alt={`Tract ${t.tract_number ?? '?'}`}
                            className="w-16 h-16 object-cover rounded border border-gg-gray-700 flex-shrink-0"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div
                            className="w-16 h-16 rounded border border-gg-gray-800 bg-gg-gray-900 flex-shrink-0 flex items-center justify-center text-gg-gray-600 text-[10px]"
                            title="No tract image stored yet"
                          >
                            no image
                          </div>
                        )}
                        <span className="text-white font-medium">Tract {t.tract_number ?? '?'}</span>
                        <span className="text-sm text-gg-gray-300">
                          {t.total_acres != null ? `${t.total_acres} ac` : 'acres unknown'}
                        </span>
                        {t.boundary_status === 'wrong' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40"
                            title="Polygon area differs from scraped acres by > 1 ac — boundary is likely wrong"
                          >
                            Wrong
                          </span>
                        )}
                        {t.boundary_status === 'missing' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            title="No boundary on file"
                          >
                            Missing
                          </span>
                        )}
                        {t.boundary_status === 'ok' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            title="Boundary passes auto-validation. Spot-check anyway — if other tracts on this listing are wrong, this one might be too."
                          >
                            Correct
                          </span>
                        )}
                        {t.land_type && (
                          <span className="text-xs text-gg-pink">{t.land_type}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/upload-boundary-tract/${t.tract_id}`}
                          className="px-3 py-1.5 text-xs rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors flex items-center gap-1"
                          title="Paste an auction-website screenshot and let Claude Vision extract the boundary"
                        >
                          📷 Upload Image
                        </Link>
                        <Link
                          href={`/admin/boundary-draw-tract/${t.tract_id}`}
                          className="px-3 py-1.5 text-xs rounded bg-gg-pink/20 hover:bg-gg-pink/30 text-gg-pink border border-gg-pink/40 transition-colors flex items-center gap-1"
                        >
                          ✏️ Draw Boundary
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
