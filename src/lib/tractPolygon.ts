/**
 * Normalizes `tract.polygon_coordinates` into a flat list of usable rings,
 * across the three shapes production actually returns:
 *
 *   - depth 2: a single ring   [[lng,lat], ...]                         (the
 *     vast majority of tracts — 8,857 of them as of 2026-09-09)
 *   - depth 3: a list of rings [[[lng,lat],...], [[lng,lat],...], ...]  for
 *     a disjoint multi-piece tract (128 tracts). NOT every ring here is a
 *     real piece of land — some are tiny digitization slivers (3-5 points,
 *     a few metres across, never closed) left over from how the boundary
 *     was drawn.
 *   - depth 4: a full GeoJSON MultiPolygon.coordinates shape
 *     [[[[lng,lat],...]], [[[lng,lat],...]], ...] — not seen in production
 *     yet, but the shape a future backend change could plausibly emit.
 *
 * OWNER BUG 2026-09-09: tract 0f3cc99c-5cb2-45ba-a47d-06f39b9b61da (Pike
 * County IL, 19.37 ac, $7,100/ac) showed its pink PIN on the Explore map but
 * no pink polygon outline, at any zoom, with no search/filter involved.
 * Production DB confirmed polygon_coordinates was present and depth 3: 11
 * rings — one real 14-point outline plus 10 degenerate slivers (3-5 points,
 * a few metres across, none closed). The old toRings() (src/lib/
 * polygonRings.ts and the independent copy in src/components/map/
 * exploreMapTransform.ts) accepted ANY ring with length >= 3 with no area or
 * closure check, so ringsToGeometry() handed MapLibre a MultiPolygon
 * containing those 10 degenerate rings alongside the real one. A malformed
 * (near-zero-area / unclosed) ring inside a MultiPolygon feature can fail
 * native tessellation for the WHOLE feature — not just that one ring —
 * which is why the real 14-point outline never drew even though it was
 * individually perfectly valid. This module filters degenerate rings out
 * before anything reaches MapLibre, so only real land pieces draw.
 *
 * Ported from ground-goat-mobile's src/utils/tractPolygon.js (PR #30) — same
 * bug, same fix, same fixtures. Pure, no framework imports — usable from any
 * consumer (Explore map, Comparables map, tract detail sheets, the report
 * flow).
 */

export type Point = [number, number]
export type Ring = Point[]

const MIN_DISTINCT_POINTS = 4
const MIN_RING_AREA_SQM = 50
const METERS_PER_DEG_LAT = 111320
const EPSILON = 1e-9

function isPointPair(v: any): v is Point {
  return Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number'
}

function isRingArray(v: any): v is Ring {
  return Array.isArray(v) && v.length > 0 && isPointPair(v[0])
}

function pointsEqual(a: Point, b: Point): boolean {
  return Math.abs(a[0] - b[0]) < EPSILON && Math.abs(a[1] - b[1]) < EPSILON
}

/** Count of geometrically-distinct vertices in a ring (an unclosed ring's
 *  closing duplicate, if present, is not counted as an extra point). */
function distinctPointCount(ring: Ring): number {
  let count = 0
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]
    if (i === ring.length - 1 && ring.length > 1 && pointsEqual(p, ring[0])) continue
    let dup = false
    for (let j = 0; j < i; j++) {
      if (pointsEqual(ring[j], p)) { dup = true; break }
    }
    if (!dup) count++
  }
  return count
}

/** Approximate planar area of a ring in square meters — a flat-earth
 *  projection local to the ring's own latitude is more than accurate enough
 *  for telling a real field (acres) from a metres-wide digitization sliver. */
function ringAreaSqMeters(ring: Ring): number {
  if (!Array.isArray(ring) || ring.length < 3) return 0
  const lat0 = ring[0][1]
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180)
  let area = 0
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % ring.length]
    const mx0 = x0 * metersPerDegLng, my0 = y0 * METERS_PER_DEG_LAT
    const mx1 = x1 * metersPerDegLng, my1 = y1 * METERS_PER_DEG_LAT
    area += mx0 * my1 - mx1 * my0
  }
  return Math.abs(area / 2)
}

/** A ring is degenerate — a digitization sliver, not real land — if it's
 *  too small in either sense that matters: too few distinct vertices to be
 *  a real shape, or too little area to be an actual field. */
function isDegenerateRing(ring: any): boolean {
  if (!Array.isArray(ring) || ring.length < 3) return true
  if (distinctPointCount(ring) < MIN_DISTINCT_POINTS) return true
  if (ringAreaSqMeters(ring) < MIN_RING_AREA_SQM) return true
  return false
}

/** Close a ring (first point === last point) — MapLibre requires closed
 *  rings; the backend does not always store them that way. Idempotent. */
function closeRing(ring: Ring): Ring {
  const coords: Ring = ring.map((pt) => [pt[0], pt[1]])
  const f = coords[0]
  const l = coords[coords.length - 1]
  if (f[0] !== l[0] || f[1] !== l[1]) coords.push([f[0], f[1]])
  return coords
}

/**
 * Normalize any of the three `polygon_coordinates` shapes into a flat list
 * of usable, closed rings — degenerate slivers dropped. This is the list a
 * Polygon/MultiPolygon geometry (or a bbox / point-in-polygon test) should
 * be built from; every ring returned here is real land.
 */
export function normalizeRings(coords: any): Ring[] {
  if (!Array.isArray(coords) || coords.length === 0) return []

  // depth 2: a single ring — the tract IS this one piece. No area filter
  // here: dropping a genuinely small but real single-piece tract would hide
  // the only boundary it has. Only the ring-length floor (3+ points to be a
  // shape at all) applies — matches the pre-existing behavior for the
  // 8,857 depth-2 tracts, which were never part of this bug.
  if (isPointPair(coords[0])) {
    return coords.length >= 3 ? [closeRing(coords as Ring)] : []
  }

  const first = coords[0]

  // depth 3: a list of rings for a disjoint multi-piece tract. Drop
  // degenerate rings (slivers) so only real pieces reach MapLibre.
  if (isRingArray(first)) {
    return (coords as any[])
      .filter((r) => Array.isArray(r) && !isDegenerateRing(r))
      .map((r) => closeRing(r as Ring))
  }

  // depth 4: a full GeoJSON MultiPolygon.coordinates shape — a list of
  // polygons, each itself a list of rings (outer ring first, any holes
  // after). Not seen in production yet; flattened to a plain ring list with
  // the same degenerate-ring guard as depth 3 so it can never reintroduce
  // this bug if the backend starts emitting it.
  if (Array.isArray(first) && isRingArray(first[0])) {
    const rings: Ring[] = []
    for (const polygon of coords as any[]) {
      if (!Array.isArray(polygon)) continue
      for (const r of polygon) {
        if (Array.isArray(r) && !isDegenerateRing(r)) rings.push(closeRing(r as Ring))
      }
    }
    return rings
  }

  return []
}

export const __testables = { isDegenerateRing, distinctPointCount, ringAreaSqMeters, closeRing }
