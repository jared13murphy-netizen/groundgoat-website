'use client'

import { useEffect, useState } from 'react'
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'

const API_URL = 'https://practical-serenity-production.up.railway.app'

type YieldPoint = {
  year: number
  value: number | null
  unit: string | null
  agg_level: string | null
}

type RentRow = {
  year: number
  cropland_non_irrigated: number | null
  cropland_irrigated: number | null
  pastureland: number | null
  agg_level: string | null
}

type LandValueRow = {
  year: number
  farm_real_estate: number | null
  cropland: number | null
  pastureland: number | null
}

type GroundTruthData = {
  state_abbr: string | null
  county_name: string | null
  yields: Record<string, YieldPoint[]>
  rent: RentRow[]
  land_value: LandValueRow[]
  attribution: string
  notes: string[]
}

interface Props {
  tractId: string
}

const COMMODITIES = [
  { key: 'CORN', label: 'Corn' },
  { key: 'SOYBEANS', label: 'Soybeans' },
  { key: 'WHEAT', label: 'Wheat' },
  { key: 'HAY', label: 'Hay' },
]

function formatNum(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—'
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function formatDollar(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return '$' + Number(n).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  })
}

export default function GroundTruthPanel({ tractId }: Props) {
  const [data, setData] = useState<GroundTruthData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedCommodity, setSelectedCommodity] = useState('CORN')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchWithAuth(`${API_URL}/api/tracts/${tractId}/ground-truth?years=5`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as GroundTruthData
        if (!cancelled) setData(json)
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load Ground Truth data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [tractId])

  if (loading) {
    return (
      <div className="bg-gg-gray-800 rounded-lg p-6 text-gg-gray-400">
        Loading Ground Truth data…
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-gg-gray-800 rounded-lg p-6 text-gg-gray-400">
        Could not load Ground Truth data ({error}).
      </div>
    )
  }

  if (!data) return null

  const yieldSeries = data.yields[selectedCommodity] || []
  const yieldUnit = yieldSeries.find(p => p.unit)?.unit || ''
  const hasAnyYieldData = COMMODITIES.some(c => (data.yields[c.key] || []).some(p => p.value !== null))
  const hasAnyRent = data.rent.some(
    r => r.cropland_non_irrigated || r.cropland_irrigated || r.pastureland
  )
  const hasAnyLandValue = data.land_value.some(
    r => r.farm_real_estate || r.cropland || r.pastureland
  )

  return (
    <div className="bg-gg-gray-800 rounded-lg p-6 space-y-6">
      <div>
        <h3 className="text-xl font-bold text-white mb-1">Ground Truth</h3>
        <p className="text-sm text-gg-gray-400">
          Public USDA county/state benchmarks for{' '}
          <span className="text-white">
            {data.county_name ? `${data.county_name} County, ` : ''}
            {data.state_abbr || '—'}
          </span>
        </p>
      </div>

      {data.notes.length > 0 && (
        <div className="text-xs text-gg-gray-400 italic space-y-1">
          {data.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {/* ---------- County yields ---------- */}
      {hasAnyYieldData && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-white font-semibold">County average yield</h4>
            <div className="flex gap-2">
              {COMMODITIES.map(c => {
                const has = (data.yields[c.key] || []).some(p => p.value !== null)
                return (
                  <button
                    key={c.key}
                    disabled={!has}
                    onClick={() => setSelectedCommodity(c.key)}
                    className={`px-3 py-1 rounded text-xs ${
                      selectedCommodity === c.key
                        ? 'bg-gg-pink text-white'
                        : has
                        ? 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
                        : 'bg-gg-gray-700 text-gg-gray-500 cursor-not-allowed opacity-50'
                    }`}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>
          {yieldSeries.length === 0 ? (
            <div className="text-sm text-gg-gray-400 py-8 text-center">
              No data for {selectedCommodity.toLowerCase()} in this county.
            </div>
          ) : (
            <>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={yieldSeries.map(p => ({ year: p.year, value: p.value }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="year" stroke="#9ca3af" />
                    <YAxis stroke="#9ca3af" />
                    <Tooltip
                      contentStyle={{ background: '#1f2937', border: '1px solid #374151' }}
                      formatter={(v: any) => [formatNum(v) + ' ' + yieldUnit, 'Yield']}
                    />
                    <Line type="monotone" dataKey="value" stroke="#ec4899" strokeWidth={2} dot />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="text-xs text-gg-gray-500 mt-1">Unit: {yieldUnit || 'n/a'}</div>
            </>
          )}
        </div>
      )}

      {/* ---------- Cash rent ---------- */}
      {hasAnyRent && (
        <div>
          <h4 className="text-white font-semibold mb-3">County cash rent ($/acre)</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gg-gray-400 border-b border-gg-gray-700">
                  <th className="text-left py-2">Year</th>
                  <th className="text-right py-2">Cropland (non-irr.)</th>
                  <th className="text-right py-2">Cropland (irrigated)</th>
                  <th className="text-right py-2">Pastureland</th>
                </tr>
              </thead>
              <tbody>
                {data.rent.map(r => (
                  <tr key={r.year} className="border-b border-gg-gray-700/50">
                    <td className="py-2 text-white">{r.year}</td>
                    <td className="py-2 text-right text-white">{formatDollar(r.cropland_non_irrigated)}</td>
                    <td className="py-2 text-right text-white">{formatDollar(r.cropland_irrigated)}</td>
                    <td className="py-2 text-right text-white">{formatDollar(r.pastureland)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---------- State land value ---------- */}
      {hasAnyLandValue && (
        <div>
          <h4 className="text-white font-semibold mb-3">
            {data.state_abbr} farmland value ($/acre, state avg)
          </h4>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={data.land_value}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="year" stroke="#9ca3af" />
                <YAxis stroke="#9ca3af" tickFormatter={(v) => '$' + (v / 1000).toFixed(0) + 'K'} />
                <Tooltip
                  contentStyle={{ background: '#1f2937', border: '1px solid #374151' }}
                  formatter={(v: any) => [formatDollar(v), '']}
                />
                <Legend />
                <Line type="monotone" dataKey="farm_real_estate" stroke="#ec4899" strokeWidth={2} name="Farm real estate" />
                <Line type="monotone" dataKey="cropland" stroke="#22c55e" strokeWidth={2} name="Cropland" />
                <Line type="monotone" dataKey="pastureland" stroke="#f59e0b" strokeWidth={2} name="Pastureland" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!hasAnyYieldData && !hasAnyRent && !hasAnyLandValue && (
        <div className="text-sm text-gg-gray-400 py-8 text-center">
          No USDA NASS data available for this location yet. Check back after the next ingest run.
        </div>
      )}

      <div className="text-xs text-gg-gray-500 pt-2 border-t border-gg-gray-700">
        {data.attribution}
      </div>
    </div>
  )
}
