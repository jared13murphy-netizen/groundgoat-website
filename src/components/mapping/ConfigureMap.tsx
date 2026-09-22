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
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  Loader2, Plus, Trash2, RotateCcw, RotateCw, Save, Search, X, Layers,
  Eye, EyeOff,
  Scissors, FileText, Download, BarChart3, Eraser, PenLine, PaintBucket, Check,
  ArrowRight, ArrowLeft, PenTool, Magnet, type LucideIcon,
} from 'lucide-react'
import {
  CLASS_COLOR, CLASS_LABEL, LAND_CLASSES, PARCEL_LINE, SEARCH_DOT, VERTEX_LINE,
  archiveParcel, classifyBoundary, fetchParcel, getSavedParcel, saveParcel, searchMap,
  splitGeometry, normalizeGeometry, previewSoil,
  updateParcel, queueReport, listReports, downloadReport, getProject,
  REPORT_KINDS, REPORT_LABEL, REPORT_BUSY_LABEL, USES_ELEVATION, type ReportRow,
  deleteReport, projectGeometry, type ProjectTractGeometry, listCounties, renameParcel,
  niceCounty, combineGeometry, fitTracts, listProjects,
  createCma, getCma, listCmas, cmaCandidates, setCmaComps, queueCmaReport, updateCma,
  parcelsUnder, differenceGeometry,
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

/** ONE undo/redo history entry — shape edits, tract/boundary edits, and
 *  draft-point edits all live on the same stack, in the order they
 *  happened, so Undo always reverses the last thing done regardless of
 *  which kind it was. `tractId` on a 'shapes' entry is the tract that
 *  was open when it was taken — used to drop it if a different tract is
 *  open by the time Undo would otherwise apply it. */
type HistEntry =
  | { kind: 'shapes'; prev: Shape[]; tractId: string }
  | { kind: 'tracts'; prev: Tract[] }
  | { kind: 'draft'; prev: Pt[] }

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
 *  polygons the old top-level `detail` held.
 *
 *  There used to be a per-tract `editingTypes` view/edit toggle here — a
 *  tract opened from the portfolio without `&edit=1` opened read-only,
 *  land types visible but not draggable, with an "Edit this tract"
 *  button to unlock them. Owner ruling 2026-09-16: opening a tract on
 *  the build screen means editing it, full stop — every boot path opens
 *  fully interactive now, so that field is gone. */
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
  /** Soil rating for the tract's tillable ground, in the state's native
   *  index — from the saved record's stats, the save response, or the
   *  live query while the tract is open, whichever is newest (owner
   *  9/16: the tract rows showed a dash for every tract but the open
   *  one). */
  soilRating: number | null
  soilRatingType: string | null
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
    soilRating: null,
    soilRatingType: null,
    dirty: false,
    saved: false,
    savedId: null,
    detail: null,
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
      // minWidth 0 so a long name ("Parcel 25-36-000-380 (remaining)")
      // ellipsises inside its grid cell instead of running under the
      // pencil and the acres (sandbox 9/16).
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
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
          style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <input
        autoFocus value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') cancel()
        }}
        placeholder={placeholder || 'e.g. Tract 1, Home Place, North 80'}
        style={{ ...inputStyle, minWidth: 0, width: '100%' }} />
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

/** One row of the tract list (item 4 of the merged 'build' panel) —
 *  source dot, name (with its own rename pencil), live acres, tillable
 *  acres, soil rating, and a trash can. There is exactly one tract list
 *  now, so this used to also have a `compact` variant for Stage 3's
 *  read-only "pick your next tract" list; that split went away with the
 *  stages themselves.
 *
 *  Tillable acres come straight off this tract's own `shapes` — every
 *  tract in this session has those once `classified`, whether it is the
 *  one open right now or not. Soil rating is different: it is a live
 *  SSURGO query kept for whichever tract is actually open (`soil` at
 *  the top of the component), so only that row can show one — the
 *  others read as unknown until you open them, same as their tillable
 *  acres read as unknown before they are classified at all — except
 *  that a tract carries its last known rating (`soilRating`: from its
 *  saved record, its save, or the live query while it was open), so a
 *  row is a dash only until the tract has been opened or saved once. */
function TractRow({ t, selected, busy, soilRating, onSelect, onCommitName, onRemove }: {
  t: Tract
  selected: boolean
  busy?: boolean
  soilRating?: number | null
  onSelect: () => void
  onCommitName: (next: string) => void
  onRemove: () => void
}) {
  const tillable = t.classified
    ? t.shapes.filter((sh) => sh.cls === 'tillable').reduce((sum, sh) => sum + shapeAcres(sh), 0)
    : null
  return (
    <div onClick={onSelect}
         style={{
           display: 'grid',
           gridTemplateColumns: 'auto 1fr auto auto auto auto',
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
      <span onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <TractName value={t.name} busy={!!busy}
                   onCommit={(n) => onCommitName(n)} />
        {!t.name.trim() && (
          <span title="Unnamed tract"
                style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444', flex: 'none' }} />
        )}
      </span>
      <span style={{ opacity: 0.7, fontSize: 12 }} title="Total acres">
        {(t.acres ?? boundaryAcresOf(t.boundary)).toFixed(1)} ac
      </span>
      <span style={{ opacity: 0.7, fontSize: 12 }} title="Tillable acres">
        {tillable != null ? `${tillable.toFixed(1)} till` : '—'}
      </span>
      <span style={{ opacity: 0.7, fontSize: 12 }} title="Soil rating">
        {soilRating != null ? soilRating : '—'}
      </span>
      <button onClick={(e) => { e.stopPropagation(); onRemove() }}
              title="Remove this tract" aria-label="Remove this tract"
              style={{ ...dangerBtn, flex: 'none', padding: '4px 7px' }}>
        <Trash2 size={13} />
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

/** Is `pt` inside the tract boundary? `boundary` is an array of
 *  polygons, each [outerRing, ...holeRings]; a point counts as inside
 *  when it lands inside SOME polygon's outer ring and none of that
 *  polygon's holes. Used to keep land-type drawing inside the tract
 *  outline (owner spec) — a local ray-cast rather than a new dependency,
 *  since @turf/boolean-point-in-polygon is not in package.json. */
function pointInBoundary(pt: Pt, boundary: Pt[][][]): boolean {
  return boundary.some((rings) => {
    const outer = rings[0]
    if (!outer || !pointInRing(pt, outer)) return false
    return !rings.slice(1).some((hole) => pointInRing(pt, hole))
  })
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

/** One button on the bottom-of-map toolbar (owner redesign 2026-09-16:
 *  round icon buttons, no dark bar behind them, so the map itself reads
 *  through). A 48px circle — transparent by default, filled solid pink
 *  for `primary` (the one button that is the deliberate next step, not
 *  a peer of the rest) — with a capitalised label underneath. Icon and
 *  label both carry a strong drop shadow so they hold up against any
 *  aerial imagery underneath, since there is no dark backing any more.
 *  `active` rings the circle in pink (an armed tool / the selected land
 *  type); unring/unfilled buttons show a subtle white ring on hover. */
function ToolButton({ icon: Icon, dot, label, onClick, active, disabled, primary, title }: {
  icon?: LucideIcon
  /** A filled colour dot instead of an icon — the land-type chips, which
   *  show their class colour rather than a symbol (owner spec). */
  dot?: string
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  primary?: boolean
  title?: string
}) {
  const [hover, setHover] = useState(false)
  // Every enabled button wears a visible white ring: a bare icon on
  // imagery read as decoration, not a button (owner 9/16: "there's not a
  // Draw Tract button"). No fill — the ring + shadow is what says "press".
  const ringColor = disabled ? 'rgba(255,255,255,0.35)'
    : (active || primary) ? GG_PINK
    : hover ? '#ffffff'
    : 'rgba(255,255,255,0.9)'
  // Toolbar redesign (owner item 3, 2026-09-22): each button animates in
  // from below and `layout` lets its siblings slide over when a button
  // mounts/unmounts or the whole row's width changes. Respects
  // prefers-reduced-motion via a zero-duration transition rather than
  // skipping the animation props outright, so layout reflow still works.
  const reduceMotion = useReducedMotion()
  const toolButtonTransition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 500, damping: 30 }
  return (
    <motion.button
      layout
      initial={{ y: 28, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 28, opacity: 0, scale: 0.9 }}
      transition={toolButtonTransition}
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-label={title || label}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        background: 'none', border: 'none', padding: 0, flex: 'none',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
      }}>
      <span style={{
        width: 48, height: 48, borderRadius: '50%', flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: primary ? GG_PINK : 'rgba(0,0,0,0.18)',
        border: `2px solid ${ringColor}`,
        boxShadow: primary
          ? 'inset 0 1px 0 rgba(255,255,255,0.45), 0 3px 10px rgba(0,0,0,0.6)'
          : '0 3px 10px rgba(0,0,0,0.6)',
        transition: 'border-color 120ms ease',
      }}>
        {dot ? (
          <span style={{
            width: 22, height: 22, borderRadius: '50%', background: dot,
            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))',
          }} />
        ) : Icon ? (
          <Icon size={24} style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.8))' }} />
        ) : null}
      </span>
      <span style={{
        fontSize: 12, fontWeight: (active || primary) ? 700 : 600,
        color: (active || primary) ? GG_PINK : '#ffffff',
        textShadow: '0 1px 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.7)', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
    </motion.button>
  )
}

/** One floating glass bubble over the map (owner redesign 2026-09-16:
 *  the fixed right panel is gone — the map spans the full surface and
 *  every panel section floats over it as its own near-black card).
 *
 *  The bubble container this sits in (`bubbleContainer`, defined below
 *  the component) is right-anchored with `direction: 'rtl'` so a second
 *  column of overflow bubbles grows LEFTWARD, into the map, instead of
 *  off the right edge — `flexWrap` itself stays plain 'wrap', never
 *  'wrap-reverse'. `direction: 'ltr'` here un-flips that for the
 *  bubble's own content, so text and button order read normally. */
type SheetTab = 'what-to-do' | 'project' | 'tract' | 'data' | 'reports'

/** True on a touch-first device (finger, not mouse): handles get bigger
 *  hit targets and the long-press/tap gestures below. */
const coarsePointer = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches

function Bubble({ animKey, children, compact }: { animKey: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <motion.div
      key={animKey}
      layout
      initial={{ opacity: 0, scale: 0.85, y: 12 }}
      animate={{
        opacity: 1, scale: 1, y: 0,
        transition: { type: 'spring', stiffness: 420, damping: 24, mass: 0.8 },
      }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
      style={{
        direction: 'ltr', pointerEvents: 'auto', flex: 'none',
        background: 'rgba(8,8,10,0.78)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.10)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 10px 30px rgba(0,0,0,0.55)',
        borderRadius: 16, padding: 14, width: compact ? '100%' : 340, color: '#ffffff',
        // A bubble never grows past the column: it scrolls inside instead
        // of burying the toolbar (auditor 9/16). In the tablet sheet it
        // is the sheet's one card and scrolls within the sheet's height.
        maxHeight: compact ? 'calc(46vh - 56px)' : 'calc(100vh - 175px)', overflowY: 'auto',
        display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13,
      }}>
      {children}
    </motion.div>
  )
}

export default function ConfigureMap() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  /** Frame `bb` — but only once the canvas has its real size. Explore's
   *  "Configure Map" button is a full page load, and on a cold load the
   *  map container can still measure 0×0 (or MapLibre's 400×300
   *  fallback) when the parcel arrives; fitBounds on a canvas with no
   *  size resolves to zoom 0, so the screen opened all the way zoomed
   *  out with the parcel loaded (owner 9/16). A fit asked for too early
   *  is parked and applied, without animation, on the first `resize`
   *  that gives the canvas a real size that matches its container. */
  const pendingFitRef = useRef<{ bb: [[number, number], [number, number]]; opts: maplibregl.FitBoundsOptions } | null>(null)
  const canvasReady = (map: maplibregl.Map) => {
    const c = map.getCanvas()
    const r = map.getContainer().getBoundingClientRect()
    return c.clientWidth >= 50 && c.clientHeight >= 50
      && Math.abs(c.clientWidth - Math.round(r.width)) <= 2
      && Math.abs(c.clientHeight - Math.round(r.height)) <= 2
  }
  const fitMap = useCallback((bb: [[number, number], [number, number]] | null, opts: maplibregl.FitBoundsOptions) => {
    const map = mapRef.current
    if (!bb || !map) return
    if (canvasReady(map)) { pendingFitRef.current = null; map.fitBounds(bb, opts); return }
    pendingFitRef.current = { bb, opts }
  }, [])
  const [ready, setReady] = useState(false)

  // ── Tracts: the owner's Stage 2/3 unit of ground ───────────────────
  // Stage 2 will hold many; Stage 3 edits one at a time via
  // `selectedTractId`. `detail`/`shapes`/`boundaryRings`/`editingId`/
  // `name`/`sources` below are DERIVED from the selected
  // tract so the rest of this file (mutate, the map handlers registered
  // once on load, the JSX) reads them exactly as it always has — only
  // where the value COMES FROM moved, not its shape or its call sites.
  // 'project' shows first on a blank visit (owner process: name the
  // project before anything else); every boot path that already has a
  // parcel/project/tract to open (?parcel=, ?project=, ?ll_uuid=) moves
  // itself past this the moment it has something to show. 'build' is
  // the one working screen after that — tract outlines and their land
  // types are edited on the same canvas now (owner redesign 2026-09-16
  // collapsed the old separate 'tracts' / 'landtypes' stages: the panel
  // informs, the map edits, and both toolbars can be on screen at once).
  const [stage, setStage] = useState<'project' | 'build'>('project')
  // Owner 9/16: the cards can be tucked away while drawing polygons and
  // brought back with the same bounce they arrive with.
  const [bubblesHidden, setBubblesHidden] = useState(false)
  /** Tablet / narrow layout (owner 9/17, iPad Safari: "the cards don't
   *  fit on the screen"). Under 1100 px the floating bubbles become ONE
   *  bottom sheet with a tab strip, and the toolbar row wraps instead of
   *  scrolling sideways. */
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1100px)')
    const apply = () => setCompact(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  const [sheetTab, setSheetTab] = useState<SheetTab>('what-to-do')
  // Toolbar redesign (owner item 3, 2026-09-22): the toolbar slides up
  // over a gradient, and its buttons animate in / slide siblings over.
  // `reduceMotion` collapses every transition below to zero duration.
  const reduceMotion = useReducedMotion()
  const toolbarEntranceTransition = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 32 }
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [toolbarH, setToolbarH] = useState(80)
  useEffect(() => {
    const el = toolbarRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setToolbarH(el.getBoundingClientRect().height))
    ro.observe(el)
    return () => ro.disconnect()
    // `stage` too: the toolbar only exists on the build step, and a cold
    // tablet load starts on Step 1 — keyed on `compact` alone the
    // observer never attached once the toolbar mounted (reviewer 9/17).
  }, [compact, stage])
  const [tracts, setTracts] = useState<Tract[]>([])
  const [selectedTractId, setSelectedTractId] = useState<string | null>(null)
  // A multi-parcel FRAME a set of tracts gets fit to ('Snap tracts' /
  // 'Snap to Parcel') — either the parcels actually under the tracts
  // (found automatically, see `snapTracts`) combined, or a single
  // parcel's own boundary.
  const [frame, setFrame] = useState<{ ll_uuids: string[]; boundary: Pt[][][] } | null>(null)
  // Whether "Draw a tract" / a parcel click should start a NEW tract.
  // False the moment a tract exists and is open for editing — otherwise
  // the draw button read as armed while the user was mid-edit on an
  // existing tract (owner). Defaults true on a blank list (nothing to
  // protect) and snaps back to true whenever the list empties out again
  // (every tract removed) so the button is never stuck looking disabled.
  const [addingTract, setAddingTract] = useState(tracts.length === 0)
  const selectedTractIdRef = useRef(selectedTractId); selectedTractIdRef.current = selectedTractId
  const tractsRef = useRef(tracts); tractsRef.current = tracts
  // No `stageRef` any more — every map handler that used to branch on
  // 'tracts' vs 'landtypes' now branches on `selectedTractIdRef`/
  // `addingTractRef` instead, since both toolbars (and both kinds of
  // edit) can be live on screen at once on the one 'build' stage.
  const frameRef = useRef(frame); frameRef.current = frame
  const addingTractRef = useRef(addingTract); addingTractRef.current = addingTract
  useEffect(() => {
    if (tracts.length === 0 && !addingTract) setAddingTract(true)
  }, [tracts.length, addingTract])

  // ── ONE undo/redo history covering shape edits, tract/boundary
  // edits, AND points placed/moved/removed while drawing (owner
  // ruling: undo always undoes the last thing done, whatever kind it
  // was — a second stack made shape edits and tract edits interleave
  // wrongly). Same snapshot-outside-the-updater shape as before, for
  // the same reason: snapshotting inside a state updater is a side
  // effect React may run twice. A 'shapes' entry carries the tractId it
  // belongs to, so switching tracts can drop only the entries that no
  // longer apply (see the effect below) without touching 'tracts'
  // entries, which are whole-list snapshots and stay valid across a
  // switch.
  const histRef = useRef<HistEntry[]>([])
  const redoHistRef = useRef<HistEntry[]>([])
  const [, forceHist] = useState(0)
  const pushHist = useCallback((entry: HistEntry) => {
    histRef.current.push(JSON.parse(JSON.stringify(entry)))
    if (histRef.current.length > 200) histRef.current.shift()
    redoHistRef.current = []
    forceHist((t) => t + 1)
  }, [])
  const snapshotTracts = useCallback((prev: Tract[]) => {
    pushHist({ kind: 'tracts', prev })
  }, [pushHist])
  /** Drop every 'draft' entry from both stacks — called when drawing
   *  ends (finished, cancelled, or Escaped): the finished polygon/tract
   *  is itself undoable through its own 'shapes'/'tracts' entry, so the
   *  point-by-point draft history under it is no longer meaningful. */
  const dropDraftHist = useCallback(() => {
    histRef.current = histRef.current.filter((e) => e.kind !== 'draft')
    redoHistRef.current = redoHistRef.current.filter((e) => e.kind !== 'draft')
    forceHist((t) => t + 1)
  }, [])
  /** Drop 'shapes' entries for one tract — used where shape edits are
   *  discarded (Cancel) without switching tracts, so the tract-switch
   *  effect below never runs to do it. */
  const dropShapesHistFor = useCallback((tractId: string | null) => {
    if (!tractId) return
    histRef.current = histRef.current.filter((e) => !(e.kind === 'shapes' && e.tractId === tractId))
    redoHistRef.current = redoHistRef.current.filter((e) => !(e.kind === 'shapes' && e.tractId === tractId))
    forceHist((t) => t + 1)
  }, [])

  /** A manual boundary edit (drag a vertex, click the line to insert
   *  one, right-click/Alt-click to remove one) invalidates any land
   *  types already classified for the OLD outline — exactly the same
   *  reason 'Snap tracts' clears `shapes` and resets `classified`, so
   *  this does exactly what that does: the effect that watches
   *  `activeTract` for an unclassified tract re-reads the engine for
   *  the new shape on its own.
   *
   *  `snapshot`: false for a vertex DRAG, which already took its own
   *  tract-level undo snapshot at drag START (see `tookTract` below) —
   *  covering both the boundary move and this clear in one entry.
   *  True (the default) for the click-to-insert / right-click-delete
   *  gestures, which are a single instantaneous edit with no snapshot
   *  of their own yet. */
  const reclassifyOnBoundaryEdit = useCallback((tractId: string, opts: { snapshot?: boolean } = {}) => {
    const t = tractsRef.current.find((x) => x.id === tractId)
    if (!t || !t.shapes.length) return
    if (opts.snapshot !== false) snapshotTracts(tractsRef.current)
    setTracts((prev) => prev.map((x) => x.id === tractId
      ? { ...x, shapes: [], classified: false } : x))
    setSavedMsg('Outline changed — land types re-read for the new shape.')
  }, [snapshotTracts])

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
    // A tract now exists and is open — "Draw a tract" / a bare parcel
    // click must go back to disarmed until "Add Another Tract" re-arms it.
    setAddingTract(false)
    return t
  }, [snapshotTracts])

  const activeTract = useMemo(
    () => tracts.find((t) => t.id === selectedTractId) ?? null,
    [tracts, selectedTractId])

  // Owner 9/16: a parcel click used to open straight into land types —
  // engine polygons and vertex dots drawn immediately, no chance to fix
  // the outline first. A tract that is open now has its own per-screen
  // mode: 'outline' (Step 2 — boundary handles live, no classification,
  // no shapes drawn) or 'landtypes' (Step 3 — shapes drawn and editable,
  // boundary handles hidden). Every tract-opening path (a parcel click,
  // a remainder fill, a finished free-hand draw, or picking a row from
  // the list) lands in 'outline'; only pressing "3. Land Types" in the
  // step row moves it to 'landtypes'. Reset below whenever the OPEN
  // tract itself changes — switching mode does not touch selectedTractId,
  // so this never fires just from toggling 2/3.
  const [tractMode, setTractMode] = useState<'outline' | 'landtypes'>('outline')
  const tractModeRef = useRef(tractMode); tractModeRef.current = tractMode
  useEffect(() => { setTractMode('outline') }, [selectedTractId])

  const detail = activeTract?.detail ?? null
  const shapes = activeTract?.shapes ?? []
  // The parcel outline while it is still editable. Rings, like a shape.
  const boundaryRings = activeTract?.boundary ?? []
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
  // 'cutpoly' takes the two clicks that cut something in half — the
  // parcel in Stage 2, the selected land type in Stage 3.
  const [tool, setTool] = useState<'draw' | 'drawtract' | 'cutpoly' | 'erase' | null>(null)
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
  // 'switch' (opening another tract with edits pending), 'leave' (Back
  // to Map, dirty), 'removeTract', and the Row 2
  // 'clearPolygons'/'startOver' one-shot wipes all have a trigger. The
  // footer's own Cancel/'discardFooter' went with the Cancel+Finish
  // footer (owner: Save Tract is the only commit, Back to Map the only
  // exit) — 'leave' already covers the dirty check Back to Map needs.
  const [confirmWhat, setConfirmWhat] = useState<
    null | 'switch' | 'leave' | 'removeTract' | 'clearPolygons' | 'startOver'
  >(null)
  /** The tract `removeTract` is waiting on a 'removeTract' confirm for —
   *  set only when that tract is already saved server-side. */
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Pt[]>([])

  // Project context. A single-parcel user never sees this: leaving it
  // blank makes the server create a project named after the parcel.
  const [projectId, setProjectId] = useState<string | null>(null)
  // Owner 9/22: arriving from Explore with a parcel, Step 1 only offered a
  // NEW project. The user's existing projects are offered too — picking
  // one adds this tract to it.
  const [existingProjects, setExistingProjects] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    listProjects().then((r: any) => setExistingProjects((r?.projects ?? r ?? []).map((p: any) => ({ id: p.id, name: p.name }))))
      .catch(() => { /* the new-project path still works */ })
  }, [])
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

  const snapshot = useCallback((prev: Shape[]) => {
    pushHist({ kind: 'shapes', prev, tractId: selectedTractIdRef.current || '' })
  }, [pushHist])
  const mutate = useCallback((fn: (s: Shape[]) => Shape[]) => {
    // Snapshot OUTSIDE the updater. It used to run inside, which is a
    // side effect where React is allowed to run the updater twice — so
    // one edit pushed two undo entries, and the forceHist that re-enables
    // the Undo button never reliably fired, leaving the button dead.
    snapshot(shapesRef.current)
    setShapes(fn)
  }, [snapshot])
  const snapshotDraft = useCallback((prev: Pt[]) => {
    pushHist({ kind: 'draft', prev })
  }, [pushHist])
  const undo = useCallback(() => {
    const e = histRef.current.pop(); if (!e) return
    if (e.kind === 'shapes') {
      setShapes((cur) => {
        redoHistRef.current.push({ kind: 'shapes', prev: JSON.parse(JSON.stringify(cur)), tractId: e.tractId })
        return e.prev
      })
    } else if (e.kind === 'tracts') {
      setTracts((cur) => {
        redoHistRef.current.push({ kind: 'tracts', prev: JSON.parse(JSON.stringify(cur)) })
        return e.prev
      })
      setSelectedTractId((cur) => (e.prev.some((t) => t.id === cur) ? cur : (e.prev[0]?.id ?? null)))
    } else {
      setDraft((cur) => {
        redoHistRef.current.push({ kind: 'draft', prev: JSON.parse(JSON.stringify(cur)) })
        return e.prev
      })
    }
    forceHist((t) => t + 1)
  }, [])
  const redo = useCallback(() => {
    const e = redoHistRef.current.pop(); if (!e) return
    if (e.kind === 'shapes') {
      setShapes((cur) => {
        histRef.current.push({ kind: 'shapes', prev: JSON.parse(JSON.stringify(cur)), tractId: e.tractId })
        return e.prev
      })
    } else if (e.kind === 'tracts') {
      setTracts((cur) => {
        histRef.current.push({ kind: 'tracts', prev: JSON.parse(JSON.stringify(cur)) })
        return e.prev
      })
      setSelectedTractId((cur) => (e.prev.some((t) => t.id === cur) ? cur : (e.prev[0]?.id ?? null)))
    } else {
      setDraft((cur) => {
        histRef.current.push({ kind: 'draft', prev: JSON.parse(JSON.stringify(cur)) })
        return e.prev
      })
    }
    forceHist((t) => t + 1)
  }, [])

  /** AUDIT HIGH: the 'shapes' entries belong to whichever tract is
   *  open, and used to be cleared wholesale on every path that changes
   *  `selectedTractId` — now only the entries that no longer apply are
   *  dropped: 'shapes' entries for a tract that is not the one now
   *  open, and every 'draft' entry (a draft never survives a tract
   *  switch). 'tracts' entries are whole-list snapshots and stay valid
   *  regardless of which tract is open, so they are kept. */
  useEffect(() => {
    const keep = (arr: HistEntry[]) => arr.filter((e) =>
      e.kind === 'tracts' || (e.kind === 'shapes' && e.tractId === selectedTractId))
    histRef.current = keep(histRef.current)
    redoHistRef.current = keep(redoHistRef.current)
    forceHist((t) => t + 1)
  }, [selectedTractId])

  // ── load a parcel ─────────────────────────────────────────────────
  /** ADDS a tract to Stage 2's list — the common path (owner process:
   *  "click a parcel on the map"). Appending onto an empty list is the
   *  same thing as starting it, so the very first parcel and every one
   *  after it go through the same call. */
  const loadParcel = useCallback(async (llUuid: string, opts: { remainder?: boolean } = {}) => {
    setBusy('Loading parcel…'); setError(null); setSavedMsg(null)
    try {
      const d = await fetchParcel(llUuid)
      const rings = geometryToPolys(d.boundary)
      const existing = tractsRef.current
      // A map click identifies a parcel by its tile `path`, a search hit
      // by its ll_uuid; the server accepts either. Store the REAL id:
      // saving a tract casts source ll_uuids to uuid[] and a path in
      // there was a 500 on 'Save tracts' (sandbox 9/16).
      const uid = String(d.parcel?.ll_uuid || llUuid)

      // Remainder fill: ground under this parcel not already covered by
      // another tract in this project — lets a second click on the same
      // parcel add what a first tract left over as its OWN tract instead
      // of just re-selecting the whole thing (owner spec 2026-09-16). No
      // existing tracts means nothing to subtract — skip the call, same
      // as before this existed.
      // Only while ADDING a tract (owner: "Add Another Tract", then click
      // the parcel you cut). A plain click on a parcel that already has a
      // tract selects that tract — it must not quietly grow the list.
      if (opts.remainder && existing.length) {
        const subtract = existing.map((x) => polysToGeometry(x.boundary)).filter(Boolean)
        const diff = await differenceGeometry(d.boundary, subtract)
        if (diff.geometry && diff.acres >= 0.25) {
          // "(remaining)" only when ground was actually taken out of this
          // parcel — a neighbour that merely shares an edge with an
          // existing tract is still the whole parcel (sandbox 9/16).
          const parcelAc = Number(d.parcel?.acres) || boundaryAcresOf(rings)
          const carved = parcelAc - diff.acres >= 0.25
          const t = addTract({
            detail: d, boundary: geometryToPolys(diff.geometry), shapes: [],
            acres: diff.acres,
            source: { kind: 'parcel', ll_uuids: [uid] },
            name: d.parcel?.parcelnumb
              ? `Parcel ${d.parcel.parcelnumb}${carved ? ' (remaining)' : ''}` : '',
          })
          setStage(projectNameRef.current.trim() ? 'build' : 'project')
          markCleanRef.current?.([], t.boundary)
          setSelectedId(null)
          setSavedName('')
          setHits([])
          const bbR = bboxOf(diff.geometry?.coordinates)
          fitMap(bbR, { padding: 90, duration: 700 })
          return t
        }
      }

      // No remainder worth its own tract (nothing left, a sliver under
      // 0.25 ac, or this is the first tract in the project) — today's
      // behaviour: same parcel twice (a double click, or React
      // re-running the URL boot) selects the tract already in the list
      // rather than becoming a second one; otherwise load the whole
      // parcel as a new tract.
      const dup = existing.find((x) =>
        x.source.kind === 'parcel' && x.source.ll_uuids.length === 1
        && (x.source.ll_uuids[0] === uid || x.source.ll_uuids[0] === llUuid))
      if (dup) { setSelectedTractId(dup.id); return dup }

      const t = addTract({
        detail: d, boundary: rings, shapes: [],
        source: { kind: 'parcel', ll_uuids: [uid] },
        name: d.parcel?.parcelnumb ? `Parcel ${d.parcel.parcelnumb}` : '',
      })
      // Owner (9/15): the project is NAMED before tracts are built. A parcel
      // arriving with no project name yet lands on Stage 1 with the parcel
      // already on the map; once named, every later parcel stays in Stage 2.
      setStage(projectNameRef.current.trim() ? 'build' : 'project')
      markCleanRef.current?.([], rings)
      setSelectedId(null)
      setSavedName('')
      setHits([])
      const bb = bboxOf(d.boundary?.coordinates)
      fitMap(bb, { padding: 90, duration: 700 })
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
    if (!saved && proj && params.get('new') === '1') {
      setStage('build')
      // The project's NAME has to come along too: loadParcel decides
      // between Stage 2 and Stage 1's "name your project" card by
      // whether a name is set, so clicking a parcel here without one
      // asked the user to create a new project instead of adding the
      // tract to this one (owner 9/17, Map Portfolio → Add Tract).
      let stop = false
      getProject(proj)
        .then((r) => { if (!stop && r.project?.name) setProjectName(r.project.name) })
        .catch(() => { /* the name is a label; the save still targets `proj` */ })
      return () => { stop = true }
    }
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
          if (!r.parcels?.length) { setStage('build'); return }
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
    // `?edit=1` used to pick between opening read-only and opening for
    // editing — every boot path opens fully interactive now (owner
    // ruling 2026-09-16: opening a tract means editing it), so that
    // param is no longer read here.
    void openSavedTractRef.current?.(saved)
  }, [ready])

  /** Open a saved tract into the editor. Extracted from the ?parcel=
   *  boot path so clicking another tract on the map can reuse it. */
  const openLocalTractRef = useRef<((id: string) => boolean) | null>(null)
  const openSavedTract = useCallback(async (saved: string) => {
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
    // openLocalTract itself cancels a live draft, so nothing extra is
    // needed on this branch.
    if (already) { openLocalTractRef.current?.(already.id); return }
    // The server-fetch path bypasses openLocalTract entirely — cancel any
    // in-progress draft here too, for the same reason: it belongs to the
    // tract being left, not the one about to load in.
    if (drawingRef.current) { setDraft([]); setDrawing(false); setTool(null); dropDraftHist() }
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
          // A saved tract with NO polygons yet has never been classified —
          // Land Types must still ask the engine for it (owner 9/16:
          // "clicked Land Types, it never created the polygons").
          classified: loadedShapes.length > 0,
          acres: rec.stats?.acres ?? null,
          soilRating: rec.stats?.soil?.rating ?? null,
          soilRatingType: rec.stats?.soil?.rating_type ?? null,
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
        })
        markCleanRef.current?.(loadedShapes, loadedRings)
        // Opened for editing straight away — boundary and land-type
        // handles both live the moment this tract is on screen.
        setStage('build')
        setSelectedId(null)
        const bb = bboxOf(rec.boundary?.coordinates)
        fitMap(bb, { padding: 90, duration: 700 })
      } catch (e: any) {
        setError(e?.message || 'Could not open that saved parcel.')
      } finally { setBusy(null) }
    })()
  }, [addTract, dropDraftHist])
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
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left')
    // A fit that arrived while the canvas had no size (see `fitMap`)
    // lands here, the moment the canvas is really sized.
    map.on('resize', () => {
      const p = pendingFitRef.current
      if (!p || mapRef.current !== map || !canvasReady(map)) return
      pendingFitRef.current = null
      map.fitBounds(p.bb, { ...p.opts, duration: 0 })
    })

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
      // A draft point being drawn now feeds into THIS layer (see the
      // verts effect), rather than a separate 'cm-draft-dots' layer, so
      // it gets the same drag/remove gestures a finished polygon's
      // points already have. Its stroke falls back to VERTEX_LINE via
      // `['coalesce', ['get','color'], VERTEX_LINE]` unless the feature
      // carries its own `color` (a draft point does, to show the
      // drawing colour).
      map.addLayer({
        id: LYR_VERTS, type: 'circle', source: SRC.verts,
        paint: {
          // Bigger on the selected shape so it is obvious what you are
          // editing, but present on every polygon — a user should never
          // have to guess whether a shape can be reshaped.
          'circle-radius': ['case', ['boolean', ['get', 'active'], false], 5, 3.2],
          'circle-color': '#ffffff',
          'circle-stroke-color': ['coalesce', ['get', 'color'], VERTEX_LINE],
          'circle-stroke-width': ['case', ['boolean', ['get', 'active'], false], 2, 1.2],
        },
      })
      if (coarsePointer()) {
        // Finger-sized handles on touch screens (owner 9/17): the hit
        // test is the drawn circle, so a mouse-sized dot was a miss.
        map.setPaintProperty(LYR_VERTS, 'circle-radius',
          ['case', ['boolean', ['get', 'active'], false], 9, 6])
        map.setPaintProperty(LYR_VERTS, 'circle-stroke-width',
          ['case', ['boolean', ['get', 'active'], false], 3, 2])
      }
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
      let boxStartPx: { x: number; y: number } | null = null
      let boxEndPx: { x: number; y: number } | null = null
      const onBoxStart = (e: { lngLat: maplibregl.LngLat; point: { x: number; y: number }; preventDefault: () => void }) => {
        if (toolRef.current !== 'erase') return
        e.preventDefault()
        box = [e.lngLat.lng, e.lngLat.lat]
        boxStartPx = { x: e.point.x, y: e.point.y }
        boxEndPx = boxStartPx
        setMarq([box, box])
        map.dragPan.disable()
        map.touchZoomRotate.disable()
      }
      const onBoxMove = (e: { lngLat: maplibregl.LngLat; point: { x: number; y: number } }) => {
        if (!box) return
        boxEndPx = { x: e.point.x, y: e.point.y }
        setMarq([box, [e.lngLat.lng, e.lngLat.lat]])
      }
      const endBox = () => {
        if (!box) return
        let b = marqRef.current
        // A TAP (no real drag) erases the dots under the finger — on a
        // tablet a box drag is awkward, tapping a dot is not (owner 9/17).
        // The mouse gets the same: a click in Erase mode takes out the
        // dot it landed on.
        if (boxStartPx && boxEndPx
            && Math.abs(boxEndPx.x - boxStartPx.x) < 6 && Math.abs(boxEndPx.y - boxStartPx.y) < 6) {
          const r = coarsePointer() ? 22 : 10
          const a = map.unproject([boxEndPx.x - r, boxEndPx.y - r])
          const c = map.unproject([boxEndPx.x + r, boxEndPx.y + r])
          b = [[a.lng, a.lat], [c.lng, c.lat]]
        }
        box = null; boxStartPx = null; boxEndPx = null
        map.dragPan.enable()
        map.touchZoomRotate.enable()
        setMarq(null)
        if (b) eraseInBoxRef.current(b)
      }
      map.on('mousedown', onBoxStart)
      map.on('mousemove', onBoxMove)
      map.on('mouseup', endBox)
      map.on('touchstart', (e) => { if (e.points.length === 1) onBoxStart(e) })
      map.on('touchmove', (e) => { if (box) { e.preventDefault(); onBoxMove(e) } })
      map.on('touchend', endBox)
      map.on('touchcancel', endBox)

      // ── vertex dragging ───────────────────────────────────────────
      let drag: { id: string; pi: number; ri: number; vi: number } | null = null
      let took = false
      // Stage 2's own undo entry for a boundary drag — one per drag, not
      // per mousemove, same discipline as `took` below for shapes.
      let tookTract = false
      // Same discipline for a draft-point drag — one 'draft' history
      // entry per drag, not per mousemove.
      let tookDraft = false
      /** Take one handle out: a boundary handle in outline mode, a
       *  land-type point in Land Types, or (owner spec) a DRAFT point
       *  while a polygon/tract is still being drawn. Right-click /
       *  Alt-click on a mouse, LONG-PRESS on touch (owner 9/17). */
      const removeVertex = (owner: string, pi: number, ri: number, vi: number) => {
        if (owner === '__draft__') {
          snapshotDraft(draftRef.current)
          setDraft((prev) => prev.filter((_, i) => i !== vi))
          return true
        }
        if (owner === '__boundary__' && tractModeRef.current === 'outline') {
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
          reclassifyOnBoundaryEdit(selectedTractIdRef.current!)
          return true
        }
        if (owner !== '__boundary__' && tractModeRef.current === 'landtypes') {
          mutate((prev) => prev.map((sh) => sh.id !== owner ? sh : {
            ...sh,
            polys: sh.polys.map((rings, p2) => p2 !== pi ? rings
              : dropDegenerateHoles(rings.map((ring, i) => {
                if (i !== ri) return ring
                // Same rule inside a land-type polygon.
                if (ring.length <= 3) return ri === 0 ? ring : []
                return ring.filter((_, v) => v !== vi)
              }))),
          }))
          return true
        }
        return false
      }
      const onVertexDown = (e: any) => {
        // A draft dot sits on top of a finished shape's own handles at
        // the same screen point often enough (drawing right over an
        // existing polygon) that queryRenderedFeatures's default
        // top-of-stack pick is not reliable — prefer the draft dot
        // explicitly so it always wins the hit test while it exists.
        const f = e.features?.find((ft: any) => String(ft.properties?.shapeId) === '__draft__') ?? e.features?.[0]
        if (!f) return
        const owner = String(f.properties!.shapeId)
        // Belt and braces with the layer being empty: nothing to drag
        // with no tract open (no boundary, no shapes) — except a DRAFT
        // point, which exists precisely while free-hand 'drawtract'
        // drawing has no open tract at all.
        if (!selectedTractIdRef.current && owner !== '__draft__') return
        // In Erase mode the press starts an erase box / tap instead.
        if (toolRef.current === 'erase') return
        e.preventDefault()

        // Remove a handle: right button, or Alt/Option-click. Handled on
        // MOUSEDOWN rather than a 'contextmenu' listener — that fired
        // inconsistently and the browser's own menu often won the event
        // instead (the canvas listener below suppresses that menu).
        // Alt-click is the fallback for anyone whose mouse or trackpad
        // makes right-click awkward.
        const oe = e.originalEvent as MouseEvent
        if (oe.button === 2 || oe.altKey) {
          if (removeVertex(owner, Number(f.properties!.pi), Number(f.properties!.ri), Number(f.properties!.vi))) return
        }

        if (owner !== '__boundary__' && owner !== '__draft__' && owner !== selectedRef.current) setSelectedId(owner)
        drag = { id: owner, pi: f.properties!.pi, ri: f.properties!.ri, vi: f.properties!.vi }
        took = false
        tookTract = false
        tookDraft = false
        map.dragPan.disable()
      }
      map.on('mousedown', LYR_VERTS, onVertexDown)
      const onDragMove = (e: { lngLat: maplibregl.LngLat }) => {
        if (!drag) return
        // One undo snapshot per drag, not per mousemove.
        const { id, pi, ri, vi } = drag
        if (id === '__draft__') {
          const newPt: Pt = [e.lngLat.lng, e.lngLat.lat]
          // Land Types drawing stays inside the tract outline (owner
          // spec) — a drag that would put the point outside is ignored,
          // same as a click outside is ignored below. 'drawtract' is
          // unrestricted (no boundary exists yet).
          if (toolRef.current === 'draw' && boundaryRef.current.length
              && !pointInBoundary(newPt, boundaryRef.current)) return
          if (!tookDraft) { snapshotDraft(draftRef.current); tookDraft = true }
          setDraft((prev) => prev.map((pt, i) => (i === vi ? newPt : pt)))
          return
        }
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
      }
      map.on('mousemove', onDragMove)
      // Dragging a handle rewrites `shapes` directly, so nothing was
      // re-checking overlap: enforceNoOverlap only ran from finishDraft,
      // i.e. when a NEW shape was drawn. That let an edited polygon be
      // dragged straight over its neighbour. Re-run the check when the
      // drag ENDS -- not on mousemove, which would fire a round trip per
      // frame. Boundary drags take the other branch below instead: they
      // reclassify the tract's land types rather than re-checking shape
      // overlap, since dragging the OUTLINE is what invalidates them.
      const endDrag = () => {
        if (!drag) return
        // A draft-point drag ends here and nothing else — it is not a
        // shape (no overlap to re-check) and not the boundary (nothing
        // to reclassify).
        if (drag.id === '__draft__') { drag = null; map.dragPan.enable(); return }
        const wasShape = drag.id !== '__boundary__'
        const draggedId = drag.id
        const movedBoundary = !wasShape && tookTract
        drag = null
        map.dragPan.enable()
        if (wasShape) void enforceNoOverlapRef.current(shapesRef.current, draggedId)
        // `draggedId` is '__boundary__' here, not a tract id — the tract
        // being dragged is whichever one is open. `snapshot: false`:
        // `tookTract`'s own snapshotTracts call above already captured
        // the tract as it stood BEFORE this drag moved it (shapes
        // included), so one Undo reverts the boundary AND restores the
        // shapes in a single step; a second snapshot here would only
        // split that into two.
        if (movedBoundary && selectedTractIdRef.current) {
          reclassifyOnBoundaryEdit(selectedTractIdRef.current, { snapshot: false })
        }
      }
      map.on('mouseup', endDrag)
      map.on('mouseout', endDrag)

      // ── touch: hold a dot to drag it; hold STILL to remove it ─────
      // Everything above listens to mouse events only, so on an iPad a
      // finger on a dot panned the map instead (owner 9/17). One finger
      // on a handle starts the same drag; the map's own pan and pinch
      // are paused for the duration. A press that never moves for
      // 550 ms is a long-press and removes the handle (Undo restores
      // it) — the touch stand-in for right-click.
      let lpTimer: number | undefined
      let lpStart: { x: number; y: number } | null = null
      map.on('touchstart', LYR_VERTS, (e) => {
        if (e.points.length !== 1) return
        // Same draft-dot-wins-the-hit-test preference as onVertexDown.
        const f = e.features?.find((ft: any) => String(ft.properties?.shapeId) === '__draft__') ?? e.features?.[0]
        if (!f || toolRef.current === 'erase') return
        if (!selectedTractIdRef.current && String(f.properties!.shapeId) !== '__draft__') return
        onVertexDown(e)
        if (!drag) return
        map.touchZoomRotate.disable()
        lpStart = { x: e.point.x, y: e.point.y }
        const owner = String(f.properties!.shapeId)
        const pi = Number(f.properties!.pi), ri = Number(f.properties!.ri), vi = Number(f.properties!.vi)
        window.clearTimeout(lpTimer)
        lpTimer = window.setTimeout(() => {
          if (!drag || !lpStart) return
          drag = null; lpStart = null
          map.dragPan.enable(); map.touchZoomRotate.enable()
          if (removeVertex(owner, pi, ri, vi)) setSavedMsg('Point removed — Undo brings it back.')
        }, 550)
      })
      map.on('touchmove', (e) => {
        if (!drag) return
        e.preventDefault()
        if (lpStart && Math.hypot(e.point.x - lpStart.x, e.point.y - lpStart.y) > 8) {
          lpStart = null
          window.clearTimeout(lpTimer)
        }
        // Holding still: waiting to see whether this is a long-press.
        if (lpStart) return
        onDragMove(e)
      })
      const endTouchDrag = () => {
        window.clearTimeout(lpTimer)
        lpStart = null
        map.touchZoomRotate.enable()
        endDrag()
      }
      map.on('touchend', endTouchDrag)
      map.on('touchcancel', endTouchDrag)
      map.on('mouseenter', LYR_VERTS, () => { map.getCanvas().style.cursor = 'move' })
      map.on('mouseleave', LYR_VERTS, () => { map.getCanvas().style.cursor = '' })

      // ── boundary: add a dot on the line, remove one from a dot ─────
      // Click the outline itself to drop a new handle where you clicked;
      // right-click a handle to take it out. Both refuse to leave fewer
      // than three points, which would stop being a polygon.
      map.on('click', 'cm-boundary-line', (e) => {
        if (tractModeRef.current !== 'outline') return
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
        reclassifyOnBoundaryEdit(selectedTractIdRef.current!)
      })
      map.on('mouseenter', 'cm-boundary-line', () => {
        if (tractModeRef.current === 'outline') map.getCanvas().style.cursor = 'copy'
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
        // A click on the outline of an open tract IN OUTLINE MODE means
        // "add a handle here" and is handled by the layer listener
        // above; letting it fall through would also try to select a
        // parcel underneath.
        if (tractModeRef.current === 'outline'
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
          // A click that landed on an existing draft dot is a vertex
          // interaction (drag/remove), handled by the LYR_VERTS
          // listeners above — it must not ALSO drop a new point here.
          if (map.queryRenderedFeatures(e.point, { layers: [LYR_VERTS] }).length) return
          let pt: Pt = [e.lngLat.lng, e.lngLat.lat]
          // "Draw a tract": magnet-snap the corner onto another tract's
          // edge or a live Regrid parcel line within ~30 ft (owner spec)
          // so two tracts meant to share a fence actually do.
          if (toolRef.current === 'drawtract') {
            const targets = snapTargetsNear(map, e.point, tractsRef.current)
            const snapped = snapPoint(map, pt, targets, 30)
            if (snapped.snapped) pt = snapped.point
          }
          // Land Types: a click outside the open tract's boundary does
          // not add a point (owner spec — land types stay inside the
          // tract). 'drawtract' is unrestricted.
          if (toolRef.current === 'draw' && boundaryRef.current.length
              && !pointInBoundary(pt, boundaryRef.current)) {
            setSavedMsg('Land types stay inside the tract outline.')
            return
          }
          snapshotDraft(draftRef.current)
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
        // A tract with a parcel loaded is open for classifying, so a
        // stray click on the map must not load another parcel or reload
        // this one — reloading rebuilt the outline from the database, so
        // a stray click anywhere silently threw away every dot the user
        // had moved. Switching tracts is deliberate — it goes through
        // the tract list / a badge click.
        //
        // While actively ADDING another tract this must NOT block a
        // parcel click — that click is exactly how a new tract gets
        // built (owner process), even with another tract already open.
        if (detailRef.current && !addingTractRef.current) { setSelectedId(null); return }

        const onParcel = map.queryRenderedFeatures(e.point, { layers: ['regrid-parcels-fill'] })
        // `path` is what the tiles actually carry — ll_uuid is not in
        // the tile schema, so keying only off it made every parcel click
        // a no-op and the screen looked like it had no selection at all.
        const props = onParcel[0]?.properties || {}
        const pid = props.ll_uuid || props.ll_uuid_text || props.path
        if (pid) {
          // A parcel click only starts a NEW tract while "adding" is
          // armed (or the list is empty — nothing to protect yet). A
          // parcel that already has a tract still routes through so the
          // existing select/remainder-fill behaviour in loadParcel runs.
          // Not adding: a click selects the tract UNDER the cursor. Once a
          // parcel has been split into two tracts they share a source
          // parcel, so matching by parcel alone would always pick the
          // first one in the list (auditor 9/16).
          if (!addingTractRef.current && tractsRef.current.length) {
            const at: Pt = [e.lngLat.lng, e.lngLat.lat]
            const under = tractsRef.current.find((x) =>
              x.boundary.some((rings) => rings[0] && pointInRing(at, rings[0])
                && !rings.slice(1).some((h) => pointInRing(at, h))))
            if (under) { setSelectedTractId(under.id); return }
          }
          const isDup = tractsRef.current.some((x) =>
            x.source.kind === 'parcel' && x.source.ll_uuids.length === 1 && x.source.ll_uuids[0] === String(pid))
          if (addingTractRef.current || tractsRef.current.length === 0 || isDup) {
            void loadParcelRef.current(String(pid), { remainder: addingTractRef.current })
          }
          return
        }
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

  /** Turns the current draft into a shape ('draw') or a tract
   *  ('drawtract') and returns what it made, SYNCHRONOUSLY — computed
   *  from `shapesRef`/`addTract`'s own return rather than left to
   *  land via React's async state update, so a caller (Save Tract, see
   *  below) can save the just-finished polygon/tract in the very same
   *  press instead of racing the next render. Always drops the 'draft'
   *  history entries: the finished result is itself undoable through
   *  its own 'shapes'/'tracts' entry. */
  const finishDraft = useCallback((): (
    { kind: 'shape'; shapes: Shape[] } | { kind: 'tract'; tract: Tract } | null
  ) => {
    const d = draftRef.current
    let result: { kind: 'shape'; shapes: Shape[] } | { kind: 'tract'; tract: Tract } | null = null
    if (d.length >= 3) {
      const ring = simplifyRing(d, 0.000004)
      if (toolRef.current === 'drawtract') {
        // Stage 2: a free-hand tract, added to the list like any other.
        const t = addTract({ boundary: [[ring]], shapes: [], source: { kind: 'drawn' } })
        result = { kind: 'tract', tract: t }
      } else {
        const id = nextId()
        const next = [...shapesRef.current, { id, cls: drawClassRef.current, polys: [[ring]] }]
        mutate(() => next)
        // Drawn last, so this one wins any overlap — then the server
        // trims the others and clips everything to the boundary.
        void enforceNoOverlapRef.current(next)
        setSelectedId(id)
        result = { kind: 'shape', shapes: next }
      }
    }
    dropDraftHist()
    setDraft([]); setDrawing(false); setTool(null)
    return result
  }, [mutate, addTract, dropDraftHist])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'Enter' && drawingRef.current) { e.preventDefault(); finishDraft() }
      if (e.key === 'Escape') { setDraft([]); setDrawing(false); dropDraftHist() }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); e.shiftKey ? redo() : undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finishDraft, undo, redo, dropDraftHist])

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
        dropShapesHistFor(tractId)
        setSelectedId(loaded.length
          ? loaded.reduce((a, b) => (shapeAcres(b) > shapeAcres(a) ? b : a)).id
          : null)
      }
    } catch (e: any) {
      setError(e?.message || 'Could not fit the land types to that boundary.')
    } finally { setBusy(null) }
  }, [])

  /** Land types classify ONLY on entering 'landtypes' mode now (pressing
   *  "3. Land Types" in the step row) — opening a tract, however it got
   *  opened (a parcel click, a remainder fill, a finished free-hand
   *  draw, or a row in the list), lands in 'outline' and must not spend
   *  an engine call before the owner has even looked at the boundary.
   *  Runs off `activeTract`/`tractMode` themselves rather than being
   *  called right inside `addTract` because `addTract` calls
   *  `setTracts`/`setSelectedTractId` and then reads back through
   *  `tractsRef` — a ref that, like every ref mirroring state in this
   *  file, only catches up on the NEXT render, so an immediate call
   *  there would find nothing yet and silently no-op. */
  useEffect(() => {
    if (activeTract && tractMode === 'landtypes' && !activeTract.classified) {
      void ensureClassified(activeTract.id)
    }
  }, [activeTract, tractMode, ensureClassified])

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
      fitMap(bb, { padding: 90, maxZoom: 13, duration: 800 })
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
    // `onBoundary` (cutting the parcel itself into tracts) is always
    // false now — the outline-mode toolbar has no cut control, only
    // 'landtypes' mode's "Split Polygon" button arms `cutpoly`, and that
    // always targets the selected land-type shape. Left as a live
    // branch (and `pieces`/`savePieces` below it) rather than torn out,
    // same as the removed Stage 2 "Split parcel"
    // button's leftover plumbing further down this file.
    const onBoundary = false
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
    // The boundary branch below is unreachable the same way runCut's is —
    // 'erase' only ever arms from 'landtypes' mode's "Erase Points"
    // button, which always targets the selected land-type shape.
    if (false as boolean) {
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
  // Always asks first (owner 9/16: deleting a tract polygon needs a
  // confirmation pop-up) — a saved tract also loses its server record.
  const removeTract = useCallback((id: string) => {
    setPendingRemoveId(id)
    setConfirmWhat('removeTract')
  }, [])
  const removeLocalTract = useCallback((id: string) => {
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

  /** 'Snap tracts' / 'Snap to Parcel' (design spec §2, §4; frame picked
   *  automatically as of 2026-09-16 — the old "Select frame parcels"
   *  click-every-parcel tool read as confusing (owner)). Builds the
   *  FRAME — a single tract's own source parcel, or every Regrid parcel
   *  actually underneath the current tracts combined, or (Regrid has
   *  nothing under them — e.g. every tract is hand-drawn) the tracts'
   *  own boundaries combined into one shape they are fit against each
   *  other — then calls the server's fit-tracts endpoint, which is the
   *  only source of truth for the resulting acres (never sum client
   *  acres for a frame total). Resets `classified` on every touched
   *  tract so Stage 3 re-asks the engine for the boundary that actually
   *  got saved. */
  const snapTracts = useCallback(async () => {
    if (!tracts.length) return
    setBusy('Snapping tracts…'); setError(null)
    try {
      let frameGeom: any = null
      let frameParts: any[] = []
      let frameMeta: { ll_uuids: string[]; boundary: Pt[][][] } | null = null
      const ownGeoms = tracts.map((t) => polysToGeometry(t.boundary)).filter(Boolean)
      if (tracts.length === 1 && tracts[0].source.kind === 'parcel' && tracts[0].detail?.boundary) {
        // 'Snap to Parcel': the lone tract's own source parcel IS the frame.
        frameGeom = tracts[0].detail.boundary
        frameParts = [frameGeom]
        frameMeta = { ll_uuids: tracts[0].source.ll_uuids, boundary: geometryToPolys(frameGeom) }
      } else {
        const under = ownGeoms.length ? (await parcelsUnder(ownGeoms)).parcels : []
        frameParts = under.map((p) => p.geometry)
        if (under.length === 1) {
          frameGeom = under[0].geometry
          frameMeta = { ll_uuids: [under[0].ll_uuid], boundary: geometryToPolys(frameGeom) }
        } else if (under.length > 1) {
          frameGeom = (await combineGeometry(under.map((p) => p.geometry))).geometry
          frameMeta = { ll_uuids: under.map((p) => p.ll_uuid), boundary: geometryToPolys(frameGeom) }
        } else {
          // Nothing found under the tracts (Regrid gap, or every tract
          // is hand-drawn) — fall back to fitting the tracts to
          // themselves, same as before this tract had automatic framing.
          frameGeom = ownGeoms.length > 1 ? (await combineGeometry(ownGeoms)).geometry : ownGeoms[0]
        }
      }
      if (!frameGeom) {
        setError('Nothing to snap to yet — draw a tract first.')
        return
      }
      setFrame(frameMeta)
      const payload = tracts.map((t) => ({ id: t.id, geometry: polysToGeometry(t.boundary) }))
        .filter((x) => x.geometry) as { id: string; geometry: any }[]
      const res = await fitTracts(frameGeom, payload, frameParts)
      snapshotTracts(tractsRef.current)
      setTracts((prev) => prev.map((t) => {
        const hit = res.tracts.find((r) => r.id === t.id)
        if (!hit) return t
        return { ...t, boundary: geometryToPolys(hit.geometry), acres: hit.acres, classified: false, shapes: [] }
      }))
      if (res.dropped.length) {
        setError(`${res.dropped.length} tract${res.dropped.length === 1 ? '' : 's'} `
          + 'had no ground left after fitting to the frame — check the list.')
      } else if (res.unassigned_acres >= 0.5) {
        // The fit lines the DRAWN tract up with the parcel — it never
        // grows a half-parcel sketch into the whole parcel — so say how
        // much of the parcel is still not in any tract (owner 9/16).
        setSavedMsg(`Snapped ${res.tracts.length} tract${res.tracts.length === 1 ? '' : 's'} `
          + `to the parcel lines — ${res.unassigned_acres.toFixed(1)} ac of the `
          + `${res.frame_acres.toFixed(1)} ac parcel is not in a tract yet. `
          + 'Use Add Another Tract and click the parcel to fill the rest.')
      } else {
        setSavedMsg(`Fit ${res.tracts.length} tract${res.tracts.length === 1 ? '' : 's'} `
          + `to ${res.frame_acres.toFixed(1)} ac.`)
      }
    } catch (e: any) {
      setError(e?.message || 'Could not snap these tracts.')
    } finally { setBusy(null) }
  }, [tracts, snapshotTracts])

  // The old "Continue to Land Types" step-transition (openId pick +
  // ensureClassified) is gone — every tract now classifies lazily the
  // moment it opens, via `openLocalTract` itself, whether that is the
  // first tract created or any row clicked afterward.

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
  const saveAllTracts = useCallback(async (
    only?: string[],
    // Save Tract can finish a polygon/tract and save it in the SAME
    // press — `finishDraft`'s result lands in React state
    // asynchronously, so this is how the just-finished shapes/tract get
    // into the save that happens immediately after, in the same
    // keystroke's worth of synchronous code. `tractId`+`shapes`: the
    // open tract's shapes list, with the just-finished land-type
    // polygon already in it. `tract`: a brand-new free-hand tract
    // `addTract` just created (its own setTracts call may not have
    // landed in `tractsRef` yet either).
    override?: { tractId: string; shapes: Shape[] } | { tract: Tract },
  ): Promise<boolean> => {
    if (savingAllRef.current) return false
    // Reads `tractsRef.current`, not the `tracts` closure — this can be
    // called synchronously right after `finishDraft`, before a render
    // has landed the tract it just added/changed.
    let pool = tractsRef.current
    if (override && 'tract' in override && !pool.some((t) => t.id === override.tract.id)) {
      pool = [...pool, override.tract]
    }
    if (override && 'shapes' in override) {
      pool = pool.map((t) => (t.id === override.tractId ? { ...t, shapes: override.shapes } : t))
    }
    // `only`: the Stage 2 "Save Tract" button saves ONE tract — the one
    // that is open — the user saves a tract at a time (owner 9/16).
    const toSave = only ? pool.filter((t) => only.includes(t.id)) : pool
    if (!toSave.length) return false
    if (toSave.some((t) => !t.name.trim())) {
      setError(only ? 'Name this tract before saving.' : 'Name every tract before saving.')
      return false
    }
    savingAllRef.current = true
    setBusy('Saving…'); setError(null); setSavedMsg(null)
    try {
      let pid = projectId
      for (const t of toSave) {
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
          soilRating: st.soil?.rating ?? x.soilRating,
          soilRatingType: st.soil?.rating_type ?? x.soilRatingType,
        })))
      }
      setProjectId(pid)
      setSavedMsg(toSave.length === 1 && only
        ? `Saved ${toSave[0].name.trim()}.`
        : `Saved ${toSave.length} tract${toSave.length === 1 ? '' : 's'}.`)
      markCleanRef.current?.(shapes, boundaryRings)
      // Belt and braces: once the setTracts above has landed, mark clean
      // from what the OPEN tract actually holds now, so a save can never
      // leave "unsaved changes" behind (owner 9/16: a false "Save before
      // switching?" right after Save Tract).
      setTimeout(() => {
        const cur = tractsRef.current.find((x) => x.id === selectedTractIdRef.current)
        if (cur && toSave.some((t) => t.id === cur.id)) markCleanRef.current?.(cur.shapes, cur.boundary)
      }, 0)
      return true
    } catch (e: any) {
      setError(e?.message || 'Save failed.')
      return false
    } finally { setBusy(null); savingAllRef.current = false }
  }, [projectId, projectName, shapes, boundaryRings])

  const fingerprint = useCallback((sh: Shape[], b: Pt[][][]) => JSON.stringify([
    sh.map((x) => [x.cls, x.polys]), b,
  ]), [])
  const markClean = useCallback((sh: Shape[], b: Pt[][][]) => {
    cleanRef.current = fingerprint(sh, b)
    setDirty(false)
    // The ref is what requestOpen / Back to Map read synchronously; it
    // only used to refresh in the fingerprint effect, i.e. on the NEXT
    // edit — so a save followed by a tract switch still asked "Save
    // before switching?" (owner 9/16, twice).
    dirtyRef.current = false
  }, [fingerprint])
  markCleanRef.current = markClean
  useEffect(() => {
    // A live draft (points placed but not yet finished into a shape or
    // a tract) is unsaved work too — without this, switching tracts
    // mid-draw fell straight through the "nothing to lose" path and
    // silently dropped every point the user had placed.
    const d = fingerprint(shapes, boundaryRings) !== cleanRef.current || (drawing && draft.length > 0)
    setDirty(d); dirtyRef.current = d
    // Mirrored onto the tract itself too — Stage 2's tract LIST will read
    // this per tract (an unsaved-work indicator next to its name) instead
    // of the single top-level `dirty`, which only ever describes whichever
    // tract happens to be open.
    if (selectedTractId) {
      setTracts((prev) => prev.map((t) =>
        t.id === selectedTractId && t.dirty !== d ? { ...t, dirty: d } : t))
    }
  }, [shapes, boundaryRings, fingerprint, selectedTractId, drawing, draft])

  /** Switch to a tract already sitting in LOCAL state (this session's
   *  list, maybe never saved) — no server round trip, since a brand-new
   *  or drawn tract does not exist there to fetch. Opens into 'outline'
   *  mode (the `selectedTractId` effect above resets it) — no classify
   *  call here; that only happens once "3. Land Types" is pressed.
   *  Returns false when `id` is not a local tract, so the caller can
   *  fall back to the server-fetch path for a peer from a
   *  previously-saved project that was never loaded into this
   *  session's list. */
  const openLocalTract = useCallback((id: string) => {
    const t = tractsRef.current.find((x) => x.id === id)
    if (!t) return false
    // A live draft belongs to whichever tract was open when it was
    // started — it does not carry over to the tract being switched to,
    // and left running it would go on placing/editing points against a
    // boundary that is no longer even on screen. Cancel it the same way
    // the toolbar's own "Cancel Drawing" button does.
    if (drawingRef.current) { setDraft([]); setDrawing(false); setTool(null); dropDraftHist() }
    setSelectedTractId(id)
    setSelectedId(null)
    markCleanRef.current?.(t.shapes, t.boundary)
    const geom = polysToGeometry(t.boundary)
    const bb = geom ? bboxOf(geom.coordinates) : null
    fitMap(bb, { padding: 90, duration: 700 })
    return true
  }, [dropDraftHist])
  openLocalTractRef.current = openLocalTract

  /** Switching to another tract behaves like Cancel: straight through
   *  when nothing is unsaved, otherwise ask — and there OK SAVES and
   *  switches rather than throwing the work away. Tries the LOCAL list
   *  first (this session's own tracts), then falls back to fetching a
   *  saved tract that is not in this session's list.
   *
   *  Every tract on this one screen can carry both boundary and
   *  land-type edits now, so the dirty check applies uniformly — there
   *  is no longer a draft-only mode exempt from it. */
  const requestOpen = useCallback((id: string) => {
    if (id === selectedTractIdRef.current) return
    const doOpen = () => { if (!openLocalTract(id)) void openSavedTractRef.current?.(id) }
    if (!dirtyRef.current) { doOpen(); return }
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
    // A local tract that has been SAVED comes back from the server under
    // its record id (savedId), not its session id — match both, or the
    // saved copy draws a second badge with the pre-rename name (owner
    // 9/16: "both the old AND the new name show up").
    const localIds = new Set(tracts.flatMap((t) => (t.savedId ? [t.id, t.savedId] : [t.id])))
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

  // Stage 2's frame: once 'Snap tracts' has run, the combined frame it
  // fit against (picked automatically now — see `snapTracts`).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const g = frame ? polysToGeometry(frame.boundary) : null
    const feats = g ? [{ type: 'Feature', geometry: g, properties: {} }] : []
    ;(map.getSource(SRC.frame) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: feats } as any)
  }, [frame, ready])

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
    // Land-type shapes are drawn ONLY in 'landtypes' mode — 'outline'
    // mode is boundary-only, no classification triggered, nothing to
    // show or edit here yet (owner 9/16).
    const feats: any[] = []
    if (tractMode === 'landtypes') {
      for (const s of shapes) {
        const g = polysToGeometry(s.polys)
        if (g) feats.push({
          type: 'Feature', geometry: g,
          properties: { id: s.id, color: CLASS_COLOR[s.cls], selected: s.id === selectedId },
        })
      }
    }
    ;(map.getSource(SRC.shapes) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: feats } as any)

    // Handles for the tract outline OR the selected land-type shape —
    // never both: 'outline' mode (Step 2) shows every boundary point,
    // draggable; 'landtypes' mode (Step 3) shows the selected shape's
    // points instead and hides the boundary entirely, since the
    // outline isn't edited there.
    const verts: any[] = []
    if (activeTract && tractMode === 'outline') {
      boundaryRings.forEach((rings, pi) => rings.forEach((ring, ri) =>
        ring.forEach((pt, vi) => verts.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: pt },
          properties: { shapeId: '__boundary__', pi, ri, vi, active: true },
        }))))
    } else if (tractMode === 'landtypes') {
      const sel = shapes.find((sh) => sh.id === selectedId)
      sel?.polys.forEach((rings, pi) => rings.forEach((ring, ri) =>
        ring.forEach((pt, vi) => verts.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: pt },
          properties: { shapeId: sel.id, pi, ri, vi, active: true },
        }))))
    }
    // Draft points, while drawing, feed into this SAME vertex layer so
    // they get the same drag-to-move / right-click-or-long-press-to-
    // remove gestures a finished polygon already has (owner spec) — the
    // separate 'cm-draft-dots' circle layer is gone; these ARE the dots.
    // They take the drawing colour (the land-type class for 'draw',
    // white for 'drawtract') via `color`, read by LYR_VERTS's
    // circle-stroke-color below.
    if (drawing && draft.length) {
      const draftColor = tool === 'draw' ? (CLASS_COLOR[drawClass] || '#ffffff') : '#ffffff'
      draft.forEach((pt, vi) => verts.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: pt },
        properties: { shapeId: '__draft__', pi: 0, ri: 0, vi, active: true, color: draftColor },
      }))
    }
    ;(map.getSource(SRC.verts) as maplibregl.GeoJSONSource)?.setData(
      { type: 'FeatureCollection', features: verts } as any)
  }, [shapes, selectedId, activeTract, tractMode, boundaryRings, draft, drawing, tool, drawClass, ready])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    // The outline is always live now — boundaryRings, not a locked
    // snapshot from `detail` — since 'outline' mode keeps dragging it
    // right up until "3. Land Types" is pressed. Falls back to the
    // last-fetched detail only for the instant before a fresh tract's
    // rings have loaded.
    const geom = polysToGeometry(boundaryRings) || detail?.boundary
    ;(map.getSource(SRC.boundary) as maplibregl.GeoJSONSource)?.setData({
      type: 'FeatureCollection',
      features: geom ? [{ type: 'Feature', geometry: geom, properties: {} }] : [],
    } as any)

    // The pink wash is 'outline' mode's own look — once in 'landtypes'
    // it would lie over every land-type shape at 22% and read as a
    // muddy brown over correct engine output. The outline LINE itself
    // still stays visible in both modes, just without the wash.
    if (map.getLayer('cm-boundary-fill')) {
      map.setLayoutProperty('cm-boundary-fill', 'visibility',
        tractMode === 'outline' ? 'visible' : 'none')
    }
  }, [detail, boundaryRings, tractMode, ready])

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
      // The closing segment is only drawn for an area being drawn, not
      // for a split line -- a split is a cut ACROSS, never a ring. The
      // dots themselves no longer come from here — they are drawn by
      // LYR_VERTS (see the verts effect above), which is what makes
      // them draggable/removable the same way a finished polygon's
      // points are.
      features: draft.length >= 2 ? [{
        type: 'Feature', properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [...draft, draft[0]],
        },
      }] : [],
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
        if (r.parcels.length) fitMap(bb, { padding: 120, maxZoom: 15, duration: 700 })
      } else if (r.kind === 'flyto') {
        setNote(r.label)
        if (r.bounds) fitMap(r.bounds, { padding: 60, duration: 800 })
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
    dropShapesHistFor(selectedTractIdRef.current)
  }, [editingId, detail])

  // `discardAndClose` and `addTractToProject` (the old footer Cancel
  // button's two destinations — close the parcel entirely, or stay in
  // the project and start a fresh one) went with that button, and the
  // footer's Finish went the same way: Save Tract is the only commit
  // now and "Back to Map" (top-left, its own dirty-confirm) is the
  // only exit, so nothing calls either of these any more.

  // The draft line takes the colour of the land type being drawn, so
  // what you are drawing looks like what it will become. The draft
  // DOTS get their colour per-feature instead (see the verts effect —
  // they are LYR_VERTS features now, not a separate layer), since that
  // effect already recomputes on `drawClass`.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const c = CLASS_COLOR[drawClass] || '#ffffff'
    if (map.getLayer('cm-draft-line')) map.setPaintProperty('cm-draft-line', 'line-color', c)
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
    // Runs in 'outline' mode too: the tract row in the Tracts card shows
    // the rating in every mode (owner 9/16), not only the Acres card.
    if (!activeTract || !detail) { setSoil(null); return }
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
        if (!cancelled) {
          setSoil({ rating: r.rating, rating_type: r.rating_type })
          // Keep it on the tract itself so the row still shows it after
          // you switch to another tract.
          const tid = selectedTractIdRef.current
          if (r.rating != null && tid) {
            setTracts((prev) => prev.map((x) => x.id === tid
              ? { ...x, soilRating: r.rating, soilRatingType: r.rating_type } : x))
          }
        }
      } catch {
        if (!cancelled) setSoil(null)
      } finally {
        if (!cancelled) setSoilBusy(false)
      }
    }, 700)
    return () => { cancelled = true; clearTimeout(t); setSoilBusy(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tillableKey, selectedTractId, tractMode, detail?.boundary])

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

  // Tract data (item 7): the outline's own centre point, for a tract
  // with no parcel behind it as much as one with — same maths the map's
  // peer badges use to place themselves.
  const tractCentre = useMemo(() => ringCentre(boundaryRings), [boundaryRings])

  const storedAcres = Number(detail?.parcel?.acres ?? 0)
  // Use the boundary that is actually on screen in BOTH steps. In step 2
  // this used to fall back to the parcel's stored acreage, so if the
  // outline had been trimmed the land types (clipped to the new outline)
  // shrank while Total did not — and the gap landed in
  // "Other / Unclassified", which reads as though the engine returned
  // nonsense. Total must describe the same shape the classes were cut to.
  const parcelAcres = liveBoundaryAcres > 0 ? liveBoundaryAcres : storedAcres
  const classified = LAND_CLASSES.reduce((s, c) => s + totals[c], 0)

  // The bottom toolbar's hint pill: copy for whichever tool is currently
  // ARMED, shown only while it is armed — an idle toolbar, or a one-shot
  // action like Snap Tracts/Fill Holes, gets no pill; those get a plain
  // title tooltip instead, like the rest of this screen's buttons.
  // 'outline' and 'landtypes' modes each have their OWN toolbar row now
  // (never both at once), so this is one priority chain covering every
  // tool from either row — whichever is actually armed wins — plus a
  // default per-mode instruction when nothing is.
  const toolbarHint =
    (tool === 'drawtract' && drawing) ? 'Click to place corners. Save Tract, Enter or double-click '
      + 'closes the shape; edges and other tracts snap automatically.'
    : (tool === 'draw' && drawing) ? 'Click to place corners. Save Tract, Enter or double-click '
      + 'closes the shape; Esc cancels.'
    : tool === 'cutpoly' ? 'Click once on each side of the selected polygon. It cuts on the second click.'
    : tool === 'erase' ? 'Drag a box over a run of dots and they are all removed at once. '
      + 'Right-click (or Alt-click) a single dot to remove just that one.'
    : addingTract ? (tracts.length === 0
      ? 'To start your first tract: click a parcel on the map, or press Draw a Tract below.'
      : 'Adding a tract: click a parcel on the map, or press Draw a Tract below.')
    // Default instruction for an open tract with no tool armed — one
    // copy per mode now, the banner must never sit empty while there is
    // a tract to work on. 'outline': the round "Land Types" toolbar
    // button and the "3. Land Types" step button are the same handler,
    // so either phrase points at a real, reachable control.
    : (activeTract && tractMode === 'outline')
      ? 'Drag a corner to reshape the tract, or press Snap to Parcel to fit it exactly. '
        + 'When the outline is right, press Land Types.'
    : activeTract ? 'Pick a land type below, then press Add Polygon to draw it.'
    // Tracts exist but none is open (e.g. "2. Tracts" was clicked):
    // still say what to do — the banner is never blank on this screen.
    : tracts.length > 0 ? 'Click a tract in the list to open it, or press Add Another Tract.'
    : null

  // Row 1's single Undo/Redo now reads the ONE history stack directly —
  // it always reverses whatever happened last, whether that was a shape
  // edit, a tract/boundary edit, or a draft-point edit.
  // The open tract has work not on the server: edits since the last
  // save, or never saved at all. Drives the pink Save Tract button (owner
  // 9/16) and is what the switch/leave prompts should mean.
  const activeUnsaved = !!activeTract && (dirty || !activeTract.saved)
  const handleUndo = () => undo()
  const handleRedo = () => redo()
  const undoDisabled = !histRef.current.length
  const redoDisabled = !redoHistRef.current.length

  // Tablet sheet: which bubbles exist right now, and which one is open.
  // A tab that no longer applies (the tract closed) falls back to the
  // first, so the sheet is never empty.
  const sheetTabs: { key: SheetTab; label: string }[] = [
    { key: 'what-to-do', label: 'What To Do' },
    ...(stage === 'build' ? [{ key: 'project' as SheetTab, label: 'Project' }] : []),
    ...(stage === 'build' && activeTract ? [{ key: 'tract' as SheetTab, label: 'Tract' }, { key: 'data' as SheetTab, label: 'Data' }] : []),
    ...(stage === 'build' && activeTract && editingId ? [{ key: 'reports' as SheetTab, label: 'Reports' }] : []),
  ]
  const sheetKey: SheetTab = sheetTabs.some((t) => t.key === sheetTab) ? sheetTab : 'what-to-do'
  const showBubble = (k: SheetTab) => !compact || sheetKey === k

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
            if (dirty || tracts.some((t) => !t.savedId || !t.saved)) { setConfirmWhat('leave'); return }
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
        {/* Bottom gradient (owner item 3, 2026-09-22): "these buttons
            aren't currently noticeable" — a non-interactive band pinned
            under the toolbar (zIndex below its 30, above the map) so the
            round buttons read against dark ground no matter what's under
            them. Fades with the toolbar itself; sized to clear it (its
            height + 56px) plus a fixed 150px on desktop, where the row
            never wraps so a fixed height reads fine. Sits under the
            tablet sheet's own 25 z-index, never over it. */}
        <AnimatePresence>
          {stage === 'build' && (
            <motion.div
              key="toolbar-gradient"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 0.26 }}
              style={{
                position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20,
                height: compact ? toolbarH + 56 : 150,
                background: 'linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0.92) 100%)',
                pointerEvents: 'none',
              }}
            />
          )}
        </AnimatePresence>
        {/* Bottom-of-map toolbar (owner redesign 2026-09-16): every tool
            that touches a tract's polygons — boundary OR land type —
            lives HERE, not in the right panel ("the panel informs, the
            map edits"). Round icon buttons now, no dark bar behind them
            (a later owner pass), and ONE row whose content is whichever
            mode the open tract is in: 'outline' (Draw a Tract / Snap /
            Save Tract / Undo / Redo, plus a primary "Land Types" button
            at the end once a tract is open) or 'landtypes' (an "Outline"
            button back to the other mode, the land-type chips, every
            polygon tool, and Undo/Redo/Save Tract) — never both at
            once, since the two modes are mutually exclusive now (an
            outline edit invalidates classified land types; see
            `reclassifyOnBoundaryEdit`). An armed tool still swaps its
            OWN button's icon/label to its done state in place (Save
            Polygon, Cancel Cut, Done Erasing) instead of a separate
            floating pill. */}
        {/* The top-of-map banner is gone (owner redesign 2026-09-16,
            floating bubbles) — `toolbarHint`'s value now shows as the
            "What To Do" bubble's body instead (same variable, same
            priority chain, just a different piece of JSX reading it). */}
        <AnimatePresence>
          {stage === 'build' && (
            <motion.div
              ref={toolbarRef}
              style={compact ? toolbarRowCompact : toolbarRow}
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={toolbarEntranceTransition}
            >
            {/* Individual buttons animate in on top of the row's own
                entrance above; `initial={false}` skips a double-animation
                on first paint, and `layout` (set on ToolButton itself)
                slides the rest of the row over whenever one mounts,
                unmounts, or the mode branch below swaps wholesale. Every
                button below keeps a STABLE key across label toggles (e.g.
                Add Polygon / Cancel Drawing is always "draw-polygon") so
                it morphs in place instead of re-entering. */}
            <AnimatePresence mode="popLayout" initial={false}>
              {tractMode === 'landtypes' && activeTract ? (
                <>
                  {/* Mirrors "2. Tracts" clicked from Step 3 — same
                      handler, just closer to hand (owner correction). */}
                  <ToolButton key="outline" icon={PenTool} label="Outline"
                              onClick={() => setTractMode('outline')} />
                  {LAND_CLASSES.map((c) => (
                    <ToolButton key={c} dot={CLASS_COLOR[c]} label={CLASS_LABEL[c]}
                                active={drawClass === c} title={CLASS_LABEL[c]}
                                onClick={() => { setDrawClass(c); if (selectedId) setClassOf(selectedId, c) }} />
                  ))}
                  <ToolButton key="draw-polygon" icon={(tool === 'draw' && drawing) ? X : Plus} active={tool === 'draw' && drawing}
                              label={(tool === 'draw' && drawing) ? 'Cancel Drawing' : 'Add Polygon'}
                              onClick={() => {
                                if (tool === 'draw' && drawing) {
                                  setDraft([]); setDrawing(false); setTool(null); dropDraftHist()
                                  return
                                }
                                setTool('draw'); setDrawing(true); setDraft([])
                              }} />
                  <ToolButton key="delete-polygon" icon={Trash2} label="Delete" disabled={!selectedId}
                              onClick={() => selectedId && deleteShape(selectedId)} />
                  <ToolButton key="split-polygon" icon={tool === 'cutpoly' ? X : Scissors} active={tool === 'cutpoly'}
                              label={tool === 'cutpoly' ? 'Cancel Cut' : 'Split Polygon'}
                              disabled={!selectedId && tool !== 'cutpoly'}
                              onClick={() => {
                                if (tool === 'cutpoly') { setTool(null); setCutPts([]); return }
                                setTool('cutpoly'); setCutPts([]); setDrawing(false); setDraft([])
                              }} />
                  <ToolButton key="erase-points" icon={tool === 'erase' ? Check : Eraser} active={tool === 'erase'}
                              label={tool === 'erase' ? 'Done Erasing' : 'Erase Points'}
                              disabled={!selectedId && tool !== 'erase'}
                              onClick={() => { setTool(tool === 'erase' ? null : 'erase'); setMarq(null) }} />
                  <ToolButton key="fill-holes" icon={PaintBucket}
                              label={`Fill Holes${holesOnSelected > 0 ? ` (${holesOnSelected})` : ''}`}
                              disabled={!selectedId || holesOnSelected === 0}
                              title="Remove every hole inside the selected polygon"
                              onClick={() => selectedId && fillHoles(selectedId)} />
                  <ToolButton key="clear-polygons" icon={X} label="Clear Polygons" disabled={!shapes.length}
                              onClick={() => { if (shapes.length) setConfirmWhat('clearPolygons') }} />
                  <ToolButton key="start-over" icon={Layers} label="Start Over" disabled={!detail?.polygons.length}
                              onClick={() => { if (detail?.polygons.length) setConfirmWhat('startOver') }} />
                  <ToolButton key="undo" icon={RotateCcw} label="Undo" disabled={undoDisabled} onClick={handleUndo} />
                  <ToolButton key="redo" icon={RotateCw} label="Redo" disabled={redoDisabled} onClick={handleRedo} />
                  <ToolButton key="save-tract" icon={Save} label="Save Tract" primary={activeUnsaved && !!activeTract?.name.trim()}
                              disabled={!!busy || (tool === 'draw' && drawing
                                ? draft.length < 3 : !activeTract.name.trim())}
                              title={tool === 'draw' && drawing
                                ? (draft.length < 3 ? 'Needs at least 3 points.' : 'Finishes the polygon and saves the tract.')
                                : !activeTract.name.trim() ? 'Name this tract before saving.'
                                : 'Saves this tract to the project. You stay here.'}
                              onClick={() => {
                                if (!selectedTractId) return
                                if (tool === 'draw' && drawing) {
                                  // The button is disabled under 3 points, so
                                  // this only ever runs with a finishable draft.
                                  const result = finishDraft()
                                  if (result?.kind === 'shape') {
                                    void saveAllTracts([selectedTractId], { tractId: selectedTractId, shapes: result.shapes })
                                  } else {
                                    void saveAllTracts([selectedTractId])
                                  }
                                  return
                                }
                                void saveAllTracts([selectedTractId])
                              }} />
                </>
              ) : (
                <>
                  {/* The icon follows the label: an X while it says Cancel Drawing (owner 9/16 icon-follows-label rule). */}
                  <ToolButton key="draw-tract" icon={(tool === 'drawtract' && drawing) ? X : PenTool} active={tool === 'drawtract' && drawing}
                              // The call to action while adding: pink so it is
                              // the obvious thing to press.
                              primary={addingTract && !(tool === 'drawtract' && drawing)}
                              label={(tool === 'drawtract' && drawing) ? 'Cancel Drawing' : 'Draw a Tract'}
                              disabled={!(addingTract || (tool === 'drawtract' && drawing))}
                              onClick={() => {
                                if (tool === 'drawtract' && drawing) {
                                  setDraft([]); setDrawing(false); setTool(null); dropDraftHist()
                                  return
                                }
                                setTool('drawtract'); setDrawing(true); setDraft([])
                              }} />
                  <ToolButton key="snap-tracts" icon={Magnet} label={tracts.length <= 1 ? 'Snap to Parcel' : 'Snap Tracts'}
                              disabled={!!busy || (tracts.length < 2
                                && !(tracts.length === 1 && tracts[0].source.kind === 'parcel'))}
                              title={tracts.length <= 1
                                ? 'Fits this tract to its own parcel boundary so the acres are exact.'
                                : 'Fits every drawn tract to the frame and to each other so acres add up.'}
                              onClick={() => void snapTracts()} />
                  <ToolButton key="save-tract" icon={Save} label="Save Tract" primary={activeUnsaved && !!activeTract?.name.trim()}
                              disabled={!!busy || (tool === 'drawtract' && drawing
                                ? draft.length < 3
                                : !activeTract || !activeTract.name.trim())}
                              title={tool === 'drawtract' && drawing
                                ? (draft.length < 3 ? 'Needs at least 3 points.' : 'Finishes the tract and saves it.')
                                : !activeTract ? 'Open a tract to save it.'
                                : !activeTract.name.trim() ? 'Name this tract before saving.'
                                : 'Saves this tract to the project. You stay here.'}
                              onClick={() => {
                                if (tool === 'drawtract' && drawing) {
                                  // The button is disabled under 3 points, so
                                  // this only ever runs with a finishable draft.
                                  const result = finishDraft()
                                  if (result?.kind === 'tract') {
                                    if (!result.tract.name.trim()) {
                                      setError('Name this tract before saving.')
                                      return
                                    }
                                    void saveAllTracts([result.tract.id], { tract: result.tract })
                                  }
                                  return
                                }
                                if (selectedTractId) void saveAllTracts([selectedTractId])
                              }} />
                  {/* Owner 9/16: a way to throw a tract polygon away and start
                      over, on the map with the other tract tools; it always
                      confirms first. */}
                  <ToolButton key="delete-tract" icon={Trash2} label="Delete Tract"
                              disabled={!!busy || !activeTract}
                              title={!activeTract ? 'Open a tract to delete it.' : 'Removes this tract. You will be asked first.'}
                              onClick={() => { if (selectedTractId) removeTract(selectedTractId) }} />
                  <ToolButton key="undo" icon={RotateCcw} label="Undo" disabled={undoDisabled} onClick={handleUndo} />
                  <ToolButton key="redo" icon={RotateCw} label="Redo" disabled={redoDisabled} onClick={handleRedo} />
                  {/* The deliberate "next step" once a tract is open — filled
                      pink rather than a peer of the rest (owner correction).
                      Only ever rendered with a tract open (this branch also
                      covers the empty-list/adding-a-tract states, which have
                      no tract to switch), so there is no reachable disabled
                      state worth building for it. */}
                  {activeTract && (
                    <ToolButton key="land-types" icon={Layers} label="Land Types" primary
                                onClick={() => setTractMode('landtypes')} />
                  )}
                </>
              )}
              <ToolButton key="toggle-cards" icon={bubblesHidden ? Eye : EyeOff}
                          label={bubblesHidden ? 'Show Cards' : 'Hide Cards'}
                          title={bubblesHidden ? 'Bring the cards back' : 'Tuck the cards away while you draw'}
                          onClick={() => setBubblesHidden((v) => !v)} />
            </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Floating glass bubbles replace the fixed right panel (owner
          redesign 2026-09-16) — the map above now spans the full
          surface. Every bubble below is a straight re-housing of
          content/handlers/state that used to live in the `<aside>`;
          nothing here is new functionality. `bubbleContainer` (defined
          near the bottom of the file, by the other style consts) is
          right-anchored with the RTL trick that makes overflow bubbles
          stack a new column to the LEFT — see the comment on `Bubble`
          above for why. */}
      {/* The Hide/Show Cards toggle lives in the bottom toolbar row now
          (owner 9/16, third pass: a round icon button in line with the
          others, text below), so the cards start at the very top. */}
      <motion.div
        style={compact ? { ...bubbleContainer, ...sheetContainer, bottom: toolbarH + 28 } : bubbleContainer}
        initial={false}
        animate={bubblesHidden
          ? { opacity: 0, scale: 0.85, y: 12, transition: { duration: 0.18 }, transitionEnd: { visibility: 'hidden' } }
          : { opacity: 1, scale: 1, y: 0, visibility: 'visible',
              transition: { type: 'spring', stiffness: 420, damping: 24, mass: 0.8 } }}>
        {compact && (
          // Tablet: one card at a time, picked from this strip. The
          // strip is part of the sheet so Hide Cards tucks it away too.
          <div style={sheetTabStrip}>
            {sheetTabs.map((t) => (
              <button key={t.key} onClick={() => setSheetTab(t.key)}
                      style={{ ...sheetTabBtn,
                               background: t.key === sheetKey ? GG_PINK : 'rgba(8,8,10,0.78)',
                               color: t.key === sheetKey ? '#1a0a14' : '#fff' }}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <AnimatePresence>
          {/* Bubble 1 — What To Do. Header is the 1/2/3 step row
              (unchanged: same `cur`/`canJump` logic, same click
              handlers). On Step 1 this is the ONLY bubble and its body
              becomes the "name this project" card, footer becomes the
              single Continue button. On Steps 2/3 the body is just
              `toolbarHint` — the same variable, same priority chain,
              that used to feed the top-of-map banner pill (now
              removed) — with no footer: Save Tract is the only commit
              and Back to Map (top-left) the only exit (owner ruling,
              the Cancel+Finish footer is gone). */}
          {showBubble('what-to-do') && (
          <Bubble key="what-to-do" animKey="what-to-do" compact={compact}>
            {(() => {
              const cur = stage === 'project' ? 0 : (activeTract && tractMode === 'landtypes') ? 2 : 1
              const labels = ['1. Project', '2. Tracts', '3. Land Types']
              return (
                <div style={{ display: 'flex', gap: 4 }}>
                  {labels.map((label, i) => {
                    const state = i === cur ? 'current' : i < cur ? 'done' : 'future'
                    const canJump = (i === 1 && cur === 2) || (i === 2 && !!activeTract && cur !== 2)
                    return (
                      <button key={label}
                        onClick={() => {
                          if (!canJump) return
                          if (i === 1) setTractMode('outline')
                          else if (i === 2) setTractMode('landtypes')
                        }}
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
              )
            })()}

            {stage === 'project' ? (
              <>
                <div style={stepLabel}>Step 1 — Name this project.</div>
                <div style={{ lineHeight: 1.5 }}>
                  Give this project a name before adding tracts — it&rsquo;s how
                  you&rsquo;ll find it in Map Portfolio.
                </div>
                <input
                  autoFocus
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && projectName.trim()) setStage('build') }}
                  placeholder="e.g. Smith Estate Auction"
                  style={{
                    ...inputStyle, width: '100%', fontSize: 16, fontWeight: 600, marginTop: 4,
                    border: projectName.trim() ? inputStyle.border : '1px solid #ef4444',
                  }}
                />
                <button onClick={() => setStage('build')} disabled={!projectName.trim()}
                        style={{ ...primaryBtn, width: '100%', justifyContent: 'center', padding: '9px 10px' }}>
                  <ArrowRight size={14} /> Continue to the Map
                </button>
                {existingProjects.length > 0 && (
                  <>
                    <div style={{ textAlign: 'center', opacity: 0.6, fontSize: 12, margin: '6px 0 2px' }}>or</div>
                    <div style={{ lineHeight: 1.5 }}>Add this tract to one of your existing projects:</div>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const p = existingProjects.find((x) => x.id === e.target.value)
                        if (!p) return
                        setProjectId(p.id)
                        setProjectName(p.name)
                        setStage('build')
                      }}
                      style={{ ...inputStyle, width: '100%', marginTop: 4 }}
                      title="The tract you opened joins this project; you can still draw more.">
                      <option value="" disabled>Choose a project…</option>
                      {existingProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </>
                )}
              </>
            ) : (
              <>
                {toolbarHint && (
                  <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4 }}>{toolbarHint}</div>
                )}
              </>
            )}
          </Bubble>
          )}

          {/* Bubble 2 — Project: name (top bubble already has the step
              row, this is the project's own renameable name + portfolio
              link), the parcel search block, the getting-started card,
              and the tract list. Never on Step 1 — bubble 1 is the only
              one shown there. */}
          {stage === 'build' && showBubble('project') && (
            <Bubble key="project" animKey="project" compact={compact}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, flex: 1,
                              fontSize: 15, fontWeight: 700 }}>
                  <TractName value={projectName} busy={!!busy} placeholder="Untitled project"
                             onCommit={(n) => setProjectName(n)} />
                </div>
                <a href="/map-portfolio"
                   style={{ fontSize: 12, color: '#f58cde', textDecoration: 'none', flex: 'none' }}>
                  Map Portfolio
                </a>
              </div>

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
                          aria-label="State"
                          style={{ ...inputStyle, width: 84, flex: 'none' }}>
                    {/* Owner 9/16: say what the dropdown is, not "--". */}
                    <option value="">State</option>
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

              {/* Owner 9/16: tell the user how to get started, in the same
                  white card Step 1 uses, until the first tract exists. */}
              {(tracts.length === 0 || addingTract) && (
                <div style={stepCard}>
                  <div style={stepLabel}>
                    {tracts.length === 0 ? 'Build your tracts.' : 'Adding another tract.'}
                  </div>
                  <div style={{ lineHeight: 1.5 }}>
                    {tracts.length === 0 ? 'To get started, ' : 'Now '}
                    <strong>click a parcel</strong> on the map to use its boundary, or
                    press <strong>Draw a Tract</strong> at the bottom of the map and click
                    the corners of your own shape.
                    {tracts.length === 0
                      ? ' Add as many tracts as you need — each one is saved with Save Tract.'
                      : ' Clicking a parcel you have already used fills in what is left of it.'}
                  </div>
                </div>
              )}
              {/* The one tract list: every tract, its acres, its tillable
                  acres and soil rating once known, and a rename pencil /
                  trash can right on the row. Clicking a row opens it for
                  BOTH boundary and land-type editing. */}
              <div style={card}>
                <div style={sectionLabel}>Tracts ({tracts.length})</div>
                {tracts.map((t) => (
                  <TractRow key={t.id} t={t} selected={t.id === selectedTractId} busy={!!busy}
                            soilRating={t.id === selectedTractId && soil?.rating != null ? soil.rating : t.soilRating}
                            onSelect={() => requestOpen(t.id)}
                            onCommitName={(n) => {
                              setTracts((prev) => prev.map((x) => x.id === t.id ? { ...x, name: n } : x))
                              // The tract you have OPEN persists its rename right
                              // away (doRename), same as the removed standalone
                              // name card used to — any other row's rename rides
                              // along with that tract's next Save Tract, same as
                              // every other edit made to a tract that is not open.
                              if (t.id === selectedTractId) void doRename(n)
                            }}
                            onRemove={() => removeTract(t.id)} />
                ))}
                {/* Re-arms "adding" mode explicitly rather than relying on
                    the ambient state — a deliberate click, not a side effect
                    of clearing the selection some other way. */}
                <button
                  onClick={() => {
                    setSelectedTractId(null)
                    setAddingTract(true)
                    setTool(null); setDrawing(false); setDraft([])
                  }}
                  // Nothing to add "another" to until the first tract exists,
                  // and nothing to do while adding is already armed (owner 9/16).
                  disabled={!!busy || tracts.length === 0 || addingTract}
                  style={{ ...btn, width: '100%', justifyContent: 'center', marginTop: 8 }}>
                  <Plus size={13} /> Add Another Tract
                </button>
              </div>
            </Bubble>
          )}

          {/* Bubble 3 — Tract: today's "Tract data" card verbatim, plus
              two sections that had no named bubble in the spec and are
              gated the same way Tract data always was (activeTract only,
              no savedId requirement) — the per-tract "which project"
              card, and the dormant post-split `pieces` card. Both moved
              here rather than into Reports (gated on savedId) since
              neither of them requires a saved tract to show. */}
          {stage === 'build' && activeTract && showBubble('tract') && (
            <Bubble key="tract" animKey="tract" compact={compact}>
              {detail ? (
                <div style={card}>
                  <div style={sectionLabel}>Tract data</div>
                  <div style={{ fontWeight: 600 }}>{detail.parcel?.owner || 'Parcel'}</div>
                  <div style={{ opacity: 0.65 }}>
                    {/* The parcel NUMBER — the ids in `sources` are internal
                        and mean nothing to a farmer (sandbox 9/16). */}
                    {detail.parcel?.parcelnumb ? `Parcel ${detail.parcel.parcelnumb}` : 'No parcel number'}
                    {' · '}{niceCounty(detail.parcel?.county)} County {detail.parcel?.state}
                  </div>
                  {!!detail.parcel?.township && (
                    <div style={statRow}>
                      <span style={{ opacity: 0.65 }}>Township</span><span>{detail.parcel.township}</span>
                    </div>
                  )}
                  {!!detail.parcel?.section && (
                    <div style={statRow}>
                      <span style={{ opacity: 0.65 }}>Section</span><span>{detail.parcel.section}</span>
                    </div>
                  )}
                  {tractCentre && (
                    <div style={statRow}>
                      <span style={{ opacity: 0.65 }}>Centre</span>
                      <span>{tractCentre[1].toFixed(5)}, {tractCentre[0].toFixed(5)}</span>
                    </div>
                  )}
                  {detail.parcel?.acreage_mismatch && (
                    <div style={{ ...hint, color: '#fcd34d' }}>
                      Deed acreage ({detail.parcel.acres_of_record}) differs from the mapped shape.
                    </div>
                  )}
                </div>
              ) : (
                <div style={card}>
                  <div style={sectionLabel}>Tract data</div>
                  <div style={{ fontWeight: 600 }}>Hand-drawn</div>
                  {tractCentre && (
                    <div style={statRow}>
                      <span style={{ opacity: 0.65 }}>Centre</span>
                      <span>{tractCentre[1].toFixed(5)}, {tractCentre[0].toFixed(5)}</span>
                    </div>
                  )}
                </div>
              )}

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

              {/* The project this tract files into is the Project bubble —
                  no second copy here (owner 9/16). */}
            </Bubble>
          )}

          {/* Bubble 4 — Data: today's "Acres & land types" card verbatim,
              plus the polygon-fill-opacity slider (moved here from
              directly below that card, same relative position it always
              had). Gated on activeTract only, same as the card was. */}
          {stage === 'build' && activeTract && showBubble('data') && (
            <Bubble key="data" animKey="data" compact={compact}>
              <div style={card}>
                <div style={sectionLabel}>Acres &amp; land types</div>
                {tractMode === 'outline' ? (
                  <>
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      fontSize: 22, fontWeight: 800,
                    }}>
                      <span>Total</span><span>{parcelAcres.toFixed(1)}</span>
                    </div>
                    <div style={hint}>
                      Press 3. Land Types to see tillable, timber and water.
                    </div>
                  </>
                ) : (
                  <>
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
                  </>
                )}
              </div>

              {/* Land-type chips and every polygon tool (Add Polygon,
                  Delete, Split Polygon, Erase Points, Fill Holes, Undo,
                  Redo, Clear Polygons, Start Over) live in the bottom
                  toolbar now (design spec §2) — no duplicate controls
                  here (owner). There is no "Edit this tract" unlock any
                  more either: opening a tract on this screen opens it
                  fully interactive, full stop (owner ruling 2026-09-16). */}

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
            </Bubble>
          )}

          {/* Bubble 5 — Reports: market analysis + the reports section,
              shown ONLY once this tract has a savedId (`editingId`) — the
              old "Save this parcel first" placeholder is dropped
              entirely rather than shown as an empty bubble. CMA had no
              named bubble in the spec either; it lives here because
              `cma` can only ever be set after `startCma` succeeds, which
              itself requires `editingId` — same gate as Reports. */}
          {stage === 'build' && activeTract && editingId && showBubble('reports') && (
            <Bubble key="reports" animKey="reports" compact={compact}>
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
            </Bubble>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Cancel throws away every unsaved edit and closes the parcel, so
          it confirms first. Was "sits inside the panel, over it" — now
          just a fixed overlay over the whole map, unchanged otherwise. */}
      {confirmWhat && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 40,
          background: 'rgba(0,0,0,0.66)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18,
        }}>
          <div style={{
            width: '100%', maxWidth: 360,
            background: 'linear-gradient(180deg, #1b1e23 0%, #0a0a0a 100%)',
            border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 30px rgba(0,0,0,0.6)',
            borderRadius: 11, padding: 16,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              {confirmWhat === 'switch' ? 'Save before switching tracts?'
                : confirmWhat === 'leave' ? 'Leave without saving?'
                : confirmWhat === 'clearPolygons' ? 'Clear every polygon?'
                : confirmWhat === 'startOver' ? 'Start over from the engine?'
                : 'Remove this tract?'}
            </div>
            <div style={{ ...hint, marginTop: 0, marginBottom: 14, display: 'block' }}>
              {confirmWhat === 'switch'
                ? 'This tract has changes you have not saved. OK saves them and '
                  + 'opens the tract you clicked. Cancel stays on this one.'
                : confirmWhat === 'leave'
                ? 'This tract has changes you have not saved. OK leaves for the '
                  + 'Explore map and throws them away. Cancel stays here.'
                : confirmWhat === 'clearPolygons'
                ? 'Every land-type polygon on this tract will be removed. This '
                  + 'cannot be undone with Redo once you navigate away.'
                : confirmWhat === 'startOver'
                ? 'Every polygon edit you have made will be thrown away and '
                  + 'replaced with the engine’s own land types for this '
                  + 'boundary. This cannot be undone with Redo once you navigate away.'
                : (pendingRemoveId && tracts.find((x) => x.id === pendingRemoveId)?.savedId)
                ? 'This tract is already saved. OK removes it here and deletes '
                  + 'its saved record too — that part cannot be undone.'
                : 'This tract comes off the map. You can Undo right away, but '
                  + 'not after you leave this screen.'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => {
                        if (confirmWhat === 'leave') {
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
                        } else if (confirmWhat === 'clearPolygons') {
                          setConfirmWhat(null)
                          clearAll()
                        } else if (confirmWhat === 'startOver') {
                          setConfirmWhat(null)
                          resetToEngine()
                        } else {
                          const target = pendingRemoveId
                          setConfirmWhat(null); setPendingRemoveId(null)
                          if (!target) return
                          const t = tractsRef.current.find((x) => x.id === target)
                          if (t?.savedId) void removeSavedTract(target)
                          else removeLocalTract(target)
                        }
                      }}
                      style={{
                        ...primaryBtn,
                        flex: 1, justifyContent: 'center', padding: '9px 10px',
                      }}>
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
// Bottom-of-map toolbar (owner redesign 2026-09-16): ONE row of round
// `ToolButton`s (see that component, defined above `ConfigureMap`), no
// dark bar behind them any more — the map itself should read through.
// `flexWrap: 'nowrap'` plus `overflowX: 'auto'` is the width contract:
// the owner's longest row (every landtypes-mode button, all full labels)
// measures well inside 1400px, so it never needs to wrap there; auto-
// scroll is the fallback for a narrower window rather than a silent clip.
// Tablet: the circles wrap onto a second row instead of scrolling off
// the right edge (owner 9/17: Redo was cut off on an iPad).
const toolbarRowCompact: React.CSSProperties = {
  position: 'absolute', bottom: 12, left: 12, right: 12, zIndex: 30,
  display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'center',
  columnGap: 10, rowGap: 4, padding: '4px 2px',
}
// Tablet sheet: one bubble at a time, full width, above the toolbar.
const sheetContainer: React.CSSProperties = {
  top: 'auto', left: 12, right: 12, direction: 'ltr',
  flexDirection: 'column', flexWrap: 'nowrap', alignContent: 'stretch', alignItems: 'stretch',
  transformOrigin: 'bottom center', rowGap: 8,
}
const sheetTabStrip: React.CSSProperties = {
  display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', pointerEvents: 'auto',
}
const sheetTabBtn: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.18)', borderRadius: 999, padding: '7px 14px',
  fontSize: 13, fontWeight: 700, cursor: 'pointer',
  boxShadow: '0 4px 14px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)',
}
// `left: 0; right: 0; margin: 0 auto; width: fit-content` centres this
// row instead of the usual `left: 50%; transform: translateX(-50%)` —
// framer-motion drives its own `transform` for the entrance animation
// (see the `motion.div` wrapper), and the two would clobber each other.
const toolbarRow: React.CSSProperties = {
  position: 'absolute', bottom: 16, left: 0, right: 0, margin: '0 auto', width: 'fit-content', zIndex: 30,
  display: 'flex', flexWrap: 'nowrap', alignItems: 'flex-start', justifyContent: 'center',
  gap: 14, maxWidth: 'calc(100% - 32px)', overflowX: 'auto', padding: '4px 2px',
}
// The floating-bubble panel (owner redesign 2026-09-16, replacing the
// fixed right `<aside>`). Right-anchored, clearing the bottom toolbar
// (`bottom: 90` vs. the toolbar's own `bottom: 16` + ~70px of button
// height — a structural check, not a rendered one; flagged in the
// report). `pointerEvents: 'none'` here (each `Bubble` sets its own
// 'auto') so empty space between bubbles lets map drags/clicks through.
//
// `direction: 'rtl'` is the trick that makes a second, overflowing
// column of bubbles grow LEFTWARD into the map instead of off the right
// edge — `flexWrap` itself is plain 'wrap' (never 'wrap-reverse', per
// spec); in RTL, 'wrap's normal cross-axis order runs right-to-left, so
// the first bubble's column sits at the right (flush with this
// container's own right edge) and any overflow column lands to its
// left. `Bubble` flips back to `direction: 'ltr'` so its own content
// reads normally.
const bubbleContainer: React.CSSProperties = {
  position: 'absolute', top: 14, right: 14, bottom: 110, left: 14, zIndex: 25,
  transformOrigin: 'top right',
  pointerEvents: 'none',
  display: 'flex', flexDirection: 'column', flexWrap: 'wrap',
  // rtl makes the FIRST column the right-hand one; flex-start then packs
  // every column against the right edge no matter how wide the box is
  // measured. (flex-end packed them to the LEFT of an over-wide box —
  // owner 9/16: "shifts the cards left and leaves a huge gap on the right".)
  direction: 'rtl',
  columnGap: 12, rowGap: 12, alignContent: 'flex-start',
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
