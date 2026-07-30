import { STATE_NAMES } from '@/components/map/mapConstants'

/**
 * Free-text matcher for the Auctions / Results slide-out panels.
 *
 * This is the WEB twin of ground-goat-mobile/src/utils/listingSearch.js —
 * same tokenising rules and same fields, so a query behaves identically on
 * both surfaces. Update BOTH together.
 *
 * Behaviour:
 *  - Leading/trailing whitespace is ignored (the mobile bug this fixes was
 *    "Hancock " returning nothing because the raw, untrimmed string was
 *    substring-matched).
 *  - Splits on whitespace AND commas, so "Hancock IL", "Hancock, IL" and
 *    "hancock   il" all behave the same.
 *  - EVERY token must match SOMETHING (AND across tokens), but a token may
 *    match ANY field (OR across fields) — so "Hancock IL" narrows to Hancock
 *    County, Illinois and correctly EXCLUDES Hancock County, Missouri.
 *  - Multi-word counties still work: "De Witt" → ["de","witt"], both of which
 *    are substrings of "de witt".
 *  - Fields searched: county, state abbreviation, state full name (via
 *    STATE_NAMES, so "Missouri" matches state="MO"), and company name —
 *    which on this panel can arrive as either `company.name` or the flat
 *    `company_name`, so both are checked.
 *
 * Returns true for an empty/whitespace-only query so callers can pass raw
 * input straight through with no guard of their own.
 */
export function listingMatchesSearch(
  listing: {
    county?: string | null
    state?: string | null
    company_name?: string | null
    company?: { name?: string | null } | null
  },
  rawQuery: string | null | undefined,
): boolean {
  const trimmed = String(rawQuery ?? '').trim()
  if (!trimmed) return true

  const tokens = trimmed.toLowerCase().split(/[\s,]+/).filter(Boolean)
  if (tokens.length === 0) return true

  const county = String(listing?.county ?? '').toLowerCase()
  const stateAbbr = String(listing?.state ?? '')
  const state = stateAbbr.toLowerCase()
  const stateFull = String(STATE_NAMES[stateAbbr.toUpperCase()] ?? '').toLowerCase()
  const company = String(
    listing?.company?.name ?? listing?.company_name ?? '',
  ).toLowerCase()

  return tokens.every((token) => (
    county.includes(token) ||
    state.includes(token) ||
    (!!stateFull && stateFull.includes(token)) ||
    company.includes(token)
  ))
}
