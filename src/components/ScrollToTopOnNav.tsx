'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Forces the window to scroll to (0, 0) whenever the user navigates
 * to a new route via a forward push.
 *
 * Why this is needed:
 * - Next.js App Router *should* reset scroll on route change, but in
 *   practice several things break that default in this app:
 *     * fixed-position navigation bar (z-50 top-0) that intercepts
 *       initial focus/scroll on some browsers
 *     * pages that mount tall content (admin maps, listings) before
 *       the scroll-restoration hook fires
 *     * components that mark navigation with `{ scroll: false }`
 *       elsewhere in the codebase
 *
 * Behavior:
 * - Fires only on path/query CHANGE (not the initial mount, so a deep
 *   link with a hash or query still lands where the user expected).
 * - Skipped when the URL contains a `#hash` (anchor target).
 * - Skipped on browser back/forward (popstate) — the browser restores
 *   scroll naturally for those, and stomping it is annoying.
 */
export default function ScrollToTopOnNav() {
  const pathname = usePathname()
  const search = useSearchParams()
  const isFirstRenderRef = useRef(true)
  const isPopstateRef = useRef(false)

  useEffect(() => {
    const onPopState = () => { isPopstateRef.current = true }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false
      return
    }
    if (isPopstateRef.current) {
      isPopstateRef.current = false
      return
    }
    if (typeof window === 'undefined') return
    if (window.location.hash) return  // user wants the anchor target
    // Use both for cross-browser reliability
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
    } catch {
      window.scrollTo(0, 0)
    }
    if (document.documentElement) document.documentElement.scrollTop = 0
    if (document.body) document.body.scrollTop = 0
  }, [pathname, search])

  return null
}
