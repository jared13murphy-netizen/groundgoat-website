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
import CardThumb from '@/components/CardThumb'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  Check, ChevronDown, ChevronRight, Download, Folder, Image as ImageIcon, Loader2, Map as MapIcon, MoreHorizontal, Plus, StickyNote, Trash2, Upload, X,
} from 'lucide-react'
import {
  createProject, deleteFarm, deleteReport, downloadReport, duplicateProject, firmMembers,
  getProject, linkParcels, listProjects, listReports, parcelProjects, projectShares, queueReport, renameParcel, unlinkParcel,
  reportFilename, setProjectShares, updateProject, updateProjectAerialYear,
  REPORT_BUSY_LABEL, REPORT_LABEL, USES_ELEVATION,
  addLibraryLogo, deleteLibraryLogo, fetchLibraryLogoUrl, getBranding, setBranding,
  listSavedReports, renameSavedReport, deleteSavedReport, type SavedReportRow,
  type FirmMember, type LibraryLogo, type Project, type ReportKind, type ReportRow, type SavedParcelRow,
} from '@/lib/configurableMapping'
import { AERIAL_YEARS } from '@/components/map/mapConstants'
import { SavedReportCard } from '@/components/mapping/SavedReportsPanel'
import MyMapsShell, {
  CardPicture, ListEmpty, MyMapsCard, Tag, applyControls, fmtModified, grayBtn, offBtn, pinkBtn as shellPink, useListControls, whiteInput,
} from '@/components/mapping/MyMapsShell'
import NotesTimeline from '@/components/notes/NotesTimeline'
import NotesPrintChoice from '@/components/notes/NotesPrintChoice'
import { DEFAULT_NOTES_PRINT, notesPrintBody, type NotesPrint } from '@/lib/notes'

const PINK = '#F58CDE'
/** Same default the old Configure Map slider started at. */
const DEFAULT_EXAGGERATION = 2.5
/** Stop polling a report that never finishes (~5 min at 3 s). */
const POLL_MS = 3000
const POLL_CAP_MS = 5 * 60 * 1000
const MAP_REPORT_KINDS: ReportKind[] = ['soil_map', 'ground_goat', 'elevation_3d']

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
  /** Zoom the map to every map in the project (owner 10/30). */
  onShowProject: (projectId: string) => void
  /** A rename/move/delete happened: refresh the map's saved-maps layer. */
  onChanged: () => void
  /** Owner 11/2: bumped by the My Maps "New Project" tile — opens the
   *  New Project name box, same as the panel's own button. */
  newProjectNonce?: number
  /** Owner 11/3: open a saved comp report (rebuilt live) in the report panel. */
  onOpenSavedReport?: (id: string) => void
  /** Back to the My Maps menu (owner 11/15: every My Maps screen has it). */
  onBack: () => void
  /** Firm account: show the All / Mine / Team chips. */
  isFirm?: boolean
}

const input: CSSProperties = {
  // Owner 11/3: input boxes are ALWAYS white with a light gray border —
  // never a dark box, even inside a dark panel.
  width: '100%', boxSizing: 'border-box', background: '#FFFFFF',
  border: '1px solid #D1D5DB', borderRadius: 8, color: '#111111',
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

const section: CSSProperties = {
  background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 10px', marginBottom: 4,
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
  open, onClose, reloadNonce, focus, onEditTract, onAddTract, onShowTract, onShowProject, onChanged, newProjectNonce = 0, onOpenSavedReport,
  onBack, isFirm = false,
}: Props) {
  // Which tract cards show their notes timeline (owner 11/10).
  const [notesFor, setNotesFor] = useState<Record<string, boolean>>({})
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({})
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Search box, All / Mine / Team and sort (shared My Maps controls, owner 11/15).
  const c = useListControls()
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [details, setDetails] = useState<Record<string, Detail>>({})
  const detailsRef = useRef(details); detailsRef.current = details
  const [menu, setMenu] = useState<string | null>(null)        // 'p:<id>' | 't:<id>'
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null)
  // Saved reports (owner 11/3): every comp report the user emailed, downloaded
  // or saved. Those built from a Map It tract hang under that tract; the rest
  // list at the bottom of the panel.
  const [savedReports, setSavedReports] = useState<SavedReportRow[]>([])
  const loadSavedReports = useCallback(async () => {
    try { setSavedReports((await listSavedReports()).reports || []) } catch { /* panel still works without them */ }
  }, [])
  const reportsForTract = (tractId: string) => savedReports.filter((r) => r.parcel_id === tractId)
  // Owner 11/10: a report saved together with "Save as project" belongs to
  // the project: listed in the project's Reports, above its maps.
  const reportsForProject = (projectId: string) => savedReports.filter((r) => r.project_id === projectId && !r.parcel_id)
  const renameReport = async (r: SavedReportRow) => {
    const name = window.prompt('Report name', r.name)
    if (name == null || !name.trim() || name.trim() === r.name) return
    try { await renameSavedReport(r.id, name.trim()); await loadSavedReports() } catch (e: any) { setMsg(e?.message || 'Could not rename the report.') }
  }
  const removeSavedReport = async (r: SavedReportRow) => {
    if (!window.confirm(`Delete the saved report "${r.name}"?`)) return
    try { await deleteSavedReport(r.id); setSavedReports((x) => x.filter((y) => y.id !== r.id)) } catch (e: any) { setMsg(e?.message || 'Could not delete the report.') }
  }
  const reportLine = (r: SavedReportRow) => (
    <SavedReportCard key={r.id} r={r} onOpen={(id) => onOpenSavedReport?.(id)} onRename={(x) => void renameReport(x)} onDelete={(x) => void removeSavedReport(x)} />
  )
  // v2 (owner 11/10): a farm (one drawing) can be in many projects. Keys are
  // '<projectId>:<tractId>' because the same farm can show under several
  // expanded projects at once.
  const [adding, setAdding] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ key: string; id: string; name: string; projects: string[] | null } | null>(null)
  const askDeleteFarm = async (key: string, t: SavedParcelRow, fallback: string[]) => {
    setDeleting({ key, id: t.id, name: t.name || 'Untitled', projects: null })
    let names = fallback
    try {
      const r = await parcelProjects(t.id)
      if (r.projects?.length) names = r.projects.map((x) => x.name)
    } catch { /* older API / offline: name the projects we already know */ }
    setDeleting((d) => (d && d.key === key ? { ...d, projects: names } : d))
  }
  const [creating, setCreating] = useState<string | null>(null) // new project name draft
  useEffect(() => { if (newProjectNonce > 0) setCreating('') }, [newProjectNonce])

  // ── Report Logo (owner 11/2: back on this panel, for every mapping user —
  // premium state subscribers included, not just firms). Same library API
  // the retired Map Portfolio card used: upload several, pick the one that
  // prints, remove. Firm members see the firm's logos too.
  const [logoOpen, setLogoOpen] = useState(false)
  const [brandName, setBrandName] = useState('')
  const [libraryLogos, setLibraryLogos] = useState<LibraryLogo[]>([])
  const [libraryUrls, setLibraryUrls] = useState<Record<string, string>>({})
  const [selectedLogoId, setSelectedLogoId] = useState<string | null>(null)
  const [brandSaving, setBrandSaving] = useState<'name' | 'logo' | 'remove' | null>(null)
  const [brandMsg, setBrandMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [brandLoaded, setBrandLoaded] = useState(false)
  const loadBranding = useCallback(async () => {
    try {
      const b = await getBranding()
      setBrandName(b.name || '')
      const logos = b.logos || []
      setLibraryLogos(logos)
      setSelectedLogoId(b.selected_logo_id || null)
      const urls: Record<string, string> = {}
      await Promise.all(logos.map(async (l) => { const u = await fetchLibraryLogoUrl(l.id); if (u) urls[l.id] = u }))
      setLibraryUrls(urls)
      setBrandLoaded(true)
    } catch (e: any) {
      setBrandMsg({ kind: 'err', text: e?.message || 'Could not load your report logo.' })
    }
  }, [])
  useEffect(() => { if (open && logoOpen && !brandLoaded) void loadBranding() }, [open, logoOpen, brandLoaded, loadBranding])
  const saveBrandName = async () => {
    setBrandSaving('name'); setBrandMsg(null)
    try { await setBranding({ name: brandName.trim() }); setBrandMsg({ kind: 'ok', text: 'Company name saved.' }) }
    catch (e: any) { setBrandMsg({ kind: 'err', text: e?.message || 'Could not save that name.' }) }
    finally { setBrandSaving(null) }
  }
  const uploadLogo = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) { setBrandMsg({ kind: 'err', text: 'That logo is too big — please use an image under 2 MB.' }); return }
    setBrandMsg(null)
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Could not read that file.'))
      reader.readAsDataURL(file)
    }).catch((e: Error) => { setBrandMsg({ kind: 'err', text: e.message }); return null })
    if (!dataUrl) return
    setBrandSaving('logo')
    try {
      await addLibraryLogo(file.name.replace(/\.[^.]+$/, '') || 'Logo', dataUrl, true)
      setBrandMsg({ kind: 'ok', text: 'Logo added and selected for your reports.' })
      await loadBranding()
    } catch (e: any) { setBrandMsg({ kind: 'err', text: e?.message || 'Could not save that logo.' }) }
    finally { setBrandSaving(null) }
  }
  const removeLogo = async (id: string) => {
    if (!window.confirm('Remove this logo from your library?')) return
    setBrandSaving('remove'); setBrandMsg(null)
    try { await deleteLibraryLogo(id); setBrandMsg({ kind: 'ok', text: 'Logo removed.' }); await loadBranding() }
    catch (e: any) { setBrandMsg({ kind: 'err', text: e?.message || 'Could not remove that logo.' }) }
    finally { setBrandSaving(null) }
  }
  const pickLogo = async (id: string | '') => {
    setBrandSaving('logo'); setBrandMsg(null)
    try {
      await setBranding({ logo_id: id }); setSelectedLogoId(id || null)
      setBrandMsg({ kind: 'ok', text: id ? 'That logo now prints on your reports.' : 'Reports will print without a logo.' })
    } catch (e: any) { setBrandMsg({ kind: 'err', text: e?.message || 'Could not change the logo.' }) }
    finally { setBrandSaving(null) }
  }
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // "Notes on this report" (owner 11/10): which timeline entries print.
  const [notesPrint, setNotesPrint] = useState<NotesPrint>(DEFAULT_NOTES_PRINT)
  const [reportsOpen, setReportsOpen] = useState<Record<string, boolean>>({})
  const [reports, setReports] = useState<Record<string, ReportRow[]>>({})
  const reportsOpenRef = useRef(reportsOpen); reportsOpenRef.current = reportsOpen
  const [queuing, setQueuing] = useState<string | null>(null)   // '<projectId>:<kind>:<parcelId>'
  const [deletingReport, setDeletingReport] = useState<string | null>(null)
  const [members, setMembers] = useState<FirmMember[] | null>(null)
  const [sharing, setSharing] = useState<{ projectId: string; ids: string[] } | null>(null)
  const [yearFor, setYearFor] = useState<string | null>(null)   // project id
  const [mapReportFor, setMapReportFor] = useState<string | null>(null) // tract id

  const loadReports = useCallback(async (projectId: string) => {
    try {
      const r = await listReports({ projectId })
      setReports((x) => ({ ...x, [projectId]: r.reports || [] }))
    } catch (e: any) {
      setMsg(e?.message || 'Could not load the reports.')
    }
  }, [])

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
    for (const id of Object.keys(reportsOpenRef.current)) if (reportsOpenRef.current[id]) void loadReports(id)
    void loadSavedReports()
  }, [loadProjects, loadDetail, loadReports, loadSavedReports])

  useEffect(() => { if (open) void loadProjects() }, [open, loadProjects])
  useEffect(() => { if (open) void loadSavedReports() }, [open, loadSavedReports])
  useEffect(() => {
    if (!open || members !== null) return
    firmMembers().then((r) => setMembers(r.members || [])).catch(() => setMembers([]))
  }, [open, members])

  // Poll a project's reports every 3 s while any is queued/running, for at
  // most ~5 min; the effect re-arms only when the pending set changes.
  const pendingIds = Object.entries(reports)
    .filter(([, rows]) => rows.some((r) => r.status === 'queued' || r.status === 'running'))
    .map(([id]) => id)
  const pendingKey = pendingIds.join(',')
  useEffect(() => {
    if (!open || !pendingKey) return
    const started = Date.now()
    const ids = pendingKey.split(',')
    const t = setInterval(() => {
      if (Date.now() - started > POLL_CAP_MS) { clearInterval(t); return }
      ids.forEach((id) => void loadReports(id))
    }, POLL_MS)
    return () => clearInterval(t)
  }, [open, pendingKey, loadReports])
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
  const q = c.q.trim().toLowerCase()
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
  // Chips + sort over what the search left (the search itself also finds map names).
  const ctl = useMemo(() => {
    const r = applyControls(visible, { ...c, q: '' }, {
      mine: (v) => v.p.mine ?? !v.p.shared,
      name: (v) => v.p.name || '',
      modified: (v) => v.p.updated_at,
      text: () => '',
    })
    const mineN = projects.filter((p) => p.mine ?? !p.shared).length
    return { shown: r.shown, counts: { all: projects.length, mine: mineN, team: projects.length - mineN } }
  }, [visible, projects, c])

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

  const openReports = (projectId: string) => {
    setReportsOpen((x) => ({ ...x, [projectId]: true }))
    setExpanded((x) => ({ ...x, [projectId]: true }))
    void loadDetail(projectId)
    void loadReports(projectId)
  }

  const queue = async (projectId: string, kind: ReportKind, parcelId?: string) => {
    const key = `${projectId}:${kind}:${parcelId || ''}`
    setQueuing(key); setMsg(null)
    try {
      await queueReport(
        parcelId ? { parcelId } : { projectId }, kind,
        { ...(USES_ELEVATION.includes(kind) ? { exaggeration: DEFAULT_EXAGGERATION } : {}), notes_print: notesPrintBody(notesPrint) })
      await loadReports(projectId)
    } catch (e: any) {
      setMsg(e?.message || 'Could not start that report.')
    } finally { setQueuing(null) }
  }

  const download = async (projectName: string, r: ReportRow) => {
    setMsg(null)
    try { await downloadReport(r.id, reportFilename(projectName, r.kind)) }
    catch (e: any) { setMsg(e?.message || 'That report could not be downloaded.') }
  }

  const removeReport = async (projectId: string, r: ReportRow) => {
    if (!window.confirm(`Delete this ${REPORT_LABEL[r.kind] || 'report'}?`)) return
    setDeletingReport(r.id); setMsg(null)
    try {
      await deleteReport(r.id)
      setReports((x) => ({ ...x, [projectId]: (x[projectId] || []).filter((o) => o.id !== r.id) }))
    } catch (e: any) {
      setMsg(e?.message || 'That report could not be deleted.')
    } finally { setDeletingReport(null) }
  }

  const openShare = async (projectId: string) => {
    setMsg(null)
    try {
      const cur = await projectShares(projectId)
      setSharing({ projectId, ids: cur.user_ids || [] })
    } catch (e: any) {
      setMsg(e?.message || 'Could not load the sharing list.')
    }
  }

  const duplicate = async (projectId: string) => {
    setBusy('Duplicating…'); setMsg(null)
    try {
      const r = await duplicateProject(projectId)
      await loadProjects()
      setExpanded((x) => ({ ...x, [r.id]: true }))
      void loadDetail(r.id, true)
      onChanged()
    } catch (e: any) {
      setMsg(e?.message || 'Could not duplicate the project.')
    } finally { setBusy(null) }
  }

  // The Report Logo controls (owner 11/2), shown when its row is open.
  const logoBody = (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={muted}>Your name and the logo you pick print on every PDF report you build.</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Company name on reports"
                       maxLength={120} style={{ ...input, flex: 1 }} />
                <button type="button" style={pinkBtn} disabled={brandSaving === 'name'} onClick={() => void saveBrandName()}>
                  {brandSaving === 'name' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
                </button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" onClick={() => void pickLogo('')} disabled={!!brandSaving} title="Print reports without a logo"
                        style={{ ...iconBtn, width: 72, height: 72, flexDirection: 'column', gap: 4, fontSize: 10,
                                 outline: selectedLogoId ? 'none' : '2px solid #F58CDE' }}>
                  <ImageIcon size={14} style={{ opacity: 0.6 }} /> No logo
                </button>
                {libraryLogos.map((l) => (
                  <div key={l.id} style={{ width: 72, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <button type="button" onClick={() => void pickLogo(l.id)} disabled={!!brandSaving}
                            title={l.scope === 'firm' ? `${l.name} (firm logo)` : l.name}
                            style={{ ...iconBtn, width: 72, height: 72, padding: 3, background: '#fff',
                                     outline: selectedLogoId === l.id ? '2px solid #F58CDE' : 'none' }}>
                      {libraryUrls[l.id]
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={libraryUrls[l.id]} alt={l.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                        : <Loader2 size={13} className="animate-spin" />}
                    </button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}>
                      <span style={{ ...muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 10 }}>
                        {selectedLogoId === l.id ? '✓ ' : ''}{l.name}
                      </span>
                      <button type="button" onClick={() => void removeLogo(l.id)} disabled={!!brandSaving}
                              title="Remove this logo" aria-label="Remove this logo" style={{ ...iconBtn, padding: 2 }}>
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                ))}
                <label title="Upload logo" style={{ ...iconBtn, width: 72, height: 72, flexDirection: 'column', gap: 4, fontSize: 10,
                                                     cursor: brandSaving ? 'not-allowed' : 'pointer', opacity: brandSaving ? 0.6 : 1 }}>
                  {brandSaving === 'logo' ? <Loader2 size={13} className="animate-spin" /> : <Upload size={14} />} Upload logo
                  <input type="file" accept="image/png,image/jpeg" disabled={!!brandSaving} style={{ display: 'none' }}
                         onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); e.target.value = '' }} />
                </label>
              </div>
              {brandMsg && <span style={{ ...muted, color: brandMsg.kind === 'err' ? '#fca5a5' : '#86efac' }}>{brandMsg.text}</span>}
            </div>
  )

  return (
    <MyMapsShell open={open} title="Saved Projects" onBack={onBack} onClose={onClose} controls={c}
                 searchPlaceholder="Search projects and maps" showChips={isFirm} counts={ctl.counts}
                 onNew={() => setCreating(creating === null ? '' : null)} testId="saved-projects-panel"
                 dataAttr={{ 'data-gg-saved-panel': '' }}
                 top={<>
                   {creating !== null && (
                     <div data-testid="new-project-form" style={{ display: 'flex', gap: 6 }}>
                       <input
                         autoFocus style={{ ...whiteInput, flex: 1 }} value={creating} placeholder="New project name"
                         data-testid="new-project-name"
                         onChange={(e) => setCreating(e.target.value)}
                         onKeyDown={(e) => {
                           if (e.key === 'Enter') void submitNewProject()
                           if (e.key === 'Escape') setCreating(null)
                         }} />
                       <button type="button" data-testid="new-project-create" style={creating.trim() ? shellPink : offBtn}
                               disabled={!creating.trim() || !!busy} onClick={() => void submitNewProject()}>Create</button>
                       <button type="button" style={grayBtn} onClick={() => setCreating(null)}>Cancel</button>
                     </div>
                   )}
                   {/* Report Logo (owner 11/2) */}
                   <div data-gg-report-logo style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: '8px 10px' }}>
                     <button type="button" onClick={() => setLogoOpen((v) => !v)}
                             style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', gap: 6, width: '100%', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}>
                       {logoOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                       <ImageIcon size={13} /> Report Logo
                       <span style={{ ...muted, marginLeft: 'auto', fontWeight: 400 }}>
                         {selectedLogoId ? 'Logo selected' : brandLoaded ? 'No logo' : ''}
                       </span>
                     </button>
                     {logoOpen && logoBody}
                   </div>
                   {(msg || error) && (
                     <div style={{ fontSize: 12, color: '#fca5a5' }}>{msg || error}</div>
                   )}
                   {busy && (
                     <div style={{ ...muted, display: 'flex', alignItems: 'center', gap: 6 }}>
                       <Loader2 size={12} className="animate-spin" /> {busy}
                     </div>
                   )}
                 </>}>
      {loading && !projects.length && (
        <div style={{ ...muted, padding: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Loader2 size={13} className="animate-spin" /> Loading…
        </div>
      )}
      {!loading && !error && !projects.length && (
        <ListEmpty>No projects yet. Use + New, or Map It on any parcel.</ListEmpty>
      )}
      {!loading && !error && projects.length > 0 && !ctl.shown.length && (
        <ListEmpty>{c.chip === 'team' && !q ? 'Nothing from your team yet. Projects a teammate shares with you show here.' : c.chip === 'mine' && !q ? 'You have not made a project yet.' : 'Nothing matches.'}</ListEmpty>
      )}
      {ctl.shown.map(({ p, maps, nameHit }) => {
          const isOpen = !!expanded[p.id] || (!!q && !nameHit)
          const det = details[p.id]
          const where = [p.county, p.state].filter(Boolean).join(', ')
          const sm = p.summary || ({} as any)
          const pKey = `p:${p.id}`
          const nMaps = sm.parcels ?? 0
          const canShare = !p.shared && (members?.length ?? 0) > 0
          return (
            <MyMapsCard key={p.id} testId="project-card"
              picture={<CardPicture kind="saved" id={p.cover_parcel_id} icon={<Folder size={26} />} />}
              title={editing?.key === pKey ? (
                <input autoFocus style={{ ...whiteInput, padding: '5px 8px', fontSize: 14 }} value={editing.text}
                       data-testid="project-rename-input"
                       onClick={(e) => e.stopPropagation()}
                       onChange={(e) => setEditing({ key: pKey, text: e.target.value })}
                       onBlur={commitRename}
                       onKeyDown={(e) => {
                         e.stopPropagation()
                         if (e.key === 'Enter') commitRename()
                         if (e.key === 'Escape') cancelEdit()
                       }} />
              ) : p.name}
              sub={[where, fmtModified(p.updated_at)].filter(Boolean).join(' · ')}
              extra={<>
                {p.shared && <div style={{ ...muted, color: PINK }}>Shared by {p.shared_by || 'a colleague'}</div>}
                {!p.shared && (p.shared_with?.length ?? 0) > 0 && (
                  <div style={{ ...muted, color: PINK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Shared with {p.shared_with!.map((m) => m.name).join(', ')}</div>
                )}
              </>}
              tags={[
                <Tag key="ac">{fmt(sm.acres)} ac</Tag>,
                <Tag key="maps">{nMaps} map{nMaps === 1 ? '' : 's'}</Tag>,
                sm.tillable_acres ? <Tag key="till">{fmt(sm.tillable_acres)} tillable</Tag> : null,
                p.aerial_year != null ? <Tag key="yr">Aerial {p.aerial_year}</Tag> : null,
                <button key="exp" type="button" data-testid="project-expand" onClick={(e) => { e.stopPropagation(); toggle(p.id) }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 6, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                                 background: 'rgba(245,140,222,0.18)', color: PINK, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                  {isOpen ? <>Hide maps <ChevronDown size={11} /></> : <>Show maps <ChevronRight size={11} /></>}
                </button>,
              ]}
              onOpen={() => { if (editing?.key === pKey) return; if (!expanded[p.id]) toggle(p.id); onShowProject(p.id) }}
              actions={[
                { label: 'Show on the map', testId: 'project-show', onClick: () => { if (!expanded[p.id]) toggle(p.id); onShowProject(p.id) } },
                { label: 'Add a New Tract', testId: 'project-add-tract', onClick: () => onAddTract({ id: p.id, name: p.name }) },
                { label: 'Reports…', testId: 'project-reports', onClick: () => openReports(p.id) },
                ...(!p.shared ? [
                  { label: 'Rename', testId: 'project-rename', onClick: () => setEditing({ key: pKey, text: p.name }) },
                  ...(canShare ? [{ label: 'Share…', testId: 'project-share', onClick: () => { if (!expanded[p.id]) toggle(p.id); void openShare(p.id) } }] : []),
                  { label: 'Aerial year…', testId: 'project-year', onClick: () => { if (!expanded[p.id]) toggle(p.id); setYearFor(p.id) } },
                  { label: 'Duplicate', testId: 'project-duplicate', onClick: () => void duplicate(p.id) },
                  { label: 'Delete project', danger: true, testId: 'project-delete', onClick: () => {
                    if (!window.confirm(`Delete the project "${p.name}"? Its maps are archived with it.`)) return
                    void run('Deleting…', () => updateProject(p.id, { archived: true }))
                  } },
                ] : []),
              ]}>
              {isOpen && (
                <div style={{ marginTop: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {(det?.loading && !maps.length) && (
                    <div style={{ ...muted, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Loader2 size={12} className="animate-spin" /> Loading maps…
                    </div>
                  )}
                  {det?.error && <div style={{ fontSize: 12, color: '#fca5a5' }}>{det.error}</div>}
                  {sharing?.projectId === p.id && (
                    <div style={section}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Share this project</div>
                      {(members || []).map((m) => (
                        <label key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0', cursor: 'pointer' }}>
                          <input type="checkbox" checked={sharing.ids.includes(m.id)}
                                 onChange={(e) => setSharing({
                                   projectId: p.id,
                                   ids: e.target.checked ? Array.from(new Set([...sharing.ids, m.id])) : sharing.ids.filter((x) => x !== m.id),
                                 })} />
                          <span>{m.full_name || m.email}</span>
                        </label>
                      ))}
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button type="button" style={pinkBtn} disabled={!!busy}
                                onClick={() => void run('Sharing…', () => setProjectShares(p.id, sharing.ids), () => setSharing(null))}>
                          Save
                        </button>
                        <button type="button" style={{ ...pinkBtn, background: '#E4E4E7', border: '1px solid #E4E4E7' }}
                                onClick={() => setSharing(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {yearFor === p.id && (
                    <div style={section}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>Aerial year</div>
                      <select autoFocus style={input} value={p.aerial_year ?? ''}
                              onBlur={() => setYearFor(null)}
                              onChange={(e) => {
                                const v = e.target.value
                                setYearFor(null)
                                void run('Saving…', () => updateProjectAerialYear(p.id, v === '' ? null : Number(v)))
                              }}>
                        <option value="">Latest</option>
                        {AERIAL_YEARS.map((y) => <option key={y.year} value={y.year}>{y.year}</option>)}
                      </select>
                    </div>
                  )}
                  {reportsOpen[p.id] && (() => {
                    const rows = reports[p.id] || []
                    const nameOf = (id: string | null) => (id && (det?.parcels || []).find((x) => x.id === id)?.name) || ''
                    const mapTarget = mapReportFor && (det?.parcels || []).find((x) => x.id === mapReportFor)
                    const inFlight = rows.some((r) => r.status === 'queued' || r.status === 'running')
                    const btn = (kind: ReportKind, parcelId?: string) => {
                      const working = queuing === `${p.id}:${kind}:${parcelId || ''}`
                        || rows.some((r) => r.kind === kind && (r.parcel_id || undefined) === parcelId && (r.status === 'queued' || r.status === 'running'))
                      return (
                        <button key={kind} type="button" style={{ ...pinkBtn, opacity: working ? 0.6 : 1 }}
                                disabled={working || !!queuing}
                                onClick={() => void queue(p.id, kind, parcelId)}>
                          {working ? (REPORT_BUSY_LABEL[kind] || 'Working…') : (REPORT_LABEL[kind] || kind)}
                        </button>
                      )
                    }
                    return (
                      <div style={section}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <span style={{ fontWeight: 600, flex: 1 }}>Reports</span>
                          <button type="button" style={iconBtn} aria-label="Close reports"
                                  onClick={() => { setReportsOpen((x) => ({ ...x, [p.id]: false })); setMapReportFor(null) }}>
                            <X size={13} />
                          </button>
                        </div>
                        {(p.summary?.parcels ?? 0) === 0 ? (
                          <div style={muted}>Add a tract before building a report.</div>
                        ) : (
                          <>
                            <div style={{ marginBottom: 8 }}>
                              <NotesPrintChoice compact value={notesPrint} onChange={setNotesPrint}
                                                items={(det?.parcels || []).map((x) => ({ key: `cm:${String(x.id).toLowerCase()}`, label: x.name || 'Untitled' }))} />
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{btn('aerial')}</div>
                            {mapTarget && (
                              <div style={{ marginTop: 8 }}>
                                <div style={{ ...muted, marginBottom: 4 }}>For &quot;{mapTarget.name || 'Untitled'}&quot;</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {MAP_REPORT_KINDS.map((k) => btn(k, mapTarget.id))}
                                </div>
                              </div>
                            )}
                            {!mapTarget && <div style={{ ...muted, marginTop: 6 }}>Soil, Ground Goat and 3D reports: use Reports… on a map.</div>}
                          </>
                        )}
                        {inFlight && <div style={{ ...muted, marginTop: 6 }}>Building… this updates on its own.</div>}
                        {rows.map((r) => {
                          const label = REPORT_LABEL[r.kind] || r.kind
                          const mapName = nameOf(r.parcel_id)
                          const pending = r.status === 'queued' || r.status === 'running'
                          return (
                            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {label}{mapName ? ` · ${mapName}` : ''}
                                </div>
                                <div style={{ ...muted, color: r.status === 'failed' ? '#fca5a5' : muted.color }}>
                                  {pending ? (REPORT_BUSY_LABEL[r.kind] || 'Working…')
                                    : r.status === 'failed' ? (r.error || 'Failed')
                                    : 'Ready'} · {new Date(r.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                                </div>
                              </div>
                              {r.status === 'done' && r.ready && (
                                <button type="button" style={iconBtn} aria-label="Download"
                                        onClick={() => void download(p.name, r)}><Download size={14} /></button>
                              )}
                              <button type="button" style={iconBtn} aria-label="Delete report"
                                      disabled={deletingReport === r.id}
                                      onClick={() => void removeReport(p.id, r)}><Trash2 size={14} /></button>
                            </div>
                          )
                        })}
                        <div style={{ ...muted, marginTop: 10 }}>
                          Report logo: see <button type="button" onClick={() => setLogoOpen(true)} style={{ background: 'none', border: 'none', padding: 0, color: PINK, cursor: 'pointer', fontSize: 11 }}>Report Logo</button> at the top of this panel.
                        </div>
                      </div>
                    )
                  })()}
                  {reportsForProject(p.id).length > 0 && (
                    <div data-testid="project-saved-reports" style={{ margin: '4px 0' }}>
                      <div style={{ ...muted, fontWeight: 600 }}>Reports</div>
                      {reportsForProject(p.id).map(reportLine)}
                    </div>
                  )}
                  {det && !det.loading && !det.error && !det.parcels.length && (
                    <div style={muted}>No maps in this project yet.</div>
                  )}
                  {maps.map((t) => {
                    const tKey = `t:${t.id}`
                    const rowKey = `${p.id}:${t.id}`
                    // Every project this farm is in (v2); older APIs: just this one.
                    const inProjects = t.projects?.length ? t.projects : [{ id: p.id, name: p.name }]
                    const otherProjects = inProjects.filter((o) => o.id !== p.id)
                    const inIds = new Set(inProjects.map((o) => o.id))
                    const addTargets = projects.filter((o) => o.id !== p.id && !inIds.has(o.id))
                    return (
                      <div key={t.id} data-testid="tract-card" style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 4,
                                               margin: '6px 0', padding: '10px 12px', borderRadius: 12,
                                               background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.22)' }}>
                        {/* The tract's own outline in pink (owner 11/11), the same card
                            image the report panel shows — drawn from the saved drawing,
                            so a multi-parcel or partial tract shows its real shape. */}
                        <div style={{ flex: 'none', marginRight: 6, cursor: 'pointer' }} onClick={() => onShowTract(t.id)}>
                          <CardThumb kind="saved" id={t.id} size={56} />
                        </div>
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
                            <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                              <MapIcon size={14} color={PINK} style={{ flex: 'none' }} />
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name || 'Untitled'}</span>
                              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: 'rgba(255,255,255,0.55)', marginLeft: 2 }}>TRACT</span>
                            </div>
                          )}
                          <div style={muted}>{mapLine(t)}</div>
                          <button type="button" data-testid="tract-notes-toggle"
                                  onClick={(e) => { e.stopPropagation(); setNotesFor((x) => ({ ...x, [t.id]: !x[t.id] })) }}
                                  style={{ background: 'none', border: 'none', padding: 0, marginTop: 4, color: PINK, cursor: 'pointer', fontSize: 11,
                                           display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <StickyNote size={11} /> {notesFor[t.id] ? 'Hide notes' : noteCounts[t.id] ? `Notes (${noteCounts[t.id]})` : 'Notes'}
                          </button>
                          {notesFor[t.id] && (
                            <div style={{ marginTop: 6, cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
                              <NotesTimeline compact theme="dark" itemKey={`cm:${t.id}`} label={t.name || null}
                                             onCount={(n) => setNoteCounts((x) => (x[t.id] === n ? x : { ...x, [t.id]: n }))} />
                            </div>
                          )}
                          {reportsForTract(t.id).length > 0 && (
                            <div style={{ marginTop: 2 }} onClick={(e) => e.stopPropagation()}>
                              <div style={{ ...muted, fontWeight: 600, marginTop: 6 }}>Comp reports</div>
                              {reportsForTract(t.id).map(reportLine)}
                            </div>
                          )}
                          {otherProjects.length > 0 && (
                            <div data-testid="tract-project-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}
                                 onClick={(e) => e.stopPropagation()}>
                              <span style={muted}>Also in</span>
                              {otherProjects.map((o) => (
                                <button key={o.id} type="button" title={`Open ${o.name}`}
                                        onClick={() => { setExpanded((x) => ({ ...x, [o.id]: true })); void loadDetail(o.id) }}
                                        style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 999, cursor: 'pointer',
                                                 background: 'rgba(245,140,222,0.14)', color: '#fff', border: '1px solid rgba(245,140,222,0.45)',
                                                 maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {o.name}
                                </button>
                              ))}
                            </div>
                          )}
                          {adding === rowKey && (
                            <select
                              autoFocus style={{ ...input, marginTop: 4 }} defaultValue=""
                              data-testid="add-to-project"
                              onClick={(e) => e.stopPropagation()}
                              onBlur={() => setAdding(null)}
                              onChange={(e) => {
                                const target = e.target.value
                                setAdding(null)
                                if (target) void run('Adding…', () => linkParcels(target, [t.id]))
                              }}>
                              <option value="" disabled>Add to project…</option>
                              {addTargets.map((o) => <option key={o.id} value={o.id}>{o.name}{o.shared ? ' (shared)' : ''}</option>)}
                            </select>
                          )}
                          {deleting?.key === rowKey && (
                            <div data-testid="delete-farm-confirm" onClick={(e) => e.stopPropagation()}
                                 style={{ marginTop: 6, background: 'rgba(0,0,0,0.35)', borderRadius: 8, padding: '8px 10px' }}>
                              {deleting.projects === null ? (
                                <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <Loader2 size={12} className="animate-spin" /> Checking its projects…
                                </span>
                              ) : (
                                <>
                                  <div style={{ fontSize: 12 }}>
                                    This removes <b>{deleting.name}</b> from: {deleting.projects.join(', ') || p.name}. This can&apos;t be undone from here.
                                  </div>
                                  <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                    <button type="button" data-testid="delete-farm-yes"
                                            style={{ ...pinkBtn, background: '#fca5a5', borderColor: '#fca5a5' }}
                                            onClick={() => { const id = deleting.id; setDeleting(null); void run('Deleting…', () => deleteFarm(id)) }}>
                                      Delete farm
                                    </button>
                                    <button type="button" style={{ ...pinkBtn, background: '#E4E4E7', borderColor: '#E4E4E7' }}
                                            onClick={() => setDeleting(null)}>
                                      Cancel
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
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
                                    onClick={() => { setMenu(null); setMapReportFor(t.id); openReports(p.id) }}>
                              Reports…
                            </button>
                            <button type="button" style={menuItem}
                                    onClick={() => { setMenu(null); setEditing({ key: tKey, text: t.name }) }}>
                              Rename
                            </button>
                            {addTargets.length > 0 && (
                              <button type="button" style={menuItem} data-testid="menu-add-to-project"
                                      onClick={() => { setMenu(null); setDeleting(null); setAdding(rowKey) }}>
                                Add to project…
                              </button>
                            )}
                            <button type="button" style={menuItem} data-testid="menu-remove-from-project"
                                    onClick={() => { setMenu(null); void run('Removing…', () => unlinkParcel(p.id, t.id)) }}>
                              Remove from project
                            </button>
                            <button type="button" style={{ ...menuItem, color: '#fca5a5' }} data-testid="menu-delete-farm"
                                    onClick={() => { setMenu(null); setAdding(null); void askDeleteFarm(rowKey, t, inProjects.map((o) => o.name)) }}>
                              Delete farm…
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
            </MyMapsCard>
          )
        })}
    </MyMapsShell>
  )
}
