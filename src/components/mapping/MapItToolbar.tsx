'use client'

/**
 * MapItToolbar — the in-map UI for "Map It" on the Explore map. Drives a
 * useTractEditor session. Dark floating style matching the Explore map's
 * other controls (rgba(0,0,0,0.75) + blur, #F58CDE accent).
 *
 * Outline step:    [Draw a Tract + Choose Parcel when starting empty],
 *                  Parcel, Undo, Redo, Land Types, Save ->
 * Land Types step: class chips, Add Polygon, Delete, Split, Erase,
 *                  Fill Holes, Clear, Start Over, Undo, Redo, Save.
 * Save opens a small panel the first time: name, optional project, Save /
 * Cancel. Later saves just save. Once saved, a Reports button sits in the bar.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  ArrowRight, Check, FileText, Loader2, MapPin, PenTool,
  RotateCcw, RotateCw, Save, X,
} from 'lucide-react'
import { listProjects } from '@/lib/configurableMapping'
import type { TractEditor } from './useTractEditor'
import { polygonAcres } from '@/lib/polygonGeometry'
import { openReports } from '@/lib/reportsPanel'
// The land-type half of the bar (shared with the admin Tillable Workshop).
import {
  Btn, LandTypeHint, LandTypeMessages, LandTypeToolRow, LandTypeTotals,
  PINK, overlayBar as bar, row, stat,
} from './LandTypeTools'

const NEW_PROJECT = '__new__'
const NO_PROJECT = ''

const field: CSSProperties = {
  // Owner 11/3: input boxes are ALWAYS white with a light gray border —
  // never a dark box, even inside a dark panel.
  width: '100%', boxSizing: 'border-box', background: '#FFFFFF',
  border: '1px solid #D1D5DB', borderRadius: 8, color: '#111111',
  padding: '8px 10px', fontSize: 14,
}
const label: CSSProperties = {
  color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, display: 'block',
}

export default function MapItToolbar({
  editor, onExit, onDone, startKind, lockedProject, savedProject, canUseReports, choosing, onToggleChoose,
}: {
  editor: TractEditor
  /** Leave Map It without saving. */
  onExit: () => void
  /** "Done" once the tract is saved: leave Map It and open its panel. */
  onDone?: (savedId: string) => void
  /** Project the tract landed in on its first save this session (the
   *  host learns it from onSaved). Lets the bar's reports work when the
   *  user let the server make the project. */
  savedProject: { id: string; name: string } | null
  /** Reports gate (basic plan has none). */
  canUseReports: boolean
  /** How this session started: a parcel, a saved tract, or empty. */
  startKind: 'parcel' | 'tract' | 'empty'
  /** Project the tract is saved into, fixed for this session (Add a New
   *  Tract / editing a saved map). Null = the user picks on save. */
  lockedProject: { id: string; name: string } | null
  /** "Choose Parcel" is armed: the next parcel click loads its outline. */
  choosing: boolean
  onToggleChoose: () => void
}) {
  const e = editor
  const [savePanel, setSavePanel] = useState(false)
  const [name, setName] = useState('')
  const [pick, setPick] = useState<string>(NO_PROJECT)
  const [newName, setNewName] = useState('')
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])

  // The user's existing projects, for the optional "Add to project".
  useEffect(() => {
    if (lockedProject) return
    let stale = false
    listProjects()
      .then((r: any) => {
        if (stale) return
        // Shared projects are read-only to a colleague; only offer your own.
        setProjects(((r?.projects ?? r ?? []) as any[])
          .filter((p) => !p.shared).map((p) => ({ id: p.id, name: p.name })))
      })
      .catch(() => { /* saving with no project still works */ })
    return () => { stale = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!lockedProject])

  // Reports for the saved tract, in the bar. The project is the locked one
  // (editing a saved map / Add a New Tract) or the one the first save
  // created. Every save purges the tract's old PDFs, so reload after.
  const project = lockedProject ?? savedProject
  const reportsOn = canUseReports && !!e.savedId && !!project
  const savedNameRef = useRef('')

  const runSave = async (opts: Parameters<typeof e.save>[0]) => {
    const ok = await e.save(opts)
    if (ok) { savedNameRef.current = opts.name.trim(); setSavePanel(false) }
    return ok
  }
  const openSave = () => {
    setName((n) => n || e.defaultName)
    setSavePanel(true)
  }
  // Owner 11/2: the name/project panel only the FIRST time a tract is
  // saved. After that Save just saves (the server keeps its project).
  const saveClick = () => {
    if (!e.savedId) { openSave(); return }
    void runSave({ name: savedNameRef.current || e.defaultName || name, projectId: null, projectName: null })
  }
  const doSave = () => {
    if (lockedProject) {
      void runSave({ name, projectId: lockedProject.id, projectName: null, projectLabel: lockedProject.name })
      return
    }
    const picked = projects.find((p) => p.id === pick)
    void runSave({
      name,
      projectId: pick && pick !== NEW_PROJECT ? pick : null,
      projectName: pick === NEW_PROJECT ? newName : null,
      projectLabel: picked?.name ?? null,
    })
  }
  const exit = () => {
    if (e.dirty && !window.confirm('Discard this map? Your drawing has not been saved.')) return
    onExit()
  }
  const done = () => {
    if (e.savedId && !e.dirty && onDone) onDone(e.savedId)
    else exit()
  }

  const busy = !!e.busy
  const landTypes = e.mode === 'landtypes'
  const drawingTract = e.tool === 'drawtract' && e.drawing
  const hasOutline = e.boundary.length > 0
  const undoBtns = (
    <>
      <Btn icon={<RotateCcw size={13} />} text="Undo" disabled={!e.canUndo} onClick={e.undo} />
      <Btn icon={<RotateCw size={13} />} text="Redo" disabled={!e.canRedo} onClick={e.redo} />
    </>
  )

  return (
    <div style={bar} onMouseDown={(ev) => ev.stopPropagation()}>
      {savePanel && (
        <div style={{
          background: 'rgba(20,20,20,0.95)', border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div>
            <span style={label}>Tract name</span>
            <input
              autoFocus value={name} onChange={(ev) => setName(ev.target.value)}
              onKeyDown={(ev) => { if (ev.key === 'Enter' && name.trim() && !busy) doSave() }}
              placeholder="e.g. Home Place, North 80" style={field} />
          </div>
          {lockedProject ? (
            <div>
              <span style={label}>Project</span>
              <div style={{ ...field, background: '#F3F4F6' }}>{lockedProject.name}</div>
            </div>
          ) : (
          <div>
            <span style={label}>Add to project (optional)</span>
            <select value={pick} onChange={(ev) => setPick(ev.target.value)} style={field}>
              <option value={NO_PROJECT}>None</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              <option value={NEW_PROJECT}>New project…</option>
            </select>
            {pick === NEW_PROJECT && (
              <input
                value={newName} onChange={(ev) => setNewName(ev.target.value)}
                placeholder="Project name" style={{ ...field, marginTop: 6 }} />
            )}
          </div>
          )}
          <div style={{ ...row, justifyContent: 'flex-end' }}>
            <Btn text="Cancel" onClick={() => setSavePanel(false)} disabled={busy} />
            <Btn icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                 text="Save" primary disabled={busy || !name.trim()} onClick={doSave} />
          </div>
        </div>
      )}

      <LandTypeMessages editor={e} />

      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div style={{ ...row, gap: 12 }}>
          <span style={{ fontWeight: 700, color: PINK }}>Map It</span>
          <span style={stat}>{landTypes ? 'Step 2 · Land types' : 'Step 1 · Outline'}</span>
          <span style={stat}>Boundary {e.boundaryAcres.toFixed(2)} ac</span>
        </div>
        {e.savedId && !e.dirty && onDone
          ? <Btn icon={<Check size={13} />} text="Done" onClick={done} title="Leave Map It and open this saved tract" />
          : <Btn icon={<X size={13} />} text="Cancel mapping" onClick={exit} />}
      </div>

      {reportsOn && (
        <div data-gg-mapit-reports style={{ ...row, gap: 6 }}>
          {/* Owner 11/15: one Reports button opens the Reports panel for
              this saved tract (every report, its notes, Download / Email). */}
          <Btn primary icon={<FileText size={13} />} text="Reports"
               disabled={e.dirty || busy}
               title={e.dirty ? 'Save your changes first' : 'Reports for this saved tract'}
               onClick={() => openReports({
                 target: { type: 'farm', parcelId: e.savedId!, title: savedNameRef.current || e.defaultName || 'Farm',
                           meta: `${e.boundaryAcres.toFixed(2)} ac`, projectId: project!.id, projectName: project!.name },
                 backLabel: 'Map It', canUseReports, canUseMapIt: true,
               })} />
        </div>
      )}

      {!landTypes ? (
        <>
          <div style={stat}>
            {drawingTract
              ? `Click to add corners · Done, double-click or Enter to finish · Esc to cancel${e.draft.length >= 3 ? ` · drawing ${polygonAcres(e.draft).toFixed(2)} ac` : ''}`
              : choosing
              ? 'Zoom in until parcel lines show, then click a parcel'
              : startKind === 'empty' && !hasOutline
              ? 'Draw a tract, or choose a parcel on the map'
              : 'Drag a corner to move it · click the outline to add one · right-click a corner to remove it'}
          </div>
          <div style={row}>
            {startKind === 'empty' && (
              <>
                <Btn icon={drawingTract ? <X size={13} /> : <PenTool size={13} />} active={drawingTract}
                     text={drawingTract ? 'Cancel Drawing' : 'Draw a Tract'} disabled={busy || e.loading}
                     onClick={() => { if (choosing) onToggleChoose(); e.startDrawTract() }} />
                {drawingTract && (
                  <Btn icon={<Check size={13} />} text="Done" primary disabled={e.draft.length < 3}
                       title="Finish the outline (same as Enter)" onClick={() => e.finishDraft()} />
                )}
                <Btn icon={<MapPin size={13} />} active={choosing} text="Choose Parcel"
                     disabled={busy || e.loading || e.drawing}
                     title="Then click a parcel on the map to use its outline."
                     onClick={onToggleChoose} />
              </>
            )}
            {/* Snap to Parcel removed 10/30 (owner: did not work, not needed). */}
            {undoBtns}
            <Btn icon={<ArrowRight size={13} />} text="Land Types" primary
                 disabled={busy || !hasOutline || e.drawing}
                 onClick={() => e.setMode('landtypes')} />
            <Btn icon={<Save size={13} />} text="Save" disabled={busy || !hasOutline || e.drawing}
                 title="Save with the engine's land types"
                 onClick={saveClick} />
          </div>
        </>
      ) : (
        <>
          <LandTypeTotals editor={e} />
          <LandTypeHint editor={e} />
          <LandTypeToolRow editor={e} onSave={saveClick} />
        </>
      )}
    </div>
  )
}
