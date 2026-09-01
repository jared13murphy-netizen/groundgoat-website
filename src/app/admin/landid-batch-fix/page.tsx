'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Loader2, ExternalLink, Check, X, Play, RefreshCw } from 'lucide-react'
import { fetchScraperProxy } from '@/lib/fetchWithAuth'

const SCRAPER_PROXY = '/api/scraper-proxy'
const SCRAPER_URL =
  process.env.NEXT_PUBLIC_SCRAPER_URL ||
  'https://ground-goat-scraper-production.up.railway.app'

type Proposal = {
  id: string
  tract_id: string
  run_id: string
  created_at: string | null
  status: 'success' | 'no_landid' | 'acres_mismatch' | 'fetch_failed' | 'error'
  review_status: 'pending' | 'approved' | 'rejected' | null
  landid_hash: string | null
  proposed_acres: number | null
  scraped_acres: number | null
  old_acres_diff: number | null
  error_message: string | null
  tract_number: number | null
  total_acres: number | null
  listing_id: string
  title: string | null
  county: string | null
  state: string | null
  source_url: string | null
  primary_image_url: string | null
  company: string
  applied_at: string | null
}

const STATUS_LABEL: Record<Proposal['status'], string> = {
  success: 'Land ID match',
  no_landid: 'No Land ID on page',
  acres_mismatch: 'Acres mismatch',
  fetch_failed: 'Source URL fetch failed',
  error: 'Error',
}

const STATUS_COLOR: Record<Proposal['status'], string> = {
  success: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  no_landid: 'bg-gg-gray-700/40 text-gg-gray-300 border-gg-gray-600',
  acres_mismatch: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
  fetch_failed: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
  error: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
}

export default function LandIdBatchFixPage() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stateFilter, setStateFilter] = useState<string>('IA')
  const [statusFilter, setStatusFilter] = useState<string>('success')
  // After a run, we want to see the auto-applied fixes by default —
  // those have review_status='approved'. Switch to 'rejected' to see
  // anything the user already flagged as wrong.
  const [reviewFilter, setReviewFilter] = useState<string>('approved')
  const [limit, setLimit] = useState<number>(20)
  const [runResult, setRunResult] = useState<any>(null)
  const [busyProposal, setBusyProposal] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const qs = new URLSearchParams()
      if (statusFilter) qs.set('status', statusFilter)
      if (reviewFilter) qs.set('review', reviewFilter)
      if (stateFilter) qs.set('state', stateFilter)
      const r = await fetchScraperProxy(`/api/admin/landid-batch-fix/proposals?${qs.toString()}`)
      const data = await r.json()
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`)
      setProposals(data.items || [])
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [statusFilter, reviewFilter, stateFilter])

  useEffect(() => { load() }, [load])

  async function runBatch() {
    setRunning(true); setRunResult(null); setError(null)
    try {
      const r = await fetchScraperProxy(`/api/admin/landid-batch-fix/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: stateFilter || undefined, limit }),
      })
      const data = await r.json()
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`)
      setRunResult(data)
      await load()
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setRunning(false)
    }
  }

  async function markWrong(p: Proposal) {
    if (!confirm('Mark this Land ID polygon as wrong? The tract will go back on the missing-boundaries dashboard for manual fixing.'))
      return
    setBusyProposal(p.id)
    try {
      const r = await fetchScraperProxy(`/api/admin/landid-batch-fix/proposal/${p.id}/reject`, {
        method: 'POST',
      })
      const data = await r.json()
      if (!r.ok || !data.success) throw new Error(data.error || `HTTP ${r.status}`)
      await load()
    } catch (e: any) {
      alert(`Mark-wrong failed: ${e.message || e}`)
    } finally {
      setBusyProposal(null)
    }
  }

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-2xl font-bold">Land ID Batch Fix</h1>
          <p className="text-sm text-gg-gray-400 mt-1">
            Automated fixer for single-tract listings flagged as missing or
            wrong. Pick a state, hit <strong>Run batch</strong>, and the
            scraper will fetch each source URL, find a Land ID embed, pull
            the polygon, and — when the polygon's acreage matches the
            scraped acres within 1 ac — auto-apply the fix and run full
            re-enrichment (state-aware soil rating, tillable acres, tract
            image, listing primary image). Review the results below; click
            <strong> Mark wrong</strong> on anything that doesn't look right
            and that tract goes back on the missing-boundaries dashboard
            for manual fixing.
          </p>
        </div>

        <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-4 mb-4 flex flex-wrap gap-3 items-center">
          <label className="text-xs uppercase text-gg-gray-400">State</label>
          <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}
                  className="bg-gg-gray-950 border border-gg-gray-700 rounded px-2 py-1 text-sm">
            <option value="">All</option>
            <option value="IA">IA</option>
            <option value="IL">IL</option>
            <option value="MO">MO</option>
            <option value="IN">IN</option>
            <option value="MN">MN</option>
            <option value="NE">NE</option>
            <option value="KS">KS</option>
            <option value="WI">WI</option>
            <option value="OH">OH</option>
            <option value="ND">ND</option>
            <option value="SD">SD</option>
          </select>
          <label className="text-xs uppercase text-gg-gray-400 ml-2">Limit</label>
          <input type="number" min={1} max={200} value={limit}
                 onChange={e => setLimit(Math.max(1, Math.min(200, Number(e.target.value) || 20)))}
                 className="bg-gg-gray-950 border border-gg-gray-700 rounded px-2 py-1 text-sm w-20" />
          <button onClick={runBatch} disabled={running}
                  className="ml-2 px-3 py-1.5 rounded bg-gg-pink hover:bg-gg-pink/80 text-white text-sm flex items-center gap-1.5 disabled:opacity-50">
            {running ? <Loader2 className="animate-spin" size={14} /> : <Play size={14} />}
            {running ? 'Running…' : `Run batch (${limit})`}
          </button>
          <button onClick={load}
                  className="px-3 py-1.5 rounded border border-gg-gray-700 hover:bg-gg-gray-800 text-sm flex items-center gap-1.5">
            <RefreshCw size={14} /> Reload
          </button>
        </div>

        {runResult && (
          <div className="bg-gg-gray-900 border border-emerald-700/40 rounded p-3 mb-4 text-sm">
            <div className="font-semibold text-emerald-300 mb-1">
              Run {runResult.run_id?.slice(0, 8)} — {runResult.total_attempted} attempted,
              {' '}<span className="text-emerald-200">{runResult.auto_applied || 0} auto-applied</span>
              {runResult.apply_errors ? <span className="text-rose-300"> · {runResult.apply_errors} apply errors</span> : null}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-gg-gray-300">
              {Object.entries(runResult.counts || {}).map(([k, v]) => (
                <span key={k}>
                  <span className="text-gg-gray-400">{k}:</span> <strong>{String(v)}</strong>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 mb-4 text-sm">
          <span className="text-xs uppercase text-gg-gray-400">Status:</span>
          {(['success', 'acres_mismatch', 'no_landid', 'fetch_failed', 'error', ''] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
                    className={`px-2 py-1 rounded text-xs ${statusFilter === s
                      ? 'bg-gg-pink/30 text-gg-pink' : 'bg-gg-gray-800 text-gg-gray-300 hover:bg-gg-gray-700'}`}>
              {s === '' ? 'All' : STATUS_LABEL[s as Proposal['status']]}
            </button>
          ))}
          <span className="text-xs uppercase text-gg-gray-400 ml-3">Review:</span>
          {(['pending', 'approved', 'rejected', ''] as const).map(s => (
            <button key={s || 'all'} onClick={() => setReviewFilter(s)}
                    className={`px-2 py-1 rounded text-xs ${reviewFilter === s
                      ? 'bg-gg-pink/30 text-gg-pink' : 'bg-gg-gray-800 text-gg-gray-300 hover:bg-gg-gray-700'}`}>
              {s === '' ? 'All' : s}
            </button>
          ))}
        </div>

        {loading && <div className="flex items-center gap-2 text-gg-gray-400">
          <Loader2 className="animate-spin" size={16} /> Loading…</div>}
        {error && (
          <div className="bg-rose-900/40 border border-rose-700 rounded p-3 mb-4 text-rose-200 text-sm">
            {error}
          </div>
        )}
        {!loading && proposals.length === 0 && (
          <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-6 text-gg-gray-400 text-sm">
            No proposals match the current filters. Try running a preview batch above.
          </div>
        )}

        <div className="space-y-3">
          {proposals.map(p => (
            <div key={p.id} className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gg-gray-800 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white truncate">{p.title || '(untitled)'}</span>
                    <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${STATUS_COLOR[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                    {p.review_status && p.review_status !== 'pending' && (
                      <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                        p.review_status === 'approved'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-gg-gray-700/60 text-gg-gray-300 border border-gg-gray-600'
                      }`}>
                        {p.review_status}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gg-gray-400">
                    <span>{p.county}, {p.state}</span>
                    <span>Tract {p.tract_number ?? '?'} · {p.total_acres ?? '?'} ac</span>
                    {p.company && <span>{p.company}</span>}
                    {p.source_url && (
                      <a href={p.source_url} target="_blank" rel="noreferrer"
                         className="text-gg-pink hover:underline flex items-center gap-1">
                        Source <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  {p.error_message && (
                    <div className="text-xs text-rose-400 mt-1">{p.error_message}</div>
                  )}
                </div>
                {p.status === 'success' && p.review_status === 'approved' && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] text-emerald-300 flex items-center gap-1">
                      <Check size={12} /> Auto-applied
                    </span>
                    <button onClick={() => markWrong(p)} disabled={busyProposal === p.id}
                            className="px-3 py-1.5 rounded text-xs flex items-center gap-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 disabled:opacity-50"
                            title="Send this tract back to the missing-boundaries dashboard for manual fixing">
                      <X size={12} /> Mark wrong
                    </button>
                  </div>
                )}
                {p.status === 'success' && p.review_status === 'pending' && (
                  // Auto-apply failed (rare). Surface it so admin can retry
                  // or send to manual queue.
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-[11px] text-amber-300">Apply failed — see error</span>
                    <button onClick={() => markWrong(p)} disabled={busyProposal === p.id}
                            className="px-3 py-1.5 rounded text-xs flex items-center gap-1 bg-gg-gray-800 hover:bg-gg-gray-700 text-gg-gray-300 border border-gg-gray-700 disabled:opacity-50">
                      <X size={12} /> Send to manual queue
                    </button>
                  </div>
                )}
              </div>
              {p.status === 'success' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3 bg-gg-gray-950">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-gg-gray-400 mb-1">
                      Current (in DB) {p.old_acres_diff != null && (
                        <span className="ml-1 text-gg-gray-500">Δ {p.old_acres_diff > 0 ? '+' : ''}{p.old_acres_diff} ac</span>
                      )}
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${SCRAPER_URL}/api/admin/landid-batch-fix/proposal/${p.id}/current-image`}
                      alt="current polygon"
                      className="w-full h-auto rounded border border-gg-gray-800 bg-gg-gray-900"
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-emerald-400 mb-1">
                      Land ID proposed
                      <span className="ml-1 text-gg-gray-500">{p.proposed_acres} ac</span>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`${SCRAPER_URL}/api/admin/landid-batch-fix/proposal/${p.id}/proposed-image`}
                      alt="proposed polygon"
                      className="w-full h-auto rounded border border-emerald-500/40 bg-gg-gray-900"
                    />
                  </div>
                </div>
              )}
              {(p.review_status === 'rejected' || p.review_status === 'pending') && (
                <div className="px-4 py-2 bg-gg-gray-950 border-t border-gg-gray-800 flex items-center gap-2 text-xs">
                  <Link href={`/admin/upload-boundary-tract/${p.tract_id}`}
                        className="text-gg-pink hover:underline">
                    Open in upload-boundary tool
                  </Link>
                  <span className="text-gg-gray-600">·</span>
                  <Link href={`/admin/boundary-draw-tract/${p.tract_id}`}
                        className="text-gg-pink hover:underline">
                    Open in draw tool
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
