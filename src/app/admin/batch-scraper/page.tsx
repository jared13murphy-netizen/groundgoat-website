'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Search,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Play,
  MapPin,
  Filter,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Trash2,
  Ban,
  Gavel,
  FileText
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

interface DiscoveredUrl {
  url: string
  text: string
  reason: string
  image_url?: string
  method?: string
}

interface ScrapeResultDetails {
  title?: string
  listing_type?: string
  total_acres?: number
  county?: string
  state?: string
  company_name?: string
  asking_price?: number
  auction_datetime?: string
  primary_image_url?: string
  tracts?: Array<{ tract_number?: string; acres?: number }>
}

interface ScrapeResult {
  url: string
  success: boolean
  duplicate?: boolean
  error?: string
  listing_id?: string
  details?: ScrapeResultDetails
  verified?: boolean
  verifying?: boolean
}

type Phase = 'input' | 'discovering' | 'review' | 'checking' | 'scraping' | 'complete'

export default function BatchScraperPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<Phase>('input')

  // Input phase
  const [parentUrl, setParentUrl] = useState('')
  const [maxPages, setMaxPages] = useState(10)
  const [allListingsAreLand, setAllListingsAreLand] = useState(false)
  const [listingType, setListingType] = useState<'auction' | 'private_treaty'>('auction')

  // Ignored URLs (persisted to localStorage)
  const [ignoredUrls, setIgnoredUrls] = useState<string[]>([])

  // Discovery phase
  const [landUrls, setLandUrls] = useState<DiscoveredUrl[]>([])
  const [excludedUrls, setExcludedUrls] = useState<DiscoveredUrl[]>([])
  const [showExcluded, setShowExcluded] = useState(false)
  const [discoverySummary, setDiscoverySummary] = useState<{
    totalListings: number
    alreadyExist: number
  } | null>(null)

  // Check phase - URLs after deduplication
  const [newUrls, setNewUrls] = useState<string[]>([])
  const [existingUrls, setExistingUrls] = useState<string[]>([])

  // Scrape phase
  const [scrapeResults, setScrapeResults] = useState<ScrapeResult[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)

  // Summary
  const [summary, setSummary] = useState<{
    total: number
    success: number
    duplicates: number
    errors: number
  } | null>(null)

  const [error, setError] = useState<string | null>(null)

  // Load ignored URLs from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('batch_scraper_ignored_urls')
    if (stored) {
      try {
        setIgnoredUrls(JSON.parse(stored))
      } catch (e) {
        console.error('Failed to parse ignored URLs:', e)
      }
    }
  }, [])

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

  const discoverUrls = async () => {
    if (!parentUrl.trim()) {
      setError('Please enter a URL')
      return
    }

    setPhase('discovering')
    setError(null)
    setLandUrls([])
    setExcludedUrls([])

    try {
      const response = await fetch(SCRAPER_URL + '/api/batch-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: parentUrl.trim(),
          max_pages: maxPages,
          all_land: allListingsAreLand,
          listing_type: listingType
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Discovery failed')
      }

      // Filter out ignored URLs from land_urls
      const filteredLandUrls = (data.land_urls || []).filter(
        (item: DiscoveredUrl) => !ignoredUrls.includes(item.url)
      )
      // Add ignored URLs to excluded list
      const ignoredFromResults = (data.land_urls || []).filter(
        (item: DiscoveredUrl) => ignoredUrls.includes(item.url)
      ).map((item: DiscoveredUrl) => ({
        ...item,
        reason: 'Ignored by user'
      }))

      setLandUrls(filteredLandUrls)
      setExcludedUrls([...ignoredFromResults, ...(data.excluded_urls || [])])

      // Store discovery summary for display
      if (data.summary) {
        setDiscoverySummary({
          totalListings: data.summary.listing_cards || 0,
          alreadyExist: data.summary.already_exist || 0
        })
      }

      setPhase('review')

    } catch (err: any) {
      setError(err.message || 'Discovery failed')
      setPhase('input')
    }
  }

  const checkDuplicates = async () => {
    if (landUrls.length === 0) {
      setError('No land URLs to check')
      return
    }

    setPhase('checking')
    setError(null)

    try {
      const urlList = landUrls.map(u => u.url)
      const response = await fetch(API_URL + '/api/listings/check-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: urlList })
      })

      const data = await response.json()

      setNewUrls(data.new || [])
      setExistingUrls(data.existing || [])

      // If there are new URLs, proceed to scraping automatically
      if (data.new && data.new.length > 0) {
        startScraping(data.new)
      } else {
        setPhase('complete')
        setSummary({
          total: urlList.length,
          success: 0,
          duplicates: data.existing?.length || 0,
          errors: 0
        })
      }

    } catch (err: any) {
      setError(err.message || 'Failed to check duplicates')
      setPhase('review')
    }
  }

  const startScraping = async (urls: string[]) => {
    setPhase('scraping')
    setScrapeResults([])
    setCurrentIndex(0)

    try {
      const response = await fetch(SCRAPER_URL + '/api/batch-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, listing_type: listingType })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Scraping failed')
      }

      setScrapeResults(data.results || [])
      setSummary(data.summary)
      setPhase('complete')

    } catch (err: any) {
      setError(err.message || 'Scraping failed')
      setPhase('review')
    }
  }

  const removeUrl = (urlToRemove: string) => {
    setLandUrls(prev => prev.filter(u => u.url !== urlToRemove))
  }

  const handleVerify = async (resultIndex: number) => {
    const result = scrapeResults[resultIndex]
    if (!result.listing_id) return

    // Set verifying state
    setScrapeResults(prev => prev.map((r, idx) =>
      idx === resultIndex ? { ...r, verifying: true } : r
    ))

    try {
      const response = await fetchWithAuth(`${API_URL}/api/listings/${result.listing_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verified: true }),
      })

      if (response.ok) {
        setScrapeResults(prev => prev.map((r, idx) =>
          idx === resultIndex ? { ...r, verified: true, verifying: false } : r
        ))
      } else {
        setScrapeResults(prev => prev.map((r, idx) =>
          idx === resultIndex ? { ...r, verifying: false } : r
        ))
      }
    } catch (err) {
      setScrapeResults(prev => prev.map((r, idx) =>
        idx === resultIndex ? { ...r, verifying: false } : r
      ))
    }
  }

  const ignoreUrl = (urlToIgnore: string) => {
    // Add to ignored list and persist
    const newIgnored = [...ignoredUrls, urlToIgnore]
    setIgnoredUrls(newIgnored)
    localStorage.setItem('batch_scraper_ignored_urls', JSON.stringify(newIgnored))

    // Move from land URLs to excluded URLs
    const urlItem = landUrls.find(u => u.url === urlToIgnore)
    if (urlItem) {
      setLandUrls(prev => prev.filter(u => u.url !== urlToIgnore))
      setExcludedUrls(prev => [{
        ...urlItem,
        reason: 'Ignored by user'
      }, ...prev])
    }
  }

  const clearIgnoredUrls = () => {
    setIgnoredUrls([])
    localStorage.removeItem('batch_scraper_ignored_urls')
  }

  const resetScraper = () => {
    setPhase('input')
    setParentUrl('')
    setLandUrls([])
    setExcludedUrls([])
    setDiscoverySummary(null)
    setNewUrls([])
    setExistingUrls([])
    setScrapeResults([])
    setSummary(null)
    setError(null)
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
      <div className="max-w-5xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white transition-colors">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white flex items-center gap-3">
              <Search className="text-gg-pink" />
              Batch Listing Discovery
            </h1>
            <p className="text-gg-gray-400">
              Discover and scrape multiple land listings from a single URL
            </p>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-3">
            <XCircle className="text-red-400 flex-shrink-0" size={20} />
            <span className="text-red-400">{error}</span>
          </div>
        )}

        {/* Phase: Input */}
        {phase === 'input' && (
          <div className="bg-gg-gray-900 rounded-xl p-6 border border-gg-gray-800">
            <h2 className="text-lg font-semibold text-white mb-4">Enter Parent URL</h2>
            <p className="text-gg-gray-400 text-sm mb-4">
              Enter the URL of a page that lists multiple auctions or properties.
              The scraper will find all land listings and filter out equipment, livestock, etc.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gg-gray-300 mb-2">Parent URL</label>
                <input
                  type="url"
                  value={parentUrl}
                  onChange={(e) => setParentUrl(e.target.value)}
                  placeholder="https://www.sullivanauctioneers.com"
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:outline-none focus:border-gg-pink"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gg-gray-300 mb-2">Listing Type</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setListingType('auction')}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                        listingType === 'auction'
                          ? 'bg-gg-pink/20 border-gg-pink text-gg-pink'
                          : 'bg-gg-gray-800 border-gg-gray-700 text-gg-gray-400 hover:border-gg-gray-600'
                      }`}
                    >
                      <Gavel size={18} />
                      Auction
                    </button>
                    <button
                      onClick={() => setListingType('private_treaty')}
                      className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border transition-colors ${
                        listingType === 'private_treaty'
                          ? 'bg-gg-pink/20 border-gg-pink text-gg-pink'
                          : 'bg-gg-gray-800 border-gg-gray-700 text-gg-gray-400 hover:border-gg-gray-600'
                      }`}
                    >
                      <FileText size={18} />
                      Private Treaty
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-gg-gray-300 mb-2">Max Pages to Scan</label>
                  <select
                    value={maxPages}
                    onChange={(e) => setMaxPages(Number(e.target.value))}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-gg-pink"
                  >
                    <option value={1}>1 page</option>
                    <option value={3}>3 pages</option>
                    <option value={5}>5 pages</option>
                    <option value={10}>10 pages</option>
                    <option value={20}>20 pages</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allListingsAreLand}
                    onChange={(e) => setAllListingsAreLand(e.target.checked)}
                    className="w-5 h-5 rounded border-gg-gray-600 bg-gg-gray-800 text-gg-pink focus:ring-gg-pink focus:ring-offset-0"
                  />
                  <span className="text-white">All listings are Land</span>
                </label>
                <span className="text-gg-gray-500 text-sm">
                  (Skip classification - saves API credits)
                </span>
              </div>

              {ignoredUrls.length > 0 && (
                <div className="flex items-center justify-between bg-gg-gray-800 rounded-lg px-4 py-3">
                  <span className="text-gg-gray-400 text-sm">
                    {ignoredUrls.length} URL{ignoredUrls.length !== 1 ? 's' : ''} in ignore list
                  </span>
                  <button
                    onClick={clearIgnoredUrls}
                    className="text-red-400 hover:text-red-300 text-sm underline"
                  >
                    Clear ignore list
                  </button>
                </div>
              )}

              <button
                onClick={discoverUrls}
                className="flex items-center gap-2 bg-gg-pink text-black font-semibold px-6 py-3 rounded-lg hover:bg-gg-pink/90 transition-colors"
              >
                <Search size={18} />
                Discover Listings
              </button>
            </div>
          </div>
        )}

        {/* Phase: Discovering */}
        {phase === 'discovering' && (
          <div className="bg-gg-gray-900 rounded-xl p-12 border border-gg-gray-800 text-center">
            <Loader2 className="animate-spin text-gg-pink mx-auto mb-4" size={48} />
            <h2 className="text-xl font-semibold text-white mb-2">Discovering Listings...</h2>
            <p className="text-gg-gray-400">
              Scanning pages and identifying land listings. This may take a minute.
            </p>
          </div>
        )}

        {/* Phase: Review */}
        {phase === 'review' && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="bg-gg-gray-900 rounded-xl p-6 border border-gg-gray-800">
              <h2 className="text-lg font-semibold text-white mb-4">Discovery Results</h2>

              {/* Total listings info */}
              {discoverySummary && (
                <div className="bg-gg-gray-800/50 rounded-lg px-4 py-3 mb-4 text-sm">
                  <span className="text-gg-gray-300">
                    Found <span className="text-white font-semibold">{discoverySummary.totalListings}</span> total listings on page
                  </span>
                  {discoverySummary.alreadyExist > 0 && (
                    <span className="text-gg-gray-400">
                      {' '}— <span className="text-blue-400">{discoverySummary.alreadyExist}</span> already in database
                    </span>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-green-500/20 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-400">{landUrls.length}</div>
                  <div className="text-sm text-green-300">New Land Listings Found</div>
                </div>
                <div className="bg-gg-gray-800 rounded-lg p-4">
                  <div className="text-2xl font-bold text-gg-gray-400">{excludedUrls.length}</div>
                  <div className="text-sm text-gg-gray-500">Non-Land URLs Filtered</div>
                </div>
              </div>

              {landUrls.length > 0 && (
                <button
                  onClick={checkDuplicates}
                  className="flex items-center gap-2 bg-gg-pink text-black font-semibold px-6 py-3 rounded-lg hover:bg-gg-pink/90 transition-colors"
                >
                  <Play size={18} />
                  Check for Duplicates & Scrape New
                </button>
              )}
            </div>

            {/* Land URLs */}
            {landUrls.length > 0 && (
              <div className="bg-gg-gray-900 rounded-xl border border-gg-gray-800 overflow-hidden">
                <div className="p-4 border-b border-gg-gray-800 flex items-center justify-between">
                  <h3 className="font-semibold text-white flex items-center gap-2">
                    <MapPin className="text-green-400" size={18} />
                    New Land Listings ({landUrls.length})
                  </h3>
                </div>
                <div className="max-h-96 overflow-y-auto divide-y divide-gg-gray-800">
                  {landUrls.map((item, idx) => (
                    <div key={idx} className="p-3 hover:bg-gg-gray-800/50 flex items-center gap-3">
                      <CheckCircle className="text-green-400 flex-shrink-0" size={16} />
                      <div className="flex-1 min-w-0">
                        <div className="text-white text-sm truncate">{item.text || item.url}</div>
                        <div className="text-gg-gray-500 text-xs truncate">{item.url}</div>
                        <div className="text-green-400/60 text-xs">{item.reason}</div>
                      </div>
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gg-gray-400 hover:text-gg-pink p-1"
                        title="Open in new tab"
                      >
                        <ExternalLink size={14} />
                      </a>
                      <button
                        onClick={() => ignoreUrl(item.url)}
                        className="text-gg-gray-400 hover:text-yellow-400 p-1"
                        title="Ignore this URL permanently"
                      >
                        <Ban size={14} />
                      </button>
                      <button
                        onClick={() => removeUrl(item.url)}
                        className="text-gg-gray-400 hover:text-red-400 p-1"
                        title="Remove from this batch only"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Excluded URLs (collapsible) */}
            {excludedUrls.length > 0 && (
              <div className="bg-gg-gray-900 rounded-xl border border-gg-gray-800 overflow-hidden">
                <button
                  onClick={() => setShowExcluded(!showExcluded)}
                  className="w-full p-4 flex items-center justify-between hover:bg-gg-gray-800/50 transition-colors"
                >
                  <h3 className="font-semibold text-gg-gray-400 flex items-center gap-2">
                    <Filter size={18} />
                    Filtered Out ({excludedUrls.length})
                  </h3>
                  {showExcluded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {showExcluded && (
                  <div className="max-h-64 overflow-y-auto divide-y divide-gg-gray-800 border-t border-gg-gray-800">
                    {excludedUrls.map((item, idx) => (
                      <div key={idx} className="p-3 flex items-center gap-3">
                        <XCircle className="text-gg-gray-500 flex-shrink-0" size={16} />
                        <div className="flex-1 min-w-0">
                          <div className="text-gg-gray-400 text-sm truncate">{item.text || item.url}</div>
                          <div className="text-gg-gray-600 text-xs truncate">{item.url}</div>
                          <div className="text-red-400/60 text-xs">{item.reason}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button
              onClick={resetScraper}
              className="text-gg-gray-400 hover:text-white text-sm underline"
            >
              Start Over
            </button>
          </div>
        )}

        {/* Phase: Checking */}
        {phase === 'checking' && (
          <div className="bg-gg-gray-900 rounded-xl p-12 border border-gg-gray-800 text-center">
            <Loader2 className="animate-spin text-gg-pink mx-auto mb-4" size={48} />
            <h2 className="text-xl font-semibold text-white mb-2">Checking for Duplicates...</h2>
            <p className="text-gg-gray-400">
              Comparing discovered URLs against existing listings in the database.
            </p>
          </div>
        )}

        {/* Phase: Scraping */}
        {phase === 'scraping' && (
          <div className="bg-gg-gray-900 rounded-xl p-12 border border-gg-gray-800 text-center">
            <Loader2 className="animate-spin text-gg-pink mx-auto mb-4" size={48} />
            <h2 className="text-xl font-semibold text-white mb-2">Scraping Listings...</h2>
            <p className="text-gg-gray-400 mb-4">
              Processing {newUrls.length} new listings. This may take several minutes.
            </p>
            {existingUrls.length > 0 && (
              <p className="text-yellow-400 text-sm">
                Skipped {existingUrls.length} duplicate URLs
              </p>
            )}
          </div>
        )}

        {/* Phase: Complete */}
        {phase === 'complete' && summary && (
          <div className="space-y-6">
            <div className="bg-gg-gray-900 rounded-xl p-6 border border-gg-gray-800">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <CheckCircle className="text-green-400" size={24} />
                Scraping Complete
              </h2>

              <div className="grid grid-cols-4 gap-4 mb-6">
                <div className="bg-gg-gray-800 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-white">{summary.total}</div>
                  <div className="text-sm text-gg-gray-400">Total</div>
                </div>
                <div className="bg-green-500/20 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-green-400">{summary.success}</div>
                  <div className="text-sm text-green-300">Scraped</div>
                </div>
                <div className="bg-yellow-500/20 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-yellow-400">{summary.duplicates + existingUrls.length}</div>
                  <div className="text-sm text-yellow-300">Duplicates</div>
                </div>
                <div className="bg-red-500/20 rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-red-400">{summary.errors}</div>
                  <div className="text-sm text-red-300">Errors</div>
                </div>
              </div>

              <button
                onClick={resetScraper}
                className="flex items-center gap-2 bg-gg-pink text-black font-semibold px-6 py-3 rounded-lg hover:bg-gg-pink/90 transition-colors"
              >
                <Search size={18} />
                Scrape Another Site
              </button>
            </div>

            {/* Results List */}
            {scrapeResults.length > 0 && (
              <div className="bg-gg-gray-900 rounded-xl border border-gg-gray-800 overflow-hidden">
                <div className="p-4 border-b border-gg-gray-800">
                  <h3 className="font-semibold text-white">Scrape Results</h3>
                </div>
                <div className="divide-y divide-gg-gray-800">
                  {scrapeResults.map((result, idx) => (
                    <div key={idx} className="p-4">
                      <div className="flex items-start gap-3">
                        {result.success ? (
                          <CheckCircle className="text-green-400 flex-shrink-0 mt-1" size={18} />
                        ) : result.duplicate ? (
                          <AlertTriangle className="text-yellow-400 flex-shrink-0 mt-1" size={18} />
                        ) : (
                          <XCircle className="text-red-400 flex-shrink-0 mt-1" size={18} />
                        )}

                        <div className="flex-1 min-w-0">
                          {/* URL */}
                          <div className="text-gg-gray-400 text-xs truncate mb-2">{result.url}</div>

                          {result.error && (
                            <div className="text-red-400 text-sm">{result.error}</div>
                          )}

                          {result.success && result.details && (
                            <div className="flex gap-4">
                              {/* Image thumbnail */}
                              {result.details.primary_image_url && (
                                <div className="flex-shrink-0">
                                  <img
                                    src={result.details.primary_image_url}
                                    alt="Listing"
                                    className="w-24 h-24 object-cover rounded-lg border border-gg-gray-700"
                                  />
                                </div>
                              )}

                              {/* Listing details */}
                              <div className="flex-1 min-w-0">
                                {result.details.title && (
                                  <p className="text-white font-medium text-sm mb-2 line-clamp-2">{result.details.title}</p>
                                )}

                                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                  <p>
                                    <span className="text-gg-gray-500">Type:</span>{' '}
                                    <span className="text-gg-gray-300">
                                      {result.details.listing_type === 'auction' ? 'Auction' : 'Private Treaty'}
                                    </span>
                                  </p>
                                  {result.details.total_acres && (
                                    <p>
                                      <span className="text-gg-gray-500">Acres:</span>{' '}
                                      <span className="text-gg-gray-300">{result.details.total_acres}</span>
                                    </p>
                                  )}
                                  {result.details.county && result.details.state && (
                                    <p>
                                      <span className="text-gg-gray-500">Location:</span>{' '}
                                      <span className="text-gg-gray-300">{result.details.county} County, {result.details.state}</span>
                                    </p>
                                  )}
                                  {result.details.company_name && (
                                    <p>
                                      <span className="text-gg-gray-500">Company:</span>{' '}
                                      <span className="text-gg-gray-300">{result.details.company_name}</span>
                                    </p>
                                  )}
                                  {result.details.listing_type === 'auction' && result.details.auction_datetime && (
                                    <>
                                      <p>
                                        <span className="text-gg-gray-500">Auction Date:</span>{' '}
                                        <span className="text-gg-gray-300">
                                          {new Date(result.details.auction_datetime).toLocaleDateString()}
                                        </span>
                                      </p>
                                      <p>
                                        <span className="text-gg-gray-500">Auction Time:</span>{' '}
                                        <span className="text-gg-gray-300">
                                          {new Date(result.details.auction_datetime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                        </span>
                                      </p>
                                    </>
                                  )}
                                  {result.details.listing_type === 'private_treaty' && result.details.asking_price && (
                                    <p>
                                      <span className="text-gg-gray-500">Price:</span>{' '}
                                      <span className="text-gg-gray-300">${result.details.asking_price.toLocaleString()}</span>
                                    </p>
                                  )}
                                </div>

                                {/* Tracts */}
                                {result.details.tracts && result.details.tracts.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-gg-gray-700">
                                    <p className="text-xs text-gg-gray-500 mb-1">Tracts ({result.details.tracts.length}):</p>
                                    <div className="flex flex-wrap gap-2">
                                      {result.details.tracts.slice(0, 5).map((tract, i) => (
                                        <div key={i} className="text-xs bg-gg-gray-800 px-2 py-1 rounded">
                                          <span className="text-white">#{tract.tract_number || i + 1}</span>
                                          {tract.acres && (
                                            <span className="text-gg-gray-400 ml-1">{tract.acres} ac</span>
                                          )}
                                        </div>
                                      ))}
                                      {result.details.tracts.length > 5 && (
                                        <span className="text-xs text-gg-gray-500">+{result.details.tracts.length - 5} more</span>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Actions */}
                                <div className="flex items-center gap-3 mt-3">
                                  {result.listing_id && (
                                    <Link
                                      href={`/admin/listings/${result.listing_id}`}
                                      className="text-gg-pink hover:underline text-xs"
                                    >
                                      View Listing →
                                    </Link>
                                  )}
                                  <a
                                    href={result.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-gg-gray-400 hover:text-white text-xs"
                                  >
                                    View Source ↗
                                  </a>
                                </div>
                              </div>

                              {/* Verify button */}
                              {result.listing_id && (
                                <div className="flex-shrink-0">
                                  <button
                                    onClick={() => handleVerify(idx)}
                                    disabled={result.verifying || result.verified}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                                      result.verified
                                        ? 'bg-green-500/20 text-green-400'
                                        : 'bg-gg-gray-800 text-white hover:bg-gg-gray-700'
                                    } disabled:opacity-50`}
                                  >
                                    {result.verifying ? (
                                      <Loader2 size={16} className="animate-spin" />
                                    ) : (
                                      <CheckCircle size={16} />
                                    )}
                                    {result.verified ? 'Verified' : 'Verify'}
                                  </button>
                                </div>
                              )}
                            </div>
                          )}

                          {result.success && !result.details && result.listing_id && (
                            <div className="flex items-center justify-between">
                              <div className="text-green-400 text-sm">Created listing</div>
                              <button
                                onClick={() => handleVerify(idx)}
                                disabled={result.verifying || result.verified}
                                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
                                  result.verified
                                    ? 'bg-green-500/20 text-green-400'
                                    : 'bg-gg-gray-800 text-white hover:bg-gg-gray-700'
                                } disabled:opacity-50`}
                              >
                                {result.verifying ? (
                                  <Loader2 size={16} className="animate-spin" />
                                ) : (
                                  <CheckCircle size={16} />
                                )}
                                {result.verified ? 'Verified' : 'Verify'}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
