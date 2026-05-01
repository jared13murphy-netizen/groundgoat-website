'use client'

/**
 * Ground Truth panel — USDA NASS county-level history for a tract.
 *
 * Pulls yields, cash rent, and state landvalue from
 * `/api/tracts/{id}/ground-truth` and renders three compact line charts.
 * Designed to drop into PortalTractDetail as a new section (no tabs).
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

interface GroundTruthPanelProps {
  tractId: string
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
  format = (v: number) => v.toFixed(1),
}: {
  data: { year: number; value: number | null }[]
  color: string
  unitLabel: string
  format?: (v: number) => string
}) {
  const filtered = data.filter(d => d.value != null) as { year: number; value: number }[]
  if (filtered.length === 0) {
    return <div className="text-[11px] text-gg-gray-400 italic px-1 py-2">No data</div>
  }
  // Sorted ascending for the chart axis
  const sorted = [...filtered].sort((a, b) => a.year - b.year)
  const latest = sorted[sorted.length - 1]
  const earliest = sorted[0]
  const delta = latest.value - earliest.value
  const pctDelta = earliest.value !== 0 ? (delta / earliest.value) * 100 : 0
  const trendUp = delta >= 0

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5 px-0.5">
        <div className="text-sm font-semibold text-white">
          {format(latest.value)} <span className="text-[10px] text-gg-gray-400 font-normal">{unitLabel}</span>
        </div>
        <div className={`text-[10px] font-medium ${trendUp ? 'text-emerald-400' : 'text-red-400'}`}>
          {trendUp ? '↑' : '↓'} {Math.abs(pctDelta).toFixed(1)}% since {earliest.year}
        </div>
      </div>
      <div className="h-14">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sorted} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <XAxis
              dataKey="year"
              tick={{ fill: '#6b7280', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis hide domain={['dataMin', 'dataMax']} />
            <Tooltip
              cursor={{ stroke: '#444', strokeWidth: 1 }}
              contentStyle={{
                background: 'rgba(0,0,0,0.85)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 8,
                fontSize: 11,
              }}
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

export default function GroundTruthPanel({ tractId }: GroundTruthPanelProps) {
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
      <div className="bg-white/[0.03] rounded-xl border border-white/5 px-4 py-6 flex items-center justify-center gap-2 text-gg-gray-400 text-xs">
        <Loader2 size={14} className="animate-spin" /> Loading USDA county data…
      </div>
    )
  }
  if (error || !data) {
    return null  // Quietly hide on error — not critical
  }
  if (data.note) {
    // Tract has no resolved state/county — endpoint can't join. Hide.
    return null
  }

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
        <Sprout size={14} className="text-emerald-400" />
        <h3 className="text-sm font-semibold">Ground Truth</h3>
        <span className="text-[10px] text-gg-gray-400">
          USDA NASS · {data.county ? `${data.county} County, ` : ''}{data.state}
        </span>
      </div>

      <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
        {hasYields && (
          <div className="px-4 py-3 space-y-3">
            <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">County yields</div>
            {corn.length > 0 && (
              <div>
                <div className="text-[11px] text-gg-gray-400 mb-0.5">Corn</div>
                <MiniLineChart data={corn} color="#fbbf24" unitLabel="bu/ac" format={v => v.toFixed(1)} />
              </div>
            )}
            {beans.length > 0 && (
              <div>
                <div className="text-[11px] text-gg-gray-400 mb-0.5">Soybeans</div>
                <MiniLineChart data={beans} color="#34d399" unitLabel="bu/ac" format={v => v.toFixed(1)} />
              </div>
            )}
            {wheat.length > 0 && (
              <div>
                <div className="text-[11px] text-gg-gray-400 mb-0.5">Wheat</div>
                <MiniLineChart data={wheat} color="#a78bfa" unitLabel="bu/ac" format={v => v.toFixed(1)} />
              </div>
            )}
          </div>
        )}

        {hasRent && (
          <div className="px-4 py-3 space-y-3">
            <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">Cash rent (county avg)</div>
            {rentNonIrr.length > 0 && (
              <div>
                <div className="text-[11px] text-gg-gray-400 mb-0.5">Cropland (non-irrigated)</div>
                <MiniLineChart data={rentNonIrr} color="#60a5fa" unitLabel="/ac" format={dollar} />
              </div>
            )}
            {rentPasture.length > 0 && (
              <div>
                <div className="text-[11px] text-gg-gray-400 mb-0.5">Pastureland</div>
                <MiniLineChart data={rentPasture} color="#a3e635" unitLabel="/ac" format={dollar} />
              </div>
            )}
          </div>
        )}

        {hasLand && (
          <div className="px-4 py-3 space-y-3">
            <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">
              Land value <span className="normal-case text-gg-gray-400 tracking-normal">(state avg)</span>
            </div>
            {landCropland.length > 0 && (
              <div>
                <div className="text-[11px] text-gg-gray-400 mb-0.5">Cropland</div>
                <MiniLineChart data={landCropland} color="#E91E8C" unitLabel="/ac" format={dollar} />
              </div>
            )}
            {landPasture.length > 0 && (
              <div>
                <div className="text-[11px] text-gg-gray-400 mb-0.5">Pastureland</div>
                <MiniLineChart data={landPasture} color="#f472b6" unitLabel="/ac" format={dollar} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
