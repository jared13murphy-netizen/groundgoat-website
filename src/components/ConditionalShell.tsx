'use client'

import { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'
import ScrollToTopOnNav from '@/components/ScrollToTopOnNav'

export default function ConditionalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isPortal = pathname.startsWith('/access')

  // Global scroll-to-top on route change. Wrapped in Suspense because
  // useSearchParams() inside ScrollToTopOnNav requires a Suspense
  // boundary in static-rendered routes.
  const scrollFix = (
    <Suspense fallback={null}>
      <ScrollToTopOnNav />
    </Suspense>
  )

  if (isPortal) {
    return <>{scrollFix}{children}</>
  }

  return (
    <>
      {scrollFix}
      <Navigation />
      <main className="flex-grow">
        {children}
      </main>
      <Footer />
    </>
  )
}