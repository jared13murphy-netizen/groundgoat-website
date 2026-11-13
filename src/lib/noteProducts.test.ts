/**
 * Firm products on notes (owner 11/12). No test harness in this repo: run with
 *   node src/lib/noteProducts.test.ts
 */
import assert from 'node:assert/strict'
import { productLineText, productDetailParts, productMatches, productFieldLabels } from './noteProducts.ts'

assert.equal(productLineText({ kind: 'fertilizer', name: 'Potash 0-0-60', brand: 'Mosaic', epa_reg_no: '', variety: '', rate: '150 lb/ac' }),
  'Potash 0-0-60 · Mosaic · 150 lb/ac')
assert.equal(productLineText({ kind: 'chemical', name: 'Roundup PowerMAX', brand: 'Bayer', epa_reg_no: '100-497', rate: '32 oz/ac' }),
  'Roundup PowerMAX · Bayer · EPA 100-497 · 32 oz/ac')
// seed shows the variety, never an EPA number
assert.equal(productLineText({ kind: 'seed', name: 'Corn', brand: 'Pioneer', variety: 'P1197', epa_reg_no: 'x', rate: '34k' }),
  'Corn · Pioneer · P1197 · 34k')
// a chemical never shows a variety; blanks drop out
assert.deepEqual(productDetailParts({ kind: 'chemical', name: 'Atrazine', brand: '', variety: 'x', epa_reg_no: '' }), ['Atrazine'])
assert.equal(productLineText({ kind: 'other', name: 'Lime', rate: '  ' }), 'Lime')

assert.ok(productMatches({ kind: 'chemical', name: 'Roundup', brand: 'Bayer', epa_reg_no: '100-497' }, '100-497'))
assert.ok(productMatches({ kind: 'seed', name: 'Corn', brand: 'Pioneer', variety: 'P1197' }, 'pioneer p11'))
assert.ok(!productMatches({ kind: 'seed', name: 'Corn', brand: 'Pioneer', variety: 'P1197' }, 'dekalb'))
assert.ok(productMatches({ kind: 'other', name: 'Lime' }, '  '))

assert.equal(productFieldLabels('seed').extraKey, 'variety')
assert.equal(productFieldLabels('fertilizer').extraKey, 'epa_reg_no')

console.log('noteProducts: all passed')
