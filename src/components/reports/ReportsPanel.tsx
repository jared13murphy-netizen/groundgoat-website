'use client'

/**
 * ReportsPanel — the one place every report starts (owner 11/15, mockups
 * "PROPOSAL — one Reports panel" + the parcel/tract bottom buttons).
 *
 * 1 · Pick a report — cards; the picked one is pink (gradient) with black
 *     text, the others gray. Reports that need a Map It farm are grayed out
 *     on a plain parcel or auction tract ("Map It this farm first").
 * 2 · Notes to include — NotesStep (None · Latest · All · Pick + the notes).
 * 3 · Send it — Download or Email (off until a report is picked).
 *
 * Opened from anywhere with openReports() (lib/reportsPanel); back and X
 * both return to the screen it was opened from. Parcel and Tract Reports go
 * through the report queue (POST /api/reports/jobs: the floating
 * ReportJobsIndicator downloads or confirms the email); Map It reports go
 * through /api/mapping/reports (Email = params.deliver "email").
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { ChevronLeft, Download, Loader2, Mail, X } from 'lucide-react'
import reportJobEnqueue from '@/lib/reportJobs'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { getProject, queueAndDownloadReport, queueReport, type ReportKind } from '@/lib/configurableMapping'
import { DEFAULT_NOTES_PRINT, notesPrintBody, type NotePickItem, type NotesPrint } from '@/lib/notes'
import { closeReports, reportsSnapshot, subscribeReports, type ReportsOpen, type ReportsTarget } from '@/lib/reportsPanel'
import useSlide from '@/lib/useSlide'
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
    return [own, ...MAP_KINDS.map((k) => mapIt(k, mapOff || 'Map It this farm first'))]
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
  // One report to pick = picked already; otherwise Download/Email wait for a pick.
  const [kind, setKind] = useState<Kind | null>(enabled.length === 1 ? enabled[0].kind : null)
  const [farmId, setFarmId] = useState<string | null>(t.type === 'farm' ? t.parcelId : t.type === 'project' && t.farms.length === 1 ? t.farms[0].id : null)
  const [notes, setNotes] = useState<NotesPrint>(DEFAULT_NOTES_PRINT)
  const [busy, setBusy] = useState<'download' | 'email' | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [projectFarms, setProjectFarms] = useState<{ id: string; name: string }[] | null>(t.type === 'project' ? t.farms : null)

  const projectId = t.type === 'farm' || t.type === 'project' ? t.projectId : null
  const projectName = t.type === 'farm' || t.type === 'project' ? t.projectName : null
  // The Aerial Map prints every farm in the project: its notes too.
  useEffect(() => {
    if (kind !== 'aerial' || projectFarms || !projectId) return
    let live = true
    getProject(projectId).then((r) => {
      if (live) setProjectFarms((r.parcels || []).map((p: any) => ({ id: String(p.id), name: p.name || 'Untitled' })))
    }).catch(() => { if (live) setProjectFarms([]) })
    return () => { live = false }
  }, [kind, projectFarms, projectId])

  const noteItems = useMemo<NotePickItem[]>(() => {
    if (t.type === 'parcel') {
      const k = t.llUuid ? `p:${String(t.llUuid).toLowerCase()}` : t.noteKey
      return k ? [{ key: k, label: t.title }] : []
    }
    if (t.type === 'tract') return [{ key: `t:${String(t.tractId).toLowerCase()}`, label: t.title }]
    if (kind === 'aerial') return (projectFarms || []).map((f) => ({ key: `cm:${f.id.toLowerCase()}`, label: f.name }))
    if (!farmId) return []
    const name = t.type === 'farm' ? t.title : (projectFarms || t.farms).find((f) => f.id === farmId)?.name || 'Farm'
    return [{ key: `cm:${farmId.toLowerCase()}`, label: name }]
  }, [t, kind, farmId, projectFarms])

  const needsFarm = t.type === 'project' && kind != null && kind !== 'aerial'
  const ready = kind != null && (!needsFarm || !!farmId)

  const send = async (delivery: 'download' | 'email') => {
    if (!ready || !kind || busy) return
    setBusy(delivery); setMsg(null)
    const notes_print = notesPrintBody(notes)
    try {
      if (kind === 'parcel' || kind === 'tract') {
        let res: Response
        if (t.type === 'tract') res = await reportJobEnqueue('tract', delivery, { tract_id: t.tractId, notes_print })
        else if (t.type === 'parcel' && t.llUuid) res = await reportJobEnqueue('parcel', delivery, { ll_uuid: t.llUuid, notes_print })
        else if (t.type === 'parcel') res = await reportJobEnqueue('parcel_by_point', delivery, { lat: t.lat, lng: t.lng, notes_print })
        else throw new Error('Pick a report')
        if (!res.ok) { setMsg({ ok: false, text: await errorText(res) }); return }
        setMsg({ ok: true, text: delivery === 'email' ? 'Building it — it will arrive in your email.' : 'Building it — it downloads when ready.' })
        return
      }
      const ref = kind === 'aerial' ? { projectId: projectId || undefined } : { parcelId: farmId || undefined }
      const params = { notes_print, ...(kind === 'elevation_3d' ? { exaggeration: DEFAULT_EXAGGERATION } : {}) }
      if (delivery === 'email') {
        await queueReport(ref, kind, { ...params, deliver: 'email' })
        setMsg({ ok: true, text: 'Building it — we will email it to you when it is ready.' })
      } else {
        setMsg({ ok: true, text: 'Building it — it downloads when ready. You can close this.' })
        await queueAndDownloadReport(ref, kind, projectName, params)
        setMsg({ ok: true, text: 'Downloaded.' })
      }
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message || 'Something went wrong — try again' })
    } finally {
      setBusy(null)
    }
  }

  const close = () => closeReports()
  const card = (x: Option) => {
    const on = kind === x.kind
    return (
      <button key={x.kind} type="button" disabled={!!x.off} data-testid={`report-card-${x.kind}`} aria-pressed={on}
              onClick={() => { setKind(x.kind); setMsg(null) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', borderRadius: 12, border: 'none',
                       background: on ? PINK_GRADIENT : '#1C1C1E', opacity: x.off ? 0.5 : 1,
                       cursor: x.off ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: on ? '#000' : '#8E8E96' }}>{INFO[x.kind].name}</span>
        <span style={{ display: 'block', fontSize: 12, marginTop: 2, color: on ? '#3F1D36' : '#6B6B73' }}>{x.desc}</span>
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
        <div style={stepHead}>1 · PICK A REPORT</div>
        <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {options.map(card)}
          {needsFarm && t.type === 'project' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#A1A1AA' }}>
              Farm
              <select data-testid="reports-farm" value={farmId || ''} onChange={(e) => setFarmId(e.target.value || null)}
                      style={{ background: '#FFFFFF', border: '1px solid #D4D4D8', borderRadius: 10, color: '#111111',
                               padding: '9px 32px 9px 12px', fontSize: 14, fontFamily: 'inherit' }}>
                <option value="">Choose a farm</option>
                {t.farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <div style={stepHead}>2 · NOTES TO INCLUDE</div>
        <div style={{ padding: '0 16px 16px' }}>
          {noteItems.length || kind === 'aerial'
            ? <NotesStep items={noteItems} value={notes} onChange={setNotes} />
            : <div style={{ fontSize: 12, color: '#A1A1AA' }}>{needsFarm ? 'Choose a farm to see its notes.' : 'No notes for this.'}</div>}
        </div>
      </div>
      <div style={{ padding: '14px 16px 18px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#A1A1AA' }}>3 · SEND IT</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {sendBtn('download')}{sendBtn('email')}
        </div>
        {msg
          ? <div data-testid="reports-msg" style={{ fontSize: 12, textAlign: 'center', color: msg.ok ? '#D4D4D8' : '#F87171' }}>{msg.text}</div>
          : <div style={{ fontSize: 12, color: '#A1A1AA', textAlign: 'center' }}>{ready ? 'Pink notes print on the report, with their products.' : 'Pick a report first.'}</div>}
      </div>
    </div>
  )
}
