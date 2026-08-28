'use client'

/**
 * /map-portfolio — every project a Configurable Mapping subscriber has saved.
 *
 * A 20-tract auction is ONE card here, not twenty. The list reads cached
 * summaries only — no geometry crosses the wire — so it opens at the same
 * speed whether someone has three parcels or three thousand.
 *
 * Projects ARCHIVE, they never delete. Somebody will archive a 20-tract
 * project by accident, and drawing it again is an afternoon.
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  Archive, ArchiveRestore, Copy, Loader2, Map as MapIcon, PenLine, Plus, Search,
} from 'lucide-react'
import {
  archiveParcel, duplicateProject, fetchMappingAccessState, getProject, listProjects,
  updateProject, type Project, type SavedParcelRow,
} from '@/lib/configurableMapping'

export default function MapPortfolioPage() {
  const [allowed, setAllowed] = useState<boolean | null | undefined>(undefined)
  const [projects, setProjects] = useState<Project[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openParcels, setOpenParcels] = useState<SavedParcelRow[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy('Loading…'); setError(null)
    try {
      const r = await listProjects(showArchived)
      setProjects(r.projects)
    } catch (e: any) {
      setError(e?.message || 'Could not load your portfolio.')
    } finally { setBusy(null) }
  }, [showArchived])

  useEffect(() => { fetchMappingAccessState().then(setAllowed) }, [])
  useEffect(() => { if (allowed) void refresh() }, [allowed, refresh])

  const openProject = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); setOpenParcels([]); return }
    setOpenId(id); setOpenParcels([])
    try {
      const r = await getProject(id)
      setOpenParcels(r.parcels)
    } catch (e: any) { setError(e?.message || 'Could not open that project.') }
  }, [openId])

  const act = useCallback(async (label: string, fn: () => Promise<any>) => {
    setBusy(label); setError(null)
    try { await fn(); await refresh() }
    catch (e: any) { setError(e?.message || 'That did not work.') }
    finally { setBusy(null) }
  }, [refresh])

  if (allowed === undefined) return <Shell><p style={{ opacity: 0.6 }}>Loading…</p></Shell>
  // null = could not check (lapsed session), not "not entitled".
  if (allowed === null) {
    return (
      <Shell>
        <p style={{ opacity: 0.75 }}>
          We couldn&apos;t confirm your access — your session has probably expired.{' '}
          <a href="/signin" style={{ color: '#93c5fd' }}>Sign in</a>
        </p>
      </Shell>
    )
  }
  if (!allowed) {
    return (
      <Shell>
        <h1 style={h1}>Map Portfolio</h1>
        <p style={{ opacity: 0.7, maxWidth: 440, lineHeight: 1.6 }}>
          Configurable Mapping isn&apos;t enabled on your account.
        </p>
        <Link href="/access" style={link}>Back to the map</Link>
      </Shell>
    )
  }

  const visible = projects.filter((p) =>
    !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase()) ||
    (p.county || '').toLowerCase().includes(q.trim().toLowerCase()))

  return (
    <div style={page}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 24px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={h1}>Map Portfolio</h1>
          <div style={{ flex: 1 }} />
          <Link href="/configure-map" style={{ ...btn, borderColor: '#22c55e', color: '#86efac' }}>
            <Plus size={14} /> Create Map
          </Link>
        </div>

        <div style={{ display: 'flex', gap: 10, margin: '18px 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: 10, opacity: 0.4 }} />
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Search by name or county"
                   style={{ ...input, paddingLeft: 30, width: '100%' }} />
          </div>
          <label style={{ ...btn, cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived}
                   onChange={(e) => setShowArchived(e.target.checked)}
                   style={{ marginRight: 6 }} />
            Show archived
          </label>
        </div>

        {busy && <p style={muted}><Loader2 size={13} /> {busy}</p>}
        {error && <p style={{ ...muted, color: '#fca5a5' }}>{error}</p>}

        {!busy && visible.length === 0 && (
          <div style={{ ...card, textAlign: 'center', padding: 40 }}>
            <MapIcon size={26} style={{ opacity: 0.35 }} />
            <p style={{ marginTop: 12, opacity: 0.75 }}>
              {q ? 'Nothing matches that search.' : 'You haven’t saved any parcels yet.'}
            </p>
            {!q && (
              <Link href="/configure-map" style={{ ...link, marginTop: 10, display: 'inline-block' }}>
                Draw your first one
              </Link>
            )}
          </div>
        )}

        <div style={{ display: 'grid', gap: 12 }}>
          {visible.map((p) => (
            <div key={p.id} style={{ ...card, opacity: p.archived_at ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <button onClick={() => void openProject(p.id)} style={nameBtn}>
                  {p.name}
                </button>
                <span style={muted}>
                  {p.summary?.parcels ?? 0} parcel{(p.summary?.parcels ?? 0) === 1 ? '' : 's'}
                  {' · '}{(p.summary?.acres ?? 0).toFixed(1)} ac
                  {p.summary?.tillable_acres ? ` · ${p.summary.tillable_acres.toFixed(1)} ac tillable` : ''}
                  {p.county ? ` · ${p.county} County ${p.state || ''}` : ''}
                </span>
                <div style={{ flex: 1 }} />
                <span style={{ ...muted, fontSize: 11 }}>
                  edited {new Date(p.updated_at).toLocaleDateString()}
                </span>
                <Link href={`/configure-map?project=${p.id}`} style={btn}>
                  <PenLine size={13} /> Open
                </Link>
                <button style={btn} disabled={!!busy}
                        onClick={() => void act('Duplicating…', () => duplicateProject(p.id))}>
                  <Copy size={13} /> Duplicate
                </button>
                <button style={btn} disabled={!!busy}
                        onClick={() => void act(
                          p.archived_at ? 'Restoring…' : 'Archiving…',
                          () => updateProject(p.id, { archived: !p.archived_at }))}>
                  {p.archived_at ? <><ArchiveRestore size={13} /> Restore</> : <><Archive size={13} /> Archive</>}
                </button>
              </div>

              {openId === p.id && (
                <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
                  {openParcels.length === 0 && <p style={muted}>No parcels in this project yet.</p>}
                  {openParcels.map((x) => (
                    <div key={x.id} style={parcelRow}>
                      <Link href={`/configure-map?parcel=${x.id}`} style={{ ...link, fontSize: 13 }}>
                        {x.name}
                      </Link>
                      <span style={muted}>
                        {(x.stats?.acres ?? 0).toFixed(1)} ac
                        {x.stats?.tillable_acres ? ` · ${x.stats.tillable_acres.toFixed(1)} tillable` : ''}
                        {x.stats?.soil?.rating ? ` · ${x.stats.soil.rating} ${x.stats.soil.rating_type}` : ''}
                      </span>
                      <div style={{ flex: 1 }} />
                      <button style={{ ...btn, padding: '3px 8px', fontSize: 11 }} disabled={!!busy}
                              onClick={() => void act('Archiving…', async () => {
                                await archiveParcel(x.id)
                                const r = await getProject(p.id); setOpenParcels(r.parcels)
                              })}>
                        <Archive size={11} /> Archive
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ ...page, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
      {children}
    </div>
  )
}

const page: React.CSSProperties = {
  position: 'fixed', inset: 0, overflowY: 'auto',
  background: '#0f1520', color: '#e5e7eb', zIndex: 9999,
  fontSize: 13,
}
const h1: React.CSSProperties = { fontSize: 20, fontWeight: 600, margin: 0 }
const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 10, padding: 14,
}
const btn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5,
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 7, padding: '5px 10px', color: '#e5e7eb', fontSize: 12,
  cursor: 'pointer', textDecoration: 'none',
}
const input: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 7, padding: '7px 9px', color: '#e5e7eb', fontSize: 13, outline: 'none',
}
const muted: React.CSSProperties = { opacity: 0.6, fontSize: 12, display: 'inline-flex', gap: 5, alignItems: 'center' }
const link: React.CSSProperties = { color: '#93c5fd', textDecoration: 'none' }
const nameBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: '#e5e7eb', fontSize: 15, fontWeight: 600,
  cursor: 'pointer', padding: 0, textAlign: 'left',
}
const parcelRow: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0',
  borderBottom: '1px solid rgba(255,255,255,0.05)',
}
