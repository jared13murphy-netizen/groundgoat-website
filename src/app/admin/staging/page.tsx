'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  CheckCircle,
  XCircle,
  ExternalLink,
  MapPin,
  Calendar,
  Layers,
  Image as ImageIcon,
  Pencil,
  X,
  Plus,
  Trash2,
  Save
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface StagingListing {
  id: number
  source_url: string
  source_url_hash: string
  listing_company_id: string | null
  company_name: string | null
  scraped_data: any
  screenshot_base64: string | null
  auction_date: string | null
  status: string
  created_at: string
}

interface TractForm {
  tract_number: number
  acres: string
  tillable_acres: string
  county: string
  state: string
}

interface EditForm {
  acres_listed: string
  sale_date: string
  description: string
  tracts: TractForm[]
}

function buildEditForm(scraped: any): EditForm {
  const listing = scraped?.listing || {}
  const tracts = scraped?.tracts || []
  return {
    acres_listed: listing.acres_listed != null ? String(listing.acres_listed) : '',
    sale_date: listing.sale_date || '',
    description: listing.description || '',
    tracts: tracts.map((t: any, i: number) => ({
      tract_number: t.tract_number ?? i + 1,
      acres: t.acres != null ? String(t.acres) : '',
      tillable_acres: t.tillable_acres != null ? String(t.tillable_acres) : '',
      county: t.county?.county_name || '',
      state: t.state_full || t.county?.state_full || '',
    })),
  }
}

function applyEditToScrapedData(original: any, form: EditForm): any {
  const updated = JSON.parse(JSON.stringify(original || {}))

  if (!updated.listing) updated.listing = {}
  updated.listing.acres_listed = form.acres_listed ? parseFloat(form.acres_listed) : null
  updated.listing.sale_date = form.sale_date || null
  updated.listing.description = form.description || null

  updated.tracts = form.tracts.map((t) => {
    const origTract = (original?.tracts || []).find(
      (ot: any) => ot.tract_number === t.tract_number
    ) || {}
    return {
      ...origTract,
      tract_number: t.tract_number,
      acres: t.acres ? parseFloat(t.acres) : null,
      tillable_acres: t.tillable_acres ? parseFloat(t.tillable_acres) : null,
      county: {
        ...(origTract.county || {}),
        county_name: t.county,
        state_full: t.state,
      },
      state_full: t.state,
    }
  })

  return updated
}

export default function AdminStagingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<StagingListing[]>([])
  const [expandedScreenshot, setExpandedScreenshot] = useState<number | null>(null)

  // Action state
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Edit modal state
  const [editingListing, setEditingListing] = useState<StagingListing | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ acres_listed: '', sale_date: '', description: '', tracts: [] })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth()
  }, [router])

  const checkAuth = async () => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)
      if (!response.ok) throw new Error('Not authenticated')
      const userData = await response.json()
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }
      fetchStagingListings()
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchStagingListings = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging?status=pending`)
      if (response.ok) {
        const data = await response.json()
        setListings(data)
      }
    } catch (err) {
      console.error('Failed to fetch staging listings:', err)
    } finally {
      setLoading(false)
    }
  }

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 4000)
  }

  const handleVerify = async (id: number) => {
    setActionLoading(id)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}/verify`, {
        method: 'POST',
      })
      if (response.ok) {
        setListings((prev) => prev.filter((l) => l.id !== id))
        showToast('success', 'Listing verified and created successfully')
      } else {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }))
        showToast('error', err.detail || err.error || 'Failed to verify listing')
      }
    } catch (err) {
      showToast('error', 'Network error — failed to verify listing')
    } finally {
      setActionLoading(null)
    }
  }

  const handleReject = async (id: number) => {
    setActionLoading(id)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      })
      if (response.ok) {
        setListings((prev) => prev.filter((l) => l.id !== id))
        showToast('success', 'Listing rejected')
      } else {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }))
        showToast('error', err.detail || err.error || 'Failed to reject listing')
      }
    } catch (err) {
      showToast('error', 'Network error — failed to reject listing')
    } finally {
      setActionLoading(null)
    }
  }

  const openEditModal = (listing: StagingListing) => {
    setEditingListing(listing)
    setEditForm(buildEditForm(listing.scraped_data))
  }

  const closeEditModal = () => {
    setEditingListing(null)
    setSaving(false)
  }

  const handleEditSave = async () => {
    if (!editingListing) return
    setSaving(true)

    const updatedScrapedData = applyEditToScrapedData(editingListing.scraped_data, editForm)

    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/${editingListing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scraped_data: updatedScrapedData,
          auction_date: editForm.sale_date || null,
        }),
      })

      if (response.ok) {
        setListings((prev) =>
          prev.map((l) =>
            l.id === editingListing.id
              ? { ...l, scraped_data: updatedScrapedData, auction_date: editForm.sale_date || l.auction_date }
              : l
          )
        )
        closeEditModal()
      } else {
        const err = await response.json()
        alert(err.detail || 'Failed to save')
      }
    } catch (err) {
      console.error('Failed to save staging listing:', err)
      alert('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const updateTract = (index: number, field: keyof TractForm, value: string | number) => {
    setEditForm((prev) => {
      const tracts = [...prev.tracts]
      tracts[index] = { ...tracts[index], [field]: value }
      return { ...prev, tracts }
    })
  }

  const addTract = () => {
    const nextNum = editForm.tracts.length > 0
      ? Math.max(...editForm.tracts.map((t) => t.tract_number)) + 1
      : 1
    setEditForm((prev) => ({
      ...prev,
      tracts: [...prev.tracts, { tract_number: nextNum, acres: '', tillable_acres: '', county: '', state: '' }],
    }))
  }

  const removeTract = (index: number) => {
    setEditForm((prev) => ({
      ...prev,
      tracts: prev.tracts.filter((_, i) => i !== index),
    }))
  }

  const extractListingInfo = (scraped: any) => {
    if (!scraped) return { acres: null, county: null, state: null, description: null, tractCount: 0 }
    const listing = scraped.listing || {}
    const tracts = scraped.tracts || []
    const firstTract = tracts[0] || {}
    return {
      acres: listing.acres_listed || null,
      county: firstTract.county?.county_name || null,
      state: listing.state_full || firstTract.state_full || null,
      description: listing.description || null,
      tractCount: tracts.length,
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  if (loading) {
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
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white transition-colors">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Listing Staging</h1>
              <p className="text-gg-gray-400">{listings.length} pending listings to review</p>
            </div>
          </div>
          <button
            onClick={fetchStagingListings}
            className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 transition-colors text-sm"
          >
            Refresh
          </button>
        </div>

        {/* Empty State */}
        {listings.length === 0 && (
          <div className="card text-center py-16">
            <CheckCircle className="mx-auto mb-4 text-green-400" size={48} />
            <h2 className="text-xl font-bold text-white mb-2">All caught up!</h2>
            <p className="text-gg-gray-400">No pending listings to review.</p>
          </div>
        )}

        {/* Staging Cards */}
        <div className="space-y-6">
          {listings.map((listing) => {
            const info = extractListingInfo(listing.scraped_data)
            return (
              <div
                key={listing.id}
                className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl overflow-hidden"
              >
                <div className="flex flex-col lg:flex-row">
                  {/* Screenshot */}
                  <div className="lg:w-80 flex-shrink-0 bg-gg-gray-800">
                    {listing.screenshot_base64 ? (
                      <button
                        onClick={() =>
                          setExpandedScreenshot(
                            expandedScreenshot === listing.id ? null : listing.id
                          )
                        }
                        className="w-full"
                      >
                        <img
                          src={`data:image/png;base64,${listing.screenshot_base64}`}
                          alt="Page screenshot"
                          className="w-full h-48 lg:h-full object-cover object-top cursor-pointer hover:opacity-80 transition-opacity"
                        />
                      </button>
                    ) : (
                      <div className="w-full h-48 lg:h-full flex items-center justify-center text-gg-gray-600">
                        <ImageIcon size={48} />
                      </div>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-6">
                    {/* Company & Date Row */}
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h3 className="text-lg font-bold text-white">
                          {listing.company_name || 'Unknown Company'}
                        </h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-gg-gray-400">
                          <span className="flex items-center gap-1">
                            <Calendar size={14} />
                            {formatDate(listing.auction_date)}
                          </span>
                          <span className="text-gg-gray-600">|</span>
                          <span>Staged {formatDate(listing.created_at)}</span>
                        </div>
                      </div>
                      <a
                        href={listing.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-gg-pink hover:text-white bg-gg-pink/10 hover:bg-gg-pink/20 rounded-lg transition-colors"
                      >
                        <ExternalLink size={14} />
                        Source
                      </a>
                    </div>

                    {/* Key Data */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                      <div className="bg-gg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gg-gray-400 mb-1">Acres</p>
                        <p className="text-white font-semibold">
                          {info.acres ? `${info.acres}` : 'N/A'}
                        </p>
                      </div>
                      <div className="bg-gg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gg-gray-400 mb-1">Location</p>
                        <p className="text-white font-semibold flex items-center gap-1">
                          <MapPin size={12} className="text-gg-gray-500" />
                          {info.county && info.state
                            ? `${info.county}, ${info.state}`
                            : 'N/A'}
                        </p>
                      </div>
                      <div className="bg-gg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gg-gray-400 mb-1">Tracts</p>
                        <p className="text-white font-semibold flex items-center gap-1">
                          <Layers size={12} className="text-gg-gray-500" />
                          {info.tractCount}
                        </p>
                      </div>
                      <div className="bg-gg-gray-800 rounded-lg p-3">
                        <p className="text-xs text-gg-gray-400 mb-1">Auction Date</p>
                        <p className="text-white font-semibold">
                          {formatDate(listing.auction_date)}
                        </p>
                      </div>
                    </div>

                    {/* Description */}
                    {info.description && (
                      <p className="text-sm text-gg-gray-400 mb-4 line-clamp-2">
                        {info.description.length > 200
                          ? info.description.substring(0, 200) + '...'
                          : info.description}
                      </p>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleVerify(listing.id)}
                        disabled={actionLoading === listing.id}
                        className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoading === listing.id ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
                        {actionLoading === listing.id ? 'Verifying...' : 'Verify'}
                      </button>
                      <button
                        onClick={() => openEditModal(listing)}
                        disabled={actionLoading === listing.id}
                        className="flex items-center gap-2 px-5 py-2.5 bg-gg-gray-700 text-white rounded-lg hover:bg-gg-gray-600 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Pencil size={16} />
                        Edit
                      </button>
                      <button
                        onClick={() => handleReject(listing.id)}
                        disabled={actionLoading === listing.id}
                        className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoading === listing.id ? <Loader2 className="animate-spin" size={16} /> : <XCircle size={16} />}
                        {actionLoading === listing.id ? 'Rejecting...' : 'Reject'}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Screenshot */}
                {expandedScreenshot === listing.id && listing.screenshot_base64 && (
                  <div className="border-t border-gg-gray-800 p-4 bg-gg-gray-800/50">
                    <img
                      src={`data:image/png;base64,${listing.screenshot_base64}`}
                      alt="Full page screenshot"
                      className="w-full rounded-lg"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-lg shadow-lg text-white ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {toast.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          <span className="font-medium">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Edit Modal */}
      {editingListing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gg-gray-900 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gg-gray-800">
              <h2 className="text-xl font-bold text-white">Edit Scraped Data</h2>
              <button onClick={closeEditModal} className="text-gg-gray-400 hover:text-white">
                <X size={24} />
              </button>
            </div>

            {/* Form */}
            <div className="p-4 space-y-4">
              {/* Listing Fields */}
              <div>
                <label className="block text-sm text-gg-gray-400 mb-1">Total Acres</label>
                <input
                  type="number"
                  step="0.01"
                  value={editForm.acres_listed}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, acres_listed: e.target.value }))}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-gg-gray-400 mb-1">Auction Date</label>
                <input
                  type="date"
                  value={editForm.sale_date}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, sale_date: e.target.value }))}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-gg-gray-400 mb-1">Description</label>
                <textarea
                  rows={4}
                  value={editForm.description}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>

              {/* Tracts */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm font-semibold text-white">Tracts ({editForm.tracts.length})</label>
                  <button
                    type="button"
                    onClick={addTract}
                    className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gg-pink/20 text-gg-pink rounded-lg hover:bg-gg-pink/30 transition-colors"
                  >
                    <Plus size={14} />
                    Add Tract
                  </button>
                </div>

                <div className="space-y-3">
                  {editForm.tracts.map((tract, idx) => (
                    <div key={idx} className="bg-gg-gray-800 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-white">Tract {tract.tract_number}</span>
                        <button
                          type="button"
                          onClick={() => removeTract(idx)}
                          className="text-red-400 hover:text-red-300 p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-gg-gray-400 mb-1">Tract #</label>
                          <input
                            type="number"
                            value={tract.tract_number}
                            onChange={(e) => updateTract(idx, 'tract_number', parseInt(e.target.value) || 0)}
                            className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gg-gray-400 mb-1">Acres</label>
                          <input
                            type="number"
                            step="0.01"
                            value={tract.acres}
                            onChange={(e) => updateTract(idx, 'acres', e.target.value)}
                            className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gg-gray-400 mb-1">Tillable Acres</label>
                          <input
                            type="number"
                            step="0.01"
                            value={tract.tillable_acres}
                            onChange={(e) => updateTract(idx, 'tillable_acres', e.target.value)}
                            className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gg-gray-400 mb-1">County</label>
                          <input
                            type="text"
                            value={tract.county}
                            onChange={(e) => updateTract(idx, 'county', e.target.value)}
                            className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-xs text-gg-gray-400 mb-1">State</label>
                          <input
                            type="text"
                            value={tract.state}
                            onChange={(e) => updateTract(idx, 'state', e.target.value)}
                            className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  ))}

                  {editForm.tracts.length === 0 && (
                    <p className="text-sm text-gg-gray-500 text-center py-4">No tracts. Click &quot;Add Tract&quot; to add one.</p>
                  )}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-4 border-t border-gg-gray-800">
              <button
                onClick={closeEditModal}
                className="px-4 py-2 bg-gg-gray-700 text-white rounded-lg hover:bg-gg-gray-600"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50"
              >
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
