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
import { Check, BarChart3, Plus, FolderOpen, Layers, FileText } from 'lucide-react'
import { getSavedTractDetail, type SavedTractDetail } from '@/lib/configurableMapping'
import { openReports } from '@/lib/reportsPanel'
import useSlide from '@/lib/useSlide'
import { buildSavedReportRow, savedReportId } from '@/lib/savedTractRow'
import { soilRatingLabel } from '@/lib/soilRatingLabel'
import { formatAcres } from '@/lib/format'
import { savedTractFigures, fmtFigAcres, fmtFigPct, fmtFigRating, UPDATING } from '@/lib/parcelFigures'
import { DetailRow, Section } from './parcelDetailFields'
import { ACTION_BTN, LAND_DETAIL_PANEL_WIDTH } from './LandDetailPanel'
import NotesTimeline from '@/components/notes/NotesTimeline'

const PINK = '#F58CDE'

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

  const reportId = id ? savedReportId(id) : null
  const isInReport = !!(reportId && reportIds?.has(reportId))
  const handleToggleReport = () => { if (detail && onToggleReport) onToggleReport(buildSavedReportRow(detail)) }

  if (!mounted) return null

  // Figures from the ONE helper (src/lib/parcelFigures.ts): the server's
  // `figures`, or the old-API numbers — never computed here.
  const fig = savedTractFigures(detail)
  const acres = fig.acres
  const tillable = fig.tillableAcres
  const pctTillable = fig.pctTillable
  const ratingLabel = soilRatingLabel({ soil_rating_type: fig.ratingLabel })
  const rating = fig.rating
  const remeasuring = fig.remeasuring
  const place = [detail?.county ? `${detail.county} County` : '', detail?.state || ''].filter(Boolean).join(', ')
  // v2 (owner 11/10): a farm can be in many projects — shown as chips; a tap
  // opens Saved Projects on that project. Older API: `project` as one chip.
  const farmProjects: { id: string; name: string }[] = detail?.projects?.length
    ? detail.projects.map((p) => ({ id: p.id, name: p.name || 'Project' }))
    : detail?.project?.id ? [{ id: detail.project.id, name: detail.project.name || 'Project' }] : []
  const multi = farmProjects.length === 1 && (detail?.project_tract_count ?? 0) > 1
  const landRows: [string, number | null | undefined][] = [
    ['Tillable', fig.tillableAcres], ['Timber', fig.timberAcres],
    ['Water', fig.waterAcres], ['Other', detail?.other_acres],
  ]
  const soils = detail?.soil?.breakdown || []
  const sources = detail?.source_parcels || []
  const lat = detail?.centroid?.lat ?? null
  const lng = detail?.centroid?.lng ?? null

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
        {farmProjects.length > 0 && (
          <div data-testid="saved-tract-project-chips" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, marginTop: 6 }}>
            {farmProjects.map((p) => (
              <button
                key={p.id} type="button" disabled={compMode}
                onClick={() => onOpenProjects(p.id)}
                title={compMode ? p.name : `Open ${p.name} in Saved Projects`}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, maxWidth: '100%',
                  padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                  background: 'rgba(245,140,222,0.16)', border: '1px solid rgba(197,99,173,0.45)', color: '#1a1a1a',
                  cursor: compMode ? 'default' : 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                <FolderOpen size={12} style={{ flex: 'none' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
              </button>
            ))}
            {multi && (
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>{detail?.project_tract_count} tracts</span>
            )}
          </div>
        )}
        {/* Acres are shown once, in the Acres card below (owner 11/5). */}
        {place && (
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>{place}</div>
        )}
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
              <StatCard label="Acres" value={fmtFigAcres(acres) ?? '—'} />
              <StatCard label="Tillable"
                        value={remeasuring ? UPDATING : fmtFigAcres(tillable) ?? '—'}
                        sub={!remeasuring && pctTillable != null ? `${fmtFigPct(pctTillable)} of acres` : undefined} />
              <StatCard label="Soil rating"
                        value={remeasuring ? UPDATING : fmtFigRating(rating) ?? '—'}
                        sub={!remeasuring && rating != null && fig.ratingLabel ? ratingLabel : undefined} />
            </div>

            {(remeasuring || landRows.some(([, v]) => fmtAc(v))) && (
              <Section title="Land types">
                {landRows.map(([label, v]) => remeasuring && label !== 'Other'
                  ? <DetailRow key={label} label={label} value={UPDATING} />
                  : fmtAc(v) ? <DetailRow key={label} label={label} value={fmtAc(v)!} /> : null)}
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

            {/* Notes timeline (owner 11/10): this tract's own entries plus the
                history of the parcels / auction tract it was saved from. */}
            <div data-testid="saved-tract-notes" style={{ padding: '12px 18px 4px' }}>
              <NotesTimeline theme="light" itemKey={`cm:${detail.id}`} label={detail.name || null}
                             county={detail.county || null} state={detail.state || null}
                             latitude={lat} longitude={lng} />
            </div>

          </>
        )}
      </div>

      {/* Footer (owner 11/15): Map It · Find Comps · + Add Comp ·
          Projects, then one wide Reports button — every report, its notes
          and Download / Email are in the Reports panel. */}
      {detail && (
        <div style={{ flexShrink: 0, borderTop: '1px solid rgba(0,0,0,0.06)', padding: 12, background: '#fff' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {!compMode && (
              <button data-testid="saved-tract-mapit" onClick={() => onEditInMapIt(detail)} title="Edit in Map It" style={ACTION_BTN}>
                <Layers size={16} /> Map It
              </button>
            )}
            {onFindComparables && canUseReports && !compMode && (
              <button
                data-testid="saved-tract-find-comps"
                onClick={() => onFindComparables({
                  saved_id: detail.id,
                  county: detail.county || '', state: detail.state || '', lat, lng,
                })}
                title="Find comps for this farm"
                style={ACTION_BTN}
              >
                <BarChart3 size={16} /> Find Comps
              </button>
            )}
            {onToggleReport && (canUseReports || compMode) && (
              <button
                data-testid="saved-tract-add-comp"
                onClick={handleToggleReport}
                title={isInReport ? 'Remove from the comp report' : 'Add to the comp report as a comp'}
                style={ACTION_BTN}
              >
                {isInReport ? <Check size={16} /> : <Plus size={16} />}
                {isInReport ? 'Added' : 'Add Comp'}
              </button>
            )}
            {!compMode && projectId && (
              <button onClick={() => onOpenProjects(projectId)} title="Open in Saved Projects" style={ACTION_BTN}>
                <FolderOpen size={16} /> Projects
              </button>
            )}
          </div>
          {!compMode && (
            <button
              data-testid="saved-tract-reports"
              onClick={() => openReports({
                target: { type: 'farm', parcelId: detail.id, title: detail.name || 'Farm',
                          meta: [fmtAc(acres), place].filter(Boolean).join(' · ') || undefined,
                          projectId, projectName },
                backLabel: 'Farm', canUseReports: Boolean(canUseReports), canUseMapIt: true,
              })}
              style={{ ...ACTION_BTN, flexDirection: 'row', gap: 8, padding: '12px 10px', fontSize: 14, width: '100%', marginTop: 8 }}
            >
              <FileText size={17} /> Reports
            </button>
          )}
        </div>
      )}
    </div>
  )
}
