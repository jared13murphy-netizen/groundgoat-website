/**
 * Normalize township name — mirrors normalize_township_name() from backend.
 * Strips "Township", "CCD", "Precinct" suffixes, "of"/"in" prefixes,
 * "No. X" numbered suffixes. Returns null for empty/bare-number/direction-only results.
 */
export function normalizeTownship(name: string | null | undefined): string | null {
  if (!name || typeof name !== 'string') return null
  let n = name.trim()
  if (!n) return null

  // Remove common suffixes
  n = n.replace(/\s+(Township|town|CCD|Precinct)\s*$/i, '')
  // Remove numbered suffixes
  n = n.replace(/\s+No\.?\s*\d+\s*$/i, '')
  // Remove "in " or "of " prefixes
  n = n.replace(/^(in|of)\s+/i, '')

  n = n.trim()
  if (!n) return null
  if (/^\d+$/.test(n)) return null

  const directions = new Set(['north', 'south', 'east', 'west', 'northeast', 'southeast', 'northwest', 'southwest'])
  if (directions.has(n.toLowerCase())) return null

  return n
}
