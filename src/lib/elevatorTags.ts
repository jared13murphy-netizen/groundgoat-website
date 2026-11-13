/**
 * Which elevator price tags to draw so no two overlap (owner 11/10).
 *
 * Two elevators close together (St. Louis Grain) drew their tags on top of
 * each other and the prices mixed. Below TAG_ZOOM the small bin pins all
 * draw. At and above it, greedily keep elevators with fresh bids first and
 * drop any whose tag box would overlap one already kept. Positions are
 * web-mercator points at MapLibre's 512-px world size; the tag sits above its
 * point (anchor bottom), so two boxes overlap when both gaps are under the
 * tag's size. Mirrors the app's src/utils/grainBids.js declutterTags.
 *
 * Pure (no maplibre / DOM) so node can test it: src/lib/elevatorTags.test.ts.
 */

/** Pin below this zoom, price tag at it and above. */
export const TAG_ZOOM = 10
/** Tag geometry in CSS px (drawTag in grainBids.ts draws this). */
export const TAG_W = 104
export const TAG_BODY = 42
export const TAG_POINTER = 9

const WORLD = 512
const mercX = (lng: number, scale: number) => ((lng + 180) / 360) * scale
const mercY = (lat: number, scale: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180)
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale
}

export function declutterTags<T extends { lat: number; lng: number; has_bids?: boolean }>(pins: T[], zoom: number): T[] {
  if (!Array.isArray(pins)) return []
  if (typeof zoom !== 'number' || !isFinite(zoom) || zoom < TAG_ZOOM) return pins
  const scale = WORLD * 2 ** zoom
  const w = TAG_W + 4, h = TAG_BODY + TAG_POINTER + 4
  // Stable sort: fresh bids first, otherwise the server's order.
  const ordered = [...pins].sort((a, b) => (b.has_bids ? 1 : 0) - (a.has_bids ? 1 : 0))
  const kept: { x: number; y: number; p: T }[] = []
  for (const p of ordered) {
    const x = mercX(p.lng, scale), y = mercY(p.lat, scale)
    if (!kept.some(k => Math.abs(k.x - x) < w && Math.abs(k.y - y) < h)) kept.push({ x, y, p })
  }
  return kept.map(k => k.p)
}

/** The pins inside `b` widened by half its size on every side. */
export function pinsInView<T extends { lat: number; lng: number }>(
  pins: T[],
  b: { getSouth(): number; getNorth(): number; getWest(): number; getEast(): number },
): T[] {
  const padLat = (b.getNorth() - b.getSouth()) / 2, padLng = (b.getEast() - b.getWest()) / 2
  const s = b.getSouth() - padLat, n = b.getNorth() + padLat, w = b.getWest() - padLng, e = b.getEast() + padLng
  return pins.filter(p => p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e)
}
