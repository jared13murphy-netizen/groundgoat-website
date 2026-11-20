/**
 * parcelLabel — the map label prints ONLY the server's gg_label_* tile props.
 * Evaluates the real MapLibre expression with the style-spec. Run with
 *   node src/lib/parcelLabel.test.ts
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { parcelLabelSegments } from './parcelLabel.ts'

const require = createRequire(import.meta.url)
const { createExpression } = require('@maplibre/maplibre-gl-style-spec')

let passed = 0
function test(name: string, fn: () => void) { fn(); passed++; console.log(`ok - ${name}`) }

const expr = (dateLead: string) => ['format', ['coalesce', ['get', 'owner'], 'Coming Soon'], {}, ...parcelLabelSegments(dateLead)]

function label(props: Record<string, any>, dateLead = 'Sale Date: '): string {
  const r = createExpression(expr(dateLead), { type: 'formatted' })
  assert.equal(r.result, 'success', JSON.stringify(r.value))
  const v = r.value.evaluate({ zoom: 15 }, { type: 'Polygon', properties: props })
  return v.sections.map((s: any) => s.text).join('')
}

test('per_acre: acres, $/acre and date are the server strings, verbatim', () => {
  assert.equal(
    label({ owner: 'ACME', gg_label_acres: '1,234.57', gg_label_ppa: '$9,644', gg_label_date: '03/14/2025', gg_price_mode: 'per_acre' }),
    'ACME\n1,234.57 ac\n$/Acre: $9,644\nSale Date: 03/14/2025',
  )
})

test('NO client math: tile saleprice / ll_gisacre are ignored', () => {
  assert.equal(label({ owner: 'ACME', saleprice: 1000, ll_gisacre: 10, saledate: '2020-01-01' }), 'ACME')
})

test('no $ line when gg_label_ppa is absent or empty', () => {
  assert.equal(label({ owner: 'A', gg_label_acres: '5.00', gg_label_ppa: '' }), 'A\n5.00 ac')
  assert.equal(label({ owner: 'A', gg_label_acres: '5.00' }), 'A\n5.00 ac')
})

test('price_mode total: the total price line, labelled "Sale Price", no $/Acre', () => {
  assert.equal(
    label({ owner: 'A', gg_label_acres: '5.00', gg_label_ppa: '', gg_label_price: '$117,000', gg_price_mode: 'total', gg_label_date: '01/02/2024' }),
    'A\n5.00 ac\nSale Price: $117,000\nSale Date: 01/02/2024',
  )
})

test('a price is not printed in per_acre mode', () => {
  assert.equal(label({ owner: 'A', gg_label_price: '$117,000', gg_price_mode: 'per_acre' }), 'A')
})

test('dash / empty values draw nothing; date lead differs per map', () => {
  assert.equal(label({ owner: 'A', gg_label_acres: '—', gg_label_date: '' }), 'A')
  assert.equal(label({ owner: 'A', gg_label_date: '05/06/2023' }, 'Sold: '), 'A\nSold: 05/06/2023')
})

test('strings that already carry "ac" / "$" are not doubled', () => {
  assert.equal(label({ owner: 'A', gg_label_acres: '5.00 ac', gg_label_ppa: '9,644' }), 'A\n5.00 ac\n$/Acre: $9,644')
})

console.log(`\n${passed} passed`)
