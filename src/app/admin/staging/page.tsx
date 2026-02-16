'use client'

import { useState, useEffect, useMemo } from 'react'
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
  Save,
  AlertTriangle,
  Filter,
  ChevronDown,
  Navigation
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

interface StagingListing {
  id: number
  source_url: string
  source_url_hash: string
  listing_company_id: string | null
  company_name: string | null
  scraped_data: any
  screenshot_base64: string | null
  map_image_base64: string | null
  auction_date: string | null
  status: string
  created_at: string
  scrape_duration_ms: number | null
}

interface RunLogEntry {
  id: number
  run_started_at: string | null
  run_completed_at: string | null
  company_id: string | null
  company_name: string | null
  auction_list_url: string | null
  status: string
  error_message: string | null
  cards_found: number
  urls_scraped: number
}

interface TractForm {
  tract_number: number
  acres: string
  tillable_acres: string
  county: string
  state: string
  soil_rating: string
}

interface EditForm {
  acres_listed: string
  sale_date: string
  auction_time: string
  description: string
  tracts: TractForm[]
}

function buildEditForm(scraped: any): EditForm {
  const listing = scraped?.listing || {}
  const tracts = scraped?.tracts || []

  // Extract time from auction_datetime if available
  let auctionTime = ''
  if (listing.auction_datetime) {
    try {
      const dt = new Date(listing.auction_datetime)
      const hours = String(dt.getHours()).padStart(2, '0')
      const minutes = String(dt.getMinutes()).padStart(2, '0')
      auctionTime = `${hours}:${minutes}`
    } catch {}
  }

  return {
    acres_listed: listing.acres_listed != null ? String(listing.acres_listed) : '',
    sale_date: listing.sale_date || '',
    auction_time: auctionTime,
    description: listing.description || '',
    tracts: tracts.map((t: any, i: number) => ({
      tract_number: t.tract_number ?? i + 1,
      acres: t.acres != null ? String(t.acres) : '',
      tillable_acres: t.tillable_acres != null ? String(t.tillable_acres) : '',
      county: t.county?.county_name || '',
      state: t.state_full || t.county?.state_full || '',
      soil_rating: t.soil_rating != null ? String(t.soil_rating) : '',
    })),
  }
}

function applyEditToScrapedData(original: any, form: EditForm): any {
  const updated = JSON.parse(JSON.stringify(original || {}))

  if (!updated.listing) updated.listing = {}
  updated.listing.acres_listed = form.acres_listed ? parseFloat(form.acres_listed) : null
  updated.listing.sale_date = form.sale_date || null
  updated.listing.description = form.description || null

  // Store auction_datetime in scraped_data when date+time are provided
  if (form.sale_date) {
    const timeStr = form.auction_time || '00:00'
    const localDateTime = new Date(`${form.sale_date}T${timeStr}:00`)
    updated.listing.auction_datetime = localDateTime.toISOString()
  } else {
    updated.listing.auction_datetime = null
  }

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
      soil_rating: t.soil_rating ? parseFloat(t.soil_rating) : null,
    }
  })

  return updated
}

export default function AdminStagingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<StagingListing[]>([])
  const [screenshotModal, setScreenshotModal] = useState<string | null>(null)

  // Company filter
  const [companyFilter, setCompanyFilter] = useState<string>('all')

  // Tab state
  const [activeTab, setActiveTab] = useState<'staging' | 'failures'>('staging')

  // Run log
  const [runLog, setRunLog] = useState<RunLogEntry[]>([])
  const [runLogLoading, setRunLogLoading] = useState(false)

  // Action state
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Edit modal state
  const [editingListing, setEditingListing] = useState<StagingListing | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ acres_listed: '', sale_date: '', auction_time: '', description: '', tracts: [] })
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
      fetchRunLog()
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

  const fetchRunLog = async () => {
    setRunLogLoading(true)
    try {
      const response = await fetch(`${SCRAPER_URL}/api/scraper-run-log?limit=200`)
      if (response.ok) {
        const data = await response.json()
        setRunLog(data)
      }
    } catch (err) {
      console.error('Failed to fetch run log:', err)
    } finally {
      setRunLogLoading(false)
    }
  }

  // Get unique company names from listings for the filter dropdown
  const companyNames = useMemo(() => {
    const names = new Set<string>()
    listings.forEach((l) => {
      if (l.company_name) names.add(l.company_name)
    })
    return Array.from(names).sort()
  }, [listings])

  // Filtered listings
  const filteredListings = useMemo(() => {
    if (companyFilter === 'all') return listings
    return listings.filter((l) => l.company_name === companyFilter)
  }, [listings, companyFilter])

  // Failed/no_cards entries from the most recent run
  const failedEntries = useMemo(() => {
    return runLog.filter((r) => r.status === 'failed' || r.status === 'no_cards' || r.status === 'timeout')
  }, [runLog])

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
      tracts: [...prev.tracts, { tract_number: nextNum, acres: '', tillable_acres: '', county: '', state: '', soil_rating: '' }],
    }))
  }

  const removeTract = (index: number) => {
    setEditForm((prev) => ({
      ...prev,
      tracts: prev.tracts.filter((_, i) => i !== index),
    }))
  }

  const extractListingInfo = (scraped: any) => {
    if (!scraped) return { acres: null, county: null, state: null, description: null, tractCount: 0, tracts: [], auctionTime: null }
    const listing = scraped.listing || {}
    const tracts = scraped.tracts || []
    const firstTract = tracts[0] || {}

    // Extract time from auction_datetime
    let auctionTime: string | null = null
    if (listing.auction_datetime) {
      try {
        const dt = new Date(listing.auction_datetime)
        auctionTime = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
      } catch {}
    }

    return {
      acres: listing.acres_listed || null,
      county: firstTract.county?.county_name || null,
      state: listing.state_full || firstTract.state_full || null,
      description: listing.description || null,
      tractCount: tracts.length,
      tracts: tracts,
      auctionTime,
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

  const formatDuration = (ms: number | null) => {
    if (ms == null) return null
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms}ms`
  }

  const formatTimeAgo = (dateStr: string | null) => {
    if (!dateStr) return ''
    try {
      const d = new Date(dateStr)
      const diff = Date.now() - d.getTime()
      const mins = Math.floor(diff / 60000)
      if (mins < 60) return `${mins}m ago`
      const hours = Math.floor(mins / 60)
      if (hours < 24) return `${hours}h ago`
      const days = Math.floor(hours / 24)
      return `${days}d ago`
    } catch {
      return ''
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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white transition-colors">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Listing Staging</h1>
              <p className="text-gg-gray-400">{filteredListings.length} pending listings to review</p>
            </div>
          </div>
          <button
            onClick={() => { fetchStagingListings(); fetchRunLog() }}
            className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 transition-colors text-sm"
          >
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gg-gray-900 rounded-lg p-1 w-fit">
          <button
            onClick={() => setActiveTab('staging')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'staging' ? 'bg-gg-gray-700 text-white' : 'text-gg-gray-400 hover:text-white'
            }`}
          >
            Pending ({filteredListings.length})
          </button>
          <button
            onClick={() => setActiveTab('failures')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'failures' ? 'bg-gg-gray-700 text-white' : 'text-gg-gray-400 hover:text-white'
            }`}
          >
            <AlertTriangle size={14} />
            Failed ({failedEntries.length})
          </button>
        </div>

        {/* Company Filter - only on staging tab */}
        {activeTab === 'staging' && companyNames.length > 1 && (
          <div className="mb-6 flex items-center gap-3">
            <Filter size={16} className="text-gg-gray-400" />
            <div className="relative">
              <select
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                className="appearance-none bg-gg-gray-800 border border-gg-gray-700 text-white rounded-lg px-4 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-gg-pink"
              >
                <option value="all">All Companies ({listings.length})</option>
                {companyNames.map((name) => (
                  <option key={name} value={name}>
                    {name} ({listings.filter((l) => l.company_name === name).length})
                  </option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gg-gray-400 pointer-events-none" />
            </div>
          </div>
        )}

        {/* Staging Tab */}
        {activeTab === 'staging' && (
          <>
            {/* Empty State */}
            {filteredListings.length === 0 && (
              <div className="card text-center py-16">
                <CheckCircle className="mx-auto mb-4 text-green-400" size={48} />
                <h2 className="text-xl font-bold text-white mb-2">All caught up!</h2>
                <p className="text-gg-gray-400">No pending listings to review.</p>
              </div>
            )}

            {/* Staging Cards */}
            <div className="space-y-6">
              {filteredListings.map((listing) => {
                const info = extractListingInfo(listing.scraped_data)
                return (
                  <div
                    key={listing.id}
                    className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl overflow-hidden"
                  >
                    <div className="flex flex-col lg:flex-row">
                      {/* Thumbnail Screenshot — small, click to enlarge */}
                      <div className="lg:w-52 flex-shrink-0 bg-gg-gray-800 p-3 flex flex-col gap-2">
                        {listing.screenshot_base64 ? (
                          <button
                            onClick={() => setScreenshotModal(`data:image/png;base64,${listing.screenshot_base64}`)}
                            className="block"
                            title="Click to enlarge"
                          >
                            <img
                              src={`data:image/png;base64,${listing.screenshot_base64}`}
                              alt="Page screenshot"
                              className="w-full max-w-[200px] rounded-lg object-cover object-top cursor-pointer hover:opacity-80 transition-opacity border border-gg-gray-700"
                              style={{ maxHeight: '150px' }}
                            />
                            <span className="text-[10px] text-gg-gray-500 mt-1 block">Click to enlarge</span>
                          </button>
                        ) : (
                          <div className="w-full h-24 flex items-center justify-center text-gg-gray-600 rounded-lg border border-gg-gray-700">
                            <ImageIcon size={28} />
                          </div>
                        )}
                        {/* Map image if available */}
                        {listing.map_image_base64 && (
                          <button
                            onClick={() => setScreenshotModal(`data:image/png;base64,${listing.map_image_base64}`)}
                            className="block"
                            title="Click to enlarge map"
                          >
                            <img
                              src={`data:image/png;base64,${listing.map_image_base64}`}
                              alt="Tract map"
                              className="w-full max-w-[200px] rounded-lg object-contain cursor-pointer hover:opacity-80 transition-opacity border border-gg-gray-700"
                              style={{ maxHeight: '150px' }}
                            />
                            <span className="text-[10px] text-gg-gray-500 mt-1 block">Tract Map</span>
                          </button>
                        )}
                        {/* Inline polygon mini-map from scraped_data if no map_image_base64 */}
                        {!listing.map_image_base64 && info.tracts.some((t: any) => t.polygon_coordinates) && (
                          <TractMiniMap tracts={info.tracts} />
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
                              {listing.scrape_duration_ms != null && (
                                <>
                                  <span className="text-gg-gray-600">|</span>
                                  <span className="text-gg-gray-500">Scraped in {formatDuration(listing.scrape_duration_ms)}</span>
                                </>
                              )}
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
                            <p className="text-xs text-gg-gray-400 mb-1">Auction Date &amp; Time</p>
                            <p className="text-white font-semibold">
                              {formatDate(listing.auction_date)}
                              {info.auctionTime && (
                                <span className="text-gg-gray-300 font-normal ml-1">@ {info.auctionTime}</span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Tract Details */}
                        {info.tracts.length > 0 && (
                          <div className="mb-4">
                            <p className="text-xs text-gg-gray-400 mb-2 font-medium uppercase tracking-wider">Tract Details</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {info.tracts.map((tract: any, idx: number) => (
                                <div key={idx} className="bg-gg-gray-800/60 rounded-lg px-3 py-2 text-sm">
                                  <div className="flex items-center justify-between">
                                    <span className="text-white font-medium">Tract {tract.tract_number ?? idx + 1}</span>
                                    {tract.acres && <span className="text-gg-gray-300">{tract.acres} ac</span>}
                                  </div>
                                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gg-gray-400">
                                    {tract.tillable_acres != null && (
                                      <span>Tillable: {tract.tillable_acres} ac</span>
                                    )}
                                    {tract.soil_rating != null && (
                                      <span>Soil: {tract.soil_rating}</span>
                                    )}
                                    {tract.pi != null && (
                                      <span>PI: {tract.pi}</span>
                                    )}
                                    {tract.county?.county_name && (
                                      <span>{tract.county.county_name}{tract.state_full ? `, ${tract.state_full}` : ''}</span>
                                    )}
                                    {tract.latitude && tract.longitude && (
                                      <span className="flex items-center gap-0.5">
                                        <Navigation size={10} />
                                        {tract.latitude.toFixed(4)}, {tract.longitude.toFixed(4)}
                                      </span>
                                    )}
                                    {tract.land_type && (
                                      <span className="text-gg-pink">{tract.land_type}</span>
                                    )}
                                    {tract.has_house && <span className="text-blue-400">House</span>}
                                    {tract.has_building && <span className="text-amber-400">Building</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

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
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Failures Tab */}
        {activeTab === 'failures' && (
          <div>
            {runLogLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="animate-spin text-gg-pink" size={32} />
              </div>
            ) : failedEntries.length === 0 ? (
              <div className="card text-center py-16">
                <CheckCircle className="mx-auto mb-4 text-green-400" size={48} />
                <h2 className="text-xl font-bold text-white mb-2">No failures</h2>
                <p className="text-gg-gray-400">All companies discovered successfully in recent runs.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {failedEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-4 flex items-start gap-4"
                  >
                    <div className={`mt-0.5 flex-shrink-0 ${entry.status === 'failed' ? 'text-red-400' : entry.status === 'timeout' ? 'text-amber-400' : 'text-gg-gray-500'}`}>
                      {entry.status === 'failed' ? <XCircle size={20} /> : entry.status === 'timeout' ? <AlertTriangle size={20} /> : <AlertTriangle size={20} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <h3 className="text-white font-semibold">{entry.company_name || 'Unknown'}</h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          entry.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                          entry.status === 'timeout' ? 'bg-amber-500/20 text-amber-400' :
                          'bg-gg-gray-700 text-gg-gray-400'
                        }`}>
                          {entry.status}
                        </span>
                        {entry.run_started_at && (
                          <span className="text-xs text-gg-gray-500">{formatTimeAgo(entry.run_started_at)}</span>
                        )}
                      </div>
                      {entry.auction_list_url && (
                        <a
                          href={entry.auction_list_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gg-gray-500 hover:text-gg-pink truncate block mt-1"
                        >
                          {entry.auction_list_url}
                        </a>
                      )}
                      {entry.error_message && (
                        <p className="text-sm text-red-400/80 mt-1 font-mono text-xs">{entry.error_message}</p>
                      )}
                      <div className="flex gap-4 mt-1 text-xs text-gg-gray-500">
                        <span>Cards: {entry.cards_found}</span>
                        <span>URLs scraped: {entry.urls_scraped}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Screenshot/Map Modal */}
      {screenshotModal && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer"
          onClick={() => setScreenshotModal(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setScreenshotModal(null)}
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 z-10"
            >
              <X size={20} />
            </button>
            <img
              src={screenshotModal}
              alt="Full size"
              className="w-full rounded-lg"
            />
          </div>
        </div>
      )}

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

              <div className="grid grid-cols-2 gap-4">
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
                  <label className="block text-sm text-gg-gray-400 mb-1">Auction Time</label>
                  <input
                    type="time"
                    value={editForm.auction_time}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, auction_time: e.target.value }))}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                  />
                </div>
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
                          <label className="block text-xs text-gg-gray-400 mb-1">Soil Rating</label>
                          <input
                            type="number"
                            step="0.1"
                            placeholder="e.g. 120.5"
                            value={tract.soil_rating}
                            onChange={(e) => updateTract(idx, 'soil_rating', e.target.value)}
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
                        <div>
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


/**
 * TractMiniMap renders a small SVG polygon map from tract polygon_coordinates
 * that exist in scraped_data. Used as a fallback when no pre-generated
 * map_image_base64 is available.
 */
function TractMiniMap({ tracts }: { tracts: any[] }) {
  const tractsWithCoords = tracts.filter((t: any) => t.polygon_coordinates && t.polygon_coordinates.length >= 3)
  if (tractsWithCoords.length === 0) return null

  // Gather all points to compute bounds
  let allLons: number[] = []
  let allLats: number[] = []
  tractsWithCoords.forEach((t: any) => {
    t.polygon_coordinates.forEach((pt: number[]) => {
      if (pt.length >= 2) {
        allLons.push(pt[0])
        allLats.push(pt[1])
      }
    })
  })

  if (allLons.length === 0) return null

  const minLon = Math.min(...allLons)
  const maxLon = Math.max(...allLons)
  const minLat = Math.min(...allLats)
  const maxLat = Math.max(...allLats)
  const padLon = (maxLon - minLon) * 0.1 || 0.001
  const padLat = (maxLat - minLat) * 0.1 || 0.001

  const width = 180
  const height = 140

  const scaleX = width / (maxLon - minLon + 2 * padLon)
  const scaleY = height / (maxLat - minLat + 2 * padLat)

  const toSvgX = (lon: number) => (lon - minLon + padLon) * scaleX
  // Flip Y because SVG y goes down, lat goes up
  const toSvgY = (lat: number) => height - (lat - minLat + padLat) * scaleY

  const colors = ['#4CAF50', '#2196F3', '#FF9800', '#9C27B0', '#F44336', '#00BCD4']

  return (
    <div className="bg-gg-gray-900 rounded-lg border border-gg-gray-700 p-1">
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="w-full">
        {tractsWithCoords.map((tract: any, i: number) => {
          const points = tract.polygon_coordinates
            .filter((pt: number[]) => pt.length >= 2)
            .map((pt: number[]) => `${toSvgX(pt[0])},${toSvgY(pt[1])}`)
            .join(' ')
          return (
            <polygon
              key={i}
              points={points}
              fill={colors[i % colors.length]}
              fillOpacity={0.35}
              stroke={colors[i % colors.length]}
              strokeWidth={2}
            />
          )
        })}
      </svg>
      <p className="text-[9px] text-gg-gray-500 text-center mt-0.5">Tract Boundaries</p>
    </div>
  )
}
