'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Clock,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { formatAcres } from '@/lib/format'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface IncompleteListingItem {
  id: string
  title: string
  county: string
  state: string
  total_acres: number | null
  auction_datetime: string | null
  listing_type: string
  status: string
  source_url: string | null
  company_name: string | null
  incomplete_reason: string | null
  last_rescrape_at: string | null
  rescrape_count: number
  created_at: string
}

export default function IncompletePage() {
  const [listings, setListings] = useState<IncompleteListingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [rescrapingIds, setRescrapingIds] = useState<Set<string>>(new Set())
  const [rescrapeResults, setRescrapeResults] = useState<Record<string, { success: boolean; error?: string }>>({})
  const LIMIT = 30

  const fetchListings = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: LIMIT.toString(), offset: (page * LIMIT).toString() })
      const res = await fetchWithAuth(`${API_URL}/api/admin/incomplete-listings?${params}`)
      if (res.ok) {
        const json = await res.json()
        setListings(json.listings || [])
        setTotal(json.total || 0)
      }
    } catch (e) {
      console.error('Failed to fetch incomplete listings', e)
    }
    setLoading(false)
  }

  useEffect(() => { fetchListings() }, [page])

  const handleRescrape = async (listingId: string, sourceUrl: string) => {
    setRescrapingIds(prev => new Set(prev).add(listingId))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/rescrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId })
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setRescrapeResults(prev => ({ ...prev, [listingId]: { success: true } }))
      } else {
        setRescrapeResults(prev => ({ ...prev, [listingId]: { success: false, error: json.detail || json.error || 'Failed' } }))
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—'
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const daysUntilAuction = (dateStr: string | null) => {
    if (!dateStr) return null
    const d = new Date(dateStr)
    const now = new Date()
    const diff = Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    return diff
  }

  const [sortBy, setSortBy] = useState<'days' | 'date' | 'default'>('days')

  const sortedListings = [...listings].sort((a, b) => {
    if (sortBy === 'days') {
      const dA = daysUntilAuction(a.auction_datetime)
      const dB = daysUntilAuction(b.auction_datetime)
      if (dA === null && dB === null) return 0
      if (dA === null) return 1
      if (dB === null) return -1
      return dA - dB
    }
    if (sortBy === 'date') {
      const dA = a.auction_datetime ? new Date(a.auction_datetime).getTime() : Infinity
      const dB = b.auction_datetime ? new Date(b.auction_datetime).getTime() : Infinity
      return dA - dB
    }
    return 0
  })

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="min-h-screen bg-gg-gray-900 text-white p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/admin/dashboard" className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Incomplete Listings</h1>
            <p className="text-gray-400 text-sm">
              {total} listing{total !== 1 ? 's' : ''} awaiting tract details
            </p>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="animate-spin text-gg-pink" size={32} />
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <CheckCircle size={48} className="mx-auto mb-4 text-green-400" />
            <p className="text-lg font-medium text-white">All caught up!</p>
            <p>No incomplete listings right now.</p>
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
                    <th className="px-4 py-3 text-right">Acres</th>
                    <th className="px-4 py-3">Auction Date</th>
                    <th
                      className="px-4 py-3 text-center cursor-pointer hover:text-white transition"
                      onClick={() => setSortBy(sortBy === 'days' ? 'default' : 'days')}
                    >
                      Days Left {sortBy === 'days' ? '▲' : ''}
                    </th>
                    <th className="px-4 py-3">Last Scraped</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3 text-center">Rescrapes</th>
                    <th className="px-4 py-3">URL</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedListings.map((item) => {
                    const isRescraping = rescrapingIds.has(item.id)
                    const result = rescrapeResults[item.id]
                    const days = daysUntilAuction(item.auction_datetime)
                    const isUrgent = days !== null && days <= 14 && days >= 0
                    const isPast = days !== null && days < 0

                    return (
                      <tr key={item.id} className={`border-b border-gg-gray-700/50 hover:bg-gg-gray-700/30 ${isUrgent ? 'bg-orange-500/5' : ''} ${isPast ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 font-medium">{item.company_name || 'Unknown'}</td>
                        <td className="px-4 py-3">{item.county || '—'}</td>
                        <td className="px-4 py-3">{item.state || '—'}</td>
                        <td className="px-4 py-3 text-right">
                          {item.total_acres ? `${formatAcres(item.total_acres)} ac` : '—'}
                        </td>
                        <td className="px-4 py-3">
                          {formatDate(item.auction_datetime)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {days === null ? '—' : days < 0 ? (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-gray-500/20 text-gray-400 font-medium">Past</span>
                          ) : days === 0 ? (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 text-red-400 font-bold">Today</span>
                          ) : days === 1 ? (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 font-bold">Tomorrow</span>
                          ) : days <= 7 ? (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium">{days} days</span>
                          ) : days <= 14 ? (
                            <span className="text-[11px] px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 font-medium">{days} days</span>
                          ) : (
                            <span className="text-gray-400">{days} days</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {item.last_rescrape_at ? formatDate(item.last_rescrape_at) : formatDate(item.created_at)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {(item.incomplete_reason || '').replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-gray-400">{item.rescrape_count}</span>
                        </td>
                        <td className="px-4 py-3 max-w-[200px] truncate">
                          {item.source_url && (
                            <a
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-300 flex items-center gap-1"
                            >
                              <span className="truncate">{item.source_url.replace(/https?:\/\/(www\.)?/, '').slice(0, 30)}</span>
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
                              onClick={() => item.source_url && handleRescrape(item.id, item.source_url)}
                              disabled={isRescraping || !item.source_url}
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
                  Showing {page * LIMIT + 1}-{Math.min((page + 1) * LIMIT, total)} of {total}
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
