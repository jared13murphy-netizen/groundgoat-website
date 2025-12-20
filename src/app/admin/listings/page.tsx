'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Pencil, Trash2, ChevronLeft, ChevronRight, MapPin, Calendar, Clock, Layers } from 'lucide-react'

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
  primary_image_url: string
  company?: {
    id: string
    name: string
  }
  company_name?: string
  tract_count?: number
  tracts?: any[]
}

export default function AdminListingsPage() {
  const router = useRouter()
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const itemsPerPage = 50

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
  }, [page])

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

      await fetchListings(token)
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchListings = async (token: string) => {
    setLoading(true)
    try {
      const offset = (page - 1) * itemsPerPage
      const response = await fetch(
        `${API_URL}/api/listings?limit=${itemsPerPage}&offset=${offset}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )

      if (response.ok) {
        const data = await response.json()
        setListings(data)
        // Estimate total pages (API should return total count ideally)
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
    if (!confirm('Are you sure you want to delete this listing?')) return

    const token = localStorage.getItem('auth_token')
    try {
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
      case 'listed': return 'bg-blue-500/20 text-blue-400'
      case 'live': return 'bg-green-500/20 text-green-400'
      case 'pending': return 'bg-yellow-500/20 text-yellow-400'
      case 'sold': return 'bg-purple-500/20 text-purple-400'
      case 'no_sale': return 'bg-red-500/20 text-red-400'
      default: return 'bg-gray-500/20 text-gray-400'
    }
  }

  const handlePageInput = (e: React.FormEvent) => {
    e.preventDefault()
    const newPage = parseInt(pageInput)
    if (newPage >= 1) {
      setPage(newPage)
    }
  }

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
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Listings</h1>
            <p className="text-gg-gray-400">Manage all property listings</p>
          </div>
          <Link
            href="/admin"
            className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700"
          >
            ← Back to Admin
          </Link>
        </div>

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
                {/* Status Badge */}
                <div className={`absolute top-3 left-3 px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(listing.status)}`}>
                  {listing.status?.replace('_', ' ')}
                </div>
                {/* Type Badge */}
                <div className="absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-medium bg-gg-gray-900/80 text-white">
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
                        <span>{formatDate(listing.auction_date)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-gg-gray-400 text-sm">
                        <Clock size={14} />
                        <span>{formatTime(listing.auction_time)}</span>
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
          </div>
        )}

        {/* Pagination */}
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
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
      </div>
    </div>
  )
}
