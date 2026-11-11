'use client'

/**
 * Notes timeline for one parcel / tract / saved tract (owner 11/10,
 * "Simple"). Replaces the single "Add Notes" box (10/29): dated entries with
 * a category, text, photos/PDFs and an Internal checkbox, attached to the
 * land itself so the history shows on every report and saved project.
 *
 * Owner rule: inputs are ALWAYS white with a light gray border, even on a
 * dark panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Plus, Filter, Pencil, Trash2, Paperclip, X, Lock, FileText, Loader2, ChevronDown, ChevronUp, Search } from 'lucide-react'
import {
  NOTE_CATEGORIES, MAX_NOTE_FILES, MAX_NOTE_FILE_MB, NOTE_FILE_ACCEPT,
  createNote, deleteNote, fetchTimelines, fmtNoteDate, removeNoteFile, todayIso, updateNote, uploadNoteFiles,
  type NoteCategory, type NoteEntry, type NoteTimeline, type TimelineFilters,
} from '@/lib/notes'

// ── batched loading: every timeline mounted in the same tick shares ONE request ──
let pending: { keys: Set<string>; waiters: { key: string; res: (t: NoteTimeline) => void; rej: (e: any) => void }[] } | null = null
function loadBatched(key: string): Promise<NoteTimeline> {
  return new Promise((res, rej) => {
    if (!pending) {
      pending = { keys: new Set(), waiters: [] }
      setTimeout(async () => {
        const batch = pending!
        pending = null
        try {
          const out = await fetchTimelines(Array.from(batch.keys))
          for (const w of batch.waiters) w.res(out[w.key] || { count: 0, entries: [] })
        } catch (e) {
          for (const w of batch.waiters) w.rej(e)
        }
      }, 25)
    }
    pending.keys.add(key)
    pending.waiters.push({ key, res, rej })
  })
}

type Theme = 'dark' | 'light'
const PINK = '#F58CDE'

function palette(theme: Theme) {
  return theme === 'dark'
    ? { text: '#fff', muted: 'rgba(255,255,255,0.6)', faint: 'rgba(255,255,255,0.4)', line: 'rgba(255,255,255,0.10)',
        card: 'rgba(255,255,255,0.05)', btnBg: 'rgba(255,255,255,0.06)', btnBorder: 'rgba(255,255,255,0.14)', link: PINK }
    : { text: '#1a1a1a', muted: 'rgba(0,0,0,0.55)', faint: 'rgba(0,0,0,0.4)', line: 'rgba(0,0,0,0.08)',
        card: '#FFFFFF', btnBg: 'rgba(0,0,0,0.05)', btnBorder: 'rgba(0,0,0,0.12)', link: '#a0307f' }
}

// Owner 11/3: white inputs, light gray border, dark text — on every surface.
const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#FFFFFF', border: '1px solid #D1D5DB',
  borderRadius: 8, color: '#111111', padding: '6px 8px', fontSize: 12, fontFamily: 'inherit',
}

export interface NotesTimelineProps {
  itemKey: string | null
  /** For search results: what to call this item, and where it is. */
  label?: string | null
  county?: string | null
  state?: string | null
  latitude?: number | null
  longitude?: number | null
  theme?: Theme
  /** Report cards: show the latest entry with "Show all". */
  compact?: boolean
  /** Called with the current count after every load / change. */
  onCount?: (n: number) => void
}

interface Draft {
  id: string | null
  entry_date: string
  category: NoteCategory
  text: string
  internal: boolean
  files: File[]
  existing: NoteEntry['attachments']
}

const blankDraft = (): Draft => ({ id: null, entry_date: todayIso(), category: 'note', text: '', internal: false, files: [], existing: [] })

export default function NotesTimeline({
  itemKey, label, county, state, latitude, longitude, theme = 'dark', compact = false, onCount,
}: NotesTimelineProps) {
  const c = palette(theme)
  const [tl, setTl] = useState<NoteTimeline | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 403 = this account has no notes (not Premium): show nothing at all.
  const [denied, setDenied] = useState(false)
  const [expanded, setExpanded] = useState(!compact)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<TimelineFilters>({})
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const seq = useRef(0)
  const filtered = !!(filters.category || filters.from || filters.to || (filters.q || '').trim())

  const load = useCallback(async () => {
    if (!itemKey) return
    const my = ++seq.current
    setLoading(true); setError(null)
    try {
      const t = filtered ? (await fetchTimelines([itemKey], filters))[itemKey] || { count: 0, entries: [] } : await loadBatched(itemKey)
      if (my === seq.current) setTl(t)
    } catch (e: any) {
      if (my === seq.current) {
        setDenied(e?.status === 403)
        setError(e?.status === 403 ? null : (e?.message || 'Could not load notes'))
      }
    } finally { if (my === seq.current) setLoading(false) }
  }, [itemKey, filters, filtered])

  useEffect(() => {
    const h = setTimeout(() => { void load() }, filtered ? 300 : 0)
    return () => clearTimeout(h)
  }, [load, filtered])

  useEffect(() => { if (tl && !filtered) onCount?.(tl.count) }, [tl, filtered, onCount])

  const entries = tl?.entries || []
  const shown = expanded ? entries : entries.slice(0, 1)

  const startEdit = (e: NoteEntry) => {
    setFormError(null)
    setDraft({ id: e.id, entry_date: e.entry_date, category: e.category, text: e.text, internal: e.internal, files: [], existing: e.attachments })
  }

  const addFiles = (list: FileList | null) => {
    if (!list || !draft) return
    const files = Array.from(list)
    const total = draft.existing.length + draft.files.length + files.length
    if (total > MAX_NOTE_FILES) { setFormError(`Up to ${MAX_NOTE_FILES} files per entry`); return }
    const big = files.find((f) => f.size > MAX_NOTE_FILE_MB * 1024 * 1024)
    if (big) { setFormError(`${big.name} is over ${MAX_NOTE_FILE_MB} MB`); return }
    setFormError(null)
    setDraft({ ...draft, files: [...draft.files, ...files] })
  }

  const save = async () => {
    if (!draft || !itemKey || saving) return
    if (!draft.text.trim() && !draft.files.length && !draft.existing.length) { setFormError('Write something or attach a file'); return }
    setSaving(true); setFormError(null)
    try {
      const body = { entry_date: draft.entry_date || todayIso(), category: draft.category, text: draft.text, internal: draft.internal }
      let e = draft.id ? await updateNote(draft.id, body)
        : await createNote(itemKey, body, { label, county, state, latitude, longitude })
      if (draft.files.length) e = await uploadNoteFiles(e.id, draft.files)
      setDraft(null)
      setExpanded(true)
      await load()
    } catch (err: any) {
      setFormError(err?.message || 'Could not save this note')
    } finally { setSaving(false) }
  }

  const remove = async (e: NoteEntry) => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return
    try { await deleteNote(e.id); await load() } catch (err: any) { setError(err?.message || 'Could not delete') }
  }

  const removeExisting = async (attId: string) => {
    if (!draft?.id) return
    try {
      const e = await removeNoteFile(draft.id, attId)
      setDraft({ ...draft, existing: e.attachments })
    } catch (err: any) { setFormError(err?.message || 'Could not remove the file') }
  }

  const btn: CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 600,
    borderRadius: 7, background: c.btnBg, color: c.text, border: `1px solid ${c.btnBorder}`, cursor: 'pointer',
  }
  const pinkBtn: CSSProperties = { ...btn, background: PINK, color: '#0a0a0a', border: `1px solid ${PINK}` }

  const countLabel = useMemo(() => {
    const n = tl?.count ?? 0
    return n === 0 ? 'No notes yet' : `${n} ${n === 1 ? 'note' : 'notes'}`
  }, [tl])

  if (!itemKey || denied) return null

  return (
    <div data-testid="notes-timeline" data-note-key={itemKey} style={{ color: c.text, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase', color: c.muted }}>Notes</span>
        <span style={{ color: c.faint, fontSize: 11 }} data-testid="notes-count">{loading && !tl ? 'Loading…' : filtered ? `${tl?.count ?? 0} match${(tl?.count ?? 0) === 1 ? '' : 'es'}` : countLabel}</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={btn} aria-label="Filter notes" data-testid="notes-filter-toggle"
                onClick={() => setShowFilters((v) => !v)}>
          <Filter size={11} /> {filtered ? 'Filtered' : 'Filter'}
        </button>
        <button type="button" style={pinkBtn} data-testid="notes-add" onClick={() => { setFormError(null); setDraft(blankDraft()) }}>
          <Plus size={11} /> Add entry
        </button>
      </div>

      {showFilters && (
        <div data-testid="notes-filters" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
          <div style={{ gridColumn: '1 / -1', position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 8, top: 8, color: '#9CA3AF' }} />
            <input style={{ ...input, paddingLeft: 26 }} placeholder="Search these notes" value={filters.q || ''}
                   data-testid="notes-filter-q" onChange={(e) => setFilters({ ...filters, q: e.target.value })} />
          </div>
          <select style={{ ...input, gridColumn: '1 / -1' }} value={filters.category || ''} data-testid="notes-filter-category"
                  onChange={(e) => setFilters({ ...filters, category: e.target.value || null })}>
            <option value="">All categories</option>
            {NOTE_CATEGORIES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
          </select>
          <label style={{ fontSize: 10, color: c.muted }}>From
            <input type="date" style={input} value={filters.from || ''} data-testid="notes-filter-from"
                   onChange={(e) => setFilters({ ...filters, from: e.target.value || null })} />
          </label>
          <label style={{ fontSize: 10, color: c.muted }}>To
            <input type="date" style={input} value={filters.to || ''} data-testid="notes-filter-to"
                   onChange={(e) => setFilters({ ...filters, to: e.target.value || null })} />
          </label>
          {filtered && (
            <button type="button" style={{ ...btn, gridColumn: '1 / -1', justifyContent: 'center' }} onClick={() => setFilters({})}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {draft && (
        <div data-testid="notes-form" style={{ marginTop: 8, padding: 10, borderRadius: 10, background: c.card, border: `1px solid ${c.line}`,
                                              display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <label style={{ flex: 1, fontSize: 10, color: c.muted }}>Date of the work
              <input type="date" style={input} value={draft.entry_date} data-testid="notes-date"
                     onChange={(e) => setDraft({ ...draft, entry_date: e.target.value })} />
            </label>
            <label style={{ flex: 1, fontSize: 10, color: c.muted }}>Category
              <select style={input} value={draft.category} data-testid="notes-category"
                      onChange={(e) => setDraft({ ...draft, category: e.target.value as NoteCategory })}>
                {NOTE_CATEGORIES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </label>
          </div>
          <textarea style={{ ...input, minHeight: 64, resize: 'vertical' }} rows={3} autoFocus placeholder="What happened?"
                    value={draft.text} data-testid="notes-text" onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
          {(draft.existing.length > 0 || draft.files.length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {draft.existing.map((a) => (
                <span key={a.id} style={{ ...btn, cursor: 'default', padding: '3px 6px' }}>
                  {a.kind === 'pdf' ? <FileText size={11} /> : <Paperclip size={11} />} {a.filename}
                  <button type="button" aria-label={`Remove ${a.filename}`} onClick={() => void removeExisting(a.id)}
                          style={{ background: 'none', border: 'none', color: c.muted, cursor: 'pointer', padding: 0, display: 'inline-flex' }}><X size={11} /></button>
                </span>
              ))}
              {draft.files.map((f, i) => (
                <span key={`${f.name}-${i}`} style={{ ...btn, cursor: 'default', padding: '3px 6px' }}>
                  <Paperclip size={11} /> {f.name}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setDraft({ ...draft, files: draft.files.filter((_, j) => j !== i) })}
                          style={{ background: 'none', border: 'none', color: c.muted, cursor: 'pointer', padding: 0, display: 'inline-flex' }}><X size={11} /></button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ ...btn, cursor: 'pointer' }}>
              <Paperclip size={11} /> Photos / PDFs
              <input type="file" multiple accept={NOTE_FILE_ACCEPT} style={{ display: 'none' }} data-testid="notes-files"
                     onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: c.text, cursor: 'pointer' }}
                   title="Internal notes never print on a report, spreadsheet or email">
              <input type="checkbox" checked={draft.internal} data-testid="notes-internal"
                     onChange={(e) => setDraft({ ...draft, internal: e.target.checked })} />
              Internal (never printed)
            </label>
          </div>
          {formError && <div style={{ color: '#f87171', fontSize: 11 }}>{formError}</div>}
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={{ ...pinkBtn, opacity: saving ? 0.7 : 1 }} disabled={saving} data-testid="notes-save" onClick={() => void save()}>
              {saving ? <Loader2 size={11} className="animate-spin" /> : null} {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" style={btn} disabled={saving} onClick={() => { setDraft(null); setFormError(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div style={{ color: '#f87171', fontSize: 11, marginTop: 6 }}>{error}</div>}

      {shown.length > 0 && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {shown.map((e) => (
            <div key={e.id} data-testid="notes-entry" data-note-id={e.id} data-internal={e.internal ? '1' : '0'}
                 style={{ padding: '8px 10px', borderRadius: 10, background: c.card, border: `1px solid ${c.line}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: c.muted, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, color: c.text }}>{fmtNoteDate(e.entry_date)}</span>
                <span style={{ padding: '1px 7px', borderRadius: 999, background: 'rgba(245,140,222,0.18)', color: theme === 'dark' ? PINK : '#a0307f', fontWeight: 700 }}>
                  {e.category_label}
                </span>
                <span>{e.author.name}</span>
                {e.internal && (
                  <span data-testid="notes-internal-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 6px', borderRadius: 999,
                                                                    background: theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.07)', fontWeight: 700 }}>
                    <Lock size={9} /> Internal
                  </span>
                )}
                {e.edited && <span style={{ fontStyle: 'italic' }} title={e.edited_at ? `Edited ${new Date(e.edited_at).toLocaleString()}` : 'Edited'}>edited</span>}
                <span style={{ flex: 1 }} />
                {e.can_edit && (
                  <>
                    <button type="button" aria-label="Edit note" data-testid="notes-edit" onClick={() => startEdit(e)}
                            style={{ background: 'none', border: 'none', color: c.muted, cursor: 'pointer', padding: 2, display: 'inline-flex' }}><Pencil size={12} /></button>
                    <button type="button" aria-label="Delete note" data-testid="notes-delete" onClick={() => void remove(e)}
                            style={{ background: 'none', border: 'none', color: c.muted, cursor: 'pointer', padding: 2, display: 'inline-flex' }}><Trash2 size={12} /></button>
                  </>
                )}
              </div>
              {e.text && <div data-testid="notes-entry-text" style={{ marginTop: 4, whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.4, color: c.text, wordBreak: 'break-word' }}>{e.text}</div>}
              {e.attachments.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {e.attachments.map((a) => a.thumb_url ? (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" title={a.filename}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.thumb_url} alt={a.filename} data-testid="notes-thumb"
                           style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 6, border: `1px solid ${c.line}`, display: 'block' }} />
                    </a>
                  ) : (
                    <a key={a.id} href={a.url} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none', padding: '3px 7px' }}>
                      {a.kind === 'pdf' ? <FileText size={11} /> : <Paperclip size={11} />} {a.filename}
                    </a>
                  ))}
                </div>
              )}
              {e.via && <div style={{ marginTop: 4, fontSize: 10, color: c.faint }}>From the {e.via.startsWith('t:') ? 'auction tract' : 'parcel'} this was saved from</div>}
            </div>
          ))}
        </div>
      )}
      {compact && entries.length > 1 && (
        <button type="button" data-testid="notes-expand" onClick={() => setExpanded((v) => !v)}
                style={{ marginTop: 6, background: 'none', border: 'none', color: c.link, cursor: 'pointer', fontSize: 11, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {expanded ? <><ChevronUp size={12} /> Show latest only</> : <><ChevronDown size={12} /> Show all {entries.length}</>}
        </button>
      )}
    </div>
  )
}
