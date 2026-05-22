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
// Per-tract polygon colors. Primary (first / single-tract) is pink
// per user 2026-05-21. Subsequent tracts cycle through contrasting
// colors so multi-tract listings stay distinguishable.
const TRACT_COLORS = ['#ff3bd6','#3b9fff','#ffd83b','#a83bff','#3bffa8','#ff7a3b','#ff8b3b','#3b3bff']

type ProbeResult = {
  success: boolean
  url?: string
  stage_1_acquire?: any
  stage_4_features?: any
  stage_2_resolve?: any
  stage_3_validate?: any
  stage_1c_subpages?: any
  stage_5_tillable?: any
  merged_features?: any
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
  // Stage 4 detected this many tracts on the listing. When the
  // polygon count comes back smaller, the scraper produced an
  // incomplete result and the UI flags it as MISSING.
  expected_tract_count?: number | null
  is_multi_tract_listing?: boolean
  stage_1c_subpages?: any[] | null
  acres?: number | null
  anchor?: { lat: number; lng: number; source?: string } | null
  expected_acres?: number | null
  expected_state?: string | null
  confidence?: 'high' | 'medium' | 'low' | 'none' | null
  shape_provenance?: 'real_data' | 'pdf_printed_coords' | 'vision_traced' | 'georef' | 'parcel_db' | null
  acreage_match?: 'good' | 'loose' | 'off' | null
  per_tract_validation?: any[] | null
  won_path?: string | null
  won_via?: string | null
  tried_summary?: { path?: string; status?: string }[]
  source_image?: { kind: string; url?: string | null; note?: string; page?: number; via?: string;
                   hash?: string; image_b64?: string; image_media_type?: string;
                   // Server-rendered polygon over Esri satellite. ALWAYS present
                   // when Stage 2 produced any polygon — bulletproof comparison
                   // image immune to X-Frame-blocking, dead URLs, etc.
                   polygon_render_b64?: string;
                   polygon_render_media_type?: string;
                   polygon_render_note?: string } | null
  // Stage 5 — tillable polygons (USDA CSB) + state-specific soil rating.
  stage_5_tillable?: {
    tracts?: Array<{
      tract_label?: string
      tract_acres?: number | null
      tillable_acres?: number | null
      tillable_fraction?: number | null
      field_count?: number | null
      tillable_polygons?: [number, number][][]
      fields?: any[]
      soil_rating?: {
        rating?: number | null
        scale?: string | null
        info?: string | null
        _error?: string | null
      }
      // CLASSIFIER COMPARISON — per-tract per-classifier polygon
      // sets. As of 2026-05-22, three classifiers run per tract:
      //   - hybrid: WC outline + CDL crop labels + NLCD trees + NHD
      //     water. New primary tillable shape.
      //   - cdl: USDA 30m, raw per-crop classifications
      //   - worldcover: ESA 10m, raw per-class classifications
      // Each is a complete classification with a tillable flag per
      // polygon. The UI's tillable-source toggle lets the admin
      // compare visually against satellite imagery.
      classifier_comparison?: {
        hybrid?: {
          polygons?: Array<{
            polygon: [number, number][]
            wc_class: number
            class_name: string
            tillable: boolean
            acres: number
            source?: string  // "ssurgo_lcc" | "cdl" | "nlcd" | "nhd" | "io_lulc" | "wc"
            lcc?: number | null         // SSURGO Land Capability Class 1-8
            lcc_sub?: string | null     // SSURGO LCC subclass letter (e/w/s/c)
            muname?: string | null      // SSURGO soil unit name
          }>
          tract_acres?: number | null
          tillable_acres?: number | null
          non_tillable_acres?: number | null
          by_source?: Record<string, number>
          by_lcc?: Record<string, number>
          base_source?: string  // "ssurgo_lcc" | "io_lulc" | "wc"
          _layer_errors?: Record<string, string | null>
          _error?: string | null
        } | null
        io_lulc?: {
          polygons?: Array<{
            polygon: [number, number][]
            wc_class: number
            class_name: string
            tillable: boolean
            acres: number
          }>
          tract_acres?: number | null
          tillable_acres?: number | null
          non_tillable_acres?: number | null
          year?: number | null
          _error?: string | null
        } | null
        cdl?: {
          polygons?: Array<{
            polygon: [number, number][]
            cdl_class: number
            class_name: string
            tillable: boolean
            acres: number
          }>
          tract_acres?: number | null
          tillable_acres?: number | null
          non_tillable_acres?: number | null
          _error?: string | null
        } | null
        worldcover?: {
          polygons?: Array<{
            polygon: [number, number][]
            wc_class: number
            class_name: string
            tillable: boolean
            acres: number
          }>
          tract_acres?: number | null
          tillable_acres?: number | null
          non_tillable_acres?: number | null
          year?: number | null
          _error?: string | null
        } | null
      }
      _error?: string | null
    }>
    _error?: string | null
  } | null
  // Subset of Stage 4 merged features persisted so the UI can show
  // listing-stated values (soil_rating, tillable_acres) without
  // re-querying Stage 4.
  merged_features?: {
    total_acres?: number | null
    tracts?: Array<{
      number?: number | null
      name?: string | null
      acres?: number | null
      tillable_acres?: number | null
      soil_rating?: number | null
      soil_rating_scale?: string | null
    }>
    soil_rating?: number | null
    soil_rating_scale?: string | null
    state?: string | null
    county?: string | null
  } | null
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
              '5_tillable': 'stage_5_tillable',
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
            <StageBlock title="Stage 5 — Tillable polygons + soil rating (USDA CSB + SSURGO)" data={result.stage_5_tillable} status={stageStatus['5_tillable']} />
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
            {/* Clear-all button — wipes every persisted probe so the
                admin can start fresh between test runs. */}
            {serverProbes.length > 0 && (
              <button
                onClick={async () => {
                  if (!confirm(`Delete all ${serverProbes.length} probes? This cannot be undone.`)) return
                  try {
                    const resp = await fetchWithAuth(
                      `${SCRAPER_URL}/api/admin/magic-lab/clear-probes`,
                      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
                    )
                    if (!resp.ok) {
                      alert(`Clear failed: HTTP ${resp.status}`)
                      return
                    }
                    setServerProbes([])
                  } catch (e: any) {
                    alert(`Clear failed: ${e?.message || e}`)
                  }
                }}
                className="ml-auto text-[11px] text-red-300 hover:text-red-200 border border-red-500/40 rounded px-2 py-0.5 hover:bg-red-500/10"
                title="Wipe all probes from the server — useful between test runs"
              >
                Clear all probes
              </button>
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
                const provColor = p.shape_provenance === 'parcel_db'
                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                  : p.shape_provenance === 'georef'
                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                  : p.shape_provenance === 'real_data'
                  ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                  : p.shape_provenance === 'pdf_printed_coords'
                  ? 'text-blue-300 border-blue-500/40 bg-blue-500/10'
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
                // How many polygons did Stage 2 actually return (with
                // a non-null polygon field)? Used to flag listings
                // where the scraper KNOWS there are N tracts but
                // produced fewer polygons — those are wrong by
                // definition. farmersnational 2026-05-20: 3-tract
                // listing returned 2 polygons → display "2 / 3
                // tracts" so user knows we're short.
                const npResolved = (p.tract_polygon_matches || [])
                  .filter((m: any) => m && m.polygon).length
                const expectedTracts = (p as any).expected_tract_count
                  ?? nt
                const tractCountMismatch =
                  expectedTracts > 1 && npResolved < expectedTracts
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
                          {expectedTracts > 1 ? (
                            <span className={tractCountMismatch ? 'text-red-400 font-bold' : ''}>
                              {' · '}{npResolved} / {expectedTracts} tracts
                              {tractCountMismatch ? ' ⚠ MISSING' : ''}
                            </span>
                          ) : nt > 0 ? ` · ${nt} tract${nt > 1 ? 's' : ''}` : ''}
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
                                    note: p.source_image.note,
                                    hash: p.source_image.hash,
                                    image_b64: p.source_image.image_b64,
                                    image_media_type: p.source_image.image_media_type,
                                    polygon_render_b64: p.source_image.polygon_render_b64,
                                    polygon_render_media_type: p.source_image.polygon_render_media_type,
                                    polygon_render_note: p.source_image.polygon_render_note,
                                    anchor_source: p.anchor?.source }
                                : {},
                            })),
                          },
                          stage_1c_subpages: p.stage_1c_subpages,
                          stage_5_tillable: p.stage_5_tillable,
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
                    {/* Stage 5 — per-tract tillable + soil rating, ours vs listing */}
                    {p.stage_5_tillable?.tracts?.length ? (
                      <div className="px-3 py-2 border-t border-gg-gray-800 text-[11px] font-mono">
                        {p.stage_5_tillable.tracts.map((tr: any, i: number) => {
                          const sr = tr?.soil_rating || {}
                          const merged = p.merged_features || {}
                          const tracts4 = merged.tracts || []
                          const listingTract = (tracts4[i] || {}) as any
                          const listingRating = listingTract.soil_rating
                                                ?? merged.soil_rating
                          const listingScale = listingTract.soil_rating_scale
                                                ?? merged.soil_rating_scale
                          const ours = sr.rating
                          const oursScale = sr.scale
                          const diff = (ours != null && listingRating != null)
                                       ? (ours - +listingRating) : null
                          return (
                            <div key={i} className="text-cyan-300">
                              {tr.tract_label || `T${i+1}`}:
                              {' '}tillable={tr.tillable_acres ?? '—'}ac
                              {' / '}{tr.tract_acres ?? '—'}ac
                              {tr.tillable_fraction != null
                                ? ` (${(+tr.tillable_fraction*100).toFixed(0)}%)`
                                : ''}
                              {' · '}fields={tr.field_count ?? 0}
                              {(ours != null || listingRating != null) && (
                                <span className="ml-2">
                                  soil: ours={ours != null ? (+ours).toFixed(1) : '—'}{oursScale ? ` ${oursScale}` : ''}
                                  {' · '}listing={listingRating != null ? (+listingRating).toFixed(1) : '—'}{listingScale ? ` ${listingScale}` : ''}
                                  {diff != null ? (
                                    <span className={Math.abs(diff) > 5 ? 'text-amber-300' : 'text-emerald-300'}>
                                      {' '}(Δ {diff > 0 ? '+' : ''}{diff.toFixed(1)})
                                    </span>
                                  ) : null}
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
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
  // Collapsed by default — the raw stage JSON is admin debug output,
  // not the primary result. The map + classifier panels above carry
  // the actual signal. Click the header to expand for inspection.
  return (
    <details className="mb-2 last:mb-0 group">
      <summary className="cursor-pointer flex items-center gap-2 list-none select-none hover:bg-gg-gray-900 rounded px-1 py-0.5">
        <svg className="w-3 h-3 text-gg-gray-500 transition-transform group-open:rotate-90"
             viewBox="0 0 12 12" fill="currentColor">
          <path d="M4 2 L4 10 L9 6 Z" />
        </svg>
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
      </summary>
      <div className="mt-1">
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
    </details>
  )
}


// =============================================================================
// ResultVisuals — renders polygons on a satellite map + shows the source
// image (PDF page / aerial / etc.) that Stage 2 used to derive each polygon.
// =============================================================================

type PolyEntry = {
  polygon: [number, number][]
  // Optional inner rings to cut out of `polygon` (donut/polygon-with-holes).
  // Set by the scraper when one tract polygon is nested inside another —
  // e.g. wmgauction's 235ac tract 1 with a 5ac tract 2 inside it. Each
  // hole is rendered as a transparent cutout in the outer fill.
  holes?: [number, number][][]
  label: string
  acres?: number | null
  color: string
  source?: string
}

type TillableSource = 'ssurgo' | 'hybrid' | 'io_lulc' | 'cdl' | 'worldcover'

// CDL class-code buckets per USDA NASS metadata.
// https://www.nass.usda.gov/Research_and_Science/Cropland/sarsfaqs2.php
const CDL_HAY_CODES = new Set([36, 37, 58, 59])  // Alfalfa, Other Hay, Clover, Sod/Grass
const CDL_FALLOW_CODES = new Set([61])
const CDL_PASTURE_CODES = new Set([176])  // Grass/Pasture (includes CRP)

// Land-use color palette — distinct, high-contrast, holds up over
// satellite imagery. Keep these in sync with the legend below the
// map (LegendSwatch list).
const COLOR_CROPLAND = '#22d3ee'   // cyan — active row crops
const COLOR_PASTURE = '#84cc16'    // lime — grass / pasture / CRP
const COLOR_HAY = '#fbbf24'        // gold — hay / alfalfa
const COLOR_FALLOW = '#a8a29e'     // tan — fallow / idle
const COLOR_TREES = '#dc2626'      // red — forest / tree canopy
const COLOR_WATER = '#3b82f6'      // blue — ponds / streams / wetlands
const COLOR_BUILT = '#f97316'      // orange — buildings / driveways

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-gg-gray-300">
      <span className="inline-block w-3 h-3 rounded"
        style={{ backgroundColor: color + '88',
                 border: `1.5px solid ${color}` }} />
      {label}
    </span>
  )
}

function pickClassColor(
  key: 'hybrid' | 'cdl' | 'worldcover' | 'io_lulc',
  p: any,
): string {
  // Source-based routing for hybrid's non-tillable polygons — NHD /
  // NLCD / SSURGO LCC / base classifier each get their own color
  // regardless of class code (since codes differ across datasets).
  if (key === 'hybrid' && !p.tillable) {
    const src = (p.source || '').toString()
    if (src === 'nhd') return COLOR_WATER
    if (src === 'nlcd') return COLOR_TREES
    if (src === 'ssurgo_lcc') {
      // SSURGO LCC 5-8 — route by subclass letter.
      // w = wet (waterway, ponded depression) → blue-ish water tone
      // e = erodible (steep slopes)             → brown / orange
      // s = stony / shallow                      → tan
      // c = climate-limited (cold / dry)         → tan
      const sub = ((p.lcc_sub || '').toString().toLowerCase())[0]
      if (sub === 'w') return COLOR_WATER
      if (sub === 'e') return COLOR_BUILT     // brown-ish orange
      if (sub === 's' || sub === 'c') return COLOR_FALLOW
      return COLOR_TREES  // unknown subclass → treat as non-till red
    }
    if (src === 'io_lulc' || src === 'wc') {
      const cls = Number(p.wc_class ?? 0)
      // io-lulc codes
      if (cls === 1) return COLOR_WATER       // io-lulc Water
      if (cls === 2) return COLOR_TREES       // io-lulc Trees
      if (cls === 4) return COLOR_WATER       // io-lulc Flooded Veg
      if (cls === 7) return COLOR_BUILT       // io-lulc Built
      if (cls === 8) return COLOR_FALLOW      // io-lulc Bare Ground
      // WC codes
      if (cls === 10) return COLOR_TREES      // WC Trees
      if (cls === 80) return COLOR_WATER      // WC Water
      return COLOR_BUILT
    }
  }
  // Cultivated Layer cropland (LCC 1-4 ∩ USDA Cultivated). USDA
  // says it's been row-cropped in 2+ of last 5 years → cyan, even
  // if the current year is in cover crop / CRP.
  if (key === 'hybrid' && p.tillable
      && (p.source === 'cultivated' || p.wc_class === -200)) {
    return COLOR_CROPLAND
  }
  // SSURGO LCC 1-4 area NOT in Cultivated Layer = pasture/grass.
  if (key === 'hybrid' && p.tillable
      && (p.source === 'ssurgo_lcc')) {
    return COLOR_PASTURE
  }
  if (!p.tillable) return COLOR_TREES  // fallback non-tillable

  // Tillable polygons: sub-category by class code. The class code
  // space depends on which dataset emitted the polygon — io-lulc
  // uses 5/11, CDL uses 1-176, WC uses 30/40.
  if (key === 'worldcover') {
    const cls = Number(p.wc_class ?? 0)
    if (cls === 40) return COLOR_CROPLAND  // Cropland
    if (cls === 30) return COLOR_PASTURE   // Grassland (lumps everything)
    return COLOR_CROPLAND
  }
  if (key === 'io_lulc') {
    const cls = Number(p.wc_class ?? 0)
    if (cls === 5) return COLOR_CROPLAND   // io-lulc Crops
    if (cls === 11) return COLOR_PASTURE   // io-lulc Rangeland
    return COLOR_CROPLAND
  }
  // Hybrid or CDL: io-lulc Rangeland (11) is fallback for tillable
  // areas with no CDL label, so check that first; otherwise use CDL
  // category routing.
  const cls = Number(p.wc_class ?? p.cdl_class ?? 0)
  if (cls === 11) return COLOR_PASTURE   // io-lulc Rangeland fallback
  if (cls === 5) return COLOR_CROPLAND   // io-lulc Crops fallback
  if (CDL_HAY_CODES.has(cls)) return COLOR_HAY
  if (CDL_PASTURE_CODES.has(cls)) return COLOR_PASTURE
  if (CDL_FALLOW_CODES.has(cls)) return COLOR_FALLOW
  return COLOR_CROPLAND  // CDL row crops 1-60, default
}

function extractPolygons(
  result: any,
  tillableSource: TillableSource = 'ssurgo',
): PolyEntry[] {
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
          holes: (Array.isArray(m.holes) ? m.holes : undefined) as
                  [number, number][][] | undefined,
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

  // Primary polygon. If the server's donut subtraction added HOLES
  // to a matching entry in all_polygons (outer with inner cut out),
  // attach them here so the primary renders as a donut and the inner
  // tract doesn't visually overlap.
  if (Array.isArray(s2.polygon) && s2.polygon.length >= 3) {
    let primaryHoles: [number, number][][] | undefined
    if (Array.isArray(s2.all_polygons)) {
      const primaryKey = JSON.stringify(s2.polygon)
      const m = s2.all_polygons.find(
        (p: any) => Array.isArray(p?.polygon)
          && JSON.stringify(p.polygon) === primaryKey
          && Array.isArray(p?.holes) && p.holes.length > 0
      )
      if (m) primaryHoles = m.holes
    }
    out.push({
      polygon: s2.polygon as [number, number][],
      holes: primaryHoles,
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
          holes: (Array.isArray(p.holes) ? p.holes : undefined) as
                  [number, number][][] | undefined,
          label: p.name || `Poly ${i + 1}`,
          acres: p.acres,
          color: TRACT_COLORS[(i + 1) % TRACT_COLORS.length],
          source: `all_polygons[${i}]`,
        })
      }
    })
  }
  // Stage 5 — tillable polygons. The user can toggle between three
  // sources via the tillable-source switch above the map:
  //   ssurgo     — current path: CSB+NAIP refined → SSURGO clipped
  //   cdl        — USDA Cropland Data Layer (30m raster, per-class)
  //   worldcover — ESA WorldCover (10m raster, per-class)
  // CDL / WorldCover render both TILLABLE (cyan) and NON-TILLABLE
  // (dark red @ low opacity) so the user sees what each classifier
  // excluded inside the tract, with class-name labels.
  const s5 = result.stage_5_tillable
  if (s5 && Array.isArray(s5.tracts)) {
    if (tillableSource === 'ssurgo') {
      s5.tracts.forEach((t: any, ti: number) => {
        const polys = Array.isArray(t?.tillable_polygons) ? t.tillable_polygons : []
        polys.forEach((p: any, pi: number) => {
          if (Array.isArray(p) && p.length >= 3) {
            out.push({
              polygon: p as [number, number][],
              label: `Tillable ${t.tract_label || `T${ti+1}`}${polys.length > 1 ? ` (${pi+1})` : ''}`,
              acres: undefined,
              color: '#22d3ee',  // cyan
              source: 'csb_tillable',
            })
          }
        })
      })
    } else {
      // hybrid / CDL / WorldCover — read classifier_comparison per
      // tract, emit one PolyEntry per class polygon with class-name
      // label. Color-coded by land-use category, not just tillable
      // boolean, so the user can visually distinguish cropland from
      // grass / hay / pasture across all views. Per user feedback
      // 2026-05-22: "I need grassland to be a separate color than
      // cropland."
      const key = tillableSource as 'hybrid' | 'io_lulc' | 'cdl' | 'worldcover'
      s5.tracts.forEach((t: any, ti: number) => {
        const cc = t?.classifier_comparison?.[key]
        const polys = Array.isArray(cc?.polygons) ? cc.polygons : []
        polys.forEach((p: any) => {
          const ring = p?.polygon
          if (!Array.isArray(ring) || ring.length < 3) return
          const color = pickClassColor(key, p)
          const tractTag = s5.tracts.length > 1
            ? ` · ${t.tract_label || `T${ti+1}`}` : ''
          out.push({
            polygon: ring as [number, number][],
            label: `${p.class_name}${tractTag}`,
            acres: p.acres,
            color,
            source: `${key}_${p.tillable ? 'tillable' : 'nontill'}`,
          })
        })
      })
    }
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
  // PRIORITY 1: an actual SCREENSHOT/RASTER of the source the system
  // used to build the polygon (PDF page, Land ID embed snapshot,
  // brochure aerial). This is what the user wants on the right pane —
  // visual proof of what we pulled from the listing. Per user
  // 2026-05-21: "I need to see what you are using from the auction or
  // PT url, not a screenshot of your own created polygon."
  if (detail.image_b64) {
    let kind = 'source_image'
    let note = 'Source page used to build the polygon — compare to ours on the left.'
    if (last.path === 'pdf_vision' || detail.kind === 'pdf') {
      kind = 'pdf_image'
      note = `PDF page ${detail.page ?? '?'} — what we read to build the polygon.`
    } else if (last.path === 'land_id_hash' || detail.kind === 'land_id') {
      kind = 'land_id_image'
      note = `Land ID viewer snapshot (hash ${(detail.hash || '').slice(0, 8)}…) — compare to our polygon on the left.`
    }
    return {
      url: `data:${detail.image_media_type || 'image/jpeg'};base64,${detail.image_b64}`,
      kind,
      note,
    }
  }
  // PRIORITY 2: a source URL we could iframe (only useful when the
  // target server doesn't set X-Frame-Options DENY).
  if (last.path === 'pdf_vision' && detail.url) {
    return { url: detail.url, kind: 'pdf',
      note: `PDF page ${detail.page ?? '?'} via ${detail.via ?? 'vision'}` }
  }
  if (last.path === 'vision_aerial' && detail.url) {
    return { url: detail.url, kind: 'aerial',
      note: `${detail.vertices ?? '?'} vertices · ${detail.anchor_source ?? 'unknown anchor'}` }
  }
  if (last.path === 'land_id_hash' && !detail.image_b64) {
    return { url: '', kind: 'land_id',
      note: `Land ID hash: ${detail.hash ?? '?'} (screenshot not captured)` }
  }
  if (last.path === 'js_array_literal') {
    return { url: '', kind: 'js',
      note: 'Polygon extracted from page JavaScript — no source image' }
  }
  // Trust server's source_image hint for paths not enumerated above
  // (regrid_parcel_lookup, parcel_db_lookup, per_tract_union, etc.)
  if (detail.url && detail.kind) {
    return { url: detail.url, kind: detail.kind, note: detail.note }
  }
  // PRIORITY 3 (LAST RESORT): our own polygon-over-satellite render.
  // Only shown when no actual source image is available. Labelled
  // clearly so the user knows it's our output, not the listing's.
  if (detail.polygon_render_b64) {
    return {
      url: `data:${detail.polygon_render_media_type || 'image/jpeg'};base64,${detail.polygon_render_b64}`,
      kind: 'polygon_render',
      note: 'No source image available — showing our polygon over satellite for visual reference (this is OUR output, not from the listing).',
    }
  }
  return null
}

function ResultVisuals({ result }: { result: any }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Per-instance toggle for which Stage-5 tillable source to render.
  // Each ResultVisuals (top result + each live-probe row) holds its
  // own selection — small footprint, no global state required.
  // Default to hybrid (WC + CDL + NLCD + NHD) — the 2026-05-22
  // primary. Falls back behind the toggle if user wants raw views.
  const [tillableSource, setTillableSource] = useState<TillableSource>('hybrid')
  const polys = extractPolygons(result, tillableSource)
  const srcImg = extractSourceImage(result)
  const hasMap = polys.length > 0

  // Per-classifier summary for the breakdown panel under the map.
  const s5Tracts = result?.stage_5_tillable?.tracts || []
  const compHasHybrid = s5Tracts.some(
    (t: any) => t?.classifier_comparison?.hybrid && !t.classifier_comparison.hybrid._error,
  )
  const compHasIoLulc = s5Tracts.some(
    (t: any) => t?.classifier_comparison?.io_lulc && !t.classifier_comparison.io_lulc._error,
  )
  const compHasCdl = s5Tracts.some(
    (t: any) => t?.classifier_comparison?.cdl && !t.classifier_comparison.cdl._error,
  )
  const compHasWc = s5Tracts.some(
    (t: any) => t?.classifier_comparison?.worldcover && !t.classifier_comparison.worldcover._error,
  )
  const ssurgoTotal = s5Tracts.reduce(
    (s: number, t: any) => s + (Number(t?.tillable_acres) || 0), 0,
  )
  const hybridTotal = s5Tracts.reduce(
    (s: number, t: any) => s + (Number(t?.classifier_comparison?.hybrid?.tillable_acres) || 0), 0,
  )
  const ioLulcTotal = s5Tracts.reduce(
    (s: number, t: any) => s + (Number(t?.classifier_comparison?.io_lulc?.tillable_acres) || 0), 0,
  )
  const cdlTotal = s5Tracts.reduce(
    (s: number, t: any) => s + (Number(t?.classifier_comparison?.cdl?.tillable_acres) || 0), 0,
  )
  const wcTotal = s5Tracts.reduce(
    (s: number, t: any) => s + (Number(t?.classifier_comparison?.worldcover?.tillable_acres) || 0), 0,
  )

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
        // GeoJSON Polygon coordinates: first ring is the outer boundary,
        // each subsequent ring is a HOLE (cut out of the fill). When the
        // scraper detected one tract polygon nested inside another, the
        // nested tract is delivered here as a hole on the outer tract's
        // p.holes — so the fill draws as a donut with the inner tract
        // as a transparent cutout.
        const rings: [number, number][][] = [[...p.polygon, p.polygon[0]]]
        if (Array.isArray(p.holes)) {
          for (const h of p.holes) {
            if (Array.isArray(h) && h.length >= 3) {
              rings.push([...h, h[0]])
            }
          }
        }
        map.addSource(id, {
          type: 'geojson',
          data: { type: 'Feature', properties: { label: p.label },
            geometry: { type: 'Polygon', coordinates: rings } } as any,
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
    // Re-render the map whenever the polygon set changes OR the
    // tillable source toggle changes (which swaps which polygons we
    // draw). The latter is captured by tillableSource in the dep list.
  }, [hasMap, tillableSource, JSON.stringify(polys.map(p => p.polygon[0]))])

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
        {/* Tillable source toggle — only shown when Stage 5 has at
            least one classifier comparison result. Lets the user flip
            between the current path (SSURGO+NAIP+CSB), USDA CDL 30m,
            and ESA WorldCover 10m so they can compare against the
            satellite imagery and pick the most accurate one. */}
        {s5Tracts.length > 0 && (compHasCdl || compHasWc || compHasHybrid || compHasIoLulc) && (
          <div className="flex items-center gap-2 flex-wrap text-[11px] mt-1">
            <span className="text-gg-gray-400">Tillable source:</span>
            <div className="inline-flex rounded border border-gg-gray-700 overflow-hidden">
              {([
                { v: 'hybrid', label: 'Hybrid', acres: hybridTotal, disabled: !compHasHybrid },
                { v: 'io_lulc', label: 'io-lulc 10m', acres: ioLulcTotal, disabled: !compHasIoLulc },
                { v: 'ssurgo', label: 'SSURGO clipped', acres: ssurgoTotal },
                { v: 'worldcover', label: 'WC raw 10m', acres: wcTotal, disabled: !compHasWc },
                { v: 'cdl', label: 'CDL 30m', acres: cdlTotal, disabled: !compHasCdl },
              ] as Array<{ v: TillableSource; label: string; acres: number; disabled?: boolean }>).map(opt => {
                const active = tillableSource === opt.v
                return (
                  <button key={opt.v}
                    disabled={opt.disabled}
                    onClick={() => setTillableSource(opt.v)}
                    className={`px-2 py-1 font-mono text-[11px] ${
                      active ? 'bg-cyan-500/20 text-cyan-300' : 'bg-gg-gray-900 text-gg-gray-400 hover:text-gg-gray-200'
                    } ${opt.disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    title={opt.disabled ? 'classifier returned no result' : `switch to ${opt.label}`}>
                    {opt.label}
                    {opt.acres > 0 && (
                      <span className="ml-1 text-gg-gray-500">
                        {opt.acres.toFixed(1)}ac
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
        {hasMap ? (
          <div ref={containerRef} className="rounded border border-gg-gray-800 bg-black"
            style={{ width: '100%', height: 360 }} />
        ) : (
          <div className="rounded border border-gg-gray-800 bg-black p-4 text-xs text-gg-gray-500 italic">
            No polygon to render.
          </div>
        )}
        {/* Color legend — shown only when one of the classifier
            views is active. Tells the admin what each color means
            at a glance. Kept in sync with pickClassColor() above. */}
        {tillableSource !== 'ssurgo' && s5Tracts.length > 0 && (
          <div className="mt-2 flex items-center gap-3 flex-wrap text-[10px] font-mono">
            <LegendSwatch color={COLOR_CROPLAND} label="Cropland" />
            <LegendSwatch color={COLOR_PASTURE} label="Pasture / Grass" />
            <LegendSwatch color={COLOR_HAY} label="Hay / Alfalfa" />
            <LegendSwatch color={COLOR_FALLOW} label="Fallow" />
            <LegendSwatch color={COLOR_TREES} label="Trees" />
            <LegendSwatch color={COLOR_WATER} label="Water" />
            <LegendSwatch color={COLOR_BUILT} label="Built-up" />
          </div>
        )}
        {/* Per-classifier per-class acre breakdown — shown when the
            user has selected CDL or WorldCover so they can see which
            specific land-cover classes contributed to the tillable /
            non-tillable totals. */}
        {tillableSource !== 'ssurgo' && s5Tracts.length > 0 && (
          <div className="mt-2 text-[11px] font-mono bg-black border border-gg-gray-800 rounded p-2">
            <div className="text-gg-gray-400 mb-1">
              {tillableSource === 'hybrid'
                ? 'Hybrid (io-lulc + CDL + NLCD + NHD)'
                : tillableSource === 'io_lulc' ? 'io-lulc 10m annual'
                : tillableSource === 'cdl' ? 'CDL 30m'
                : 'WorldCover 10m'} — per-class breakdown
            </div>
            {s5Tracts.map((t: any, ti: number) => {
              const cc = t?.classifier_comparison?.[tillableSource]
              if (!cc || cc._error) {
                return (
                  <div key={ti} className="text-amber-300">
                    {t.tract_label || `T${ti+1}`}: {cc?._error || 'no data'}
                  </div>
                )
              }
              // Group polygons by class code to sum acres per class.
              const byClass: Record<string, { name: string; acres: number; tillable: boolean }> = {}
              for (const p of (cc.polygons || [])) {
                const code = String(
                  (p as any).cdl_class ?? (p as any).wc_class ?? '?',
                )
                if (!byClass[code]) {
                  byClass[code] = { name: p.class_name, acres: 0, tillable: p.tillable }
                }
                byClass[code].acres += Number(p.acres) || 0
              }
              const rows = Object.entries(byClass)
                .sort((a, b) => b[1].acres - a[1].acres)
              return (
                <div key={ti} className="mb-1 last:mb-0">
                  <div className="text-cyan-300">
                    {t.tract_label || `T${ti+1}`}:
                    {' '}tillable={cc.tillable_acres ?? '—'}ac
                    {' '}· non-till={cc.non_tillable_acres ?? '—'}ac
                    {' '}/ tract={cc.tract_acres ?? '—'}ac
                  </div>
                  {rows.map(([code, info]) => (
                    <div key={code} className="ml-3 text-gg-gray-400">
                      <span className={info.tillable ? 'text-cyan-400' : 'text-red-400'}>
                        {info.tillable ? '✓' : '✗'}
                      </span>
                      {' '}{info.name} ({code}): {info.acres.toFixed(2)}ac
                    </div>
                  ))}
                </div>
              )
            })}
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
            {srcImg.url && (srcImg.kind === 'aerial' || srcImg.kind === 'land_id_image'
                            || srcImg.kind === 'pdf_image'
                            || srcImg.kind === 'listing_map'
                            || srcImg.kind === 'source_image'
                            || srcImg.kind === 'polygon_render') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={srcImg.url} alt="source aerial"
                className="object-contain max-h-[340px] w-full" />
            ) : srcImg.url && srcImg.kind === 'land_id' ? (
              // Land ID public viewer — iframe Land ID's canonical
              // rendering so the admin can pixel-compare it to our
              // polygon. If they match, we copied correctly.
              <div className="flex flex-col gap-1">
                <iframe src={srcImg.url} className="w-full"
                  style={{ height: 340, border: 'none' }}
                  sandbox="allow-scripts allow-same-origin"
                  title="Land ID viewer" />
                <a href={srcImg.url} target="_blank" rel="noreferrer"
                  className="text-[10px] text-gg-pink hover:underline px-2 pb-1">
                  Open in new tab ↗
                </a>
              </div>
            ) : srcImg.url && srcImg.kind === 'pdf' ? (
              // Browsers natively render PDFs in iframes. Embed the
              // PDF inline so the admin sees the brochure aerial
              // page with its drawn boundary side-by-side with our
              // projected polygon.
              <div className="flex flex-col gap-1">
                <iframe src={srcImg.url} className="w-full"
                  style={{ height: 340, border: 'none' }}
                  title="Source PDF brochure" />
                <a href={srcImg.url} target="_blank" rel="noreferrer"
                  className="text-[10px] text-gg-pink hover:underline px-2 pb-1">
                  Open PDF in new tab ↗
                </a>
              </div>
            ) : srcImg.url && (srcImg.kind === 'listing_iframe' || srcImg.kind === 'parcel_db') ? (
              // Iframe the listing URL itself — most auction sites
              // include their own map widget, which is the natural
              // comparison source for polygons that came from page
              // JS or county GIS. If the site sets X-Frame-Options:
              // DENY the iframe will be blank; the "open in new tab"
              // link below is the always-works fallback.
              <div className="flex flex-col gap-1">
                <iframe src={srcImg.url} className="w-full"
                  style={{ height: 340, border: 'none' }}
                  sandbox="allow-scripts allow-same-origin allow-popups"
                  title="Listing page (comparison view)" />
                <div className="px-2 pb-1 flex items-center gap-2">
                  <a href={srcImg.url} target="_blank" rel="noreferrer"
                    className="text-[10px] text-gg-pink hover:underline">
                    Open in new tab ↗
                  </a>
                  {srcImg.note && (
                    <span className="text-[10px] text-gg-gray-500 truncate">
                      {srcImg.note}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4 text-xs text-gg-gray-400">{srcImg.note}</div>
            )}
          </div>
        ) : (
          <div className="rounded border border-gg-gray-800 bg-black p-4 text-xs text-gg-gray-500 italic"
            style={{ minHeight: 360 }}>
            No source available — couldn&apos;t resolve a comparison image.
          </div>
        )}
      </div>
    </div>
  )
}
