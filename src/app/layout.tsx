import type { Metadata } from 'next'
import './globals.css'
import Navigation from '@/components/Navigation'
import Footer from '@/components/Footer'

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
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <Navigation />
        <main className="flex-grow">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  )
}
