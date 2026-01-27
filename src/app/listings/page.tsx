'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { Loader2, MapPin, Calendar, DollarSign, Building2, Filter, X, ChevronLeft, ChevronRight } from 'lucide-react'
import { getCountiesForState, US_STATES } from '@/data/counties'
import { getDistanceToCounty } from '@/data/countyCoordinates'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Company {
  id: string
  name: string
}

interface Listing {
  id: string
  title?: string
  county: string
  state: string
  total_acres: number
  listing_type: string
  status: string
  auction_datetime?: string
  auction_date?: string
  created_at?: string
  primary_image_url?: string
  asking_price?: number
  sale_price?: number
  price_per_acre?: number
  company?: Company
  company_name?: string
  tract_count?: number
  _distance?: number // Calculated distance for sorting
}

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  account_type: string
  home_county?: string
  home_state?: string
}

type TabType = 'auctions' | 'private_treaty' | 'results'

const ALLOWED_ROLES = ['groundgoat_admin', 'groundgoat_sales', 'firm_admin', 'firm_user']

function ListingsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [user, setUser] = useState<User | null>(null)
  const [listings, setListings] = useState<Listing[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('auctions')

  // Filters
  const [filterState, setFilterState] = useState('')
  const [filterCounty, setFilterCounty] = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Pagination
  const [page, setPage] = useState(1)
  const itemsPerPage = 50

  // Get counties for selected state
  const availableCounties = filterState ? getCountiesForState(filterState) : []

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    if (user) {
      fetchListings()
    }
  }, [user, activeTab, page, filterState, filterCounty, filterCompany])

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
      await fetchCompanies()
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchCompanies = async () => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/companies`)
      if (response.ok) {
        const data = await response.json()
        setCompanies(data.sort((a: Company, b: Company) => a.name.localeCompare(b.name)))
      }
    } catch (err) {
      console.error('Failed to fetch companies:', err)
    }
  }

  const fetchListings = async () => {
    setLoading(true)
    try {
      const offset = (page - 1) * itemsPerPage
      let url = `${API_URL}/api/listings?limit=${itemsPerPage}&offset=${offset}`

      // Add filters based on tab
      if (activeTab === 'auctions') {
        url += '&listing_type=auction&status=listed,live'
      } else if (activeTab === 'private_treaty') {
        url += '&listing_type=private_treaty&status=listed,live'
      } else if (activeTab === 'results') {
        url += '&status=sold,pending,no_sale'
      }

      if (filterState) url += `&state=${encodeURIComponent(filterState)}`
      if (filterCounty) url += `&county=${encodeURIComponent(filterCounty)}`
      if (filterCompany) url += `&company_id=${filterCompany}`

      const response = await fetchWithAuth(url)
      if (response.ok) {
        let data = await response.json()

        // Sort based on tab
        if (activeTab === 'auctions') {
          // Filter out auctions that are more than 12 hours in the past
          const twelveHoursAgo = Date.now() - (12 * 60 * 60 * 1000)
          data = data.filter((listing: Listing) => {
            const auctionDate = listing.auction_datetime || listing.auction_date
            if (!auctionDate) return true // Keep listings without dates
            return new Date(auctionDate).getTime() >= twelveHoursAgo
          })

          // Sort by auction datetime (soonest first)
          data = data.sort((a: Listing, b: Listing) => {
            const dateA = a.auction_datetime || a.auction_date || ''
            const dateB = b.auction_datetime || b.auction_date || ''
            return new Date(dateA).getTime() - new Date(dateB).getTime()
          })
        } else if (activeTab === 'private_treaty') {
          // Sort by distance from user's hometown if set, otherwise by date (newest first)
          if (user?.home_state && user?.home_county) {
            // Calculate distance for each listing
            const listingsWithDistance = data.map((listing: Listing, index: number) => {
              const distance = getDistanceToCounty(
                user.home_state!,
                user.home_county!,
                listing.state,
                listing.county
              )
              return {
                ...listing,
                _distance: distance ?? 999999, // Put listings without coordinates at end
                _originalIndex: index,
              }
            })

            // Sort by distance (closest first)
            listingsWithDistance.sort((a: Listing & { _originalIndex: number }, b: Listing & { _originalIndex: number }) => {
              const diff = (a._distance ?? 999999) - (b._distance ?? 999999)
              if (diff !== 0) return diff
              return a._originalIndex - b._originalIndex // Stable sort fallback
            })

            data = listingsWithDistance
          } else {
            // No home location set - sort by date added (newest first)
            data = data.sort((a: Listing, b: Listing) => {
              const dateA = a.created_at || a.auction_datetime || a.auction_date || ''
              const dateB = b.created_at || b.auction_datetime || b.auction_date || ''
              return new Date(dateB).getTime() - new Date(dateA).getTime()
            })
          }
        } else if (activeTab === 'results') {
          // Sort by most recent sale first
          data = data.sort((a: Listing, b: Listing) => {
            const dateA = a.auction_datetime || a.auction_date || ''
            const dateB = b.auction_datetime || b.auction_date || ''
            return new Date(dateB).getTime() - new Date(dateA).getTime()
          })
        }

        setListings(data)
      }
    } catch (err) {
      console.error('Failed to fetch listings:', err)
    } finally {
      setLoading(false)
    }
  }

  const clearFilters = () => {
    setFilterState('')
    setFilterCounty('')
    setFilterCompany('')
    setPage(1)
  }

  const hasActiveFilters = filterState || filterCounty || filterCompany

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'listed': return 'bg-blue-500'
      case 'live': return 'bg-green-500'
      case 'pending': return 'bg-yellow-500'
      case 'sold': return 'bg-purple-500'
      case 'no_sale': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'listed': return 'Upcoming'
      case 'live': return 'Live Now'
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
    if (!acres) return '—'
    return acres.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '—'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatTime = (dateString: string | undefined) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }

  const getCompanyName = (listing: Listing) => {
    if (listing.company?.name) return listing.company.name
    if (listing.company_name) return listing.company_name
    return '—'
  }

  const getPricePerAcre = (listing: Listing) => {
    if (listing.price_per_acre) return listing.price_per_acre
    const price = listing.sale_price || listing.asking_price
    if (price && listing.total_acres) {
      return price / listing.total_acres
    }
    return null
  }

  if (loading && !user) {
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
        <div className="mb-6">
          <h1 className="font-display text-3xl font-bold text-white mb-2">Listings</h1>
          <p className="text-gg-gray-400">Browse upcoming auctions, private treaties, and recent sales</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => { setActiveTab('auctions'); setPage(1) }}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'auctions'
                ? 'bg-gg-pink text-white'
                : 'bg-gg-gray-800 text-gg-gray-300 hover:bg-gg-gray-700'
            }`}
          >
            Auctions
          </button>
          <button
            onClick={() => { setActiveTab('private_treaty'); setPage(1) }}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'private_treaty'
                ? 'bg-gg-pink text-white'
                : 'bg-gg-gray-800 text-gg-gray-300 hover:bg-gg-gray-700'
            }`}
          >
            Private Treaty
          </button>
          <button
            onClick={() => { setActiveTab('results'); setPage(1) }}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              activeTab === 'results'
                ? 'bg-gg-pink text-white'
                : 'bg-gg-gray-800 text-gg-gray-300 hover:bg-gg-gray-700'
            }`}
          >
            Results
          </button>

          {/* Filter Toggle */}
          <div className="ml-auto">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-3 rounded-lg transition-colors ${
                showFilters || hasActiveFilters
                  ? 'bg-gg-pink text-white'
                  : 'bg-gg-gray-800 text-white hover:bg-gg-gray-700'
              }`}
            >
              <Filter size={18} />
              Filters
              {hasActiveFilters && (
                <span className="bg-white text-gg-pink text-xs font-bold px-2 py-0.5 rounded-full">
                  {[filterState, filterCounty, filterCompany].filter(Boolean).length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-4 mb-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">State</label>
                <select
                  value={filterState}
                  onChange={(e) => {
                    setFilterState(e.target.value)
                    setFilterCounty('')
                    setPage(1)
                  }}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All States</option>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">County</label>
                <select
                  value={filterCounty}
                  onChange={(e) => { setFilterCounty(e.target.value); setPage(1) }}
                  disabled={!filterState}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
                >
                  <option value="">{filterState ? 'All Counties' : 'Select State First'}</option>
                  {availableCounties.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Company</label>
                <select
                  value={filterCompany}
                  onChange={(e) => { setFilterCompany(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All Companies</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              {hasActiveFilters && (
                <div className="flex items-end">
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-2 px-4 py-2 bg-gg-gray-700 text-white rounded-lg text-sm hover:bg-gg-gray-600"
                  >
                    <X size={16} />
                    Clear Filters
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Listings */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-gg-pink" size={32} />
          </div>
        ) : listings.length === 0 ? (
          <div className="text-center py-12">
            <MapPin className="mx-auto text-gg-gray-600 mb-4" size={48} />
            <p className="text-gg-gray-400">No listings found</p>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="mt-4 text-gg-pink hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {listings.map((listing) => (
              <Link
                key={listing.id}
                href={`/listings/${listing.id}`}
                className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg overflow-hidden hover:border-gg-gray-700 transition-colors group"
              >
                {/* Image */}
                <div className="relative h-48 bg-gg-gray-800">
                  {listing.primary_image_url ? (
                    <img
                      src={listing.primary_image_url}
                      alt=""
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <MapPin className="text-gg-gray-600" size={48} />
                    </div>
                  )}
                  {/* Status Badge - only show for Results tab or live auctions */}
                  {(activeTab === 'results' || listing.status === 'live') && (
                    <div className={`absolute top-3 left-3 px-3 py-1 rounded-full text-xs font-semibold text-white ${getStatusColor(listing.status)}`}>
                      {getStatusLabel(listing.status)}
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="text-white font-semibold text-lg mb-1">
                    {listing.county} County, {listing.state}
                  </h3>
                  <p className="text-gg-gray-400 text-sm mb-3 flex items-center gap-1">
                    <Building2 size={14} />
                    {getCompanyName(listing)}
                  </p>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-2 text-center mb-3">
                    <div>
                      <div className="text-white font-medium">{formatAcres(listing.total_acres)}</div>
                      <div className="text-gg-gray-500 text-xs">Acres</div>
                    </div>
                    <div>
                      <div className="text-white font-medium">{listing.tract_count || '—'}</div>
                      <div className="text-gg-gray-500 text-xs">Tracts</div>
                    </div>
                    <div>
                      <div className="text-white font-medium">
                        {getPricePerAcre(listing) ? formatCurrency(getPricePerAcre(listing)!) : '—'}
                      </div>
                      <div className="text-gg-gray-500 text-xs">$/Acre</div>
                    </div>
                  </div>

                  {/* Bottom info based on type */}
                  <div className="pt-3 border-t border-gg-gray-800">
                    {activeTab === 'auctions' && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar size={14} className="text-gg-pink" />
                        <span className="text-gg-gray-300">
                          {formatDate(listing.auction_datetime || listing.auction_date)}
                          {listing.auction_datetime && ` at ${formatTime(listing.auction_datetime)}`}
                        </span>
                      </div>
                    )}
                    {activeTab === 'private_treaty' && (
                      <div className="flex items-center gap-2 text-sm">
                        <DollarSign size={14} className="text-gg-pink" />
                        <span className="text-gg-gray-300">
                          Asking: {formatCurrency(listing.asking_price)}
                        </span>
                      </div>
                    )}
                    {activeTab === 'results' && (
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <DollarSign size={14} className="text-gg-pink" />
                          <span className="text-gg-gray-300">
                            {listing.status === 'sold' ? formatCurrency(listing.sale_price) : '—'}
                          </span>
                        </div>
                        <span className="text-gg-gray-500 text-xs">
                          {formatDate(listing.auction_datetime || listing.auction_date)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Pagination */}
        {listings.length > 0 && (
          <div className="flex items-center justify-center gap-4 mt-8">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg disabled:opacity-50"
            >
              <ChevronLeft size={16} /> Previous
            </button>
            <span className="text-gg-gray-400">Page {page}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={listings.length < itemsPerPage}
              className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg disabled:opacity-50"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ListingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    }>
      <ListingsPageContent />
    </Suspense>
  )
}
