/**
 * Owner bug 2026-09-09: tract 0f3cc99c-5cb2-45ba-a47d-06f39b9b61da (Pike
 * County IL, 19.37 ac, $7,100/ac) drew its pink pin on the Explore map but
 * never its pink polygon outline, at any zoom, with no search/filter
 * active. Production DB confirmed polygon_coordinates was present — depth
 * 3, 11 rings: one real 14-point outline plus 10 digitization slivers (3-5
 * points, a few metres across, none closed). The old toRings() accepted
 * every ring with length >= 3, so ringsToGeometry() handed MapLibre a
 * MultiPolygon containing the slivers alongside the real outline; a
 * degenerate ring inside a MultiPolygon feature can fail native
 * tessellation for the WHOLE feature, which is why the real outline never
 * drew even though it was individually valid.
 *
 * Fixtures below are the ACTUAL production API response (saved
 * 2026-09-09, /api/map/tracts?include_polygons=true) for the reported
 * tract, a second depth-3 tract found alongside it, and two ordinary
 * depth-2 tracts from the same viewport as a control group — the same
 * fixtures used by ground-goat-mobile's tractPolygon.test.mjs (PR #30).
 *
 * This repo has no jest/vitest harness configured, so this is a plain
 * runnable script (Node 22+ strips TS types natively):
 *   node src/lib/tractPolygon.test.ts
 *
 * polygonRings.ts (toRings/ringsToGeometry) and exploreMapTransform.ts both
 * delegate to normalizeRings (see each file's own header comment) rather
 * than re-implementing ring filtering — this file exercises normalizeRings
 * directly and also runs ringsToGeometry's actual delegation to it inline
 * (below) rather than importing polygonRings.ts as a module: this repo's
 * source uses extensionless relative imports everywhere (the Next.js
 * "bundler" moduleResolution convention), and plain `node` — unlike
 * Next/webpack — cannot resolve those without an explicit .ts extension on
 * EVERY file in the import chain, not just the entry point. Reproducing
 * ringsToGeometry's own few lines here keeps this test runnable with plain
 * node while still proving the same behavior polygonRings.ts exposes (its
 * source is the delegation being tested — see the "delegates" assertion
 * below).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { normalizeRings, __testables } from './tractPolygon.ts'

const { isDegenerateRing } = __testables

// Mirrors polygonRings.ts's ringsToGeometry exactly (see that file) — kept
// in lockstep so this test still proves the real shape MapLibre receives.
function ringsToGeometry(coords: any) {
  const rings = normalizeRings(coords)
  if (rings.length === 0) return null
  if (rings.length === 1) return { type: 'Polygon' as const, coordinates: [rings[0]] }
  return { type: 'MultiPolygon' as const, coordinates: rings.map((r) => [r]) }
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = JSON.parse(
  readFileSync(join(__dirname, 'tractPolygon.fixtures.json'), 'utf8'),
)

const REPORTED_TRACT = fixtures['0f3cc99c-5cb2-45ba-a47d-06f39b9b61da'] // 19.37 ac, 11 rings
const OTHER_MULTI_RING = fixtures['2be20cff-e1db-4d52-bb5c-508ea9d21a99'] // 72.02 ac, 10 rings
const NORMAL_A = fixtures['72822266-8180-4d2a-8cb6-a0c386e751e1'] // 20.05 ac, depth 2
const NORMAL_B = fixtures['7f652074-764e-4405-934e-45d0ae53ccab'] // 29.99 ac, depth 2

let passed = 0
function t(name: string, fn: () => void) {
  fn()
  passed++
  console.log('  ok  ' + name)
}

t('THE BUG, reproduced: the raw 11-ring boundary has slivers among its rings', () => {
  const coords = REPORTED_TRACT.polygon_coordinates
  assert.equal(coords.length, 11)
  const realOutline = coords[0]
  assert.equal(realOutline.length, 14)
  const slivers = coords.slice(1)
  assert.ok(
    slivers.every((r: any[]) => r.length >= 3 && r.length <= 5),
    'fixture no longer matches the reported sliver shape',
  )
  // Every sliver is individually "valid" under the OLD length>=3-only rule —
  // that's exactly why the old code kept them.
  assert.ok(slivers.every((r: any[]) => r.length >= 3))
})

t('THE FIX: normalizeRings drops the 10 slivers, keeps the 1 real outline', () => {
  const rings = normalizeRings(REPORTED_TRACT.polygon_coordinates)
  assert.equal(rings.length, 1, 'expected exactly the real outline to survive')
  // 14 source points + 1 closing point (unclosed source ring).
  assert.equal(rings[0].length, 15)
})

t('THE FIX: the real outline is individually non-degenerate', () => {
  const realOutline = REPORTED_TRACT.polygon_coordinates[0]
  assert.equal(isDegenerateRing(realOutline), false)
})

t('THE FIX: every sliver ring IS flagged degenerate', () => {
  for (const sliver of REPORTED_TRACT.polygon_coordinates.slice(1)) {
    assert.equal(isDegenerateRing(sliver), true, JSON.stringify(sliver))
  }
})

t('THE FIX: ringsToGeometry now returns a renderable Polygon, not a MultiPolygon full of slivers', () => {
  const geom = ringsToGeometry(REPORTED_TRACT.polygon_coordinates)
  assert.ok(geom)
  assert.equal(geom!.type, 'Polygon')
  assert.equal(geom!.coordinates.length, 1)
  assert.equal(geom!.coordinates[0].length, 15)
})

t('the reported tract still normalizes to at least one ring — the pin never disappeared, only the polygon', () => {
  assert.ok(normalizeRings(REPORTED_TRACT.polygon_coordinates).length > 0)
})

t('every ring returned is closed (first point === last point)', () => {
  const rings = normalizeRings(REPORTED_TRACT.polygon_coordinates)
  for (const ring of rings) {
    assert.deepEqual(ring[0], ring[ring.length - 1])
  }
})

t('a second real-world multi-ring tract (72.02 ac, 10 rings) also normalizes to just its real piece(s)', () => {
  const coords = OTHER_MULTI_RING.polygon_coordinates
  const rings = normalizeRings(coords)
  assert.ok(rings.length >= 1)
  assert.ok(rings.length < coords.length, 'expected at least one sliver dropped')
  const geom = ringsToGeometry(coords)
  assert.ok(geom!.type === 'Polygon' || geom!.type === 'MultiPolygon')
})

t('ordinary depth-2 tracts are unaffected — every point survives, none dropped', () => {
  for (const tract of [NORMAL_A, NORMAL_B]) {
    const coords = tract.polygon_coordinates
    const rings = normalizeRings(coords)
    assert.equal(rings.length, 1)
    // Unclosed source + 1 closing point == one more than the source length.
    assert.equal(rings[0].length, coords.length + 1)
    assert.ok(ringsToGeometry(coords)!.type === 'Polygon')
  }
})

// --- Synthetic shape coverage (real production data doesn't have a depth-4
// or a legitimate small ring case, so these are hand-built) ---

t('depth 4 (GeoJSON MultiPolygon.coordinates) is flattened to its usable rings', () => {
  const bigSquare = [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]] // real field, ~1.2 km^2
  const sliver = [[5, 5], [5.00001, 5], [5.00001, 5.00001]] // ~1 m^2, 3 points
  const multiPolygon = [[bigSquare], [sliver]] // depth 4: [ [ [ring],[hole?] ], [ [ring] ] ]
  const rings = normalizeRings(multiPolygon)
  assert.equal(rings.length, 1)
  assert.equal(rings[0].length, bigSquare.length + 1)
})

t('a ring under the 4-distinct-point floor is dropped even with a large-enough area', () => {
  // A degenerate near-zero-width "ring" that's technically 3 points but not
  // a real shape — length 3 already fails the floor.
  const triangleLike = [[0, 0], [0.001, 0], [0.0005, 0.0005]]
  assert.equal(isDegenerateRing(triangleLike), true) // < 4 distinct points
})

t('a ring under the ~50 sq-m area floor is dropped even with 4+ points', () => {
  const tinyButFourPoints = [[0, 0], [0.00002, 0], [0.00002, 0.00002], [0, 0.00002]]
  assert.equal(isDegenerateRing(tinyButFourPoints), true)
})

t('a real small ring (4+ distinct points, area well over the floor) survives', () => {
  const realSmallField = [[0, 0], [0.002, 0], [0.002, 0.002], [0, 0.002]] // ~5 acres
  assert.equal(isDegenerateRing(realSmallField), false)
})

t('fails OPEN — unreadable / empty coordinates never throw, just produce no rings', () => {
  assert.deepEqual(normalizeRings(null), [])
  assert.deepEqual(normalizeRings(undefined), [])
  assert.deepEqual(normalizeRings([]), [])
  assert.equal(ringsToGeometry(null), null)
})

// --- Wiring: every known ring-shape consumer must delegate to
// normalizeRings, not re-implement its own length>=3-only filter (the
// exact defect this bug fix closes). Source-inspection rather than a
// runtime import: this repo's extensionless relative imports (Next.js
// "bundler" moduleResolution) only resolve under webpack/tsc, not plain
// node — see the file header. Each assertion fails loudly (naming the
// file) if a future edit reintroduces a local, unguarded ring filter. ---

function sourceOf(relPath: string): string {
  return readFileSync(join(__dirname, relPath), 'utf8')
}

t('polygonRings.ts toRings()/ringsToGeometry() delegate to normalizeRings', () => {
  const src = sourceOf('polygonRings.ts')
  assert.match(src, /from '\.\/tractPolygon'/, 'polygonRings.ts must import from ./tractPolygon')
  assert.match(src, /export function toRings\([^)]*\)[^{]*\{\s*return normalizeRings\(coords\)/,
    'toRings() must delegate straight to normalizeRings, not re-implement ring filtering')
})

t('exploreMapTransform.ts imports the shared toRings instead of its own copy', () => {
  const src = sourceOf('../components/map/exploreMapTransform.ts')
  assert.match(src, /import \{ toRings \} from '@\/lib\/polygonRings'/,
    'exploreMapTransform.ts must import toRings from @/lib/polygonRings, not define its own')
  // The old bug: an independent `function toRings` here with a bare
  // length>=3 filter and no degenerate-ring guard.
  assert.doesNotMatch(src, /function toRings\(/,
    'exploreMapTransform.ts must not define its own toRings — that was the second copy of this bug')
})

console.log(`\n${passed} passed`)
