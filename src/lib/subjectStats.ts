/**
 * Pure helpers for the "Subject Tract" strip on comp reports (the strip
 * that must be pixel-identical, in content and order, to the owner-approved
 * PDF: Total Acres, Tillable Acres, % Tillable, then the record's own
 * soil-rating tile).
 *
 * Kept dependency-free of React/formatting on purpose — callers decide how
 * to render a `null` result (e.g. "—") vs. a real number (e.g. "0.0").
 *
 * Deliberately has ZERO local imports (mirrors polygonCentroid.ts) so it —
 * and its .test.ts — stay runnable with a bare `node src/lib/subjectStats.test.ts`;
 * this repo has no jest/vitest, and Node's ESM loader requires explicit file
 * extensions on relative imports, which breaks a bare `node` run the moment
 * a .ts file imports another extensionless local .ts file. `numOrNull`
 * below mirrors the null/''/NaN handling of the canonical coercion point,
 * `toNum` in ./format.ts (API DECIMAL columns arrive as strings) — see that
 * file's header comment. Keep the two in sync if either changes.
 */

/** Same contract as toNum() in ./format.ts — duplicated, not imported; see file header. */
function numOrNull(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Resolve tillable acres for the subject tract.
 *
 * Precedence: a present tillable-acres value (including a genuine 0) wins
 * outright. Only when it's null/undefined do we fall back to
 * total * pct/100. Returns null when neither source can produce a number.
 *
 * `!n` truthiness checks are the wrong tool here — they treat a real 0
 * (0% tillable) the same as missing data. Use explicit numeric coercion
 * instead so 0 survives.
 */
export function subjectTillableAcres(
  total: number | string | null | undefined,
  tillable: number | string | null | undefined,
  pct: number | string | null | undefined,
): number | null {
  const t = numOrNull(tillable)
  if (t !== null) return t

  const totalNum = numOrNull(total)
  const pctNum = numOrNull(pct)
  if (totalNum === null || pctNum === null) return null
  return totalNum * (pctNum / 100)
}

// Soil-rating index labels (PI / CSR2 / WAPI / NCCPI / CPI) now come from
// each record's own `soil_rating_type` field via src/lib/soilRatingLabel.ts
// — never from a state guess. See that file's header for why.
