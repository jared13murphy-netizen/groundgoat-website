'use client'

/**
 * ReportsPanel — the one place every report starts (owner 11/15, mockups
 * "PROPOSAL — one Reports panel" + the parcel/tract bottom buttons).
 *
 * 1 · Pick reports — cards; every report the target offers starts picked
 *     (pink gradient, black text) and a click un-picks it (owner 11/28). A
 *     project also asks WHICH ground: a tick list ("Choose Ground"), any
 *     number of them — one press of Download / Email then builds every picked
 *     report for every picked piece of ground (lib/reportBatch). The Map It reports work on ANY parcel or
 *     auction tract too (owner 11/16): a parcel prints the engine's tillable
 *     polygons, a tract its drawn tillable polygons, a farm its saved ones.
 * 2 · Notes to include — NotesStep (None · Latest · All · Pick + the notes).
 * 3 · Send it — Download or Email (off until a report is picked).
 *
 * Opened from anywhere with openReports() (lib/reportsPanel); back and X
 * both return to the screen it was opened from. Parcel and Tract Reports go
 * through the report queue (POST /api/reports/jobs: the floating
 * ReportJobsIndicator downloads or confirms the email); Map It reports go
 * through /api/mapping/reports (Email = params.deliver "email"), keyed on the
 * farm / project, or on tract_id / ll_uuid for a tract or parcel.
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { Check, ChevronLeft, Download, Loader2, Mail, X } from 'lucide-react'
import reportJobEnqueue from '@/lib/reportJobs'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { getProject, queueAndDownloadReport, queueReport, type ReportKind, type ReportTarget } from '@/lib/configurableMapping'
import { DEFAULT_NOTES_PRINT, notesPrintBody, type NotePickItem, type NotesPrint } from '@/lib/notes'
import { closeReports, reportsSnapshot, subscribeReports, type ReportsOpen, type ReportsTarget } from '@/lib/reportsPanel'
import useSlide from '@/lib/useSlide'
import { buildBatchJobs, countLabel, needsGround, runBatch, type BatchJob } from '@/lib/reportBatch'
import NotesStep, { PINK_GRADIENT } from '@/components/notes/NotesStep'

const PINK = '#F58CDE'
type Kind = 'parcel' | 'tract' | ReportKind
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const ALL_MAP_KINDS: Kind[] = ['ground_goat', 'applicator', 'soil_map', 'aerial', 'elevation_3d']
const INFO: Record<string, { name: string; desc: string }> = {
  parcel: { name: 'Parcel Report', desc: 'Owner, soils, crops and land facts' },
  tract: { name: 'Tract Report', desc: 'Sale or auction facts, soils and maps' },
  ground_goat: { name: 'Ground Goat Report', desc: 'Full farm report: land types, soils, maps' },
  applicator: { name: 'Applicator Report', desc: 'Fields, owners and products to apply' },
  soil_map: { name: 'Soil Map', desc: 'Soil map of the tillable ground' },
  aerial: { name: 'Aerial Map', desc: 'Aerial photo with the farm outlined' },
  elevation_3d: { name: '3D Elevation Map', desc: '3D surface of the farm' },
}
const DEFAULT_EXAGGERATION = 2.5

interface Option { kind: Kind; desc: string; off: string | null }

/** The reports a target offers, in order, each enabled or grayed with why. */
export function reportOptions(t: ReportsTarget, canUseReports: boolean, canUseMapIt: boolean, isFirm: boolean): Option[] {
  // Applicator Report is for firms only (it prints the firm's products).
  const MAP_KINDS = ALL_MAP_KINDS.filter((k) => isFirm || k !== 'applicator')
  const mapOff = !canUseMapIt ? 'Needs Map It' : null
  const mapIt = (kind: Kind, off: string | null, desc?: string): Option =>
    ({ kind, desc: off ? `${INFO[kind].desc.split(':')[0]} · ${off}` : (desc || INFO[kind].desc), off })
  if (t.type === 'parcel' || t.type === 'tract') {
    const own: Option = { kind: t.type, desc: INFO[t.type].desc, off: canUseReports ? null : 'Not in your plan' }
    // Owner 11/16: every Map It report works on any parcel or tract.
    const noGround = t.type === 'parcel' && !t.llUuid && (t.lat == null || t.lng == null) ? 'No parcel here' : null
    return [own, ...MAP_KINDS.map((k) => mapIt(k, mapOff || noGround,
      k === 'aerial' ? `Aerial photo with the ${t.type} outlined` : undefined))]
  }
  const projectName = t.projectName || 'this project'
  return MAP_KINDS.map((k) => mapIt(k, k === 'aerial' && !t.projectId ? 'No project' : mapOff,
    k === 'aerial' ? `Every farm in ${projectName}` : undefined))
}

// Firm admin / firm user, from /api/auth/me (asked once per page).
let firmLoad: Promise<boolean> | null = null
function useIsFirm(): boolean {
  const [firm, setFirm] = useState(false)
  useEffect(() => {
    firmLoad ??= fetchWithAuth(`${API_URL}/api/auth/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => me?.account_type === 'firm_admin' || me?.account_type === 'firm_user')
      .catch(() => { firmLoad = null; return false })
    let live = true
    firmLoad.then((f) => { if (live) setFirm(f) })
    return () => { live = false }
  }, [])
  return firm
}

async function errorText(res: Response): Promise<string> {
  if (res.status === 403) return 'Not available for your account'
  try {
    const b = await res.json()
    if (typeof b?.detail === 'string') return b.detail
  } catch { /* keep default */ }
  return res.status === 429 ? 'Too many reports in progress — wait for one to finish' : 'Something went wrong — try again'
}

const roundBtn: CSSProperties = {
  height: 36, borderRadius: 18, border: 'none', background: '#1C1C1E', color: '#fff', cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'inherit',
}
const tickBox: CSSProperties = {
  flex: '0 0 auto', width: 18, height: 18, borderRadius: 5, border: '2px solid', boxSizing: 'border-box',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
}
const groundRow: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', fontSize: 14, color: '#111111', cursor: 'pointer',
}
const stepHead: CSSProperties = { padding: '16px 16px 8px', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#A1A1AA' }

export default function ReportsPanel() {
  const s = useSyncExternalStore(subscribeReports, reportsSnapshot, () => null)
  const [last, setLast] = useState<ReportsOpen | null>(s)
  useEffect(() => { if (s) setLast(s) }, [s])
  const slide = useSlide(!!s, 240)
  // Same rule as the My Maps screens: any click outside closes it.
  useEffect(() => {
    if (!s) return
    const onDown = (e: PointerEvent) => {
      const el = e.target as Element | null
      if (el && !el.closest('[data-gg-reports-panel]')) closeReports()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeReports() }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey) }
  }, [s])
  const open = s || last
  if (!slide.mounted || !open) return null
  return <Panel key={targetKey(open.target)} o={open} shown={slide.shown && !!s} />
}

function targetKey(t: ReportsTarget) {
  return t.type === 'parcel' ? `p:${t.llUuid || `${t.lat},${t.lng}`}` : t.type === 'tract' ? `t:${t.tractId}`
    : t.type === 'farm' ? `cm:${t.parcelId}` : `pr:${t.projectId}`
}

function Panel({ o, shown }: { o: ReportsOpen; shown: boolean }) {
  const t = o.target
  const isFirm = useIsFirm()
  const options = useMemo(() => reportOptions(t, o.canUseReports, o.canUseMapIt, isFirm), [t, o.canUseReports, o.canUseMapIt, isFirm])
  const enabled = options.filter((x) => !x.off)
  // Owner 11/28: every report starts picked; the person un-picks what they
  // do not want. `kindsTouched` keeps a late change in what is offered (the
  // firm check answering) from undoing a pick the person already made.
  const [kinds, setKinds] = useState<Set<Kind>>(() => new Set(enabled.map((x) => x.kind)))
  const [kindsTouched, setKindsTouched] = useState(false)
  useEffect(() => {
    if (!kindsTouched) setKinds(new Set(options.filter((x) => !x.off).map((x) => x.kind)))
  }, [options, kindsTouched])
  const isProject = t.type === 'project'
  // Which ground a project's reports are for — any number of them.
  const [groundIds, setGroundIds] = useState<Set<string>>(() => new Set(isProject && t.farms.length === 1 ? [t.farms[0].id] : []))
  const [notes, setNotes] = useState<NotesPrint>(DEFAULT_NOTES_PRINT)
  const [busy, setBusy] = useState<'download' | 'email' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [projectFarms, setProjectFarms] = useState<{ id: string; name: string }[] | null>(t.type === 'project' ? t.farms : null)

  const projectId = t.type === 'farm' || t.type === 'project' ? t.projectId : null
  const projectName = t.type === 'farm' || t.type === 'project' ? t.projectName : null
  // The Aerial Map prints every farm in the project: its notes too.
  const hasAerial = kinds.has('aerial')
  useEffect(() => {
    if (!hasAerial || projectFarms || !projectId) return
    let live = true
    getProject(projectId).then((r) => {
      if (live) setProjectFarms((r.parcels || []).map((p: any) => ({ id: String(p.id), name: p.name || 'Untitled' })))
    }).catch(() => { if (live) setProjectFarms([]) })
    return () => { live = false }
  }, [hasAerial, projectFarms, projectId])

  const noteItems = useMemo<NotePickItem[]>(() => {
    if (t.type === 'parcel') {
      const k = t.llUuid ? `p:${String(t.llUuid).toLowerCase()}` : t.noteKey
      return k ? [{ key: k, label: t.title }] : []
    }
    if (t.type === 'tract') return [{ key: `t:${String(t.tractId).toLowerCase()}`, label: t.title }]
    // The Aerial Map prints every farm in the project, so every farm's notes
    // are on offer; otherwise the notes of the ground that is picked.
    if (hasAerial) return (projectFarms || (t.type === 'project' ? t.farms : [])).map((f) => ({ key: `cm:${f.id.toLowerCase()}`, label: f.name }))
    if (t.type === 'farm') return [{ key: `cm:${t.parcelId.toLowerCase()}`, label: t.title }]
    return t.farms.filter((f) => groundIds.has(f.id)).map((f) => ({ key: `cm:${f.id.toLowerCase()}`, label: f.name }))
  }, [t, hasAerial, groundIds, projectFarms])

  const kindsInOrder = useMemo(() => options.map((x) => x.kind as string), [options])
  const needsFarm = needsGround(isProject, kinds)
  const jobs = useMemo(() => buildBatchJobs({
    isProject, kindsInOrder, pickedKinds: kinds as Set<string>,
    grounds: t.type === 'project' ? t.farms : [], pickedGroundIds: groundIds,
  }), [isProject, kindsInOrder, kinds, t, groundIds])
  const ready = kinds.size > 0 && (!needsFarm || groundIds.size > 0) && jobs.length > 0

  /** Build ONE report. Throws on failure (a "too many building" answer is
   *  thrown too — runBatch waits and tries it again). */
  const runOne = async (job: BatchJob, delivery: 'download' | 'email', notes_print: ReturnType<typeof notesPrintBody>) => {
    const kind = job.kind as Kind
    if (kind === 'parcel' || kind === 'tract') {
      let res: Response
      if (t.type === 'tract') res = await reportJobEnqueue('tract', delivery, { tract_id: t.tractId, notes_print })
      else if (t.type === 'parcel' && t.llUuid) res = await reportJobEnqueue('parcel', delivery, { ll_uuid: t.llUuid, notes_print })
      else if (t.type === 'parcel') res = await reportJobEnqueue('parcel_by_point', delivery, { lat: t.lat, lng: t.lng, notes_print })
      else throw new Error('Pick a report')
      if (!res.ok) throw Object.assign(new Error(await errorText(res)), { status: res.status })
      return
    }
    const ref: ReportTarget = t.type === 'tract' ? { tractId: t.tractId }
      : t.type === 'parcel' ? { llUuid: t.llUuid || undefined, lat: t.lat ?? undefined, lng: t.lng ?? undefined }
      : kind === 'aerial' ? { projectId: projectId || undefined }
      : { parcelId: (t.type === 'farm' ? t.parcelId : job.groundId) || undefined }
    const params = { notes_print, ...(kind === 'elevation_3d' ? { exaggeration: DEFAULT_EXAGGERATION } : {}) }
    if (delivery === 'email') {
      await queueReport(ref, kind as ReportKind, { ...params, deliver: 'email' })
    } else {
      // The file is named for the ground it is of, so several downloads
      // from one press do not all carry the project's name.
      const name = job.groundName || projectName || (t.type === 'parcel' || t.type === 'tract' || t.type === 'farm' ? t.title : null)
      await queueAndDownloadReport(ref, kind as ReportKind, name, params)
    }
  }

  const send = async (delivery: 'download' | 'email') => {
    if (!ready || busy) return
    setBusy(delivery); setMsg(null)
    const notes_print = notesPrintBody(notes)
    const list = jobs
    const many = list.length > 1
    const verb = delivery === 'email' ? 'Emailing' : 'Building'
    setMsg({ ok: true, text: many ? `${verb} ${countLabel(list.length)} — keep this tab open.`
      : delivery === 'email' ? 'Building it — we will email it to you when it is ready.' : 'Building it — it downloads when ready.' })
    try {
      const r = await runBatch(list, (job) => runOne(job, delivery, notes_print), {
        concurrency: 3,
        onProgress: (finished, total, failed) => {
          if (many) setMsg({ ok: !failed, text: `${verb} ${finished} of ${total}${failed ? ` — ${failed} failed` : ''}…` })
        },
      })
      if (!r.failed.length) {
        setMsg({ ok: true, text: delivery === 'email'
          ? (many ? `${countLabel(r.done)} on the way to your email.` : 'Building it — it will arrive in your email.')
          : (many ? `${countLabel(r.done)} downloaded.` : 'Downloaded.') })
      } else if (!many) {
        setMsg({ ok: false, text: r.failed[0].error || 'Something went wrong — try again' })
      } else {
        const what = r.failed.slice(0, 3).map((f) => `${INFO[f.job.kind]?.name || f.job.kind}${f.job.groundName ? ` (${f.job.groundName})` : ''}`).join(', ')
        setMsg({ ok: false, text: `${r.done} of ${list.length} done. Failed: ${what}${r.failed.length > 3 ? ` and ${r.failed.length - 3} more` : ''} — ${r.failed[0].error}` })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Something went wrong — try again' })
    } finally {
      setBusy(null)
    }
  }

  const toggleKind = (k: Kind) => {
    setKindsTouched(true); setMsg(null)
    setKinds((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }
  const toggleGround = (id: string) => {
    setMsg(null)
    setGroundIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  const allGround = t.type === 'project' && t.farms.length > 0 && groundIds.size === t.farms.length
  const toggleAllGround = () => {
    if (t.type !== 'project') return
    setMsg(null); setGroundIds(allGround ? new Set() : new Set(t.farms.map((f) => f.id)))
  }

  const close = () => closeReports()
  const card = (x: Option) => {
    const on = !x.off && kinds.has(x.kind)
    return (
      <button key={x.kind} type="button" disabled={!!x.off || !!busy} data-testid={`report-card-${x.kind}`} aria-pressed={on}
              onClick={() => toggleKind(x.kind)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '11px 14px', borderRadius: 12, border: 'none',
                       background: on ? PINK_GRADIENT : '#1C1C1E', opacity: x.off ? 0.5 : 1,
                       cursor: x.off ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
        <span aria-hidden style={{ ...tickBox, background: on ? '#000' : 'transparent', borderColor: on ? '#000' : '#5A5A62' }}>
          {on && <Check size={13} color="#F58CDE" strokeWidth={3} />}
        </span>
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: on ? '#000' : '#8E8E96' }}>{INFO[x.kind].name}</span>
          <span style={{ display: 'block', fontSize: 12, marginTop: 2, color: on ? '#3F1D36' : '#6B6B73' }}>{x.desc}</span>
        </span>
      </button>
    )
  }
  const sendBtn = (d: 'download' | 'email') => {
    const off = !ready || !!busy
    return (
      <button type="button" data-testid={`report-send-${d}`} disabled={off} onClick={() => void send(d)}
              style={{ height: 48, borderRadius: 12, border: 'none', fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
                       display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                       background: off && busy !== d ? '#3F3F46' : PINK, color: off && busy !== d ? '#A1A1AA' : '#000',
                       cursor: off ? 'not-allowed' : 'pointer' }}>
        {busy === d ? <Loader2 size={18} className="animate-spin" /> : d === 'download' ? <Download size={18} /> : <Mail size={18} />}
        {d === 'download' ? 'Download' : 'Email'}
      </button>
    )
  }

  return (
    <div data-testid="reports-panel" data-gg-reports-panel="" role="dialog" aria-label="Reports"
         onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
         style={{ position: 'absolute', top: 0, right: 0, bottom: 0, zIndex: 600, width: 'min(400px, calc(100% - 24px))',
                  boxSizing: 'border-box', background: '#0B0B0B', color: '#fff', borderLeft: '1px solid rgba(255,255,255,0.10)',
                  boxShadow: '-4px 0 20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', fontSize: 13,
                  transform: shown ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 240ms ease',
                  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '14px 14px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button type="button" data-testid="reports-back" onClick={close} style={{ ...roundBtn, gap: 2, padding: '0 12px 0 6px', fontSize: 13, fontWeight: 500 }}>
          <ChevronLeft size={17} /> {o.backLabel}
        </button>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Reports</h2>
        <button type="button" data-testid="reports-close" aria-label="Close" onClick={close} style={{ ...roundBtn, width: 36 }}><X size={16} /></button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        <div style={{ padding: '12px 16px 0' }}>
          <div style={{ fontSize: 15, fontWeight: 700, wordBreak: 'break-word' }}>{t.title}</div>
          {t.meta && <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 2 }}>{t.meta}</div>}
        </div>
        <div style={stepHead}>1 · PICK REPORTS</div>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map(card)}
          {needsFarm && t.type === 'project' && (
            <div data-testid="reports-ground" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#A1A1AA' }}>
              <span>{groundIds.size ? `Ground · ${groundIds.size} of ${t.farms.length} chosen` : 'Choose Ground'}</span>
              {/* White box, light gray border (owner input rule). Tick any number. */}
              <div role="group" aria-label="Choose Ground"
                   style={{ background: '#FFFFFF', border: '1px solid #D4D4D8', borderRadius: 10, maxHeight: 216, overflowY: 'auto', padding: '4px 0' }}>
                {t.farms.length > 1 && (
                  <label data-testid="reports-ground-all" style={{ ...groundRow, fontWeight: 700, borderBottom: '1px solid #E4E4E7' }}>
                    <input type="checkbox" checked={allGround} disabled={!!busy} onChange={toggleAllGround}
                           style={{ width: 16, height: 16, accentColor: PINK, margin: 0 }} />
                    Select all
                  </label>
                )}
                {t.farms.map((f) => (
                  <label key={f.id} data-testid={`reports-ground-${f.id}`} style={groundRow}>
                    <input type="checkbox" checked={groundIds.has(f.id)} disabled={!!busy} onChange={() => toggleGround(f.id)}
                           style={{ width: 16, height: 16, accentColor: PINK, margin: 0, flex: '0 0 auto' }} />
                    <span style={{ minWidth: 0, wordBreak: 'break-word' }}>{f.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
        <div style={stepHead}>2 · NOTES TO INCLUDE</div>
        <div style={{ padding: '0 16px 16px' }}>
          {noteItems.length || hasAerial
            ? <NotesStep items={noteItems} value={notes} onChange={setNotes} />
            : <div style={{ fontSize: 12, color: '#A1A1AA' }}>{needsFarm ? 'Choose ground to see its notes.' : 'No notes for this.'}</div>}
        </div>
      </div>
      <div style={{ padding: '14px 16px 18px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#A1A1AA' }}>3 · SEND IT</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {sendBtn('download')}{sendBtn('email')}
        </div>
        {msg
          ? <div data-testid="reports-msg" style={{ fontSize: 12, textAlign: 'center', color: msg.ok ? '#D4D4D8' : '#F87171' }}>{msg.text}</div>
          : <div style={{ fontSize: 12, color: '#A1A1AA', textAlign: 'center' }}>{ready ? `${countLabel(jobs.length)} will be built. Pink notes print on them, with their products.`
              : !kinds.size ? 'Pick at least one report.' : 'Choose ground first.'}</div>}
      </div>
    </div>
  )
}
