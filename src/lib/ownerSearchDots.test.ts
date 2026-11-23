/**
 * Goat Search dot kinds (owner 11/23). No test harness in this repo: run with
 *   node src/lib/ownerSearchDots.test.ts
 */
import assert from 'node:assert/strict'
import {
  buildOwnerParcelFeatures, ownerDotKind, ownerDotLlUuid, ownerDotKindsPresent,
  ownerSearchLegendRows, outlineBounds, ownerDotPaint,
} from './ownerSearchDots.ts'

// Missing / unknown kind = the existing owner-search dot.
assert.equal(ownerDotKind(undefined), 'owner')
assert.equal(ownerDotKind('bogus'), 'owner')
assert.equal(ownerDotKind('mailing'), 'mailing')

const U = '1b2c3d4e-0000-4abc-8def-0123456789ab'
// ll_uuid only for a real UUID that came with a path.
assert.equal(ownerDotLlUuid(U, '/us/il/hancock/pilot-grove/12132'), U)
assert.equal(ownerDotLlUuid(U, null), null)
assert.equal(ownerDotLlUuid('geocode', '/us/il/x/y/1'), null)
assert.equal(ownerDotLlUuid('12345', '/us/il/x/y/1'), null)

const feats = buildOwnerParcelFeatures([
  { id: 'a', lat: 40, lng: -91, acres: 10 },
  { id: 'geocode', lat: 40.1, lng: -91.1, acres: 0, kind: 'address' },
  { id: U, lat: 40.2, lng: -91.2, acres: 80, kind: 'mailing', path: '/us/il/a/b/1', owner: 'SMITH LLC' },
])
assert.deepEqual(feats[0].properties, { id: 'a', acres: 10, kind: 'owner', path: null, owner: null, sort: 0 })
assert.equal(feats[1].properties!.sort, 2)
assert.equal(feats[2].properties!.owner, 'SMITH LLC')
assert.deepEqual(feats[2].geometry.coordinates, [-91.2, 40.2])

const kinds = ownerDotKindsPresent([{ id: 'x', lat: 0, lng: 0, acres: 0, kind: 'address' }])
assert.deepEqual(kinds, { address: true, mailing: false })
assert.deepEqual(ownerSearchLegendRows(kinds).map(r => r.label), ['Search results', 'Searched address'])
assert.deepEqual(ownerSearchLegendRows({ address: false, mailing: true }).map(r => r.label), ['Search results', 'Same mailing address'])

assert.deepEqual(outlineBounds({ type: 'Polygon', coordinates: [[[-91, 40], [-90, 40], [-90, 41], [-91, 40]]] }), [[-91, 40], [-90, 41]])
assert.equal(outlineBounds(null), null)

const paint = ownerDotPaint() as any
assert.equal(paint['circle-color'][3], '#5B21B6')

console.log('ownerSearchDots: ok')
