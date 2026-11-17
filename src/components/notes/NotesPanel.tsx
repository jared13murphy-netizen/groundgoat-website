'use client'

// Notes screen in My Maps (owner 11/10 search, 11/15 redesign): every note
// the user — or their firm — can see, in the shared My Maps design. Search
// runs on the server (note text, item, category); category and date
// filters sit behind "Filters". A card opens its item on the map; "+ New"
// asks the user to tap the parcel the note is for.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Loader2, Lock, SlidersHorizontal, StickyNote } from 'lucide-react'
import { fmtNoteDate, searchNotes, type NoteSearchResult } from '@/lib/notes'
import { titleCase } from '@/components/map/parcelDetailFields'
import { useNoteCategories } from './NoteCategorySelect'
import NoteProductsList from './NoteProductsList'
import MyMapsShell, {
  CardPicture, ListEmpty, MyMapsCard, Tag, applyControls, fmtModified, muted, useListControls, whiteInput,
} from '@/components/mapping/MyMapsShell'

const KIND_LABEL: Record<string, string> = { parcel: 'Parcel', tract: 'Auction tract', saved: 'Saved tract', point: 'Parcel' }
const LIMIT = 200

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

function placeOf(r: NoteSearchResult) {
  // Same place line as the app: "Hancock County, IL" (the server's county can be lowercase).
  const county = titleCase(r.item.county || '')
  return [county && !/\s(county|parish|borough)$/i.test(county) ? `${county} County` : county, r.item.state].filter(Boolean).join(', ')
}

const pictureKind = (k: string) => (k === 'saved' || k === 'tract' || k === 'parcel' ? k : undefined)
const label: CSSProperties = { ...muted, fontSize: 11, display: 'flex', flexDirection: 'column', gap: 3 }

export default function NotesPanel({ open, onClose, onBack, onOpen, onNewNote, isFirm = false }: {
  open: boolean
  onClose: () => void
  onBack: () => void
  onOpen: (r: NoteSearchResult) => void
  /** "+ New": a note always belongs to a place, so the user taps it next. */
  onNewNote: () => void
  isFirm?: boolean
}) {
  const cats = useNoteCategories()
  const c = useListControls()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [category, setCategory] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [res, setRes] = useState<{ total: number; results: NoteSearchResult[] } | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    const my = ++seq.current
    const h = setTimeout(async () => {
      setLoading(true); setError(null)
      try {
        const r = await searchNotes({ q: c.q.trim() || null, category: category || null, from: from || null, to: to || null, limit: LIMIT })
        if (my === seq.current) setRes(r)
      } catch (e: any) {
        if (my === seq.current) setError(e?.message || 'Could not load notes')
      } finally { if (my === seq.current) setLoading(false) }
    }, 250)
    return () => clearTimeout(h)
  }, [open, c.q, category, from, to])

  const rows = useMemo(() => res?.results || [], [res])
  const { shown, counts } = useMemo(() => applyControls(rows, c, {
    mine: (r) => r.entry.mine !== false,
    name: (r) => r.item.label || KIND_LABEL[r.item.kind] || '',
    modified: (r) => r.entry.updated_at || r.entry.created_at,
    text: () => '',
    serverSearch: true,
  }), [rows, c])
  const filtered = !!(c.q.trim() || category || from || to)
  const nFilters = [category, from, to].filter(Boolean).length

  return (
    <MyMapsShell open={open} title="Notes" onBack={onBack} onClose={onClose} controls={c} searchPlaceholder="Search all notes"
                 onNew={onNewNote} showChips={isFirm} counts={counts} testId="notes-panel"
                 top={<>
                   <button type="button" data-testid="notes-filters-toggle" onClick={() => setFiltersOpen((v) => !v)}
                           style={{ alignSelf: 'flex-start', height: 30, padding: '0 10px', borderRadius: 15, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                                    background: nFilters ? 'rgba(245,140,222,0.18)' : '#1C1C1E', color: nFilters ? '#F58CDE' : '#fff', fontSize: 12, fontWeight: 600,
                                    display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                     <SlidersHorizontal size={13} /> Filters{nFilters ? ` · ${nFilters}` : ''}
                   </button>
                   {filtersOpen && (
                     <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                       <select style={{ ...whiteInput, gridColumn: '1 / -1' }} value={category} data-testid="notes-search-category"
                               aria-label="Category" onChange={(e) => setCategory(e.target.value)}>
                         <option value="">All categories</option>
                         {cats.categories.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                       </select>
                       <label style={label}>From<input type="date" style={whiteInput} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                       <label style={label}>To<input type="date" style={whiteInput} value={to} onChange={(e) => setTo(e.target.value)} /></label>
                       {nFilters > 0 && (
                         <button type="button" onClick={() => { setCategory(''); setFrom(''); setTo('') }}
                                 style={{ gridColumn: '1 / -1', justifySelf: 'start', background: 'none', border: 'none', color: '#F58CDE', cursor: 'pointer', padding: 0, fontSize: 12, fontFamily: 'inherit' }}>
                           Clear filters
                         </button>
                       )}
                     </div>
                   )}
                   {error && <div style={{ fontSize: 12, color: '#fca5a5' }}>{error}</div>}
                 </>}>
      {loading && !res && <div style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}><Loader2 size={14} className="animate-spin" /> Loading…</div>}
      {res && !rows.length && !loading && (
        <ListEmpty>{filtered ? 'No notes match.' : 'No notes yet. Use + New, then tap the parcel the note is for.'}</ListEmpty>
      )}
      {res && rows.length > 0 && !shown.length && <ListEmpty>No notes match.</ListEmpty>}
      {shown.map((r) => {
        const where = placeOf(r)
        const open1 = () => onOpen(r)
        return (
          <MyMapsCard key={r.entry.id} testId="notes-search-result"
                      picture={<CardPicture kind={pictureKind(r.item.kind)} id={r.item.id} icon={<StickyNote size={26} />} />}
                      title={r.item.label || KIND_LABEL[r.item.kind] || 'Item'}
                      sub={[KIND_LABEL[r.item.kind] || 'Item', where, fmtModified(r.entry.updated_at || r.entry.created_at)].filter(Boolean).join(' · ')}
                      extra={<>
                        {(r.snippet || r.entry.text) && (
                          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.88)', lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                            {r.snippet ? <Snippet html={r.snippet} /> : r.entry.text}
                          </div>
                        )}
                        <NoteProductsList products={r.entry.products} color="rgba(255,255,255,0.88)" iconColor="rgba(255,255,255,0.6)" />
                      </>}
                      tags={[
                        <Tag key="c" pink>{r.entry.category_label}</Tag>,
                        <Tag key="d">{fmtNoteDate(r.entry.entry_date)}</Tag>,
                        r.entry.mine === false ? <Tag key="a">{r.entry.author.name}</Tag> : null,
                        r.entry.internal ? <Tag key="i"><Lock size={9} style={{ display: 'inline', verticalAlign: '-1px' }} /> Internal</Tag> : null,
                      ]}
                      onOpen={open1}
                      actions={[{ label: 'Open on the map', onClick: open1, testId: 'note-open' }]} />
        )
      })}
      {res && res.total > rows.length && (
        <div style={{ ...muted, textAlign: 'center' }}>Showing the newest {rows.length} of {res.total} notes. Search or filter to find older ones.</div>
      )}
    </MyMapsShell>
  )
}
