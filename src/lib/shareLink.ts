// Encoding for the `area` query param on /go share links (Quick Draw
// shares) and, by extension, on /access once /go redirects there.
//
// FORMAT: standard Google polyline algorithm encoding
// (https://developers.google.com/maps/documentation/utilities/polylinealgorithm),
// precision 1e5 (5 decimal digits — ~1.1m accuracy, plenty for a drawn
// farm-ground boundary), applied to a list of [lat, lng] pairs in order.
// This is the same encoding Google Maps/Directions uses, so it's a single
// well-known algorithm with no library dependency on either side — the
// mobile app should port these two functions verbatim (same var names/
// comments help keep them in sync) rather than reinvent the format.
//
// Why polyline over base64-of-rounded-coords: polyline delta-encodes each
// point against the previous one, so a tight drawn polygon (points close
// together) compresses far better than raw coordinates would. A 100-point
// polygon typically encodes to ~600-900 chars — well under the ~1,500 char
// budget for a shareable link (SMS/iMessage previews degrade past ~2,000).
//
// The encoded string is URL-safe to *carry* as a query value (it round-trips
// through encodeURIComponent/decodeURIComponent like any other string —
// Next's router and fetch('...').searchParams both handle that transparently)
// but is NOT itself restricted to the URL-safe alphabet the way base64url is;
// callers must percent-encode it when building a URL by hand (see
// buildGoLink below, which uses URLSearchParams so this is automatic).

const POLYLINE_PRECISION = 1e5

function encodeSignedNumber(num: number): string {
  let sgn = num << 1
  if (num < 0) sgn = ~sgn
  return encodeUnsignedNumber(sgn)
}

function encodeUnsignedNumber(num: number): string {
  let str = ''
  let n = num
  while (n >= 0x20) {
    str += String.fromCharCode((0x20 | (n & 0x1f)) + 63)
    n >>= 5
  }
  str += String.fromCharCode(n + 63)
  return str
}

/** Encode a list of [lat, lng] pairs into a compact polyline string. */
export function encodeArea(points: [number, number][]): string {
  let prevLatE5 = 0
  let prevLngE5 = 0
  let result = ''
  for (const [lat, lng] of points) {
    const latE5 = Math.round(lat * POLYLINE_PRECISION)
    const lngE5 = Math.round(lng * POLYLINE_PRECISION)
    result += encodeSignedNumber(latE5 - prevLatE5)
    result += encodeSignedNumber(lngE5 - prevLngE5)
    prevLatE5 = latE5
    prevLngE5 = lngE5
  }
  return result
}

/** Decode a polyline string back into a list of [lat, lng] pairs. */
export function decodeArea(encoded: string): [number, number][] {
  const points: [number, number][] = []
  let index = 0
  let lat = 0
  let lng = 0
  const len = encoded.length

  while (index < len) {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dlat = (result & 1) ? ~(result >> 1) : (result >> 1)
    lat += dlat

    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    const dlng = (result & 1) ? ~(result >> 1) : (result >> 1)
    lng += dlng

    points.push([lat / POLYLINE_PRECISION, lng / POLYLINE_PRECISION])
  }

  return points
}

export interface GoLinkParams {
  lat: number
  lng: number
  /** Map zoom level. Optional — /go and /access both fall back to a sane default. */
  z?: number
  /** Set for a Quick-Draw share — an ordered list of [lat, lng] points (not necessarily closed). */
  area?: [number, number][]
  /** Set for a Set-Pin share. Ignored if `area` is also set. */
  pin?: boolean
}

const GO_BASE_URL = 'https://www.groundgoat.com/go'

/**
 * Build a groundgoat.com/go share link. Mirrors the params PinCardSheet.js /
 * DrawAreaStatsCard.js (mobile) construct — keep both in sync with this file.
 */
export function buildGoLink(params: GoLinkParams): string {
  const qs = new URLSearchParams()
  qs.set('lat', params.lat.toFixed(6))
  qs.set('lng', params.lng.toFixed(6))
  if (params.z != null) qs.set('z', String(params.z))
  if (params.area && params.area.length > 0) {
    qs.set('area', encodeArea(params.area))
  } else if (params.pin) {
    qs.set('pin', '1')
  }
  return `${GO_BASE_URL}?${qs.toString()}`
}
