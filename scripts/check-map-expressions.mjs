/**
 * Compile every MapLibre style expression in ExploreMap.tsx and fail if any
 * one of them is invalid.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-22 the $/Acre section was removed from the Regrid parcel label.
 * A `format` expression takes strictly ALTERNATING arguments — input, options,
 * input, options — and the edit deleted the input but left BOTH surrounding
 * `{ 'font-scale': 1.0 }` options objects. MapLibre rejected the whole
 * expression, the layer never built, and EVERY Regrid parcel disappeared from
 * the live Explore map for two days.
 *
 * `tsc` passed the entire time, and it always will: to TypeScript these
 * expressions are just nested arrays of strings and objects. There is no type
 * error to find. The only thing that can catch it is MapLibre's own compiler,
 * which is what this runs.
 *
 *   node scripts/check-map-expressions.mjs
 */
import { readFileSync } from 'node:fs';
import { createExpression } from '@maplibre/maplibre-gl-style-spec';

const SRC = 'src/components/map/ExploreMap.tsx';
const src = readFileSync(SRC, 'utf8');

// Pull out every ['format', ...] and ['concat', ...] literal. Comments are
// stripped first: they are the reason the broken pair was easy to miss by eye.
const clean = src.replace(/^\s*\/\/.*$/gm, '');

let checked = 0, failed = 0, skipped = 0;
// Whitespace-tolerant. The second version of this script searched for the
// literal "['format'," and found nothing, because the label in question is
// written as:
//     'text-field': [
//       'format',
// with a newline after the bracket. It reported "0 invalid" twice while the
// map was demonstrably broken. Match the bracket and the operator separately.
for (const kind of ['format', 'concat', 'case', 'coalesce']) {
  const re = new RegExp(`\\[\\s*'${kind}'\\s*,`, 'g');
  let m;
  while ((m = re.exec(clean)) !== null) {
    const i = m.index;
    // Walk brackets to find the matching close, skipping quoted strings.
    let depth = 0, j = i, q = null;
    for (; j < clean.length; j++) {
      const c = clean[j];
      if (q) { if (c === q && clean[j - 1] !== '\\') q = null; continue; }
      if (c === "'" || c === '"' || c === '`') { q = c; continue; }
      if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) break; }
    }
    const text = clean.slice(i, j + 1);
    // Do NOT pre-filter with a regex. The first version of this script tried
    // to skip anything "containing an identifier" and skipped the ONE
    // expression that actually mattered — the Regrid parcel label — so it
    // reported 0 invalid while the live map was broken. A check that quietly
    // skips the interesting case is worse than no check.
    //
    // Instead: just try to evaluate it. An expression referring to a runtime
    // variable throws ReferenceError and is genuinely un-checkable here; one
    // built from literals evaluates and gets compiled for real.
    let expr;
    try { expr = eval(`(${text})`); }
    catch (e) {
      if (e instanceof ReferenceError) { skipped++; continue; }
      continue;
    }
    const line = clean.slice(0, i).split('\n').length;
    const result = createExpression(expr);
    checked++;
    if (result.result === 'error') {
      failed++;
      console.error(`\n${SRC}:${line}  INVALID ['${kind}', ...]`);
      for (const e of result.value) console.error(`    ${e.key || ''} ${e.message}`);
      console.error(`    ${text.slice(0, 160).replace(/\s+/g, ' ')}...`);
    }
  }
}

console.log(`\ncompiled ${checked} expression(s), ${failed} invalid, ${skipped} skipped (runtime vars)`);
process.exit(failed ? 1 : 0);
