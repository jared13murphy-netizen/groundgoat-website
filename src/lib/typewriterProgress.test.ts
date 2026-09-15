/**
 * computeTypedChars / typewriterRate / typewriterDurationMs — the Goat
 * Analysis typewriter's reveal-progress math (MapChatPanel.tsx).
 *
 * Bug this guards against (owner incident 2026-09-09, ported from the
 * mobile app's src/utils/typewriterProgress.test.mjs): the old
 * typewriter counted a fixed number of characters per FIRED
 * setInterval tick, with no elapsed-time correction — a single
 * dropped/delayed tick (e.g. a concurrent map filter reload starving
 * the JS thread) could leave the reveal permanently stuck mid-word.
 * This module derives progress from elapsed time against the answer's
 * CURRENT length, so a late computation always catches straight up to
 * the correct position.
 *
 * This repo has no jest/vitest harness (see polygonCentroid.test.ts).
 * Run with:
 *   node src/lib/typewriterProgress.test.ts
 */
import assert from 'node:assert/strict'
import { computeTypedChars, typewriterRate, typewriterDurationMs } from './typewriterProgress.ts'

let passed = 0
function test(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`ok - ${name}`)
}

test('zero elapsed time reveals nothing', () => {
  assert.equal(computeTypedChars(0, 100), 0)
})

test('zero or negative total length reveals nothing (no divide-by-zero/NaN)', () => {
  assert.equal(computeTypedChars(1000, 0), 0)
  assert.equal(computeTypedChars(1000, -5), 0)
})

test('a long answer finishes within the 4000ms budget, not before', () => {
  const total = 3340 // well past the min-rate crossover
  assert.equal(computeTypedChars(4000, total), total)
  assert.ok(computeTypedChars(3999, total) < total)
})

test('a short answer reveals at the historical minimum pace (2 chars / 12ms), finishing well under the 4s budget', () => {
  const total = 20 // short — under the ~667-char crossover
  const finishMs = typewriterDurationMs(total)
  assert.ok(finishMs < 4000, `expected a short answer to finish well under 4000ms, got ${finishMs}`)
  assert.equal(computeTypedChars(finishMs, total), total)
})

test('progress never exceeds the total even with an overshot elapsed time', () => {
  const total = 500
  assert.equal(computeTypedChars(10_000, total), total)
})

test('a late/delayed computation catches straight up to the real elapsed position — no lost progress from a skipped tick', () => {
  // Simulates a dropped tick: elapsed jumps from 100ms to 3000ms in one
  // step (the JS thread was starved in between). The later computation
  // must reflect the REAL elapsed time, not one fixed step past the
  // earlier value — this is the actual fix for the reported bug.
  const total = 3340
  const early = computeTypedChars(100, total)
  const late = computeTypedChars(3000, total)
  assert.ok(late > early + 100, `expected the late computation to reflect the skipped time (early=${early}, late=${late})`)
})

test('typewriterRate never drops below the historical minimum (2 chars per 12ms)', () => {
  assert.ok(typewriterRate(1) >= 2 / 12)
})

test('typewriterRate is 0 for an empty/invalid answer (no infinite/NaN duration)', () => {
  assert.equal(typewriterRate(0), 0)
  assert.equal(typewriterDurationMs(0), 0)
})

console.log(`\n${passed} passed`)
