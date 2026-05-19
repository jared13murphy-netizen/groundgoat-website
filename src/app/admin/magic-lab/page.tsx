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

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Play, FileJson, CheckCircle2, XCircle } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const API_URL = 'https://practical-serenity-production.up.railway.app'

type ProbeResult = {
  success: boolean
  url?: string
  stage_1_acquire?: any
  stage_4_features?: any
  stage_2_resolve?: any
  stage_3_validate?: any
  stage_1c_subpages?: any
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
  // Streaming UX state — each stage shows a pending spinner until its
  // event arrives, then renders the result.
  type StageStatus = 'idle' | 'pending' | 'done' | 'error'
  const [stageStatus, setStageStatus] = useState<Record<string, StageStatus>>({})
  const [streamLog, setStreamLog] = useState<string[]>([])
  const [stage1cSubs, setStage1cSubs] = useState<any[]>([])
  const [subpageProgress, setSubpageProgress] = useState<{i: number; total: number; url?: string} | null>(null)
  const abortRef = useRef<AbortController | null>(null)

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
    // Cancel any in-flight stream
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setRunning(true)
    setResult({ success: true, url: trimmed })  // shell — gets filled in by events
    setStreamLog([`▶ Started probe of ${trimmed}`])
    setStage1cSubs([])
    setSubpageProgress(null)
    setStageStatus({
      '1_acquire': 'pending',
      '4_features': 'pending',
      '2_resolve': 'pending',
      '3_validate': 'pending',
    })
    let cumResult: any = { success: true, url: trimmed, stage_1c_subpages: [] }

    try {
      const res = await fetch(`${SCRAPER_URL}/api/admin/magic-lab/probe-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const blocks = buf.split('\n\n')
        buf = blocks.pop() ?? ''
        for (const block of blocks) {
          if (!block.startsWith('data: ')) continue
          let evt: any
          try { evt = JSON.parse(block.slice(6)) } catch { continue }

          const ts = new Date().toLocaleTimeString()
          if (evt.event === 'started') {
            // already logged
          } else if (evt.event === 'stage_done') {
            const k = evt.stage as string
            setStageStatus(s => ({ ...s, [k]: 'done' }))
            const keyMap: Record<string,string> = {
              '1_acquire': 'stage_1_acquire',
              '4_features': 'stage_4_features',
              '2_resolve': 'stage_2_resolve',
              '3_validate': 'stage_3_validate',
            }
            const cumKey = keyMap[k]
            if (cumKey) {
              cumResult = { ...cumResult, [cumKey]: evt.result }
              setResult({ ...cumResult })
            }
            setStreamLog(l => [...l, `[${ts}] ✓ Stage ${k} done`])
          } else if (evt.event === 'subpage_starting') {
            setSubpageProgress({ i: evt.index, total: evt.total, url: evt.url })
            setStreamLog(l => [...l, `[${ts}] → Sub-page ${evt.index+1}/${evt.total}: ${evt.url}`])
          } else if (evt.event === 'subpage_done') {
            const got = evt.result?.polygon ? '✓ polygon' : (evt.result?.error ? `✗ ${evt.result.error}` : '— no polygon')
            setStage1cSubs(s => {
              const next = [...s]; next[evt.index] = evt.result; return next
            })
            setStreamLog(l => [...l, `[${ts}]   ${got}`])
            cumResult.stage_1c_subpages = [...(cumResult.stage_1c_subpages || [])]
            cumResult.stage_1c_subpages[evt.index] = evt.result
            setResult({ ...cumResult })
          } else if (evt.event === 'stage_promoted') {
            cumResult.stage_2_resolve = evt.stage_2
            cumResult.stage_3_validate = evt.stage_3
            setResult({ ...cumResult })
            setStreamLog(l => [...l, `[${ts}] ↑ Promoted sub-page polygon → stage_2`])
          } else if (evt.event === 'all_done') {
            cumResult.elapsed_ms = evt.elapsed_ms
            cumResult.stage_1c_subpages = evt.stage_1c_subpages
            setResult({ ...cumResult })
            setSubpageProgress(null)
            setStreamLog(l => [...l, `[${ts}] ✓ Complete (${evt.elapsed_ms}ms)`])
          } else if (evt.event === 'subpage_error') {
            setStreamLog(l => [...l, `[${ts}] ✗ Sub-page error: ${evt.error}`])
          }
        }
      }
      setHistory(h => [{ url: trimmed, result: cumResult, at: new Date().toLocaleTimeString() }, ...h].slice(0, 20))
    } catch (e: any) {
      if (e.name === 'AbortError') {
        setStreamLog(l => [...l, `[${new Date().toLocaleTimeString()}] ✗ Aborted`])
      } else {
        setResult({ success: false, error: e.message || String(e) })
        setStreamLog(l => [...l, `[${new Date().toLocaleTimeString()}] ✗ ${e.message || e}`])
      }
    } finally {
      setRunning(false)
      setStageStatus(s => {
        const next = { ...s }
        for (const k of Object.keys(next)) if (next[k] === 'pending') next[k] = 'error'
        return next
      })
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

        {running && streamLog.length > 0 && (
          <div className="bg-black border border-gg-pink/40 rounded-lg p-3 mb-4 max-h-48 overflow-y-auto">
            <div className="text-[10px] text-gg-pink uppercase tracking-wider font-semibold mb-1">
              Live stream {subpageProgress
                ? ` · sub-page ${subpageProgress.i + 1}/${subpageProgress.total}`
                : ''}
            </div>
            <pre className="text-[11px] font-mono text-gg-gray-200 leading-snug whitespace-pre-wrap">
{streamLog.join('\n')}
            </pre>
          </div>
        )}
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
            <StageBlock title="Stage 1 — Acquire" data={result.stage_1_acquire} status={stageStatus['1_acquire']} />
            <StageBlock title="Stage 4 — Features (Claude-extracted)" data={result.stage_4_features} status={stageStatus['4_features']} />
            <StageBlock title="Stage 2 — Resolve" data={result.stage_2_resolve} status={stageStatus['2_resolve']} />
            <StageBlock title="Stage 1c — Sub-page recursion" data={result.stage_1c_subpages} />
            <StageBlock title="Stage 3 — Validate" data={result.stage_3_validate} status={stageStatus['3_validate']} />
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

type StageStatus = 'idle' | 'pending' | 'done' | 'error' | undefined
function StageBlock({ title, data, status }: { title: string; data: any; status?: StageStatus }) {
  const isStub = data?._status && String(data._status).startsWith('stub')
  const isPending = status === 'pending'
  const isError = status === 'error' || data?._status === 'error'
  if (!data && !isPending) return null
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-gg-gray-200">{title}</span>
        {isPending && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
            <Loader2 size={9} className="animate-spin" /> running
          </span>
        )}
        {!isPending && status === 'done' && (
          <CheckCircle2 size={12} className="text-emerald-400" />
        )}
        {!isPending && isError && (
          <XCircle size={12} className="text-red-400" />
        )}
        {isStub && (
          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gg-gray-800 text-gg-gray-500">
            stub
          </span>
        )}
      </div>
      {data ? (
        <pre className="text-xs bg-black border border-gg-gray-800 rounded p-2 overflow-x-auto font-mono text-gg-gray-400">
{JSON.stringify(data, null, 2)}
        </pre>
      ) : isPending ? (
        <div className="text-xs bg-black border border-gg-gray-800 rounded p-2 font-mono text-gg-gray-500 italic">
          waiting for stage to complete…
        </div>
      ) : null}
    </div>
  )
}
