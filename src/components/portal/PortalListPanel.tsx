'use client'

import { useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { X, Calendar, Building2, DollarSign, Loader2, MapPin, Bookmark, Pencil, Search } from 'lucide-react'
import Link from 'next/link'
import PortalListingDetail from './PortalListingDetail'
import { getStatusBadge } from '@/lib/listingStatusBadge'
import { formatAcres, toNum } from '@/lib/format'
import { listingMatchesSearch } from '@/lib/listingSearch'

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
  primary_image_url?: string
  marketing_image_url?: string
  asking_price?: number
  sale_price?: number
  price_per_acre?: number
  company?: { id: string; name: string }
  company_name?: string
  tract_count?: number
  tracts?: { id: string; tillable_acres?: number; soil_rating?: number; csr2?: number; total_acres?: number; price_per_acre?: number }[]
  is_incomplete?: boolean
  incomplete_reason?: string
}

interface PortalListPanelProps {
  listings: Listing[]
  loading: boolean
  activeTab: TabType
  onClose: () => void
  onTractSelected?: (tract: any) => void
  /** Forwarded to PortalListingDetail — fired when the listing's
      full payload (including tract polygons) finishes loading.
      Lets the access page zoom the map to the first tract. */
  onListingLoaded?: (listing: any) => void
  onFindComparables?: (tractId: string, county: string, state: string) => void
  activeFilters?: { stateFilter: string; countyFilters: string[] }
  onClearFilters?: () => void
  userAccountType?: string
  watchlistIds?: Set<string>
  onToggleWatchlist?: (listingId: string) => void
}

const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=600'

// Landscape twin of a marketing image (same file name + '-wide.jpg', written by
// the staging service beside the portrait one). Used for wide boxes.
function wideMarketingImage(url?: string | null): string | null {
  if (!url || !/\.jpg$/i.test(url)) return null
  return url.replace(/\.jpg$/i, '-wide.jpg')
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
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function formatTime(listing: Listing): string {
  const raw = listing.auction_datetime
  if (!raw) return ''
  const d = new Date(raw)
  const hours = d.getHours()
  const mins = d.getMinutes()
  // Skip midnight (00:00) — means no time was set
  if (hours === 0 && mins === 0) return ''
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${h12}:${String(mins).padStart(2, '0')} ${ampm}`
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

export function getSoilLabel(state?: string): string {
  if (state) return STATE_SOIL_LABELS[state.toUpperCase()] || 'Soil'
  return 'Soil'
}

export function getListingTillableAcres(tracts?: { tillable_acres?: number; total_acres?: number }[]): number | null {
  if (!tracts?.length) return null
  // toNum, not raw +. The API sends DECIMALs as strings, so `0 + "59.94"`
  // concatenated to "059.94" — the leading zero the owner reported — and a
  // two-tract listing silently produced a nonsense total. See lib/format.ts.
  // getListingSoilRating below already did this correctly with Number();
  // these two sums were the ones that missed it.
  const total = tracts.reduce((sum, t) => sum + (toNum(t.tillable_acres) ?? 0), 0)
  return total > 0 ? total : null
}

function getListingAvgPricePerAcre(listing: Listing): { avg: number | null; isAverage: boolean } {
  // Use listing-level price_per_acre if available
  const listingPpa = toNum(listing.price_per_acre)
  if (listingPpa) {
    return { avg: listingPpa, isAverage: (listing.tract_count || 1) > 1 }
  }
  // Compute from tracts
  if (!listing.tracts?.length) return { avg: null, isAverage: false }
  const withPrice = listing.tracts.filter(t => toNum(t.price_per_acre))
  if (withPrice.length === 0) return { avg: null, isAverage: false }
  const avg = withPrice.reduce((sum, t) => sum + (toNum(t.price_per_acre) ?? 0), 0) / withPrice.length
  return { avg: Math.round(avg), isAverage: withPrice.length > 1 }
}

export function getListingSoilRating(tracts?: { tillable_acres?: number; total_acres?: number; soil_rating?: number; csr2?: number }[]): number | null {
  if (!tracts?.length) return null
  let weightedSum = 0
  let totalWeight = 0
  for (const t of tracts) {
    const r = Number(t.soil_rating) > 0 ? Number(t.soil_rating) : (Number(t.csr2) > 0 ? Number(t.csr2) : null)
    if (r === null) continue
    const w = Number(t.tillable_acres) > 0 ? Number(t.tillable_acres) : Number(t.total_acres)
    if (!(w > 0)) continue
    weightedSum += r * w
    totalWeight += w
  }
  if (totalWeight === 0) return null
  return Math.round((weightedSum / totalWeight) * 10) / 10
}

function ListingCard({ listing, activeTab, onClick, isWatchlisted, onToggleWatchlist, isAdmin }: { listing: Listing; activeTab: TabType; onClick: () => void; isWatchlisted?: boolean; onToggleWatchlist?: (id: string) => void; isAdmin?: boolean }) {
  const hasCompany = !!(listing.company?.name || listing.company_name)
  const [imgError, setImgError] = useState(false)
  const imgSrc = (!imgError && (wideMarketingImage(listing.marketing_image_url) || listing.primary_image_url)) || FALLBACK_IMAGE
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
        {/* Bookmark button */}
        {onToggleWatchlist && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleWatchlist(listing.id) }}
            className="absolute top-2 left-2 p-2 bg-black/40 backdrop-blur-sm rounded-lg hover:bg-black/60 transition z-10"
          >
            <Bookmark size={14} className={isWatchlisted ? 'text-gg-pink fill-gg-pink' : 'text-white'} />
          </button>
        )}
        {listing.is_incomplete && (
          <span className="absolute top-2 left-2 text-[10px] px-2 py-1 rounded-full font-bold uppercase bg-orange-500/90 text-white shadow-lg">
            Details Coming Soon
          </span>
        )}
        {(() => {
          // Always show a status badge so card and detail-page badges
          // tell the same story; getStatusBadge picks the right color
          // (sold→pink, auction→blue, live→green, etc.) to match the
          // map pin palette.
          const badge = getStatusBadge(listing.status, listing.listing_type)
          return (
            <span
              className={`absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase shadow-lg ${badge.className}`}
            >
              {badge.label}
            </span>
          )
        })()}
      </div>

      {/* Card body — subtle dark gradient: #1a1a1a top → #3a3a3a
          (gg-gray-600) bottom. Enough delta to pop off the black panel
          but stays in the dark zone, so all text stays light. */}
      <div className="p-4 bg-gradient-to-b from-gg-gray-800 to-[#222222] text-white">
        {/* Title */}
        <div className={`text-sm font-semibold ${hasCompany ? 'group-hover:text-gg-pink' : ''} transition`}>
          {listing.total_acres ? formatAcres(listing.total_acres) : '—'} ac — {listing.county}
        </div>
        <div className="text-xs text-gg-gray-300 mt-0.5 flex items-center gap-1">
          <MapPin size={11} />
          {listing.county}, {listing.state}
        </div>

        {/* Company */}
        {hasCompany && (
          <div className="text-xs text-gg-gray-300 flex items-center gap-1 mt-2">
            <Building2 size={11} />
            {listing.company?.name || listing.company_name}
          </div>
        )}

        {/* Admin: Edit Listing shortcut */}
        {isAdmin && (
          <Link
            href={`/admin/listings/${listing.id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 mt-2 text-[10px] font-semibold text-gg-pink/70 hover:text-gg-pink transition"
          >
            <Pencil size={10} />
            Edit Listing
          </Link>
        )}

        {/* Auction date/time - prominent calendar style for auctions */}
        {activeTab === 'auctions' && (
          <div className="flex items-center gap-3 mt-3 bg-gg-pink/10 rounded-lg px-3 py-2.5 -mx-1 border border-gg-pink/30">
            <div className="flex items-center justify-center bg-gg-pink rounded-lg w-11 h-11 shrink-0">
              <span className="text-sm font-black text-white">
                {(() => { const d = new Date(listing.auction_datetime || listing.auction_date || ''); return ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()] })()}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white">{formatDate(listing)}{formatTime(listing) ? ` at ${formatTime(listing)}` : ''}</span>
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className={`grid ${activeTab === 'auctions' ? 'grid-cols-4' : 'grid-cols-3'} gap-2 pt-3 mt-3 border-t border-white/15`}>
          <div>
            <div className="text-[10px] text-gg-gray-300">Acres</div>
            <div className="text-sm font-semibold text-white">{listing.total_acres ? formatAcres(listing.total_acres) : '—'}</div>
          </div>
          {!listing.is_incomplete && (
            <div>
              <div className="text-[10px] text-gg-gray-300">Tracts</div>
              <div className="text-sm font-semibold text-white">{listing.tract_count || '—'}</div>
            </div>
          )}
          {activeTab === 'auctions' ? (
            <>
              <div>
                <div className="text-[10px] text-gg-gray-300">Tillable</div>
                <div className="text-sm font-semibold text-white">{listing.is_incomplete ? '—' : (getListingTillableAcres(listing.tracts) ? formatAcres(getListingTillableAcres(listing.tracts)!) + ' ac' : '—')}</div>
              </div>
              <div>
                <div className="text-[10px] text-gg-gray-300">{getSoilLabel(listing.state)}</div>
                <div className="text-sm font-semibold text-white">{listing.is_incomplete ? '—' : (getListingSoilRating(listing.tracts) ?? '—')}</div>
              </div>
            </>
          ) : (
            <div>
              <div className="text-[10px] text-gg-gray-300">
                {activeTab === 'private_treaty' ? 'Asking' : 'Sold'}
              </div>
              <div className="text-sm font-semibold text-white">
                {activeTab === 'private_treaty'
                  ? formatPrice(listing.asking_price)
                  : formatPrice(listing.sale_price)
                }
              </div>
            </div>
          )}
        </div>

        {/* Results: price per acre + date.

            OWNER BUG (2026-07-31): this whole block used to be
            `return ppa.avg ? (...) : null`, so a listing with no price —
            a NO SALE, or a sold auction whose price hasn't been entered
            yet — lost its AUCTION DATE along with the price. The date is
            essential on every results card regardless of outcome (owner:
            "even if it's a no_sale auction, the date needs to be on the
            card"), so the row now always renders whenever there IS a
            date, and only the $/ac part is conditional. */}
        {activeTab === 'results' && (() => {
          const ppa = getListingAvgPricePerAcre(listing)
          const date = formatDate(listing)
          if (!ppa.avg && !date) return null
          return (
            <div className="mt-3 pt-2 border-t border-white/15">
              <div className="flex items-center gap-1.5 text-xs">
                {ppa.avg ? (
                  <>
                    <DollarSign size={12} className="text-gg-gray-300" />
                    <span className="text-gg-pink font-bold text-sm">{formatPrice(ppa.avg)}/ac</span>
                    {date && <span className="text-gg-gray-300">· {date}</span>}
                  </>
                ) : (
                  <>
                    <Calendar size={12} className="text-gg-gray-300" />
                    <span className="text-gg-gray-300">{date}</span>
                  </>
                )}
              </div>
              {ppa.avg && ppa.isAverage && (
                <div className="text-[10px] text-gg-gray-300 mt-1 italic">Avg of {listing.tract_count || listing.tracts?.length} tracts</div>
              )}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

export default function PortalListPanel({ listings, loading, activeTab, onClose, onTractSelected, onListingLoaded, onFindComparables, activeFilters, onClearFilters, userAccountType, watchlistIds, onToggleWatchlist }: PortalListPanelProps) {
  const [selectedListingId, setSelectedListingId] = useState<string | null>(null)
  // Free-text search over the panel's listings (owner ask 2026-07-28 — parity
  // with the mobile Auctions/Results screens). Filters CLIENT-SIDE over the
  // already-fetched page; it deliberately does not refetch, so typing is
  // instant and costs no API calls. Shared matcher: @/lib/listingSearch.
  const [searchQuery, setSearchQuery] = useState('')
  const visibleListings = listings.filter(l => listingMatchesSearch(l, searchQuery))

  return (
    <motion.div
      initial={{ x: -500 }}
      animate={{ x: 0 }}
      exit={{ x: -500 }}
      transition={{ type: 'spring', damping: 28, stiffness: 300 }}
      className="fixed top-0 left-0 bottom-0 w-[480px] z-[510] bg-black border-r border-white/10 shadow-2xl flex flex-col"
    >
      {/* Header */}
      <div className="pt-8 px-5 pb-4 border-b border-white/5 shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {selectedListingId ? (() => {
              const selectedListing = listings.find(l => l.id === selectedListingId)
              const detailTitle = selectedListing?.listing_type === 'auction' ? 'Auction Detail' : 'Listing Detail'
              return detailTitle
            })() : TAB_TITLES[activeTab]}
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
        {/* Free-text search (owner ask 2026-07-28, mobile parity). Hidden in
            the listing-detail view, where there's no list to filter. */}
        {!selectedListingId && (
          <div className="relative mt-3">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-500 pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by county, state, or company..."
              aria-label="Search listings"
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-9 py-2 text-sm text-white placeholder:text-gg-gray-500 focus:outline-none focus:border-gg-pink/50 transition"
            />
            {/* Placeholder deliberately says only "county, state" (owner
                2026-07-28) — auctioneer/company IS still matched by
                listingMatchesSearch, we just don't advertise it in the hint.
                Clear button renders only when there's text, so it's never
                dead chrome. */}
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md flex items-center justify-center text-gg-gray-400 hover:text-white hover:bg-white/10 transition"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}
        {/* Active filters display with clear button */}
        {!selectedListingId && activeFilters && (activeFilters.stateFilter || activeFilters.countyFilters.length > 0) && (
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-gg-gray-400">
              Showing{activeFilters.stateFilter ? ` ${activeFilters.stateFilter}` : ''}{activeFilters.countyFilters.length > 0 ? ` · ${activeFilters.countyFilters.join(', ')}` : ''}
            </p>
            {onClearFilters && (
              <button
                onClick={onClearFilters}
                className="text-xs text-gg-pink hover:text-gg-pink/80 font-medium transition"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {selectedListingId ? (
          <PortalListingDetail
            listingId={selectedListingId}
            onBack={() => setSelectedListingId(null)}
            onTractSelected={(tract) => {
              onTractSelected?.(tract)
            }}
            onListingLoaded={onListingLoaded}
            onFindComparables={onFindComparables}
            userAccountType={userAccountType}
            isWatchlisted={watchlistIds?.has(selectedListingId!)}
            onToggleWatchlist={onToggleWatchlist}
          />
        ) : loading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="animate-spin text-gg-pink" size={28} />
          </div>
        ) : visibleListings.length === 0 ? (
          <div className="text-center text-gg-gray-500 py-12">
            {/* Distinguish "your search matched nothing" from "there's nothing
                here at all" — otherwise a stray query looks like missing data. */}
            {searchQuery.trim() && listings.length > 0 ? (
              <>
                <p className="text-sm">No listings match &ldquo;{searchQuery.trim()}&rdquo;</p>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-2 text-xs text-gg-pink hover:text-gg-pink/80 font-medium transition"
                >
                  Clear search
                </button>
              </>
            ) : (
              <p className="text-sm">No listings found</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {visibleListings.map(listing => (
              <ListingCard
                key={listing.id}
                listing={listing}
                activeTab={activeTab}
                onClick={() => setSelectedListingId(listing.id)}
                isWatchlisted={watchlistIds?.has(listing.id)}
                onToggleWatchlist={onToggleWatchlist}
                isAdmin={userAccountType === 'groundgoat_admin'}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}