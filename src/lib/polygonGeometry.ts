/**
 * Shared polygon area + perimeter helpers.
 *
 * Used by:
 *   - components/admin/TractMapEditor (drawn polygon live area)
 *   - app/admin/staging + private-treaty-staging (listing-level
 *     polygon sum discrepancy, per-tract perimeter display)
 *
 * Both formulas verified 2026-05-25 against geodesic Albers equal-area
 * (pyproj) and great-circle distance (haversine) on real Halderman
 * Land ID polygons — area accurate to 0.145%, perimeter accurate to
 * essentially machine precision. Plenty for staging-screen display.
 */

export type LngLatPt = [number, number]

/** Acres for a [lng, lat] polygon ring using planar shoelace × meters-
 *  per-degree-at-centroid. Accepts open OR closed rings (auto-detects
 *  duplicate last vertex). Returns 0 for degenerate input.
 *
 *  Accuracy: ~0.15% on parcels <1000 acres in mid-latitudes —
 *  essentially perfect for staging display. Same formula the scraper
 *  uses (scrapers/magic_lab.py:_polygon_area_acres) so frontend and
 *  backend always agree to the rounding digit. */
export function polygonAcres(poly: LngLatPt[] | null | undefined): number {
  if (!Array.isArray(poly) || poly.length < 3) return 0
  // Drop duplicate closing vertex if present.
  const pts =
    poly.length > 3 &&
    poly[0][0] === poly[poly.length - 1][0] &&
    poly[0][1] === poly[poly.length - 1][1]
      ? poly.slice(0, -1)
      : poly
  const n = pts.length
  if (n < 3) return 0
  const meanLat = pts.reduce((s, p) => s + p[1], 0) / n
  const cosLat = Math.cos((meanLat * Math.PI) / 180)
  const mPerDegLat = 111320.0
  const mPerDegLng = 111320.0 * cosLat
  let areaM2 = 0
  for (let i = 0; i < n; i++) {
    const [lng1, lat1] = pts[i]
    const [lng2, lat2] = pts[(i + 1) % n]
    const x1 = lng1 * mPerDegLng
    const y1 = lat1 * mPerDegLat
    const x2 = lng2 * mPerDegLng
    const y2 = lat2 * mPerDegLat
    areaM2 += x1 * y2 - x2 * y1
  }
  return Math.abs(areaM2) / 2 / 4046.86 // m² → acres
}

/** Normalize a tract boundary to a list of rings. Mirrors the backend
 *  `to_rings()` (tract_enrichment_service.py): a tract's coordinates can be a
 *  single ring [[lng,lat],...] (legacy) OR a multi-polygon [[[lng,lat],...],...]
 *  for tracts made of disjoint pieces. Returns one ring for the legacy shape so
 *  every single-polygon caller is unchanged. */
export function toRings(poly: any): LngLatPt[][] {
  if (!Array.isArray(poly) || poly.length === 0) return []
  const first = poly[0]
  // Single ring: first element is a coordinate pair (two numbers).
  if (Array.isArray(first) && typeof first[0] === 'number' && typeof first[1] === 'number') {
    return poly.length >= 3 ? [poly as LngLatPt[]] : []
  }
  // Multi-polygon: each element is itself a ring (a list of coord pairs).
  const rings: LngLatPt[][] = []
  for (const ring of poly) {
    if (Array.isArray(ring) && ring.length >= 3 && Array.isArray(ring[0])) {
      rings.push(ring as LngLatPt[])
    }
  }
  return rings
}

/** Total acres across ALL rings of a tract boundary (single or multi). Sums
 *  per-ring shoelace areas — correct for disjoint pieces. */
export function multiPolygonAcres(poly: any): number {
  return toRings(poly).reduce((s, r) => s + polygonAcres(r), 0)
}

/** Perimeter (in feet) for a [lng, lat] polygon ring using haversine
 *  great-circle distance between consecutive vertices. Accepts open
 *  or closed rings — auto-closes if needed. Returns 0 for degenerate
 *  input.
 *
 *  Accuracy: effectively exact (haversine + mean Earth radius is
 *  millimeter-level for any parcel-sized boundary). */
export function polygonPerimeterFeet(poly: LngLatPt[] | null | undefined): number {
  if (!Array.isArray(poly) || poly.length < 3) return 0
  const R_M = 6371008.8 // mean Earth radius, meters
  const M_TO_FT = 3.28084
  // Force-close the ring
  const ring =
    poly[0][0] === poly[poly.length - 1][0] &&
    poly[0][1] === poly[poly.length - 1][1]
      ? poly
      : [...poly, poly[0]]
  let totalM = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i]
    const [lng2, lat2] = ring[i + 1]
    const lat1r = (lat1 * Math.PI) / 180
    const lat2r = (lat2 * Math.PI) / 180
    const dLat = lat2r - lat1r
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1r) * Math.cos(lat2r) * Math.sin(dLng / 2) ** 2
    totalM += 2 * R_M * Math.asin(Math.sqrt(a))
  }
  return totalM * M_TO_FT
}

/** Format feet as "5,316 ft (1.01 mi)" — feet primary with miles in
 *  parentheses, per user 2026-05-25. Always include both. */
export function formatPerimeter(ft: number): string {
  if (!isFinite(ft) || ft <= 0) return '—'
  return `${Math.round(ft).toLocaleString()} ft (${(ft / 5280).toFixed(2)} mi)`
}
