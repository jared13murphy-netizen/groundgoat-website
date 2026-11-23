/**
 * Parcel vector sources — ONE helper every map uses (owner 11/22).
 *
 * `/api/regrid/config` either carries `state_tiles` (pre-built per-state
 * archives, regrid_bulk/STATE_TILES_CONTRACT.md §3) or it does not:
 *
 *   - state_tiles present → one vector source per allowed state, id
 *     `parcels-{st}`, `bounds` = that state's box so MapLibre never asks for a
 *     tile outside it, and the SAME parcel layers per source. Layer ids are
 *     `parcels-{st}-fill` / `-line` / `-label` / `-owner-label` and
 *     `parcel-sale-pin-plus-{st}`.
 *   - absent → the legacy single source `regrid-parcels` with exactly today's
 *     ids (`regrid-parcels-fill` … `parcel-sale-pin-plus`) and settings.
 *
 * Every interaction (hover, selection, feature-state, queryRenderedFeatures,
 * filters, drag-to-report) goes through parcelLayers() / parcelSourceForPath()
 * so it works across all state sources — `path` is unique nationwide, and a
 * parcel lives only in its own state's archive.
 *
 * Pure module (types-only maplibre import) so it runs under `node` tests.
 */
import type maplibregl from 'maplibre-gl'

export const LEGACY_PARCEL_SOURCE_ID = 'regrid-parcels'
export const PARCEL_LABEL_POINT_LAYER_DEFAULT = 'gg_label_points'
export const PARCEL_ATTRIBUTION = 'Parcel data &copy; <a href="https://regrid.com" target="_blank" rel="noopener">Regrid</a>'

export interface StateTileEntry {
  token: string
  bounds?: [number, number, number, number] | number[] | null
}

export interface StateTilesConfig {
  url_template: string
  source_layer?: string
  label_layer?: string
  minzoom?: number
  maxzoom?: number
  /** unix seconds */
  expires_at?: number
  states: Record<string, StateTileEntry>
}

/** The slice of /api/regrid/config this helper reads. */
export interface ParcelSourcesConfig {
  tile_url_template?: string
  source_layer?: string
  state_tiles?: StateTilesConfig | null
}

export type ParcelLayerKind = 'fill' | 'line' | 'label' | 'owner-label' | 'sale'

const LEGACY_LAYER_IDS: Record<ParcelLayerKind, string> = {
  fill: 'regrid-parcels-fill',
  line: 'regrid-parcels-line',
  label: 'regrid-parcels-label',
  'owner-label': 'regrid-parcels-owner-label',
  sale: 'parcel-sale-pin-plus',
}

const LAYER_ID_PATTERNS: Record<ParcelLayerKind, RegExp> = {
  fill: /^(regrid-parcels|parcels-[a-z]{2})-fill$/,
  line: /^(regrid-parcels|parcels-[a-z]{2})-line$/,
  label: /^(regrid-parcels|parcels-[a-z]{2})-label$/,
  'owner-label': /^(regrid-parcels|parcels-[a-z]{2})-owner-label$/,
  sale: /^parcel-sale-pin-plus(-[a-z]{2})?$/,
}

const STATE_SOURCE_RE = /^parcels-[a-z]{2}$/

export interface ParcelSourceSpec {
  /** source id: 'regrid-parcels' (legacy) or 'parcels-{st}' */
  id: string
  /** lowercase 2-letter state, null for the legacy nationwide source */
  st: string | null
  /** polygon MVT layer */
  sourceLayer: string
  /** one-point-per-parcel MVT layer */
  labelLayer: string
  /** ready for map.addSource */
  source: Record<string, any>
}

export interface ParcelSourceOptions {
  /** legacy source minzoom (callers pass today's value) */
  legacyMinzoom?: number
  /** legacy source maxzoom (today 14) */
  legacyMaxzoom?: number
  /** label-point layer name for the legacy source (today gg_label_points) */
  legacyLabelLayer?: string
}

/** true when the config says to use the per-state archives. */
export function usesStateTiles(config: ParcelSourcesConfig | null | undefined): boolean {
  const st = config?.state_tiles
  return !!(st && st.url_template && st.states && Object.keys(st.states).length > 0)
}

/** The tile URL for one state: {st} and {token} filled, {z}/{x}/{y} kept. */
export function stateTileUrl(stateTiles: StateTilesConfig, st: string): string {
  const token = stateTiles.states[st]?.token ?? ''
  return stateTiles.url_template.split('{st}').join(st).split('{token}').join(token)
}

/** config → the sources to add. Empty when the config has no tiles at all. */
export function parcelSourceSpecs(
  config: ParcelSourcesConfig | null | undefined,
  opts: ParcelSourceOptions = {},
): ParcelSourceSpec[] {
  if (!config) return []
  if (usesStateTiles(config)) {
    const stc = config.state_tiles as StateTilesConfig
    const sourceLayer = stc.source_layer || config.source_layer || 'parcels'
    const labelLayer = stc.label_layer || PARCEL_LABEL_POINT_LAYER_DEFAULT
    return Object.keys(stc.states).map((k) => k.toLowerCase()).sort().map((st) => {
      const entry = stc.states[st] ?? stc.states[st.toUpperCase()]
      const b = entry?.bounds
      const source: Record<string, any> = {
        type: 'vector',
        tiles: [stateTileUrl({ ...stc, states: { [st]: entry } }, st)],
        minzoom: stc.minzoom ?? 11,
        maxzoom: stc.maxzoom ?? 15,
        promoteId: { [sourceLayer]: 'path', [labelLayer]: 'path' },
        attribution: PARCEL_ATTRIBUTION,
      }
      if (Array.isArray(b) && b.length === 4 && b.every((n) => typeof n === 'number' && isFinite(n))) {
        source.bounds = b
      }
      return { id: `parcels-${st}`, st, sourceLayer, labelLayer, source }
    })
  }
  if (!config.tile_url_template) return []
  const sourceLayer = config.source_layer || 'parcels'
  const labelLayer = opts.legacyLabelLayer || PARCEL_LABEL_POINT_LAYER_DEFAULT
  return [{
    id: LEGACY_PARCEL_SOURCE_ID,
    st: null,
    sourceLayer,
    labelLayer,
    source: {
      type: 'vector',
      tiles: [config.tile_url_template],
      minzoom: opts.legacyMinzoom ?? 11,
      maxzoom: opts.legacyMaxzoom ?? 14,
      promoteId: { [sourceLayer]: 'path', [labelLayer]: 'path' },
      attribution: PARCEL_ATTRIBUTION,
    },
  }]
}

/** Layer id of one kind for one source. */
export function parcelLayerId(spec: Pick<ParcelSourceSpec, 'st'>, kind: ParcelLayerKind): string {
  if (!spec.st) return LEGACY_LAYER_IDS[kind]
  return kind === 'sale' ? `parcel-sale-pin-plus-${spec.st}` : `parcels-${spec.st}-${kind}`
}

/** Is this a parcel source id (legacy or per-state)? */
export function isParcelSourceId(id: string | null | undefined): boolean {
  return !!id && (id === LEGACY_PARCEL_SOURCE_ID || STATE_SOURCE_RE.test(id))
}

/** Is this one of the parcel layer ids of `kind` (any source)? */
export function isParcelLayerId(id: string, kind: ParcelLayerKind): boolean {
  return LAYER_ID_PATTERNS[kind].test(id)
}

type MapLike = Pick<maplibregl.Map, 'getStyle' | 'getSource' | 'getLayer'>

/** Every parcel layer of `kind` on the map right now, in draw order. */
export function parcelLayers(map: MapLike, kind: ParcelLayerKind): string[] {
  let layers: { id: string }[] = []
  try { layers = (map.getStyle()?.layers as { id: string }[]) || [] } catch { return [] }
  const re = LAYER_ID_PATTERNS[kind]
  return layers.filter((l) => re.test(l.id)).map((l) => l.id)
}

/** Every parcel source id on the map right now. */
export function parcelSourceIds(map: MapLike): string[] {
  let sources: Record<string, unknown> = {}
  try { sources = (map.getStyle()?.sources as Record<string, unknown>) || {} } catch { return [] }
  return Object.keys(sources).filter(isParcelSourceId)
}

/**
 * Replace every legacy parcel layer id in a list with the matching layers of
 * all sources (unknown ids pass through). For call sites that build a layer
 * list such as [...SALE_DOT_LAYERS, 'tract-polygon-fill'].
 */
export function expandParcelLayerIds(map: MapLike, ids: readonly string[]): string[] {
  const out: string[] = []
  for (const id of ids) {
    const kind = (Object.keys(LEGACY_LAYER_IDS) as ParcelLayerKind[]).find((k) => LEGACY_LAYER_IDS[k] === id)
    if (kind) out.push(...parcelLayers(map, kind))
    else out.push(id)
  }
  return Array.from(new Set(out))
}

/** The source that holds the parcel with this `path` (/us/{st}/...). */
export function parcelSourceForPath(map: MapLike, path: string | null | undefined): string | null {
  if (map.getSource(LEGACY_PARCEL_SOURCE_ID)) return LEGACY_PARCEL_SOURCE_ID
  const st = typeof path === 'string' ? path.slice(4, 6).toLowerCase() : ''
  if (/^[a-z]{2}$/.test(st) && map.getSource(`parcels-${st}`)) return `parcels-${st}`
  return null
}

type FeatureStateMap = Pick<maplibregl.Map, 'getStyle' | 'getSource' | 'getLayer' | 'setFeatureState' | 'removeFeatureState'>

/** setFeatureState for a parcel, on whichever source holds it. */
export function setParcelFeatureState(
  map: FeatureStateMap, path: string, sourceLayers: string[], state: Record<string, any>,
): void {
  const source = parcelSourceForPath(map, path)
  if (!source) return
  for (const sourceLayer of sourceLayers) {
    try { map.setFeatureState({ source, sourceLayer, id: path }, state) } catch {/* source torn down */}
  }
}

/** removeFeatureState for a parcel, on whichever source holds it. */
export function removeParcelFeatureState(
  map: FeatureStateMap, path: string, sourceLayers: string[], key?: string,
): void {
  const source = parcelSourceForPath(map, path)
  if (!source) return
  for (const sourceLayer of sourceLayers) {
    try { map.removeFeatureState({ source, sourceLayer, id: path }, key) } catch {/* source torn down */}
  }
}

/** Sorted state list of a config ('' for legacy) — equal ⇒ same sources. */
export function parcelSourcesKey(config: ParcelSourcesConfig | null | undefined): string {
  if (!usesStateTiles(config)) return config?.tile_url_template ? `legacy:${config.source_layer || ''}` : ''
  const stc = config!.state_tiles as StateTilesConfig
  return `states:${stc.source_layer || ''}:${Object.keys(stc.states).map((s) => s.toLowerCase()).sort().join(',')}`
}

/** Re-fetch 10 minutes before the state tokens expire (min 1 min). null = never. */
export const CONFIG_REFRESH_LEAD_MS = 10 * 60 * 1000
export function parcelConfigRefreshDelayMs(
  config: ParcelSourcesConfig | null | undefined, nowMs: number = Date.now(),
): number | null {
  if (!usesStateTiles(config)) return null
  const exp = Number(config!.state_tiles!.expires_at)
  if (!isFinite(exp) || exp <= 0) return null
  const delay = exp * 1000 - nowMs - CONFIG_REFRESH_LEAD_MS
  return Math.min(Math.max(delay, 60 * 1000), 2_000_000_000)
}

/**
 * Point the mounted state sources at fresh tokens without tearing the layers
 * down (no flicker, tiles already on screen stay). Returns false when the
 * new config needs a remount instead (different states / legacy switch).
 */
export function refreshParcelSourceTiles(
  map: MapLike,
  oldConfig: ParcelSourcesConfig | null | undefined,
  newConfig: ParcelSourcesConfig | null | undefined,
): boolean {
  if (parcelSourcesKey(oldConfig) !== parcelSourcesKey(newConfig)) return false
  if (!usesStateTiles(newConfig)) return true
  for (const spec of parcelSourceSpecs(newConfig)) {
    const src: any = map.getSource(spec.id)
    if (src && typeof src.setTiles === 'function') {
      try { src.setTiles(spec.source.tiles) } catch {/* source torn down */}
    }
  }
  return true
}

/** The polygon MVT layer name (same on legacy and state tiles by contract). */
export function parcelSourceLayer(config: ParcelSourcesConfig | null | undefined): string {
  return (usesStateTiles(config) ? config!.state_tiles!.source_layer : null) || config?.source_layer || 'parcels'
}
