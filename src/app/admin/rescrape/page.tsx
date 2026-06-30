'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  ExternalLink,
  Filter,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Layers,
  CheckCircle,
  AlertTriangle
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { formatAcres } from '@/lib/format'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface RescrapeListingItem {
  id: string
  source_url: string
  county: string | null
  state: string | null
  total_acres: number | null
  status: string
  sale_price: number | null
  company_name: string | null
  tract_count: number
  tracts_missing_boundary: number
  auction_datetime: string | null
  listing_type: string | null
}

interface RescrapeResponse {
  total: number
  listings: RescrapeListingItem[]
  company_counts: Record<string, number>
  state_counts: Record<string, number>
  limit: number
  offset: number
}

export default function ReScrapePage() {
  const router = useRouter()
  const [data, setData] = useState<RescrapeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [rescrapingIds, setRescrapingIds] = useState<Set<string>>(new Set())
  const [rescrapeResults, setRescrapeResults] = useState<Record<string, { success: boolean; staging_id?: number; error?: string }>>({})
  const [stateFilter, setStateFilter] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')
  const [page, setPage] = useState(0)
  const LIMIT = 50

  const fetchListings = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: LIMIT.toString(), offset: (page * LIMIT).toString() })
      if (stateFilter) params.append('state', stateFilter)
      if (companyFilter) params.append('company', companyFilter)
      const res = await fetchWithAuth(`${API_URL}/api/admin/rescrape/listings?${params}`)
      if (res.ok) {
        const json = await res.json()
        setData(json)
      }
    } catch (e) {
      console.error('Failed to fetch rescrape listings', e)
    }
    setLoading(false)
  }

  useEffect(() => { fetchListings() }, [page, stateFilter, companyFilter])

  const handleRescrape = async (listingId: string) => {
    setRescrapingIds(prev => new Set(prev).add(listingId))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/rescrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId })
      })
      const json = await res.json()
      if (!res.ok) {
        setRescrapeResults(prev => ({ ...prev, [listingId]: { success: false, error: json.detail || `HTTP ${res.status}` } }))
      } else {
        setRescrapeResults(prev => ({ ...prev, [listingId]: json }))
      }
    } catch (e: any) {
      setRescrapeResults(prev => ({ ...prev, [listingId]: { success: false, error: e.message } }))
    }
    setRescrapingIds(prev => {
      const next = new Set(prev)
      next.delete(listingId)
      return next
    })
  }

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 0

  return (
    <div className="min-h-screen bg-gg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/dashboard" className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Rescrape Listings</h1>
            <p className="text-gray-400 text-sm">
              {data ? `${data.total} listings with tracts missing boundary lines` : 'Loading...'}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-6">
          <select
            className="bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300"
            value={stateFilter}
            onChange={(e) => { setStateFilter(e.target.value); setPage(0) }}
          >
            <option value="">Filter by State</option>
            {data && Object.entries(data.state_counts)
              .sort((a, b) => b[1] - a[1])
              .map(([state, count]) => (
                <option key={state} value={state}>{state} ({count})</option>
              ))
            }
          </select>
          <select
            className="bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-sm text-gray-300"
            value={companyFilter}
            onChange={(e) => { setCompanyFilter(e.target.value); setPage(0) }}
          >
            <option value="">Filter by Company</option>
            {data && Object.entries(data.company_counts)
              .sort((a, b) => b[1] - a[1])
              .map(([company, count]) => (
                <option key={company} value={company}>{company} ({count})</option>
              ))
            }
          </select>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-gg-pink" size={32} />
          </div>
        ) : (
          <>
            <div className="bg-gg-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gg-gray-700 text-gray-400 text-left">
                    <th className="px-4 py-3">Company</th>
                    <th className="px-4 py-3">County</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Tracts</th>
                    <th className="px-4 py-3 text-right">Missing</th>
                    <th className="px-4 py-3 text-right">Acres</th>
                    <th className="px-4 py-3">URL</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.listings.map((item) => {
                    const isRescraping = rescrapingIds.has(item.id)
                    const result = rescrapeResults[item.id]
                    return (
                      <tr key={item.id} className="border-b border-gg-gray-700/50 hover:bg-gg-gray-700/30">
                        <td className="px-4 py-3 font-medium">{item.company_name || 'Unknown'}</td>
                        <td className="px-4 py-3">{item.county || '-'}</td>
                        <td className="px-4 py-3">{item.state || '-'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">
                          {item.auction_datetime ? (() => {
                            const d = new Date(item.auction_datetime!)
                            const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                            return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
                          })() : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">{item.tract_count}</td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-red-400">{item.tracts_missing_boundary}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {item.total_acres ? `${formatAcres(item.total_acres)} ac` : '-'}
                        </td>
                        <td className="px-4 py-3 max-w-[300px] truncate">
                          {item.source_url && (
                            <a
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                            >
                              <span className="truncate">{item.source_url.replace(/https?:\/\/(www\.)?/, '').slice(0, 40)}</span>
                              <ExternalLink size={12} className="flex-shrink-0" />
                            </a>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {result?.success ? (
                            <Link
                              href="/admin/staging"
                              className="inline-flex items-center gap-1 text-green-400 hover:text-green-300 text-xs"
                            >
                              <CheckCircle size={14} />
                              In Staging
                            </Link>
                          ) : result?.error ? (
                            <span className="inline-flex items-center gap-1 text-red-400 text-xs" title={result.error}>
                              <AlertTriangle size={14} />
                              Failed
                            </span>
                          ) : (
                            <button
                              onClick={() => handleRescrape(item.id)}
                              disabled={isRescraping}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gg-pink/20 text-gg-pink rounded-lg hover:bg-gg-pink/30 disabled:opacity-50 text-xs font-medium"
                            >
                              {isRescraping ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <RefreshCw size={14} />
                              )}
                              {isRescraping ? 'Scraping...' : 'Rescrape'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4">
                <p className="text-gray-400 text-sm">
                  Showing {page * LIMIT + 1}-{Math.min((page + 1) * LIMIT, data?.total || 0)} of {data?.total}
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="p-2 rounded-lg bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-30"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="p-2 rounded-lg bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-30"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
