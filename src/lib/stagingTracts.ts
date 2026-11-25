/**
 * Shared rules for the staged-tract copies the admin staging pages keep in
 * memory (auction staging + private-treaty staging).
 *
 * The pages PATCH their whole copy of `scraped_data` back to
 * `PATCH /api/admin/staging/{id}`. That copy goes stale the moment anything
 * is saved server-side (above all a Tillable Workshop save), so the backend
 * gives every staged tract two server-owned keys:
 *
 *   _uid           stable identity (array index and tract_number are not:
 *                  the number is editable and can be duplicate or null)
 *   _tillable_rev  bumped on every Workshop save
 *
 * Both are always sent back UNCHANGED and are never created or edited here.
 * A tract added on the page has no `_uid` until the server returns one.
 *
 * Pure functions only (no React, no imports) so this file runs under plain
 * Node for its unit test: `node src/lib/stagingTracts.test.ts`.
 */

/** Keys only the Tillable Workshop writes. The server ignores client values
 *  for these; the page must never move or invent them. */
export const TILLABLE_WORK_KEYS = [
  'tillable_clu_selection',
  'tillable_manual_polygons',
  'tillable_cutout_polygons',
  'tillable_clu_overrides',
  'tillable_polygon',
  'tillable_polygon_source',
  // The Map It-style Workshop's saved land cover (all five classes).
  'staff_land_cover',
] as const

/** Server-owned identity keys. Travel with the tract object, never edited. */
export const SERVER_IDENTITY_KEYS = ['_uid', '_tillable_rev'] as const

/** The tract boundary. "Swap Polygons" swaps exactly these: the server moves
 *  the tillable work to whichever tract ends up holding the boundary. */
export const BOUNDARY_KEYS = ['polygon_coordinates', 'polygon_holes'] as const

/** Keys that exist only for the page (set by the list GET or by the page
 *  itself). Kept from the page's copy when the server's tract omits them. */
export const PAGE_LOCAL_TRACT_KEYS = ['has_tract_image', 'tract_image_base64'] as const

/** Computed keys the server adds to a staged tract in its responses only
 *  (`engine_shapes`: the engine-shapes badge, see ./engineShapes.ts). They
 *  are never sent back in a PATCH. */
export const RESPONSE_ONLY_TRACT_KEYS = ['engine_shapes'] as const

type Tract = Record<string, any>
type ScrapedData = Record<string, any>

/** The tract's server uid, or null for a tract the server has not seen. */
export function tractUid(tract: unknown): string | null {
  const uid = (tract as Tract | null | undefined)?._uid
  return typeof uid === 'string' && uid.length > 0 ? uid : null
}

/**
 * Where a tract sits in `tracts`: by `_uid` when one is given and present,
 * otherwise the fallback index (only if it is in range). -1 when neither
 * resolves. A uid that is given but NOT found does not fall back to the
 * index when another tract with a different uid sits there: that would be
 * a different tract.
 */
export function findTractIndex(tracts: unknown, uid: string | null | undefined, fallbackIndex?: number | null): number {
  const list: Tract[] = Array.isArray(tracts) ? tracts : []
  if (uid) {
    const byUid = list.findIndex((t) => tractUid(t) === uid)
    if (byUid !== -1) return byUid
  }
  if (fallbackIndex == null || fallbackIndex < 0 || fallbackIndex >= list.length) return -1
  const there = tractUid(list[fallbackIndex])
  if (uid && there && there !== uid) return -1
  return fallbackIndex
}

/**
 * Replace one tract in a scraped_data document with the server's full copy
 * (the `tract` in a Workshop save response). Everything on the page's old
 * copy is dropped except page-local keys the server did not send, so stale
 * tillable keys / computed / chosen / manual can never be PATCHed back.
 * Returns the same document when the tract cannot be located.
 */
export function replaceTractInScrapedData(
  scraped: ScrapedData | null | undefined,
  serverTract: Tract | null | undefined,
  opts: { uid?: string | null; index?: number | null } = {},
): ScrapedData {
  const sd: ScrapedData = { ...(scraped || {}) }
  if (!serverTract || typeof serverTract !== 'object') return sd
  const tracts: Tract[] = Array.isArray(sd.tracts) ? [...sd.tracts] : []
  const uid = opts.uid ?? tractUid(serverTract)
  const at = findTractIndex(tracts, uid, opts.index)
  if (at === -1) return sd
  const old = tracts[at] || {}
  const next: Tract = { ...serverTract }
  for (const k of PAGE_LOCAL_TRACT_KEYS) {
    if (next[k] === undefined && old[k] !== undefined) next[k] = old[k]
  }
  tracts[at] = next
  sd.tracts = tracts
  return sd
}

/** Drop tracts whose uid is waiting to be deleted (used when a row is
 *  re-read from the server before the delete has been PATCHed). */
export function withoutDeletedTracts(scraped: ScrapedData | null | undefined, deletedUids: readonly string[] | undefined): ScrapedData {
  const sd: ScrapedData = { ...(scraped || {}) }
  if (!deletedUids || deletedUids.length === 0 || !Array.isArray(sd.tracts)) return sd
  const gone = new Set(deletedUids)
  sd.tracts = sd.tracts.filter((t: Tract) => {
    const uid = tractUid(t)
    return !(uid && gone.has(uid))
  })
  return sd
}

/** Pending deletes, per staging row id. Immutable updates. */
export type PendingDeletes = Record<number, string[]>

export function addPendingDeletes(pending: PendingDeletes, stagingId: number, uids: readonly (string | null | undefined)[]): PendingDeletes {
  const add = uids.filter((u): u is string => typeof u === 'string' && u.length > 0)
  if (add.length === 0) return pending
  const have = pending[stagingId] || []
  const merged = [...have]
  for (const u of add) if (!merged.includes(u)) merged.push(u)
  if (merged.length === have.length) return pending
  return { ...pending, [stagingId]: merged }
}

/** Remove the uids a PATCH just delivered. Uids queued while that PATCH was
 *  in flight stay queued. */
export function clearPendingDeletes(pending: PendingDeletes, stagingId: number, sent: readonly string[]): PendingDeletes {
  const have = pending[stagingId]
  if (!have || have.length === 0) return pending
  const left = have.filter((u) => !sent.includes(u))
  const next = { ...pending }
  if (left.length) next[stagingId] = left
  else delete next[stagingId]
  return next
}

/**
 * The document without the response-only tract keys. The same object is
 * returned when no tract carries one (nothing is copied).
 */
export function withoutResponseOnlyTractKeys<T extends ScrapedData | null | undefined>(scraped: T): T {
  const tracts = scraped?.tracts
  if (!Array.isArray(tracts)) return scraped
  const has = (t: Tract) => !!t && typeof t === 'object' && RESPONSE_ONLY_TRACT_KEYS.some((k) => k in t)
  if (!tracts.some(has)) return scraped
  return {
    ...scraped,
    tracts: tracts.map((t: Tract) => {
      if (!has(t)) return t
      const copy: Tract = { ...t }
      for (const k of RESPONSE_ONLY_TRACT_KEYS) delete copy[k]
      return copy
    }),
  } as T
}

/**
 * Body for `PATCH /api/admin/staging/{id}`: the page's copy of scraped_data
 * (minus the response-only tract keys) plus `deleted_tract_uids` when any
 * are due. The server KEEPS every stored
 * tract the client did not send unless its uid is listed, so a delete that
 * is not listed is silently undone. A uid that is still present in the
 * document being sent is never listed.
 */
export function buildStagingPatchBody(
  scraped: ScrapedData | null | undefined,
  deletedUids: readonly string[] | undefined,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = { scraped_data: withoutResponseOnlyTractKeys(scraped), ...extra }
  const present = new Set(
    (Array.isArray(scraped?.tracts) ? scraped!.tracts : []).map((t: Tract) => tractUid(t)).filter(Boolean),
  )
  const due = (deletedUids || []).filter((u) => !present.has(u))
  if (due.length) body.deleted_tract_uids = due
  return body
}

/** Uids of tracts that were in `before` and are no longer in `after`. */
export function removedTractUids(before: unknown, after: unknown): string[] {
  const kept = new Set((Array.isArray(after) ? after : []).map((t) => tractUid(t)).filter(Boolean))
  const out: string[] = []
  for (const t of Array.isArray(before) ? before : []) {
    const uid = tractUid(t)
    if (uid && !kept.has(uid) && !out.includes(uid)) out.push(uid)
  }
  return out
}

/**
 * Swap `keys` between two tracts. A key missing on one side is swapped as an
 * explicit `null` (never dropped): the server keeps any key the client does
 * not send, so a dropped key would leave the old value on that tract.
 * Server identity keys and the tillable work keys are never moved, whatever
 * `keys` says: the server relocates tillable work itself.
 */
export function swapKeys(a: Tract, b: Tract, keys: readonly string[]): [Tract, Tract] {
  const na: Tract = { ...a }
  const nb: Tract = { ...b }
  const fixed: readonly string[] = [...SERVER_IDENTITY_KEYS, ...TILLABLE_WORK_KEYS]
  for (const k of keys) {
    if (fixed.includes(k)) continue
    const inA = a != null && Object.prototype.hasOwnProperty.call(a, k) && a[k] !== undefined
    const inB = b != null && Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined
    if (!inA && !inB) continue
    na[k] = inB ? b[k] : null
    nb[k] = inA ? a[k] : null
  }
  return [na, nb]
}

/**
 * "Swap Everything": the two tract objects trade places wholesale, so each
 * one's `_uid`, `_tillable_rev` and tillable work travel with it. Only the
 * tract NUMBER stays with the slot — otherwise the swap would do nothing
 * but reorder the list.
 */
export function swapTractObjects(a: Tract, b: Tract): [Tract, Tract] {
  const na: Tract = { ...b }
  const nb: Tract = { ...a }
  const numA = a?.tract_number
  const numB = b?.tract_number
  na.tract_number = numA === undefined ? null : numA
  nb.tract_number = numB === undefined ? null : numB
  return [na, nb]
}

/**
 * The original tract an Edit-modal row belongs to, so a duplicate tract
 * number can never copy one tract's record onto another:
 *   1. by `_uid` when the row has one (a uid that is gone matches nothing);
 *   2. a row without a uid: by the position it was built from
 *      (`_src_index`), if the tract there has no uid either;
 *   3. last, by tract_number — only among tracts with no uid, and only when
 *      exactly one has that number.
 * A row added in the modal carries `_src_index: -1` and matches nothing (it
 * is a new tract), whatever number is typed on it.
 */
export function findOriginalTract(
  originals: unknown,
  row: { _uid?: string | null; _src_index?: number | null; tract_number?: number | null },
): Tract | null {
  const list: Tract[] = Array.isArray(originals) ? originals : []
  if (row._uid) return list.find((t) => tractUid(t) === row._uid) || null
  if (row._src_index != null) {
    // -1 (or any out-of-range value) marks a row added in the modal.
    const there = row._src_index >= 0 && row._src_index < list.length ? list[row._src_index] : null
    return there && !tractUid(there) ? there : null
  }
  const matches = list.filter((t) => !tractUid(t) && t?.tract_number === row.tract_number)
  return matches.length === 1 ? matches[0] : null
}

/**
 * Decides whether a single-row re-read may replace the page's copy of a
 * staging row, so a re-read can never overwrite an edit made after it was
 * requested. Per staging row id:
 *
 *  - only the LATEST re-read applies (an older response is 'superseded');
 *  - a re-read that came back after a local edit (a PATCH was started, or
 *    noteEdit() was called for an unsaved in-memory edit) is 'edited': it is
 *    dropped, and one more re-read is owed;
 *  - finishPatch() returns true when a re-read should run now: one is owed,
 *    or one is still in flight (it predates this PATCH), and no other PATCH
 *    for the row is still in flight.
 *
 * No React, no timers — the page keeps one instance in a ref.
 */
export class RowRereadGate {
  seq: Record<number, number> = {}
  edits: Record<number, number> = {}
  rereads: Record<number, number> = {}
  patches: Record<number, number> = {}
  owed: Record<number, boolean> = {}

  /** A local in-memory edit that is not PATCHed right away. */
  noteEdit(id: number): void {
    this.edits[id] = (this.edits[id] || 0) + 1
  }

  startPatch(id: number): void {
    this.noteEdit(id)
    this.patches[id] = (this.patches[id] || 0) + 1
  }

  /** True → re-read the row now. Call when the PATCH settles (ok or not). */
  finishPatch(id: number): boolean {
    this.patches[id] = Math.max(0, (this.patches[id] || 0) - 1)
    if (this.patches[id] > 0) return false
    if (this.owed[id] || (this.rereads[id] || 0) > 0) {
      this.owed[id] = false
      return true
    }
    return false
  }

  startReread(id: number): { seq: number; edits: number } {
    this.seq[id] = (this.seq[id] || 0) + 1
    this.rereads[id] = (this.rereads[id] || 0) + 1
    return { seq: this.seq[id], edits: this.edits[id] || 0 }
  }

  /** Call exactly once per startReread, when the response (or failure) is in. */
  finishReread(id: number, token: { seq: number; edits: number }, failed = false): 'apply' | 'superseded' | 'edited' | 'failed' {
    this.rereads[id] = Math.max(0, (this.rereads[id] || 0) - 1)
    if (token.seq !== this.seq[id]) return 'superseded'
    if (failed) return 'failed'
    if ((this.edits[id] || 0) !== token.edits) {
      this.owed[id] = true
      return 'edited'
    }
    return 'apply'
  }

  /** The row is gone from the page. */
  forget(id: number): void {
    delete this.seq[id]; delete this.edits[id]; delete this.rereads[id]
    delete this.patches[id]; delete this.owed[id]
  }
}
