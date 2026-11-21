'use client'

/**
 * Meta Pixel base code — one PageView per page, including the in-app
 * navigations Next.js does without a full reload. Staff (/admin) pages are
 * not visitors, same rule as SiteAnalytics. See src/lib/metaPixel.ts.
 */

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { trackMetaPageView } from '@/lib/metaPixel'

export default function MetaPixel() {
  const pathname = usePathname()
  const lastPath = useRef<string | null>(null)

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return
    // React runs effects twice in development; one view is one view.
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    trackMetaPageView()
  }, [pathname])

  return null
}
