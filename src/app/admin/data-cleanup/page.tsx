'use client'

// Force dynamic rendering — admin pages must never be cached at the edge
// (a 1-year static HTML cache would pin an old JS bundle hash after redeploy).
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ExternalLink, MapPin, ChevronLeft, ChevronRight } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// States where soil mapping is done → tract polygon + tillable + soil rating
// can all be completed. Every other state is SHOWN but held read-only until
// its soil mapping ships (NE is in progress). Per user 2026-06-02.
const ACTIONABLE_STATES = ['IL', 'IA', 'MO', 'IN', 'WI', 'MN']
const STAFF = ['Isaac', 'Haley', 'Brandt', 'Truly', 'Jared']
const STATUSES = ['queued', 'in_progress', 'done', 'unfixable'] as const
const PAGE_SIZE = 100

// Defect-reason → short label + tailwind color. These ONLY order/annotate the
// queue; they never decide "this is the full defect set" (early-scraper fakes
// pass every check), so a human still eyeballs every tract against the URL.
const REASON_META: Record<string, { label: string; cls: string }> = {
  poly_missing:           { label: 'No polygon',        cls: 'bg-red-500/20 text-red-300 border-red-500/40' },
  poly_invalid:           { label: 'Invalid geom',      cls: 'bg-red-500/20 text-red-300 border-red-500/40' },
  poly_degenerate:        { label: 'Degenerate',        cls: 'bg-red-500/20 text-red-300 border-red-500/40' },
  duplicate_polygon:      { label: 'Duplicate',         cls: 'bg-orange-500/20 text-orange-300 border-orange-500/40' },
  acreage_mismatch:       { label: 'Acreage off',       cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  boundary_valid_false:   { label: 'Flagged wrong',     cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  tillable_acres_missing: { label: 'No tillable',       cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  rating_missing:         { label: 'No soil rating',    cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  rating_wrong_type:      { label: 'Wrong rating type', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
}

type QueueItem = {
  listing_id: string
  cleanup_status: string
  assigned_to: string | null
  priority: boolean
  is_sold: boolean
  state: string | null
  tract_count: number
  defect_tract_count: number
  flagged_reasons: Record<string, number> | null
  audited_at: string | null
  updated_at: string | null
  title: string | null
  county: string | null
  source_url: string | null
}

type Stats = {
  listings: number
  defect_tracts: number
  priority_listings: number
  by_status: Record<string, number>
  by_state: Record<string, number>
  by_assignee: Record<string, number>
}

function statusLabel(s: string) {
  return s === 'in_progress' ? 'In progress'
    : s.charAt(0).toUpperCase() + s.slice(1)
}

export default function TractDataCleanupPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters
  const [stateFilter, setStateFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('') // '', '__unassigned__', or a name
  const [statusFilter, setStatusFilter] = useState('')      // '' = all
  const [soldOnly, setSoldOnly] = useState(false)
  const [priorityOnly, setPriorityOnly] = useState(false)
  const [offset, setOffset] = useState(0)

  // Per-row in-flight markers so dropdowns disable while saving.
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/stats`)
      if (res.ok) setStats(await res.json())
    } catch { /* non-fatal: header counts just won't show */ }
  }, [])

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const qs = new URLSearchParams()
      if (stateFilter) qs.set('state', stateFilter)
      if (assigneeFilter === '__unassigned__') qs.set('assigned_to', '')
      else if (assigneeFilter) qs.set('assigned_to', assigneeFilter)
      if (statusFilter) qs.set('cleanup_status', statusFilter)
      if (soldOnly) qs.set('is_sold', 'true')
      if (priorityOnly) qs.set('priority', 'true')
      qs.set('limit', String(PAGE_SIZE))
      qs.set('offset', String(offset))
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/queue?${qs.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [stateFilter, assigneeFilter, statusFilter, soldOnly, priorityOnly, offset])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadQueue() }, [loadQueue])
  // Reset to first page whenever a filter changes.
  useEffect(() => { setOffset(0) }, [stateFilter, assigneeFilter, statusFilter, soldOnly, priorityOnly])

  const patchRow = (lid: string, fields: Partial<QueueItem>) =>
    setItems((prev) => prev.map((it) => (it.listing_id === lid ? { ...it, ...fields } : it)))

  async function setAssignee(lid: string, value: string) {
    const assigned_to = value || null
    const prev = items.find((i) => i.listing_id === lid)?.assigned_to ?? null
    setSavingId(lid)
    patchRow(lid, { assigned_to })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/${lid}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      loadStats()
    } catch (e: any) {
      patchRow(lid, { assigned_to: prev }) // revert
      alert(`Could not update assignee: ${e.message || e}`)
    } finally { setSavingId(null) }
  }

  async function setStatus(lid: string, value: string) {
    const prev = items.find((i) => i.listing_id === lid)?.cleanup_status ?? 'queued'
    setSavingId(lid)
    patchRow(lid, { cleanup_status: value })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/${lid}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleanup_status: value }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      loadStats()
    } catch (e: any) {
      patchRow(lid, { cleanup_status: prev }) // revert
      alert(`Could not update status: ${e.message || e}`)
    } finally { setSavingId(null) }
  }

  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + PAGE_SIZE, total)

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">Tract Data Clean-Up</h1>
          <Link href="/admin/dashboard" className="text-sm text-gg-pink hover:underline">← Dashboard</Link>
        </div>
        <p className="text-sm text-gg-gray-400 mb-4">
          Every listing with tracts is here. A human confirms each tract against its
          source URL — correct polygon, tillable polygon, and soil rating — or flags it.
          Reason badges only order the queue; they don&apos;t decide what&apos;s wrong.
        </p>

        {/* Header stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <StatCard label="Listings" value={stats.listings} />
            <StatCard label="Priority (sold + soil-state)" value={stats.priority_listings} />
            <StatCard label="Done" value={stats.by_status?.done || 0} />
            <StatCard label="Unfixable" value={stats.by_status?.unfixable || 0} />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <label className="text-xs text-gg-gray-400 uppercase tracking-wide">State:</label>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded px-2 py-1 text-sm">
            <option value="">All states</option>
            {stats && Object.entries(stats.by_state)
              .sort((a, b) => b[1] - a[1])
              .map(([st, n]) => (
                <option key={st || 'none'} value={st || ''}>
                  {st || '(none)'} ({n}){ACTIONABLE_STATES.includes(st) ? '' : ' — held'}
                </option>
              ))}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Assigned:</label>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded px-2 py-1 text-sm">
            <option value="">All</option>
            <option value="__unassigned__">Unassigned</option>
            {STAFF.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Status:</label>
          <div className="inline-flex rounded overflow-hidden border border-gg-gray-700">
            {['', ...STATUSES].map((opt) => (
              <button key={opt || 'all'} onClick={() => setStatusFilter(opt)}
                className={`px-3 py-1 text-xs ${statusFilter === opt ? 'bg-gg-pink/30 text-gg-pink' : 'bg-gg-gray-900 text-gg-gray-300 hover:bg-gg-gray-800'}`}>
                {opt ? statusLabel(opt) : 'All'}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1 text-xs text-gg-gray-300 ml-2 cursor-pointer">
            <input type="checkbox" checked={soldOnly} onChange={(e) => setSoldOnly(e.target.checked)} /> Sold only
          </label>
          <label className="flex items-center gap-1 text-xs text-gg-gray-300 ml-1 cursor-pointer">
            <input type="checkbox" checked={priorityOnly} onChange={(e) => setPriorityOnly(e.target.checked)} /> Priority only
          </label>
        </div>

        {/* Pagination header */}
        <div className="flex items-center justify-between mb-3 text-sm text-gg-gray-400">
          <span>{loading ? 'Loading…' : `${pageStart}–${pageEnd} of ${total} listings`}</span>
          <div className="flex items-center gap-2">
            <button disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="px-2 py-1 rounded border border-gg-gray-700 disabled:opacity-40 hover:bg-gg-gray-800 flex items-center gap-1">
              <ChevronLeft size={14} /> Prev
            </button>
            <button disabled={pageEnd >= total || loading} onClick={() => setOffset(offset + PAGE_SIZE)}
              className="px-2 py-1 rounded border border-gg-gray-700 disabled:opacity-40 hover:bg-gg-gray-800 flex items-center gap-1">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-600 rounded p-3 text-red-300 mb-3">{error}</div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-gg-gray-400 py-8 justify-center">
            <Loader2 className="animate-spin" size={18} /> Loading queue…
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-2">
            {items.map((it) => {
              const actionable = it.state ? ACTIONABLE_STATES.includes(it.state) : false
              const reasons = it.flagged_reasons ? Object.entries(it.flagged_reasons) : []
              return (
                <div key={it.listing_id}
                  className={`bg-gg-gray-900 border rounded-lg p-3 ${it.priority ? 'border-gg-pink/40' : 'border-gg-gray-800'}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-semibold text-white truncate max-w-md">{it.title || '(untitled)'}</h2>
                        {it.is_sold && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gg-gray-800 text-gg-gray-300 border border-gg-gray-700">Sold</span>}
                        {it.priority && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gg-pink/20 text-gg-pink border border-gg-pink/40">Priority</span>}
                        {!actionable && (
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-300 border border-yellow-500/40"
                            title="Soil mapping not done for this state — view only, don't update tillable/soil yet">
                            Soil not mapped — hold
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gg-gray-400">
                        <span className="flex items-center gap-1"><MapPin size={11} />{it.county || '—'}, {it.state || '—'}</span>
                        <span>{it.tract_count} tract{it.tract_count === 1 ? '' : 's'}{it.defect_tract_count > 0 ? ` · ${it.defect_tract_count} flagged` : ''}</span>
                        {it.source_url && (
                          <a href={it.source_url} target="_blank" rel="noreferrer" className="text-gg-pink hover:underline flex items-center gap-1">
                            Source <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                      {reasons.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {reasons.map(([r, n]) => {
                            const m = REASON_META[r] || { label: r, cls: 'bg-gg-gray-800 text-gg-gray-300 border-gg-gray-700' }
                            return (
                              <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded border ${m.cls}`}>
                                {m.label}{n > 1 ? ` ×${n}` : ''}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Workflow controls */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <select value={it.assigned_to || ''} disabled={savingId === it.listing_id}
                        onChange={(e) => setAssignee(it.listing_id, e.target.value)}
                        className="bg-gg-gray-950 border border-gg-gray-700 rounded px-2 py-1 text-xs disabled:opacity-50">
                        <option value="">Unassigned</option>
                        {STAFF.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <select value={it.cleanup_status} disabled={savingId === it.listing_id}
                        onChange={(e) => setStatus(it.listing_id, e.target.value)}
                        className="bg-gg-gray-950 border border-gg-gray-700 rounded px-2 py-1 text-xs disabled:opacity-50">
                        {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                      </select>
                      <button disabled
                        title="Per-tract editor — coming in the next stage"
                        className="text-xs px-2 py-1 rounded border border-gg-gray-700 text-gg-gray-500 cursor-not-allowed">
                        Edit tracts (soon)
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            {items.length === 0 && (
              <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-6 text-gg-gray-400 text-center">
                No listings match these filters.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg px-4 py-3">
      <div className="text-2xl font-bold text-white">{value.toLocaleString()}</div>
      <div className="text-xs text-gg-gray-400 mt-0.5">{label}</div>
    </div>
  )
}
