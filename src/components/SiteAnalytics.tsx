'use client'

/**
 * First-party page-view beacon (owner 2026-10-20, "build our own").
 *
 * One small POST per page view to our own API — no third party, no cookies,
 * so no consent banner. The visitor id is a random string kept in
 * localStorage, the visit id lives in sessionStorage (one per tab), and the
 * referrer and utm tags are sent only on the page the visit landed on.
 * The backend strips query strings and never stores an IP.
 *
 * Read on the Command Center → Website visitors.
 */

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.groundgoat.com'

function randomId() {
  try {
    return crypto.randomUUID().replace(/-/g, '')
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
}

// Storage can be blocked (private mode, strict settings); a visit without a
// remembered id is still a visit, so fall back to an id for this page load.
function storedId(store: 'local' | 'session', key: string): string {
  try {
    const s = store === 'local' ? window.localStorage : window.sessionStorage
    const have = s.getItem(key)
    if (have) return have
    const id = randomId()
    s.setItem(key, id)
    return id
  } catch {
    return randomId()
  }
}

export default function SiteAnalytics() {
  const pathname = usePathname()
  const lastPath = useRef<string | null>(null)
  const landed = useRef(false)

  useEffect(() => {
    // Staff pages are not visitors.
    if (!pathname || pathname.startsWith('/admin')) return
    // React runs effects twice in development; one view is one view.
    if (lastPath.current === pathname) return
    lastPath.current = pathname

    const body: Record<string, unknown> = {
      v: storedId('local', 'gg_vid'),
      s: storedId('session', 'gg_sid'),
      p: pathname,
    }
    try {
      body.a = !!window.localStorage.getItem('auth_token')
    } catch {
      body.a = false
    }
    // Where the visit came from belongs to the page it landed on only. Later
    // in-app navigations keep the same document.referrer and would otherwise
    // all credit it again. (The backend ignores our own domain.)
    if (!landed.current) {
      if (document.referrer) body.r = document.referrer
      const q = new URLSearchParams(window.location.search)
      if (q.get('utm_source')) body.us = q.get('utm_source')
      if (q.get('utm_medium')) body.um = q.get('utm_medium')
      if (q.get('utm_campaign')) body.uc = q.get('utm_campaign')
    }
    landed.current = true

    const url = `${API_URL}/api/analytics/visit`
    const json = JSON.stringify(body)
    try {
      // text/plain keeps this a "simple" request: no CORS preflight.
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([json], { type: 'text/plain' }))) return
    } catch {
      /* fall through to fetch */
    }
    fetch(url, { method: 'POST', body: json, keepalive: true, headers: { 'Content-Type': 'text/plain' } })
      .catch(() => {})
  }, [pathname])

  return null
}
