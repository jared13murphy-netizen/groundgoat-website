'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  CheckCircle,
  XCircle,
  ExternalLink,
  MapPin,
  Calendar,
  Layers,
  Image as ImageIcon
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface StagingListing {
  id: number
  source_url: string
  source_url_hash: string
  listing_company_id: string | null
  company_name: string | null
  scraped_data: any
  screenshot_base64: string | null
  auction_date: string | null
  status: string
  created_at: string
}

export default function AdminStagingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<StagingListing[]>([])
  const [expandedScreenshot, setExpandedScreenshot] = useState<number | null>(null)

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
      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)
      if (!response.ok) throw new Error('Not authenticated')
      const userData = await response.json()
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }
      fetchStagingListings()
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchStagingListings = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging?status=pending`)
      if (response.ok) {
        const data = await response.json()
        setListings(data)
      }
    } catch (err) {
      console.error('Failed to fetch staging listings:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = (id: number) => {
    console.log('Verify staging listing:', id)
  }

  const handleReject = (id: number) => {
    console.log('Reject staging listing:', id)
  }

  const extractListingInfo = (scraped: any) => {
    if (!scraped) return { acres: null, county: null, state: null, description: null, tractCount: 0 }
    const listing = scraped.listing || {}
    const tracts = scraped.tracts || []
    const firstTract = tracts[0] || {}
    return {
      acres: listing.acres_listed || null,
      county: firstTract.county?.county_name || null,
      state: listing.state_full || firstTract.state_full || null,
      description: listing.description || null,
      tractCount: tracts.length,
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return dateStr
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
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white transition-colors">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Listing Staging</h1>
              <p className="text-gg-gray-400">{listings.length} pending listings to review</p>
            </div>
          </div>
          <button
            onClick={fetchStagingListings}
            className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 transition-colors text-sm"
          >
            Refresh
          </button>
        </div>

        {/* Empty State */}
        {listings.length === 0 && (
          <div className="card text-center py-16">
            <CheckCircle className="mx-auto mb-4 text-green-400" size={48} />
            <h2 className="text-xl font-bold text-white mb-2">All caught up!</h2>
            <p className="text-gg-gray-400">No pending listings to review.</p>
          </div>
        )}

        {/* Staging Cards */}
        <div className="space-y-6">
          {listings.map((listing) => {
            const info = extractListingInfo(listing.scraped_data)
            return (
              <div
                key={listing.id}
                className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl overflow-hidden"
              >
                <div className="flex flex-col lg:flex-row">
                  {/* Screenshot */}
                  <div className="lg:w-80 flex-shrink-0 bg-gg-gray-800">
                    {listing.screenshot_base64 ? (
                      <button
                        onClick={() =>
                          setExpandedScreenshot(
                            expandedScreenshot === listing.id ? null : listing.id
                          )
                        }
                        className="w-full"
                      >
                        <img
                          src={`data:image/png;base64,${listing.screenshot_base64}`}
                          alt="Page screenshot"
                          className="w-full h-48 lg:h-full object-cover object-top cursor-pointer hover:opacity-80 transition-opacity"
                        />
                      </button>
                    ) : (
                      <div className="w-full h-48 lg:h-full flex items-center justify-center text-gg-gray-600">
                        <ImageIcon size={48} />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-6">
                    {/* Company & Date Row */}
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white">
                          {listing.company_name || 'Unknown Company'}
                        </h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-gg-gray-400">
                          <span className="flex items-center gap-1">
                            <Calendar size={14} />
                            {formatDate(listing.auction_date)}
                          </span>
                          <span className="text-gg-gray-600">|</span>
                          <span>Staged {formatDate(listing.created_at)}</span>
                        </div>
                      </div>
                      <a
                        href={listing.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-gg-pink hover:text-white bg-gg-pink/10 hover:bg-gg-pink/20 rounded-lg transition-colors"
                      >
                        <ExternalLink size={14} />
                        Source
                      </a>
                    </div>

                    {/* Key Data */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="bg-gg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gg-gray-400 mb-1">Acres</p>
                        <p className="text-white font-semibold">
                          {info.acres ? `${info.acres}` : 'N/A'}
                        </p>
                      </div>
                      <div className="bg-gg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gg-gray-400 mb-1">Location</p>
                        <p className="text-white font-semibold flex items-center gap-1">
                          <MapPin size={12} className="text-gg-gray-500" />
                          {info.county && info.state
                            ? `${info.county}, ${info.state}`
                            : 'N/A'}
                        </p>
                      </div>
                      <div className="bg-gg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gg-gray-400 mb-1">Tracts</p>
                        <p className="text-white font-semibold flex items-center gap-1">
                          <Layers size={12} className="text-gg-gray-500" />
                          {info.tractCount}
                        </p>
                      </div>
                      <div className="bg-gg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gg-gray-400 mb-1">Auction Date</p>
                        <p className="text-white font-semibold">
                          {formatDate(listing.auction_date)}
                        </p>
                      </div>
                    </div>

                    {/* Description */}
                    {info.description && (
                      <p className="text-sm text-gg-gray-400 mb-4 line-clamp-2">
                        {info.description.length > 200
                          ? info.description.substring(0, 200) + '...'
                          : info.description}
                      </p>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleVerify(listing.id)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors font-medium"
                      >
                        <CheckCircle size={16} />
                        Verify
                      </button>
                      <button
                        onClick={() => handleReject(listing.id)}
                        className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors font-medium"
                      >
                        <XCircle size={16} />
                        Reject
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Screenshot */}
                {expandedScreenshot === listing.id && listing.screenshot_base64 && (
                  <div className="border-t border-gg-gray-800 p-4 bg-gg-gray-800/50">
                    <img
                      src={`data:image/png;base64,${listing.screenshot_base64}`}
                      alt="Full page screenshot"
                      className="w-full rounded-lg"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
