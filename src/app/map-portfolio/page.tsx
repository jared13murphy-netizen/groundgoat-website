'use client'

/**
 * /map-portfolio — every project a Configurable Mapping subscriber has
 * saved, on the map and in a list beside it.
 *
 * The map opens showing EVERY saved tract. Picking a project — from the
 * list, or by clicking a tract on the map — narrows the map to that
 * project and frames it. A 20-tract auction is ONE row in the list.
 *
 * The list itself reads cached summaries only. The map fetches outlines
 * and label points, never land-type polygons: at this zoom they are
 * smaller than the outline stroke, and a few hundred tracts of them
 * would be tens of megabytes.
 *
 * Projects ARCHIVE, they never delete. Somebody will archive a 20-tract
 * project by accident, and drawing it again is an afternoon.
 */
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  Archive, ArchiveRestore, Check, Loader2, Map as MapIcon, PenLine, Plus, Search, X,
} from 'lucide-react'
import {
  allTractsGeometry, archiveParcel, fetchMappingAccessState, getProject, listProjects,
  renameParcel, updateProject,
  type PortfolioTract, type Project, type SavedParcelRow,
} from '@/lib/configurableMapping'
import PortfolioMap from '@/components/mapping/PortfolioMap'

export default function MapPortfolioPage() {
  const [allowed, setAllowed] = useState<boolean | null | undefined>(undefined)
  const [projects, setProjects] = useState<Project[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [openParcels, setOpenParcels] = useState<SavedParcelRow[]>([])
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const [tracts, setTracts] = useState<PortfolioTract[]>([])

  const saveRename = async (parcelId: string, projectId: string) => {
    const n = renameTo.trim()
    if (!n) return
    await act('Renaming…', async () => {
      await renameParcel(parcelId, n)
      setRenameId(null)
      const r = await getProject(projectId); setOpenParcels(r.parcels)
    })
  }
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setBusy('Loading…'); setError(null)
    try {
      const r = await listProjects(showArchived)
      setProjects(r.projects)
      // Geometry is a separate, slower call — never let it hold up the
      // list, which is what most visits are actually here for.
      allTractsGeometry()
        .then((g) => setTracts(g.tracts))
        .catch(() => { /* the map degrades to empty; the list still works */ })
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

  /** Clicking a tract on the map selects the project it belongs to —
   *  the same act as opening that project in the list. */
  const pickProject = useCallback((id: string) => {
    setOpenId((cur) => {
      if (cur === id) return cur
      setOpenParcels([])
      getProject(id)
        .then((r) => setOpenParcels(r.parcels))
        .catch(() => { /* the map is already narrowed; the list catches up */ })
      return id
    })
  }, [])

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
      {/* Map first, list beside it: the tracts ARE the portfolio, and a
          list of names never told anyone where their ground is. */}
      <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
        <PortfolioMap tracts={tracts} selectedProject={openId} onPickProject={pickProject} />
        {openId && (
          <button onClick={() => { setOpenId(null); setOpenParcels([]) }}
                  style={{
                    position: 'absolute', top: 14, left: 14, zIndex: 5,
                    ...btn, padding: '7px 12px',
                    background: 'rgba(8,8,10,0.86)', borderColor: '#f58cde',
                  }}>
            <X size={13} /> Show every tract
          </button>
        )}
      </div>

      <aside style={panel}>
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
                <button onClick={() => void openProject(p.id)} style={nameBtn}
                        title="Show the tracts in this project">
                  {openId === p.id ? '▾ ' : '▸ '}{p.name}
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
                <Link href={`/configure-map?project=${p.id}&new=1`} style={btn}>
                  <Plus size={13} /> Add tract
                </Link>
                <button style={btn} disabled={!!busy}
                        onClick={() => void act(
                          p.archived_at ? 'Restoring…' : 'Archiving…',
                          () => updateProject(p.id, { archived: !p.archived_at }))}>
                  {p.archived_at ? <><ArchiveRestore size={13} /> Restore</> : <><Archive size={13} /> Archive</>}
                </button>
              </div>

              {openId === p.id && (
                <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 }}>
                  {openParcels.length === 0 && (
                    <p style={muted}>
                      No tracts in this project yet — use “Add tract” to draw one.
                    </p>
                  )}
                  {openParcels.map((x) => (
                    <div key={x.id} style={parcelRow}>
                      {/* Same gesture as the map panel: text, pencil,
                          then x to abandon and a tick to keep. */}
                      {renameId === x.id ? (
                        <>
                          <input
                            autoFocus value={renameTo}
                            onChange={(e) => setRenameTo(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') setRenameId(null)
                              if (e.key === 'Enter') void saveRename(x.id, p.id)
                            }}
                            style={{ ...input, fontSize: 13, padding: '4px 8px', width: 220 }} />
                          <button style={{ ...btn, padding: '3px 7px', fontSize: 11 }}
                                  title="Cancel" aria-label="Cancel rename"
                                  onClick={() => setRenameId(null)}>
                            <X size={12} />
                          </button>
                          <button style={{ ...btn, padding: '3px 7px', fontSize: 11 }}
                                  disabled={!!busy || !renameTo.trim()}
                                  title="Save this name" aria-label="Save this name"
                                  onClick={() => void saveRename(x.id, p.id)}>
                            <Check size={12} />
                          </button>
                        </>
                      ) : (
                        <Link href={`/configure-map?parcel=${x.id}`} style={{ ...link, fontSize: 13 }}>
                          {x.name}
                        </Link>
                      )}
                      <span style={muted}>
                        {(x.stats?.acres ?? 0).toFixed(1)} ac
                        {x.stats?.tillable_acres ? ` · ${x.stats.tillable_acres.toFixed(1)} tillable` : ''}
                        {x.stats?.soil?.rating ? ` · ${x.stats.soil.rating} ${x.stats.soil.rating_type}` : ''}
                      </span>
                      <div style={{ flex: 1 }} />
                      {renameId !== x.id && (
                        <button style={{ ...btn, padding: '3px 7px', fontSize: 11 }} disabled={!!busy}
                                title="Rename this tract" aria-label="Rename this tract"
                                onClick={() => { setRenameId(x.id); setRenameTo(x.name) }}>
                          <PenLine size={12} />
                        </button>
                      )}
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
      </aside>
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
  position: 'fixed', inset: 0, display: 'flex',
  background: '#0f1520', color: '#e5e7eb', zIndex: 9999,
  fontSize: 13,
}
/** The list. Only this side scrolls — a map that scrolls the page under
 *  it is unusable. */
const panel: React.CSSProperties = {
  width: 420, flexShrink: 0, overflowY: 'auto',
  padding: '20px 18px 48px',
  background: 'linear-gradient(180deg, #23262b 0%, #131519 14%, #0a0a0a 44%, #050505 100%)',
  borderLeft: '1px solid rgba(255,255,255,0.10)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.16)',
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
