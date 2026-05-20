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
import { Loader2, Play, FileJson, CheckCircle2, XCircle, MapIcon, ImageIcon } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import fetchWithAuth from '@/lib/fetchWithAuth'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const API_URL = 'https://practical-serenity-production.up.railway.app'
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '© Esri, Maxar, Earthstar Geographics'
// Per-tract polygon colors, cycled in order. Same palette as
// /admin/missing-boundaries for consistency across the admin UI.
const TRACT_COLORS = ['#ff3b3b','#3b9fff','#ffd83b','#a83bff','#3bffa8','#ff7a3b','#ff8b3b','#3b3bff']

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

// Server-side recent probes — persisted on the scraper so probes run
// by anyone (the admin, an iterating engineer via curl, CI) show up
// for everyone. Polled every 5s while no probe is running.
type ServerProbe = {
  id: string
  url: string
  at: number
  elapsed_ms: number
  polygon: [number, number][] | null
  all_polygons?: any[] | null
  tract_polygon_matches?: any[] | null
  stage_1c_subpages?: any[] | null
  acres?: number | null
  anchor?: { lat: number; lng: number; source?: string } | null
  expected_acres?: number | null
  expected_state?: string | null
  confidence?: 'high' | 'medium' | 'low' | 'none' | null
  shape_provenance?: 'real_data' | 'pdf_printed_coords' | 'vision_traced' | null
  acreage_match?: 'good' | 'loose' | 'off' | null
  per_tract_validation?: any[] | null
  won_path?: string | null
  won_via?: string | null
  tried_summary?: { path?: string; status?: string }[]
  source_image?: { kind: string; url?: string | null; note?: string; page?: number; via?: string } | null
}

export default function MagicLabPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [url, setUrl] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ProbeResult | null>(null)
  const [history, setHistory] = useState<{ url: string; result: ProbeResult; at: string }[]>([])
  const [serverProbes, setServerProbes] = useState<ServerProbe[]>([])
  const [serverProbesError, setServerProbesError] = useState<string | null>(null)
  const [expandedProbe, setExpandedProbe] = useState<string | null>(null)
  // Streaming UX state — each stage shows a pending spinner until its
  // event arrives, then renders the result.
  type StageStatus = 'idle' | 'pending' | 'done' | 'error'
  const [stageStatus, setStageStatus] = useState<Record<string, StageStatus>>({})
  const [streamLog, setStreamLog] = useState<string[]>([])
  const [stage1cSubs, setStage1cSubs] = useState<any[]>([])
  const [subpageProgress, setSubpageProgress] = useState<{i: number; total: number; url?: string} | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Poll the server-side persisted probe log every 5s (only when no
  // probe is currently in flight, to avoid jitter). Server keeps the
  // last 200 probes; we render the newest 20 here.
  useEffect(() => {
    if (running) return
    let cancelled = false
    const fetchRecent = async () => {
      try {
        const r = await fetch(`${SCRAPER_URL}/api/admin/magic-lab/recent-probes?limit=20`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        if (!cancelled) {
          setServerProbes(Array.isArray(data?.items) ? data.items : [])
          setServerProbesError(null)
        }
      } catch (e: any) {
        if (!cancelled) setServerProbesError(e?.message || String(e))
      }
    }
    fetchRecent()
    const id = setInterval(fetchRecent, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [running])

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

            {/* ▼▼ Visual panels — map + source image ▼▼ */}
            <ResultVisuals result={result} />
            {/* ▲▲ End visual panels ▲▲ */}

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

        {/* Server-side recent probes — visible across sessions / users.
            Updates every 5 seconds when no probe is in flight, so probes
            run via curl by an iterating engineer show up here for human
            review. EVERY probe shows its polygon on a satellite map
            auto-expanded — that's the whole point of this panel. */}
        <div className="bg-gg-gray-900 border-2 border-gg-pink/40 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="text-sm text-gg-pink uppercase tracking-wider font-bold">
              🛰  Live probe stream {serverProbes.length > 0 && `(${serverProbes.length})`}
            </div>
            <span className="text-[11px] text-gg-gray-400">
              {running
                ? '⏸ paused (a probe is running above)'
                : '● auto-refreshes every 5s — polygons shown live below'}
            </span>
            {serverProbesError && (
              <span className="text-[11px] text-red-400 font-mono">
                fetch error: {serverProbesError}
              </span>
            )}
          </div>
          {serverProbes.length === 0 ? (
            <div className="text-sm text-gg-gray-300 italic p-6 text-center border border-dashed border-gg-gray-700 rounded">
              No probes logged yet on the server. Run one above (or wait
              for an engineer to run one via curl) — it will appear here
              within 5 seconds with the polygon rendered on satellite.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {serverProbes.map((p) => {
                const provColor = p.shape_provenance === 'real_data'
                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                  : p.shape_provenance === 'pdf_printed_coords'
                  ? 'text-blue-300 border-blue-500/40 bg-blue-500/10'
                  : p.shape_provenance === 'georef'
                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                  : p.shape_provenance === 'vision_traced'
                  ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                  : 'text-gg-gray-500 border-gg-gray-700 bg-gg-gray-800'
                const confColor = p.confidence === 'high'
                  ? 'text-emerald-300'
                  : p.confidence === 'medium'
                  ? 'text-amber-300'
                  : p.confidence === 'low'
                  ? 'text-red-300'
                  : 'text-gg-gray-500'
                const ts = new Date((p.at || 0) * 1000).toLocaleString()
                const nt = p.tract_polygon_matches?.length || 0
                const hasPoly = !!(p.polygon || (p.all_polygons && p.all_polygons.length)
                                    || (p.tract_polygon_matches && p.tract_polygon_matches.length))
                return (
                  <div key={p.id} className="bg-black border border-gg-gray-800 rounded overflow-hidden">
                    {/* Header row */}
                    <div className="px-3 py-2 border-b border-gg-gray-800 flex items-start gap-3 flex-wrap">
                      <div className="flex flex-col gap-0.5 min-w-[140px]">
                        <span className="text-[10px] text-gg-gray-500">{ts}</span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border w-fit ${provColor}`}>
                          {p.shape_provenance || 'no-source'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                        <a href={p.url} target="_blank" rel="noreferrer"
                          className="text-xs text-gg-pink hover:underline font-mono truncate"
                          title={p.url}>
                          {p.url}
                        </a>
                        <span className="text-[11px] text-gg-gray-400">
                          {p.won_path || 'unresolved'}
                          {p.won_via ? ` · ${p.won_via}` : ''}
                          {p.acres != null ? ` · ${(+p.acres).toFixed(1)}ac` : ''}
                          {p.expected_acres != null ? ` (listing ${(+p.expected_acres).toFixed(1)}ac)` : ''}
                          {nt > 0 ? ` · ${nt} tract${nt > 1 ? 's' : ''}` : ''}
                          {p.elapsed_ms ? ` · ${(p.elapsed_ms / 1000).toFixed(1)}s` : ''}
                        </span>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className={`text-sm font-bold uppercase ${confColor}`}>
                          {p.confidence || '—'}
                        </span>
                        {p.acreage_match && (
                          <span className="text-[10px] text-gg-gray-500">{p.acreage_match}</span>
                        )}
                      </div>
                    </div>
                    {/* Map + source image — ALWAYS VISIBLE */}
                    {hasPoly ? (
                      <div className="p-2">
                        <ResultVisuals result={{
                          success: true,
                          stage_2_resolve: {
                            polygon: p.polygon,
                            all_polygons: p.all_polygons,
                            tract_polygon_matches: p.tract_polygon_matches,
                            tried: (p.tried_summary || []).map(t => ({
                              path: t.path, status: t.status,
                              detail: p.source_image && t.path === p.won_path
                                ? { url: p.source_image.url, page: p.source_image.page,
                                    via: p.source_image.via, kind: p.source_image.kind,
                                    anchor_source: p.anchor?.source }
                                : {},
                            })),
                          },
                          stage_1c_subpages: p.stage_1c_subpages,
                        }} />
                      </div>
                    ) : (
                      <div className="p-4 text-xs text-amber-300 italic">
                        ⚠ No polygon was produced — the probe ran but Stage 2
                        couldn&apos;t find a boundary (no usable PDF, no aerial
                        with anchor, no Land ID hash, oblique image). The
                        listing needs a different acquisition strategy or
                        manual review.
                      </div>
                    )}
                    {/* Per-tract validation */}
                    {p.per_tract_validation && p.per_tract_validation.length > 0 && (
                      <div className="px-3 py-2 border-t border-gg-gray-800 text-[11px] font-mono">
                        {p.per_tract_validation.map((v, i) => (
                          <div key={i} className={
                            v.match === 'good' ? 'text-emerald-300'
                            : v.match === 'loose' ? 'text-amber-300'
                            : 'text-gg-gray-400'
                          }>
                            T{v.tract_number}: tract={v.tract_acres}ac ·
                            poly={v.polygon_acres ?? '—'}ac
                            {v.diff_pct != null ? ` (${v.diff_pct}% off)` : ''} · {v.match || v.status}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

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


// =============================================================================
// ResultVisuals — renders polygons on a satellite map + shows the source
// image (PDF page / aerial / etc.) that Stage 2 used to derive each polygon.
// =============================================================================

type PolyEntry = {
  polygon: [number, number][]
  label: string
  acres?: number | null
  color: string
  source?: string
}

function extractPolygons(result: any): PolyEntry[] {
  if (!result) return []
  const out: PolyEntry[] = []
  const s2 = result.stage_2_resolve || {}
  let idx = 0

  // Multi-tract matches take priority — each tract gets its own labeled polygon
  const matches = s2.tract_polygon_matches
  if (Array.isArray(matches) && matches.length > 0) {
    for (const m of matches) {
      if (m && Array.isArray(m.polygon) && m.polygon.length >= 3) {
        out.push({
          polygon: m.polygon as [number, number][],
          label: `T${m.tract_number ?? '?'}`,
          acres: m.polygon_acres ?? m.tract_acres,
          color: TRACT_COLORS[(m.tract_number ?? idx) % TRACT_COLORS.length],
          source: `match: ${m.matched_via}`,
        })
        idx++
      }
    }
    if (out.length > 0) return out
  }

  // Primary polygon
  if (Array.isArray(s2.polygon) && s2.polygon.length >= 3) {
    out.push({
      polygon: s2.polygon as [number, number][],
      label: 'Primary',
      acres: s2.acres,
      color: TRACT_COLORS[0],
      source: 'stage_2.polygon',
    })
  }
  // Other polygons (multi-tract land_id without matching)
  if (Array.isArray(s2.all_polygons)) {
    s2.all_polygons.forEach((p: any, i: number) => {
      if (p && Array.isArray(p.polygon) && p.polygon.length >= 3
          && JSON.stringify(p.polygon) !== JSON.stringify(s2.polygon)) {
        out.push({
          polygon: p.polygon as [number, number][],
          label: p.name || `Poly ${i + 1}`,
          acres: p.acres,
          color: TRACT_COLORS[(i + 1) % TRACT_COLORS.length],
          source: `all_polygons[${i}]`,
        })
      }
    })
  }
  // Sub-page polygons
  const subs = result.stage_1c_subpages
  if (Array.isArray(subs)) {
    subs.forEach((s: any, i: number) => {
      if (s && Array.isArray(s.polygon) && s.polygon.length >= 3) {
        const hint = s.hint || {}
        const tn = hint.tract_hint?.tract_number
        out.push({
          polygon: s.polygon as [number, number][],
          label: tn ? `T${tn}` : `Sub ${i + 1}`,
          acres: s.acres,
          color: TRACT_COLORS[(tn ?? out.length + i) % TRACT_COLORS.length],
          source: 'sub-page',
        })
      }
    })
  }
  return out
}

function extractSourceImage(result: any): { url: string; kind: string; note?: string } | null {
  const s2 = result?.stage_2_resolve
  if (!s2) return null
  const triedOk = (s2.tried || []).filter((t: any) => t.status === 'OK')
  if (triedOk.length === 0) return null
  const last = triedOk[triedOk.length - 1]
  const detail = last.detail || {}
  if (last.path === 'pdf_vision') {
    return { url: detail.url, kind: 'pdf',
      note: `PDF page ${detail.page ?? '?'} via ${detail.via ?? 'vision'}` }
  }
  if (last.path === 'vision_aerial') {
    return { url: detail.url, kind: 'aerial',
      note: `${detail.vertices ?? '?'} vertices · ${detail.anchor_source ?? 'unknown anchor'}` }
  }
  if (last.path === 'land_id_hash') {
    return { url: '', kind: 'land_id',
      note: `Land ID hash: ${detail.hash ?? '?'} (no source image — polygon came from API)` }
  }
  if (last.path === 'js_array_literal') {
    return { url: '', kind: 'js',
      note: 'Polygon extracted from page JavaScript — no source image' }
  }
  return null
}

function ResultVisuals({ result }: { result: any }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const polys = extractPolygons(result)
  const srcImg = extractSourceImage(result)
  const hasMap = polys.length > 0

  useEffect(() => {
    if (!hasMap || !containerRef.current) return
    let minLng = Infinity, maxLng = -Infinity
    let minLat = Infinity, maxLat = -Infinity
    for (const p of polys) {
      for (const [lng, lat] of p.polygon) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: { version: 8,
        sources: { imagery: { type: 'raster', tiles: [TILE_URL], tileSize: 256,
                              attribution: TILE_ATTRIBUTION } },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
      },
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      zoom: 12, attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.on('load', () => {
      for (let i = 0; i < polys.length; i++) {
        const p = polys[i]
        const id = `poly_${i}`
        map.addSource(id, {
          type: 'geojson',
          data: { type: 'Feature', properties: { label: p.label },
            geometry: { type: 'Polygon',
                        coordinates: [[...p.polygon, p.polygon[0]]] } } as any,
        })
        map.addLayer({ id: `${id}_fill`, type: 'fill', source: id,
          paint: { 'fill-color': p.color, 'fill-opacity': 0.18 } })
        map.addLayer({ id: `${id}_line`, type: 'line', source: id,
          paint: { 'line-color': p.color, 'line-width': 2.5 } })
      }
      try {
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]],
          { padding: 40, duration: 0, maxZoom: 16 })
      } catch {}
    })
    return () => { try { map.remove() } catch {}; mapRef.current = null }
  }, [hasMap, JSON.stringify(polys.map(p => p.polygon[0]))])

  if (!hasMap && !srcImg) {
    return (
      <div className="mb-3 p-3 bg-black border border-gg-gray-800 rounded text-xs text-gg-gray-500 italic">
        No polygon resolved yet — nothing to render on the map.
      </div>
    )
  }

  return (
    <div className="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <MapIcon size={14} className="text-gg-pink" />
          <span className="text-xs font-semibold text-gg-gray-200">
            Polygons {polys.length > 0 && `(${polys.length})`}
          </span>
          {polys.length > 0 && (
            <div className="flex flex-wrap gap-1 ml-auto">
              {polys.map((p, i) => (
                <span key={i} className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: p.color + '33', color: p.color,
                           border: `1px solid ${p.color}88` }}>
                  {p.label}{p.acres != null && ` · ${(+p.acres).toFixed(1)}ac`}
                </span>
              ))}
            </div>
          )}
        </div>
        {hasMap ? (
          <div ref={containerRef} className="rounded border border-gg-gray-800 bg-black"
            style={{ width: '100%', height: 360 }} />
        ) : (
          <div className="rounded border border-gg-gray-800 bg-black p-4 text-xs text-gg-gray-500 italic">
            No polygon to render.
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <ImageIcon size={14} className="text-gg-pink" />
          <span className="text-xs font-semibold text-gg-gray-200">Source</span>
          {srcImg?.kind && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-gg-gray-800 text-gg-gray-400">
              {srcImg.kind}
            </span>
          )}
        </div>
        {srcImg ? (
          <div className="rounded border border-gg-gray-800 bg-black flex flex-col"
            style={{ minHeight: 360 }}>
            {srcImg.url && srcImg.kind === 'aerial' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={srcImg.url} alt="source aerial"
                className="object-contain max-h-[340px] w-full" />
            ) : srcImg.url && srcImg.kind === 'pdf' ? (
              <div className="p-4 flex flex-col gap-2">
                <p className="text-xs text-gg-gray-300">{srcImg.note}</p>
                <a href={srcImg.url} target="_blank" rel="noreferrer"
                  className="text-xs text-gg-pink underline break-all">
                  {srcImg.url}
                </a>
                <p className="text-[11px] text-gg-gray-500 italic">
                  PDF preview not embedded — open the link to inspect.
                </p>
              </div>
            ) : (
              <div className="p-4 text-xs text-gg-gray-400">{srcImg.note}</div>
            )}
          </div>
        ) : (
          <div className="rounded border border-gg-gray-800 bg-black p-4 text-xs text-gg-gray-500 italic"
            style={{ minHeight: 360 }}>
            No source image — polygon came from page data (Land ID API,
            JS array, etc.) without a visual reference.
          </div>
        )}
      </div>
    </div>
  )
}
