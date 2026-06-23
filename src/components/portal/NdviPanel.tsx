'use client'

/**
 * NDVI panel — Sentinel-2 vegetation index time series for a tract.
 *
 * NDVI (Normalized Difference Vegetation Index) measures vegetation
 * health and biomass per pixel from satellite imagery. Computed from
 * the polygon's red + near-infrared bands every ~5 days during the
 * growing season.
 *
 * The chart renders a multi-year overlay: each growing season's NDVI
 * curve, color-coded by year. Lets buyers see at a glance whether the
 * tract is consistently productive or has bad-year volatility.
 *
 * Two themes (matching GroundTruthPanel):
 *   • 'dark'  — PortalTractDetail slide-out (/access)
 *   • 'light' — ExploreMap inline modal (/listings)
 *
 * Self-hides while the backfill is in progress for tracts that haven't
 * been processed yet — `observation_count: 0` returns nothing visible.
 */
import { useEffect, useState } from 'react'
import { Loader2, Leaf } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend,
  ReferenceLine,
} from 'recharts'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Observation {
  date: string
  ndvi_mean: number | null
  ndvi_min: number | null
  ndvi_max: number | null
  cloud_pct: number | null
  pixels_used: number | null
}

interface NdviResponse {
  tract_id: string
  observations: Observation[]
  observation_count: number
  peak_ndvi: number | null
  peak_date: string | null
}

type Theme = 'dark' | 'light'

interface NdviPanelProps {
  tractId: string
  theme?: Theme
}

const THEMES: Record<Theme, {
  card: string
  primaryText: string
  subtle: string
  rowLabel: string
  chartTickFill: string
  cursorStroke: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  loadingText: string
  loadingBg: string
  iconAccent: string
}> = {
  dark: {
    card: 'bg-white/[0.03] rounded-xl border border-white/5 p-4',
    primaryText: 'text-white',
    subtle: 'text-gg-gray-400',
    rowLabel: 'text-[11px] text-gg-gray-300 uppercase tracking-wider',
    chartTickFill: '#9ca3af',
    cursorStroke: '#444',
    tooltipBg: 'rgba(0,0,0,0.85)',
    tooltipBorder: '1px solid rgba(255,255,255,0.1)',
    tooltipText: '#fff',
    loadingText: 'text-gg-gray-400',
    loadingBg: 'bg-white/[0.03] border-white/5',
    iconAccent: 'text-emerald-400',
  },
  light: {
    card: 'bg-white rounded-lg border border-gray-200 p-4',
    primaryText: 'text-gray-900',
    subtle: 'text-gray-500',
    rowLabel: 'text-[11px] text-gray-500 uppercase tracking-wider font-semibold',
    chartTickFill: '#6b7280',
    cursorStroke: '#d1d5db',
    tooltipBg: 'rgba(255,255,255,0.98)',
    tooltipBorder: '1px solid #e5e7eb',
    tooltipText: '#1a1a1a',
    loadingText: 'text-gray-500',
    loadingBg: 'bg-gray-50 border-gray-200',
    iconAccent: 'text-emerald-600',
  },
}

// Color per year — distinct, season-friendly palette. Most recent year
// gets the boldest color so it visually anchors the chart.
const YEAR_COLORS = ['#10b981', '#3b82f6', '#a855f7', '#f59e0b', '#ec4899']

interface DayOfYearPoint {
  doy: number     // day of year, 1–366
  date: string    // human-readable for tooltip
  [year: string]: number | string  // dynamic year keys: "2024": 0.55
}

/**
 * Reshape observations into a "day-of-year" overlay so multiple years
 * line up on the same x-axis. Each row has one `doy` value plus a column
 * per year. Recharts then renders one Line per year; gaps (missing dates)
 * naturally show as breaks.
 */
function transformToYearOverlay(obs: Observation[]): {
  data: DayOfYearPoint[]
  years: number[]
} {
  if (!obs || obs.length === 0) return { data: [], years: [] }

  // Group by (year, doy)
  const byKey = new Map<string, DayOfYearPoint>()
  const yearSet = new Set<number>()
  for (const o of obs) {
    if (o.ndvi_mean == null) continue
    const d = new Date(o.date + 'T00:00:00')
    const year = d.getFullYear()
    yearSet.add(year)
    // Day of year (1-based)
    const startOfYear = new Date(year, 0, 1)
    const doy = Math.floor((d.getTime() - startOfYear.getTime()) / 86400000) + 1
    const key = String(doy)
    if (!byKey.has(key)) {
      byKey.set(key, { doy, date: monthDayLabel(d) })
    }
    byKey.get(key)![String(year)] = o.ndvi_mean
  }
  // Sort by doy (Apr → Oct), filter to growing season window
  const data = Array.from(byKey.values())
    .filter(p => p.doy >= 90 && p.doy <= 305) // Apr 1 ≈ doy 91, Nov 1 ≈ doy 305
    .sort((a, b) => a.doy - b.doy)
  const years = Array.from(yearSet).sort((a, b) => a - b)
  return { data, years }
}

function monthDayLabel(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function doyToMonthLabel(doy: number): string {
  // Use a non-leap year for axis labels (consistent across years)
  const d = new Date(2023, 0, doy)
  return d.toLocaleDateString('en-US', { month: 'short' })
}

function classifyPeak(peak: number | null): { label: string; color: string } | null {
  if (peak == null) return null
  if (peak >= 0.75) return { label: 'Excellent', color: 'text-emerald-500' }
  if (peak >= 0.6)  return { label: 'Healthy',   color: 'text-emerald-500' }
  if (peak >= 0.45) return { label: 'Average',   color: 'text-amber-500' }
  if (peak >= 0.3)  return { label: 'Below avg', color: 'text-orange-500' }
  return { label: 'Sparse',  color: 'text-red-500' }
}

export default function NdviPanel({ tractId, theme = 'dark' }: NdviPanelProps) {
  const t = THEMES[theme]
  const [data, setData] = useState<NdviResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchWithAuth(`${API_URL}/api/tracts/${tractId}/ndvi?years=3`)
      .then(r => r.ok ? r.json() : null)
      .then((body: NdviResponse | null) => { if (!cancelled && body) setData(body) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tractId])

  if (loading) {
    return (
      <div className={`rounded-xl border px-4 py-6 flex items-center justify-center gap-2 text-xs ${t.loadingText} ${t.loadingBg}`}>
        <Loader2 size={14} className="animate-spin" /> Loading vegetation history…
      </div>
    )
  }
  if (!data || data.observation_count === 0) return null

  const { data: chartData, years } = transformToYearOverlay(data.observations)
  if (chartData.length === 0) return null

  const peakClass = classifyPeak(data.peak_ndvi)

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Leaf size={14} className={t.iconAccent} />
        <h3 className={`text-sm font-semibold ${t.primaryText}`}>Vegetation Index (NDVI)</h3>
        <span className={`text-[10px] ${t.subtle}`}>Sentinel-2 · {data.observation_count} obs</span>
      </div>

      <div className={t.card}>
        {/* Peak NDVI summary header */}
        {data.peak_ndvi != null && peakClass && (
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <span className={`text-2xl font-bold ${t.primaryText}`}>
                {data.peak_ndvi.toFixed(2)}
              </span>
              <span className={`text-[11px] ml-1.5 ${t.subtle}`}>peak NDVI</span>
            </div>
            <div className={`text-xs font-medium ${peakClass.color}`}>
              {peakClass.label}
            </div>
          </div>
        )}

        {/* Multi-year overlay chart */}
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
              <XAxis
                dataKey="doy"
                tick={{ fill: t.chartTickFill, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                ticks={[91, 121, 152, 182, 213, 244, 274, 305]}
                tickFormatter={doyToMonthLabel}
                interval={0}
              />
              <YAxis
                tick={{ fill: t.chartTickFill, fontSize: 9 }}
                axisLine={false}
                tickLine={false}
                domain={[0, 1]}
                ticks={[0, 0.25, 0.5, 0.75, 1]}
                width={28}
              />
              {/* Reference: healthy crop NDVI threshold */}
              <ReferenceLine
                y={0.6}
                stroke={t.chartTickFill}
                strokeDasharray="3 3"
                opacity={0.4}
              />
              <Tooltip
                cursor={{ stroke: t.cursorStroke, strokeWidth: 1 }}
                contentStyle={{
                  background: t.tooltipBg,
                  border: t.tooltipBorder,
                  borderRadius: 8,
                  fontSize: 11,
                  color: t.tooltipText,
                }}
                itemStyle={{ color: t.tooltipText }}
                labelStyle={{ color: t.tooltipText }}
                labelFormatter={(_doy: any, payload: any) =>
                  payload?.[0]?.payload?.date || ''}
                formatter={(v: any, name: any) => [
                  typeof v === 'number' ? v.toFixed(2) : '—',
                  String(name),
                ]}
              />
              <Legend
                verticalAlign="top"
                height={20}
                wrapperStyle={{ fontSize: 10, color: t.chartTickFill }}
                iconType="line"
                iconSize={12}
              />
              {years.map((year, i) => (
                <Line
                  key={year}
                  type="monotone"
                  dataKey={String(year)}
                  name={String(year)}
                  stroke={YEAR_COLORS[i % YEAR_COLORS.length]}
                  strokeWidth={i === years.length - 1 ? 2.5 : 1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className={`text-[10px] mt-1 ${t.subtle}`}>
          Dashed line at 0.6 = healthy cropland threshold
        </div>
      </div>
    </div>
  )
}
