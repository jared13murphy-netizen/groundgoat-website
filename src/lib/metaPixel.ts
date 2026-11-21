/**
 * Meta (Facebook / Instagram) Pixel — TEDDYco Media ad campaigns (owner 2026-11-20).
 *
 * Pixel ID from the "Bailey Mrozinski sent you instructions on setting up
 * Meta Pixel" email. Two things are tracked:
 *   - PageView on every page (retargeting audiences)       → <MetaPixel />
 *   - CompleteRegistration ONLY after /api/auth/register   → trackCompleteRegistration()
 *     returns OK — never on visiting /signup or starting it.
 *
 * Off on the sandbox site so test sign-ups never count as conversions.
 * ensureFbq() is Meta's standard base snippet: it creates the fbq queue
 * synchronously and loads fbevents.js once, so a call made before the
 * script finishes downloading is queued, not lost.
 */

// Ground Goat staff never count (owner 2026-11-20) — see internalVisitor.ts.
import { isInternalVisitor } from '@/lib/internalVisitor'

export const META_PIXEL_ID = '3595310273970927'

const IS_SANDBOX = process.env.NEXT_PUBLIC_IS_SANDBOX === 'true'

type Fbq = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  push: unknown
  loaded: boolean
  version: string
}

declare global {
  interface Window {
    fbq?: Fbq
    _fbq?: Fbq
  }
}

let initialized = false

function ensureFbq(): Fbq | null {
  if (IS_SANDBOX || typeof window === 'undefined' || isInternalVisitor()) return null
  if (!window.fbq) {
    const n = function (...args: unknown[]) {
      if (n.callMethod) n.callMethod(...args)
      else n.queue.push(args)
    } as Fbq
    n.push = n
    n.loaded = true
    n.version = '2.0'
    n.queue = []
    window.fbq = n
    if (!window._fbq) window._fbq = n
    const s = document.createElement('script')
    s.async = true
    s.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.head.appendChild(s)
  }
  if (!initialized) {
    window.fbq('init', META_PIXEL_ID)
    initialized = true
  }
  return window.fbq
}

export function trackMetaPageView() {
  try {
    ensureFbq()?.('track', 'PageView')
  } catch {
    // Tracking must never break the page.
  }
}

/** Call only after the account was actually created. */
export function trackCompleteRegistration() {
  try {
    ensureFbq()?.('track', 'CompleteRegistration')
  } catch {
    // Tracking must never break sign-up.
  }
}
