'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { X, Mail, Loader2, Trash2, Check, Mountain, ExternalLink, Download } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import type { TractSaleData } from './PortalTractDetail'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const STATE_SOIL_LABELS: Record<string, string> = {
  IL: 'PI', IA: 'CSR2', IN: 'WAPI', MO: 'NCCPI', MN: 'CPI',
  NE: 'NCCPI', SD: 'PI', ND: 'PI', KS: 'NCCPI', OH: 'NCCPI',
  MI: 'NCCPI', WI: 'PI', KY: 'NCCPI', TN: 'NCCPI', WV: 'NCCPI', VA: 'NCCPI',
}

const STATE_NAME_TO_ABBR: Record<string, string> = {
  'ILLINOIS': 'IL', 'IOWA': 'IA', 'INDIANA': 'IN', 'MISSOURI': 'MO', 'MINNESOTA': 'MN',
  'NEBRASKA': 'NE', 'SOUTH DAKOTA': 'SD', 'NORTH DAKOTA': 'ND', 'KANSAS': 'KS', 'OHIO': 'OH',
  'MICHIGAN': 'MI', 'WISCONSIN': 'WI', 'KENTUCKY': 'KY', 'TENNESSEE': 'TN', 'WEST VIRGINIA': 'WV', 'VIRGINIA': 'VA',
}

function getSoilLabel(state?: string): string {
  if (!state) return 'Soil'
  const upper = state.toUpperCase()
  const abbr = STATE_NAME_TO_ABBR[upper] || upper
  return STATE_SOIL_LABELS[abbr] || 'Soil'
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
  // IDs needed by the backend to fetch polygon/image/DEM for the PDF
  listing_id?: string | null
  tract_id?: string | null
  subject_auction_date?: string | null
  subject_company?: string | null
}

interface PortalComparablesReportPanelProps {
  subjectInfo: SubjectInfo | null
  reportTracts: TractSaleData[]
  onRemoveTract: (id: string) => void
  onClose: () => void
  onView3DTerrain?: (tractId: string, tractName: string) => void
  onViewListing?: (listingId: string) => void
}

export default function PortalComparablesReportPanel({ subjectInfo, reportTracts, onRemoveTract, onClose, onView3DTerrain, onViewListing }: PortalComparablesReportPanelProps) {
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // avgTillable averages tillable acreage across every comp that reports it,
  // independent of price — gating it on price would silently drop comps from
  // an unrelated metric.
  const stats = useMemo(() => {
    const withPrice = reportTracts.filter(t => t.pricePerAcre)
    const withSoil = reportTracts.filter(t => t.soilRating && t.pricePerAcre)
    const withTillablePrice = reportTracts.filter(t => t.tillableAcres && t.totalAcres && t.pricePerAcre)
    const withTillable = reportTracts.filter(t => t.tillableAcres)
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
      avgPricePerTillable: withTillablePrice.length
        ? withTillablePrice.reduce((s, t) => s + ((t.pricePerAcre! * t.totalAcres!) / t.tillableAcres!), 0) / withTillablePrice.length : null,
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

  // Build the report request body. Same shape for email + PDF download —
  // backend uses tract_id + subject info to pull polygon/image/DEM and
  // render the subject card and overview map in the PDF.
  const buildReportBody = () => ({
    listing_id: subjectInfo?.listing_id || null,
    tract_id: subjectInfo?.tract_id || null,
    subject_county: subjectInfo?.county || null,
    subject_state: subjectInfo?.state || null,
    subject_acres: subjectInfo?.subject_acres ? String(subjectInfo.subject_acres) : null,
    subject_tillable_pct: subjectInfo?.subject_pct_tillable
      ? String(Math.round(subjectInfo.subject_pct_tillable)) + '%' : null,
    subject_soil_rating: subjectInfo?.subject_soil_rating ? String(subjectInfo.subject_soil_rating) : null,
    subject_auction_date: subjectInfo?.subject_auction_date || null,
    subject_company: subjectInfo?.subject_company || null,
    comparables: reportTracts.map(t => ({
      tract_id: t.tractId || t.id,
      county: t.county || '',
      state: t.state || '',
      total_acres: t.totalAcres,
      tillable_acres: t.tillableAcres,
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
  })

  const handleEmail = async () => {
    setSending(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/comparables/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildReportBody()),
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

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/comparables/report/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildReportBody()),
      })
      if (!res.ok) {
        alert('Failed to generate PDF')
        return
      }
      const blob = await res.blob()
      const dispo = res.headers.get('Content-Disposition') || ''
      const match = dispo.match(/filename="?([^";]+)"?/i)
      const filename = match?.[1] || 'ground-goat-comp-report.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Download error:', e)
      alert('Failed to generate PDF')
    }
    setDownloading(false)
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
            onClick={(e) => { e.stopPropagation(); onClose() }}
            className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition relative z-10"
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
                  {(onView3DTerrain || (onViewListing && t.listingId && t.companyName)) && (
                    <div className="flex gap-2 px-4 pb-3 pt-2 border-t border-white/5">
                      {onView3DTerrain && (t.tractId || t.id) && (
                        <button
                          onClick={() => onView3DTerrain((t.tractId || t.id)!, `${t.county}, ${t.state}`)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 hover:text-white rounded-md border border-white/10 transition"
                        >
                          <Mountain size={12} />
                          3D Map
                        </button>
                      )}
                      {onViewListing && t.listingId && t.companyName && (
                        <button
                          onClick={() => onViewListing(t.listingId!)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-gg-pink bg-gg-pink/10 hover:bg-gg-pink/20 rounded-md border border-gg-pink/30 transition"
                        >
                          <ExternalLink size={12} />
                          View Details
                        </button>
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

      {/* Footer — Download (web) + Email buttons. Both produce the same PDF
          via the backend; mobile callers only see Email since this panel
          is web-only. */}
      {reportTracts.length > 0 && (
        <div className="px-5 py-4 border-t border-white/5 shrink-0 flex gap-2">
          <button
            onClick={handleDownload}
            disabled={downloading || sending}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition border ${
              downloading
                ? 'bg-white/5 border-white/10 text-white/60 cursor-wait'
                : 'bg-white/5 border-white/15 text-white hover:bg-white/10'
            }`}
          >
            {downloading ? (
              <><Loader2 size={16} className="animate-spin" /> Building PDF...</>
            ) : (
              <><Download size={16} /> Download PDF</>
            )}
          </button>
          <button
            onClick={handleEmail}
            disabled={sending || sent || downloading}
            className={`flex-1 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition ${
              sent
                ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                : sending
                  ? 'bg-gg-pink/50 text-white/70 cursor-wait'
                  : 'bg-gg-pink text-white hover:bg-gg-pink/80'
            }`}
          >
            {sent ? (
              <><Check size={16} /> Sent!</>
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
