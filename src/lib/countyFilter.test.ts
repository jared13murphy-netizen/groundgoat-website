// node --experimental-strip-types src/lib/countyFilter.test.ts
import assert from 'node:assert/strict'
import { countyFilterMatches, splitCountyFilter } from './countyFilter.ts'

assert.deepEqual(splitCountyFilter('Adams (IL)'), { county: 'Adams', state: 'IL' })
assert.deepEqual(splitCountyFilter('Lee|ia'), { county: 'Lee', state: 'IA' })
assert.deepEqual(splitCountyFilter('St. Clair'), { county: 'St. Clair', state: null })
const pairs = ['Adams (IL)', 'Lee (IA)']
assert.equal(countyFilterMatches(pairs, 'Adams', 'IL'), true)
assert.equal(countyFilterMatches(pairs, 'adams', 'IA'), false)
assert.equal(countyFilterMatches(pairs, 'Lee', 'IL'), false)
assert.equal(countyFilterMatches(pairs, 'Lee', 'IA'), true)
assert.equal(countyFilterMatches(['Adams'], 'Adams', 'IN'), true)
console.log('countyFilter ok')
