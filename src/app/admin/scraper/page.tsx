'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

export default function AdminScraperPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }

    checkAuth(token)
  }, [router])

  const checkAuth = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()
      
      if (userData.account_type !== 'groundgoat_admin' && userData.account_type !== 'groundgoat_sales') {
        router.push('/account')
        return
      }
    } catch (err) {
      router.push('/signin')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-0">
      <div className="max-w-7xl mx-auto px-6 mb-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-4xl font-bold text-white">Scraper</h1>
              <p className="text-gg-gray-400">Extract auction listings from URLs</p>
            </div>
          </div>
          <a 
            href={SCRAPER_URL} 
            target="_blank" 
            rel="noopener noreferrer"
            className="btn-secondary flex items-center gap-2"
          >
            Open in New Tab
            <ExternalLink size={16} />
          </a>
        </div>
      </div>

      {/* Embedded Scraper */}
      <div className="w-full" style={{ height: 'calc(100vh - 180px)' }}>
        <iframe
          src={SCRAPER_URL}
          className="w-full h-full border-0"
          title="Ground Goat Scraper"
          allow="clipboard-write"
        />
      </div>
    </div>
  )
}
