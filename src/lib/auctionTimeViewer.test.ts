// node --experimental-strip-types src/lib/auctionTimeViewer.test.ts
import assert from 'node:assert/strict'
import {
  formatAuctionDateForViewer,
  formatAuctionTimeForViewer,
  formatAuctionDateTimeForViewer,
} from './auctionTime.ts'

const LONG = { month: 'long', day: 'numeric', year: 'numeric' } as const
const fmt = (v: string, st?: string) => formatAuctionDateTimeForViewer(v, st)

// UTC instant -> Central viewer (CST, winter). 21:00Z = 3:00 PM CST.
process.env.TZ = 'America/Chicago'
assert.equal(fmt('2026-12-03T21:00:00Z', 'NY'), 'Dec 3, 2026 at 3:00 PM CST')
assert.equal(fmt('2026-12-03T21:00:00+00:00', 'NY'), 'Dec 3, 2026 at 3:00 PM CST')
assert.equal(formatAuctionDateTimeForViewer('2026-12-03T21:00:00Z', 'NY', LONG), 'December 3, 2026 at 3:00 PM CST')

// Same instant -> Pacific viewer.
process.env.TZ = 'America/Los_Angeles'
assert.equal(fmt('2026-12-03T21:00:00Z', 'NY'), 'Dec 3, 2026 at 1:00 PM PST')

// Naive value = wall clock in the auction STATE's zone. 4:00 PM New York -> 3:00 PM Central.
process.env.TZ = 'America/Chicago'
assert.equal(fmt('2026-12-03T16:00:00', 'NY'), 'Dec 3, 2026 at 3:00 PM CST')
// Naive Central state for a Central viewer is unchanged.
assert.equal(fmt('2026-12-03T13:00:00', 'IA'), 'Dec 3, 2026 at 1:00 PM CST')
// Naive Eastern evening can land on the next/previous day for a western viewer.
process.env.TZ = 'America/Los_Angeles'
assert.equal(fmt('2026-12-03T22:00:00', 'OH'), 'Dec 3, 2026 at 7:00 PM PST')
assert.equal(fmt('2026-12-03T01:00:00', 'OH'), 'Dec 2, 2026 at 10:00 PM PST')

// Midnight in the auction's zone = no time: date only, the auction's own day.
process.env.TZ = 'America/Los_Angeles'
assert.equal(fmt('2026-12-03T00:00:00', 'NY'), 'Dec 3, 2026')
assert.equal(fmt('2026-12-03T06:00:00Z', 'IA'), 'Dec 3, 2026') // 00:00 CST
assert.equal(formatAuctionTimeForViewer('2026-12-03T06:00:00Z', 'IA'), '')
// ...but 00:00 UTC is 6 PM Central, a real time.
process.env.TZ = 'America/Chicago'
assert.equal(fmt('2026-12-04T00:00:00Z', 'IA'), 'Dec 3, 2026 at 6:00 PM CST')

// Bare dates are calendar days and never shift.
process.env.TZ = 'Pacific/Honolulu'
assert.equal(fmt('2026-12-03', 'NY'), 'Dec 3, 2026')
assert.equal(formatAuctionDateForViewer('2026-12-03', null), 'Dec 3, 2026')

// DST: summer date shows daylight abbreviations; naive NY wall clock across DST.
process.env.TZ = 'America/Chicago'
assert.equal(fmt('2026-07-15T20:00:00Z', 'NY'), 'Jul 15, 2026 at 3:00 PM CDT')
assert.equal(fmt('2026-07-15T16:00:00', 'NY'), 'Jul 15, 2026 at 3:00 PM CDT')
// Spring-forward day (Mar 8 2026): 10:00 AM EDT = 9:00 AM CDT.
assert.equal(fmt('2026-03-08T10:00:00', 'NY'), 'Mar 8, 2026 at 9:00 AM CDT')
// Fall-back day (Nov 1 2026): 10:00 AM EST = 9:00 AM CST.
assert.equal(fmt('2026-11-01T10:00:00', 'NY'), 'Nov 1, 2026 at 9:00 AM CST')

// Bad / empty input.
assert.equal(fmt('not a date', 'NY'), '—')
assert.equal(formatAuctionTimeForViewer(null, 'NY'), '')
assert.equal(formatAuctionDateForViewer(undefined, 'NY'), '—')

console.log('auctionTimeViewer ok')
