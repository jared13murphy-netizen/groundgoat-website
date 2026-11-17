/**
 * County filter entries may carry their state (owner 2026-11-17): Goat Search
 * sends "Adams (IL)" or "Adams|IL" when a question pairs counties with
 * different states ("Adams County IL and Lee County IA"), so Adams IA and
 * Lee IL never match. Plain "Adams" still matches any state, as before.
 * Mirrors the backend's _split_county_filter.
 */
export function splitCountyFilter(entry: string): { county: string; state: string | null } {
  const e = entry.trim()
  const paren = /^(.*\S)\s*\(([A-Za-z]{2})\)$/.exec(e)
  if (paren) return { county: paren[1].trim(), state: paren[2].toUpperCase() }
  const pipe = /^(.*\S)\s*\|\s*([A-Za-z]{2})$/.exec(e)
  if (pipe) return { county: pipe[1].trim(), state: pipe[2].toUpperCase() }
  return { county: e, state: null }
}

export function countyFilterMatches(
  filters: string[],
  county: string | null | undefined,
  state: string | null | undefined,
): boolean {
  const c = (county || '').trim().toLowerCase()
  const st = (state || '').trim().toUpperCase()
  return filters.some(f => {
    const p = splitCountyFilter(f)
    return p.county.toLowerCase() === c && (p.state === null || p.state === st)
  })
}
