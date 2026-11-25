/** Owner 2026-11-25: change a tract's number from its row; if another tract
 *  already has that number the two trade numbers. Pure helpers. */

export function tractNum(s: unknown): string | null {
  if (s == null) return null
  if (typeof s === 'number') return Number.isFinite(s) ? String(Math.trunc(s)) : null
  const m = String(s).match(/\d+/)
  return m ? String(parseInt(m[0], 10)) : null
}

/** The calls needed to give tract `index` the number `want`.
 *  Pure, so it can be tested without a network. */
export function renumberSteps(numbers: (string | null)[], index: number, want: string):
  { index: number; number: string }[] {
  const old = tractNum(numbers[index])
  const w = tractNum(want)
  if (!w || w === old) return []
  const other = numbers.findIndex((n, i) => i !== index && tractNum(n) === w)
  if (other < 0) return [{ index, number: w }]
  if (!old) return []   // cannot trade when this tract has no number of its own
  const used = numbers.map(tractNum).filter(Boolean).map(Number)
  const temp = String(Math.max(900, ...used) + 1)
  return [
    { index: other, number: temp },  // park the other tract for a moment
    { index, number: w },
    { index: other, number: old },
  ]
}
