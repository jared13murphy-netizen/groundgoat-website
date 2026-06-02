'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import fetchWithAuth from '@/lib/fetchWithAuth'
import openListingReport from '@/lib/openListingReport'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Trash2, ChevronLeft, ChevronRight, MapPin, ArrowLeft, Filter, Pencil, CheckCircle, ExternalLink, Plus, X, FileText } from 'lucide-react'
import { getCountiesForState } from '@/data/counties'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const US_STATES: Record<string, string> = {
  "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
  "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
  "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
  "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
  "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
  "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
  "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
  "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
  "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
  "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"
}

interface Listing {
  id: string
  title: string
  county: string
  state: string
  total_acres: number
  listing_type: string
  status: string
  auction_datetime: string
  primary_image_url: string
  asking_price: number
  verified: boolean
  data_confidence?: number
  source_url?: string
  tract_count?: number
  company?: {
    id: string
    name: string
  }
  listing_company_id?: string
}

interface Company {
  id: string
  name: string
}

const STATUS_OPTIONS = ['listed', 'live', 'pending', 'sold', 'no_sale']
const LISTING_TYPES = ['auction', 'private_treaty']

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
  const [filterState, setFilterState] = useState('')
  const [filterCounty, setFilterCounty] = useState('')
  const [filterListingType, setFilterListingType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterVerified, setFilterVerified] = useState('')
  const [filterConfidence, setFilterConfidence] = useState('')
  const [filterAuctionDate, setFilterAuctionDate] = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Add listing modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newListing, setNewListing] = useState({
    listing_type: 'auction',
    listing_company_id: '',
    county: '',
    state: '',
    total_acres: '',
    status: 'listed',
    source_url: '',
    auction_datetime: '',
    asking_price: ''
  })

  // Get counties for selected state
  const availableCounties = filterState ? getCountiesForState(filterState) : []
  const newListingCounties = newListing.state ? getCountiesForState(newListing.state) : []

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    fetchListings()
  }, [page, filterCompany, filterState, filterCounty, filterListingType, filterStatus, filterVerified, filterConfidence, filterAuctionDate])

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

      if (filterState) url += `&state=${encodeURIComponent(filterState)}`
      if (filterCounty) url += `&county=${encodeURIComponent(filterCounty)}`
      if (filterListingType) url += `&listing_type=${filterListingType}`
      if (filterCompany) url += `&company_id=${filterCompany}`
      if (filterStatus) url += `&status=${filterStatus}`
      if (filterAuctionDate) url += `&auction_date=${filterAuctionDate}`

      const response = await fetchWithAuth(url)
      if (response.ok) {
        let data = await response.json()

        // Client-side filter for verified status (since API doesn't support it yet)
        if (filterVerified === 'verified') {
          data = data.filter((l: Listing) => l.verified === true)
        } else if (filterVerified === 'unverified') {
          data = data.filter((l: Listing) => l.verified === false)
        }

        // Client-side filter for confidence level
        if (filterConfidence === 'excellent') {
          data = data.filter((l: Listing) => (l.data_confidence || 0) >= 80)
        } else if (filterConfidence === 'good') {
          data = data.filter((l: Listing) => (l.data_confidence || 0) >= 60 && (l.data_confidence || 0) < 80)
        } else if (filterConfidence === 'fair') {
          data = data.filter((l: Listing) => (l.data_confidence || 0) >= 40 && (l.data_confidence || 0) < 60)
        } else if (filterConfidence === 'poor') {
          data = data.filter((l: Listing) => (l.data_confidence || 0) < 40)
        }

        setListings(data)
      }
    } catch (err) {
      console.error('Failed to fetch listings:', err)
    } finally {
      setLoading(false)
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
      }
    } catch (err) {
      console.error('Failed to delete listing:', err)
    }
  }

  const handleAddListing = async () => {
    if (!newListing.county || !newListing.state || !newListing.listing_company_id) {
      alert('County, State, and Company are required')
      return
    }

    setSaving(true)
    try {
      const payload: any = {
        listing_type: newListing.listing_type,
        listing_company_id: newListing.listing_company_id,
        county: newListing.county,
        state: newListing.state,
        status: newListing.status,
      }

      if (newListing.total_acres) payload.total_acres = parseFloat(newListing.total_acres)
      if (newListing.source_url) payload.source_url = newListing.source_url
      if (newListing.auction_datetime) payload.auction_datetime = newListing.auction_datetime
      if (newListing.asking_price) payload.asking_price = parseFloat(newListing.asking_price)

      const response = await fetchWithAuth(`${API_URL}/api/listings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        const created = await response.json()
        // Redirect to the listing edit page so they can add more details and tracts
        router.push(`/admin/listings/${created.id}`)
      } else {
        const error = await response.json()
        alert(error.detail || 'Failed to create listing')
      }
    } catch (err) {
      console.error('Failed to create listing:', err)
      alert('Failed to create listing')
    } finally {
      setSaving(false)
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

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'bg-green-500/20 text-green-400'
    if (confidence >= 60) return 'bg-yellow-500/20 text-yellow-400'
    if (confidence >= 40) return 'bg-orange-500/20 text-orange-400'
    return 'bg-red-500/20 text-red-400'
  }

  const clearFilters = () => {
    setFilterCompany('')
    setFilterState('')
    setFilterCounty('')
    setFilterListingType('')
    setFilterStatus('')
    setFilterVerified('')
    setFilterConfidence('')
    setFilterAuctionDate('')
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80"
            >
              <Plus size={16} />
              Add Listing
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                showFilters || filterCompany || filterState || filterCounty || filterListingType || filterStatus || filterVerified || filterConfidence || filterAuctionDate
                  ? 'bg-gg-pink text-white' : 'bg-gg-gray-800 text-white hover:bg-gg-gray-700'
              }`}
            >
              <Filter size={16} />
              Filters
            </button>
          </div>
        </div>

        {/* Add Listing Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gg-gray-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gg-gray-800">
                <h2 className="text-xl font-bold text-white">Add Listing</h2>
                <button onClick={() => setShowAddModal(false)} className="text-gg-gray-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Listing Type *</label>
                    <select
                      value={newListing.listing_type}
                      onChange={(e) => setNewListing(prev => ({ ...prev, listing_type: e.target.value }))}
                      className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-2 text-black"
                    >
                      {LISTING_TYPES.map(t => (
                        <option key={t} value={t}>{t.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Company *</label>
                    <select
                      value={newListing.listing_company_id}
                      onChange={(e) => setNewListing(prev => ({ ...prev, listing_company_id: e.target.value }))}
                      className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-2 text-black"
                    >
                      <option value="">Select Company</option>
                      {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">State *</label>
                    <select
                      value={newListing.state}
                      onChange={(e) => setNewListing(prev => ({ ...prev, state: e.target.value, county: '' }))}
                      className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-2 text-black"
                    >
                      <option value="">Select State</option>
                      {Object.entries(US_STATES).map(([abbr, name]) => <option key={abbr} value={abbr}>{name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">County *</label>
                    <select
                      value={newListing.county}
                      onChange={(e) => setNewListing(prev => ({ ...prev, county: e.target.value }))}
                      disabled={!newListing.state}
                      className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-2 text-black disabled:opacity-50"
                    >
                      <option value="">{newListing.state ? 'Select County' : 'Select State First'}</option>
                      {newListingCounties.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Total Acres</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newListing.total_acres}
                      onChange={(e) => setNewListing(prev => ({ ...prev, total_acres: e.target.value }))}
                      className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Status</label>
                    <select
                      value={newListing.status}
                      onChange={(e) => setNewListing(prev => ({ ...prev, status: e.target.value }))}
                      className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-2 text-black"
                    >
                      {STATUS_OPTIONS.map(s => (
                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {newListing.listing_type === 'auction' && (
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Auction Date & Time</label>
                    <input
                      type="datetime-local"
                      value={newListing.auction_datetime}
                      onChange={(e) => setNewListing(prev => ({ ...prev, auction_datetime: e.target.value }))}
                      className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                )}
                {newListing.listing_type === 'private_treaty' && (
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Asking Price</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newListing.asking_price}
                      onChange={(e) => setNewListing(prev => ({ ...prev, asking_price: e.target.value }))}
                      className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                      placeholder="$"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-gg-gray-400 text-sm mb-1">Source URL</label>
                  <input
                    type="url"
                    value={newListing.source_url}
                    onChange={(e) => setNewListing(prev => ({ ...prev, source_url: e.target.value }))}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    placeholder="https://..."
                  />
                </div>
                <p className="text-gg-gray-500 text-sm">
                  After creating, you'll be redirected to the listing page to add tracts and more details.
                </p>
              </div>
              <div className="flex justify-end gap-3 p-4 border-t border-gg-gray-800">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-gg-gray-700 text-white rounded-lg hover:bg-gg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddListing}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  {saving ? 'Creating...' : 'Create Listing'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        {showFilters && (
          <div className="card mb-6 p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Company</label>
                <select
                  value={filterCompany}
                  onChange={(e) => { setFilterCompany(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All Companies</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">State</label>
                <select
                  value={filterState}
                  onChange={(e) => {
                    setFilterState(e.target.value)
                    setFilterCounty('') // Reset county when state changes
                    setPage(1)
                  }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All States</option>
                  {Object.entries(US_STATES).map(([abbr, name]) => <option key={abbr} value={abbr}>{name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">County</label>
                <select
                  value={filterCounty}
                  onChange={(e) => { setFilterCounty(e.target.value); setPage(1) }}
                  disabled={!filterState}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">
                    {filterState ? 'All Counties' : 'Select State First'}
                  </option>
                  {availableCounties.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Type</label>
                <select
                  value={filterListingType}
                  onChange={(e) => { setFilterListingType(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All Types</option>
                  <option value="auction">Auction</option>
                  <option value="private_treaty">Private Treaty</option>
                </select>
              </div>

              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Status</label>
                <select
                  value={filterStatus}
                  onChange={(e) => { setFilterStatus(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All Statuses</option>
                  {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Verified</label>
                <select
                  value={filterVerified}
                  onChange={(e) => { setFilterVerified(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All</option>
                  <option value="verified">Verified Only</option>
                  <option value="unverified">Unverified Only</option>
                </select>
              </div>

              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Confidence</label>
                <select
                  value={filterConfidence}
                  onChange={(e) => { setFilterConfidence(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                >
                  <option value="">All Levels</option>
                  <option value="excellent">Excellent (80%+)</option>
                  <option value="good">Good (60-79%)</option>
                  <option value="fair">Fair (40-59%)</option>
                  <option value="poor">Poor (&lt;40%)</option>
                </select>
              </div>

              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Auction Date</label>
                <input
                  type="date"
                  value={filterAuctionDate}
                  onChange={(e) => { setFilterAuctionDate(e.target.value); setPage(1) }}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>

              {(filterCompany || filterState || filterCounty || filterListingType || filterStatus || filterVerified || filterConfidence || filterAuctionDate) && (
                <div className="flex items-end">
                  <button
                    onClick={clearFilters}
                    className="w-full px-4 py-2 bg-gg-gray-700 text-white rounded-lg text-sm hover:bg-gg-gray-600"
                  >
                    Clear All
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Listings */}
        <div className="space-y-2">
          {listings.map((listing) => (
            <div key={listing.id} className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg overflow-hidden">
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
                  <div className="flex items-center gap-2">
                    <h3 className="text-white font-semibold truncate">
                      {listing.county} County, {listing.state}
                    </h3>
                    {listing.verified ? (
                      <div className="flex-shrink-0 flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 rounded-full text-xs font-medium">
                        <CheckCircle size={12} />
                        Verified
                      </div>
                    ) : (
                      <div className={`flex-shrink-0 px-2 py-0.5 ${getConfidenceColor(listing.data_confidence || 0)} rounded-full text-xs font-medium`}>
                        {listing.data_confidence || 0}% Confidence
                      </div>
                    )}
                  </div>
                  <p className="text-gg-gray-400 text-sm truncate">{getCompanyName(listing)}</p>
                </div>

                {/* Details */}
                <div className="hidden md:flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <div className="text-white font-medium">{listing.total_acres || '—'}</div>
                    <div className="text-gg-gray-500 text-xs">acres</div>
                  </div>
                  <div className="text-center">
                    <div className="text-white font-medium">{listing.tract_count || 0}</div>
                    <div className="text-gg-gray-500 text-xs">tracts</div>
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
                  onChange={(e) => handleQuickStatusChange(listing.id, e.target.value)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold text-white ${getStatusColor(listing.status)} border-0 cursor-pointer`}
                >
                  {STATUS_OPTIONS.map(s => (
                    <option key={s} value={s} className="bg-gg-gray-900 text-white">{s.replace('_', ' ')}</option>
                  ))}
                </select>

                {/* External Link Icon */}
                {listing.source_url && (
                  <a
                    href={listing.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 text-gg-gray-400 hover:text-white hover:bg-gg-gray-800 rounded-lg"
                    title="View original listing"
                  >
                    <ExternalLink size={16} />
                  </a>
                )}

                {/* Report PDF */}
                <button
                  onClick={() => openListingReport(String(listing.id), { force: true })}
                  className="p-2 text-gg-gray-400 hover:text-white hover:bg-gg-gray-800 rounded-lg"
                  title="Open branded listing report (PDF)"
                >
                  <FileText size={16} />
                </button>

                {/* Edit Icon */}
                <Link
                  href={`/admin/listings/${listing.id}`}
                  className="p-2 text-gg-gray-400 hover:text-white hover:bg-gg-gray-800 rounded-lg"
                >
                  <Pencil size={16} />
                </Link>

                {/* Delete */}
                <button
                  onClick={() => handleDelete(listing.id)}
                  className="p-2 text-red-400 hover:bg-red-500/20 rounded-lg"
                >
                  <Trash2 size={16} />
                </button>
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
