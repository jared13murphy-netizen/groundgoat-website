'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Loader2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { getCountiesForState, US_STATES } from '@/data/counties'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface TownshipDetail {
  total_acres: number
  total_sale_price: number
  tract_count: number
  avg_price_per_acre: number
}

interface CountyDetailData {
  county: string
  state: string
  companies: Record<string, any>
  townships: Record<string, TownshipDetail>
  total_listings: number
  total_acres_sold: number
  total_sale_amount: number
}

interface PortalAnalyticsPanelProps {
  county: string
  state: string
  onClose: () => void
  onDataLoad?: (data: CountyDetailData | null) => void
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(1) + 'M'
  if (amount >= 1000) return '$' + Math.round(amount / 1000).toLocaleString() + 'K'
  return '$' + Math.round(amount).toLocaleString()
}

function formatAcres(acres: number): string {
  if (acres >= 1000) return (acres / 1000).toFixed(1) + 'K'
  return acres.toFixed(0)
}

export default function PortalAnalyticsPanel({ county, state, onClose, onDataLoad }: PortalAnalyticsPanelProps) {
  const [data, setData] = useState<CountyDetailData | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedCounty, setSelectedCounty] = useState(county)
  const [selectedState, setSelectedState] = useState(state)

  useEffect(() => {
    if (!selectedCounty || !selectedState) return
    setLoading(true)
    setData(null)

    // Default to last 12 months
    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1)
    const dateFrom = twelveMonthsAgo.toISOString().split('T')[0]

    const params = new URLSearchParams({ county: selectedCounty, state: selectedState, date_from: dateFrom })

    fetchWithAuth(`${API_URL}/api/admin/county-sales-detail?${params}`)
      .then(r => {
        if (!r.ok) throw new Error('API error')
        return r.json()
      })
      .then(d => {
        if (d && d.townships) {
          setData(d)
          onDataLoad?.(d)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedCounty, selectedState])

  const overallAvgPPA = data && data.total_acres_sold > 0
    ? data.total_sale_amount / data.total_acres_sold
    : 0

  const townshipChartData = data?.townships
    ? Object.entries(data.townships)
        .map(([name, t]) => ({
          name,
          avgPricePerAcre: Math.round(t.avg_price_per_acre),
          acres: t.total_acres,
          tracts: t.tract_count,
        }))
        .sort((a, b) => b.avgPricePerAcre - a.avgPricePerAcre)
    : []

  const counties = selectedState ? getCountiesForState(selectedState) : []

  return (
    <motion.div
      initial={{ x: 480 }}
      animate={{ x: 0 }}
      exit={{ x: 480 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 right-0 bottom-0 w-[440px] z-[400] bg-gg-gray-900/95 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="pt-8 px-5 pb-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-semibold">Market Analytics</h2>
            <p className="text-xs text-gg-gray-400 mt-0.5">Based on the last 12 months of sales</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition"
          >
            <X size={16} className="text-gg-gray-400" />
          </button>
        </div>

        {/* County selector */}
        <div className="flex gap-2">
          <select
            value={selectedState}
            onChange={e => {
              setSelectedState(e.target.value)
              setSelectedCounty('')
            }}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gg-gray-300 focus:border-gg-pink outline-none"
          >
            <option value="">Select State</option>
            {US_STATES.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            value={selectedCounty}
            onChange={e => setSelectedCounty(e.target.value)}
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-gg-gray-300 focus:border-gg-pink outline-none"
            disabled={!selectedState}
          >
            <option value="">Select County</option>
            {counties.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="animate-spin text-gg-pink" size={28} />
          </div>
        ) : !selectedCounty || !selectedState ? (
          <div className="text-center text-gg-gray-500 py-12">
            <p className="text-sm">Select a state and county to view analytics</p>
          </div>
        ) : !data ? (
          <div className="text-center text-gg-gray-500 py-12">
            <p className="text-sm">No data available for this county</p>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                <div className="text-2xl font-bold">{data.total_listings}</div>
                <div className="text-xs text-gg-gray-400 mt-1">Total Sales</div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                <div className="text-2xl font-bold text-gg-pink">{formatAcres(data.total_acres_sold)}</div>
                <div className="text-xs text-gg-gray-400 mt-1">Acres Sold</div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                <div className="text-2xl font-bold">{formatCurrency(data.total_sale_amount)}</div>
                <div className="text-xs text-gg-gray-400 mt-1">Total Volume</div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                <div className="text-2xl font-bold">{overallAvgPPA > 0 ? formatCurrency(overallAvgPPA) : '—'}</div>
                <div className="text-xs text-gg-gray-400 mt-1">Avg $/Acre</div>
              </div>
            </div>

            {/* Township Bar Chart */}
            {townshipChartData.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3">Avg $/Acre by Township</h4>
                <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                  <ResponsiveContainer width="100%" height={Math.max(180, townshipChartData.length * 32)}>
                    <BarChart
                      layout="vertical"
                      data={townshipChartData}
                      margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                    >
                      <XAxis
                        type="number"
                        tick={{ fill: '#888888', fontSize: 10 }}
                        tickFormatter={(v) => '$' + v.toLocaleString()}
                        axisLine={{ stroke: '#2a2a2a' }}
                        tickLine={{ stroke: '#2a2a2a' }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fill: '#aaaaaa', fontSize: 11 }}
                        width={100}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#1a1a1a',
                          border: '1px solid #3a3a3a',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '12px',
                        }}
                        itemStyle={{ color: '#fff' }}
                        formatter={(value) => ['$' + Number(value).toLocaleString(), 'Avg $/Acre']}
                        labelStyle={{ color: '#d1d5db', fontWeight: 600 }}
                        cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                      />
                      <Bar dataKey="avgPricePerAcre" radius={[0, 4, 4, 0]}>
                        {townshipChartData.map((_, i) => (
                          <Cell key={i} fill="#f58cde" />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Township Details Table */}
            {townshipChartData.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3">Township Details</h4>
                <div className="bg-white/[0.03] rounded-xl overflow-hidden border border-white/5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="text-left px-4 py-2.5 text-xs font-medium text-gg-gray-400">Township</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-gg-gray-400">Acres</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-gg-gray-400">Avg $/Ac</th>
                        <th className="text-right px-4 py-2.5 text-xs font-medium text-gg-gray-400">Tracts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {townshipChartData.map((t, i) => (
                        <tr key={t.name} className={i > 0 ? 'border-t border-white/5' : ''}>
                          <td className="px-4 py-2 text-gg-gray-300">{t.name}</td>
                          <td className="px-4 py-2 text-right">{formatAcres(t.acres)}</td>
                          <td className="px-4 py-2 text-right text-gg-pink">{formatCurrency(t.avgPricePerAcre)}</td>
                          <td className="px-4 py-2 text-right text-gg-gray-400">{t.tracts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}