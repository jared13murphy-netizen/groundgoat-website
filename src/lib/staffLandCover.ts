/**
 * Staff land cover — pure helpers for the Map It-style Tillable Workshop on
 * STAGED auction tracts (admin staging + private-treaty staging).
 *
 * The editor itself is the customer Map It hook (useTractEditor). These
 * helpers translate between its state (shapes = { id, cls, polys }, a poly is
 * [outer, ...holes], rings stored OPEN) and the staging endpoints:
 *
 *   GET  /api/admin/staging/{id}/tracts/{i}/land-cover          load
 *   POST /api/admin/staging/{id}/tracts/{i}/clu  {land_cover}   save
 *   POST /api/admin/staging/{id}/tracts/{i}/clu/compute-soil    live soil
 *   GET  /api/admin/staging/{id}/tracts/{i}/clu                 FSA fields
 *
 * No React and no runtime imports, so this file runs under plain Node for
 * its unit test: `node src/lib/staffLandCover.test.ts`.
 */

export type Pt = [number, number]

export const STAFF_LAND_CLASSES = ['tillable', 'pasture', 'timber', 'water', 'other'] as const
export type StaffLandClass = (typeof STAFF_LAND_CLASSES)[number]

export type LandCoverOrigin = 'staff' | 'legacy' | 'engine' | 'none'

/** One editor shape (same structure as cmShapes' Shape). */
export interface EditorShape { id: string; cls: StaffLandClass; polys: Pt[][][] }

/** One land-cover item as the API reads and writes it. */
export interface ApiLandCover { cls: StaffLandClass; geometry: any; acres?: number }

/** An FSA field from GET …/clu (geometry already clipped to the tract). */
export interface FsaField {
  fsa_clu_id: number
  geometry: any
  acres_within_tract?: number | null
  default_tillable?: boolean
  current_tillable?: boolean
}

// ── rings and geometries ────────────────────────────────────────────

const isClass = (c: unknown): c is StaffLandClass =>
  typeof c === 'string' && (STAFF_LAND_CLASSES as readonly string[]).includes(c)

const isPt = (p: unknown): p is Pt =>
  Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number'
  && Number.isFinite(p[0]) && Number.isFinite(p[1])

/** Drop a repeated closing point; rings are edited open. */
export function openRing(ring: unknown): Pt[] {
  if (!Array.isArray(ring)) return []
  const pts = ring.filter(isPt).map((p) => [Number(p[0]), Number(p[1])] as Pt)
  if (pts.length >= 2) {
    const f = pts[0]; const l = pts[pts.length - 1]
    if (f[0] === l[0] && f[1] === l[1]) pts.pop()
  }
  return pts
}

/** Repeat the first point at the end (GeoJSON rings are closed). */
export function closeRing(ring: Pt[]): Pt[] {
  if (!ring.length) return []
  const f = ring[0]; const l = ring[ring.length - 1]
  return f[0] === l[0] && f[1] === l[1] ? [...ring] : [...ring, [f[0], f[1]] as Pt]
}

/** GeoJSON Polygon / MultiPolygon → polygons of [outer, ...holes], open
 *  rings. A polygon whose OUTER ring is unusable is dropped whole; an
 *  unusable hole is dropped alone. */
export function geometryToPolys(geom: any): Pt[][][] {
  if (!geom || typeof geom !== 'object') return []
  const raw: any[] = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? (Array.isArray(geom.coordinates) ? geom.coordinates : []) : []
  const out: Pt[][][] = []
  for (const rings of raw) {
    if (!Array.isArray(rings) || !rings.length) continue
    const outer = openRing(rings[0])
    if (outer.length < 3) continue
    const holes = rings.slice(1).map(openRing).filter((r: Pt[]) => r.length >= 3)
    out.push([outer, ...holes])
  }
  return out
}

/** Polygons of [outer, ...holes] → a GeoJSON Polygon (one part) or
 *  MultiPolygon (several). null when nothing is a polygon. */
export function polysToGeometry(polys: Pt[][][]): any {
  const cleaned: Pt[][][] = []
  for (const rings of polys || []) {
    if (!Array.isArray(rings) || !rings.length || !rings[0] || rings[0].length < 3) continue
    cleaned.push([closeRing(rings[0]), ...rings.slice(1).filter((r) => r.length >= 3).map(closeRing)])
  }
  if (!cleaned.length) return null
  return cleaned.length === 1
    ? { type: 'Polygon', coordinates: cleaned[0] }
    : { type: 'MultiPolygon', coordinates: cleaned }
}

/** Ray cast on an open ring. */
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

/** Inside some polygon's outer ring and none of that polygon's holes. */
export function pointInPolys(pt: Pt, polys: Pt[][][]): boolean {
  return polys.some((rings) => {
    const outer = rings[0]
    if (!outer || !pointInRing(pt, outer)) return false
    return !rings.slice(1).some((hole) => pointInRing(pt, hole))
  })
}

/** Same planar formula as polygonGeometry.polygonAcres (open or closed ring). */
export function ringAcres(ring: Pt[]): number {
  const pts = openRing(ring)
  const n = pts.length
  if (n < 3) return 0
  const meanLat = pts.reduce((s, p) => s + p[1], 0) / n
  const mLat = 111320.0
  const mLng = 111320.0 * Math.cos((meanLat * Math.PI) / 180)
  let a = 0
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i]
    const [x2, y2] = pts[(i + 1) % n]
    a += x1 * mLng * y2 * mLat - x2 * mLng * y1 * mLat
  }
  return Math.abs(a) / 2 / 4046.86
}

/** Outer rings minus their holes. */
export function polysAcres(polys: Pt[][][]): number {
  return polys.reduce((sum, rings) => {
    if (!rings.length) return sum
    const holes = rings.slice(1).reduce((h, r) => h + ringAcres(r), 0)
    return sum + Math.max(ringAcres(rings[0]) - holes, 0)
  }, 0)
}

// ── the tract boundary ──────────────────────────────────────────────

/** A staged tract's boundary (`polygon_coordinates` + `polygon_holes`) as
 *  one GeoJSON geometry. `polygon` is one ring [[lng,lat],…] or several
 *  pieces [[[lng,lat],…],…]; each hole ring is cut out of the piece that
 *  contains it. null when there is no usable boundary. */
export function tractBoundaryGeometry(polygon: unknown, holes?: unknown): any {
  let pieces: Pt[][] = []
  if (Array.isArray(polygon) && polygon.length) {
    if (isPt(polygon[0])) pieces = [openRing(polygon)]
    else pieces = polygon.map(openRing)
  }
  pieces = pieces.filter((r) => r.length >= 3)
  if (!pieces.length) return null
  const polys: Pt[][][] = pieces.map((r) => [r])
  if (Array.isArray(holes)) {
    for (const h of holes) {
      const ring = openRing(h)
      if (ring.length < 3) continue
      const at = polys.findIndex((rings) => pointInRing(ring[0], rings[0]))
      if (at !== -1) polys[at].push(ring)
    }
  }
  return polysToGeometry(polys)
}

// ── load ────────────────────────────────────────────────────────────

/** The land-cover GET, reduced to what the editor needs. */
export interface StaffLandCoverLoad {
  origin: LandCoverOrigin
  /** GeoJSON boundary, or null when the tract has none (nothing to edit). */
  boundary: any
  /** Shapes to open with. null = nothing stored AND the engine may still
   *  know this ground: ask it (classify). [] = open blank. */
  shapes: ApiLandCover[] | null
  /** Derived from old Workshop work: fit the shapes once before editing. */
  needsNormalize: boolean
  state: string | null
  uid: string | null
  tillableRev: number | null
  totalAcres: number | null
  reportedAcres: number | null
  soilRating: number | null
  soilRatingType: string | null
  engineCovered: boolean | null
  error: string | null
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Keep only well-formed items (known class, polygon geometry). */
export function cleanApiShapes(shapes: unknown): ApiLandCover[] {
  if (!Array.isArray(shapes)) return []
  const out: ApiLandCover[] = []
  for (const s of shapes) {
    if (!s || typeof s !== 'object' || !isClass((s as any).cls)) continue
    const g = (s as any).geometry
    if (!geometryToPolys(g).length) continue
    out.push({ cls: (s as any).cls, geometry: g, ...(num((s as any).acres) != null ? { acres: num((s as any).acres)! } : {}) })
  }
  return out
}

/**
 * Read a land-cover GET response.
 *
 *   staff   what staff saved — open exactly that (an empty list is a real
 *           save: staff decided there is no land cover to draw);
 *   legacy  old Tillable Workshop work over the engine's other classes —
 *           open it, fitted once (needs_normalize);
 *   engine  the mapping engine's result — open it;
 *   none    nothing stored: ask the engine (shapes null) unless the server
 *           already knows the engine does not cover this ground (blank).
 *
 * A tract with no boundary opens nothing and carries the server's error.
 */
export function readLandCoverLoad(data: any): StaffLandCoverLoad {
  const t = (data && typeof data === 'object' && data.tract && typeof data.tract === 'object') ? data.tract : {}
  const origin: LandCoverOrigin =
    data?.origin === 'staff' || data?.origin === 'legacy' || data?.origin === 'engine' ? data.origin : 'none'
  const boundary = tractBoundaryGeometry(t.polygon, t.polygon_holes)
  const engineCovered: boolean | null = typeof data?.engine_covered === 'boolean' ? data.engine_covered : null
  let shapes: ApiLandCover[] | null
  if (!boundary) shapes = []
  else if (origin === 'none') shapes = engineCovered === false ? [] : null
  else shapes = cleanApiShapes(data?.shapes)
  return {
    origin,
    boundary,
    shapes,
    needsNormalize: !!boundary && origin !== 'none' && data?.needs_normalize === true && (shapes?.length ?? 0) > 0,
    state: typeof t.state === 'string' && t.state ? t.state : null,
    uid: typeof t.uid === 'string' && t.uid ? t.uid : null,
    tillableRev: num(t.tillable_rev),
    totalAcres: num(t.total_acres),
    reportedAcres: num(t.reported_acres),
    soilRating: num(data?.soil_rating),
    soilRatingType: typeof data?.soil_rating_type === 'string' && data.soil_rating_type ? data.soil_rating_type : null,
    engineCovered,
    error: boundary ? (typeof data?.error === 'string' ? data.error : null)
      : (typeof data?.error === 'string' && data.error ? data.error : 'Tract has no boundary polygon'),
  }
}

/** API items → editor shapes, one per polygon PART (so each piece selects
 *  and deletes alone), holes kept. Ids come from `makeId`. */
export function apiShapesToEditor(shapes: ApiLandCover[] | null | undefined, makeId: () => string): EditorShape[] {
  const out: EditorShape[] = []
  for (const s of cleanApiShapes(shapes)) {
    for (const part of geometryToPolys(s.geometry)) out.push({ id: makeId(), cls: s.cls, polys: [part] })
  }
  return out
}

// ── save ────────────────────────────────────────────────────────────

/** The server lets LATER items win an overlap between classes, so the shape
 *  staff just edited goes last. Order is otherwise kept. */
export function orderEditedLast<T extends { id: string }>(shapes: T[], editedId?: string | null): T[] {
  if (!editedId) return [...shapes]
  const edited = shapes.find((s) => s.id === editedId)
  if (!edited) return [...shapes]
  return [...shapes.filter((s) => s.id !== editedId), edited]
}

/** Editor shapes → the `land_cover` list of a save. Shapes with no polygon
 *  left are dropped. An empty list is a valid save (zero tillable). */
export function landCoverPayload(
  shapes: { id: string; cls: string; polys: Pt[][][] }[],
  editedId?: string | null,
): { cls: StaffLandClass; geometry: any }[] {
  const out: { cls: StaffLandClass; geometry: any }[] = []
  for (const s of orderEditedLast(shapes, editedId)) {
    if (!isClass(s.cls)) continue
    const geometry = polysToGeometry(s.polys)
    if (geometry) out.push({ cls: s.cls, geometry })
  }
  return out
}

/** The staff shapes a save returned (`tract.staff_land_cover.polygons`), or
 *  null when the response carries none. */
export function savedShapesOf(saveResponse: any): ApiLandCover[] | null {
  const list = saveResponse?.tract?.staff_land_cover?.polygons
  return Array.isArray(list) ? cleanApiShapes(list) : null
}

// ── live soil ───────────────────────────────────────────────────────

/**
 * Body for POST …/clu/compute-soil from the tillable geometries on screen
 * (each a Polygon or MultiPolygon). Returns NULL when there is no tillable
 * piece: that endpoint treats an empty selection as "the FSA default
 * fields", so it must never be called then — show "no rating" instead.
 */
export function soilRequestBody(tillable: any[] | null | undefined): { selections: never[]; manual_polygons: any[] } | null {
  const pieces: any[] = []
  for (const g of tillable || []) {
    for (const part of geometryToPolys(g)) {
      const geom = polysToGeometry([part])
      if (geom) pieces.push(geom)
    }
  }
  if (!pieces.length) return null
  return { selections: [], manual_polygons: pieces }
}

/** Soil line text: "72.3 (CSR2)", or `none` when there is no rating. */
export function soilText(rating: number | null | undefined, ratingType: string | null | undefined, none = 'no rating'): string {
  if (rating == null || !Number.isFinite(Number(rating))) return none
  return `${rating}${ratingType ? ` (${ratingType})` : ''}`
}

// ── FSA fields ──────────────────────────────────────────────────────

/** Well-formed FSA fields only (numeric id, polygon geometry). */
export function cleanFsaFields(clus: unknown): FsaField[] {
  if (!Array.isArray(clus)) return []
  return clus.filter((c) => c && typeof c === 'object' && Number.isFinite(Number((c as any).fsa_clu_id))
    && geometryToPolys((c as any).geometry).length > 0)
    .map((c: any) => ({ ...c, fsa_clu_id: Number(c.fsa_clu_id) }))
}

/** A field's clipped geometry as editor polygons (holes kept). */
export function fsaFieldPolys(field: FsaField): Pt[][][] {
  return geometryToPolys(field?.geometry)
}

export function fsaFieldAcres(field: FsaField): number {
  const given = num(field?.acres_within_tract)
  return given != null && given > 0 ? given : polysAcres(fsaFieldPolys(field))
}

/** The field under a point; the SMALLEST when several overlap (the FSA
 *  table carries overlapping vintages of the same ground). */
export function fsaFieldAt(fields: FsaField[], pt: Pt): FsaField | null {
  let best: FsaField | null = null
  let bestAcres = Infinity
  for (const f of fields) {
    if (!pointInPolys(pt, fsaFieldPolys(f))) continue
    const a = fsaFieldAcres(f)
    if (a < bestAcres) { best = f; bestAcres = a }
  }
  return best
}

/** ~1 m in degrees: slack for the clip the server applies after an add. */
const FIELD_TOL = 0.00001

/** Tillable shapes lying wholly inside a field's bounding box — the shapes
 *  a tick of that field made (ids change at every server fit, so the tie is
 *  by position, never by id). */
export function shapesInField<T extends { cls: string; polys: Pt[][][] }>(shapes: T[], field: FsaField): T[] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const rings of fsaFieldPolys(field)) for (const pt of rings[0]) {
    w = Math.min(w, pt[0]); e = Math.max(e, pt[0]); s = Math.min(s, pt[1]); n = Math.max(n, pt[1])
  }
  if (!Number.isFinite(w)) return []
  const inBox = (pt: Pt) => pt[0] >= w - FIELD_TOL && pt[0] <= e + FIELD_TOL && pt[1] >= s - FIELD_TOL && pt[1] <= n + FIELD_TOL
  return shapes.filter((sh) => sh.cls === 'tillable' && sh.polys.length > 0
    && sh.polys.every((rings) => rings[0]?.length >= 3 && rings[0].every(inBox)))
}

/** A ticked field still counts as ticked while at least half of it is
 *  tillable shapes inside it. */
export function fieldStillTicked(shapes: { cls: string; polys: Pt[][][] }[], field: FsaField): boolean {
  const mine = shapesInField(shapes, field)
  if (!mine.length) return false
  const acres = mine.reduce((sum, sh) => sum + polysAcres(sh.polys), 0)
  return acres >= 0.5 * fsaFieldAcres(field)
}

/** Drop ticks whose shapes are gone (deleted, undone, cleared, reloaded). */
export function pruneTickedFields(ticked: readonly number[], fields: FsaField[], shapes: { cls: string; polys: Pt[][][] }[]): number[] {
  return ticked.filter((id) => {
    const f = fields.find((x) => x.fsa_clu_id === id)
    return !!f && fieldStillTicked(shapes, f)
  })
}

export type FieldClick =
  /** add the field's geometry as tillable and remember the tick */
  | { action: 'add'; field: FsaField }
  /** un-tick: remove the shapes that tick made */
  | { action: 'remove'; field: FsaField; shapeIds: string[] }
  /** not a field click — the editor handles it (select / add a corner) */
  | { action: 'pass' }

/**
 * What a map click means for the FSA fields overlay.
 *
 *  - not on a field, or the overlay is off, or a tool is armed → pass;
 *  - on a field this session ticked, on one of its shapes → remove them;
 *  - on ground that is already tillable → pass (normal select / edit);
 *  - otherwise → add the field as tillable.
 */
export function fsaFieldClick(opts: {
  enabled: boolean
  /** a draw / split / erase tool is armed, or a ring is being drawn */
  toolActive: boolean
  point: Pt
  fields: FsaField[]
  shapes: { id: string; cls: string; polys: Pt[][][] }[]
  ticked: readonly number[]
}): FieldClick {
  if (!opts.enabled || opts.toolActive) return { action: 'pass' }
  const field = fsaFieldAt(opts.fields, opts.point)
  if (!field) return { action: 'pass' }
  if (opts.ticked.includes(field.fsa_clu_id) && fieldStillTicked(opts.shapes, field)) {
    const mine = shapesInField(opts.shapes, field)
    if (mine.some((sh) => pointInPolys(opts.point, sh.polys))) {
      return { action: 'remove', field, shapeIds: mine.map((sh) => sh.id) }
    }
  }
  const onTillable = opts.shapes.some((sh) => sh.cls === 'tillable' && pointInPolys(opts.point, sh.polys))
  if (onTillable) return { action: 'pass' }
  return { action: 'add', field }
}

// ── feature switch ──────────────────────────────────────────────────

/** `?oldworkshop=1` in the page URL keeps the old Tillable Workshop. */
export function oldWorkshopRequested(search: string | null | undefined): boolean {
  if (!search) return false
  const q = search.startsWith('?') ? search.slice(1) : search
  for (const part of q.split('&')) {
    const [k, v = ''] = part.split('=')
    if (decodeURIComponent(k) === 'oldworkshop') {
      const val = decodeURIComponent(v).toLowerCase()
      return val === '1' || val === 'true' || val === 'yes'
    }
  }
  return false
}
