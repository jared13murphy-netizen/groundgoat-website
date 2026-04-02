'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { X, Bookmark, Loader2, Calendar, Building2, MapPin } from 'lucide-react'

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=600'

interface WatchlistListing {
  id: string
  county: string
  state: string
  total_acres: number
  listing_type: string
  status: string
  auction_datetime?: string
  auction_date?: string
  primary_image_url?: string
  asking_price?: number
  company?: { id: string; name: string }
  company_name?: string
  tract_count?: number
}

interface PortalWatchlistPanelProps {
  listings: WatchlistListing[]
  loading: boolean
  onClose: () => void
  onRemoveListing: (listingId: string) => void
  onSelectListing: (listingId: string) => void
}

function formatDate(listing: WatchlistListing): string {
  const raw = listing.auction_datetime || listing.auction_date
  if (!raw) return ''
  const d = new Date(raw)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatPrice(price?: number): string {
  if (!price) return ''
  return '$' + Math.round(price).toLocaleString()
}

function WatchlistCard({ listing, onRemove, onSelect }: {
  listing: WatchlistListing
  onRemove: (id: string) => void
  onSelect: (id: string) => void
}) {
  const [imgError, setImgError] = useState(false)
  const imgSrc = (!imgError && listing.primary_image_url) ? listing.primary_image_url : FALLBACK_IMAGE
  const handleImgError = useCallback(() => setImgError(true), [])
  const companyName = listing.company?.name || listing.company_name

  return (
    <div
      onClick={() => onSelect(listing.id)}
      className="bg-white/[0.03] rounded-xl overflow-hidden border border-transparent hover:bg-white/[0.06] hover:border-gg-pink/20 cursor-pointer group transition"
    >
      {/* Image with remove button */}
      <div className="relative h-32 w-full bg-gg-gray-800">
        <Image
          src={imgSrc}
          alt={`${listing.county}, ${listing.state}`}
          fill
          className="object-cover"
          sizes="450px"
          onError={handleImgError}
        />
        {/* Remove bookmark button */}
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(listing.id) }}
          className="absolute top-2 right-2 p-2 bg-black/40 backdrop-blur-sm rounded-lg hover:bg-black/60 transition z-10"
          title="Remove from watchlist"
        >
          <Bookmark size={14} className="text-gg-pink fill-gg-pink" />
        </button>
      </div>

      <div className="p-3.5">
        <div className="text-sm font-semibold group-hover:text-gg-pink transition">
          {listing.total_acres ? Math.round(listing.total_acres) : '—'} ac — {listing.county}
        </div>
        <div className="text-xs text-gg-gray-400 mt-0.5 flex items-center gap-1">
          <MapPin size={11} />
          {listing.county}, {listing.state}
        </div>

        {companyName && (
          <div className="text-xs text-gg-gray-400 flex items-center gap-1 mt-1.5">
            <Building2 size={11} />
            {companyName}
          </div>
        )}

        {/* Date or price */}
        {listing.listing_type === 'auction' && formatDate(listing) ? (
          <div className="flex items-center gap-1.5 text-xs text-gg-gray-300 mt-2">
            <Calendar size={11} className="text-gg-pink" />
            {formatDate(listing)}
          </div>
        ) : listing.asking_price ? (
          <div className="text-xs text-gg-pink font-medium mt-2">
            {formatPrice(listing.asking_price)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function PortalWatchlistPanel({ listings, loading, onClose, onRemoveListing, onSelectListing }: PortalWatchlistPanelProps) {
  return (
    <motion.div
      initial={{ x: -480 }}
      animate={{ x: 0 }}
      exit={{ x: -480 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 left-0 bottom-0 w-[440px] z-[510] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="pt-8 px-5 pb-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold">Watchlist</h2>
          <p className="text-xs text-gg-gray-400 mt-0.5">
            {listings.length} listing{listings.length !== 1 ? 's' : ''} saved
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition"
        >
          <X size={16} className="text-gg-gray-400" />
        </button>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="animate-spin text-gg-pink" size={28} />
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-16">
            <Bookmark size={40} className="text-gg-gray-600 mx-auto mb-3" />
            <p className="text-sm text-gg-gray-500">No saved listings</p>
            <p className="text-xs text-gg-gray-600 mt-1">Tap the bookmark icon on any listing to save it here</p>
          </div>
        ) : (
          listings.map(listing => (
            <WatchlistCard
              key={listing.id}
              listing={listing}
              onRemove={onRemoveListing}
              onSelect={onSelectListing}
            />
          ))
        )}
      </div>
    </motion.div>
  )
}
