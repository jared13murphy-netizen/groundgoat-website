'use client'

import { useState, useEffect, useCallback } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  ArrowLeft, MapPin, Calendar, Clock, Building2,
  DollarSign, ExternalLink, Share2, BarChart3, Loader2, RefreshCw, Bookmark
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { getStatusBadge } from '@/lib/listingStatusBadge'

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
  polygon_coordinates?: [number, number][] | null
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
  is_incomplete?: boolean
  incomplete_reason?: string
}

interface PortalListingDetailProps {
  listingId: string
  onBack: () => void
  onTractSelected?: (tract: any) => void
  /** Fired once the listing's full payload (including tracts +
      polygon_coordinates) is loaded. Parents use this to zoom the
      map to the listing's first tract on open. */
  onListingLoaded?: (listing: Listing) => void
  onFindComparables?: (tractId: string, county: string, state: string) => void
  userAccountType?: string
  isWatchlisted?: boolean
  onToggleWatchlist?: (listingId: string) => void
}

const LAND_TYPE_COLORS: Record<string, string> = {
  'Farm': 'bg-green-500',
  'Recreational': 'bg-blue-500',
  'Pasture': 'bg-yellow-500',
  'Commercial': 'bg-purple-500',
  'Residential': 'bg-pink-500',
  'Development': 'bg-red-500',
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
  const d = new Date(dateString)
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December']
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function formatTime(listing: Listing): string {
  if (!listing.auction_datetime) return ''
  const d = new Date(listing.auction_datetime)
  const hours = d.getHours()
  const mins = d.getMinutes()
  if (hours === 0 && mins === 0) return ''
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${h12}:${String(mins).padStart(2, '0')} ${ampm}`
}

export default function PortalListingDetail({ listingId, onBack, onTractSelected, onListingLoaded, onFindComparables, userAccountType, isWatchlisted, onToggleWatchlist }: PortalListingDetailProps) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [loading, setLoading] = useState(true)
  const [heroImgError, setHeroImgError] = useState(false)
  const [rescraping, setRescraping] = useState(false)
  const [rescrapeResult, setRescrapeResult] = useState<{ success: boolean; message: string } | null>(null)

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
        onListingLoaded?.(data)
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
          src={(!heroImgError && listing.primary_image_url) ? listing.primary_image_url : FALLBACK_IMAGE}
          alt={`${listing.county}, ${listing.state}`}
          fill
          className="object-cover"
          sizes="500px"
          onError={() => setHeroImgError(true)}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Status badge — colors mirror map pin palette so list-card,
            detail page, and map pin all read the same status. */}
        {(() => {
          const badge = getStatusBadge(listing.status, listing.listing_type)
          return (
            <span className={`absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-semibold ${badge.className}`}>
              {badge.label}
            </span>
          )
        })()}

        {/* Share + Bookmark */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <button
            onClick={handleShare}
            className="p-2 bg-black/40 backdrop-blur-sm rounded-lg hover:bg-black/60 transition"
          >
            <Share2 size={14} className="text-white" />
          </button>
          {onToggleWatchlist && (
            <button
              onClick={() => onToggleWatchlist(listingId)}
              className="p-2 bg-black/40 backdrop-blur-sm rounded-lg hover:bg-black/60 transition"
            >
              <Bookmark size={14} className={isWatchlisted ? 'text-gg-pink fill-gg-pink' : 'text-white'} />
            </button>
          )}
        </div>
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
        {!listing.is_incomplete && (
          <div className="text-center">
            <div className="text-lg font-bold">{listing.tracts?.length || listing.tract_count || '—'}</div>
            <div className="text-[10px] text-gg-gray-500 uppercase">Tracts</div>
          </div>
        )}
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

      {/* Rescrape Button — GG Admin only */}
      {userAccountType === 'groundgoat_admin' && listing.source_url && (
        <div>
          {rescrapeResult ? (
            <div className={`px-4 py-3 rounded-xl text-xs font-medium ${
              rescrapeResult.success ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              {rescrapeResult.message}
            </div>
          ) : (
            <button
              onClick={async () => {
                setRescraping(true)
                setRescrapeResult(null)
                try {
                  const res = await fetchWithAuth(`${API_URL}/api/admin/listings/${listingId}/rescrape`, { method: 'POST' })
                  const data = await res.json()
                  setRescrapeResult({
                    success: data.success,
                    message: data.success ? 'Sent to staging for review' : (data.message || data.detail || 'Rescrape failed'),
                  })
                } catch (err) {
                  setRescrapeResult({ success: false, message: 'Failed to contact server' })
                }
                setRescraping(false)
              }}
              disabled={rescraping}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-400 text-xs font-semibold hover:bg-orange-500/20 transition disabled:opacity-50"
            >
              {rescraping ? (
                <><Loader2 size={14} className="animate-spin" /> Rescraping...</>
              ) : (
                <><RefreshCw size={14} /> Rescrape Listing</>
              )}
            </button>
          )}
        </div>
      )}

      {/* Incomplete Banner */}
      {listing.is_incomplete && (
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 mb-4">
          <div className="text-orange-400 font-semibold text-sm">Details Coming Soon</div>
          <div className="text-orange-400/70 text-xs mt-1">
            Tract details will be available closer to the auction date. Check back soon for boundaries, soil ratings, and per-tract acreage.
          </div>
        </div>
      )}

      {/* Tracts */}
      {listing.tracts && listing.tracts.length > 0 && !listing.is_incomplete && (
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
                    polygonCoordinates: tract.polygon_coordinates,
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
                      <img
                        src={tract.image_url}
                        alt={`Tract ${tract.tract_number || index + 1}`}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE }}
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
                        {tract.sale_status && ['sold', 'no_sale', 'pending'].includes(tract.sale_status.toLowerCase()) && (() => {
                          const badge = getStatusBadge(tract.sale_status, listing.listing_type)
                          return (
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.className}`}>
                              {badge.label}
                            </span>
                          )
                        })()}
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
                    {onFindComparables && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          onFindComparables(
                            tract.id,
                            tract.county_name || listing.county,
                            tract.state_abbr || listing.state
                          )
                        }}
                        className="mt-3 flex items-center justify-center gap-2 w-full py-2 bg-gg-pink/10 text-gg-pink border border-gg-pink/30 rounded-lg hover:bg-gg-pink/20 transition text-xs font-medium"
                      >
                        <BarChart3 size={14} />
                        Find Comparables
                      </button>
                    )}
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