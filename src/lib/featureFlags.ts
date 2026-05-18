/**
 * Static feature flags. Flip these by editing this file + redeploying.
 *
 * Used instead of env vars because:
 *   1. We want flags visible in source so reviewers can spot what's behind
 *      one (no "where does this env var come from?" hunts).
 *   2. Build-time inlined → tree-shaken when disabled.
 *
 * Per-flag comment should say: WHAT it gates, WHY it's a flag (kill-switch
 * vs experiment), and when it should be removed.
 */

/**
 * Phase-1 "Find Comparables" map experience (shipped 2026-05-16):
 *   - Adds a button to the existing ExploreMap pin popup
 *   - Opens a new comparables-map view at /comparables/map?tractId=…
 *   - All-new code path; existing /listings/[id]/comparables untouched
 *
 * Kill-switch — flip to false if the new view misbehaves; existing app
 * keeps working. Remove this flag once the feature has shipped for a
 * couple weeks without issue.
 */
export const FIND_COMPARABLES_MAP_ENABLED = true
