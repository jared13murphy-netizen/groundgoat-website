/**
 * National map layers (owner 11/10): flood, wetlands, slope, HEL, public
 * land, protected areas, tribal land, PLSS, grazing allotments, airports,
 * points of interest and light pollution, drawn from PMTiles archives on
 * tiles.groundgoat.com.
 *
 * File contract (national-layers/SPEC.md):
 *   per state  <ST>_flood | _wetlands | _slope | _hel | _public | _protected
 *              | _plss | _poi .pmtiles  (PLSS only exists for PLSS states)
 *   national   tribal | airports | light_pollution | grazing .pmtiles
 * Which files exist is read from the tile server's own file listing (GET /,
 * `available`), so a state shows up the moment its builder uploads it and a
 * missing state is never requested (MapLibre fetches a pmtiles header the
 * moment a source is added — a missing file is a console 404).
 *
 * Sources + layers are added lazily, the first time a layer is turned on,
 * and then only shown / hidden. Slope and HEL are soil-polygon fills, so
 * they join the one-at-a-time base overlays (baseOverlay 'slope' / 'hel');
 * every other layer here is a free overlay that stacks.
 */
import type maplibregl from 'maplibre-gl'

const TILES_BASE_URL = process.env.NEXT_PUBLIC_TILES_URL || 'https://tiles.groundgoat.com'

// HEL is computed from RUSLE with an approximate R factor and no wind factor
// (layer-pilot-il). It stays out of the panel until it is checked against the
// NRCS county HEL map-unit lists. Flip to true to show it.
export const HEL_ENABLED = false

export type NationalLayerKey =
  | 'flood' | 'wetlands' | 'slope' | 'hel'
  | 'public' | 'protected' | 'tribal' | 'plss'
  | 'grazing' | 'airports' | 'poi' | 'light'

/** Free overlays (stack with each other and with one base overlay). */
export type NationalOverlayKey = Exclude<NationalLayerKey, 'slope' | 'hel'>
export const NATIONAL_OVERLAY_KEYS: NationalOverlayKey[] = [
  'flood', 'wetlands', 'public', 'protected', 'tribal', 'plss', 'grazing', 'airports', 'poi', 'light',
]

export type LegendRow = { label: string; color: string; kind?: 'fill' | 'line' | 'dot' | 'hatch' | 'dash' }

export type NationalLayerDef = {
  key: NationalLayerKey
  name: string
  desc: string
  preview: string            // public/layer-previews/<preview>.png
  /** Per-state file suffix (<ST>_<file>.pmtiles) or national file name. */
  file: string
  perState: boolean
  minzoom: number            // below this the layer draws nothing → zoom toast
  defaultOpacity: number
  attribution: string
  legend: LegendRow[]
  legendNote?: string
  gradient?: string
}

const FLOOD_SFHA = '#2563eb'
const FLOOD_FLOODWAY = '#1e3a8a'
const FLOOD_MODERATE = '#93c5fd'

export const WETLAND_COLORS: Array<[string, string]> = [
  ['Freshwater Emergent Wetland', '#7fc31c'],
  ['Freshwater Forested/Shrub Wetland', '#008837'],
  ['Freshwater Pond', '#688cc0'],
  ['Lake', '#13007c'],
  ['Riverine', '#0190bf'],
  ['Estuarine and Marine Wetland', '#66c2a5'],
  ['Estuarine and Marine Deepwater', '#007c88'],
  ['Other', '#b28653'],
]
export const SLOPE_COLORS: Array<[string, string]> = [
  ['0-2%', '#1a9850'],
  ['2-5%', '#91cf60'],
  ['5-9%', '#d9ef8b'],
  ['9-15%', '#fee08b'],
  ['15-25%', '#fc8d59'],
  ['25%+', '#d73027'],
]
export const HEL_COLORS: Array<[string, string]> = [
  ['Highly erodible', '#d73027'],
  ['Potentially highly erodible', '#fdae61'],
]
// Public land by manager. mgr codes from PAD-US (Mang_Name); state / local by mgr_type.
export const PUBLIC_COLORS = {
  BLM: '#facc15',
  USFS: '#22c55e',
  NPS: '#a855f7',
  FWS: '#06b6d4',
  federal: '#f97316',
  state: '#3b82f6',
  other: '#9ca3af',
}
const PROTECTED_FILL = '#064e3b'
const PROTECTED_LINE = '#10b981'
const TRIBAL_COLOR = '#e11d48'
const PLSS_TOWNSHIP = '#fbbf24'
const PLSS_SECTION = '#fde68a'
const GRAZING_COLOR = '#a3e635'
export const AIRPORT_COLORS: Array<[string, string]> = [
  ['Public airport', '#ef4444'],
  ['Private airport', '#f97316'],
  ['Heliport', '#a855f7'],
  ['Seaplane base', '#0ea5e9'],
  ['Other airfield', '#9ca3af'],
]
export const POI_COLORS: Array<[string, string, string]> = [
  // [cat, label, colour]
  ['grain_elevator', 'Grain elevator', '#facc15'],
  ['silo', 'Silo', '#eab308'],
  ['farm_supply', 'Farm supply', '#65a30d'],
  ['hardware', 'Hardware', '#d97706'],
  ['fuel', 'Fuel', '#10b981'],
  ['veterinary', 'Veterinary', '#14b8a6'],
  ['school', 'School', '#f59e0b'],
  ['church', 'Church', '#a78bfa'],
  ['cemetery', 'Cemetery', '#6b7280'],
  ['hospital', 'Hospital', '#ef4444'],
  ['clinic', 'Clinic', '#f87171'],
  ['fire', 'Fire station', '#dc2626'],
  ['police', 'Police', '#3b82f6'],
  ['post_office', 'Post office', '#1d4ed8'],
]
// Same stops build_lights.py bakes into the WebP tiles (log radiance ramp).
export const LIGHT_GRADIENT = 'linear-gradient(to right,rgb(5,12,60),rgb(10,35,130),rgb(20,85,200),rgb(50,170,210),rgb(250,235,60),rgb(250,150,30),rgb(230,40,30),rgb(255,250,250))'

export const NATIONAL_LAYERS: Record<NationalLayerKey, NationalLayerDef> = {
  flood: {
    key: 'flood', name: 'Flood zones', desc: 'FEMA flood hazard zones',
    preview: 'flood', file: 'flood', perState: true, minzoom: 7, defaultOpacity: 0.5,
    attribution: 'Flood zones: FEMA NFHL',
    legend: [
      { label: '1% annual chance (A, AE, AH, AO, VE)', color: FLOOD_SFHA },
      { label: 'Floodway', color: FLOOD_FLOODWAY, kind: 'hatch' },
      { label: '0.2% annual chance / levee-protected', color: FLOOD_MODERATE },
    ],
    legendNote: 'Minimal-hazard Zone X is not drawn.',
  },
  wetlands: {
    key: 'wetlands', name: 'Wetlands', desc: 'National Wetlands Inventory',
    preview: 'wetlands', file: 'wetlands', perState: true, minzoom: 8, defaultOpacity: 0.55,
    attribution: 'Wetlands: USFWS National Wetlands Inventory',
    legend: WETLAND_COLORS.map(([label, color]) => ({ label, color })),
  },
  slope: {
    key: 'slope', name: 'Slope', desc: 'Soil map unit slope class',
    preview: 'slope', file: 'slope', perState: true, minzoom: 8, defaultOpacity: 0.55,
    attribution: 'Slope: USDA NRCS SSURGO',
    legend: SLOPE_COLORS.map(([label, color]) => ({ label, color })),
  },
  hel: {
    key: 'hel', name: 'Highly erodible land', desc: 'HEL class by soil map unit',
    preview: 'hel', file: 'hel', perState: true, minzoom: 8, defaultOpacity: 0.55,
    attribution: 'HEL: computed from USDA NRCS SSURGO',
    legend: HEL_COLORS.map(([label, color]) => ({ label, color })),
    legendNote: 'Not highly erodible ground is not drawn.',
  },
  public: {
    key: 'public', name: 'Public land', desc: 'Federal, state and local public land',
    preview: 'public-land', file: 'public', perState: true, minzoom: 4, defaultOpacity: 0.4,
    attribution: 'Public land: USGS PAD-US',
    legend: [
      { label: 'BLM', color: PUBLIC_COLORS.BLM },
      { label: 'Forest Service', color: PUBLIC_COLORS.USFS },
      { label: 'National Park Service', color: PUBLIC_COLORS.NPS },
      { label: 'Fish & Wildlife Service', color: PUBLIC_COLORS.FWS },
      { label: 'Other federal', color: PUBLIC_COLORS.federal },
      { label: 'State', color: PUBLIC_COLORS.state },
      { label: 'Local / other', color: PUBLIC_COLORS.other },
    ],
  },
  protected: {
    key: 'protected', name: 'Protected areas', desc: 'Wilderness and protected land (GAP 1-2)',
    preview: 'protected', file: 'protected', perState: true, minzoom: 4, defaultOpacity: 0.5,
    attribution: 'Protected areas: USGS PAD-US',
    legend: [{ label: 'Wilderness / protected (GAP 1-2)', color: PROTECTED_FILL }],
  },
  tribal: {
    key: 'tribal', name: 'Tribal land', desc: 'Reservations and trust land',
    preview: 'tribal', file: 'tribal.pmtiles', perState: false, minzoom: 3, defaultOpacity: 0.3,
    attribution: 'Tribal land: US Census TIGER',
    legend: [
      { label: 'Reservation / tribal area', color: TRIBAL_COLOR },
      { label: 'Off-reservation trust land', color: TRIBAL_COLOR, kind: 'dash' },
    ],
  },
  plss: {
    key: 'plss', name: 'PLSS sections', desc: 'Township, range and section lines',
    preview: 'plss', file: 'plss', perState: true, minzoom: 7, defaultOpacity: 0.9,
    attribution: 'PLSS: BLM CadNSDI',
    legend: [
      { label: 'Township (T5N R6W)', color: PLSS_TOWNSHIP, kind: 'line' },
      { label: 'Section (from zoom 10)', color: PLSS_SECTION, kind: 'line' },
    ],
  },
  grazing: {
    key: 'grazing', name: 'Grazing allotments', desc: 'BLM grazing allotments',
    preview: 'grazing', file: 'grazing.pmtiles', perState: false, minzoom: 5, defaultOpacity: 0.9,
    attribution: 'Grazing allotments: BLM',
    legend: [{ label: 'Grazing allotment', color: GRAZING_COLOR, kind: 'dash' }],
  },
  airports: {
    key: 'airports', name: 'Airports', desc: 'Airports, airstrips and heliports',
    preview: 'airports', file: 'airports.pmtiles', perState: false, minzoom: 6, defaultOpacity: 1,
    attribution: 'Airports: FAA',
    legend: AIRPORT_COLORS.map(([label, color]) => ({ label, color, kind: 'dot' as const })),
    legendNote: 'Public airports from zoom 6; every strip and heliport from zoom 9.',
  },
  poi: {
    key: 'poi', name: 'Points of interest', desc: 'Schools, churches, fuel, farm supply',
    preview: 'poi', file: 'poi', perState: true, minzoom: 9, defaultOpacity: 1,
    attribution: '© OpenStreetMap contributors',
    legend: POI_COLORS.map(([, label, color]) => ({ label, color, kind: 'dot' as const })),
  },
  light: {
    key: 'light', name: 'Light pollution', desc: 'Night sky brightness (VIIRS 2024)',
    preview: 'light-pollution', file: 'light_pollution.pmtiles', perState: false, minzoom: 3, defaultOpacity: 0.65,
    // national-layers/attributions.json (CC BY 4.0 credit)
    attribution: 'Night lights: VIIRS Nighttime Lights V2 2024, Earth Observation Group, Payne Institute for Public Policy (Elvidge et al. 2021), via OpenGeoHub, CC BY 4.0',
    legend: [],
    gradient: LIGHT_GRADIENT,
    legendNote: 'Dark → bright night sky',
  },
}

// ── Availability (which files the tile server holds) ───────────────────
export type NationalAvailability = Record<NationalLayerKey, string[]>  // states; ['*'] = national
export const EMPTY_AVAILABILITY: NationalAvailability = {
  flood: [], wetlands: [], slope: [], hel: [], public: [], protected: [],
  tribal: [], plss: [], grazing: [], airports: [], poi: [], light: [],
}

export function parseAvailability(files: string[]): NationalAvailability {
  const out: NationalAvailability = JSON.parse(JSON.stringify(EMPTY_AVAILABILITY))
  const set = new Set(files)
  for (const def of Object.values(NATIONAL_LAYERS)) {
    if (!def.perState) {
      if (set.has(def.file)) out[def.key] = ['*']
      continue
    }
    const re = new RegExp(`^([A-Z]{2})_${def.file}\\.pmtiles$`)
    for (const f of files) {
      const m = re.exec(f)
      if (m) out[def.key].push(m[1])
    }
    out[def.key].sort()
  }
  return out
}

export async function fetchNationalAvailability(): Promise<NationalAvailability> {
  const res = await fetch(`${TILES_BASE_URL}/`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`tiles listing ${res.status}`)
  const body = await res.json()
  return parseAvailability(Array.isArray(body?.available) ? body.available : [])
}

export function isLayerAvailable(av: NationalAvailability, key: NationalLayerKey): boolean {
  if (key === 'hel' && !HEL_ENABLED) return false
  return (av[key] || []).length > 0
}

// ── Source / layer ids ─────────────────────────────────────────────────
const srcId = (key: NationalLayerKey, st: string) => (st === '*' ? `gg-nl-${key}` : `gg-nl-${key}-${st}`)

/** Every MapLibre layer id this national layer draws, bottom → top. */
export function nationalLayerIds(key: NationalLayerKey, states: string[]): string[] {
  const out: string[] = []
  for (const st of states) {
    const s = srcId(key, st)
    switch (key) {
      case 'flood': out.push(`${s}-fill`, `${s}-hatch`, `${s}-line`); break
      case 'wetlands': case 'slope': case 'hel': case 'public': case 'protected':
        out.push(`${s}-fill`, `${s}-line`); break
      case 'tribal': out.push(`${s}-fill`, `${s}-line`, `${s}-dash`); break
      case 'plss': out.push(`${s}-sec-hit`, `${s}-twp-hit`, `${s}-sec-line`, `${s}-twp-line`, `${s}-sec-label`, `${s}-twp-label`); break
      case 'grazing': out.push(`${s}-fill`, `${s}-line`, `${s}-label`); break
      case 'airports': case 'poi': out.push(`${s}-circle`, `${s}-label`); break
      case 'light': out.push(`${s}-raster`); break
    }
  }
  return out
}

/** Layers a click can hit (for the info popup). */
export function nationalClickLayerIds(key: NationalLayerKey, states: string[]): string[] {
  return nationalLayerIds(key, states).filter(id =>
    id.endsWith('-fill') || id.endsWith('-circle') || id.endsWith('-hit'))
}

// ── Paint helpers ──────────────────────────────────────────────────────
const MODERATE_SUBTYPES = [
  '0.2 PCT ANNUAL CHANCE FLOOD HAZARD',
  '0.2 PCT ANNUAL CHANCE FLOOD HAZARD IN COASTAL ZONE',
  '0.2 PCT ANNUAL CHANCE FLOOD HAZARD CONTAINED IN CHANNEL',
  '0.2 PCT ANNUAL CHANCE FLOOD HAZARD CONTAINED IN STRUCTURE',
  'AREA WITH REDUCED FLOOD RISK DUE TO LEVEE',
  'AREA WITH REDUCED FLOOD HAZARD DUE TO ACCREDITED LEVEE SYSTEM',
  'AREA WITH REDUCED FLOOD HAZARD DUE TO NON-ACCREDITED LEVEE SYSTEM',
  '1 PCT DEPTH LESS THAN 1 FOOT',
  '1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE',
  '1 PCT FUTURE CONDITIONS',
]
const FLOOD_SFHA_FILTER: any = ['==', ['get', 'SFHA_TF'], 'T']
const FLOOD_FLOODWAY_FILTER: any = ['==', ['get', 'ZONE_SUBTY'], 'FLOODWAY']
const FLOOD_DRAWN_FILTER: any = ['any', FLOOD_SFHA_FILTER, ['all', ['==', ['get', 'FLD_ZONE'], 'X'], ['in', ['get', 'ZONE_SUBTY'], ['literal', MODERATE_SUBTYPES]]]]
const floodColor: any = ['case', FLOOD_FLOODWAY_FILTER, FLOOD_FLOODWAY, FLOOD_SFHA_FILTER, FLOOD_SFHA, FLOOD_MODERATE]
const floodOpacity = (v: number): any => ['case', FLOOD_SFHA_FILTER, v, v * 0.75]

const matchColor = (prop: string, pairs: Array<[string, string]>, fallback: string): any =>
  ['match', ['get', prop], ...pairs.flat(), fallback]

const publicColor: any = ['match', ['get', 'mgr'],
  'BLM', PUBLIC_COLORS.BLM, 'USFS', PUBLIC_COLORS.USFS, 'NPS', PUBLIC_COLORS.NPS, 'FWS', PUBLIC_COLORS.FWS,
  ['match', ['get', 'mgr_type'], 'Federal', PUBLIC_COLORS.federal, 'State', PUBLIC_COLORS.state, PUBLIC_COLORS.other]]

const airportClass: any = ['case',
  ['==', ['get', 'type'], 'Heliport'], 'Heliport',
  ['==', ['get', 'type'], 'Seaplane base'], 'Seaplane base',
  ['all', ['==', ['get', 'type'], 'Airport'], ['==', ['get', 'use'], 'Public']], 'Public airport',
  ['==', ['get', 'type'], 'Airport'], 'Private airport',
  'Other airfield']
const airportColor: any = ['match', airportClass, ...AIRPORT_COLORS.flat(), '#9ca3af']

const HATCH_IMAGE = 'gg-nl-hatch'
function ensureHatch(map: maplibregl.Map) {
  if (map.hasImage(HATCH_IMAGE)) return
  const n = 12
  const data = new Uint8Array(n * n * 4)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = (x + y) % n
    if (d === 0 || d === 1) {
      const i = (y * n + x) * 4
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = 230
    }
  }
  try { map.addImage(HATCH_IMAGE, { width: n, height: n, data }) } catch { /* raced */ }
}

const clamp = (v: number) => Math.min(1, Math.max(0.2, v))

/** Add (once) the sources + layers for one national layer; returns its layer ids. */
export function addNationalLayer(
  map: maplibregl.Map,
  key: NationalLayerKey,
  states: string[],
  opacity: number,
  visible: boolean,
  beforeId?: string,
): string[] {
  const def = NATIONAL_LAYERS[key]
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined
  const vis = visible ? 'visible' : 'none'
  const v = clamp(opacity)
  const add = (spec: any) => { if (!map.getLayer(spec.id)) map.addLayer({ ...spec, layout: { ...(spec.layout || {}), visibility: vis } }, before) }
  if (key === 'flood') ensureHatch(map)

  for (const st of states) {
    const s = srcId(key, st)
    const file = def.perState ? `${st}_${def.file}.pmtiles` : def.file
    if (!map.getSource(s)) {
      map.addSource(s, key === 'light'
        ? { type: 'raster', url: `pmtiles://${TILES_BASE_URL}/tiles/${file}`, tileSize: 256, attribution: def.attribution } as any
        : { type: 'vector', url: `pmtiles://${TILES_BASE_URL}/tiles/${file}`, attribution: def.attribution } as any)
    }
    const base = { source: s, minzoom: def.minzoom }
    switch (key) {
      case 'flood':
        add({ ...base, id: `${s}-fill`, type: 'fill', 'source-layer': 'flood', filter: FLOOD_DRAWN_FILTER,
          paint: { 'fill-color': floodColor, 'fill-opacity': floodOpacity(v) } })
        add({ ...base, id: `${s}-hatch`, type: 'fill', 'source-layer': 'flood', filter: FLOOD_FLOODWAY_FILTER,
          paint: { 'fill-pattern': HATCH_IMAGE, 'fill-opacity': v } })
        add({ ...base, id: `${s}-line`, type: 'line', 'source-layer': 'flood', filter: FLOOD_DRAWN_FILTER, minzoom: 11,
          paint: { 'line-color': floodColor, 'line-width': 0.8, 'line-opacity': v } })
        break
      case 'wetlands':
        add({ ...base, id: `${s}-fill`, type: 'fill', 'source-layer': 'wetlands',
          paint: { 'fill-color': matchColor('WETLAND_TYPE', WETLAND_COLORS, '#b28653'), 'fill-opacity': v } })
        add({ ...base, id: `${s}-line`, type: 'line', 'source-layer': 'wetlands', minzoom: 12,
          paint: { 'line-color': matchColor('WETLAND_TYPE', WETLAND_COLORS, '#b28653'), 'line-width': 0.7, 'line-opacity': v } })
        break
      case 'slope':
        add({ ...base, id: `${s}-fill`, type: 'fill', 'source-layer': 'slope', filter: ['!=', ['get', 'slope_class'], 'Not rated'],
          paint: { 'fill-color': matchColor('slope_class', SLOPE_COLORS, '#9ca3af'), 'fill-opacity': v } })
        add({ ...base, id: `${s}-line`, type: 'line', 'source-layer': 'slope', minzoom: 12, filter: ['!=', ['get', 'slope_class'], 'Not rated'],
          paint: { 'line-color': 'rgba(0,0,0,0.18)', 'line-width': 0.5 } })
        break
      case 'hel':
        add({ ...base, id: `${s}-fill`, type: 'fill', 'source-layer': 'hel',
          filter: ['in', ['get', 'hel_class'], ['literal', ['Highly erodible', 'Potentially highly erodible']]],
          paint: { 'fill-color': matchColor('hel_class', HEL_COLORS, '#9ca3af'), 'fill-opacity': v } })
        add({ ...base, id: `${s}-line`, type: 'line', 'source-layer': 'hel', minzoom: 12,
          filter: ['in', ['get', 'hel_class'], ['literal', ['Highly erodible', 'Potentially highly erodible']]],
          paint: { 'line-color': 'rgba(0,0,0,0.2)', 'line-width': 0.5 } })
        break
      case 'public':
        add({ ...base, id: `${s}-fill`, type: 'fill', 'source-layer': 'public',
          paint: { 'fill-color': publicColor, 'fill-opacity': v } })
        add({ ...base, id: `${s}-line`, type: 'line', 'source-layer': 'public',
          paint: { 'line-color': publicColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 1.6], 'line-opacity': Math.min(1, v + 0.4) } })
        break
      case 'protected':
        add({ ...base, id: `${s}-fill`, type: 'fill', 'source-layer': 'protected',
          paint: { 'fill-color': PROTECTED_FILL, 'fill-opacity': v } })
        add({ ...base, id: `${s}-line`, type: 'line', 'source-layer': 'protected',
          paint: { 'line-color': PROTECTED_LINE, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 12, 2], 'line-opacity': Math.min(1, v + 0.4) } })
        break
      case 'tribal':
        add({ ...base, id: `${s}-fill`, type: 'fill', 'source-layer': 'tribal',
          paint: { 'fill-color': TRIBAL_COLOR, 'fill-opacity': v } })
        add({ ...base, id: `${s}-line`, type: 'line', 'source-layer': 'tribal',
          filter: ['!=', ['get', 'type'], 'Off-reservation trust land'],
          paint: { 'line-color': TRIBAL_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 12, 2.2], 'line-opacity': Math.min(1, v + 0.5) } })
        add({ ...base, id: `${s}-dash`, type: 'line', 'source-layer': 'tribal',
          filter: ['==', ['get', 'type'], 'Off-reservation trust land'],
          paint: { 'line-color': TRIBAL_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 12, 2.2], 'line-opacity': Math.min(1, v + 0.5), 'line-dasharray': [2, 1.5] } })
        break
      case 'plss':
        // Invisible fills so a click anywhere inside a section / township
        // answers "T5N R6W, Section 22" (lines alone are too thin to hit).
        add({ ...base, id: `${s}-sec-hit`, type: 'fill', 'source-layer': 'section', minzoom: 10, paint: { 'fill-color': '#000', 'fill-opacity': 0 } })
        add({ ...base, id: `${s}-twp-hit`, type: 'fill', 'source-layer': 'township', paint: { 'fill-color': '#000', 'fill-opacity': 0 } })
        add({ ...base, id: `${s}-sec-line`, type: 'line', 'source-layer': 'section', minzoom: 10,
          paint: { 'line-color': PLSS_SECTION, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1.2], 'line-opacity': v * 0.8 } })
        add({ ...base, id: `${s}-twp-line`, type: 'line', 'source-layer': 'township',
          paint: { 'line-color': PLSS_TOWNSHIP, 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 12, 2.2], 'line-opacity': v } })
        add({ ...base, id: `${s}-sec-label`, type: 'symbol', 'source-layer': 'section', minzoom: 12.5,
          layout: { 'text-field': ['get', 'sec'], 'text-font': ['Open Sans Bold'], 'text-size': 12, 'text-allow-overlap': false, 'text-padding': 4 },
          paint: { 'text-color': PLSS_SECTION, 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.4, 'text-opacity': v } })
        add({ ...base, id: `${s}-twp-label`, type: 'symbol', 'source-layer': 'township', minzoom: 9,
          layout: { 'text-field': ['get', 'label'], 'text-font': ['Open Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 9, 11, 13, 14], 'text-allow-overlap': false, 'text-padding': 8 },
          paint: { 'text-color': PLSS_TOWNSHIP, 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.5, 'text-opacity': v } })
        break
      case 'grazing':
        add({ ...base, id: `${s}-fill`, type: 'fill', 'source-layer': 'grazing',
          paint: { 'fill-color': GRAZING_COLOR, 'fill-opacity': v * 0.12 } })
        add({ ...base, id: `${s}-line`, type: 'line', 'source-layer': 'grazing',
          paint: { 'line-color': GRAZING_COLOR, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 12, 2], 'line-opacity': v, 'line-dasharray': [3, 1.5] } })
        add({ ...base, id: `${s}-label`, type: 'symbol', 'source-layer': 'grazing', minzoom: 10,
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 11, 'text-allow-overlap': false, 'text-padding': 6 },
          paint: { 'text-color': GRAZING_COLOR, 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.4, 'text-opacity': v } })
        break
      case 'airports':
        add({ ...base, id: `${s}-circle`, type: 'circle', 'source-layer': 'airports',
          // Public airports from z6; every strip / heliport from z9.
          filter: ['any', ['>=', ['zoom'], 9], ['all', ['==', ['get', 'type'], 'Airport'], ['==', ['get', 'use'], 'Public']]],
          paint: {
            'circle-color': airportColor,
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, ['case', ['==', ['get', 'use'], 'Public'], 4, 2.5], 12, ['case', ['==', ['get', 'use'], 'Public'], 8, 5.5]],
            'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-opacity': v, 'circle-stroke-opacity': v,
          } })
        add({ ...base, id: `${s}-label`, type: 'symbol', 'source-layer': 'airports', minzoom: 10,
          layout: {
            'text-field': ['concat', ['get', 'name'], ' (', ['get', 'ident'], ')'], 'text-font': ['Open Sans Bold'], 'text-size': 11,
            'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 10, 'text-allow-overlap': false, 'text-optional': true,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.4, 'text-opacity': v } })
        break
      case 'poi':
        add({ ...base, id: `${s}-circle`, type: 'circle', 'source-layer': 'poi',
          paint: {
            'circle-color': ['match', ['get', 'cat'], ...POI_COLORS.flatMap(([c, , col]) => [c, col]), '#9ca3af'],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 14, 6],
            'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.2, 'circle-opacity': v, 'circle-stroke-opacity': v,
          } })
        add({ ...base, id: `${s}-label`, type: 'symbol', 'source-layer': 'poi', minzoom: 13,
          layout: {
            'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 11,
            'text-offset': [0, 0.9], 'text-anchor': 'top', 'text-max-width': 9, 'text-allow-overlap': false, 'text-optional': true,
          },
          paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.4, 'text-opacity': v } })
        break
      case 'light':
        add({ ...base, id: `${s}-raster`, type: 'raster', paint: { 'raster-opacity': v, 'raster-resampling': 'linear' } })
        break
    }
  }
  return nationalLayerIds(key, states)
}

export function setNationalLayerVisible(map: maplibregl.Map, key: NationalLayerKey, states: string[], visible: boolean) {
  for (const id of nationalLayerIds(key, states)) {
    try { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none') } catch { /* not ready */ }
  }
}

/** Live opacity: only opacity paint properties are touched. */
export function applyNationalOpacity(map: maplibregl.Map, key: NationalLayerKey, states: string[], opacity: number) {
  const v = clamp(opacity)
  const set = (id: string, prop: string, val: unknown) => {
    try { if (map.getLayer(id)) map.setPaintProperty(id, prop as any, val as any) } catch { /* not ready */ }
  }
  for (const st of states) {
    const s = srcId(key, st)
    switch (key) {
      case 'flood':
        set(`${s}-fill`, 'fill-opacity', floodOpacity(v)); set(`${s}-hatch`, 'fill-opacity', v); set(`${s}-line`, 'line-opacity', v); break
      case 'wetlands':
        set(`${s}-fill`, 'fill-opacity', v); set(`${s}-line`, 'line-opacity', v); break
      case 'slope': case 'hel':
        set(`${s}-fill`, 'fill-opacity', v); break
      case 'public': case 'protected':
        set(`${s}-fill`, 'fill-opacity', v); set(`${s}-line`, 'line-opacity', Math.min(1, v + 0.4)); break
      case 'tribal':
        set(`${s}-fill`, 'fill-opacity', v); set(`${s}-line`, 'line-opacity', Math.min(1, v + 0.5)); set(`${s}-dash`, 'line-opacity', Math.min(1, v + 0.5)); break
      case 'plss':
        set(`${s}-sec-line`, 'line-opacity', v * 0.8); set(`${s}-twp-line`, 'line-opacity', v)
        set(`${s}-sec-label`, 'text-opacity', v); set(`${s}-twp-label`, 'text-opacity', v); break
      case 'grazing':
        set(`${s}-fill`, 'fill-opacity', v * 0.12); set(`${s}-line`, 'line-opacity', v); set(`${s}-label`, 'text-opacity', v); break
      case 'airports': case 'poi':
        set(`${s}-circle`, 'circle-opacity', v); set(`${s}-circle`, 'circle-stroke-opacity', v); set(`${s}-label`, 'text-opacity', v); break
      case 'light':
        set(`${s}-raster`, 'raster-opacity', v); break
    }
  }
}

// ── Popup ──────────────────────────────────────────────────────────────
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

/** One popup entry per hit feature: heading + detail lines (plain text). */
export function describeNationalFeature(key: NationalLayerKey, p: Record<string, any>, sourceLayer?: string): { heading: string; lines: string[] } | null {
  switch (key) {
    case 'flood': {
      const zone = p.FLD_ZONE || ''
      const sfha = p.SFHA_TF === 'T'
      const sub = p.ZONE_SUBTY ? title(String(p.ZONE_SUBTY)).replace(/Pct/g, '%') : ''
      return {
        heading: `Flood zone ${zone}`,
        lines: [
          sfha ? '1% annual chance flood (Special Flood Hazard Area)' : (/0\.2/.test(p.ZONE_SUBTY || '') ? '0.2% annual chance flood' : 'Outside the Special Flood Hazard Area'),
          ...(sub ? [sub] : []),
        ],
      }
    }
    case 'wetlands':
      return { heading: p.WETLAND_TYPE || 'Wetland', lines: p.ATTRIBUTE ? [`NWI code ${p.ATTRIBUTE}`] : [] }
    case 'slope':
      return { heading: `Slope ${p.slope_class || ''}`.trim(), lines: [] }
    case 'hel':
      return { heading: p.hel_class || 'HEL', lines: ['Computed from soil data; verify with NRCS'] }
    case 'public': case 'protected': {
      const lines = [p.designation, p.manager, p.access ? `Access: ${p.access}` : null, p.acres ? `${Number(p.acres).toLocaleString()} ac` : null]
      if (key === 'protected' && p.gap) lines.push(`GAP status ${p.gap}`)
      return { heading: p.name || (key === 'public' ? 'Public land' : 'Protected area'), lines: lines.filter(Boolean) as string[] }
    }
    case 'tribal':
      return { heading: p.name || 'Tribal land', lines: [p.type, p.recog ? `${p.recog} recognized` : null].filter(Boolean) as string[] }
    case 'plss':
      if (sourceLayer === 'section') {
        const m = /^(T\S+ R\S+)/.exec(p.label || '')
        return { heading: `Section ${p.sec}`, lines: m ? [m[1]] : [] }
      }
      return { heading: p.label || 'Township', lines: p.meridian ? [p.meridian] : [] }
    case 'grazing':
      return {
        heading: p.name ? String(p.name).trim() : 'Grazing allotment',
        lines: [p.allot_no ? `Allotment ${p.allot_no}` : null, p.acres ? `${Number(p.acres).toLocaleString()} ac` : null, p.state ? `BLM ${p.state}` : null].filter(Boolean) as string[],
      }
    case 'airports':
      return {
        heading: `${p.name || 'Airport'}${p.ident ? ` (${p.ident})` : ''}`,
        lines: [[p.type, p.use].filter(Boolean).join(' · '), [p.city, p.state].filter(Boolean).join(', '), p.status && p.status !== 'OPERATIONAL' ? title(p.status) : null].filter(Boolean) as string[],
      }
    case 'poi': {
      const cat = POI_COLORS.find(([c]) => c === p.cat)
      return { heading: p.name || (cat ? cat[1] : 'Place'), lines: [cat ? cat[1] : p.cat].filter(Boolean) }
    }
    default:
      return null
  }
}

export function nationalPopupHtml(entries: Array<{ key: NationalLayerKey; heading: string; lines: string[] }>): string {
  return `<div style="font-size:12px;line-height:1.35;max-width:240px;color:#111">${entries.map((e, i) => `
    <div style="${i ? 'margin-top:8px;padding-top:8px;border-top:1px solid #e5e7eb;' : ''}">
      <div style="color:#6b7280;font-size:10px;text-transform:uppercase;letter-spacing:.5px">${esc(NATIONAL_LAYERS[e.key].name)}</div>
      <div style="font-weight:700">${esc(e.heading)}</div>
      ${e.lines.map(l => `<div style="color:#374151">${esc(l)}</div>`).join('')}
    </div>`).join('')}</div>`
}

/** Key of the national layer a MapLibre layer id belongs to. */
export function keyForLayerId(id: string): NationalLayerKey | null {
  const m = /^gg-nl-([a-z]+)/.exec(id)
  return m && m[1] in NATIONAL_LAYERS ? (m[1] as NationalLayerKey) : null
}

// ── "Map layers here" (owner 11/10): one compact line per ON layer under a
// click, shown at the top of the parcel panel (the popup shows alone only
// where no panel opens). Same wording as the app (utils/nationalLayers.js).
const abbreviateUnit = (s: unknown) => String(s || '').trim()
  .replace(/\bNational Forest\b/g, 'NF')
  .replace(/\bNational Wildlife Refuge\b/g, 'NWR')
  .replace(/\bNational Park\b/g, 'NP')
  .replace(/\bNational Grassland\b/g, 'NG')

export function summarizeNationalFeature(key: NationalLayerKey, p: Record<string, any> = {}): string | null {
  switch (key) {
    case 'flood': {
      const sfha = p.SFHA_TF === 'T'
      const sub = String(p.ZONE_SUBTY || '')
      const chance = sfha ? '1% annual chance' : (/0\.2/.test(sub) ? '0.2% annual chance' : (/LEVEE/.test(sub) ? 'levee-protected' : 'minimal hazard'))
      const tags = [sfha ? 'SFHA' : null, sub === 'FLOODWAY' ? 'Floodway' : null].filter(Boolean)
      return `Flood zone: ${p.FLD_ZONE || '?'} (${chance})${tags.length ? ` · ${tags.join(' · ')}` : ''}`
    }
    case 'wetlands': return `Wetland: ${String(p.WETLAND_TYPE || 'Wetland').replace(/ Wetland$/, '')}`
    case 'slope': return `Slope: ${String(p.slope_class || '').replace('-', '–')}`
    case 'hel': return `HEL: ${p.hel_class || ''}`
    case 'public': return `Public land: ${abbreviateUnit(p.name) || 'Public land'}${p.mgr ? ` (${p.mgr})` : ''}`
    case 'protected': return `Protected: ${abbreviateUnit(p.name) || 'Protected area'}${p.gap ? ` (GAP ${p.gap})` : ''}`
    case 'tribal': return `Tribal land: ${p.name || ''}`
    case 'plss': return `PLSS: ${p.label || (p.sec ? `Sec ${p.sec}` : '')}`
    case 'grazing': return `Grazing allotment: ${String(p.name || '').trim()}${p.allot_no ? ` (#${p.allot_no})` : ''}`
    case 'airports': return `Airport: ${p.name || ''}${p.ident ? ` (${p.ident})` : ''}`
    case 'poi': {
      const cat = POI_COLORS.find(([c]) => c === p.cat)
      return `${cat ? cat[1] : 'Place'}: ${p.name || ''}`
    }
    default: return null
  }
}

/** Rendered features → unique lines in panel order (PLSS section replaces township). */
export function mapLayersHere(features: Array<{ layer: { id: string }; properties?: any; sourceLayer?: string }>): Array<{ key: NationalLayerKey; line: string }> {
  const byKey = new Map<NationalLayerKey, string[]>()
  for (const f of features) {
    const key = keyForLayerId(f.layer.id)
    if (!key) continue
    const line = summarizeNationalFeature(key, f.properties || {})
    if (!line) continue
    const list = byKey.get(key) || []
    if (key === 'plss') {
      if (f.sourceLayer === 'section') { byKey.set(key, [line]); continue }
      if (list.length) continue
    }
    if (!list.includes(line) && list.length < 2) list.push(line)
    byKey.set(key, list)
  }
  const out: Array<{ key: NationalLayerKey; line: string }> = []
  for (const key of Object.keys(NATIONAL_LAYERS) as NationalLayerKey[]) for (const line of byKey.get(key) || []) out.push({ key, line })
  return out
}
