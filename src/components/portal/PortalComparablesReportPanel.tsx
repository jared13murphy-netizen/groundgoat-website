'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { X, Mail, Loader2, Trash2, Check } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import type { TractSaleData } from './PortalTractDetail'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const STATE_SOIL_LABELS: Record<string, string> = {
  IL: 'PI', IA: 'CSR2', IN: 'WAPI', MO: 'NCCPI', MN: 'CPI',
  NE: 'NCCPI', SD: 'PI', ND: 'PI', KS: 'NCCPI', OH: 'NCCPI',
  MI: 'NCCPI', WI: 'PI', KY: 'NCCPI', TN: 'NCCPI', WV: 'NCCPI', VA: 'NCCPI',
}

function getSoilLabel(state?: string): string {
  if (state) return STATE_SOIL_LABELS[state.toUpperCase()] || 'Soil'
  return 'Soil'
}

function fmt(val?: number | null): string {
  if (!val) return '—'
  return '$' + Math.round(val).toLocaleString()
}

function fmtNum(val?: number | null): string {
  if (!val) return '—'
  return val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function fmtDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

interface SubjectInfo {
  county?: string
  state?: string
  subject_acres?: number
  subject_tillable_acres?: number
  subject_pct_tillable?: number
  subject_soil_rating?: number
  subject_soil_rating_type?: string | null
  subject_township?: string
  subject_land_type?: string
}

interface PortalComparablesReportPanelProps {
  subjectInfo: SubjectInfo | null
  reportTracts: TractSaleData[]
  onRemoveTract: (id: string) => void
  onClose: () => void
}

export default function PortalComparablesReportPanel({ subjectInfo, reportTracts, onRemoveTract, onClose }: PortalComparablesReportPanelProps) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const stats = useMemo(() => {
    const withPrice = reportTracts.filter(t => t.pricePerAcre)
    const withSoil = reportTracts.filter(t => t.soilRating && t.pricePerAcre)
    const withTillable = reportTracts.filter(t => t.tillableAcres && t.totalAcres && t.pricePerAcre)
    const withAcres = reportTracts.filter(t => t.totalAcres)

    return {
      avgPricePerAcre: withPrice.length
        ? withPrice.reduce((s, t) => s + (t.pricePerAcre || 0), 0) / withPrice.length : null,
      avgAcres: withAcres.length
        ? withAcres.reduce((s, t) => s + (t.totalAcres || 0), 0) / withAcres.length : null,
      avgTillable: withTillable.length
        ? withTillable.reduce((s, t) => s + (t.tillableAcres || 0), 0) / withTillable.length : null,
      avgSoilRating: withSoil.length
        ? withSoil.reduce((s, t) => s + (t.soilRating || 0), 0) / withSoil.length : null,
      avgPricePerTillable: withTillable.length
        ? withTillable.reduce((s, t) => s + ((t.pricePerAcre! * t.totalAcres!) / t.tillableAcres!), 0) / withTillable.length : null,
      avgPricePerSoil: withSoil.length
        ? withSoil.reduce((s, t) => s + (t.pricePerAcre! / t.soilRating!), 0) / withSoil.length : null,
    }
  }, [reportTracts])

  const getPricePerTillable = (t: TractSaleData): number | null => {
    if (!t.tillableAcres || !t.totalAcres || !t.pricePerAcre || t.tillableAcres <= 0) return null
    return (t.pricePerAcre * t.totalAcres) / t.tillableAcres
  }

  const getPricePerSoil = (t: TractSaleData): number | null => {
    if (!t.soilRating || !t.pricePerAcre || t.soilRating <= 0) return null
    return t.pricePerAcre / t.soilRating
  }

  const handleEmail = async () => {
    setSending(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/comparables/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comparables: reportTracts.map(t => ({
            county: t.county || '',
            state: t.state || '',
            total_acres: t.totalAcres,
            pct_tillable: t.tillableAcres && t.totalAcres ? Math.round((t.tillableAcres / t.totalAcres) * 100) : null,
            soil_rating: t.soilRating,
            price_per_acre: t.pricePerAcre,
            price_per_tillable_acre: t.tillableAcres && t.totalAcres && t.pricePerAcre && t.tillableAcres > 0
              ? (t.pricePerAcre * t.totalAcres) / t.tillableAcres : null,
            price_per_soil_rating: t.soilRating && t.pricePerAcre && t.soilRating > 0
              ? t.pricePerAcre / t.soilRating : null,
            sale_price: t.salePrice,
            auction_date: t.auctionDate,
            company_name: t.companyName,
          })),
        }),
      })
      if (!res.ok) {
        alert('Failed to send email')
      } else {
        setSent(true)
      }
    } catch (e) {
      console.error('Email error:', e)
      alert('Failed to send email')
    }
    setSending(false)
  }

  return (
    <motion.div
      initial={{ x: -420 }}
      animate={{ x: 0 }}
      exit={{ x: -420 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 left-0 bottom-0 w-[400px] z-[400] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="pt-8 px-5 pb-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Comparable Sales</h2>
            <p className="text-xs text-gg-gray-400 mt-0.5">
              Click tracts on the map to build your report
            </p>
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
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Subject Tract */}
        {subjectInfo && (
          <div className="bg-gg-pink/5 rounded-xl p-4 border border-gg-pink/20">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-gg-pink" />
              <span className="text-xs font-semibold text-gg-pink uppercase tracking-wider">Subject Tract</span>
            </div>
            <div className="text-sm font-bold mb-1">
              {subjectInfo.county}, {subjectInfo.state}
              {subjectInfo.subject_township ? ` \u00B7 ${subjectInfo.subject_township}` : ''}
            </div>
            <div className="grid grid-cols-4 gap-3 mt-3">
              {subjectInfo.subject_acres ? (
                <div>
                  <div className="text-[10px] text-gg-gray-400">Acres</div>
                  <div className="text-sm font-semibold">{Math.round(subjectInfo.subject_acres)}</div>
                </div>
              ) : null}
              {subjectInfo.subject_pct_tillable ? (
                <div>
                  <div className="text-[10px] text-gg-gray-400">Tillable</div>
                  <div className="text-sm font-semibold">{Math.round(subjectInfo.subject_pct_tillable)}%</div>
                </div>
              ) : null}
              {subjectInfo.subject_soil_rating ? (
                <div>
                  <div className="text-[10px] text-gg-gray-400">{subjectInfo.subject_soil_rating_type || getSoilLabel(subjectInfo.state)}</div>
                  <div className="text-sm font-semibold">{subjectInfo.subject_soil_rating}</div>
                </div>
              ) : null}
              {subjectInfo.subject_land_type ? (
                <div>
                  <div className="text-[10px] text-gg-gray-400">Type</div>
                  <div className="text-sm font-semibold">{subjectInfo.subject_land_type}</div>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {/* Live Analytics Cards — always visible */}
        <div>
          <h3 className="text-xs font-semibold text-gg-gray-400 uppercase tracking-wider mb-3">
            Report Summary {reportTracts.length > 0 ? `(${reportTracts.length} sale${reportTracts.length !== 1 ? 's' : ''})` : ''}
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-lg font-bold text-gg-pink">{fmt(stats.avgPricePerAcre)}</div>
              <div className="text-[10px] text-gg-gray-400 mt-0.5">Avg $/Acre</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-lg font-bold text-gg-pink">{fmt(stats.avgPricePerTillable)}</div>
              <div className="text-[10px] text-gg-gray-400 mt-0.5">Avg $/Till Ac</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-lg font-bold text-gg-pink">{fmt(stats.avgPricePerSoil)}</div>
              <div className="text-[10px] text-gg-gray-400 mt-0.5">Avg $/Soil</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-lg font-bold">{stats.avgAcres ? fmtNum(stats.avgAcres) : '—'}</div>
              <div className="text-[10px] text-gg-gray-400 mt-0.5">Avg Acres</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-lg font-bold">{stats.avgTillable ? fmtNum(stats.avgTillable) : '—'}</div>
              <div className="text-[10px] text-gg-gray-400 mt-0.5">Avg Tillable</div>
            </div>
            <div className="bg-white/[0.03] rounded-xl p-3 border border-white/5">
              <div className="text-lg font-bold">{stats.avgSoilRating ? fmtNum(stats.avgSoilRating) : '—'}</div>
              <div className="text-[10px] text-gg-gray-400 mt-0.5">Avg Soil Rating</div>
            </div>
          </div>
        </div>

        {/* Selected Tracts */}
        {reportTracts.length > 0 ? (
          <div>
            <h3 className="text-xs font-semibold text-gg-gray-400 uppercase tracking-wider mb-3">Selected Sales</h3>
            <div className="space-y-3">
              {reportTracts.map(t => (
                <div key={t.id} className="bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden">
                  <div className="flex items-start justify-between px-4 pt-3 pb-2">
                    <div>
                      <div className="text-sm font-semibold">{t.county}, {t.state}</div>
                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gg-gray-400">
                        {t.auctionDate && <span className="text-gg-pink font-medium">{fmtDate(t.auctionDate)}</span>}
                        {t.companyName && <span>{'\u00B7'} {t.companyName}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => onRemoveTract(t.id)}
                      className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center hover:bg-red-500/20 hover:text-red-400 transition text-gg-gray-500"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="grid grid-cols-4 gap-2 px-4 pb-2">
                    <div>
                      <div className="text-[10px] text-gg-gray-500">Acres</div>
                      <div className="text-sm font-medium">{t.totalAcres ? Math.round(t.totalAcres) : '—'}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gg-gray-500">$/Acre</div>
                      <div className="text-sm font-medium text-gg-pink">{fmt(t.pricePerAcre)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gg-gray-500">Tillable</div>
                      <div className="text-sm font-medium">
                        {t.tillableAcres && t.totalAcres ? Math.round((t.tillableAcres / t.totalAcres) * 100) + '%' : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gg-gray-500">{getSoilLabel(t.state)}</div>
                      <div className="text-sm font-medium">{t.soilRating ? fmtNum(t.soilRating) : '—'}</div>
                    </div>
                  </div>
                  {(t.salePrice || getPricePerTillable(t) || getPricePerSoil(t)) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 pt-1 border-t border-white/5 mt-1">
                      {t.salePrice && (
                        <div className="text-[10px]">
                          <span className="text-gg-gray-500">Sale: </span>
                          <span className="text-white font-medium">{fmt(t.salePrice)}</span>
                        </div>
                      )}
                      {getPricePerTillable(t) && (
                        <div className="text-[10px]">
                          <span className="text-gg-gray-500">$/Till Ac: </span>
                          <span className="text-white font-medium">{fmt(getPricePerTillable(t))}</span>
                        </div>
                      )}
                      {getPricePerSoil(t) && (
                        <div className="text-[10px]">
                          <span className="text-gg-gray-500">$/{getSoilLabel(t.state)}: </span>
                          <span className="text-white font-medium">{fmt(getPricePerSoil(t))}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-gg-gray-500">Click sold tracts on the map</p>
            <p className="text-xs text-gg-gray-600 mt-1">then tap &quot;Add to Report&quot; to build your report</p>
          </div>
        )}
      </div>

      {/* Footer — Email Button */}
      {reportTracts.length > 0 && (
        <div className="px-5 py-4 border-t border-white/5 shrink-0">
          <button
            onClick={handleEmail}
            disabled={sending || sent}
            className={`w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition ${
              sent
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : sending
                  ? 'bg-gg-pink/50 text-white/70 cursor-wait'
                  : 'bg-gg-pink text-white hover:bg-gg-pink/80'
            }`}
          >
            {sent ? (
              <><Check size={16} /> Report Sent!</>
            ) : sending ? (
              <><Loader2 size={16} className="animate-spin" /> Sending...</>
            ) : (
              <><Mail size={16} /> Email Report</>
            )}
          </button>
        </div>
      )}
    </motion.div>
  )
}
