'use client'

/**
 * SavedTractPanel — right-hand slide-out for one of the user's saved tracts
 * (Map It). Owner 11/2: tapping a saved tract shows all of its details and
 * lets them build comp reports, "very similar to the Tract Details panel".
 *
 * Same size, surface, tiles and button row as LandDetailPanel (ACTION_BTN is
 * imported from it). Self-fetches GET /api/mapping/parcels/{id}/detail; every
 * field is optional and a missing one simply leaves its row out.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mail, Download, Check, Loader2, BarChart3, Plus, FolderOpen, Trash2, X } from 'lucide-react'
import reportJobEnqueue from '@/lib/reportJobs'
import {
  getSavedTractDetail, queueAndDownloadReport, REPORT_BUSY_LABEL, REPORT_LABEL,
  type ReportKind, type SavedTractDetail,
} from '@/lib/configurableMapping'
import useMapReports from '@/lib/useMapReports'
import useSlide from '@/lib/useSlide'
import { buildSavedReportRow, savedReportId } from '@/lib/savedTractRow'
import { soilRatingLabel } from '@/lib/soilRatingLabel'
import { formatAcres } from '@/lib/format'
import { DetailRow, Section } from './parcelDetailFields'
import { ACTION_BTN, LAND_DETAIL_PANEL_WIDTH } from './LandDetailPanel'

const PINK = '#F58CDE'
const MAP_REPORT_KINDS: ReportKind[] = ['soil_map', 'ground_goat', 'elevation_3d']

interface Props {
  /** Saved-map id to show; null = closed. */
  tractId: string | null
  onClose: () => void
  /** Gates Report / Download / Email / Comps exactly like LandDetailPanel. */
  canUseReports?: boolean
  /** Comparables mode: the action row collapses to the Report toggle. */
  compMode?: boolean
  reportIds?: Set<string> | null
  onToggleReport?: (row: any) => void
  onEditInMapIt: (d: SavedTractDetail) => void
  onOpenProjects: (projectId: string) => void
  onFindComparables?: (p: { saved_id: string; county: string; state: string; lat: number | null; lng: number | null }) => void
  /** Open the parcel panel for one of this tract's source parcels. */
  onShowParcel: (llUuid: string, at: { lat: number; lng: number } | null) => void
}

const fmtAc = (n: any): string | null => {
  const v = typeof n === 'number' ? n : Number(n)
  return isFinite(v) && v > 0 ? `${formatAcres(v)} ac` : null
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{
      flex: '1 1 30%', textAlign: 'center', padding: '14px 6px',
      borderRadius: 14, border: '1px solid #D6D3DC', background: '#FBF7FB', minWidth: 0,
    }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.45)' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: PINK, marginTop: 4 }}>{value}</div>
      {sub ? <div style={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(0,0,0,0.45)', marginTop: 3 }}>{sub}</div> : null}
    </div>
  )
}

const smallPink: React.CSSProperties = {
  padding: '7px 10px', borderRadius: 999, border: '1.5px solid #C563AD', background: PINK,
  color: '#0a0a0a', fontSize: 12, fontWeight: 700, cursor: 'pointer',
}
const iconBtn: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.06)',
  color: '#444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
}

export default function SavedTractPanel({
  tractId, onClose, canUseReports = true, compMode = false, reportIds, onToggleReport,
  onEditInMapIt, onOpenProjects, onFindComparables, onShowParcel,
}: Props) {
  const isOpen = tractId !== null
  const { mounted, shown } = useSlide(isOpen, 220)
  // Keep the last id while the exit animation plays.
  const [shownId, setShownId] = useState<string | null>(tractId)
  useEffect(() => { if (tractId) setShownId(tractId) }, [tractId])
  const id = tractId ?? shownId

  const [detail, setDetail] = useState<SavedTractDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)
  const load = useCallback(async (tid: string) => {
    const my = ++seq.current
    setDetail(null); setError(null); setLoading(true)
    try {
      const d = await getSavedTractDetail(tid)
      if (my === seq.current) setDetail(d)
    } catch (e: any) {
      if (my === seq.current) setError(e?.message || 'Could not load this tract.')
    } finally { if (my === seq.current) setLoading(false) }
  }, [])
  useEffect(() => { if (tractId) void load(tractId) }, [tractId, load])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const projectId = detail?.project?.id ?? null
  const projectName = detail?.project?.name ?? null
  const reports = useMapReports(isOpen && !!detail, projectId, detail?.id ?? null, projectName)

  // ── footer actions ──
  const [downloading, setDownloading] = useState(false)
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [actionError, setActionError] = useState<string | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  useEffect(() => { setEmailStatus('idle'); setActionError(null); setDownloading(false) }, [tractId])

  const reportId = id ? savedReportId(id) : null
  const isInReport = !!(reportId && reportIds?.has(reportId))
  const handleToggleReport = () => { if (detail && onToggleReport) onToggleReport(buildSavedReportRow(detail)) }

  // The Ground Goat Report PDF: queue, wait for the worker, download. Keeps
  // going if the panel is closed meanwhile (see queueAndDownloadReport).
  const handleDownload = async () => {
    if (!detail || downloading) return
    setDownloading(true); setActionError(null)
    try {
      await queueAndDownloadReport({ parcelId: detail.id }, 'ground_goat', projectName)
    } catch (e: any) {
      if (mountedRef.current) setActionError(e?.message || 'Something went wrong — try again')
    } finally { if (mountedRef.current) setDownloading(false) }
  }

  // Emails a one-row Comparables report for this saved tract (source "saved").
  const handleEmail = async () => {
    if (!detail) return
    const row = buildSavedReportRow(detail)
    setEmailStatus('sending'); setActionError(null)
    try {
      const res = await reportJobEnqueue('comparables', 'email', {
        listing_id: null, tract_id: null, subject_county: null, subject_state: null,
        subject_acres: null, subject_tillable_pct: null, subject_soil_rating: null,
        subject_auction_date: null, subject_company: null,
        comparables: [{
          tract_id: row.id, county: row.county, state: row.state,
          total_acres: row.totalAcres, tillable_acres: row.tillableAcres,
          pct_tillable: row.pctTillable != null ? Math.round(row.pctTillable) : null,
          soil_rating: row.soilRating, price_per_acre: null, price_per_tillable_acre: null,
          price_per_soil_rating: null, sale_price: null, auction_date: null, company_name: null,
          source: 'saved', cm_id: detail.id, ll_uuid: null, owner: null,
          latitude: row.latitude, longitude: row.longitude, notes: null,
        }],
      })
      if (!res.ok) {
        let m = 'Something went wrong — try again'
        if (res.status === 403) m = 'Not available for your account'
        else if (res.status === 429 || res.status === 400) {
          try { m = (await res.json())?.detail || m } catch { /* keep default */ }
        }
        setEmailStatus('error'); setActionError(m)
        return
      }
      setEmailStatus('sent')
      setTimeout(() => setEmailStatus('idle'), 1500)
    } catch {
      setEmailStatus('error'); setActionError('Something went wrong — try again')
    }
  }

  if (!mounted) return null

  const acres = detail?.acres ?? null
  const tillable = detail?.tillable_acres ?? null
  const pctTillable = acres && tillable != null ? Math.round((tillable / acres) * 100) : null
  const ratingLabel = soilRatingLabel({ soil_rating_type: detail?.soil?.rating_type })
  const rating = detail?.soil?.rating ?? null
  const place = [detail?.county ? `${detail.county} County` : '', detail?.state || ''].filter(Boolean).join(', ')
  const multi = (detail?.project_tract_count ?? 0) > 1
  const landRows: [string, number | null | undefined][] = [
    ['Tillable', detail?.tillable_acres], ['Pasture', detail?.pasture_acres], ['Timber', detail?.timber_acres],
    ['Water', detail?.water_acres], ['Other', detail?.other_acres],
  ]
  const soils = detail?.soil?.breakdown || []
  const sources = detail?.source_parcels || []
  const lat = detail?.centroid?.lat ?? null
  const lng = detail?.centroid?.lng ?? null

  // ── reports section ──
  const rrows = reports.rows
  const btn = (kind: ReportKind, projectLevel: boolean) => {
    const working = reports.queuing === `${kind}:${projectLevel ? '' : detail?.id || ''}`
      || rrows.some((r) => r.kind === kind && (projectLevel ? !r.parcel_id : r.parcel_id === detail?.id)
        && (r.status === 'queued' || r.status === 'running'))
    return (
      <button key={kind} type="button" style={{ ...smallPink, opacity: working ? 0.6 : 1 }}
              disabled={working || !!reports.queuing}
              onClick={() => void reports.queue(kind, projectLevel)}>
        {working ? (REPORT_BUSY_LABEL[kind] || 'Working…') : (REPORT_LABEL[kind] || kind)}
      </button>
    )
  }

  return (
    <div
      data-gg-saved-tract-panel
      role="dialog"
      aria-label="Saved tract"
      style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: LAND_DETAIL_PANEL_WIDTH, maxWidth: '100%',
        zIndex: 400,
        background: 'linear-gradient(180deg,#FFFFFF 0%,#F7F7FA 45%,#E8E8EF 100%)',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
        display: 'flex', flexDirection: 'column',
        transform: shown && isOpen ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 220ms cubic-bezier(0.2,0,0.1,1)',
        pointerEvents: isOpen ? 'auto' : 'none',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div style={{ flexShrink: 0, padding: '16px 44px 4px 18px', position: 'relative' }}>
        <div style={{ fontSize: 18.5, fontWeight: 700, lineHeight: '24px', color: '#1a1a1a', wordBreak: 'break-word' }}>
          {detail ? (detail.name || 'Untitled') : 'Saved tract'}
        </div>
        {detail?.project?.name && (
          <div style={{ fontSize: 12.5, color: 'rgba(0,0,0,0.55)', marginTop: 2, lineHeight: 1.3, wordBreak: 'break-word' }}>
            {detail.project.name}{multi ? ` · ${detail.project_tract_count} tracts` : ''}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 9, marginTop: 9 }}>
          {acres != null && (
            <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.4px', color: '#111214' }}>{fmtAc(acres)}</span>
          )}
          {place && <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)' }}>{place}</span>}
        </div>
        <button
          onClick={onClose} aria-label="Close panel"
          style={{
            position: 'absolute', top: 10, right: 10, width: 28, height: 28, borderRadius: '50%', border: 'none',
            background: 'rgba(0,0,0,0.06)', color: '#444', cursor: 'pointer', display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 14, lineHeight: 1, padding: 0,
          }}
        >✕</button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 24 }}>
        {loading && (
          <div style={{ padding: 16, color: 'rgba(0,0,0,0.45)', fontSize: 12, fontStyle: 'italic', textAlign: 'center' }}>
            Loading tract details…
          </div>
        )}
        {error && (
          <div style={{ padding: '16px 18px', color: '#d33', fontSize: 12.5 }}>
            {error}{' '}
            <button type="button" onClick={() => id && void load(id)}
                    style={{ background: 'none', border: 'none', color: '#a0307f', textDecoration: 'underline', cursor: 'pointer', fontSize: 12.5, padding: 0 }}>
              Try again
            </button>
          </div>
        )}

        {detail && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '14px 18px 4px' }}>
              <StatCard label="Acres" value={acres != null ? formatAcres(acres) : '—'} />
              <StatCard label="Tillable"
                        value={tillable != null ? formatAcres(tillable) : '—'}
                        sub={pctTillable != null ? `${pctTillable}% of acres` : undefined} />
              <StatCard label="Soil rating"
                        value={rating != null ? String(rating) : '—'}
                        sub={rating != null && detail.soil?.rating_type ? ratingLabel : undefined} />
            </div>

            {landRows.some(([, v]) => fmtAc(v)) && (
              <Section title="Land types">
                {landRows.map(([label, v]) => fmtAc(v) ? <DetailRow key={label} label={label} value={fmtAc(v)!} /> : null)}
              </Section>
            )}

            {soils.length > 0 && (
              <Section title={`Soils (${ratingLabel})`}>
                <div style={{ display: 'flex', gap: 8, fontSize: 10, fontWeight: 700, color: 'rgba(0,0,0,0.4)', padding: '0 0 3px', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                  <span style={{ flex: 1 }}>Soil</span>
                  <span style={{ width: 58, textAlign: 'right' }}>Acres</span>
                  <span style={{ width: 44, textAlign: 'right' }}>% till.</span>
                  <span style={{ width: 38, textAlign: 'right' }}>Rating</span>
                </div>
                {soils.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <span style={{ flex: 1, minWidth: 0, color: '#1a1a1a', fontWeight: 500, wordBreak: 'break-word' }}>{s.name || 'Soil'}</span>
                    <span style={{ width: 58, textAlign: 'right', color: '#1a1a1a' }}>{s.acres != null ? formatAcres(s.acres) : '—'}</span>
                    <span style={{ width: 44, textAlign: 'right', color: 'rgba(0,0,0,0.6)' }}>{s.pct_of_tillable != null ? `${Math.round(s.pct_of_tillable)}%` : '—'}</span>
                    <span style={{ width: 38, textAlign: 'right', fontWeight: 700, color: '#1a1a1a' }}>{s.rating != null ? s.rating : '—'}</span>
                  </div>
                ))}
              </Section>
            )}

            {sources.length > 0 && (
              <Section title="Source parcels">
                {sources.map((p) => (
                  <div key={p.ll_uuid} style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <span style={{ flex: 1, minWidth: 0, color: '#1a1a1a', fontWeight: 600, wordBreak: 'break-word' }}>
                      {p.owner || 'Unknown owner'}
                      {p.parcelnumb ? <span style={{ color: '#888', fontWeight: 500 }}> · {p.parcelnumb}</span> : null}
                    </span>
                    <span style={{ color: 'rgba(0,0,0,0.6)', flexShrink: 0 }}>{fmtAc(p.acres) || ''}</span>
                    <button type="button" onClick={() => onShowParcel(p.ll_uuid, lat != null && lng != null ? { lat, lng } : null)}
                            style={{ background: 'none', border: 'none', color: '#a0307f', cursor: 'pointer', fontSize: 11.5, textDecoration: 'underline', padding: 0, flexShrink: 0 }}>
                      Show Parcel Data
                    </button>
                  </div>
                ))}
              </Section>
            )}

            {/* Reports */}
            <Section title="Reports">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {btn('aerial', true)}
                {MAP_REPORT_KINDS.map((k) => btn(k, false))}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>
                The Aerial Map prints the whole project.
              </div>
              {reports.pending && (
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>Building… this updates on its own.</div>
              )}
              {rrows.map((r) => {
                const label = REPORT_LABEL[r.kind] || r.kind
                const pend = r.status === 'queued' || r.status === 'running'
                return (
                  <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                      <div style={{ fontSize: 11, color: r.status === 'failed' ? '#d33' : 'rgba(0,0,0,0.45)' }}>
                        {pend ? (REPORT_BUSY_LABEL[r.kind] || 'Working…') : r.status === 'failed' ? (r.error || 'Failed') : 'Ready'}
                        {' · '}{new Date(r.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                    {r.status === 'done' && r.ready && (
                      <button type="button" style={iconBtn} aria-label="Download" onClick={() => void reports.download(r)}><Download size={14} /></button>
                    )}
                    <button type="button" style={iconBtn} aria-label="Delete report" disabled={reports.deleting === r.id}
                            onClick={() => void reports.remove(r, label)}><Trash2 size={14} /></button>
                  </div>
                )
              })}
              {reports.msg && (
                <div style={{ fontSize: 11.5, color: '#d33', marginTop: 6 }}>
                  {reports.msg}{' '}
                  <button type="button" aria-label="Dismiss" onClick={() => reports.setMsg(null)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#d33', padding: 0, verticalAlign: 'middle' }}><X size={11} /></button>
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      {/* Footer */}
      {detail && (
        <div style={{ flexShrink: 0, borderTop: '1px solid rgba(0,0,0,0.06)', padding: 12, background: '#fff' }}>
          {!compMode && (
            <button
              type="button"
              onClick={() => onEditInMapIt(detail)}
              style={{
                width: '100%', marginBottom: 8, padding: '12px 14px', borderRadius: 999,
                border: '1.5px solid #000', background: PINK, color: '#0a0a0a',
                fontSize: 14, fontWeight: 700, cursor: 'pointer', letterSpacing: 0.2,
              }}
            >
              Edit in Map It
            </button>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            {onToggleReport && (canUseReports || compMode) && (
              <button
                onClick={handleToggleReport}
                title={isInReport ? 'Remove from report' : 'Add to report'}
                style={ACTION_BTN}
              >
                {isInReport ? <Check size={16} /> : <Plus size={16} />}
                {isInReport ? 'Added' : 'Report'}
              </button>
            )}
            {canUseReports && !compMode && (
              <>
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  title="Download Ground Goat Report"
                  style={{ ...ACTION_BTN, cursor: downloading ? 'wait' : 'pointer', opacity: downloading ? 0.8 : 1 }}
                >
                  {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {downloading ? 'Building' : 'Download'}
                </button>
                <button
                  onClick={handleEmail}
                  disabled={emailStatus === 'sending' || emailStatus === 'sent'}
                  title="Email Tract"
                  style={{ ...ACTION_BTN, cursor: (emailStatus === 'sending' || emailStatus === 'sent') ? 'default' : 'pointer', opacity: emailStatus === 'sending' ? 0.8 : 1 }}
                >
                  {emailStatus === 'sent' ? <Check size={16} />
                    : emailStatus === 'sending' ? <Loader2 size={16} className="animate-spin" />
                    : <Mail size={16} />}
                  {emailStatus === 'sent' ? 'Queued' : emailStatus === 'sending' ? 'Sending' : 'Email'}
                </button>
              </>
            )}
            {onFindComparables && canUseReports && !compMode && (
              <button
                onClick={() => onFindComparables({
                  saved_id: detail.id,
                  county: detail.county || '', state: detail.state || '', lat, lng,
                })}
                title="Find Comps"
                style={ACTION_BTN}
              >
                <BarChart3 size={16} /> Comps
              </button>
            )}
            {!compMode && projectId && (
              <button onClick={() => onOpenProjects(projectId)} title="Open in Saved Projects" style={ACTION_BTN}>
                <FolderOpen size={16} /> Projects
              </button>
            )}
          </div>
          {actionError && <p style={{ fontSize: 11, color: '#d33', margin: '8px 0 0' }}>{actionError}</p>}
        </div>
      )}
    </div>
  )
}
