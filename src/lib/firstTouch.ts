/**
 * First-touch sign-up source (Command Center v7, contract section D).
 *
 * The first time someone lands on the site we remember where they came from
 * (utm_*, an ad click id, or the referring site) in localStorage
 * `gg_first_touch`, and send it with the register call so the Command Center
 * can say which ad platform a customer came from.
 *
 * Never overwritten (first touch means first), forgotten after 30 days, and
 * every storage access is wrapped: a blocked localStorage just means no source.
 */

const KEY = 'gg_first_touch'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export type FirstTouch = { source: string; medium: string; campaign: string; at: number }

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** Same alphabet the backend keeps: [a-z0-9_-], at most 40 characters. */
export function cleanTag(v: unknown): string {
  return String(v ?? '').toLowerCase().trim().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

const CLICK_IDS: [string, string, string][] = [
  ['fbclid', 'facebook', 'paid_social'],
  ['ttclid', 'tiktok', 'paid_social'],
  ['li_fat_id', 'linkedin', 'paid_social'],
  ['gclid', 'google', 'cpc'],
]

const REFERRERS: [RegExp, string, string][] = [
  [/(^|\.)instagram\.com$/, 'instagram', 'social'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'facebook', 'social'],
  [/(^|\.)tiktok\.com$/, 'tiktok', 'social'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'linkedin', 'social'],
  [/(^|\.)google\.[a-z.]+$/, 'google', 'organic'],
]

/** Where this page view came from, or null when there is no signal at all. */
export function deriveFirstTouch(
  search: string, referrer: string, ownHost = '',
): { source: string; medium: string; campaign: string } | null {
  const q = new URLSearchParams(search || '')
  const campaign = cleanTag(q.get('utm_campaign'))
  const utmSource = cleanTag(q.get('utm_source'))
  if (utmSource) return { source: utmSource, medium: cleanTag(q.get('utm_medium')), campaign }
  for (const [param, source, medium] of CLICK_IDS) {
    if (q.get(param)) return { source, medium, campaign }
  }
  let host = ''
  try { host = new URL(referrer).hostname.toLowerCase() } catch { /* no referrer */ }
  if (host && host !== ownHost && !host.endsWith('groundgoat.com')) {
    for (const [re, source, medium] of REFERRERS) {
      if (re.test(host)) return { source, medium, campaign }
    }
  }
  return null
}

function read(store: Store, now: number): FirstTouch | null {
  try {
    const v = JSON.parse(store.getItem(KEY) || 'null')
    if (v && typeof v.source === 'string' && now - Number(v.at) < MAX_AGE_MS) return v
  } catch { /* corrupt or blocked: treat as nothing stored */ }
  return null
}

/** Call on every page load. Stores once; an unexpired value is never replaced. */
export function captureFirstTouch(
  store: Store | null = null, search = '', referrer = '', ownHost = '', now = Date.now(),
): void {
  try {
    const s = store ?? window.localStorage
    if (read(s, now)) return
    const t = deriveFirstTouch(search, referrer, ownHost)
    if (!t) return
    s.setItem(KEY, JSON.stringify({ ...t, at: now }))
  } catch { /* storage blocked: the sign-up just carries no source */ }
}

/** Fields for the register request. Empty when nothing was captured. */
export function firstTouchForSignup(
  store: Store | null = null, now = Date.now(),
): { signup_source?: string; signup_medium?: string; signup_campaign?: string } {
  try {
    const t = read(store ?? window.localStorage, now)
    if (!t) return {}
    const out: { signup_source?: string; signup_medium?: string; signup_campaign?: string } = { signup_source: t.source }
    if (t.medium) out.signup_medium = t.medium
    if (t.campaign) out.signup_campaign = t.campaign
    return out
  } catch {
    return {}
  }
}
