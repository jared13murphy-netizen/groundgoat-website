'use client'

import { useEffect, useState } from 'react'
import {
  Server, AlertCircle, Loader2, CheckCircle2, XCircle, AlertTriangle,
  Activity, Clock, Users, TrendingUp, TrendingDown, Globe,
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// All four panels here read the same `/api/admin/metrics/dashboard`
// payload so they share one network call. Each owns its own slice of
// the response.

interface ServiceStatus {
  name: string
  status: 'up' | 'down' | 'degraded' | string
  latency_ms?: number | null
  http_status?: number | null
  message?: string | null
}

interface JobRun {
  name: string
  last_started_at: string | null
  last_finished_at: string | null
  last_status: string | null
  last_duration_ms: number | null
  last_message: string | null
  consecutive_failures: number
}

interface ExternalApi {
  api: string
  operation: string
  calls_24h: number
  errors_24h: number
  error_rate_pct: number
  last_success_at: string | null
  last_error_at: string | null
}

interface SubscriptionData {
  active: number
  trialing: number
  state_subs: number
  firm_subs: number
  premium_state_subs: number
  new_30d: number
  canceled_30d: number
  net_change_30d: number
  trial_started_30d: number
  trial_converted_30d: number
  trial_conversion_pct: number
}

interface RegridSummary {
  totals_24h: {
    calls: number
    parcels: number
    cache_hits: number
    errors: number
    tiles?: number  // populated once the tile-proxy is wired
  }
}

interface DashboardPayload {
  services?: ServiceStatus[]
  jobs?: JobRun[]
  external_apis?: ExternalApi[]
  subscription?: SubscriptionData
  regrid?: RegridSummary
}

// Shared fetch hook so the four panels make ONE network request between them.
function useDashboard(refreshMs: number) {
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setError(null)
        const res = await fetchWithAuth(`${API_URL}/api/admin/metrics/dashboard?hours=24`)
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail || `HTTP ${res.status}`)
        }
        const body = await res.json()
        if (!cancelled) setData(body)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const t = setInterval(load, refreshMs)
    return () => { cancelled = true; clearInterval(t) }
  }, [refreshMs])

  return { data, error, loading }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
function fmtAge(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1)  return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24)   return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString('en-US')
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, { color: string; Icon: any }> = {
    up:        { color: 'text-green-400',  Icon: CheckCircle2 },
    degraded:  { color: 'text-yellow-400', Icon: AlertTriangle },
    down:      { color: 'text-red-400',    Icon: XCircle },
  }
  const m = map[status] || { color: 'text-gg-gray-400', Icon: AlertCircle }
  const Icon = m.Icon
  return <Icon size={14} className={m.color} />
}

// ─────────────────────────────────────────────────────────────────────
// Combined wrapper — renders all four panels with a single fetch.
// ─────────────────────────────────────────────────────────────────────
export default function HealthPanels() {
  const { data, error, loading } = useDashboard(60_000)

  if (loading && !data) {
    return (
      <div className="card mt-6 h-32 flex items-center justify-center text-gg-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading health data…
      </div>
    )
  }
  if (error) {
    return (
      <div className="card mt-6 bg-red-900/20 border-red-500/30">
        <div className="text-sm text-red-300 flex items-center gap-2">
          <AlertCircle size={16} /> Failed to load health data: {error}
        </div>
      </div>
    )
  }
  if (!data) return null

  return (
    <>
      <ServiceHealthPanel services={data.services || []} />
      <RegridUsagePanel regrid={data.regrid} />
      <SubscriptionPanel subs={data.subscription} />
      <JobsPanel jobs={data.jobs || []} />
      <ExternalApisPanel apis={data.external_apis || []} />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Regrid usage — top-of-page summary so admin can spot a runaway
// spend at a glance without scrolling to the Usage Metrics panel.
// Status indicator turns yellow when error_rate > 5%, red when > 20%.
// ─────────────────────────────────────────────────────────────────────
function RegridUsagePanel({ regrid }: { regrid?: RegridSummary }) {
  if (!regrid) return null
  const t = regrid.totals_24h
  const calls = t.calls || 0
  const cacheHits = t.cache_hits || 0
  const errors = t.errors || 0
  const parcels = t.parcels || 0
  // Cache hit rate is meaningful only when there are calls
  const cachePct = calls > 0 ? Math.round((cacheHits / calls) * 100) : 0
  const errorPct = calls > 0 ? (errors / calls) * 100 : 0
  const status = errorPct > 20 ? 'down' : errorPct > 5 ? 'degraded' : 'up'
  const statusLabel = status === 'down' ? 'Elevated errors' :
                      status === 'degraded' ? 'Some errors' : 'Healthy'
  const tiles = t.tiles ?? null
  return (
    <div className="card mt-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Activity size={20} className="text-gg-pink" />
            Regrid Usage (last 24h)
          </h2>
          <p className="text-sm text-gg-gray-400 mt-0.5">
            At-a-glance counters. Full breakdown + hourly chart in the
            Usage Metrics panel below.
          </p>
        </div>
        <div className={`text-xs px-3 py-1 rounded-full border ${
          status === 'up' ? 'bg-green-900/20 border-green-500/30 text-green-300' :
          status === 'degraded' ? 'bg-yellow-900/20 border-yellow-500/30 text-yellow-300' :
          'bg-red-900/20 border-red-500/30 text-red-300'
        }`}>
          {statusLabel}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <RegridStat label="API calls" value={calls.toLocaleString()} />
        <RegridStat label="Parcels returned" value={parcels.toLocaleString()} />
        <RegridStat
          label="Cache hit rate"
          value={`${cachePct}%`}
          accent={cachePct >= 50 ? 'good' : cachePct >= 20 ? 'ok' : 'bad'}
        />
        <RegridStat
          label="Errors"
          value={`${errors.toLocaleString()}${errorPct > 0 ? ` (${errorPct.toFixed(1)}%)` : ''}`}
          accent={errorPct > 20 ? 'bad' : errorPct > 5 ? 'ok' : 'good'}
        />
        <RegridStat
          label="Map tiles loaded"
          // Reverted 2026-05-18: the tile-counting proxy was making
          // the parcel layer slow to paint. Tiles go direct to Regrid's
          // CDN again so we can't count them. Stat shown as N/A.
          value="N/A"
        />
      </div>
    </div>
  )
}

function RegridStat({
  label, value, accent = 'good',
}: { label: string; value: string; accent?: 'good' | 'ok' | 'bad' }) {
  const valueColor =
    accent === 'good' ? 'text-white' :
    accent === 'ok' ? 'text-yellow-300' : 'text-red-300'
  return (
    <div className="rounded-xl p-3 border bg-white/[0.03] border-white/5">
      <div className="text-[11px] uppercase tracking-wide text-gg-gray-500">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${valueColor}`}>{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Service health badges (web · mobile API · scraper · DB)
// ─────────────────────────────────────────────────────────────────────
function ServiceHealthPanel({ services }: { services: ServiceStatus[] }) {
  const anyDown = services.some(s => s.status === 'down')
  const anyDegraded = services.some(s => s.status === 'degraded')
  const overall = anyDown ? 'down' : anyDegraded ? 'degraded' : 'up'

  return (
    <div className="card mt-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <Server size={20} className="text-gg-pink" />
            Service Health
          </h2>
          <p className="text-sm text-gg-gray-400 mt-0.5">
            Live ping of each Railway service + DB. Refreshes every 60s.
          </p>
        </div>
        <div className={`text-xs px-3 py-1 rounded-full border ${
          overall === 'up' ? 'bg-green-900/20 border-green-500/30 text-green-300' :
          overall === 'degraded' ? 'bg-yellow-900/20 border-yellow-500/30 text-yellow-300' :
          'bg-red-900/20 border-red-500/30 text-red-300'
        }`}>
          {overall === 'up' ? 'All systems operational' :
           overall === 'degraded' ? 'Some services degraded' :
           'Outage detected'}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {services.map(s => (
          <div
            key={s.name}
            className={`rounded-xl p-3 border ${
              s.status === 'down' ? 'bg-red-900/10 border-red-500/30' :
              s.status === 'degraded' ? 'bg-yellow-900/10 border-yellow-500/30' :
              'bg-white/[0.03] border-white/5'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium text-white">{s.name}</div>
              <StatusDot status={s.status} />
            </div>
            <div className="text-[11px] text-gg-gray-400 leading-snug">
              {s.latency_ms != null ? `${s.latency_ms.toFixed(0)}ms` : '—'}
              {s.http_status != null ? ` · HTTP ${s.http_status}` : ''}
            </div>
            {s.message && (
              <div className="text-[11px] text-gg-gray-500 mt-1 truncate" title={s.message}>
                {s.message}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Subscription health
// ─────────────────────────────────────────────────────────────────────
function SubscriptionPanel({ subs }: { subs?: SubscriptionData }) {
  if (!subs) return null
  const NetIcon = subs.net_change_30d >= 0 ? TrendingUp : TrendingDown
  const netColor = subs.net_change_30d >= 0 ? 'text-green-300' : 'text-red-300'

  return (
    <div className="card mt-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Users size={20} className="text-gg-pink" />
          Subscriptions
        </h2>
        <p className="text-sm text-gg-gray-400 mt-0.5">
          Active subscribers + 30-day churn / conversion. Excludes staff bypass accounts.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Tile label="Active subscribers" value={fmtNum(subs.active)} />
        <Tile label="Currently trialing" value={fmtNum(subs.trialing)} />
        <Tile label="State plans" value={fmtNum(subs.state_subs)} />
        <Tile label="Firm plans" value={fmtNum(subs.firm_subs)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-gg-gray-800/60 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-gg-gray-400 mb-1">Net change (30d)</div>
          <div className={`text-2xl font-bold flex items-center gap-2 ${netColor}`}>
            <NetIcon size={18} />
            {subs.net_change_30d >= 0 ? '+' : ''}{fmtNum(subs.net_change_30d)}
          </div>
          <div className="text-[11px] text-gg-gray-500 mt-1">
            {fmtNum(subs.new_30d)} new · {fmtNum(subs.canceled_30d)} canceled
          </div>
        </div>

        <div className="bg-gg-gray-800/60 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-gg-gray-400 mb-1">Trial conversion (30d)</div>
          <div className="text-2xl font-bold text-white">{subs.trial_conversion_pct.toFixed(1)}%</div>
          <div className="text-[11px] text-gg-gray-500 mt-1">
            {fmtNum(subs.trial_converted_30d)} of {fmtNum(subs.trial_started_30d)} converted to paid
          </div>
        </div>

        <div className="bg-gg-gray-800/60 rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-wider text-gg-gray-400 mb-1">Premium state subs</div>
          <div className="text-2xl font-bold text-gg-pink">{fmtNum(subs.premium_state_subs)}</div>
          <div className="text-[11px] text-gg-gray-500 mt-1">Active premium tier</div>
        </div>
      </div>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
      <div className="text-[10px] uppercase tracking-wider text-gg-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{value}</div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// Background-job freshness
// ─────────────────────────────────────────────────────────────────────
function JobsPanel({ jobs }: { jobs: JobRun[] }) {
  return (
    <div className="card mt-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Clock size={20} className="text-gg-pink" />
          Background Jobs
        </h2>
        <p className="text-sm text-gg-gray-400 mt-0.5">
          When each cron-style job last ran + how long it took. A job that hasn't run in too long is silently broken.
        </p>
      </div>

      {jobs.length === 0 ? (
        <div className="text-center py-8 text-sm text-gg-gray-500">
          No jobs reporting yet — they show up here once they call <code>system_health.record_job_finish()</code>.
          The scraper, NASS sync, and private-treaty monitor will start populating this as they next run.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gg-gray-500 border-b border-white/5">
                <th className="py-2 font-medium">Job</th>
                <th className="py-2 font-medium">Status</th>
                <th className="py-2 font-medium">Last run</th>
                <th className="py-2 font-medium">Duration</th>
                <th className="py-2 font-medium">Streak</th>
                <th className="py-2 font-medium">Note</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => {
                const statusColor =
                  j.last_status === 'success' ? 'text-green-400' :
                  j.last_status === 'failed' ? 'text-red-400' :
                  j.last_status === 'partial' ? 'text-yellow-400' :
                  j.last_status === 'running' ? 'text-blue-400' :
                  'text-gg-gray-500'
                return (
                  <tr key={j.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2 font-mono text-xs text-white">{j.name}</td>
                    <td className={`py-2 text-xs ${statusColor}`}>{j.last_status || '—'}</td>
                    <td className="py-2 text-gg-gray-300 text-xs">{fmtAge(j.last_finished_at)}</td>
                    <td className="py-2 text-gg-gray-300 text-xs">
                      {j.last_duration_ms != null ? `${(j.last_duration_ms / 1000).toFixed(1)}s` : '—'}
                    </td>
                    <td className={`py-2 text-xs ${j.consecutive_failures > 0 ? 'text-red-400' : 'text-gg-gray-500'}`}>
                      {j.consecutive_failures > 0 ? `${j.consecutive_failures} fail${j.consecutive_failures !== 1 ? 's' : ''}` : 'ok'}
                    </td>
                    <td className="py-2 text-gg-gray-400 text-xs truncate max-w-xs" title={j.last_message || ''}>
                      {j.last_message || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// External APIs (Anthropic / Stripe / Resend / etc.)
// ─────────────────────────────────────────────────────────────────────
function ExternalApisPanel({ apis }: { apis: ExternalApi[] }) {
  return (
    <div className="card mt-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-white flex items-center gap-2">
          <Globe size={20} className="text-gg-pink" />
          External APIs
        </h2>
        <p className="text-sm text-gg-gray-400 mt-0.5">
          Outbound third-party calls in the last 24h. Lights up when a vendor breaks silently.
        </p>
      </div>

      {apis.length === 0 ? (
        <div className="text-center py-8 text-sm text-gg-gray-500">
          No outbound API calls recorded in the last 24h yet — these populate as Anthropic / Stripe webhook /
          Resend / etc. fire. (Regrid is tracked separately on the Usage Metrics panel.)
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gg-gray-500 border-b border-white/5">
                <th className="py-2 font-medium">API</th>
                <th className="py-2 font-medium">Operation</th>
                <th className="py-2 font-medium text-right">Calls (24h)</th>
                <th className="py-2 font-medium text-right">Error rate</th>
                <th className="py-2 font-medium">Last success</th>
                <th className="py-2 font-medium">Last error</th>
              </tr>
            </thead>
            <tbody>
              {apis.map(a => {
                const errClass = a.error_rate_pct > 5 ? 'text-red-400'
                  : a.error_rate_pct > 0 ? 'text-yellow-400' : 'text-gg-gray-500'
                return (
                  <tr key={`${a.api}/${a.operation}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="py-2 text-xs text-gg-pink font-medium">{a.api}</td>
                    <td className="py-2 text-xs font-mono text-white">{a.operation}</td>
                    <td className="py-2 text-right text-white text-xs">{fmtNum(a.calls_24h)}</td>
                    <td className={`py-2 text-right text-xs ${errClass}`}>
                      {a.error_rate_pct.toFixed(1)}%
                    </td>
                    <td className="py-2 text-xs text-green-300">{fmtAge(a.last_success_at)}</td>
                    <td className={`py-2 text-xs ${a.last_error_at ? 'text-red-300' : 'text-gg-gray-500'}`}>
                      {fmtAge(a.last_error_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
