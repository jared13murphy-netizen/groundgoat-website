'use client'

// ───────────────────────────────────────────────────────────────────────
//  /admin/activity — global DB change log.
//
//  Backed by the audit_log table populated by an AFTER INSERT/UPDATE/DELETE
//  trigger on every Tier-1 table (see project_audit_log_system.md, Phase
//  1 + 2). Every write captures: WHAT changed (table, record, columns,
//  old/new row JSONB), WHO did it (user JWT / scraper / webhook), WHEN,
//  WHERE (endpoint + request_id correlation).
//
//  This page is the global timeline. Per-record History tabs on edit
//  pages are Phase 3.5 — added later, they call the same backend's
//  /api/admin/audit-log/record/{table}/{record_id} endpoint.
// ───────────────────────────────────────────────────────────────────────

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
  Loader2,
  Search,
  X,
  RefreshCw,
  Filter as FilterIcon,
  Plus,
  Pencil,
  Trash2,
  User as UserIcon,
  Cpu,
  Webhook,
  HelpCircle,
  ChevronRight,
  Link2,
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// ── Types ─────────────────────────────────────────────────────────────
interface AuditRow {
  id: number
  table_name: string
  record_id: string
  operation: 'I' | 'U' | 'D'
  changed_columns: string[]
  actor_type: string
  actor_id: string | null
  actor_email: string | null
  actor_account_type: string | null
  source: string | null
  request_id: string | null
  ip_address: string | null
  user_agent: string | null
  note: string | null
  changed_at: string | null
}
interface AuditDetail extends AuditRow {
  old_row: Record<string, any> | null
  new_row: Record<string, any> | null
}
interface DetailResponse {
  row: AuditDetail
  siblings: AuditRow[]
}
interface ListResponse {
  rows: AuditRow[]
  next_cursor: number | null
  limit: number
}
interface TableEntry { name: string; count_30d: number }
interface ActorEntry {
  actor_id: string | null
  actor_email: string | null
  actor_account_type: string | null
  actor_type: string | null
  last_seen: string | null
  event_count: number
}

interface Filters {
  table: string
  actor_id: string
  actor_email: string
  actor_type: string
  operation: string
  field: string
  request_id: string
  q: string
  from_ts: string
  to_ts: string
  record_id: string
}
const EMPTY_FILTERS: Filters = {
  table: '', actor_id: '', actor_email: '', actor_type: '', operation: '',
  field: '', request_id: '', q: '', from_ts: '', to_ts: '', record_id: '',
}

// ── Helpers ───────────────────────────────────────────────────────────
function opLabel(o: string) {
  return o === 'I' ? 'Created' : o === 'U' ? 'Updated' : o === 'D' ? 'Deleted' : o
}
function OpIcon({ o }: { o: string }) {
  if (o === 'I') return <Plus size={14} className="text-emerald-400" />
  if (o === 'D') return <Trash2 size={14} className="text-red-400" />
  return <Pencil size={14} className="text-amber-400" />
}
function ActorIcon({ t }: { t: string }) {
  if (t === 'user') return <UserIcon size={14} className="text-sky-400" />
  if (t === 'system') return <Cpu size={14} className="text-purple-400" />
  if (t === 'webhook') return <Webhook size={14} className="text-fuchsia-400" />
  return <HelpCircle size={14} className="text-gg-gray-400" />
}
function timeAgo(iso: string | null) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
function fmtAbsolute(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString()
}
function actorLabel(r: { actor_email: string | null; actor_id: string | null; actor_type: string }) {
  if (r.actor_type === 'user') return r.actor_email || r.actor_id || 'unknown user'
  // For non-user actors the actor_id IS the human label (e.g. system:scraper, webhook:stripe:...)
  return r.actor_id || r.actor_type
}
function shortRecord(id: string) {
  if (!id) return ''
  if (id.length > 12) return id.slice(0, 8) + '…' + id.slice(-4)
  return id
}

// Compute a one-line summary of what changed, for the row.
function summarizeChange(r: AuditRow): string {
  if (r.operation === 'I') return `created in ${r.table_name}`
  if (r.operation === 'D') return `deleted from ${r.table_name}`
  const cols = r.changed_columns || []
  if (!cols.length) return `updated ${r.table_name}`
  if (cols.length === 1) return `${r.table_name}.${cols[0]}`
  if (cols.length <= 3) return `${r.table_name} · ${cols.join(', ')}`
  return `${r.table_name} · ${cols.slice(0, 3).join(', ')} +${cols.length - 3} more`
}

// Diff two JSON values for the drawer.
function valueRepr(v: any): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    try {
      const s = JSON.stringify(v)
      return s.length > 200 ? s.slice(0, 197) + '…' : s
    } catch { return String(v) }
  }
  return String(v)
}

// ── Page ──────────────────────────────────────────────────────────────
// Next.js 14 requires useSearchParams() to be inside a Suspense boundary
// at build time (or the page bails out of static prerendering). Wrap the
// real component in <Suspense> here in the default export, do everything
// else in AdminActivityPageInner below.
export default function AdminActivityPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-gray-900 text-white flex items-center justify-center">
        <Loader2 className="animate-spin" size={20} />
      </div>
    }>
      <AdminActivityPageInner />
    </Suspense>
  )
}

function AdminActivityPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Hydrate initial filters from query string so links are deep-linkable.
  const initial = useMemo<Filters>(() => {
    const f: Filters = { ...EMPTY_FILTERS }
    ;(Object.keys(f) as (keyof Filters)[]).forEach(k => {
      const v = searchParams.get(k)
      if (v != null) f[k] = v
    })
    return f
  }, [searchParams])

  const [filters, setFilters] = useState<Filters>(initial)
  const [pendingFilters, setPendingFilters] = useState<Filters>(initial)
  const [rows, setRows] = useState<AuditRow[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [tableOpts, setTableOpts] = useState<TableEntry[]>([])
  const [actorSearch, setActorSearch] = useState('')
  const [actorOpts, setActorOpts] = useState<ActorEntry[]>([])
  const [actorOpen, setActorOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [detail, setDetail] = useState<DetailResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const reqSeq = useRef(0)

  // ── Load tables (for the table-filter dropdown) once on mount ──
  useEffect(() => {
    (async () => {
      try {
        const r = await fetchWithAuth(API_URL + '/api/admin/audit-log/tables')
        if (r.ok) {
          const j = await r.json()
          setTableOpts(j.tables || [])
        }
      } catch {}
    })()
  }, [])

  // ── Actor autocomplete ──
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const u = new URL(API_URL + '/api/admin/audit-log/actors')
        if (actorSearch.trim()) u.searchParams.set('q', actorSearch.trim())
        const r = await fetchWithAuth(u.toString())
        if (r.ok) {
          const j = await r.json()
          setActorOpts(j.actors || [])
        }
      } catch {}
    }, 200)
    return () => clearTimeout(t)
  }, [actorSearch])

  // ── Build the list query URL ──
  const buildListUrl = useCallback((f: Filters, cursor?: number | null) => {
    const u = new URL(API_URL + '/api/admin/audit-log')
    ;(Object.keys(f) as (keyof Filters)[]).forEach(k => {
      const v = f[k]?.trim?.() ?? f[k]
      if (v) u.searchParams.set(k, String(v))
    })
    u.searchParams.set('limit', '50')
    if (cursor != null) u.searchParams.set('cursor', String(cursor))
    return u.toString()
  }, [])

  // ── Fetch first page when applied filters change ──
  useEffect(() => {
    const mySeq = ++reqSeq.current
    setLoading(true)
    setErr(null)
    setRows([])
    setNextCursor(null)
    ;(async () => {
      try {
        const r = await fetchWithAuth(buildListUrl(filters))
        if (mySeq !== reqSeq.current) return
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const j: ListResponse = await r.json()
        setRows(j.rows || [])
        setNextCursor(j.next_cursor ?? null)
      } catch (e: any) {
        if (mySeq !== reqSeq.current) return
        setErr(e?.message || 'Failed to load')
      } finally {
        if (mySeq === reqSeq.current) setLoading(false)
      }
    })()
  }, [filters, buildListUrl])

  const loadMore = useCallback(async () => {
    if (loadingMore || nextCursor == null) return
    setLoadingMore(true)
    try {
      const r = await fetchWithAuth(buildListUrl(filters, nextCursor))
      if (r.ok) {
        const j: ListResponse = await r.json()
        setRows(prev => [...prev, ...(j.rows || [])])
        setNextCursor(j.next_cursor ?? null)
      }
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, nextCursor, filters, buildListUrl])

  // ── Detail fetch on row select ──
  useEffect(() => {
    if (selectedId == null) { setDetail(null); return }
    setDetailLoading(true)
    let cancel = false
    ;(async () => {
      try {
        const r = await fetchWithAuth(API_URL + '/api/admin/audit-log/' + selectedId)
        if (cancel) return
        if (r.ok) {
          const j: DetailResponse = await r.json()
          setDetail(j)
        } else {
          setDetail(null)
        }
      } finally {
        if (!cancel) setDetailLoading(false)
      }
    })()
    return () => { cancel = true }
  }, [selectedId])

  const applyFilters = () => {
    setFilters(pendingFilters)
    // Mirror to URL so it's shareable. Same-page nav.
    const u = new URLSearchParams()
    ;(Object.keys(pendingFilters) as (keyof Filters)[]).forEach(k => {
      const v = pendingFilters[k]?.trim?.() ?? pendingFilters[k]
      if (v) u.set(k, String(v))
    })
    const qs = u.toString()
    router.replace('/admin/activity' + (qs ? '?' + qs : ''))
  }
  const clearFilters = () => {
    setPendingFilters({ ...EMPTY_FILTERS })
    setFilters({ ...EMPTY_FILTERS })
    router.replace('/admin/activity')
  }
  const pivotByRequest = (request_id: string) => {
    const next: Filters = { ...EMPTY_FILTERS, request_id }
    setPendingFilters(next)
    setFilters(next)
    setSelectedId(null)
    const u = new URLSearchParams({ request_id })
    router.replace('/admin/activity?' + u.toString())
  }
  const pivotByRecord = (table_name: string, record_id: string) => {
    const next: Filters = { ...EMPTY_FILTERS, table: table_name, record_id }
    setPendingFilters(next)
    setFilters(next)
    setSelectedId(null)
    const u = new URLSearchParams({ table: table_name, record_id })
    router.replace('/admin/activity?' + u.toString())
  }
  const pivotByActor = (actor_id: string) => {
    const next: Filters = { ...EMPTY_FILTERS, actor_id }
    setPendingFilters(next)
    setFilters(next)
    setSelectedId(null)
    const u = new URLSearchParams({ actor_id })
    router.replace('/admin/activity?' + u.toString())
  }

  return (
    <div className="min-h-screen bg-gg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link
              href="/admin/dashboard"
              className="inline-flex items-center gap-2 text-sm text-gg-gray-400 hover:text-white mb-2"
            >
              <ArrowLeft size={16} /> Admin Dashboard
            </Link>
            <h1 className="font-display text-3xl font-bold">Activity</h1>
            <p className="text-sm text-gg-gray-400 mt-1">
              Every database change, with who did it, when, and what changed.
            </p>
          </div>
          <button
            onClick={() => setFilters({ ...filters })}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gg-gray-800 hover:bg-gg-gray-700 text-sm"
            title="Refresh"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {/* Filter bar */}
        <div className="card mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Table */}
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Table</label>
              <select
                value={pendingFilters.table}
                onChange={e => setPendingFilters(p => ({ ...p, table: e.target.value }))}
                className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm"
              >
                <option value="">All tables</option>
                {tableOpts.map(t => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({t.count_30d})
                  </option>
                ))}
              </select>
            </div>

            {/* Operation */}
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Operation</label>
              <select
                value={pendingFilters.operation}
                onChange={e => setPendingFilters(p => ({ ...p, operation: e.target.value }))}
                className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm"
              >
                <option value="">Any</option>
                <option value="I">Created</option>
                <option value="U">Updated</option>
                <option value="D">Deleted</option>
              </select>
            </div>

            {/* Actor type */}
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Actor type</label>
              <select
                value={pendingFilters.actor_type}
                onChange={e => setPendingFilters(p => ({ ...p, actor_type: e.target.value }))}
                className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm"
              >
                <option value="">Any</option>
                <option value="user">User</option>
                <option value="system">System</option>
                <option value="webhook">Webhook</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>

            {/* Actor search (autocomplete) */}
            <div className="relative">
              <label className="block text-xs text-gg-gray-400 mb-1">Actor</label>
              <div className="relative">
                <input
                  type="text"
                  value={pendingFilters.actor_id || actorSearch}
                  onChange={e => {
                    setActorSearch(e.target.value)
                    setPendingFilters(p => ({ ...p, actor_id: '' }))
                    setActorOpen(true)
                  }}
                  onFocus={() => setActorOpen(true)}
                  onBlur={() => setTimeout(() => setActorOpen(false), 150)}
                  placeholder="email or actor id"
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm pr-7"
                />
                {pendingFilters.actor_id && (
                  <button
                    onClick={() => { setPendingFilters(p => ({ ...p, actor_id: '' })); setActorSearch('') }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gg-gray-400 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
              {actorOpen && actorOpts.length > 0 && (
                <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-gg-gray-800 border border-gg-gray-700 rounded shadow-lg max-h-72 overflow-y-auto">
                  {actorOpts.map(a => (
                    <button
                      key={a.actor_id || 'null'}
                      onMouseDown={() => {
                        setPendingFilters(p => ({ ...p, actor_id: a.actor_id || '' }))
                        setActorSearch(a.actor_email || a.actor_id || '')
                        setActorOpen(false)
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-gg-gray-700 text-sm flex items-center gap-2"
                    >
                      <ActorIcon t={a.actor_type || 'unknown'} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">
                          {a.actor_email || a.actor_id || '(no id)'}
                        </div>
                        <div className="text-xs text-gg-gray-400 truncate">
                          {a.actor_account_type || a.actor_type} · {a.event_count} events
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Field (column changed) */}
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Column changed</label>
              <input
                type="text"
                value={pendingFilters.field}
                onChange={e => setPendingFilters(p => ({ ...p, field: e.target.value }))}
                placeholder="e.g. sale_price"
                className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm"
              />
            </div>

            {/* Source (free text) */}
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Source contains</label>
              <input
                type="text"
                value={pendingFilters.q}
                onChange={e => setPendingFilters(p => ({ ...p, q: e.target.value }))}
                placeholder="e.g. /api/tracts"
                className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm"
              />
            </div>

            {/* From */}
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">From</label>
              <input
                type="datetime-local"
                value={pendingFilters.from_ts}
                onChange={e => setPendingFilters(p => ({ ...p, from_ts: e.target.value }))}
                className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm"
              />
            </div>

            {/* To */}
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">To</label>
              <input
                type="datetime-local"
                value={pendingFilters.to_ts}
                onChange={e => setPendingFilters(p => ({ ...p, to_ts: e.target.value }))}
                className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Record / request pivots are usually set by clicking a row,
              but we expose plain inputs too for paste-an-ID use. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Record ID</label>
              <input
                type="text"
                value={pendingFilters.record_id}
                onChange={e => setPendingFilters(p => ({ ...p, record_id: e.target.value }))}
                placeholder="paste a UUID to see only that record's history"
                className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Request ID</label>
              <input
                type="text"
                value={pendingFilters.request_id}
                onChange={e => setPendingFilters(p => ({ ...p, request_id: e.target.value }))}
                placeholder="paste a request_id to see all sibling changes"
                className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={applyFilters}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gg-pink hover:bg-gg-pink/80 text-sm font-medium"
            >
              <FilterIcon size={14} /> Apply
            </button>
            <button
              onClick={clearFilters}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-gg-gray-800 hover:bg-gg-gray-700 text-sm"
            >
              <X size={14} /> Clear
            </button>
            <div className="ml-auto text-xs text-gg-gray-400">
              {loading ? 'Loading…' : `${rows.length} row${rows.length === 1 ? '' : 's'} shown${nextCursor ? ' (more available)' : ''}`}
            </div>
          </div>
        </div>

        {err && (
          <div className="card border-red-500/40 text-red-300 mb-4 text-sm">
            Error: {err}
          </div>
        )}

        {/* Timeline + drawer */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className={`${selectedId != null ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <div className="card p-0 overflow-hidden">
              {loading && rows.length === 0 ? (
                <div className="p-8 text-center text-gg-gray-400">
                  <Loader2 className="inline animate-spin mr-2" size={16} /> Loading activity…
                </div>
              ) : rows.length === 0 ? (
                <div className="p-8 text-center text-gg-gray-400 text-sm">
                  No matching activity in the last 2 years.
                </div>
              ) : (
                <ul className="divide-y divide-gg-gray-800">
                  {rows.map(r => (
                    <li
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`px-4 py-3 hover:bg-gg-gray-800/60 cursor-pointer text-sm flex items-center gap-3 ${selectedId === r.id ? 'bg-gg-gray-800/80' : ''}`}
                    >
                      <OpIcon o={r.operation} />
                      <ActorIcon t={r.actor_type} />
                      <div className="flex-1 min-w-0">
                        <div className="truncate">
                          <span className="font-medium">{actorLabel(r)}</span>
                          <span className="text-gg-gray-400"> · {opLabel(r.operation)} </span>
                          <span>{summarizeChange(r)}</span>
                          <span className="text-gg-gray-500"> · {shortRecord(r.record_id)}</span>
                        </div>
                        <div className="text-xs text-gg-gray-500 truncate">
                          {r.source || '(no source)'}{r.actor_account_type ? ' · ' + r.actor_account_type : ''}
                        </div>
                      </div>
                      <div
                        className="text-xs text-gg-gray-400 whitespace-nowrap"
                        title={fmtAbsolute(r.changed_at)}
                      >
                        {timeAgo(r.changed_at)}
                      </div>
                      <ChevronRight size={14} className="text-gg-gray-500" />
                    </li>
                  ))}
                </ul>
              )}
              {nextCursor != null && rows.length > 0 && (
                <div className="p-3 border-t border-gg-gray-800 text-center">
                  <button
                    onClick={loadMore}
                    disabled={loadingMore}
                    className="text-sm text-gg-pink hover:underline disabled:opacity-50"
                  >
                    {loadingMore ? 'Loading…' : 'Load older'}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Detail drawer */}
          {selectedId != null && (
            <div className="lg:col-span-1">
              <div className="card sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-sm font-semibold">Change detail</div>
                  <button
                    onClick={() => setSelectedId(null)}
                    className="p-1 text-gg-gray-400 hover:text-white"
                    title="Close"
                  >
                    <X size={14} />
                  </button>
                </div>
                {detailLoading ? (
                  <div className="text-center py-6 text-gg-gray-400 text-sm">
                    <Loader2 className="inline animate-spin mr-1" size={14} /> Loading…
                  </div>
                ) : !detail ? (
                  <div className="text-center py-6 text-gg-gray-400 text-sm">No detail.</div>
                ) : (
                  <DetailDrawer
                    d={detail}
                    onPivotRequest={pivotByRequest}
                    onPivotRecord={pivotByRecord}
                    onPivotActor={pivotByActor}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Detail drawer body ────────────────────────────────────────────────
function DetailDrawer({
  d,
  onPivotRequest,
  onPivotRecord,
  onPivotActor,
}: {
  d: DetailResponse
  onPivotRequest: (id: string) => void
  onPivotRecord: (table: string, id: string) => void
  onPivotActor: (id: string) => void
}) {
  const r = d.row
  const cols = r.changed_columns || []
  return (
    <div className="text-sm space-y-3">
      <div>
        <div className="text-xs text-gg-gray-400">Operation</div>
        <div className="flex items-center gap-2">
          <OpIcon o={r.operation} /> {opLabel(r.operation)} on{' '}
          <button
            onClick={() => onPivotRecord(r.table_name, r.record_id)}
            className="underline decoration-dotted hover:text-gg-pink font-mono"
            title="See full history of this record"
          >
            {r.table_name}
          </button>
        </div>
      </div>
      <div>
        <div className="text-xs text-gg-gray-400">Record</div>
        <button
          onClick={() => onPivotRecord(r.table_name, r.record_id)}
          className="font-mono text-xs underline decoration-dotted hover:text-gg-pink break-all"
        >
          {r.record_id}
        </button>
      </div>
      <div>
        <div className="text-xs text-gg-gray-400">Actor</div>
        <div className="flex items-center gap-2 flex-wrap">
          <ActorIcon t={r.actor_type} />
          <button
            onClick={() => r.actor_id && onPivotActor(r.actor_id)}
            className="underline decoration-dotted hover:text-gg-pink"
          >
            {actorLabel(r)}
          </button>
          {r.actor_account_type && (
            <span className="px-2 py-0.5 rounded bg-gg-gray-800 text-xs">
              {r.actor_account_type}
            </span>
          )}
        </div>
        {r.ip_address && (
          <div className="text-xs text-gg-gray-500 mt-1">IP {r.ip_address}</div>
        )}
      </div>
      <div>
        <div className="text-xs text-gg-gray-400">Source</div>
        <div className="text-xs break-all">{r.source || '—'}</div>
        {r.request_id && (
          <button
            onClick={() => onPivotRequest(r.request_id!)}
            className="inline-flex items-center gap-1 text-xs text-gg-pink hover:underline mt-1"
          >
            <Link2 size={11} /> request {r.request_id.slice(0, 8)}…
            {d.siblings.length > 0 && <span className="text-gg-gray-400">({d.siblings.length} sibling{d.siblings.length === 1 ? '' : 's'})</span>}
          </button>
        )}
      </div>
      <div>
        <div className="text-xs text-gg-gray-400">When</div>
        <div className="text-xs" title={fmtAbsolute(r.changed_at)}>
          {fmtAbsolute(r.changed_at)} <span className="text-gg-gray-500">({timeAgo(r.changed_at)})</span>
        </div>
      </div>

      {/* Diff */}
      {r.operation === 'U' && cols.length > 0 && (
        <div>
          <div className="text-xs text-gg-gray-400 mb-1">Fields changed ({cols.length})</div>
          <div className="space-y-2">
            {cols.map(c => {
              const oldV = d.row.old_row?.[c]
              const newV = d.row.new_row?.[c]
              return (
                <div key={c} className="bg-gg-gray-800/50 rounded p-2 text-xs">
                  <div className="font-mono text-gg-gray-300 mb-1">{c}</div>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="bg-red-500/10 border border-red-500/20 rounded px-2 py-1 break-words text-red-200">
                      <div className="text-[10px] text-gg-gray-400 mb-0.5">before</div>
                      <div className="font-mono whitespace-pre-wrap">{valueRepr(oldV)}</div>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded px-2 py-1 break-words text-emerald-200">
                      <div className="text-[10px] text-gg-gray-400 mb-0.5">after</div>
                      <div className="font-mono whitespace-pre-wrap">{valueRepr(newV)}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {r.operation === 'I' && d.row.new_row && (
        <div>
          <div className="text-xs text-gg-gray-400 mb-1">Created row</div>
          <pre className="bg-gg-gray-800/50 rounded p-2 text-xs font-mono overflow-x-auto max-h-64">
            {JSON.stringify(d.row.new_row, null, 2)}
          </pre>
        </div>
      )}
      {r.operation === 'D' && d.row.old_row && (
        <div>
          <div className="text-xs text-gg-gray-400 mb-1">Deleted row</div>
          <pre className="bg-gg-gray-800/50 rounded p-2 text-xs font-mono overflow-x-auto max-h-64">
            {JSON.stringify(d.row.old_row, null, 2)}
          </pre>
        </div>
      )}

      {/* Siblings */}
      {d.siblings.length > 0 && (
        <div>
          <div className="text-xs text-gg-gray-400 mb-1">
            Other changes in the same request ({d.siblings.length})
          </div>
          <ul className="text-xs space-y-1">
            {d.siblings.map(s => (
              <li key={s.id} className="text-gg-gray-300 flex items-center gap-2">
                <OpIcon o={s.operation} />
                <span className="truncate">{summarizeChange(s)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
