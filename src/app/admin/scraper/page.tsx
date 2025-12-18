'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminScraperPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to the cloud scraper
    window.location.href = 'https://ground-goat-scraper-production.up.railway.app'
  }, [])

  return (
    <div className="min-h-screen bg-gg-black flex items-center justify-center">
      <div className="text-white">Redirecting to scraper...</div>
    </div>
  )
}
