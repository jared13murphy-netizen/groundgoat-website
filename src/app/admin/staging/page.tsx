'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
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
  Navigation,
  BarChart3,
  Clock,
  Copy,
  StopCircle,
  Play
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
  run_type: string
  company_name: string | null
  company_id: string | null
  auction_list_url: string | null
  status: string
  discovery_method: string | null
  cards_found: number
  cards_after_filter: number
  new_urls: number
  error_message: string | null
  duration_ms: number | null
  created_at: string | null
}

interface TractForm {
  tract_number: number
  acres: string
  tillable_acres: string
  county: string
  state: string
  soil_rating: string
  latitude: string
  longitude: string
}

interface EditForm {
  acres_listed: string
  sale_date: string
  auction_time: string
  auction_url: string
  image_url: string
  description: string
  tracts: TractForm[]
}

function buildEditForm(scraped: any): EditForm {
  const listing = scraped?.listing || {}
  const tracts = scraped?.tracts || []

  // Extract time from auction_time or auction_datetime
  // Handles both naive ISO strings (2026-03-20T10:00:00) and UTC (2026-03-20T15:00:00Z)
  let auctionTime = ''
  const timeSource = listing.auction_time || listing.auction_datetime
  if (timeSource) {
    try {
      // Try to extract time directly from the string first (for naive ISO without Z)
      const timeMatch = String(timeSource).match(/T(\d{2}):(\d{2})/)
      if (timeMatch && !String(timeSource).endsWith('Z')) {
        auctionTime = `${timeMatch[1]}:${timeMatch[2]}`
      } else {
        const dt = new Date(timeSource)
        if (!isNaN(dt.getTime())) {
          const hours = String(dt.getHours()).padStart(2, '0')
          const minutes = String(dt.getMinutes()).padStart(2, '0')
          auctionTime = `${hours}:${minutes}`
        }
      }
    } catch {}
  }

  return {
    acres_listed: listing.acres_listed != null ? String(listing.acres_listed) : '',
    sale_date: listing.sale_date || '',
    auction_time: auctionTime,
    auction_url: listing.auction_url || '',
    image_url: listing.image || listing.primary_image_url || '',
    description: listing.description || '',
    tracts: tracts.map((t: any, i: number) => ({
      tract_number: t.tract_number ?? i + 1,
      acres: t.acres != null ? String(t.acres) : '',
      tillable_acres: t.tillable_acres != null ? String(t.tillable_acres) : '',
      county: t.county?.county_name || '',
      state: t.state_full || t.county?.state_full || t.state || t.county?.state || '',
      soil_rating: t.soil_rating != null ? String(t.soil_rating) : '',
      latitude: t.latitude != null ? String(t.latitude) : '',
      longitude: t.longitude != null ? String(t.longitude) : '',
    })),
  }
}

function applyEditToScrapedData(original: any, form: EditForm): any {
  const updated = JSON.parse(JSON.stringify(original || {}))

  if (!updated.listing) updated.listing = {}
  updated.listing.acres_listed = form.acres_listed ? parseFloat(form.acres_listed) : null
  updated.listing.sale_date = form.sale_date || null
  updated.listing.description = form.description || null
  updated.listing.auction_url = form.auction_url || null
  updated.listing.image = form.image_url || null
  updated.listing.primary_image_url = form.image_url || null

  // Store auction_datetime in scraped_data as a naive ISO string (no UTC conversion)
  // The auction time is in the auction's local timezone based on county/state
  if (form.sale_date) {
    const timeStr = form.auction_time || '00:00'
    const naiveIso = `${form.sale_date}T${timeStr}:00`
    updated.listing.auction_time = naiveIso
    updated.listing.auction_datetime = naiveIso
  } else {
    updated.listing.auction_time = null
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
      latitude: t.latitude ? parseFloat(t.latitude) : null,
      longitude: t.longitude ? parseFloat(t.longitude) : null,
    }
  })

  return updated
}

export default function AdminStagingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [listings, setListings] = useState<StagingListing[]>([])
  const [screenshotModal, setScreenshotModal] = useState<string | null>(null)

  // Company filter
  const [companyFilter, setCompanyFilter] = useState<string>('all')

  // Tab state
  const [activeTab, setActiveTab] = useState<'staging' | 'failures' | 'results'>('staging')

  // Run log
  const [runLog, setRunLog] = useState<RunLogEntry[]>([])
  const [runLogLoading, setRunLogLoading] = useState(false)

  // Action state
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  // Edit modal state
  const [editingListing, setEditingListing] = useState<StagingListing | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ acres_listed: '', sale_date: '', auction_time: '', auction_url: '', image_url: '', description: '', tracts: [] })
  const [saving, setSaving] = useState(false)

  // Scraper status
  const [scraperStatus, setScraperStatus] = useState<{
    running: boolean
    stopped: boolean
    started_at: string | null
    completed_at: string | null
    current_url: string | null
    progress: string
    total_scraped: number
    phase: string | null
    phase_detail: string | null
    companies_total: number
    companies_checked: number
    discovery_urls_found: number
  } | null>(null)
  const [stoppingScraper, setStoppingScraper] = useState(false)
  const [startingScraper, setStartingScraper] = useState(false)
  const prevScraperRunning = useRef<boolean | null>(null)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${SCRAPER_URL}/api/scraper/status`)
        if (res.ok) {
          const data = await res.json()
          setScraperStatus(data)
          // Auto-refresh listings when scraper transitions from running → complete
          if (prevScraperRunning.current === true && data?.running === false) {
            fetchStagingListings()
            fetchRunLog()
          }
          prevScraperRunning.current = data?.running ?? null
        }
      } catch {}
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [])

  const stopScraper = async () => {
    setStoppingScraper(true)
    try {
      const res = await fetch(`${SCRAPER_URL}/api/scraper/stop`, { method: 'POST' })
      if (res.ok) {
        // Status will update via the polling interval
      }
    } catch (err) {
      console.error('Failed to stop scraper:', err)
    } finally {
      setStoppingScraper(false)
    }
  }

  const runScraper = async () => {
    setStartingScraper(true)
    try {
      const res = await fetch(`${SCRAPER_URL}/api/nightly/scrape-and-stage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('Failed to start scraper:', data.message || res.statusText)
      }
      // Status banner will update via the polling interval
    } catch (err) {
      console.error('Failed to start scraper:', err)
    } finally {
      setStartingScraper(false)
    }
  }

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
    setFetchError(null)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging?status=pending&listing_type=auction`)
      if (response.ok) {
        const data = await response.json()
        setListings(Array.isArray(data) ? data : [])
      } else {
        const errBody = await response.json().catch(() => null)
        setFetchError(errBody?.detail || errBody?.error || `Server returned ${response.status}`)
        setListings([])
      }
    } catch (err) {
      console.error('Failed to fetch staging listings:', err)
      setFetchError('Failed to connect to the server. Please try again.')
      setListings([])
    } finally {
      setLoading(false)
    }
  }

  const fetchRunLog = async () => {
    setRunLogLoading(true)
    try {
      const response = await fetch(`${SCRAPER_URL}/api/scraper-run-log?limit=500`)
      if (response.ok) {
        const data = await response.json()
        // API returns { success: true, entries: [...] }
        const entries = data?.entries || (Array.isArray(data) ? data : [])
        setRunLog(entries)
      }
    } catch (err) {
      console.error('Failed to fetch run log:', err)
      setRunLog([])
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

  // Group latest run results by company for the Scraper Results tab
  const latestRunResults = useMemo(() => {
    if (runLog.length === 0) return { runs: [], runTime: null as string | null }

    // Find the most recent created_at timestamp to identify the latest run batch
    // All entries within 2 hours of the newest are considered part of the same run
    const sorted = [...runLog].sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })
    const newestTime = sorted[0]?.created_at ? new Date(sorted[0].created_at).getTime() : 0
    const twoHoursMs = 2 * 60 * 60 * 1000
    const latestBatch = sorted.filter((r) => {
      const t = r.created_at ? new Date(r.created_at).getTime() : 0
      return newestTime - t < twoHoursMs
    })

    // Group by company, merging discovery + scrape entries
    const companyMap = new Map<string, {
      company_name: string
      auction_list_url: string | null
      discovery_method: string | null
      cards_found: number
      cards_after_filter: number
      new_urls: number
      urls_scraped: number
      listings_staged: number
      status: string
      error_message: string | null
      duration_ms: number
    }>()

    for (const entry of latestBatch) {
      const name = entry.company_name || 'Unknown'
      const existing = companyMap.get(name)
      if (!existing) {
        companyMap.set(name, {
          company_name: name,
          auction_list_url: entry.auction_list_url,
          discovery_method: entry.discovery_method,
          cards_found: entry.run_type === 'discovery' ? entry.cards_found : 0,
          cards_after_filter: entry.run_type === 'discovery' ? entry.cards_after_filter : 0,
          new_urls: entry.run_type === 'discovery' ? entry.new_urls : 0,
          urls_scraped: entry.run_type === 'scrape' ? entry.cards_found : 0,
          listings_staged: entry.run_type === 'scrape' ? entry.cards_after_filter : 0,
          status: entry.status,
          error_message: entry.error_message,
          duration_ms: entry.duration_ms || 0,
        })
      } else {
        // Merge discovery + scrape data for same company
        if (entry.run_type === 'discovery') {
          existing.cards_found = entry.cards_found
          existing.cards_after_filter = entry.cards_after_filter
          existing.new_urls = entry.new_urls
          existing.discovery_method = entry.discovery_method
          if (!existing.auction_list_url) existing.auction_list_url = entry.auction_list_url
        } else if (entry.run_type === 'scrape') {
          existing.urls_scraped = entry.cards_found
          existing.listings_staged = entry.cards_after_filter
        }
        if (entry.status === 'failed') {
          existing.status = 'failed'
          existing.error_message = entry.error_message
        }
        existing.duration_ms += entry.duration_ms || 0
      }
    }

    const runs = Array.from(companyMap.values()).sort((a, b) => {
      // Failed first, then by cards_found desc
      if (a.status === 'failed' && b.status !== 'failed') return -1
      if (b.status === 'failed' && a.status !== 'failed') return 1
      return b.cards_found - a.cards_found
    })

    return { runs, runTime: sorted[0]?.created_at || null }
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
        method: 'DELETE',
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

  const handleClearAll = async () => {
    if (!confirm(`Are you sure you want to clear all ${filteredListings.length} staging listings? This will NOT add them to rejected URLs.`)) {
      return
    }
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/clear-all?listing_type=auction`, {
        method: 'DELETE',
      })
      if (response.ok) {
        const data = await response.json()
        setListings([])
        showToast('success', `Cleared ${data.deleted} staging listings`)
      } else {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }))
        showToast('error', err.detail || err.error || 'Failed to clear staging')
      }
    } catch (err) {
      showToast('error', 'Network error — failed to clear staging')
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
              ? { ...l, scraped_data: updatedScrapedData, auction_date: editForm.sale_date || null }
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
      tracts: [...prev.tracts, { tract_number: nextNum, acres: '', tillable_acres: '', county: '', state: '', soil_rating: '', latitude: '', longitude: '' }],
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

    // Extract time from auction_time or auction_datetime
    // Handles both naive ISO strings (2026-03-20T10:00:00) and UTC (2026-03-20T15:00:00Z)
    let auctionTime: string | null = null
    const timeSource = listing.auction_time || listing.auction_datetime
    if (timeSource) {
      try {
        const timeStr = String(timeSource)
        const timeMatch = timeStr.match(/T(\d{2}):(\d{2})/)
        if (timeMatch && !timeStr.endsWith('Z')) {
          // Naive ISO string — parse hours/minutes directly to avoid timezone shift
          const h = parseInt(timeMatch[1])
          const m = timeMatch[2]
          const ampm = h >= 12 ? 'PM' : 'AM'
          const h12 = h % 12 || 12
          auctionTime = `${h12}:${m} ${ampm}`
        } else {
          const dt = new Date(timeSource)
          if (!isNaN(dt.getTime())) {
            auctionTime = dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
          }
        }
      } catch {}
    }

    // Extract listing image URL
    const imageUrl = listing.image || listing.primary_image_url || null

    return {
      acres: listing.acres_listed || null,
      county: firstTract.county?.county_name || null,
      state: listing.state_full || firstTract.state_full || firstTract.state || listing.state || null,
      description: listing.description || null,
      tractCount: tracts.length,
      tracts: tracts,
      auctionTime,
      imageUrl,
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    try {
      // For date-only strings like "2026-03-15", parse as local date
      // to avoid timezone shift (new Date("2026-03-15") treats it as UTC midnight,
      // which becomes the previous day in US timezones)
      const dateOnly = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
      if (dateOnly) {
        const d = new Date(parseInt(dateOnly[1]), parseInt(dateOnly[2]) - 1, parseInt(dateOnly[3]))
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      }
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
        <div className="text-center">
          <Loader2 className="animate-spin text-gg-pink mx-auto mb-4" size={32} />
          <p className="text-gg-gray-400 text-sm">Loading staging listings...</p>
        </div>
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
              <h1 className="font-display text-3xl font-bold text-white">Auction Staging</h1>
              <p className="text-gg-gray-400">{filteredListings.length} pending listings to review</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={runScraper}
              disabled={startingScraper || scraperStatus?.running}
              className="px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm flex items-center gap-2"
            >
              {startingScraper ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Starting...
                </>
              ) : (
                <>
                  <Play size={16} />
                  Run Scraper
                </>
              )}
            </button>
            {listings.length > 0 && (
              <button
                onClick={handleClearAll}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm flex items-center gap-2"
              >
                <Trash2 size={16} />
                Clear All
              </button>
            )}
            <button
              onClick={() => { fetchStagingListings(); fetchRunLog() }}
              className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 transition-colors text-sm"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Scraper Status Banner */}
        {scraperStatus && (
          <div className={`mb-6 rounded-lg px-4 py-3 flex items-center gap-3 text-sm ${
            scraperStatus.running
              ? 'bg-gg-pink/10 border border-gg-pink/30'
              : 'bg-gg-gray-800 border border-gg-gray-700'
          }`}>
            {scraperStatus.running ? (
              <>
                <Loader2 className="animate-spin text-gg-pink shrink-0" size={16} />
                <div className="text-white flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Scraper Running</span>
                    {scraperStatus.phase === 'discovery' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">Discovery</span>
                    )}
                    {scraperStatus.phase === 'scraping' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gg-pink/20 text-gg-pink font-medium">Scraping</span>
                    )}
                  </div>
                  {scraperStatus.phase === 'discovery' ? (
                    <div className="text-sm text-gg-gray-300 mt-1">
                      <span>Companies: {scraperStatus.companies_checked}/{scraperStatus.companies_total}</span>
                      {scraperStatus.discovery_urls_found > 0 && (
                        <span className="text-green-400 ml-3">{scraperStatus.discovery_urls_found} new URLs found</span>
                      )}
                      {scraperStatus.phase_detail && (
                        <div className="text-gg-gray-400 text-xs mt-0.5 truncate">{scraperStatus.phase_detail}</div>
                      )}
                    </div>
                  ) : scraperStatus.phase === 'scraping' ? (
                    <div className="text-sm text-gg-gray-300 mt-1">
                      <span>{scraperStatus.progress} URLs scraped</span>
                      {scraperStatus.current_url && (
                        <div className="text-gg-gray-400 text-xs mt-0.5 truncate">{scraperStatus.current_url}</div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-gg-gray-300 mt-1">
                      {scraperStatus.progress} URLs
                    </div>
                  )}
                </div>
                <button
                  onClick={stopScraper}
                  disabled={stoppingScraper || scraperStatus.stopped}
                  className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:bg-red-800 disabled:opacity-50 text-white text-xs font-medium rounded-md transition-colors"
                >
                  <StopCircle size={14} />
                  {stoppingScraper ? 'Stopping...' : scraperStatus.stopped ? 'Stopping...' : 'Stop Scraper'}
                </button>
              </>
            ) : scraperStatus.completed_at ? (
              <>
                <CheckCircle className="text-green-400 shrink-0" size={16} />
                <span className="text-gg-gray-300">
                  Last run: {new Date(scraperStatus.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(scraperStatus.completed_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                  {scraperStatus.total_scraped > 0 && ` — ${scraperStatus.total_scraped} listings scraped`}
                  {scraperStatus.phase_detail && ` (${scraperStatus.phase_detail})`}
                </span>
              </>
            ) : null}
          </div>
        )}

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
          <button
            onClick={() => setActiveTab('results')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === 'results' ? 'bg-gg-gray-700 text-white' : 'text-gg-gray-400 hover:text-white'
            }`}
          >
            <BarChart3 size={14} />
            Scraper Results
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

        {/* Error State */}
        {fetchError && (
          <div className="mb-6 rounded-lg px-4 py-3 flex items-center gap-3 text-sm bg-red-500/10 border border-red-500/30">
            <XCircle className="text-red-400 shrink-0" size={16} />
            <span className="text-red-300">{fetchError}</span>
            <button
              onClick={() => { setFetchError(null); fetchStagingListings(); fetchRunLog() }}
              className="ml-auto px-3 py-1 bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Staging Tab */}
        {activeTab === 'staging' && (
          <>
            {/* Empty State */}
            {filteredListings.length === 0 && !fetchError && (
              <div className="card text-center py-16">
                {scraperStatus?.running ? (
                  <>
                    <Loader2 className="animate-spin mx-auto mb-4 text-gg-pink" size={48} />
                    <h2 className="text-xl font-bold text-white mb-2">
                      {scraperStatus.phase === 'discovery' ? 'Discovering listings...' : scraperStatus.phase === 'scraping' ? 'Scraping listings...' : 'Scraper is running'}
                    </h2>
                    {scraperStatus.phase === 'discovery' ? (
                      <div className="text-gg-gray-400 mb-1">
                        <p>Checking companies for new auction listings ({scraperStatus.companies_checked}/{scraperStatus.companies_total})</p>
                        {scraperStatus.discovery_urls_found > 0 && (
                          <p className="text-green-400 mt-1">{scraperStatus.discovery_urls_found} new URLs found so far</p>
                        )}
                        {scraperStatus.phase_detail && (
                          <p className="text-gg-gray-500 text-sm mt-2">{scraperStatus.phase_detail}</p>
                        )}
                      </div>
                    ) : scraperStatus.phase === 'scraping' ? (
                      <div className="text-gg-gray-400 mb-1">
                        <p>{scraperStatus.progress} URLs scraped</p>
                        {scraperStatus.current_url && (
                          <p className="text-gg-gray-500 text-sm mt-1 truncate max-w-xl mx-auto">{scraperStatus.current_url}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-gg-gray-400 mb-1">{scraperStatus.progress} URLs processed so far.</p>
                    )}
                    <p className="text-gg-gray-500 text-sm mt-2">New listings will appear here once the scraper finishes. This page auto-refreshes.</p>
                  </>
                ) : (
                  <>
                    <CheckCircle className="mx-auto mb-4 text-green-400" size={48} />
                    <h2 className="text-xl font-bold text-white mb-2">No listings in staging</h2>
                    <p className="text-gg-gray-400">No pending listings to review. Run the nightly scraper to discover new listings.</p>
                  </>
                )}
              </div>
            )}

            {/* Staging Cards */}
            <div className="space-y-6">
              {filteredListings.map((listing) => {
                const info = extractListingInfo(listing.scraped_data)
                const mapImageBase64 = listing.scraped_data?.map_image_base64 || listing.map_image_base64 || null
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
                        {/* Listing property image */}
                        {info.imageUrl && (
                          <button
                            onClick={() => setScreenshotModal(info.imageUrl)}
                            className="block"
                            title="Click to enlarge property image"
                          >
                            <img
                              src={info.imageUrl}
                              alt="Property"
                              className="w-full max-w-[200px] rounded-lg object-cover cursor-pointer hover:opacity-80 transition-opacity border border-gg-gray-700"
                              style={{ maxHeight: '150px' }}
                              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                            />
                            <span className="text-[10px] text-gg-gray-500 mt-1 block">Property Photo</span>
                          </button>
                        )}
                        {/* Map image if available */}
                        {mapImageBase64 && (
                          <button
                            onClick={() => setScreenshotModal(`data:image/png;base64,${mapImageBase64}`)}
                            className="block"
                            title="Click to enlarge map"
                          >
                            <img
                              src={`data:image/png;base64,${mapImageBase64}`}
                              alt="Tract map"
                              className="w-full max-w-[200px] rounded-lg object-contain cursor-pointer hover:opacity-80 transition-opacity border border-gg-gray-700"
                              style={{ maxHeight: '150px' }}
                            />
                            <span className="text-[10px] text-gg-gray-500 mt-1 block">Tract Map</span>
                          </button>
                        )}
                        {/* Inline polygon mini-map from scraped_data if no map_image_base64 */}
                        {!mapImageBase64 && info.tracts.some((t: any) => t.polygon_coordinates) && (
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
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(listing.source_url)
                              setCopiedId(listing.id)
                              setTimeout(() => setCopiedId((prev) => prev === listing.id ? null : prev), 2000)
                            }}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm text-gg-gray-400 hover:text-white bg-gg-gray-800 hover:bg-gg-gray-700 rounded-lg transition-colors"
                          >
                            {copiedId === listing.id ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
                            {copiedId === listing.id ? 'Copied!' : 'Copy URL'}
                          </button>
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
                                      <span>{tract.county.county_name}{(tract.state_full || tract.state) ? `, ${tract.state_full || tract.state}` : ''}</span>
                                    )}
                                    {tract.latitude != null && tract.longitude != null && (
                                      <span className="flex items-center gap-0.5">
                                        <Navigation size={10} />
                                        {Number(tract.latitude).toFixed(4)}, {Number(tract.longitude).toFixed(4)}
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
                        {entry.created_at && (
                          <span className="text-xs text-gg-gray-500">{formatTimeAgo(entry.created_at)}</span>
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
                        <span>New URLs: {entry.new_urls}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Scraper Results Tab */}
        {activeTab === 'results' && (
          <div>
            {runLogLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="animate-spin text-gg-pink" size={32} />
              </div>
            ) : latestRunResults.runs.length === 0 ? (
              <div className="card text-center py-16">
                <BarChart3 className="mx-auto mb-4 text-gg-gray-500" size={48} />
                <h2 className="text-xl font-bold text-white mb-2">No scraper results yet</h2>
                <p className="text-gg-gray-400">Run the nightly scraper to see per-company discovery results.</p>
              </div>
            ) : (
              <>
                {/* Run timestamp */}
                {latestRunResults.runTime && (
                  <div className="flex items-center gap-2 mb-4 text-sm text-gg-gray-400">
                    <Clock size={14} />
                    <span>Latest run: {formatTimeAgo(latestRunResults.runTime)}</span>
                    <span className="text-gg-gray-600">·</span>
                    <span>{latestRunResults.runs.length} companies checked</span>
                  </div>
                )}

                {/* Summary stats */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-white">{latestRunResults.runs.length}</div>
                    <div className="text-xs text-gg-gray-400 mt-1">Companies</div>
                  </div>
                  <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-white">{latestRunResults.runs.reduce((s, r) => s + r.cards_found, 0)}</div>
                    <div className="text-xs text-gg-gray-400 mt-1">Cards Found</div>
                  </div>
                  <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-white">{latestRunResults.runs.reduce((s, r) => s + r.new_urls, 0)}</div>
                    <div className="text-xs text-gg-gray-400 mt-1">New URLs</div>
                  </div>
                  <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-white">{latestRunResults.runs.reduce((s, r) => s + r.listings_staged, 0)}</div>
                    <div className="text-xs text-gg-gray-400 mt-1">Listings Staged</div>
                  </div>
                </div>

                {/* Per-company table */}
                <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gg-gray-800">
                        <th className="text-left px-4 py-3 text-gg-gray-400 font-medium">Company</th>
                        <th className="text-left px-4 py-3 text-gg-gray-400 font-medium">Method</th>
                        <th className="text-right px-4 py-3 text-gg-gray-400 font-medium">Cards</th>
                        <th className="text-right px-4 py-3 text-gg-gray-400 font-medium">Filtered</th>
                        <th className="text-right px-4 py-3 text-gg-gray-400 font-medium">New</th>
                        <th className="text-right px-4 py-3 text-gg-gray-400 font-medium">Scraped</th>
                        <th className="text-right px-4 py-3 text-gg-gray-400 font-medium">Staged</th>
                        <th className="text-center px-4 py-3 text-gg-gray-400 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestRunResults.runs.map((run, idx) => (
                        <tr
                          key={idx}
                          className={`border-b border-gg-gray-800/50 ${
                            run.company_name === 'Whitetail Properties' ? 'bg-gg-pink/5' : ''
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="text-white font-medium">{run.company_name}</div>
                            {run.auction_list_url && (
                              <a
                                href={run.auction_list_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-gg-gray-500 hover:text-gg-pink truncate block max-w-[250px]"
                              >
                                {run.auction_list_url.replace(/^https?:\/\//, '').split('/')[0]}
                              </a>
                            )}
                          </td>
                          <td className="px-4 py-3 text-gg-gray-400 text-xs">{run.discovery_method || '—'}</td>
                          <td className="px-4 py-3 text-right text-white">{run.cards_found}</td>
                          <td className="px-4 py-3 text-right text-gg-gray-400">{run.cards_after_filter}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={run.new_urls > 0 ? 'text-green-400 font-medium' : 'text-gg-gray-500'}>
                              {run.new_urls}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gg-gray-400">{run.urls_scraped || '—'}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={run.listings_staged > 0 ? 'text-green-400 font-medium' : 'text-gg-gray-500'}>
                              {run.listings_staged || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${
                              run.status === 'success' ? 'bg-green-500/20 text-green-400' :
                              run.status === 'failed' ? 'bg-red-500/20 text-red-400' :
                              run.status === 'no_new_urls' ? 'bg-gg-gray-700 text-gg-gray-400' :
                              run.status === 'no_cards_after_filter' ? 'bg-amber-500/20 text-amber-400' :
                              'bg-gg-gray-700 text-gg-gray-400'
                            }`}>
                              {run.status === 'no_new_urls' ? 'no new' :
                               run.status === 'no_cards_after_filter' ? 'filtered out' :
                               run.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Error details */}
                {latestRunResults.runs.some((r) => r.error_message) && (
                  <div className="mt-4 space-y-2">
                    <h3 className="text-sm font-semibold text-white">Errors</h3>
                    {latestRunResults.runs.filter((r) => r.error_message).map((run, idx) => (
                      <div key={idx} className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                        <span className="text-sm text-red-400 font-medium">{run.company_name}:</span>
                        <span className="text-sm text-red-400/80 ml-2 font-mono">{run.error_message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
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
                <label className="block text-sm text-gg-gray-400 mb-1">Auction / Bidding URL</label>
                <input
                  type="url"
                  placeholder="https://bidwrangler.com/... or https://hibid.com/..."
                  value={editForm.auction_url}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, auction_url: e.target.value }))}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-gg-gray-400 mb-1">Listing Image URL</label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={editForm.image_url}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, image_url: e.target.value }))}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                />
                {editForm.image_url && (
                  <img
                    src={editForm.image_url}
                    alt="Preview"
                    className="mt-2 max-h-24 rounded-lg border border-gg-gray-700 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                )}
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
                        <div>
                          <label className="block text-xs text-gg-gray-400 mb-1">Latitude</label>
                          <input
                            type="number"
                            step="0.000001"
                            placeholder="e.g. 41.8781"
                            value={tract.latitude}
                            onChange={(e) => updateTract(idx, 'latitude', e.target.value)}
                            className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gg-gray-400 mb-1">Longitude</label>
                          <input
                            type="number"
                            step="0.000001"
                            placeholder="e.g. -87.6298"
                            value={tract.longitude}
                            onChange={(e) => updateTract(idx, 'longitude', e.target.value)}
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
