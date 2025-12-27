'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Pencil, Trash2, ChevronLeft, ChevronRight, MapPin, Calendar, Clock, Layers, ArrowLeft, Filter } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Listing {
  id: string
  title: string
  county: string
  state: string
  total_acres: number
  listing_type: string
  status: string
  auction_date: string
  auction_time: string
  auction_datetime: string
  primary_image_url: string
  company?: {
    id: string
    name: string
  }
  company_name?: string
  listing_company_id?: string
  tract_count?: number
  tracts?: any[]
  created_at: string
}

interface Company {
  id: string
  name: string
}

export default function AdminListingsPage() {
  const router = useRouter()
  const [listings, setListings] = useState<Listing[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const [filterCompany, setFilterCompany] = useState('')
  const [filterCounty, setFilterCounty] = useState('')
  const [filterListingType, setFilterListingType] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const itemsPerPage = 100

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth(token)
  }, [router])

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      fetchListings(token)
    }
  }, [page, filterCompany, filterCounty, filterListingType])

  const checkAuth = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()
      
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }

      await Promise.all([
        fetchListings(token),
        fetchCompanies(token)
      ])
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchCompanies = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/companies`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setCompanies(data)
      }
    } catch (err) {
      console.error('Failed to fetch companies:', err)
    }
  }

  const fetchListings = async (token: string) => {
    setLoading(true)
    try {
      const offset = (page - 1) * itemsPerPage
      let url = `${API_URL}/api/listings?limit=${itemsPerPage}&offset=${offset}&sort_order=desc`
      
      if (filterCounty) {
        url += `&county=${encodeURIComponent(filterCounty)}`
      }
      
      if (filterListingType) {
        url += `&listing_type=${filterListingType}`
      }
      
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.ok) {
        let data = await response.json()
        
        // Filter by company client-side if selected
        if (filterCompany) {
          data = data.filter((l: Listing) => 
            l.listing_company_id === filterCompany || 
            l.company?.id === filterCompany
          )
        }
        
        // Sort by auction_date DESC, then auction_time DESC
        // Sort by auction_datetime DESC
        data.sort((a: Listing, b: Listing) => {
          const dateA = a.auction_datetime ? new Date(a.auction_datetime).getTime() : (a.auction_date ? new Date(a.auction_date).getTime() : 0)
          const dateB = b.auction_datetime ? new Date(b.auction_datetime).getTime() : (b.auction_date ? new Date(b.auction_date).getTime() : 0)
          return dateB - dateA
        })
        
        setListings(data)
        if (data.length === itemsPerPage) {
          setTotalPages(Math.max(totalPages, page + 1))
        } else if (data.length < itemsPerPage && data.length > 0) {
          setTotalPages(page)
        }
      }
    } catch (err) {
      console.error('Failed to fetch listings:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this listing and all its tracts?')) return

    const token = localStorage.getItem('auth_token')
    try {
      // First, fetch the listing's tracts
      const tractsResponse = await fetch(`${API_URL}/api/listings/${id}/tracts`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      
      if (tractsResponse.ok) {
        const tracts = await tractsResponse.json()
        // Delete each tract
        for (const tract of tracts) {
          await fetch(`${API_URL}/api/listings/${id}/tracts/${tract.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` },
          })
        }
      }

      // Then delete the listing
      const response = await fetch(`${API_URL}/api/listings/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        setListings(prev => prev.filter(l => l.id !== id))
      }
    } catch (err) {
      console.error('Failed to delete listing:', err)
    }
  }

  const formatDate = (dateString: string) => {
    if (!dateString) return '—'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatTime = (timeString: string) => {
    if (!timeString) return '—'
    const date = new Date(timeString)
    if (isNaN(date.getTime())) return timeString
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }

  const getCompanyName = (listing: Listing) => {
    if (listing.company?.name) return listing.company.name
    if (listing.company_name) return listing.company_name
    return '—'
  }

  const getTractCount = (listing: Listing) => {
    if (listing.tract_count !== undefined) return listing.tract_count
    if (listing.tracts?.length) return listing.tracts.length
    return 0
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'listed': return 'bg-blue-500 text-white'
      case 'live': return 'bg-green-500 text-white'
      case 'pending': return 'bg-yellow-500 text-black'
      case 'sold': return 'bg-purple-500 text-white'
      case 'no_sale': return 'bg-red-500 text-white'
      default: return 'bg-gray-500 text-white'
    }
  }

  const handlePageInput = (e: React.FormEvent) => {
    e.preventDefault()
    const newPage = parseInt(pageInput)
    if (newPage >= 1) {
      setPage(newPage)
    }
  }

  const clearFilters = () => {
    setFilterCompany('')
    setFilterCounty('')
    setFilterListingType('')
    setPage(1)
    setPageInput('1')
  }

  // Get unique counties from listings for filter dropdown
  const uniqueCounties = Array.from(new Set(listings.map(l => l.county).filter(Boolean))).sort()

  if (loading && listings.length === 0) {
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
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Listings</h1>
              <p className="text-gg-gray-400">Manage all property listings</p>
            </div>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              showFilters || filterCompany || filterCounty || filterListingType
                ? 'bg-gg-pink text-white'
                : 'bg-gg-gray-800 text-white hover:bg-gg-gray-700'
            }`}
          >
            <Filter size={16} />
            Filters
            {(filterCompany || filterCounty || filterListingType) && (
              <span className="ml-1 px-2 py-0.5 bg-white/20 rounded-full text-xs">
                {[filterCompany, filterCounty, filterListingType].filter(Boolean).length}
              </span>
            )}
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="card mb-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-gg-gray-400 text-sm mb-1">Company</label>
                <select
                  value={filterCompany}
                  onChange={(e) => {
                    setFilterCompany(e.target.value)
                    setPage(1)
                    setPageInput('1')
                  }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                >
                  <option value="">All Companies</option>
                  {companies.map(company => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-gg-gray-400 text-sm mb-1">Listing Type</label>
                <select
                  value={filterListingType}
                  onChange={(e) => {
                    setFilterListingType(e.target.value)
                    setPage(1)
                    setPageInput('1')
                  }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                >
                  <option value="">All Types</option>
                  <option value="auction">Auction</option>
                  <option value="private_treaty">Private Treaty</option>
                </select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="block text-gg-gray-400 text-sm mb-1">County</label>
                <input
                  type="text"
                  value={filterCounty}
                  onChange={(e) => {
                    setFilterCounty(e.target.value)
                    setPage(1)
                    setPageInput('1')
                  }}
                  placeholder="Enter county name..."
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                />
              </div>
              {(filterCompany || filterCounty || filterListingType) && (
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>
        )}

        {/* Listings Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {listings.map((listing) => (
            <div key={listing.id} className="card overflow-hidden group">
              {/* Image */}
              <div className="relative h-40 bg-gg-gray-800">
                {listing.primary_image_url ? (
                  <img
                    src={listing.primary_image_url}
                    alt={listing.title || 'Listing'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <MapPin className="text-gg-gray-600" size={40} />
                  </div>
                )}
                {/* Status Badge - Solid background */}
                <div className={`absolute top-3 left-3 px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(listing.status)}`}>
                  {listing.status?.replace('_', ' ')}
                </div>
                {/* Type Badge */}
                <div className="absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-medium bg-black/70 text-white">
                  {listing.listing_type === 'auction' ? 'Auction' : 'Private Treaty'}
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                {/* Location */}
                <h3 className="text-white font-semibold text-lg mb-1">
                  {listing.county} County, {listing.state}
                </h3>
                
                {/* Company */}
                <p className="text-gg-pink text-sm mb-3">{getCompanyName(listing)}</p>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="flex items-center gap-2 text-gg-gray-400 text-sm">
                    <MapPin size={14} />
                    <span>{listing.total_acres?.toLocaleString() || '—'} acres</span>
                  </div>
                  <div className="flex items-center gap-2 text-gg-gray-400 text-sm">
                    <Layers size={14} />
                    <span>{getTractCount(listing)} tracts</span>
                  </div>
                  {listing.listing_type === 'auction' && (
                    <>
                      <div className="flex items-center gap-2 text-gg-gray-400 text-sm">
                        <Calendar size={14} />
                        <span>{formatDate(listing.auction_datetime || listing.auction_date)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gg-gray-400 text-sm">
                        <Clock size={14} />
                        <span>{formatTime(listing.auction_datetime || listing.auction_time)}</span>
                      </div>
                    </>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-3 border-t border-gg-gray-800">
                  <Link
                    href={`/admin/listings/${listing.id}`}
                    className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 transition-colors"
                  >
                    <Pencil size={14} />
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(listing.id)}
                    className="flex items-center justify-center gap-2 px-3 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {listings.length === 0 && !loading && (
          <div className="text-center py-12">
            <MapPin className="mx-auto text-gg-gray-600 mb-4" size={48} />
            <p className="text-gg-gray-400">No listings found</p>
            {(filterCompany || filterCounty) && (
              <button
                onClick={clearFilters}
                className="mt-4 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Pagination */}
        {listings.length > 0 && (
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => {
                setPage(p => Math.max(1, p - 1))
                setPageInput((Math.max(1, page - 1)).toString())
              }}
              disabled={page === 1}
              className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            
            <form onSubmit={handlePageInput} className="flex items-center gap-2">
              <span className="text-gg-gray-400">Page</span>
              <input
                type="number"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                className="w-16 bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-center"
                min="1"
              />
              <button type="submit" className="px-3 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80">
                Go
              </button>
            </form>

            <button
              onClick={() => {
                setPage(p => p + 1)
                setPageInput((page + 1).toString())
              }}
              disabled={listings.length < itemsPerPage}
              className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
