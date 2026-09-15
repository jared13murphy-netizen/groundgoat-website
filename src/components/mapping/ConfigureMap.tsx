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
  Scissors, FileText, Download, BarChart3, Eraser, PenLine, PaintBucket, Check,
  ArrowRight, ArrowLeft, PenTool, Magnet, LayoutGrid,
} from 'lucide-react'
import {
  CLASS_COLOR, CLASS_LABEL, LAND_CLASSES, PARCEL_LINE, SEARCH_DOT, VERTEX_LINE,
  archiveParcel, classifyBoundary, fetchParcel, getSavedParcel, saveParcel, searchMap,
  splitGeometry, normalizeGeometry, previewSoil,
  updateParcel, queueReport, listReports, downloadReport, getProject,
  REPORT_KINDS, REPORT_LABEL, REPORT_BUSY_LABEL, USES_ELEVATION, type ReportRow,
  deleteReport, projectGeometry, type ProjectTractGeometry, listCounties, renameParcel,
  niceCounty, combineGeometry, fitTracts,
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
  closeRing, nearestSegmentIndex, nearestVertexIndex, openRing, simplifyRing, snapPoint,
  type Pt, type SnapTarget,
} from '@/lib/polygonEditing'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

/** One drawn shape: a list of polygons, each [outerRing, ...holes].
 *  Holes are preserved — a pond inside a tillable field is a hole in
 *  that field, not a separate shape. Rings are stored OPEN. */
interface Shape { id: string; cls: LandClass; polys: Pt[][][] }

/** One tract: the owner's Stage 2/3 unit of ground. A project holds
 *  many; Stage 3 (land types) edits one at a time via `shapes`.
 *
 *  `source` records where the outline came from: a click on a Regrid
 *  parcel (one or more `ll_uuids` once a multi-parcel FRAME is combined
 *  into a reshape) or a free-hand draw with no parcel behind it.
 *  `boundary`/`shapes` are exactly the shape the old top-level
 *  `boundaryRings`/`shapes` state used to be — one tract's worth of
 *  what used to be the whole screen's state.
 *
 *  `savedId` is the server row id once this tract has been saved via
 *  /api/mapping/parcels (the old top-level `editingId`, now scoped to
 *  the tract it belongs to). `detail` is the parcel metadata + engine
 *  polygons the old top-level `detail` held, and `editingTypes` is the
 *  old top-level view/edit toggle — both now per tract so a saved tract
 *  opened to look at does not put every OTHER tract into edit mode. */
interface Tract {
  id: string
  name: string
  source: { kind: 'parcel'; ll_uuids: string[] } | { kind: 'drawn' }
  boundary: Pt[][][]
  shapes: Shape[]
  acres: number | null
  dirty: boolean
  saved: boolean
  savedId: string | null
  detail: ParcelDetail | null
  editingTypes: boolean
  /** Has this tract's `shapes` been fitted against the engine for its
   *  CURRENT boundary? False for a brand-new tract and again after any
   *  boundary change ('Snap tracts' rewrites `boundary`) — Stage 3
   *  re-classifies lazily, the first time the tract is opened there. */
  classified: boolean
}

// A module-level counter here (`tract${++seq}`) produced duplicate ids —
// and duplicate React keys, both in Stage 2/3's lists and in the map
// source features — the moment two tracts were created across separate
// renders that both read the same pre-increment value (seen in the
// console as two "tract1"s after a fit/undo/hot reload). crypto.randomUUID
// has no shared counter to race on; the timestamp+random fallback is for
// an http:// context (or a very old browser) where it is unavailable.
const nextTractId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tract-${Date.now()}-${Math.random().toString(36).slice(2)}`
)

function newTract(overrides: Partial<Tract> = {}): Tract {
  return {
    id: nextTractId(),
    name: '',
    source: { kind: 'drawn' },
    boundary: [],
    shapes: [],
    acres: null,
    dirty: false,
    saved: false,
    savedId: null,
    detail: null,
    editingTypes: true,
    classified: false,
    ...overrides,
  }
}

const SRC = {
  boundary: 'cm-boundary', shapes: 'cm-shapes', verts: 'cm-verts',
  dots: 'cm-dots', draft: 'cm-draft', comps: 'cm-comps',
  cut: 'cm-cut', marq: 'cm-marq',
  // The rest of the project, drawn around whatever is open.
  peerFill: 'cm-peer-shapes', peerLine: 'cm-peer-bounds', peerLabel: 'cm-peer-labels',
  // Stage 2's multi-parcel FRAME — either being built (raw parcel
  // outlines, one feature per click) or already combined (one feature,
  // the fit-tracts frame boundary).
  frame: 'cm-frame',
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

/** Fewer dots, same shape — run once at LOAD time so a freshly-traced
 *  engine polygon (which follows the painted raster contour and comes
 *  back with far more vertices than the corner actually needs) does not
 *  put a wall of drag handles on screen before anyone has touched it.
 *
 *  This used to be a manual "Simplify polygon" button the user pressed
 *  per shape; the owner's process assumes it already happened, so it now
 *  runs automatically wherever a shape is first built from server
 *  geometry — never on the result of a user's own edit (enforceNoOverlap
 *  re-normalizes after every drag and must NOT run this, or a shape
 *  would quietly lose precision on every single move).
 *
 *  Identical maths to the old button: Douglas-Peucker at 0.5% of the
 *  ring's own bbox diagonal, so it behaves the same at any acreage or
 *  zoom. Every ring is done, holes included; a ring too small to thin is
 *  left alone. */
function simplifyShapes(shapes: Shape[]): Shape[] {
  return shapes.map((sh) => ({
    ...sh,
    polys: sh.polys.map((rings) => rings.map((ring) => {
      if (ring.length < 5) return ring
      const lngs = ring.map((pt) => pt[0])
      const lats = ring.map((pt) => pt[1])
      const diag = Math.hypot(
        Math.max(...lngs) - Math.min(...lngs),
        Math.max(...lats) - Math.min(...lats),
      )
      return simplifyRing(ring, diag * 0.005)
    })),
  }))
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
    // A <form> rather than a plain div: Enter-to-submit is then the
    // browser's own native behavior for a single text input, so it
    // commits even in cases a raw onKeyDown Enter check alone misses
    // (autofill, an IME composition tail) — same reason a login field's
    // Enter key works even though nobody wired a keydown handler for
    // it. The explicit keydown check stays too, belt and suspenders,
    // since it's the one that fires for a JS-dispatched keydown that
    // never reaches the browser's native submit machinery at all. The
    // check button stays as the same submit action; Escape cancels.
    <form onSubmit={(e) => { e.preventDefault(); commit() }}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        autoFocus value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
        placeholder={placeholder || 'e.g. Tract 1, Home Place, North 80'}
        style={inputStyle} />
      <button type="button" onClick={cancel} title="Cancel" aria-label="Cancel rename"
              style={{ ...dangerBtn, flex: 'none', padding: '4px 7px' }}>
        <X size={13} />
      </button>
      <button type="submit" disabled={busy || !draft.trim()}
              title="Save this name" aria-label="Save this name"
              style={{ ...goBtn, flex: 'none', padding: '4px 7px' }}>
        <Check size={13} />
      </button>
    </form>
  )
}

/** One row of the tract list — the source dot, name, and live acres,
 *  shared by Stage 2's editable list (rename + remove) and Stage 3's
 *  compact "pick your next tract" list (name only, no controls) so
 *  there is exactly one place that draws a tract row. `compact` drops
 *  the rename/remove affordances and renders the name as plain text. */
function TractRow({ t, selected, compact, busy, onSelect, onCommitName, onRemove }: {
  t: Tract
  selected: boolean
  compact?: boolean
  busy?: boolean
  onSelect: () => void
  onCommitName?: (next: string) => void
  onRemove?: () => void
}) {
  return (
    <div onClick={onSelect}
         style={{
           display: 'grid',
           gridTemplateColumns: compact ? 'auto 1fr auto' : 'auto 1fr auto auto',
           gap: 8, alignItems: 'center', cursor: 'pointer',
           padding: '8px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)',
           borderRadius: selected ? 7 : 0,
           background: selected ? 'rgba(245,140,222,0.14)' : 'transparent',
         }}>
      <span title={t.source.kind === 'drawn' ? 'Hand-drawn' : 'From a parcel'}
            style={{
              width: 8, height: 8, borderRadius: '50%', flex: 'none',
              background: t.source.kind === 'drawn' ? GG_PINK : '#93c5fd',
            }} />
      {compact ? (
        <span style={{
          minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          opacity: t.name.trim() ? 1 : 0.5,
        }}>
          {t.name.trim() || 'Unnamed tract'}
        </span>
      ) : (
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
          <TractName value={t.name} busy={!!busy}
                     onCommit={(n) => onCommitName?.(n)} />
          {!t.name.trim() && (
            <span title="Unnamed tract"
                  style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', flex: 'none' }} />
          )}
        </span>
      )}
      <span style={{ opacity: 0.7, fontSize: 12 }}>
        {(t.acres ?? boundaryAcresOf(t.boundary)).toFixed(1)} ac
      </span>
      {!compact && (
        <button onClick={(e) => { e.stopPropagation(); onRemove?.() }}
                title="Remove this tract" aria-label="Remove this tract"
                style={{ ...dangerBtn, flex: 'none', padding: '4px 7px' }}>
          <Trash2 size={13} />
        </button>
      )}
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

/** A tract's boundary acreage, live — same maths as `shapeAcres`, for
 *  the outline instead of a land-type polygon. Used for the Stage 2
 *  tract-list row whenever a tract has not been fit yet (`acres` null) —
 *  the server figure from 'Snap tracts' or a save always wins once it
 *  exists, this is only ever a browser estimate. */
function boundaryAcresOf(boundary: Pt[][][]): number {
  return boundary.reduce((sum, rings) => {
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

/** Magnet-snap targets for the Stage 2 "Draw a tract" tool: every other
 *  tract's boundary rings, plus whatever Regrid parcel edges are on
 *  screen near the click (queried live off the rendered tile, since we
 *  do not have Regrid's own polygon geometry loaded client-side). */
function snapTargetsNear(
  map: maplibregl.Map, screenPt: { x: number; y: number }, tracts: Tract[],
): SnapTarget[] {
  const targets: SnapTarget[] = []
  for (const t of tracts) {
    for (const rings of t.boundary) for (const ring of rings) targets.push({ ring })
  }
  if (map.getLayer('regrid-parcels-line')) {
    const pad = 40
    const feats = map.queryRenderedFeatures(
      [[screenPt.x - pad, screenPt.y - pad], [screenPt.x + pad, screenPt.y + pad]] as any,
      { layers: ['regrid-parcels-line'] })
    for (const f of feats) {
      const g: any = f.geometry
      if (g.type === 'LineString') targets.push({ ring: g.coordinates as Pt[] })
      else if (g.type === 'MultiLineString') for (const l of g.coordinates) targets.push({ ring: l as Pt[] })
      else if (g.type === 'Polygon') for (const r of g.coordinates) targets.push({ ring: r as Pt[] })
      else if (g.type === 'MultiPolygon') for (const poly of g.coordinates) for (const r of poly) targets.push({ ring: r as Pt[] })
    }
  }
  return targets
}

export default function ConfigureMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)

  // ── Tracts: the owner's Stage 2/3 unit of ground ───────────────────
  // Stage 2 will hold many; Stage 3 edits one at a time via
  // `selectedTractId`. `detail`/`shapes`/`boundaryRings`/`editingTypes`/
  // `editingId`/`name`/`sources` below are DERIVED from the selected
  // tract so the rest of this file (mutate, the map handlers registered
  // once on load, the JSX) reads them exactly as it always has — only
  // where the value COMES FROM moved, not its shape or its call sites.
  // 'project' shows first on a blank visit (owner process: name the
  // project before anything else); every boot path that already has a
  // parcel/project/tract to open (?parcel=, ?project=, ?ll_uuid=) moves
  // itself past this the moment it has something to show.
  const [stage, setStage] = useState<'project' | 'tracts' | 'landtypes'>('project')
  const [tracts, setTracts] = useState<Tract[]>([])
  const [selectedTractId, setSelectedTractId] = useState<string | null>(null)
  // A multi-parcel FRAME a set of tracts gets fit to ('Snap tracts' /
  // 'Snap to Parcel') — either combined already (from `frameParcels`) or,
  // for a single-parcel frame, that parcel's own boundary.
  const [frame, setFrame] = useState<{ ll_uuids: string[]; boundary: Pt[][][] } | null>(null)
  // Parcels clicked with the "Select frame parcels" tool armed, waiting
  // to be combined into `frame` the next time 'Snap tracts' runs.
  const [frameParcels, setFrameParcels] = useState<{ ll_uuid: string; geometry: any }[]>([])
  const selectedTractIdRef = useRef(selectedTractId); selectedTractIdRef.current = selectedTractId
  const tractsRef = useRef(tracts); tractsRef.current = tracts
  const stageRef = useRef(stage); stageRef.current = stage
  const frameRef = useRef(frame); frameRef.current = frame
  const frameParcelsRef = useRef(frameParcels); frameParcelsRef.current = frameParcels

  // ── Stage 2's OWN undo/redo — boundary-level, separate from Stage 3's
  // shape stack below (`undoRef`/`redoRef`). One entry per tract ADDED,
  // REMOVED, DRAWN, snapped (`snapTracts`), or dragged (one entry per
  // drag, not per mousemove — same discipline as the shape stack). Same
  // snapshot-outside-the-updater shape as `snapshot`/`mutate` below, for
  // the same reason: snapshotting inside a state updater is a side
  // effect React may run twice.
  const tractUndoRef = useRef<Tract[][]>([])
  const tractRedoRef = useRef<Tract[][]>([])
  const [, forceTractHist] = useState(0)
  const snapshotTracts = useCallback((prev: Tract[]) => {
    tractUndoRef.current.push(JSON.parse(JSON.stringify(prev)))
    if (tractUndoRef.current.length > 100) tractUndoRef.current.shift()
    tractRedoRef.current = []
    forceTractHist((t) => t + 1)
  }, [])
  const undoTracts = useCallback(() => {
    const p = tractUndoRef.current.pop(); if (!p) return
    setTracts((cur) => { tractRedoRef.current.push(JSON.parse(JSON.stringify(cur))); return p })
    setSelectedTractId((cur) => (p.some((t) => t.id === cur) ? cur : (p[0]?.id ?? null)))
    forceTractHist((t) => t + 1)
  }, [])
  const redoTracts = useCallback(() => {
    const n = tractRedoRef.current.pop(); if (!n) return
    setTracts((cur) => { tractUndoRef.current.push(JSON.parse(JSON.stringify(cur))); return n })
    setSelectedTractId((cur) => (n.some((t) => t.id === cur) ? cur : (n[0]?.id ?? null)))
    forceTractHist((t) => t + 1)
  }, [])

  /** Update the OPEN tract only, reading which one that is from a ref —
   *  the map handlers below are registered once (`map.on(..., [])`) and
   *  can never close over a fresh `selectedTractId`, so every write here
   *  has to go through `selectedTractIdRef` the same way the rest of
   *  this file reads current state from inside those handlers. */
  const updateActiveTract = useCallback((fn: (t: Tract) => Tract) => {
    setTracts((prev) => prev.map((t) =>
      t.id === selectedTractIdRef.current ? fn(t) : t))
  }, [])

  /** Stage 2: ADD a tract to the list rather than replacing it — a
   *  parcel click or a free-hand draw builds the list one tract at a
   *  time (owner process). Appending onto an empty list is exactly
   *  `openTract`'s effect, so this is the only tract-creation path Stage
   *  2 needs. */
  const addTract = useCallback((overrides: Partial<Tract> = {}) => {
    const t = newTract(overrides)
    snapshotTracts(tractsRef.current)
    setTracts((prev) => [...prev, t])
    setSelectedTractId(t.id)
    return t
  }, [snapshotTracts])

  const activeTract = useMemo(
    () => tracts.find((t) => t.id === selectedTractId) ?? null,
    [tracts, selectedTractId])

  const detail = activeTract?.detail ?? null
  const shapes = activeTract?.shapes ?? []
  // The parcel outline while it is still editable. Rings, like a shape.
  const boundaryRings = activeTract?.boundary ?? []
  const editingTypes = activeTract?.editingTypes ?? true
  const editingId = activeTract?.savedId ?? null
  const name = activeTract?.name ?? ''
  // Every Regrid parcel folded into this tract, for provenance. Empty
  // for a hand-drawn tract — there is no parcel to attribute it to.
  const sources = activeTract?.source.kind === 'parcel' ? activeTract.source.ll_uuids : []

  const setDetail = useCallback((d: ParcelDetail | null) => {
    updateActiveTract((t) => ({ ...t, detail: d }))
  }, [updateActiveTract])
  const setShapes = useCallback((v: Shape[] | ((prev: Shape[]) => Shape[])) => {
    updateActiveTract((t) => ({
      ...t, shapes: typeof v === 'function' ? (v as (p: Shape[]) => Shape[])(t.shapes) : v,
    }))
  }, [updateActiveTract])
  const setBoundaryRings = useCallback((v: Pt[][][] | ((prev: Pt[][][]) => Pt[][][])) => {
    updateActiveTract((t) => ({
      ...t, boundary: typeof v === 'function' ? (v as (p: Pt[][][]) => Pt[][][])(t.boundary) : v,
    }))
  }, [updateActiveTract])
  const setEditingTypes = useCallback((v: boolean) => {
    updateActiveTract((t) => ({ ...t, editingTypes: v }))
  }, [updateActiveTract])
  const setEditingId = useCallback((v: string | null) => {
    updateActiveTract((t) => ({ ...t, savedId: v }))
  }, [updateActiveTract])
  const setName = useCallback((v: string) => {
    updateActiveTract((t) => ({ ...t, name: v }))
  }, [updateActiveTract])
  const setSources = useCallback((v: string[]) => {
    updateActiveTract((t) => (
      t.source.kind === 'parcel' ? { ...t, source: { kind: 'parcel', ll_uuids: v } } : t))
  }, [updateActiveTract])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawClass, setDrawClass] = useState<LandClass>('tillable')
  const [drawing, setDrawing] = useState(false)
  // 'draw' adds a classified land-type polygon (Stage 3); 'drawtract'
  // free-hand draws a new TRACT boundary (Stage 2, magnet-snapped);
  // 'frame' picks the parcels that make up a multi-parcel FRAME (Stage
  // 2); 'cutpoly' takes the two clicks that cut something in half — the
  // parcel in Stage 2, the selected land type in Stage 3.
  const [tool, setTool] = useState<'draw' | 'drawtract' | 'frame' | 'cutpoly' | 'erase' | null>(null)
  // The two clicks that cut the SELECTED polygon in half.
  const [cutPts, setCutPts] = useState<Pt[]>([])
  // Rubber-band box for erasing many points at once.
  const [marq, setMarq] = useState<[Pt, Pt] | null>(null)
  // Which report kind is being queued right now. The spinner then hands
  // over to the row's own queued/running status, so the button keeps
  // spinning until the file is actually built rather than stopping the
  // moment the request returns.
  const [queuing, setQueuing] = useState<string | null>(null)
  // Cancel throws away work, so it asks first.
  // Both of these throw away work, so both ask first.
  const [confirmWhat, setConfirmWhat] = useState<null | 'cancel' | 'outline' | 'switch' | 'leave' | 'removeTract'>(null)
  /** The tract `removeTract` is waiting on a 'removeTract' confirm for —
   *  set only when that tract is already saved server-side. */
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Pt[]>([])

  // Project context. A single-parcel user never sees this: leaving it
  // blank makes the server create a project named after the parcel.
  const [projectId, setProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const projectNameRef = useRef(''); projectNameRef.current = projectName
  const [reports, setReports] = useState<ReportRow[]>([])
  const [deletingReport, setDeletingReport] = useState<string | null>(null)
  /** ?reports=1 (the portfolio's Reports button) opens the tract in
   *  VIEW mode and brings the reports into view — no edit mode, no
   *  hunting down a long panel. */
  const reportsRef = useRef<HTMLDivElement | null>(null)
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
    // Snapshot OUTSIDE the updater. It used to run inside, which is a
    // side effect where React is allowed to run the updater twice — so
    // one edit pushed two undo entries, and the forceHist that re-enables
    // the Undo button never reliably fired, leaving the button dead.
    snapshot(shapesRef.current)
    setShapes(fn)
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

  /** AUDIT HIGH: this shape-level stack belongs to whichever tract is
   *  open, and used to only be cleared on SOME of the paths that change
   *  `selectedTractId` (a fresh parcel load, a re-classify) — not
   *  `openLocalTract` (switching to an existing tract already in the
   *  session) or the save-and-switch confirm, both of which go through
   *  it. Undo on tract B could then pop an entry pushed while tract A
   *  was open, overwriting B's shapes with A's. One place, keyed on the
   *  tract itself, catches every switch regardless of path. */
  useEffect(() => {
    undoRef.current = []; redoRef.current = []
    forceHist((t) => t + 1)
  }, [selectedTractId])

  // ── load a parcel ─────────────────────────────────────────────────
  /** ADDS a tract to Stage 2's list — the common path (owner process:
   *  "click a parcel on the map"). Appending onto an empty list is the
   *  same thing as starting it, so the very first parcel and every one
   *  after it go through the same call. */
  const loadParcel = useCallback(async (llUuid: string) => {
    // Same parcel twice (a double click, or React re-running the URL boot)
    // must not become two tracts — select the one already in the list.
    const dup = tractsRef.current.find((x) =>
      x.source.kind === 'parcel' && x.source.ll_uuids.length === 1 && x.source.ll_uuids[0] === llUuid)
    if (dup) { setSelectedTractId(dup.id); return dup }
    setBusy('Loading parcel…'); setError(null); setSavedMsg(null)
    try {
      const d = await fetchParcel(llUuid)
      const rings = geometryToPolys(d.boundary)
      const t = addTract({
        detail: d, boundary: rings, shapes: [],
        source: { kind: 'parcel', ll_uuids: [llUuid] },
        name: d.parcel?.parcelnumb ? `Parcel ${d.parcel.parcelnumb}` : '',
      })
      undoRef.current = []; redoRef.current = []
      // Owner (9/15): the project is NAMED before tracts are built. A parcel
      // arriving with no project name yet lands on Stage 1 with the parcel
      // already on the map; once named, every later parcel stays in Stage 2.
      setStage(projectNameRef.current.trim() ? 'tracts' : 'project')
      markCleanRef.current?.([], rings)
      setSelectedId(null)
      setSavedName('')
      setHits([])
      const bb = bboxOf(d.boundary?.coordinates)
      if (bb && mapRef.current) mapRef.current.fitBounds(bb, { padding: 90, duration: 700 })
      return t
    } catch (e: any) {
      setError(e?.message || 'Could not load that parcel.')
      return null
    } finally { setBusy(null) }
  }, [addTract])
  const loadParcelRef = useRef(loadParcel); loadParcelRef.current = loadParcel

  // ── open from the Map Portfolio (?parcel= / ?project=) ────────────
  // or from Explore's "Configure Map" button (?ll_uuid=&stage=tracts) ─
  const bootedRef = useRef(false)
  useEffect(() => {
    if (!ready || bootedRef.current) return   // once per page load, not per effect re-run
    bootedRef.current = true
    const params = new URLSearchParams(window.location.search)
    const proj = params.get('project')
    const saved = params.get('parcel')
    // ?ll_uuid= is a REGRID parcel, not a saved tract id — ?parcel=
    // keeps meaning the latter, so a saved-tract link still wins if both
    // somehow show up. Goes through the exact same /api/mapping/parcel
    // fetch a map click does (loadParcel), so this is not a separate
    // boot path to keep in sync — just a second way to kick it off.
    const llUuid = params.get('ll_uuid')
    if (proj) setProjectId(proj)
    // 'Add tract' passes new=1: stay on a blank canvas inside this
    // project instead of reopening the tract that is already there — a
    // project is already named, so Stage 1 has nothing left to ask.
    if (!saved && proj && params.get('new') === '1') { setStage('tracts'); return }
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
          if (!r.parcels?.length) { setStage('tracts'); return }
          const url = new URL(window.location.href)
          url.searchParams.set('parcel', r.parcels[0].id)
          window.location.replace(url.toString())
        } catch { /* leave the blank canvas */ }
      })()
      return () => { stop = true }
    }
    // Explore's "Configure Map" button (?ll_uuid=&stage=tracts) and a
    // parcel click both land here. loadParcel always lands on Stage 2
    // itself (below), so a fresh visit skips Stage 1's name prompt —
    // this parcel becomes tract 1 and the project gets an automatic name
    // if it is never given one before Save.
    if (!saved && llUuid) { void loadParcelRef.current?.(llUuid); return }
    if (!saved) return
    void openSavedTractRef.current?.(saved, params.get('edit') === '1')
  }, [ready])

  /** Open a saved tract into the editor. Extracted from the ?parcel=
   *  boot path so clicking another tract on the map can reuse it. */
  const openLocalTractRef = useRef<((id: string) => boolean) | null>(null)
  const openSavedTract = useCallback(async (saved: string, startEditing = false) => {
    // Already in the session's local list (e.g. a peer badge on the map
    // for a tract that was itself opened earlier this session) — select
    // it rather than fetching and re-adding it. Without this dedupe,
    // requestOpen's fallback (a peer whose id is not a LOCAL tract id,
    // because it is keyed by the server's savedId) landed here every
    // time, and this used to hand the result to openTract, which
    // REPLACED the whole Stage 2 list — silently discarding every other
    // tract, saved or not.
    const already = tractsRef.current.find((t) => t.savedId === saved)
    // Already in this session's list: open it the way any local tract is
    // opened (clean fingerprint, classification, recentre) — a bare select
    // left it looking "unsaved" and unclassified (auditor 2026-09-15).
    if (already) { openLocalTractRef.current?.(already.id); return }
    let cancelled = false
    await (async () => {
      setBusy('Opening saved parcel…')
      try {
        const rec = await getSavedParcel(saved)
        if (cancelled) return
        setProjectId(rec.project_id)
        setSavedName(rec.name)
        if (rec.project_id) {
          getProject(rec.project_id)
            .then((r) => { if (!cancelled && r.project?.name) setProjectName(r.project.name) })
            .catch(() => { /* the name is a label, not load-bearing */ })
        }
        const loadedShapes = simplifyShapes(explodeShapes(rec.polygons as any))
        const loadedRings = geometryToPolys(rec.boundary)
        // Every field goes into ONE addTract call rather than a
        // sequence of setDetail/setShapes/setName calls — those write
        // through a ref (updateActiveTract reads selectedTractIdRef) that
        // only catches up on the NEXT render, so chaining them right
        // after the tract that ref is about to point at is created would
        // silently miss the brand-new tract and write nothing. addTract
        // APPENDS to the list (and snapshots it for undo) — this used to
        // go through openTract, which replaced the whole list.
        addTract({
          savedId: rec.id,
          name: rec.name,
          source: { kind: 'parcel', ll_uuids: rec.source_ll_uuids || [] },
          saved: true,
          classified: true,
          acres: rec.stats?.acres ?? null,
          shapes: loadedShapes,
          boundary: loadedRings,
          // The outline has to come across too. Without this it kept the
          // PREVIOUS tract's rings: the panel then read as having unsaved
          // changes the moment a tract opened, and 'Edit outline' would
          // have handed you the wrong tract's boundary to drag.
          detail: {
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
          },
          // Opened to LOOK at by default; the portfolio's Edit button asks
          // for the tools up front so it does not take two clicks to get
          // to the thing you pressed Edit for.
          editingTypes: startEditing,
        })
        markCleanRef.current?.(loadedShapes, loadedRings)
        // Opened from the portfolio to LOOK at, not to edit: show the
        // land types straight away and keep the editing tools away until
        // the user asks for them.
        setStage('landtypes')
        setSelectedId(null)
        const bb = bboxOf(rec.boundary?.coordinates)
        if (bb && mapRef.current) mapRef.current.fitBounds(bb, { padding: 90, duration: 700 })
      } catch (e: any) {
        setError(e?.message || 'Could not open that saved parcel.')
      } finally { setBusy(null) }
    })()
  }, [addTract])
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
      // React 18 double-mounts this effect in development: the FIRST
      // mount's map can be .remove()'d (cleanup below) while this is
      // still awaiting the config fetch. Every maplibre call after this
      // point — addLayer, getLayer, addImage, getSource in the effects
      // further down that this 'load' handler unblocks via `ready` —
      // throws "Cannot read properties of undefined" once the map is
      // removed, because .remove() tears down its internal style. Bail
      // out before touching `map` again; the newer mount's own 'load'
      // handler runs this same setup for the live map.
      if (mapRef.current !== map) return
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

      // ── Stage 2's multi-parcel FRAME, under everything else ────────
      // Either being built (one feature per parcel clicked with "Select
      // frame parcels") or already the combined 'Snap tracts' frame.
      map.addLayer({
        id: 'cm-frame-fill', type: 'fill', source: SRC.frame,
        paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.10 },
      })
      map.addLayer({
        id: 'cm-frame-line', type: 'line', source: SRC.frame,
        paint: { 'line-color': '#60a5fa', 'line-width': 2.5, 'line-dasharray': [3, 2] },
      })

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
      // Invisible, and there purely so a click anywhere ON another
      // tract switches to it. Only the badge used to be clickable, which
      // is a 100px target on a 600-acre field.
      map.addLayer({
        id: 'cm-peer-bounds-hit', type: 'fill', source: SRC.peerLine,
        paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.001 },
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
        // Repainted from `drawClass` below — a shape being drawn as water
        // has to look like water, not like every other shape.
        paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
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
          'circle-stroke-color': VERTEX_LINE,   // repainted from drawClass
          'circle-stroke-width': 3,
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
      // Stage 2's own undo entry for a boundary drag — one per drag, not
      // per mousemove, same discipline as `took` below for shapes.
      let tookTract = false
      map.on('mousedown', LYR_VERTS, (e) => {
        // Belt and braces with the layer being empty in view mode.
        if (stageRef.current !== 'tracts' && !editingTypesRef.current) return
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
        if (owner === '__boundary__' && stageRef.current === 'tracts'
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
        tookTract = false
        map.dragPan.disable()
      })
      map.on('mousemove', (e) => {
        if (!drag) return
        // One undo snapshot per drag, not per mousemove.
        const { id, pi, ri, vi } = drag
        if (id === '__boundary__') {
          let newPt: Pt = [e.lngLat.lng, e.lngLat.lat]
          // After a fit, an OUTER vertex (one that sits on the frame's
          // own edge) stays projected onto it as it is dragged — the
          // frame is the true boundary; a tract's own edge is only ever
          // a piece of it.
          if (frameRef.current) {
            const snapped = snapPoint(
              map, newPt, frameRef.current.boundary.flat().map((ring) => ({ ring })), 30)
            if (snapped.snapped) newPt = snapped.point
          }
          if (!tookTract) { snapshotTracts(tractsRef.current); tookTract = true }
          setTracts((prev) => {
            const active = prev.find((t) => t.id === selectedTractIdRef.current)
            const oldPt = active?.boundary[pi]?.[ri]?.[vi]
            return prev.map((t) => {
              if (t.id === selectedTractIdRef.current) {
                return {
                  ...t,
                  boundary: t.boundary.map((rings, p2) => p2 !== pi ? rings
                    : rings.map((r, i) => i !== ri ? r
                      : r.map((pt, v) => v === vi ? newPt : pt))),
                }
              }
              // Shared-edge sync: a vertex another tract has at the SAME
              // point (the fence two neighbouring tracts were just fit
              // to share) moves along with it, so dragging one side of a
              // shared boundary cannot open a gap or an overlap on the
              // other.
              if (!oldPt) return t
              let touched = false
              const boundary = t.boundary.map((rings) => rings.map((r) => r.map((pt) => {
                if (Math.abs(pt[0] - oldPt[0]) < 1e-9 && Math.abs(pt[1] - oldPt[1]) < 1e-9) {
                  touched = true
                  return newPt
                }
                return pt
              })))
              return touched ? { ...t, boundary } : t
            })
          })
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
        if (stageRef.current !== 'tracts') return
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
        if (stageRef.current === 'tracts') map.getCanvas().style.cursor = 'copy'
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

        // Clicking another tract — anywhere on it, not just its badge —
        // switches to that tract. requestOpen enforces the unsaved-work
        // confirmation. This has to come BEFORE the guard below, which
        // otherwise swallows every click while a parcel is open.
        if (map.getLayer('cm-peer-bounds-hit')) {
          const onPeer = map.queryRenderedFeatures(e.point, { layers: ['cm-peer-bounds-hit'] })
          const peerId = onPeer[0]?.properties?.tractId
          if (peerId && toolRef.current === null && !drawingRef.current) {
            requestOpenRef.current?.(String(peerId))
            return
          }
        }
        // A click on the outline during step 1 means "add a handle here"
        // and is handled by the layer listener above; letting it fall
        // through would also try to select a parcel underneath.
        if (stageRef.current === 'tracts'
            && map.queryRenderedFeatures(e.point, { layers: ['cm-boundary-line'] }).length) return
        // "Select frame parcels": each click toggles that parcel into (or
        // out of) the set 'Snap tracts' will combine into the frame.
        if (toolRef.current === 'frame') {
          const onFrameParcel = map.queryRenderedFeatures(e.point, { layers: ['regrid-parcels-fill'] })
          const fprops = onFrameParcel[0]?.properties || {}
          const fpid = fprops.ll_uuid || fprops.ll_uuid_text || fprops.path
          if (fpid) void toggleFrameParcelRef.current(String(fpid))
          return
        }
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
          let pt: Pt = [e.lngLat.lng, e.lngLat.lat]
          // "Draw a tract": magnet-snap the corner onto another tract's
          // edge or a live Regrid parcel line within ~30 ft (owner spec)
          // so two tracts meant to share a fence actually do.
          if (toolRef.current === 'drawtract') {
            const targets = snapTargetsNear(map, e.point, tractsRef.current)
            const snapped = snapPoint(map, pt, targets, 30)
            if (snapped.snapped) pt = snapped.point
          }
          setDraft((d) => [...d, pt])
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
        // Stage 3 (land types): a tract is open for CLASSIFYING, so a
        // stray click on the map must not load another parcel or reload
        // this one — reloading rebuilt the outline from the database, so
        // a stray click anywhere silently threw away every dot the user
        // had moved. Switching tracts is deliberate — it goes through
        // the tract list / a badge click.
        //
        // Stage 2 (tracts) is different: clicking a parcel there is the
        // common way to ADD another tract to the list (owner process),
        // so an already-open tract must NOT block it.
        if (detailRef.current && stageRef.current !== 'tracts') { setSelectedId(null); return }

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
      if (toolRef.current === 'drawtract') {
        // Stage 2: a free-hand tract, added to the list like any other.
        addTract({ boundary: [[ring]], shapes: [], source: { kind: 'drawn' } })
        undoRef.current = []; redoRef.current = []
      } else {
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
    }
    setDraft([]); setDrawing(false); setTool(null)
  }, [mutate, addTract])

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

  /** Stage 2 -> Stage 3, ONE TRACT. Ask the ENGINE for the land types
   *  under the boundary the tract actually has right now — its original
   *  parcel outline, a hand-drawn shape, or whatever 'Snap tracts' just
   *  rewrote it to.
   *
   *  This used to clip `detail.polygons` — whatever the parcel loaded
   *  with — to the new boundary. That can only ever remove ground, so
   *  enlarging a boundary left the new part blank, and it carried
   *  forward whatever the first read produced. Re-asking the engine is
   *  correct in both directions and is the same call the parcel click
   *  makes.
   *
   *  Runs once per tract per boundary: `classified` gates it so picking
   *  a tract you have already opened in Stage 3 does not re-query the
   *  engine every time — only a fresh tract, or one 'Snap tracts' just
   *  moved (which resets `classified` to false), pays for the call. */
  const ensureClassified = useCallback(async (tractId: string) => {
    const t = tractsRef.current.find((x) => x.id === tractId)
    if (!t || t.classified) return
    const geom = polysToGeometry(t.boundary)
    if (!geom) return
    const state = t.detail?.parcel?.state ?? null
    setBusy('Fitting land types to the boundary…'); setError(null)
    try {
      const fresh = await classifyBoundary(geom, state)
      // Still normalise: the engine's classes are disjoint, but the user
      // may already have drawn shapes of their own over them.
      const res = await normalizeGeometry(
        geom, fresh.polygons.map((p) => ({ cls: p.cls, geometry: p.geometry })))
      if (!fresh.engine_covered) {
        setError('Part of this boundary is outside the mapped area — '
               + 'the land types there have not been filled in.')
      }
      const loaded = simplifyShapes(explodeShapes(res.polygons as any))
      setTracts((prev) => prev.map((x) => x.id !== tractId ? x : {
        ...x,
        shapes: loaded,
        classified: true,
        detail: x.detail ? { ...x.detail, boundary: geom } : x.detail,
      }))
      if (tractId === selectedTractIdRef.current) {
        markCleanRef.current?.(loaded, t.boundary)
        setEditingTypes(true)
        undoRef.current = []; redoRef.current = []
        setSelectedId(loaded.length
          ? loaded.reduce((a, b) => (shapeAcres(b) > shapeAcres(a) ? b : a)).id
          : null)
      }
    } catch (e: any) {
      setError(e?.message || 'Could not fit the land types to that boundary.')
    } finally { setBusy(null) }
  }, [])

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

  // ── split / open-saved ────────────────────────────────────────────

  /** Cut the boundary with the drawn line. Pieces come back largest
   *  first so they can be named Tract 1, Tract 2, … sensibly. */

  /** Cut the SELECTED land-type polygon in two along the line between the
   *  user's two clicks. The line is extended well past both clicks so a
   *  click landing just inside the polygon still cuts clean through
   *  instead of failing with "that line did not cut". */
  const runCut = useCallback(async (line: Pt[]) => {
    // Step 1 cuts the PARCEL into tracts; step 2 cuts the selected land
    // type polygon. Same two-click gesture either way.
    const onBoundary = stageRef.current === 'tracts'
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
    if (stageRef.current === 'tracts') {
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

  /** Drop a tract from Stage 2's list. A tract that was already saved
   *  this session (has a `savedId`) is archived server-side too — same
   *  endpoint `savePieces` uses to retire a since-divided parcel — but
   *  only after a confirm, since that side is not undoable from here
   *  (Stage 2's own undo stack only ever restores the LOCAL list). A
   *  tract never saved just drops straight out. */
  const removeTract = useCallback((id: string) => {
    const t = tractsRef.current.find((x) => x.id === id)
    if (t?.savedId) {
      setPendingRemoveId(id)
      setConfirmWhat('removeTract')
      return
    }
    snapshotTracts(tractsRef.current)
    setTracts((prev) => prev.filter((x) => x.id !== id))
    setSelectedTractId((cur) => (cur === id ? null : cur))
  }, [snapshotTracts])

  /** Confirmed removal of a tract that is already saved server-side:
   *  archive it there FIRST, then drop it locally — in that order, so a
   *  failed archive leaves the tract in the list instead of vanishing
   *  from the screen while the server still has the record. */
  const removeSavedTract = useCallback(async (id: string) => {
    const t = tractsRef.current.find((x) => x.id === id)
    if (!t?.savedId) return
    setBusy('Removing tract…'); setError(null)
    try {
      await archiveParcel(t.savedId)
      snapshotTracts(tractsRef.current)
      setTracts((prev) => prev.filter((x) => x.id !== id))
      setSelectedTractId((cur) => (cur === id ? null : cur))
    } catch (e: any) {
      setError(e?.message || 'Could not remove that tract.')
    } finally { setBusy(null) }
  }, [snapshotTracts])

  /** A parcel clicked with the "Select frame parcels" tool armed. Toggles
   *  it in or out of the set waiting to be combined into `frame` the next
   *  time 'Snap tracts' runs — fetched once and cached on the toggle, not
   *  re-fetched every render. */
  const toggleFrameParcel = useCallback(async (llUuid: string) => {
    if (frameParcelsRef.current.some((p) => p.ll_uuid === llUuid)) {
      setFrameParcels((prev) => prev.filter((p) => p.ll_uuid !== llUuid))
      return
    }
    try {
      const d = await fetchParcel(llUuid)
      setFrameParcels((prev) => (prev.some((p) => p.ll_uuid === llUuid)
        ? prev : [...prev, { ll_uuid: llUuid, geometry: d.boundary }]))
    } catch (e: any) {
      setError(e?.message || 'Could not load that parcel.')
    }
  }, [])
  const toggleFrameParcelRef = useRef(toggleFrameParcel); toggleFrameParcelRef.current = toggleFrameParcel

  /** 'Select frame parcels' → Done. The frame is a WHOLE-PROJECT
   *  boundary — `snapTracts` below fits EVERY tract to it, not just
   *  ones added since — so finishing frame selection with parcels
   *  chosen means no tract still sourced from a single old assessor
   *  parcel will keep that shape (owner, re: the Hiland scenario: "none
   *  of the current parcels will be the same shape"). Those drop
   *  automatically here, in one Stage 2 undo entry, so Undo restores
   *  them. A hand-drawn tract has no parcel behind it to go stale and
   *  is always kept. No-op if nothing was picked (tool just disarms). */
  const finishFrameSelection = useCallback(() => {
    setTool(null)
    const n = frameParcelsRef.current.length
    if (!n) return
    const stale = tractsRef.current.filter((t) => t.source.kind === 'parcel')
    if (!stale.length) return
    snapshotTracts(tractsRef.current)
    setTracts((prev) => prev.filter((t) => t.source.kind !== 'parcel'))
    setSelectedTractId((cur) => (stale.some((t) => t.id === cur) ? null : cur))
    setSavedMsg(`Frame set from ${n} parcel${n === 1 ? '' : 's'} — draw your tracts inside it.`)
  }, [snapshotTracts])

  /** 'Snap tracts' / 'Snap to Parcel' (design spec §2, §4). Builds the
   *  FRAME — the picked frame parcels combined, or (no frame picked) a
   *  single tract's own source parcel, or (neither) every tract's own
   *  boundary combined into one shape they are fit against each other —
   *  then calls the server's fit-tracts endpoint, which is the only
   *  source of truth for the resulting acres (never sum client acres for
   *  a frame total). Resets `classified` on every touched tract so Stage
   *  3 re-asks the engine for the boundary that actually got saved. */
  const snapTracts = useCallback(async () => {
    if (!tracts.length) return
    setBusy('Snapping tracts…'); setError(null)
    try {
      let frameGeom: any = null
      let frameMeta: { ll_uuids: string[]; boundary: Pt[][][] } | null = null
      if (frameParcels.length >= 2) {
        frameGeom = (await combineGeometry(frameParcels.map((p) => p.geometry))).geometry
        frameMeta = { ll_uuids: frameParcels.map((p) => p.ll_uuid), boundary: geometryToPolys(frameGeom) }
      } else if (frameParcels.length === 1) {
        frameGeom = frameParcels[0].geometry
        frameMeta = { ll_uuids: [frameParcels[0].ll_uuid], boundary: geometryToPolys(frameGeom) }
      } else if (tracts.length === 1 && tracts[0].source.kind === 'parcel' && tracts[0].detail?.boundary) {
        // 'Snap to Parcel': the lone tract's own source parcel IS the frame.
        frameGeom = tracts[0].detail.boundary
        frameMeta = { ll_uuids: tracts[0].source.ll_uuids, boundary: geometryToPolys(frameGeom) }
      } else {
        const own = tracts.map((t) => polysToGeometry(t.boundary)).filter(Boolean)
        frameGeom = own.length > 1 ? (await combineGeometry(own)).geometry : own[0]
      }
      if (!frameGeom) {
        setError('Nothing to snap to yet — draw a tract, or select frame parcels, first.')
        return
      }
      setFrame(frameMeta)
      const payload = tracts.map((t) => ({ id: t.id, geometry: polysToGeometry(t.boundary) }))
        .filter((x) => x.geometry) as { id: string; geometry: any }[]
      const res = await fitTracts(frameGeom, payload)
      snapshotTracts(tractsRef.current)
      setTracts((prev) => prev.map((t) => {
        const hit = res.tracts.find((r) => r.id === t.id)
        if (!hit) return t
        return { ...t, boundary: geometryToPolys(hit.geometry), acres: hit.acres, classified: false, shapes: [] }
      }))
      if (res.dropped.length) {
        setError(`${res.dropped.length} tract${res.dropped.length === 1 ? '' : 's'} `
          + 'had no ground left after fitting to the frame — check the list.')
      } else {
        setSavedMsg(`Fit ${res.tracts.length} tract${res.tracts.length === 1 ? '' : 's'} `
          + `to ${res.frame_acres.toFixed(1)} ac.`)
      }
    } catch (e: any) {
      setError(e?.message || 'Could not snap these tracts.')
    } finally { setBusy(null) }
  }, [tracts, frameParcels, snapshotTracts])

  /** Stage 2 -> Stage 3: pick which tract opens (whatever is already
   *  selected, else the first one) and lazily classify it. Gated on
   *  every tract being named — the footer button is disabled otherwise,
   *  this is belt-and-braces. */
  const continueToLandTypes = useCallback(() => {
    if (!tracts.length || tracts.some((t) => !t.name.trim())) return
    const openId = tracts.some((t) => t.id === selectedTractId) ? selectedTractId! : tracts[0].id
    setSelectedTractId(openId)
    setStage('landtypes')
    void ensureClassified(openId)
  }, [tracts, selectedTractId, ensureClassified])

  /** Guards `saveAllTracts` against firing twice for one click. The
   *  footer button already disables on `busy`, but that disables the
   *  DOM node on the NEXT render — a second click (or a stray second
   *  event for the same click) arriving before that commit paints would
   *  otherwise start a second pass through the loop below with the same
   *  stale `tracts` closure (every tract's `savedId` still null), racing
   *  its own POSTs against the first pass's and creating duplicate
   *  records for tracts that were about to get one. A plain ref is
   *  checked and set synchronously, before any `await`, so there is no
   *  gap for a second call to slip through. */
  const savingAllRef = useRef(false)

  /** Save EVERY named tract as its own record, all in the same project —
   *  the tracts-first equivalent of `savePieces` above, generalised to
   *  the whole list rather than one split's leftover pieces. */
  const saveAllTracts = useCallback(async (): Promise<boolean> => {
    if (savingAllRef.current) return false
    if (!tracts.length) return false
    if (tracts.some((t) => !t.name.trim())) {
      setError('Name every tract before saving.')
      return false
    }
    savingAllRef.current = true
    setBusy('Saving…'); setError(null); setSavedMsg(null)
    try {
      let pid = projectId
      for (const t of tracts) {
        const boundaryGeom = polysToGeometry(t.boundary) || t.detail?.boundary
        const payload = {
          name: t.name.trim(),
          boundary: boundaryGeom,
          polygons: t.shapes
            .map((s) => ({ cls: s.cls, geometry: polysToGeometry(s.polys) }))
            .filter((p) => p.geometry) as any,
          source_ll_uuids: t.source.kind === 'parcel' ? t.source.ll_uuids : [],
          project_id: pid,
          project_name: projectName || null,
        }
        const res = t.savedId
          ? await updateParcel(t.savedId, payload)
          : await saveParcel(payload)
        if (!t.savedId && 'project_id' in res) pid = (res as any).project_id
        const st = res.stats || {}
        setTracts((prev) => prev.map((x) => (x.id !== t.id ? x : {
          ...x,
          saved: true,
          savedId: 'id' in res ? res.id : x.savedId,
          acres: Number(st.acres ?? x.acres ?? 0) || x.acres,
        })))
      }
      setProjectId(pid)
      setSavedMsg(`Saved ${tracts.length} tract${tracts.length === 1 ? '' : 's'}.`)
      markCleanRef.current?.(shapes, boundaryRings)
      return true
    } catch (e: any) {
      setError(e?.message || 'Save failed.')
      return false
    } finally { setBusy(null); savingAllRef.current = false }
  }, [tracts, projectId, projectName, shapes, boundaryRings])

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
    // Mirrored onto the tract itself too — Stage 2's tract LIST will read
    // this per tract (an unsaved-work indicator next to its name) instead
    // of the single top-level `dirty`, which only ever describes whichever
    // tract happens to be open.
    if (selectedTractId) {
      setTracts((prev) => prev.map((t) =>
        t.id === selectedTractId && t.dirty !== d ? { ...t, dirty: d } : t))
    }
  }, [shapes, boundaryRings, fingerprint, selectedTractId])

  /** Switch to a tract already sitting in LOCAL state (Stage 2's list,
   *  built this session and maybe never saved) — no server round trip,
   *  since a brand-new or drawn tract does not exist there to fetch.
   *  Stage 3 lazily classifies it if it has not been already. Returns
   *  false when `id` is not a local tract, so the caller can fall back
   *  to the server-fetch path for a peer from a previously-saved
   *  project that was never loaded into this session's list. */
  const openLocalTract = useCallback((id: string) => {
    const t = tractsRef.current.find((x) => x.id === id)
    if (!t) return false
    setSelectedTractId(id)
    setSelectedId(null)
    markCleanRef.current?.(t.shapes, t.boundary)
    if (stageRef.current === 'landtypes') void ensureClassified(id)
    const geom = polysToGeometry(t.boundary)
    const bb = geom ? bboxOf(geom.coordinates) : null
    if (bb && mapRef.current) mapRef.current.fitBounds(bb, { padding: 90, duration: 700 })
    return true
  }, [ensureClassified])
  openLocalTractRef.current = openLocalTract

  /** Switching to another tract behaves like Cancel: straight through
   *  when nothing is unsaved, otherwise ask — and there OK SAVES and
   *  switches rather than throwing the work away. Tries the LOCAL list
   *  first (Stage 2/3's own tracts), then falls back to fetching a
   *  saved tract that is not in this session's list.
   *
   *  Stage 2 is exempt entirely: every tract there is a draft by design
   *  (the owner's process builds the whole list before land types), so
   *  selecting a row — or a tract's outline/badge on the map — just
   *  switches, no matter what `dirty` says. The guard only matters in
   *  Stage 3, where opening another tract's land types can discard
   *  edits to the one on screen. */
  const requestOpen = useCallback((id: string) => {
    if (id === selectedTractIdRef.current) return
    const doOpen = () => { if (!openLocalTract(id)) void openSavedTractRef.current?.(id) }
    if (stageRef.current !== 'landtypes' || !dirtyRef.current) { doOpen(); return }
    setPendingOpen(id)
    setConfirmWhat('switch')
  }, [openLocalTract])
  requestOpenRef.current = requestOpen

  // ── the rest of the project ───────────────────────────────────────
  // Re-read after every save, because saving is what changes the set —
  // `savedMsg` flips on each completed save, editingId on each open.
  const loadPeers = useCallback(async (pid: string | null) => {
    if (!pid) { setPeers((prev) => (prev.length ? [] : prev)); return }
    try { setPeers((await projectGeometry(pid)).tracts) } catch { /* context only */ }
  }, [])

  useEffect(() => { void loadPeers(projectId) }, [projectId, savedMsg, loadPeers])

  /** Every tract in the project, drawn underneath whatever is selected —
   *  generalised from a single "open tract" to Stage 2/3's whole list,
   *  local (this session's, maybe unsaved) tracts first, then whatever
   *  the server knows about this project that has not been touched this
   *  session (a previously-saved tract nobody has clicked into yet). The
   *  SELECTED tract is skipped for fills/bounds — that one is drawn live
   *  from the editor's own layers (SRC.shapes / SRC.boundary), and a
   *  stale copy underneath it would ghost every edit — but it still gets
   *  a badge, same as everyone else. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    peersRef.current = peers
    const localIds = new Set(tracts.map((t) => t.id))
    const extraPeers = peers.filter((t) => !localIds.has(t.id))
    const fills: any[] = []
    const bounds: any[] = []
    const labels: any[] = []
    for (const t of tracts) {
      if (t.id !== selectedTractId) {
        for (const s of t.shapes) {
          const g = polysToGeometry(s.polys)
          if (g) fills.push({ type: 'Feature', geometry: g, properties: { color: CLASS_COLOR[s.cls] } })
        }
        const bGeom = polysToGeometry(t.boundary)
        if (bGeom) bounds.push({ type: 'Feature', geometry: bGeom, properties: { tractId: t.id } })
      }
      // EVERY tract gets its own badge, always — including the one open
      // right now, from its LIVE outline, so the name tracks what is
      // being typed instead of what was last saved.
      //
      // This used to hide a tract whose label point fell inside the open
      // tract's outline, on the theory that the live badge stood for
      // that ground. It broke the one rule this map has to keep: the
      // name on a badge must belong to the tract that badge opens.
      const c = ringCentre(t.boundary)
      if (c) labels.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: c },
        properties: { name: t.name.trim() || 'Unnamed tract', tractId: t.id },
      })
    }
    for (const t of extraPeers) {
      for (const poly of t.polygons) {
        if (poly.geometry) fills.push({
          type: 'Feature', geometry: poly.geometry,
          properties: { color: CLASS_COLOR[poly.cls] || '#9ca3af' },
        })
      }
      if (t.boundary) bounds.push({
        type: 'Feature', geometry: t.boundary, properties: { tractId: t.id },
      })
      if (t.label_point) labels.push({
        type: 'Feature', geometry: t.label_point,
        properties: { name: t.name || 'Untitled', tractId: t.id },
      })
    }
    ;(map.getSource(SRC.peerFill) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: fills } as any)
    ;(map.getSource(SRC.peerLine) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: bounds } as any)
    ;(map.getSource(SRC.peerLabel) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: labels } as any)
    raisePlaceLabelsRef.current?.()
  }, [peers, tracts, selectedTractId, ready])

  // Stage 2's frame: the parcels picked with "Select frame parcels"
  // (uncombined — this is a preview of the pick, not the fit) or, once
  // 'Snap tracts' has actually run, the combined frame it fit against.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const feats = frame
      ? (() => {
          const g = polysToGeometry(frame.boundary)
          return g ? [{ type: 'Feature', geometry: g, properties: {} }] : []
        })()
      : frameParcels.map((p) => ({ type: 'Feature', geometry: p.geometry, properties: {} }))
    ;(map.getSource(SRC.frame) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: feats } as any)
  }, [frame, frameParcels, ready])

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
    for (const s of (stage === 'tracts' ? [] : shapes)) {
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
    if (stage === 'tracts') {
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
  }, [shapes, selectedId, stage, boundaryRings, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // While the outline is being edited it comes from boundaryRings; once
    // confirmed it is the saved geometry and is drawn as a locked line.
    const geom = stage === 'tracts' ? polysToGeometry(boundaryRings) : detail?.boundary
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
        stage === 'tracts' ? 'visible' : 'none')
    }
  }, [detail, boundaryRings, stage, ready])

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
    // ONLY the tract open in the editor. This used to fall back to
    // "whichever saved tract's boundary contains this outline's centre",
    // which renamed the WRONG tract whenever a saved tract overlapped
    // the parcel being worked on — the name landed on a neighbour and
    // the tract being named never got it. A rename must never guess
    // which row it is writing to.
    //
    // To rename an existing tract, open it: from the Map Portfolio, or
    // by clicking its badge on the map.
    const target = editingId
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
  }, [editingId, name, projectId, loadPeers])

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
    mutate(() => simplifyShapes(explodeShapes(detail.polygons as any)))
    setSelectedId(null)
  }, [detail, mutate])

  const doSave = useCallback(async (): Promise<boolean> => {
    // A hand-drawn tract has no `detail` (no Regrid parcel behind it) —
    // only its own boundary, which is enough to save it.
    if (!activeTract) return false
    const boundaryGeom = polysToGeometry(boundaryRings) || detail?.boundary
    if (!boundaryGeom) return false
    if (!name.trim()) { setError('Give this parcel a name before saving.'); return false }
    setBusy('Saving…'); setError(null); setSavedMsg(null)
    try {
      const payload = {
        name: name.trim(),
        boundary: boundaryGeom,
        polygons: shapes
          .map((s) => ({ cls: s.cls, geometry: polysToGeometry(s.polys) }))
          .filter((p) => p.geometry) as any,
        source_ll_uuids: sources.length
          ? sources
          : [String(detail?.parcel?.ll_uuid)].filter((x) => x && x !== 'null'),
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
      updateActiveTract((t) => ({ ...t, saved: true, acres: Number(st.acres ?? t.acres ?? 0) || t.acres }))
      setTool(null); setDrawing(false); setDraft([]); setCutPts([]); setSelectedId(null)
      return true
    } catch (e: any) {
      setError(e?.message || 'Save failed.')
      return false
    } finally { setBusy(null) }
  }, [activeTract, detail, name, shapes, boundaryRings, sources, projectId, projectName, editingId, updateActiveTract])

  useEffect(() => {
    if (!editingId) return
    try {
      if (new URLSearchParams(window.location.search).get('reports') !== '1') return
    } catch { return }
    // After the panel has laid out with this tract's cards in it.
    const t = window.setTimeout(
      () => reportsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 400)
    return () => window.clearTimeout(t)
  }, [editingId])

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
        setShapes(simplifyShapes(explodeShapes(rec.polygons as any)))
        setName(rec.name); setSavedName(rec.name)
      } catch (e: any) {
        setError(e?.message || 'Could not reload the saved version.')
      } finally { setBusy(null) }
    } else if (detail) {
      setShapes(simplifyShapes(explodeShapes(detail.polygons as any)))
    }
    undoRef.current = []; redoRef.current = []
  }, [editingId, detail])

  /** Cancel, confirmed: drop every edit and close the parcel entirely,
   *  rather than reloading it and leaving it open. */
  const discardAndClose = useCallback(() => {
    setConfirmWhat(null)
    setError(null); setSavedMsg(null); setPieces([]); setTool(null)
    setDrawing(false); setDraft([]); setCutPts([]); setMarq(null)
    setSelectedId(null); setSavedName('')
    // No active tract left, not a blanked-out one — closing empties the
    // whole list rather than routing through updateActiveTract, which
    // would just leave a lone tract sitting there with every field wiped.
    setTracts([]); setSelectedTractId(null); setStage('tracts')
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
    setSelectedId(null); setSavedName('')
    setTracts([]); setSelectedTractId(null); setStage('tracts')
    try {
      window.history.replaceState(
        {}, '', `/configure-map?project=${encodeURIComponent(projectId)}&new=1`)
    } catch { /* history is a convenience, not load-bearing */ }
    undoRef.current = []; redoRef.current = []
  }, [projectId])

  // The draft takes the colour of the land type being drawn, so what you
  // are drawing looks like what it will become.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const c = CLASS_COLOR[drawClass] || '#ffffff'
    if (map.getLayer('cm-draft-line')) map.setPaintProperty('cm-draft-line', 'line-color', c)
    if (map.getLayer('cm-draft-dots')) {
      map.setPaintProperty('cm-draft-dots', 'circle-stroke-color', c)
    }
  }, [drawClass, ready])

  // Recompute the soil rating whenever the tillable ground changes.
  // Debounced by 700 ms so a drag fires one query at the end, not one per
  // mouse move, and keyed on the actual geometry so an unrelated edit
  // (renaming, selecting) does not re-query.
  const tillableKey = useMemo(
    () => shapes.filter((sh) => sh.cls === 'tillable')
      .map((sh) => sh.polys.flat().flat().map((pt) => pt.join(',')).join(';')).join('|'),
    [shapes])

  useEffect(() => {
    if (stage !== 'landtypes' || !detail) { setSoil(null); return }
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
  }, [tillableKey, stage, detail?.boundary])

  // Live totals by class for the panel.
  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const c of LAND_CLASSES) t[c] = 0
    for (const s of shapes) t[s.cls] += shapeAcres(s)
    return t
  }, [shapes])

  // Legend & Acres flash (design spec §5): a class row's background
  // flashes pink for 400ms whenever its acreage actually changes, so an
  // edit's effect on the numbers is visible without staring at them.
  const [flashClasses, setFlashClasses] = useState<Set<string>>(new Set())
  const prevTotalsRef = useRef(totals)
  useEffect(() => {
    const changed = new Set<string>()
    for (const c of LAND_CLASSES) {
      if (Math.abs((prevTotalsRef.current[c] ?? 0) - totals[c]) > 0.05) changed.add(c)
    }
    prevTotalsRef.current = totals
    if (!changed.size) return
    setFlashClasses(changed)
    const t = window.setTimeout(() => setFlashClasses(new Set()), 400)
    return () => window.clearTimeout(t)
  }, [totals])

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

  // The bottom toolbar's hint pill (design spec §2, §7): copy for
  // whichever tool is currently ARMED, shown only while it is armed —
  // an idle toolbar, or a one-shot action like Snap tracts/Fill holes,
  // gets no pill; those get a plain title tooltip instead, like the
  // rest of this screen's buttons.
  const toolbarHint = stage === 'tracts'
    ? (tool === 'frame' ? 'Click each parcel that forms the frame, then Snap tracts.'
      : (tool === 'drawtract' && drawing) ? 'Click to place corners. Enter or double-click closes '
        + 'the shape; edges and other tracts snap automatically.'
      : null)
    : stage === 'landtypes'
    ? ((tool === 'draw' && drawing) ? 'Click to place corners. Save Polygon, Enter or double-click '
        + 'closes the shape; Esc cancels.'
      : tool === 'cutpoly' ? 'Click once on each side of the selected polygon. It cuts on the second click.'
      : tool === 'erase' ? 'Drag a box over a run of dots and they are all removed at once. '
        + 'Right-click (or Alt-click) a single dot to remove just that one.'
      : null)
    : null

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
        {/* The way OUT of Configurable Mapping. Top-left, on the map,
            where a back control belongs — the panel is for the tract. */}
        <button
          onClick={() => {
            if (dirty) { setConfirmWhat('leave'); return }
            window.location.href = '/access'
          }}
          style={{
            position: 'absolute', top: 14, left: 14, zIndex: 30,
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 13px', borderRadius: 8, cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: '#0b0b0b',
            background: 'linear-gradient(180deg, #f9a8e6 0%, #f58cde 48%, #e072c8 100%)',
            border: '1px solid #f58cde',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.45), 0 2px 8px rgba(0,0,0,0.5)',
          }}>
          <ArrowLeft size={14} /> Back to Map
        </button>
        {/* Bottom-of-map toolbar (design spec §2). Stage 2's frame/draw/
            snap tools and Stage 3's land-type chips + polygon tools live
            HERE, not in the right panel — no duplicate controls (owner).
            Replaces the old floating "Done erasing"/"Cancel cut"/"Save
            Polygon" pill: an armed tool now swaps its OWN toolbar button
            to its done label in place instead. */}
        {toolbarHint && <div style={toolbarHintPill}>{toolbarHint}</div>}
        {stage === 'tracts' && (
          <div style={toolbarBar}>
            <button
              onClick={() => (tool === 'frame' ? finishFrameSelection() : setTool('frame'))}
              style={{ ...btn, outline: tool === 'frame' ? '2px solid #ffffff' : 'none',
                       outlineOffset: tool === 'frame' ? 1 : 0 }}>
              {tool === 'frame' ? <><Check size={13} /> Done</> : <><LayoutGrid size={13} /> Select frame parcels</>}
            </button>
            <button
              onClick={() => {
                if (tool === 'drawtract' && drawing) { finishDraft(); return }
                setTool('drawtract'); setDrawing(true); setDraft([])
              }}
              style={{ ...btn, outline: (tool === 'drawtract' && drawing) ? '2px solid #ffffff' : 'none',
                       outlineOffset: (tool === 'drawtract' && drawing) ? 1 : 0 }}>
              {(tool === 'drawtract' && drawing)
                ? <><Plus size={13} /> Save Polygon</>
                : <><PenTool size={13} /> Draw a tract</>}
            </button>
            <div style={toolbarDivider} />
            <button
              onClick={() => void snapTracts()}
              disabled={!!busy || (tracts.length < 2 && frameParcels.length === 0
                && !(tracts.length === 1 && tracts[0].source.kind === 'parcel'))}
              title={tracts.length <= 1
                ? 'Fits this tract to its own parcel boundary so the acres are exact.'
                : 'Fits every drawn tract to the frame and to each other so acres add up.'}
              style={primaryBtn}>
              <Magnet size={13} /> {tracts.length <= 1 ? 'Snap to Parcel' : 'Snap tracts'}
            </button>
            <div style={toolbarDivider} />
            <button onClick={undoTracts} disabled={!tractUndoRef.current.length} style={btn}>
              <RotateCcw size={13} /> Undo
            </button>
            <button onClick={redoTracts} disabled={!tractRedoRef.current.length} style={btn}>
              <RotateCw size={13} /> Redo
            </button>
          </div>
        )}
        {stage === 'landtypes' && activeTract && editingTypes && (
          <div style={toolbarBar}>
            {LAND_CLASSES.map((c) => (
              <button
                key={c}
                onClick={() => { setDrawClass(c); if (selectedId) setClassOf(selectedId, c) }}
                title={CLASS_LABEL[c]}
                style={{
                  ...chip,
                  outline: drawClass === c ? '2px solid #ffffff' : 'none',
                  outlineOffset: drawClass === c ? 1 : 0,
                  opacity: drawClass === c ? 1 : 0.72,
                }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: CLASS_COLOR[c] }} />
                {CLASS_LABEL[c]}
              </button>
            ))}
            <div style={toolbarDivider} />
            <button
              onClick={() => {
                if (tool === 'draw' && drawing) { finishDraft(); return }
                setTool('draw'); setDrawing(true); setDraft([])
              }}
              style={{ ...btn, outline: (tool === 'draw' && drawing) ? '2px solid #ffffff' : 'none',
                       outlineOffset: (tool === 'draw' && drawing) ? 1 : 0 }}>
              {(tool === 'draw' && drawing)
                ? <><Plus size={13} /> Save Polygon</>
                : <><Plus size={13} /> Add polygon</>}
            </button>
            <button onClick={() => selectedId && deleteShape(selectedId)} disabled={!selectedId} style={btn}>
              <Trash2 size={13} /> Delete
            </button>
            <button
              onClick={() => {
                if (tool === 'cutpoly') { setTool(null); setCutPts([]); return }
                setTool('cutpoly'); setCutPts([]); setDrawing(false); setDraft([])
              }}
              disabled={!selectedId && tool !== 'cutpoly'}
              style={{ ...btn, outline: tool === 'cutpoly' ? '2px solid #ffffff' : 'none',
                       outlineOffset: tool === 'cutpoly' ? 1 : 0 }}>
              {tool === 'cutpoly' ? <><X size={13} /> Cancel cut</> : <><Scissors size={13} /> Split polygon</>}
            </button>
            <button
              onClick={() => { setTool(tool === 'erase' ? null : 'erase'); setMarq(null) }}
              disabled={!selectedId && tool !== 'erase'}
              style={{ ...btn, outline: tool === 'erase' ? '2px solid #ffffff' : 'none',
                       outlineOffset: tool === 'erase' ? 1 : 0 }}>
              {tool === 'erase' ? <><Check size={13} /> Done erasing</> : <><Eraser size={13} /> Erase points</>}
            </button>
            <button
              onClick={() => selectedId && fillHoles(selectedId)}
              disabled={!selectedId || holesOnSelected === 0}
              title="Remove every hole inside the selected polygon"
              style={btn}>
              <PaintBucket size={13} /> Fill holes{holesOnSelected > 0 ? ` (${holesOnSelected})` : ''}
            </button>
            <div style={toolbarDivider} />
            <button onClick={undo} disabled={!undoRef.current.length} style={btn}>
              <RotateCcw size={13} /> Undo
            </button>
            <button onClick={redo} disabled={!redoRef.current.length} style={btn}>
              <RotateCw size={13} /> Redo
            </button>
            <button onClick={clearAll} disabled={!shapes.length} style={btn}>
              <X size={13} /> Clear polygons
            </button>
            <button onClick={resetToEngine} disabled={!detail?.polygons.length} style={btn}>
              <Layers size={13} /> Start over
            </button>
          </div>
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

        {/* Stage indicator — 1 Project / 2 Tracts / 3 Land Types. A done
            stage is clickable (jump back); a future one is not (nothing
            to show there yet). */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['project', 'tracts', 'landtypes'] as const).map((s, i) => {
            const order = ['project', 'tracts', 'landtypes'] as const
            const stageIdx = order.indexOf(stage)
            const state = i === stageIdx ? 'current' : i < stageIdx ? 'done' : 'future'
            const label = s === 'project' ? '1 Project' : s === 'tracts' ? '2 Tracts' : '3 Land Types'
            const canJump = state === 'done'
            return (
              <button key={s}
                onClick={() => { if (canJump) setStage(s) }}
                disabled={!canJump}
                style={{
                  border: 'none', cursor: canJump ? 'pointer' : 'default',
                  background: state === 'current' ? GG_PINK : 'transparent',
                  color: state === 'current' ? '#0b0b0b' : '#ffffff',
                  opacity: state === 'current' ? 1 : state === 'done' ? 0.4 : 0.25,
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
                }}>
                {state === 'done' && <Check size={12} />}
                {label}
              </button>
            )
          })}
        </div>

        {stage === 'project' ? (
          <div style={stepCard}>
            <div style={stepLabel}>Step 1 — Name this project.</div>
            <div style={{ lineHeight: 1.5 }}>
              Give this project a name before adding tracts — it&rsquo;s how
              you&rsquo;ll find it in Map Portfolio.
            </div>
            <input
              autoFocus
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && projectName.trim()) setStage('tracts') }}
              placeholder="e.g. Smith Estate Auction"
              style={{
                ...inputStyle, width: '100%', fontSize: 16, fontWeight: 600, marginTop: 4,
                border: projectName.trim() ? inputStyle.border : '1px solid #ef4444',
              }}
            />
          </div>
        ) : (
        <>
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

        {/* Stage 2: the whole tract list, built before any land type is
            touched (owner process). No parcel-detail card, no per-tract
            outline tools here — those either happen on the map directly
            (drag a boundary vertex, click the line to add one) or moved
            to the bottom toolbar (Select frame parcels / Draw a tract /
            Snap tracts). */}
        {stage === 'tracts' && (
          <div style={card}>
            <div style={sectionLabel}>Tracts ({tracts.length})</div>
            {tracts.length === 0 && (
              <div style={hint}>
                Click a parcel on the map, or draw one with the toolbar below, to add your first tract.
              </div>
            )}
            {tracts.map((t) => (
              <TractRow key={t.id} t={t} selected={t.id === selectedTractId} busy={!!busy}
                        onSelect={() => requestOpen(t.id)}
                        onCommitName={(n) => setTracts((prev) => prev.map((x) => x.id === t.id ? { ...x, name: n } : x))}
                        onRemove={() => removeTract(t.id)} />
            ))}
          </div>
        )}

        {stage === 'landtypes' && !activeTract && !busy && (
          <div style={hint}>Pick a tract from the map to edit its land types.</div>
        )}

        {stage === 'landtypes' && activeTract && (
          <>
            {/* A hand-drawn tract has no Regrid parcel behind it — no
                owner, parcel number, or deed acreage to show. Its acres
                are on the Legend & Acres card below either way. */}
            {detail ? (
              <div style={card}>
                <div style={{ fontWeight: 600 }}>{detail.parcel?.owner || 'Parcel'}</div>
                <div style={{ opacity: 0.65 }}>
                  {detail.parcel?.parcelnumb} · {niceCounty(detail.parcel?.county)} County {detail.parcel?.state}
                </div>
                <div style={{ marginTop: 6 }}>{parcelAcres.toFixed(1)} acres</div>
                {detail.parcel?.acreage_mismatch && (
                  <div style={{ ...hint, color: '#fcd34d' }}>
                    Deed acreage ({detail.parcel.acres_of_record}) differs from the mapped shape.
                  </div>
                )}
              </div>
            ) : (
              <div style={card}>
                <div style={{ fontWeight: 600 }}>Hand-drawn tract</div>
                <div style={{ marginTop: 6 }}>{parcelAcres.toFixed(1)} acres</div>
              </div>
            )}

            {/* The name, right under the parcel it belongs to. It used
                to sit at the very bottom of a long scrolling panel in a
                small grey label, which nobody found. Same place in every
                step, so it never moves on you. */}
            <div style={{ ...card, gap: 6 }}>
              <div style={{ ...sectionLabel, marginBottom: 0, opacity: 0.75 }}>Tract name</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>
                <TractName value={name} busy={!!busy}
                           onCommit={(n) => { setName(n); void doRename(n) }} />
              </div>
            </div>

            {/* Tract list, compact — lets the owner pick the next tract
                to edit one at a time ("pick a tract from the list and
                edit its land types one tract at a time") without
                dropping back to Stage 2. Same row component as Stage 2,
                just without rename/remove. Clicking a row goes through
                the ordinary requestOpen guard, so Stage 3's unsaved-
                changes confirm still fires. */}
            <div style={card}>
              <div style={sectionLabel}>Tracts ({tracts.length})</div>
              {tracts.map((t) => (
                <TractRow key={t.id} t={t} selected={t.id === selectedTractId} compact
                          onSelect={() => requestOpen(t.id)} />
              ))}
            </div>

            {/* Legend & Acres — moved to the TOP of Stage 3 (design spec
                §5), enlarged: this is the number the tract is actually
                built around, not a footnote under the tools. */}
            <div style={card}>
              <div style={sectionLabel}>Legend &amp; acres</div>
              {LAND_CLASSES.map((c) => (
                <div key={c} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '3px 4px', borderRadius: 5,
                  background: flashClasses.has(c) ? 'rgba(245,140,222,0.25)' : 'transparent',
                  transition: 'background-color 300ms',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    <span style={{ display: 'inline-block', width: 14, height: 14, borderRadius: 3, background: CLASS_COLOR[c], marginRight: 8 }} />
                    {CLASS_LABEL[c]}
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 800 }}>{totals[c].toFixed(1)}</span>
                </div>
              ))}
              <div style={{ ...statRow, opacity: 0.6 }}>
                <span>Other / Unclassified</span>
                <span>{Math.max(parcelAcres - classified, 0).toFixed(1)}</span>
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                fontSize: 22, fontWeight: 800, borderTop: '2px solid rgba(255,255,255,0.16)', paddingTop: 8, marginTop: 2,
              }}>
                <span>Total</span><span>{parcelAcres.toFixed(1)}</span>
              </div>
              <div style={statRow}>
                <span style={{ opacity: 0.65 }}>Buildings</span>
                <span>{detail?.parcel?.ll_bldg_count ?? 0}</span>
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

            <>
            {!editingTypes && (
              <button onClick={() => setEditingTypes(true)}
                      style={{ ...primaryBtn, width: '100%', justifyContent: 'center' }}>
                <PenLine size={13} /> Edit this tract
              </button>
            )}

            {/* Land-type chips and every polygon tool (Add polygon,
                Delete, Split polygon, Erase points, Fill holes, Undo,
                Redo, Clear polygons, Start over) live in the bottom
                toolbar now (design spec §2) — no duplicate controls
                here (owner). */}

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

            {/* This card only ever fills in via the (removed) Stage 2
                "Split parcel" boundary-cut tool — dead in the new
                tracts-first flow, since Stage 2 no longer offers that
                button, but left in place rather than torn out along with
                its `pieces`/`savePieces` plumbing. */}
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

            <div style={card} ref={reportsRef}>
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
                      style={{ ...dangerBtn, padding: '2px 5px', fontSize: 11 }}>
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
        </>
        )}
        </div>

        {/* Pinned footer — always on screen. */}
        {stage === 'project' && (
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.10)', padding: 12,
            background: 'linear-gradient(180deg, #0a0a0a 0%, #050505 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
          }}>
            <button onClick={() => setStage('tracts')} disabled={!projectName.trim()}
                    style={{ ...primaryBtn, width: '100%', justifyContent: 'center', padding: '9px 10px' }}>
              <ArrowRight size={14} /> Continue to Tracts
            </button>
          </div>
        )}
        {stage !== 'project' && (
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.10)', padding: 12,
            background: 'linear-gradient(180deg, #0a0a0a 0%, #050505 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            {stage === 'landtypes' && !editingTypes ? (
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
                    "New Project" in the portfolio. */}
                <button onClick={projectId ? addTractToProject : discardAndClose}
                        disabled={!!busy}
                        style={{ ...btn, flex: 1, justifyContent: 'center', padding: '9px 10px' }}>
                  <Plus size={14} /> Add Another Parcel
                </button>
              </div>
            ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              {/* Stage 2's button is NOT "Save outline": nothing is
                  written here. It moves to Stage 3, where each tract's
                  land types fill in as it is opened — so it names where
                  it is taking you. Disabled until every tract is named
                  (design spec §4). */}
              {stage === 'tracts' ? (
                <button onClick={continueToLandTypes}
                        disabled={!!busy || !tracts.length || tracts.some((t) => !t.name.trim())}
                        style={{ ...primaryBtn, flex: 1, justifyContent: 'center', padding: '9px 10px' }}>
                  <ArrowRight size={14} /> Continue to Land Types
                </button>
              ) : (
                <button onClick={() => void saveAllTracts()}
                        disabled={!!busy || !tracts.length || tracts.some((t) => !t.name.trim())}
                        style={{ ...primaryBtn, flex: 1, justifyContent: 'center', padding: '9px 10px' }}>
                  <Save size={14} /> Save
                </button>
              )}
              <button
                onClick={() => {
                  // Only ask when there is something to lose. A
                  // "discard your changes?" over a tract nobody has
                  // touched is pure noise (owner).
                  if (stage === 'landtypes') {
                    if (dirty) { setConfirmWhat('outline'); return }
                    setTool(null); setSelectedId(null); setStage('tracts')
                    return
                  }
                  if (dirty) { setConfirmWhat('cancel'); return }
                  discardAndClose()
                }}
                disabled={!!busy}
                style={{ ...btn, flex: 1, justifyContent: 'center', padding: '9px 10px' }}>
                <X size={14} /> {stage === 'landtypes' ? 'Edit outline' : 'Cancel'}
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
                {confirmWhat === 'outline' ? 'Go back to Tracts?'
                  : confirmWhat === 'switch' ? 'Save before switching tracts?'
                  : confirmWhat === 'leave' ? 'Leave without saving?'
                  : confirmWhat === 'removeTract' ? 'Remove this tract?'
                  : 'Discard your changes?'}
              </div>
              <div style={{ ...hint, marginTop: 0, marginBottom: 14, display: 'block' }}>
                {confirmWhat === 'outline'
                  ? 'If you reshape this tract’s outline there — including with '
                    + '‘Snap tracts’ — its land types are re-read from the engine, '
                    + 'and every polygon edit you have made here will be lost.'
                  : confirmWhat === 'switch'
                  ? 'This tract has changes you have not saved. OK saves them and '
                    + 'opens the tract you clicked. Cancel stays on this one.'
                  : confirmWhat === 'leave'
                  ? 'This tract has changes you have not saved. OK leaves for the '
                    + 'Explore map and throws them away. Cancel stays here.'
                  : confirmWhat === 'removeTract'
                  ? 'This tract is already saved. OK removes it here and deletes '
                    + 'its saved record too — that part cannot be undone.'
                  : 'Every polygon edit you have made will be thrown away and the '
                    + 'parcel will close. This cannot be undone.'}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => {
                          if (confirmWhat === 'outline') {
                            setConfirmWhat(null); setTool(null); setSelectedId(null)
                            setStage('tracts')
                          } else if (confirmWhat === 'leave') {
                            setConfirmWhat(null)
                            window.location.href = '/access'
                          } else if (confirmWhat === 'switch') {
                            // Save FIRST, and only switch if it worked —
                            // switching on a failed save would lose the
                            // very work the dialog promised to keep.
                            const target = pendingOpen
                            setConfirmWhat(null); setPendingOpen(null)
                            void (async () => {
                              const ok = await doSave()
                              if (ok && target && !openLocalTract(target)) {
                                void openSavedTractRef.current?.(target)
                              }
                            })()
                          } else if (confirmWhat === 'removeTract') {
                            const target = pendingRemoveId
                            setConfirmWhat(null); setPendingRemoveId(null)
                            if (target) void removeSavedTract(target)
                          } else {
                            discardAndClose()
                          }
                        }}
                        style={{ ...primaryBtn, flex: 1, justifyContent: 'center',
                                 padding: '9px 10px' }}>
                  OK
                </button>
                <button onClick={() => { setConfirmWhat(null); setPendingOpen(null); setPendingRemoveId(null) }}
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
/** Abandon (x) is red, keep (tick) is green, wherever they appear —
 *  the two are always side by side and the colour is what tells them
 *  apart at a glance (owner). */
const dangerBtn: React.CSSProperties = {
  ...btn,
  background: 'linear-gradient(180deg, #fca5a5 0%, #ef4444 48%, #dc2626 100%)',
  border: '1px solid #ef4444',
}
const goBtn: React.CSSProperties = {
  ...btn,
  background: 'linear-gradient(180deg, #86efac 0%, #22c55e 48%, #16a34a 100%)',
  border: '1px solid #22c55e',
}
/** The button that commits the work: same pink, heavier. */
const primaryBtn: React.CSSProperties = {
  ...btn,
  fontWeight: 700,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55), 0 2px 6px rgba(0,0,0,0.55)',
}
const chip: React.CSSProperties = { ...btn, padding: '5px 9px' }
// Bottom-of-map toolbar (design spec §2) — Stage 2's frame/draw/snap
// tools and Stage 3's land-type chips + polygon tools, consolidated
// here instead of the right panel. Same surface treatment (gradient,
// border, inset+drop shadow) as the confirm dialog, so every floating
// black-on-map chrome on this screen reads as one family.
const toolbarBar: React.CSSProperties = {
  position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center',
  maxWidth: 'calc(100% - 32px)',
  borderRadius: 14, padding: '8px 10px',
  background: 'linear-gradient(180deg, #1b1e23 0%, #0a0a0a 100%)',
  border: '1px solid rgba(255,255,255,0.14)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 30px rgba(0,0,0,0.6)',
}
const toolbarDivider: React.CSSProperties = {
  width: 1, height: 24, background: 'rgba(255,255,255,0.14)', flex: 'none',
}
// The armed-tool hint, one line above the bar (design spec §2, §7) —
// shown only while a tool is armed; everything else on the bar carries
// its own explanation as a plain title tooltip instead.
const toolbarHintPill: React.CSSProperties = {
  position: 'absolute', bottom: 72, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
  padding: '5px 10px', borderRadius: 8, background: 'rgba(0,0,0,0.7)',
  fontSize: 11, opacity: 0.85, color: '#e5e7eb', textAlign: 'center', maxWidth: 320,
}
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
