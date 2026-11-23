/**
 * Goat Search result dots (owner 11/23): owner-name, street-address and
 * PLSS-section searches all land on the 'owner-parcels' source. Each dot
 * carries a `kind` so the searched address, same-mailing-address parcels
 * and plain results draw differently. Pure helpers so they can be tested
 * with `node src/lib/ownerSearchDots.test.ts` (no harness in this repo).
 */

export type OwnerDotKind = 'owner' | 'mailing' | 'address' | 'section'

export interface OwnerDotInput {
  id: string
  lat: number
  lng: number
  acres: number
  kind?: OwnerDotKind | string | null
  path?: string | null
  owner?: string | null
}

// Same value as LayersPanel's SEARCH_RESULT_COLOR (kept here so this file
// has no React imports and runs under plain node).
export const OWNER_DOT_DEFAULT_COLOR = '#8B3DFF'
export const OWNER_DOT_ADDRESS_COLOR = '#5B21B6'
export const OWNER_DOT_MAILING_COLOR = '#C084FC'
export const OWNER_DOT_MAILING_STROKE = '#6D28D9'

const KINDS: OwnerDotKind[] = ['owner', 'mailing', 'address', 'section']

export function ownerDotKind(kind: unknown): OwnerDotKind {
  return KINDS.includes(kind as OwnerDotKind) ? (kind as OwnerDotKind) : 'owner'
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** ll_uuid for the parcel panel: only a real UUID that came with a Regrid
 *  path (bulk ids). Anything else -> null so the panel resolves by point. */
export function ownerDotLlUuid(id: unknown, path: unknown): string | null {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null
  if (typeof path !== 'string' || !path) return null
  return id
}

export function buildOwnerParcelFeatures(dots: OwnerDotInput[]): GeoJSON.Feature<GeoJSON.Point>[] {
  return dots.map(d => {
    const kind = ownerDotKind(d.kind)
    return {
      type: 'Feature' as const,
      properties: {
        id: d.id,
        acres: d.acres,
        kind,
        path: d.path || null,
        owner: d.owner || null,
        // Higher draws on top: the searched address over everything.
        sort: kind === 'address' ? 2 : kind === 'mailing' ? 1 : 0,
      },
      geometry: { type: 'Point' as const, coordinates: [d.lng, d.lat] },
    }
  })
}

export function ownerDotKindsPresent(dots: OwnerDotInput[]): { address: boolean; mailing: boolean } {
  let address = false
  let mailing = false
  for (const d of dots) {
    const k = ownerDotKind(d.kind)
    if (k === 'address') address = true
    else if (k === 'mailing') mailing = true
  }
  return { address, mailing }
}

const KIND = ['get', 'kind']

/** Data-driven circle paint for 'owner-parcels-dots'. */
export function ownerDotPaint(): Record<string, unknown> {
  // A zoom expression must be the TOP-level interpolate — nesting it in a
  // 'case' makes addLayer throw, and the dots never draw (sandbox 11/23).
  const isAddress = ['==', KIND, 'address']
  return {
    'circle-radius': ['interpolate', ['linear'], ['zoom'],
      9, ['case', isAddress, 8, 4],
      14, ['case', isAddress, 11, 7]],
    'circle-color': ['match', KIND,
      'address', OWNER_DOT_ADDRESS_COLOR,
      'mailing', OWNER_DOT_MAILING_COLOR,
      OWNER_DOT_DEFAULT_COLOR],
    'circle-stroke-color': ['match', KIND,
      'mailing', OWNER_DOT_MAILING_STROKE,
      '#ffffff'],
    'circle-stroke-width': ['match', KIND,
      'address', 3,
      'mailing', 2,
      1.5],
  }
}

/** Legend rows shown while a Goat Search result is on the map. */
export function ownerSearchLegendRows(kinds: { address: boolean; mailing: boolean }): { label: string; color: string }[] {
  return [
    { label: 'Search results', color: OWNER_DOT_DEFAULT_COLOR },
    ...(kinds.address ? [{ label: 'Searched address', color: OWNER_DOT_ADDRESS_COLOR }] : []),
    ...(kinds.mailing ? [{ label: 'Same mailing address', color: OWNER_DOT_MAILING_COLOR }] : []),
  ]
}

/** [[w,s],[e,n]] of a Polygon/MultiPolygon, or null. */
export function outlineBounds(g: GeoJSON.Geometry | null | undefined): [[number, number], [number, number]] | null {
  if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const poly of polys) for (const ring of poly) for (const [x, y] of ring) {
    if (x < w) w = x
    if (x > e) e = x
    if (y < s) s = y
    if (y > n) n = y
  }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null
}
