'use client'

/**
 * Magic Lab — admin-only sandbox for the "find the tract polygon from
 * any auction / private-treaty URL" pipeline.
 *
 * This page does NOT write anything to the production database. It
 * runs the scraper's /api/admin/magic-lab/probe endpoint against a
 * given URL and renders the structured output for human review.
 *
 * Purpose: iterate on the magic pipeline (page acquisition, polygon
 * resolution, validation) without touching real listings. Once the
 * pipeline reliably handles 80%+ of test URLs, we'll wire it into
 * the prod scrapers via separate commits.
 *
 * See BOUNDARY_PIPELINE_AUDIT.md in the scraper repo for the full
 * architecture context.
 */
export const dynamic = 'force-dynamic'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Play, FileJson } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const API_URL = 'https://practical-serenity-production.up.railway.app'

type ProbeResult = {
  success: boolean
  url?: string
  stage_1_acquire?: any
  stage_2_resolve?: any
  stage_3_validate?: any
  elapsed_ms?: number
  note?: string
  error?: string
}

export default function MagicLabPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [url, setUrl] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [history, setHistory] = useState<{ url: string; result: ProbeResult; at: string }[]>([])

  // Auth gate — same pattern as other admin pages
  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }
    ;(async () => {
      try {
        const r = await fetchWithAuth(`${API_URL}/api/auth/me`)
        if (!r.ok) throw new Error('not authed')
        const u = await r.json()
        if (u.account_type !== 'groundgoat_admin' && u.account_type !== 'groundgoat_sales') {
          router.push('/account'); return
        }
        setUser(u)
      } catch {
        router.push('/signin')
      } finally {
        setAuthLoading(false)
      }
    })()
  }, [router])

  const run = async () => {
    const trimmed = url.trim()
    if (!trimmed) return
    if (!/^https?:\/\//i.test(trimmed)) {
      setResult({ success: false, error: 'URL must start with http:// or https://' })
      return
    }
    setRunning(true); setResult(null)
    try {
      const res = await fetch(`${SCRAPER_URL}/api/admin/magic-lab/probe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      })
      const body = await res.json()
      setResult(body)
      setHistory(h => [{ url: trimmed, result: body, at: new Date().toLocaleTimeString() }, ...h].slice(0, 20))
    } catch (e: any) {
      setResult({ success: false, error: e.message || String(e) })
    } finally {
      setRunning(false)
    }
  }

  if (authLoading) return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center">
      <Loader2 size={28} className="animate-spin" />
    </div>
  )
  if (!user) return null

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gg-pink">🧪 Magic Lab</h1>
          <p className="text-gg-gray-400 text-sm mt-1">
            Test the boundary-extraction pipeline against any auction / private-treaty URL.
            Writes nothing to the production database — purely a read-only sandbox for
            iterating on the &quot;find the tract polygon from any URL&quot; problem.
          </p>
        </div>

        <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-4 mb-6">
          <label className="text-xs text-gg-gray-400 uppercase tracking-wider font-semibold">
            Auction / private treaty URL
          </label>
          <div className="flex gap-2 mt-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') run() }}
              placeholder="https://www.trophypa.com/p/0-Wood-Station-Road-Alton-IL-62002/dmgid_171861674"
              className="flex-1 bg-black border border-gg-gray-700 rounded px-3 py-2 text-sm font-mono"
            />
            <button
              onClick={run}
              disabled={running || !url.trim()}
              className="px-4 py-2 bg-gg-pink hover:bg-gg-pink/85 disabled:opacity-50 text-white text-sm font-semibold rounded flex items-center gap-2"
            >
              {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {running ? 'Running…' : 'Run probe'}
            </button>
          </div>
        </div>

        {result && (
          <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <FileJson size={16} className="text-gg-pink" />
              <span className="text-sm font-semibold">Result</span>
              {result.elapsed_ms != null && (
                <span className="text-xs text-gg-gray-400">({result.elapsed_ms}ms)</span>
              )}
              <span className={`ml-auto text-xs px-2 py-0.5 rounded ${
                result.success
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-red-500/20 text-red-300 border border-red-500/40'
              }`}>
                {result.success ? 'success' : 'error'}
              </span>
            </div>
            {result.note && (
              <div className="text-xs text-amber-300/80 bg-amber-500/10 border border-amber-500/30 rounded p-2 mb-3">
                ℹ {result.note}
              </div>
            )}
            <StageBlock title="Stage 1 — Acquire" data={result.stage_1_acquire} />
            <StageBlock title="Stage 2 — Resolve" data={result.stage_2_resolve} />
            <StageBlock title="Stage 3 — Validate" data={result.stage_3_validate} />
            {result.error && (
              <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2 mt-3">
                ✗ {result.error}
              </div>
            )}
            <details className="mt-4">
              <summary className="text-xs text-gg-gray-500 cursor-pointer hover:text-gg-gray-300">
                Raw JSON
              </summary>
              <pre className="text-xs bg-black border border-gg-gray-800 rounded p-3 mt-2 overflow-x-auto font-mono text-gg-gray-300">
{JSON.stringify(result, null, 2)}
              </pre>
            </details>
          </div>
        )}

        {history.length > 0 && (
          <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-4">
            <div className="text-xs text-gg-gray-400 uppercase tracking-wider font-semibold mb-2">
              Recent probes (session only)
            </div>
            <div className="flex flex-col gap-1">
              {history.map((h, i) => (
                <div key={i} className="flex items-center gap-3 text-xs font-mono">
                  <span className="text-gg-gray-500 shrink-0 w-16">{h.at}</span>
                  <span className={`shrink-0 w-12 px-1 rounded text-center ${
                    h.result.success ? 'text-emerald-300' : 'text-red-300'
                  }`}>
                    {h.result.success ? 'OK' : 'FAIL'}
                  </span>
                  <span className="text-gg-gray-300 truncate" title={h.url}>{h.url}</span>
                  <button
                    onClick={() => { setUrl(h.url); setResult(h.result) }}
                    className="ml-auto text-gg-pink hover:underline shrink-0"
                  >
                    re-load
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StageBlock({ title, data }: { title: string; data: any }) {
  if (!data) return null
  const isStub = data._status && String(data._status).startsWith('stub')
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-gg-gray-200">{title}</span>
        {isStub && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gg-gray-800 text-gg-gray-500">
            stub
          </span>
        )}
      </div>
      <pre className="text-xs bg-black border border-gg-gray-800 rounded p-2 overflow-x-auto font-mono text-gg-gray-400">
{JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}
