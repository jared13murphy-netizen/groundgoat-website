/**
 * Notes timeline (owner 11/10, "Simple"): dated entries attached to the
 * parcel / tract ITSELF, so the history follows the land into every report
 * and saved project. Backend: notes_timeline.py, contract in
 * report-to-project/NOTES_API.md.
 */
import { fetchWithAuth } from '@/lib/fetchWithAuth'

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
export type NoteCategory = (typeof NOTE_CATEGORIES)[number]['value']

export type NotesPrintMode = 'none' | 'latest' | 'all' | 'range'
export interface NotesPrint { mode: NotesPrintMode; from?: string | null; to?: string | null }
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

/** The print choice for a report body; omitted fields mean "latest". */
export function notesPrintBody(p: NotesPrint): NotesPrint {
  return p.mode === 'range' ? { mode: 'range', from: p.from || null, to: p.to || null } : { mode: p.mode }
}
