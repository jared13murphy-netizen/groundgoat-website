'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Search, MapPin, Calendar, Loader2, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Trash2 } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const ITEMS_PER_PAGE = 50

interface Listing {
  id: string
  county: string
  state: string
  auction_date: string
  total_acres: number
  status: string
  listing_type: string
  company?: {
    id: string
    name: string
  }
  created_at: string
}

export default function AdminListingsPage() {
  const router = useRouter()
  const [listings, setListings] = useState<Listing[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth(token)
  }, [router])

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

      fetchListings(token, 1)
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchListings = async (token: string, page: number) => {
    setLoading(true)
    try {
      const offset = (page - 1) * ITEMS_PER_PAGE
      const response = await fetch(`${API_URL}/api/listings?limit=${ITEMS_PER_PAGE}&offset=${offset}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setListings(Array.isArray(data) ? data : [])
        setHasMore(data.length === ITEMS_PER_PAGE)
      }
    } catch (err) {
      console.error('Failed to fetch listings:', err)
    } finally {
      setLoading(false)
    }
  }

  const handlePageChange = (newPage: number) => {
    const token = localStorage.getItem('auth_token')
    if (token && newPage >= 1) {
      setCurrentPage(newPage)
      fetchListings(token, newPage)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  const filteredListings = listings.filter(listing => {
    const companyName = listing.company?.name || ''
    const matchesSearch = 
      listing.county?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      listing.state?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      companyName.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesFilter = filterStatus === 'all' || listing.status === filterStatus
    
    return matchesSearch && matchesFilter
  })

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { label: string, class: string }> = {
      'upcoming': { label: 'Upcoming', class: 'bg-blue-500/20 text-blue-400' },
      'active': { label: 'Active', class: 'bg-green-500/20 text-green-400' },
      'completed': { label: 'Completed', class: 'bg-gray-500/20 text-gray-400' },
      'cancelled': { label: 'Cancelled', class: 'bg-red-500/20 text-red-400' },
    }
    const badge = badges[status] || { label: status, class: 'bg-gray-500/20 text-gray-400' }
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge.class}`}>{badge.label}</span>
  }

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const handleDelete = async (listingId: string) => {
    if (!confirm('Are you sure you want to delete this listing?')) return
    
    const token = localStorage.getItem('auth_token')
    try {
      const response = await fetch(`${API_URL}/api/listings/${listingId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      
      if (response.ok) {
        setListings(listings.filter(l => l.id !== listingId))
      } else {
        alert('Failed to delete listing')
      }
    } catch (err) {
      console.error('Delete error:', err)
      alert('Failed to delete listing')
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
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="font-display text-4xl font-bold text-white">Manage Listings</h1>
            <p className="text-gg-gray-400">
              Page {currentPage} • Showing {filteredListings.length} listings
              {hasMore && ' (more available)'}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-500" size={20} />
            <input
              type="text"
              placeholder="Search by county, state, or company..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="flex items-center gap-2 bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
            >
              <span>Status: {filterStatus === 'all' ? 'All' : filterStatus}</span>
              <ChevronDown size={16} />
            </button>
            {showFilterDropdown && (
              <div className="absolute right-0 top-full mt-1 bg-gg-gray-800 border border-gg-gray-700 rounded-lg shadow-xl z-10">
                {['all', 'upcoming', 'active', 'completed', 'cancelled'].map(status => (
                  <button
                    key={status}
                    onClick={() => { setFilterStatus(status); setShowFilterDropdown(false) }}
                    className="block w-full px-4 py-2 text-left text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white capitalize"
                  >
                    {status === 'all' ? 'All Statuses' : status}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Listings Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gg-gray-700">
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Location</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Date</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Acres</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Company</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Status</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredListings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-gg-gray-400">
                      No listings found
                    </td>
                  </tr>
                ) : (
                  filteredListings.map(listing => (
                    <tr key={listing.id} className="border-b border-gg-gray-800 hover:bg-gg-gray-800/50">
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <MapPin size={16} className="text-gg-pink" />
                          <div>
                            <p className="text-white font-medium">{listing.county} County</p>
                            <p className="text-gg-gray-400 text-sm">{listing.state}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2 text-gg-gray-300">
                          <Calendar size={14} />
                          {formatDate(listing.auction_date)}
                        </div>
                      </td>
                      <td className="py-4 px-4 text-white">
                        {listing.total_acres?.toLocaleString() || 'N/A'}
                      </td>
                      <td className="py-4 px-4 text-gg-gray-300 text-sm">
                        {listing.company?.name || 'Unknown'}
                      </td>
                      <td className="py-4 px-4">
                        {getStatusBadge(listing.status)}
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <Link 
                            href={`/listing/${listing.id}`}
                            className="text-gg-gray-400 hover:text-white p-1" 
                            title="View"
                          >
                            <ExternalLink size={16} />
                          </Link>
                          <button 
                            onClick={() => handleDelete(listing.id)}
                            className="text-gg-gray-400 hover:text-red-400 p-1" 
                            title="Delete"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-4 border-t border-gg-gray-700">
            <button
              onClick={() => handlePageChange(currentPage - 1)}
              disabled={currentPage === 1}
              className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gg-gray-700"
            >
              <ChevronLeft size={16} />
              Previous
            </button>
            
            <div className="flex items-center gap-2">
              <span className="text-gg-gray-400">Page</span>
              <input
                type="number"
                min="1"
                value={currentPage}
                onChange={(e) => {
                  const page = parseInt(e.target.value)
                  if (page >= 1) handlePageChange(page)
                }}
                className="w-16 bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1 text-white text-center"
              />
            </div>

            <button
              onClick={() => handlePageChange(currentPage + 1)}
              disabled={!hasMore}
              className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gg-gray-700"
            >
              Next
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
