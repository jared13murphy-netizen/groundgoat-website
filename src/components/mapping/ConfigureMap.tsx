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
  Scissors, Combine, FileText, Download, BarChart3, Eraser, PenLine, PaintBucket, Check,
  ArrowRight,
} from 'lucide-react'
import {
  CLASS_COLOR, CLASS_LABEL, LAND_CLASSES, PARCEL_LINE, SEARCH_DOT, VERTEX_LINE,
  archiveParcel, classifyBoundary, combineGeometry, fetchParcel, getSavedParcel, saveParcel, searchMap,
  splitGeometry, normalizeGeometry, previewSoil,
  updateParcel, queueReport, listReports, downloadReport, getProject,
  REPORT_KINDS, REPORT_LABEL, REPORT_BUSY_LABEL, USES_ELEVATION, type ReportRow,
  deleteReport, projectGeometry, type ProjectTractGeometry, listCounties, renameParcel,
  createCma, getCma, listCmas, cmaCandidates, setCmaComps, queueCmaReport, updateCma,
  type Cma, type CompCandidate,
  type LandClass, type ParcelDetail, type ParcelSummary,
} from '@/lib/configurableMapping'
import { addRegridLayer, buildRegridStateFilter, fetchRegridConfig } from '@/components/map/regridLayer'
import { addPlaceLabels } from '@/components/map/placeLabels'
import {
  GLYPH_URL, MAP_CENTER, MAP_INITIAL_ZOOM, TILE_ATTRIBUTION, TILE_URL,
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
  dots: 'cm-dots', draft: 'cm-draft', comps: 'cm-comps',
  cut: 'cm-cut', marq: 'cm-marq',
  // The rest of the project, drawn around whatever is open.
  peerFill: 'cm-peer-shapes', peerLine: 'cm-peer-bounds', peerLabel: 'cm-peer-labels',
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

/** One editable shape per POLYGON PART.
 *
 *  The engine returns one geometry per land TYPE, so a class made of many
 *  separate pieces arrived as a single MultiPolygon. Clicking it selected
 *  every piece and Delete removed every piece — there was no way to act
 *  on one. Splitting the parts here makes each piece independently
 *  selectable and deletable. normalizeGeometry returns one row per input
 *  polygon in order, so the pieces survive editing. */
function explodeShapes(polys: { cls: LandClass; geometry: any }[]): Shape[] {
  const out: Shape[] = []
  for (const p of polys) {
    for (const part of geometryToPolys(p.geometry)) {
      if (part.length) out.push({ id: nextId(), cls: p.cls, polys: [part] })
    }
  }
  return out
}

/** Mean of a shape's outer ring — a cheap, stable fingerprint used to
 *  find a polygon again after normalising rebuilds it with a new id. */
/** The tract name. Reads as text until you pick up the pencil; then an
 *  x to abandon the change and a tick to keep it. One component so the
 *  gesture is identical everywhere a tract can be renamed (owner). */
function TractName({ value, onCommit, busy, placeholder }: {
  value: string
  onCommit: (next: string) => void
  busy?: boolean
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  // Someone else may have changed it — a save, a reload, another tract
  // opened. While editing, the draft is the user's and is left alone.
  useEffect(() => { if (!editing) setDraft(value) }, [value, editing])

  const commit = () => {
    const n = draft.trim()
    if (!n) return
    setEditing(false)
    if (n !== value) onCommit(n)
  }
  const cancel = () => { setDraft(value); setEditing(false) }

  if (!editing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden',
                       textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                       opacity: value ? 1 : 0.5 }}>
          {value || placeholder || 'Unnamed tract'}
        </span>
        <button onClick={() => setEditing(true)} disabled={busy}
                title="Rename this tract" aria-label="Rename this tract"
                style={{ ...btn, flex: 'none', padding: '4px 7px' }}>
          <PenLine size={13} />
        </button>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        autoFocus value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
        placeholder={placeholder || 'e.g. Tract 1, Home Place, North 80'}
        style={inputStyle} />
      <button onClick={cancel} title="Cancel" aria-label="Cancel rename"
              style={{ ...btn, flex: 'none', padding: '4px 7px' }}>
        <X size={13} />
      </button>
      <button onClick={commit} disabled={busy || !draft.trim()}
              title="Save this name" aria-label="Save this name"
              style={{ ...primaryBtn, flex: 'none', padding: '4px 7px' }}>
        <Check size={13} />
      </button>
    </div>
  )
}

/** Ray cast. Rings here are open — first point is not repeated. */
function pointInRing(pt: Pt, ring: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if ((yi > pt[1]) !== (yj > pt[1])
        && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Keeps the outer ring, throws away holes that are no longer a shape.
 *  A hole emptied by removing its points must actually disappear. */
function dropDegenerateHoles(rings: Pt[][]): Pt[][] {
  return rings.filter((ring, i) => i === 0 || ring.length >= 3)
}

function ringCentre(polys: Pt[][][]): Pt | null {
  const ring = polys[0]?.[0]
  if (!ring || !ring.length) return null
  let x = 0, y = 0
  for (const [a, b] of ring) { x += a; y += b }
  return [x / ring.length, y / ring.length]
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
  // Owner's model: outline the parcel FIRST and confirm it, and only then
  // do the land-type polygons appear inside it.
  const [step, setStep] = useState<'boundary' | 'landtypes'>('boundary')
  // The parcel outline while it is still editable. Rings, like a shape.
  const [boundaryRings, setBoundaryRings] = useState<Pt[][][]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawClass, setDrawClass] = useState<LandClass>('tillable')
  const [drawing, setDrawing] = useState(false)
  // 'draw' adds a classified polygon; 'cutpoly' takes the two clicks
  // that cut something in half — the parcel in step 1, the selected land
  // type in step 2;
  // 'combine' adds the next clicked parcel to this boundary.
  const [tool, setTool] = useState<'draw' | 'cutpoly' | 'erase' | 'combine' | null>(null)
  // The two clicks that cut the SELECTED polygon in half.
  const [cutPts, setCutPts] = useState<Pt[]>([])
  // Rubber-band box for erasing many points at once.
  const [marq, setMarq] = useState<[Pt, Pt] | null>(null)
  // After a save the parcel is finished, so the editing tools come down
  // until the user asks for them again.
  const [editingTypes, setEditingTypes] = useState(true)
  // Which report kind is being queued right now. The spinner then hands
  // over to the row's own queued/running status, so the button keeps
  // spinning until the file is actually built rather than stopping the
  // moment the request returns.
  const [queuing, setQueuing] = useState<string | null>(null)
  // Cancel throws away work, so it asks first.
  // Both of these throw away work, so both ask first.
  const [confirmWhat, setConfirmWhat] = useState<null | 'cancel' | 'outline' | 'switch'>(null)
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
  const [deletingReport, setDeletingReport] = useState<string | null>(null)
  const [peers, setPeers] = useState<ProjectTractGeometry[]>([])
  // Soil rating recomputed as the tillable ground is reshaped. Debounced —
  // it is a real query against SSURGO, not arithmetic in the browser.
  const [soil, setSoil] = useState<{ rating: number | null; rating_type: string | null } | null>(null)
  const [soilBusy, setSoilBusy] = useState(false)
  // How dramatic the terrain reads on the 3D and topography maps.
  // 1 is true scale. Stored with the report so a regenerated PDF
  // reproduces exactly what was on screen when it was ordered.
  const [exaggeration, setExaggeration] = useState(2.5)
  // Market analysis. `cmaSubject` is the subject whose comparables the
  // + / - pins on the map are currently choosing.
  const [cma, setCma] = useState<Cma | null>(null)
  const [cmaSubject, setCmaSubject] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<CompCandidate[]>([])
  // Split results waiting to be named and saved as separate tracts.
  const [pieces, setPieces] = useState<{ geometry: any; acres: number }[]>([])
  const [query, setQuery] = useState('')
  const [searchState, setSearchState] = useState('')
  // 1 = the fills as designed, 0 = outlines only over bare imagery.
  const [fillOpacity, setFillOpacity] = useState(1)
  const [savedName, setSavedName] = useState('')
  const [searchCounty, setSearchCounty] = useState('')
  const [counties, setCounties] = useState<string[]>([])
  const [hits, setHits] = useState<ParcelSummary[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  // Refs mirror state for use inside map event handlers, which close
  // over their first render otherwise.
  const shapesRef = useRef(shapes); shapesRef.current = shapes
  /** What the tract looked like when it was loaded or last saved.
   *  Cancel confirms only when there is something to lose — a
   *  "discard your changes?" over an untouched tract is noise. */
  const cleanRef = useRef<string>('')
  const markCleanRef = useRef<((sh: Shape[], b: Pt[][][]) => void) | null>(null)
  const [dirty, setDirty] = useState(false)
  const dirtyRef = useRef(false)
  /** A tract the user asked to switch to while holding unsaved work. */
  const [pendingOpen, setPendingOpen] = useState<string | null>(null)
  const requestOpenRef = useRef<((id: string) => void) | null>(null)
  // Read by map handlers that are registered once, on load, and so can
  // never close over current state.
  const peersRef = useRef<ProjectTractGeometry[]>([])
  const placeLabelsRaised = useRef(new Set<string>()).current
  const raisePlaceLabelsRef = useRef<(() => void) | null>(null)
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId
  const drawingRef = useRef(drawing); drawingRef.current = drawing
  const toolRef = useRef(tool); toolRef.current = tool
  const stepRef = useRef(step); stepRef.current = step
  const boundaryRef = useRef(boundaryRings); boundaryRef.current = boundaryRings
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
      // Step 1 is the OUTLINE. Interior polygons stay hidden until the
      // boundary is confirmed, so there is one thing to work on at a time.
      setStep('boundary')
      const rings = geometryToPolys(d.boundary)
      setBoundaryRings(rings)
      setShapes([])
      markCleanRef.current?.([], rings)
      setSelectedId(null)
      setName(d.parcel?.parcelnumb ? `Parcel ${d.parcel.parcelnumb}` : ''); setSavedName('')
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
    // 'Add tract' passes new=1: stay on a blank canvas inside this
    // project instead of reopening the tract that is already there.
    if (!saved && proj && params.get('new') === '1') return
    if (!saved && proj) {
      // 'Open' on a project: show its first tract rather than an empty
      // map. With no tracts yet this stays a blank canvas, which is what
      // 'Add tract' wants.
      let stop = false
      ;(async () => {
        try {
          const r = await getProject(proj)
          if (stop) return
          if (r.project?.name) setProjectName(r.project.name)
          if (!r.parcels?.length) return
          const url = new URL(window.location.href)
          url.searchParams.set('parcel', r.parcels[0].id)
          window.location.replace(url.toString())
        } catch { /* leave the blank canvas */ }
      })()
      return () => { stop = true }
    }
    if (!saved) return
    void openSavedTractRef.current?.(saved)
  }, [ready])

  /** Open a saved tract into the editor. Extracted from the ?parcel=
   *  boot path so clicking another tract on the map can reuse it. */
  const openSavedTract = useCallback(async (saved: string) => {
    let cancelled = false
    await (async () => {
      setBusy('Opening saved parcel…')
      try {
        const rec = await getSavedParcel(saved)
        if (cancelled) return
        setEditingId(rec.id)
        setProjectId(rec.project_id)
        setName(rec.name); setSavedName(rec.name)
        if (rec.project_id) {
          getProject(rec.project_id)
            .then((r) => { if (!cancelled && r.project?.name) setProjectName(r.project.name) })
            .catch(() => { /* the name is a label, not load-bearing */ })
        }
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
        const loadedShapes = explodeShapes(rec.polygons as any)
        setShapes(loadedShapes)
        markCleanRef.current?.(loadedShapes, geometryToPolys(rec.boundary))
        // Opened from the portfolio to LOOK at, not to edit: show the
        // land types straight away and keep the editing tools away until
        // the user asks for them.
        setStep('landtypes')
        setEditingTypes(false)
        setSelectedId(null)
        const bb = bboxOf(rec.boundary?.coordinates)
        if (bb && mapRef.current) mapRef.current.fitBounds(bb, { padding: 90, duration: 700 })
      } catch (e: any) {
        setError(e?.message || 'Could not open that saved parcel.')
      } finally { setBusy(null) }
    })()
  }, [])
  const openSavedTractRef = useRef(openSavedTract); openSavedTractRef.current = openSavedTract

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
        },
        // Place names come from addPlaceLabels (the Explore map's own
        // vector styling), not the basemap's raster label tiles — those
        // were blurry, unstyled, and could not be matched to the rest of
        // the product. State silhouettes are deliberately absent.
        layers: [
          { id: 'sat', type: 'raster', source: 'sat' },
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

    // ResizeObserver alone is not enough. If the container measures 0×0
    // at construction, MapLibre falls back to its 400×300 default, and
    // any environment that does not deliver the observer's initial
    // observation leaves the map stuck at that size on a full-screen
    // container — a broken-looking map that only fixes itself if the
    // user happens to resize the window. Measuring again on the next
    // frame and on load costs nothing and does not depend on RO.
    // Right-click is a map gesture here (remove a boundary handle), so
    // the browser's context menu must not open on top of it.
    const stopMenu = (ev: Event) => ev.preventDefault()
    map.getCanvas().addEventListener('contextmenu', stopMenu)

    const removePlaceLabelsRef = { current: null as null | (() => void) }

    const raf = requestAnimationFrame(() => map.resize())
    map.once('load', () => map.resize())

    // Belt and braces for the case that actually bites: the container
    // measures 0x0 when the map is built and only gains size later,
    // WITHOUT a window resize and without the observer's first callback
    // being delivered. The map then sits at MapLibre's 400x300 default
    // forever. Re-measure for a couple of seconds, stop as soon as the
    // canvas matches, and always stop — this must never become a loop.
    // The window has to outlast a COLD full page load. At 2 s this gave
    // up while the canvas was still 0-sized, and a 0-sized canvas never
    // finishes loading the style -- so the map sat blank forever, with
    // no layers, and clicking a parcel did nothing. Opening the screen
    // by navigating within the app was fast enough to hide it; opening
    // the URL directly was not.
    //
    // It still STOPS: as soon as the canvas matches a container that has
    // real size, and unconditionally at the cap. This must never become
    // an unbounded loop -- an effect that never settles is what put 4.3
    // GB in the owner's browser.
    let tries = 0
    let sizeTimer: number | undefined
    const syncSize = () => {
      sizeTimer = undefined
      const el = containerRef.current
      if (!el || mapRef.current !== map) return
      const r = el.getBoundingClientRect()
      const c = map.getCanvas()
      const off = Math.abs(c.clientWidth - Math.round(r.width)) > 1
        || Math.abs(c.clientHeight - Math.round(r.height)) > 1
      if (r.width > 0 && off) map.resize()
      const settled = r.width > 0 && r.height > 0 && !off
        && c.clientWidth > 0 && c.clientHeight > 0
      if (!settled && ++tries < 100) sizeTimer = window.setTimeout(syncSize, 100)
    }
    sizeTimer = window.setTimeout(syncSize, 50)

    map.on('load', async () => {
      for (const id of Object.values(SRC)) {
        map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any })
      }

      // Outlines and labels go on before the parcel layer, so parcels
      // and their labels sit above the place names.
      removePlaceLabelsRef.current = addPlaceLabels(map)

      const cfg = await fetchRegridConfig()
      if (cfg) {
        addRegridLayer(map, cfg, { minZoom: 11, labelMinZoom: 14, interactive: false })
        const f = buildRegridStateFilter(cfg)
        if (f) for (const l of ['regrid-parcels-fill', 'regrid-parcels-line', 'regrid-parcels-label']) {
          if (map.getLayer(l)) map.setFilter(l, f)
        }
      }

      // Town, county and state names belong ABOVE the parcel grid: a
      // place name half-crossed by a parcel line is unreadable. Only the
      // LABEL layers are raised — the county/state borders stay under
      // the grid, which is what put them below in the first place.
      //
      // Anchored before the first Configure Map layer rather than moved
      // to the very top, so a town name can never cover a tract badge.
      // The town layer arrives from a fetch AFTER load, so this has to
      // run again when it shows up; `raised` stops it looping, because
      // moveLayer itself fires styledata.
      const raisePlaceLabels = () => {
        for (const l of ['pl-state-labels', 'pl-county-labels', 'pl-town-labels']) {
          if (placeLabelsRaised.has(l) || !map.getLayer(l)) continue
          if (map.getLayer('cm-peer-shapes-fill')) map.moveLayer(l, 'cm-peer-shapes-fill')
          else map.moveLayer(l)
          placeLabelsRaised.add(l)
        }
      }
      raisePlaceLabelsRef.current = raisePlaceLabels
      map.on('styledata', raisePlaceLabels)

      // ── the rest of the project ──────────────────────────────────
      // Every OTHER tract in this project, drawn underneath whatever is
      // open so you can see what you already have and do not add the
      // same ground twice. Deliberately muted: this is context, not the
      // thing being edited, and it must never be mistaken for it.
      map.addLayer({
        id: 'cm-peer-shapes-fill', type: 'fill', source: SRC.peerFill,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.16 },
      })
      map.addLayer({
        id: 'cm-peer-shapes-line', type: 'line', source: SRC.peerFill,
        paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': 0.7 },
      })
      map.addLayer({
        id: 'cm-peer-bounds-line', type: 'line', source: SRC.peerLine,
        paint: {
          'line-color': '#ffffff', 'line-width': 2,
          'line-opacity': 0.75, 'line-dasharray': [3, 2],
        },
      })

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
      // A light pink wash inside the outline so the parcel reads as one
      // object at a glance. Deliberately faint — the imagery underneath
      // is what the user is judging the boundary against, and anything
      // heavier hides it (the same mistake the topography report made).
      // Added BEFORE the line so the stroke stays crisp on top.
      map.addLayer({
        id: 'cm-boundary-fill', type: 'fill', source: SRC.boundary,
        paint: { 'fill-color': '#f58cde', 'fill-opacity': 0.22 },
      })
      map.addLayer({
        id: 'cm-boundary-line', type: 'line', source: SRC.boundary,
        paint: { 'line-color': PARCEL_LINE, 'line-width': 4 },
      })
      map.addLayer({
        id: 'cm-draft-line', type: 'line', source: SRC.draft,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [2, 1.5] },
      })
      // A dot per click. Without these you cannot see where your corners
      // landed, which made both drawing and splitting guesswork.
      // A white disc with a scissors glyph, drawn on a canvas so it does
      // not depend on the glyph server carrying U+2702 in its font stack.
      if (!map.hasImage('cm-scissors')) {
        const S = 44
        const cv = document.createElement('canvas'); cv.width = S; cv.height = S
        const g = cv.getContext('2d')!
        g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2)
        g.fillStyle = '#ffffff'; g.fill()
        g.lineWidth = 3; g.strokeStyle = '#111827'; g.stroke()
        g.fillStyle = '#111827'
        g.font = '22px system-ui, "Apple Color Emoji", sans-serif'
        g.textAlign = 'center'; g.textBaseline = 'middle'
        g.fillText('\u2702', S / 2, S / 2 + 1)
        map.addImage('cm-scissors', g.getImageData(0, 0, S, S) as any, { pixelRatio: 2 })
      }
      // The tract-name badge. A 9-slice pill: the middle stretches to
      // whatever the name needs, the rounded ends do not, so one image
      // serves "North 80" and "Hamilton test tract" alike.
      if (!map.hasImage('cm-badge')) {
        const W = 48, H = 36, R = 12
        const cv = document.createElement('canvas'); cv.width = W; cv.height = H
        const g = cv.getContext('2d')!
        const pill = () => {
          g.beginPath()
          g.moveTo(R + 1, 2)
          g.lineTo(W - R - 1, 2)
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
        map.addImage('cm-badge', g.getImageData(0, 0, W, H) as any, {
          pixelRatio: 2,
          stretchX: [[R + 2, W - R - 2]],
          stretchY: [[R + 2, H - R - 2]],
          content: [R - 2, 5, W - R + 2, H - 5],
        })
      }
      map.addLayer({
        id: 'cm-marq-fill', type: 'fill', source: SRC.marq,
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.12 },
      })
      map.addLayer({
        id: 'cm-marq-line', type: 'line', source: SRC.marq,
        paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      })
      map.addLayer({
        id: 'cm-cut-line', type: 'line', source: SRC.cut,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [1.5, 1.5] },
      })
      map.addLayer({
        id: 'cm-cut-marks', type: 'symbol', source: SRC.cut,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: { 'icon-image': 'cm-scissors', 'icon-size': 0.6,
                  'icon-allow-overlap': true, 'icon-ignore-placement': true },
      })
      map.addLayer({
        id: 'cm-draft-dots', type: 'circle', source: SRC.draft,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ffffff',
          'circle-stroke-color': VERTEX_LINE,
          'circle-stroke-width': 2,
        },
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
      // Comparable sales: a pin per sale, showing + to add and - to drop,
      // the same read as the Find Comparables screen.
      map.addLayer({
        id: 'cm-comps-circles', type: 'circle', source: SRC.comps,
        paint: {
          'circle-radius': 11,
          'circle-color': ['case', ['boolean', ['get', 'selected'], false], '#f58cde', '#111827'],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: 'cm-comps-label', type: 'symbol', source: SRC.comps,
        layout: {
          'text-field': ['case', ['boolean', ['get', 'selected'], false], '−', '+'],
          'text-size': 15, 'text-allow-overlap': true,
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#ffffff' },
      })
      map.addLayer({
        id: 'cm-dots-circles', type: 'circle', source: SRC.dots,
        paint: {
          'circle-radius': 6, 'circle-color': SEARCH_DOT,
          'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
        },
      })

      // Tract names, last so they sit above every polygon. Placed on a
      // point INSIDE each tract (PostGIS gives us point-on-surface, not
      // a centroid, so an L-shaped tract's badge does not float over the
      // neighbour's ground).
      map.addLayer({
        id: 'cm-peer-label', type: 'symbol', source: SRC.peerLabel,
        layout: {
          'icon-image': 'cm-badge',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [2, 7, 2, 7],
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': 12,
          'text-max-width': 12,
          'symbol-z-order': 'source',
        },
        paint: { 'text-color': '#ffffff' },
      })

      // ── erase box: drag a rectangle over a cluster of points and
      //    every point inside it is removed on release. Shift-clicking
      //    dots one at a time was unusable where a driveway had dozens.
      let box: Pt | null = null
      map.on('mousedown', (e) => {
        if (toolRef.current !== 'erase') return
        e.preventDefault()
        box = [e.lngLat.lng, e.lngLat.lat]
        setMarq([box, box])
        map.dragPan.disable()
      })
      map.on('mousemove', (e) => {
        if (!box) return
        setMarq([box, [e.lngLat.lng, e.lngLat.lat]])
      })
      const endBox = () => {
        if (!box) return
        const b = marqRef.current
        box = null
        map.dragPan.enable()
        setMarq(null)
        if (b) eraseInBoxRef.current(b)
      }
      map.on('mouseup', endBox)

      // ── vertex dragging ───────────────────────────────────────────
      let drag: { id: string; pi: number; ri: number; vi: number } | null = null
      let took = false
      map.on('mousedown', LYR_VERTS, (e) => {
        // Belt and braces with the layer being empty in view mode.
        if (stepRef.current !== 'boundary' && !editingTypesRef.current) return
        const f = e.features?.[0]
        if (!f) return
        e.preventDefault()
        const owner = String(f.properties!.shapeId)

        // Remove a boundary handle: right button, or Alt/Option-click.
        // Handled on MOUSEDOWN rather than a 'contextmenu' listener —
        // that fired inconsistently and the browser's own menu often
        // won the event instead (the canvas listener below suppresses
        // that menu). Alt-click is the fallback for anyone whose mouse
        // or trackpad makes right-click awkward.
        const oe = e.originalEvent as MouseEvent
        if (owner === '__boundary__' && stepRef.current === 'boundary'
            && (oe.button === 2 || oe.altKey)) {
          const pi = Number(f.properties!.pi)
          const ri = Number(f.properties!.ri)
          const vi = Number(f.properties!.vi)
          setBoundaryRings((prev) => prev.map((rings, p2) => p2 !== pi ? rings
            : dropDegenerateHoles(rings.map((ring, i) => {
              if (i !== ri) return ring
              // Ring 0 is the outline itself and must stay a polygon.
              // Rings 1+ are HOLES: taking a hole below three points
              // means the user is trying to get rid of it, so let it
              // go rather than leaving a vestigial triangle behind.
              if (ring.length <= 3) return ri === 0 ? ring : []
              return ring.filter((_, v) => v !== vi)
            }))))
          return
        }

        // Same gesture on a land-type point. This only ever worked on the
        // boundary, which is why removing a point inside a polygon looked
        // broken.
        if (owner !== '__boundary__' && (oe.button === 2 || oe.altKey)) {
          const pi = Number(f.properties!.pi)
          const ri = Number(f.properties!.ri)
          const vi = Number(f.properties!.vi)
          mutate((prev) => prev.map((sh) => sh.id !== owner ? sh : {
            ...sh,
            polys: sh.polys.map((rings, p2) => p2 !== pi ? rings
              : dropDegenerateHoles(rings.map((ring, i) => {
                if (i !== ri) return ring
                // Same rule inside a land-type polygon. This is why a
                // hole could be whittled down but never actually
                // removed — it stuck at a three-dot triangle.
                if (ring.length <= 3) return ri === 0 ? ring : []
                return ring.filter((_, v) => v !== vi)
              }))),
          }))
          return
        }

        if (owner !== '__boundary__' && owner !== selectedRef.current) setSelectedId(owner)
        drag = { id: owner, pi: f.properties!.pi, ri: f.properties!.ri, vi: f.properties!.vi }
        took = false
        map.dragPan.disable()
      })
      map.on('mousemove', (e) => {
        if (!drag) return
        // One undo snapshot per drag, not per mousemove.
        const { id, pi, ri, vi } = drag
        if (id === '__boundary__') {
          setBoundaryRings((prev) => prev.map((rings, p2) => p2 !== pi ? rings
            : rings.map((r, i) => i !== ri ? r
              : r.map((pt, v) => v === vi ? [e.lngLat.lng, e.lngLat.lat] as Pt : pt))))
          return
        }
        if (!took) { snapshot(shapesRef.current); took = true }
        setShapes((prev) => prev.map((s) => {
          if (s.id !== id) return s
          const polys = s.polys.map((rings, p) => p !== pi ? rings : rings.map((r, i) =>
            i !== ri ? r : r.map((pt, v) => v === vi ? [e.lngLat.lng, e.lngLat.lat] as Pt : pt)))
          return { ...s, polys }
        }))
      })
      // Dragging a handle rewrites `shapes` directly, so nothing was
      // re-checking overlap: enforceNoOverlap only ran from finishDraft,
      // i.e. when a NEW shape was drawn. That let an edited polygon be
      // dragged straight over its neighbour. Re-run the check when the
      // drag ENDS -- not on mousemove, which would fire a round trip per
      // frame. Boundary drags are excluded: step 1 is the outline, and
      // the land types are not on screen yet.
      const endDrag = () => {
        if (!drag) return
        const wasShape = drag.id !== '__boundary__'
        const draggedId = drag.id
        drag = null
        map.dragPan.enable()
        if (wasShape) void enforceNoOverlapRef.current(shapesRef.current, draggedId)
      }
      map.on('mouseup', endDrag)
      map.on('mouseout', endDrag)
      map.on('mouseenter', LYR_VERTS, () => { map.getCanvas().style.cursor = 'move' })
      map.on('mouseleave', LYR_VERTS, () => { map.getCanvas().style.cursor = '' })

      // ── boundary: add a dot on the line, remove one from a dot ─────
      // Click the outline itself to drop a new handle where you clicked;
      // right-click a handle to take it out. Both refuse to leave fewer
      // than three points, which would stop being a polygon.
      map.on('click', 'cm-boundary-line', (e) => {
        if (stepRef.current !== 'boundary') return
        e.preventDefault()
        const pt = [e.lngLat.lng, e.lngLat.lat] as Pt
        setBoundaryRings((prev) => {
          if (!prev.length) return prev
          // Insert into whichever ring's edge is nearest the click.
          let best = { pi: 0, ri: 0, seg: 0, d: Infinity }
          prev.forEach((rings, pi) => rings.forEach((ring, ri) => {
            if (ring.length < 2) return
            const seg = nearestSegmentIndex(map, ring, e.point)
            const a = map.project(ring[seg] as [number, number])
            const b = map.project(ring[(seg + 1) % ring.length] as [number, number])
            const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
            const d = Math.hypot(mid.x - e.point.x, mid.y - e.point.y)
            if (d < best.d) best = { pi, ri, seg, d }
          }))
          return prev.map((rings, pi) => pi !== best.pi ? rings
            : rings.map((ring, ri) => ri !== best.ri ? ring
              : [...ring.slice(0, best.seg + 1), pt, ...ring.slice(best.seg + 1)]))
        })
      })
      map.on('mouseenter', 'cm-boundary-line', () => {
        if (stepRef.current === 'boundary') map.getCanvas().style.cursor = 'copy'
      })
      map.on('mouseleave', 'cm-boundary-line', () => { map.getCanvas().style.cursor = '' })

      // ── clicks: draw a point, select a shape, or pick a parcel ─────
      map.on('click', 'cm-comps-circles', (e) => {
        const f = e.features?.[0]
        if (!f) return
        e.preventDefault()
        toggleCompRef.current(String(f.properties!.id))
      })

      // Zoomed out, the badge is often the only part of a tract big
      // enough to hit. Clicking it frames that tract.
      map.on('click', 'cm-peer-label', (e) => {
        const f = e.features?.[0]
        if (!f) return
        e.preventDefault()
        const id = f.properties?.tractId ? String(f.properties.tractId) : null
        const t = id ? peersRef.current.find((x) => x.id === id) : null
        const bb = t?.boundary ? bboxOf(t.boundary.coordinates) : null
        // Frame it either way, then open it. Opening fits the bounds
        // itself, so the zoom the badge already gave you is kept.
        if (bb) map.fitBounds(bb, { padding: 80, maxZoom: 16, duration: 800 })
        else if (f.geometry.type === 'Point') {
          map.flyTo({ center: (f.geometry as any).coordinates, zoom: 15, duration: 800 })
        }
        if (id) requestOpenRef.current?.(id)
      })
      map.on('mouseenter', 'cm-peer-label', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'cm-peer-label', () => { map.getCanvas().style.cursor = '' })
      map.on('mouseenter', 'cm-comps-circles', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'cm-comps-circles', () => { map.getCanvas().style.cursor = '' })

      map.on('click', (e) => {
        if (map.queryRenderedFeatures(e.point, {
          layers: ['cm-comps-circles', 'cm-peer-label'].filter((l) => map.getLayer(l)),
        }).length) return
        // A click on the outline during step 1 means "add a handle here"
        // and is handled by the layer listener above; letting it fall
        // through would also try to select a parcel underneath.
        if (stepRef.current === 'boundary'
            && map.queryRenderedFeatures(e.point, { layers: ['cm-boundary-line'] }).length) return
        // Cutting the selected polygon: two clicks, one either side, and
        // the second one performs the cut immediately.
        if (toolRef.current === 'cutpoly') {
          const pt = [e.lngLat.lng, e.lngLat.lat] as Pt
          setCutPts((prev) => {
            if (prev.length === 0) return [pt]
            void runCutRef.current([prev[0], pt])
            return []
          })
          return
        }
        if (drawingRef.current) {
          setDraft((d) => [...d, [e.lngLat.lng, e.lngLat.lat] as Pt])
          return
        }
        // Combine: the next parcel clicked is merged into this boundary.
        if (toolRef.current === 'combine') {
          const hit = map.queryRenderedFeatures(e.point, { layers: ['regrid-parcels-fill'] })
          // Same tile-schema point as the select handler below: `path`
          // is the id the tiles carry.
          const hp = hit[0]?.properties || {}
          const uu = hp.ll_uuid || hp.ll_uuid_text || hp.path
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
        // A parcel is already open: clicking the map must NOT load
        // another one, and must not reload this one. Reloading rebuilt
        // the outline from the database, so a stray click anywhere
        // silently threw away every dot the user had moved. Switching
        // parcels is deliberate — it goes through Cancel.
        if (detailRef.current) { setSelectedId(null); return }

        const onParcel = map.queryRenderedFeatures(e.point, { layers: ['regrid-parcels-fill'] })
        // `path` is what the tiles actually carry — ll_uuid is not in
        // the tile schema, so keying only off it made every parcel click
        // a no-op and the screen looked like it had no selection at all.
        const props = onParcel[0]?.properties || {}
        const pid = props.ll_uuid || props.ll_uuid_text || props.path
        if (pid) { void loadParcelRef.current(String(pid)) ; return }
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
      cancelAnimationFrame(raf)
      try { map.getCanvas().removeEventListener('contextmenu', stopMenu) } catch { /* gone */ }
      if (sizeTimer !== undefined) clearTimeout(sizeTimer)
      removePlaceLabelsRef.current?.()
      ro.disconnect()
      map.remove()
      // Only clear the ref if it still points at THIS map, so a
      // late cleanup cannot orphan a newer instance.
      raisePlaceLabelsRef.current = null
      placeLabelsRaised.clear()
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
    if (d.length >= 3) {
      const ring = simplifyRing(d, 0.000004)
      const id = nextId()
      mutate((prev) => {
        const next = [...prev, { id, cls: drawClassRef.current, polys: [[ring]] }]
        // Drawn last, so this one wins any overlap — then the server
        // trims the others and clips everything to the boundary.
        void enforceNoOverlapRef.current(next)
        return next
      })
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

  /** Step 1 -> step 2. Ask the ENGINE for the land types under the
   *  boundary the user actually confirmed.
   *
   *  This used to clip `detail.polygons` — whatever the parcel loaded
   *  with — to the new boundary. That can only ever remove ground, so
   *  enlarging a boundary left the new part blank, and it carried
   *  forward whatever the first read produced. Re-asking the engine is
   *  correct in both directions and is the same call the parcel click
   *  makes. */
  const confirmBoundary = useCallback(async () => {
    if (!detail) return
    const geom = polysToGeometry(boundaryRings)
    if (!geom) { setError('Draw a boundary before confirming it.'); return }
    setBusy('Fitting land types to the boundary…'); setError(null)
    try {
      const fresh = await classifyBoundary(geom, detail.parcel?.state)
      // Still normalise: the engine's classes are disjoint, but the user
      // may already have drawn shapes of their own over them.
      const res = await normalizeGeometry(
        geom, fresh.polygons.map((p) => ({ cls: p.cls, geometry: p.geometry })))
      setDetail({ ...detail, boundary: geom })
      if (!fresh.engine_covered) {
        setError('Part of this boundary is outside the mapped area — '
               + 'the land types there have not been filled in.')
      }
      const loaded = explodeShapes(res.polygons as any)
      setShapes(loaded)
      markCleanRef.current?.(loaded, boundaryRings)
      setEditingTypes(true)
      undoRef.current = []; redoRef.current = []
      // Select the biggest piece so drag handles are on screen at once.
      setSelectedId(loaded.length
        ? loaded.reduce((a, b) => (shapeAcres(b) > shapeAcres(a) ? b : a)).id
        : null)
      setStep('landtypes')
    } catch (e: any) {
      setError(e?.message || 'Could not fit the land types to that boundary.')
    } finally { setBusy(null) }
  }, [detail, boundaryRings])

  /** Enforce the owner's rule after every hand-drawn shape: polygons
   *  cannot overlap, and cannot leave the parcel. Later drawing wins. */
  const enforceNoOverlap = useCallback(async (next: Shape[], keepId?: string | null) => {
    if (!detail?.boundary) return
    // Normalising rebuilds every shape with a fresh id, so the selection
    // used to be dropped on the floor. After moving one handle that meant
    // re-clicking the polygon before you could move the next one. Keep a
    // fingerprint of the shape being edited and re-select its replacement.
    const keep = keepId ? next.find((sh) => sh.id === keepId) : undefined
    const mark = keep ? ringCentre(keep.polys) : null
    try {
      const res = await normalizeGeometry(detail.boundary, next
        .map((sh) => ({ cls: sh.cls, geometry: polysToGeometry(sh.polys) }))
        .filter((x) => x.geometry) as any)
      const rebuilt = explodeShapes(res.polygons as any)
      setShapes(rebuilt)
      let again: string | null = null
      if (keep && mark) {
        let best = Infinity
        for (const sh of rebuilt) {
          if (sh.cls !== keep.cls) continue
          const c = ringCentre(sh.polys)
          if (!c) continue
          const d = (c[0] - mark[0]) ** 2 + (c[1] - mark[1]) ** 2
          if (d < best) { best = d; again = sh.id }
        }
      }
      setSelectedId(again)
    } catch (e: any) {
      setError(e?.message || 'Could not fit that shape to the others.')
    }
  }, [detail])

  // ── market analysis ───────────────────────────────────────────────
  const loadCandidates = useCallback(async (c: Cma, parcelId: string) => {
    setBusy('Finding comparable sales…'); setError(null)
    try {
      const r = await cmaCandidates(c.id, parcelId)
      setCandidates(r.comparables)
      if (!r.comparables.length) {
        setNote('No comparable sales found near this tract.')
        return
      }
      // Comparable sales are usually miles away, and the map is still
      // framed on the parcel — without this the pins load off-screen and
      // there is nothing to click. Frame the subject AND its comps.
      const pts: any[] = r.comparables
        .filter((c2) => c2.longitude != null && c2.latitude != null)
        .map((c2) => [c2.longitude, c2.latitude])
      if (detailRef.current?.boundary) pts.push(detailRef.current.boundary.coordinates)
      const bb = bboxOf(pts)
      if (bb && mapRef.current) {
        mapRef.current.fitBounds(bb, { padding: 90, maxZoom: 13, duration: 800 })
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load comparable sales.')
    } finally { setBusy(null) }
  }, [])

  /** Start (or extend) a market analysis with this parcel as a subject. */
  const startCma = useCallback(async () => {
    if (!editingId || !projectId) {
      setError('Save this parcel first.')
      return
    }
    setBusy('Starting market analysis…'); setError(null)
    try {
      // Reuse an existing analysis for this project rather than making a
      // new one every time the page is reloaded — otherwise the portfolio
      // fills up with duplicates nobody asked for.
      let c = cma ? await getCma(cma.id) : null
      if (!c) {
        const mine = (await listCmas(projectId)).cmas
        c = mine.length ? await getCma(mine[0].id) : null
      }
      if (!c) {
        c = await createCma(projectId, `${name || 'Parcel'} — Market Analysis`, [editingId])
      }
      // Make sure the parcel being edited is one of its subjects.
      if (!c.subjects.some((x) => x.parcel_id === editingId)) {
        await updateCma(c.id, {
          parcel_ids: [...c.subjects.map((x) => x.parcel_id), editingId],
        })
        c = await getCma(c.id)
      }
      setCma(c)
      setCmaSubject(editingId)
      await loadCandidates(c, editingId)
    } catch (e: any) {
      setError(e?.message || 'Could not start the analysis.')
    } finally { setBusy(null) }
  }, [editingId, projectId, cma, name, loadCandidates])

  /** A + / - click on a comparable pin. */
  const toggleComp = useCallback(async (compId: string) => {
    if (!cma || !cmaSubject) return
    const next = candidates.map((c) =>
      String(c.id) === compId ? { ...c, selected: !c.selected } : c)
    setCandidates(next)
    const chosen = next.filter((c) => c.selected).map((c) => String(c.id))
    try {
      await setCmaComps(cma.id, cmaSubject, chosen)
      setCma((prev) => prev ? {
        ...prev,
        subjects: prev.subjects.map((s) =>
          s.parcel_id === cmaSubject ? { ...s, comps: chosen } : s),
      } : prev)
    } catch (e: any) {
      setError(e?.message || 'Could not save that selection.')
      // Put the pin back the way it was rather than leaving the map
      // showing a choice the server did not accept.
      setCandidates(candidates)
    }
  }, [cma, cmaSubject, candidates])
  const toggleCompRef = useRef(toggleComp); toggleCompRef.current = toggleComp
  // Declared later in the file; a ref keeps the ordering irrelevant.
  const refreshReportsRef = useRef<(id: string) => Promise<void>>(async () => {})

  const buildCmaReport = useCallback(async () => {
    if (!cma) return
    setBusy('Queuing the analysis…'); setError(null)
    try {
      await queueCmaReport(cma.id)
      if (editingId) await refreshReportsRef.current(editingId)
      setSavedMsg('Market analysis queued — it will appear under Reports.')
    } catch (e: any) {
      setError(e?.message || 'Could not queue the analysis.')
    } finally { setBusy(null) }
  }, [cma, editingId])

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
      mutate((prev) => [...prev, ...explodeShapes(other.polygons as any)])
      // Record the RESOLVED uuid, not whatever id the click supplied —
      // source_ll_uuids is read back as ll_uuids when a saved parcel is
      // reopened, so storing a tile `path` here would break that.
      setSources((prev) => Array.from(new Set([
        ...prev, other.parcel?.ll_uuid || llUuid,
      ])))
      setTool(null)
    } catch (e: any) {
      setError(e?.message || 'Those parcels could not be combined.')
    } finally { setBusy(null) }
  }, [mutate])
  const combineWithRef = useRef(combineWith); combineWithRef.current = combineWith

  /** Cut the boundary with the drawn line. Pieces come back largest
   *  first so they can be named Tract 1, Tract 2, … sensibly. */

  /** Cut the SELECTED land-type polygon in two along the line between the
   *  user's two clicks. The line is extended well past both clicks so a
   *  click landing just inside the polygon still cuts clean through
   *  instead of failing with "that line did not cut". */
  const runCut = useCallback(async (line: Pt[]) => {
    // Step 1 cuts the PARCEL into tracts; step 2 cuts the selected land
    // type polygon. Same two-click gesture either way.
    const onBoundary = stepRef.current === 'boundary'
    const id = selectedRef.current
    const target = onBoundary ? null : shapesRef.current.find((sh) => sh.id === id)
    if (!onBoundary && !target) { setError('Select a polygon first, then cut it.'); return }
    const geom = onBoundary ? polysToGeometry(boundaryRef.current) : polysToGeometry(target!.polys)
    if (!geom) return
    const [a, b] = line
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const ext: Pt[] = [[a[0] - dx, a[1] - dy], [b[0] + dx, b[1] + dy]]
    setBusy('Cutting…'); setError(null)
    try {
      const res = await splitGeometry(geom, { type: 'LineString', coordinates: ext })
      if (!res.pieces || res.pieces.length < 2) {
        setError(onBoundary
          ? 'That line did not cut the parcel — click once outside each side of it.'
          : 'That line did not cut the polygon — click once on each side of it.')
        return
      }
      if (onBoundary) {
        setPieces(res.pieces)
      } else {
        const next = shapesRef.current.filter((sh) => sh.id !== id).concat(
          res.pieces.map((pc) => ({
            id: nextId(), cls: target!.cls, polys: geometryToPolys(pc.geometry),
          })).filter((x) => x.polys.length > 0))
        mutate(() => next)
        setSelectedId(null)
      }
      setTool(null)
    } catch (e: any) {
      setError(e?.message || 'Could not cut that polygon.')
    } finally { setBusy(null) }
  }, [mutate])
  const runCutRef = useRef(runCut); runCutRef.current = runCut

  /** Remove every handle inside the dragged box. Step 1 trims the parcel
   *  outline; step 2 trims the selected polygon (the only one showing
   *  handles). A ring is never taken below a triangle. */
  const eraseInBox = useCallback((b: [Pt, Pt]) => {
    const x0 = Math.min(b[0][0], b[1][0]), x1 = Math.max(b[0][0], b[1][0])
    const y0 = Math.min(b[0][1], b[1][1]), y1 = Math.max(b[0][1], b[1][1])
    if (Math.abs(x1 - x0) < 1e-9 || Math.abs(y1 - y0) < 1e-9) return   // a click, not a drag
    const inside = (pt: Pt) => pt[0] >= x0 && pt[0] <= x1 && pt[1] >= y0 && pt[1] <= y1
    // ri 0 is the outer ring and must stay a polygon, so a box that
    // would flatten it is ignored. Rings 1+ are holes: a box dragged
    // over a whole hole is someone asking for it to GO, and refusing
    // left it stuck as a triangle that could not be cleared.
    const trim = (ring: Pt[], ri: number) => {
      const kept = ring.filter((pt) => !inside(pt))
      if (kept.length >= 3) return kept
      return ri === 0 ? ring : []
    }
    let removed = 0
    const count = (before: Pt[], after: Pt[]) => { removed += before.length - after.length }
    if (stepRef.current === 'boundary') {
      setBoundaryRings((prev) => prev.map((rings) => dropDegenerateHoles(
        rings.map((ring, ri) => { const t = trim(ring, ri); count(ring, t); return t }))))
    } else {
      const id = selectedRef.current
      if (!id) { setError('Select a polygon first, then drag over its points.'); return }
      mutate((prev) => prev.map((sh) => sh.id !== id ? sh : {
        ...sh,
        polys: sh.polys.map((rings) => dropDegenerateHoles(
          rings.map((ring, ri) => { const t = trim(ring, ri); count(ring, t); return t }))),
      }))
    }
    if (!removed) setError('No points inside that box — drag a box right over the dots.')
  }, [mutate])
  const eraseInBoxRef = useRef(eraseInBox); eraseInBoxRef.current = eraseInBox
  const marqRef = useRef(marq); marqRef.current = marq
  const editingTypesRef = useRef(editingTypes); editingTypesRef.current = editingTypes
  const enforceNoOverlapRef = useRef(enforceNoOverlap); enforceNoOverlapRef.current = enforceNoOverlap

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

  const fingerprint = useCallback((sh: Shape[], b: Pt[][][]) => JSON.stringify([
    sh.map((x) => [x.cls, x.polys]), b,
  ]), [])
  const markClean = useCallback((sh: Shape[], b: Pt[][][]) => {
    cleanRef.current = fingerprint(sh, b)
    setDirty(false)
  }, [fingerprint])
  markCleanRef.current = markClean
  useEffect(() => {
    const d = fingerprint(shapes, boundaryRings) !== cleanRef.current
    setDirty(d); dirtyRef.current = d
  }, [shapes, boundaryRings, fingerprint])

  /** Switching to another saved tract behaves like Cancel: straight
   *  through when nothing is unsaved, otherwise ask — and there OK
   *  SAVES and switches rather than throwing the work away. */
  const requestOpen = useCallback((id: string) => {
    if (id === editingId) return
    if (!dirtyRef.current) { void openSavedTractRef.current?.(id); return }
    setPendingOpen(id)
    setConfirmWhat('switch')
  }, [editingId])
  requestOpenRef.current = requestOpen

  // ── the rest of the project ───────────────────────────────────────
  // Re-read after every save, because saving is what changes the set —
  // `savedMsg` flips on each completed save, editingId on each open.
  const loadPeers = useCallback(async (pid: string | null) => {
    if (!pid) { setPeers((prev) => (prev.length ? [] : prev)); return }
    try { setPeers((await projectGeometry(pid)).tracts) } catch { /* context only */ }
  }, [])

  useEffect(() => { void loadPeers(projectId) }, [projectId, savedMsg, loadPeers])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // Everything EXCEPT the tract that is open: that one is drawn live
    // from the editor's own state, and a stale copy underneath it would
    // ghost every edit.
    peersRef.current = peers
    const others = peers.filter((t) => t.id !== editingId)
    // The outline currently open, used to decide which saved badge the
    // live one replaces.
    const liveOuter = boundaryRings.map((rings) => rings[0]).filter(Boolean)
    const fills: any[] = []
    const bounds: any[] = []
    const labels: any[] = []
    for (const t of others) {
      for (const poly of t.polygons) {
        if (poly.geometry) fills.push({
          type: 'Feature', geometry: poly.geometry,
          properties: { color: CLASS_COLOR[poly.cls] || '#9ca3af' },
        })
      }
      if (t.boundary) bounds.push({ type: 'Feature', geometry: t.boundary, properties: {} })
      // A saved tract sitting under the parcel you have open gets NO
      // badge of its own — the live one below stands for that ground.
      // Suppressing the live badge instead left the SAVED name on screen,
      // so renaming what you were editing appeared to do nothing.
      const under = t.label_point?.type === 'Point'
        && liveOuter.some((r) => pointInRing(t.label_point.coordinates as Pt, r))
      if (t.label_point && !under) labels.push({
        type: 'Feature', geometry: t.label_point,
        properties: { name: t.name || 'Untitled', tractId: t.id },
      })
    }
    // The open tract gets a badge too, from its LIVE outline, so the name
    // tracks what is being typed instead of what was last saved.
    const liveCentre = ringCentre(boundaryRings)
    if (liveCentre && detail && name.trim()) {
      labels.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: liveCentre },
        properties: { name: name.trim() },
      })
    }
    ;(map.getSource(SRC.peerFill) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: fills } as any)
    ;(map.getSource(SRC.peerLine) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: bounds } as any)
    ;(map.getSource(SRC.peerLabel) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: labels } as any)
    raisePlaceLabelsRef.current?.()
  }, [peers, editingId, ready, boundaryRings, detail, name])

  // Every fill on the screen scales together, so the slider does one
  // legible thing: at 0 you get bare imagery with the outlines still
  // drawn, which is the point — you can see what is underneath WITHOUT
  // losing track of where the polygon is.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const k = fillOpacity
    const set = (layer: string, value: any) => {
      if (map.getLayer(layer)) map.setPaintProperty(layer, 'fill-opacity', value)
    }
    set(LYR_FILL, ['case', ['boolean', ['get', 'selected'], false], 0.42 * k, 0.22 * k])
    set('cm-boundary-fill', 0.22 * k)
    set('cm-peer-shapes-fill', 0.16 * k)
  }, [fillOpacity, ready])

  // ── paint shapes / vertices / boundary / dots / draft ──────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const feats: any[] = []
    for (const s of (step === 'boundary' ? [] : shapes)) {
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
    if (step === 'boundary') {
      // Step 1: the outline itself is what you drag.
      boundaryRings.forEach((rings, pi) => rings.forEach((ring, ri) =>
        ring.forEach((pt, vi) => verts.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: pt },
          properties: { shapeId: '__boundary__', pi, ri, vi, active: true },
        }))))
    } else if (!editingTypes) {
      // View mode: no handles at all. They used to still be drawn and
      // draggable with the tools hidden, so a tract opened just to look
      // at could be reshaped by a stray drag.
    } else {
      const sel = shapes.find((sh) => sh.id === selectedId)
      sel?.polys.forEach((rings, pi) => rings.forEach((ring, ri) =>
        ring.forEach((pt, vi) => verts.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: pt },
          properties: { shapeId: sel.id, pi, ri, vi, active: true },
        }))))
    }
    ;(map.getSource(SRC.verts) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: verts } as any)
  }, [shapes, selectedId, step, boundaryRings, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // While the outline is being edited it comes from boundaryRings; once
    // confirmed it is the saved geometry and is drawn as a locked line.
    const geom = step === 'boundary' ? polysToGeometry(boundaryRings) : detail?.boundary
    ;(map.getSource(SRC.boundary) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: geom ? [{ type: 'Feature', geometry: geom, properties: {} }] : [],
    } as any)

    // The pink wash belongs to step 1 only. Left on in step 2 it lies
    // over every land type at 22% — green tillable under pink reads as a
    // muddy brown, so correct engine output looks like nonsense. The
    // outline itself stays visible in both steps.
    if (map.getLayer('cm-boundary-fill')) {
      map.setLayoutProperty('cm-boundary-fill', 'visibility',
        step === 'boundary' ? 'visible' : 'none')
    }
  }, [detail, boundaryRings, step, ready])

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
    ;(map.getSource(SRC.comps) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: candidates
        .filter((c) => c.longitude != null && c.latitude != null)
        .map((c) => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c.longitude, c.latitude] },
          properties: { id: String(c.id), selected: !!c.selected },
        })),
    } as any)
  }, [candidates, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource(SRC.marq) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: marq ? [{
        type: 'Feature', properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [marq[0][0], marq[0][1]], [marq[1][0], marq[0][1]],
            [marq[1][0], marq[1][1]], [marq[0][0], marq[1][1]],
            [marq[0][0], marq[0][1]],
          ]],
        },
      }] : [],
    } as any)
    ;(map.getSource(SRC.cut) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: cutPts.map((pt) => ({
        type: 'Feature', properties: {},
        geometry: { type: 'Point', coordinates: pt },
      })),
    } as any)
  }, [cutPts, marq, ready])

  // Crosshair while the cut tool is armed, so it stops looking like a pan.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    map.getCanvas().style.cursor =
      tool === 'cutpoly' ? 'crosshair' : tool === 'erase' ? 'cell' : ''
  }, [tool, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    ;(map.getSource(SRC.draft) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: [
        // The closing segment is only drawn for an area being drawn, not
        // for a split line -- a split is a cut ACROSS, never a ring.
        ...(draft.length >= 2 ? [{
          type: 'Feature', properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [...draft, draft[0]],
          },
        }] : []),
        ...draft.map((pt, i) => ({
          type: 'Feature', properties: { i },
          geometry: { type: 'Point', coordinates: pt },
        })),
      ],
    } as any)
  }, [draft, ready])

  // ── panel actions ─────────────────────────────────────────────────
  // Counties for the chosen state. Cleared with the state, so a county
  // from the last state can never be sent with the next one.
  useEffect(() => {
    setSearchCounty('')
    if (!searchState) { setCounties([]); return }
    let stale = false
    ;(async () => {
      try {
        const r = await listCounties(searchState)
        if (!stale) setCounties(r.counties)
      } catch { if (!stale) setCounties([]) }
    })()
    return () => { stale = true }
  }, [searchState])

  const runSearch = useCallback(async () => {
    if (!query.trim()) return
    setBusy('Searching…'); setError(null); setNote(null); setHits([])
    try {
      const r = await searchMap(query.trim(), searchState || null, searchCounty || null)
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
  }, [query, searchState, searchCounty])

  const setClassOf = useCallback((id: string, cls: LandClass) => {
    mutate((prev) => prev.map((s) => s.id === id ? { ...s, cls } : s))
  }, [mutate])

  /** Throw away every hole in the selected polygon, in one go.
   *  Whittling a big hole away point by point was the only route, and
   *  it could not finish. Any hole that is genuinely another polygon's
   *  ground comes straight back: enforceNoOverlap re-cuts it. */
  const fillHoles = useCallback((id: string) => {
    // Build the result here rather than reading shapesRef back after
    // the setState: that ref is assigned during RENDER, so it still
    // holds the holed version at this point and the overlap check
    // would run against stale geometry.
    const next = shapesRef.current.map((sh) => sh.id !== id ? sh : {
      ...sh, polys: sh.polys.map((rings) => rings.slice(0, 1)),
    })
    mutate(() => next)
    void enforceNoOverlapRef.current(next, id)
  }, [mutate])

  const holesOnSelected = useMemo(() => {
    const sh = shapes.find((x) => x.id === selectedId)
    return sh ? sh.polys.reduce((n, rings) => n + Math.max(rings.length - 1, 0), 0) : 0
  }, [shapes, selectedId])

  /** Rename a saved tract on its own. Renaming used to mean entering
   *  full edit mode and re-saving the whole tract — geometry, acreage
   *  and soil recomputed — to change a word. */
  /** A name is not geometry: the tick writes it on its own, in any step,
   *  without going near the polygons (owner).
   *
   *  Takes the name rather than reading `name` back — the tick commits
   *  and calls in the same tick, before that setState has landed. */
  const doRename = useCallback(async (next?: string) => {
    const n = (next ?? name).trim()
    if (!n) return
    // Which tract is this? The one open in the editor, or — when a
    // parcel is re-opened that is ALREADY saved in this project — the
    // saved tract covering this ground. Renaming that one is plainly
    // what is meant; its badge is the one on screen.
    const centre = ringCentre(boundaryRings)
    const covering = editingId ? null : (centre
      ? peersRef.current.find((t) => t.boundary
          && geometryToPolys(t.boundary).some((rings) => pointInRing(centre, rings[0])))
      : null)
    const target = editingId || covering?.id
    if (!target) {
      // Nothing saved yet to rename. The name rides along with the first
      // save; say so rather than reporting a write that did not happen.
      setSavedName(n)
      setSavedMsg(`Named "${n}" — saved with the tract.`)
      return
    }
    setBusy('Saving the name…'); setError(null); setSavedMsg(null)
    try {
      await renameParcel(target, n)
      setSavedMsg(`Renamed to "${n}".`); setSavedName(n)
      await loadPeers(projectId)   // the badge on the map follows
    } catch (e: any) {
      setError(e?.message || 'That name could not be saved.')
    } finally { setBusy(null) }
  }, [editingId, name, projectId, loadPeers, boundaryRings])

  const deleteShape = useCallback((id: string) => {
    const gone = shapesRef.current.find((s) => s.id === id)
    const rest = shapesRef.current.filter((s) => s.id !== id)
    const goneOuter = gone?.polys[0]?.[0]

    // Deleting only ever removed the polygon. The polygon AROUND it kept
    // the hole that polygon was sitting in, so the ground left behind
    // showed as a differently coloured patch instead of becoming part of
    // its neighbour. Close that hole: a hole belongs to the deleted
    // polygon when its centre falls inside what was just removed.
    const next = !goneOuter ? rest : rest.map((sh) => ({
      ...sh,
      polys: sh.polys.map((rings) => rings.filter((ring, ri) => {
        if (ri === 0) return true
        const c = ringCentre([[ring]])
        if (!c || !pointInRing(c, goneOuter)) return true
        // Another polygon still occupies this hole — closing it would
        // swallow that one too.
        return rest.some((o) => {
          if (o.id === sh.id) return false
          const oc = ringCentre(o.polys)
          return !!oc && pointInRing(oc, ring)
        })
      })),
    }))
    mutate(() => next)
    setSelectedId((cur) => cur === id ? null : cur)
    void enforceNoOverlapRef.current(next, null)
  }, [mutate])

  const clearAll = useCallback(() => {
    if (!shapes.length) return
    mutate(() => [])
    setSelectedId(null)
  }, [mutate, shapes.length])

  const resetToEngine = useCallback(() => {
    if (!detail) return
    mutate(() => explodeShapes(detail.polygons as any))
    setSelectedId(null)
  }, [detail, mutate])

  const doSave = useCallback(async (): Promise<boolean> => {
    if (!detail) return false
    if (!name.trim()) { setError('Give this parcel a name before saving.'); return false }
    setBusy('Saving…'); setError(null); setSavedMsg(null)
    try {
      const payload = {
        name: name.trim(),
        boundary: polysToGeometry(boundaryRings) || detail.boundary,
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
      setSavedName(res.name)
      markCleanRef.current?.(shapes, boundaryRings)
      setEditingTypes(false)
      setTool(null); setDrawing(false); setDraft([]); setCutPts([]); setSelectedId(null)
      return true
    } catch (e: any) {
      setError(e?.message || 'Save failed.')
      return false
    } finally { setBusy(null) }
  }, [detail, name, shapes, sources, projectId, projectName, editingId])

  // ── reports ───────────────────────────────────────────────────────
  // Queue, then poll. Rendering happens on a worker, so the screen must
  // never sit blocked waiting for a PDF.
  const refreshReports = useCallback(async (id: string) => {
    try { setReports((await listReports(id)).reports) } catch { /* non-fatal */ }
  }, [])
  refreshReportsRef.current = refreshReports

  // A boolean, not the array: depending on `reports` here meant every
  // refresh produced a new array identity and re-ran the effect. Worse,
  // with no parcel open the effect called setReports([]) — a fresh empty
  // array each time — so it re-triggered itself forever, allocating and
  // re-rendering from the moment the screen opened. That was ~6 MB a
  // second of heap growth on an idle page.
  const reportsPending = reports.some(
    (r) => r.status === 'queued' || r.status === 'running',
  )

  useEffect(() => {
    if (!editingId) {
      // Only ever assign when there is something to clear, so this can
      // never manufacture a new identity for an already-empty list.
      setReports((prev) => (prev.length ? [] : prev))
      return
    }
    void refreshReports(editingId)
  }, [editingId, refreshReports])

  // Poll only while something is actually rendering. A boolean flips at
  // most twice per report, so the interval is armed and cleared once.
  useEffect(() => {
    if (!editingId || !reportsPending) return
    const t = setInterval(() => void refreshReports(editingId), 4000)
    return () => clearInterval(t)
  }, [editingId, reportsPending, refreshReports])

  const removeReport = useCallback(async (id: string) => {
    setDeletingReport(id)
    try {
      await deleteReport(id)
      // Drop it locally too: the poll only runs while something is
      // still rendering, so a finished report would otherwise stay on
      // screen until the next parcel load.
      setReports((prev) => prev.filter((r) => r.id !== id))
    } catch (e: any) {
      setError(e?.message || 'That report could not be deleted.')
    } finally { setDeletingReport(null) }
  }, [])

  const makeReport = useCallback(async (kind: (typeof REPORT_KINDS)[number]) => {
    if (!editingId) { setError('Save this parcel before building a report.'); return }
    setError(null); setQueuing(kind)
    try {
      await queueReport(editingId, kind,
        USES_ELEVATION.includes(kind) ? { exaggeration } : {})
      await refreshReports(editingId)
    } catch (e: any) {
      setError(e?.message || 'Could not start that report.')
    } finally { setQueuing(null) }
  }, [editingId, refreshReports, exaggeration])

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
        setShapes(explodeShapes(rec.polygons as any))
        setName(rec.name); setSavedName(rec.name)
      } catch (e: any) {
        setError(e?.message || 'Could not reload the saved version.')
      } finally { setBusy(null) }
    } else if (detail) {
      setShapes(explodeShapes(detail.polygons as any))
    }
    undoRef.current = []; redoRef.current = []
  }, [editingId, detail])

  /** Cancel, confirmed: drop every edit and close the parcel entirely,
   *  rather than reloading it and leaving it open. */
  const discardAndClose = useCallback(() => {
    setConfirmWhat(null)
    setError(null); setSavedMsg(null); setPieces([]); setTool(null)
    setDrawing(false); setDraft([]); setCutPts([]); setMarq(null)
    setSelectedId(null); setShapes([]); setBoundaryRings([])
    setDetail(null); setEditingId(null); setName(''); setSavedName(''); setSources([])
    setStep('boundary'); setEditingTypes(true)
    // Leave the project as well. Keeping projectId meant the next parcel
    // you drew was silently filed into the project you had just
    // cancelled out of — and ?project= in the URL put it straight back
    // on the next load.
    setProjectId(null); setProjectName('')
    try {
      window.history.replaceState({}, '', '/configure-map')
    } catch { /* history is a convenience, not load-bearing */ }
    undoRef.current = []; redoRef.current = []
  }, [])

  /** Clear the canvas but STAY in the project, so the next parcel you
   *  draw is filed alongside the one you just finished. Same thing
   *  'Add tract' does from the Map Portfolio — reaching it used to mean
   *  leaving this screen and coming back. */
  const addTractToProject = useCallback(() => {
    if (!projectId) return
    setConfirmWhat(null)
    setError(null); setSavedMsg(null); setPieces([]); setTool(null)
    setDrawing(false); setDraft([]); setCutPts([]); setMarq(null)
    setSelectedId(null); setShapes([]); setBoundaryRings([])
    setDetail(null); setEditingId(null); setName(''); setSavedName(''); setSources([])
    setStep('boundary'); setEditingTypes(true)
    try {
      window.history.replaceState(
        {}, '', `/configure-map?project=${encodeURIComponent(projectId)}&new=1`)
    } catch { /* history is a convenience, not load-bearing */ }
    undoRef.current = []; redoRef.current = []
  }, [projectId])

  // Recompute the soil rating whenever the tillable ground changes.
  // Debounced by 700 ms so a drag fires one query at the end, not one per
  // mouse move, and keyed on the actual geometry so an unrelated edit
  // (renaming, selecting) does not re-query.
  const tillableKey = useMemo(
    () => shapes.filter((sh) => sh.cls === 'tillable')
      .map((sh) => sh.polys.flat().flat().map((pt) => pt.join(',')).join(';')).join('|'),
    [shapes])

  useEffect(() => {
    if (step !== 'landtypes' || !detail) { setSoil(null); return }
    const tillable = shapes.filter((sh) => sh.cls === 'tillable')
      .map((sh) => polysToGeometry(sh.polys)).filter(Boolean)
    if (!tillable.length) { setSoil(null); return }
    const st = detail.parcel?.state || null
    if (!st) return
    let cancelled = false
    setSoilBusy(true)
    const t = setTimeout(async () => {
      try {
        const r = await previewSoil(tillable, st, detail.boundary)
        if (!cancelled) setSoil({ rating: r.rating, rating_type: r.rating_type })
      } catch {
        if (!cancelled) setSoil(null)
      } finally {
        if (!cancelled) setSoilBusy(false)
      }
    }, 700)
    return () => { cancelled = true; clearTimeout(t); setSoilBusy(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tillableKey, step, detail?.boundary])

  // Live totals by class for the panel.
  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const c of LAND_CLASSES) t[c] = 0
    for (const s of shapes) t[s.cls] += shapeAcres(s)
    return t
  }, [shapes])

  // Acres for the boundary as it stands RIGHT NOW. While step 1 is open
  // the outline is the thing being dragged, so reading the stored figure
  // left the panel claiming the original acreage no matter how far the
  // boundary moved — the panel even promises it updates as you edit.
  // Same geodesic helper the land-type totals use, so the two agree.
  const liveBoundaryAcres = useMemo(() => (
    boundaryRings.reduce((sum, rings) => {
      if (!rings.length) return sum
      const holes = rings.slice(1).reduce((h, r) => h + polygonAcres(r), 0)
      return sum + Math.max(polygonAcres(rings[0]) - holes, 0)
    }, 0)
  ), [boundaryRings])

  const storedAcres = Number(detail?.parcel?.acres ?? 0)
  // Use the boundary that is actually on screen in BOTH steps. In step 2
  // this used to fall back to the parcel's stored acreage, so if the
  // outline had been trimmed the land types (clipped to the new outline)
  // shrank while Total did not — and the gap landed in
  // "Other / Unclassified", which reads as though the engine returned
  // nonsense. Total must describe the same shape the classes were cut to.
  const parcelAcres = liveBoundaryAcres > 0 ? liveBoundaryAcres : storedAcres
  const classified = LAND_CLASSES.reduce((s, c) => s + totals[c], 0)

  return (
    // Fixed + above the site chrome: this is a full-surface tool, and
    // the marketing header/footer would otherwise wrap around it.
    <div className="cm-surface"
         style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', background: '#0f1520' }}>
      {/* The labels are black on pink; the icons are white. That cannot
          be expressed inline — lucide icons paint with currentColor,
          which is the label colour. */}
      <style>{`
        .cm-surface button svg, .cm-surface a svg { color: #ffffff; }
        .cm-surface button:disabled { opacity: 0.45; cursor: default; }
      `}</style>
      <div style={{ flex: 1, position: 'relative' }}>
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
        {/* While a tool is armed, the way OUT of it belongs on the map,
            where the user's eyes and cursor already are — not in a panel
            button they have to go hunting for mid-gesture. */}
        {(tool === 'erase' || tool === 'cutpoly') && (
          <button
            onClick={() => { setTool(null); setCutPts([]); setMarq(null) }}
            style={{
              position: 'absolute', bottom: 22, left: '50%',
              transform: 'translateX(-50%)', zIndex: 30,
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '11px 20px', borderRadius: 999, cursor: 'pointer',
              fontSize: 14, fontWeight: 700, color: '#0b0b0b',
              background: 'linear-gradient(180deg, #f9a8e6 0%, #f58cde 48%, #e072c8 100%)',
              border: '1px solid #f58cde',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), 0 4px 14px rgba(0,0,0,0.45)',
            }}>
            {tool === 'erase'
              ? <><Eraser size={15} /> Done erasing</>
              : <><Scissors size={15} /> Cancel cut</>}
          </button>
        )}
      </div>

      <aside style={{
        width: 360, flexShrink: 0, color: '#e5e7eb', position: 'relative',
        // Two stacked gradients: a sheen that falls off in the top fifth
        // (the gloss), over a dark-grey-to-black body. The inset
        // highlight is the lit top edge that makes it read as a surface
        // rather than a flat fill.
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.10) 0%,'
          + ' rgba(255,255,255,0.035) 7%, rgba(255,255,255,0) 20%),'
          + ' linear-gradient(180deg, #23262b 0%, #131519 14%,'
          + ' #0a0a0a 44%, #050505 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)',
        borderLeft: '1px solid rgba(255,255,255,0.10)',
        display: 'flex', flexDirection: 'column', fontSize: 13,
      }}>
        {/* Scrolling body. Save / Cancel live in the pinned footer below —
            the panel is taller than most windows, and burying the two
            buttons that commit or discard the work at the bottom of a
            scroll meant people could not find them at all. */}
        <div style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 14, padding: 16,
        }}>
        <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: 0.2 }}>Configure Map</div>

        {/* Search */}
        <div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void runSearch() }}
              placeholder="Town, township, county, owner, parcel #, or lat/lng"
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
          {/* Only once a state is chosen: county names repeat across
              states, so one without the other narrows nothing. */}
          {searchState && counties.length > 0 && (
            <select value={searchCounty} onChange={(e) => setSearchCounty(e.target.value)}
                    style={{ ...inputStyle, width: '100%', marginTop: 6 }}>
              <option value="">All counties in {searchState}</option>
              {counties.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
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
        {savedMsg && <div style={{ ...hint, color: '#f8daf1' }}>{savedMsg}</div>}

        {!detail && !busy && (
          <>
            <div style={hint}>Click a parcel on the map, or search for one, to start.</div>
            {/* With nothing open there is no footer, so this was a dead
                end — no route to the saved work. */}
            <a href="/map-portfolio"
               style={{ ...btn, width: '100%', justifyContent: 'center',
                        padding: '9px 10px', textDecoration: 'none' }}>
              <Layers size={14} /> Map Portfolio
            </a>
          </>
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
            </div>

            {step === 'boundary' ? (
              <>
                <div style={stepCard}>
                  <div style={stepLabel}>Step 1 — the parcel outline</div>
                  <div style={{ lineHeight: 1.5 }}>
                    This is the recorded parcel boundary. Drag any dot to adjust it.
                    Continue and the land types will fill in inside.
                  </div>
                </div>
                {/* The name field belonged in step 2 only, but the badge
                    on the map is already showing a name here — so this is
                    where people go looking to change it. Typing renames
                    the badge as you go; nothing is written until save. */}
                <div>
                  <div style={sectionLabel}>Tract name</div>
                  <TractName value={name} busy={!!busy}
                             onCommit={(n) => { setName(n); void doRename(n) }} />
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <button
                    onClick={() => setBoundaryRings(geometryToPolys(detail.boundary))}
                    style={btn}>
                    <RotateCcw size={13} /> Reset outline
                  </button>
                  <button
                    onClick={() => {
                      const on = tool !== 'cutpoly'
                      setTool(on ? 'cutpoly' : null); setCutPts([]); setPieces([])
                    }}
                    style={{ ...btn, borderColor: tool === 'cutpoly' ? '#ffffff' : undefined }}>
                    <Scissors size={13} /> Split parcel
                  </button>
                  <button
                    onClick={() => setTool(tool === 'erase' ? null : 'erase')}
                    style={{ ...btn, borderColor: tool === 'erase' ? '#ffffff' : undefined }}>
                    <Eraser size={13} /> Erase points
                  </button>
                </div>
                {tool === 'erase' && (
              <p style={{ margin: '6px 2px 0', fontSize: 11, lineHeight: 1.45, color: '#9ca3af' }}>
                Drag a box over a run of dots and they are all removed at once. Right-click
                (or Alt-click) a single dot to remove just that one.
              </p>
            )}
            {tool === 'cutpoly' && (
                  <p style={{ ...hint, marginTop: 6 }}>
                    Click once <strong>outside each side</strong> of the parcel. It cuts on
                    the second click.
                  </p>
                )}
                <div style={hint}>
                  {(boundaryRings[0]?.[0]?.length ?? 0)} points on the outline
                  <div style={{ ...hint, marginTop: 4 }}>
                    Click the line to add a point. Right-click (or Alt-click) a point to remove it.
                  </div>
                </div>
              </>
            ) : (
              <>
            {!editingTypes && (
              <button onClick={() => setEditingTypes(true)}
                      style={{ ...primaryBtn, width: '100%', justifyContent: 'center' }}>
                <PenLine size={13} /> Edit this tract
              </button>
            )}

            {editingTypes && (<>
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
                      // Selection used to be carried by the fill. The fill
                      // is pink on every chip now, so it is carried by a
                      // white ring instead.
                      outline: drawClass === c ? '2px solid #ffffff' : 'none',
                      outlineOffset: drawClass === c ? 1 : 0,
                      opacity: drawClass === c ? 1 : 0.72,
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
                  if (drawing) { finishDraft(); return }
                  setTool('draw'); setDrawing(true); setDraft([])
                }}
                style={{ ...btn, borderColor: drawing ? CLASS_COLOR[drawClass] : undefined }}>
                <Plus size={13} /> {drawing ? 'Finish shape' : 'Add polygon'}
              </button>
              <button onClick={() => selectedId && deleteShape(selectedId)} disabled={!selectedId} style={btn}>
                <Trash2 size={13} /> Delete
              </button>
              <button
                onClick={() => {
                  const on = tool !== 'cutpoly'
                  setTool(on ? 'cutpoly' : null)
                  setCutPts([]); setDrawing(false); setDraft([])
                }}
                disabled={!selectedId && tool !== 'cutpoly'}
                style={{ ...btn, borderColor: tool === 'cutpoly' ? '#ffffff' : undefined }}>
                <Scissors size={13} /> Split polygon
              </button>
              <button
                onClick={() => setTool(tool === 'erase' ? null : 'erase')}
                disabled={!selectedId && tool !== 'erase'}
                style={{ ...btn, borderColor: tool === 'erase' ? '#ffffff' : undefined }}>
                <Eraser size={13} /> Erase points
              </button>
              <button
                onClick={() => selectedId && fillHoles(selectedId)}
                disabled={!selectedId || holesOnSelected === 0}
                title="Remove every hole inside the selected polygon"
                style={btn}>
                <PaintBucket size={13} /> Fill holes
                {holesOnSelected > 0 ? ` (${holesOnSelected})` : ''}
              </button>
              <button
                onClick={() => setTool(tool === 'combine' ? null : 'combine')}
                style={{ ...btn, borderColor: tool === 'combine' ? '#ffffff' : undefined }}>
                <Combine size={13} /> {tool === 'combine' ? 'Pick a parcel…' : 'Combine'}
              </button>
            </div>
            {tool === 'cutpoly' && (
              <p style={{ margin: '6px 2px 0', fontSize: 11, lineHeight: 1.45, color: '#9ca3af' }}>
                Click once on <strong>each side</strong> of the selected polygon. It cuts
                on the second click.
              </p>
            )}


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
            {drawing && (
              <div style={hint}>Click to place corners. Enter or double-click closes the shape; Esc cancels.</div>
            )}
            {tool === 'combine' && (
              <div style={hint}>Click another parcel to fold it into this one.</div>
            )}
            </>)}

            {/* See what is under a polygon without deleting it. */}
            <div>
              <div style={{ ...statRow, marginBottom: 2 }}>
                <span style={{ opacity: 0.65 }}>Polygon fill</span>
                <span>{Math.round(fillOpacity * 100)}%</span>
              </div>
              <input
                type="range" min={0} max={1} step={0.05} value={fillOpacity}
                onChange={(e) => setFillOpacity(parseFloat(e.target.value))}
                style={{ width: '100%' }} />
              <div style={hint}>
                Slide to 0 to see the bare imagery. The outlines stay put, so
                nothing gets lost — and nothing is changed or saved.
              </div>
            </div>


              </>
            )}

            {/* Cutting the parcel is a STEP 1 action, but this card lived
                inside the step 2 branch — so the cut ran, staged its
                pieces, and nothing appeared. Outside the ternary now. */}
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
                          style={primaryBtn}>
                    <Save size={13} /> Save all as tracts
                  </button>
                  <button onClick={() => setPieces([])} style={btn}>Discard</button>
                </div>
              </div>
            )}

            {/* Step 2 only. In step 1 nothing has been classified yet, so
                every class read 0.0 and the whole parcel fell into
                "Other / Unclassified" — which states something false
                about the ground rather than saying "not computed yet".
                The live acreage is on the parcel card above either way. */}
            {step === 'landtypes' && (
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
              <div style={{ ...statRow, borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 6 }}>
                <span style={{ opacity: 0.65 }}>
                  Soil rating{soil?.rating_type ? ` (${soil.rating_type})` : ''}
                </span>
                <span style={{ opacity: soilBusy ? 0.45 : 1 }}>
                  {soilBusy ? 'updating…' : (soil?.rating ?? '—')}
                </span>
              </div>
              <div style={hint}>
                Acres update as you edit; the soil rating follows a moment later.
                Both are recomputed exactly when you save.
              </div>
            </div>
            )}

            {/* Name + save */}
            {cma && (
              <div style={card}>
                <div style={sectionLabel}>Market analysis</div>
                <div style={{ fontWeight: 600 }}>{cma.name}</div>
                {cma.subjects.map((sub) => (
                  <button
                    key={sub.parcel_id}
                    onClick={() => { setCmaSubject(sub.parcel_id); void loadCandidates(cma, sub.parcel_id) }}
                    style={{
                      ...btn, width: '100%', justifyContent: 'space-between', marginTop: 5,
                      borderColor: cmaSubject === sub.parcel_id ? '#ffffff' : undefined,
                    }}>
                    <span>{sub.name || 'Tract'}</span>
                    <span style={{ opacity: 0.7 }}>
                      {(sub.comps || []).length} comp{(sub.comps || []).length === 1 ? '' : 's'}
                    </span>
                  </button>
                ))}
                {cmaSubject && (
                  <div style={hint}>
                    {candidates.length
                      ? 'Click a + pin on the map to use that sale, − to drop it.'
                      : 'No comparable sales found near this tract.'}
                  </div>
                )}
                {editingId && !cma.subjects.some((x) => x.parcel_id === editingId) && (
                  <button
                    onClick={() => void (async () => {
                      try {
                        await updateCma(cma.id, {
                          parcel_ids: [...cma.subjects.map((x) => x.parcel_id), editingId],
                        })
                        setCma(await getCma(cma.id))
                      } catch (e: any) { setError(e?.message || 'Could not add this tract.') }
                    })()}
                    style={{ ...btn, marginTop: 6 }}>
                    <Plus size={13} /> Add this tract as a subject
                  </button>
                )}
                <button onClick={() => void buildCmaReport()} disabled={!!busy}
                        style={{ ...primaryBtn, marginTop: 8 }}>
                  <FileText size={13} /> Build the analysis
                </button>
              </div>
            )}

            <div style={card}>
              <div style={sectionLabel}>Reports</div>
              {!editingId && (
                <div style={hint}>Save this parcel first, then build reports from it.</div>
              )}
              {editingId && (
                <>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {REPORT_KINDS.map((k) => {
                      const working = queuing === k || reports.some(
                        (r) => r.kind === k && (r.status === 'queued' || r.status === 'running'))
                      return (
                        <button key={k} onClick={() => void makeReport(k)}
                                disabled={working} style={btn}>
                          {working
                            ? <Loader2 size={13} className="animate-spin" />
                            : <FileText size={13} />}
                          {working ? (REPORT_BUSY_LABEL[k] || 'Working…') : REPORT_LABEL[k]}
                        </button>
                      )
                    })}
                  </div>
                  <button onClick={() => void startCma()} style={{ ...btn, marginTop: 8 }}>
                    <BarChart3 size={13} /> {cma ? 'Market analysis' : 'Start market analysis'}
                  </button>
                  <div style={{ marginTop: 10 }}>
                    <div style={{ ...statRow, marginBottom: 2 }}>
                      <span style={{ opacity: 0.65 }}>Elevation on 3D &amp; topography</span>
                      <span>{exaggeration.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range" min={1} max={4} step={0.5} value={exaggeration}
                      onChange={(e) => setExaggeration(parseFloat(e.target.value))}
                      style={{ width: '100%' }} />
                    <div style={hint}>
                      1x is true scale. The report always prints the real
                      elevation change in feet alongside it.
                    </div>
                  </div>
                </>
              )}
              {reports.map((r) => (
                <div key={r.id} style={statRow}>
                  <span style={{ opacity: 0.8 }}>{REPORT_LABEL[r.kind] || r.kind}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
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
                    {/* Removes this one report. A failed or stale build
                        otherwise sat in the list for good. */}
                    <button
                      onClick={() => void removeReport(r.id)}
                      disabled={deletingReport === r.id}
                      title="Delete this report"
                      aria-label="Delete this report"
                      style={{ ...btn, padding: '2px 5px', fontSize: 11 }}>
                      <X size={12} />
                    </button>
                  </span>
                </div>
              ))}
            </div>

            <div>
              <div style={sectionLabel}>Project</div>
              {projectId ? (
                // Already inside a project: name it, don't offer a dead
                // input. The greyed box with placeholder text said
                // nothing about WHICH project this tract belongs to.
                <>
                  <div style={{ ...statRow, opacity: 0.85 }}>
                    <span>{projectName || 'Open project'}</span>
                    <a href="/map-portfolio"
                       style={{ fontSize: 12, color: '#f58cde', textDecoration: 'none' }}>
                      All tracts
                    </a>
                  </div>
                  <div style={{ ...hint, marginTop: 4 }}>
                    This tract will be saved into that project.
                  </div>
                  {/* Only while the tract is UNSAVED. Once it is saved,
                      leaving the project here changed nothing that
                      lasted — Update does not move a saved tract between
                      projects — so the button promised a re-file it
                      could not do. On a saved tract the way to a fresh
                      project is "New map" in the footer. */}
                  {!editingId && (
                    <button
                      onClick={() => {
                        setProjectId(null); setProjectName('')
                        try { window.history.replaceState({}, '', '/configure-map') } catch {}
                      }}
                      style={{ ...btn, marginTop: 6, width: '100%', justifyContent: 'center' }}>
                      <Plus size={13} /> Save into a new project
                    </button>
                  )}
                </>
              ) : (
                <input value={projectName} onChange={(e) => setProjectName(e.target.value)}
                       placeholder="e.g. Smith Estate Auction (optional)"
                       style={inputStyle} />
              )}
            </div>
          </>
        )}
        </div>

        {/* Pinned footer — always on screen. */}
        {detail && (
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.10)', padding: 12,
            background: 'linear-gradient(180deg, #0a0a0a 0%, #050505 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {step === 'landtypes' && editingTypes && (
              <div>
                <div style={sectionLabel}>Tract name</div>
                <TractName value={name} busy={!!busy}
                           onCommit={(n) => { setName(n); void doRename(n) }} />
              </div>
            )}
            {/* Renaming a saved tract without entering edit mode. Only
                the name is written — the geometry is not touched. */}
            {step === 'landtypes' && !editingTypes && editingId && (
              <div>
                <div style={sectionLabel}>Tract name</div>
                <TractName value={name} busy={!!busy}
                           onCommit={(n) => { setName(n); void doRename(n) }} />
              </div>
            )}
            {step === 'landtypes' && !editingTypes ? (
              // View mode hid Save and Cancel, which left no way off this
              // screen at all — no route back to the portfolio and no way
              // to start a fresh map without editing the URL.
              <div style={{ display: 'flex', gap: 8 }}>
                <a href="/map-portfolio"
                   style={{ ...btn, flex: 1, justifyContent: 'center', padding: '9px 10px',
                            textDecoration: 'none' }}>
                  <Layers size={14} /> Map Portfolio
                </a>
                {/* Clears the canvas so you can pick the next parcel. In
                    a project it KEEPS the project, so the parcel you
                    draw next is filed alongside this one — that is the
                    whole point of a project. Outside one it is just a
                    blank canvas. A brand-new project starts from
                    "Create Map" in the portfolio. */}
                <button onClick={projectId ? addTractToProject : discardAndClose}
                        disabled={!!busy}
                        style={{ ...btn, flex: 1, justifyContent: 'center', padding: '9px 10px' }}>
                  <Plus size={14} /> Add Another Parcel
                </button>
              </div>
            ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Step 1's button is NOT "Save outline": nothing is
                  written here. It confirms the outline and moves to step
                  2, where the land types fill in — so it names where it
                  is taking you. */}
              {step === 'boundary' ? (
                <button onClick={() => void confirmBoundary()} disabled={!!busy}
                        style={{ ...primaryBtn, flex: 1, justifyContent: 'center', padding: '9px 10px' }}>
                  <ArrowRight size={14} /> Continue to Land Types
                </button>
              ) : (
                <button onClick={() => void doSave()} disabled={!!busy || !name.trim()}
                        style={{ ...primaryBtn, flex: 1, justifyContent: 'center', padding: '9px 10px' }}>
                  <Save size={14} /> {editingId ? 'Update' : 'Save'}
                </button>
              )}
              <button
                onClick={() => {
                  // Only ask when there is something to lose. A
                  // "discard your changes?" over a tract nobody has
                  // touched is pure noise (owner).
                  if (step === 'landtypes') {
                    if (dirty) { setConfirmWhat('outline'); return }
                    setTool(null); setSelectedId(null); setStep('boundary')
                    return
                  }
                  if (dirty) { setConfirmWhat('cancel'); return }
                  discardAndClose()
                }}
                disabled={!!busy}
                style={{ ...btn, flex: 1, justifyContent: 'center', padding: '9px 10px' }}>
                <X size={14} /> {step === 'landtypes' ? 'Edit outline' : 'Cancel'}
              </button>
            </div>
            )}
          </div>
        )}
        {/* Cancel throws away every unsaved edit and closes the parcel,
            so it confirms first. Sits inside the panel, over it. */}
        {confirmWhat && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 40,
            background: 'rgba(0,0,0,0.66)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
          }}>
            <div style={{
              width: '100%',
              background: 'linear-gradient(180deg, #1b1e23 0%, #0a0a0a 100%)',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 30px rgba(0,0,0,0.6)',
              borderRadius: 11, padding: 16,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {confirmWhat === 'outline' ? 'Go back to the outline?'
                  : confirmWhat === 'switch' ? 'Save before switching tracts?'
                  : 'Discard your changes?'}
              </div>
              <div style={{ ...hint, marginTop: 0, marginBottom: 14, display: 'block' }}>
                {confirmWhat === 'outline'
                  ? 'The land types are re-read from the engine for whatever outline '
                    + 'you confirm, so every polygon edit you have made will be lost.'
                  : confirmWhat === 'switch'
                  ? 'This tract has changes you have not saved. OK saves them and '
                    + 'opens the tract you clicked. Cancel stays on this one.'
                  : 'Every polygon edit you have made will be thrown away and the '
                    + 'parcel will close. This cannot be undone.'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => {
                          if (confirmWhat === 'outline') {
                            setConfirmWhat(null); setTool(null); setSelectedId(null)
                            setStep('boundary')
                          } else if (confirmWhat === 'switch') {
                            // Save FIRST, and only switch if it worked —
                            // switching on a failed save would lose the
                            // very work the dialog promised to keep.
                            const target = pendingOpen
                            setConfirmWhat(null); setPendingOpen(null)
                            void (async () => {
                              const ok = await doSave()
                              if (ok && target) void openSavedTractRef.current?.(target)
                            })()
                          } else {
                            discardAndClose()
                          }
                        }}
                        style={{ ...primaryBtn, flex: 1, justifyContent: 'center',
                                 padding: '9px 10px' }}>
                  OK
                </button>
                <button onClick={() => { setConfirmWhat(null); setPendingOpen(null) }}
                        style={{ ...btn, flex: 1, justifyContent: 'center',
                                 padding: '9px 10px' }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

// Fields in this panel are white on a dark surface (owner, 2026-08-27).
// The text colour has to move with the background — dark-on-dark text
// left over from the old style would be invisible on white.
const inputStyle: React.CSSProperties = {
  flex: 1, background: '#ffffff', border: '1px solid #d1d5db',
  borderRadius: 7, padding: '7px 9px', color: '#1a1a1a', fontSize: 13, outline: 'none',
}
// Brand pink (#f58cde, tailwind gg-pink). Tool buttons are outlined pink
// on solid pink: black label, white icon. Hierarchy is carried by
// weight and shadow (PRIMARY, the button that commits) rather than by
// fill, so every control on the surface reads as the same family.
const GG_PINK = '#f58cde'
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: `linear-gradient(180deg, #f9a8e6 0%, ${GG_PINK} 48%, #e072c8 100%)`,
  border: `1px solid ${GG_PINK}`, borderRadius: 7, padding: '6px 10px',
  color: '#0b0b0b', fontSize: 12, fontWeight: 500, cursor: 'pointer',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.40), 0 1px 3px rgba(0,0,0,0.45)',
}
/** The button that commits the work: same pink, heavier. */
const primaryBtn: React.CSSProperties = {
  ...btn,
  fontWeight: 700,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 2px 6px rgba(0,0,0,0.55)',
}
const chip: React.CSSProperties = { ...btn, padding: '5px 9px' }
const card: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(255,255,255,0.055) 0%, rgba(255,255,255,0.02) 100%)',
  border: '1px solid rgba(255,255,255,0.09)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07)',
  borderRadius: 9, padding: 10, display: 'flex', flexDirection: 'column', gap: 3,
}
/** The step cards are the one WHITE surface on a black panel — they
 *  carry the instructions for where you are, and reading them should not
 *  be work (owner). Everything inside is black, so nothing inherits the
 *  panel's light-on-dark colours. */
const stepCard: React.CSSProperties = {
  background: '#ffffff', color: '#0b0b0b',
  border: '1px solid rgba(0,0,0,0.12)', borderRadius: 9, padding: 10,
  display: 'flex', flexDirection: 'column', gap: 3,
  boxShadow: '0 1px 3px rgba(0,0,0,0.45)',
}
const stepLabel: React.CSSProperties = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8,
  opacity: 0.65, marginBottom: 5, color: '#0b0b0b',
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
