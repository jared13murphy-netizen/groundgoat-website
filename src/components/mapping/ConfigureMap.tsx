'use client'

/**
 * Configure Map — Configurable Mapping, phase 2.
 *
 * A deliberately stripped-down map: satellite, place labels, parcel
 * outlines and parcel labels. No state silhouettes, no tract dots, no
 * parcel sale dots, no Goat Search, no top menu, no layers button —
 * nothing competes with the parcel you are working on.
 *
 * Click a parcel: it outlines in BLACK, and the classification polygons
 * our engine already produced are drawn inside it in PINK, each labelled
 * with its land type. Vertices drag, edges accept new vertices, and the
 * user can add, reclassify, delete or clear polygons, then name and save.
 *
 * The drawing mechanics (edge insert, simplify, scale, ring handling)
 * come from `@/lib/polygonEditing` — the same code the Auction Staging
 * map creator uses, so the two editors cannot drift apart.
 *
 * Acreage shown WHILE EDITING is computed in the browser for instant
 * feedback. The acreage that gets SAVED is recomputed server-side
 * against PostGIS, so stored figures never depend on this approximation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Loader2, Plus, Trash2, RotateCcw, RotateCw, Save, Search, X, Layers,
  Scissors, Combine, FileText, Download,
} from 'lucide-react'
import {
  CLASS_COLOR, CLASS_LABEL, LAND_CLASSES, PARCEL_LINE, SEARCH_DOT, VERTEX_LINE,
  archiveParcel, combineGeometry, fetchParcel, getSavedParcel, saveParcel, searchMap,
  splitGeometry,
  updateParcel, queueReport, listReports, downloadReport,
  REPORT_KINDS, REPORT_LABEL, type ReportRow,
  type LandClass, type ParcelDetail, type ParcelSummary,
} from '@/lib/configurableMapping'
import { addRegridLayer, buildRegridStateFilter, fetchRegridConfig } from '@/components/map/regridLayer'
import {
  GLYPH_URL, LABEL_TILE_URL, MAP_CENTER, MAP_INITIAL_ZOOM, TILE_ATTRIBUTION, TILE_URL,
} from '@/components/map/mapConstants'
import { polygonAcres } from '@/lib/polygonGeometry'
import {
  closeRing, nearestSegmentIndex, nearestVertexIndex, openRing, simplifyRing, type Pt,
} from '@/lib/polygonEditing'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

/** One drawn shape: a list of polygons, each [outerRing, ...holes].
 *  Holes are preserved — a pond inside a tillable field is a hole in
 *  that field, not a separate shape. Rings are stored OPEN. */
interface Shape { id: string; cls: LandClass; polys: Pt[][][] }

const SRC = {
  boundary: 'cm-boundary', shapes: 'cm-shapes', verts: 'cm-verts',
  dots: 'cm-dots', draft: 'cm-draft',
} as const
const LYR_VERTS = 'cm-verts-circles'
const LYR_FILL = 'cm-shapes-fill'

let idSeq = 0
const nextId = () => `s${++idSeq}`

function geometryToPolys(geom: any): Pt[][][] {
  if (!geom) return []
  const raw: any[] = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : []
  return raw.map((rings: any[]) => rings.map((r: any) => openRing(r as Pt[])).filter((r) => r.length >= 3))
             .filter((rings) => rings.length > 0)
}

function polysToGeometry(polys: Pt[][][]): any {
  const cleaned = polys
    .map((rings) => rings.filter((r) => r.length >= 3).map(closeRing))
    .filter((rings) => rings.length > 0)
  if (!cleaned.length) return null
  return cleaned.length === 1
    ? { type: 'Polygon', coordinates: cleaned[0] }
    : { type: 'MultiPolygon', coordinates: cleaned }
}

/** Outer rings minus their holes. */
function shapeAcres(s: Shape): number {
  return s.polys.reduce((sum, rings) => {
    if (!rings.length) return sum
    const holes = rings.slice(1).reduce((h, r) => h + polygonAcres(r), 0)
    return sum + Math.max(polygonAcres(rings[0]) - holes, 0)
  }, 0)
}

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

export default function ConfigureMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)

  const [detail, setDetail] = useState<ParcelDetail | null>(null)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawClass, setDrawClass] = useState<LandClass>('tillable')
  const [drawing, setDrawing] = useState(false)
  // 'draw' adds a classified polygon; 'split' draws the cut line;
  // 'combine' adds the next clicked parcel to this boundary.
  const [tool, setTool] = useState<'draw' | 'split' | 'combine' | null>(null)
  const [draft, setDraft] = useState<Pt[]>([])

  const [name, setName] = useState('')
  // Project context. A single-parcel user never sees this: leaving it
  // blank makes the server create a project named after the parcel.
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  // Every Regrid parcel folded into this subject, for provenance.
  const [sources, setSources] = useState<string[]>([])
  const [reports, setReports] = useState<ReportRow[]>([])
  // Split results waiting to be named and saved as separate tracts.
  const [pieces, setPieces] = useState<{ geometry: any; acres: number }[]>([])
  const [query, setQuery] = useState('')
  const [searchState, setSearchState] = useState('')
  const [hits, setHits] = useState<ParcelSummary[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  // Refs mirror state for use inside map event handlers, which close
  // over their first render otherwise.
  const shapesRef = useRef(shapes); shapesRef.current = shapes
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId
  const drawingRef = useRef(drawing); drawingRef.current = drawing
  const toolRef = useRef(tool); toolRef.current = tool
  const detailRef = useRef(detail); detailRef.current = detail
  const draftRef = useRef(draft); draftRef.current = draft
  const drawClassRef = useRef(drawClass); drawClassRef.current = drawClass

  const undoRef = useRef<Shape[][]>([])
  const redoRef = useRef<Shape[][]>([])
  const [, forceHist] = useState(0)
  const snapshot = useCallback((prev: Shape[]) => {
    undoRef.current.push(JSON.parse(JSON.stringify(prev)))
    if (undoRef.current.length > 100) undoRef.current.shift()
    redoRef.current = []
    forceHist((t) => t + 1)
  }, [])
  const mutate = useCallback((fn: (s: Shape[]) => Shape[]) => {
    setShapes((prev) => { snapshot(prev); return fn(prev) })
  }, [snapshot])
  const undo = useCallback(() => {
    const p = undoRef.current.pop(); if (!p) return
    setShapes((cur) => { redoRef.current.push(JSON.parse(JSON.stringify(cur))); return p })
    forceHist((t) => t + 1)
  }, [])
  const redo = useCallback(() => {
    const n = redoRef.current.pop(); if (!n) return
    setShapes((cur) => { undoRef.current.push(JSON.parse(JSON.stringify(cur))); return n })
    forceHist((t) => t + 1)
  }, [])

  // ── load a parcel ─────────────────────────────────────────────────
  const loadParcel = useCallback(async (llUuid: string) => {
    setBusy('Loading parcel…'); setError(null); setSavedMsg(null)
    try {
      const d = await fetchParcel(llUuid)
      setDetail(d)
      undoRef.current = []; redoRef.current = []
      const loaded = d.polygons.map((p) => ({
        id: nextId(), cls: p.cls, polys: geometryToPolys(p.geometry),
      })).filter((s) => s.polys.length > 0)
      setShapes(loaded)
      // Pre-select the largest piece so the drag handles are on screen
      // immediately — otherwise the shapes look un-editable until you
      // happen to click one.
      setSelectedId(loaded.length
        ? loaded.reduce((a, b) => (shapeAcres(b) > shapeAcres(a) ? b : a)).id
        : null)
      setName(d.parcel?.parcelnumb ? `Parcel ${d.parcel.parcelnumb}` : '')
      setHits([])
      const bb = bboxOf(d.boundary?.coordinates)
      if (bb && mapRef.current) mapRef.current.fitBounds(bb, { padding: 90, duration: 700 })
    } catch (e: any) {
      setError(e?.message || 'Could not load that parcel.')
    } finally { setBusy(null) }
  }, [])
  const loadParcelRef = useRef(loadParcel); loadParcelRef.current = loadParcel

  // ── open from the Map Portfolio (?parcel= / ?project=) ────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const proj = params.get('project')
    const saved = params.get('parcel')
    if (proj) setProjectId(proj)
    if (!saved) return
    let cancelled = false
    ;(async () => {
      setBusy('Opening saved parcel…')
      try {
        const rec = await getSavedParcel(saved)
        if (cancelled) return
        setEditingId(rec.id)
        setProjectId(rec.project_id)
        setName(rec.name)
        setSources(rec.source_ll_uuids || [])
        setDetail({
          // A saved parcel's stats use `buildings`; the live-parcel path
          // uses Regrid's `ll_bldg_count`. Map it across so a reopened
          // parcel doesn't report zero buildings.
          parcel: {
            ...rec.stats,
            acres: rec.stats?.acres ?? 0,
            ll_bldg_count: rec.stats?.buildings ?? 0,
            county: rec.stats?.county ?? null,
            state: rec.stats?.state ?? null,
            ll_uuid: null,
          },
          boundary: rec.boundary,
          polygons: rec.polygons as any,
          source: 'engine',
          unclassified_acres: rec.stats?.unclassified_acres ?? 0,
        })
        setShapes(rec.polygons.map((pp) => ({
          id: nextId(), cls: pp.cls, polys: geometryToPolys(pp.geometry),
        })).filter((x) => x.polys.length > 0))
        const bb = bboxOf(rec.boundary?.coordinates)
        if (bb && mapRef.current) mapRef.current.fitBounds(bb, { padding: 90, duration: 700 })
      } catch (e: any) {
        setError(e?.message || 'Could not open that saved parcel.')
      } finally { setBusy(null) }
    })()
    return () => { cancelled = true }
  }, [ready])

  // ── map ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return
    // No `if (mapRef.current) return` guard here. React mounts effects
    // twice in development, and that guard let the second mount skip
    // creating a map while the first mount's cleanup destroyed the one
    // the component was still pointing at — sources and layers silently
    // missing, on a map that still drew its base tiles. Each mount now
    // owns exactly one map and tears down exactly that one.
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: GLYPH_URL,
        sources: {
          sat: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION },
          // State / county / town labels are kept; everything else the
          // Explore map draws is deliberately absent.
          places: { type: 'raster', tiles: [LABEL_TILE_URL], tileSize: 256 },
        },
        layers: [
          { id: 'sat', type: 'raster', source: 'sat' },
          { id: 'places', type: 'raster', source: 'places', paint: { 'raster-opacity': 0.85 } },
        ],
      },
      center: MAP_CENTER,
      zoom: MAP_INITIAL_ZOOM,
      attributionControl: false,
      // Parcel tiles come from our backend behind auth; the token rides
      // as a header rather than in the URL (header_auth=1).
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

    // The canvas is sized when the map is constructed, which happens
    // before the fixed-position layout has settled — without this the
    // map paints into a small corner of its container.
    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current!)

    map.on('load', async () => {
      for (const id of Object.values(SRC)) {
        map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any })
      }

      const cfg = await fetchRegridConfig()
      if (cfg) {
        addRegridLayer(map, cfg, { minZoom: 11, labelMinZoom: 14, interactive: false })
        const f = buildRegridStateFilter(cfg)
        if (f) for (const l of ['regrid-parcels-fill', 'regrid-parcels-line', 'regrid-parcels-label']) {
          if (map.getLayer(l)) map.setFilter(l, f)
        }
      }

      // The polygon IS the land type — its colour carries the meaning and
      // the panel legend explains it. No text on the map: labels stacked
      // on top of a field made the map unreadable.
      map.addLayer({
        id: LYR_FILL, type: 'fill', source: SRC.shapes,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.42, 0.22],
        },
      })
      map.addLayer({
        id: 'cm-shapes-line', type: 'line', source: SRC.shapes,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['boolean', ['get', 'selected'], false], 3, 2],
        },
      })
      map.addLayer({
        id: 'cm-boundary-line', type: 'line', source: SRC.boundary,
        paint: { 'line-color': PARCEL_LINE, 'line-width': 4 },
      })
      map.addLayer({
        id: 'cm-draft-line', type: 'line', source: SRC.draft,
        paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.5] },
      })
      map.addLayer({
        id: LYR_VERTS, type: 'circle', source: SRC.verts,
        paint: {
          // Bigger on the selected shape so it is obvious what you are
          // editing, but present on every polygon — a user should never
          // have to guess whether a shape can be reshaped.
          'circle-radius': ['case', ['boolean', ['get', 'active'], false], 5, 3.2],
          'circle-color': '#ffffff',
          'circle-stroke-color': VERTEX_LINE,
          'circle-stroke-width': ['case', ['boolean', ['get', 'active'], false], 2, 1.2],
        },
      })
      map.addLayer({
        id: 'cm-dots-circles', type: 'circle', source: SRC.dots,
        paint: {
          'circle-radius': 6, 'circle-color': SEARCH_DOT,
          'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        },
      })

      // ── vertex dragging ───────────────────────────────────────────
      let drag: { id: string; pi: number; ri: number; vi: number } | null = null
      let took = false
      map.on('mousedown', LYR_VERTS, (e) => {
        const f = e.features?.[0]
        if (!f) return
        e.preventDefault()
        const owner = String(f.properties!.shapeId)
        if (owner !== selectedRef.current) setSelectedId(owner)
        drag = { id: owner, pi: f.properties!.pi, ri: f.properties!.ri, vi: f.properties!.vi }
        took = false
        map.dragPan.disable()
      })
      map.on('mousemove', (e) => {
        if (!drag) return
        // One undo snapshot per drag, not per mousemove.
        if (!took) { snapshot(shapesRef.current); took = true }
        const { id, pi, ri, vi } = drag
        setShapes((prev) => prev.map((s) => {
          if (s.id !== id) return s
          const polys = s.polys.map((rings, p) => p !== pi ? rings : rings.map((r, i) =>
            i !== ri ? r : r.map((pt, v) => v === vi ? [e.lngLat.lng, e.lngLat.lat] as Pt : pt)))
          return { ...s, polys }
        }))
      })
      const endDrag = () => { if (drag) { drag = null; map.dragPan.enable() } }
      map.on('mouseup', endDrag)
      map.on('mouseout', endDrag)
      map.on('mouseenter', LYR_VERTS, () => { map.getCanvas().style.cursor = 'move' })
      map.on('mouseleave', LYR_VERTS, () => { map.getCanvas().style.cursor = '' })

      // ── clicks: draw a point, select a shape, or pick a parcel ─────
      map.on('click', (e) => {
        if (drawingRef.current) {
          setDraft((d) => [...d, [e.lngLat.lng, e.lngLat.lat] as Pt])
          return
        }
        // Combine: the next parcel clicked is merged into this boundary.
        if (toolRef.current === 'combine') {
          const hit = map.queryRenderedFeatures(e.point, { layers: ['regrid-parcels-fill'] })
          const uu = hit[0]?.properties?.ll_uuid || hit[0]?.properties?.ll_uuid_text
          if (uu) { void combineWithRef.current(String(uu)) }
          return
        }
        const onShape = map.queryRenderedFeatures(e.point, { layers: [LYR_FILL] })
        if (onShape.length) {
          const id = onShape[0].properties?.id
          if (id) {
            // Clicking an already-selected shape's edge inserts a vertex
            // there, matching the staging editor's behaviour.
            const sel = shapesRef.current.find((s) => s.id === id)
            if (id === selectedRef.current && sel) {
              insertOnNearestEdge(map, sel, e.point, e.lngLat)
            } else {
              setSelectedId(id)
            }
            return
          }
        }
        const onParcel = map.queryRenderedFeatures(e.point, { layers: ['regrid-parcels-fill'] })
        const uuid = onParcel[0]?.properties?.ll_uuid || onParcel[0]?.properties?.ll_uuid_text
        if (uuid) { void loadParcelRef.current(String(uuid)) ; return }
        setSelectedId(null)
      })

      map.on('dblclick', (e) => {
        if (!drawingRef.current) return
        e.preventDefault()
        finishDraft()
      })

      if (mapRef.current === map) setReady(true)
    })

    return () => {
      ro.disconnect()
      map.remove()
      // Only clear the ref if it still points at THIS map, so a
      // late cleanup cannot orphan a newer instance.
      if (mapRef.current === map) { mapRef.current = null; setReady(false) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Insert a vertex on whichever edge of `s` the user clicked. */
  const insertOnNearestEdge = useCallback((
    map: maplibregl.Map, s: Shape, screenPt: { x: number; y: number }, lngLat: maplibregl.LngLat,
  ) => {
    let bestPi = 0, bestRi = 0, bestSeg = 0, bestD = Infinity
    s.polys.forEach((rings, pi) => rings.forEach((ring, ri) => {
      const seg = nearestSegmentIndex(map, ring, screenPt)
      const a = map.project(ring[seg]); const b = map.project(ring[(seg + 1) % ring.length])
      const t = Math.hypot(screenPt.x - (a.x + b.x) / 2, screenPt.y - (a.y + b.y) / 2)
      if (t < bestD) { bestD = t; bestPi = pi; bestRi = ri; bestSeg = seg }
    }))
    mutate((prev) => prev.map((sh) => sh.id !== s.id ? sh : {
      ...sh,
      polys: sh.polys.map((rings, pi) => pi !== bestPi ? rings : rings.map((r, ri) =>
        ri !== bestRi ? r
          : [...r.slice(0, bestSeg + 1), [lngLat.lng, lngLat.lat] as Pt, ...r.slice(bestSeg + 1)])),
    }))
  }, [mutate])

  const finishDraft = useCallback(() => {
    const d = draftRef.current
    if (toolRef.current === 'split') {
      if (d.length >= 2) void runSplitRef.current(d)
      setDraft([]); setDrawing(false); setTool(null)
      return
    }
    if (d.length >= 3) {
      const ring = simplifyRing(d, 0.000004)
      const id = nextId()
      mutate((prev) => [...prev, { id, cls: drawClassRef.current, polys: [[ring]] }])
      setSelectedId(id)
    }
    setDraft([]); setDrawing(false)
  }, [mutate])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Enter' && drawingRef.current) { e.preventDefault(); finishDraft() }
      if (e.key === 'Escape') { setDraft([]); setDrawing(false) }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); e.shiftKey ? redo() : undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finishDraft, undo, redo])

  // ── combine / split / open-saved ──────────────────────────────────
  /** Merge another clicked parcel into the current subject boundary.
   *  A real auction tract is often two or three Regrid parcels. */
  const combineWith = useCallback(async (llUuid: string) => {
    const cur = detailRef.current
    if (!cur) { await loadParcelRef.current(llUuid); return }
    setBusy('Combining…'); setError(null)
    try {
      const other = await fetchParcel(llUuid)
      const merged = await combineGeometry([cur.boundary, other.boundary])
      setDetail({
        ...cur,
        boundary: merged.geometry,
        parcel: {
          ...cur.parcel,
          acres: merged.acres,
          ll_bldg_count: (cur.parcel?.ll_bldg_count || 0) + (other.parcel?.ll_bldg_count || 0),
          ll_uuid: cur.parcel?.ll_uuid,
        },
        polygons: cur.polygons,
      })
      // The other parcel's engine polygons come along with it.
      mutate((prev) => [...prev, ...other.polygons.map((pp) => ({
        id: nextId(), cls: pp.cls, polys: geometryToPolys(pp.geometry),
      })).filter((x) => x.polys.length > 0)])
      setSources((prev) => Array.from(new Set([...prev, llUuid])))
      setTool(null)
    } catch (e: any) {
      setError(e?.message || 'Those parcels could not be combined.')
    } finally { setBusy(null) }
  }, [mutate])
  const combineWithRef = useRef(combineWith); combineWithRef.current = combineWith

  /** Cut the boundary with the drawn line. Pieces come back largest
   *  first so they can be named Tract 1, Tract 2, … sensibly. */
  const runSplit = useCallback(async (line: Pt[]) => {
    const cur = detailRef.current
    if (!cur) return
    setBusy('Splitting…'); setError(null); setPieces([])
    try {
      const res = await splitGeometry(cur.boundary, {
        type: 'LineString', coordinates: line,
      })
      setPieces(res.pieces)
    } catch (e: any) {
      setError(e?.message || 'That line did not cut the boundary.')
    } finally { setBusy(null) }
  }, [])
  const runSplitRef = useRef(runSplit); runSplitRef.current = runSplit

  /** Save every split piece as its own named tract in one project —
   *  the 20-tract auction workflow in a single click. */
  const savePieces = useCallback(async () => {
    if (!pieces.length || !detail) return
    setBusy('Saving tracts…'); setError(null)
    try {
      let pid = projectId
      for (let i = 0; i < pieces.length; i++) {
        const res = await saveParcel({
          name: `Tract ${i + 1}`,
          boundary: pieces[i].geometry,
          // Each tract keeps only the classified ground that falls inside
          // it; the server clips every polygon to the boundary on save.
          polygons: shapes
            .map((sh) => ({ cls: sh.cls, geometry: polysToGeometry(sh.polys) }))
            .filter((x) => x.geometry) as any,
          source_ll_uuids: sources,
          project_id: pid,
          project_name: projectName || name || 'Untitled auction',
        })
        pid = res.project_id
      }
      // The whole parcel has been replaced by its pieces. Leaving it in
      // the project makes the totals count the same ground twice — an
      // 81-acre farm reading as 163 acres.
      if (editingId) {
        await archiveParcel(editingId)
        setEditingId(null)
      }
      setProjectId(pid)
      setSavedMsg(
        `Saved ${pieces.length} tracts` +
        (editingId ? ' and archived the undivided parcel.' : '.'))
      setPieces([])
    } catch (e: any) {
      setError(e?.message || 'Could not save the tracts.')
    } finally { setBusy(null) }
  }, [pieces, detail, projectId, projectName, name, shapes, sources, editingId])

  // ── paint shapes / vertices / boundary / dots / draft ──────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const feats: any[] = []
    for (const s of shapes) {
      const g = polysToGeometry(s.polys)
      if (g) feats.push({
        type: 'Feature', geometry: g,
        properties: { id: s.id, color: CLASS_COLOR[s.cls], selected: s.id === selectedId },
      })
    }
    ;(map.getSource(SRC.shapes) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: feats } as any)

    // Handles on EVERY polygon so it is visible that they can be
    // reshaped — small on the others, full size on the one being edited.
    const verts: any[] = []
    const sel = shapes.find((sh) => sh.id === selectedId)
    sel?.polys.forEach((rings, pi) => rings.forEach((ring, ri) =>
      ring.forEach((pt, vi) => verts.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: pt },
        properties: { shapeId: sel.id, pi, ri, vi, active: true },
      }))))
    ;(map.getSource(SRC.verts) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: verts } as any)
  }, [shapes, selectedId, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource(SRC.boundary) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: detail?.boundary ? [{ type: 'Feature', geometry: detail.boundary, properties: {} }] : [],
    } as any)
  }, [detail, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource(SRC.dots) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: hits.filter((h) => h.lng != null && h.lat != null).map((h) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [h.lng, h.lat] },
        properties: { ll_uuid: h.ll_uuid },
      })),
    } as any)
  }, [hits, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource(SRC.draft) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: draft.length >= 2
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...draft, draft[0]] } }]
        : [],
    } as any)
  }, [draft, ready])

  // ── panel actions ─────────────────────────────────────────────────
  const runSearch = useCallback(async () => {
    if (!query.trim()) return
    setBusy('Searching…'); setError(null); setNote(null); setHits([])
    try {
      const r = await searchMap(query.trim(), searchState || null)
      if (r.kind === 'parcels') {
        setHits(r.parcels)
        setNote(r.parcels.length ? `${r.parcels.length} parcel${r.parcels.length === 1 ? '' : 's'} found` : 'No parcels matched.')
        const bb = bboxOf(r.parcels.map((p) => [p.lng, p.lat]))
        if (bb && mapRef.current && r.parcels.length) {
          mapRef.current.fitBounds(bb, { padding: 120, maxZoom: 15, duration: 700 })
        }
      } else if (r.kind === 'flyto') {
        setNote(r.label)
        if (r.bounds) mapRef.current?.fitBounds(r.bounds, { padding: 60, duration: 800 })
        else if (r.center) mapRef.current?.flyTo({ center: r.center, zoom: r.zoom ?? 15 })
      } else {
        setNote(r.message)
      }
    } catch (e: any) {
      setError(e?.message || 'Search failed.')
    } finally { setBusy(null) }
  }, [query, searchState])

  const setClassOf = useCallback((id: string, cls: LandClass) => {
    mutate((prev) => prev.map((s) => s.id === id ? { ...s, cls } : s))
  }, [mutate])

  const deleteShape = useCallback((id: string) => {
    mutate((prev) => prev.filter((s) => s.id !== id))
    setSelectedId((cur) => cur === id ? null : cur)
  }, [mutate])

  const clearAll = useCallback(() => {
    if (!shapes.length) return
    mutate(() => [])
    setSelectedId(null)
  }, [mutate, shapes.length])

  const resetToEngine = useCallback(() => {
    if (!detail) return
    mutate(() => detail.polygons.map((p) => ({
      id: nextId(), cls: p.cls, polys: geometryToPolys(p.geometry),
    })).filter((s) => s.polys.length > 0))
    setSelectedId(null)
  }, [detail, mutate])

  const doSave = useCallback(async () => {
    if (!detail) return
    if (!name.trim()) { setError('Give this parcel a name before saving.'); return }
    setBusy('Saving…'); setError(null); setSavedMsg(null)
    try {
      const payload = {
        name: name.trim(),
        boundary: detail.boundary,
        polygons: shapes
          .map((s) => ({ cls: s.cls, geometry: polysToGeometry(s.polys) }))
          .filter((p) => p.geometry) as any,
        source_ll_uuids: sources.length
          ? sources
          : [String(detail.parcel?.ll_uuid)].filter((x) => x && x !== 'null'),
        project_id: projectId,
        project_name: projectName || null,
      }
      const res = editingId
        ? await updateParcel(editingId, payload)
        : await saveParcel(payload)
      if (!editingId && 'project_id' in res) {
        setProjectId((res as any).project_id)
        setEditingId(res.id)
      }
      const st = res.stats || {}
      setSavedMsg(`Saved "${res.name}" — ${st.acres ?? '?'} ac total, ${st.tillable_acres ?? 0} ac tillable.`)
    } catch (e: any) {
      setError(e?.message || 'Save failed.')
    } finally { setBusy(null) }
  }, [detail, name, shapes, sources, projectId, projectName, editingId])

  // ── reports ───────────────────────────────────────────────────────
  // Queue, then poll. Rendering happens on a worker, so the screen must
  // never sit blocked waiting for a PDF.
  const refreshReports = useCallback(async (id: string) => {
    try { setReports((await listReports(id)).reports) } catch { /* non-fatal */ }
  }, [])

  useEffect(() => {
    if (!editingId) { setReports([]); return }
    void refreshReports(editingId)
    const pending = reports.some((r) => r.status === 'queued' || r.status === 'running')
    if (!pending) return
    const t = setTimeout(() => void refreshReports(editingId), 4000)
    return () => clearTimeout(t)
  }, [editingId, reports, refreshReports])

  const makeReport = useCallback(async (kind: (typeof REPORT_KINDS)[number]) => {
    if (!editingId) { setError('Save this parcel before building a report.'); return }
    setError(null)
    try {
      await queueReport(editingId, kind)
      await refreshReports(editingId)
    } catch (e: any) {
      setError(e?.message || 'Could not start that report.')
    }
  }, [editingId, refreshReports])

  /** Discard unsaved edits. Falls back to the engine's own polygons when
   *  this parcel has never been saved, so Cancel always lands somewhere
   *  sensible rather than on an empty map. */
  const cancelEdits = useCallback(async () => {
    setError(null); setSavedMsg(null); setPieces([]); setTool(null)
    setDrawing(false); setDraft([]); setSelectedId(null)
    if (editingId) {
      setBusy('Reloading saved version…')
      try {
        const rec = await getSavedParcel(editingId)
        setShapes(rec.polygons.map((pp) => ({
          id: nextId(), cls: pp.cls, polys: geometryToPolys(pp.geometry),
        })).filter((x) => x.polys.length > 0))
        setName(rec.name)
      } catch (e: any) {
        setError(e?.message || 'Could not reload the saved version.')
      } finally { setBusy(null) }
    } else if (detail) {
      setShapes(detail.polygons.map((pp) => ({
        id: nextId(), cls: pp.cls, polys: geometryToPolys(pp.geometry),
      })).filter((x) => x.polys.length > 0))
    }
    undoRef.current = []; redoRef.current = []
  }, [editingId, detail])

  // Live totals by class for the panel.
  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const c of LAND_CLASSES) t[c] = 0
    for (const s of shapes) t[s.cls] += shapeAcres(s)
    return t
  }, [shapes])

  const parcelAcres = Number(detail?.parcel?.acres ?? 0)
  const classified = LAND_CLASSES.reduce((s, c) => s + totals[c], 0)

  return (
    // Fixed + above the site chrome: this is a full-surface tool, and
    // the marketing header/footer would otherwise wrap around it.
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: '#0f1520' }}>
      <div ref={containerRef} style={{ flex: 1, position: 'relative' }} />

      <aside style={{
        width: 360, flexShrink: 0, background: '#0f1520', color: '#e5e7eb',
        borderLeft: '1px solid rgba(255,255,255,0.08)', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 14, padding: 16,
        fontSize: 13,
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.2 }}>Configure Map</div>

        {/* Search */}
        <div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
              placeholder="Parcel #, owner, town, county, lat/lng"
              style={inputStyle}
            />
            <select value={searchState} onChange={(e) => setSearchState(e.target.value)}
                    style={{ ...inputStyle, width: 68, flex: 'none' }}>
              <option value="">--</option>
              {['IL', 'IA', 'MO', 'NE', 'KS', 'IN', 'MN', 'WI', 'OH', 'SD', 'ND'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <button onClick={() => void runSearch()} style={{ ...btn, width: '100%', marginTop: 6 }}>
            <Search size={13} /> Submit
          </button>
          {note && <div style={hint}>{note}</div>}
        </div>

        {hits.length > 0 && (
          <div style={{ maxHeight: 170, overflowY: 'auto', ...card }}>
            {hits.slice(0, 60).map((h) => (
              <button key={h.ll_uuid} onClick={() => void loadParcel(h.ll_uuid)} style={rowBtn}>
                <span style={{ color: '#93c5fd' }}>{h.parcelnumb || '(no number)'}</span>
                <span style={{ opacity: 0.7 }}>{h.owner || ''}</span>
                <span style={{ opacity: 0.5 }}>{h.acres ? `${Number(h.acres).toFixed(1)} ac` : ''}</span>
              </button>
            ))}
          </div>
        )}

        {busy && <div style={hint}><Loader2 size={12} className="animate-spin" /> {busy}</div>}
        {error && <div style={{ ...hint, color: '#fca5a5' }}>{error}</div>}
        {savedMsg && <div style={{ ...hint, color: '#86efac' }}>{savedMsg}</div>}

        {!detail && !busy && (
          <div style={hint}>Click a parcel on the map, or search for one, to start.</div>
        )}

        {detail && (
          <>
            <div style={card}>
              <div style={{ fontWeight: 600 }}>{detail.parcel?.owner || 'Parcel'}</div>
              <div style={{ opacity: 0.65 }}>
                {detail.parcel?.parcelnumb} · {detail.parcel?.county} County {detail.parcel?.state}
              </div>
              <div style={{ marginTop: 6 }}>{parcelAcres.toFixed(1)} acres</div>
              {detail.parcel?.acreage_mismatch && (
                <div style={{ ...hint, color: '#fcd34d' }}>
                  Deed acreage ({detail.parcel.acres_of_record}) differs from the mapped shape.
                </div>
              )}
              <div style={{ ...hint }}>
                {detail.source === 'engine'
                  ? 'Ground Goat AI boundaries — adjust as needed.'
                  : 'No AI boundaries here yet — draw your own.'}
              </div>
            </div>

            {/* Land type chips — pick the type for the NEXT polygon, or
                retype the selected one. */}
            <div>
              <div style={sectionLabel}>Land type</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {LAND_CLASSES.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setDrawClass(c)
                      if (selectedId) setClassOf(selectedId, c)
                    }}
                    style={{
                      ...chip,
                      borderColor: drawClass === c ? CLASS_COLOR[c] : 'rgba(255,255,255,0.15)',
                      background: drawClass === c ? 'rgba(255,255,255,0.10)' : 'transparent',
                    }}
                  >
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: CLASS_COLOR[c] }} />
                    {CLASS_LABEL[c]}
                  </button>
                ))}
              </div>
            </div>

            {/* Tools — drawing, then edit state, then commit. */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button
                onClick={() => {
                  if (drawing && tool !== 'split') { finishDraft(); return }
                  setTool('draw'); setDrawing(true); setDraft([])
                }}
                style={{ ...btn, borderColor: drawing && tool !== 'split' ? CLASS_COLOR[drawClass] : undefined }}>
                <Plus size={13} /> {drawing && tool !== 'split' ? 'Finish shape' : 'Add polygon'}
              </button>
              <button onClick={() => selectedId && deleteShape(selectedId)} disabled={!selectedId} style={btn}>
                <Trash2 size={13} /> Delete
              </button>
              <button
                onClick={() => {
                  if (tool === 'split' && draft.length >= 2) { finishDraft(); return }
                  const on = tool !== 'split'
                  setTool(on ? 'split' : null); setDrawing(on); setDraft([]); setPieces([])
                }}
                style={{ ...btn, borderColor: tool === 'split' ? '#ffffff' : undefined }}>
                <Scissors size={13} />
                {tool !== 'split' ? 'Split' : draft.length >= 2 ? 'Make the cut' : 'Click two points'}
              </button>
              <button
                onClick={() => setTool(tool === 'combine' ? null : 'combine')}
                style={{ ...btn, borderColor: tool === 'combine' ? '#ffffff' : undefined }}>
                <Combine size={13} /> {tool === 'combine' ? 'Pick a parcel…' : 'Combine'}
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button onClick={undo} disabled={!undoRef.current.length} style={btn}>
                <RotateCcw size={13} /> Undo last edit
              </button>
              <button onClick={redo} disabled={!redoRef.current.length} style={btn}>
                <RotateCw size={13} /> Redo
              </button>
              <button onClick={clearAll} disabled={!shapes.length} style={btn}>
                <X size={13} /> Clear polygons
              </button>
              <button onClick={resetToEngine} disabled={!detail.polygons.length} style={btn}>
                <Layers size={13} /> Start over
              </button>
            </div>
            {drawing && tool !== 'split' && (
              <div style={hint}>Click to place corners. Enter or double-click closes the shape; Esc cancels.</div>
            )}
            {tool === 'split' && (
              <div style={hint}>Click once on each side of the boundary to lay the cut line, then Enter.</div>
            )}
            {tool === 'combine' && (
              <div style={hint}>Click another parcel to fold it into this one.</div>
            )}

            {pieces.length > 0 && (
              <div style={card}>
                <div style={sectionLabel}>Split into {pieces.length} tracts</div>
                {pieces.map((pc, i) => (
                  <div key={i} style={statRow}>
                    <span>Tract {i + 1}</span><span>{pc.acres.toFixed(1)} ac</span>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <button onClick={() => void savePieces()} disabled={!!busy}
                          style={{ ...btn, borderColor: '#22c55e', color: '#86efac' }}>
                    <Save size={13} /> Save all as tracts
                  </button>
                  <button onClick={() => setPieces([])} style={btn}>Discard</button>
                </div>
              </div>
            )}

            {/* Acreage */}
            <div style={card}>
              <div style={sectionLabel}>Legend &amp; acres</div>
              {LAND_CLASSES.map((c) => (
                <div key={c} style={statRow}>
                  <span><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 2, background: CLASS_COLOR[c], marginRight: 6 }} />{CLASS_LABEL[c]}</span>
                  <span>{totals[c].toFixed(1)}</span>
                </div>
              ))}
              <div style={{ ...statRow, opacity: 0.6 }}>
                <span>Other / Unclassified</span>
                <span>{Math.max(parcelAcres - classified, 0).toFixed(1)}</span>
              </div>
              <div style={{ ...statRow, fontWeight: 600, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6 }}>
                <span>Total</span><span>{parcelAcres.toFixed(1)}</span>
              </div>
              <div style={statRow}>
                <span style={{ opacity: 0.65 }}>Buildings</span>
                <span>{detail.parcel?.ll_bldg_count ?? 0}</span>
              </div>
              <div style={hint}>Live estimate — final acres are computed when you save.</div>
            </div>

            {/* Name + save */}
            <div style={card}>
              <div style={sectionLabel}>Reports</div>
              {!editingId && (
                <div style={hint}>Save this parcel first, then build reports from it.</div>
              )}
              {editingId && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {REPORT_KINDS.map((k) => (
                    <button key={k} onClick={() => void makeReport(k)} style={btn}>
                      <FileText size={13} /> {REPORT_LABEL[k]}
                    </button>
                  ))}
                </div>
              )}
              {reports.map((r) => (
                <div key={r.id} style={statRow}>
                  <span style={{ opacity: 0.8 }}>{REPORT_LABEL[r.kind] || r.kind}</span>
                  {r.status === 'done' ? (
                    <button
                      onClick={() => void downloadReport(
                        r.id, `${name || 'parcel'} ${REPORT_LABEL[r.kind] || r.kind}.pdf`)}
                      style={{ ...btn, padding: '2px 8px', fontSize: 11 }}>
                      <Download size={11} /> Download
                    </button>
                  ) : (
                    <span style={{ fontSize: 11, opacity: 0.6,
                                   color: r.status === 'failed' ? '#fca5a5' : undefined }}>
                      {r.status === 'failed' ? (r.error || 'failed') : 'building…'}
                    </span>
                  )}
                </div>
              ))}
            </div>

            <div>
              <div style={sectionLabel}>Project</div>
              <input value={projectName} onChange={(e) => setProjectName(e.target.value)}
                     placeholder={projectId ? 'Saving into the open project' : 'e.g. Smith Estate Auction (optional)'}
                     disabled={!!projectId}
                     style={{ ...inputStyle, opacity: projectId ? 0.55 : 1, marginBottom: 10 }} />
              <div style={sectionLabel}>Parcel name</div>
              <input value={name} onChange={(e) => setName(e.target.value)}
                     placeholder="e.g. Tract 1 — Home Place" style={inputStyle} />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={() => void doSave()} disabled={!!busy || !name.trim()}
                        style={{ ...btn, flex: 1, justifyContent: 'center',
                                 borderColor: '#22c55e', color: '#86efac' }}>
                  <Save size={13} /> {editingId ? 'Update' : 'Save'}
                </button>
                <button onClick={() => void cancelEdits()} disabled={!!busy}
                        style={{ ...btn, flex: 1, justifyContent: 'center' }}>
                  <X size={13} /> Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 7, padding: '7px 9px', color: '#e5e7eb', fontSize: 13, outline: 'none',
}
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.15)', borderRadius: 7, padding: '6px 10px',
  color: '#e5e7eb', fontSize: 12, cursor: 'pointer',
}
const chip: React.CSSProperties = { ...btn, padding: '5px 9px' }
const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 9, padding: 10, display: 'flex', flexDirection: 'column', gap: 3,
}
const hint: React.CSSProperties = { fontSize: 11, opacity: 0.6, marginTop: 5, display: 'flex', gap: 5, alignItems: 'center' }
const sectionLabel: React.CSSProperties = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, opacity: 0.5, marginBottom: 5,
}
const statRow: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', padding: '2px 0' }
const rowBtn: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
  color: '#e5e7eb', padding: '6px 2px', fontSize: 11, cursor: 'pointer',
}
