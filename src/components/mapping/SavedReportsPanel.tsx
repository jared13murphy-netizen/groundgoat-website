// Saved Reports slide-out (owner 11/3): every comp report this account
// emailed, downloaded or saved, as cards with Avg $/Acre, searchable by
// name, county and date. Opened from the My Maps "Saved Reports" tile.
'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Bookmark, Loader2, Pencil, Trash2, X } from 'lucide-react'
import { listSavedReports, renameSavedReport, deleteSavedReport, type SavedReportRow } from '@/lib/configurableMapping'

const PINK = '#F58CDE'
const panel: CSSProperties = {
  position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 540,
  width: 'min(340px, calc(100% - 24px))', boxSizing: 'border-box',
  background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(8px)', color: '#fff',
  boxShadow: '-4px 0 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
  transition: 'transform 240ms ease', fontSize: 13,
}
const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#ffffff', border: '1px solid #D1D5DB',
  borderRadius: 8, color: '#111', padding: '9px 12px', fontSize: 14,
}
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

export default function SavedReportsPanel({ open, onClose, onOpenReport, reloadNonce = 0 }: {
  open: boolean; onClose: () => void; onOpenReport: (id: string) => void; reloadNonce?: number
}) {
  const [rows, setRows] = useState<SavedReportRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try { setRows((await listSavedReports()).reports || []) } catch (e: any) { setError(e?.message || 'Could not load your saved reports.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { if (open) void load() }, [open, reloadNonce, load])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) => {
      const hay = [r.name, r.subject?.county, r.subject?.state, fmtWhen(r.updated_at), fmtWhen(r.created_at),
        ...(r.items || []).map((i) => `${i.county || ''} ${i.state || ''}`)].join(' ').toLowerCase()
      return hay.includes(needle)
    })
  }, [rows, q])

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
    <div style={{ ...panel, transform: open ? 'translateX(0)' : 'translateX(105%)' }} data-testid="saved-reports-panel" aria-hidden={!open}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 8px' }}>
        <Bookmark size={18} color={PINK} />
        <div style={{ fontSize: 18, fontWeight: 700, flex: 1 }}>Saved Reports</div>
        <button type="button" style={iconBtn} aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <div style={{ padding: '0 16px 8px' }}>
        <input style={input} placeholder="Search by name, county or date…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
        {loading && rows.length === 0 && <div style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 size={14} className="animate-spin" /> Loading…</div>}
        {error && <div style={{ color: '#fca5a5', fontSize: 12 }}>{error}</div>}
        {!loading && !error && shown.length === 0 && (
          <div style={muted}>{q ? 'Nothing matches.' : 'No saved reports yet. Every comp report you email, download or save shows up here.'}</div>
        )}
        {shown.map((r) => <SavedReportCard key={r.id} r={r} onOpen={onOpenReport} onRename={rename} onDelete={remove} />)}
      </div>
    </div>
  )
}
