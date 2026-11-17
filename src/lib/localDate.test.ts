// node --experimental-strip-types src/lib/localDate.test.ts
import assert from 'node:assert/strict'
import { localIsoDate } from './localDate.ts'

process.env.TZ = 'America/Chicago'
// 7:30 pm Central on Nov 17 = 01:30 UTC Nov 18; the user's day is the 17th.
const evening = new Date(Date.UTC(2026, 10, 18, 1, 30))
assert.equal(evening.toISOString().split('T')[0], '2026-11-18')
assert.equal(localIsoDate(evening), '2026-11-17')
assert.equal(localIsoDate(new Date(2026, 0, 5)), '2026-01-05')
console.log('localDate ok')
