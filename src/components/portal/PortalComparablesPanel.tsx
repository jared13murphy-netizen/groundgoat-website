'use client'

import { motion } from 'framer-motion'
import { X, Loader2, MapPin, Calendar, Building2 } from 'lucide-react'

interface Comparable {
  id: string
  county: string
  state: string
  total_acres: number
  tillable_acres?: number
  pct_tillable?: number
  soil_rating?: number
  price_per_acre: number
  price_per_tillable_acre?: number
  sale_price?: number
  auction_date?: string
  company_name?: string
  similarity_score?: number
  primary_image_url?: string
  township?: string
  days_ago?: number
}

interface ComparablesSummary {
  count: number
  avg_price_per_acre: number
  median_price_per_acre: number
  min_price_per_acre: number
  max_price_per_acre: number
  avg_acres: number
}

interface PortalComparablesPanelProps {
  data: {
    comparables: Comparable[]
    summary: ComparablesSummary
    search_criteria: {
      county: string
      state: string
    }
  } | null
  loading?: boolean
  onClose: () => void
  onSelectComparable?: (comp: Comparable) => void
}

function formatCurrency(value: number): string {
  if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M'
  if (value >= 1000) return '$' + Math.round(value / 1000).toLocaleString() + 'K'
  return '$' + Math.round(value).toLocaleString()
}

function formatDate(dateString?: string): string {
  if (!dateString) return '—'
  const d = new Date(dateString)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PortalComparablesPanel({ data, loading, onClose, onSelectComparable }: PortalComparablesPanelProps) {
  if (!data && !loading) return null

  return (
    <motion.div
      initial={{ x: -500 }}
      animate={{ x: 0 }}
      exit={{ x: -500 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 left-0 bottom-0 w-[480px] z-[400] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="pt-20 px-5 pb-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-lg font-semibold">Comparable Sales</h2>
            {data?.search_criteria && (
              <p className="text-xs text-gg-gray-400 mt-0.5">
                {data.search_criteria.county}, {data.search_criteria.state} area
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition"
          >
            <X size={16} className="text-gg-gray-400" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="animate-spin text-gg-pink" size={28} />
          </div>
        ) : !data || data.comparables.length === 0 ? (
          <div className="text-center text-gg-gray-500 py-12">
            <p className="text-sm">No comparable sales found</p>
          </div>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                <div className="text-xl font-bold">{data.summary.count}</div>
                <div className="text-[10px] text-gg-gray-400 uppercase">Comparables</div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                <div className="text-xl font-bold text-gg-pink">{formatCurrency(data.summary.avg_price_per_acre)}/ac</div>
                <div className="text-[10px] text-gg-gray-400 uppercase">Avg $/Acre</div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                <div className="text-xl font-bold">{formatCurrency(data.summary.min_price_per_acre)}</div>
                <div className="text-[10px] text-gg-gray-400 uppercase">Min $/Acre</div>
              </div>
              <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
                <div className="text-xl font-bold">{formatCurrency(data.summary.max_price_per_acre)}</div>
                <div className="text-[10px] text-gg-gray-400 uppercase">Max $/Acre</div>
              </div>
            </div>

            {/* Comparable List */}
            <div>
              <h3 className="text-sm font-semibold mb-3 text-gg-gray-300">
                Sorted by Similarity
              </h3>
              <div className="space-y-3">
                {data.comparables.map(comp => (
                  <button
                    key={comp.id}
                    onClick={() => onSelectComparable?.(comp)}
                    className="w-full text-left bg-white/[0.03] rounded-xl p-4 border border-white/5 hover:bg-white/[0.06] hover:border-gg-pink/20 transition group"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-semibold group-hover:text-gg-pink transition">
                          {Math.round(comp.total_acres)} ac — {comp.county}
                        </div>
                        <div className="text-xs text-gg-gray-400 mt-0.5 flex items-center gap-1">
                          <MapPin size={10} />
                          {comp.county}, {comp.state}
                          {comp.township && <span>· {comp.township}</span>}
                        </div>
                      </div>
                      {comp.similarity_score != null && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          comp.similarity_score >= 70 ? 'bg-green-500/15 text-green-400' :
                          comp.similarity_score >= 40 ? 'bg-yellow-500/15 text-yellow-400' :
                          'bg-gray-500/15 text-gray-400'
                        }`}>
                          {Math.round(comp.similarity_score)}% match
                        </span>
                      )}
                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/5">
                      <div>
                        <div className="text-xs text-gg-gray-500">$/Acre</div>
                        <div className="text-sm font-medium text-gg-pink">{formatCurrency(comp.price_per_acre)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gg-gray-500">Acres</div>
                        <div className="text-sm font-medium">{Math.round(comp.total_acres)}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gg-gray-500">Tillable</div>
                        <div className="text-sm font-medium">{comp.pct_tillable ? Math.round(comp.pct_tillable) + '%' : '—'}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gg-gray-500">CSR2</div>
                        <div className="text-sm font-medium">{comp.soil_rating ?? '—'}</div>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/5 text-xs text-gg-gray-400">
                      {comp.company_name && (
                        <span className="flex items-center gap-1">
                          <Building2 size={10} />
                          {comp.company_name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Calendar size={10} />
                        {formatDate(comp.auction_date)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}