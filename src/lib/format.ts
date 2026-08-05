/**
 * The API sends DECIMAL columns as JSON *strings*, not numbers.
 *
 * Production runs FastAPI 0.109 / pydantic 2.5.3, and pydantic v2 serialises
 * Decimal to a string to preserve precision — so `tracts.tillable_acres`
 * arrives as "59.94", not 59.94. (Newer FastAPI emits numbers, which is why
 * this never reproduces on a fresh local install.)
 *
 * That breaks JS arithmetic silently and in two different ways:
 *
 *   0 + "59.94"                  -> "059.94"   // + concatenates, not adds
 *   ["10.5","20.25"].reduce(...) -> "010.520.25" -> 10.52 after parseFloat
 *
 * The first is the visible "leading zero" bug the owner reported on the
 * Explore-map auction cards (2026-08-04). The second is worse and silent: a
 * multi-tract listing reports a total that is simply wrong, with no clue on
 * screen that anything happened.
 *
 * `toNum` is the single coercion point. Use it anywhere an API numeric field
 * is summed, compared, or formatted. It is deliberately tolerant of the
 * number case too, so it is always safe to wrap a value in it.
 */
export function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function formatAcres(v: number | string | null | undefined): string {
  // NB: the old guard was `isNaN(v)`, which PASSES for the string "59.94" —
  // and String.prototype.toLocaleString ignores the options object entirely
  // and returns the string untouched. That is why "99.00" rendered as
  // "99.00" instead of "99": it was never actually formatted.
  const n = toNum(v)
  if (n === null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}
