import { formatAuctionTimeInZone } from './auctionTime.ts'
const cases: [string, string, string][] = [
  ['2026-12-03T19:00:00+00:00', 'Iowa', '1:00 PM CST'],          // Klemesrud: UTC stored, Iowa
  ['2026-12-03T19:00:00Z', 'IA', '1:00 PM CST'],
  ['2026-12-03T13:00:00', 'Iowa', '1:00 PM CST'],                // naive wall clock
  ['2027-02-18T18:00:00', 'Indiana', '6:00 PM EST'],              // Wagner naive
  ['2026-11-24T19:00:00+00:00', 'Indiana', '2:00 PM EST'],        // Beckort
  ['2026-07-10T15:00:00Z', 'Minnesota', '10:00 AM CDT'],
  ['2026-12-03T00:00:00', 'Iowa', ''],                            // no time set
]
let bad = 0
for (const [v, st, want] of cases) { const got = formatAuctionTimeInZone(v, st); if (got !== want) bad++; console.log(got === want ? 'PASS' : 'FAIL', v, st, '->', JSON.stringify(got), 'want', want) }
process.exit(bad)
