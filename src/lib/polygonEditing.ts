/**
 * Shared polygon-EDITING mechanics.
 *
 * These functions were built and proven inside
 * `components/admin/TractMapEditor` (the Auction Staging map creator).
 * They were moved here so the Configurable Mapping "Configure Map"
 * screen reuses the same behaviour instead of growing a second, subtly
 * different editor — an edge insert or a simplify that rounds corners
 * differently on two screens is exactly the kind of drift that makes
 * two maps of the same field disagree.
 *
 * Everything here is PURE (except the two that need `map.project` for
 * pixel distances). No React, no component state.
 *
 * Companion module: `polygonGeometry.ts` (area + perimeter).
 */
import type maplibregl from 'maplibre-gl'

export type Pt = [number, number]

// ── pixel-space hit testing ─────────────────────────────────────────

/** Pixel distance from screen point p to segment a–b. */
export function segDistPx(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1e-9
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = a.x + t * dx
  const cy = a.y + t * dy
  return Math.hypot(p.x - cx, p.y - cy)
}

/** Index of the ring segment (i → i+1) whose screen projection is
 *  nearest the clicked point, so a new vertex lands on the edge the
 *  user actually clicked instead of being appended to the end. */
export function nearestSegmentIndex(
  map: maplibregl.Map,
  ring: Pt[],
  screenPt: { x: number; y: number },
): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = map.project(ring[i] as [number, number])
    const b = map.project(ring[(i + 1) % ring.length] as [number, number])
    const d = segDistPx(screenPt, a, b)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

/** Nearest vertex within `maxPx`, or null. Used for grab-a-handle and
 *  for snapping a drawn corner onto an existing one. */
export function nearestVertexIndex(
  map: maplibregl.Map,
  ring: Pt[],
  screenPt: { x: number; y: number },
  maxPx = 18,
): number | null {
  let best: number | null = null
  let bestD = maxPx
  for (let i = 0; i < ring.length; i++) {
    const s = map.project(ring[i] as [number, number])
    const d = Math.hypot(screenPt.x - s.x, screenPt.y - s.y)
    if (d <= bestD) { bestD = d; best = i }
  }
  return best
}

// ── magnet snapping (Configurable Mapping, Stage 2 free-draw) ──────────
// The owner's tracts-first process free-draws a tract with a ~30 ft
// magnet: a corner dropped near another tract's edge, or near a Regrid
// parcel line, should land ON it rather than a few feet off and leave a
// sliver gap between two tracts that are supposed to share a fence.
// Not wired into ConfigureMap.tsx's draw tool yet — this is the pure
// geometry half, landing ahead of the map-handler wiring so that piece
// can be reviewed and tested on its own.

/** Web Mercator's standard meters-per-pixel at a latitude/zoom. Turns
 *  the owner's "~30 ft" into the same screen-pixel units
 *  nearestSegmentIndex/nearestVertexIndex already work in, so this reuses
 *  them instead of a second, geodesic distance check. */
function metersPerPixel(map: maplibregl.Map, lat: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, map.getZoom())
}

export interface SnapTarget { ring: Pt[] }

export interface SnapResult { point: Pt; snapped: boolean }

/** Magnet-snap `point` onto the nearest vertex or edge of any ring in
 *  `targets` — other tracts' boundaries, plus a Regrid parcel edge
 *  queried live off the map (`map.queryRenderedFeatures` on the regrid
 *  line layer) — within `feet` (owner spec: ~30 ft). A vertex snap wins
 *  over an edge snap at the same point: landing exactly on a shared
 *  corner is more useful than a hair off it on the edge between two
 *  corners. Returns the point unchanged with `snapped: false` when
 *  nothing in `targets` is close enough — the caller draws the point the
 *  user actually placed. */
export function snapPoint(
  map: maplibregl.Map, point: Pt, targets: SnapTarget[], feet = 30,
): SnapResult {
  const maxPx = (feet * 0.3048) / metersPerPixel(map, point[1])
  const screenPt = map.project(point)
  let bestVertex: { d: number; pt: Pt } | null = null
  let bestEdge: { d: number; pt: Pt } | null = null
  for (const { ring } of targets) {
    if (ring.length < 2) continue
    const vi = nearestVertexIndex(map, ring, screenPt, maxPx)
    if (vi != null) {
      const s = map.project(ring[vi] as [number, number])
      const d = Math.hypot(screenPt.x - s.x, screenPt.y - s.y)
      if (!bestVertex || d < bestVertex.d) bestVertex = { d, pt: ring[vi] }
    }
    const seg = nearestSegmentIndex(map, ring, screenPt)
    const a = map.project(ring[seg] as [number, number])
    const b = map.project(ring[(seg + 1) % ring.length] as [number, number])
    const d = segDistPx(screenPt, a, b)
    if (d <= maxPx && (!bestEdge || d < bestEdge.d)) {
      // Project screenPt onto the segment in screen space, then carry
      // that fraction back onto the ring's own lng/lat endpoints —
      // planar-enough over a ~30 ft radius.
      const dx = b.x - a.x, dy = b.y - a.y
      const len2 = dx * dx + dy * dy || 1e-9
      let t = ((screenPt.x - a.x) * dx + (screenPt.y - a.y) * dy) / len2
      t = Math.max(0, Math.min(1, t))
      const ra = ring[seg] as Pt
      const rb = ring[(seg + 1) % ring.length] as Pt
      bestEdge = { d, pt: [ra[0] + t * (rb[0] - ra[0]), ra[1] + t * (rb[1] - ra[1])] }
    }
  }
  // A vertex match is inherently also within snap range of its two
  // adjacent edges, so preferring it here is enough — no tie-break
  // needed against bestEdge.d.
  if (bestVertex) return { point: bestVertex.pt, snapped: true }
  if (bestEdge) return { point: bestEdge.pt, snapped: true }
  return { point, snapped: false }
}

// ── Douglas–Peucker simplification ──────────────────────────────────
// A traced boundary follows the painted contour and emits many vertices
// on gentle curves, so corners read as "rounded". Dropping vertices that
// sit within `tol` (degrees) of the line between their neighbours
// straightens those runs while leaving real corners intact.

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function dp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts
  const end = pts.length - 1
  let maxD = 0
  let idx = 0
  for (let i = 1; i < end; i++) {
    const d = perpDist(pts[i], pts[0], pts[end])
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD > tol) {
    const left = dp(pts.slice(0, idx + 1), tol)
    const right = dp(pts.slice(idx), tol)
    return [...left.slice(0, -1), ...right]
  }
  return [pts[0], pts[end]]
}

/** Simplify an OPEN ring (no closing duplicate). Returns the original
 *  when simplification would degenerate it. */
export function simplifyRing(ring: Pt[], tol: number): Pt[] {
  if (ring.length < 5) return ring
  const out = dp([...ring, ring[0]] as Pt[], tol)
  const open = out.slice(0, -1) as Pt[]
  return open.length >= 3 ? open : ring
}

// ── ring shape utilities ────────────────────────────────────────────

/** Strip a closing duplicate vertex, returning an OPEN ring. */
export function openRing(poly: Pt[] | null | undefined): Pt[] {
  if (!Array.isArray(poly) || poly.length < 3) return []
  const f = poly[0]
  const l = poly[poly.length - 1]
  return f && l && f[0] === l[0] && f[1] === l[1] ? (poly.slice(0, -1) as Pt[]) : ([...poly] as Pt[])
}

/** Add a closing duplicate vertex if the ring lacks one. */
export function closeRing(ring: Pt[]): Pt[] {
  if (ring.length < 3) return ring
  const f = ring[0]
  const l = ring[ring.length - 1]
  return f[0] === l[0] && f[1] === l[1] ? ring : [...ring, [f[0], f[1]] as Pt]
}

/** Scale a ring about its own centroid by `factor`. */
export function scaleRing(ring: Pt[], factor: number): Pt[] {
  if (ring.length < 3 || !isFinite(factor) || factor <= 0) return ring
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length
  return ring.map(([x, y]) => [cx + (x - cx) * factor, cy + (y - cy) * factor] as Pt)
}

/** Scale a ring so its area matches `targetAcres`. Area grows with the
 *  square of linear size, hence sqrt. Returns the ring unchanged when
 *  the target or the current area is unusable. */
export function scaleRingToAcres(ring: Pt[], currentAcres: number, targetAcres: number): Pt[] {
  if (!isFinite(targetAcres) || targetAcres <= 0 || currentAcres <= 0) return ring
  return scaleRing(ring, Math.sqrt(targetAcres / currentAcres))
}

/** Translate every vertex by a lng/lat delta (whole-shape move). */
export function translateRing(ring: Pt[], dLng: number, dLat: number): Pt[] {
  return ring.map(([x, y]) => [x + dLng, y + dLat] as Pt)
}
