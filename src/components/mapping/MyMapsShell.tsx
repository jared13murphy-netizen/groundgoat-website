'use client'

/**
 * MyMapsShell — the one design every My Maps screen uses (owner 11/15,
 * mockup "FINAL — Saved Projects"): Saved Projects, Saved Reports, Notes
 * and Products.
 *
 * Header: "‹ My Maps" (back to the My Maps menu) · title · X (close).
 * Toolbar: white search box + pink "+ New".
 * Chips: All · Mine · Team with counts (firm accounts only) and a Sort
 * menu (Last modified | Name A to Z) on the same row.
 * Cards: picture (or an icon), name, a place/"Modified" line, small tags,
 * and a ⋯ menu holding that screen's actions.
 *
 * Search, chips and sort combine: useListControls() owns the three and
 * applies them to any list.
 */
import useSlide from '@/lib/useSlide'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowUpDown, Check, ChevronLeft, MoreVertical, Plus, Search, X } from 'lucide-react'

export const PINK = '#F58CDE'
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export type Chip = 'all' | 'mine' | 'team'
export type SortKey = 'modified' | 'name'

/** The screens' shared list state: search text, chip and sort. */
export function useListControls() {
  const [q, setQ] = useState('')
  const [chip, setChip] = useState<Chip>('all')
  const [sort, setSort] = useState<SortKey>('modified')
  return { q, setQ, chip, setChip, sort, setSort }
}
export type ListControls = ReturnType<typeof useListControls>

/** Chip counts, then chip + search + sort applied (in that order). */
export function applyControls<T>(items: T[], c: ListControls, get: {
  mine: (x: T) => boolean
  name: (x: T) => string
  modified: (x: T) => string | null | undefined
  /** Everything search should look in (name + secondary fields). */
  text: (x: T) => string
  /** Search done on the server already (Notes): skip the local text match. */
  serverSearch?: boolean
}) {
  const mineN = items.filter(get.mine).length
  const counts = { all: items.length, mine: mineN, team: items.length - mineN }
  const needle = c.q.trim().toLowerCase()
  let out = items.filter((x) => (c.chip === 'all' ? true : c.chip === 'mine' ? get.mine(x) : !get.mine(x)))
  if (needle && !get.serverSearch) out = out.filter((x) => get.text(x).toLowerCase().includes(needle))
  out = [...out].sort((a, b) => {
    if (c.sort === 'name') {
      const n = get.name(a).localeCompare(get.name(b), undefined, { sensitivity: 'base', numeric: true })
      if (n) return n
    }
    return (Date.parse(get.modified(b) || '') || 0) - (Date.parse(get.modified(a) || '') || 0)
  })
  return { shown: out, counts }
}

export function fmtModified(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return `Modified ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), timeZone: 'America/Chicago' })}`
}

const panel: CSSProperties = {
  position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 540,
  width: 'min(400px, calc(100% - 24px))', boxSizing: 'border-box',
  background: '#0B0B0B', color: '#fff', borderLeft: '1px solid rgba(255,255,255,0.10)',
  boxShadow: '-4px 0 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
  transition: 'transform 240ms ease', fontSize: 13,
}
const roundBtn: CSSProperties = {
  height: 36, borderRadius: 18, border: 'none', background: '#1C1C1E', color: '#fff', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
}
export const muted: CSSProperties = { color: '#A1A1AA', fontSize: 12 }
// Owner 11/3: every input is white with a light gray border.
export const whiteInput: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#FFFFFF', border: '1px solid #D4D4D8',
  borderRadius: 10, color: '#111111', padding: '9px 12px', fontSize: 14, fontFamily: 'inherit',
}
// Owner 11/12: solid buttons only. Pink + black = primary, gray #E4E4E7 + black = secondary.
export const pinkBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, height: 36, padding: '0 14px',
  borderRadius: 10, background: PINK, color: '#000', border: 'none', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit',
}
export const grayBtn: CSSProperties = { ...pinkBtn, background: '#E4E4E7' }
export const offBtn: CSSProperties = { ...pinkBtn, background: '#E4E4E7', color: '#71717A', cursor: 'not-allowed' }
export const redBtn: CSSProperties = { ...pinkBtn, background: '#EF4444', color: '#fff' }

interface ShellProps {
  open: boolean
  title: string
  /** Back to the My Maps menu. */
  onBack: () => void
  /** Close everything. */
  onClose: () => void
  controls: ListControls
  searchPlaceholder?: string
  /** "+ New". Omitted = no button. */
  onNew?: () => void
  newLabel?: string
  /** Firm accounts only (owner 11/15): non-firm users see no chip row. */
  showChips: boolean
  counts: { all: number; mine: number; team: number }
  /** Shown under the toolbar (forms, messages, extra filters). */
  top?: ReactNode
  children: ReactNode
  testId: string
  /** Marks the panel for ExploreMap's outside-click checks. */
  dataAttr?: Record<string, string>
}

export default function MyMapsShell({
  open, title, onBack, onClose, controls: c, searchPlaceholder = 'Search', onNew, newLabel = 'New',
  showChips, counts, top, children, testId, dataAttr = {},
}: ShellProps) {
  const [sortOpen, setSortOpen] = useState(false)
  const sortRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sortOpen) return
    const off = (e: MouseEvent) => { if (!sortRef.current?.contains(e.target as Node)) setSortOpen(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [sortOpen])
  const slide = useSlide(open, 240)
  if (!slide.mounted) return null
  const chip = (k: Chip, label: string) => {
    const on = c.chip === k
    return (
      <button type="button" key={k} data-testid={`mm-chip-${k}`} aria-pressed={on} onClick={() => c.setChip(k)}
              style={{ height: 32, padding: '0 12px', borderRadius: 16, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                       background: on ? PINK : '#27272A', color: on ? '#000' : '#fff', fontSize: 13, fontWeight: on ? 600 : 500 }}>
        {label} · {counts[k]}
      </button>
    )
  }
  const sortLabel = c.sort === 'name' ? 'Name' : 'Last modified'
  return (
    <div data-testid={testId} data-gg-mymaps-screen="" {...dataAttr}
         style={{ ...panel, transform: slide.shown ? 'translateX(0)' : 'translateX(100%)' }}
         onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 14px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button type="button" data-testid="mm-back" onClick={onBack} style={{ ...roundBtn, gap: 2, padding: '0 12px 0 6px', fontSize: 13, fontWeight: 500 }}>
          <ChevronLeft size={17} /> My Maps
        </button>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
        <button type="button" data-testid="mm-close" aria-label="Close" onClick={onClose} style={{ ...roundBtn, width: 36 }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ padding: '14px 16px 6px', display: 'flex', gap: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 44, padding: '0 12px', borderRadius: 10, background: '#FFFFFF',
                        border: '1px solid #D4D4D8', color: '#52525B', flex: 1, minWidth: 0, boxSizing: 'border-box' }}>
          <Search size={16} style={{ flex: 'none' }} />
          <input data-testid="mm-search" placeholder={searchPlaceholder} aria-label={searchPlaceholder} value={c.q}
                 onChange={(e) => c.setQ(e.target.value)}
                 style={{ border: 'none', outline: 'none', flex: 1, minWidth: 0, fontSize: 14, color: '#111111', background: 'transparent', fontFamily: 'inherit' }} />
          {c.q && (
            <button type="button" aria-label="Clear search" onClick={() => c.setQ('')}
                    style={{ border: 'none', background: 'none', color: '#71717A', cursor: 'pointer', padding: 0, display: 'flex' }}>
              <X size={15} />
            </button>
          )}
        </label>
        {onNew && (
          <button type="button" data-testid="mm-new" onClick={onNew} style={{ ...pinkBtn, height: 44, fontSize: 14 }}>
            <Plus size={16} strokeWidth={2.6} /> {newLabel}
          </button>
        )}
      </div>
      <div style={{ padding: '8px 16px 10px', display: 'flex', gap: 8, alignItems: 'center' }}>
        {showChips && <>{chip('all', 'All')}{chip('mine', 'Mine')}{chip('team', 'Team')}</>}
        <div style={{ flex: 1 }} />
        <div ref={sortRef} style={{ position: 'relative' }}>
          <button type="button" data-testid="mm-sort" aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen((v) => !v)}
                  style={{ height: 32, padding: '0 10px', borderRadius: 16, border: 'none', background: '#27272A', color: '#fff', cursor: 'pointer',
                           display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 500, fontFamily: 'inherit' }}>
            <ArrowUpDown size={14} /> {sortLabel}
          </button>
          {sortOpen && (
            <div role="menu" data-testid="mm-sort-menu"
                 style={{ position: 'absolute', right: 0, top: 38, zIndex: 20, width: 210, borderRadius: 12, background: '#1C1C1E',
                          border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 12px 32px rgba(0,0,0,0.6)', padding: 6 }}>
              <div style={{ padding: '8px 10px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#A1A1AA' }}>SORT BY</div>
              {([['modified', 'Last modified'], ['name', 'Name (A to Z)']] as [SortKey, string][]).map(([k, label]) => (
                <button key={k} type="button" role="menuitemradio" aria-checked={c.sort === k} data-testid={`mm-sort-${k}`}
                        onClick={() => { c.setSort(k); setSortOpen(false) }}
                        style={{ width: '100%', height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px',
                                 borderRadius: 8, border: 'none', background: c.sort === k ? '#27272A' : 'transparent', color: '#fff',
                                 fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  {label} {c.sort === k && <Check size={16} color={PINK} strokeWidth={2.6} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {top && <div style={{ padding: '0 16px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>{top}</div>}
      <div data-testid="mm-list" style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {children}
      </div>
    </div>
  )
}

/** Empty / no-match line inside the list. */
export function ListEmpty({ children }: { children: ReactNode }) {
  return <div data-testid="mm-empty" style={{ ...muted, padding: '18px 4px', textAlign: 'center', lineHeight: 1.45 }}>{children}</div>
}

export interface CardAction { label: string; onClick: () => void; danger?: boolean; testId?: string }

/** A card's picture: the saved card image when there is one, else the icon. */
export function CardPicture({ kind, id, icon }: { kind?: 'saved' | 'tract' | 'parcel'; id?: string | null; icon: ReactNode }) {
  const [ok, setOk] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setOk(false); setFailed(false) }, [kind, id])
  const src = kind && id && !failed ? `${API_URL}/api/card-image/${kind}/${encodeURIComponent(id)}` : null
  return (
    <div style={{ width: 84, height: 64, borderRadius: 8, overflow: 'hidden', flex: 'none', background: '#1F2A1C',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.7)', position: 'relative' }}>
      {!ok && icon}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onLoad={() => setOk(true)} onError={() => setFailed(true)}
             style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: ok ? 'block' : 'none' }} />
      )}
    </div>
  )
}

export function Tag({ children, pink = false }: { children: ReactNode; pink?: boolean }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap',
                   background: pink ? 'rgba(245,140,222,0.18)' : '#27272A', color: pink ? PINK : '#E4E4E7' }}>
      {children}
    </span>
  )
}

/** One list card (option A). Clicking the body runs onOpen; ⋯ holds `actions`. */
export function MyMapsCard({
  picture, title, sub, extra, tags, actions = [], onOpen, children, testId = 'mm-card', dim = false,
}: {
  picture: ReactNode
  title: ReactNode
  sub?: ReactNode
  /** A line under sub (e.g. "shared by …", a note's text). */
  extra?: ReactNode
  tags?: ReactNode[]
  actions?: CardAction[]
  onOpen?: () => void
  /** Shown inside the card under its main row (an expanded project, an edit form). */
  children?: ReactNode
  testId?: string
  dim?: boolean
}) {
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setMenu(false) }
    document.addEventListener('mousedown', off)
    return () => document.removeEventListener('mousedown', off)
  }, [menu])
  const shownTags = useMemo(() => (tags || []).filter(Boolean), [tags])
  return (
    <div data-testid={testId} style={{ borderRadius: 12, background: '#161616', border: '1px solid rgba(255,255,255,0.10)', opacity: dim ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 10, position: 'relative' }}>
        <div onClick={onOpen} style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, minWidth: 0, cursor: onOpen ? 'pointer' : 'default' }}
             role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined}
             onKeyDown={(e) => { if (onOpen && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen() } }}>
          {picture}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div data-testid="mm-card-title" style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            {sub && <div style={{ ...muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub}</div>}
            {extra}
            {shownTags.length > 0 && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>{shownTags}</div>}
          </div>
        </div>
        {actions.length > 0 && (
          <div ref={ref} style={{ position: 'relative', alignSelf: 'stretch', display: 'flex', alignItems: 'center' }}>
            <button type="button" data-testid="mm-card-menu" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu}
                    onClick={() => setMenu((v) => !v)}
                    style={{ width: 32, height: 44, border: 'none', background: 'transparent', color: '#A1A1AA', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MoreVertical size={18} />
            </button>
            {menu && (
              <div role="menu" style={{ position: 'absolute', right: 0, top: 40, zIndex: 20, minWidth: 190, borderRadius: 12, background: '#1C1C1E',
                                        border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 12px 32px rgba(0,0,0,0.6)', padding: 6 }}>
                {actions.map((a) => (
                  <button key={a.label} type="button" role="menuitem" data-testid={a.testId}
                          onClick={() => { setMenu(false); a.onClick() }}
                          style={{ display: 'block', width: '100%', textAlign: 'left', height: 38, padding: '0 10px', borderRadius: 8, border: 'none',
                                   background: 'transparent', color: a.danger ? '#FCA5A5' : '#fff', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {children && <div style={{ padding: '0 10px 10px' }}>{children}</div>}
    </div>
  )
}
