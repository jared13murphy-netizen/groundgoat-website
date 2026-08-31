import type { Metadata } from 'next'
import './globals.css'
import ConditionalShell from '@/components/ConditionalShell'
import ReportJobsIndicator from '@/components/ReportJobsIndicator'

export const metadata: Metadata = {
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
      <body className="min-h-screen flex flex-col">
        <ConditionalShell>
          {children}
        </ConditionalShell>
        {/* Above the pages on purpose: a report keeps building while the
            user navigates, so the thing telling them about it must not be
            unmounted by navigation. */}
        <ReportJobsIndicator />
      </body>
    </html>
  )
}
