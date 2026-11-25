/**
 * Engine-shapes badge for the admin staging pages (auction staging +
 * private-treaty staging).
 *
 * Owner rule 2026-11-25: "If a tract is within one of our 9 mapped states,
 * it has to have the engine polygons. Those are required."
 *
 * The backend adds a computed, response-only `engine_shapes` to every staged
 * tract returned by `GET /api/admin/staging` and `GET /api/admin/staging/{id}`:
 *
 *   ok                engine (or staff) shapes are there
 *   missing           the engine has not run, or failed, for this boundary
 *   empty             the engine ran and found nothing to draw
 *   no_data           the engine has no data at this place
 *   not_engine_state  outside the nine states
 *   no_boundary       the tract has no boundary (the backend checks this
 *                     BEFORE the state, so it is sent for every state)
 *
 * Older backends do not send the field: undefined (or any other value) is
 * "unknown" and shows nothing.
 *
 * Pure functions only (no React, no imports) so this file runs under plain
 * Node for its unit test: `node src/lib/engineShapes.test.ts`.
 */

export type EngineShapesStatus = 'ok' | 'missing' | 'empty' | 'no_data' | 'not_engine_state' | 'no_boundary'

const STATUSES: readonly string[] = ['ok', 'missing', 'empty', 'no_data', 'not_engine_state', 'no_boundary']

/** The nine mapped states (backend configurable_mapping.ENGINE_STATES). */
export const ENGINE_STATES: readonly string[] = ['IL', 'IA', 'IN', 'MO', 'NE', 'KS', 'KY', 'WI', 'MN']

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID',
  illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD',
  tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}
const STATE_CODES = new Set(Object.values(STATE_NAMES))

type Tract = Record<string, any>

/** 2-letter code for a state name or code, '' when it is not a state. */
export function stateAbbr(v: unknown): string {
  if (typeof v !== 'string') return ''
  const s = v.trim()
  if (!s) return ''
  const up = s.toUpperCase()
  if (STATE_CODES.has(up)) return up
  return STATE_NAMES[s.toLowerCase()] || ''
}

/**
 * A staged tract's state, in the backend's order (_engine_state_abbr): its
 * county dict, its own state_abbr / state_full / state, then the listing's.
 */
export function tractStateAbbr(tract: unknown, listingState?: unknown): string {
  const t = (tract || {}) as Tract
  const c = t.county && typeof t.county === 'object' ? t.county : {}
  for (const v of [c.state_abbr, c.state_full, t.state_abbr, t.state_full, t.state, listingState]) {
    const ab = stateAbbr(v)
    if (ab) return ab
  }
  return ''
}

/** The listing-level state the backend falls back to (staging list GET):
 *  scraped_data.listing.state_full, else .state. */
export function listingEngineState(scraped: unknown): string | null {
  const l = (scraped as Tract | null | undefined)?.listing
  if (!l || typeof l !== 'object') return null
  const v = l.state_full || l.state
  return typeof v === 'string' ? v : null
}

export function isEngineStateTract(tract: unknown, listingState?: unknown): boolean {
  return ENGINE_STATES.includes(tractStateAbbr(tract, listingState))
}

/** The tract's `engine_shapes`, or null when the backend did not send one. */
export function engineShapesStatus(tract: unknown): EngineShapesStatus | null {
  const v = (tract as Tract | null | undefined)?.engine_shapes
  return typeof v === 'string' && STATUSES.includes(v) ? (v as EngineShapesStatus) : null
}

/** What the rule calls a problem: 'missing', or 'no_boundary' in one of the
 *  nine states. null for everything else. */
export function engineShapesProblem(tract: unknown, listingState?: unknown): 'missing' | 'no_boundary' | null {
  const s = engineShapesStatus(tract)
  if (s === 'missing') return 'missing'
  if (s === 'no_boundary' && isEngineStateTract(tract, listingState)) return 'no_boundary'
  return null
}

export interface EngineShapesBadge {
  status: EngineShapesStatus
  label: string
  tone: 'green' | 'red' | 'amber' | 'gray'
  title: string
}

/** The per-tract badge, or null for no badge (unknown, outside the nine
 *  states, or no boundary outside the nine states). */
export function engineShapesBadge(tract: unknown, listingState?: unknown): EngineShapesBadge | null {
  const status = engineShapesStatus(tract)
  switch (status) {
    case 'ok':
      return { status, label: 'Engine shapes', tone: 'green', title: 'This tract has its engine shapes.' }
    case 'missing':
      return { status, label: 'Engine shapes missing', tone: 'red', title: 'The engine has not run, or failed, for this boundary. Engine shapes are required in our mapped states.' }
    case 'no_boundary':
      if (!isEngineStateTract(tract, listingState)) return null
      return { status, label: "No boundary — engine can't run", tone: 'amber', title: 'Draw the tract boundary: engine shapes are required in our mapped states.' }
    case 'empty':
      return { status, label: 'Engine: nothing to draw', tone: 'gray', title: 'The engine ran and found nothing to draw inside this boundary.' }
    case 'no_data':
      return { status, label: 'Engine: no data here', tone: 'gray', title: 'The engine has no data for this place.' }
    default:
      return null
  }
}

/** Solid-fill pill classes per tone (readable on the dark tract cards). */
export const ENGINE_BADGE_CLASS: Record<EngineShapesBadge['tone'], string> = {
  green: 'bg-green-600 text-white',
  red: 'bg-red-600 text-white',
  amber: 'bg-amber-400 text-black',
  gray: 'bg-gray-500 text-white',
}

function tractLabel(tract: unknown, index: number): string {
  const n = (tract as Tract | null | undefined)?.tract_number
  return `Tract ${n ?? index + 1}`
}

/**
 * One line for the top of a staged auction card, or null when no tract in
 * the nine states is `missing` / `no_boundary`:
 *   "2 of 6 tracts in our mapped states have no engine shapes (1 no boundary, 1 engine missing)"
 * The "of N" counts the tracts known to be in the nine states.
 */
export function engineShapesSummary(tracts: unknown, listingState?: unknown): string | null {
  const list: unknown[] = Array.isArray(tracts) ? tracts : []
  let inStates = 0
  let noBoundary = 0
  let missing = 0
  for (const t of list) {
    const s = engineShapesStatus(t)
    if (s == null || s === 'not_engine_state') continue
    if (s === 'no_boundary' && !isEngineStateTract(t, listingState)) continue
    inStates++
    if (s === 'no_boundary') noBoundary++
    else if (s === 'missing') missing++
  }
  const bad = noBoundary + missing
  if (bad === 0) return null
  const parts: string[] = []
  if (noBoundary) parts.push(`${noBoundary} no boundary`)
  if (missing) parts.push(`${missing} engine missing`)
  return `${bad} of ${inStates} ${inStates === 1 ? 'tract' : 'tracts'} in our mapped states ${bad === 1 ? 'has' : 'have'} no engine shapes (${parts.join(', ')})`
}

export interface EngineChecklistItem {
  scope: 'tract'
  code: 'engine_shapes_missing' | 'engine_shapes_no_boundary'
  tract_number: number | string
  message: string
}

/** Checklist lines for the "Incomplete fields" block, one per problem tract. */
export function engineShapesChecklistItems(tracts: unknown, listingState?: unknown): EngineChecklistItem[] {
  const list: unknown[] = Array.isArray(tracts) ? tracts : []
  const out: EngineChecklistItem[] = []
  list.forEach((t, i) => {
    const problem = engineShapesProblem(t, listingState)
    if (!problem) return
    const label = tractLabel(t, i)
    const n = (t as Tract | null | undefined)?.tract_number ?? i + 1
    out.push(problem === 'missing'
      ? { scope: 'tract', code: 'engine_shapes_missing', tract_number: n, message: `${label} — engine shapes missing` }
      : { scope: 'tract', code: 'engine_shapes_no_boundary', tract_number: n, message: `${label} — no boundary, engine shapes required` })
  })
  return out
}

function hasRing(coords: unknown): boolean {
  if (!Array.isArray(coords)) return false
  const isPt = (p: unknown) => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number'
  if (coords.filter(isPt).length >= 3) return true
  return coords.some((c) => Array.isArray(c) && !isPt(c) && hasRing(c))
}

/**
 * The fields a boundary save hands back (TractMapEditor onUpdate) carry no
 * `engine_shapes`, and the old value described the OLD boundary. Returns the
 * update with the value the page may show until the row is next read:
 *  - the update's own `engine_shapes` when the server sent one;
 *  - 'no_boundary' when the boundary was cleared (exactly the backend rule);
 *  - otherwise unknown (no badge) — whether the engine has run for the new
 *    boundary is only known to the server.
 * An update that does not touch the boundary is returned unchanged.
 */
export function withEngineShapesAfterBoundaryUpdate<T extends Record<string, any>>(update: T): T {
  if (!update || !Object.prototype.hasOwnProperty.call(update, 'polygon_coordinates')) return update
  if (engineShapesStatus(update)) return update
  return { ...update, engine_shapes: hasRing(update.polygon_coordinates) ? undefined : 'no_boundary' }
}

/**
 * A Workshop save returns the full tract without `engine_shapes`. Carry the
 * page's value onto it: a saved staff land cover counts as 'ok' (the backend
 * rule) when the tract is one the engine applies to; anything else keeps the
 * value from the last read. The server's own value, when sent, wins.
 */
export function withEngineShapesAfterWorkshopSave<T extends Record<string, any>>(serverTract: T, pageTract: unknown): T {
  if (!serverTract || typeof serverTract !== 'object') return serverTract
  if (engineShapesStatus(serverTract)) return serverTract
  const old = engineShapesStatus(pageTract)
  if (old == null) return serverTract
  const slc = serverTract.staff_land_cover
  const hasStaffCover = !!slc && typeof slc === 'object' && Array.isArray(slc.polygons)
  const applies = old === 'ok' || old === 'missing' || old === 'empty' || old === 'no_data'
  return { ...serverTract, engine_shapes: applies && hasStaffCover ? 'ok' : old }
}
