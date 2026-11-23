/**
 * parcelSources — config → parcel sources/layers. state_tiles present → one
 * source per state (`parcels-{st}`, bounds, tokens); absent → the legacy single
 * `regrid-parcels` source exactly as before. No test harness: run with
 *   node src/lib/parcelSources.test.ts
 */
import assert from 'node:assert/strict'
import {
  parcelSourceSpecs, parcelLayerId, parcelLayers, parcelSourceIds, parcelSourceForPath,
  expandParcelLayerIds, isParcelSourceId, usesStateTiles, stateTileUrl,
  setParcelFeatureState, removeParcelFeatureState, parcelSourcesKey,
  parcelConfigRefreshDelayMs, refreshParcelSourceTiles, parcelSourceLayer, CONFIG_REFRESH_LEAD_MS,
} from './parcelSources.ts'

let passed = 0
function test(name: string, fn: () => void) { fn(); passed++; console.log(`ok - ${name}`) }

const LAYER = '23ddb9e360af6270a6cc96870323aa27dbc2e7e9'
const LEGACY = {
  tile_url_template: 'https://sandbox-api.groundgoat.com/api/regrid/tile/{z}/{x}/{y}.mvt',
  source_layer: LAYER,
}
const ME_B = [-71.08, 42.98, -66.95, 47.46]
const NY_B = [-79.76, 40.5, -71.86, 45.01]
const STATE = {
  ...LEGACY,
  state_tiles: {
    url_template: 'https://sandbox-api.groundgoat.com/ptiles/{st}/{z}/{x}/{y}.mvt?{token}',
    source_layer: LAYER,
    label_layer: 'gg_label_points',
    minzoom: 11, maxzoom: 15,
    expires_at: 1795400000,
    states: { ny: { token: 'e=1795400000&s=NYSIG', bounds: NY_B }, me: { token: 'e=1795400000&s=MESIG', bounds: ME_B } },
  },
}

// Minimal map double: style layers/sources + feature-state log.
function fakeMap(sourceIds: string[], layerIds: string[]) {
  const sources: Record<string, any> = {}
  for (const id of sourceIds) sources[id] = { tiles: null as any, setTiles(t: string[]) { this.tiles = t } }
  const calls: any[] = []
  return {
    calls, sources,
    getStyle: () => ({ layers: layerIds.map((id) => ({ id })), sources }),
    getSource: (id: string) => sources[id],
    getLayer: (id: string) => (layerIds.includes(id) ? { id } : undefined),
    setFeatureState: (f: any, s: any) => { calls.push(['set', f, s]) },
    removeFeatureState: (f: any, k?: string) => { calls.push(['remove', f, k]) },
  } as any
}

test('absent state_tiles → legacy single source, today\'s ids and settings', () => {
  const specs = parcelSourceSpecs(LEGACY, { legacyMinzoom: 11, legacyMaxzoom: 14, legacyLabelLayer: 'gg_label_points' })
  assert.equal(specs.length, 1)
  const [sp] = specs
  assert.equal(sp.id, 'regrid-parcels')
  assert.equal(sp.st, null)
  assert.deepEqual(sp.source.tiles, [LEGACY.tile_url_template])
  assert.equal(sp.source.minzoom, 11)
  assert.equal(sp.source.maxzoom, 14)
  assert.equal(sp.source.bounds, undefined)
  assert.deepEqual(sp.source.promoteId, { [LAYER]: 'path', gg_label_points: 'path' })
  assert.equal(parcelLayerId(sp, 'fill'), 'regrid-parcels-fill')
  assert.equal(parcelLayerId(sp, 'line'), 'regrid-parcels-line')
  assert.equal(parcelLayerId(sp, 'label'), 'regrid-parcels-label')
  assert.equal(parcelLayerId(sp, 'owner-label'), 'regrid-parcels-owner-label')
  assert.equal(parcelLayerId(sp, 'sale'), 'parcel-sale-pin-plus')
  assert.equal(usesStateTiles(LEGACY), false)
  assert.equal(usesStateTiles({ ...LEGACY, state_tiles: null }), false)
  assert.equal(usesStateTiles({ ...LEGACY, state_tiles: { ...STATE.state_tiles, states: {} } }), false)
  assert.equal(parcelConfigRefreshDelayMs(LEGACY), null)
})

test('no config / no template → no sources', () => {
  assert.deepEqual(parcelSourceSpecs(null), [])
  assert.deepEqual(parcelSourceSpecs({}), [])
})

test('state_tiles → one source per state with its own token, bounds, zooms, promoteId', () => {
  const specs = parcelSourceSpecs(STATE, { legacyMinzoom: 11, legacyMaxzoom: 14 })
  assert.deepEqual(specs.map((s) => s.id), ['parcels-me', 'parcels-ny'])
  const me = specs[0]
  assert.equal(me.st, 'me')
  assert.deepEqual(me.source.tiles, ['https://sandbox-api.groundgoat.com/ptiles/me/{z}/{x}/{y}.mvt?e=1795400000&s=MESIG'])
  assert.deepEqual(me.source.bounds, ME_B)
  assert.equal(me.source.minzoom, 11)
  assert.equal(me.source.maxzoom, 15)
  assert.equal(me.source.type, 'vector')
  assert.deepEqual(me.source.promoteId, { [LAYER]: 'path', gg_label_points: 'path' })
  assert.equal(me.sourceLayer, LAYER)
  assert.equal(me.labelLayer, 'gg_label_points')
  assert.deepEqual(specs[1].source.tiles, ['https://sandbox-api.groundgoat.com/ptiles/ny/{z}/{x}/{y}.mvt?e=1795400000&s=NYSIG'])
  assert.equal(parcelLayerId(me, 'fill'), 'parcels-me-fill')
  assert.equal(parcelLayerId(me, 'line'), 'parcels-me-line')
  assert.equal(parcelLayerId(me, 'label'), 'parcels-me-label')
  assert.equal(parcelLayerId(me, 'sale'), 'parcel-sale-pin-plus-me')
  assert.equal(stateTileUrl(STATE.state_tiles, 'ny'), specs[1].source.tiles[0])
  assert.equal(parcelSourceLayer(STATE), LAYER)
})

test('bad bounds are dropped (MapLibre would reject them), not passed through', () => {
  const cfg = { ...STATE, state_tiles: { ...STATE.state_tiles, states: { me: { token: 't', bounds: [1, 2] } } } }
  assert.equal(parcelSourceSpecs(cfg)[0].source.bounds, undefined)
})

test('layer lookups span every state source, in draw order, and ignore look-alikes', () => {
  const map = fakeMap(['parcels-me', 'parcels-ny', 'parcels', 'parcels_regrid'], [
    'parcels-fill', 'parcels-regrid-fill', // staff editor's own layers — not ours
    'parcels-me-fill', 'parcels-ny-fill', 'parcels-me-line', 'parcels-ny-line',
    'parcels-me-label', 'parcels-ny-label', 'parcel-sale-pin-plus-me', 'parcel-sale-pin-plus-ny', 'tract-polygon-fill',
  ])
  assert.deepEqual(parcelLayers(map, 'fill'), ['parcels-me-fill', 'parcels-ny-fill'])
  assert.deepEqual(parcelLayers(map, 'line'), ['parcels-me-line', 'parcels-ny-line'])
  assert.deepEqual(parcelLayers(map, 'sale'), ['parcel-sale-pin-plus-me', 'parcel-sale-pin-plus-ny'])
  assert.deepEqual(parcelSourceIds(map), ['parcels-me', 'parcels-ny'])
  assert.deepEqual(
    expandParcelLayerIds(map, ['tract-polygon-fill', 'parcel-sale-pin-plus', 'regrid-parcels-fill']),
    ['tract-polygon-fill', 'parcel-sale-pin-plus-me', 'parcel-sale-pin-plus-ny', 'parcels-me-fill', 'parcels-ny-fill'],
  )
  assert.equal(isParcelSourceId('parcels-me'), true)
  assert.equal(isParcelSourceId('regrid-parcels'), true)
  assert.equal(isParcelSourceId('parcels'), false)
  assert.equal(isParcelSourceId('parcels_regrid'), false)
})

test('legacy map: lookups return today\'s single ids', () => {
  const map = fakeMap(['regrid-parcels'], ['regrid-parcels-fill', 'regrid-parcels-line', 'regrid-parcels-label', 'parcel-sale-pin-plus'])
  assert.deepEqual(parcelLayers(map, 'fill'), ['regrid-parcels-fill'])
  assert.deepEqual(parcelLayers(map, 'sale'), ['parcel-sale-pin-plus'])
  assert.deepEqual(expandParcelLayerIds(map, ['parcel-sale-pin-plus']), ['parcel-sale-pin-plus'])
  assert.equal(parcelSourceForPath(map, '/us/ny/kings/brooklyn/1'), 'regrid-parcels')
})

test('feature-state (hover / selection / dotSuppressed) goes to the parcel\'s own state source', () => {
  const map = fakeMap(['parcels-me', 'parcels-ny'], [])
  assert.equal(parcelSourceForPath(map, '/us/ny/kings/brooklyn/1'), 'parcels-ny')
  assert.equal(parcelSourceForPath(map, '/us/me/aroostook/presque-isle/1'), 'parcels-me')
  assert.equal(parcelSourceForPath(map, '/us/vt/x/y/1'), null)
  setParcelFeatureState(map, '/us/ny/kings/brooklyn/1', [LAYER, 'gg_label_points'], { dotSuppressed: true })
  removeParcelFeatureState(map, '/us/me/aroostook/presque-isle/1', [LAYER], 'hover')
  setParcelFeatureState(map, '/us/vt/x/y/1', [LAYER], { hover: true }) // not subscribed → no-op
  assert.deepEqual(map.calls, [
    ['set', { source: 'parcels-ny', sourceLayer: LAYER, id: '/us/ny/kings/brooklyn/1' }, { dotSuppressed: true }],
    ['set', { source: 'parcels-ny', sourceLayer: 'gg_label_points', id: '/us/ny/kings/brooklyn/1' }, { dotSuppressed: true }],
    ['remove', { source: 'parcels-me', sourceLayer: LAYER, id: '/us/me/aroostook/presque-isle/1' }, 'hover'],
  ])
})

test('re-fetch before expires_at; same states → tiles swapped in place, new states → remount', () => {
  const now = 1795400000 * 1000 - 3 * 3600 * 1000
  assert.equal(parcelConfigRefreshDelayMs(STATE, now), 3 * 3600 * 1000 - CONFIG_REFRESH_LEAD_MS)
  assert.equal(parcelConfigRefreshDelayMs(STATE, 1795400000 * 1000), 60 * 1000) // already late → soon
  const map = fakeMap(['parcels-me', 'parcels-ny'], [])
  const fresh = { ...STATE, state_tiles: { ...STATE.state_tiles, states: {
    me: { token: 'e=2&s=ME2', bounds: ME_B }, ny: { token: 'e=2&s=NY2', bounds: NY_B } } } }
  assert.equal(parcelSourcesKey(STATE), parcelSourcesKey(fresh))
  assert.equal(refreshParcelSourceTiles(map, STATE, fresh), true)
  assert.deepEqual(map.sources['parcels-me'].tiles, ['https://sandbox-api.groundgoat.com/ptiles/me/{z}/{x}/{y}.mvt?e=2&s=ME2'])
  assert.deepEqual(map.sources['parcels-ny'].tiles, ['https://sandbox-api.groundgoat.com/ptiles/ny/{z}/{x}/{y}.mvt?e=2&s=NY2'])
  const plusVt = { ...STATE, state_tiles: { ...STATE.state_tiles, states: { ...STATE.state_tiles.states, vt: { token: 'x' } } } }
  assert.equal(refreshParcelSourceTiles(map, STATE, plusVt), false)
  assert.equal(refreshParcelSourceTiles(map, LEGACY, STATE), false)
  assert.equal(refreshParcelSourceTiles(map, LEGACY, LEGACY), true)
})

console.log(`\n${passed} passed`)
