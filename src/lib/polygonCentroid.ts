/**
 * Shared AREA-centroid helper for tract polygons — the client-side mirror of
 * the backend's geo_centroid.py (single source of truth for "where is this
 * tract's true location, given its drawn/scraped boundary").
 *
 * The backend now guarantees tract.latitude/longitude == the area-weighted
 * shoelace centroid of tract.polygon_coordinates, and the viewport/bbox map
 * query filters tracts by that stored point. Map components MUST draw each
 * tract's dot at that same stored point (see resolveTractDotLngLat) —
 * recomputing a DIFFERENT point client-side (e.g. a plain average of
 * vertices, or "biggest ring by vertex count") causes a tract to be counted
 * by the filter but rendered somewhere else, or rendered off-center on an
 * L/U-shaped or multi-piece parcel (a long, densely-sampled edge skews a
 * vertex average toward itself).
 *
 * This module is ONLY a fallback for tracts with no stored latitude/
 * longitude — it must compute the identical point the backend would have
 * stored, so the two never disagree. Pure, no framework imports.
 */

export type LngLatPt = [number, number]
export type Ring = LngLatPt[]

function isRing(candidate: any): candidate is Ring {
  if (!Array.isArray(candidate) || candidate.length === 0) return false
  const first = candidate[0]
  return (
    Array.isArray(first) &&
    first.length >= 2 &&
    typeof first[0] === 'number' &&
    typeof first[1] === 'number'
  )
}

/** Normalize polygon_coordinates (single ring OR list-of-rings/multi-piece)
 *  to a list of rings. Mirrors geo_centroid.py's _rings_from_polygon. */
function ringsFromPolygon(poly: any): Ring[] {
  if (!Array.isArray(poly) || poly.length === 0) return []
  if (isRing(poly)) return [poly as Ring]
  return (poly as any[]).filter(isRing) as Ring[]
}

/** Shoelace signed area + true centroid [lng, lat] for a single ring.
 *  Correct regardless of winding order (CW vs CCW) — only the sign of
 *  `area` reflects winding. Returns lng/lat === null for a degenerate
 *  (zero-area, e.g. collinear/duplicate-point) ring. Mirrors
 *  geo_centroid.py's _ring_area_and_centroid exactly (plain degree-space
 *  shoelace, no meters conversion — matches the backend bit-for-bit). */
function ringAreaAndCentroid(ring: Ring): { area: number; lng: number | null; lat: number | null } {
  const n = ring.length
  let signedArea = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[(i + 1) % n]
    const cross = x0 * y1 - x1 * y0
    signedArea += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  signedArea /= 2
  if (Math.abs(signedArea) < 1e-12) return { area: 0, lng: null, lat: null }
  return { area: signedArea, lng: cx / (6 * signedArea), lat: cy / (6 * signedArea) }
}

/**
 * True AREA centroid of a tract polygon, returned as [lng, lat] (GeoJSON /
 * polygon_coordinates order — never [lat, lng]). Mirrors geo_centroid.py's
 * tract_polygon_centroid:
 *   - single-ring polygons: standard shoelace-formula centroid.
 *   - multi-ring (disjoint-piece) tracts: each ring's own centroid is
 *     weighted by that ring's area, so a tiny sliver doesn't pull the
 *     combined centroid as hard as the main piece.
 *   - degenerate polygons (zero area across every ring): fall back to a
 *     plain average of every vertex, since a true area centroid is
 *     undefined there.
 *   - fewer than 3 usable points (no valid ring at all): null — caller
 *     should render no marker, same as having no geometry at all.
 */
export function polygonAreaCentroid(poly: any): LngLatPt | null {
  const rings = ringsFromPolygon(poly).filter((r) => r.length >= 3)
  if (rings.length === 0) return null

  let weightedLng = 0
  let weightedLat = 0
  let totalWeight = 0
  const allPts: Ring = []
  for (const ring of rings) {
    allPts.push(...ring)
    const { area, lng, lat } = ringAreaAndCentroid(ring)
    if (lng == null || lat == null) continue // degenerate ring — excluded
    const w = Math.abs(area)
    weightedLng += lng * w
    weightedLat += lat * w
    totalWeight += w
  }

  if (totalWeight > 1e-12) return [weightedLng / totalWeight, weightedLat / totalWeight]

  // Every ring was degenerate — fall back to the average of all vertices.
  if (allPts.length === 0) return null
  const lng = allPts.reduce((s, p) => s + p[0], 0) / allPts.length
  const lat = allPts.reduce((s, p) => s + p[1], 0) / allPts.length
  return [lng, lat]
}

/**
 * Resolve where a tract's dot should be drawn:
 *   1. Stored latitude/longitude, if both are present and finite — this is
 *      the SAME point the backend's viewport/bbox filter used, so the
 *      filter and the drawn dot always agree.
 *   2. Otherwise the polygon's area centroid (see polygonAreaCentroid).
 *   3. null if neither is available (no marker — same as today when a
 *      tract has no geometry).
 *
 * Every map component (website + mobile) that draws a tract dot should call
 * this instead of rolling its own centroid math.
 */
export function resolveTractDotLngLat(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  polygon: any,
): LngLatPt | null {
  if (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude)
  ) {
    return [longitude, latitude]
  }
  return polygonAreaCentroid(polygon)
}
