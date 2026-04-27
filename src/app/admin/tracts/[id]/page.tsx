'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, Trash2 } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Tract {
  id: string
  listing_id: string
  tract_number: number
  name: string
  description: string
  total_acres: number
  tillable_acres: number
  pasture_acres: number
  timber_acres: number
  other_acres: number
  land_type: string
  soil_rating: number
  bid_amount: number
  bid_type: string
  sale_price: number
  price_per_acre: number
  sale_status: string
  image_url: string
}

export default function EditTractPage() {
  const router = useRouter()
  const params = useParams()
  const tractId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [tract, setTract] = useState<Tract | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [updateParentListing, setUpdateParentListing] = useState(false)

  const [formData, setFormData] = useState({
    tract_number: '',
    name: '',
    description: '',
    total_acres: '',
    tillable_acres: '',
    pasture_acres: '',
    timber_acres: '',
    other_acres: '',
    land_type: '',
    soil_rating: '',
    bid_amount: '',
    bid_type: '',
    sale_price: '',
    price_per_acre: '',
    sale_status: '',
    image_url: '',
  })

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth(token)
  }, [router, tractId])

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

      await fetchTract(token)
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchTract = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/tracts/${tractId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setTract(data)
        
        setFormData({
          tract_number: data.tract_number?.toString() || '',
          name: data.name || '',
          description: data.description || '',
          total_acres: data.total_acres?.toString() || '',
          tillable_acres: data.tillable_acres?.toString() || '',
          pasture_acres: data.pasture_acres?.toString() || '',
          timber_acres: data.timber_acres?.toString() || '',
          other_acres: data.other_acres?.toString() || '',
          land_type: data.land_type || '',
          soil_rating: data.soil_rating?.toString() || '',
          bid_amount: data.bid_amount?.toString() || '',
          bid_type: data.bid_type || '',
          sale_price: data.sale_price?.toString() || '',
          price_per_acre: data.price_per_acre?.toString() || '',
          sale_status: data.sale_status || '',
          image_url: data.image_url || '',
        })
      } else {
        setError('Tract not found')
      }
    } catch (err) {
      setError('Failed to fetch tract')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const token = localStorage.getItem('auth_token')

    try {
      const updateData: any = {}
      
      if (formData.tract_number) updateData.tract_number = parseInt(formData.tract_number)
      if (formData.name) updateData.name = formData.name
      if (formData.description) updateData.description = formData.description
      if (formData.total_acres) updateData.total_acres = parseFloat(formData.total_acres)
      if (formData.tillable_acres) updateData.tillable_acres = parseFloat(formData.tillable_acres)
      if (formData.pasture_acres) updateData.pasture_acres = parseFloat(formData.pasture_acres)
      if (formData.timber_acres) updateData.timber_acres = parseFloat(formData.timber_acres)
      if (formData.other_acres) updateData.other_acres = parseFloat(formData.other_acres)
      if (formData.land_type) updateData.land_type = formData.land_type
      if (formData.soil_rating) updateData.soil_rating = parseFloat(formData.soil_rating)
      if (formData.bid_amount) updateData.bid_amount = parseFloat(formData.bid_amount)
      if (formData.bid_type) updateData.bid_type = formData.bid_type
      if (formData.sale_price) updateData.sale_price = parseFloat(formData.sale_price)
      if (formData.price_per_acre) updateData.price_per_acre = parseFloat(formData.price_per_acre)
      if (formData.sale_status) updateData.sale_status = formData.sale_status
      if (formData.image_url) updateData.image_url = formData.image_url

      const response = await fetch(`${API_URL}/api/tracts/${tractId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      })

      if (response.ok) {
        // If checkbox is checked, update parent listing values
        if (updateParentListing && tract) {
          try {
            // Fetch all tracts for this listing to recalculate
            const tractsResponse = await fetch(`${API_URL}/api/listings/${tract.listing_id}`, {
              headers: { 'Authorization': `Bearer ${token}` },
            })
            if (tractsResponse.ok) {
              const listingData = await tractsResponse.json()
              const allTracts = listingData.tracts || []
              
              // Calculate totals from all tracts
              let totalAcres = 0
              let soldAcres = 0
              let totalSalePrice = 0
              
              allTracts.forEach((t: any) => {
                const tractAcres = parseFloat(t.total_acres) || 0
                const tractSalePrice = parseFloat(t.sale_price) || 0
                const tractPricePerAcre = parseFloat(t.price_per_acre) || 0
                
                // Use the updated values if this is the current tract
                if (t.id === tractId) {
                  totalAcres += parseFloat(formData.total_acres) || 0
                  if (formData.sale_status === 'sold') {
                    soldAcres += parseFloat(formData.total_acres) || 0
                  }
                  totalSalePrice += parseFloat(formData.sale_price) || 0
                } else {
                  totalAcres += tractAcres
                  if (t.sale_status === 'sold') {
                    soldAcres += tractAcres
                  }
                  totalSalePrice += tractSalePrice
                }
              })
              
              const pricePerAcre = totalAcres > 0 ? totalSalePrice / totalAcres : 0
              
              // Update the parent listing
              await fetch(`${API_URL}/api/listings/${tract.listing_id}`, {
                method: 'PATCH',
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  total_acres: totalAcres,
                  sold_acres: soldAcres,
                  sale_price: totalSalePrice,
                  price_per_acre: pricePerAcre,
                }),
              })
            }
          } catch (err) {
            console.error('Failed to update parent listing:', err)
          }
        }
        
        setSuccess('Tract updated successfully!' + (updateParentListing ? ' Parent listing also updated.' : ''))
        setTimeout(() => setSuccess(''), 3000)
      } else {
        const data = await response.json()
        setError(data.detail || 'Failed to update tract')
      }
    } catch (err) {
      setError('Failed to update tract')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this tract? This cannot be undone.')) return

    const token = localStorage.getItem('auth_token')

    try {
      const response = await fetch(`${API_URL}/api/tracts/${tractId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok && tract) {
        router.push(`/admin/listings/${tract.listing_id}`)
      } else {
        setError('Failed to delete tract')
      }
    } catch (err) {
      setError('Failed to delete tract')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  if (!tract) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-xl mb-4">Tract not found</p>
          <Link href="/admin/listings" className="text-gg-pink hover:underline">
            Back to Listings
          </Link>
        </div>
      </div>
    )
  }

  const LAND_TYPES = ['Farm', 'Recreational', 'Pasture', 'Timber', 'Hunting', 'Vacant Land', 'CRP', 'Commercial', 'Residential', 'Development', 'Other']
  const BID_TYPES = ['per_acre', 'total']
  const SALE_STATUSES = ['pending', 'sold', 'no_sale']

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href={`/admin/listings/${tract.listing_id}`} className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Edit Tract {tract.tract_number}</h1>
              <p className="text-gg-gray-400">{tract.total_acres} acres</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/tracts/${tractId}/draw`}
              className="flex items-center gap-2 px-4 py-2 bg-gg-pink/20 text-gg-pink border border-gg-pink/30 rounded-lg hover:bg-gg-pink/30"
            >
              Draw boundary
            </Link>
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
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Tract Number</label>
                <input
                  type="number"
                  name="tract_number"
                  value={formData.tract_number}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
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
                  rows={3}
                  className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-3 text-black"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Land Type</label>
                <select
                  name="land_type"
                  value={formData.land_type}
                  onChange={handleChange}
                  className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-3 text-black"
                >
                  <option value="">Select Type</option>
                  {LAND_TYPES.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Image URL</label>
                <input
                  type="url"
                  name="image_url"
                  value={formData.image_url}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>

          {/* Acreage */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Acreage</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
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
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Tillable</label>
                <input
                  type="number"
                  name="tillable_acres"
                  value={formData.tillable_acres}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Pasture</label>
                <input
                  type="number"
                  name="pasture_acres"
                  value={formData.pasture_acres}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Timber</label>
                <input
                  type="number"
                  name="timber_acres"
                  value={formData.timber_acres}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Other</label>
                <input
                  type="number"
                  name="other_acres"
                  value={formData.other_acres}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>

          {/* Soil Info */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Soil Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Soil Productivity</label>
                <input
                  type="number"
                  name="soil_rating"
                  value={formData.soil_rating}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>

          {/* Sale Info */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Sale Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Bid Amount ($)</label>
                <input
                  type="number"
                  name="bid_amount"
                  value={formData.bid_amount}
                  onChange={handleChange}
                  step="0.01"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Bid Type</label>
                <select
                  name="bid_type"
                  value={formData.bid_type}
                  onChange={handleChange}
                  className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-3 text-black"
                >
                  <option value="">Select Type</option>
                  {BID_TYPES.map(type => (
                    <option key={type} value={type}>{type === 'per_acre' ? 'Per Acre' : 'Total'}</option>
                  ))}
                </select>
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
                <label className="block text-gg-gray-400 text-sm mb-1">Sale Status</label>
                <select
                  name="sale_status"
                  value={formData.sale_status}
                  onChange={handleChange}
                  className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-3 text-black"
                >
                  <option value="">Select Status</option>
                  {SALE_STATUSES.map(status => (
                    <option key={status} value={status} className="capitalize">{status.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Update Parent Listing Option */}
          <div className="card">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={updateParentListing}
                onChange={(e) => setUpdateParentListing(e.target.checked)}
                className="w-5 h-5 rounded border-gg-gray-700 bg-gg-gray-900 text-gg-pink focus:ring-gg-pink"
              />
              <div>
                <span className="text-white font-medium">Update parent listing values</span>
                <p className="text-gg-gray-400 text-sm">Recalculate listing's total acres, sold acres, sale price, and price/acre from all tracts</p>
              </div>
            </label>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-4">
            <Link
              href={`/admin/listings/${tract.listing_id}`}
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
