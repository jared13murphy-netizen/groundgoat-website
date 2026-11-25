/**
 * Auction time formatting — always renders in the AUCTION's local timezone
 * (determined from its 2-letter state code), not the viewer's. A farm
 * auction in Iowa should always display as Central Time with a "CDT"/"CST"
 * label so a viewer anywhere in the world knows when to show up.
 *
 * The backend stores auction_date as TIMESTAMP WITH TIME ZONE (UTC) and
 * serializes it as an ISO 8601 Z-suffixed string. This module converts
 * that UTC string into the auction's local timezone for display.
 */

const STATE_TO_TZ: Record<string, string> = {
  // Central
  AL: 'America/Chicago',
  AR: 'America/Chicago',
  IA: 'America/Chicago',
  IL: 'America/Chicago',
  KS: 'America/Chicago',
  KY: 'America/Chicago', // most of KY is Eastern but default Central — see note
  LA: 'America/Chicago',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  ND: 'America/Chicago',
  NE: 'America/Chicago',
  OK: 'America/Chicago',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  WI: 'America/Chicago',
  // Eastern
  CT: 'America/New_York',
  DC: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  IN: 'America/Indiana/Indianapolis',
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  MI: 'America/Detroit',
  NC: 'America/New_York',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NY: 'America/New_York',
  OH: 'America/New_York',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WV: 'America/New_York',
  // Mountain
  CO: 'America/Denver',
  ID: 'America/Denver', // parts of ID are Pacific; default Mountain
  MT: 'America/Denver',
  NM: 'America/Denver',
  UT: 'America/Denver',
  WY: 'America/Denver',
  AZ: 'America/Phoenix', // no DST
  // Pacific
  CA: 'America/Los_Angeles',
  NV: 'America/Los_Angeles',
  OR: 'America/Los_Angeles',
  WA: 'America/Los_Angeles',
  // Non-contiguous
  AK: 'America/Anchorage',
  HI: 'Pacific/Honolulu',
}

function tzForState(state?: string | null): string | undefined {
  if (!state) return undefined
  return STATE_TO_TZ[state.toUpperCase()]
}

/** Format the date portion in the auction's local timezone — "April 24, 2026". */
export function formatAuctionDate(
  dateString?: string | null,
  state?: string | null,
): string {
  if (!dateString) return '—'
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return '—'
  const opts: Intl.DateTimeFormatOptions = {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }
  const tz = tzForState(state)
  if (tz) opts.timeZone = tz
  return date.toLocaleDateString('en-US', opts)
}

/**
 * Format the time portion in the auction's local timezone with a short TZ
 * label — "10:00 AM CDT". Returns '' for midnight-exactly (no time set) or
 * for invalid input.
 */
export function formatAuctionTime(
  dateString?: string | null,
  state?: string | null,
): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  if (isNaN(date.getTime())) return ''

  const tz = tzForState(state)

  // Skip midnight-exactly — that's our convention for "no time provided"
  // (the scraper defaults to 00:00:00 UTC when only a date is known).
  const hourStr = date.toLocaleString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(tz ? { timeZone: tz } : {}),
  })
  if (hourStr === '00:00' || hourStr === '24:00') return ''

  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }
  if (tz) opts.timeZone = tz
  return date.toLocaleTimeString('en-US', opts)
}

/** Combined "April 24, 2026 at 10:00 AM CDT". */
export function formatAuctionDateTime(
  dateString?: string | null,
  state?: string | null,
): string {
  const d = formatAuctionDate(dateString, state)
  if (d === '—') return '—'
  const t = formatAuctionTime(dateString, state)
  return t ? `${d} at ${t}` : d
}

const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO',
  connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY',
  louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND',
  ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
}

/** 'Iowa' / 'iowa' / 'IA' -> 'IA' (null when unknown). */
export function stateAbbr(state?: string | null): string | null {
  if (!state) return null
  const t = String(state).trim()
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase()
  return STATE_NAME_TO_ABBR[t.toLowerCase()] || null
}

/**
 * Staging (owner 11/25): show the auction's time in ITS OWN time zone with
 * the zone named — "1:00 PM CST". A value with an offset/Z is an instant
 * (converted to the state's zone); a naive "…T13:00:00" is already the
 * auction's wall-clock time (shown as is, zone label added).
 */
export function formatAuctionTimeInZone(value?: string | null, state?: string | null): string {
  if (!value) return ''
  const s = String(value)
  const tz = tzForState(stateAbbr(state))
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(s)
  if (hasOffset) return formatAuctionTime(s, stateAbbr(state))
  const m = s.match(/T(\d{2}):(\d{2})/)
  if (!m) return ''
  const h = parseInt(m[1], 10)
  if (h === 0 && m[2] === '00') return ''
  const label = `${h % 12 || 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`
  if (!tz) return label
  // Zone abbreviation for that calendar day (CST vs CDT).
  const day = new Date(s.slice(0, 10) + 'T12:00:00Z')
  const zone = isNaN(day.getTime()) ? '' : (new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(day).find((p) => p.type === 'timeZoneName')?.value || '')
  return zone ? `${label} ${zone}` : label
}
