/**
 * Pure helpers, types and map-source constants for Configurable Mapping
 * tract editing. Lifted out of ConfigureMap.tsx unchanged so the
 * /configure-map page and the Explore map's "Map It" editor
 * (useTractEditor) share one implementation.
 */
import type maplibregl from 'maplibre-gl'
import type { LandClass, ParcelDetail } from '@/lib/configurableMapping'
import { polygonAcres } from '@/lib/polygonGeometry'
import { closeRing, openRing, simplifyRing, type Pt, type SnapTarget } from '@/lib/polygonEditing'

/** One drawn shape: a list of polygons, each [outerRing, ...holes].
 *  Holes are preserved — a pond inside a tillable field is a hole in
 *  that field, not a separate shape. Rings are stored OPEN. */
export interface Shape { id: string; cls: LandClass; polys: Pt[][][] }

/** ONE undo/redo history entry — shape edits, tract/boundary edits, and
 *  draft-point edits all live on the same stack, in the order they
 *  happened, so Undo always reverses the last thing done regardless of
 *  which kind it was. `tractId` on a 'shapes' entry is the tract that
 *  was open when it was taken — used to drop it if a different tract is
 *  open by the time Undo would otherwise apply it. */
export type HistEntry =
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
export interface Tract {
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
  /** County and state of the ground (from the saved record's stats or the
   *  save response) — shown on the Tract data card for hand-drawn tracts
   *  too (owner 10/1: always County, State). */
  county?: string | null
  state?: string | null
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
export const nextTractId = () => (
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tract-${Date.now()}-${Math.random().toString(36).slice(2)}`
)

export function newTract(overrides: Partial<Tract> = {}): Tract {
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

export const SRC = {
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
export const LYR_VERTS = 'cm-verts-circles'
export const LYR_FILL = 'cm-shapes-fill'

let idSeq = 0
export const nextId = () => `s${++idSeq}`

export function geometryToPolys(geom: any): Pt[][][] {
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
export function explodeShapes(polys: { cls: LandClass; geometry: any }[]): Shape[] {
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
export function simplifyShapes(shapes: Shape[]): Shape[] {
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

/** Ray cast. Rings here are open — first point is not repeated. */
export function pointInRing(pt: Pt, ring: Pt[]): boolean {
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
export function dropDegenerateHoles(rings: Pt[][]): Pt[][] {
  return rings.filter((ring, i) => i === 0 || ring.length >= 3)
}

/** Is `pt` inside the tract boundary? `boundary` is an array of
 *  polygons, each [outerRing, ...holeRings]; a point counts as inside
 *  when it lands inside SOME polygon's outer ring and none of that
 *  polygon's holes. Used to keep land-type drawing inside the tract
 *  outline (owner spec) — a local ray-cast rather than a new dependency,
 *  since @turf/boolean-point-in-polygon is not in package.json. */
export function pointInBoundary(pt: Pt, boundary: Pt[][][]): boolean {
  return boundary.some((rings) => {
    const outer = rings[0]
    if (!outer || !pointInRing(pt, outer)) return false
    return !rings.slice(1).some((hole) => pointInRing(pt, hole))
  })
}

export function ringCentre(polys: Pt[][][]): Pt | null {
  const ring = polys[0]?.[0]
  if (!ring || !ring.length) return null
  let x = 0, y = 0
  for (const [a, b] of ring) { x += a; y += b }
  return [x / ring.length, y / ring.length]
}

export function polysToGeometry(polys: Pt[][][]): any {
  const cleaned = polys
    .map((rings) => rings.filter((r) => r.length >= 3).map(closeRing))
    .filter((rings) => rings.length > 0)
  if (!cleaned.length) return null
  return cleaned.length === 1
    ? { type: 'Polygon', coordinates: cleaned[0] }
    : { type: 'MultiPolygon', coordinates: cleaned }
}

/** Outer rings minus their holes. */
export function shapeAcres(s: Shape): number {
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
export function boundaryAcresOf(boundary: Pt[][][]): number {
  return boundary.reduce((sum, rings) => {
    if (!rings.length) return sum
    const holes = rings.slice(1).reduce((h, r) => h + polygonAcres(r), 0)
    return sum + Math.max(polygonAcres(rings[0]) - holes, 0)
  }, 0)
}

export function bboxOf(coords: any): [[number, number], [number, number]] | null {
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
export function snapTargetsNear(
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
