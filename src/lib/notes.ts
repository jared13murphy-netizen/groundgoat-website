/**
 * Notes timeline (owner 11/10, "Simple"): dated entries attached to the
 * parcel / tract ITSELF, so the history follows the land into every report
 * and saved project. Backend: notes_timeline.py, contract in
 * report-to-project/NOTES_API.md.
 */
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import { PRODUCT_KINDS, type NoteProductLineIn, type ProductKind } from '@/lib/noteProducts'
export { PRODUCT_KINDS, noteProductsBody, productLineText, productDetailParts, productMatches, productFieldLabels } from '@/lib/noteProducts'
export type { ProductKind, ProductDetails, NoteProductLineIn } from '@/lib/noteProducts'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export const NOTE_CATEGORIES = [
  { value: 'note', label: 'Note' },
  { value: 'field_visit', label: 'Field visit' },
  { value: 'application', label: 'Application' },
  { value: 'harvest', label: 'Harvest' },
  { value: 'soil_test', label: 'Soil test' },
  { value: 'loan_review', label: 'Loan review' },
  { value: 'other', label: 'Other' },
] as const
/** A built-in key, or a firm's own category: 'firm:<uuid>' (owner 11/11). */
export type NoteCategory = (typeof NOTE_CATEGORIES)[number]['value'] | `firm:${string}`

export interface NoteCategoryOption { value: string; label: string; custom: boolean }
export interface FirmNoteCategory {
  id: string; value: string; label: string; custom: true
  created_by: string | null; created_at: string | null; updated_at: string | null; used?: number
}
export interface NoteCategoriesState {
  categories: NoteCategoryOption[]
  custom: FirmNoteCategory[]
  /** Any member of a management firm may add a category. */
  can_add: boolean
  /** The firm admin renames / deletes them (Account → Note Categories). */
  can_manage: boolean
}
const BUILTIN_STATE: NoteCategoriesState = {
  categories: NOTE_CATEGORIES.map((c) => ({ ...c, custom: false })), custom: [], can_add: false, can_manage: false,
}
export const FIRM_CATEGORY_MAX = 40

// One shared copy for every dropdown on the page: a category added in one
// timeline shows at once in all the others.
let catState: NoteCategoriesState = BUILTIN_STATE
let catLoad: Promise<NoteCategoriesState> | null = null
const catListeners = new Set<(s: NoteCategoriesState) => void>()
function setCatState(s: NoteCategoriesState) { catState = s; catListeners.forEach((f) => f(s)) }
export function noteCategoriesSnapshot(): NoteCategoriesState { return catState }
export function subscribeNoteCategories(f: (s: NoteCategoriesState) => void): () => void {
  catListeners.add(f)
  return () => { catListeners.delete(f) }
}

/** The dropdown's categories (built-ins + the firm's own). Cached; `force`
 *  re-reads. Falls back to the built-ins if the server can't be reached. */
export function loadNoteCategories(force = false): Promise<NoteCategoriesState> {
  if (catLoad && !force) return catLoad
  catLoad = (async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/notes/categories`)
      const s = await json<NoteCategoriesState>(res)
      setCatState(s)
      return s
    } catch (e: any) {
      if (e?.status !== 403 && e?.status !== 401) catLoad = null   // no notes for this account: don't keep asking
      return catState
    }
  })()
  return catLoad
}

export async function addNoteCategory(label: string): Promise<FirmNoteCategory> {
  const res = await fetchWithAuth(`${API_URL}/api/notes/categories`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }),
  })
  const cat = (await json<{ category: FirmNoteCategory }>(res)).category
  await loadNoteCategories(true)
  return cat
}

export async function renameNoteCategory(id: string, label: string): Promise<FirmNoteCategory> {
  const res = await fetchWithAuth(`${API_URL}/api/notes/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label }),
  })
  const cat = (await json<{ category: FirmNoteCategory }>(res)).category
  await loadNoteCategories(true)
  return cat
}

/** Entries filed under it move to "Note". */
export async function deleteNoteCategory(id: string): Promise<{ moved_to_note: number }> {
  const out = await json<{ moved_to_note: number }>(
    await fetchWithAuth(`${API_URL}/api/notes/categories/${encodeURIComponent(id)}`, { method: 'DELETE' }))
  await loadNoteCategories(true)
  return out
}

export type NotesPrintMode = 'none' | 'latest' | 'all' | 'range' | 'pick'
/** `ids` (mode 'pick', owner 11/11): the entries the user ticked. The server
 *  re-checks every id against the item's own timeline under the user's
 *  visibility, so a stray / internal / foreign id never prints. */
export interface NotesPrint { mode: NotesPrintMode; from?: string | null; to?: string | null; ids?: string[] | null }
/** One item a report covers, for the "Choose notes" list. */
export interface NotePickItem { key: string; label: string }
export const NOTES_PRINT_MODES: { value: NotesPrintMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'latest', label: 'Latest note only' },
  { value: 'all', label: 'All notes' },
  { value: 'range', label: 'Date range' },
]
export const DEFAULT_NOTES_PRINT: NotesPrint = { mode: 'latest' }

export const MAX_NOTE_FILES = 10
export const MAX_NOTE_FILE_MB = 15
export const NOTE_FILE_ACCEPT = 'image/jpeg,image/png,image/heic,image/heif,image/webp,image/gif,application/pdf,.heic,.heif'

export interface NoteAttachment {
  id: string
  kind: 'image' | 'pdf'
  filename: string
  content_type: string
  size: number
  url: string
  thumb_url: string | null
}

export interface NoteItemRef {
  key: string
  kind: 'parcel' | 'tract' | 'saved' | 'point'
  id: string | null
  label: string | null
  county: string | null
  state: string | null
}

export interface NoteEntry {
  id: string
  item_key: string
  via: string | null
  item: NoteItemRef
  entry_date: string
  created_at: string
  updated_at: string
  edited: boolean
  edited_at: string | null
  author: { id: string; name: string }
  category: NoteCategory
  category_label: string
  text: string
  internal: boolean
  scope: 'private' | 'firm'
  can_edit: boolean
  attachments: NoteAttachment[]
  /** Firm products on this note: a COPY of each as saved, plus this note's
   *  rate. product_id is null once the product was deleted from the list.
   *  (Optional only for an older server.) */
  products?: NoteProductLine[]
}

export interface NoteTimeline { count: number; entries: NoteEntry[]; error?: string }

export interface NoteSearchResult {
  entry: NoteEntry
  item: NoteItemRef & { latitude: number | null; longitude: number | null; project_id: string | null; listing_id?: string | null }
  snippet: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The timeline key for a report row — the same rule the backend uses
 *  (saved_reports.item_key): saved tract → cm:, tract → t:, parcel → p:
 *  (real ll_uuid) or pt:<lng>,<lat> (a bare map point). */
export function noteKeyForRow(t: {
  id?: string | null; tractId?: string | null; savedId?: string | null; llUuid?: string | null
  latitude?: number | null; longitude?: number | null
}): string | null {
  if (t.savedId && UUID_RE.test(t.savedId)) return `cm:${t.savedId.toLowerCase()}`
  if (t.tractId && UUID_RE.test(t.tractId)) return `t:${t.tractId.toLowerCase()}`
  const ll = t.llUuid && UUID_RE.test(t.llUuid) ? t.llUuid : t.id && UUID_RE.test(t.id) ? t.id : null
  if (ll) return `p:${ll.toLowerCase()}`
  if (t.latitude != null && t.longitude != null && isFinite(t.latitude) && isFinite(t.longitude)) {
    return `pt:${Number(t.longitude).toFixed(6)},${Number(t.latitude).toFixed(6)}`
  }
  return null
}

// ── Firm products on notes (owner 11/12) ─────────────────────────────
// Management firms keep a product list (fertilizer, chemical / herbicide,
// seed, other). Any firm member adds one; only the firm admin edits,
// retires or deletes. A note keeps a COPY of each product plus its own
// rate. Individuals never see any of this. Backend: firm_products.py.

export const MAX_NOTE_PRODUCTS = 20

export interface FirmProduct {
  id: string
  kind: ProductKind
  kind_label: string
  name: string
  brand: string
  epa_reg_no: string
  variety: string
  retired: boolean
  /** Firm admin only. */
  notes_using?: number
}

export interface NoteProductLine {
  /** The line's own id (server-saved lines). A line picked in the editor
   *  but not saved yet has none. */
  id?: string | null
  product_id: string | null
  kind: string
  kind_label: string
  name: string
  brand: string
  epa_reg_no: string
  variety: string
  rate: string
}

export interface ProductInput { kind: ProductKind; name: string; brand: string; epa_reg_no: string; variety: string }

export interface NotesMeta {
  can_attach: boolean
  can_use_products: boolean
  can_add_products: boolean
  can_manage_products: boolean
  product_kinds: { value: ProductKind; label: string }[]
}
const NO_META: NotesMeta = { can_attach: false, can_use_products: false, can_add_products: false, can_manage_products: false, product_kinds: PRODUCT_KINDS }

let metaLoad: Promise<NotesMeta> | null = null
/** /api/notes/meta, read once per page. Anything that fails = no products. */
export function loadNotesMeta(force = false): Promise<NotesMeta> {
  if (metaLoad && !force) return metaLoad
  metaLoad = (async () => {
    try {
      const m = await json<Partial<NotesMeta>>(await fetchWithAuth(`${API_URL}/api/notes/meta`))
      return {
        can_attach: !!m.can_attach,
        can_use_products: !!m.can_use_products,
        can_add_products: !!m.can_add_products,
        can_manage_products: !!m.can_manage_products,
        product_kinds: m.product_kinds?.length ? m.product_kinds : PRODUCT_KINDS,
      }
    } catch (e: any) {
      if (e?.status !== 403 && e?.status !== 401) metaLoad = null
      return NO_META
    }
  })()
  return metaLoad
}

export interface ProductsState { products: FirmProduct[]; loaded: boolean }
// One shared copy of the firm's ACTIVE products for every note editor on
// the page: a product added in one shows at once in all the others.
let prodState: ProductsState = { products: [], loaded: false }
let prodLoad: Promise<ProductsState> | null = null
const prodListeners = new Set<(s: ProductsState) => void>()
function setProdState(s: ProductsState) { prodState = s; prodListeners.forEach((f) => f(s)) }
export function firmProductsSnapshot(): ProductsState { return prodState }
export function subscribeFirmProducts(f: (s: ProductsState) => void): () => void {
  prodListeners.add(f)
  return () => { prodListeners.delete(f) }
}

/** The firm's active products (the note picker's list). Cached; `force` re-reads. */
export function loadFirmProducts(force = false): Promise<ProductsState> {
  if (prodLoad && !force) return prodLoad
  prodLoad = (async () => {
    try {
      const r = await json<{ products: FirmProduct[] }>(await fetchWithAuth(`${API_URL}/api/notes/products`))
      const s = { products: (r.products || []).filter((p) => !p.retired), loaded: true }
      setProdState(s)
      return s
    } catch (e: any) {
      if (e?.status !== 403 && e?.status !== 401) prodLoad = null
      return prodState
    }
  })()
  return prodLoad
}

/** The Products page list. include_retired / notes_using only for the firm admin. */
export async function fetchFirmProducts(includeRetired = false): Promise<{ products: FirmProduct[]; can_add: boolean; can_manage: boolean }> {
  const q = includeRetired ? '?include_retired=true' : ''
  return json(await fetchWithAuth(`${API_URL}/api/notes/products${q}`))
}

/** 409 when it is already in the list (the message says so). */
export async function addFirmProduct(p: ProductInput): Promise<FirmProduct> {
  const res = await fetchWithAuth(`${API_URL}/api/notes/products`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
  })
  const out = (await json<{ product: FirmProduct }>(res)).product
  void loadFirmProducts(true)
  return out
}

/** Firm admin. `update_existing` (unticked by default): also rewrite every
 *  note's copy of it (rates stay). updated_notes = how many notes changed. */
export async function updateFirmProduct(id: string, p: Partial<ProductInput> & { retired?: boolean; update_existing?: boolean }): Promise<{ product: FirmProduct; updated_notes: number }> {
  const res = await fetchWithAuth(`${API_URL}/api/notes/products/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ update_existing: false, ...p }),
  })
  const out = await json<{ product: FirmProduct; updated_notes: number }>(res)
  void loadFirmProducts(true)
  return { product: out.product, updated_notes: Number(out.updated_notes) || 0 }
}

/** Firm admin. Notes that used it keep their copy (notes_kept). */
export async function deleteFirmProduct(id: string): Promise<{ notes_kept: number }> {
  const out = await json<{ notes_kept: number }>(
    await fetchWithAuth(`${API_URL}/api/notes/products/${encodeURIComponent(id)}`, { method: 'DELETE' }))
  void loadFirmProducts(true)
  return { notes_kept: Number(out.notes_kept) || 0 }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = 'Something went wrong — try again'
    try { const d = await res.json(); if (d?.detail && typeof d.detail === 'string') msg = d.detail } catch { /* keep */ }
    const err: any = new Error(msg)
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

export interface TimelineFilters { category?: string | null; from?: string | null; to?: string | null; q?: string | null }

export async function fetchTimelines(keys: string[], f: TimelineFilters = {}): Promise<Record<string, NoteTimeline>> {
  const uniq = Array.from(new Set(keys.filter(Boolean)))
  if (!uniq.length) return {}
  const out: Record<string, NoteTimeline> = {}
  for (let i = 0; i < uniq.length; i += 100) {
    const res = await fetchWithAuth(`${API_URL}/api/notes/timeline`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: uniq.slice(i, i + 100), category: f.category || null, from: f.from || null, to: f.to || null, q: f.q || null }),
    })
    Object.assign(out, (await json<{ items: Record<string, NoteTimeline> }>(res)).items)
  }
  return out
}

export async function fetchTimeline(key: string, f: TimelineFilters = {}): Promise<NoteTimeline> {
  return (await fetchTimelines([key], f))[key] || { count: 0, entries: [] }
}

export interface NoteDraft {
  entry_date: string
  category: NoteCategory
  text: string
  internal: boolean
  /** Firm accounts only. On an edit, sending it REPLACES the note's list;
   *  leave it out to keep the products as they are. Max 20. A line the note
   *  already has goes as {line_id, rate} (kept exactly as saved, even when
   *  its product was deleted); a new one as {product_id, rate}. */
  products?: NoteProductLineIn[]
}

export async function createNote(itemKey: string, d: NoteDraft, ctx: {
  label?: string | null; county?: string | null; state?: string | null; latitude?: number | null; longitude?: number | null
} = {}): Promise<NoteEntry> {
  const res = await fetchWithAuth(`${API_URL}/api/notes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_key: itemKey, item_label: ctx.label || null, county: ctx.county || null, state: ctx.state || null,
                           latitude: ctx.latitude ?? null, longitude: ctx.longitude ?? null, ...d }),
  })
  return (await json<{ entry: NoteEntry }>(res)).entry
}

export async function updateNote(id: string, d: Partial<NoteDraft>): Promise<NoteEntry> {
  const res = await fetchWithAuth(`${API_URL}/api/notes/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d),
  })
  return (await json<{ entry: NoteEntry }>(res)).entry
}

export async function deleteNote(id: string): Promise<void> {
  await json(await fetchWithAuth(`${API_URL}/api/notes/${id}`, { method: 'DELETE' }))
}

export async function uploadNoteFiles(id: string, files: File[]): Promise<NoteEntry> {
  const fd = new FormData()
  for (const f of files) fd.append('files', f, f.name)
  const res = await fetchWithAuth(`${API_URL}/api/notes/${id}/attachments`, { method: 'POST', body: fd }, 120_000)
  return (await json<{ entry: NoteEntry }>(res)).entry
}

export async function removeNoteFile(id: string, attachmentId: string): Promise<NoteEntry> {
  const res = await fetchWithAuth(`${API_URL}/api/notes/${id}/attachments/${attachmentId}`, { method: 'DELETE' })
  return (await json<{ entry: NoteEntry }>(res)).entry
}

export async function searchNotes(f: TimelineFilters & { limit?: number; offset?: number }): Promise<{ total: number; results: NoteSearchResult[] }> {
  const p = new URLSearchParams()
  if (f.q) p.set('q', f.q)
  if (f.category) p.set('category', f.category)
  if (f.from) p.set('from', f.from)
  if (f.to) p.set('to', f.to)
  p.set('limit', String(f.limit ?? 50))
  if (f.offset) p.set('offset', String(f.offset))
  return json(await fetchWithAuth(`${API_URL}/api/notes/search?${p.toString()}`))
}

/** Today in Central time, YYYY-MM-DD (the backend's default date). */
export function todayIso(): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const g = (t: string) => parts.find((x) => x.type === t)?.value || ''
  return `${g('year')}-${g('month')}-${g('day')}`
}

export function fmtNoteDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** The print choice for a report body; omitted fields mean "latest".
 *  'pick' before its list has loaded (no ids yet) sends 'latest' — the
 *  same entries the list starts with ticked. */
export function notesPrintBody(p: NotesPrint): NotesPrint {
  if (p.mode === 'range') return { mode: 'range', from: p.from || null, to: p.to || null }
  if (p.mode === 'pick') return Array.isArray(p.ids) ? { mode: 'pick', ids: p.ids } : { mode: 'latest' }
  return { mode: p.mode }
}

/** The items a comparables report body covers, keyed exactly as the server
 *  keys them (notes_timeline.item_key_of / subject_key_of). */
export function noteItemsForReportBody(body: {
  tract_id?: string | null; subject_cm_id?: string | null; subject_ll_uuid?: string | null
  comparables?: Array<{ source?: string | null; tract_id?: string | null; cm_id?: string | null; ll_uuid?: string | null
    latitude?: number | null; longitude?: number | null; owner?: string | null; company_name?: string | null
    county?: string | null; state?: string | null }>
}, subjectLabel = 'Subject'): NotePickItem[] {
  const out: NotePickItem[] = []
  const seen = new Set<string>()
  const add = (key: string | null, label: string) => {
    if (!key) return
    const k = key.toLowerCase()
    if (seen.has(k)) return
    seen.add(k); out.push({ key: k, label })
  }
  const real = (v: string | null | undefined) => (v && UUID_RE.test(v) ? v : null)
  const sKey = real(body.subject_cm_id) ? `cm:${body.subject_cm_id}`
    : real(body.subject_ll_uuid) ? `p:${body.subject_ll_uuid}`
    : real(body.tract_id) ? `t:${body.tract_id}` : null
  add(sKey, subjectLabel)
  for (const c of body.comparables || []) {
    const src = c.source || 'tract'
    let key: string | null = null
    if (src === 'saved' && real(c.cm_id)) key = `cm:${c.cm_id}`
    else if (src === 'parcel') {
      if (real(c.ll_uuid)) key = `p:${c.ll_uuid}`
      else if (c.latitude != null && c.longitude != null && isFinite(c.latitude) && isFinite(c.longitude)) {
        key = `pt:${Number(c.longitude).toFixed(6)},${Number(c.latitude).toFixed(6)}`
      }
    } else if (real(c.tract_id)) key = `t:${c.tract_id}`
    const place = [c.county, c.state].filter(Boolean).join(', ')
    add(key, (c.owner || c.company_name || '').trim() || place || 'Comparable')
  }
  return out
}

/** Where a Notes search result is on the map (owner 11/10: tapping a result
 *  ALWAYS flies there). The server sends lat/lng; when it can't, a point key
 *  carries its own, and a parcel / tract is looked up by id. */
export async function locateNoteItem(item: NoteSearchResult['item']): Promise<{ lat: number; lng: number } | null> {
  const ok = (lat: any, lng: any) => {
    const a = Number(lat), o = Number(lng)
    return lat != null && lng != null && isFinite(a) && isFinite(o) && !(a === 0 && o === 0) ? { lat: a, lng: o } : null
  }
  const direct = ok(item.latitude, item.longitude)
  if (direct) return direct
  const key = item.key || ''
  if (key.startsWith('pt:')) {
    const [lng, lat] = key.slice(3).split(',')
    return ok(lat, lng)
  }
  try {
    if (item.kind === 'parcel' && item.id) {
      const res = await fetchWithAuth(`${API_URL}/api/regrid/parcel?ll_uuid=${encodeURIComponent(item.id)}`)
      if (res.ok) {
        const p = (await res.json())?.parcel || {}
        const hit = ok(p.lat ?? p.latitude ?? p.centroid_lat, p.lon ?? p.lng ?? p.longitude ?? p.centroid_lng)
        if (hit) return hit
        const g = p._geometry
        const ring: number[][] | undefined = g?.type === 'Polygon' ? g.coordinates?.[0] : g?.type === 'MultiPolygon' ? g.coordinates?.[0]?.[0] : undefined
        if (ring?.length) {
          const xs = ring.map((c) => c[0]), ys = ring.map((c) => c[1])
          return ok((Math.min(...ys) + Math.max(...ys)) / 2, (Math.min(...xs) + Math.max(...xs)) / 2)
        }
      }
    } else if (item.kind === 'tract' && item.id) {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${encodeURIComponent(item.id)}`)
      if (res.ok) { const t = await res.json(); return ok(t?.latitude, t?.longitude) }
    }
  } catch { /* fall through: no location */ }
  return null
}
