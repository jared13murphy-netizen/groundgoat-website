/**
 * Website state-gate (owner 2026-09-15, item 18): premium_state
 * subscribers ('individual' account_type with an active premium_state
 * subscription) get the website Explore Map, limited to their
 * subscribed state(s). basic_state stays app-only.
 *
 * Single source of truth for:
 *   - which account_types get an Explore Map / listings portal on the
 *     website at all (the four staff/firm roles, unconditionally, OR
 *     an 'individual' with a non-empty allowed_states array)
 *   - the shared "restricted" definition every UI surface (map banner,
 *     dimming, panel scope lines, /go redirect) uses to decide whether
 *     to show state-gate copy
 *   - shared copy formatting ("Illinois" / "Illinois and Iowa" /
 *     "Illinois, Iowa, and Missouri")
 *
 * Backend contract (Phase A, in progress): GET /api/auth/me returns
 * `allowed_states: string[] | null` — 2-letter abbrevs. null = staff/
 * firms (unlimited). [] = a premium_state subscription with no states
 * on it, which never reaches restricted-user UI because
 * isAllowedForExplore already rejects it at the gate (same as no
 * subscription at all).
 */
import { STATE_NAMES } from '@/components/map/mapConstants'

// The four account_types the backend has always allowed on the website
// Explore Map / listings portal, unconditionally (their allowed_states
// is null — unlimited). Individual premium_state subscribers are
// admitted separately, via isRestrictedIndividual below.
export const ALLOWED_ROLES = ['groundgoat_admin', 'groundgoat_sales', 'firm_admin', 'firm_user']

/** Pulls allowed_states off a /api/auth/me payload. Anything other than
 *  a real array (missing field, null, malformed) reads as null
 *  (unlimited) here — the gate functions below are what actually
 *  decide access, so a malformed field can't accidentally grant it. */
export function getAllowedStates(me: any): string[] | null {
  const v = me?.allowed_states
  return Array.isArray(v) ? v : null
}

/** An 'individual' subscriber admitted to the website ONLY because of a
 *  non-empty allowed_states array — never true for a staff/firm role. */
export function isRestrictedIndividual(me: any): boolean {
  return me?.account_type === 'individual' && Array.isArray(me?.allowed_states) && me.allowed_states.length > 0
}

/** Who gets an Explore Map / listings portal on the website at all. */
export function isAllowedForExplore(me: any): boolean {
  return ALLOWED_ROLES.includes(me?.account_type) || isRestrictedIndividual(me)
}

/** Shared "restricted" definition for UI surfaces that already have an
 *  `allowedStates` value in hand (not a raw /me payload): non-null. A
 *  user reaches gated UI with a non-null array only via
 *  isRestrictedIndividual above — staff/firms always carry null — so
 *  this is equivalent to "state-limited" for anyone past the gate. */
export function isRestrictedToStates(allowedStates: string[] | null | undefined): boolean {
  return allowedStates != null
}

/** "Illinois" / "Illinois and Iowa" / "Illinois, Iowa, and Missouri" —
 *  shared copy for the map banner, panel scope lines, and the /go
 *  out-of-plan toast. Unknown abbrevs fall back to the raw code. */
export function formatStateList(abbrevs: string[]): string {
  const names = abbrevs.map((a) => STATE_NAMES[a] || a)
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}
