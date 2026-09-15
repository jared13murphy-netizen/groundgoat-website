/**
 * Single formatter for every "tillable acres" render on the website.
 *
 * Owner rule (9/9): "whenever we show tillable acres, it always needs to
 * also show % tillable — everywhere on the website." This is the one
 * place that pairs the two so every surface (tract pane, listing pages,
 * comp report, Command Center, admin staging) renders the same text.
 *
 * Resolution order mirrors subjectTillableAcres in ./subjectStats.ts: a
 * present tillable-acres value wins outright (including a genuine 0),
 * falling back to total * pct/100 only when tillable is missing.
 *
 * Deliberately has ZERO local imports (mirrors subjectStats.ts /
 * polygonCentroid.ts) so it — and its .test.ts — stay runnable with a bare
 * `node src/lib/tillable.test.ts`; this repo has no jest/vitest, and
 * Node's ESM loader requires explicit file extensions on relative
 * imports, which breaks a bare `node` run the moment a .ts file imports
 * another extensionless local .ts file. An extension-ed import (e.g.
 * `./format.ts`) would satisfy `node` but trips tsc's TS5097 (this repo's
 * tsconfig doesn't set allowImportingTsExtensions) — so the two tiny
 * helpers below are copied, not imported. `numOrNull` mirrors toNum() in
 * ./format.ts (API DECIMAL columns arrive as strings — see that file's
 * header comment) and `fmtAcres` mirrors formatAcres() there. Keep them
 * in sync if either changes.
 */

/** Same contract as toNum() in ./format.ts — duplicated, not imported; see file header. */
function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** Same contract as formatAcres() in ./format.ts — duplicated, not imported; see file header. */
function fmtAcres(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

export interface TillableFormat {
  /** e.g. "10.92 ac", or "—" when tillable acres can't be resolved. */
  acresText: string
  /** e.g. "52%", or null when it can't be resolved (total missing/zero). */
  pctText: string | null
  /** acresText and pctText joined for inline display: "10.92 ac · 52%",
   *  or just acresText when there's no percent to show. */
  inlineText: string
}

export function formatTillable(
  total: number | string | null | undefined,
  tillable: number | string | null | undefined,
  pct: number | string | null | undefined,
): TillableFormat {
  const totalNum = numOrNull(total)
  const tillableNum = numOrNull(tillable)
  const pctNum = numOrNull(pct)

  const resolvedTillable = tillableNum !== null
    ? tillableNum
    : (totalNum !== null && totalNum > 0 && pctNum !== null ? totalNum * (pctNum / 100) : null)

  const acresText = resolvedTillable !== null ? `${fmtAcres(resolvedTillable)} ac` : '—'

  let pctText: string | null = null
  if (totalNum !== null && totalNum > 0) {
    if (pctNum !== null) {
      pctText = `${Math.round(pctNum)}%`
    } else if (resolvedTillable !== null) {
      pctText = `${Math.round((resolvedTillable / totalNum) * 100)}%`
    }
  }

  const inlineText = resolvedTillable === null
    ? '—'
    : (pctText ? `${acresText} · ${pctText}` : acresText)

  return { acresText, pctText, inlineText }
}
