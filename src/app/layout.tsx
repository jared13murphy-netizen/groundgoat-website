import type { Metadata } from 'next'
import './globals.css'
import ConditionalShell from '@/components/ConditionalShell'
import ReportJobsIndicator from '@/components/ReportJobsIndicator'
import SandboxBanner from '@/components/SandboxBanner'
import SiteAnalytics from '@/components/SiteAnalytics'
import MetaPixel from '@/components/MetaPixel'
import { GoogleTagManagerHead, GoogleTagManagerNoScript } from '@/components/GoogleTagManager'

export const metadata: Metadata = {
  // Google Search Console 11/15: "Duplicate without user-selected canonical".
  // The same page was reachable with tracking/query strings (?ref=, ?utm_…)
  // and no page named its own real address. './' resolves per route to the
  // page's own path with no query string, so every page declares itself.
  metadataBase: new URL('https://www.groundgoat.com'),
  alternates: { canonical: './' },
  title: 'Ground Goat | Land Auction Intelligence',
  description: 'Access comprehensive land auction data, sale results, and property insights across the United States. Subscribe to counties or states you care about.',
  keywords: 'land auctions, farm land, rural property, auction results, land sales, property data',
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Ground Goat | Land Auction Intelligence',
    description: 'Access comprehensive land auction data and sale results across the United States.',
    type: 'website',
    url: 'https://www.groundgoat.com',
  },
  // Apple's Smart App Banner. Safari on iPhone/iPad renders the "Get the app"
  // strip itself from this tag; every other browser and all desktops ignore it
  // entirely, which is exactly the behaviour the owner asked for (8/3).
  // app-id is the App Store ID for Ground Goat.
  itunes: { appId: '6753321116' },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        {/* Google Tag Manager — as high in <head> as possible (Google's install guide). */}
        <GoogleTagManagerHead />
      </head>
      <body className="min-h-screen flex flex-col sandbox-body-offset">
        {/* Google Tag Manager (noscript) — immediately after the opening <body>. */}
        <GoogleTagManagerNoScript />
        <SandboxBanner />
        <ConditionalShell>
          {children}
        </ConditionalShell>
        {/* Above the pages on purpose: a report keeps building while the
            user navigates, so the thing telling them about it must not be
            unmounted by navigation. */}
        <ReportJobsIndicator />
        {/* Our own page-view counter — no third party, no cookies. */}
        <SiteAnalytics />
        {/* Meta Pixel for TEDDYco's Facebook/Instagram ads (owner 11/20). */}
        <MetaPixel />
      </body>
    </html>
  )
}
