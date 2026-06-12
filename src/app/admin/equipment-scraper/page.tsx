'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth, { fetchScraperProxy } from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Tractor,
  Loader2,
  Play,
  Check,
  X,
  AlertCircle,
  ExternalLink,
  ListChecks
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_PROXY = '/api/scraper-proxy'

interface ScrapeResult {
  url: string
  success: boolean
  items_count: number
  items_saved: number
  error?: string
  message?: string
}

export default function EquipmentScraperPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [urlsInput, setUrlsInput] = useState('')
  const [scraping, setScraping] = useState(false)
  const [results, setResults] = useState<ScrapeResult[]>([])
  const [summary, setSummary] = useState<{
    urls_processed: number
    total_items: number
    total_saved: number
    errors_count: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      setLoading(false)
    } catch (err) {
      router.push('/signin')
    }
  }

  const parseUrls = (): string[] => {
    return urlsInput
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && line.startsWith('http'))
  }

  const runBatchScrape = async () => {
    const urls = parseUrls()
    if (urls.length === 0) {
      setError('Please enter at least one valid URL')
      return
    }

    setScraping(true)
    setError(null)
    setResults([])
    setSummary(null)

    try {
      const response = await fetchScraperProxy(`/api/scrape-equipment/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls })
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()
      setResults(data.results || [])
      setSummary({
        urls_processed: data.urls_processed,
        total_items: data.total_items,
        total_saved: data.total_saved,
        errors_count: data.errors_count
      })
    } catch (err: any) {
      setError(err.message || 'Failed to run batch scrape')
    } finally {
      setScraping(false)
    }
  }

  const urlCount = parseUrls().length

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/equipment" className="text-gg-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white flex items-center gap-3">
              <Tractor className="text-gg-pink" />
              Equipment Batch Scraper
            </h1>
            <p className="text-gg-gray-400">Scrape multiple equipment auction URLs at once</p>
          </div>
        </div>

        {/* URL Input */}
        <div className="bg-gg-gray-900 rounded-xl p-6 border border-gg-gray-800 mb-6">
          <div className="flex items-center justify-between mb-4">
            <label className="text-white font-medium">Auction URLs</label>
            <span className="text-sm text-gg-gray-400">
              {urlCount} URL{urlCount !== 1 ? 's' : ''} detected
            </span>
          </div>
          <textarea
            value={urlsInput}
            onChange={(e) => setUrlsInput(e.target.value)}
            placeholder="Paste URLs here, one per line...

https://www.steffesgroup.com/auctions/auction123/results
https://www.steffesgroup.com/auctions/auction456/results
https://bid.wheelerauctions.com/auction/789"
            className="w-full h-64 bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-gg-pink resize-none"
            disabled={scraping}
          />
          <div className="mt-4 flex items-center justify-between">
            <div className="text-sm text-gg-gray-400">
              Supported sites: <span className="text-gg-pink">steffesgroup.com</span>, <span className="text-gg-pink">wheelerauctions.com</span>
            </div>
            <button
              onClick={runBatchScrape}
              disabled={scraping || urlCount === 0}
              className="flex items-center gap-2 bg-gg-pink text-black font-semibold px-6 py-2 rounded-lg hover:bg-gg-pink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {scraping ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Scraping...
                </>
              ) : (
                <>
                  <Play size={18} />
                  Run Batch Scrape
                </>
              )}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6 flex items-center gap-3">
            <AlertCircle className="text-red-400 flex-shrink-0" size={20} />
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="bg-gg-gray-900 rounded-xl p-6 border border-gg-gray-800 mb-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <ListChecks className="text-gg-pink" size={20} />
              Batch Results
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gg-gray-800 rounded-lg p-4">
                <div className="text-2xl font-bold text-white">{summary.urls_processed}</div>
                <div className="text-sm text-gg-gray-400">URLs Processed</div>
              </div>
              <div className="bg-gg-gray-800 rounded-lg p-4">
                <div className="text-2xl font-bold text-gg-pink">{summary.total_items}</div>
                <div className="text-sm text-gg-gray-400">Items Found</div>
              </div>
              <div className="bg-gg-gray-800 rounded-lg p-4">
                <div className="text-2xl font-bold text-green-400">{summary.total_saved}</div>
                <div className="text-sm text-gg-gray-400">Items Saved</div>
              </div>
              <div className="bg-gg-gray-800 rounded-lg p-4">
                <div className={`text-2xl font-bold ${summary.errors_count > 0 ? 'text-red-400' : 'text-gg-gray-400'}`}>
                  {summary.errors_count}
                </div>
                <div className="text-sm text-gg-gray-400">Errors</div>
              </div>
            </div>
          </div>
        )}

        {/* Results List */}
        {results.length > 0 && (
          <div className="bg-gg-gray-900 rounded-xl border border-gg-gray-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-gg-gray-800">
              <h3 className="text-white font-medium">Individual Results</h3>
            </div>
            <div className="divide-y divide-gg-gray-800 max-h-96 overflow-y-auto">
              {results.map((result, idx) => (
                <div key={idx} className="px-4 py-3 flex items-center gap-3">
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                    result.success ? 'bg-green-500/20' : 'bg-red-500/20'
                  }`}>
                    {result.success ? (
                      <Check className="text-green-400" size={16} />
                    ) : (
                      <X className="text-red-400" size={16} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gg-pink hover:underline flex items-center gap-1 truncate"
                    >
                      {result.url}
                      <ExternalLink size={12} />
                    </a>
                    <div className="text-xs text-gg-gray-400">
                      {result.success ? (
                        `${result.items_count} items found, ${result.items_saved} saved`
                      ) : (
                        <span className="text-red-400">{result.error}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!scraping && results.length === 0 && !error && (
          <div className="bg-gg-gray-900 rounded-xl p-12 border border-gg-gray-800 text-center">
            <Tractor size={48} className="mx-auto text-gg-gray-600 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2">Ready to Scrape</h3>
            <p className="text-gg-gray-400 max-w-md mx-auto">
              Paste equipment auction result URLs above (one per line) and click "Run Batch Scrape" to extract equipment data from multiple auctions at once.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
