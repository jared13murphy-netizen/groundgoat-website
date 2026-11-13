/**
 * Elevator tag declutter (owner 11/10). Mirrors the app's
 * src/utils/grainBids.test.mjs. No test harness in this repo: run with
 *   node src/lib/elevatorTags.test.ts
 */
import assert from 'node:assert/strict'
import { declutterTags, pinsInView, TAG_ZOOM } from './elevatorTags.ts'

// Two St. Louis riverfront elevators ~300 m apart; the stale one listed first.
const stale = { id: 1, lat: 38.630, lng: -90.180, has_bids: false }
const fresh = { id: 2, lat: 38.632, lng: -90.183, has_bids: true }
const far = { id: 3, lat: 40.23, lng: -91.07, has_bids: false }
const pins = [stale, fresh, far]

// Below tag zoom every pin draws.
assert.deepEqual(declutterTags(pins, TAG_ZOOM - 0.5).map(p => p.id), [1, 2, 3])
// At tag zoom the overlapping pair keeps only the one with fresh bids.
assert.deepEqual(declutterTags(pins, 11).map(p => p.id), [2, 3])
// Zoomed in far enough the two separate and both draw.
assert.deepEqual(declutterTags(pins, 18).map(p => p.id).sort(), [1, 2, 3])
// Side by side, just wider than a tag apart at z11: both kept.
const pxPerDegLng = 512 * 2 ** 11 / 360
const a = { id: 10, lat: 41, lng: -93, has_bids: true }
const b = { id: 11, lat: 41, lng: -93 + 110 / pxPerDegLng, has_bids: true }
const c = { id: 12, lat: 41, lng: -93 + 100 / pxPerDegLng, has_bids: true }
assert.deepEqual(declutterTags([a, b], 11).map(p => p.id), [10, 11])
assert.deepEqual(declutterTags([a, c], 11).map(p => p.id), [10])
// Bad input never throws.
assert.deepEqual(declutterTags(null as any, 11), [])
assert.deepEqual(declutterTags(pins, NaN as any).length, 3)
// Input is not mutated.
assert.deepEqual(pins.map(p => p.id), [1, 2, 3])

console.log('elevatorTags: all assertions passed')

// Only the pins in view (plus half a view each side) go to the map (owner 11/13).
const view = { getSouth: () => 40, getNorth: () => 41, getWest: () => -92, getEast: () => -91 }
const inView = { id: 20, lat: 40.5, lng: -91.5 }
const inPad = { id: 21, lat: 41.4, lng: -90.6 }
const outside = { id: 22, lat: 42, lng: -91.5 }
assert.deepEqual(pinsInView([inView, inPad, outside], view).map(p => p.id), [20, 21])
