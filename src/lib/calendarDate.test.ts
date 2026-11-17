// node --experimental-strip-types src/lib/calendarDate.test.ts
import assert from 'node:assert/strict'
import { fmtSaleDate, fmtRowDate } from './calendarDate.ts'

for (const tz of ['America/Chicago', 'America/New_York', 'America/Los_Angeles', 'America/Denver']) {
  process.env.TZ = tz
  assert.equal(fmtSaleDate('2010-12-22'), 'Dec 22, 2010', tz)
  assert.equal(fmtSaleDate('2019-03-27T00:00:00.000Z'), 'Mar 27, 2019', tz)
  assert.equal(fmtSaleDate('2021-05-07T00:00:00+00:00'), 'May 7, 2021', tz)
  assert.equal(fmtRowDate('2021-05-07'), 'May 7, 2021', tz)
}
process.env.TZ = 'America/Chicago'
// A real auction instant keeps the viewer's clock: 6 pm CT Nov 17 = 00:00Z Nov 18.
assert.equal(fmtRowDate('2026-11-18T00:00:00+00:00'), 'Nov 17, 2026')
assert.equal(fmtSaleDate(null), null)
console.log('calendarDate ok')
