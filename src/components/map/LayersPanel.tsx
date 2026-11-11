'use client'

// ── Map layers panel v2 (owner approved 11/10) ─────────────────────────
// Spec: ground-goat-backend/docs/layers-panel-v2-spec.md.
// Top to bottom: header ("N on · Turn all off"), ON NOW chips, basemap
// tiles, then collapsible groups. REVISION 11/10: no switches —
// every layer is a picture tile (3 per row); tap toggles. Under each
// group's grid, every ON layer gets a compact settings strip (name +
// legend/year chips + Opacity slider). ON tiles "breathe": the layer
// image fades 0.82→1→0.82 (owner 11/10: subtle) over the satellite-only base image with a
// pulsing pink glow — CSS @keyframes only, off for prefers-reduced-motion.
// Previews: public/layer-previews/<key>.png + <key>-base.png (480x320).
// Holds TODAY's layers only — no new map data, no search bar. The base
// overlays (Soil Types, NCCPI, Crops by Year, Tillable Map, FSA, Annual
// Precipitation) stay mutually exclusive exactly as before: they all
// drive the one `baseOverlay` value owned by ExploreMap.

import { useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { ChevronDown, X as XIcon, Check as CheckIcon } from 'lucide-react'
import { CDL_LEGEND_ROWS } from './mapOverlays'
import {
  NATIONAL_LAYERS, NATIONAL_OVERLAY_KEYS, HEL_ENABLED, isLayerAvailable, applyNationalOpacity,
  type NationalAvailability, type NationalLayerKey, type NationalOverlayKey, type LegendRow,
} from './nationalLayers'

const PINK = '#F58CDE'

// 'slope' / 'hel' (national layers, owner 11/10) are soil-polygon fills, so
// they join the one-at-a-time base overlays instead of stacking on Soil Types.
export type BaseOverlayValue = 'crops' | 'csb' | 'ssurgo' | 'nccpi' | 'fsa' | 'engine' | 'precip' | 'slope' | 'hel' | null
export type OpacityLayerKey = 'ssurgo' | 'nccpi' | 'crops' | 'engine' | 'fsa' | 'precip' | NationalLayerKey
const NATIONAL_KEYS = Object.keys(NATIONAL_LAYERS) as NationalLayerKey[]
const isNationalKey = (k: string): k is NationalLayerKey => k in NATIONAL_LAYERS

// ── Opacity: default = the paint value each layer has always used ──────
export const OVERLAY_DEFAULT_OPACITY: Record<OpacityLayerKey, number> = {
  ssurgo: 0.60, // soils-full-fill-{ST} (zoom ramp 6→0, 7→0.60)
  nccpi: 0.65,  // explore-nccpi-fill-{ST} (zoom ramp 6→0, 7→0.65)
  crops: 0.65,  // csb-fields-fill
  engine: 0.55, // explore-engine-fill-{ST} (per-class, max 0.55)
  fsa: 0.90,    // explore-fsa-line-{ST} (line-opacity)
  precip: 0.72, // precip-tiles (raster-opacity)
  // National layers (nationalLayers.ts defaultOpacity).
  ...(Object.fromEntries(NATIONAL_KEYS.map(k => [k, NATIONAL_LAYERS[k].defaultOpacity])) as Record<NationalLayerKey, number>),
}
export const OPACITY_MIN = 0.2
export const OPACITY_MAX = 1
const OPACITY_STORAGE_PREFIX = 'gg_layer_opacity_'

const clampOpacity = (v: number) => Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, v))

export function loadOverlayOpacity(): Record<OpacityLayerKey, number> {
  const out = { ...OVERLAY_DEFAULT_OPACITY }
  for (const k of Object.keys(out) as OpacityLayerKey[]) {
    try {
      const raw = localStorage.getItem(OPACITY_STORAGE_PREFIX + k)
      if (raw !== null) {
        const n = Number(raw)
        if (Number.isFinite(n)) out[k] = clampOpacity(n)
      }
    } catch { /* private mode / SSR */ }
  }
  return out
}

export function saveOverlayOpacity(key: OpacityLayerKey, value: number) {
  try { localStorage.setItem(OPACITY_STORAGE_PREFIX + key, String(clampOpacity(value))) } catch { /* private mode */ }
}

// Sets the paint opacity for one overlay's MapLibre layers. Only the
// opacity paint property is touched — every other paint/layout value
// (colours, zoom ramps' start, visibility) stays exactly as before.
export function applyOverlayOpacity(
  map: maplibregl.Map,
  key: OpacityLayerKey,
  value: number,
  states: { soil: string[]; fsa: string[]; engine: string[]; national?: NationalAvailability },
) {
  const v = clampOpacity(value)
  if (isNationalKey(key)) {
    applyNationalOpacity(map, key, states.national?.[key] ?? [], v)
    return
  }
  const set = (id: string, prop: string, val: unknown) => {
    try { if (map.getLayer(id)) map.setPaintProperty(id, prop as any, val as any) } catch { /* layer not ready */ }
  }
  switch (key) {
    case 'ssurgo':
      for (const st of states.soil) set(`soils-full-fill-${st}`, 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 6, 0, 7, v])
      break
    case 'nccpi':
      for (const st of states.soil) set(`explore-nccpi-fill-${st}`, 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 6, 0, 7, v])
      break
    case 'crops':
      set('csb-fields-fill', 'fill-opacity', v)
      break
    case 'engine': {
      // Keep the per-class ratios (tillable 0.40 / pasture 0.45 / rest 0.55).
      const s = v / OVERLAY_DEFAULT_OPACITY.engine
      const expr = ['match', ['get', 'cls'], 'tillable', Math.min(1, 0.4 * s), 'pasture', Math.min(1, 0.45 * s), Math.min(1, 0.55 * s)]
      for (const st of states.engine) set(`explore-engine-fill-${st}`, 'fill-opacity', expr)
      break
    }
    case 'fsa':
      for (const st of states.fsa) set(`explore-fsa-line-${st}`, 'line-opacity', v)
      break
    case 'precip':
      set('precip-tiles', 'raster-opacity', v)
      break
  }
}

// ── Props ──────────────────────────────────────────────────────────────
export type ToggleLayer = {
  available: boolean
  on: boolean
  toggle: () => void
  status?: string | null
}

export type LayersPanelProps = {
  baseOverlay: BaseOverlayValue
  setBaseOverlay: (v: BaseOverlayValue) => void
  engineAvailable: boolean
  precipAvailable: boolean
  precipYears: number[]
  selectedPrecipYear: number | null
  setSelectedPrecipYear: (y: number) => void
  precipAttribution?: string
  cropYears: number[]
  selectedCropYear: number
  setSelectedCropYear: (y: number) => void
  opacity: Record<OpacityLayerKey, number>
  onOpacityChange: (key: OpacityLayerKey, value: number) => void
  savedMaps: ToggleLayer
  elevators: ToggleLayer
  aerialYear: number | null
  onSelectSatellite: () => void
  onOpenAerialYear: () => void
  // National layers (owner 11/10). availability = which state / national
  // files the tile server holds; a layer with none is not shown.
  nationalAvailability: NationalAvailability
  nationalOn: Record<NationalOverlayKey, boolean>
  setNationalOn: (changes: Partial<Record<NationalOverlayKey, boolean>>) => void
}

type LayerId = OpacityLayerKey | 'savedMaps' | 'elevators'

type LayerDef = {
  id: LayerId
  name: string
  desc: string
  preview: string | null // public/layer-previews/<preview>.png
  on: boolean
  toggle: () => void
  setOff: () => void
}

const DESCRIPTIONS: Record<LayerId, string> = {
  ssurgo: 'Soil map units and productivity',
  nccpi: 'Crop productivity index, 0 to 100',
  crops: 'What was planted each year, 2018-2025',
  engine: 'Tillable ground the mapping engine drew',
  fsa: 'FSA field boundaries (2008)',
  precip: 'Rainfall by year, inches',
  savedMaps: 'Your saved tracts and projects',
  elevators: 'Cash bids at nearby elevators',
  ...(Object.fromEntries(NATIONAL_KEYS.map(k => [k, NATIONAL_LAYERS[k].desc])) as Record<NationalLayerKey, string>),
}

// Preview image key per layer (public/layer-previews/<key>.png and
// <key>-base.png). Tillable Map has no preview (it never renders today).
const PREVIEWS: Record<LayerId, string | null> = {
  ssurgo: 'soil-types',
  nccpi: 'nccpi',
  crops: 'crops-by-year',
  engine: null,
  fsa: 'fsa',
  precip: 'precipitation',
  savedMaps: 'saved-maps',
  elevators: 'grain-elevators',
  ...(Object.fromEntries(NATIONAL_KEYS.map(k => [k, NATIONAL_LAYERS[k].preview])) as Record<NationalLayerKey, string>),
}

const PRECIP_GRADIENT = 'linear-gradient(to right,#f7f4ec,#e6e0b4,#cfe2a0,#9fd3a3,#5fbfb0,#2f9fc6,#1f6fb5,#14468f,#0b2560)'

// Tile CSS — @keyframes only, no JS timers. The ON tile's top image
// breathes over its base image; the border glow pulses in sync.
const TILE_CSS = `
.gg-lt-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px 8px; }
.gg-lt { background: none; border: none; padding: 0; cursor: pointer; display: flex; flex-direction: column; align-items: stretch; gap: 5px; min-width: 0; }
.gg-lt-pic { position: relative; aspect-ratio: 3 / 2; border-radius: 10px; overflow: hidden; border: 1px solid rgba(255,255,255,0.18); background: #1a1a1a; transition: border-color 0.15s; }
.gg-lt-pic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.gg-lt-on .gg-lt-pic { border: 2.5px solid ${PINK}; animation: gg-lt-glow 2.5s ease-in-out infinite; }
.gg-lt-on .gg-lt-top { animation: gg-lt-breathe 2.5s ease-in-out infinite; }
.gg-lt-check { position: absolute; top: 4px; right: 4px; width: 16px; height: 16px; border-radius: 50%; background: ${PINK}; color: #000; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0,0,0,0.5); }
.gg-lt-label { color: rgba(255,255,255,0.8); font-size: 11px; line-height: 1.25; text-align: center; overflow: hidden; text-overflow: ellipsis; }
.gg-lt-on .gg-lt-label { color: ${PINK}; font-weight: 600; }
.gg-lt:focus-visible { outline: none; }
.gg-lt:focus-visible .gg-lt-pic { outline: 2px solid #fff; outline-offset: 2px; }
@keyframes gg-lt-breathe { 0%, 100% { opacity: 0.82; transform: scale(1); } 50% { opacity: 1; transform: scale(1.04); } }
@keyframes gg-lt-glow { 0%, 100% { box-shadow: 0 0 4px 1px rgba(245,140,222,0.3); } 50% { box-shadow: 0 0 8px 2px rgba(245,140,222,0.5); } }
@media (prefers-reduced-motion: reduce) {
  .gg-lt-on .gg-lt-pic, .gg-lt-on .gg-lt-top { animation: none; }
  .gg-lt-on .gg-lt-top { opacity: 1; }
  .gg-lt-on .gg-lt-pic { box-shadow: 0 0 0 2px rgba(245,140,222,0.25); }
}
`

const TRACT_STATUS_ROWS = [
  { label: 'Sold', color: '#f58cde' },
  { label: 'Auction', color: '#2563eb' },
  { label: 'Listed', color: '#eab308' },
  { label: "Today's Auctions", color: '#22c55e' },
  { label: 'No Sale', color: '#9ca3af' },
]

const sectionLabel: React.CSSProperties = {
  color: 'rgba(255,255,255,0.40)', fontSize: 10, fontWeight: 600,
  textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 0 8px',
}

// ── Small pieces ───────────────────────────────────────────────────────
function YearChips({ years, selected, onSelect }: { years: number[]; selected: number | null; onSelect: (y: number) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {years.map(yr => {
        const sel = selected === yr
        return (
          <button
            key={yr}
            onClick={() => onSelect(yr)}
            aria-pressed={sel}
            style={{
              height: 22, padding: '0 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
              background: sel ? PINK : 'rgba(255,255,255,0.05)',
              border: sel ? `1px solid ${PINK}` : '1px solid rgba(255,255,255,0.15)',
              color: sel ? '#000' : 'rgba(255,255,255,0.60)',
              transition: 'background 0.12s, border-color 0.12s, color 0.12s',
            }}
          >
            {yr}
          </button>
        )
      })}
    </div>
  )
}

function OpacitySlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10, flexShrink: 0, width: 44 }}>Opacity</span>
      <input
        type="range"
        min={OPACITY_MIN * 100}
        max={OPACITY_MAX * 100}
        step={5}
        value={Math.round(value * 100)}
        onChange={e => onChange(Number(e.target.value) / 100)}
        aria-label={`${label} opacity`}
        style={{ flex: 1, accentColor: PINK, cursor: 'pointer' }}
      />
      <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, flexShrink: 0, width: 32, textAlign: 'right' }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  )
}

// ── Panel ──────────────────────────────────────────────────────────────
export default function LayersPanel(p: LayersPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const cropsOn = p.baseOverlay === 'crops' || p.baseOverlay === 'csb'

  const base = (key: 'ssurgo' | 'nccpi' | 'crops' | 'engine' | 'fsa' | 'precip' | 'slope' | 'hel', name: string): LayerDef => {
    const on = key === 'crops' ? cropsOn : p.baseOverlay === key
    return {
      id: key, name, desc: DESCRIPTIONS[key], preview: PREVIEWS[key], on,
      // Radio-exclusive, same as the old buttons: on → this one, on again → none.
      toggle: () => p.setBaseOverlay(on ? null : key),
      setOff: () => { if (on) p.setBaseOverlay(null) },
    }
  }
  const toggleDef = (id: 'savedMaps' | 'elevators', name: string, t: ToggleLayer): LayerDef => ({
    id, name, desc: DESCRIPTIONS[id], preview: PREVIEWS[id], on: t.on,
    toggle: t.toggle,
    setOff: () => { if (t.on) t.toggle() },
  })

  const avail = (k: NationalLayerKey) => isLayerAvailable(p.nationalAvailability, k)
  // National base overlays (slope / HEL) — only where the tile server has them.
  const nationalBase = (k: 'slope' | 'hel'): LayerDef[] =>
    (k === 'hel' && !HEL_ENABLED) || !avail(k) ? [] : [base(k, NATIONAL_LAYERS[k].name)]
  // Free national overlays: stack with each other and with one base overlay.
  const overlay = (k: NationalOverlayKey): LayerDef[] => {
    if (!avail(k)) return []
    const on = !!p.nationalOn[k]
    return [{
      id: k, name: NATIONAL_LAYERS[k].name, desc: NATIONAL_LAYERS[k].desc, preview: NATIONAL_LAYERS[k].preview, on,
      toggle: () => p.setNationalOn({ [k]: !on }),
      setOff: () => { if (on) p.setNationalOn({ [k]: false }) },
    }]
  }

  const soilCrops: LayerDef[] = [
    base('ssurgo', 'Soil Types'),
    base('nccpi', 'NCCPI'),
    base('crops', 'Crops by Year'),
    // Tillable Map left out of the tile grid: it has no preview image and
    // never renders today (ENGINE_PMTILES_STATES is empty).
    base('fsa', 'FSA'),
    ...nationalBase('slope'),
    ...nationalBase('hel'),
  ]
  const water: LayerDef[] = [
    ...(p.precipAvailable ? [base('precip', 'Annual Precipitation')] : []),
    ...overlay('flood'),
    ...overlay('wetlands'),
  ]
  const land: LayerDef[] = [
    ...(p.savedMaps.available ? [toggleDef('savedMaps', 'My saved maps', p.savedMaps)] : []),
    ...overlay('public'),
    ...overlay('protected'),
    ...overlay('tribal'),
    ...overlay('plss'),
  ]
  const markets: LayerDef[] = [
    ...(p.elevators.available ? [toggleDef('elevators', 'Grain elevators', p.elevators)] : []),
    ...overlay('grazing'),
  ]
  const infrastructure: LayerDef[] = [...overlay('airports'), ...overlay('poi'), ...overlay('light')]

  const groups: Array<{ id: string; name: string; layers: LayerDef[]; note?: string; extra?: React.ReactNode; alwaysShow?: boolean }> = [
    { id: 'soil', name: 'Soil and crops', layers: soilCrops, note: 'One soil, crop or rain layer at a time.' },
    { id: 'water', name: 'Water and flood', layers: water },
    { id: 'land', name: 'Land and boundaries', layers: land },
    // Markets always shows: the Tract Status legend lives here for everyone.
    { id: 'markets', name: 'Markets', layers: markets, alwaysShow: true },
    { id: 'infrastructure', name: 'Infrastructure', layers: infrastructure },
  ]

  const all = groups.flatMap(g => g.layers)
  const onLayers = all.filter(l => l.on)
  const turnAllOff = () => {
    if (p.baseOverlay !== null) p.setBaseOverlay(null)
    for (const l of onLayers) if (l.id === 'savedMaps' || l.id === 'elevators') l.setOff()
    const off: Partial<Record<NationalOverlayKey, boolean>> = {}
    for (const k of NATIONAL_OVERLAY_KEYS) if (p.nationalOn[k]) off[k] = false
    if (Object.keys(off).length) p.setNationalOn(off)
  }
  const legendFor = (l: LayerDef): React.ReactNode => {
    switch (l.id) {
      case 'nccpi':
        return (
          <div>
            <div style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
              {[['#d73027', '0'], ['#fc8d59', '25'], ['#fee08b', '50'], ['#91cf60', '75'], ['#1a9850', '100']].map(([c, lbl]) => (
                <div key={lbl} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: 5, background: c, borderRadius: 2 }} />
                  <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 8 }}>{lbl}</span>
                </div>
              ))}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8, textAlign: 'center' }}>Low → High productivity</div>
          </div>
        )
      case 'fsa':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 12, height: 3, borderRadius: 1, background: '#22d3ee', flexShrink: 0, marginTop: 1 }} />
              <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10 }}>FSA field boundary</span>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>2008 snapshot · Not available in AL, FL, AK</span>
          </div>
        )
      case 'precip':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <YearChips years={p.precipYears} selected={p.selectedPrecipYear} onSelect={p.setSelectedPrecipYear} />
            <div>
              <div style={{ height: 8, borderRadius: 3, background: PRECIP_GRADIENT }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
                {['0', '20', '40', '60', '80+'].map(lbl => (
                  <span key={lbl} style={{ color: 'rgba(255,255,255,0.4)', fontSize: 8 }}>{lbl}</span>
                ))}
              </div>
            </div>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8, textAlign: 'center' }}>
              Annual precipitation, inches · {p.precipAttribution || 'PRISM Group, Oregon State University'}
            </span>
          </div>
        )
      case 'crops':
        return (
          <div>
            <YearChips years={p.cropYears} selected={p.selectedCropYear} onSelect={p.setSelectedCropYear} />
            <div style={{ height: 1, background: 'rgba(255,255,255,0.07)', margin: '8px 0 6px' }} />
            <div style={{ ...sectionLabel, margin: '0 0 4px' }}>Crop Types</div>
            {CDL_LEGEND_ROWS.map(({ code, name, color }) => (
              <div key={code} style={{ display: 'flex', alignItems: 'center', height: 20, gap: 8 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, flexShrink: 0, backgroundColor: color, border: '1px solid rgba(255,255,255,0.20)' }} />
                <span style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10, fontWeight: 500 }}>{name}</span>
              </div>
            ))}
          </div>
        )
      case 'engine':
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px' }}>
            {[['Tillable', '#3caa28'], ['Pasture', '#eb9620'], ['Timber', '#e12d23'], ['Waterway', '#d73cc8'], ['Water', '#3c6edc']].map(([n, c]) => (
              <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: c }} />{n}
              </span>
            ))}
          </div>
        )
      case 'savedMaps':
      case 'elevators':
        return p[l.id].status
          ? <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10 }}>{p[l.id].status}</div>
          : null
      default:
        if (isNationalKey(l.id)) return nationalLegend(l.id)
        return null // Soil Types has no legend today (16-colour categorical).
    }
  }

  const swatch = (r: LegendRow) => {
    const base: React.CSSProperties = { width: 12, height: 12, borderRadius: 3, flexShrink: 0, border: '1px solid rgba(255,255,255,0.20)' }
    switch (r.kind) {
      case 'dot': return <span style={{ ...base, borderRadius: '50%', background: r.color, border: '1.5px solid #fff', width: 10, height: 10 }} />
      case 'line': return <span style={{ width: 14, height: 3, borderRadius: 1, background: r.color, flexShrink: 0 }} />
      case 'dash': return <span style={{ width: 14, height: 0, borderTop: `3px dashed ${r.color}`, flexShrink: 0 }} />
      case 'hatch': return <span style={{ ...base, background: `repeating-linear-gradient(135deg, ${r.color} 0 3px, #fff 3px 4.5px)` }} />
      default: return <span style={{ ...base, background: r.color }} />
    }
  }
  const nationalLegend = (k: NationalLayerKey): React.ReactNode => {
    const def = NATIONAL_LAYERS[k]
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {def.gradient && (
          <div>
            <div style={{ height: 8, borderRadius: 3, background: def.gradient }} />
          </div>
        )}
        {def.legend.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {def.legend.map(r => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', minHeight: 18, gap: 8 }}>
                {swatch(r)}
                <span style={{ color: 'rgba(255,255,255,0.72)', fontSize: 10, fontWeight: 500 }}>{r.label}</span>
              </div>
            ))}
          </div>
        )}
        {def.legendNote && <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9 }}>{def.legendNote}</span>}
        <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8 }}>{def.attribution}</span>
      </div>
    )
  }

  // Picture tile. OFF: <key>.png static, thin gray border. ON: <key>-base.png
  // under <key>.png (breathing), pink border + glow + check badge.
  const pictureTile = (opts: { key: string; label: string; title?: string; preview: string; on: boolean; onClick: () => void; overlay?: React.ReactNode }) => (
    <button
      key={opts.key}
      type="button"
      className={`gg-lt${opts.on ? ' gg-lt-on' : ''}`}
      onClick={opts.onClick}
      aria-pressed={opts.on}
      aria-label={opts.label}
      title={opts.title}
    >
      <div className="gg-lt-pic">
        {opts.on && <img src={`/layer-previews/${opts.preview}-base.png`} alt="" draggable={false} />}
        <img className="gg-lt-top" src={`/layer-previews/${opts.preview}.png`} alt="" draggable={false} />
        {opts.overlay}
        {opts.on && (
          <span className="gg-lt-check" aria-hidden="true"><CheckIcon size={11} strokeWidth={3} /></span>
        )}
      </div>
      <span className="gg-lt-label">{opts.label}</span>
    </button>
  )

  const layerTile = (l: LayerDef) => l.preview
    ? pictureTile({ key: l.id, label: l.name, title: l.desc, preview: l.preview, on: l.on, onClick: l.toggle })
    : null

  // Compact settings strip for an ON layer: name + legend/year chips + Opacity.
  const settingsStrip = (l: LayerDef) => {
    const opacityKey = (l.id === 'savedMaps' || l.id === 'elevators') ? null : l.id
    const legend = legendFor(l)
    return (
      <div
        key={l.id}
        style={{
          borderRadius: 8, padding: '8px 10px',
          border: '1px solid rgba(245,140,222,0.35)', background: 'rgba(245,140,222,0.06)',
        }}
      >
        <div style={{ color: '#fff', fontSize: 12, fontWeight: 600, marginBottom: legend || opacityKey ? 6 : 0 }}>{l.name}</div>
        {legend}
        {opacityKey && (
          <OpacitySlider
            label={l.name}
            value={p.opacity[opacityKey]}
            onChange={v => p.onOpacityChange(opacityKey, v)}
          />
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <style>{TILE_CSS}</style>
      {/* 1. Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>Map layers</span>
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, whiteSpace: 'nowrap' }}>
          {onLayers.length} on ·{' '}
          <button
            onClick={turnAllOff}
            disabled={onLayers.length === 0}
            style={{
              background: 'none', border: 'none', padding: 0, fontSize: 12, fontWeight: 600,
              color: onLayers.length ? PINK : 'rgba(255,255,255,0.30)',
              cursor: onLayers.length ? 'pointer' : 'default',
            }}
          >
            Turn all off
          </button>
        </span>
      </div>

      {/* 2. ON NOW chips */}
      {onLayers.length > 0 && (
        <div>
          <div style={sectionLabel}>On now</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {onLayers.map(l => (
              <span
                key={l.id}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 4px 0 10px',
                  borderRadius: 13, background: 'rgba(245,140,222,0.14)', border: `1px solid ${PINK}`,
                  color: '#fff', fontSize: 11, fontWeight: 500,
                }}
              >
                {l.name}
                <button
                  onClick={l.setOff}
                  aria-label={`Turn off ${l.name}`}
                  style={{ width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.10)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                >
                  <XIcon size={11} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 3. Basemaps */}
      <div>
        <div style={sectionLabel}>Basemap</div>
        <div className="gg-lt-grid">
          {pictureTile({
            key: 'basemap-satellite',
            label: 'Satellite',
            preview: 'basemap-satellite',
            on: p.aerialYear === null,
            onClick: p.onSelectSatellite,
          })}
          {pictureTile({
            key: 'basemap-aerial-year',
            label: p.aerialYear !== null ? `Aerial ${p.aerialYear}` : 'Aerial year',
            preview: 'basemap-aerial-year',
            on: p.aerialYear !== null,
            onClick: p.onOpenAerialYear,
            overlay: p.aerialYear !== null
              ? <span style={{ position: 'absolute', left: 6, bottom: 4, color: '#fff', fontSize: 14, fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,0.8)' }}>{p.aerialYear}</span>
              : null,
          })}
        </div>
      </div>

      {/* 4. Groups */}
      {groups.filter(g => g.layers.length > 0 || g.alwaysShow).map(g => {
        const isCollapsed = !!collapsed[g.id]
        const onCount = g.layers.filter(l => l.on).length
        return (
          <div key={g.id} style={{ borderTop: '1px solid #222', paddingTop: 12 }}>
            <button
              onClick={() => setCollapsed(c => ({ ...c, [g.id]: !c[g.id] }))}
              aria-expanded={!isCollapsed}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <span style={{ flex: 1, textAlign: 'left', color: '#fff', fontSize: 13, fontWeight: 700 }}>{g.name}</span>
              {g.layers.length > 0 && (
                <span style={{ color: onCount ? PINK : 'rgba(255,255,255,0.45)', fontSize: 11 }}>
                  {onCount} of {g.layers.length} on
                </span>
              )}
              <ChevronDown
                size={16}
                color="rgba(255,255,255,0.6)"
                style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}
              />
            </button>
            {!isCollapsed && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {g.note && <div style={{ color: 'rgba(255,255,255,0.40)', fontSize: 11, marginBottom: 2 }}>{g.note}</div>}
                {g.layers.some(l => l.preview) && (
                  <div className="gg-lt-grid">{g.layers.map(layerTile)}</div>
                )}
                {g.layers.filter(l => l.on).map(settingsStrip)}
                {g.id === 'markets' && (
                  <div style={{ marginTop: g.layers.length ? 6 : 0 }}>
                    <div style={sectionLabel}>Tract Status</div>
                    {TRACT_STATUS_ROWS.map(({ label, color }) => (
                      <div key={label} style={{ display: 'flex', alignItems: 'center', height: 30, gap: 8 }}>
                        <span style={{ width: 14, height: 14, borderRadius: '50%', backgroundColor: color, flexShrink: 0, border: '1.5px solid rgba(255,255,255,0.5)' }} />
                        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11 }}>{label}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
