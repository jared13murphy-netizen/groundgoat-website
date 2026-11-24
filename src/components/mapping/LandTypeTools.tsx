'use client'

/**
 * LandTypeTools — the land-type half of the Map It bar, shared by the
 * customer bar (MapItToolbar) and the admin Tillable Workshop.
 *
 *   LandTypeMessages  error / notice / busy strip
 *   LandTypeTotals    acres per land type + the soil rating
 *   LandTypeHint      one line saying what a click does right now
 *   LandTypeToolRow   type chips, Add Polygon, Delete, Split, Erase, Simplify,
 *                     Fill Holes, Clear, Start Over, Undo, Redo, Save
 *
 * MapItToolbar places the pieces among its own customer-only parts (outline
 * step, name / project panel, Reports). The default export stacks all four
 * for a host with nothing else to add.
 *
 * `tone`:  'dark'  = the Map It bar's translucent pills (unchanged);
 *          'solid' = house-style solid buttons (pink = primary / armed,
 *                    gray = everything else, black text).
 * `docked` (default export only): render in normal flow instead of as an
 * overlay at the bottom of the map — the overlay would cover a small map.
 */
import type { CSSProperties, ReactNode } from 'react'
import {
  ArrowLeft, Check, Eraser, Layers, Loader2, PaintBucket, Plus, Spline,
  RotateCcw, RotateCw, Save, Scissors, Trash2, X,
} from 'lucide-react'
import { CLASS_COLOR, CLASS_LABEL, LAND_CLASSES } from '@/lib/configurableMapping'
import { polygonAcres } from '@/lib/polygonGeometry'
import type { TractEditor } from './useTractEditor'

export const PINK = '#F58CDE'
const SOLID_GRAY = '#E4E4E7'

export type ToolTone = 'dark' | 'solid'

export const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }
export const stat: CSSProperties = { fontSize: 12, color: 'rgba(255,255,255,0.75)' }

/** The Map It bar: an overlay at the bottom of the map. */
export const overlayBar: CSSProperties = {
  // Owner 10/30: at the bottom with a small gap; the Goat Search dock is
  // hidden by the page while Map It is up (MapChatPanel `hidden`), so
  // nothing sits on top of these buttons.
  position: 'absolute', left: '50%', bottom: 22, transform: 'translateX(-50%)',
  zIndex: 560, width: 'min(960px, calc(100% - 24px))',
  background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(6px)', color: '#fff',
  borderRadius: 14, boxShadow: '0 4px 14px rgba(0,0,0,0.4)', padding: '10px 12px',
  display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13,
}

/** The same bar in normal flow (under a small map). */
export const dockedBar: CSSProperties = {
  background: '#18181B', color: '#fff', padding: '10px 12px',
  display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13,
}

export function Btn({ icon, dot, text, onClick, active, disabled, primary, title, tone = 'dark' }: {
  icon?: ReactNode
  dot?: string
  text: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  primary?: boolean
  title?: string
  tone?: ToolTone
}) {
  const solidBg = primary || active ? PINK : SOLID_GRAY
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title || text} aria-label={title || text}
      aria-pressed={tone === 'solid' && active !== undefined ? !!active : undefined}
      style={tone === 'solid' ? {
        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
        padding: '7px 11px', borderRadius: 999, fontSize: 12, fontWeight: 600,
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
        color: '#111', background: solidBg, border: `1px solid ${solidBg}`,
      } : {
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

/** Error / notice / busy strip. Renders nothing when there is none. */
export function LandTypeMessages({ editor: e }: { editor: TractEditor }) {
  if (!(e.error || e.notice || e.busy || e.loading)) return null
  return (
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
  )
}

/** Acres per land type + the soil rating over the tillable ground. */
export function LandTypeTotals({ editor: e, noSoil = '—' }: {
  editor: TractEditor
  /** shown when there is no rating (no tillable ground, or none computed) */
  noSoil?: string
}) {
  return (
    <div style={{ ...row, gap: 10 }}>
      {LAND_CLASSES.map((c) => (
        <span key={c} style={{ ...stat, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: CLASS_COLOR[c] }} />
          {CLASS_LABEL[c]} {(e.totals[c] ?? 0).toFixed(2)} ac
        </span>
      ))}
      <span style={stat}>
        Soil {e.soilBusy ? '…' : e.soil?.rating != null
          ? `${e.soil.rating}${e.soil.rating_type ? ` (${e.soil.rating_type})` : ''}` : noSoil}
      </span>
    </div>
  )
}

/** What a click does right now. */
export function LandTypeHint({ editor: e }: { editor: TractEditor }) {
  const drawingPoly = e.tool === 'draw' && e.drawing
  return (
    <div style={stat}>
      {drawingPoly
        ? `Click inside the outline · Done, double-click or Enter to finish · Esc to cancel${e.draft.length >= 3 ? ` · drawing ${polygonAcres(e.draft).toFixed(2)} ac` : ''}`
        : e.tool === 'cutpoly' ? 'Click once on each side of the polygon to cut it'
        : e.tool === 'erase' ? 'Drag a box over points to remove them'
        : 'Pick a type, then Add Polygon. Click a polygon to select it; picking a type recolors the selected one.'}
    </div>
  )
}

/** The land-type tool row. */
export function LandTypeToolRow({ editor: e, tone = 'dark', showOutlineButton = true, onSave, beforeSave }: {
  editor: TractEditor
  tone?: ToolTone
  /** "‹ Outline" back to the outline step (Map It only). */
  showOutlineButton?: boolean
  onSave: () => void
  /** Host buttons placed just before Save. */
  beforeSave?: ReactNode
}) {
  const busy = !!e.busy
  const drawingPoly = e.tool === 'draw' && e.drawing
  const hasOutline = e.boundary.length > 0
  return (
    <div style={row}>
      {showOutlineButton && (
        <Btn tone={tone} icon={<ArrowLeft size={13} />} text="Outline" disabled={busy}
             onClick={() => e.setMode('outline')} />
      )}
      {LAND_CLASSES.map((c) => (
        <Btn tone={tone} key={c} dot={CLASS_COLOR[c]} text={CLASS_LABEL[c]} active={e.drawClass === c}
             onClick={() => e.setDrawClass(c)} />
      ))}
      <Btn tone={tone} icon={drawingPoly ? <X size={13} /> : <Plus size={13} />} active={drawingPoly}
           text={drawingPoly ? 'Cancel Drawing' : 'Add Polygon'}
           disabled={busy || !e.classified} onClick={e.startDrawPolygon} />
      {drawingPoly && (
        <Btn tone={tone} icon={<Check size={13} />} text="Done" primary disabled={e.draft.length < 3}
             title="Finish this polygon (same as Enter)" onClick={() => e.finishDraft()} />
      )}
      <Btn tone={tone} icon={<Trash2 size={13} />} text="Delete" disabled={!e.selectedId} onClick={e.deleteSelected} />
      <Btn tone={tone} icon={e.tool === 'cutpoly' ? <X size={13} /> : <Scissors size={13} />} active={e.tool === 'cutpoly'}
           text={e.tool === 'cutpoly' ? 'Cancel Cut' : 'Split'}
           disabled={!e.selectedId && e.tool !== 'cutpoly'} onClick={e.toggleCut} />
      <Btn tone={tone} icon={e.tool === 'erase' ? <Check size={13} /> : <Eraser size={13} />} active={e.tool === 'erase'}
           text={e.tool === 'erase' ? 'Done Erasing' : 'Erase'}
           disabled={!e.selectedId && e.tool !== 'erase'} onClick={e.toggleErase} />
      <Btn tone={tone} icon={<Spline size={13} />} text="Simplify"
           title={e.selectedId ? 'Remove extra dots from the selected polygon' : 'Remove extra dots from every polygon'}
           disabled={busy || !e.shapes.length} onClick={e.simplify} />
      <Btn tone={tone} icon={<PaintBucket size={13} />}
           text={`Fill Holes${e.holesOnSelected > 0 ? ` (${e.holesOnSelected})` : ''}`}
           disabled={!e.selectedId || e.holesOnSelected === 0} onClick={e.fillHoles} />
      <Btn tone={tone} icon={<X size={13} />} text="Clear" disabled={!e.shapes.length}
           onClick={() => { if (window.confirm('Clear every land-type polygon?')) e.clearPolygons() }} />
      <Btn tone={tone} icon={<Layers size={13} />} text="Start Over" disabled={busy || !e.classified}
           title="Back to the engine's land types for this outline"
           onClick={() => { if (window.confirm('Throw away your edits and go back to the engine land types?')) e.startOver() }} />
      <Btn tone={tone} icon={<RotateCcw size={13} />} text="Undo" disabled={!e.canUndo} onClick={e.undo} />
      <Btn tone={tone} icon={<RotateCw size={13} />} text="Redo" disabled={!e.canRedo} onClick={e.redo} />
      {beforeSave}
      <Btn tone={tone} icon={<Save size={13} />} text="Save" primary
           disabled={busy || !hasOutline} onClick={onSave} />
    </div>
  )
}

/** All four pieces stacked, for a host with nothing of its own to add. */
export default function LandTypeTools({
  editor, docked = false, tone = 'dark', showOutlineButton = true, onSave, noSoil, beforeSave, header,
}: {
  editor: TractEditor
  /** normal flow (true) or the Map It overlay at the bottom of the map */
  docked?: boolean
  tone?: ToolTone
  showOutlineButton?: boolean
  onSave: () => void
  noSoil?: string
  beforeSave?: ReactNode
  /** Host line shown above the totals (e.g. boundary acres). */
  header?: ReactNode
}) {
  return (
    <div style={docked ? dockedBar : overlayBar} onMouseDown={(ev) => ev.stopPropagation()}>
      <LandTypeMessages editor={editor} />
      {header}
      <LandTypeTotals editor={editor} noSoil={noSoil} />
      <LandTypeHint editor={editor} />
      <LandTypeToolRow editor={editor} tone={tone} showOutlineButton={showOutlineButton}
                       onSave={onSave} beforeSave={beforeSave} />
    </div>
  )
}
