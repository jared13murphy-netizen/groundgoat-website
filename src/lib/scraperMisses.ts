/**
 * Data layer for the "Missed" tab on the admin auction staging screen.
 *
 * Everything the tab needs from the backend goes through here, with the fetch
 * function passed in, so it can be exercised with a mocked fetch (see
 * scraperMisses.test.ts — this repo has no jest/vitest harness).
 *
 * Rule: a 404, any other non-OK answer, or a network error is "nothing to show
 * yet" — never a thrown error on load. The endpoints ship separately from this
 * screen, so the screen must stay quiet until they exist.
 */

export type MissStatus =
  | 'open'
  | 'ai_staged'
  | 'ai_none_upcoming'
  | 'ai_rejected'
  | 'needs_person'
  | 'resolved'

export interface Miss {
  id: number
  level: 'company' | 'page'
  url: string | null
  company_name: string | null
  reason: string | null
  detail: string | null
  first_seen: string | null
  last_seen: string | null
  nights_failed: number | null
  status: MissStatus | string
  ai_note: string | null
  ai_checked_at: string | null
  ai_staged_ids: number[] | null
}

export interface LastRunSummary {
  companies?: number
  read?: number
  staged?: number
  needs_person?: number
  none_upcoming?: number
  usd?: number
}

export interface LastRun {
  started_at: string | null
  finished_at: string | null
  summary: LastRunSummary | null
}

export interface MissesResponse {
  counts: Record<string, number>
  misses: Miss[]
  last_run: LastRun | null
  spend_tonight_usd: number
  cap_usd: number
}

export interface AiRejection {
  id: number
  source_url: string | null
  reason: string | null
  what_was_sold: string | null
  rejected_at: string | null
  company_name: string | null
  title: string | null
}

export interface DuplicateCaught {
  source_url: string | null
  reason: string | null
  rule: string | null
  detail: string | null
  created_at: string | null
}

export interface RejectionsResponse {
  rejections: AiRejection[]
  duplicates_caught: DuplicateCaught[]
}

export interface MissedData {
  /** null = the misses endpoint is not answering yet (404 / error). */
  misses: MissesResponse | null
  /** null = the rejections endpoint is not answering yet (404 / error). */
  rejections: RejectionsResponse | null
}

/** Same shape as fetchWithAuth / window.fetch. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export const REASON_LABELS: Record<string, string> = {
  company_no_auctions_found: 'Scraper found no auctions on this page',
  company_all_cards_filtered: 'Scraper found items but kept none',
  completeness_gap: 'Site shows auctions we did not have',
  page_blocked: 'Site blocked us',
  page_no_listing_data: 'Could not read the auction page',
  page_no_date: 'No auction date found',
  page_error: 'Scraper error',
}

/** Plain words for a reason code. Unknown codes fall back to a neutral label. */
export function reasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Scraper problem'
  return REASON_LABELS[reason] || 'Scraper problem'
}

export const HANDLED_STATUSES = ['ai_staged', 'ai_none_upcoming', 'resolved']

export const HANDLED_LABELS: Record<string, string> = {
  ai_staged: 'AI added it to staging',
  ai_none_upcoming: 'AI found no upcoming auctions',
  resolved: 'Marked done',
}

export interface MissGroups {
  needsPerson: Miss[]
  waiting: Miss[]
  handled: Miss[]
}

export function groupMisses(misses: Miss[] | null | undefined): MissGroups {
  const list = Array.isArray(misses) ? misses : []
  return {
    needsPerson: list.filter((m) => m.status === 'needs_person'),
    waiting: list.filter((m) => m.status === 'open'),
    handled: list.filter((m) => HANDLED_STATUSES.includes(m.status)),
  }
}

/**
 * The number on the "Missed" tab. Uses the server's count (the list is capped
 * at 200 rows) and falls back to counting the rows we were given.
 */
export function needsPersonCount(data: MissesResponse | null | undefined): number {
  if (!data) return 0
  const fromCounts = data.counts?.needs_person
  if (typeof fromCounts === 'number') return fromCounts
  return groupMisses(data.misses).needsPerson.length
}

function money(n: unknown): string {
  const v = typeof n === 'number' && isFinite(n) ? n : 0
  return `$${v.toFixed(2)}`
}

function num(n: unknown): number {
  return typeof n === 'number' && isFinite(n) ? n : 0
}

/** The one-line summary at the top of the Missed view. */
export function summaryLine(data: MissesResponse | null | undefined): string {
  if (!data || !data.last_run) return 'No AI run yet.'
  const s = data.last_run.summary || {}
  const read = num(s.read)
  const staged = num(s.staged)
  const needs = num(s.needs_person)
  return (
    `Last night the AI checked ${read} company ${read === 1 ? 'page' : 'pages'}, ` +
    `added ${staged} ${staged === 1 ? 'auction' : 'auctions'} to staging, ` +
    `and ${needs} ${needs === 1 ? 'needs' : 'need'} a person. ` +
    `AI cost ${money(data.spend_tonight_usd)} of ${money(data.cap_usd)}.`
  )
}

export function nightsFailedText(n: number | null | undefined): string {
  const v = num(n)
  return `failed ${v} ${v === 1 ? 'night' : 'nights'}`
}

/** "Nov 23, 2026" — empty string when the date is missing or unreadable. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Only http(s) links are ever rendered as clickable. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null
}

async function getJson<T>(fetchFn: FetchFn, url: string): Promise<T | null> {
  try {
    const res = await fetchFn(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

/** Loads both lists. Never throws; a missing endpoint comes back as null. */
export async function loadMissed(fetchFn: FetchFn, apiUrl: string): Promise<MissedData> {
  const [misses, rejections] = await Promise.all([
    getJson<MissesResponse>(fetchFn, `${apiUrl}/api/admin/scraper/misses?status=&level=&limit=200`),
    getJson<RejectionsResponse>(fetchFn, `${apiUrl}/api/admin/scraper/ai-rejections?days=14`),
  ])
  return {
    misses: misses && Array.isArray(misses.misses) ? misses : null,
    rejections: rejections
      ? {
          rejections: Array.isArray(rejections.rejections) ? rejections.rejections : [],
          duplicates_caught: Array.isArray(rejections.duplicates_caught) ? rejections.duplicates_caught : [],
        }
      : null,
  }
}

/** Marks a miss done / needs a person / open again. Returns true when saved. */
export async function setMissStatus(
  fetchFn: FetchFn,
  apiUrl: string,
  id: number,
  status: 'resolved' | 'needs_person' | 'open',
  note?: string,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${apiUrl}/api/admin/scraper/misses/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(note ? { status, note } : { status }),
    })
    return res.ok
  } catch {
    return false
  }
}

/** Puts an AI-rejected auction back in line. Returns true when restored. */
export async function restoreRejection(fetchFn: FetchFn, apiUrl: string, id: number): Promise<boolean> {
  try {
    const res = await fetchFn(`${apiUrl}/api/admin/scraper/ai-rejections/${id}/restore`, { method: 'POST' })
    if (!res.ok) return false
    const body = await res.json().catch(() => null)
    return !!body && body.restored === true
  } catch {
    return false
  }
}

/** Local state after a "Done" click: the row leaves its section and the tab count drops. */
export function withMissResolved(data: MissedData, id: number): MissedData {
  if (!data.misses) return data
  const hit = data.misses.misses.find((m) => m.id === id)
  if (!hit) return data
  const counts = { ...data.misses.counts }
  if (typeof counts[hit.status] === 'number') counts[hit.status] = Math.max(0, counts[hit.status] - 1)
  counts.resolved = (counts.resolved || 0) + 1
  return {
    ...data,
    misses: {
      ...data.misses,
      counts,
      misses: data.misses.misses.map((m) => (m.id === id ? { ...m, status: 'resolved' } : m)),
    },
  }
}

/** Local state after a "Restore" click: the row leaves the rejected list. */
export function withRejectionRestored(data: MissedData, id: number): MissedData {
  if (!data.rejections) return data
  return {
    ...data,
    rejections: {
      ...data.rejections,
      rejections: data.rejections.rejections.filter((r) => r.id !== id),
    },
  }
}
