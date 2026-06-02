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
  DollarSign,
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
  Play,
  Link2,
  Check
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import TractMapEditor from '@/components/admin/TractMapEditor'
import TillableCluWorkshop from '@/components/admin/TillableCluWorkshop'
import TractDataCompare from '@/components/admin/TractDataCompare'
import { polygonAcres, polygonPerimeterFeet, formatPerimeter } from '@/lib/polygonGeometry'

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
  asking_price: string
  auction_url: string
  image_url: string
  description: string
  tracts: TractForm[]
}

function buildEditForm(scraped: any): EditForm {
  const listing = scraped?.listing || {}
  const tracts = scraped?.tracts || []

  return {
    acres_listed: listing.acres_listed != null ? String(listing.acres_listed) : '',
    asking_price: listing.sale_price != null ? String(listing.sale_price) : (listing.asking_price != null ? String(listing.asking_price) : ''),
    auction_url: listing.auction_url || listing.listing_url || '',
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
  updated.listing.sale_price = form.asking_price ? parseFloat(form.asking_price) : null
  updated.listing.asking_price = form.asking_price ? parseFloat(form.asking_price) : null
  updated.listing.description = form.description || null
  updated.listing.auction_url = form.auction_url || null
  updated.listing.listing_url = form.auction_url || null
  updated.listing.image = form.image_url || null
  updated.listing.primary_image_url = form.image_url || null

  // No auction datetime for private treaty
  updated.listing.auction_time = null
  updated.listing.auction_datetime = null
  updated.listing.listing_type = 'private_treaty'

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

export default function AdminPrivateTreatyStagingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [listings, setListings] = useState<StagingListing[]>([])
  const [screenshotModal, setScreenshotModal] = useState<string | null>(null)
  // PT pending stagings have ballooned to 200+ rows with ~100MB+ of
  // scraped_data total. Without pagination the page was downloading
  // the entire payload on every load and either timing out or running
  // the browser out of memory before render. Page through the same way
  // /admin/staging does for auctions.
  const PAGE_SIZE = 20
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // Tract image lazy-load cache. Mirrors the auction-staging
  // implementation — tract_image_base64 isn't included in the staging
  // list response (too heavy) and is fetched per-tract via
  // /api/admin/staging/{id}/tract-image/{idx} when the user expands a
  // card.
  const [tractImageCache, setTractImageCache] = useState<Record<string, string | null>>({})
  const [loadingTractImage, setLoadingTractImage] = useState<string | null>(null)

  // Per-tract CLU-workshop reload counter — bumped on boundary save so the
  // TillableCluWorkshop re-fetches CLUs against the new polygon.
  const [cluReloadKeys, setCluReloadKeys] = useState<Record<string, number>>({})

  // Tillable polygon visibility per `${listingId}-${tractIdx}`. Per user
  // 2026-05-25: show tract polygon by default, tillable only when the
  // user clicks Show Tillable on the per-tract map. Lifted to page
  // level so each tract toggles independently without re-mounting
  // the whole list.
  // Inverted set — tracks which tracts have tillable HIDDEN.
  // Default: tillable is SHOWN whenever tract.tillable_polygon exists.
  const [tillableHidden, setTillableHidden] = useState<Set<string>>(new Set())
  const toggleTillable = (key: string, next: boolean) => {
    setTillableHidden(prev => {
      const s = new Set(prev)
      if (next) s.delete(key); else s.add(key)
      return s
    })
  }

  // Source-image cache per listingId. Lazy-fetched from
  // /api/admin/staging/{id}/source-image. Keyed by listing because
  // a multi-tract listing shares ONE source image (Land ID map shows
  // all tracts). undefined = not yet requested; null = requested,
  // none available; { ... } = loaded successfully.
  const [sourceImageCache, setSourceImageCache] = useState<Record<number, {
    base64: string | null
    url: string | null
    kind: string | null
  } | null>>({})
  const loadSourceImage = async (listingId: number) => {
    if (sourceImageCache[listingId] !== undefined) return
    // Mark as in-flight (null) so we don't double-fetch on re-renders
    setSourceImageCache(prev => ({ ...prev, [listingId]: null }))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listingId}/source-image`)
      if (res.ok) {
        const data = await res.json()
        setSourceImageCache(prev => ({
          ...prev,
          [listingId]: {
            base64: data.source_image_base64 || null,
            url: data.source_image_url || null,
            kind: data.source_image_kind || null,
          },
        }))
      }
    } catch (err) {
      console.error('Failed to load source image:', err)
    }
  }

  // Company filter
  const [companyFilter, setCompanyFilter] = useState<string>('all')

  // Tab state
  const [activeTab, setActiveTab] = useState<'staging' | 'results'>('staging')

  // Run log
  const [runLog, setRunLog] = useState<RunLogEntry[]>([])
  const [runLogLoading, setRunLogLoading] = useState(false)

  // Action state
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  // Edit modal state
  const [editingListing, setEditingListing] = useState<StagingListing | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ acres_listed: '', asking_price: '', auction_url: '', image_url: '', description: '', tracts: [] })
  const [saving, setSaving] = useState(false)

  // Inline price editing on the Price card. Lets the admin fix a missing
  // / wrong scraped price without opening the full edit modal.
  const [priceEditId, setPriceEditId] = useState<number | null>(null)
  const [priceEditValue, setPriceEditValue] = useState('')
  const [priceSaving, setPriceSaving] = useState(false)

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

  // Single URL scrape (paste a direct PT listing URL)
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scrapingUrl, setScrapingUrl] = useState(false)
  const [scrapeUrlResult, setScrapeUrlResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${SCRAPER_URL}/api/scraper/private-treaty/status`)
        if (res.ok) {
          const data = await res.json()
          setScraperStatus(data)
          // Auto-refresh listings when scraper transitions from running -> complete
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
      const res = await fetch(`${SCRAPER_URL}/api/scraper/private-treaty/stop`, { method: 'POST' })
      if (res.ok) {
        // Status will update via the polling interval
      }
    } catch (err) {
      console.error('Failed to stop scraper:', err)
    } finally {
      setStoppingScraper(false)
    }
  }

  const scrapeSingleUrl = async () => {
    if (!scrapeUrl.trim()) return
    setScrapingUrl(true)
    setScrapeUrlResult(null)
    try {
      // Async by default: the scraper runs the 30-60s scrape on a background
      // thread and returns a job_id immediately. We poll for completion so
      // the long request never trips the browser/edge timeout ("Failed to
      // fetch"). The server still finishes even if this tab closes.
      const res = await fetch(`${SCRAPER_URL}/api/scraper/scrape-single-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: scrapeUrl.trim(),
          listing_type: 'private_treaty',
          force: true,
          async: true,
        }),
      })
      const data = await res.json()

      const applyResult = (d: any) => {
        if (d.success && d.staging_id) {
          setScrapeUrlResult({
            success: true,
            message: `Staged (${d.company_name || 'Unknown company'}, ${Math.round((d.scrape_duration_ms || 0) / 1000)}s)`,
          })
          setScrapeUrl('')
          fetchStagingListings()
        } else {
          setScrapeUrlResult({ success: false, message: d.error || 'Scraping failed' })
        }
      }

      // Sync fallback (async=false or older server): result is inline.
      if (!data.job_id) {
        applyResult(data)
        return
      }

      // Poll the status endpoint until the job finishes. Scrapes can take 5+
      // minutes (slow auction sites, polygon enrichment), so allow up to 12 min
      // and surface the live step-by-step stage the scraper reports.
      const jobId = data.job_id
      setScrapeUrlResult({ success: true, message: 'Starting… (step 0/5)' })
      const started = Date.now()
      while (Date.now() - started < 720_000) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          const sres = await fetch(`${SCRAPER_URL}/api/scraper/scrape-single-url/status/${jobId}`)
          const sdata = await sres.json()
          if (sdata.status === 'running') {
            const p = sdata.progress
            const el = sdata.elapsed_s != null ? ` · ${sdata.elapsed_s}s elapsed` : ''
            if (p && p.label) {
              setScrapeUrlResult({ success: true, message: `${p.label} (step ${p.step}/${p.total})${el}` })
            }
            continue
          }
          applyResult(sdata)
          return
        } catch {
          // transient network blip while polling — keep trying until timeout
        }
      }
      setScrapeUrlResult({ success: false, message: 'Still running after 12 min — hit Refresh; it may have finished.' })
    } catch (err: any) {
      setScrapeUrlResult({ success: false, message: err.message || 'Network error' })
    } finally {
      setScrapingUrl(false)
    }
  }

  const runScraper = async () => {
    setStartingScraper(true)
    try {
      const res = await fetch(`${SCRAPER_URL}/api/nightly/scrape-private-treaty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ async: true }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        console.error('Failed to start PT scraper:', data.message || res.statusText)
      }
      // Status banner will update via the polling interval
    } catch (err) {
      console.error('Failed to start PT scraper:', err)
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

  const fetchStagingListings = async (pageNum?: number) => {
    setLoading(true)
    setFetchError(null)
    const offset = (pageNum ?? page) * PAGE_SIZE
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging?status=pending&listing_type=private_treaty&limit=${PAGE_SIZE}&offset=${offset}`)
      if (response.ok) {
        const data = await response.json()
        if (data && Array.isArray(data.items)) {
          setListings(data.items)
          setTotalCount(data.total || data.items.length)
        } else if (Array.isArray(data)) {
          // Legacy non-paginated response — keep it working but don't
          // try to render hundreds of rows.
          setListings(data.slice(0, PAGE_SIZE))
          setTotalCount(data.length)
        } else {
          setListings([])
          setTotalCount(0)
        }
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

  // Lazy-load a single tract's satellite image. Mirrors the
  // auction-staging implementation. tract_image_base64 isn't
  // included in the staging list response (heavy payload) — fetch
  // on-demand when the user expands a card.
  const loadTractImage = async (listingId: number, tractIndex: number) => {
    const key = `${listingId}-${tractIndex}`
    if (tractImageCache[key] !== undefined) return // already loaded/loading
    setLoadingTractImage(key)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/${listingId}/tract-image/${tractIndex}`)
      if (response.ok) {
        const data = await response.json()
        setTractImageCache(prev => ({ ...prev, [key]: data.tract_image_base64 }))
      }
    } catch (err) {
      console.error('Failed to load tract image:', err)
    } finally {
      setLoadingTractImage(null)
    }
  }

  const fetchRunLog = async () => {
    setRunLogLoading(true)
    try {
      const [discRes, scrapeRes] = await Promise.all([
        fetch(`${SCRAPER_URL}/api/scraper-run-log?limit=500&run_type=pt_discovery`),
        fetch(`${SCRAPER_URL}/api/scraper-run-log?limit=500&run_type=pt_scrape`),
      ])
      const allEntries: RunLogEntry[] = []
      for (const res of [discRes, scrapeRes]) {
        if (res.ok) {
          const data = await res.json()
          const entries = data?.entries || (Array.isArray(data) ? data : [])
          allEntries.push(...entries)
        }
      }
      // Sort by created_at descending
      allEntries.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
      setRunLog(allEntries)
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

  // Group latest run results by company for the Scraper Results tab
  const latestRunResults = useMemo(() => {
    if (runLog.length === 0) return { runs: [], runTime: null as string | null }

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
    const item = listings.find((l) => l.id === id)
    const isRescrape = !!item?.scraped_data?.rescrape_listing_id
    const verifyUrl = isRescrape
      ? `${API_URL}/api/admin/staging/${id}/verify-rescrape`
      : `${API_URL}/api/admin/staging/${id}/verify`
    try {
      const response = await fetchWithAuth(verifyUrl, {
        method: 'POST',
      })
      if (response.ok) {
        setListings((prev) => prev.filter((l) => l.id !== id))
        showToast('success', isRescrape ? 'Tracts updated with new data' : 'Listing verified and created successfully')
      } else {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }))
        const detail = err.detail
        showToast('error', (typeof detail === 'string' ? detail : detail?.message) || err.error || 'Failed to verify listing')
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
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/clear-all?listing_type=private_treaty`, {
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

  const startPriceEdit = (listing: StagingListing, current: number | string | null) => {
    setPriceEditId(listing.id)
    setPriceEditValue(current != null ? String(current) : '')
  }

  const cancelPriceEdit = () => {
    setPriceEditId(null)
    setPriceEditValue('')
  }

  const savePriceEdit = async (listing: StagingListing) => {
    setPriceSaving(true)
    const raw = priceEditValue.replace(/[$,\s]/g, '')
    const num = raw ? parseFloat(raw) : null
    if (raw && (num == null || isNaN(num))) {
      showToast('error', 'Enter a valid price')
      setPriceSaving(false)
      return
    }
    const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
    if (!updated.listing) updated.listing = {}
    updated.listing.sale_price = num
    updated.listing.asking_price = num
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraped_data: updated }),
      })
      if (res.ok) {
        setListings((prev) =>
          prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l))
        )
        setPriceEditId(null)
        setPriceEditValue('')
        showToast('success', 'Price updated')
      } else {
        const err = await res.json().catch(() => ({}))
        showToast('error', err.detail || 'Failed to update price')
      }
    } catch (err) {
      showToast('error', 'Network error — failed to update price')
    } finally {
      setPriceSaving(false)
    }
  }

  // Persist the per-tract "has buildings" checkbox. Verify POSTs with no
  // body, so per-tract edits must be PATCHed into scraped_data here (same
  // pattern as the inline price edit). Updates local state optimistically.
  const saveTractHasBuilding = async (listing: StagingListing, idx: number, next: boolean) => {
    const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
    if (!Array.isArray(updated.tracts)) updated.tracts = []
    if (!updated.tracts[idx]) updated.tracts[idx] = {}
    updated.tracts[idx].has_building = next
    setListings((prev) =>
      prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l))
    )
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraped_data: updated }),
      })
      if (!res.ok) showToast('error', 'Failed to save buildings flag')
    } catch {
      showToast('error', 'Network error — failed to save buildings flag')
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
          auction_date: null, // No auction date for private treaty
        }),
      })

      if (response.ok) {
        setListings((prev) =>
          prev.map((l) =>
            l.id === editingListing.id
              ? { ...l, scraped_data: updatedScrapedData, auction_date: null }
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
    if (!scraped) return { acres: null, county: null, state: null, description: null, tractCount: 0, tracts: [], askingPrice: null, imageUrl: null }
    const listing = scraped.listing || {}
    const tracts = scraped.tracts || []
    const firstTract = tracts[0] || {}

    // Extract asking price
    const askingPrice = listing.sale_price || listing.asking_price || null

    // Extract listing image URL
    const imageUrl = listing.image || listing.primary_image_url || null

    return {
      acres: listing.acres_listed || null,
      // Per user 2026-05-25 location regression: previous code read
      // `firstTract.county?.county_name` which only worked if a county
      // object was nested. Halderman (and most scrapers) put county
      // as a flat string at `firstTract.county_name` OR at
      // `listing.county` (after server-side derivation in
      // scrape_single_url). Check both flat fields with sensible
      // fallback chain.
      county: listing.county || firstTract.county_name || firstTract.county || null,
      state: listing.state_full || firstTract.state_full || firstTract.state_abbr || firstTract.state || listing.state || null,
      description: listing.description || null,
      tractCount: tracts.length,
      tracts: tracts,
      askingPrice,
      imageUrl,
    }
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'N/A'
    try {
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

  const formatPrice = (price: number | string | null) => {
    if (price == null) return 'N/A'
    const num = typeof price === 'string' ? parseFloat(price) : price
    if (isNaN(num)) return 'N/A'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num)
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

  // Per user 2026-05-24 incident: spinner stuck forever when fetch
  // hangs or returns an error before checkAuth completes. Show the
  // error inline + a retry button INSIDE the loading screen so the
  // user is never stranded with just a spinner. fetchError is set
  // by the catch/else branches of fetchStagingListings — if loading
  // is still true AND fetchError is set, something errored on the
  // first attempt and the user needs an out.
  if (loading) {
    return (
      <div className="staging-light min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          {fetchError ? (
            <>
              <p className="text-red-400 mb-3">Failed to load: {fetchError}</p>
              <button
                onClick={() => { setLoading(false); fetchStagingListings(); fetchRunLog() }}
                className="px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 text-sm"
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <Loader2 className="animate-spin text-gg-pink mx-auto mb-4" size={32} />
              <p className="text-gg-gray-400 text-sm">Loading private treaty staging...</p>
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    // `staging-light` (defined in globals.css) flips the dark gg-* tokens
    // used throughout this page to a light theme — easier to read during
    // data review. Brand accents (pink, gold) stay the same.
    <div className="staging-light min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white transition-colors">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Private Treaty Staging</h1>
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
                  Run PT Scraper
                </>
              )}
            </button>
            <button
              onClick={() => { fetchStagingListings(); fetchRunLog() }}
              className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 transition-colors text-sm"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Pagination — same UX as auction staging. Mandatory because
            PT pending list has 200+ rows and ~100MB+ of scraped_data
            and was timing out without it. */}
        {totalCount > PAGE_SIZE && (
          <div className="mb-4 flex items-center justify-between bg-gg-gray-900 border border-gg-gray-800 rounded-lg px-4 py-2 text-sm">
            <span className="text-gg-gray-300">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { const next = Math.max(0, page - 1); setPage(next); fetchStagingListings(next) }}
                disabled={page === 0 || loading}
                className="px-3 py-1 bg-gg-gray-800 text-white rounded hover:bg-gg-gray-700 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-gg-gray-400">Page {page + 1} of {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}</span>
              <button
                onClick={() => { const next = page + 1; if (next * PAGE_SIZE < totalCount) { setPage(next); fetchStagingListings(next) } }}
                disabled={(page + 1) * PAGE_SIZE >= totalCount || loading}
                className="px-3 py-1 bg-gg-gray-800 text-white rounded hover:bg-gg-gray-700 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Single PT URL Scrape — paste a direct PT listing URL to scrape just that one page */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex-1 relative">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-500" size={16} />
            <input
              type="text"
              value={scrapeUrl}
              onChange={(e) => { setScrapeUrl(e.target.value); setScrapeUrlResult(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && scrapeUrl.trim() && !scrapingUrl) scrapeSingleUrl() }}
              placeholder="Paste private treaty URL to scrape..."
              className="w-full pl-10 pr-4 py-2.5 bg-gg-gray-800 border border-gg-gray-700 rounded-lg text-white text-sm placeholder-gg-gray-500 focus:outline-none focus:border-gg-pink/50 transition-colors"
              disabled={scrapingUrl}
            />
          </div>
          <button
            onClick={scrapeSingleUrl}
            disabled={!scrapeUrl.trim() || scrapingUrl}
            className="px-5 py-2.5 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex items-center gap-2 shrink-0"
          >
            {scrapingUrl ? (
              <>
                <Loader2 className="animate-spin" size={16} />
                Scraping...
              </>
            ) : (
              <>
                <Play size={16} />
                Scrape URL
              </>
            )}
          </button>
        </div>
        {scrapeUrlResult && (
          <div className={`mb-4 rounded-lg px-4 py-2.5 text-sm flex items-center gap-2 ${
            scrapeUrlResult.success
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-red-500/10 border border-red-500/30 text-red-400'
          }`}>
            {scrapeUrlResult.success ? <CheckCircle size={16} /> : <XCircle size={16} />}
            {scrapeUrlResult.message}
          </div>
        )}

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
                    <span className="font-semibold">PT Scraper Running</span>
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
                      {scraperStatus.phase === 'discovery' ? 'Discovering listings...' : scraperStatus.phase === 'scraping' ? 'Scraping listings...' : 'PT Scraper is running'}
                    </h2>
                    {scraperStatus.phase === 'discovery' ? (
                      <div className="text-gg-gray-400 mb-1">
                        <p>Checking companies for new private treaty listings ({scraperStatus.companies_checked}/{scraperStatus.companies_total})</p>
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
                    <p className="text-gg-gray-400">No pending private treaty listings to review. Run the PT scraper to discover new listings.</p>
                  </>
                )}
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
                    <div className="flex flex-col">
                      {/* Per user 2026-06-01: removed the left thumbnail column
                          (page screenshot + property photo + tract map) — wasted
                          space. The interactive tract map below is the working
                          reference now. */}

                      {/* Content */}
                      <div className="flex-1 p-6">
                        {/* Company & Info Row */}
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            <h3 className="text-lg font-bold text-white">
                              {listing.company_name || 'Unknown Company'}
                            </h3>
                            <div className="flex items-center gap-4 mt-1 text-sm text-gg-gray-400">
                              <span>Staged {formatDate(listing.created_at)}</span>
                              {listing.scrape_duration_ms != null && (
                                <>
                                  <span className="text-gg-gray-600">|</span>
                                  <span className="text-gg-gray-500">Scraped in {formatDuration(listing.scrape_duration_ms)}</span>
                                </>
                              )}
                            </div>
                          </div>
                          {/* Per user 2026-05-26: Source + Copy URL
                              grouped together so they read as one
                              button bar; Source is solid pink for
                              visibility against the light staging-page
                              background. Mirror of auction-staging
                              layout. */}
                          <div className="flex items-center gap-2">
                            <a
                              href={listing.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold text-white bg-gg-pink hover:bg-gg-pink-light rounded-lg transition-colors shadow-sm"
                              title="Open the auctioneer's listing page in a new tab"
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
                              title="Copy the source URL to clipboard"
                            >
                              {copiedId === listing.id ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
                              {copiedId === listing.id ? 'Copied!' : 'Copy URL'}
                            </button>
                          </div>
                        </div>

                        {/* Per-listing polygon sum — used to surface
                            scraped-vs-drawn acres discrepancy in the
                            Acres card. Per user 2026-05-25: "I would
                            just like the discrepancy shown at the
                            listing level." Don't auto-scale polygons;
                            just show both numbers + delta so admin can
                            spot listings where the drawn boundaries
                            don't agree with what the auctioneer
                            published. */}
                        {(() => {
                          // Sum each tract's polygon area (acres).
                          // Skip tracts without a drawn polygon.
                          const polySumAc = (info.tracts || []).reduce((sum: number, t: any) => {
                            const p = t?.polygon_coordinates
                            return Array.isArray(p) && p.length >= 3
                              ? sum + polygonAcres(p)
                              : sum
                          }, 0)
                          const scrapedAc = typeof info.acres === 'number'
                            ? info.acres
                            : parseFloat(info.acres)
                          const delta = (isFinite(scrapedAc) && polySumAc > 0)
                            ? polySumAc - scrapedAc
                            : null
                          const deltaPct = (delta != null && scrapedAc > 0)
                            ? (delta / scrapedAc) * 100
                            : null
                          // Stash on info so the Acres card below can render
                          ;(info as any).__polySumAc = polySumAc
                          ;(info as any).__acresDelta = delta
                          ;(info as any).__acresDeltaPct = deltaPct
                          return null
                        })()}

                        {/* Key Data */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                          <div className="bg-gg-gray-800 rounded-lg p-3">
                            <p className="text-xs text-gg-gray-400 mb-1">Acres</p>
                            <p className="text-white font-semibold">
                              {info.acres ? `${info.acres}` : 'N/A'}
                            </p>
                            {(info as any).__polySumAc > 0 && (info as any).__acresDelta != null && (
                              <p className="text-[11px] mt-0.5 text-gray-700">
                                Drawn: {(info as any).__polySumAc.toFixed(2)} ac
                                {' · '}
                                {/* deltaPct is null whenever scrapedAc isn't a
                                    positive number (e.g. listing.acres_listed
                                    arrived as "0", "-5", or any string that
                                    parseFloat coerces to ≤ 0). Previously this
                                    block called .toFixed(1) on the null and
                                    crashed the entire admin page with
                                    "Application error: a client-side exception
                                    has occurred." Guard each accessor
                                    independently so the absolute delta still
                                    renders without a percent. */}
                                <span className={(info as any).__acresDeltaPct != null && Math.abs((info as any).__acresDeltaPct) > 5 ? 'font-semibold' : ''}>
                                  {(info as any).__acresDelta >= 0 ? '+' : ''}{(info as any).__acresDelta.toFixed(2)}
                                  {(info as any).__acresDeltaPct != null && (
                                    <>
                                      {' ('}{(info as any).__acresDeltaPct >= 0 ? '+' : ''}{(info as any).__acresDeltaPct.toFixed(1)}%)
                                    </>
                                  )}
                                </span>
                              </p>
                            )}
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
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-xs text-gg-gray-400">Asking Price</p>
                              {priceEditId !== listing.id && (
                                <button
                                  onClick={() => startPriceEdit(listing, info.askingPrice)}
                                  className="text-gg-gray-500 hover:text-white transition-colors"
                                  title="Edit price"
                                >
                                  <Pencil size={12} />
                                </button>
                              )}
                            </div>
                            {priceEditId === listing.id ? (
                              <div className="flex items-center gap-1">
                                <DollarSign size={12} className="text-green-400 shrink-0" />
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  autoFocus
                                  value={priceEditValue}
                                  onChange={(e) => setPriceEditValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') savePriceEdit(listing)
                                    if (e.key === 'Escape') cancelPriceEdit()
                                  }}
                                  placeholder="Price"
                                  className="w-full bg-gg-gray-900 border border-gg-gray-600 rounded px-1.5 py-0.5 text-sm text-white focus:outline-none focus:border-green-500"
                                />
                                <button
                                  onClick={() => savePriceEdit(listing)}
                                  disabled={priceSaving}
                                  className="text-green-400 hover:text-green-300 disabled:opacity-50 shrink-0"
                                  title="Save price"
                                >
                                  {priceSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                </button>
                                <button
                                  onClick={cancelPriceEdit}
                                  disabled={priceSaving}
                                  className="text-gg-gray-500 hover:text-white disabled:opacity-50 shrink-0"
                                  title="Cancel"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            ) : (
                              <p className="text-white font-semibold flex items-center gap-1">
                                <DollarSign size={12} className="text-green-400" />
                                {formatPrice(info.askingPrice)}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Tract Details — each tract is a vertical block:
                            map+image header on top (magic-lab pattern),
                            charcoal details box below. Single-column because
                            each tract has a 320px-high map header. */}
                        {info.tracts.length > 0 && (
                          <div className="mb-4">
                            <p className="text-xs text-gg-gray-400 mb-2 font-medium uppercase tracking-wider">Tract Details</p>
                            <div className="space-y-4">
                              {info.tracts.map((tract: any, idx: number) => {
                                const tractKey = `${listing.id}-${idx}`
                                const showTill = tract.tillable_polygon != null && !tillableHidden.has(tractKey)
                                // Kick off source-image fetch on first
                                // render of any tract for this listing.
                                // Cheap: dedup'd inside loadSourceImage.
                                const listingHasSourceImage = (listing.scraped_data?.listing as any)?.has_source_image
                                const inlineSourceUrl = (listing.scraped_data?.listing as any)?.source_image_url
                                const inlineSourceKind = (listing.scraped_data?.listing as any)?.source_image_kind
                                if (listingHasSourceImage && sourceImageCache[listing.id] === undefined) {
                                  // schedule for after render
                                  setTimeout(() => loadSourceImage(listing.id), 0)
                                }
                                // Auto-load tract satellite image when available
                                if (tract.has_tract_image && tractImageCache[tractKey] === undefined) {
                                  setTimeout(() => loadTractImage(listing.id, idx), 0)
                                }
                                const cachedSrc = sourceImageCache[listing.id]
                                return (
                                <div key={idx}>
                                  {/* View on Map — opens the Explore portal map
                                      in a new tab, zoomed to this tract. */}
                                  {(() => {
                                    const ring = Array.isArray(tract.polygon_coordinates) ? tract.polygon_coordinates : null
                                    let fLat: number | null = null
                                    let fLng: number | null = null
                                    if (ring && ring.length) {
                                      let sx = 0, sy = 0, n = 0
                                      for (const p of ring) {
                                        if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
                                          sx += p[0]; sy += p[1]; n++
                                        }
                                      }
                                      if (n) { fLng = sx / n; fLat = sy / n }
                                    }
                                    if (fLat == null || fLng == null) {
                                      fLat = tract.latitude ?? listing.scraped_data?.listing?.latitude ?? null
                                      fLng = tract.longitude ?? listing.scraped_data?.listing?.longitude ?? null
                                    }
                                    const disabled = fLat == null || fLng == null
                                    return (
                                      <div className="flex items-center justify-between mb-2">
                                        <p className="text-2xl text-white font-extrabold tracking-tight">
                                          Tract {tract.tract_number ?? idx + 1}
                                        </p>
                                        <button
                                          type="button"
                                          disabled={disabled}
                                          title={disabled ? 'No location available for this tract' : 'Open this tract on the Explore map'}
                                          onClick={() => {
                                            const params = new URLSearchParams({
                                              focusLat: String(fLat),
                                              focusLng: String(fLng),
                                              focusZoom: '15',
                                            })
                                            window.open(`/access?${params.toString()}`, '_blank')
                                          }}
                                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                                            disabled
                                              ? 'bg-gg-gray-800 text-gg-gray-600 cursor-not-allowed'
                                              : 'bg-gg-pink text-white hover:bg-gg-pink-light shadow-sm'
                                          }`}
                                        >
                                          <MapPin size={13} /> View on Map
                                        </button>
                                      </div>
                                    )
                                  })()}
                                  {/* Map (~60%) + tract image (~40%) header.
                                      Lazy-mounts MapLibre on first visibility. */}
                                  <TractMapEditor
                                    stagingId={listing.id}
                                    tractIndex={idx}
                                    // Upload Image → multi-tract Surety overview
                                    // extraction: pass this tract's number + the
                                    // listing's full tract list so the backend
                                    // returns the correct traced polygon.
                                    tractNumber={tract.tract_number ?? (idx + 1)}
                                    siblingTracts={((listing.scraped_data?.tracts as any[]) || []).map((t: any, i: number) => ({
                                      tract_number: t.tract_number ?? (i + 1),
                                      total_acres: t.scraped?.acres ?? t.acres ?? null,
                                      tillable_acres: t.tillable_acres ?? null,
                                    }))}
                                    initialPolygon={Array.isArray(tract.polygon_coordinates) ? tract.polygon_coordinates : null}
                                    // FSA-CLU rescope: tillable is owned by the
                                    // TillableCluWorkshop below. The map editor is
                                    // tract-boundary-only — no old green overlay,
                                    // no Draw/Auto Tillable buttons.
                                    hideTillable
                                    tillablePolygon={null}
                                    showTillable={false}
                                    tractImageBase64={tract.tract_image_base64 || tractImageCache[`${listing.id}-${idx}`] || null}
                                    sourceImageBase64={cachedSrc?.base64 || null}
                                    sourceImageUrl={cachedSrc?.url || inlineSourceUrl || null}
                                    sourceImageKind={cachedSrc?.kind || inlineSourceKind || null}
                                    listingUrl={listing.source_url || null}
                                    listingState={listing.scraped_data?.listing?.state || null}
                                    // Per user 2026-05-26: Align button +
                                    // live Computed update on edit (same
                                    // wiring as auction staging).
                                    scrapedAcres={tract.scraped?.acres ?? tract.acres ?? null}
                                    // Per user 2026-05-25: when no polygon
                                    // exists, the map was always defaulting
                                    // to Iowa (-93.5, 41.9). Fall through to
                                    // listing-level latitude/longitude so the
                                    // map at least centers on the right area
                                    // for manual drawing.
                                    latitude={tract.latitude ?? listing.scraped_data?.listing?.latitude ?? null}
                                    longitude={tract.longitude ?? listing.scraped_data?.listing?.longitude ?? null}
                                    onPolygonChange={(_pts, gisAcres) => {
                                      setListings(prev => prev.map(l => {
                                        if (l.id !== listing.id) return l
                                        const sd = { ...(l.scraped_data || {}) }
                                        const ts = [...((sd.tracts as any[]) || [])]
                                        const cur = ts[idx] || {}
                                        const comp = { ...(cur.computed || {}), acres: gisAcres > 0 ? gisAcres : null }
                                        ts[idx] = { ...cur, computed: comp }
                                        sd.tracts = ts
                                        return { ...l, scraped_data: sd }
                                      }))
                                    }}
                                    onUpdate={(updatedTract) => {
                                      setListings(prev => prev.map(l => {
                                        if (l.id !== listing.id) return l
                                        const sd = { ...(l.scraped_data || {}) }
                                        const ts = [...((sd.tracts as any[]) || [])]
                                        ts[idx] = { ...ts[idx], ...updatedTract }
                                        sd.tracts = ts
                                        return { ...l, scraped_data: sd }
                                      }))
                                      const rk = `${listing.id}-${idx}`
                                      setCluReloadKeys(prev => ({ ...prev, [rk]: (prev[rk] || 0) + 1 }))
                                    }}
                                  />
                                  {/* FSA-CLU tillable workshop — click field
                                      polygons to toggle tillable; onSaved
                                      patches tract.computed for TractDataCompare
                                      + Verify. */}
                                  <TillableCluWorkshop
                                    stagingId={listing.id}
                                    tractIndex={idx}
                                    reloadKey={cluReloadKeys[`${listing.id}-${idx}`] || 0}
                                    latitude={tract.latitude ?? listing.scraped_data?.listing?.latitude ?? null}
                                    longitude={tract.longitude ?? listing.scraped_data?.listing?.longitude ?? null}
                                    onSaved={(r) => {
                                      setListings(prev => prev.map(l => {
                                        if (l.id !== listing.id) return l
                                        const sd = { ...(l.scraped_data || {}) }
                                        const ts = [...((sd.tracts as any[]) || [])]
                                        const cur = ts[idx] || {}
                                        const comp = { ...(cur.computed || {}) }
                                        const chosen = { ...(cur.chosen || {}) }
                                        if (r.tillable_acres != null) {
                                          comp.tillable_acres = r.tillable_acres
                                          chosen.tillable_acres = 'computed'
                                        }
                                        if (r.soil_rating != null) {
                                          comp.soil_rating = r.soil_rating
                                          chosen.soil_rating = 'computed'
                                        }
                                        if (r.soil_rating_type) comp.soil_rating_type = r.soil_rating_type
                                        ts[idx] = { ...cur, computed: comp, chosen }
                                        sd.tracts = ts
                                        return { ...l, scraped_data: sd }
                                      }))
                                    }}
                                  />
                                  {/* Side-by-side comparison panel — per user
                                      2026-05-25 requirement. Renders for new-format
                                      tracts (scraped + computed split from CHUNK
                                      C2a). Falls back to old display for
                                      pre-refactor staging rows. */}
                                  <TractDataCompare
                                    tractNumber={tract.tract_number ?? idx + 1}
                                    scraped={tract.scraped}
                                    computed={tract.computed}
                                    chosen={tract.chosen}
                                    fallbackTract={tract}
                                    stagingId={listing.id}
                                    tractIndex={idx}
                                    hasBuilding={!!tract.has_building}
                                    onHasBuildingChange={(next) => saveTractHasBuilding(listing, idx, next)}
                                    siblingTractNumbers={info.tracts.map((t: any) =>
                                      String(t.tract_number ?? ''))}
                                    onTractNumberChange={(newNum) => {
                                      setListings(prev => prev.map(l => {
                                        if (l.id !== listing.id) return l
                                        const sd = { ...(l.scraped_data || {}) }
                                        const ts = [...((sd.tracts as any[]) || [])]
                                        ts[idx] = { ...ts[idx], tract_number: newNum }
                                        sd.tracts = ts
                                        return { ...l, scraped_data: sd }
                                      }))
                                    }}
                                    onChosenChange={(nextChosen) => {
                                      setListings(prev => prev.map(l => {
                                        if (l.id !== listing.id) return l
                                        const sd = { ...(l.scraped_data || {}) }
                                        const ts = [...((sd.tracts as any[]) || [])]
                                        ts[idx] = { ...ts[idx], chosen: nextChosen }
                                        sd.tracts = ts
                                        return { ...l, scraped_data: sd }
                                      }))
                                    }}
                                  />
                                  {/* Second per-tract details box removed
                                      per user 2026-05-25 — redundant with
                                      TractDataCompare above + perimeter
                                      moved into the editor toolbar. */}
                                </div>
                                )
                              })}
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
                            {actionLoading === listing.id ? 'Verifying...' : (listing.scraped_data?.rescrape_listing_id ? 'Update Tracts' : 'Verify')}
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
                <p className="text-gg-gray-400">Run the PT scraper to see per-company discovery results.</p>
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
                        <tr key={idx} className="border-b border-gg-gray-800/50">
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
                          <td className="px-4 py-3 text-gg-gray-400 text-xs">{run.discovery_method || '\u2014'}</td>
                          <td className="px-4 py-3 text-right text-white">{run.cards_found}</td>
                          <td className="px-4 py-3 text-right text-gg-gray-400">{run.cards_after_filter}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={run.new_urls > 0 ? 'text-green-400 font-medium' : 'text-gg-gray-500'}>
                              {run.new_urls}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right text-gg-gray-400">{run.urls_scraped || '\u2014'}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={run.listings_staged > 0 ? 'text-green-400 font-medium' : 'text-gg-gray-500'}>
                              {run.listings_staged || '\u2014'}
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

              <div>
                <label className="block text-sm text-gg-gray-400 mb-1">Asking Price</label>
                <input
                  type="number"
                  step="0.01"
                  placeholder="e.g. 500000"
                  value={editForm.asking_price}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, asking_price: e.target.value }))}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                />
              </div>

              <div>
                <label className="block text-sm text-gg-gray-400 mb-1">Listing URL</label>
                <input
                  type="url"
                  placeholder="https://..."
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


