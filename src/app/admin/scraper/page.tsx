'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, 
  Play, 
  Plus, 
  Trash2, 
  CheckCircle, 
  XCircle, 
  Clock,
  ExternalLink,
  Loader2
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface ScraperJob {
  id: string
  url: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: {
    listings_created: number
    tracts_created: number
    listing_id?: string
    company_id?: string
    details?: {
      total_acres?: number
      county?: string
      state?: string
      company_name?: string
      listing_type?: string
      auction_datetime?: string
      asking_price?: number
    }
  }
  error?: string
  existing_listing_id?: string
}

export default function AdminScraperPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [urls, setUrls] = useState<string[]>([''])
  const [jobs, setJobs] = useState<ScraperJob[]>([])
  const [running, setRunning] = useState(false)
  const [schemaId, setSchemaId] = useState(1) // 1 = Land Auction, 2 = Private Treaty, 3 = Equipment

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
      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)

      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()
      
      if (userData.account_type !== 'groundgoat_admin' && userData.account_type !== 'groundgoat_sales') {
        router.push('/account')
        return
      }

      setUser(userData)
    } catch (err) {
      router.push('/signin')
    } finally {
      setLoading(false)
    }
  }

  const addUrlField = () => {
    setUrls([...urls, ''])
  }

  const removeUrlField = (index: number) => {
    const newUrls = urls.filter((_, i) => i !== index)
    setUrls(newUrls.length ? newUrls : [''])
  }

  const updateUrl = (index: number, value: string) => {
    const newUrls = [...urls]
    newUrls[index] = value
    setUrls(newUrls)
  }

  const runScraper = async () => {
    const validUrls = urls.filter(url => url.trim())
    if (validUrls.length === 0) return

    setRunning(true)
    const newJobs: ScraperJob[] = validUrls.map((url, i) => ({
      id: `job-${Date.now()}-${i}`,
      url,
      status: 'pending',
    }))
    setJobs(newJobs)

    const token = localStorage.getItem('auth_token')

    // Process each URL sequentially
    for (let i = 0; i < newJobs.length; i++) {
      setJobs(prev => prev.map((job, idx) => 
        idx === i ? { ...job, status: 'running' } : job
      ))

      try {
        const response = await fetchWithAuth(`${API_URL}/api/scraper/run`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ 
            url: newJobs[i].url,
            schema_id: schemaId
          }),
        })

        if (response.ok) {
          const result = await response.json()
          // Check if backend returned success: false (e.g., duplicate)
          if (result.success === false) {
            setJobs(prev => prev.map((job, idx) => 
              idx === i ? { 
                ...job, 
                status: 'failed', 
                error: result.error || 'Failed to scrape',
                existing_listing_id: result.listing_id  // For duplicates
              } : job
            ))
          } else {
            setJobs(prev => prev.map((job, idx) => 
              idx === i ? { 
                ...job, 
                status: 'completed', 
                result: {
                  listings_created: result.listings_created,
                  tracts_created: result.tracts_created,
                  listing_id: result.listing_id,
                  company_id: result.company_id,
                  details: result.details
                }
              } : job
            ))
          }
        } else {
          const error = await response.json()
          setJobs(prev => prev.map((job, idx) => 
            idx === i ? { ...job, status: 'failed', error: error.detail || 'Failed to scrape' } : job
          ))
        }
      } catch (err: any) {
        setJobs(prev => prev.map((job, idx) => 
          idx === i ? { ...job, status: 'failed', error: err.message || 'Network error' } : job
        ))
      }

      // Small delay between jobs to avoid overwhelming the server
      if (i < newJobs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    setRunning(false)
  }

  const clearResults = () => {
    setJobs([])
    setUrls([''])
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
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="font-display text-4xl font-bold text-white">Scraper</h1>
            <p className="text-gg-gray-400">Enter auction listing URLs to scrape and add to the database</p>
          </div>
        </div>

        {/* URL Input Section */}
        <div className="card mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-white">Listing URLs</h2>
            <div className="flex items-center gap-2">
              <label className="text-gg-gray-400 text-sm">Type:</label>
              <select
                value={schemaId}
                onChange={(e) => setSchemaId(Number(e.target.value))}
                disabled={running}
                className="bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-1 text-white text-sm"
              >
                <option value={1}>Land Auction</option>
                <option value={2}>Private Treaty</option>
                <option value={3}>Equipment Auction</option>
              </select>
            </div>
          </div>
          
          <div className="space-y-3">
            {urls.map((url, index) => (
              <div key={index} className="flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(e) => updateUrl(index, e.target.value)}
                  placeholder="https://example.com/auction/listing"
                  className="flex-1 bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                  disabled={running}
                />
                <button
                  onClick={() => removeUrlField(index)}
                  disabled={running || urls.length === 1}
                  className="p-3 text-gg-gray-400 hover:text-red-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 size={20} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-4 mt-6">
            <button
              onClick={addUrlField}
              disabled={running}
              className="btn-secondary flex items-center gap-2"
            >
              <Plus size={20} />
              Add URL
            </button>
            <button
              onClick={runScraper}
              disabled={running || !urls.some(u => u.trim())}
              className="btn-primary flex items-center gap-2"
            >
              {running ? (
                <>
                  <Loader2 size={20} className="animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play size={20} />
                  Run Scraper
                </>
              )}
            </button>
          </div>
        </div>

        {/* Results Section */}
        {jobs.length > 0 && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Results</h2>
              {!running && (
                <button
                  onClick={clearResults}
                  className="text-sm text-gg-gray-400 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="space-y-4">
              {jobs.map((job, index) => (
                <div
                  key={job.id}
                  className={`p-4 rounded-lg border ${
                    job.status === 'completed' ? 'border-green-500/30 bg-green-500/5' :
                    job.status === 'failed' ? 'border-red-500/30 bg-red-500/5' :
                    job.status === 'running' ? 'border-gg-pink/30 bg-gg-pink/5' :
                    'border-gg-gray-700 bg-gg-gray-800/50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-1">
                      {job.status === 'completed' && <CheckCircle className="text-green-500" size={20} />}
                      {job.status === 'failed' && <XCircle className="text-red-500" size={20} />}
                      {job.status === 'running' && <Loader2 className="text-gg-pink animate-spin" size={20} />}
                      {job.status === 'pending' && <Clock className="text-gg-gray-500" size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-medium truncate">{job.url}</span>
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gg-gray-400 hover:text-gg-pink flex-shrink-0"
                        >
                          <ExternalLink size={14} />
                        </a>
                      </div>
                      {job.status === 'completed' && job.result && (
                        <div className="text-sm text-green-400">
                          <p>Created {job.result.listings_created} listing(s), {job.result.tracts_created} tract(s)</p>
                          {job.result.details && (
                            <div className="mt-1 text-gg-gray-300 text-xs space-y-0.5">
                              {job.result.details.total_acres && (
                                <p><span className="text-gg-gray-500">Acres:</span> {job.result.details.total_acres}</p>
                              )}
                              {job.result.details.county && job.result.details.state && (
                                <p><span className="text-gg-gray-500">Location:</span> {job.result.details.county} County, {job.result.details.state}</p>
                              )}
                              {job.result.details.company_name && (
                                <p><span className="text-gg-gray-500">Company:</span> {job.result.details.company_name}</p>
                              )}
                              {job.result.details.listing_type === 'auction' && job.result.details.auction_datetime && (
                                <p><span className="text-gg-gray-500">Auction:</span> {new Date(job.result.details.auction_datetime).toLocaleString()}</p>
                              )}
                              {job.result.details.listing_type === 'private_treaty' && job.result.details.asking_price && (
                                <p><span className="text-gg-gray-500">Price:</span> ${job.result.details.asking_price.toLocaleString()}</p>
                              )}
                            </div>
                          )}
                          {job.result.listing_id && (
                            <Link 
                              href={`/admin/listings/${job.result.listing_id}`}
                              className="text-gg-pink hover:underline mt-1 inline-block"
                            >
                              View/Edit Listing →
                            </Link>
                          )}
                        </div>
                      )}
                      {job.status === 'failed' && job.error && (
                        <div className="text-sm text-red-400">
                          <p>{job.error}</p>
                          {job.existing_listing_id && (
                            <Link 
                              href={`/admin/listings/${job.existing_listing_id}`}
                              className="text-gg-pink hover:underline"
                            >
                              Edit Existing Listing →
                            </Link>
                          )}
                        </div>
                      )}
                      {job.status === 'running' && (
                        <p className="text-sm text-gg-pink">Extracting data and creating listing...</p>
                      )}
                      {job.status === 'pending' && (
                        <p className="text-sm text-gg-gray-500">Waiting...</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="mt-8 card bg-gg-gray-900/50">
          <h3 className="font-semibold text-white mb-2">Instructions</h3>
          <ul className="space-y-2 text-sm text-gg-gray-400">
            <li>• Enter one or more auction listing URLs from supported auction company websites</li>
            <li>• Select the listing type (Land Auction, Private Treaty, or Equipment Auction)</li>
            <li>• The scraper will extract property details, tract information, and company data</li>
            <li>• Each URL should be a direct link to a specific listing page</li>
            <li>• Results are automatically added to the Ground Goat database</li>
            <li>• Click the listing link after completion to review and edit the extracted data</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
