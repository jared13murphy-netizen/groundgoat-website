'use client'

// Cross-item "Notes" search (owner 11/10): every note the user — or their
// firm — can see, by text, category and date. A result names the item,
// county/state, date, category and a snippet; tapping it opens that item.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Loader2, Search, Lock, X } from 'lucide-react'
import { fmtNoteDate, searchNotes, type NoteSearchResult } from '@/lib/notes'
import { titleCase } from '@/components/map/parcelDetailFields'
import { useNoteCategories } from './NoteCategorySelect'

const PINK = '#F58CDE'
const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#FFFFFF', border: '1px solid #D1D5DB',
  borderRadius: 8, color: '#111111', padding: '7px 10px', fontSize: 13, fontFamily: 'inherit',
}
const muted: CSSProperties = { color: 'rgba(255,255,255,0.6)', fontSize: 11 }

const KIND_LABEL: Record<string, string> = { parcel: 'Parcel', tract: 'Auction tract', saved: 'Saved tract', point: 'Parcel' }

/** The snippet comes back HTML-escaped with only <b> around the match. */
function Snippet({ html }: { html: string }) {
  const parts = html.split(/(<b>.*?<\/b>)/g)
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
  return (
    <>
      {parts.map((p, i) => p.startsWith('<b>')
        ? <mark key={i} style={{ background: 'rgba(245,140,222,0.35)', color: '#fff', borderRadius: 3, padding: '0 1px' }}>{unescape(p.slice(3, -4))}</mark>
        : <span key={i}>{unescape(p)}</span>)}
    </>
  )
}

export default function NotesSearch({ onOpen, onClose }: { onOpen: (r: NoteSearchResult) => void; onClose: () => void }) {
  const cats = useNoteCategories()
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [res, setRes] = useState<{ total: number; results: NoteSearchResult[] } | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const my = ++seq.current
    const h = setTimeout(async () => {
      setLoading(true); setError(null)
      try {
        const r = await searchNotes({ q: q.trim() || null, category: category || null, from: from || null, to: to || null, limit: 100 })
        if (my === seq.current) setRes(r)
      } catch (e: any) {
        if (my === seq.current) setError(e?.message || 'Could not search notes')
      } finally { if (my === seq.current) setLoading(false) }
    }, 250)
    return () => clearTimeout(h)
  }, [q, category, from, to])

  return (
    <div data-testid="notes-search" style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Notes</span>
        <button type="button" onClick={onClose} aria-label="Back to projects"
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', padding: 4, display: 'inline-flex' }}>
          <X size={15} />
        </button>
      </div>
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: '#9CA3AF' }} />
        <input autoFocus style={{ ...input, paddingLeft: 28 }} placeholder="Search all notes" value={q}
               data-testid="notes-search-q" onChange={(e) => setQ(e.target.value)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <select style={{ ...input, gridColumn: '1 / -1' }} value={category} data-testid="notes-search-category" onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {cats.categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <label style={muted}>From<input type="date" style={input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={muted}>To<input type="date" style={input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6 }}>
        {loading ? <><Loader2 size={12} className="animate-spin" /> Searching…</> : res ? `${res.total} note${res.total === 1 ? '' : 's'}` : ''}
      </div>
      {error && <div style={{ fontSize: 12, color: '#fca5a5' }}>{error}</div>}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {res?.results.map((r) => {
          // Same place line as the app: "Hancock County, IL" (the server's county can be lowercase).
          const county = titleCase(r.item.county || '')
          const where = [county && !/\s(county|parish|borough)$/i.test(county) ? `${county} County` : county, r.item.state].filter(Boolean).join(', ')
          return (
            <button key={r.entry.id} type="button" data-testid="notes-search-result" onClick={() => onOpen(r)}
                    style={{ textAlign: 'left', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 10,
                             padding: '8px 10px', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.item.label || KIND_LABEL[r.item.kind] || 'Item'}
              </div>
              <div style={{ ...muted, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 1 }}>
                <span>{KIND_LABEL[r.item.kind] || 'Item'}{where ? ` · ${where}` : ''}</span>
              </div>
              <div style={{ ...muted, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 3 }}>
                <span style={{ color: '#fff', fontWeight: 600 }}>{fmtNoteDate(r.entry.entry_date)}</span>
                <span style={{ padding: '0 6px', borderRadius: 999, background: 'rgba(245,140,222,0.18)', color: PINK, fontWeight: 700 }}>{r.entry.category_label}</span>
                <span>{r.entry.author.name}</span>
                {r.entry.internal && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}><Lock size={9} /> Internal</span>}
              </div>
              {r.snippet && <div style={{ fontSize: 12, marginTop: 4, color: 'rgba(255,255,255,0.88)', lineHeight: 1.35 }}><Snippet html={r.snippet} /></div>}
            </button>
          )
        })}
        {res && !res.results.length && !loading && <div style={muted}>No notes match.</div>}
      </div>
    </div>
  )
}
