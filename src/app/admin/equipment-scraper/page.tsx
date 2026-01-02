'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Tractor,
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  ExternalLink,
  Download,
  Trash2
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

interface EquipmentItem {
  id?: number
  title: string
  year: number | null
  make: string | null
  model: string | null
  category: string
  sale_price: number | null
  city: string | null
  state: string | null
  lot_number: string | null
  image_url: string | null
  auction_company: string
}

interface ScrapeResult {
  success: boolean
  items_count: number
  items_saved: number
  items: EquipmentItem[]
  message: string
  error?: string
}

export default function EquipmentScraperPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [scraping, setScraping] = useState(false)
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<ScrapeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [stats, setStats] = useState<any>(null)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth()
  }, [router])

  const checkAuth = async () => {
    try {
      const response = await fetchWithAuth(API_URL + '/api/auth/me')
      if (!response.ok) throw new Error('Not authenticated')
      const userData = await response.json()
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }
      fetchEquipment()
      fetchStats()
    } catch (err) {
      router.push('/signin')
    } finally {
      setLoading(false)
    }
  }

  const fetchEquipment = async () => {
    try {
      const response = await fetch(SCRAPER_URL + '/api/equipment?limit=50')
      if (response.ok) {
        const data = await response.json()
        setEquipment(data.sales || [])
      }
    } catch (err) {
      console.error('Failed to fetch equipment:', err)
    }
  }

  const fetchStats = async () => {
    try {
      const response = await fetch(SCRAPER_URL + '/api/equipment/stats')
      if (response.ok) {
        const data = await response.json()
        setStats(data)
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    }
  }

  const runScraper = async () => {
    if (!url.trim()) {
      setError('Please enter a URL')
      return
    }

    setScraping(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch(SCRAPER_URL + '/api/scrape-equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'Scraping failed')
      } else {
        setResult(data)
        fetchEquipment()
        fetchStats()
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
    } finally {
      setScraping(false)
    }
  }

  const exportToExcel = () => {
    window.open(SCRAPER_URL + '/api/equipment/export', '_blank')
  }

  const clearAll = async () => {
    if (!confirm('Are you sure you want to delete ALL equipment records?')) return

    try {
      const response = await fetch(SCRAPER_URL + '/api/equipment/clear', {
        method: 'POST'
      })
      if (response.ok) {
        setEquipment([])
        fetchStats()
      }
    } catch (err) {
      console.error('Failed to clear equipment:', err)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white flex items-center gap-3">
              <Tractor className="text-gg-pink" />
              Equipment Scraper
            </h1>
            <p className="text-gg-gray-400">Scrape equipment auction results from Steffes Group</p>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="bg-gg-gray-900 rounded-xl p-4 border border-gg-gray-800">
              <div className="text-2xl font-bold text-white">{stats.total_count?.toLocaleString() || 0}</div>
              <div className="text-sm text-gg-gray-400">Total Items</div>
            </div>
            <div className="bg-gg-gray-900 rounded-xl p-4 border border-gg-gray-800">
              <div className="text-2xl font-bold text-green-400">
                ${stats.price_stats?.avg ? Math.round(stats.price_stats.avg).toLocaleString() : 0}
              </div>
              <div className="text-sm text-gg-gray-400">Avg Sale Price</div>
            </div>
            <div className="bg-gg-gray-900 rounded-xl p-4 border border-gg-gray-800">
              <div className="text-2xl font-bold text-blue-400">{stats.top_makes?.[0]?.make || 'N/A'}</div>
              <div className="text-sm text-gg-gray-400">Top Make</div>
            </div>
            <div className="bg-gg-gray-900 rounded-xl p-4 border border-gg-gray-800">
              <div className="text-2xl font-bold text-yellow-400">{stats.top_categories?.[0]?.category || 'N/A'}</div>
              <div className="text-sm text-gg-gray-400">Top Category</div>
            </div>
          </div>
        )}

        {/* Scraper Input */}
        <div className="bg-gg-gray-900 rounded-xl p-6 border border-gg-gray-800 mb-8">
          <h2 className="text-lg font-semibold text-white mb-4">Run Equipment Scraper</h2>
          <p className="text-gg-gray-400 text-sm mb-4">
            Enter a Steffes Group auction URL to scrape equipment listings.
            Example: <code className="bg-gg-gray-800 px-2 py-1 rounded text-xs">
              https://steffesgroup.com/auctions/[auction-id]/listings/[listing-id]?activeStatus=All
            </code>
          </p>

          <div className="flex gap-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://steffesgroup.com/auctions/..."
              className="flex-1 bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:outline-none focus:border-gg-pink"
            />
            <button
              onClick={runScraper}
              disabled={scraping}
              className="flex items-center gap-2 bg-gg-pink text-black font-semibold px-6 py-3 rounded-lg hover:bg-gg-pink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scraping ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Scraping...
                </>
              ) : (
                <>
                  <Play size={18} />
                  Scrape
                </>
              )}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mt-4 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-3">
              <XCircle className="text-red-400" size={20} />
              <span className="text-red-400">{error}</span>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="mt-4 p-4 bg-green-500/20 border border-green-500/50 rounded-lg">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle className="text-green-400" size={20} />
                <span className="text-green-400 font-semibold">{result.message}</span>
              </div>
              <div className="text-sm text-gg-gray-300">
                Found {result.items_count} items, saved {result.items_saved} to database
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={exportToExcel}
            className="flex items-center gap-2 bg-gg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gg-gray-700 transition-colors"
          >
            <Download size={18} />
            Export to Excel
          </button>
          <button
            onClick={clearAll}
            className="flex items-center gap-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-lg hover:bg-red-500/30 transition-colors"
          >
            <Trash2 size={18} />
            Clear All
          </button>
        </div>

        {/* Equipment List */}
        <div className="bg-gg-gray-900 rounded-xl border border-gg-gray-800 overflow-hidden">
          <div className="p-4 border-b border-gg-gray-800">
            <h2 className="text-lg font-semibold text-white">Recent Equipment ({equipment.length})</h2>
          </div>

          {equipment.length === 0 ? (
            <div className="p-12 text-center">
              <Tractor size={48} className="mx-auto text-gg-gray-600 mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Equipment Yet</h3>
              <p className="text-gg-gray-400">Run the scraper to fetch equipment auction results.</p>
            </div>
          ) : (
            <div className="divide-y divide-gg-gray-800">
              {equipment.map((item, idx) => (
                <div key={item.id || idx} className="p-4 hover:bg-gg-gray-800/50 transition-colors">
                  <div className="flex items-start gap-4">
                    {item.image_url && (
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="w-20 h-20 object-cover rounded-lg flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-white font-medium truncate">
                            {item.lot_number && <span className="text-gg-gray-500">Lot #{item.lot_number} </span>}
                            {item.year && <span className="text-gg-pink">{item.year} </span>}
                            {item.title}
                          </h3>
                          <div className="flex items-center gap-3 mt-1 text-sm text-gg-gray-400">
                            {item.make && <span>{item.make}</span>}
                            {item.category && (
                              <span className="bg-gg-gray-700 px-2 py-0.5 rounded">{item.category}</span>
                            )}
                            {item.city && item.state && (
                              <span>{item.city}, {item.state}</span>
                            )}
                          </div>
                        </div>
                        {item.sale_price && (
                          <div className="text-green-400 font-bold whitespace-nowrap">
                            ${item.sale_price.toLocaleString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Supported Sites */}
        <div className="mt-8 bg-gg-gray-900 rounded-xl p-6 border border-gg-gray-800">
          <h2 className="text-lg font-semibold text-white mb-4">Supported Sites</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-center gap-3 p-3 bg-gg-gray-800 rounded-lg">
              <CheckCircle className="text-green-400" size={20} />
              <div>
                <div className="text-white font-medium">Steffes Group</div>
                <div className="text-sm text-gg-gray-400">steffesgroup.com</div>
              </div>
              <a
                href="https://steffesgroup.com"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-gg-gray-400 hover:text-gg-pink"
              >
                <ExternalLink size={16} />
              </a>
            </div>
            <div className="flex items-center gap-3 p-3 bg-gg-gray-800 rounded-lg">
              <CheckCircle className="text-green-400" size={20} />
              <div>
                <div className="text-white font-medium">Wheeler Auctions</div>
                <div className="text-sm text-gg-gray-400">bid.wheelerauctions.com</div>
              </div>
              <a
                href="https://bid.wheelerauctions.com"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-gg-gray-400 hover:text-gg-pink"
              >
                <ExternalLink size={16} />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
