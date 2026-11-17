/**
 * Sale dates are calendar days, not moments in time (owner 11/17).
 *
 * `new Date('2010-12-22')` is midnight UTC — 6 pm Dec 21 in Central — so
 * every parcel panel, comp card and popup showed sale dates ONE DAY EARLY
 * (Junk Farms "Dec 21, 2010" while the PDF and map label said Dec 22).
 * A deed's sale date never shifts with the viewer's time zone.
 */
const OPTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' }

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
// Regrid tiles/API send a deed date as midnight UTC ("2019-03-27T00:00:00.000Z").
const MIDNIGHT_UTC = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.0+)?(?:Z|\+00:?00)?$/

function calendarParts(s: string, allowMidnightUtc: boolean): [number, number, number] | null {
  const m = DATE_ONLY.exec(s) || (allowMidnightUtc ? MIDNIGHT_UTC.exec(s) : null)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** A deed/parcel sale date ('YYYY-MM-DD' or midnight-UTC ISO) → "Dec 22, 2010". */
export function fmtSaleDate(s: unknown): string | null {
  if (!s) return null
  const str = String(s).trim()
  const p = calendarParts(str, true)
  if (p) return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', OPTS)
  const d = new Date(str)
  return isNaN(d.getTime()) ? str : d.toLocaleDateString('en-US', OPTS)
}

/**
 * A row date that may be either a calendar day ('YYYY-MM-DD', parcel sales)
 * or a real instant (an auction's start time, full ISO with time) → "Dec 22, 2010".
 * Only a bare date is treated as a calendar day; an instant keeps the viewer's clock.
 */
export function fmtRowDate(s: unknown): string | null {
  if (!s) return null
  const str = String(s).trim()
  const p = calendarParts(str, false)
  if (p) return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', OPTS)
  const d = new Date(str)
  return isNaN(d.getTime()) ? str : d.toLocaleDateString('en-US', OPTS)
}
