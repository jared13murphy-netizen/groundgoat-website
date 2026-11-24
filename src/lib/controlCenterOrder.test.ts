/**
 * Standalone test for the Control Center's fixed row order (plain script,
 * Node 22+ strips TS types natively). Run with:
 *   node src/lib/controlCenterOrder.test.ts
 */
import assert from 'node:assert/strict'
import { sortAuctionRows, keepScreenOrder } from './controlCenterOrder.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const row = (id: string, t: string, extra: Record<string, unknown> = {}) => ({ id, auction_datetime: t, ...extra })
const ids = (rows: { id: string }[]) => rows.map(r => r.id)

test('sorts by auction time, then id for auctions at the same time', () => {
  const rows = [row('c', '2026-11-23T16:00:00Z'), row('b', '2026-11-23T15:00:00Z'), row('a', '2026-11-23T16:00:00Z')]
  assert.deepEqual(ids(sortAuctionRows(rows)), ['b', 'a', 'c'])
})

test('server returning same-time rows in a different order does not move them', () => {
  const screen = ['a', 'b', 'c', 'd']
  const fresh = [row('d', '2026-11-23T15:00:00Z'), row('c', '2026-11-23T15:00:00Z'), row('b', '2026-11-23T15:00:00Z'), row('a', '2026-11-23T15:00:00Z')]
  assert.deepEqual(ids(keepScreenOrder(screen, fresh)), screen)
})

test('saved row updates in place (fresh data, same slot)', () => {
  const screen = ['a', 'b', 'c']
  const fresh = [row('b', '2026-11-23T15:00:00Z', { status: 'sold' }), row('a', '2026-11-23T15:00:00Z'), row('c', '2026-11-23T15:00:00Z')]
  const out = keepScreenOrder(screen, fresh)
  assert.deepEqual(ids(out), screen)
  assert.equal((out[1] as { status?: string }).status, 'sold')
})

test('a row whose time changed on the server stays where it is', () => {
  const screen = ['a', 'b', 'c']
  const fresh = [row('a', '2026-11-23T15:00:00Z'), row('b', '2026-11-23T23:00:00Z'), row('c', '2026-11-23T16:00:00Z')]
  assert.deepEqual(ids(keepScreenOrder(screen, fresh)), screen)
})

test('new auction slots into its sorted place; others keep relative order', () => {
  const screen = ['a', 'c', 'e']
  const fresh = [
    row('a', '2026-11-23T15:00:00Z'), row('c', '2026-11-23T16:00:00Z'), row('e', '2026-11-23T18:00:00Z'),
    row('d', '2026-11-23T17:00:00Z'), row('z', '2026-11-23T20:00:00Z'), row('0', '2026-11-23T14:00:00Z'),
  ]
  assert.deepEqual(ids(keepScreenOrder(screen, fresh)), ['0', 'a', 'c', 'd', 'e', 'z'])
})

test('a removed auction drops out without moving the rest', () => {
  const screen = ['a', 'b', 'c']
  const fresh = [row('c', '2026-11-23T15:00:00Z'), row('a', '2026-11-23T15:00:00Z')]
  assert.deepEqual(ids(keepScreenOrder(screen, fresh)), ['a', 'c'])
})

test('missing auction time sorts last, never throws', () => {
  const rows = [{ id: 'x', auction_datetime: null }, row('y', '2026-11-23T15:00:00Z')]
  assert.deepEqual(ids(sortAuctionRows(rows)), ['y', 'x'])
})

console.log(`\n${passed} passed`)
