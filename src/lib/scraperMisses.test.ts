/**
 * Standalone test for the Missed tab's data layer — this repo has no
 * jest/vitest harness (see tillable.test.ts), so this is a plain runnable
 * script with a mocked fetch. Run with:
 *   node src/lib/scraperMisses.test.ts
 */
import assert from 'node:assert/strict'
import {
  loadMissed,
  groupMisses,
  needsPersonCount,
  summaryLine,
  reasonLabel,
  nightsFailedText,
  safeHref,
  setMissStatus,
  restoreRejection,
  withMissResolved,
  withRejectionRestored,
  type FetchFn,
  // Node needs the .ts extension to run this file directly; tsc (no
  // allowImportingTsExtensions in this repo) flags it as TS5097.
  // @ts-ignore
} from './scraperMisses.ts'

const API = 'https://api.example.test'

let passed = 0
async function test(name: string, fn: () => void | Promise<void>) {
  await fn()
  passed++
  console.log(`ok - ${name}`)
}

const miss = (over: Record<string, unknown>) => ({
  id: 1,
  level: 'company',
  url: 'https://acme-auctions.example/upcoming',
  company_name: 'Acme Auctions',
  reason: 'company_no_auctions_found',
  detail: null,
  first_seen: '2026-11-20T08:00:00Z',
  last_seen: '2026-11-23T08:00:00Z',
  nights_failed: 3,
  status: 'needs_person',
  ai_note: 'Page needs a login to see the sale list.',
  ai_checked_at: '2026-11-23T08:10:00Z',
  ai_staged_ids: [],
  ...over,
})

const MISSES_JSON = {
  counts: { needs_person: 1, open: 1, ai_staged: 1, resolved: 1 },
  misses: [
    miss({}),
    miss({ id: 2, status: 'open', reason: 'page_blocked', nights_failed: 1, ai_note: null }),
    miss({ id: 3, status: 'ai_staged', ai_note: 'Found 2 auctions.', ai_staged_ids: [10, 11] }),
    miss({ id: 4, status: 'resolved' }),
    miss({ id: 5, status: 'ai_rejected' }),
  ],
  last_run: {
    started_at: '2026-11-23T08:00:00Z',
    finished_at: '2026-11-23T08:20:00Z',
    summary: { companies: 14, read: 12, staged: 5, needs_person: 1, none_upcoming: 6, usd: 0.42 },
  },
  spend_tonight_usd: 0.42,
  cap_usd: 5,
}

const REJECTIONS_JSON = {
  rejections: [
    {
      id: 77,
      source_url: 'https://acme-auctions.example/lot/9',
      reason: 'not_real_estate',
      what_was_sold: 'Farm equipment',
      rejected_at: '2026-11-22T08:05:00Z',
      company_name: 'Acme Auctions',
      title: 'Fall machinery sale',
    },
  ],
  duplicates_caught: [
    {
      source_url: 'https://acme-auctions.example/lot/4',
      reason: 'duplicate',
      rule: 'same_url',
      detail: 'Same auction as staging #812',
      created_at: '2026-11-22T08:06:00Z',
    },
  ],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Mock fetch that records every call. */
function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fn: FetchFn = async (url, init) => {
    calls.push({ url, init })
    return handler(url, init)
  }
  return { fn, calls }
}

async function main() {
  await test('loads both lists from the agreed URLs', async () => {
    const { fn, calls } = mockFetch((url) => (url.includes('/misses') ? json(MISSES_JSON) : json(REJECTIONS_JSON)))
    const data = await loadMissed(fn, API)
    assert.deepEqual(calls.map((c) => c.url).sort(), [
      `${API}/api/admin/scraper/ai-rejections?days=14`,
      `${API}/api/admin/scraper/misses?status=&level=&limit=200`,
    ])
    assert.equal(data.misses?.misses.length, 5)
    assert.equal(data.rejections?.rejections.length, 1)
    assert.equal(data.rejections?.duplicates_caught.length, 1)
  })

  await test('"Needs a person" row carries company, link, plain reason, nights and AI note', async () => {
    const { fn } = mockFetch((url) => (url.includes('/misses') ? json(MISSES_JSON) : json(REJECTIONS_JSON)))
    const data = await loadMissed(fn, API)
    const g = groupMisses(data.misses?.misses)
    assert.equal(g.needsPerson.length, 1)
    const row = g.needsPerson[0]
    assert.equal(row.company_name, 'Acme Auctions')
    assert.equal(safeHref(row.url), 'https://acme-auctions.example/upcoming')
    assert.equal(reasonLabel(row.reason), 'Scraper found no auctions on this page')
    assert.equal(nightsFailedText(row.nights_failed), 'failed 3 nights')
    assert.equal(row.ai_note, 'Page needs a login to see the sale list.')
    assert.deepEqual(g.waiting.map((m) => m.id), [2])
    assert.deepEqual(g.handled.map((m) => m.id), [3, 4])
    assert.equal(needsPersonCount(data.misses), 1)
  })

  await test('summary line', () => {
    assert.equal(
      summaryLine(MISSES_JSON as never),
      'Last night the AI checked 12 company pages, added 5 auctions to staging, and 1 needs a person. AI cost $0.42 of $5.00.',
    )
    assert.equal(summaryLine({ ...MISSES_JSON, last_run: null } as never), 'No AI run yet.')
    assert.equal(summaryLine(null), 'No AI run yet.')
  })

  await test('every reason code has a plain label; unknown codes do not leak', () => {
    assert.equal(reasonLabel('company_all_cards_filtered'), 'Scraper found items but kept none')
    assert.equal(reasonLabel('completeness_gap'), 'Site shows auctions we did not have')
    assert.equal(reasonLabel('page_blocked'), 'Site blocked us')
    assert.equal(reasonLabel('page_no_listing_data'), 'Could not read the auction page')
    assert.equal(reasonLabel('page_no_date'), 'No auction date found')
    assert.equal(reasonLabel('page_error'), 'Scraper error')
    assert.equal(reasonLabel('something_new'), 'Scraper problem')
    assert.equal(nightsFailedText(1), 'failed 1 night')
  })

  await test('only http(s) links are clickable', () => {
    assert.equal(safeHref('javascript:alert(1)'), null)
    assert.equal(safeHref(null), null)
  })

  await test('Done posts status=resolved and the row leaves its section', async () => {
    const { fn, calls } = mockFetch(() => json({ ok: true }))
    const ok = await setMissStatus(fn, API, 1, 'resolved')
    assert.equal(ok, true)
    assert.equal(calls[0].url, `${API}/api/admin/scraper/misses/1/status`)
    assert.equal(calls[0].init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { status: 'resolved' })

    const before = { misses: MISSES_JSON as never, rejections: null }
    const after = withMissResolved(before, 1)
    assert.equal(groupMisses(after.misses?.misses).needsPerson.length, 0)
    assert.equal(needsPersonCount(after.misses), 0)
  })

  await test('Done that fails reports false (row stays)', async () => {
    const { fn } = mockFetch(() => json({ detail: 'nope' }, 500))
    assert.equal(await setMissStatus(fn, API, 1, 'resolved'), false)
    const boom: FetchFn = async () => { throw new TypeError('Failed to fetch') }
    assert.equal(await setMissStatus(boom, API, 1, 'resolved'), false)
  })

  await test('Restore posts to the restore URL and the row leaves the list', async () => {
    const { fn, calls } = mockFetch(() => json({ restored: true }))
    const ok = await restoreRejection(fn, API, 77)
    assert.equal(ok, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, `${API}/api/admin/scraper/ai-rejections/77/restore`)
    assert.equal(calls[0].init?.method, 'POST')

    const after = withRejectionRestored({ misses: null, rejections: REJECTIONS_JSON }, 77)
    assert.equal(after.rejections?.rejections.length, 0)
    assert.equal(after.rejections?.duplicates_caught.length, 1)

    const { fn: notRestored } = mockFetch(() => json({ restored: false }))
    assert.equal(await restoreRejection(notRestored, API, 77), false)
  })

  await test('404 on both endpoints is quiet: no throw, nothing to show', async () => {
    const { fn } = mockFetch(() => json({ detail: 'Not Found' }, 404))
    const data = await loadMissed(fn, API)
    assert.deepEqual(data, { misses: null, rejections: null })
    assert.equal(needsPersonCount(data.misses), 0)
    assert.equal(summaryLine(data.misses), 'No AI run yet.')
  })

  await test('network error is quiet too, and one endpoint can fail alone', async () => {
    const boom: FetchFn = async () => { throw new TypeError('Failed to fetch') }
    assert.deepEqual(await loadMissed(boom, API), { misses: null, rejections: null })

    const { fn } = mockFetch((url) => (url.includes('/misses') ? json(MISSES_JSON) : json({}, 404)))
    const half = await loadMissed(fn, API)
    assert.equal(half.misses?.misses.length, 5)
    assert.equal(half.rejections, null)

    const { fn: badShape } = mockFetch(() => json({ hello: 'world' }))
    const odd = await loadMissed(badShape, API)
    assert.equal(odd.misses, null)
    assert.deepEqual(odd.rejections, { rejections: [], duplicates_caught: [] })
  })

  console.log(`\n${passed} passed`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
