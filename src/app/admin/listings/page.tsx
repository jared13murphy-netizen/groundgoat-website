'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Trash2, ChevronLeft, ChevronRight, MapPin, ArrowLeft, Filter, Pencil } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Tract {
  id: string
  tract_number: number
  acres: number
  tillable_acres: number
  pi: number
  land_type: string
  has_house: boolean
  has_building: boolean
  sale_price: number
  price_per_acre: number
}

interface Listing {
  id: string
  title: string
  county: string
  state: string
  total_acres: number
  tillable_acres: number
  listing_type: string
  status: string
  land_type: string
  auction_datetime: string
  primary_image_url: string
  source_url: string
  brochure_url: string
  bidding_url: string
  asking_price: number
  description: string
  company?: {
    id: string
    name: string
  }
  listing_company_id?: string
  tracts?: Tract[]
}

interface Company {
  id: string
  name: string
  logo_url?: string
}

const STATUS_OPTIONS = ['listed', 'live', 'pending', 'sold', 'no_sale']
const LISTING_TYPE_OPTIONS = ['auction', 'private_treaty']
const LAND_TYPE_OPTIONS = ['Farm', 'Recreational', 'Pasture', 'Commercial', 'Residential', 'Development']
const STATE_OPTIONS = ['IL', 'IA', 'MO', 'IN', 'OH', 'KS', 'NE', 'MN', 'WI', 'MI', 'OK', 'TX', 'AR', 'KY', 'TN']

function AdminListingsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [listings, setListings] = useState<Listing[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  
  // Pagination
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const itemsPerPage = 50
  
  // Filters
  const [filterCompany, setFilterCompany] = useState(searchParams.get('company') || '')
  const [filterCounty, setFilterCounty] = useState('')
  const [filterListingType, setFilterListingType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    fetchListings()
  }, [page, filterCompany, filterCounty, filterListingType, filterStatus])

  const checkAuth = async () => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)
      if (!response.ok) throw new Error('Not authenticated')
      const userData = await response.json()
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }
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
      let url = `${API_URL}/api/listings?limit=${itemsPerPage}&offset=${offset}&sort_order=desc`
      
      if (filterCounty) url += `&county=${encodeURIComponent(filterCounty)}`
      if (filterListingType) url += `&listing_type=${filterListingType}`
      if (filterCompany) url += `&company_id=${filterCompany}`
      if (filterStatus) url += `&status=${filterStatus}`
      
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data = await response.json()
        setListings(data)
      }
    } catch (err) {
      console.error('Failed to fetch listings:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchTracts = async (listingId: string) => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/listings/${listingId}/tracts`)
      if (response.ok) {
        const tracts = await response.json()
        setEditedTracts(prev => ({ ...prev, [listingId]: tracts }))
      }
    } catch (err) {
      console.error('Failed to fetch tracts:', err)
    }
  }

  const toggleExpand = async (listing: Listing) => {
    if (expandedId === listing.id) {
      setExpandedId(null)
    } else {
      setExpandedId(listing.id)
      setEditedListings(prev => ({ ...prev, [listing.id]: { ...listing } }))
      await fetchTracts(listing.id)
    }
  }

  const updateListingField = (listingId: string, field: string, value: any) => {
    setEditedListings(prev => ({
      ...prev,
      [listingId]: { ...prev[listingId], [field]: value }
    }))
  }

  const updateTractField = (listingId: string, tractIndex: number, field: string, value: any) => {
    setEditedTracts(prev => {
      const tracts = [...(prev[listingId] || [])]
      tracts[tractIndex] = { ...tracts[tractIndex], [field]: value }
      return { ...prev, [listingId]: tracts }
    })
  }

  const addTract = (listingId: string) => {
    const tracts = editedTracts[listingId] || []
    const newTractNumber = tracts.length > 0 ? Math.max(...tracts.map(t => t.tract_number)) + 1 : 1
    const newTract: Tract = {
      id: `new-${Date.now()}`,
      tract_number: newTractNumber,
      acres: 0,
      tillable_acres: 0,
      pi: 0,
      land_type: 'Farm',
      has_house: false,
      has_building: false,
      sale_price: 0,
      price_per_acre: 0
    }
    setEditedTracts(prev => ({
      ...prev,
      [listingId]: [...(prev[listingId] || []), newTract]
    }))
  }

  const deleteTract = async (listingId: string, tractId: string, tractIndex: number) => {
    if (!confirm('Delete this tract?')) return
    
    // If it's a new tract (not saved yet), just remove from state
    if (tractId.startsWith('new-')) {
      setEditedTracts(prev => ({
        ...prev,
        [listingId]: prev[listingId].filter((_, i) => i !== tractIndex)
      }))
      return
    }
    
    try {
      const response = await fetchWithAuth(`${API_URL}/api/listings/${listingId}/tracts/${tractId}`, {
        method: 'DELETE'
      })
      if (response.ok) {
        setEditedTracts(prev => ({
          ...prev,
          [listingId]: prev[listingId].filter((_, i) => i !== tractIndex)
        }))
      }
    } catch (err) {
      console.error('Failed to delete tract:', err)
    }
  }

  const saveListing = async (listingId: string) => {
    setSaving(listingId)
    try {
      const listing = editedListings[listingId]
      const tracts = editedTracts[listingId] || []
      
      // Save listing
      const listingResponse = await fetchWithAuth(`${API_URL}/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: listing.title,
          county: listing.county,
          state: listing.state,
          total_acres: listing.total_acres ? parseFloat(String(listing.total_acres)) : null,
          tillable_acres: listing.tillable_acres ? parseFloat(String(listing.tillable_acres)) : null,
          listing_type: listing.listing_type,
          status: listing.status,
          land_type: listing.land_type,
          asking_price: listing.asking_price ? parseFloat(String(listing.asking_price)) : null,
          primary_image_url: listing.primary_image_url || null,
          source_url: listing.source_url || null,
          brochure_url: listing.brochure_url || null,
          bidding_url: listing.bidding_url || null,
          listing_company_id: listing.listing_company_id || null,
          description: listing.description || null
        })
      })
      
      if (!listingResponse.ok) {
        throw new Error('Failed to save listing')
      }
      
      // Save tracts
      for (const tract of tracts) {
        const tractData = {
          tract_number: tract.tract_number,
          acres: tract.acres ? parseFloat(String(tract.acres)) : null,
          tillable_acres: tract.tillable_acres ? parseFloat(String(tract.tillable_acres)) : null,
          pi: tract.pi ? parseFloat(String(tract.pi)) : null,
          land_type: tract.land_type,
          has_house: tract.has_house,
          has_building: tract.has_building,
          sale_price: tract.sale_price ? parseFloat(String(tract.sale_price)) : null
        }
        
        if (tract.id.startsWith('new-')) {
          // Create new tract
          await fetchWithAuth(`${API_URL}/api/listings/${listingId}/tracts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tractData)
          })
        } else {
          // Update existing tract
          await fetchWithAuth(`${API_URL}/api/listings/${listingId}/tracts/${tract.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tractData)
          })
        }
      }
      
      // Refresh listings
      await fetchListings()
      await fetchTracts(listingId)
      
    } catch (err) {
      console.error('Failed to save:', err)
      alert('Failed to save changes')
    } finally {
      setSaving(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this listing and all its tracts?')) return
    
    try {
      const response = await fetchWithAuth(`${API_URL}/api/listings/${id}`, {
        method: 'DELETE'
      })
      if (response.ok) {
        setListings(prev => prev.filter(l => l.id !== id))
        if (expandedId === id) setExpandedId(null)
      }
    } catch (err) {
      console.error('Failed to delete listing:', err)
    }
  }

  const handleQuickStatusChange = async (listingId: string, newStatus: string) => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
      if (response.ok) {
        setListings(prev => prev.map(l => 
          l.id === listingId ? { ...l, status: newStatus } : l
        ))
      }
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

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

  const formatCurrency = (value: number) => {
    if (!value) return '—'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
  }

  const getCompanyName = (listing: Listing) => {
    if (listing.company?.name) return listing.company.name
    const company = companies.find(c => c.id === listing.listing_company_id)
    return company?.name || '—'
  }

  const clearFilters = () => {
    setFilterCompany('')
    setFilterCounty('')
    setFilterListingType('')
    setFilterStatus('')
    setPage(1)
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Listings</h1>
              <p className="text-gg-gray-400">{listings.length} listings</p>
            </div>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              showFilters || filterCompany || filterCounty || filterListingType || filterStatus
                ? 'bg-gg-pink text-white' : 'bg-gg-gray-800 text-white hover:bg-gg-gray-700'
            }`}
          >
            <Filter size={16} />
            Filters
          </button>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="card mb-6 p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[150px]">
                <label className="block text-gg-gray-400 text-sm mb-1">Company</label>
                <select
                  value={filterCompany}
                  onChange={(e) => { setFilterCompany(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="block text-gg-gray-400 text-sm mb-1">Type</label>
                <select
                  value={filterListingType}
                  onChange={(e) => { setFilterListingType(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All</option>
                  <option value="auction">Auction</option>
                  <option value="private_treaty">Private Treaty</option>
                </select>
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="block text-gg-gray-400 text-sm mb-1">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All</option>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="block text-gg-gray-400 text-sm mb-1">County</label>
                <input
                  type="text"
                  value={filterCounty}
                  onChange={(e) => { setFilterCounty(e.target.value); setPage(1) }}
                  placeholder="Enter county..."
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
              {(filterCompany || filterCounty || filterListingType || filterStatus) && (
                <button onClick={clearFilters} className="px-4 py-2 bg-gg-gray-700 text-white rounded-lg text-sm">
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Listings */}
        <div className="space-y-2">
          {listings.map((listing) => {
            
            return (
              <div key={listing.id} className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg overflow-hidden">
                {/* Row Header */}
                <div className="flex items-center gap-4 p-3 hover:bg-gg-gray-800/50">
                  {/* Image */}
                  <div className="w-16 h-16 flex-shrink-0 bg-gg-gray-800 rounded-lg overflow-hidden">
                    {listing.primary_image_url ? (
                      <img src={listing.primary_image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <MapPin className="text-gg-gray-600" size={24} />
                      </div>
                    )}
                  </div>

                  {/* Title/Location */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-semibold truncate">
                      {listing.county} County, {listing.state}
                    </h3>
                    <p className="text-gg-gray-400 text-sm truncate">{getCompanyName(listing)}</p>
                  </div>

                  {/* Details */}
                  <div className="hidden md:flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="text-white font-medium">{listing.total_acres || '—'}</div>
                      <div className="text-gg-gray-500 text-xs">acres</div>
                    </div>
                    <div className="text-center">
                      <div className="text-white font-medium">{formatCurrency(listing.asking_price)}</div>
                      <div className="text-gg-gray-500 text-xs">price</div>
                    </div>
                    <div className="text-center">
                      <div className="text-white font-medium capitalize">{listing.listing_type?.replace('_', ' ')}</div>
                      <div className="text-gg-gray-500 text-xs">type</div>
                    </div>
                  </div>

                  {/* Status Dropdown */}
                  <select
                    value={listing.status}
                    onChange={(e) => {
                      e.stopPropagation()
                      handleQuickStatusChange(listing.id, e.target.value)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className={`px-3 py-1 rounded-full text-xs font-semibold text-white ${getStatusColor(listing.status)} border-0 cursor-pointer`}
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s} value={s} className="bg-gg-gray-900 text-white">{s.replace('_', ' ')}</option>
                    ))}
                  </select>

                  {/* Edit Icon */}
                  <Link
                    href={`/admin/listings/${listing.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="p-2 text-gg-gray-400 hover:text-white hover:bg-gg-gray-800 rounded-lg"
                  >
                    <Pencil size={16} />
                  </Link>

                  {/* Delete */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(listing.id) }}
                    className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>

}
              </div>
            )
          })}
        </div>

        {/* Empty State */}
        {listings.length === 0 && !loading && (
          <div className="text-center py-12">
            <MapPin className="mx-auto text-gg-gray-600 mb-4" size={48} />
            <p className="text-gg-gray-400">No listings found</p>
          </div>
        )}

        {/* Pagination */}
        {listings.length > 0 && (
          <div className="flex items-center justify-center gap-4 mt-6">
            <button
              onClick={() => { setPage(p => Math.max(1, p - 1)); setPageInput(String(Math.max(1, page - 1))) }}
              disabled={page === 1}
              className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg disabled:opacity-50"
            >
              <ChevronLeft size={16} /> Previous
            </button>
            <span className="text-gg-gray-400">Page {page}</span>
            <button
              onClick={() => { setPage(p => p + 1); setPageInput(String(page + 1)) }}
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

export default function AdminListingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    }>
      <AdminListingsPageContent />
    </Suspense>
  )
}
