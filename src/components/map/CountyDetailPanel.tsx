'use client'

import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { COMPANY_COLORS } from './CountySalesMap'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface CompanyDetail {
  company_id: string
  acres_sold: number
  sale_amount: number
  listing_count: number
  avg_price_per_acre: number
}

interface TownshipDetail {
  total_acres: number
  total_sale_price: number
  tract_count: number
  avg_price_per_acre: number
}

interface CountyDetailData {
  county: string
  state: string
  companies: Record<string, CompanyDetail>
  townships: Record<string, TownshipDetail>
  total_listings: number
  total_acres_sold: number
  total_sale_amount: number
}

interface CountyDetailPanelProps {
  county: string | null
  state: string | null
  onClose: () => void
  dateFrom?: string
  dateTo?: string
  listingType?: string
  statuses?: string
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(1) + 'M'
  if (amount >= 1000) return '$' + (amount / 1000).toFixed(0) + 'K'
  return '$' + Math.round(amount).toLocaleString()
}

function formatAcres(acres: number): string {
  if (acres >= 1000) return (acres / 1000).toFixed(1) + 'K'
  return acres.toFixed(0)
}

export default function CountyDetailPanel({
  county, state, onClose, dateFrom, dateTo, listingType, statuses
}: CountyDetailPanelProps) {
  const [data, setData] = useState<CountyDetailData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!county || !state) return
    setLoading(true)
    setData(null)

    const params = new URLSearchParams({ county, state })
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    if (listingType) params.set('listing_type', listingType)
    if (statuses) params.set('statuses', statuses)

    fetchWithAuth(`${API_URL}/api/admin/county-sales-detail?${params}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [county, state, dateFrom, dateTo, listingType, statuses])

  if (!county) return null

  // Township data for bar chart
  const townshipChartData = data
    ? Object.entries(data.townships)
        .map(([name, t]) => ({
          name,
          avgPricePerAcre: Math.round(t.avg_price_per_acre),
          acres: t.total_acres,
          tracts: t.tract_count,
        }))
        .sort((a, b) => b.avgPricePerAcre - a.avgPricePerAcre)
    : []

  // Company breakdown sorted by acres descending
  const companyRows = data
    ? Object.entries(data.companies)
        .sort((a, b) => b[1].acres_sold - a[1].acres_sold)
    : []

  // Calculate overall avg price per acre
  const overallAvgPPA = data && data.total_acres_sold > 0
    ? data.total_sale_amount / data.total_acres_sold
    : 0

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-gg-gray-900 border-l border-gg-gray-700 z-50 overflow-y-auto shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-gg-gray-900 border-b border-gg-gray-700 p-6 flex items-center justify-between z-10">
          <div>
            <h3 className="text-xl font-bold text-white">{county} County, {state}</h3>
            <p className="text-gg-gray-400 text-sm">Sales Analytics</p>
          </div>
          {/* Canonical pane close button — match PortalListPanel etc. */}
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition shrink-0"
          >
            <X size={16} className="text-gg-gray-400" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-gg-pink" size={32} />
          </div>
        ) : data ? (
          <div className="p-6 space-y-6">
            {/* Summary stat cards */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="bg-gg-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-white">
                  {data.total_listings}
                </div>
                <div className="text-xs text-gg-gray-400 mt-1">Sales</div>
              </div>
              <div className="bg-gg-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-gg-pink">
                  {formatAcres(data.total_acres_sold)}
                </div>
                <div className="text-xs text-gg-gray-400 mt-1">Acres Sold</div>
              </div>
              <div className="bg-gg-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-white">
                  {formatCurrency(data.total_sale_amount)}
                </div>
                <div className="text-xs text-gg-gray-400 mt-1">Total Volume</div>
              </div>
              <div className="bg-gg-gray-800 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-white">
                  {overallAvgPPA > 0 ? formatCurrency(overallAvgPPA) : '—'}
                </div>
                <div className="text-xs text-gg-gray-400 mt-1">Avg $/Acre</div>
              </div>
            </div>

            {/* Company breakdown */}
            {companyRows.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-white mb-3">Sales by Company</h4>
                <div className="space-y-2">
                  {companyRows.map(([name, comp], i) => (
                    <div key={name} className="bg-gg-gray-800 rounded-lg p-3 flex items-center gap-3">
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ background: COMPANY_COLORS[i % COMPANY_COLORS.length] }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-white truncate">{name}</div>
                        <div className="text-xs text-gg-gray-400">
                          {comp.listing_count} sale{comp.listing_count !== 1 ? 's' : ''} &middot; {comp.avg_price_per_acre > 0 ? formatCurrency(comp.avg_price_per_acre) + '/ac' : '—'}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-sm font-medium text-white">
                          {formatAcres(comp.acres_sold)} ac
                        </div>
                        <div className="text-xs text-gg-gray-400">
                          {formatCurrency(comp.sale_amount)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Township avg price/acre bar chart */}
            {townshipChartData.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-white mb-3">
                  Avg $/Acre by Township
                </h4>
                <div className="bg-gg-gray-800 rounded-xl p-4">
                  <ResponsiveContainer width="100%" height={Math.max(200, townshipChartData.length * 36)}>
                    <BarChart
                      layout="vertical"
                      data={townshipChartData}
                      margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
                    >
                      <XAxis
                        type="number"
                        tick={{ fill: '#888888', fontSize: 11 }}
                        tickFormatter={(v) => '$' + v.toLocaleString()}
                        axisLine={{ stroke: '#3a3a3a' }}
                        tickLine={{ stroke: '#3a3a3a' }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ fill: '#aaaaaa', fontSize: 12 }}
                        width={110}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#1a1a1a',
                          border: '1px solid #3a3a3a',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '13px',
                        }}
                        formatter={(value) => ['$' + Number(value).toLocaleString(), 'Avg $/Acre']}
                        labelStyle={{ color: '#d1d5db', fontWeight: 600 }}
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

            {/* Township details table */}
            {townshipChartData.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-white mb-3">Township Details</h4>
                <div className="bg-gg-gray-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gg-gray-700">
                        <th className="text-left p-3 text-gg-gray-400 font-medium">Township</th>
                        <th className="text-right p-3 text-gg-gray-400 font-medium">Acres</th>
                        <th className="text-right p-3 text-gg-gray-400 font-medium">Avg $/Ac</th>
                        <th className="text-right p-3 text-gg-gray-400 font-medium">Volume</th>
                        <th className="text-right p-3 text-gg-gray-400 font-medium">Tracts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {townshipChartData.map((twp) => (
                        <tr key={twp.name} className="border-b border-gg-gray-700/50 last:border-0">
                          <td className="p-3 text-white">{twp.name}</td>
                          <td className="p-3 text-right text-gg-gray-300">{formatAcres(twp.acres)}</td>
                          <td className="p-3 text-right text-gg-pink font-medium">
                            {twp.avgPricePerAcre > 0 ? '$' + twp.avgPricePerAcre.toLocaleString() : '—'}
                          </td>
                          <td className="p-3 text-right text-gg-gray-300">
                            {formatCurrency(twp.acres * twp.avgPricePerAcre)}
                          </td>
                          <td className="p-3 text-right text-gg-gray-400">{twp.tracts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {data.total_listings === 0 && (
              <div className="text-center py-12">
                <p className="text-gg-gray-400 text-lg">No sales data for this county</p>
                <p className="text-gg-gray-500 text-sm mt-1">Try adjusting the date range filters</p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </>
  )
}
