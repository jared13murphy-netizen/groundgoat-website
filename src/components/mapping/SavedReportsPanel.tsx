// Saved Reports slide-out (owner 11/3): every comp report this account
// emailed, downloaded or saved, as cards with Avg $/Acre, searchable by
// name, county and date. Opened from the My Maps "Saved Reports" row; uses the
// shared My Maps screen design (MyMapsShell, owner 11/15).
'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { FileText, Loader2, Pencil, Trash2 } from 'lucide-react'
import MyMapsShell, { CardPicture, ListEmpty, MyMapsCard, Tag, applyControls, fmtModified, useListControls } from '@/components/mapping/MyMapsShell'
import { listSavedReports, renameSavedReport, deleteSavedReport, type SavedReportRow } from '@/lib/configurableMapping'

const PINK = '#F58CDE'
const muted: CSSProperties = { color: 'rgba(255,255,255,0.65)', fontSize: 12 }
const iconBtn: CSSProperties = {
  background: 'none', border: 'none', color: 'rgba(255,255,255,0.8)', cursor: 'pointer',
  padding: 4, display: 'inline-flex', alignItems: 'center', borderRadius: 6,
}

export const reportCard: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', marginTop: 8,
  background: 'rgba(245,140,222,0.16)', border: '1px solid rgba(245,140,222,0.45)', borderRadius: 12,
}

export function fmtWhen(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }) : ''
}
export function fmtPpa(r: SavedReportRow) {
  const v = r.summary?.avg_price_per_acre
  return typeof v === 'number' && v > 0 ? `$${Math.round(v).toLocaleString('en-US')}/ac` : null
}

/** One saved-report card — shared by this panel and Saved Projects. */
export function SavedReportCard({ r, onOpen, onRename, onDelete }: {
  r: SavedReportRow; onOpen: (id: string) => void; onRename: (r: SavedReportRow) => void; onDelete: (r: SavedReportRow) => void
}) {
  const ppa = fmtPpa(r)
  return (
    <div style={reportCard} data-testid="saved-report-row">
      <button type="button" title="Open this report"
              style={{ flex: 1, minWidth: 0, background: 'none', border: 'none', padding: 0, color: '#fff', cursor: 'pointer', textAlign: 'left' }}
              onClick={() => onOpen(r.id)}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700 }}>{r.name}</div>
        {ppa && <div style={{ color: PINK, fontWeight: 700, fontSize: 13, marginTop: 2 }}>Avg {ppa}</div>}
        <div style={muted}>{r.item_count} {r.item_count === 1 ? 'sale' : 'sales'} · {fmtWhen(r.updated_at)}</div>
      </button>
      <button type="button" style={iconBtn} aria-label="Rename report" onClick={() => onRename(r)}><Pencil size={13} /></button>
      <button type="button" style={iconBtn} aria-label="Delete saved report" onClick={() => onDelete(r)}><Trash2 size={13} /></button>
    </div>
  )
}

export default function SavedReportsPanel({ open, onClose, onBack, onOpenReport, onNewReport, isFirm = false, reloadNonce = 0 }: {
  open: boolean; onClose: () => void; onBack: () => void; onOpenReport: (id: string) => void
  /** "+ New": opens the comp report panel (a saved report starts there). */
  onNewReport?: () => void
  isFirm?: boolean; reloadNonce?: number
}) {
  const [rows, setRows] = useState<SavedReportRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const c = useListControls()
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows((await listSavedReports()).reports || []); setLoaded(true) } catch (e: any) { setError(e?.message || 'Could not load your saved reports.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { if (open) void load() }, [open, reloadNonce, load])

  const { shown, counts } = useMemo(() => applyControls(rows, c, {
    mine: (r) => r.mine !== false,
    name: (r) => r.name || '',
    modified: (r) => r.updated_at || r.created_at,
    text: (r) => [r.name, r.subject?.county, r.subject?.state, fmtWhen(r.updated_at), fmtWhen(r.created_at),
      ...(r.items || []).map((i) => `${i.county || ''} ${i.state || ''}`)].join(' '),
  }), [rows, c])

  const rename = async (r: SavedReportRow) => {
    const name = window.prompt('Report name', r.name)
    if (name == null || !name.trim() || name.trim() === r.name) return
    try { await renameSavedReport(r.id, name.trim()); await load() } catch (e: any) { setError(e?.message || 'Could not rename the report.') }
  }
  const remove = async (r: SavedReportRow) => {
    if (!window.confirm(`Delete the saved report "${r.name}"?`)) return
    try { await deleteSavedReport(r.id); setRows((x) => x.filter((y) => y.id !== r.id)) } catch (e: any) { setError(e?.message || 'Could not delete the report.') }
  }

  return (
    <MyMapsShell open={open} title="Saved Reports" onBack={onBack} onClose={onClose} controls={c}
                 searchPlaceholder="Search by name, county or date" onNew={onNewReport} showChips={isFirm} counts={counts}
                 testId="saved-reports-panel"
                 top={error ? <div style={{ color: '#fca5a5', fontSize: 12 }}>{error}</div> : undefined}>
      {loading && !loaded && <div style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 size={14} className="animate-spin" /> Loading…</div>}
      {loaded && !rows.length && <ListEmpty>No saved reports yet. Every comp report you email, download or save shows up here.</ListEmpty>}
      {loaded && rows.length > 0 && !shown.length && (
        <ListEmpty>{c.chip === 'team' && !c.q.trim() ? 'Saved reports are private: each person sees only their own.' : 'Nothing matches.'}</ListEmpty>
      )}
      {shown.map((r) => {
        const ppa = fmtPpa(r)
        const where = [r.subject?.county, r.subject?.state].filter(Boolean).join(', ')
        return (
          <MyMapsCard key={r.id} testId="saved-report-row"
                      picture={<CardPicture icon={<FileText size={26} />} />}
                      title={r.name}
                      sub={[where, fmtModified(r.updated_at || r.created_at)].filter(Boolean).join(' · ')}
                      tags={[ppa ? <Tag key="ppa" pink>Avg {ppa}</Tag> : null,
                             <Tag key="n">{r.item_count} {r.item_count === 1 ? 'sale' : 'sales'}</Tag>]}
                      onOpen={() => onOpenReport(r.id)}
                      actions={[
                        { label: 'Open report', onClick: () => onOpenReport(r.id), testId: 'report-open' },
                        { label: 'Rename', onClick: () => void rename(r), testId: 'report-rename' },
                        { label: 'Delete', onClick: () => void remove(r), danger: true, testId: 'report-delete' },
                      ]} />
        )
      })}
    </MyMapsShell>
  )
}
