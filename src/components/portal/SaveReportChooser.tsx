'use client'

// Save → "Save report" and/or "Save as project" (owner-approved 2026-11-10).
// OWNER RULE: save works the first time, every time — no failure UX. Save is
// enabled only when the server's preview says it will succeed; the save then
// retries invisibly until the server confirms (src/lib/reportToProject.ts).

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Check, FolderOpen, Loader2, Share2, X } from 'lucide-react'
import {
  PROJECT_SAVE_CAP, newIdempotencyKey, openSavedProject, previewFromReport, reportItemFromRow,
  reportItemFromSubject, saveReportAsProject, saveReportUntilConfirmed, untilConfirmed,
  type Preview, type SaveResult,
} from '@/lib/reportToProject'
import { firmMembers, projectShares, type FirmMember } from '@/lib/configurableMapping'
import type { TractSaleData } from './PortalTractDetail'

const PINK = '#F58CDE'
// Owner rule 11/3: inputs are ALWAYS white with a light gray border.
const inputStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#FFFFFF', border: '1px solid #D1D5DB',
  borderRadius: 8, color: '#111111', padding: '8px 10px', fontSize: 13,
}

interface Props {
  subjectInfo: any | null
  reportTracts: TractSaleData[]
  /** The saved-report recipe (same body as POST /api/mapping/saved-reports). */
  buildRecipe: () => { subject: Record<string, any>; items: any[] }
  onClose: () => void
}

type Phase = 'choose' | 'saving' | 'done'

export default function SaveReportChooser({ subjectInfo, reportTracts, buildRecipe, onClose }: Props) {
  const [wantReport, setWantReport] = useState(true)
  const [wantProject, setWantProject] = useState(false)
  const [name, setName] = useState('')
  const nameTouched = useRef(false)
  const [projectId, setProjectId] = useState<string | null>(null)
  const [pickExisting, setPickExisting] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checking, setChecking] = useState(false)
  const [phase, setPhase] = useState<Phase>('choose')
  const [result, setResult] = useState<SaveResult | null>(null)
  const [reportOnlyDone, setReportOnlyDone] = useState(false)

  const subject = useMemo(() => reportItemFromSubject(subjectInfo), [subjectInfo])
  const items = useMemo(() => reportTracts.map(reportItemFromRow), [reportTracts])
  const itemsKey = useMemo(() => JSON.stringify([subject, items]), [subject, items])

  // Pre-validate while the panel is open (and again when the target changes).
  useEffect(() => {
    if (!wantProject) return
    const signal = { cancelled: false }
    setChecking(true)
    previewFromReport({ subject, items, project_id: projectId }, { signal })
      .then((p) => {
        if (signal.cancelled) return
        setPreview(p)
        if (!nameTouched.current) setName(p.default_name)
      })
      .catch(() => {
        // The chosen project is gone (404): fall back to a new project.
        if (!signal.cancelled && projectId) { setProjectId(null); setPickExisting(false) }
      })
      .finally(() => { if (!signal.cancelled) setChecking(false) })
    return () => { signal.cancelled = true }
  }, [wantProject, projectId, itemsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = preview?.counts
  const chosenProject = projectId ? preview?.projects.find((p) => p.id === projectId) : null
  const projectReady = !!preview && !checking && preview.ok_to_save && (!!projectId || name.trim().length > 0)
  const canSave = phase === 'choose' && (wantReport || wantProject) && (!wantProject || projectReady)

  const save = async () => {
    if (!canSave) return
    setPhase('saving')
    const recipe = buildRecipe()
    if (wantProject) {
      const r = await saveReportAsProject({
        idempotency_key: newIdempotencyKey(),
        subject, items, project_id: projectId,
        name: projectId ? null : name.trim(),
        report: wantReport ? { subject: recipe.subject, items: recipe.items } : null,
      }).catch(() => null)
      if (r) { setResult(r); setPhase('done') } else { setPhase('choose') }
      return
    }
    const ok = await saveReportUntilConfirmed(recipe).then(() => true).catch(() => false)
    if (ok) { setReportOnlyDone(true); setPhase('done'); setTimeout(onClose, 2000) } else { setPhase('choose') }
  }

  const box: CSSProperties = {
    background: '#161616', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12, padding: 14,
    boxShadow: '0 6px 24px rgba(0,0,0,0.6)', color: '#fff', fontSize: 13,
  }
  const choice = (on: boolean): CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderRadius: 10, cursor: 'pointer',
    border: `1px solid ${on ? PINK : 'rgba(255,255,255,0.18)'}`, background: on ? 'rgba(245,140,222,0.12)' : 'transparent',
    fontWeight: 600, flex: 1,
  })
  const muted: CSSProperties = { color: 'rgba(255,255,255,0.6)', fontSize: 12 }

  if (phase === 'done') {
    if (reportOnlyDone) {
      return (
        <div style={box} data-testid="save-confirmation">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <Check size={16} color="#4ade80" /> Report saved
          </div>
        </div>
      )
    }
    return <SavedConfirmation result={result!} reportToo={wantReport} onClose={onClose} />
  }

  return (
    <div style={box} data-testid="save-chooser">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, flex: 1 }}>Save</span>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={choice(wantReport)} data-testid="choice-report">
          <input type="checkbox" checked={wantReport} onChange={(e) => setWantReport(e.target.checked)} disabled={phase !== 'choose'} />
          Save report
        </label>
        <label style={choice(wantProject)} data-testid="choice-project">
          <input type="checkbox" checked={wantProject} onChange={(e) => setWantProject(e.target.checked)} disabled={phase !== 'choose'} />
          Save as project
        </label>
      </div>

      {wantProject && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!projectId ? (
            <>
              <div style={muted}>Project name</div>
              <input data-testid="project-name" style={inputStyle} value={name} maxLength={200}
                     placeholder={preview?.default_name || 'Project name'}
                     onChange={(e) => { nameTouched.current = true; setName(e.target.value) }} />
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FolderOpen size={14} color={PINK} />
              <span style={{ fontWeight: 600 }} data-testid="chosen-project">{chosenProject?.name || 'Project'}</span>
              <button type="button" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: PINK, cursor: 'pointer', fontSize: 12 }}
                      onClick={() => { setProjectId(null); setPickExisting(false) }}>
                New project instead
              </button>
            </div>
          )}
          {!projectId && (preview?.projects.length ?? 0) > 0 && (
            !pickExisting ? (
              <button type="button" data-testid="add-existing" onClick={() => setPickExisting(true)}
                      style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0, color: 'rgba(255,255,255,0.65)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>
                or add to an existing project
              </button>
            ) : (
              <select data-testid="existing-project" style={inputStyle} defaultValue=""
                      onChange={(e) => { if (e.target.value) setProjectId(e.target.value) }}>
                <option value="" disabled>Choose a project…</option>
                {preview!.projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.shared ? ` (shared by ${p.shared_by || 'a colleague'})` : ''}</option>
                ))}
              </select>
            )
          )}

          <div data-testid="save-summary" style={{ marginTop: 2 }}>
            {checking || !preview ? (
              <span style={{ ...muted, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Loader2 size={12} className="animate-spin" /> Checking…
              </span>
            ) : preview.over_cap ? (
              <span style={muted} data-testid="cap-note">{preview.note || `Save as project holds up to ${PROJECT_SAVE_CAP} items.`}</span>
            ) : (
              <span style={{ fontWeight: 600 }}>{preview.summary_text}</span>
            )}
          </div>
          {/* v2 (owner 11/10): a farm can be in many projects. Items already
              saved are LINKED here and keep their one drawing — no Move/Leave. */}
          {!checking && preview && !preview.over_cap && (counts?.existing ?? 0) > 0 && (
            <div style={muted} data-testid="existing-note">
              {counts!.existing === 1 ? '1 is already one of your saved farms; it will be added here and keep its drawing.'
                : `${counts!.existing} are already your saved farms; they will be added here and keep their drawings.`}
            </div>
          )}
          {!checking && preview && !preview.over_cap && preview.unsavable.length > 0 && (
            <div style={muted} data-testid="unsavable-note">
              {preview.unsavable.length === 1 ? '1 item has no boundary on record and will be left out.'
                : `${preview.unsavable.length} items have no boundary on record and will be left out.`}
            </div>
          )}
          {!checking && preview && !preview.over_cap && counts && counts.total === 0 && (
            <div style={muted}>Nothing in this report can be saved as a project.</div>
          )}
        </div>
      )}

      <button type="button" data-testid="save-confirm" onClick={() => void save()} disabled={!canSave}
              style={{ marginTop: 14, width: '100%', padding: '10px 0', borderRadius: 10, fontWeight: 700, fontSize: 14,
                       background: canSave || phase === 'saving' ? PINK : 'rgba(245,140,222,0.35)', color: '#000', border: 'none',
                       cursor: canSave ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        {phase === 'saving' ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save'}
      </button>
    </div>
  )
}

function SavedConfirmation({ result, reportToo, onClose }: { result: SaveResult; reportToo: boolean; onClose: () => void }) {
  const [members, setMembers] = useState<FirmMember[] | null>(null)
  const [sharing, setSharing] = useState<string[] | null>(null)
  const [shareState, setShareState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const canShare = result.share_available && result.project.owned

  useEffect(() => {
    if (!canShare) return
    firmMembers().then((r) => setMembers(r.members || [])).catch(() => setMembers([]))
  }, [canShare])

  const openShare = async () => {
    try {
      const cur = await projectShares(result.project.id)
      setSharing(cur.user_ids || [])
    } catch { setSharing([]) }
  }
  const saveShare = async () => {
    if (!sharing) return
    setShareState('saving')
    await untilConfirmed(`/api/mapping/projects/${encodeURIComponent(result.project.id)}/shares`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_ids: sharing }),
    }).catch(() => null)
    setShareState('saved')
    setTimeout(() => { setSharing(null); setShareState('idle') }, 1200)
  }

  const c = result.counts
  const n = c.saved + (c.linked ?? 0) + (c.moved ?? 0) + c.already_in_project
  const btn: CSSProperties = {
    flex: 1, padding: '9px 0', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }
  return (
    <div data-testid="save-confirmation" style={{
      background: '#161616', border: '1px solid rgba(255,255,255,0.18)', borderRadius: 12, padding: 14,
      boxShadow: '0 6px 24px rgba(0,0,0,0.6)', color: '#fff', fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
        <Check size={16} color="#4ade80" /> Saved
        <button type="button" onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#aaa', cursor: 'pointer' }}>
          <X size={16} />
        </button>
      </div>
      <div style={{ marginTop: 6 }} data-testid="saved-project-name">
        {n} item{n === 1 ? '' : 's'} in <b>{result.project.name}</b>{reportToo ? ' · report saved to the project' : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" data-testid="open-project" style={{ ...btn, background: PINK, color: '#000', border: 'none' }}
                onClick={() => { openSavedProject(result.project.id); onClose() }}>
          <FolderOpen size={14} /> Open project
        </button>
        {canShare && (members?.length ?? 0) > 0 && (
          <button type="button" data-testid="share-project" style={{ ...btn, background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
                  onClick={() => void openShare()}>
            <Share2 size={14} /> Share
          </button>
        )}
      </div>
      {sharing && (
        <div style={{ marginTop: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: '8px 10px' }} data-testid="share-list">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Share with</div>
          {(members || []).map((m) => (
            <label key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0', cursor: 'pointer' }}>
              <input type="checkbox" checked={sharing.includes(m.id)}
                     onChange={(e) => setSharing(e.target.checked ? Array.from(new Set([...sharing, m.id])) : sharing.filter((x) => x !== m.id))} />
              <span>{m.full_name || m.email}</span>
            </label>
          ))}
          <button type="button" data-testid="share-save" onClick={() => void saveShare()} disabled={shareState !== 'idle'}
                  style={{ marginTop: 6, padding: '6px 14px', borderRadius: 999, background: PINK, color: '#000', border: 'none', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {shareState === 'saving' ? 'Sharing…' : shareState === 'saved' ? 'Shared' : 'Share'}
          </button>
        </div>
      )}
    </div>
  )
}
