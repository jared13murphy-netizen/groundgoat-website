// node --experimental-strip-types src/lib/stagingCompanyFilter.test.ts
import assert from 'node:assert/strict'
import {
  stagingListQuery, stagingPageSize, parseStagingCompanies, companyOptions, allCompaniesCount,
} from './stagingCompanyFilter.ts'

const ID = '3f2b8c1e-8a0b-4b7e-9a51-2a7d3c4e5f60'
// All Companies: today's 20-per-page view, unchanged.
assert.equal(stagingListQuery(0, null), 'status=pending&listing_type=auction&limit=20&offset=0')
assert.equal(stagingListQuery(3, null), 'status=pending&listing_type=auction&limit=20&offset=60')
// One company: page 0, 200 rows, company_id.
assert.equal(stagingListQuery(0, ID), `status=pending&listing_type=auction&limit=200&offset=0&company_id=${ID}`)
assert.equal(stagingListQuery(0, 'none'), 'status=pending&listing_type=auction&limit=200&offset=0&company_id=none')
assert.equal(stagingListQuery(-1, null), 'status=pending&listing_type=auction&limit=20&offset=0')
assert.equal(stagingPageSize(null), 20)
assert.equal(stagingPageSize(ID), 200)

// Endpoint answer: good shape parsed; anything else -> null (fallback).
const good = [{ id: ID, name: 'Acme', count: 41 }, { id: 'none', name: '(no company)', count: 2 }]
assert.deepEqual(parseStagingCompanies(good), good)
assert.deepEqual(parseStagingCompanies([]), [])
assert.equal(parseStagingCompanies({ detail: 'Not Found' }), null)
assert.equal(parseStagingCompanies(null), null)
assert.equal(parseStagingCompanies([{ name: 'x', count: 1 }]), null)
assert.equal(parseStagingCompanies([{ id: ID, name: 'x', count: '1' }]), null)
assert.deepEqual(parseStagingCompanies([{ id: ID, name: null, count: 1 }]), [{ id: ID, name: '(unnamed company)', count: 1 }])

// Selection kept when its company drops out of the list.
assert.deepEqual(companyOptions(good, ID), good)
assert.deepEqual(companyOptions(good, null), good)
assert.deepEqual(companyOptions([], ID, 'Acme'), [{ id: ID, name: 'Acme', count: 0 }])
assert.equal(allCompaniesCount(good), 43)
console.log('stagingCompanyFilter ok')
