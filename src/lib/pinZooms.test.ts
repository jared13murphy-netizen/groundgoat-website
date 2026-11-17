/**
 * Comp-mode pin zooms (owner 11/16). Mirrors the app's
 * src/utils/pinZooms.test.mjs. No test harness in this repo: run with
 *   node src/lib/pinZooms.test.ts
 */
import assert from 'node:assert/strict'
import { pinMinZoom, tileDotMinZoom, saleDotFade, COMP_PIN_MIN_ZOOM, SEARCH_PIN_MIN_ZOOM } from './pinZooms.ts'

// Explore map: unchanged label-zoom floor.
assert.equal(pinMinZoom({}, 12), 12)
assert.equal(pinMinZoom({ comp: false, search: false }, 12), 12)
// Building a comp report: back to the pre-11/12 zoom 9.
assert.equal(COMP_PIN_MIN_ZOOM, 9)
assert.equal(pinMinZoom({ comp: true }, 12), 9)
// Goat Search wins (any zoom), with or without comp mode.
assert.equal(pinMinZoom({ search: true }, 12), SEARCH_PIN_MIN_ZOOM)
assert.equal(pinMinZoom({ search: true, comp: true }, 12), 0)
// Comp mode never RAISES a floor that is already lower.
assert.equal(pinMinZoom({ comp: true }, 8), 8)
// Regrid-tile dot layer: 12 on Explore, 11 (the tile floor) in comp mode.
assert.equal(tileDotMinZoom({}, 12), 12)
assert.equal(tileDotMinZoom({ comp: true }, 12), 11)
assert.equal(tileDotMinZoom({ search: true }, 12), 12)
// Fade ramps end just above the floor; no fade at any-zoom.
assert.deepEqual(saleDotFade(9), ['interpolate', ['linear'], ['zoom'], 8.8, 0, 9.3, 1])
assert.deepEqual(saleDotFade(12), ['interpolate', ['linear'], ['zoom'], 11.8, 0, 12.3, 1])
assert.equal(saleDotFade(0), 1)

console.log('pinZooms: all assertions passed')
