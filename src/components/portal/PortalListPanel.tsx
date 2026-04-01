'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { X, Calendar, Building2, DollarSign, Loader2, MapPin } from 'lucide-react'
import PortalListingDetail from './PortalListingDetail'

type TabType = 'auctions' | 'private_treaty' | 'results'

interface Listing {
  id: string
  county: string
  state: string
  total_acres: number
  listing_type: string
  status: string
  auction_datetime?: string
  auction_date?: string
  auction_time?: string
  primary_image_url?: string
  asking_price?: number
  sale_price?: number
  price_per_acre?: number
  company?: { id: string; name: string }
  company_name?: string
  tract_count?: number
  tracts?: { id: string; tillable_acres?: number; soil_rating?: number; csr2?: number; total_acres?: number }[]
}

interface PortalListPanelProps {
  listings: Listing[]
  loading: boolean
  activeTab: TabType
  onClose: () => void
  onTractSelected?: (tract: any) => void
  onFindComparables?: (tractId: string, county: string, state: string) => void
  activeFilters?: { stateFilter: string; countyFilters: string[] }
}

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=600'

const STATUS_COLORS: Record<string, string> = {
  listed: 'bg-blue-500/20 text-blue-400',
  live: 'bg-red-500/20 text-red-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  sold: 'bg-purple-500/20 text-purple-400',
  no_sale: 'bg-gray-500/20 text-gray-400',
}

const TAB_TITLES: Record<TabType, string> = {
  auctions: 'Upcoming Auctions',
  private_treaty: 'Private Treaty',
  results: 'Recent Results',
}

function formatDate(listing: Listing): string {
  const raw = listing.auction_datetime || listing.auction_date
  if (!raw) return ''
  const d = new Date(raw)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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
  return ''
}

function formatPrice(price?: number): string {
  if (!price) return '—'
  return '$' + Math.round(price).toLocaleString()
}

const STATE_SOIL_LABELS: Record<string, string> = {
  IL: 'PI', IA: 'CSR2', IN: 'WAPI', MO: 'NCCPI', MN: 'CPI',
  NE: 'NCCPI', SD: 'PI', ND: 'PI', KS: 'NCCPI', OH: 'NCCPI',
  MI: 'NCCPI', WI: 'PI', KY: 'NCCPI', TN: 'NCCPI', WV: 'NCCPI', VA: 'NCCPI',
}

function getSoilLabel(state?: string): string {
  if (state) return STATE_SOIL_LABELS[state.toUpperCase()] || 'Soil'
  return 'Soil'
}

function getListingTillableAcres(listing: Listing): number | null {
  if (!listing.tracts?.length) return null
  const total = listing.tracts.reduce((sum, t) => sum + (t.tillable_acres || 0), 0)
  return total > 0 ? total : null
}

function getListingSoilRating(listing: Listing): number | null {
  if (!listing.tracts?.length) return null
  const withRating = listing.tracts.filter(t => t.soil_rating || t.csr2)
  if (withRating.length === 0) return null
  const avg = withRating.reduce((sum, t) => sum + (Number(t.soil_rating) || Number(t.csr2) || 0), 0) / withRating.length
  return Math.round(avg * 10) / 10
}

function ListingCard({ listing, activeTab, onClick }: { listing: Listing; activeTab: TabType; onClick: () => void }) {
  const hasCompany = !!(listing.company?.name || listing.company_name)
  const [imgError, setImgError] = useState(false)
  const imgSrc = (!imgError && listing.primary_image_url) ? listing.primary_image_url : FALLBACK_IMAGE
  const handleImgError = useCallback(() => setImgError(true), [])

  return (
    <div
      onClick={hasCompany ? onClick : undefined}
      className={`bg-white/[0.03] rounded-xl overflow-hidden border border-transparent transition ${
        hasCompany ? 'hover:bg-white/[0.06] hover:border-gg-pink/20 cursor-pointer group' : 'opacity-80'
      }`}
    >
      {/* Image */}
      <div className="relative h-36 w-full bg-gg-gray-800">
        <Image
          src={imgSrc}
          alt={`${listing.county}, ${listing.state}`}
          fill
          className="object-cover"
          sizes="500px"
          onError={handleImgError}
        />
        {listing.status === 'live' && (
          <span className="absolute top-2 right-2 text-[10px] px-2 py-1 rounded-full font-bold uppercase bg-red-500 text-white flex items-center gap-1.5 animate-pulse shadow-lg shadow-red-500/40">
            <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            Live Now
          </span>
        )}
        {activeTab === 'results' && listing.status !== 'live' && (
          <span className={`absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full font-medium uppercase ${
            STATUS_COLORS[listing.status] || 'bg-gray-500/20 text-gray-400'
          }`}>
            {listing.status === 'no_sale' ? 'No Sale' : listing.status}
          </span>
        )}
      </div>

      <div className="p-4">
        {/* Title */}
        <div className={`text-sm font-semibold ${hasCompany ? 'group-hover:text-gg-pink' : ''} transition`}>
          {listing.total_acres ? Math.round(listing.total_acres) : '—'} ac — {listing.county}
        </div>
        <div className="text-xs text-gg-gray-400 mt-0.5 flex items-center gap-1">
          <MapPin size={11} />
          {listing.county}, {listing.state}
        </div>

        {/* Company */}
        {hasCompany && (
          <div className="text-xs text-gg-gray-400 flex items-center gap-1 mt-2">
            <Building2 size={11} />
            {listing.company?.name || listing.company_name}
          </div>
        )}

        {/* Auction date/time - prominent for auctions */}
        {activeTab === 'auctions' && (
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5 bg-gg-pink/5 rounded-lg px-3 py-2 -mx-1">
            <Calendar size={14} className="text-gg-pink shrink-0" />
            <span className="text-sm font-bold text-white">{formatDate(listing)}</span>
            {formatTime(listing) && <span className="text-sm font-semibold text-gg-pink">· {formatTime(listing)}</span>}
          </div>
        )}

        {/* Stats row */}
        <div className={`grid ${activeTab === 'auctions' ? 'grid-cols-4' : 'grid-cols-3'} gap-2 pt-3 mt-3 border-t border-white/5`}>
          <div>
            <div className="text-[10px] text-gg-gray-500">Acres</div>
            <div className="text-sm font-medium">{listing.total_acres ? Math.round(listing.total_acres).toLocaleString() : '—'}</div>
          </div>
          <div>
            <div className="text-[10px] text-gg-gray-500">Tracts</div>
            <div className="text-sm font-medium">{listing.tract_count || '—'}</div>
          </div>
          {activeTab === 'auctions' ? (
            <>
              <div>
                <div className="text-[10px] text-gg-gray-500">Tillable</div>
                <div className="text-sm font-medium">{getListingTillableAcres(listing) ? Math.round(getListingTillableAcres(listing)!) + ' ac' : '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-gg-gray-500">{getSoilLabel(listing.state)}</div>
                <div className="text-sm font-medium">{getListingSoilRating(listing) ?? '—'}</div>
              </div>
            </>
          ) : (
            <div>
              <div className="text-[10px] text-gg-gray-500">
                {activeTab === 'private_treaty' ? 'Asking' : 'Sold'}
              </div>
              <div className="text-sm font-medium">
                {activeTab === 'private_treaty'
                  ? formatPrice(listing.asking_price)
                  : formatPrice(listing.sale_price)
                }
              </div>
            </div>
          )}
        </div>

        {/* Results: price per acre + date */}
        {activeTab === 'results' && listing.price_per_acre && (
          <div className="flex items-center gap-1.5 text-xs mt-3 pt-2 border-t border-white/5">
            <DollarSign size={12} className="text-gg-gray-400" />
            <span className="text-gg-pink font-medium">{formatPrice(listing.price_per_acre)}/ac</span>
            <span className="text-gg-gray-500">· {formatDate(listing)}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PortalListPanel({ listings, loading, activeTab, onClose, onTractSelected, onFindComparables, activeFilters }: PortalListPanelProps) {
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)

  return (
    <motion.div
      initial={{ x: -500 }}
      animate={{ x: 0 }}
      exit={{ x: -500 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 left-0 bottom-0 w-[480px] z-[400] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="pt-20 px-5 pb-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {selectedListingId ? 'Listing Detail' : TAB_TITLES[activeTab]}
          </h2>
          <button
            onClick={() => {
              if (selectedListingId) {
                setSelectedListingId(null)
              } else {
                onClose()
              }
            }}
            className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition"
          >
            <X size={16} className="text-gg-gray-400" />
          </button>
        </div>
        {/* Active filters display */}
        {!selectedListingId && activeFilters && (activeFilters.stateFilter || activeFilters.countyFilters.length > 0) && (
          <p className="text-xs text-gg-gray-400 mt-2">
            Showing{activeFilters.stateFilter ? ` ${activeFilters.stateFilter}` : ''}{activeFilters.countyFilters.length > 0 ? ` · ${activeFilters.countyFilters.join(', ')}` : ''}
          </p>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {selectedListingId ? (
          <PortalListingDetail
            listingId={selectedListingId}
            onBack={() => setSelectedListingId(null)}
            onTractSelected={onTractSelected}
            onFindComparables={onFindComparables}
          />
        ) : loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="animate-spin text-gg-pink" size={28} />
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center text-gg-gray-500 py-12">
            <p className="text-sm">No listings found</p>
          </div>
        ) : (
          <div className="space-y-4">
            {listings.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                activeTab={activeTab}
                onClick={() => setSelectedListingId(listing.id)}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}