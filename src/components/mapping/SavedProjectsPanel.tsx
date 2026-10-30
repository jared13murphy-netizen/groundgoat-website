'use client'

/**
 * SavedProjectsPanel — the Explore map's left slide-out for the user's
 * projects and saved maps (tracts). Replaces the separate Map Portfolio /
 * Configure Map screens: everything happens over the map.
 *
 * Projects load once on open; a project's maps load the first time it is
 * expanded and are cached until something changes. All writes go through
 * configurableMapping.ts; the host (ExploreMap) refreshes its map layer via
 * onChanged and owns what "Edit in Map It" and "Add a New Tract" do.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  ChevronDown, ChevronRight, FolderPlus, Loader2, MoreHorizontal, Plus, X,
} from 'lucide-react'
import {
  archiveParcel, createProject, getProject, listProjects, moveParcel, renameParcel,
  updateProject, type Project, type SavedParcelRow,
} from '@/lib/configurableMapping'

const PINK = '#F58CDE'

export interface PanelTract { id: string; name: string; projectId: string; projectName: string }

interface Props {
  open: boolean
  onClose: () => void
  /** Bump to reload the lists (a Map It save happened). */
  reloadNonce: number
  /** Open the panel with this project expanded. `n` makes repeat requests distinct. */
  focus: { projectId: string; n: number } | null
  onEditTract: (t: PanelTract) => void
  onAddTract: (p: { id: string; name: string }) => void
  onShowTract: (tractId: string) => void
  /** A rename/move/delete happened: refresh the map's saved-maps layer. */
  onChanged: () => void
}

const panel: CSSProperties = {
  position: 'absolute', top: 0, left: 0, bottom: 0, zIndex: 540,
  width: 'min(340px, calc(100% - 24px))', boxSizing: 'border-box',
  background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(8px)', color: '#fff',
  boxShadow: '4px 0 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
  fontSize: 13,
}
const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, color: '#fff',
  padding: '7px 10px', fontSize: 13,
}
const muted: CSSProperties = { color: 'rgba(255,255,255,0.6)', fontSize: 11 }
const iconBtn: CSSProperties = {
  background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer',
  padding: 4, display: 'inline-flex', alignItems: 'center', borderRadius: 6,
}
const pinkBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999,
  background: PINK, color: '#000', border: `1px solid ${PINK}`, fontSize: 12, fontWeight: 700,
  cursor: 'pointer', whiteSpace: 'nowrap',
}
const menuBox: CSSProperties = {
  position: 'absolute', right: 6, top: 28, zIndex: 5, minWidth: 170,
  background: 'rgba(20,20,20,0.98)', border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 10, padding: 4, boxShadow: '0 6px 18px rgba(0,0,0,0.5)',
}
const menuItem: CSSProperties = {
  display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none',
  color: '#fff', padding: '7px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
}

const fmt = (n: unknown) => (typeof n === 'number' && isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '0')

function mapLine(t: SavedParcelRow) {
  const st: any = t.stats || {}
  const bits = [`${fmt(st.acres)} ac`]
  if (st.tillable_acres) bits.push(`${fmt(st.tillable_acres)} tillable`)
  if (st.soil?.rating) bits.push(`soil ${st.soil.rating}`)
  return bits.join(' · ')
}

type Detail = { loading: boolean; error?: string; parcels: SavedParcelRow[] }

export default function SavedProjectsPanel({
  open, onClose, reloadNonce, focus, onEditTract, onAddTract, onShowTract, onChanged,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [details, setDetails] = useState<Record<string, Detail>>({})
  const detailsRef = useRef(details); detailsRef.current = details
  const [menu, setMenu] = useState<string | null>(null)        // 'p:<id>' | 't:<id>'
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null)
  const [moving, setMoving] = useState<string | null>(null)    // tract id
  const [creating, setCreating] = useState<string | null>(null) // new project name draft
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const loadProjects = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await listProjects()
      setProjects(r.projects || [])
    } catch (e: any) {
      setError(e?.message || 'Could not load your projects.')
    } finally { setLoading(false) }
  }, [])

  const loadDetail = useCallback(async (id: string, force = false) => {
    if (!force && detailsRef.current[id]) return
    setDetails((d) => ({ ...d, [id]: { loading: true, parcels: d[id]?.parcels || [] } }))
    try {
      const r = await getProject(id)
      setDetails((d) => ({ ...d, [id]: { loading: false, parcels: r.parcels || [] } }))
    } catch (e: any) {
      setDetails((d) => ({ ...d, [id]: { loading: false, parcels: [], error: e?.message || 'Could not load maps.' } }))
    }
  }, [])

  /** Reload the project list and every expanded project's maps. */
  const refreshAll = useCallback(async () => {
    await loadProjects()
    for (const id of Object.keys(detailsRef.current)) void loadDetail(id, true)
  }, [loadProjects, loadDetail])

  useEffect(() => { if (open) void loadProjects() }, [open, loadProjects])
  const firstNonce = useRef(reloadNonce)
  useEffect(() => {
    if (reloadNonce === firstNonce.current) return
    if (open) void refreshAll()
    else setDetails({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadNonce])

  useEffect(() => {
    if (!focus) return
    setExpanded((x) => ({ ...x, [focus.projectId]: true }))
    void loadDetail(focus.projectId, true)
  }, [focus, loadDetail])

  // Close the row menu on any outside click.
  useEffect(() => {
    if (!menu) return
    const off = () => setMenu(null)
    document.addEventListener('click', off)
    return () => document.removeEventListener('click', off)
  }, [menu])

  // Typing in the filter searches map names too: fetch the maps of
  // projects not loaded yet (bounded, a few at a time).
  const q = filter.trim().toLowerCase()
  useEffect(() => {
    if (q.length < 2) return
    const todo = projects.filter((p) => !detailsRef.current[p.id]).slice(0, 60)
    let cancelled = false
    ;(async () => {
      for (let i = 0; i < todo.length && !cancelled; i += 4) {
        await Promise.all(todo.slice(i, i + 4).map((p) => loadDetail(p.id)))
      }
    })()
    return () => { cancelled = true }
  }, [q.length >= 2, projects, loadDetail]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => {
    const next = !expanded[id]
    setExpanded((x) => ({ ...x, [id]: next }))
    if (next) void loadDetail(id)
  }

  const visible = useMemo(() => {
    if (!q) return projects.map((p) => ({ p, maps: details[p.id]?.parcels || [], nameHit: true }))
    const out: { p: Project; maps: SavedParcelRow[]; nameHit: boolean }[] = []
    for (const p of projects) {
      const all = details[p.id]?.parcels || []
      const nameHit = `${p.name} ${p.county || ''} ${p.state || ''}`.toLowerCase().includes(q)
      const mapHits = all.filter((t) => (t.name || '').toLowerCase().includes(q))
      if (nameHit) out.push({ p, maps: all, nameHit })
      else if (mapHits.length) out.push({ p, maps: mapHits, nameHit })
    }
    return out
  }, [projects, details, q])

  const run = async (label: string, fn: () => Promise<unknown>, then?: () => void) => {
    setBusy(label); setMsg(null)
    try {
      await fn()
      then?.()
      await refreshAll()
      onChanged()
    } catch (e: any) {
      setMsg(e?.message || `${label} failed.`)
    } finally { setBusy(null) }
  }

  const submitNewProject = async () => {
    const name = (creating || '').trim()
    if (!name) return
    setBusy('Creating…'); setMsg(null)
    try {
      const r = await createProject(name)
      setCreating(null)
      await loadProjects()
      setExpanded((x) => ({ ...x, [r.id]: true }))
      setDetails((d) => ({ ...d, [r.id]: { loading: false, parcels: [] } }))
    } catch (e: any) {
      setMsg(e?.message || 'Could not create the project.')
    } finally { setBusy(null) }
  }

  const editingRef = useRef(editing); editingRef.current = editing
  const cancelEdit = () => { editingRef.current = null; setEditing(null) }
  const commitRename = () => {
    // Enter and blur can both fire; the ref makes the second one a no-op.
    const cur = editingRef.current
    if (!cur) return
    editingRef.current = null
    const text = cur.text.trim()
    const [kind, id] = cur.key.split(':')
    setEditing(null)
    if (!text) return
    void run('Renaming…', () => (kind === 'p' ? updateProject(id, { name: text }) : renameParcel(id, text)))
  }

  if (!open) return null

  const ownProjects = projects.filter((p) => !p.shared)

  return (
    <div style={panel} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div style={{ padding: '12px 12px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Saved Projects</span>
          <button type="button" style={pinkBtn} onClick={() => setCreating(creating === null ? '' : null)}>
            <FolderPlus size={13} /> New Project
          </button>
          <button type="button" style={iconBtn} onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {creating !== null && (
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              autoFocus style={input} value={creating} placeholder="Project name"
              onChange={(e) => setCreating(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitNewProject()
                if (e.key === 'Escape') setCreating(null)
              }} />
            <button type="button" style={{ ...pinkBtn, opacity: creating.trim() ? 1 : 0.5 }}
                    disabled={!creating.trim() || !!busy} onClick={() => void submitNewProject()}>Create</button>
          </div>
        )}
        <input style={input} value={filter} placeholder="Find a project or map…"
               onChange={(e) => setFilter(e.target.value)} />
        {(msg || error) && (
          <div style={{ fontSize: 12, color: '#fca5a5' }}>{msg || error}</div>
        )}
        {busy && (
          <div style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Loader2 size={12} className="animate-spin" /> {busy}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 14px' }}>
        {loading && !projects.length && (
          <div style={{ ...muted, padding: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Loader2 size={13} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && !error && !visible.length && (
          <div style={{ ...muted, padding: 12 }}>
            {q ? 'Nothing matches.' : 'No projects yet. Use New Project, or Map It on any parcel.'}
          </div>
        )}
        {visible.map(({ p, maps, nameHit }) => {
          const isOpen = !!expanded[p.id] || (!!q && !nameHit)
          const det = details[p.id]
          const where = [p.county, p.state].filter(Boolean).join(', ')
          const sm = p.summary || ({} as any)
          const pKey = `p:${p.id}`
          return (
            <div key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '6px 4px' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                <button type="button" style={{ ...iconBtn, marginTop: 1 }} onClick={() => toggle(p.id)}
                        aria-label={isOpen ? 'Collapse' : 'Expand'}>
                  {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>
                <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => toggle(p.id)}>
                  {editing?.key === pKey ? (
                    <input autoFocus style={input} value={editing.text}
                           onClick={(e) => e.stopPropagation()}
                           onChange={(e) => setEditing({ key: pKey, text: e.target.value })}
                           onBlur={commitRename}
                           onKeyDown={(e) => {
                             if (e.key === 'Enter') commitRename()
                             if (e.key === 'Escape') cancelEdit()
                           }} />
                  ) : (
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </div>
                  )}
                  <div style={muted}>
                    {where ? `${where} · ` : ''}
                    {sm.parcels ?? 0} map{(sm.parcels ?? 0) === 1 ? '' : 's'} · {fmt(sm.acres)} ac · {fmt(sm.tillable_acres)} tillable
                  </div>
                  {p.shared && <div style={{ ...muted, color: PINK }}>shared by {p.shared_by || 'a colleague'}</div>}
                </div>
                <button type="button" style={iconBtn} aria-label="Project menu"
                        onClick={(e) => { e.stopPropagation(); setMenu(menu === pKey ? null : pKey) }}>
                  <MoreHorizontal size={16} />
                </button>
                {menu === pKey && (
                  <div style={menuBox} onClick={(e) => e.stopPropagation()}>
                    <button type="button" style={menuItem}
                            onClick={() => { setMenu(null); onAddTract({ id: p.id, name: p.name }) }}>
                      Add a New Tract
                    </button>
                    {!p.shared && (
                      <>
                        <button type="button" style={menuItem}
                                onClick={() => { setMenu(null); setEditing({ key: pKey, text: p.name }) }}>
                          Rename
                        </button>
                        <button type="button" style={{ ...menuItem, color: '#fca5a5' }}
                                onClick={() => {
                                  setMenu(null)
                                  if (!window.confirm(`Delete the project "${p.name}"? Its maps are archived with it.`)) return
                                  void run('Deleting…', () => updateProject(p.id, { archived: true }))
                                }}>
                          Delete project
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {isOpen && (
                <div style={{ marginLeft: 22, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(det?.loading && !maps.length) && (
                    <div style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Loader2 size={12} className="animate-spin" /> Loading maps…
                    </div>
                  )}
                  {det?.error && <div style={{ fontSize: 12, color: '#fca5a5' }}>{det.error}</div>}
                  {det && !det.loading && !det.error && !det.parcels.length && (
                    <div style={muted}>No maps in this project yet.</div>
                  )}
                  {maps.map((t) => {
                    const tKey = `t:${t.id}`
                    return (
                      <div key={t.id} style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 4,
                                               padding: '4px 4px', borderRadius: 8, background: 'rgba(255,255,255,0.04)' }}>
                        <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
                             onClick={() => { if (editing?.key !== tKey) onShowTract(t.id) }}>
                          {editing?.key === tKey ? (
                            <input autoFocus style={input} value={editing.text}
                                   onClick={(e) => e.stopPropagation()}
                                   onChange={(e) => setEditing({ key: tKey, text: e.target.value })}
                                   onBlur={commitRename}
                                   onKeyDown={(e) => {
                                     if (e.key === 'Enter') commitRename()
                                     if (e.key === 'Escape') cancelEdit()
                                   }} />
                          ) : (
                            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t.name || 'Untitled'}
                            </div>
                          )}
                          <div style={muted}>{mapLine(t)}</div>
                          {moving === t.id && (
                            <select
                              autoFocus style={{ ...input, marginTop: 4 }} defaultValue=""
                              onClick={(e) => e.stopPropagation()}
                              onBlur={() => setMoving(null)}
                              onChange={(e) => {
                                const target = e.target.value
                                setMoving(null)
                                if (target) void run('Moving…', () => moveParcel(t.id, target))
                              }}>
                              <option value="" disabled>Move to…</option>
                              {ownProjects.filter((o) => o.id !== p.id)
                                .map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                            </select>
                          )}
                        </div>
                        <button type="button" style={iconBtn} aria-label="Map menu"
                                onClick={(e) => { e.stopPropagation(); setMenu(menu === tKey ? null : tKey) }}>
                          <MoreHorizontal size={16} />
                        </button>
                        {menu === tKey && (
                          <div style={menuBox} onClick={(e) => e.stopPropagation()}>
                            <button type="button" style={menuItem}
                                    onClick={() => { setMenu(null); onEditTract({ id: t.id, name: t.name, projectId: p.id, projectName: p.name }) }}>
                              Edit in Map It
                            </button>
                            <button type="button" style={menuItem}
                                    onClick={() => { setMenu(null); setEditing({ key: tKey, text: t.name }) }}>
                              Rename
                            </button>
                            {!p.shared && ownProjects.length > 1 && (
                              <button type="button" style={menuItem}
                                      onClick={() => { setMenu(null); setMoving(t.id) }}>
                                Move to project…
                              </button>
                            )}
                            <button type="button" style={{ ...menuItem, color: '#fca5a5' }}
                                    onClick={() => {
                                      setMenu(null)
                                      if (!window.confirm(`Delete the map "${t.name}"?`)) return
                                      void run('Deleting…', () => archiveParcel(t.id))
                                    }}>
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {!q && (
                    <button type="button" style={{ ...pinkBtn, alignSelf: 'flex-start', marginTop: 4 }}
                            onClick={() => onAddTract({ id: p.id, name: p.name })}>
                      <Plus size={12} /> Add a New Tract
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
