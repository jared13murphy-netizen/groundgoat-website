// Shared helpers for tract boundaries that may be a SINGLE ring
// [[lng,lat], ...] (legacy) or a LIST OF RINGS [[[lng,lat],...], ...] for a
// tract made of multiple disjoint pieces (multi-polygon).

export type Ring = [number, number][]

/** Normalize a boundary (single ring OR list of rings) to a list of rings.
 *  A single ring → a one-element list. Empty/invalid → []. */
export function toRings(coords: any): Ring[] {
  if (!Array.isArray(coords) || coords.length === 0) return []
  const first = coords[0]
  // Single ring: first element is a coordinate pair [lng, lat].
  if (Array.isArray(first) && typeof first[0] === 'number' && typeof first[1] === 'number') {
    return [coords as Ring]
  }
  // Multipolygon: each element is itself a ring.
  return (coords as any[]).filter((r) => Array.isArray(r) && r.length >= 3) as Ring[]
}

/** Close a ring (first === last) if it isn't already. */
export function closeRing(ring: Ring): Ring {
  if (ring.length < 3) return ring
  const f = ring[0]
  const l = ring[ring.length - 1]
  return f[0] !== l[0] || f[1] !== l[1] ? [...ring, [f[0], f[1]]] : ring
}

/** GeoJSON geometry for a boundary: Polygon for one ring, MultiPolygon for
 *  multiple. Returns null if there are no usable rings. */
export function ringsToGeometry(
  coords: any,
):
  | { type: 'Polygon'; coordinates: Ring[] }
  | { type: 'MultiPolygon'; coordinates: Ring[][] }
  | null {
  const rings = toRings(coords).filter((r) => r.length >= 3).map(closeRing)
  if (rings.length === 0) return null
  if (rings.length === 1) return { type: 'Polygon', coordinates: [rings[0]] }
  return { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) }
}

/** The largest ring (by vertex count) — used for marker/centroid placement on
 *  a multi-piece tract. Null if none. */
export function largestRing(coords: any): Ring | null {
  const rings = toRings(coords).filter((r) => r.length >= 3)
  if (rings.length === 0) return null
  return rings.reduce((a, b) => (b.length > a.length ? b : a))
}

/** Standard even-odd ray-cast point-in-polygon test. `point` is [lng, lat].
 *  No external dep (turf isn't in package.json) — this is the same
 *  algorithm turf.booleanPointInPolygon uses under the hood, just inlined.
 *  Ring need not be pre-closed (first === last is harmless either way). */
export function pointInRing(point: [number, number], ring: Ring): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

/** True if `point` falls inside ANY ring of a tract boundary. Each ring in a
 *  multi-piece tract is a disjoint piece of land (not a hole — see toRings),
 *  so "inside the tract" means inside at least one ring, not a hole-aware
 *  even-odd count across all rings combined. */
export function pointInBoundary(point: [number, number], coords: any): boolean {
  const rings = toRings(coords)
  for (const ring of rings) {
    if (ring.length >= 3 && pointInRing(point, ring)) return true
  }
  return false
}
