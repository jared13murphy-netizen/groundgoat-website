'use client'

/**
 * NotesStep — "Notes to include" on every report (owner 11/15, Reports
 * panel mockup): four buttons (None · Latest · All · Pick) and the item's
 * notes as cards. A note that will print is pink (gradient) and says
 * "Prints"; one left out is gray and says "Left out". In Pick, tapping a
 * card adds or removes it. Products show inside each card and always print
 * with their note. Internal notes never print and are not listed.
 *
 * The value is the same NotesPrint every report endpoint takes.
 */
import { useEffect, useMemo, useState } from 'react'
import {
  fetchTimelines, fmtNoteDate, productLineText,
  type NoteEntry, type NotePickItem, type NotesPrint,
} from '@/lib/notes'

export const PINK_GRADIENT = 'linear-gradient(135deg, #F9A8E6 0%, #F58CDE 55%, #E879C9 100%)'

const MODES: { mode: 'none' | 'latest' | 'all' | 'pick'; label: string }[] = [
  { mode: 'none', label: 'None' }, { mode: 'latest', label: 'Latest' },
  { mode: 'all', label: 'All' }, { mode: 'pick', label: 'Pick' },
]

/** Which entry ids print for a choice — the same rule the server applies
 *  per item (latest = each item's newest). Entries arrive newest first. */
export function printedIds(groups: Record<string, NoteEntry[]>, v: NotesPrint): Set<string> {
  const out = new Set<string>()
  for (const ents of Object.values(groups)) {
    if (v.mode === 'latest' && ents[0]) out.add(ents[0].id)
    if (v.mode === 'all') ents.forEach((e) => out.add(e.id))
    if (v.mode === 'pick') ents.forEach((e) => { if (v.ids?.includes(e.id)) out.add(e.id) })
  }
  return out
}

export default function NotesStep({ items, value, onChange, maxListHeight }: {
  items: NotePickItem[]
  value: NotesPrint
  onChange: (v: NotesPrint) => void
  /** Scroll the cards inside a box this tall (comp report footers). */
  maxListHeight?: number
}) {
  const keysSig = items.map((i) => i.key).join('|')
  const [groups, setGroups] = useState<Record<string, NoteEntry[]> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const keys = keysSig ? keysSig.split('|') : []
    setGroups(null); setError(null)
    if (!keys.length) { setGroups({}); return }
    fetchTimelines(keys).then((t) => {
      if (!alive) return
      const g: Record<string, NoteEntry[]> = {}
      for (const k of keys) g[k] = (t[k]?.entries || []).filter((e) => !e.internal)
      setGroups(g)
    }).catch((e: any) => { if (alive) setError(e?.message || 'Could not load the notes.') })
    return () => { alive = false }
  }, [keysSig])

  const prints = useMemo(() => printedIds(groups || {}, value), [groups, value])
  const label = useMemo(() => Object.fromEntries(items.map((i) => [i.key, i.label])), [items])
  const all = useMemo(() => Object.entries(groups || {}).flatMap(([k, ents]) => ents.map((e) => ({ k, e }))), [groups])
  const mode = value.mode === 'range' ? 'all' : value.mode

  const pickMode = (m: typeof MODES[number]['mode']) => {
    // Pick starts from what prints now, so switching never loses a choice.
    if (m === 'pick') onChange({ mode: 'pick', ids: Array.from(prints) })
    else onChange({ mode: m })
  }
  const toggle = (id: string) => {
    if (mode !== 'pick') return
    const n = new Set(prints)
    if (n.has(id)) n.delete(id); else n.add(id)
    onChange({ mode: 'pick', ids: Array.from(n) })
  }

  return (
    <div data-testid="notes-step" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div role="radiogroup" aria-label="Notes to include" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
        {MODES.map((m) => {
          const on = mode === m.mode
          return (
            <button key={m.mode} type="button" role="radio" aria-checked={on} data-testid={`notes-mode-${m.mode}`}
                    onClick={() => pickMode(m.mode)}
                    style={{ height: 40, borderRadius: 10, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                             background: on ? '#F58CDE' : '#27272A', color: on ? '#000' : '#fff',
                             fontSize: 13, fontWeight: on ? 700 : 500 }}>
              {m.label}
            </button>
          )
        })}
      </div>
      {mode === 'pick' && all.length > 0 && (
        <div style={{ fontSize: 12, color: '#A1A1AA' }}>Tap a note to add or remove it.</div>
      )}
      <div data-testid="notes-step-list"
           style={{ display: 'flex', flexDirection: 'column', gap: 8, ...(maxListHeight ? { maxHeight: maxListHeight, overflowY: 'auto' } : {}) }}>
        {!groups && !error && <div style={{ fontSize: 12, color: '#A1A1AA' }}>Loading notes…</div>}
        {error && <div style={{ fontSize: 12, color: '#F87171' }}>{error}</div>}
        {groups && !all.length && <div data-testid="notes-step-empty" style={{ fontSize: 12, color: '#A1A1AA' }}>No notes on this yet.</div>}
        {all.map(({ k, e }) => {
          const on = prints.has(e.id)
          const fg = on ? '#000' : '#3F3F46'
          const Tag = mode === 'pick' ? 'button' : 'div'
          return (
            <Tag key={e.id} type={mode === 'pick' ? 'button' : undefined} data-testid="notes-step-card" data-prints={on ? '1' : '0'}
                 aria-pressed={mode === 'pick' ? on : undefined} onClick={() => toggle(e.id)}
                 style={{ textAlign: 'left', width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: 'none',
                          background: on ? PINK_GRADIENT : '#E4E4E7', color: fg, fontSize: 12, lineHeight: 1.45,
                          cursor: mode === 'pick' ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700, fontSize: 13 }}>
                <span>{[fmtNoteDate(e.entry_date), e.category_label].filter(Boolean).join(' · ')}</span>
                <span style={{ fontSize: 11, fontWeight: 600, flex: 'none' }}>{on ? 'Prints' : 'Left out'}</span>
              </div>
              {items.length > 1 && <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.8 }}>{label[k]}</div>}
              {(e.products || []).map((p, i) => (
                <div key={p.id || i} style={{ marginTop: 3, fontWeight: 600 }}>{productLineText(p)}</div>
              ))}
              {e.text && <div style={{ marginTop: 2, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{e.text.length > 280 ? `${e.text.slice(0, 279)}…` : e.text}</div>}
            </Tag>
          )
        })}
      </div>
    </div>
  )
}
