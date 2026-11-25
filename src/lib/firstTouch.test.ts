/**
 * First-touch sign-up source. Run with:
 *   node src/lib/firstTouch.test.ts
 */
import assert from 'node:assert/strict'
import { deriveFirstTouch, captureFirstTouch, firstTouchForSignup, cleanTag } from './firstTouch.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
}
const DAY = 24 * 60 * 60 * 1000

test('utm_source wins and is cleaned', () => {
  assert.deepEqual(deriveFirstTouch('?utm_source=Facebook Ads&utm_medium=cpc&utm_campaign=Fall_26', ''),
    { source: 'facebook_ads', medium: 'cpc', campaign: 'fall_26' })
})

test('click ids map to their platform', () => {
  assert.equal(deriveFirstTouch('?fbclid=abc', '')?.source, 'facebook')
  assert.equal(deriveFirstTouch('?ttclid=abc', '')?.source, 'tiktok')
  assert.equal(deriveFirstTouch('?li_fat_id=abc', '')?.source, 'linkedin')
  assert.equal(deriveFirstTouch('?gclid=abc', '')?.source, 'google')
  assert.equal(deriveFirstTouch('?gclid=abc', '')?.medium, 'cpc')
})

test('referrer host maps to a platform; our own site and strangers do not', () => {
  assert.equal(deriveFirstTouch('', 'https://l.facebook.com/l.php?u=x')?.source, 'facebook')
  assert.equal(deriveFirstTouch('', 'https://l.instagram.com/')?.source, 'instagram')
  assert.equal(deriveFirstTouch('', 'https://www.tiktok.com/@x')?.source, 'tiktok')
  assert.equal(deriveFirstTouch('', 'https://www.linkedin.com/feed')?.source, 'linkedin')
  assert.equal(deriveFirstTouch('', 'https://www.google.co.uk/')?.source, 'google')
  assert.equal(deriveFirstTouch('', 'https://www.groundgoat.com/auctions'), null)
  assert.equal(deriveFirstTouch('', 'https://example.org/'), null)
  assert.equal(deriveFirstTouch('', ''), null)
})

test('first touch is stored once and never overwritten', () => {
  const s = memory()
  captureFirstTouch(s, '?utm_source=tiktok', '', '', 1000)
  captureFirstTouch(s, '?utm_source=google', '', '', 2000)
  assert.equal(firstTouchForSignup(s, 3000).signup_source, 'tiktok')
})

test('a visit with no signal stores nothing, so a later one can', () => {
  const s = memory()
  captureFirstTouch(s, '', '', '', 1000)
  assert.deepEqual(firstTouchForSignup(s, 1500), {})
  captureFirstTouch(s, '?gclid=1', '', '', 2000)
  assert.equal(firstTouchForSignup(s, 2500).signup_source, 'google')
})

test('expires after 30 days, then a new first touch can be stored', () => {
  const s = memory()
  captureFirstTouch(s, '?utm_source=facebook', '', '', 0)
  assert.equal(firstTouchForSignup(s, 29 * DAY).signup_source, 'facebook')
  assert.deepEqual(firstTouchForSignup(s, 31 * DAY), {})
  captureFirstTouch(s, '?utm_source=linkedin', '', '', 31 * DAY)
  assert.equal(firstTouchForSignup(s, 32 * DAY).signup_source, 'linkedin')
})

test('blocked or corrupt storage never throws', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  captureFirstTouch(broken, '?utm_source=x')
  assert.deepEqual(firstTouchForSignup(broken), {})
  const bad = memory(); bad.setItem('gg_first_touch', '{nope')
  assert.deepEqual(firstTouchForSignup(bad), {})
})

test('cleanTag keeps the backend alphabet and length', () => {
  assert.equal(cleanTag('A b/C'), 'a_b_c')
  assert.equal(cleanTag('x'.repeat(60)).length, 40)
})

console.log(`${passed} passed`)
