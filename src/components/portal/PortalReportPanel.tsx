'use client'

import NotesTimeline from '@/components/notes/NotesTimeline'
import NotesPrintChoice from '@/components/notes/NotesPrintChoice'
import { DEFAULT_NOTES_PRINT, noteKeyForRow, notesPrintBody, type NotesPrint } from '@/lib/notes'
import CardThumb from '@/components/CardThumb'
import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { X, Mail, Trash2, Check, Download, Bookmark } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import useFreshParcelFigures from '@/lib/useFreshParcelFigures'
import { saveReport } from '@/lib/configurableMapping'
import reportJobEnqueue from '@/lib/reportJobs'
import { formatAcres } from '@/lib/format'
import { formatAuctionDateTime } from '@/lib/auctionTime'
import { soilRatingLabel, perSoilRatingLabel, avgSoilRatingLabel } from '@/lib/soilRatingLabel'
import SubjectStrip from './SubjectStrip'
import CompSummaryGrid from '@/components/CompSummaryGrid'
import type { TractSaleData } from './PortalTractDetail'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

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

// Same signal as PortalComparablesReportPanel.tsx — `tracts` here is fed
// the same reportTracts state, which can hold parcel rows (tractId null,
// id possibly a real ll_uuid, a Regrid tile `path`, or the synthetic
// "parcel:lng,lat" click-point id). Only forward ll_uuid when it's a real
// Regrid UUID.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function asRealUuid(id: string | null | undefined): string | null {
  return id && UUID_RE.test(id) ? id : null
}

interface SubjectInfo {
  /** Owner 11/2: ids for the subject thumbnail (saved map / parcel). */
  subject_cm_id?: string | null
  subject_ll_uuid?: string | null
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

interface PortalReportPanelProps {
  tracts: TractSaleData[]
  onClose: () => void
  onRemoveTract: (id: string) => void
  /** Saves per-row notes (owner 2026-10-29); the page owns the rows. */
  onUpdateTract?: (id: string, patch: Partial<TractSaleData>) => void
  subjectInfo?: SubjectInfo | null
}

export default function PortalReportPanel({ tracts, onClose, onRemoveTract, onUpdateTract, subjectInfo }: PortalReportPanelProps) {
  // Owner 11/3: parcel rows re-read their figures from the one parcel record
  // every time this panel opens — never the copy taken when the row was added.
  useFreshParcelFigures(tracts, onUpdateTract)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [downloading, setDownloading] = useState(false)
  // Owner 11/10: what the report prints from each item's notes timeline.
  const [notesPrint, setNotesPrint] = useState<NotesPrint>(DEFAULT_NOTES_PRINT)

  // Build the request body shared by the email + download endpoints. Both
  // endpoints take the same shape; only the response handling differs.
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
    comparables: tracts.map(t => ({
      tract_id: t.tractId || t.id,
      county: t.county || '',
      state: t.state || '',
      total_acres: t.totalAcres,
      tillable_acres: t.tillableAcres,
      pct_tillable: t.pctTillable != null ? Math.round(t.pctTillable) : (t.tillableAcres && t.totalAcres ? Math.round((t.tillableAcres / t.totalAcres) * 100) : null),
      soil_rating: t.soilRating,
      price_per_acre: t.pricePerAcre,
      price_per_tillable_acre: t.tillableAcres && t.totalAcres && t.pricePerAcre && t.tillableAcres > 0
        ? (t.pricePerAcre * t.totalAcres) / t.tillableAcres : null,
      price_per_soil_rating: t.soilRating && t.pricePerAcre && t.soilRating > 0
        ? t.pricePerAcre / t.soilRating : null,
      sale_price: t.salePrice,
      auction_date: t.auctionDate,
      company_name: t.companyName,
      source: t.savedId ? 'saved' : t.tractId ? 'tract' : 'parcel',
      cm_id: t.savedId || null,
      // Owner 11/11: the parcel's real ll_uuid first (same rule as noteKeyForRow), so its notes print.
      ll_uuid: t.tractId || t.savedId ? null : (asRealUuid(t.llUuid) || asRealUuid(t.id)),
      owner: t.owner ?? null,
      latitude: t.latitude ?? null,
      longitude: t.longitude ?? null,
    })),
    // Notes timeline (owner 11/10): the server reads each item's timeline
    // itself; only the print choice goes up. Internal entries never print.
    notes_print: notesPrintBody(notesPrint),
  })


  // Fire-and-forget (owner, 2026-09-01: never trap the user on a
  // "Building..." button). This only enqueues the job — the floating
  // ReportJobsIndicator (root layout) owns polling, the download
  // hand-off, and the "sent" confirmation from here on, so the user is
  // free to close this panel or navigate away immediately.
  // Owner 11/3: save this report's recipe (subject + rows + notes) so it
  // can be reopened from Saved Projects. Email/Download save it too.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const handleSaveReport = async () => {
    if (saveState === 'saving' || tracts.length === 0) return
    setSaveState('saving')
    try {
      const body = buildReportBody() as any
      await saveReport({ subject: {
        subject_kind: body.subject_cm_id ? 'saved' : body.subject_ll_uuid ? 'parcel' : body.tract_id ? 'tract' : null,
        tract_id: body.tract_id, listing_id: body.listing_id, subject_ll_uuid: body.subject_ll_uuid, subject_cm_id: body.subject_cm_id,
        county: body.subject_county, state: body.subject_state, subject_tract_number: body.subject_tract_number,
        subject_company: body.subject_company, subject_auction_date: body.subject_auction_date,
      }, items: body.comparables })
      setSaveState('saved'); setTimeout(() => setSaveState('idle'), 2500)
    } catch { setSaveState('error'); setTimeout(() => setSaveState('idle'), 2500) }
  }
  const handleEmail = async () => {
    setSending(true)
    try {
      const res = await reportJobEnqueue('comparables', 'email', buildReportBody())
      if (!res.ok) {
        setSending(false)
        alert('Failed to send email')
        return
      }
      setSent(true)
      setTimeout(() => { setSending(false); setSent(false) }, 1500)
    } catch (e) {
      console.error('Email error:', e)
      setSending(false)
      alert('Failed to send email')
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await reportJobEnqueue('comparables', 'download', buildReportBody())
      if (!res.ok) {
        setDownloading(false)
        alert('Failed to generate PDF')
        return
      }
      setTimeout(() => setDownloading(false), 1500)
    } catch (e) {
      console.error('Download error:', e)
      setDownloading(false)
      alert('Failed to generate PDF')
    }
  }

  // Derive per-tract metrics
  const getPricePerTillable = (t: TractSaleData): number | null => {
    if (!t.tillableAcres || !t.totalAcres || !t.pricePerAcre || t.tillableAcres <= 0) return null
    return (t.pricePerAcre * t.totalAcres) / t.tillableAcres
  }

  const getPricePerSoil = (t: TractSaleData): number | null => {
    if (!t.soilRating || !t.pricePerAcre || t.soilRating <= 0) return null
    return t.pricePerAcre / t.soilRating
  }

  return (
    <motion.div
      initial={{ x: 500 }}
      animate={{ x: 0 }}
      exit={{ x: 500 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      data-report-dropzone
      className="fixed top-0 right-0 bottom-0 w-[480px] z-[400] bg-gg-gray-900/95 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="pt-8 px-5 pb-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Comparable Report</h2>
            <p className="text-xs text-gg-gray-400 mt-0.5">{tracts.length} sale{tracts.length !== 1 ? 's' : ''} selected</p>
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
        {tracts.length === 0 ? (
          <div className="text-center text-gg-gray-500 py-12">
            <p className="text-sm">No tracts selected</p>
          </div>
        ) : (
          <>
            {/* Subject Tract */}
            {subjectInfo && (
              <div className="bg-gg-pink/5 rounded-xl p-4 border border-gg-pink/20">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full bg-gg-pink" />
                  <span className="text-xs font-semibold text-gg-pink uppercase tracking-wider">Subject Tract</span>
                </div>
                {/* Owner 11/2: thumbnail of the subject tract / parcel / saved map */}
                {(() => { const k = subjectInfo.tract_id ? 'tract' : subjectInfo.subject_cm_id ? 'saved' : subjectInfo.subject_ll_uuid ? 'parcel' : null
                  const id = subjectInfo.tract_id || subjectInfo.subject_cm_id || subjectInfo.subject_ll_uuid || null
                  return k && id ? <div className="mb-2"><CardThumb kind={k} id={String(id)} size={96} className="w-full !h-24 object-cover" /></div> : null })()}
                <div className="text-sm font-bold mb-1">
                  {subjectInfo.county}, {subjectInfo.state}
                  {subjectInfo.subject_township ? ` · ${subjectInfo.subject_township}` : ''}
                </div>
                {subjectInfo.subject_land_type && (
                  <div className="text-xs text-gg-gray-400 mb-2">{subjectInfo.subject_land_type}</div>
                )}
                <SubjectStrip
                  totalAcres={subjectInfo.subject_acres}
                  tillableAcres={subjectInfo.subject_tillable_acres}
                  pctTillable={subjectInfo.subject_pct_tillable}
                  soilRating={subjectInfo.subject_soil_rating}
                  soilRatingType={subjectInfo.subject_soil_rating_type}
                  state={subjectInfo.state}
                />
                {subjectInfo.subject_auction_date && (
                  <p className="text-xs text-gg-gray-400 mt-2">
                    {formatAuctionDateTime(subjectInfo.subject_auction_date, subjectInfo.state)}
                    {subjectInfo.subject_company ? ` · ${subjectInfo.subject_company}` : ''}
                  </p>
                )}
              </div>
            )}

                        {/* Totals + averages — one shared block for every report surface (owner 2026-10-27) */}
            <CompSummaryGrid
              comps={tracts}
              title="Summary"
              soilLabel={avgSoilRatingLabel({ soil_rating_type: subjectInfo?.subject_soil_rating_type }, tracts)}
              perSoilLabel={'Avg ' + perSoilRatingLabel({ soil_rating_type: subjectInfo?.subject_soil_rating_type }, tracts)}
            />

            {/* Tract List */}
            <div>
              <h3 className="text-xs font-semibold text-gg-gray-400 uppercase tracking-wider mb-3">Selected Sales</h3>
              <div className="space-y-4">
                {tracts.map((t, i) => (
                  <div key={t.id} className="bg-[#161616] rounded-xl border border-white/15 shadow-[0_2px_10px_rgba(0,0,0,0.5)] overflow-hidden">
                    {/* Header row */}
                    <div className="flex items-start justify-between px-4 pt-3 pb-2">
                      <div>
                        <div className="text-sm font-semibold flex items-center gap-2">
                        <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1 rounded-md bg-[#FFD60A] text-black text-[11px] font-extrabold shrink-0 border-[1.5px] border-[#C9A100]">{i + 1}</span>
                        {t.county}, {t.state}
                      </div>
                        <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gg-gray-400">
                          {t.auctionDate && <span className="text-gg-pink font-medium">{fmtDate(t.auctionDate)}</span>}
                          {/* Tract rows show the listing company; parcel rows
                              (no company) show the Regrid owner instead. */}
                          {(t.companyName || t.owner) && <span>· {t.companyName || t.owner}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => onRemoveTract(t.id)}
                        className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center hover:bg-red-500/20 hover:text-red-400 transition text-gg-gray-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>

                    {/* Stats grid */}
                  {/* Saved/inline-rendered thumbnail (owner 2026-10-29): parcel rows key
                      on their ll_uuid, tract rows on tractId; hidden until loaded. */}
                  <div className="flex gap-3 px-4 pb-2 items-start">
                    <CardThumb kind={t.savedId ? 'saved' : t.tractId ? 'tract' : 'parcel'} id={t.savedId || t.tractId || t.llUuid || asRealUuid(t.id)} size={64} />
                    <div className="grid grid-cols-4 gap-2 flex-1 min-w-0">
                      <div>
                        <div className="text-[10px] text-gg-gray-500">Acres</div>
                        <div className="text-sm font-medium">{t.totalAcres ? formatAcres(t.totalAcres) : '—'}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gg-gray-500">$/Acre</div>
                        <div className="text-sm font-medium text-gg-pink">{fmt(t.pricePerAcre)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gg-gray-500">Tillable</div>
                        <div className="text-sm font-medium">
                          {t.pctTillable != null ? Math.round(t.pctTillable) + '%' : t.tillableAcres && t.totalAcres ? Math.round((t.tillableAcres / t.totalAcres) * 100) + '%' : '—'}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gg-gray-500">{soilRatingLabel(t)}</div>
                        <div className="text-sm font-medium">{t.soilRating ? fmtNum(t.soilRating) : '—'}</div>
                      </div>
                    </div>

                    {/* Derived pricing */}
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
                            <span className="text-gg-gray-500">{perSoilRatingLabel(t)}: </span>
                            <span className="text-white font-medium">{fmt(getPricePerSoil(t))}</span>
                          </div>
                        )}
                      </div>
                    )}
                  
                  {/* Notes timeline (owner 11/10): dated entries on the land itself —
                  
                      they follow this parcel/tract into every report and project. */}
                  
                  <div className="px-4 pb-3 pt-2 border-t border-white/5">
                  
                    <NotesTimeline compact theme="dark" itemKey={noteKeyForRow(t)}
                  
                      label={t.companyName || t.owner || null} county={t.county} state={t.state}
                  
                      latitude={t.latitude ?? null} longitude={t.longitude ?? null} />
                  
                  </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Sticky Footer — Download + Email buttons. Download is web-only;
          Email works for both web and mobile and produces the same PDF. */}
      {tracts.length > 0 && (
        <div className="border-t border-white/5 shrink-0">
        <NotesPrintChoice value={notesPrint} onChange={setNotesPrint} />
        <div className="px-5 py-4 shrink-0 flex gap-2">
          <button
            onClick={handleSaveReport}
            disabled={saveState === 'saving'}
            title="Save this report to Saved Projects so you can open it again"
            data-testid="save-report"
            className={`py-3 px-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition border ${
              saveState === 'saved'
                ? 'bg-green-500/20 text-green-400 border-green-500/30'
                : saveState === 'error'
                  ? 'bg-red-500/20 text-red-300 border-red-500/30'
                  : 'bg-white/5 border-white/15 text-white hover:bg-white/10'
            }`}
          >
            {saveState === 'saved' ? <><Check size={16} /> Saved</> : saveState === 'error' ? 'Not saved' : <><Bookmark size={16} /> Save</>}
          </button>
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
              <><Check size={16} /> Queued ✓</>
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
                  : 'bg-gg-pink text-gg-black hover:bg-gg-pink/80'
            }`}
          >
            {sent ? (
              <><Check size={16} /> Queued ✓</>
            ) : (
              <><Mail size={16} /> Email Report</>
            )}
          </button>
        </div>
        </div>
      )}
    </motion.div>
  )
}