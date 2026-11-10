'use client'

// ── Map layers panel v2 (owner approved 11/10) ─────────────────────────
// Spec: ground-goat-backend/docs/layers-panel-v2-spec.md.
// Top to bottom: header ("N on · Turn all off"), ON NOW chips, basemap
// tiles, presets, then collapsible groups of layer cards. A card that is
// on expands in place to its legend/controls + an Opacity slider.
// Holds TODAY's layers only — no new map data, no search bar. The base
// overlays (Soil Types, NCCPI, Crops by Year, Tillable Map, FSA, Annual
// Precipitation) stay mutually exclusive exactly as before: they all
// drive the one `baseOverlay` value owned by ExploreMap.

import { useState } from 'react'
import type maplibregl from 'maplibre-gl'
import { ChevronDown, X as XIcon, Calendar as CalendarIcon } from 'lucide-react'
import { CDL_LEGEND_ROWS } from './mapOverlays'

const PINK = '#F58CDE'

export type BaseOverlayValue = 'crops' | 'csb' | 'ssurgo' | 'nccpi' | 'fsa' | 'engine' | 'precip' | null
export type OpacityLayerKey = 'ssurgo' | 'nccpi' | 'crops' | 'engine' | 'fsa' | 'precip'

// ── Opacity: default = the paint value each layer has always used ──────
export const OVERLAY_DEFAULT_OPACITY: Record<OpacityLayerKey, number> = {
  ssurgo: 0.60, // soils-full-fill-{ST} (zoom ramp 6→0, 7→0.60)
  nccpi: 0.65,  // explore-nccpi-fill-{ST} (zoom ramp 6→0, 7→0.65)
  crops: 0.65,  // csb-fields-fill
  engine: 0.55, // explore-engine-fill-{ST} (per-class, max 0.55)
  fsa: 0.90,    // explore-fsa-line-{ST} (line-opacity)
  precip: 0.72, // precip-tiles (raster-opacity)
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
  states: { soil: string[]; fsa: string[]; engine: string[] },
) {
  const v = clampOpacity(value)
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
}

type LayerId = OpacityLayerKey | 'savedMaps' | 'elevators'

type LayerDef = {
  id: LayerId
  name: string
  desc: string
  swatch: string
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
}

const SWATCHES: Record<LayerId, string> = {
  ssurgo: 'linear-gradient(to right,#c94040,#c4b030,#29a068,#2878c8,#b03890)',
  crops: 'linear-gradient(to right,#FFD400,#267000,#A87000,#FFA8E3)',
  nccpi: 'linear-gradient(to right,#d73027,#fee08b,#1a9850)',
  fsa: '#22d3ee',
  engine: 'linear-gradient(to right,#3caa28,#eb9620,#e12d23,#d73cc8,#3c6edc)',
  precip: 'linear-gradient(to right,#f7f4ec,#e6e0b4,#cfe2a0,#9fd3a3,#5fbfb0,#2f9fc6,#1f6fb5,#14468f,#0b2560)',
  savedMaps: '#2563eb',
  elevators: '#FFD21F',
}

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
function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={e => { e.stopPropagation(); onToggle() }}
      style={{
        width: 32, height: 18, borderRadius: 9, flexShrink: 0, border: 'none', padding: 0, cursor: 'pointer',
        background: on ? PINK : 'rgba(255,255,255,0.18)', position: 'relative', transition: 'background 0.15s',
      }}
    >
      <span style={{
        position: 'absolute', top: 2, left: on ? 16 : 2, width: 14, height: 14,
        borderRadius: '50%', background: '#fff', transition: 'left 0.15s',
      }} />
    </button>
  )
}

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

  const base = (key: OpacityLayerKey, name: string): LayerDef => {
    const on = key === 'crops' ? cropsOn : p.baseOverlay === key
    return {
      id: key, name, desc: DESCRIPTIONS[key], swatch: SWATCHES[key], on,
      // Radio-exclusive, same as the old buttons: on → this one, on again → none.
      toggle: () => p.setBaseOverlay(on ? null : key),
      setOff: () => { if (on) p.setBaseOverlay(null) },
    }
  }
  const toggleDef = (id: 'savedMaps' | 'elevators', name: string, t: ToggleLayer): LayerDef => ({
    id, name, desc: DESCRIPTIONS[id], swatch: SWATCHES[id], on: t.on,
    toggle: t.toggle,
    setOff: () => { if (t.on) t.toggle() },
  })

  const soilCrops: LayerDef[] = [
    base('ssurgo', 'Soil Types'),
    base('nccpi', 'NCCPI'),
    base('crops', 'Crops by Year'),
    ...(p.engineAvailable ? [base('engine', 'Tillable Map')] : []),
    base('fsa', 'FSA'),
  ]
  const water: LayerDef[] = p.precipAvailable ? [base('precip', 'Annual Precipitation')] : []
  const land: LayerDef[] = p.savedMaps.available ? [toggleDef('savedMaps', 'My saved maps', p.savedMaps)] : []
  const markets: LayerDef[] = p.elevators.available ? [toggleDef('elevators', 'Grain elevators', p.elevators)] : []

  const groups: Array<{ id: string; name: string; layers: LayerDef[]; note?: string; extra?: React.ReactNode; alwaysShow?: boolean }> = [
    { id: 'soil', name: 'Soil and crops', layers: soilCrops, note: 'One soil, crop or rain layer at a time.' },
    { id: 'water', name: 'Water and flood', layers: water },
    { id: 'land', name: 'Land and boundaries', layers: land },
    // Markets always shows: the Tract Status legend lives here for everyone.
    { id: 'markets', name: 'Markets', layers: markets, alwaysShow: true },
  ]

  const all = groups.flatMap(g => g.layers)
  const onLayers = all.filter(l => l.on)
  const turnAllOff = () => {
    if (p.baseOverlay !== null) p.setBaseOverlay(null)
    for (const l of onLayers) if (l.id === 'savedMaps' || l.id === 'elevators') l.setOff()
  }

  // Presets — only those whose layers exist for this user.
  const presets: Array<{ id: string; label: string; active: boolean; apply: () => void }> = [
    {
      id: 'due-diligence', label: 'Due diligence',
      active: p.baseOverlay === 'ssurgo',
      apply: () => { if (p.baseOverlay !== 'ssurgo') p.setBaseOverlay('ssurgo') },
    },
    ...(p.elevators.available ? [{
      id: 'grain-market', label: 'Grain market',
      active: p.elevators.on,
      apply: () => { if (!p.elevators.on) p.elevators.toggle() },
    }] : []),
  ]

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
              <div style={{ height: 8, borderRadius: 3, background: SWATCHES.precip }} />
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
        return null // Soil Types has no legend today (16-colour categorical).
    }
  }

  const card = (l: LayerDef) => {
    const opacityKey = (l.id === 'savedMaps' || l.id === 'elevators') ? null : l.id
    const legend = l.on ? legendFor(l) : null
    return (
      <div
        key={l.id}
        style={{
          borderRadius: 10,
          border: `1px solid ${l.on ? 'rgba(245,140,222,0.55)' : 'rgba(255,255,255,0.12)'}`,
          background: l.on ? 'rgba(245,140,222,0.07)' : 'rgba(255,255,255,0.04)',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        <div
          onClick={l.toggle}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}
        >
          <span style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, background: l.swatch, border: '1px solid rgba(255,255,255,0.2)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#fff', fontSize: 13, fontWeight: 600 }}>{l.name}</div>
            <div style={{ color: 'rgba(255,255,255,0.50)', fontSize: 11, marginTop: 1 }}>{l.desc}</div>
          </div>
          <Switch on={l.on} label={l.name} onToggle={l.toggle} />
        </div>
        {l.on && (legend || opacityKey) && (
          <div style={{ padding: '0 12px 12px' }}>
            {legend}
            {opacityKey && (
              <OpacitySlider
                label={l.name}
                value={p.opacity[opacityKey]}
                onChange={v => p.onOpacityChange(opacityKey, v)}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  const tile = (opts: { label: string; selected: boolean; onClick: () => void; preview: React.ReactNode; bg: string }) => (
    <button
      onClick={opts.onClick}
      aria-pressed={opts.selected}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 92 }}
    >
      <div style={{
        width: 92, height: 60, borderRadius: 10, background: opts.bg,
        border: `2px solid ${opts.selected ? PINK : 'rgba(255,255,255,0.15)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
        boxShadow: opts.selected ? '0 0 0 2px rgba(245,140,222,0.25)' : 'none',
      }}>
        {opts.preview}
      </div>
      <span style={{ color: opts.selected ? PINK : 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: opts.selected ? 600 : 400 }}>{opts.label}</span>
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
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
        <div style={{ display: 'flex', gap: 12 }}>
          {tile({
            label: 'Satellite',
            selected: p.aerialYear === null,
            onClick: p.onSelectSatellite,
            bg: 'linear-gradient(135deg,#3f5a2a 0%,#6b7c3a 35%,#8a7a4c 60%,#4a6232 100%)',
            preview: null,
          })}
          {tile({
            label: p.aerialYear !== null ? `Aerial ${p.aerialYear}` : 'Aerial year',
            selected: p.aerialYear !== null,
            onClick: p.onOpenAerialYear,
            bg: 'linear-gradient(135deg,#5a4a32 0%,#7c6a48 45%,#a08c62 100%)',
            preview: p.aerialYear !== null
              ? <span style={{ fontSize: 15, fontWeight: 700, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>{p.aerialYear}</span>
              : <CalendarIcon size={18} />,
          })}
        </div>
      </div>

      {/* 4. Presets */}
      {presets.length > 0 && (
        <div>
          <div style={sectionLabel}>Presets</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {presets.map(pr => (
              <button
                key={pr.id}
                onClick={pr.apply}
                aria-pressed={pr.active}
                style={{
                  height: 28, padding: '0 12px', borderRadius: 14, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  background: pr.active ? PINK : 'rgba(255,255,255,0.08)',
                  border: `1px solid ${pr.active ? PINK : 'rgba(255,255,255,0.22)'}`,
                  color: pr.active ? '#000' : 'rgba(255,255,255,0.85)',
                }}
              >
                {pr.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 5. Groups */}
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
                {g.layers.map(card)}
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
