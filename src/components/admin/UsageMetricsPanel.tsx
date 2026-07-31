'use client'

import { useEffect, useState } from 'react'
import { Activity, Users, AlertCircle, Clock, Database, Loader2, RefreshCw } from 'lucide-react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// All numbers shown here are populated by the backend's request-metrics
// middleware (web + mobile API traffic, customer accounts only — staff
// and anon traffic are excluded server-side) and the scraper's
// regrid_metrics helper. Counters are flushed to the hourly_* tables
// every ~10s, so the dashboard is near-realtime.

interface DashboardData {
  kpi: {
    unique_users_last_hour: number
    requests_last_hour: number
    unique_users_24h: number
    requests_24h: number
    error_rate_24h_pct: number
    avg_latency_24h_ms: number
  }
  series: Array<{
    hour: string
    request_count: number
    error_count: number
    unique_users: number
    login_count: number
    signup_count: number
  }>
  top_endpoints: Array<{
    endpoint: string
    request_count: number
    error_count: number
    server_error_count: number
    avg_ms: number
    p50_ms: number | null
    p95_ms: number | null
  }>
  regrid: {
    totals_24h: { calls: number; parcels: number; cache_hits: number; errors: number }
    by_endpoint: Array<{ endpoint: string; calls: number; parcels: number; cache_hits: number; errors: number }>
    series: Array<{ hour: string; calls: number; parcels: number; cache_hits: number }>
    // OUR locally-measured Regrid usage since the contract anniversary
    // (May 11). Source of truth for cross-checking Regrid's billed
    // numbers — Records = parcel_count from every parcels/* call
    // (the billable unit per Schedule A), Tiles = call_count from the
    // tile-proxy endpoint.
    measured?: {
      anniversary_date: string     // 'YYYY-MM-DD'
      days_into_year: number
      records: number              // billable records since anniversary
      tiles: number                // tile requests since anniversary
      calls: number
      cache_hits: number
      errors: number
      by_endpoint: Array<{ endpoint: string; calls: number; parcels: number; cache_hits: number; errors: number }>
    }
    // Billing-cycle usage straight from Regrid's free /api/v2/usage
    // endpoint. Null when the call fails.
    cycle: null | {
      cycle_dates: { begin: number; end: number }  // epoch seconds
      cycle_usage: {
        requests: number          // parcel API calls this cycle
        results: number           // parcel records returned (= billable units)
        tiles: number             // total tile requests
        tiles_parcels: number
        tiles_buildings: number
        tiles_zoning: number
        features: number
        typeahead: number
        addresses: number         // add-on usage
        buildings: number
        ownership: number
        zoning: number
        parcels: number
        area: { sq_meters: number; acres: number; sq_miles: number }
      }
    }
  }
  generated_at: string
  hours_covered: number
}

const HOUR_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
  { label: '7d',  hours: 168 },
]

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 10_000)    return (n / 1_000).toFixed(0) + 'k'
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k'
  return n.toLocaleString('en-US')
}

function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's'
  return Math.round(ms) + 'ms'
}

function fmtHourLabel(iso: string): string {
  // 'YYYY-MM-DDTHH:00:00Z' → 'Mon 14:00'
  const d = new Date(iso)
  const day = d.toLocaleDateString('en-US', { weekday: 'short' })
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${day} ${time}`
}

export default function UsageMetricsPanel() {
  const [hours, setHours] = useState(24)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  useEffect(() => {
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      try {
        setError(null)
        const res = await fetchWithAuth(`${API_URL}/api/admin/metrics/dashboard?hours=${hours}`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail || `HTTP ${res.status}`)
        }
        const body: DashboardData = await res.json()
        if (!cancelled) setData(body)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    if (autoRefresh) {
      // 60s refresh — matches the typical admin-eyeball cadence and
      // avoids hammering the metrics endpoint while leaving it open.
      interval = setInterval(load, 60_000)
    }
    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
    }
  }, [hours, autoRefresh])

  return (
    <div className="card mt-8">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Activity size={20} className="text-gg-pink" />
            Usage Metrics
          </h2>
          <p className="text-sm text-gg-gray-400 mt-0.5">
            Real customer traffic across web + mobile (staff excluded). Updated ~60s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gg-gray-800 rounded-lg p-0.5">
            {HOUR_OPTIONS.map(opt => (
              <button
                key={opt.hours}
                onClick={() => setHours(opt.hours)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                  hours === opt.hours
                    ? 'bg-gg-pink text-white'
                    : 'text-gg-gray-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`p-1.5 rounded-md transition ${
              autoRefresh ? 'text-gg-pink bg-gg-pink/10' : 'text-gg-gray-500 hover:text-white'
            }`}
            title={autoRefresh ? 'Auto-refresh on (60s)' : 'Auto-refresh off'}
          >
            <RefreshCw size={14} className={autoRefresh ? 'animate-pulse' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-4 text-sm text-red-300 flex items-center gap-2">
          <AlertCircle size={16} />
          Failed to load metrics: {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-gg-gray-400">
          <Loader2 className="animate-spin mr-2" size={20} />
          Loading metrics…
        </div>
      ) : data ? (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <KpiTile
              icon={<Users size={16} />}
              label="Active users (last hour)"
              value={fmtNum(data.kpi.unique_users_last_hour)}
              sub={`${fmtNum(data.kpi.unique_users_24h)} unique in 24h`}
            />
            <KpiTile
              icon={<Activity size={16} />}
              label="Requests (last hour)"
              value={fmtNum(data.kpi.requests_last_hour)}
              sub={`${fmtNum(data.kpi.requests_24h)} in 24h`}
            />
            <KpiTile
              icon={<AlertCircle size={16} />}
              label="Error rate (24h)"
              value={`${data.kpi.error_rate_24h_pct.toFixed(2)}%`}
              danger={data.kpi.error_rate_24h_pct > 2}
            />
            <KpiTile
              icon={<Clock size={16} />}
              label="Avg latency (24h)"
              value={fmtMs(data.kpi.avg_latency_24h_ms)}
              danger={data.kpi.avg_latency_24h_ms > 800}
            />
          </div>

          {/* Hourly trend chart */}
          <div className="bg-gg-gray-800/60 rounded-xl p-4 mb-6">
            <div className="text-sm font-medium text-white mb-2">
              Hourly traffic — last {data.hours_covered}h
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.series.map(s => ({ ...s, hourLabel: fmtHourLabel(s.hour) }))}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="hourLabel" tick={{ fill: '#888', fontSize: 11 }} stroke="#444" />
                  <YAxis yAxisId="left" tick={{ fill: '#888', fontSize: 11 }} stroke="#444" />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#888', fontSize: 11 }} stroke="#444" />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
                    labelStyle={{ color: '#fff' }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="request_count"
                    name="Requests"
                    stroke="#f58cde"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="unique_users"
                    name="Unique users"
                    stroke="#f5b800"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top endpoints */}
          <div className="bg-gg-gray-800/60 rounded-xl p-4 mb-6">
            <div className="text-sm font-medium text-white mb-3">
              Top endpoints (last 24h)
            </div>
            {data.top_endpoints.length === 0 ? (
              <div className="text-xs text-gg-gray-500 py-4 text-center">
                No traffic recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gg-gray-500 border-b border-white/5">
                      <th className="py-2 font-medium">Endpoint</th>
                      <th className="py-2 font-medium text-right">Requests</th>
                      <th className="py-2 font-medium text-right">Errors</th>
                      <th className="py-2 font-medium text-right">Avg</th>
                      <th className="py-2 font-medium text-right">p50</th>
                      <th className="py-2 font-medium text-right">p95</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_endpoints.map(ep => (
                      <tr key={ep.endpoint} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 font-mono text-xs text-white">{ep.endpoint}</td>
                        <td className="py-2 text-right text-white">{fmtNum(ep.request_count)}</td>
                        <td className={`py-2 text-right ${ep.error_count > 0 ? 'text-red-400' : 'text-gg-gray-500'}`}>
                          {ep.error_count > 0 ? fmtNum(ep.error_count) : '0'}
                        </td>
                        <td className="py-2 text-right text-gg-gray-300">{fmtMs(ep.avg_ms)}</td>
                        <td className="py-2 text-right text-gg-gray-300">{fmtMs(ep.p50_ms)}</td>
                        <td className={`py-2 text-right ${(ep.p95_ms || 0) > 1000 ? 'text-yellow-400' : 'text-gg-gray-300'}`}>
                          {fmtMs(ep.p95_ms)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Regrid usage */}
          <div className="bg-gg-gray-800/60 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <Database size={16} className="text-gg-gold" />
                Regrid usage (last 24h)
              </div>
              <RegridSavingsBadge
                calls={data.regrid.totals_24h.calls}
                cacheHits={data.regrid.totals_24h.cache_hits}
              />
            </div>

            {/* OUR locally-measured usage since the contract anniversary
                — the cross-check on whatever Regrid bills us. Shown
                FIRST because it's our source of truth. */}
            <RegridMeasuredBlock
              measured={data.regrid.measured}
              cycle={data.regrid.cycle}
            />

            {/* Regrid's official billing-cycle usage (from their free
                /api/v2/usage endpoint). Billing model per Regrid docs:
                "Parcel API requests are tracked for billing by how many
                Parcel Records are RETURNED in a response" — so the
                "Records returned" tile is what counts against quota. */}
            <RegridCycleBlock cycle={data.regrid.cycle} />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <KpiTile
                label="Live calls (billable)"
                value={fmtNum(data.regrid.totals_24h.calls)}
                tone="gold"
              />
              <KpiTile
                label="Parcels returned"
                value={fmtNum(data.regrid.totals_24h.parcels)}
                tone="gold"
              />
              <KpiTile
                label="Served from cache"
                value={fmtNum(data.regrid.totals_24h.cache_hits)}
              />
              <KpiTile
                label="Errors"
                value={fmtNum(data.regrid.totals_24h.errors)}
                danger={data.regrid.totals_24h.errors > 0}
              />
            </div>
            {data.regrid.by_endpoint.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-gg-gray-500 border-b border-white/5">
                      <th className="py-2 font-medium">Endpoint</th>
                      <th className="py-2 font-medium text-right">Live calls</th>
                      <th className="py-2 font-medium text-right">Parcels</th>
                      <th className="py-2 font-medium text-right">Cache hits</th>
                      <th className="py-2 font-medium text-right">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.regrid.by_endpoint.map(ep => (
                      <tr key={ep.endpoint} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 font-mono text-xs text-white">{ep.endpoint}</td>
                        <td className="py-2 text-right text-gg-gold">{fmtNum(ep.calls)}</td>
                        <td className="py-2 text-right text-gg-gray-300">{fmtNum(ep.parcels)}</td>
                        <td className="py-2 text-right text-gg-gray-300">{fmtNum(ep.cache_hits)}</td>
                        <td className={`py-2 text-right ${ep.errors > 0 ? 'text-red-400' : 'text-gg-gray-500'}`}>
                          {ep.errors > 0 ? fmtNum(ep.errors) : '0'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-xs text-gg-gray-500 py-3 text-center">
                No Regrid activity recorded in the selected window.
              </div>
            )}

            {/* Regrid hourly chart — only when we actually have activity */}
            {data.regrid.series.some(s => s.calls > 0 || s.cache_hits > 0) && (
              <div className="mt-4 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={data.regrid.series.map(s => ({ ...s, hourLabel: fmtHourLabel(s.hour) }))}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="hourLabel" tick={{ fill: '#888', fontSize: 11 }} stroke="#444" />
                    <YAxis tick={{ fill: '#888', fontSize: 11 }} stroke="#444" />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
                      labelStyle={{ color: '#fff' }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="calls" name="Live calls" stroke="#f5b800" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="cache_hits" name="Cache hits" stroke="#f58cde" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

function KpiTile({
  icon, label, value, sub, danger, tone,
}: {
  icon?: React.ReactNode
  label: string
  value: string
  sub?: string
  danger?: boolean
  tone?: 'gold'
}) {
  return (
    <div className={`rounded-xl p-3 border ${
      danger ? 'bg-red-900/15 border-red-500/30' :
      tone === 'gold' ? 'bg-gg-gold/5 border-gg-gold/20' :
      'bg-white/[0.03] border-white/5'
    }`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gg-gray-400 mb-1">
        {icon} <span>{label}</span>
      </div>
      <div className={`text-2xl font-bold ${
        danger ? 'text-red-300' : tone === 'gold' ? 'text-gg-gold' : 'text-white'
      }`}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-gg-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

/** Tiny pink chip showing the % of Regrid lookups served from cache. */
function RegridSavingsBadge({ calls, cacheHits }: { calls: number; cacheHits: number }) {
  const total = calls + cacheHits
  if (total === 0) return null
  const pct = (cacheHits / total) * 100
  return (
    <div className="text-xs px-2 py-1 rounded-full bg-gg-pink/10 border border-gg-pink/30 text-gg-pink">
      {pct.toFixed(0)}% served from cache
    </div>
  )
}

// Contract caps per Ground Goat × Regrid Schedule A, effective May 11,
// 2026 (3-year term). Annual cycle: each cap resets on the May 11
// anniversary. Combined-usage rule: (records/RECORDS_CAP) +
// (tiles/TILES_CAP) is the fraction of the prepaid Fee consumed —
// going over either dimension OR the combined total triggers overage
// billing ($0.15/record, $0.001/tile).
const REGRID_RECORDS_CAP = 133_333
const REGRID_TILES_CAP = 20_000_000
const REGRID_ANNIVERSARY_MONTH = 4 // May (0-indexed)
const REGRID_ANNIVERSARY_DAY = 11

/** Returns [begin, end] of the contract year covering `now`. The
 *  contract year runs from the most-recent May 11 anniversary through
 *  May 10 of the following calendar year. */
function regridContractYear(now: Date): { begin: Date; end: Date } {
  const y = now.getFullYear()
  const thisYearAnniv = new Date(y, REGRID_ANNIVERSARY_MONTH, REGRID_ANNIVERSARY_DAY)
  const begin = now >= thisYearAnniv
    ? thisYearAnniv
    : new Date(y - 1, REGRID_ANNIVERSARY_MONTH, REGRID_ANNIVERSARY_DAY)
  const end = new Date(begin.getFullYear() + 1, REGRID_ANNIVERSARY_MONTH, REGRID_ANNIVERSARY_DAY)
  return { begin, end }
}

/** Pick a Tailwind color class for a usage bar based on % consumed. */
function capBarColor(pct: number): string {
  if (pct >= 95) return 'bg-red-500'
  if (pct >= 80) return 'bg-orange-400'
  if (pct >= 60) return 'bg-amber-400'
  return 'bg-emerald-500'
}

function capTextColor(pct: number): string {
  if (pct >= 95) return 'text-red-400'
  if (pct >= 80) return 'text-orange-300'
  if (pct >= 60) return 'text-amber-300'
  return 'text-emerald-400'
}

/** Single cap-progress row: label + count/cap + colored bar + pct. */
function CapBar({
  label, used, cap, unit,
}: { label: string; used: number; cap: number; unit: string }) {
  const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[11px] uppercase tracking-wider text-gg-gray-300">
          {label}
        </div>
        <div className={`text-[11px] font-semibold ${capTextColor(pct)}`}>
          {pct.toFixed(1)}%
        </div>
      </div>
      <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden mb-1">
        <div
          className={`h-full ${capBarColor(pct)} rounded-full transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[11px] text-gg-gray-400">
        {fmtNum(used)} / {fmtNum(cap)} {unit}
      </div>
    </div>
  )
}

/** Billing-cycle usage block (data straight from Regrid). The 'results'
 *  field is the billable unit per Regrid's billing model — they charge
 *  per parcel RECORD returned, not per request.
 *
 *  Annual contract caps (Schedule A, eff. May 11, 2026):
 *    133,333 Parcel Records OR 20M Parcel Tiles OR combined fraction.
 *  When combined fraction > 100% Regrid bills overage at $0.15/record
 *  + $0.001/tile.
 *
 *  This block shows BOTH the Regrid-reported cycle (whatever window
 *  their /api/v2/usage returns — could be monthly or annual depending
 *  on their billing model) AND the contract-year window derived from
 *  the May 11 anniversary. If Regrid's cycle matches the contract
 *  year, the two windows line up; if not, the contract-year banner
 *  warns the user that their cycle data may understate annual usage.
 */
function RegridCycleBlock({ cycle }: { cycle: DashboardData['regrid']['cycle'] }) {
  if (!cycle) return null
  const { cycle_dates, cycle_usage } = cycle
  const beginD = new Date(cycle_dates.begin * 1000)
  const endD   = new Date(cycle_dates.end * 1000)
  const fmtDate = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const daysRemaining = Math.max(0, Math.ceil((endD.getTime() - Date.now()) / 86_400_000))
  const cycleDays = Math.max(1, Math.round((endD.getTime() - beginD.getTime()) / 86_400_000))
  const daysElapsed = Math.max(0, cycleDays - daysRemaining)
  const pctElapsed = Math.min(100, (daysElapsed / cycleDays) * 100)

  // Cap math against the annual contract: combined fraction is the
  // single number Regrid actually bills against the prepaid Fee.
  const recordsUsed = cycle_usage.results
  const tilesUsed = cycle_usage.tiles_parcels
  const recordsPct = (recordsUsed / REGRID_RECORDS_CAP) * 100
  const tilesPct = (tilesUsed / REGRID_TILES_CAP) * 100
  const combinedPct = recordsPct + tilesPct

  // Detect whether Regrid's reported cycle is the same window as our
  // contract year. If not, surface a warning — the user needs to know
  // that the cycle_usage numbers may be a subset of annual usage.
  const contract = regridContractYear(new Date())
  const cycleIsAnnual = cycleDays >= 350 && cycleDays <= 380
  const cycleMatchesContract = (
    cycleIsAnnual
    && Math.abs(beginD.getTime() - contract.begin.getTime()) < 7 * 86_400_000
  )

  return (
    <div className="mb-4 rounded-xl border border-gg-gold/15 bg-gg-gold/[0.04] p-3">
      <div className="flex items-baseline justify-between flex-wrap gap-x-3 gap-y-1 mb-2">
        <div className="text-xs font-semibold text-gg-gold uppercase tracking-wider">
          Regrid billing cycle · {fmtDate(beginD)} – {fmtDate(endD)}
        </div>
        <div className="text-[11px] text-gg-gray-400">
          Day {daysElapsed} of {cycleDays} · {daysRemaining} left
        </div>
      </div>
      <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-gg-gold/70 rounded-full transition-all"
          style={{ width: `${pctElapsed}%` }}
        />
      </div>

      {/* Contract-cap progress: Records, Tiles, Combined. */}
      <div className="mb-3 p-3 rounded-lg bg-black/20 border border-white/5">
        <div className="flex items-baseline justify-between mb-2">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gg-gold/80">
            Annual contract caps
          </div>
          <div className="text-[10px] text-gg-gray-400">
            Year: {fmtDate(contract.begin)} – {fmtDate(new Date(contract.end.getTime() - 86_400_000))}
          </div>
        </div>
        {!cycleMatchesContract && (
          <div className="mb-2 text-[11px] text-amber-300/90">
            ⚠ Regrid is reporting a {cycleDays}-day cycle, not the full
            contract year. Numbers below reflect the reported window —
            actual annual usage may be higher.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <CapBar
            label="Parcel Records"
            used={recordsUsed}
            cap={REGRID_RECORDS_CAP}
            unit="records"
          />
          <CapBar
            label="Parcel Tiles"
            used={tilesUsed}
            cap={REGRID_TILES_CAP}
            unit="tiles"
          />
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-[11px] uppercase tracking-wider text-gg-gray-300">
                Combined (billed against fee)
              </div>
              <div className={`text-[11px] font-semibold ${capTextColor(combinedPct)}`}>
                {combinedPct.toFixed(1)}%
              </div>
            </div>
            <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden mb-1">
              <div
                className={`h-full ${capBarColor(combinedPct)} rounded-full transition-all`}
                style={{ width: `${Math.min(100, combinedPct)}%` }}
              />
            </div>
            <div className="text-[11px] text-gg-gray-400">
              {combinedPct > 100
                ? `Over by ${(combinedPct - 100).toFixed(1)}% · overage rates apply`
                : `${(100 - combinedPct).toFixed(1)}% headroom`}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile
          label="Records returned (billable)"
          value={fmtNum(cycle_usage.results)}
          sub={`${fmtNum(cycle_usage.requests)} requests`}
          tone="gold"
        />
        <KpiTile
          label="Parcel tiles served"
          value={fmtNum(cycle_usage.tiles_parcels)}
        />
        <KpiTile
          label="Add-ons used"
          value={fmtNum(
            cycle_usage.addresses + cycle_usage.buildings +
            cycle_usage.ownership + cycle_usage.zoning,
          )}
          sub={addonBreakdown(cycle_usage)}
        />
        <KpiTile
          label="Area searched"
          value={
            cycle_usage.area.acres > 0
              ? `${fmtNum(Math.round(cycle_usage.area.acres))} ac`
              : '0 ac'
          }
        />
      </div>
    </div>
  )
}

/** OUR locally-measured Regrid usage block. Sums every billable Regrid
 *  call from `hourly_regrid_usage` since the contract anniversary (May
 *  11). When Regrid bills us "over quota" we use this to cross-check
 *  their number — vendor reports can be wrong, and this is the only
 *  number we control.
 *
 *  Layout: contract-year header, three cap bars (Records / Tiles /
 *  Combined), then a side-by-side OUR-vs-THEIRS comparison so the user
 *  can spot discrepancies at a glance. */
function RegridMeasuredBlock({
  measured, cycle,
}: {
  measured: DashboardData['regrid']['measured']
  cycle: DashboardData['regrid']['cycle']
}) {
  if (!measured) {
    return (
      <div className="mb-4 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-3 text-[12px] text-amber-200">
        Local Regrid usage tracking is not reporting yet — once the
        backend is updated, this panel will show OUR measured usage
        since the May 11 contract anniversary.
      </div>
    )
  }

  const recordsUsed = measured.records
  const tilesUsed = measured.tiles
  const recordsPct = (recordsUsed / REGRID_RECORDS_CAP) * 100
  const tilesPct = (tilesUsed / REGRID_TILES_CAP) * 100
  const combinedPct = recordsPct + tilesPct

  // Pull Regrid's reported numbers if we have them for side-by-side.
  const theirRecords = cycle?.cycle_usage.results
  const theirTiles = cycle?.cycle_usage.tiles_parcels

  const fmtDelta = (ours: number, theirs: number | undefined) => {
    if (theirs === undefined || theirs === null) return '—'
    const diff = ours - theirs
    const pct = theirs > 0 ? (diff / theirs) * 100 : 0
    const sign = diff > 0 ? '+' : ''
    return `${sign}${fmtNum(diff)} (${sign}${pct.toFixed(1)}%)`
  }

  const anniv = new Date(measured.anniversary_date + 'T00:00:00')
  const annivLabel = anniv.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-3">
      <div className="flex items-baseline justify-between flex-wrap gap-x-3 gap-y-1 mb-2">
        <div className="text-xs font-semibold text-emerald-300 uppercase tracking-wider">
          Our measured usage · since {annivLabel}
        </div>
        <div className="text-[11px] text-gg-gray-400">
          Day {measured.days_into_year} of 365
        </div>
      </div>
      <div className="text-[11px] text-gg-gray-400 mb-3">
        Sum of every billable Regrid call we logged locally. Use this to
        cross-check Regrid's reported numbers.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <CapBar
          label="Parcel Records (ours)"
          used={recordsUsed}
          cap={REGRID_RECORDS_CAP}
          unit="records"
        />
        <CapBar
          label="Parcel Tiles (ours)"
          used={tilesUsed}
          cap={REGRID_TILES_CAP}
          unit="tiles"
        />
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <div className="text-[11px] uppercase tracking-wider text-gg-gray-300">
              Combined (billed against fee)
            </div>
            <div className={`text-[11px] font-semibold ${capTextColor(combinedPct)}`}>
              {combinedPct.toFixed(1)}%
            </div>
          </div>
          <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden mb-1">
            <div
              className={`h-full ${capBarColor(combinedPct)} rounded-full transition-all`}
              style={{ width: `${Math.min(100, combinedPct)}%` }}
            />
          </div>
          <div className="text-[11px] text-gg-gray-400">
            {combinedPct > 100
              ? `Over by ${(combinedPct - 100).toFixed(1)}%`
              : `${(100 - combinedPct).toFixed(1)}% headroom`}
          </div>
        </div>
      </div>

      {/* Side-by-side: OURS vs Regrid's reported. */}
      <div className="rounded-lg border border-white/5 bg-black/20 overflow-hidden">
        <div className="grid grid-cols-4 text-[10px] uppercase tracking-wider text-gg-gray-400 bg-white/[0.02] px-2 py-1">
          <div></div>
          <div className="text-right">Ours</div>
          <div className="text-right">Regrid says</div>
          <div className="text-right">Δ (ours − theirs)</div>
        </div>
        <div className="grid grid-cols-4 text-[12px] px-2 py-1 border-t border-white/5">
          <div className="text-gg-gray-300">Records</div>
          <div className="text-right font-mono">{fmtNum(recordsUsed)}</div>
          <div className="text-right font-mono text-gg-gray-400">
            {theirRecords !== undefined ? fmtNum(theirRecords) : '—'}
          </div>
          <div className="text-right font-mono text-gg-gray-400">
            {fmtDelta(recordsUsed, theirRecords)}
          </div>
        </div>
        <div className="grid grid-cols-4 text-[12px] px-2 py-1 border-t border-white/5">
          <div className="text-gg-gray-300">Tiles</div>
          <div className="text-right font-mono">{fmtNum(tilesUsed)}</div>
          <div className="text-right font-mono text-gg-gray-400">
            {theirTiles !== undefined ? fmtNum(theirTiles) : '—'}
          </div>
          <div className="text-right font-mono text-gg-gray-400">
            {fmtDelta(tilesUsed, theirTiles)}
          </div>
        </div>
      </div>

      {/* Per-endpoint breakdown so we can see WHICH call is the hot one. */}
      {measured.by_endpoint.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wider text-gg-gray-400 mb-1">
            By endpoint (since {annivLabel})
          </div>
          <table className="w-full text-[11px]">
            <thead className="text-gg-gray-400">
              <tr>
                <th className="text-left font-normal">Endpoint</th>
                <th className="text-right font-normal">Calls</th>
                <th className="text-right font-normal">Records</th>
                <th className="text-right font-normal">Cache hits</th>
                <th className="text-right font-normal">Errors</th>
              </tr>
            </thead>
            <tbody>
              {measured.by_endpoint.map(ep => (
                <tr key={ep.endpoint} className="border-t border-white/5">
                  <td className="py-1 font-mono">{ep.endpoint}</td>
                  <td className="py-1 text-right font-mono">{fmtNum(ep.calls)}</td>
                  <td className="py-1 text-right font-mono text-gg-gold">{fmtNum(ep.parcels)}</td>
                  <td className="py-1 text-right font-mono text-gg-gray-400">{fmtNum(ep.cache_hits)}</td>
                  <td className={`py-1 text-right font-mono ${ep.errors > 0 ? 'text-red-400' : 'text-gg-gray-400'}`}>
                    {fmtNum(ep.errors)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function addonBreakdown(u: NonNullable<DashboardData['regrid']['cycle']>['cycle_usage']): string {
  // Only mention add-ons that have any usage, so the row is empty for
  // pure-Standard accounts.
  const parts: string[] = []
  if (u.addresses) parts.push(`${u.addresses} addr`)
  if (u.buildings) parts.push(`${u.buildings} bldg`)
  if (u.ownership) parts.push(`${u.ownership} own`)
  if (u.zoning)    parts.push(`${u.zoning} zon`)
  return parts.length ? parts.join(' · ') : 'none'
}
