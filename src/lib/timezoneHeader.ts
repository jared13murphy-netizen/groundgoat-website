/**
 * Send the browser's time zone on every Ground Goat API request (owner
 * 2026-11-17: "goat search should always use the user's time zone").
 *
 * The backend reads X-Timezone so "today", "this week" and every date filter
 * mean the user's own calendar day — Eastern, Central, Mountain or Pacific.
 * Before this, Goat Search counted days in UTC and "auctions today" missed
 * every auction at 6 pm Central or later.
 *
 * Installed once at module load (before any component effect fires) by
 * wrapping window.fetch; only requests to our own API get the header.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

function isApiUrl(url: string): boolean {
  return url.startsWith(API_URL)
}

export function installTimezoneHeader(): void {
  if (typeof window === 'undefined') return
  const w = window as typeof window & { __ggTzFetch?: boolean }
  if (w.__ggTzFetch) return
  const tz = browserTimeZone()
  if (!tz) return
  w.__ggTzFetch = true
  const original = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!isApiUrl(url)) return original(input, init)
    if (input instanceof Request && !init) {
      const req = new Request(input)
      if (!req.headers.has('X-Timezone')) req.headers.set('X-Timezone', tz)
      return original(req)
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (!headers.has('X-Timezone')) headers.set('X-Timezone', tz)
    return original(input, { ...init, headers })
  }
}

installTimezoneHeader()
