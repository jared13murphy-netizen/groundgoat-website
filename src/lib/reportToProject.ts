// Save a comp report as a Map It project (owner-approved 2026-11-10).
//
// OWNER RULE: SAVE WORKS THE FIRST TIME, EVERY TIME. NO FAILURE UX.
//   • preview while the panel is open; Save is enabled only when it will succeed
//   • ONE idempotency key per Save tap; the server dedupes on it
//   • the client retries invisibly, with backoff, until the server confirms —
//     through dropped connections, timeouts, 5xx and reloads (the pending save
//     is kept in localStorage and resumed on the next page load)
//   • nothing ever says "did not save" or "try again"
// Contract: report-to-project/API.md (backend report_project.py).
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import type { TractSaleData } from '@/components/portal/PortalTractDetail'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const PROJECT_SAVE_CAP = 50

export interface ReportItem {
  source: 'tract' | 'parcel' | 'saved'
  tract_id?: string | null
  ll_uuid?: string | null
  cm_id?: string | null
  listing_id?: string | null
  latitude?: number | null
  longitude?: number | null
  county?: string | null
  state?: string | null
  notes?: string | null
  owner?: string | null
  company_name?: string | null
  total_acres?: number | null
  tillable_acres?: number | null
  pct_tillable?: number | null
  soil_rating?: number | null
  soil_rating_type?: string | null
  sale_price?: number | null
  price_per_acre?: number | null
  auction_date?: string | null
}

export interface ProjectChoice { id: string; name: string; shared: boolean; shared_by: string | null; parcels: number; updated_at: string }
export interface PreviewConflict { project_id: string; project_name: string; count: number; keys: string[]; text: string }
export interface Preview {
  ok_to_save: boolean
  over_cap: boolean
  cap: number
  item_count: number
  note: string | null
  default_name: string
  duplicates_removed: number
  counts: { parcels: number; tracts: number; total: number; new: number; conflicts: number; already_in_project: number; unsavable: number } | null
  summary_text: string | null
  conflicts: PreviewConflict[]
  unsavable: { key: string; kind: string; reason: string }[]
  items: any[]
  projects: ProjectChoice[]
  target: { owner_id: string; project_id: string | null; name: string | null }
  share_available: boolean
}
export interface SaveResult {
  ok: boolean
  project: { id: string; name: string; created: boolean; owned: boolean }
  counts: { saved: number; moved: number; left: number; already_in_project: number; skipped: number; duplicates_removed: number }
  summary_text: string
  item_ids: string[]
  saved_report: { id: string; name: string } | null
  share_available: boolean
  idempotency_key: string
  replayed?: boolean
}

function realUuid(id: string | null | undefined): string | null {
  return id && UUID_RE.test(id) ? id : null
}

/** One report row → the item the server resolves (ids + the figures the row shows). */
export function reportItemFromRow(t: TractSaleData): ReportItem {
  const source: ReportItem['source'] = t.savedId ? 'saved' : t.tractId ? 'tract' : 'parcel'
  return {
    source,
    tract_id: source === 'tract' ? (t.tractId || null) : null,
    cm_id: source === 'saved' ? (t.savedId || null) : null,
    ll_uuid: source === 'parcel' ? (realUuid(t.llUuid) || realUuid(t.id)) : null,
    listing_id: t.listingId || null,
    latitude: t.latitude ?? null,
    longitude: t.longitude ?? null,
    county: t.county || null,
    state: t.state || null,
    notes: (t.notes || '').trim() || null,
    owner: t.owner ?? null,
    company_name: t.companyName ?? null,
    total_acres: t.totalAcres ?? null,
    tillable_acres: t.tillableAcres ?? null,
    pct_tillable: (t as any).pctTillable ?? null,
    soil_rating: t.soilRating ?? null,
    soil_rating_type: t.soilRatingType ?? null,
    sale_price: t.salePrice ?? null,
    price_per_acre: t.pricePerAcre ?? null,
    auction_date: t.auctionDate ?? null,
  }
}

/** The report's subject → an item, or null for a report with no subject. */
export function reportItemFromSubject(s: any | null | undefined): ReportItem | null {
  if (!s) return null
  const kind = (s.subject_kind || '').toLowerCase()
  let source: ReportItem['source'] | null = null
  if (s.subject_cm_id && (kind === 'saved' || !kind)) source = 'saved'
  else if (s.tract_id && kind !== 'parcel') source = 'tract'
  else if (s.subject_ll_uuid) source = 'parcel'
  else if (s.subject_cm_id) source = 'saved'
  else if (s.tract_id) source = 'tract'
  if (!source) return null
  return {
    source,
    tract_id: source === 'tract' ? s.tract_id : null,
    cm_id: source === 'saved' ? s.subject_cm_id : null,
    ll_uuid: source === 'parcel' ? s.subject_ll_uuid : null,
    listing_id: s.listing_id || null,
    county: s.county || null, state: s.state || null,
    total_acres: s.subject_acres ?? null, tillable_acres: s.subject_tillable_acres ?? null,
    pct_tillable: s.subject_pct_tillable ?? null, soil_rating: s.subject_soil_rating ?? null,
    soil_rating_type: s.subject_soil_rating_type ?? null,
    auction_date: s.subject_auction_date ?? null, company_name: s.subject_company ?? null,
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000]

/** Resolves when the browser says it is online (immediately when it already is), or after `ms`. */
function onlineOrAfter(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') { setTimeout(resolve, ms); return }
    const done = () => { window.removeEventListener('online', done); clearTimeout(t); resolve() }
    const t = setTimeout(done, ms)
    window.addEventListener('online', done)
  })
}

/** Permanent answers: the same request can never succeed, so do not loop on them. */
const PERMANENT = new Set([400, 401, 403, 404, 409, 422])

export class PermanentError extends Error {
  status: number
  constructor(status: number, detail: string) { super(detail); this.status = status }
}

/** POST/PUT that retries until the server confirms (2xx). Network errors,
 *  timeouts and any non-permanent status retry with backoff, forever; while
 *  offline it waits for the browser's 'online' event. */
export async function untilConfirmed<T>(path: string, init: RequestInit, opts: { signal?: { cancelled: boolean } } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.cancelled) throw new Error('cancelled')
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await onlineOrAfter(15000)
      continue
    }
    try {
      const res = await fetchWithAuth(`${API_URL}${path}`, init)
      if (res.ok) return (await res.json()) as T
      if (PERMANENT.has(res.status)) {
        let detail = `Request failed (${res.status})`
        try { const b = await res.json(); if (b?.detail) detail = typeof b.detail === 'string' ? b.detail : detail } catch { /* keep */ }
        throw new PermanentError(res.status, detail)
      }
    } catch (e) {
      if (e instanceof PermanentError) throw e
      // network error / timeout / aborted fetch: fall through to the backoff
    }
    await onlineOrAfter(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)])
  }
}

export function previewFromReport(body: { subject: ReportItem | null; items: ReportItem[]; project_id: string | null },
                                  opts: { signal?: { cancelled: boolean } } = {}) {
  return untilConfirmed<Preview>('/api/mapping/projects/from-report/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, opts)
}

export interface SaveBody {
  idempotency_key: string
  subject: ReportItem | null
  items: ReportItem[]
  project_id: string | null
  name: string | null
  conflict: 'move' | 'leave'
  report?: { name?: string | null; subject: Record<string, any>; items: any[] } | null
}

const PENDING_KEY = 'gg_pending_project_saves'

function readPending(): SaveBody[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') || [] } catch { return [] }
}
function writePending(list: SaveBody[]) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)) } catch { /* private mode: in-memory retry still runs */ }
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') return (crypto as any).randomUUID()
  // RFC 4122 v4 fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

const inFlight = new Map<string, Promise<SaveResult>>()

/** Save until the server confirms. The pending save is persisted first, so a
 *  reload mid-save finishes it on the next page load (resumePendingProjectSaves). */
export function saveReportAsProject(body: SaveBody): Promise<SaveResult> {
  const existing = inFlight.get(body.idempotency_key)
  if (existing) return existing
  const list = readPending().filter((b) => b.idempotency_key !== body.idempotency_key)
  writePending([...list, body])
  const p = (async () => {
    let cur = body
    for (;;) {
      try {
        const out = await untilConfirmed<SaveResult>('/api/mapping/projects/from-report', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cur),
        })
        writePending(readPending().filter((b) => b.idempotency_key !== body.idempotency_key))
        return out
      } catch (e) {
        // The chosen project vanished between preview and save (deleted by
        // its owner): save into a new project of the same name instead.
        if (e instanceof PermanentError && e.status === 404 && cur.project_id) {
          cur = { ...cur, project_id: null, name: cur.name || null }
          continue
        }
        writePending(readPending().filter((b) => b.idempotency_key !== body.idempotency_key))
        throw e
      }
    }
  })()
  inFlight.set(body.idempotency_key, p)
  p.finally(() => inFlight.delete(body.idempotency_key)).catch(() => {})
  return p
}

let resumed = false
/** Finish any save a reload interrupted. Safe to call many times. */
export function resumePendingProjectSaves(onDone?: (r: SaveResult) => void) {
  if (resumed || typeof window === 'undefined') return
  resumed = true
  for (const b of readPending()) {
    saveReportAsProject(b).then((r) => onDone?.(r)).catch(() => {})
  }
}

/** The plain saved-report save, with the same invisible retry (the server
 *  upserts on the report's fingerprint, so a repeat never duplicates). */
export function saveReportUntilConfirmed(body: { name?: string | null; subject: Record<string, any>; items: any[] }) {
  return untilConfirmed<{ report: any }>('/api/mapping/saved-reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

/** Open the Saved Projects panel on a project (ExploreMap listens). */
export function openSavedProject(projectId: string) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('gg:open-saved-project', { detail: { projectId } }))
}
