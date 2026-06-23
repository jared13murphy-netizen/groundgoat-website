'use client'

/**
 * Ground Truth panel — USDA NASS county-level history for a tract.
 *
 * Pulls yields, cash rent, and state landvalue from
 * `/api/tracts/{id}/ground-truth` and renders three compact line charts.
 *
 * Two themes:
 *   • 'dark' (default) — matches PortalTractDetail's slide-out panel
 *     in /access (admin-only).
 *   • 'light' — matches the inline "Sale Modal" that opens from the
 *     ExploreMap on /listings (white card, dark text). Same component,
 *     different palette so it looks native in both surfaces.
 *
 * Data note: yields and rent are county-level. Landvalue is state-level
 * (NASS doesn't publish per-county landvalue annually). The header
 * makes that distinction explicit so customers don't read "$10,300/ac"
 * as a county-specific number.
 */
import { useEffect, useState } from 'react'
import { Loader2, Sprout } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface YieldRow {
  year: number
  practice: string | null
  ypa: number | null
  unit: string | null
}
interface RentRow { year: number; dpa: number | null }
interface ValueRow { year: number; dpa: number | null }

interface GroundTruth {
  state: string | null
  state_name?: string | null
  county: string | null
  yields: Record<string, YieldRow[]>
  rent: Record<string, RentRow[]>
  landvalue: Record<string, ValueRow[]>
  note?: string
}

type Theme = 'dark' | 'light'

interface GroundTruthPanelProps {
  tractId: string
  theme?: Theme
}

// Theme bundles. Picked here so the rest of the component just reads
// from one object rather than branching on theme everywhere.
const THEMES: Record<Theme, {
  container: string
  card: string
  divider: string
  sectionLabel: string
  rowLabel: string
  primaryText: string
  unitText: string
  noDataText: string
  chartTickFill: string
  cursorStroke: string
  tooltipBg: string
  tooltipBorder: string
  tooltipText: string
  loadingText: string
  loadingBg: string
  headerSubtle: string
  iconAccent: string
}> = {
  dark: {
    container: '',
    card: 'bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5',
    divider: '',
    sectionLabel: 'text-[10px] text-gg-gray-300 uppercase tracking-wider',
    rowLabel: 'text-[11px] text-gg-gray-400 mb-0.5',
    primaryText: 'text-white',
    unitText: 'text-gg-gray-400',
    noDataText: 'text-gg-gray-400',
    chartTickFill: '#6b7280',
    cursorStroke: '#444',
    tooltipBg: 'rgba(0,0,0,0.85)',
    tooltipBorder: '1px solid rgba(255,255,255,0.1)',
    tooltipText: '#fff',
    loadingText: 'text-gg-gray-400',
    loadingBg: 'bg-white/[0.03] border-white/5',
    headerSubtle: 'text-gg-gray-400',
    iconAccent: 'text-emerald-400',
  },
  light: {
    container: '',
    card: 'bg-white rounded-lg border border-gray-200 divide-y divide-gray-100',
    divider: '',
    sectionLabel: 'text-[10px] text-gray-500 uppercase tracking-wider font-semibold',
    rowLabel: 'text-[11px] text-gray-500 mb-0.5',
    primaryText: 'text-gray-900',
    unitText: 'text-gray-500',
    noDataText: 'text-gray-400',
    chartTickFill: '#9ca3af',
    cursorStroke: '#d1d5db',
    tooltipBg: 'rgba(255,255,255,0.98)',
    tooltipBorder: '1px solid #e5e7eb',
    tooltipText: '#1a1a1a',
    loadingText: 'text-gray-500',
    loadingBg: 'bg-gray-50 border-gray-200',
    headerSubtle: 'text-gray-500',
    iconAccent: 'text-emerald-600',
  },
}

/**
 * For each commodity NASS publishes multiple practices per year (CORN
 * has GRAIN + SILAGE; SOYBEANS has UTILIZATION variants). We display
 * the production-relevant one — GRAIN for corn, ALL UTILIZATION
 * PRACTICES for soybeans, ALL otherwise. The picker stays here (not in
 * the API) so we can refine which practice to show without a deploy
 * cycle on the backend.
 */
function pickPrimaryPractice(commodity: string, rows: YieldRow[]): YieldRow[] {
  if (!rows || rows.length === 0) return []
  const want =
    commodity === 'CORN' ? 'GRAIN' :
    commodity === 'SOYBEANS' ? 'ALL UTILIZATION PRACTICES' :
    null
  if (want) {
    const filtered = rows.filter(r => r.practice === want)
    if (filtered.length > 0) return filtered
  }
  // Fallback: take whichever practice has the most years of data
  const byPractice = new Map<string, YieldRow[]>()
  for (const r of rows) {
    const k = r.practice || 'ALL'
    if (!byPractice.has(k)) byPractice.set(k, [])
    byPractice.get(k)!.push(r)
  }
  let best: YieldRow[] = []
  byPractice.forEach(arr => {
    if (arr.length > best.length) best = arr
  })
  return best
}

function MiniLineChart({
  data,
  color,
  unitLabel,
  themeStyles,
  format = (v: number) => v.toFixed(1),
}: {
  data: { year: number; value: number | null }[]
  color: string
  unitLabel: string
  themeStyles: typeof THEMES.dark
  format?: (v: number) => string
}) {
  const filtered = data.filter(d => d.value != null) as { year: number; value: number }[]
  if (filtered.length === 0) {
    return <div className={`text-[11px] italic px-1 py-2 ${themeStyles.noDataText}`}>No data</div>
  }
  const sorted = [...filtered].sort((a, b) => a.year - b.year)
  const latest = sorted[sorted.length - 1]
  const earliest = sorted[0]
  const delta = latest.value - earliest.value
  const pctDelta = earliest.value !== 0 ? (delta / earliest.value) * 100 : 0
  const trendUp = delta >= 0

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5 px-0.5">
        <div className={`text-sm font-semibold ${themeStyles.primaryText}`}>
          {format(latest.value)} <span className={`text-[10px] font-normal ${themeStyles.unitText}`}>{unitLabel}</span>
        </div>
        <div className={`text-[10px] font-medium ${trendUp ? 'text-emerald-500' : 'text-red-500'}`}>
          {trendUp ? '↑' : '↓'} {Math.abs(pctDelta).toFixed(1)}% since {earliest.year}
        </div>
      </div>
      <div className="h-14">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sorted} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <XAxis
              dataKey="year"
              tick={{ fill: themeStyles.chartTickFill, fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Tooltip
              cursor={{ stroke: themeStyles.cursorStroke, strokeWidth: 1 }}
              contentStyle={{
                background: themeStyles.tooltipBg,
                border: themeStyles.tooltipBorder,
                borderRadius: 8,
                fontSize: 11,
                color: themeStyles.tooltipText,
              }}
              itemStyle={{ color: themeStyles.tooltipText }}
              labelStyle={{ color: themeStyles.tooltipText }}
              formatter={(v: any) => [format(Number(v)) + ' ' + unitLabel, '']}
              labelFormatter={(yr: any) => `Year ${yr}`}
              separator=""
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={{ fill: color, r: 2 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function GroundTruthPanel({ tractId, theme = 'dark' }: GroundTruthPanelProps) {
  const t = THEMES[theme]
  const [data, setData] = useState<GroundTruth | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetchWithAuth(`${API_URL}/api/tracts/${tractId}/ground-truth`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((body: GroundTruth) => {
        if (cancelled) return
        setData(body)
      })
      .catch(e => {
        if (cancelled) return
        setError(e.message || 'Failed to load')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tractId])

  if (loading) {
    return (
      <div className={`rounded-xl border px-4 py-6 flex items-center justify-center gap-2 text-xs ${t.loadingText} ${t.loadingBg}`}>
        <Loader2 size={14} className="animate-spin" /> Loading USDA county data…
      </div>
    )
  }
  if (error || !data) return null
  if (data.note) return null

  const corn = pickPrimaryPractice('CORN', data.yields.CORN || [])
    .map(r => ({ year: r.year, value: r.ypa }))
  const beans = pickPrimaryPractice('SOYBEANS', data.yields.SOYBEANS || [])
    .map(r => ({ year: r.year, value: r.ypa }))
  const wheat = pickPrimaryPractice('WHEAT', data.yields.WHEAT || [])
    .map(r => ({ year: r.year, value: r.ypa }))

  const rentNonIrr = (data.rent.CROPLAND_NON_IRR || [])
    .map(r => ({ year: r.year, value: r.dpa }))
  const rentPasture = (data.rent.PASTURELAND || [])
    .map(r => ({ year: r.year, value: r.dpa }))

  const landCropland = (data.landvalue.CROPLAND || [])
    .map(r => ({ year: r.year, value: r.dpa }))
  const landPasture = (data.landvalue.PASTURELAND || [])
    .map(r => ({ year: r.year, value: r.dpa }))

  const hasYields = corn.length || beans.length || wheat.length
  const hasRent = rentNonIrr.length || rentPasture.length
  const hasLand = landCropland.length || landPasture.length
  if (!hasYields && !hasRent && !hasLand) return null

  const dollar = (v: number) => '$' + Math.round(v).toLocaleString('en-US')

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Sprout size={14} className={t.iconAccent} />
        <h3 className={`text-sm font-semibold ${t.primaryText}`}>Ground Truth</h3>
        <span className={`text-[10px] ${t.headerSubtle}`}>
          USDA NASS · {data.county ? `${data.county} County, ` : ''}{data.state}
        </span>
      </div>

      <div className={t.card}>
        {hasYields && (
          <div className="px-4 py-3 space-y-3">
            <div className={t.sectionLabel}>County yields</div>
            {corn.length > 0 && (
              <div>
                <div className={t.rowLabel}>Corn</div>
                <MiniLineChart data={corn} color="#fbbf24" unitLabel="bu/ac" format={v => v.toFixed(1)} themeStyles={t} />
              </div>
            )}
            {beans.length > 0 && (
              <div>
                <div className={t.rowLabel}>Soybeans</div>
                <MiniLineChart data={beans} color="#10b981" unitLabel="bu/ac" format={v => v.toFixed(1)} themeStyles={t} />
              </div>
            )}
            {wheat.length > 0 && (
              <div>
                <div className={t.rowLabel}>Wheat</div>
                <MiniLineChart data={wheat} color="#8b5cf6" unitLabel="bu/ac" format={v => v.toFixed(1)} themeStyles={t} />
              </div>
            )}
          </div>
        )}

        {hasRent && (
          <div className="px-4 py-3 space-y-3">
            <div className={t.sectionLabel}>Cash rent (county avg)</div>
            {rentNonIrr.length > 0 && (
              <div>
                <div className={t.rowLabel}>Cropland (non-irrigated)</div>
                <MiniLineChart data={rentNonIrr} color="#3b82f6" unitLabel="/ac" format={dollar} themeStyles={t} />
              </div>
            )}
            {rentPasture.length > 0 && (
              <div>
                <div className={t.rowLabel}>Pastureland</div>
                <MiniLineChart data={rentPasture} color="#84cc16" unitLabel="/ac" format={dollar} themeStyles={t} />
              </div>
            )}
          </div>
        )}

        {hasLand && (
          <div className="px-4 py-3 space-y-3">
            <div className={t.sectionLabel}>
              Land value <span className={`normal-case tracking-normal ${t.headerSubtle}`}>(state avg)</span>
            </div>
            {landCropland.length > 0 && (
              <div>
                <div className={t.rowLabel}>Cropland</div>
                <MiniLineChart data={landCropland} color="#E91E8C" unitLabel="/ac" format={dollar} themeStyles={t} />
              </div>
            )}
            {landPasture.length > 0 && (
              <div>
                <div className={t.rowLabel}>Pastureland</div>
                <MiniLineChart data={landPasture} color="#ec4899" unitLabel="/ac" format={dollar} themeStyles={t} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
