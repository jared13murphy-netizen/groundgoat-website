/**
 * The user's own calendar day (owner 2026-11-17: "goat search should always
 * use the user's time zone").
 *
 * `new Date().toISOString().split('T')[0]` is the UTC date — after 6 pm
 * Central it is already tomorrow, so "Upcoming" hid that evening's auctions.
 * Every date the website sends to the API comes from here; the browser's
 * zone rides along as X-Timezone (lib/timezoneHeader) so the backend reads
 * those dates as the user's day.
 */
export function localIsoDate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
