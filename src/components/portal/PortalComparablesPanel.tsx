'use client'

import { useState, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import { X, Loader2, MapPin, Calendar, Building2, ArrowUpDown, SlidersHorizontal } from 'lucide-react'
import { formatAcres } from '@/lib/format'
import { SOIL_FILTER_ENABLED } from '@/lib/featureFlags'
import { formatAuctionDateTime } from '@/lib/auctionTime'
import SubjectStrip from './SubjectStrip'

interface Comparable {
  id: string
  county: string
  state: string
  total_acres: number
  tillable_acres?: number
  pct_tillable?: number
  soil_rating?: number
  csr2?: number
  soil_rating_type?: string | null
  price_per_acre: number
  price_per_tillable_acre?: number
  sale_price?: number
  auction_date?: string
  company_name?: string
  similarity_score?: number
  primary_image_url?: string
  township?: string
  days_ago?: number
  latitude?: number
  longitude?: number
}

interface ComparablesSummary {
  count: number
  avg_price_per_acre: number
  median_price_per_acre: number
  min_price_per_acre: number
  max_price_per_acre: number
  avg_acres: number
}

interface SearchCriteria {
  county: string
  state: string
  subject_latitude?: number
  subject_longitude?: number
  subject_acres?: number
  subject_tillable_acres?: number
  subject_pct_tillable?: number
  subject_soil_rating?: number
  subject_soil_rating_type?: string | null
  subject_township?: string
  subject_tract_number?: number
  subject_land_type?: string
  subject_auction_date?: string | null
  subject_company?: string | null
  listing_id?: string | null
}

interface PortalComparablesPanelProps {
  data: {
    comparables: Comparable[]
    all_tracts?: Comparable[]
    summary: ComparablesSummary
    search_criteria: SearchCriteria
  } | null
  loading?: boolean
  onClose: () => void
  onSelectComparable?: (comp: Comparable) => void
  onToggleReport?: (comp: Comparable) => void
  isInReport?: (id: string) => boolean
  reportCount?: number
  onViewReport?: () => void
  onVisibleTractsChange?: (ids: Set<string>) => void
}

type SortOption = 'similarity' | 'distance' | 'price_asc' | 'price_desc' | 'acres' | 'soil_rating' | 'date'

// State-based soil rating label defaults
const STATE_SOIL_LABELS: Record<string, string> = {
  IL: 'PI', IA: 'CSR2', IN: 'WAPI', MO: 'NCCPI', MN: 'CPI',
  NE: 'NCCPI', SD: 'PI', ND: 'PI', KS: 'NCCPI', OH: 'NCCPI',
  MI: 'NCCPI', WI: 'PI', KY: 'NCCPI', TN: 'NCCPI', WV: 'NCCPI', VA: 'NCCPI',
}

function getSoilLabel(soilRatingType?: string | null, state?: string): string {
  if (soilRatingType) return soilRatingType.toUpperCase()
  if (state) return STATE_SOIL_LABELS[state.toUpperCase()] || 'Soil'
  return 'Soil'
}

function getSoilValue(comp: { soil_rating?: number; csr2?: number; soil_rating_type?: string | null; state?: string }): number | null {
  // Use the appropriate field based on type
  if (comp.soil_rating != null) return Number(comp.soil_rating)
  if (comp.csr2 != null) return Number(comp.csr2)
  return null
}

function formatCurrency(value?: number | null): string {
  if (!value) return '—'
  if (value >= 1000000) return '$' + (value / 1000000).toFixed(1) + 'M'
  if (value >= 1000) return '$' + Math.round(value / 1000).toLocaleString() + 'K'
  return '$' + Math.round(value).toLocaleString()
}

function formatDate(dateString?: string): string {
  if (!dateString) return '—'
  const d = new Date(dateString)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959 // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'similarity', label: 'Similarity' },
  { value: 'distance', label: 'Distance' },
  { value: 'price_desc', label: '$/Acre (High)' },
  { value: 'price_asc', label: '$/Acre (Low)' },
  { value: 'soil_rating', label: 'Soil Rating' },
  { value: 'acres', label: 'Acreage' },
  { value: 'date', label: 'Most Recent' },
]

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=400'

export default function PortalComparablesPanel({ data, loading, onClose, onSelectComparable, onToggleReport, isInReport, reportCount, onViewReport, onVisibleTractsChange }: PortalComparablesPanelProps) {
  const [sortBy, setSortBy] = useState<SortOption>('similarity')
  const [showFilters, setShowFilters] = useState(false)
  const [filterCounty, setFilterCounty] = useState<string>('')
  const [filterMinTillable, setFilterMinTillable] = useState('')
  const [filterMaxTillable, setFilterMaxTillable] = useState('')
  const [filterMinSoil, setFilterMinSoil] = useState('')
  const [filterMaxSoil, setFilterMaxSoil] = useState('')
  const [filterMaxDistance, setFilterMaxDistance] = useState('')

  const subjectLat = data?.search_criteria?.subject_latitude
  const subjectLng = data?.search_criteria?.subject_longitude

  // Use scored comparables for similarity, all_tracts for other sorts
  const sourceData = useMemo(() => {
    if (!data) return []
    if (sortBy === 'similarity') return data.comparables || []
    // For other sorts, use the full dataset if available
    return data.all_tracts && data.all_tracts.length > 0 ? data.all_tracts : data.comparables || []
  }, [data, sortBy])

  // Compute distances
  const comparablesWithDistance = useMemo(() => {
    return sourceData.map(c => ({
      ...c,
      _distance: (subjectLat && subjectLng && c.latitude && c.longitude)
        ? haversineDistance(subjectLat, subjectLng, c.latitude, c.longitude)
        : null,
    }))
  }, [sourceData, subjectLat, subjectLng])

  // Get unique counties for filter
  const counties = useMemo(() => {
    const set = new Set(comparablesWithDistance.map(c => c.county))
    return Array.from(set).sort()
  }, [comparablesWithDistance])

  // Filter
  const filtered = useMemo(() => {
    let result = comparablesWithDistance
    if (filterCounty) result = result.filter(c => c.county === filterCounty)
    if (filterMinTillable) result = result.filter(c => (c.pct_tillable ?? 0) >= Number(filterMinTillable))
    if (filterMaxTillable) result = result.filter(c => (c.pct_tillable ?? 100) <= Number(filterMaxTillable))
    if (SOIL_FILTER_ENABLED && filterMinSoil) result = result.filter(c => (c.soil_rating ?? c.csr2 ?? 0) >= Number(filterMinSoil))
    if (SOIL_FILTER_ENABLED && filterMaxSoil) result = result.filter(c => (c.soil_rating ?? c.csr2 ?? 999) <= Number(filterMaxSoil))
    if (filterMaxDistance) result = result.filter(c => (c._distance ?? 999) <= Number(filterMaxDistance))
    return result
  }, [comparablesWithDistance, filterCounty, filterMinTillable, filterMaxTillable, filterMinSoil, filterMaxSoil, filterMaxDistance])

  // Sort
  const sorted = useMemo(() => {
    const arr = [...filtered]
    switch (sortBy) {
      case 'similarity': arr.sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0)); break
      case 'distance': arr.sort((a, b) => (a._distance ?? 999) - (b._distance ?? 999)); break
      case 'price_asc': arr.sort((a, b) => a.price_per_acre - b.price_per_acre); break
      case 'price_desc': arr.sort((a, b) => b.price_per_acre - a.price_per_acre); break
      case 'soil_rating': arr.sort((a, b) => (b.soil_rating ?? b.csr2 ?? 0) - (a.soil_rating ?? a.csr2 ?? 0)); break
      case 'acres': arr.sort((a, b) => b.total_acres - a.total_acres); break
      case 'date': arr.sort((a, b) => (a.days_ago ?? 999) - (b.days_ago ?? 999)); break
    }
    return arr.slice(0, 50)
  }, [filtered, sortBy])

  // Notify parent of visible tract IDs whenever sorted list changes
  useEffect(() => {
    if (onVisibleTractsChange && sorted.length > 0) {
      const ids = new Set(sorted.map(c => String((c as any).tract_id || c.id)))
      onVisibleTractsChange(ids)
    }
  }, [sorted, onVisibleTractsChange])

  if (!data && !loading) return null

  const sc = data?.search_criteria

  return (
    <motion.div
      initial={{ x: -500 }}
      animate={{ x: 0 }}
      exit={{ x: -500 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 left-0 bottom-0 w-[480px] z-[510] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="pt-8 px-5 pb-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Comparable Sales</h2>
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
            {/* Subject Tract Card */}
            {sc && (
              <div className="bg-gg-pink/5 rounded-xl p-4 border-2 border-gg-pink/30">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-gg-pink animate-pulse" />
                  <span className="text-xs font-bold text-gg-pink uppercase tracking-wider">Subject Tract</span>
                </div>
                <div className="text-sm font-semibold mb-1">
                  {sc.county}, {sc.state}
                  {sc.subject_township && <span className="text-gg-gray-400 font-normal"> · {sc.subject_township}</span>}
                </div>
                {sc.subject_land_type && (
                  <div className="text-xs text-gg-gray-400 mb-2">{sc.subject_land_type}</div>
                )}
                <SubjectStrip
                  totalAcres={sc.subject_acres}
                  tillableAcres={sc.subject_tillable_acres}
                  pctTillable={sc.subject_pct_tillable}
                  soilRating={sc.subject_soil_rating}
                  soilRatingType={sc.subject_soil_rating_type}
                  state={sc.state}
                />
                {sc.subject_auction_date && (
                  <p className="text-xs text-gg-gray-400 mt-2">
                    {formatAuctionDateTime(sc.subject_auction_date, sc.state)}
                    {sc.subject_company ? ` · ${sc.subject_company}` : ''}
                  </p>
                )}
              </div>
            )}

            {/* Sort & Filter Bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 bg-white/[0.03] rounded-lg border border-white/5 px-3 py-1.5">
                <ArrowUpDown size={12} className="text-gg-gray-400" />
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as SortOption)}
                  className="bg-transparent text-xs text-gg-gray-300 outline-none flex-1 cursor-pointer"
                >
                  {SORT_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition ${
                  showFilters
                    ? 'bg-gg-pink/10 border-gg-pink/30 text-gg-pink'
                    : 'bg-white/[0.03] border-white/5 text-gg-gray-400 hover:text-white'
                }`}
              >
                <SlidersHorizontal size={12} />
                Filter
              </button>
              <span className="text-xs text-gg-gray-500">{sorted.length} results</span>
            </div>

            {/* Filter Panel */}
            {showFilters && (
              <div className="bg-white/[0.03] rounded-xl border border-white/5 p-4 space-y-3">
                <div>
                  <label className="text-[10px] text-gg-gray-400 uppercase tracking-wider">County</label>
                  <select
                    value={filterCounty}
                    onChange={e => setFilterCounty(e.target.value)}
                    className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gg-gray-300 outline-none"
                  >
                    <option value="">All Counties</option>
                    {counties.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className={SOIL_FILTER_ENABLED ? "grid grid-cols-2 gap-3" : ""}>
                  <div>
                    <label className="text-[10px] text-gg-gray-400 uppercase tracking-wider">Max Distance (mi)</label>
                    <input
                      type="number"
                      value={filterMaxDistance}
                      onChange={e => setFilterMaxDistance(e.target.value)}
                      placeholder="Any"
                      className="w-full mt-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-gg-gray-300 outline-none"
                    />
                  </div>
                  {SOIL_FILTER_ENABLED && (
                    <div>
                      <label className="text-[10px] text-gg-gray-400 uppercase tracking-wider">Soil Rating</label>
                      <div className="flex gap-1 mt-1">
                        <input type="number" value={filterMinSoil} onChange={e => setFilterMinSoil(e.target.value)} placeholder="Min" className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gg-gray-300 outline-none" />
                        <input type="number" value={filterMaxSoil} onChange={e => setFilterMaxSoil(e.target.value)} placeholder="Max" className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gg-gray-300 outline-none" />
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-[10px] text-gg-gray-400 uppercase tracking-wider">% Tillable Range</label>
                  <div className="flex gap-1 mt-1">
                    <input type="number" value={filterMinTillable} onChange={e => setFilterMinTillable(e.target.value)} placeholder="Min" className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gg-gray-300 outline-none" />
                    <input type="number" value={filterMaxTillable} onChange={e => setFilterMaxTillable(e.target.value)} placeholder="Max" className="w-full bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gg-gray-300 outline-none" />
                  </div>
                </div>
                <button
                  onClick={() => { setFilterCounty(''); setFilterMaxDistance(''); setFilterMinSoil(''); setFilterMaxSoil(''); setFilterMinTillable(''); setFilterMaxTillable('') }}
                  className="text-xs text-gg-pink hover:text-gg-pink/80 transition"
                >
                  Clear All Filters
                </button>
              </div>
            )}

            {/* Comparable List */}
            <div className="space-y-3">
              {sorted.map(comp => {
                const inReport = isInReport?.(comp.id) ?? false
                return (
                  <div
                    key={comp.id}
                    className={`bg-white/[0.03] rounded-xl overflow-hidden border transition ${
                      inReport ? 'border-gg-pink/40' : 'border-white/5 hover:border-gg-pink/20'
                    }`}
                  >
                    {/* Image */}
                    {comp.primary_image_url && (
                      <div className="relative h-28 w-full bg-gg-gray-800">
                        <img
                          src={comp.primary_image_url}
                          alt={`${comp.county}, ${comp.state}`}
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE }}
                        />
                        {comp.similarity_score != null && (
                          <span className={`absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                            comp.similarity_score >= 70 ? 'bg-green-500/15 text-green-400 backdrop-blur-sm' :
                            comp.similarity_score >= 40 ? 'bg-yellow-500/15 text-yellow-400 backdrop-blur-sm' :
                            'bg-gray-500/15 text-gray-400 backdrop-blur-sm'
                          }`}>
                            {Math.round(comp.similarity_score)}% match
                          </span>
                        )}
                      </div>
                    )}

                    <div className="p-4 cursor-pointer" onClick={() => onSelectComparable?.(comp)}>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="text-sm font-semibold hover:text-gg-pink transition">
                            {formatAcres(comp.total_acres)} ac — {comp.county}
                          </div>
                          <div className="text-xs text-gg-gray-400 mt-0.5 flex items-center gap-1">
                            <MapPin size={10} />
                            {comp.county}, {comp.state}
                            {comp.township && <span>· {comp.township}</span>}
                            {comp._distance != null && (
                              <span className="text-gg-gray-500">· {Math.round(comp._distance)} mi</span>
                            )}
                          </div>
                        </div>
                        {!comp.primary_image_url && comp.similarity_score != null && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${
                            comp.similarity_score >= 70 ? 'bg-green-500/15 text-green-400' :
                            comp.similarity_score >= 40 ? 'bg-yellow-500/15 text-yellow-400' :
                            'bg-gray-500/15 text-gray-400'
                          }`}>
                            {Math.round(comp.similarity_score)}%
                          </span>
                        )}
                      </div>

                      {/* Land Stats */}
                      <div className="grid grid-cols-4 gap-2 mt-3 pt-3 border-t border-white/5">
                        <div>
                          <div className="text-[10px] text-gg-gray-500">Acres</div>
                          <div className="text-sm font-medium">{formatAcres(comp.total_acres)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gg-gray-500">Tillable</div>
                          <div className="text-sm font-medium">{comp.pct_tillable ? Math.round(comp.pct_tillable) + '%' : '—'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gg-gray-500">{getSoilLabel(comp.soil_rating_type, comp.state)}</div>
                          <div className="text-sm font-medium">{getSoilValue(comp) ?? '—'}</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-gg-gray-500">$/Acre</div>
                          <div className="text-sm font-bold text-gg-pink">{formatCurrency(comp.price_per_acre)}</div>
                        </div>
                      </div>

                      {/* Sale Pricing */}
                      {comp.sale_price && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pt-2 border-t border-white/5">
                          <div className="text-[10px]">
                            <span className="text-gg-gray-500">Sale: </span>
                            <span className="text-white font-medium">{formatCurrency(comp.sale_price)}</span>
                          </div>
                          {(() => {
                            const ppTillAc = comp.price_per_tillable_acre
                              ?? ((comp.tillable_acres && comp.total_acres && comp.price_per_acre && comp.tillable_acres > 0)
                                    ? (comp.price_per_acre * comp.total_acres) / comp.tillable_acres
                                    : null)
                            return ppTillAc ? (
                              <div className="text-[10px]">
                                <span className="text-gg-gray-500">$/Till Ac: </span>
                                <span className="text-white font-medium">{formatCurrency(ppTillAc)}</span>
                              </div>
                            ) : null
                          })()}
                          {getSoilValue(comp) && comp.price_per_acre ? (
                            <div className="text-[10px]">
                              <span className="text-gg-gray-500">$/{getSoilLabel(comp.soil_rating_type, comp.state)}: </span>
                              <span className="text-white font-medium">{formatCurrency(comp.price_per_acre / getSoilValue(comp)!)}</span>
                            </div>
                          ) : null}
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/5 text-[10px] text-gg-gray-400">
                        {comp.company_name && (
                          <span className="flex items-center gap-1 truncate">
                            <Building2 size={10} />
                            {comp.company_name}
                          </span>
                        )}
                        <span className="flex items-center gap-1 shrink-0">
                          <Calendar size={10} />
                          {formatDate(comp.auction_date)}
                        </span>
                      </div>
                    </div>

                    {/* Add to Report button */}
                    {onToggleReport && (
                      <button
                        onClick={() => onToggleReport(comp)}
                        className={`w-full py-2.5 text-xs font-bold border-t transition ${
                          inReport
                            ? 'bg-white/10 text-gg-pink border-gg-pink/30'
                            : 'bg-gg-pink text-white border-gg-pink hover:bg-gg-pink/80'
                        }`}
                      >
                        {inReport ? '✓ In Report' : '+ Add to Report'}
                      </button>
                    )}
                  </div>
                )
              })}

              {sorted.length === 0 && (
                <div className="text-center text-gg-gray-500 py-8">
                  <p className="text-sm">No comparables match your filters</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}