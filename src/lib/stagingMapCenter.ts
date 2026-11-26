// Where the Auction Staging map editor opens when a tract has no location.
//
// Owner 2026-11-25: 117 of 353 pending listings opened on a fixed mid-Iowa
// point (Story County) — 102 of them not in Iowa. The scraper now stores a
// VIEW-ONLY `map_center` on a tract with no boundary and no coordinates
// ({latitude, longitude, source, county, state} — scraper app.py
// `_ensure_map_centres`). The editor opens, in order, on:
//   1. the tract boundary (centroid)      — existing behaviour, unchanged
//   2. the tract / listing coordinates    — existing behaviour, unchanged
//   3. the tract's `map_center`
//   4. the listing's `map_center`
//   5. the county centre (static county table, when it has the county)
//   6. the STATE centre (static table below)
//   7. the old fixed default
// `map_center` is never written back as the tract's location — this only
// picks where the camera starts. Pure, no framework imports.

export type LngLat = [number, number]

export interface StagingMapCenterInput {
  /** Active ring of the tract boundary, [lng, lat] points. */
  points?: LngLat[] | null
  latitude?: unknown
  longitude?: unknown
  tractMapCenter?: unknown
  listingMapCenter?: unknown
  county?: string | null
  state?: string | null
  /** County centre lookup: (county name without "County", 2-letter state) →
   *  [lat, lng] or null. Optional so the function stays pure. */
  countyCentre?: (county: string, stateAbbr: string) => [number, number] | null | undefined
}

export type StagingMapCenterSource =
  | 'boundary' | 'coordinates' | 'tract_map_center' | 'listing_map_center'
  | 'county' | 'state' | 'default'

export interface StagingMapCenter {
  lng: number
  lat: number
  zoom: number
  source: StagingMapCenterSource
}

export const DEFAULT_MAP_CENTER: StagingMapCenter = { lng: -93.5, lat: 41.9, zoom: 14, source: 'default' }

// Approximate geographic centres (lat, lng) of the 50 states + DC.
export const STATE_CENTROIDS: Record<string, [number, number]> = {
  AL: [32.8, -86.8], AK: [64.7, -152.0], AZ: [34.3, -111.7], AR: [34.9, -92.4],
  CA: [37.2, -119.5], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5],
  DC: [38.9, -77.03], FL: [28.6, -82.4], GA: [32.7, -83.4], HI: [20.3, -156.4],
  ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.07, -93.5],
  KS: [38.5, -98.4], KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2],
  MD: [39.05, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3],
  MS: [32.7, -89.7], MO: [38.4, -92.5], MT: [47.0, -109.6], NE: [41.5, -99.8],
  NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.2, -74.7], NM: [34.4, -106.1],
  NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.45, -100.5], OH: [40.3, -82.8],
  OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5],
  SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3],
  UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5],
  WV: [38.6, -80.6], WI: [44.6, -89.9], WY: [43.0, -107.6],
}

const STATE_NAMES: Record<string, string> = {
  ALABAMA: 'AL', ALASKA: 'AK', ARIZONA: 'AZ', ARKANSAS: 'AR', CALIFORNIA: 'CA',
  COLORADO: 'CO', CONNECTICUT: 'CT', DELAWARE: 'DE', 'DISTRICT OF COLUMBIA': 'DC',
  FLORIDA: 'FL', GEORGIA: 'GA', HAWAII: 'HI', IDAHO: 'ID', ILLINOIS: 'IL',
  INDIANA: 'IN', IOWA: 'IA', KANSAS: 'KS', KENTUCKY: 'KY', LOUISIANA: 'LA',
  MAINE: 'ME', MARYLAND: 'MD', MASSACHUSETTS: 'MA', MICHIGAN: 'MI', MINNESOTA: 'MN',
  MISSISSIPPI: 'MS', MISSOURI: 'MO', MONTANA: 'MT', NEBRASKA: 'NE', NEVADA: 'NV',
  'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
  'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', OHIO: 'OH', OKLAHOMA: 'OK',
  OREGON: 'OR', PENNSYLVANIA: 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD', TENNESSEE: 'TN', TEXAS: 'TX', UTAH: 'UT', VERMONT: 'VT',
  VIRGINIA: 'VA', WASHINGTON: 'WA', 'WEST VIRGINIA': 'WV', WISCONSIN: 'WI', WYOMING: 'WY',
}

/** "IA", "ia", "Iowa", " iowa " → "IA"; anything else → null. */
export function stateAbbr(state: unknown): string | null {
  if (typeof state !== 'string') return null
  const s = state.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!s) return null
  if (s.length === 2) return STATE_CENTROIDS[s] ? s : null
  return STATE_NAMES[s] ?? null
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** A usable [lng, lat]: finite, in range, and not the 0,0 "null island". */
function valid(lng: number | null, lat: number | null): LngLat | null {
  if (lng === null || lat === null) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  if (lat === 0 && lng === 0) return null
  return [lng, lat]
}

/** Reads a `map_center` in any of the shapes we store:
 *  {latitude, longitude}, {lat, lng}, {lat, lon}, or [lng, lat].
 *  Returns [lng, lat] or null — never throws. */
export function parseMapCenter(mc: unknown): LngLat | null {
  if (!mc) return null
  if (Array.isArray(mc)) {
    if (mc.length < 2) return null
    const a = num(mc[0]), b = num(mc[1])
    if (a === null || b === null) return null
    // [lng, lat] is the stored order; a US [lat, lng] (lat > 0, lng < 0)
    // written the other way round is read the right way, not into the ocean.
    if (a > 0 && a <= 90 && b < 0 && -b > a) return valid(b, a)
    return valid(a, b)
  }
  if (typeof mc === 'object') {
    const o = mc as Record<string, unknown>
    const lat = num(o.latitude ?? o.lat)
    const lng = num(o.longitude ?? o.lng ?? o.lon)
    return valid(lng, lat)
  }
  return null
}

function cleanCounty(county: unknown): string | null {
  if (typeof county !== 'string') return null
  const c = county.trim().replace(/\s+county$/i, '').trim()
  return c || null
}

export function pickStagingMapCenter(input: StagingMapCenterInput): StagingMapCenter {
  const pts = (input.points || []).filter(
    (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (pts.length >= 3) {
    const lng = pts.reduce((s, p) => s + p[0], 0) / pts.length
    const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length
    return { lng, lat, zoom: 16, source: 'boundary' }
  }
  const coords = valid(num(input.longitude), num(input.latitude))
  if (coords) return { lng: coords[0], lat: coords[1], zoom: 16, source: 'coordinates' }

  const st = stateAbbr(input.state)
  // A map_center whose own `state` names a different state than the listing
  // is not trusted (never open on the wrong state).
  const centerState = (mc: unknown): string | null =>
    mc && typeof mc === 'object' && !Array.isArray(mc)
      ? stateAbbr((mc as Record<string, unknown>).state) : null
  const fromCenter = (mc: unknown, source: StagingMapCenterSource): StagingMapCenter | null => {
    const p = parseMapCenter(mc)
    if (!p) return null
    const cs = centerState(mc)
    if (st && cs && cs !== st) return null
    const isState = !!mc && typeof mc === 'object' && !Array.isArray(mc)
      && (mc as Record<string, unknown>).source === 'state_center'
    return { lng: p[0], lat: p[1], zoom: isState ? 6 : 10, source }
  }
  const tc = fromCenter(input.tractMapCenter, 'tract_map_center')
  if (tc) return tc
  const lc = fromCenter(input.listingMapCenter, 'listing_map_center')
  if (lc) return lc

  const county = cleanCounty(input.county)
  if (county && st && input.countyCentre) {
    let hit: [number, number] | null | undefined = null
    try { hit = input.countyCentre(county, st) } catch { hit = null }
    const p = hit ? valid(num(hit[1]), num(hit[0])) : null
    if (p) return { lng: p[0], lat: p[1], zoom: 10, source: 'county' }
  }
  if (st) {
    const [lat, lng] = STATE_CENTROIDS[st]
    return { lng, lat, zoom: 6, source: 'state' }
  }
  return { ...DEFAULT_MAP_CENTER }
}

/** Case-insensitive lookup into a { "County, ST": [lat, lng] } table. */
export function makeCountyCentreLookup(table: Record<string, [number, number]>) {
  const idx = new Map<string, [number, number]>()
  for (const [k, v] of Object.entries(table)) idx.set(k.toLowerCase(), v)
  return (county: string, st: string) => idx.get(`${county}, ${st}`.toLowerCase()) ?? null
}
