'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { X, Calendar, Building2, DollarSign, Loader2, MapPin } from 'lucide-react'

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
}

interface PortalListPanelProps {
  listings: Listing[]
  loading: boolean
  activeTab: TabType
  onClose: () => void
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

export default function PortalListPanel({ listings, loading, activeTab, onClose }: PortalListPanelProps) {
  return (
    <motion.div
      initial={{ x: -420 }}
      animate={{ x: 0 }}
      exit={{ x: -420 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 left-0 bottom-0 w-[400px] z-[400] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="pt-20 px-5 pb-4 border-b border-white/5 flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-lg font-semibold">{TAB_TITLES[activeTab]}</h2>
          <p className="text-xs text-gg-gray-400 mt-0.5">
            {loading ? 'Loading...' : `${listings.length} listing${listings.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition"
        >
          <X size={16} className="text-gg-gray-400" />
        </button>
      </div>

      {/* Listing Cards */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="animate-spin text-gg-pink" size={28} />
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center text-gg-gray-500 py-12">
            <p className="text-sm">No listings found</p>
          </div>
        ) : (
          listings.map(listing => (
            <Link
              key={listing.id}
              href={`/listings/${listing.id}`}
              className="block bg-white/[0.03] rounded-xl p-4 hover:bg-white/[0.06] transition border border-transparent hover:border-gg-pink/20 group"
            >
              {/* Top row: Title + Status */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <div className="text-sm font-semibold group-hover:text-gg-pink transition">
                    {listing.total_acres ? Math.round(listing.total_acres) : '—'} ac — {listing.county}
                  </div>
                  <div className="text-xs text-gg-gray-400 mt-0.5 flex items-center gap-1">
                    <MapPin size={11} />
                    {listing.county}, {listing.state}
                  </div>
                </div>
                {(activeTab === 'results' || listing.status === 'live') && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium uppercase shrink-0 ${
                    STATUS_COLORS[listing.status] || 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {listing.status === 'no_sale' ? 'No Sale' : listing.status}
                  </span>
                )}
              </div>

              {/* Company */}
              {(listing.company?.name || listing.company_name) && (
                <div className="text-xs text-gg-gray-400 flex items-center gap-1 mb-3">
                  <Building2 size={11} />
                  {listing.company?.name || listing.company_name}
                </div>
              )}

              {/* Stats row */}
              <div className="grid grid-cols-3 gap-2 pt-3 border-t border-white/5">
                <div>
                  <div className="text-[10px] text-gg-gray-500">Acres</div>
                  <div className="text-sm font-medium">{listing.total_acres ? Math.round(listing.total_acres).toLocaleString() : '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gg-gray-500">Tracts</div>
                  <div className="text-sm font-medium">{listing.tract_count || '—'}</div>
                </div>
                <div>
                  <div className="text-[10px] text-gg-gray-500">
                    {activeTab === 'private_treaty' ? 'Asking' : activeTab === 'results' ? 'Sold' : '$/Acre'}
                  </div>
                  <div className="text-sm font-medium">
                    {activeTab === 'private_treaty'
                      ? formatPrice(listing.asking_price)
                      : activeTab === 'results'
                        ? formatPrice(listing.sale_price)
                        : formatPrice(listing.price_per_acre)
                    }
                  </div>
                </div>
              </div>

              {/* Bottom: Date/Price info */}
              {activeTab === 'auctions' && (
                <div className="flex items-center gap-1.5 text-xs text-gg-gray-400 mt-3 pt-2 border-t border-white/5">
                  <Calendar size={12} />
                  <span>{formatDate(listing)}</span>
                  {formatTime(listing) && <span className="text-gg-gray-500">· {formatTime(listing)}</span>}
                </div>
              )}
              {activeTab === 'results' && listing.price_per_acre && (
                <div className="flex items-center gap-1.5 text-xs mt-3 pt-2 border-t border-white/5">
                  <DollarSign size={12} className="text-gg-gray-400" />
                  <span className="text-gg-pink font-medium">{formatPrice(listing.price_per_acre)}/ac</span>
                  <span className="text-gg-gray-500">· {formatDate(listing)}</span>
                </div>
              )}
            </Link>
          ))
        )}
      </div>
    </motion.div>
  )
}