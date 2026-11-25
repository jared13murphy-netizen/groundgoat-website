// node --experimental-strip-types src/lib/stagingMapCenter.test.ts
import assert from 'node:assert/strict'
import {
  pickStagingMapCenter, parseMapCenter, stateAbbr, makeCountyCentreLookup,
  DEFAULT_MAP_CENTER, STATE_CENTROIDS,
} from './stagingMapCenter.ts'

// parseMapCenter shapes
assert.deepEqual(parseMapCenter({ latitude: 40.2, longitude: -85.0, source: 'county_centroid' }), [-85.0, 40.2])
assert.deepEqual(parseMapCenter({ lat: 40.2, lng: -85.0 }), [-85.0, 40.2])
assert.deepEqual(parseMapCenter({ lat: '40.2', lon: '-85.0' }), [-85.0, 40.2])
assert.deepEqual(parseMapCenter([-85.0, 40.2]), [-85.0, 40.2])
assert.deepEqual(parseMapCenter([40.2, -85.0]), [-85.0, 40.2])     // swapped US pair read right
assert.deepEqual(parseMapCenter([41.9, -93.5]), [-93.5, 41.9])
assert.equal(parseMapCenter(null), null)
assert.equal(parseMapCenter('41.9,-93.5'), null)
assert.equal(parseMapCenter({}), null)
assert.equal(parseMapCenter({ latitude: 0, longitude: 0 }), null)
assert.equal(parseMapCenter({ latitude: 140, longitude: -85 }), null)
assert.equal(parseMapCenter({ latitude: NaN, longitude: -85 }), null)
assert.equal(parseMapCenter([1]), null)
assert.equal(parseMapCenter({ latitude: true, longitude: -85 }), null)

// stateAbbr
assert.equal(stateAbbr('IN'), 'IN')
assert.equal(stateAbbr(' indiana '), 'IN')
assert.equal(stateAbbr('North  Dakota'), 'ND')
assert.equal(stateAbbr('XX'), null)
assert.equal(stateAbbr(null), null)
assert.equal(Object.keys(STATE_CENTROIDS).length, 51)

const box: [number, number][] = [[-90, 40], [-89.99, 40], [-89.99, 40.01], [-90, 40.01]]

// 1. boundary wins (existing behaviour)
const b = pickStagingMapCenter({ points: box, latitude: 41, longitude: -93, tractMapCenter: { latitude: 39, longitude: -86 }, state: 'IL' })
assert.equal(b.source, 'boundary'); assert.equal(b.zoom, 16)
assert.ok(Math.abs(b.lng - -89.995) < 1e-9 && Math.abs(b.lat - 40.005) < 1e-9)
// 2 points is not a boundary
assert.equal(pickStagingMapCenter({ points: box.slice(0, 2), latitude: 41, longitude: -93 }).source, 'coordinates')

// 2. coordinates (existing behaviour)
assert.deepEqual(pickStagingMapCenter({ latitude: '41.1', longitude: '-93.2', tractMapCenter: { latitude: 39, longitude: -86 } }),
  { lng: -93.2, lat: 41.1, zoom: 16, source: 'coordinates' })
// one half missing / 0,0 → not coordinates
assert.equal(pickStagingMapCenter({ latitude: 41.1, longitude: null, state: 'IA' }).source, 'state')
assert.equal(pickStagingMapCenter({ latitude: 0, longitude: 0, state: 'IA' }).source, 'state')

// 3. tract map_center (Randolph County IN — the owner's example)
const randolph = { latitude: 40.16, longitude: -85.0, source: 'county_centroid', county: 'Randolph', state: 'IN' }
assert.deepEqual(pickStagingMapCenter({ tractMapCenter: randolph, listingMapCenter: { lat: 1, lng: 1 }, state: 'IN', county: 'Story' }),
  { lng: -85.0, lat: 40.16, zoom: 10, source: 'tract_map_center' })
// state_center map_center opens zoomed out
assert.equal(pickStagingMapCenter({ tractMapCenter: { latitude: 39.8, longitude: -86.3, source: 'state_center', state: 'IN' }, state: 'IN' }).zoom, 6)
// a map_center naming another state than the listing is skipped
assert.equal(pickStagingMapCenter({ tractMapCenter: { ...randolph, state: 'Iowa' }, state: 'IN' }).source, 'state')
// full-name state on the centre matches an abbreviation on the listing
assert.equal(pickStagingMapCenter({ tractMapCenter: { ...randolph, state: 'Indiana' }, state: 'IN' }).source, 'tract_map_center')

// 4. listing map_center
assert.equal(pickStagingMapCenter({ tractMapCenter: 'junk', listingMapCenter: [-85.0, 40.16], state: 'IN' }).source, 'listing_map_center')

// 5. county centre
const lookup = makeCountyCentreLookup({ 'Randolph, IN': [40.16, -85.0], 'Story, IA': [42.03, -93.46] })
assert.deepEqual(pickStagingMapCenter({ county: 'Randolph County', state: 'Indiana', countyCentre: lookup }),
  { lng: -85.0, lat: 40.16, zoom: 10, source: 'county' })
assert.equal(pickStagingMapCenter({ county: 'randolph', state: 'in', countyCentre: lookup }).source, 'county')
// county not in table → state; throwing lookup → state, no crash
assert.equal(pickStagingMapCenter({ county: 'Nowhere', state: 'IN', countyCentre: lookup }).source, 'state')
assert.equal(pickStagingMapCenter({ county: 'Randolph', state: 'IN', countyCentre: () => { throw new Error('x') } }).source, 'state')
// county without a state is never looked up (county names repeat across states)
assert.deepEqual(pickStagingMapCenter({ county: 'Randolph', countyCentre: lookup }), DEFAULT_MAP_CENTER)

// 6. state centre
assert.deepEqual(pickStagingMapCenter({ state: 'Nebraska' }), { lng: -99.8, lat: 41.5, zoom: 6, source: 'state' })

// 7. default (unchanged)
assert.deepEqual(pickStagingMapCenter({}), DEFAULT_MAP_CENTER)
assert.deepEqual(pickStagingMapCenter({ points: null, latitude: undefined, state: 'ZZ' }), DEFAULT_MAP_CENTER)

console.log('stagingMapCenter ok')
