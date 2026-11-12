'use client'

// "Notes on this report" (owner 11/10): what Download PDF / Email Report
// print from each item's timeline. Internal entries never print, whatever
// is picked here — the server drops them before the report is built.
// "Choose notes" (owner 11/11): tick the exact entries to print, grouped by
// item, newest first; the latest note of each item starts ticked.
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchTimelines, fmtNoteDate, NOTES_PRINT_MODES, todayIso,
  type NoteEntry, type NotePickItem, type NotesPrint, type NotesPrintMode,
} from '@/lib/notes'

const input = {
  background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 8, color: '#111111',
  padding: '5px 8px', fontSize: 12, fontFamily: 'inherit',
} as const

const PICK_LABEL = 'Choose notes'

function firstLine(t: string): string {
  const l = (t || '').split('\n').map((x) => x.trim()).find(Boolean) || ''
  return l.length > 90 ? `${l.slice(0, 89)}…` : l
}

/** The tick list for mode 'pick'. Loads each item's printable entries; on
 *  first load of an item, ticks its latest entry (the "Latest" default). */
function NotesPicker({ items, value, onChange }: {
  items: NotePickItem[]; value: NotesPrint; onChange: (v: NotesPrint) => void
}) {
  const keysSig = items.map((i) => i.key).join('|')
  const [groups, setGroups] = useState<Record<string, NoteEntry[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seeded = useRef<Set<string>>(new Set())
  const valueRef = useRef(value)
  valueRef.current = value
  const changeRef = useRef(onChange)
  changeRef.current = onChange

  useEffect(() => {
    let alive = true
    const keys = keysSig ? keysSig.split('|') : []
    setError(null)
    if (!keys.length) { setGroups({}); return }
    fetchTimelines(keys).then((t) => {
      if (!alive) return
      const g: Record<string, NoteEntry[]> = {}
      for (const k of keys) g[k] = (t[k]?.entries || []).filter((e) => !e.internal)
      setGroups(g)
    }).catch((e: any) => { if (alive) setError(e?.message || 'Could not load the notes.') })
    return () => { alive = false }
  }, [keysSig])

  // Default ticks: the latest entry of each item, once per item (and again
  // for every item when the user re-picks "Choose notes": ids null).
  const fresh = value.ids == null
  useEffect(() => {
    if (!groups) return
    if (fresh) seeded.current = new Set()
    const todo = Object.keys(groups).filter((k) => !seeded.current.has(k))
    if (!todo.length) return
    todo.forEach((k) => seeded.current.add(k))
    const ids = new Set(fresh ? [] : valueRef.current.ids || [])
    for (const k of todo) if (groups[k][0]) ids.add(groups[k][0].id)
    if (valueRef.current.mode === 'pick') changeRef.current({ mode: 'pick', ids: Array.from(ids) })
  }, [groups, fresh])

  const chosen = useMemo(() => new Set(value.ids || []), [value.ids])
  const set = (ids: Set<string>) => onChange({ mode: 'pick', ids: Array.from(ids) })
  const toggle = (id: string) => { const n = new Set(chosen); if (n.has(id)) n.delete(id); else n.add(id); set(n) }
  const setMany = (ents: NoteEntry[], on: boolean) => {
    const n = new Set(chosen)
    ents.forEach((e) => (on ? n.add(e.id) : n.delete(e.id)))
    set(n)
  }

  const box: React.CSSProperties = {
    background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 8, color: '#111111',
    maxHeight: 280, overflowY: 'auto', padding: '6px 8px', fontSize: 12, textAlign: 'left',
  }
  const link: React.CSSProperties = { background: 'none', border: 'none', padding: 0, color: '#2563EB', cursor: 'pointer', fontSize: 11 }
  if (error) return <div data-testid="notes-pick-list" style={box}>{error}</div>
  if (!groups) return <div data-testid="notes-pick-list" style={box}>Loading notes…</div>
  const shown = items.filter((i) => (groups[i.key] || []).length)
  if (!shown.length) return <div data-testid="notes-pick-list" style={box}>No notes to print.</div>
  return (
    <div data-testid="notes-pick-list" style={box}>
      {shown.map((it) => {
        const ents = groups[it.key]
        return (
          <div key={it.key} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, margin: '2px 0' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
              <button type="button" style={link} onClick={() => setMany(ents, true)}>All</button>
              <button type="button" style={link} onClick={() => setMany(ents, false)}>None</button>
            </div>
            {ents.map((e) => (
              <label key={e.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '2px 0', cursor: 'pointer' }}>
                <input type="checkbox" data-testid="notes-pick-box" checked={chosen.has(e.id)} onChange={() => toggle(e.id)}
                       style={{ marginTop: 2, accentColor: '#111111', background: '#FFFFFF', border: '1px solid #D1D5DB' }} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ color: '#6B7280' }}>
                    {[fmtNoteDate(e.entry_date), e.category_label, e.author?.name].filter(Boolean).join(' · ')}
                  </span>
                  {firstLine(e.text) ? <> — {firstLine(e.text)}</> : null}
                </span>
              </label>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export default function NotesPrintChoice({ value, onChange, compact = false, items }: {
  value: NotesPrint; onChange: (v: NotesPrint) => void
  /** One inline row (toolbars): "Notes [select]" + the range dates. */
  compact?: boolean
  /** The items this report covers. When given, "Choose notes" is offered. */
  items?: NotePickItem[] | null
}) {
  const [open, setOpen] = useState(false)
  const modes = items ? [...NOTES_PRINT_MODES, { value: 'pick' as NotesPrintMode, label: PICK_LABEL }] : NOTES_PRINT_MODES
  const mode: NotesPrintMode = value.mode === 'pick' && !items ? 'latest' : value.mode
  const pick = (m: NotesPrintMode) => {
    if (m === 'range') onChange({ mode: m, from: value.from || `${todayIso().slice(0, 4)}-01-01`, to: value.to || todayIso() })
    else if (m === 'pick') { onChange({ mode: m, ids: null }); setOpen(true) }
    else onChange({ mode: m })
  }

  if (compact) {
    return (
      <span data-testid="notes-print-choice" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, position: 'relative' }}
            title="Which notes print on the report. Internal notes never print.">
        <span style={{ opacity: 0.75 }}>Notes</span>
        <select data-testid="notes-print-mode" aria-label="Notes on this report" style={input} value={mode}
                onChange={(e) => pick(e.target.value as NotesPrintMode)}>
          {modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        {mode === 'range' && (
          <>
            <input type="date" aria-label="Notes from" data-testid="notes-print-from" style={input} value={value.from || ''}
                   onChange={(e) => onChange({ ...value, from: e.target.value || null })} />
            <input type="date" aria-label="Notes to" data-testid="notes-print-to" style={input} value={value.to || ''}
                   onChange={(e) => onChange({ ...value, to: e.target.value || null })} />
          </>
        )}
        {mode === 'pick' && items && (
          <>
            <button type="button" data-testid="notes-pick-toggle" style={{ ...input, cursor: 'pointer' }} onClick={() => setOpen((x) => !x)}>
              {(value.ids || []).length} chosen {open ? '▴' : '▾'}
            </button>
            {/* Kept mounted while closed so the first load seeds the defaults. */}
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, width: 340, maxWidth: '80vw', zIndex: 60,
                          boxShadow: '0 6px 20px rgba(0,0,0,0.18)', borderRadius: 8, display: open ? 'block' : 'none' }}>
              <NotesPicker items={items} value={value} onChange={onChange} />
              <div style={{ textAlign: 'right', marginTop: 4 }}>
                <button type="button" style={{ ...input, cursor: 'pointer' }} onClick={() => setOpen(false)}>Done</button>
              </div>
            </div>
          </>
        )}
      </span>
    )
  }
  return (
    <div data-testid="notes-print-choice" className="px-5 pt-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor="notes-print-mode" className="text-[11px] font-semibold text-gg-gray-400 uppercase tracking-wider whitespace-nowrap">
          Notes on this report
        </label>
        <select id="notes-print-mode" data-testid="notes-print-mode" style={{ ...input, flex: 1 }} value={mode}
                onChange={(e) => pick(e.target.value as NotesPrintMode)}>
          {modes.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      {mode === 'range' && (
        <div className="flex items-center gap-2 text-[11px] text-gg-gray-400">
          <span>From</span>
          <input type="date" data-testid="notes-print-from" style={{ ...input, flex: 1 }} value={value.from || ''}
                 onChange={(e) => onChange({ ...value, from: e.target.value || null })} />
          <span>to</span>
          <input type="date" data-testid="notes-print-to" style={{ ...input, flex: 1 }} value={value.to || ''}
                 onChange={(e) => onChange({ ...value, to: e.target.value || null })} />
        </div>
      )}
      {mode === 'pick' && items && <NotesPicker items={items} value={value} onChange={onChange} />}
      <p className="text-[10px] text-gg-gray-500 m-0">Internal notes never print.</p>
    </div>
  )
}
