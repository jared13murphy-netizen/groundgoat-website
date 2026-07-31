'use client'

import { useEffect, useState } from 'react'
import { HardDrive, TrendingUp, AlertCircle, Loader2 } from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// Reads from the shared /api/admin/metrics/dashboard endpoint — same call
// the UsageMetricsPanel makes — but pulls only the `database` section so
// each panel stays self-contained. Could be wired through a shared
// context later if we want to drop the duplicate fetch.

interface DbTable {
  name: string
  schema: string
  bytes: number
  rows: number | null
}

interface DbSnapshot {
  current_bytes: number
  snapshot_at: string
  growth_24h_bytes: number | null
  top_tables: DbTable[]
  series: Array<{ hour: string; total_bytes: number }>
}

function fmtBytes(b: number | null | undefined): string {
  if (b === null || b === undefined) return '—'
  if (b < 1024) return `${b} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = b / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`
}

function fmtRows(r: number | null): string {
  if (r === null || r === undefined) return '—'
  if (r >= 1_000_000) return (r / 1_000_000).toFixed(1) + 'M'
  if (r >= 1_000)     return (r / 1_000).toFixed(1) + 'k'
  return r.toString()
}

function fmtDayLabel(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function DatabaseStoragePanel() {
  const [data, setData] = useState<DbSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        if (!cancelled) setData(body.database || null)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    // Hourly refresh — DB size only updates once an hour anyway, so polling
    // faster is wasted work.
    const t = setInterval(load, 60 * 60 * 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  return (
    <div className="card mt-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white flex items-center gap-2">
            <HardDrive size={20} className="text-gg-pink" />
            Database Storage
          </h2>
          <p className="text-sm text-gg-gray-400 mt-0.5">
            Railway Postgres. Snapshots captured hourly.
          </p>
        </div>
        {data?.snapshot_at && (
          <div className="text-[11px] text-gg-gray-500">
            Last snapshot: {new Date(data.snapshot_at).toLocaleString('en-US', {
              month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            })}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-4 text-sm text-red-300 flex items-center gap-2">
          <AlertCircle size={16} />
          Failed to load DB size: {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center py-12 text-gg-gray-400">
          <Loader2 className="animate-spin mr-2" size={18} />
          Loading…
        </div>
      ) : !data ? (
        <div className="text-center py-12 text-gg-gray-500 text-sm">
          No DB-size snapshots yet — the first one runs on backend startup
          and then every hour. Check back in a few minutes.
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-gg-gray-400 mb-1 flex items-center gap-1">
                <HardDrive size={12} /> Current size
              </div>
              <div className="text-2xl font-bold text-white">{fmtBytes(data.current_bytes)}</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-gg-gray-400 mb-1 flex items-center gap-1">
                <TrendingUp size={12} /> Growth (24h)
              </div>
              <div className="text-2xl font-bold text-white">
                {data.growth_24h_bytes === null
                  ? <span className="text-gg-gray-500 text-base">Need 24h history</span>
                  : (data.growth_24h_bytes >= 0 ? '+' : '') + fmtBytes(data.growth_24h_bytes)
                }
              </div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-gg-gray-400 mb-1">
                Tracked tables
              </div>
              <div className="text-2xl font-bold text-white">{data.top_tables.length}</div>
              <div className="text-[11px] text-gg-gray-500 mt-1">Top 20 by size</div>
            </div>
          </div>

          {/* Growth chart */}
          {data.series.length >= 2 && (
            <div className="bg-gg-gray-800/60 rounded-xl p-4 mb-6">
              <div className="text-sm font-medium text-white mb-2">
                Growth — last {data.series.length} hourly snapshots
              </div>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={data.series.map(s => ({
                      day: fmtDayLabel(s.hour),
                      hour: s.hour,
                      mb: s.total_bytes / (1024 * 1024),
                    }))}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="dbsize-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f58cde" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="#f58cde" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis
                      dataKey="day"
                      tick={{ fill: '#888', fontSize: 11 }}
                      stroke="#444"
                      interval="preserveStartEnd"
                      minTickGap={40}
                    />
                    <YAxis
                      tick={{ fill: '#888', fontSize: 11 }}
                      stroke="#444"
                      tickFormatter={(v) => `${v >= 1024 ? (v / 1024).toFixed(1) + ' GB' : Math.round(v) + ' MB'}`}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid #333', borderRadius: 8 }}
                      labelStyle={{ color: '#fff' }}
                      formatter={(v: any) => fmtBytes(Math.round(v * 1024 * 1024))}
                    />
                    <Area
                      type="monotone"
                      dataKey="mb"
                      stroke="#f58cde"
                      strokeWidth={2}
                      fill="url(#dbsize-grad)"
                      name="Total size"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Top tables */}
          <div className="bg-gg-gray-800/60 rounded-xl p-4">
            <div className="text-sm font-medium text-white mb-3">
              Largest tables
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-gg-gray-500 border-b border-white/5">
                    <th className="py-2 font-medium">Table</th>
                    <th className="py-2 font-medium text-right">Size</th>
                    <th className="py-2 font-medium text-right">% of DB</th>
                    <th className="py-2 font-medium text-right">Rows (est.)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_tables.map(t => {
                    const pct = data.current_bytes ? (t.bytes / data.current_bytes) * 100 : 0
                    return (
                      <tr key={`${t.schema}.${t.name}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2 font-mono text-xs text-white">{t.name}</td>
                        <td className="py-2 text-right text-white">{fmtBytes(t.bytes)}</td>
                        <td className="py-2 text-right text-gg-gray-300">
                          <div className="inline-flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gg-pink"
                                style={{ width: `${Math.min(100, pct)}%` }}
                              />
                            </div>
                            <span className="tabular-nums">{pct.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="py-2 text-right text-gg-gray-300">{fmtRows(t.rows)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
