'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import fetchWithAuth from '@/lib/fetchWithAuth'
import {
  Loader2, ArrowLeft, MapPin, Calendar, Clock, Building2,
  DollarSign, ExternalLink, Share2, BarChart3
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=600'

interface Company {
  id: string
  name: string
}

interface Tract {
  id: string
  tract_number?: number
  total_acres?: number
  tillable_acres?: number
  soil_rating?: number
  land_type?: string
  sale_status?: string
  sale_price?: number
  estimated_value_per_acre?: number
  estimate_confidence?: number
}

interface Listing {
  id: string
  title?: string
  county: string
  state: string
  total_acres?: number
  sold_acres?: number
  listing_type: string
  status: string
  auction_datetime?: string
  auction_date?: string
  auction_time?: string
  auction_location?: string
  bidding_url?: string
  source_url?: string
  primary_image_url?: string
  asking_price?: number
  sale_price?: number
  price_per_acre?: number
  description?: string
  company?: Company
  company_name?: string
  tracts?: Tract[]
  tract_count?: number
}

interface User {
  account_type: string
}

const ALLOWED_ROLES = ['groundgoat_admin', 'groundgoat_sales', 'firm_admin', 'firm_user']

const LAND_TYPE_COLORS: Record<string, string> = {
  'Farm': 'bg-green-500',
  'Recreational': 'bg-blue-500',
  'Pasture': 'bg-yellow-500',
  'Commercial': 'bg-purple-500',
  'Residential': 'bg-pink-500',
  'Development': 'bg-red-500',
}

export default function ListingDetailPage({ params }: { params: { id: string } }) {
  const { id } = params
  const router = useRouter()

  const [user, setUser] = useState<User | null>(null)
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    if (user) {
      fetchListing()
    }
  }, [user, id])

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/signin')
        return
      }

      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)
      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()

      if (!ALLOWED_ROLES.includes(userData.account_type)) {
        router.push('/account')
        return
      }

      setUser(userData)
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchListing = async () => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/listings/${id}`)
      if (response.ok) {
        const data = await response.json()
        setListing(data)
      } else {
        router.push('/listings')
      }
    } catch (err) {
      console.error('Failed to fetch listing:', err)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'listed': return 'bg-blue-500'
      case 'live': return 'bg-red-500 animate-pulse'
      case 'pending': return 'bg-yellow-500'
      case 'sold': return 'bg-purple-500'
      case 'no_sale': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'listed': return 'Upcoming'
      case 'live': return 'LIVE NOW'
      case 'pending': return 'Pending'
      case 'sold': return 'Sold'
      case 'no_sale': return 'No Sale'
      default: return status
    }
  }

  const formatCurrency = (value: number | undefined) => {
    if (!value) return '—'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
  }

  const formatAcres = (acres: number | undefined) => {
    if (!acres && acres !== 0) return '—'
    return acres.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '—'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  const formatTime = (dateString: string | undefined) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  const getCompanyName = () => {
    if (listing?.company?.name) return listing.company.name
    if (listing?.company_name) return listing.company_name
    return null
  }

  const getTotalAcres = () => {
    if (listing?.total_acres) return listing.total_acres
    if (listing?.tracts?.length) {
      const sum = listing.tracts.reduce((acc, tract) => acc + (tract.total_acres || 0), 0)
      if (sum > 0) return sum
    }
    return null
  }

  const getDisplayAcres = () => {
    const status = listing?.status?.toLowerCase()
    const showSoldAcres = status === 'sold' || status === 'no_sale' || status === 'pending'

    if (showSoldAcres) {
      const acres = listing?.sold_acres ?? getTotalAcres()
      return { acres, label: 'Sold Acres' }
    }
    return { acres: getTotalAcres(), label: 'Total Acres' }
  }

  const getPricePerAcre = () => {
    if (listing?.price_per_acre) return listing.price_per_acre
    const acres = getTotalAcres()
    if (listing?.sale_price && acres) return listing.sale_price / acres
    if (listing?.asking_price && acres) return listing.asking_price / acres
    return null
  }

  const handleShare = async () => {
    const url = listing?.source_url || listing?.bidding_url || window.location.href
    const text = `Check out this listing: ${listing?.county} County, ${listing?.state}`

    if (navigator.share) {
      try {
        await navigator.share({ title: text, url })
      } catch (err) {
        // User cancelled or error
      }
    } else {
      await navigator.clipboard.writeText(url)
      alert('Link copied to clipboard!')
    }
  }

  const isAuction = listing?.listing_type === 'auction'

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-center">
          <MapPin className="mx-auto text-gg-gray-600 mb-4" size={48} />
          <p className="text-gg-gray-400 mb-4">Listing not found</p>
          <Link href="/listings" className="text-gg-pink hover:underline">
            Back to Listings
          </Link>
        </div>
      </div>
    )
  }

  const { acres: displayAcres, label: acresLabel } = getDisplayAcres()

  return (
    <div className="min-h-screen bg-gg-black pt-24">
      <div className="max-w-5xl mx-auto px-6 pb-12">
        {/* Hero Image */}
        <div className="relative h-72 md:h-96 bg-gg-gray-900 rounded-xl overflow-hidden mb-6">
          <img
            src={listing.primary_image_url || FALLBACK_IMAGE}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gg-black/80 via-transparent to-transparent" />

          {/* Back Button */}
          <div className="absolute top-4 left-4">
            <Link
              href="/listings"
              className="flex items-center gap-2 px-4 py-2 bg-black/50 backdrop-blur-sm text-white rounded-lg hover:bg-black/70 transition-colors"
            >
              <ArrowLeft size={20} />
              Back to Listings
            </Link>
          </div>

          {/* Action Buttons */}
          <div className="absolute top-4 right-4 flex gap-2">
            <button
              onClick={handleShare}
              className="p-3 bg-black/50 backdrop-blur-sm text-white rounded-lg hover:bg-black/70 transition-colors"
            >
              <Share2 size={20} />
            </button>
          </div>

          {/* Status Badge */}
          {listing.status !== 'listed' && (
            <div className={`absolute bottom-4 left-4 px-4 py-2 rounded-full text-sm font-semibold text-white ${getStatusColor(listing.status)}`}>
              {getStatusLabel(listing.status)}
            </div>
          )}
        </div>
        {/* Main Info Card */}
        <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-6 mb-6">
          <h1 className="font-display text-3xl font-bold text-white mb-2">
            {listing.county} County, {listing.state}
          </h1>
          {getCompanyName() && (
            <p className="text-gg-pink text-lg flex items-center gap-2 mb-6">
              <Building2 size={18} />
              {getCompanyName()}
            </p>
          )}

          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-4 bg-gg-gray-800 rounded-lg p-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{formatAcres(displayAcres ?? undefined)}</div>
              <div className="text-gg-gray-400 text-sm">{acresLabel}</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-white">{listing.tracts?.length || listing.tract_count || '—'}</div>
              <div className="text-gg-gray-400 text-sm">Tracts</div>
            </div>
            {getPricePerAcre() && (
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{formatCurrency(getPricePerAcre()!)}</div>
                <div className="text-gg-gray-400 text-sm">$/Acre</div>
              </div>
            )}
          </div>

          {/* Auction/Listing Details */}
          {isAuction ? (
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white mb-4">Auction Details</h2>
              <div className="bg-gg-gray-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Calendar size={20} className="text-gg-pink" />
                  <div>
                    <div className="text-gg-gray-400 text-sm">Date</div>
                    <div className="text-white">{formatDate(listing.auction_datetime || listing.auction_date)}</div>
                  </div>
                </div>
                {(listing.auction_datetime || listing.auction_time) && (
                  <div className="flex items-center gap-3">
                    <Clock size={20} className="text-gg-pink" />
                    <div>
                      <div className="text-gg-gray-400 text-sm">Time</div>
                      <div className="text-white">{formatTime(listing.auction_datetime || listing.auction_time)}</div>
                    </div>
                  </div>
                )}
                {listing.auction_location && (
                  <div className="flex items-center gap-3">
                    <MapPin size={20} className="text-gg-pink" />
                    <div>
                      <div className="text-gg-gray-400 text-sm">Location</div>
                      <div className="text-white">{listing.auction_location}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white mb-4">Listing Details</h2>
              <div className="bg-gg-gray-800 rounded-lg p-4 space-y-3">
                {listing.asking_price && (
                  <div className="flex items-center gap-3">
                    <DollarSign size={20} className="text-gg-pink" />
                    <div>
                      <div className="text-gg-gray-400 text-sm">Asking Price</div>
                      <div className="text-white">{formatCurrency(listing.asking_price)}</div>
                    </div>
                  </div>
                )}
                {getPricePerAcre() && (
                  <div className="flex items-center gap-3">
                    <DollarSign size={20} className="text-gg-pink" />
                    <div>
                      <div className="text-gg-gray-400 text-sm">Price per Acre</div>
                      <div className="text-white">{formatCurrency(getPricePerAcre()!)}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          {listing.description && !listing.description.includes("(data from API connector)") && (
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white mb-4">Description</h2>
              <p className="text-gg-gray-300 leading-relaxed whitespace-pre-line">{listing.description}</p>
            </div>
          )}

          {/* View Details Button */}
          {(listing.bidding_url || listing.source_url) && (
            <a
              href={listing.bidding_url || listing.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 bg-gg-pink text-white font-semibold rounded-lg hover:bg-gg-pink/80 transition-colors"
            >
              <ExternalLink size={18} />
              {listing.bidding_url ? 'View Auction' : 'View Details'}
            </a>
          )}
        </div>

        {/* Tracts */}
        {listing.tracts && listing.tracts.length > 0 && (
          <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-6">
            <h2 className="text-xl font-semibold text-white mb-4">
              Tracts ({listing.tracts.length})
            </h2>
            <div className="space-y-4">
              {listing.tracts.map((tract, index) => (
                <div key={tract.id || index} className="bg-gg-gray-800 rounded-lg p-4">
                  {/* Tract Header */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-white font-semibold">
                      Tract {tract.tract_number || index + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      {tract.land_type && (
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold text-white ${LAND_TYPE_COLORS[tract.land_type] || 'bg-gg-pink'}`}>
                          {tract.land_type}
                        </span>
                      )}
                      {tract.sale_status && ['sold', 'no_sale', 'pending'].includes(tract.sale_status.toLowerCase()) && (
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold text-white ${getStatusColor(tract.sale_status.toLowerCase())}`}>
                          {getStatusLabel(tract.sale_status.toLowerCase())}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Tract Stats */}
                  <div className="grid grid-cols-4 gap-4 text-center">
                    <div>
                      <div className="text-white font-medium">{formatAcres(tract.total_acres)}</div>
                      <div className="text-gg-gray-500 text-xs">Acres</div>
                    </div>
                    {tract.tillable_acres && (
                      <div>
                        <div className="text-white font-medium">{formatAcres(tract.tillable_acres)}</div>
                        <div className="text-gg-gray-500 text-xs">Tillable</div>
                      </div>
                    )}
                    {tract.soil_rating && (
                      <div>
                        <div className="text-white font-medium">{tract.soil_rating}</div>
                        <div className="text-gg-gray-500 text-xs">Soil Rating</div>
                      </div>
                    )}
                    {tract.sale_price && tract.total_acres && (
                      <div>
                        <div className="text-white font-medium">{formatCurrency(tract.sale_price / tract.total_acres)}</div>
                        <div className="text-gg-gray-500 text-xs">$/Acre</div>
                      </div>
                    )}
                  </div>

                  {/* Find Comparables Button */}
                  <Link
                    href={`/listings/${listing.id}/comparables?tractId=${tract.id}`}
                    className="mt-3 flex items-center justify-center gap-2 w-full py-2 bg-gg-pink/10 text-gg-pink border border-gg-pink/30 rounded-lg hover:bg-gg-pink/20 transition-colors text-sm font-medium"
                  >
                    <BarChart3 size={16} />
                    Find Comparables
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
