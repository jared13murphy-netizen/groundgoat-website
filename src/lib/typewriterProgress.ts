/**
 * Typewriter reveal progress for the Goat Analysis answer (MapChatPanel.tsx).
 *
 * Ported from the mobile app's src/utils/typewriterProgress.js, which
 * fixed an owner-reported incident (2026-09-09, TestFlight 2.1.4 build
 * 1785710777): a Goat Analysis answer stopped typing mid-word ("5. Type:
 * Parcel sal") with the cursor still showing and never finished, even
 * though the backend's response was complete. Root cause: the old
 * typewriter counted a fixed number of characters per FIRED setInterval
 * tick (12ms cadence) with no elapsed-time correction and no way to
 * detect or recover from a stalled/dropped tick. The analytics response
 * lands in the same state update that can synchronously trigger a heavy
 * map filter reload, which competes for the same JS thread as the 12ms
 * interval; a tick lost to that contention was lost forever under the
 * old design — there was no way to catch up.
 *
 * Fix: derive typedChars from ELAPSED TIME against the answer's CURRENT
 * length, not from how many ticks have fired. A late tick just computes
 * a larger elapsed time and jumps straight to the correct position
 * instead of resuming one fixed step past wherever a dropped tick left
 * off — the reveal is correct by construction regardless of how the
 * interval's cadence actually plays out. MapChatPanel additionally runs a
 * defense-in-depth guard timer that force-finishes the text if the
 * interval ever dies early for any other reason (see the effect there).
 */

export interface TypewriterRateOptions {
  maxDurationMs?: number
  minRatePerMs?: number
}

// Matches the historical minimum reveal pace: 2 characters per 12ms tick
// (the old design's floor for short answers, so they read as a
// comfortable gentle reveal instead of being stretched to fill the full
// duration budget below).
const DEFAULT_MIN_RATE_PER_MS = 2 / 12

// A long answer (the row list is uncapped — a big analytics comparison
// can run to thousands of characters) always finishes within this
// budget, regardless of length.
const DEFAULT_MAX_DURATION_MS = 4000

/**
 * Characters-per-millisecond reveal rate for an answer of `totalLength`
 * characters: fast enough that even the longest answer finishes within
 * `maxDurationMs`, but never slower than `minRatePerMs` (so a short
 * answer isn't stretched out).
 */
export function typewriterRate(totalLength: number, opts: TypewriterRateOptions = {}): number {
  const { maxDurationMs = DEFAULT_MAX_DURATION_MS, minRatePerMs = DEFAULT_MIN_RATE_PER_MS } = opts
  if (!Number.isFinite(totalLength) || totalLength <= 0) return 0
  return Math.max(minRatePerMs, totalLength / maxDurationMs)
}

/** How long (ms) the full reveal takes at typewriterRate's pace. */
export function typewriterDurationMs(totalLength: number, opts: TypewriterRateOptions = {}): number {
  const rate = typewriterRate(totalLength, opts)
  if (rate <= 0) return 0
  return totalLength / rate
}

/**
 * How many characters of a `totalLength`-character answer should be
 * visible after `elapsedMs` of reveal time. Pure function of (elapsed,
 * total) — call it fresh on every tick (or animation frame) with the
 * REAL elapsed time and the CURRENT answer length; never accumulate a
 * per-tick step, or a missed tick becomes permanently lost progress.
 */
export function computeTypedChars(elapsedMs: number, totalLength: number, opts: TypewriterRateOptions = {}): number {
  if (!Number.isFinite(totalLength) || totalLength <= 0) return 0
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0
  const rate = typewriterRate(totalLength, opts)
  return Math.min(totalLength, Math.round(elapsedMs * rate))
}
