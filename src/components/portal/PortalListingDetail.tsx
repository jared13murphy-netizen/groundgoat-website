'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowLeft, MapPin, Calendar, Clock, Building2,
  DollarSign, ExternalLink, Share2, BarChart3, Loader2
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

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
  price_per_acre?: number
  estimated_value_per_acre?: number
  estimate_confidence?: number
  image_url?: string
  township?: string
  county_name?: string
  state_abbr?: string
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

interface PortalListingDetailProps {
  listingId: string
  onBack: () => void
  onTractSelected?: (tract: any) => void
}

const LAND_TYPE_COLORS: Record<string, string> = {
  'Farm': 'bg-green-500',
  'Recreational': 'bg-blue-500',
  'Pasture': 'bg-yellow-500',
  'Commercial': 'bg-purple-500',
  'Residential': 'bg-pink-500',
  'Development': 'bg-red-500',
}

const STATUS_COLORS: Record<string, string> = {
  listed: 'bg-blue-500',
  live: 'bg-red-500 animate-pulse',
  pending: 'bg-yellow-500',
  sold: 'bg-purple-500',
  no_sale: 'bg-red-500',
}

const STATUS_LABELS: Record<string, string> = {
  listed: 'Upcoming',
  live: 'LIVE NOW',
  pending: 'Pending',
  sold: 'Sold',
  no_sale: 'No Sale',
}

function formatCurrency(value?: number): string {
  if (!value) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatAcres(acres?: number): string {
  if (!acres && acres !== 0) return '—'
  return acres.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function formatDate(dateString?: string): string {
  if (!dateString) return '—'
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTime(listing: Listing): string {
  if (listing.auction_time) {
    try {
      const [h, m] = listing.auction_time.split(':')
      const hour = parseInt(h)
      const ampm = hour >= 12 ? 'PM' : 'AM'
      const h12 = hour % 12 || 12
      return `${h12}:${m} ${ampm}`
    } catch { return '' }
  }
  if (listing.auction_datetime) {
    const date = new Date(listing.auction_datetime)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }
  return ''
}

export default function PortalListingDetail({ listingId, onBack, onTractSelected }: PortalListingDetailProps) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchListing()
  }, [listingId])

  const fetchListing = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/listings/${listingId}`)
      if (response.ok) {
        const data = await response.json()
        setListing(data)
      }
    } catch (err) {
      console.error('Failed to fetch listing:', err)
    } finally {
      setLoading(false)
    }
  }

  const getCompanyName = () => listing?.company?.name || listing?.company_name || null

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
      return { acres: listing?.sold_acres ?? getTotalAcres(), label: 'Sold Acres' }
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
      try { await navigator.share({ title: text, url }) } catch {}
    } else {
      await navigator.clipboard.writeText(url)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-gg-pink" size={28} />
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="text-center py-12">
        <MapPin className="mx-auto text-gg-gray-600 mb-4" size={36} />
        <p className="text-gg-gray-400 text-sm mb-3">Listing not found</p>
        <button onClick={onBack} className="text-gg-pink text-sm hover:underline">Go Back</button>
      </div>
    )
  }

  const isAuction = listing.listing_type === 'auction'
  const { acres: displayAcres, label: acresLabel } = getDisplayAcres()

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
    >
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-gg-gray-400 hover:text-white transition mb-4 group"
      >
        <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
        Back to list
      </button>

      {/* Hero Image */}
      <div className="relative h-48 bg-gg-gray-800 rounded-xl overflow-hidden mb-4">
        <Image
          src={listing.primary_image_url || FALLBACK_IMAGE}
          alt={`${listing.county}, ${listing.state}`}
          fill
          className="object-cover"
          sizes="500px"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Status badge */}
        {listing.status !== 'listed' && (
          <span className={`absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-semibold text-white ${STATUS_COLORS[listing.status] || 'bg-gray-500'}`}>
            {STATUS_LABELS[listing.status] || listing.status}
          </span>
        )}

        {/* Share */}
        <button
          onClick={handleShare}
          className="absolute top-3 left-3 p-2 bg-black/40 backdrop-blur-sm rounded-lg hover:bg-black/60 transition"
        >
          <Share2 size={14} className="text-white" />
        </button>
      </div>

      {/* Title */}
      <h2 className="text-xl font-bold mb-1">
        {listing.county} County, {listing.state}
      </h2>
      {getCompanyName() && (
        <p className="text-gg-pink text-sm flex items-center gap-1.5 mb-4">
          <Building2 size={14} />
          {getCompanyName()}
        </p>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-3 bg-white/[0.03] rounded-xl p-4 border border-white/5 mb-4">
        <div className="text-center">
          <div className="text-lg font-bold">{formatAcres(displayAcres ?? undefined)}</div>
          <div className="text-[10px] text-gg-gray-500 uppercase">{acresLabel}</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold">{listing.tracts?.length || listing.tract_count || '—'}</div>
          <div className="text-[10px] text-gg-gray-500 uppercase">Tracts</div>
        </div>
        {getPricePerAcre() && (
          <div className="text-center">
            <div className="text-lg font-bold text-gg-pink">{formatCurrency(getPricePerAcre()!)}</div>
            <div className="text-[10px] text-gg-gray-500 uppercase">$/Acre</div>
          </div>
        )}
      </div>

      {/* Auction/Listing Details */}
      {isAuction ? (
        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5 mb-4 space-y-3">
          <h3 className="text-sm font-semibold text-gg-gray-300 uppercase tracking-wider">Auction Details</h3>
          <div className="flex items-center gap-3">
            <Calendar size={16} className="text-gg-pink shrink-0" />
            <div>
              <div className="text-[10px] text-gg-gray-500">Date</div>
              <div className="text-sm">{formatDate(listing.auction_datetime || listing.auction_date)}</div>
            </div>
          </div>
          {formatTime(listing) && (
            <div className="flex items-center gap-3">
              <Clock size={16} className="text-gg-pink shrink-0" />
              <div>
                <div className="text-[10px] text-gg-gray-500">Time</div>
                <div className="text-sm">{formatTime(listing)}</div>
              </div>
            </div>
          )}
          {listing.auction_location && (
            <div className="flex items-center gap-3">
              <MapPin size={16} className="text-gg-pink shrink-0" />
              <div>
                <div className="text-[10px] text-gg-gray-500">Location</div>
                <div className="text-sm">{listing.auction_location}</div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5 mb-4 space-y-3">
          <h3 className="text-sm font-semibold text-gg-gray-300 uppercase tracking-wider">Listing Details</h3>
          {listing.asking_price && (
            <div className="flex items-center gap-3">
              <DollarSign size={16} className="text-gg-pink shrink-0" />
              <div>
                <div className="text-[10px] text-gg-gray-500">Asking Price</div>
                <div className="text-sm">{formatCurrency(listing.asking_price)}</div>
              </div>
            </div>
          )}
          {listing.sale_price && (
            <div className="flex items-center gap-3">
              <DollarSign size={16} className="text-gg-pink shrink-0" />
              <div>
                <div className="text-[10px] text-gg-gray-500">Sale Price</div>
                <div className="text-sm">{formatCurrency(listing.sale_price)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Description */}
      {listing.description && !listing.description.includes("(data from API connector)") && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-gg-gray-300 uppercase tracking-wider mb-2">Description</h3>
          <p className="text-sm text-gg-gray-400 leading-relaxed whitespace-pre-line">{listing.description}</p>
        </div>
      )}

      {/* External link */}
      {(listing.bidding_url || listing.source_url) && (
        <a
          href={listing.bidding_url || listing.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3 bg-gg-pink text-white font-semibold rounded-xl hover:bg-gg-pink/80 transition text-sm mb-4"
        >
          <ExternalLink size={16} />
          {listing.bidding_url ? 'View Auction' : 'View Details'}
        </a>
      )}

      {/* Tracts */}
      {listing.tracts && listing.tracts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gg-gray-300 uppercase tracking-wider mb-3">
            Tracts ({listing.tracts.length})
          </h3>
          <div className="space-y-3">
            {listing.tracts.map((tract, index) => {
              const handleTractClick = () => {
                if (onTractSelected) {
                  onTractSelected({
                    id: tract.id,
                    listingId: listing.id,
                    tractId: tract.id,
                    auctionDate: listing.auction_datetime || listing.auction_date,
                    totalAcres: tract.total_acres,
                    tillableAcres: tract.tillable_acres,
                    companyName: getCompanyName(),
                    salePrice: tract.sale_price,
                    pricePerAcre: tract.sale_price && tract.total_acres ? tract.sale_price / tract.total_acres : tract.price_per_acre,
                    county: listing.county,
                    state: listing.state,
                    township: tract.township,
                    soilRating: tract.soil_rating,
                    saleStatus: tract.sale_status || listing.status,
                    listingType: listing.listing_type,
                  })
                }
              }

              return (
                <div
                  key={tract.id || index}
                  className={`bg-white/[0.03] rounded-xl overflow-hidden border border-white/5 ${onTractSelected ? 'hover:border-gg-pink/20 hover:bg-white/[0.06] cursor-pointer group' : ''} transition`}
                  onClick={onTractSelected ? handleTractClick : undefined}
                >
                  {/* Tract Image */}
                  {tract.image_url && (
                    <div className="relative h-32 w-full bg-gg-gray-800">
                      <Image
                        src={tract.image_url}
                        alt={`Tract ${tract.tract_number || index + 1}`}
                        fill
                        className="object-cover"
                        sizes="500px"
                      />
                    </div>
                  )}

                  <div className="p-4">
                    {/* Tract Header */}
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-sm font-semibold ${onTractSelected ? 'group-hover:text-gg-pink' : ''} transition`}>
                        Tract {tract.tract_number || index + 1}
                      </span>
                      <div className="flex items-center gap-2">
                        {tract.land_type && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${LAND_TYPE_COLORS[tract.land_type] || 'bg-gg-pink'}`}>
                            {tract.land_type}
                          </span>
                        )}
                        {tract.sale_status && ['sold', 'no_sale', 'pending'].includes(tract.sale_status.toLowerCase()) && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold text-white ${STATUS_COLORS[tract.sale_status.toLowerCase()] || 'bg-gray-500'}`}>
                            {STATUS_LABELS[tract.sale_status.toLowerCase()] || tract.sale_status}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Tract Stats */}
                    <div className="grid grid-cols-4 gap-2 text-center">
                      <div>
                        <div className="text-sm font-medium">{formatAcres(tract.total_acres)}</div>
                        <div className="text-[10px] text-gg-gray-500">Acres</div>
                      </div>
                      {tract.tillable_acres ? (
                        <div>
                          <div className="text-sm font-medium">{formatAcres(tract.tillable_acres)}</div>
                          <div className="text-[10px] text-gg-gray-500">Tillable</div>
                        </div>
                      ) : null}
                      {tract.soil_rating ? (
                        <div>
                          <div className="text-sm font-medium">{tract.soil_rating}</div>
                          <div className="text-[10px] text-gg-gray-500">Soil Rating</div>
                        </div>
                      ) : null}
                      {tract.sale_price && tract.total_acres ? (
                        <div>
                          <div className="text-sm font-medium text-gg-pink">{formatCurrency(tract.sale_price / tract.total_acres)}</div>
                          <div className="text-[10px] text-gg-gray-500">$/Acre</div>
                        </div>
                      ) : null}
                    </div>

                    {/* Find Comparables */}
                    <Link
                      href={`/listings/${listing.id}/comparables?tractId=${tract.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-3 flex items-center justify-center gap-2 w-full py-2 bg-gg-pink/10 text-gg-pink border border-gg-pink/30 rounded-lg hover:bg-gg-pink/20 transition text-xs font-medium"
                    >
                      <BarChart3 size={14} />
                      Find Comparables
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </motion.div>
  )
}