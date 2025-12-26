'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, Trash2, ExternalLink, Pencil, Plus } from 'lucide-react'
import { getCountiesForState } from '@/data/counties'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico",
  "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
  "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"
]

const STATUSES = ['listed', 'live', 'pending', 'sold', 'no_sale']
const LAND_TYPES = ['Farm', 'Recreational', 'Pasture', 'Timber', 'Commercial', 'Residential', 'Development', 'CRP']

interface Listing {
  id: string
  title: string
  description: string
  listing_type: 'auction' | 'private_treaty'
  status: string
  address: string
  city: string
  county: string
  state: string
  zip: string
  total_acres: number
  land_types: string[]
  primary_image_url: string
  brochure_url: string
  source_url: string
  auction_date: string
  auction_time: string
  auction_location: string
  bidding_url: string
  asking_price: number
  price_per_acre: number
  sale_price: number
  listing_company_id: string
  company?: {
    id: string
    name: string
  }
  tracts?: any[]
  created_at: string
}

interface Company {
  id: string
  name: string
}

export default function EditListingPage() {
  const router = useRouter()
  const params = useParams()
  const listingId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [listing, setListing] = useState<Listing | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showAddTract, setShowAddTract] = useState(false)
  const [addingTract, setAddingTract] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    listing_type: 'auction',
    status: 'listed',
    address: '',
    city: '',
    county: '',
    state: '',
    zip: '',
    total_acres: '',
    land_types: [] as string[],
    primary_image_url: '',
    brochure_url: '',
    source_url: '',
    auction_date: '',
    auction_time: '',
    auction_location: '',
    bidding_url: '',
    asking_price: '',
    price_per_acre: '',
    sale_price: '',
    listing_company_id: '',
  })

  // New tract form state
  const [newTract, setNewTract] = useState({
    tract_number: '',
    total_acres: '',
    tillable_acres: '',
    land_type: 'Farm',
    description: '',
    soil_rating: '',
  })

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth(token)
  }, [router, listingId])

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
        fetchListing(token),
        fetchCompanies(token)
      ])
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchListing = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/listings/${listingId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setListing(data)
        
        // Populate form
        setFormData({
          title: data.title || '',
          description: data.description || '',
          listing_type: data.listing_type || 'auction',
          status: data.status || 'listed',
          address: data.address || '',
          city: data.city || '',
          county: data.county || '',
          state: data.state || '',
          zip: data.zip || '',
          total_acres: data.total_acres?.toString() || '',
          land_types: data.land_types || [],
          primary_image_url: data.primary_image_url || '',
          brochure_url: data.brochure_url || '',
          source_url: data.source_url || '',
          auction_date: data.auction_datetime ? data.auction_datetime.split('T')[0] : (data.auction_date ? data.auction_date.split('T')[0] : ''),
          auction_time: data.auction_datetime ? new Date(data.auction_datetime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : (data.auction_time ? new Date(data.auction_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''),
          auction_location: data.auction_location || '',
          bidding_url: data.bidding_url || '',
          asking_price: data.asking_price?.toString() || '',
          price_per_acre: data.price_per_acre?.toString() || '',
          sale_price: data.sale_price?.toString() || '',
          listing_company_id: data.listing_company_id || data.company?.id || '',
        })
      } else {
        setError('Listing not found')
      }
    } catch (err) {
      setError('Failed to fetch listing')
    } finally {
      setLoading(false)
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleLandTypeChange = (type: string) => {
    setFormData(prev => ({
      ...prev,
      land_types: prev.land_types.includes(type)
        ? prev.land_types.filter(t => t !== type)
        : [...prev.land_types, type]
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const token = localStorage.getItem('auth_token')

    try {
      const updateData: any = {}
      
      // Text fields - always include if they have a value
      if (formData.title) updateData.title = formData.title
      if (formData.description) updateData.description = formData.description
      if (formData.listing_type) updateData.listing_type = formData.listing_type
      if (formData.status) updateData.status = formData.status
      
      // Location fields
      if (formData.county) updateData.county = formData.county
      if (formData.state) updateData.state = formData.state
      if (formData.city) updateData.city = formData.city
      if (formData.zip) updateData.zip = formData.zip
      if (formData.address) updateData.address = formData.address
      
      // Numeric fields
      if (formData.total_acres) updateData.total_acres = parseFloat(formData.total_acres)
      if (formData.price_per_acre) updateData.price_per_acre = parseFloat(formData.price_per_acre)
      if (formData.sale_price) updateData.sale_price = parseFloat(formData.sale_price)
      if (formData.asking_price) updateData.asking_price = parseFloat(formData.asking_price)
      
      // URL fields
      if (formData.primary_image_url) updateData.primary_image_url = formData.primary_image_url
      if (formData.brochure_url) updateData.brochure_url = formData.brochure_url
      if (formData.source_url) updateData.source_url = formData.source_url
      if (formData.bidding_url) updateData.bidding_url = formData.bidding_url
      
      // Company
      if (formData.listing_company_id) updateData.listing_company_id = formData.listing_company_id
      
      // Auction fields
      if (formData.auction_location) updateData.auction_location = formData.auction_location
      if (formData.auction_date) {
        updateData.auction_date = new Date(formData.auction_date).toISOString()
      }
      if (formData.auction_date && formData.auction_time) {
        updateData.auction_time = new Date(`${formData.auction_date}T${formData.auction_time}`).toISOString()
      }
      
      // Land types array
      if (formData.land_types && formData.land_types.length > 0) {
        updateData.land_types = formData.land_types
      }

      const response = await fetch(`${API_URL}/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      })

      if (response.ok) {
        // Redirect to listings page after successful save
        router.push('/admin/listings')
      } else {
        const data = await response.json()
        setError(data.detail || 'Failed to update listing')
      }
    } catch (err) {
      setError('Failed to update listing')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this listing? This cannot be undone.')) return

    const token = localStorage.getItem('auth_token')

    try {
      const response = await fetch(`${API_URL}/api/listings/${listingId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        router.push('/admin/listings')
      } else {
        setError('Failed to delete listing')
      }
    } catch (err) {
      setError('Failed to delete listing')
    }
  }

  const handleAddTract = async () => {
    if (!newTract.tract_number || !newTract.total_acres) {
      setError('Tract number and total acres are required')
      return
    }

    setAddingTract(true)
    setError('')

    const token = localStorage.getItem('auth_token')

    try {
      const response = await fetch(`${API_URL}/api/listings/${listingId}/tracts`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tract_number: parseInt(newTract.tract_number),
          total_acres: parseFloat(newTract.total_acres),
          tillable_acres: newTract.tillable_acres ? parseFloat(newTract.tillable_acres) : null,
          land_type: newTract.land_type,
          description: newTract.description || null,
          soil_rating: newTract.soil_rating ? parseFloat(newTract.soil_rating) : null,
        }),
      })

      if (response.ok) {
        // Reset form and refresh listing
        setNewTract({
          tract_number: '',
          total_acres: '',
          tillable_acres: '',
          land_type: 'Farm',
          description: '',
          soil_rating: '',
        })
        setShowAddTract(false)
        
        // Refresh listing to get updated tracts
        await fetchListing(token!)
        
        // Calculate total acres from all tracts and update listing
        const listingResponse = await fetch(`${API_URL}/api/listings/${listingId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        
        if (listingResponse.ok) {
          const listingData = await listingResponse.json()
          const tracts = listingData.tracts || []
          
          if (tracts.length > 0) {
            const totalAcres = tracts.reduce((sum: number, t: any) => sum + (parseFloat(t.total_acres) || 0), 0)
            const tillableAcres = tracts.reduce((sum: number, t: any) => sum + (parseFloat(t.tillable_acres) || 0), 0)
            
            // Update listing with calculated acres
            await fetch(`${API_URL}/api/listings/${listingId}`, {
              method: 'PATCH',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                total_acres: totalAcres,
                // Note: tillable_acres field may need to be added to ListingUpdate schema
              }),
            })
            
            // Update form data to reflect new total
            setFormData(prev => ({ ...prev, total_acres: totalAcres.toString() }))
          }
        }
        
        setSuccess('Tract added successfully!')
        setTimeout(() => setSuccess(''), 3000)
      } else {
        const data = await response.json()
        setError(data.detail || 'Failed to add tract')
      }
    } catch (err) {
      setError('Failed to add tract')
    } finally {
      setAddingTract(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  if (!listing) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-xl mb-4">Listing not found</p>
          <Link href="/admin/listings" className="text-gg-pink hover:underline">
            Back to Listings
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/listings" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Edit Listing</h1>
              <p className="text-gg-gray-400">{listing.county} County, {listing.state}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {listing.source_url && (
              <a
                href={listing.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700"
              >
                <ExternalLink size={16} />
                Source
              </a>
            )}
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30"
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400">
            {success}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Basic Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-gg-gray-400 text-sm mb-1">Title</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-gg-gray-400 text-sm mb-1">Description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  rows={4}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Listing Type</label>
                <select
                  name="listing_type"
                  value={formData.listing_type}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                >
                  <option value="auction">Auction</option>
                  <option value="private_treaty">Private Treaty</option>
                </select>
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Status</label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                >
                  {STATUSES.map(status => (
                    <option key={status} value={status} className="capitalize">{status.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Company</label>
                <select
                  name="listing_company_id"
                  value={formData.listing_company_id}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                >
                  <option value="">Select Company</option>
                  {companies.map(company => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Total Acres</label>
                <input
                  type="number"
                  name="total_acres"
                  value={formData.total_acres}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Location</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">State</label>
                <select
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                >
                  <option value="">Select State</option>
                  {US_STATES.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">County</label>
                <select
                  name="county"
                  value={formData.county}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                >
                  <option value="">Select County</option>
                  {formData.state && getCountiesForState(formData.state).map(county => (
                    <option key={county} value={county}>{county}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">City</label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">ZIP</label>
                <input
                  type="text"
                  name="zip"
                  value={formData.zip}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-gg-gray-400 text-sm mb-1">Address</label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>

          {/* Auction Details */}
          {formData.listing_type === 'auction' && (
            <div className="card">
              <h2 className="text-xl font-semibold text-white mb-4">Auction Details</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-gg-gray-400 text-sm mb-1">Auction Date</label>
                  <input
                    type="date"
                    name="auction_date"
                    value={formData.auction_date}
                    onChange={handleChange}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                  />
                </div>
                <div>
                  <label className="block text-gg-gray-400 text-sm mb-1">Auction Time</label>
                  <input
                    type="time"
                    name="auction_time"
                    value={formData.auction_time}
                    onChange={handleChange}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-gg-gray-400 text-sm mb-1">Auction Location</label>
                  <input
                    type="text"
                    name="auction_location"
                    value={formData.auction_location}
                    onChange={handleChange}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-gg-gray-400 text-sm mb-1">Bidding URL</label>
                  <input
                    type="url"
                    name="bidding_url"
                    value={formData.bidding_url}
                    onChange={handleChange}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Pricing */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Pricing</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Asking Price ($)</label>
                <input
                  type="number"
                  name="asking_price"
                  value={formData.asking_price}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Price per Acre ($)</label>
                <input
                  type="number"
                  name="price_per_acre"
                  value={formData.price_per_acre}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Sale Price ($)</label>
                <input
                  type="number"
                  name="sale_price"
                  value={formData.sale_price}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>

          {/* Land Types */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Land Types</h2>
            <div className="flex flex-wrap gap-3">
              {LAND_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleLandTypeChange(type)}
                  className={`px-4 py-2 rounded-lg border transition-colors ${
                    formData.land_types.includes(type)
                      ? 'bg-gg-pink/20 border-gg-pink text-gg-pink'
                      : 'bg-gg-gray-800 border-gg-gray-700 text-gg-gray-400 hover:border-gg-gray-500'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Media */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Media & Links</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Primary Image URL</label>
                <input
                  type="url"
                  name="primary_image_url"
                  value={formData.primary_image_url}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
                {formData.primary_image_url && (
                  <img 
                    src={formData.primary_image_url} 
                    alt="Preview" 
                    className="mt-2 h-32 object-cover rounded-lg"
                  />
                )}
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Brochure URL</label>
                <input
                  type="url"
                  name="brochure_url"
                  value={formData.brochure_url}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Source URL</label>
                <input
                  type="url"
                  name="source_url"
                  value={formData.source_url}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>

          {/* Tracts */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">Tracts ({listing.tracts?.length || 0})</h2>
              <button
                type="button"
                onClick={() => setShowAddTract(!showAddTract)}
                className="flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80"
              >
                <Plus size={16} />
                Add Tract
              </button>
            </div>

            {/* Add Tract Form */}
            {showAddTract && (
              <div className="mb-4 p-4 bg-gg-gray-800 rounded-lg">
                <h3 className="text-white font-medium mb-3">New Tract</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Tract Number *</label>
                    <input
                      type="number"
                      value={newTract.tract_number}
                      onChange={(e) => setNewTract(prev => ({ ...prev, tract_number: e.target.value }))}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Total Acres *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newTract.total_acres}
                      onChange={(e) => setNewTract(prev => ({ ...prev, total_acres: e.target.value }))}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Tillable Acres</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newTract.tillable_acres}
                      onChange={(e) => setNewTract(prev => ({ ...prev, tillable_acres: e.target.value }))}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Land Type</label>
                    <select
                      value={newTract.land_type}
                      onChange={(e) => setNewTract(prev => ({ ...prev, land_type: e.target.value }))}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    >
                      {LAND_TYPES.map(type => (
                        <option key={type} value={type}>{type}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Productivity Rating</label>
                    <input
                      type="number"
                      step="0.01"
                      value={newTract.soil_rating}
                      onChange={(e) => setNewTract(prev => ({ ...prev, soil_rating: e.target.value }))}
                      placeholder="e.g. 120.5"
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-gg-gray-400 text-sm mb-1">Description</label>
                    <input
                      type="text"
                      value={newTract.description}
                      onChange={(e) => setNewTract(prev => ({ ...prev, description: e.target.value }))}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddTract(false)}
                    className="px-4 py-2 bg-gg-gray-700 text-white rounded-lg hover:bg-gg-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleAddTract}
                    disabled={addingTract}
                    className="flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50"
                  >
                    {addingTract ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                    Add Tract
                  </button>
                </div>
              </div>
            )}

            {/* Existing Tracts */}
            {listing.tracts && listing.tracts.length > 0 ? (
              <div className="space-y-2">
                {listing.tracts.map((tract: any, index: number) => (
                  <div key={tract.id || index} className="flex justify-between items-center p-3 bg-gg-gray-800 rounded-lg">
                    <div className="flex-1">
                      <span className="text-white font-medium">Tract {tract.tract_number || index + 1}</span>
                      <span className="text-gg-gray-400 ml-4">{tract.total_acres} acres • {tract.land_type || 'N/A'}</span>
                    </div>
                    <Link
                      href={`/admin/tracts/${tract.id}`}
                      className="flex items-center gap-2 px-3 py-1 bg-gg-gray-700 text-gg-gray-300 rounded hover:bg-gg-gray-600 hover:text-white transition-colors"
                    >
                      <Pencil size={14} />
                      Edit
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gg-gray-400 text-center py-4">No tracts added yet</p>
            )}
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-4">
            <Link
              href="/admin/listings"
              className="px-6 py-3 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Saving...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
