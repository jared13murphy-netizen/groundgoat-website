'use client'

/**
 * MapItToolbar — the in-map UI for "Map It" on the Explore map. Drives a
 * useTractEditor session. Dark floating style matching the Explore map's
 * other controls (rgba(0,0,0,0.75) + blur, #F58CDE accent).
 *
 * Outline step:    [Draw a Tract + Choose Parcel when starting empty], Snap to
 *                  Parcel, Undo, Redo, Land Types, Save ->
 * Land Types step: class chips, Add Polygon, Delete, Split, Erase,
 *                  Fill Holes, Clear, Start Over, Undo, Redo, Save.
 * Save opens a small panel: name, optional project, Save / Cancel.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowLeft, ArrowRight, Check, Eraser, Layers, Loader2, Magnet, MapPin, PaintBucket, PenTool, Plus,
  RotateCcw, RotateCw, Save, Scissors, Trash2, X,
} from 'lucide-react'
import {
  CLASS_COLOR, CLASS_LABEL, LAND_CLASSES, listProjects,
} from '@/lib/configurableMapping'
import type { TractEditor } from './useTractEditor'

const PINK = '#F58CDE'
const NEW_PROJECT = '__new__'
const NO_PROJECT = ''

const bar: CSSProperties = {
  // Owner 10/30: at the bottom with a small gap; the Goat Search dock is
  // hidden by the page while Map It is up (MapChatPanel `hidden`), so
  // nothing sits on top of these buttons.
  position: 'absolute', left: '50%', bottom: 22, transform: 'translateX(-50%)',
  zIndex: 560, width: 'min(960px, calc(100% - 24px))',
  background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(6px)', color: '#fff',
  borderRadius: 14, boxShadow: '0 4px 14px rgba(0,0,0,0.4)', padding: '10px 12px',
  display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13,
}
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }
const stat: CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.75)' }
const field: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.08)',
  border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, color: '#fff',
  padding: '8px 10px', fontSize: 14,
}
const label: CSSProperties = {
  color: 'rgba(255,255,255,0.45)', fontSize: 10, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4, display: 'block',
}

function Btn({ icon, dot, text, onClick, active, disabled, primary, title }: {
  icon?: ReactNode
  dot?: string
  text: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  primary?: boolean
  title?: string
}) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title || text} aria-label={title || text}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        padding: '7px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
        color: primary ? '#111' : '#fff',
        background: primary ? PINK : active ? 'rgba(245,140,222,0.25)' : 'rgba(255,255,255,0.1)',
        border: `1px solid ${active ? PINK : primary ? PINK : 'rgba(255,255,255,0.22)'}`,
      }}>
      {dot && <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flex: 'none' }} />}
      {icon}
      {text}
    </button>
  )
}

export default function MapItToolbar({
  editor, onExit, startKind, lockedProject, choosing, onToggleChoose,
}: {
  editor: TractEditor
  /** Leave Map It without saving. */
  onExit: () => void
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

  const openSave = () => {
    setName((n) => n || e.defaultName)
    setSavePanel(true)
  }
  const doSave = () => {
    if (lockedProject) {
      void e.save({ name, projectId: lockedProject.id, projectName: null, projectLabel: lockedProject.name })
      return
    }
    const picked = projects.find((p) => p.id === pick)
    void e.save({
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

  const busy = !!e.busy
  const landTypes = e.mode === 'landtypes'
  const drawingTract = e.tool === 'drawtract' && e.drawing
  const drawingPoly = e.tool === 'draw' && e.drawing
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
              <div style={{ ...field, background: 'rgba(255,255,255,0.04)' }}>{lockedProject.name}</div>
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

      {(e.error || e.notice || e.busy || e.loading) && (
        <div style={{
          fontSize: 12, padding: '6px 10px', borderRadius: 8,
          background: e.error ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.08)',
          color: e.error ? '#fca5a5' : 'rgba(255,255,255,0.85)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          {e.busy && <Loader2 size={13} className="animate-spin" />}
          <span style={{ flex: 1 }}>{e.error || e.busy || e.notice}</span>
          {(e.error || e.notice) && !e.busy && (
            <button type="button" onClick={e.clearMessages} aria-label="Dismiss"
                    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}>
              <X size={13} />
            </button>
          )}
        </div>
      )}

      <div style={{ ...row, justifyContent: 'space-between' }}>
        <div style={{ ...row, gap: 12 }}>
          <span style={{ fontWeight: 700, color: PINK }}>Map It</span>
          <span style={stat}>{landTypes ? 'Step 2 · Land types' : 'Step 1 · Outline'}</span>
          <span style={stat}>Boundary {e.boundaryAcres.toFixed(2)} ac</span>
        </div>
        <Btn icon={<X size={13} />} text="Cancel mapping" onClick={exit} />
      </div>

      {!landTypes ? (
        <>
          <div style={stat}>
            {drawingTract
              ? 'Click to add corners · double-click or Enter to finish · Esc to cancel'
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
                <Btn icon={<MapPin size={13} />} active={choosing} text="Choose Parcel"
                     disabled={busy || e.loading || e.drawing}
                     title="Then click a parcel on the map to use its outline."
                     onClick={onToggleChoose} />
              </>
            )}
            <Btn icon={<Magnet size={13} />} text="Snap to Parcel"
                 disabled={busy || !hasOutline || e.drawing}
                 title="Fits the outline to the parcel lines underneath so the acres are exact."
                 onClick={() => void e.snapToParcel()} />
            {undoBtns}
            <Btn icon={<ArrowRight size={13} />} text="Land Types" primary
                 disabled={busy || !hasOutline || e.drawing}
                 onClick={() => e.setMode('landtypes')} />
            <Btn icon={<Save size={13} />} text="Save" disabled={busy || !hasOutline || e.drawing}
                 title="Save with the engine's land types"
                 onClick={openSave} />
          </div>
        </>
      ) : (
        <>
          <div style={{ ...row, gap: 10 }}>
            {LAND_CLASSES.map((c) => (
              <span key={c} style={{ ...stat, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: CLASS_COLOR[c] }} />
                {CLASS_LABEL[c]} {(e.totals[c] ?? 0).toFixed(2)} ac
              </span>
            ))}
            <span style={stat}>
              Soil {e.soilBusy ? '…' : e.soil?.rating != null
                ? `${e.soil.rating}${e.soil.rating_type ? ` (${e.soil.rating_type})` : ''}` : '—'}
            </span>
          </div>
          <div style={stat}>
            {drawingPoly
              ? 'Click inside the outline · double-click or Enter to finish · Esc to cancel'
              : e.tool === 'cutpoly' ? 'Click once on each side of the polygon to cut it'
              : e.tool === 'erase' ? 'Drag a box over points to remove them'
              : 'Pick a type, then Add Polygon. Click a polygon to select it; picking a type recolors the selected one.'}
          </div>
          <div style={row}>
            <Btn icon={<ArrowLeft size={13} />} text="Outline" disabled={busy}
                 onClick={() => e.setMode('outline')} />
            {LAND_CLASSES.map((c) => (
              <Btn key={c} dot={CLASS_COLOR[c]} text={CLASS_LABEL[c]} active={e.drawClass === c}
                   onClick={() => e.setDrawClass(c)} />
            ))}
            <Btn icon={drawingPoly ? <X size={13} /> : <Plus size={13} />} active={drawingPoly}
                 text={drawingPoly ? 'Cancel Drawing' : 'Add Polygon'}
                 disabled={busy || !e.classified} onClick={e.startDrawPolygon} />
            <Btn icon={<Trash2 size={13} />} text="Delete" disabled={!e.selectedId} onClick={e.deleteSelected} />
            <Btn icon={e.tool === 'cutpoly' ? <X size={13} /> : <Scissors size={13} />} active={e.tool === 'cutpoly'}
                 text={e.tool === 'cutpoly' ? 'Cancel Cut' : 'Split'}
                 disabled={!e.selectedId && e.tool !== 'cutpoly'} onClick={e.toggleCut} />
            <Btn icon={e.tool === 'erase' ? <Check size={13} /> : <Eraser size={13} />} active={e.tool === 'erase'}
                 text={e.tool === 'erase' ? 'Done Erasing' : 'Erase'}
                 disabled={!e.selectedId && e.tool !== 'erase'} onClick={e.toggleErase} />
            <Btn icon={<PaintBucket size={13} />}
                 text={`Fill Holes${e.holesOnSelected > 0 ? ` (${e.holesOnSelected})` : ''}`}
                 disabled={!e.selectedId || e.holesOnSelected === 0} onClick={e.fillHoles} />
            <Btn icon={<X size={13} />} text="Clear" disabled={!e.shapes.length}
                 onClick={() => { if (window.confirm('Clear every land-type polygon?')) e.clearPolygons() }} />
            <Btn icon={<Layers size={13} />} text="Start Over" disabled={busy || !e.classified}
                 title="Back to the engine's land types for this outline"
                 onClick={() => { if (window.confirm('Throw away your edits and go back to the engine land types?')) e.startOver() }} />
            {undoBtns}
            <Btn icon={<Save size={13} />} text="Save" primary
                 disabled={busy || !hasOutline} onClick={openSave} />
          </div>
        </>
      )}
    </div>
  )
}
