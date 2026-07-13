'use client'

import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
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
  ChevronLeft,
  ChevronRight,
  Navigation,
  BarChart3,
  Clock,
  Copy,
  StopCircle,
  Play,
  Link2,
  Search
} from 'lucide-react'
import fetchWithAuth, { fetchScraperProxy } from '@/lib/fetchWithAuth'
import { formatAcres } from '@/lib/format'
import CompanyLinkEditor, { type CompanyOption } from '@/components/admin/CompanyLinkEditor'
import openListingReport from '@/lib/openListingReport'
import NassStagingPreview from '@/components/admin/NassStagingPreview'
import TractMapEditor from '@/components/admin/TractMapEditor'
import TillableCluWorkshop from '@/components/admin/TillableCluWorkshop'
import TractDataCompare from '@/components/admin/TractDataCompare'
import SwapStagingTractsPanel from '@/components/admin/SwapStagingTractsPanel'
import SaleStatusChips from '@/components/admin/SaleStatusChips'
import { polygonAcres, polygonPerimeterFeet, formatPerimeter } from '@/lib/polygonGeometry'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_PROXY = '/api/scraper-proxy'

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
  is_incomplete: boolean
  incomplete_reason: string | null
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
  sale_status: string
  sale_price: string
  price_per_acre: string
}

interface EditForm {
  acres_listed: string
  sale_date: string
  auction_time: string
  auction_url: string
  image_url: string
  description: string
  primary_image_source: string  // "original", "tract:1", "tract:2", etc.
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

  // Determine primary_image_source: check if previously set in scraped_data
  const primaryImageSource = scraped?.primary_image_source || 'auto'

  return {
    acres_listed: listing.acres_listed != null ? String(listing.acres_listed) : '',
    sale_date: listing.sale_date || (listing.auction_datetime ? String(listing.auction_datetime).split('T')[0] : ''),
    auction_time: auctionTime,
    auction_url: listing.auction_url || '',
    image_url: listing.image || listing.primary_image_url || '',
    description: listing.description || '',
    primary_image_source: primaryImageSource,
    tracts: tracts.map((t: any, i: number) => ({
      tract_number: t.tract_number ?? i + 1,
      acres: t.acres != null ? String(t.acres) : '',
      tillable_acres: t.tillable_acres != null ? String(t.tillable_acres) : '',
      county: t.county?.county_name || '',
      state: t.state_full || t.county?.state_full || t.state || t.county?.state || '',
      soil_rating: t.soil_rating != null ? String(t.soil_rating) : '',
      latitude: t.latitude != null ? String(t.latitude) : '',
      longitude: t.longitude != null ? String(t.longitude) : '',
      sale_status: t.sale_status || '',
      sale_price: t.sale_price != null ? String(t.sale_price) : '',
      price_per_acre: t.price_per_acre != null ? String(t.price_per_acre) : '',
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

  // Store primary image source selection at top level of scraped_data
  updated.primary_image_source = form.primary_image_source || 'auto'

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
    const acresVal = t.acres ? parseFloat(t.acres) : null
    const tillVal = t.tillable_acres ? parseFloat(t.tillable_acres) : null
    const soilVal = t.soil_rating ? parseFloat(t.soil_rating) : null
    // Record an explicit MANUAL OVERRIDE for any of acres/tillable/soil the
    // admin actually CHANGED here. Verify reads scraped/computed subtrees first,
    // so a bare top-level edit was being ignored — `manual` is honored above
    // everything by the backend _pick(). Only changed fields are flagged, so
    // we never clobber CLU-computed tillable/soil the admin didn't touch.
    const manual: Record<string, number | null> = { ...(origTract.manual || {}) }
    const changed = (orig: any, next: number | null) =>
      (orig == null ? null : Number(orig)) !== next
    if (changed(origTract.acres, acresVal)) manual.acres = acresVal
    if (changed(origTract.tillable_acres, tillVal)) manual.tillable_acres = tillVal
    if (changed(origTract.soil_rating, soilVal)) manual.soil_rating = soilVal
    return {
      ...origTract,
      tract_number: t.tract_number,
      acres: acresVal,
      tillable_acres: tillVal,
      county: {
        ...(origTract.county || {}),
        county_name: t.county,
        state_full: t.state,
      },
      state_full: t.state,
      soil_rating: soilVal,
      latitude: t.latitude ? parseFloat(t.latitude) : null,
      longitude: t.longitude ? parseFloat(t.longitude) : null,
      // Sale status/price — editable for past (sold) auctions. Verify reads these
      // top-level fields directly, so a manual change here carries to production.
      sale_status: t.sale_status || null,
      sale_price: t.sale_price ? parseFloat(t.sale_price) : null,
      price_per_acre: t.price_per_acre ? parseFloat(t.price_per_acre) : null,
      manual,
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

  // Listing-company picker (fix an "Unknown Company" staged listing). The full
  // company list is small + bounded, so fetch once and filter client-side.
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [editingCompanyId, setEditingCompanyId] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchWithAuth(`${API_URL}/api/companies`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return
        setCompanies(data.map((c: any) => ({ id: c.id, name: c.name })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Pagination
  const PAGE_SIZE = 20
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  // Lazy-loaded screenshots cache: staging_id -> base64
  const [screenshotCache, setScreenshotCache] = useState<Record<number, string | null>>({})
  const [loadingScreenshot, setLoadingScreenshot] = useState<number | null>(null)

  // Lazy-loaded tract images cache: "staging_id-tract_index" -> base64
  const [tractImageCache, setTractImageCache] = useState<Record<string, string | null>>({})
  const [loadingTractImage, setLoadingTractImage] = useState<string | null>(null)

  // Per-tract CLU-workshop reload counter ("staging_id-tract_index" -> n).
  // Bumped whenever a tract boundary is saved in TractMapEditor so the
  // TillableCluWorkshop below re-fetches CLUs against the new polygon.
  const [cluReloadKeys, setCluReloadKeys] = useState<Record<string, number>>({})
  // Per-tract discard signal ("Collapse anyway" confirm below), same shape
  // as cluReloadKeys ("${listingId}-${tractIndex}" -> nonce). Bumped when the
  // admin confirms discarding a dirty tract's edits so TractMapEditor and
  // TractDataCompare revert their local edited state back to server truth —
  // the tract body stays mounted-but-hidden on collapse (924d7f2), so without
  // this the editors would keep reporting dirty forever.
  const [discardNonces, setDiscardNonces] = useState<Record<string, number>>({})
  // Tracks unsaved edits per tract editor so the listing's commit buttons stay
  // disabled until every tract is saved. Keys: `${listingId}::${idx}::map` for
  // the boundary editor and `::till` for the tillable workshop.
  const [dirtyTracts, setDirtyTracts] = useState<Record<string, boolean>>({})
  const setTractDirty = (key: string, dirty: boolean) =>
    setDirtyTracts(prev => {
      if (!!prev[key] === dirty) return prev
      const next = { ...prev }
      if (dirty) next[key] = true
      else delete next[key]
      return next
    })
  const listingHasUnsaved = (lid: number) =>
    Object.keys(dirtyTracts).some(k => k.startsWith(`${lid}::`) && dirtyTracts[k])

  // Completeness validation state — per staging listing id.
  // undefined = not yet fetched; { items: [], enforce, loading } = fetched.
  const [validateResults, setValidateResults] = useState<Record<number, { items: any[]; enforce: boolean; loading: boolean }>>({})
  const fetchValidation = async (id: number) => {
    setValidateResults(prev => ({ ...prev, [id]: { items: prev[id]?.items ?? [], enforce: prev[id]?.enforce ?? false, loading: true } }))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}/validate`)
      if (res.ok) {
        const data = await res.json()
        setValidateResults(prev => ({ ...prev, [id]: { items: data.items ?? [], enforce: data.enforce ?? false, loading: false } }))
      } else {
        setValidateResults(prev => ({ ...prev, [id]: { items: prev[id]?.items ?? [], enforce: prev[id]?.enforce ?? false, loading: false } }))
      }
    } catch {
      setValidateResults(prev => ({ ...prev, [id]: { items: prev[id]?.items ?? [], enforce: prev[id]?.enforce ?? false, loading: false } }))
    }
  }

  // Tillable polygon visibility per `${listingId}-${tractIdx}`. Mirrors
  // the PT staging page — show tract polygon by default, tillable only
  // when the user clicks Show Tillable on the per-tract map.
  // Per-tract expand/collapse. Key: `${listingId}-${tractIndex}`.
  // Default: all collapsed. Empty set = all collapsed.
  const [openTractIds, setOpenTractIds] = useState<Set<string>>(new Set())
  const toggleTract = (key: string) => {
    const isOpen = openTractIds.has(key)
    if (isOpen) {
      // Collapsing — check if this tract has unsaved edits.
      // Key format: "${listingId}-${tractIndex}"; dirty keys: "${listingId}::${tractIndex}::*"
      const [listingIdStr, tractIdxStr] = key.split('-')
      const dirtyPrefix = `${listingIdStr}::${tractIdxStr}::`
      const hasDirty = Object.keys(dirtyTracts).some(k => k.startsWith(dirtyPrefix) && dirtyTracts[k])
      if (hasDirty) {
        if (!window.confirm('Unsaved changes on this tract will be discarded. Collapse anyway?')) {
          return
        }
        // Confirmed discard: tell the tract editors to revert their local
        // edited state to server truth (TractMapEditor + TractDataCompare via
        // discardNonce, TillableCluWorkshop via its existing reloadKey — a
        // re-fetch resets its own dirty flag), then clear the dirty keys
        // immediately so Verify unblocks right away instead of waiting for
        // the editors' effects to report back.
        setDiscardNonces(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }))
        setCluReloadKeys(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }))
        setDirtyTracts(prev => {
          const next = { ...prev }
          Object.keys(next).forEach(k => { if (k.startsWith(dirtyPrefix)) delete next[k] })
          return next
        })
      }
    }
    setOpenTractIds(prev => {
      const s = new Set(prev)
      if (s.has(key)) s.delete(key); else s.add(key)
      return s
    })
    // When expanding any tract in a listing, eagerly load images for ALL
    // tracts in that listing so the collapsed-row thumbnails are ready.
    // Parse listingId from the key format "${listingId}-${tractIndex}".
    const listingId = parseInt(key.split('-')[0], 10)
    if (!openTractIds.has(key)) {
      // Tract is being opened — prefetch siblings too
      const listing = listings.find(l => l.id === listingId)
      const tracts: any[] = listing?.scraped_data?.tracts || []
      tracts.forEach((_t: any, idx: number) => {
        if (_t.has_tract_image) loadTractImage(listingId, idx)
      })
    }
  }

  // Inverted set — tracks which tracts have tillable HIDDEN.
  // Default behaviour: tillable is SHOWN whenever tract.tillable_polygon exists.
  // The user can click "Hide Tillable" to add the key here.
  const [tillableHidden, setTillableHidden] = useState<Set<string>>(new Set())
  const toggleTillable = (key: string, next: boolean) => {
    setTillableHidden(prev => {
      const s = new Set(prev)
      // next=true means "show now" → remove from hidden set
      // next=false means "hide now" → add to hidden set
      if (next) s.delete(key); else s.add(key)
      return s
    })
  }

  // Source-image cache per listingId — mirrors PT staging. See
  // private-treaty-staging/page.tsx for full comment.
  const [sourceImageCache, setSourceImageCache] = useState<Record<number, {
    base64: string | null
    url: string | null
    kind: string | null
  } | null>>({})
  const loadSourceImage = async (listingId: number) => {
    if (sourceImageCache[listingId] !== undefined) return
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
  const [companyCounts, setCompanyCounts] = useState<Record<string, number>>({})

  // Tab state
  const [activeTab, setActiveTab] = useState<'staging' | 'results'>('staging')

  // Run log
  const [runLog, setRunLog] = useState<RunLogEntry[]>([])
  const [runLogLoading, setRunLogLoading] = useState(false)

  // Action state
  const [actionLoading, setActionLoading] = useState<number | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [copiedId, setCopiedId] = useState<number | null>(null)

  // Duplicate comparison modal state
  const [duplicateModal, setDuplicateModal] = useState<{
    stagingId: number
    existingListingId: string
    matchType: string
    message: string
    existingListing: any | null
    loading: boolean
  } | null>(null)

  // Edit modal state
  const [editingListing, setEditingListing] = useState<StagingListing | null>(null)
  const [editForm, setEditForm] = useState<EditForm>({ acres_listed: '', sale_date: '', auction_time: '', auction_url: '', image_url: '', description: '', primary_image_source: 'auto', tracts: [] })
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
    last_run_summary?: {
      staged: number
      skipped_total: number
      skipped_by_reason: Record<string, number>
      errors_total: number
      error_samples: { company?: string | null; url?: string | null; error?: string | null }[]
      total_attempted?: number
      completed_at?: string
    } | null
  } | null>(null)
  const [stoppingScraper, setStoppingScraper] = useState(false)
  const [startingScraper, setStartingScraper] = useState(false)
  const prevScraperRunning = useRef<boolean | null>(null)

  // Single-URL scrape
  const [scrapeUrl, setScrapeUrl] = useState('')
  const [scrapingUrl, setScrapingUrl] = useState(false)
  const [scrapeUrlResult, setScrapeUrlResult] = useState<{ success: boolean; message: string } | null>(null)

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetchScraperProxy(`/api/scraper/status`)
        if (res.ok) {
          const data = await res.json()
          setScraperStatus(data)
          // Auto-refresh listings when scraper transitions from running → complete
          if (prevScraperRunning.current === true && data?.running === false) {
            setPage(0)
            fetchStagingListings(0)
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
      const res = await fetchScraperProxy(`/api/scraper/stop`, { method: 'POST' })
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
      const res = await fetchScraperProxy(`/api/nightly/scrape-and-stage`, {
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

  const scrapeSingleUrl = async () => {
    if (!scrapeUrl.trim()) return
    setScrapingUrl(true)
    setScrapeUrlResult(null)
    try {
      // Async by default: the scraper runs the 30-60s scrape on a background
      // thread and returns a job_id immediately. We poll for completion so
      // the long request never trips the browser/edge timeout ("Failed to
      // fetch"). The server still finishes even if this tab closes.
      // Resilient start: Railway can drop the FIRST socket during a cold start
      // or deploy cutover, which surfaces as a bare "Failed to fetch" even
      // though nothing is wrong. Every other call (fetchWithAuth) already rides
      // these out; this one didn't. Retry the start up to 3x with backoff — the
      // async scrape returns a job_id in ~1s and is dedup-safe (re-staging the
      // same URL is caught as a duplicate), so a retry can't double-create work.
      let res: Response | null = null
      let startErr: unknown = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          res = await fetchScraperProxy(`/api/scraper/scrape-single-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: scrapeUrl.trim(), force: true, async: true }),
          })
          startErr = null
          break
        } catch (e) {
          startErr = e
          if (attempt < 3) {
            setScrapeUrlResult({ success: true, message: `Connecting to scraper… (retry ${attempt + 1}/3)` })
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
          }
        }
      }
      if (!res) throw startErr ?? new Error('Could not start the scrape.')
      const data = await res.json()

      const applyResult = (d: any) => {
        if (d.success && d.staging_id) {
          setScrapeUrlResult({ success: true, message: `Staged successfully (${d.company_name}, ${Math.round((d.scrape_duration_ms || 0) / 1000)}s)` })
          setScrapeUrl('')
          setPage(0)
          fetchStagingListings(0)
        } else {
          setScrapeUrlResult({ success: false, message: d.error || 'Scraping failed — no reason was returned (check scraper logs)' })
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
          const sres = await fetchScraperProxy(`/api/scraper/scrape-single-url/status/${jobId}`)
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
      // A bare "Failed to fetch" is a browser network error (server unreachable
      // or request never completed) — translate it into something actionable
      // instead of the useless raw message.
      const raw = String(err?.message || '')
      const msg = /failed to fetch|networkerror|load failed/i.test(raw)
        ? 'Could not reach the server (network error or it never responded). Check your connection and try again — the scrape may still be running; hit Refresh.'
        : raw || 'Unexpected error while scraping.'
      setScrapeUrlResult({ success: false, message: msg })
    } finally {
      setScrapingUrl(false)
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

  // Pre-load tract images for every listing as soon as the listings array
  // changes (initial load + page turns). Without this, collapsed tract rows
  // never show their thumbnails until the user manually expands at least one
  // tract per listing (which triggers the sibling prefetch in toggleTract).
  // loadTractImage guards against double-fetching internally, so it's safe to
  // call for every tract on every render of this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    listings.forEach((listing) => {
      (listing.scraped_data?.tracts || []).forEach((tract: any, idx: number) => {
        if (tract.has_tract_image) {
          loadTractImage(listing.id, idx)
        }
      })
    })
  }, [listings])

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

  const fetchStagingListings = useCallback(async (pageNum?: number) => {
    setLoading(true)
    setFetchError(null)
    const offset = (pageNum ?? page) * PAGE_SIZE
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging?status=pending&listing_type=auction&limit=${PAGE_SIZE}&offset=${offset}`)
      if (response.ok) {
        const data = await response.json()
        // Handle both paginated response {items, total} and legacy array response
        if (data && Array.isArray(data.items)) {
          setListings(data.items)
          setTotalCount(data.total || data.items.length)
          if (data.company_counts) {
            setCompanyCounts(data.company_counts)
          }
          // Kick off completeness validation for each loaded listing (fire-and-forget)
          data.items.forEach((l: StagingListing) => fetchValidation(l.id))
        } else if (Array.isArray(data)) {
          setListings(data)
          setTotalCount(data.length)
          data.forEach((l: StagingListing) => fetchValidation(l.id))
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
  }, [page])

  const loadScreenshot = async (listingId: number) => {
    if (screenshotCache[listingId] !== undefined) return // Already loaded or loading
    setLoadingScreenshot(listingId)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/${listingId}/screenshot`)
      if (response.ok) {
        const data = await response.json()
        setScreenshotCache(prev => ({ ...prev, [listingId]: data.screenshot_base64 }))
      }
    } catch (err) {
      console.error('Failed to load screenshot:', err)
    } finally {
      setLoadingScreenshot(null)
    }
  }

  const loadTractImage = async (listingId: number, tractIndex: number) => {
    const key = `${listingId}-${tractIndex}`
    if (tractImageCache[key] !== undefined) return // Already loaded or loading
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

  const goToPage = (newPage: number) => {
    setPage(newPage)
    setScreenshotCache({})
    setTractImageCache({})
    fetchStagingListings(newPage)
    window.scrollTo(0, 0)
  }

  const fetchRunLog = async () => {
    setRunLogLoading(true)
    try {
      const response = await fetchScraperProxy(`/api/scraper-run-log?limit=500`)
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

  // Get unique company names from API-provided company_counts (across ALL pages)
  const companyNames = useMemo(() => {
    return Object.keys(companyCounts).sort()
  }, [companyCounts])

  // Filtered listings
  const filteredListings = useMemo(() => {
    if (companyFilter === 'all') return listings
    return listings.filter((l) => l.company_name === companyFilter)
  }, [listings, companyFilter])

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

  // Persist the per-tract "has buildings" checkbox. Verify POSTs with no
  // body, so per-tract edits must be PATCHed into scraped_data here.
  // Updates local state optimistically.
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
      else fetchValidation(listing.id)
    } catch {
      showToast('error', 'Network error — failed to save buildings flag')
    }
  }

  // Persist the per-tract "has house" checkbox. Same path as buildings: PATCH
  // it into scraped_data so the bodyless Verify reads it. (Per user 2026-06-05.)
  const saveTractHasHouse = async (listing: StagingListing, idx: number, next: boolean) => {
    const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
    if (!Array.isArray(updated.tracts)) updated.tracts = []
    if (!updated.tracts[idx]) updated.tracts[idx] = {}
    updated.tracts[idx].has_house = next
    setListings((prev) =>
      prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l))
    )
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraped_data: updated }),
      })
      if (!res.ok) showToast('error', 'Failed to save house flag')
      else fetchValidation(listing.id)
    } catch {
      showToast('error', 'Network error — failed to save house flag')
    }
  }

  // Persist the per-tract sale_status override into scraped_data so Verify
  // carries it through. Auto-saves like has_buildings (no dirty flag).
  const saveTractSaleStatus = async (listing: StagingListing, idx: number, next: string) => {
    const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
    if (!Array.isArray(updated.tracts)) updated.tracts = []
    if (!updated.tracts[idx]) updated.tracts[idx] = {}
    updated.tracts[idx].sale_status = next || null
    setListings((prev) =>
      prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l))
    )
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraped_data: updated }),
      })
      if (!res.ok) showToast('error', 'Failed to save sale status')
      else fetchValidation(listing.id)
    } catch {
      showToast('error', 'Network error — failed to save sale status')
    }
  }

  // Persist the per-tract Scraped/Computed selection (acres / tillable_acres /
  // soil_rating). CRITICAL: Verify POSTs with no body and reads the STORED
  // staging record, so a pick that only lived in React state was silently
  // ignored — Verify fell back to the default source (computed). This PATCHes
  // the pick into scraped_data so Verify saves exactly what you selected.
  // (Per user 2026-06-05.)
  const saveTractChosen = async (listing: StagingListing, idx: number, nextChosen: any) => {
    const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
    if (!Array.isArray(updated.tracts)) updated.tracts = []
    if (!updated.tracts[idx]) updated.tracts[idx] = {}
    // An explicit pick supersedes any earlier Edit-modal manual override for
    // that field (the radio is the more recent, authoritative choice).
    const manual = { ...((updated.tracts[idx] || {}).manual || {}) }
    for (const f of ['acres', 'tillable_acres', 'soil_rating']) {
      if (nextChosen?.[f]) delete manual[f]
    }
    updated.tracts[idx] = { ...updated.tracts[idx], chosen: nextChosen, manual }
    setListings((prev) =>
      prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l))
    )
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraped_data: updated }),
      })
      if (!res.ok) showToast('error', 'Failed to save Scraped/Computed selection')
      else fetchValidation(listing.id)
    } catch {
      showToast('error', 'Network error — selection not saved')
    }
  }

  // Per-tract Land Types — auto-saves into scraped_data so Verify persists it.
  const saveTractLandTypes = async (listing: StagingListing, idx: number, next: string[]) => {
    const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
    if (!Array.isArray(updated.tracts)) updated.tracts = []
    if (!updated.tracts[idx]) updated.tracts[idx] = {}
    updated.tracts[idx].land_types = next
    updated.tracts[idx].land_type = next[0] || null  // keep legacy singular in sync
    setListings((prev) =>
      prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l))
    )
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraped_data: updated }),
      })
      if (!res.ok) showToast('error', 'Failed to save land types')
      else fetchValidation(listing.id)
    } catch {
      showToast('error', 'Network error — land types not saved')
    }
  }

  // Persist a hand-typed override for one field (acres / tillable_acres /
  // soil_rating). value=null clears it. A manual value supersedes the
  // Scraped/Computed pick (Verify reads tract.manual first). (Per user.)
  const saveTractManual = async (
    listing: StagingListing, idx: number,
    field: 'acres' | 'tillable_acres' | 'soil_rating', value: number | null,
  ) => {
    const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
    if (!Array.isArray(updated.tracts)) updated.tracts = []
    if (!updated.tracts[idx]) updated.tracts[idx] = {}
    const manual = { ...((updated.tracts[idx] || {}).manual || {}) }
    if (value == null) delete manual[field]
    else manual[field] = value
    updated.tracts[idx].manual = manual
    // A hand-typed value supersedes any Scraped/Computed pick for that field.
    const chosen = { ...((updated.tracts[idx] || {}).chosen || {}) }
    if (value != null) delete chosen[field]
    updated.tracts[idx].chosen = chosen
    setListings((prev) => prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l)))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraped_data: updated }),
      })
      if (!res.ok) showToast('error', 'Failed to save value')
      else fetchValidation(listing.id)
    } catch {
      showToast('error', 'Network error — value not saved')
    }
  }

  // Add a new empty tract to a staging listing. Seeds the map location from a
  // sibling tract so the editor opens near the others; everything else blank.
  // Verify creates the real tract from this object. (Per user 2026-06-05.)
  const [addingTractFor, setAddingTractFor] = useState<number | null>(null)
  const addStagingTract = async (listing: StagingListing) => {
    if (addingTractFor === listing.id) return
    setAddingTractFor(listing.id)
    try {
      const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
      if (!Array.isArray(updated.tracts)) updated.tracts = []
      const nums = updated.tracts.map((t: any) => Number(t.tract_number) || 0)
      const nextNum = (nums.length ? Math.max(...nums) : 0) + 1
      const sib = updated.tracts.find((t: any) => t.latitude != null && t.longitude != null)
      const newTract: any = { tract_number: nextNum, created_via: 'manual' }
      if (sib) { newTract.latitude = sib.latitude; newTract.longitude = sib.longitude }
      updated.tracts.push(newTract)
      setListings((prev) => prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l)))
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraped_data: updated }),
      })
      if (!res.ok) showToast('error', 'Failed to add tract')
      else fetchValidation(listing.id)
    } catch {
      showToast('error', 'Network error — tract not added')
    } finally {
      setAddingTractFor(null)
    }
  }

  // Delete a manual-only staging tract (no DB id) by removing it from the
  // local scraped_data array and PATCHing the staging record — mirrors addStagingTract.
  const handleDeleteStagingTract = async (tractNumber: number, listing: StagingListing) => {
    if (!confirm('Delete this tract? This cannot be undone.')) return
    const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
    if (!Array.isArray(updated.tracts)) updated.tracts = []
    updated.tracts = updated.tracts.filter((t: any) => t.tract_number !== tractNumber)
    setListings((prev) => prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l)))
    // D16-style cleanup: removing a tract shifts every later tract's index
    // down by one, so index-keyed state (dirtyTracts/cluReloadKeys/
    // discardNonces) would otherwise attach to the wrong tract post-delete
    // (or strand a phantom dirty key that permanently blocks Verify). Same
    // fix as handleDeleteTract above — clear this listing's per-tract state
    // wholesale rather than trying to shift keys.
    const listingId = listing.id
    setCluReloadKeys((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((k) => { if (k.startsWith(`${listingId}-`)) delete next[k] })
      return next
    })
    setDiscardNonces((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((k) => { if (k.startsWith(`${listingId}-`)) delete next[k] })
      return next
    })
    setDirtyTracts((prev) => {
      const next = { ...prev }
      Object.keys(next).forEach((k) => { if (k.startsWith(`${listingId}::`)) delete next[k] })
      return next
    })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scraped_data: updated }),
      })
      if (!res.ok) showToast('error', 'Failed to delete tract')
      else fetchValidation(listing.id)
    } catch {
      showToast('error', 'Network error — tract not deleted')
    }
  }

  const handleDeleteTract = async (tractId: string, listingId: number) => {
    if (!confirm('Delete this tract? This cannot be undone.')) return
    const token = localStorage.getItem('auth_token')
    try {
      const response = await fetch(`${API_URL}/api/tracts/${tractId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (!response.ok) {
        const detail = (await response.json().catch(() => ({}))).detail || `HTTP ${response.status}`
        showToast('error', String(detail))
        return
      }
      // Remove the tract from local scraped_data state
      setListings(prev => prev.map(l => {
        if (l.id !== listingId) return l
        const sd = { ...(l.scraped_data || {}) }
        const ts = ((sd.tracts as any[]) || []).filter((t: any) => t.id !== tractId)
        sd.tracts = ts
        return { ...l, scraped_data: sd }
      }))
      // D16-style cleanup: deleting a tract shifts every later tract's index
      // down by one, so index-keyed state (dirtyTracts/cluReloadKeys/
      // discardNonces) would otherwise attach to the wrong tract post-delete
      // (or strand a phantom dirty key that permanently blocks Verify).
      // Mirrors SwapStagingTractsPanel.onSwap above — clear this listing's
      // per-tract state wholesale rather than trying to shift keys.
      setCluReloadKeys(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(k => { if (k.startsWith(`${listingId}-`)) delete next[k] })
        return next
      })
      setDiscardNonces(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(k => { if (k.startsWith(`${listingId}-`)) delete next[k] })
        return next
      })
      setDirtyTracts(prev => {
        const next = { ...prev }
        Object.keys(next).forEach(k => { if (k.startsWith(`${listingId}::`)) delete next[k] })
        return next
      })
      fetchValidation(listingId)
    } catch (e: any) {
      showToast('error', e.message || 'Failed to delete tract')
    }
  }

  const handleVerify = async (id: number) => {
    setActionLoading(id)
    // Check if this is a rescrape item
    const item = listings.find(l => l.id === id)
    const isRescrape = item?.scraped_data?.rescrape_listing_id
    const verifyUrl = isRescrape
      ? `${API_URL}/api/admin/staging/${id}/verify-rescrape`
      : `${API_URL}/api/admin/staging/${id}/verify`
    try {
      // Verify POSTs with no body and reads the stored staging record, so any
      // unsaved in-memory edits (TractDataCompare Scraped/Computed picks, tract
      // number changes) must be PATCHed into scraped_data FIRST or they're lost.
      // Per user 2026-06-02: chosen "Scraped" picks were being ignored at verify.
      // Flush in-memory scraped_data (TractDataCompare picks, tract number
      // changes) before any verify variant — rescrape reads scraped_data too.
      if (item) {
        const patchRes = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scraped_data: item.scraped_data }),
        })
        if (!patchRes.ok) {
          showToast('error', 'Failed to save your selections before verifying — not verified')
          setActionLoading(null)
          return
        }
      }
      const response = await fetchWithAuth(verifyUrl, {
        method: 'POST',
      })
      if (response.ok) {
        const data = await response.json().catch(() => ({}))
        const newListingId = data?.listing_id || (isRescrape ? item?.scraped_data?.rescrape_listing_id : null)
        setListings((prev) => prev.filter((l) => l.id !== id))
        setTotalCount((prev) => Math.max(0, prev - 1))
        showToast('success', isRescrape ? 'Tracts updated with new boundary data' : 'Listing verified and created successfully')
        // Open the branded report PDF so the admin can double-check the data.
        if (newListingId) openListingReport(String(newListingId), { force: true })
      } else if (response.status === 409) {
        // Duplicate detected — check if we have listing ID for comparison
        const err = await response.json().catch(() => ({ detail: 'Duplicate listing' }))
        const detail = err.detail
        if (typeof detail === 'object' && detail.existing_listing_id) {
          // Show comparison modal
          setDuplicateModal({
            stagingId: id,
            existingListingId: detail.existing_listing_id,
            matchType: detail.match_type || 'unknown',
            message: detail.message || 'A duplicate listing exists',
            existingListing: null,
            loading: true,
          })
          // Fetch the existing listing details
          try {
            const listingRes = await fetchWithAuth(`${API_URL}/api/listings/${detail.existing_listing_id}`)
            if (listingRes.ok) {
              const listingData = await listingRes.json()
              setDuplicateModal(prev => prev ? { ...prev, existingListing: listingData, loading: false } : null)
            } else {
              setDuplicateModal(prev => prev ? { ...prev, loading: false } : null)
            }
          } catch {
            setDuplicateModal(prev => prev ? { ...prev, loading: false } : null)
          }
        } else {
          showToast('error', (typeof detail === 'string' ? detail : detail?.message) || 'Duplicate listing exists')
        }
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

  const handlePublishIncomplete = async (id: number) => {
    setActionLoading(id)
    try {
      // Flush in-memory scraped_data edits before publishing, same as the
      // !isRescrape verify path — otherwise TractDataCompare picks, tract
      // numbers, etc. are silently discarded.
      const item = listings.find(l => l.id === id)
      if (item) {
        const patchRes = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scraped_data: item.scraped_data }),
        })
        if (!patchRes.ok) {
          showToast('error', 'Failed to save your selections before publishing — not published')
          setActionLoading(null)
          return
        }
      }
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}/publish-incomplete`, {
        method: 'POST',
      })
      if (response.ok) {
        setListings((prev) => prev.filter((l) => l.id !== id))
        setTotalCount((prev) => Math.max(0, prev - 1))
        showToast('success', 'Published as incomplete — Details Coming Soon')
      } else {
        const err = await response.json().catch(() => ({ detail: 'Failed' }))
        showToast('error', typeof err.detail === 'string' ? err.detail : 'Failed to publish as incomplete')
      }
    } catch (err) {
      showToast('error', 'Network error')
    } finally {
      setActionLoading(null)
    }
  }

  const handleVerifyReplace = async () => {
    if (!duplicateModal) return
    setDuplicateModal(prev => prev ? { ...prev, loading: true } : null)
    try {
      // Flush in-memory scraped_data edits before verify-replace, same as
      // the !isRescrape verify path — TractDataCompare picks and tract number
      // changes would otherwise be silently discarded.
      const item = listings.find(l => l.id === duplicateModal.stagingId)
      if (item) {
        const patchRes = await fetchWithAuth(`${API_URL}/api/admin/staging/${duplicateModal.stagingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scraped_data: item.scraped_data }),
        })
        if (!patchRes.ok) {
          showToast('error', 'Failed to save your selections before replacing — not replaced')
          setDuplicateModal(prev => prev ? { ...prev, loading: false } : null)
          return
        }
      }
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/${duplicateModal.stagingId}/verify-replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replace_listing_id: duplicateModal.existingListingId }),
      })
      if (response.ok) {
        setListings((prev) => prev.filter((l) => l.id !== duplicateModal.stagingId))
        setTotalCount((prev) => Math.max(0, prev - 1))
        setDuplicateModal(null)
        showToast('success', 'Old listing replaced with new data successfully')
      } else {
        const err = await response.json().catch(() => ({ detail: 'Replace failed' }))
        showToast('error', err.detail || 'Failed to replace listing')
        setDuplicateModal(null)
      }
    } catch {
      showToast('error', 'Network error — failed to replace listing')
      setDuplicateModal(null)
    }
  }

  const handleKeepOriginal = async () => {
    if (!duplicateModal) return
    // Reject the staging record
    try {
      await fetchWithAuth(`${API_URL}/api/admin/staging/${duplicateModal.stagingId}`, {
        method: 'DELETE',
      })
      setListings((prev) => prev.filter((l) => l.id !== duplicateModal.stagingId))
      setTotalCount((prev) => Math.max(0, prev - 1))
      showToast('success', 'Kept original listing, staging record removed')
    } catch {
      showToast('error', 'Failed to remove staging record')
    }
    setDuplicateModal(null)
  }

  const handleReject = async (id: number) => {
    setActionLoading(id)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}`, {
        method: 'DELETE',
      })
      if (response.ok) {
        setListings((prev) => prev.filter((l) => l.id !== id))
        setTotalCount((prev) => Math.max(0, prev - 1))
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

  const handleIgnore = async (id: number) => {
    setActionLoading(id)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}/ignore`, {
        method: 'POST',
      })
      if (response.ok) {
        setListings((prev) => prev.filter((l) => l.id !== id))
        setTotalCount((prev) => Math.max(0, prev - 1))
        showToast('success', 'Listing ignored — will be re-scraped next run')
      } else {
        const err = await response.json().catch(() => ({ detail: 'Unknown error' }))
        showToast('error', err.detail || err.error || 'Failed to ignore listing')
      }
    } catch (err) {
      showToast('error', 'Network error — failed to ignore listing')
    } finally {
      setActionLoading(null)
    }
  }

  const handleClearAll = async () => {
    const hasDirty = Object.keys(dirtyTracts).some(k => dirtyTracts[k])
    const msg = hasDirty
      ? `You have unsaved tract edits that will be discarded. Are you sure you want to clear all ${filteredListings.length} staging listings? Cleared URLs will be added to the rejected URLs list and will not re-import.`
      : `Are you sure you want to clear all ${filteredListings.length} staging listings? Cleared URLs will be added to the rejected URLs list and will not re-import.`
    if (!confirm(msg)) {
      return
    }
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/staging/clear-all?listing_type=auction`, {
        method: 'DELETE',
      })
      if (response.ok) {
        const data = await response.json()
        setListings([])
        setTotalCount(0)
        setPage(0)
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
    // Auto-load tract images for the primary image selector
    const tracts = listing.scraped_data?.tracts || []
    tracts.forEach((_: any, idx: number) => {
      loadTractImage(listing.id, idx)
    })
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
        fetchValidation(editingListing.id)
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
      const updated = { ...tracts[index], [field]: value }
      // D13: auto-compute price_per_acre from sale_price / acres when
      // sale_price is edited, keeping price_per_acre consistent.
      if (field === 'sale_price') {
        const sp = parseFloat(String(value))
        const ac = parseFloat(String(updated.acres))
        if (sp > 0 && ac > 0) {
          updated.price_per_acre = String(Math.round(sp / ac * 100) / 100)
        }
      }
      tracts[index] = updated
      return { ...prev, tracts }
    })
  }

  const addTract = () => {
    const nextNum = editForm.tracts.length > 0
      ? Math.max(...editForm.tracts.map((t) => t.tract_number)) + 1
      : 1
    setEditForm((prev) => ({
      ...prev,
      tracts: [...prev.tracts, { tract_number: nextNum, acres: '', tillable_acres: '', county: '', state: '', soil_rating: '', latitude: '', longitude: '', sale_status: '', sale_price: '', price_per_acre: '' }],
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
      county: firstTract.county?.county_name || firstTract.county_name || listing.county || null,
      state: listing.state_full || firstTract.state_full || firstTract.state || firstTract.state_abbr || listing.state || null,
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

  // Per user 2026-05-24 incident: spinner stuck forever when fetch
  // hangs or errors before checkAuth completes. Show the error inline
  // + Retry button INSIDE the loading screen so the user is never
  // stranded. fetchError is set by the catch/else branches of
  // fetchStagingListings — if loading is still true AND fetchError
  // is set, surface the error + an out instead of just a spinner.
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
              <p className="text-gg-gray-400 text-sm">Loading staging listings...</p>
            </>
          )}
        </div>
      </div>
    )
  }

  const lastRun = scraperStatus?.last_run_summary

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
              <h1 className="font-display text-3xl font-bold text-white">Auction Staging</h1>
              <p className="text-gg-gray-400">{totalCount} pending listings to review{totalCount > PAGE_SIZE && ` (page ${page + 1} of ${Math.ceil(totalCount / PAGE_SIZE)})`}</p>
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
            <button
              onClick={() => { setPage(0); fetchStagingListings(0); fetchRunLog() }}
              className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 transition-colors text-sm"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Last-run breakdown cards. Splits the old "N scraped, M errors"
            into an honest tally: newly staged vs. benign skips (already
            known / past auctions) vs. genuine errors (with details). */}
        {lastRun && !scraperStatus?.running && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xs font-semibold text-gg-gray-400 uppercase tracking-wide">Last Scrape Run</h2>
              {lastRun.completed_at && (
                <span className="text-xs text-gg-gray-500">
                  {new Date(lastRun.completed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}
                  {typeof lastRun.total_attempted === 'number' && ` · ${lastRun.total_attempted} URLs checked`}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Newly staged */}
              <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-4">
                <div className="text-3xl font-bold text-green-400">{lastRun.staged}</div>
                <div className="text-sm text-gg-gray-300 mt-1">Newly staged</div>
                <div className="text-xs text-gg-gray-500 mt-0.5">added to the review queue</div>
              </div>
              {/* Skipped (benign) */}
              <div className="rounded-xl border border-gg-gray-700 bg-gg-gray-800/40 p-4">
                <div className="text-3xl font-bold text-white">{lastRun.skipped_total}</div>
                <div className="text-sm text-gg-gray-300 mt-1">Skipped (normal)</div>
                <div className="text-xs text-gg-gray-500 mt-1.5 space-y-0.5">
                  {Object.entries(lastRun.skipped_by_reason || {}).sort((a, b) => b[1] - a[1]).map(([reason, n]) => (
                    <div key={reason} className="flex justify-between gap-2">
                      <span className="truncate">{reason}</span>
                      <span className="shrink-0 tabular-nums">{n}</span>
                    </div>
                  ))}
                  {Object.keys(lastRun.skipped_by_reason || {}).length === 0 && <div>—</div>}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Single URL Scrape */}
        <div className="mb-4 flex items-center gap-3">
          <div className="flex-1 relative">
            <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-500" size={16} />
            <input
              type="text"
              value={scrapeUrl}
              onChange={(e) => { setScrapeUrl(e.target.value); setScrapeUrlResult(null) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && scrapeUrl.trim() && !scrapingUrl) scrapeSingleUrl() }}
              placeholder="Paste auction URL to scrape..."
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
                <option value="all">All Companies ({totalCount})</option>
                {companyNames.map((name) => (
                  <option key={name} value={name}>
                    {name} ({companyCounts[name] || 0})
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
                return (
                  <div
                    key={listing.id}
                    className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl overflow-hidden"
                  >
                    <div className="flex flex-col">
                      {/* Per user 2026-06-01: removed the left thumbnail column
                          (page screenshot + property photo + tract map) — it was
                          wasted space. The interactive tract map below is the
                          working reference now. */}

                      {/* Content */}
                      <div className="flex-1 p-6">
                        {/* Company & Date Row */}
                        <div className="flex items-start justify-between mb-4">
                          <div>
                            {editingCompanyId === listing.id ? (
                              <div className="mb-1">
                                <CompanyLinkEditor
                                  companies={companies}
                                  onPick={async (c) => {
                                    const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ listing_company_id: c.id }),
                                    })
                                    const d = await res.json()
                                    if (!res.ok || !d.success) throw new Error(d.detail || `HTTP ${res.status}`)
                                    setListings((prev) => prev.map((l) =>
                                      l.id === listing.id
                                        ? { ...l, listing_company_id: c.id, company_name: d.company_name || c.name }
                                        : l))
                                    setEditingCompanyId(null)
                                  }}
                                  onClose={() => setEditingCompanyId(null)}
                                />
                              </div>
                            ) : (
                              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                {listing.company_name
                                  ? listing.company_name
                                  : <span className="text-orange-400">Unknown Company</span>}
                                <button
                                  onClick={() => setEditingCompanyId(listing.id)}
                                  title="Link a listing company"
                                  className="text-gg-gray-400 hover:text-gg-pink"
                                >
                                  <Pencil size={14} />
                                </button>
                                {listing.scraped_data?.rescrape_listing_id && (
                                  <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 text-xs font-medium rounded-full">RESCRAPE</span>
                                )}
                              </h3>
                            )}
                            {/* Full source URL shown under the company name
                                (per user 2026-06-01, replaces the Copy URL
                                button). Click to open the listing page. */}
                            <a
                              href={listing.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block mt-0.5 text-xs text-gg-gray-400 hover:text-gg-pink break-all"
                              title="Open the listing page in a new tab"
                            >
                              {listing.source_url}
                            </a>
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
                          {/* Source button — opens the auctioneer's listing
                              page. Solid pink for visibility against the light
                              staging-page background. (Copy URL removed
                              2026-06-01; the full URL now shows under the
                              company name.) */}
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
                          </div>
                        </div>

                        {/* Per-listing polygon sum — see PT staging
                            mirror at 2026-05-25 for rationale. Render
                            "Drawn: X ac · ±Y (±Z%)" under the scraped
                            total when polygons exist. Amber when delta
                            exceeds 5%. */}
                        {(() => {
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
                          ;(info as any).__polySumAc = polySumAc
                          ;(info as any).__acresDelta = delta
                          ;(info as any).__acresDeltaPct = deltaPct
                          return null
                        })()}

                        {/* Key Data */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                          <div className="bg-white border border-gg-gray-500 rounded-lg p-3 shadow-sm">
                            <p className="text-xs text-gg-gray-500 mb-1">Acres</p>
                            <p className="text-gg-gray-900 font-semibold">
                              {info.acres ? `${info.acres}` : 'N/A'}
                            </p>
                            {(info as any).__polySumAc > 0 && (info as any).__acresDelta != null && (
                              <p className="text-[11px] mt-0.5 text-gray-700">
                                Drawn: {formatAcres((info as any).__polySumAc)} ac
                                {' · '}
                                {/* deltaPct is null whenever scrapedAc isn't a
                                    positive number; .toFixed on the null
                                    crashed the whole page with the
                                    "Application error" boundary. Guard each
                                    accessor independently so the absolute
                                    delta still renders without a percent. */}
                                <span className={(info as any).__acresDeltaPct != null && Math.abs((info as any).__acresDeltaPct) > 5 ? 'font-semibold' : ''}>
                                  {(info as any).__acresDelta >= 0 ? '+' : '-'}{formatAcres(Math.abs((info as any).__acresDelta))}
                                  {(info as any).__acresDeltaPct != null && (
                                    <>
                                      {' ('}{(info as any).__acresDeltaPct >= 0 ? '+' : ''}{(info as any).__acresDeltaPct.toFixed(1)}%)
                                    </>
                                  )}
                                </span>
                              </p>
                            )}
                          </div>
                          <div className="bg-white border border-gg-gray-500 rounded-lg p-3 shadow-sm">
                            <p className="text-xs text-gg-gray-500 mb-1">Location</p>
                            <p className="text-gg-gray-900 font-semibold flex items-center gap-1">
                              <MapPin size={12} className="text-gg-gray-500" />
                              {info.county && info.state
                                ? `${info.county}, ${info.state}`
                                : 'N/A'}
                            </p>
                          </div>
                          <div className="bg-white border border-gg-gray-500 rounded-lg p-3 shadow-sm">
                            <p className="text-xs text-gg-gray-500 mb-1">Tracts</p>
                            <p className="text-gg-gray-900 font-semibold flex items-center gap-1">
                              <Layers size={12} className="text-gg-gray-500" />
                              {info.tractCount}
                            </p>
                          </div>
                          <div className="bg-white border border-gg-gray-500 rounded-lg p-3 shadow-sm">
                            <p className="text-xs text-gg-gray-500 mb-1">Auction Date &amp; Time</p>
                            <p className="text-gg-gray-900 font-semibold">
                              {formatDate(listing.auction_date)}
                              {info.auctionTime && (
                                <span className="text-gg-gray-600 font-normal ml-1">@ {info.auctionTime}</span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* NASS Ground Truth preview — at-a-glance USDA
                            data for the listing's county. Confirms the
                            county will resolve correctly once promoted to
                            the live `tracts` table; warns in amber if the
                            county can't be matched. */}
                        <div className="mb-3 flex justify-end">
                          <NassStagingPreview
                            state={info.state}
                            county={info.county}
                          />
                        </div>

                        {/* Swap Tracts — only shown when >= 2 tracts */}
                        {info.tracts.length >= 2 && (
                          <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                            <p className="text-xs text-gray-900 mb-2">
                              <strong>Tract data mismatched?</strong> If you changed a tract number and the acres, soil rating, or polygon are now on the wrong tract, use Swap Tracts to fix it.
                            </p>
                            <SwapStagingTractsPanel
                              tracts={info.tracts}
                              onSwap={async (updatedTracts) => {
                                const original = listings
                                const updated = JSON.parse(JSON.stringify(listing.scraped_data || {}))
                                updated.tracts = updatedTracts
                                setListings((prev) =>
                                  prev.map((l) => (l.id === listing.id ? { ...l, scraped_data: updated } : l))
                                )
                                // D16: reset per-tract React state keyed by index so stale
                                // cluReloadKeys, discardNonces, and dirtyTracts don't attach
                                // to the wrong tract.
                                const lid = listing.id
                                setCluReloadKeys((prev) => {
                                  const next = { ...prev }
                                  updatedTracts.forEach((_: any, idx: number) => {
                                    delete next[`${lid}-${idx}`]
                                  })
                                  return next
                                })
                                setDiscardNonces((prev) => {
                                  const next = { ...prev }
                                  updatedTracts.forEach((_: any, idx: number) => {
                                    delete next[`${lid}-${idx}`]
                                  })
                                  return next
                                })
                                setDirtyTracts((prev) => {
                                  const next = { ...prev }
                                  Object.keys(next).forEach((k) => {
                                    if (k.startsWith(`${lid}::`)) delete next[k]
                                  })
                                  return next
                                })
                                try {
                                  const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${listing.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ scraped_data: updated }),
                                  })
                                  if (!res.ok) throw new Error('Failed to save swap')
                                  fetchValidation(listing.id)
                                } catch (e) {
                                  setListings(original)
                                  throw e
                                }
                              }}
                            />
                          </div>
                        )}

                        {/* Tract Details — each tract is now a vertical
                            block: map+image header on top (magic-lab pattern),
                            charcoal details box below. Was previously a
                            2-column grid; switched to single-column because
                            each tract now has a 320px-high map header that
                            would be too cramped at 50% width. */}
                        {info.tracts.length > 0 && (
                          <div className="mb-4">
                            <p className="text-xs text-gg-gray-400 mb-2 font-medium uppercase tracking-wider">Tract Details</p>
                            <div className="space-y-4">
                              {info.tracts.map((tract: any, idx: number) => {
                                const tractKey = `${listing.id}-${idx}`
                                // Show tillable by default when one exists;
                                // only hide if the user explicitly toggled it off.
                                const showTill = tract.tillable_polygon != null && !tillableHidden.has(tractKey)
                                const listingHasSourceImage = (listing.scraped_data?.listing as any)?.has_source_image
                                const inlineSourceUrl = (listing.scraped_data?.listing as any)?.source_image_url
                                const inlineSourceKind = (listing.scraped_data?.listing as any)?.source_image_kind
                                if (listingHasSourceImage && sourceImageCache[listing.id] === undefined) {
                                  setTimeout(() => loadSourceImage(listing.id), 0)
                                }
                                // Auto-load tract image when one exists but hasn't been
                                // fetched yet. Backend strips tract_image_base64 from
                                // the list payload (leaves has_tract_image=true flag) to
                                // keep page weight down; we lazy-fetch it here so the
                                // TractMapEditor right pane always has a satellite overlay
                                // even when no source screenshot was captured. Per user
                                // 2026-05-26: "I HAVE to have an image on the right."
                                if (tract.has_tract_image && tractImageCache[tractKey] === undefined) {
                                  setTimeout(() => loadTractImage(listing.id, idx), 0)
                                }
                                const cachedSrc = sourceImageCache[listing.id]
                                const tractIsOpen = openTractIds.has(tractKey)
                                const stAcres = tract.scraped?.acres ?? tract.acres
                                const stPpa = tract.display_price_per_acre ?? tract.price_per_acre ?? tract.scraped?.price_per_acre
                                const stTotal = tract.sale_price ?? tract.scraped?.sale_price
                                const stStatus = tract.sale_status ?? tract.scraped?.sale_status ?? null
                                const stReviewed = tract.boundary_reviewed_at ?? null
                                const stSummaryParts = [
                                  stAcres != null ? `${formatAcres(Number(stAcres))} ac` : null,
                                  stPpa != null ? `$${Number(stPpa).toLocaleString(undefined, { maximumFractionDigits: 0 })}/ac` : null,
                                  stTotal != null ? `$${Number(stTotal).toLocaleString(undefined, { maximumFractionDigits: 0 })} total` : null,
                                ].filter(Boolean).join(' · ')
                                const stStatusCls =
                                  stStatus === 'sold'    ? 'bg-green-500/15 text-green-400 border border-green-500/40' :
                                  stStatus === 'pending' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/40' :
                                  stStatus === 'live'    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/40' :
                                  stStatus === 'no_sale' ? 'bg-red-500/15 text-red-400 border border-red-500/40' :
                                  stStatus              ? 'bg-gg-gray-700 text-gg-gray-300 border border-gg-gray-600' : ''
                                return (
                                <div key={idx} className="border-t border-gg-gray-800 pt-2 first:border-t-0 first:pt-0">
                                  {/* Collapsed summary row */}
                                  <button
                                    type="button"
                                    onClick={() => toggleTract(tractKey)}
                                    className="group w-full flex items-center gap-2 py-2 text-left hover:bg-gg-pink hover:text-white rounded-lg px-2 -mx-2 transition-colors"
                                  >
                                    <span className="text-gg-gray-400 text-xs w-3 shrink-0">{tractIsOpen ? '▼' : '▶'}</span>
                                    <span className="text-base text-white font-bold tracking-tight shrink-0">
                                      Tract {tract.tract_number ?? idx + 1}
                                    </span>
                                    {stStatus && (
                                      <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded font-medium capitalize ${stStatusCls}`}>
                                        {stStatus.replace('_', ' ')}
                                      </span>
                                    )}
                                    {stSummaryParts && (
                                      <span className="text-xs text-gg-gray-400 ml-1">{stSummaryParts}</span>
                                    )}
                                    <div className="ml-auto flex items-center gap-3 shrink-0">
                                      {stAcres != null && (
                                        <span className="text-xs text-gg-gray-300">{formatAcres(Number(stAcres))} ac</span>
                                      )}
                                      <span className={`text-xs ${tract.polygon_coordinates ? 'text-green-400' : 'text-yellow-400'}`}>
                                        {tract.polygon_coordinates ? '◼ Polygon' : '○ No polygon'}
                                      </span>
                                      {stReviewed && (
                                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/40 shrink-0">
                                          ✓ Reviewed
                                        </span>
                                      )}
                                      {/* Tract image thumbnail */}
                                      {(() => {
                                        const hasPolygon = !!tract.polygon_coordinates;
                                        if (!hasPolygon) return null;
                                        const imageSource = tractImageCache[`${listing.id}-${idx}`]
                                          ? `data:image/png;base64,${tractImageCache[`${listing.id}-${idx}`]}`
                                          : null;
                                        return (
                                          <>
                                            {imageSource ? (
                                              <img
                                                src={imageSource}
                                                alt="Tract polygon"
                                                onError={(e) => {
                                                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                                                  (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex';
                                                }}
                                                className="w-12 h-12 rounded-md object-cover border border-white/20 flex-none group-hover:border-white/40"
                                              />
                                            ) : null}
                                            <div
                                              style={{ display: imageSource ? 'none' : 'flex' }}
                                              className="w-12 h-12 rounded-md border border-white/20 bg-gray-700 flex-none items-center justify-center group-hover:border-white/40"
                                            >
                                              <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18M3.75 3h16.5A.75.75 0 0121 3.75v16.5a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75V3.75A.75.75 0 013.75 3z" />
                                              </svg>
                                            </div>
                                          </>
                                        );
                                      })()}
                                    </div>
                                  </button>

                                  <div className={tractIsOpen ? '' : 'hidden'}>
                                  {/* Sale Status chips — top of expanded tract panel.
                                      Auto-saves into scraped_data so Verify carries it. */}
                                  <SaleStatusChips
                                    status={tract.sale_status ?? tract.scraped?.sale_status ?? ''}
                                    onChange={(next) => saveTractSaleStatus(listing, idx, next)}
                                    disabled={actionLoading === listing.id}
                                  />
                                  {/* View on Map — opens the Explore portal map
                                      in a new tab, zoomed to this tract. Prefers
                                      the tract polygon centroid (most accurate),
                                      then tract lat/lng, then listing lat/lng. */}
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
                                    const tractViolations = (validateResults[listing.id]?.items ?? [])
                                      .filter((it: any) => it.scope === 'tract' && it.tract_number === (tract.tract_number ?? idx + 1))
                                    return (
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="flex items-center gap-2">
                                          <p className="text-2xl text-white font-extrabold tracking-tight">
                                            Tract {tract.tract_number ?? idx + 1}
                                          </p>
                                          {tractViolations.length > 0 && (
                                            <span
                                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-300 border border-yellow-500 text-black text-xs font-medium"
                                              title={tractViolations.map((v: any) => v.message).join('\n')}
                                            >
                                              <XCircle size={11} />
                                              {tractViolations.length} missing
                                            </span>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {tract.created_via === 'manual' && (
                                            <button
                                              type="button"
                                              onClick={() => tract.id
                                                ? handleDeleteTract(tract.id, listing.id)
                                                : handleDeleteStagingTract(tract.tract_number, listing)
                                              }
                                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm"
                                            >
                                              <Trash2 size={14} /> Delete tract
                                            </button>
                                          )}
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
                                            className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-sm ${
                                              disabled
                                                ? 'bg-gg-gray-800 text-gg-gray-600 cursor-not-allowed'
                                                : 'bg-gg-pink text-white hover:bg-gg-pink-light'
                                            }`}
                                          >
                                            <MapPin size={14} /> View on Map
                                          </button>
                                        </div>
                                      </div>
                                    )
                                  })()}
                                  {/* Map (interactive editor, ~60%) + tract image
                                      (static reference, ~40%) header — magic-lab
                                      style. Lazy-mounts MapLibre on first
                                      visibility to avoid WebGL context
                                      exhaustion on multi-tract pages. */}
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
                                    // OTHER tracts' saved polygons → dashed reference
                                    // overlay + snap / copy-edge targets so adjacent
                                    // tracts share an exact boundary.
                                    neighborPolygons={((listing.scraped_data?.tracts as any[]) || [])
                                      .filter((_t: any, i: number) => i !== idx)
                                      .map((t: any) => t.polygon_coordinates)
                                      .filter((p: any) => Array.isArray(p) && p.length >= 3)}
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
                                    listingCounty={(typeof tract.county === 'string' ? tract.county : tract.county?.county_name || null) || tract.county_name || null}
                                    // Per user 2026-05-26: Align button
                                    // appears when drawn polygon area
                                    // doesn't match scraped acres.
                                    scrapedAcres={tract.scraped?.acres ?? tract.acres ?? null}
                                    // Per user 2026-05-25: when no polygon
                                    // exists, fall through to listing-level
                                    // lat/lng so the map centers near the
                                    // actual property instead of defaulting
                                    // to Iowa (-93.5, 41.9).
                                    latitude={tract.latitude ?? listing.scraped_data?.listing?.latitude ?? null}
                                    longitude={tract.longitude ?? listing.scraped_data?.listing?.longitude ?? null}
                                    // Per user 2026-05-26: live-update
                                    // tract.computed.acres as the user
                                    // drags vertices / clicks Align, so the
                                    // TractDataCompare radios reflect the
                                    // current shape immediately (not just
                                    // after Save).
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
                                      // Merge updated tract back into local state
                                      // so the card re-renders immediately
                                      // without a full re-fetch.
                                      setListings(prev => prev.map(l => {
                                        if (l.id !== listing.id) return l
                                        const sd = { ...(l.scraped_data || {}) }
                                        const ts = [...((sd.tracts as any[]) || [])]
                                        ts[idx] = { ...ts[idx], ...updatedTract }
                                        sd.tracts = ts
                                        return { ...l, scraped_data: sd }
                                      }))
                                      // If a new polygon image was saved, update the thumbnail cache.
                                      if (updatedTract.tract_image_base64) {
                                        setTractImageCache(prev => ({
                                          ...prev,
                                          [`${listing.id}-${idx}`]: updatedTract.tract_image_base64,
                                        }));
                                      }
                                      // Boundary just saved → tell the CLU
                                      // workshop below to re-fetch against the
                                      // new polygon (it loaded empty before the
                                      // polygon existed).
                                      const rk = `${listing.id}-${idx}`
                                      setCluReloadKeys(prev => ({ ...prev, [rk]: (prev[rk] || 0) + 1 }))
                                      // Refresh completeness after polygon save (no_polygon may now clear)
                                      fetchValidation(listing.id)
                                    }}
                                    onDirtyChange={(d) => setTractDirty(`${listing.id}::${idx}::map`, d)}
                                    discardNonce={discardNonces[`${listing.id}-${idx}`] || 0}
                                  />
                                  {/* FSA-CLU tillable workshop — admin clicks
                                      the field polygons that count as tillable.
                                      onSaved patches tract.computed so the
                                      TractDataCompare radios + Verify pick up
                                      the new tillable acres / soil rating. */}
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
                                        // Reflect the freshly-computed soil rating. When the backend
                                        // returns null (no tillable, or no SSURGO data), clear the
                                        // stale value to null so pre-verify PATCH doesn't restore a
                                        // stale rating that the backend already cleared.
                                        if (r.soil_rating != null) {
                                          comp.soil_rating = r.soil_rating
                                          chosen.soil_rating = 'computed'
                                        } else {
                                          // Covers both zero-tillable and no-SSURGO cases — null is
                                          // always correct when the backend returns null (A1 fix).
                                          comp.soil_rating = null
                                          comp.soil_rating_type = null
                                          chosen.soil_rating = 'computed'
                                        }
                                        // Always sync soil_rating_type from the backend response so a
                                        // stale type (e.g. 'CSR2') is never left in memory after a
                                        // workshop Save that cleared the rating (LOW fix).
                                        comp.soil_rating_type = r.soil_rating_type ?? null
                                        ts[idx] = { ...cur, computed: comp, chosen }
                                        sd.tracts = ts
                                        return { ...l, scraped_data: sd }
                                      }))
                                      // Refresh completeness after CLU save (soil/tillable may now be set)
                                      fetchValidation(listing.id)
                                    }}
                                    onDirtyChange={(d) => setTractDirty(`${listing.id}::${idx}::till`, d)}
                                  />
                                  {/* Per-tract scraped-vs-computed side-by-side with
                                      per-field radio selectors. Per user 2026-05-25.
                                      Falls back to single old-format row for pre-
                                      refactor staging rows. */}
                                  <TractDataCompare
                                    tractNumber={tract.tract_number ?? idx + 1}
                                    scraped={tract.scraped}
                                    computed={tract.computed}
                                    chosen={tract.chosen}
                                    fallbackTract={tract}
                                    // Per user 2026-05-26: editable tract
                                    // number — fixes the Steffes-class
                                    // "wrong polygon paired with wrong
                                    // tract" bug in one click without
                                    // redrawing anything.
                                    stagingId={listing.id}
                                    tractIndex={idx}
                                    hasBuilding={!!tract.has_building}
                                    onHasBuildingChange={(next) => saveTractHasBuilding(listing, idx, next)}
                                    hasHouse={!!tract.has_house}
                                    onHasHouseChange={(next) => saveTractHasHouse(listing, idx, next)}
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
                                    onChosenChange={(nextChosen) => saveTractChosen(listing, idx, nextChosen)}
                                    manual={tract.manual}
                                    onManualChange={(field, value) => saveTractManual(listing, idx, field, value)}
                                    landTypes={(tract.land_types && tract.land_types.length) ? tract.land_types : (tract.land_type ? [tract.land_type] : [])}
                                    onLandTypesChange={(next) => saveTractLandTypes(listing, idx, next)}
                                    onDirtyChange={(d) => setTractDirty(`${listing.id}::${idx}::data`, d)}
                                    discardNonce={discardNonces[`${listing.id}-${idx}`] || 0}
                                  />
                                  {/* Second per-tract details box removed
                                      per user 2026-05-25 — redundant with
                                      TractDataCompare above + perimeter
                                      moved into the editor toolbar. */}
                                  </div> {/* end tractIsOpen */}
                                </div>
                                )
                              })}
                              {/* Add a new empty tract (seeded near the others). */}
                              <button
                                onClick={() => addStagingTract(listing)}
                                disabled={addingTractFor === listing.id}
                                className="mt-1 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gg-pink text-white hover:bg-gg-pink/80 disabled:opacity-50"
                              >
                                {addingTractFor === listing.id ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
                                Add Tract
                              </button>
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

                        {/* Confidence/COMPLETE badge removed per user
                            2026-06-02 — redundant status chip on the card. */}

                        {/* Required-field checklist — shown when the server says
                            fields are missing. Red + disables Verify when enforce=true;
                            amber advisory only when enforce=false (observe mode). */}
                        {(() => {
                          const vr = validateResults[listing.id]
                          if (!vr || vr.items.length === 0) return null
                          // Group listing-level items first, then per-tract
                          const listingItems = vr.items.filter((it: any) => it.scope === 'listing')
                          const tractItems   = vr.items.filter((it: any) => it.scope === 'tract')
                          if (vr.enforce) {
                            return (
                              <div className="mb-3 px-3 py-2.5 bg-yellow-300 border border-yellow-500 rounded-lg">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <XCircle size={14} className="text-black flex-shrink-0" />
                                  <span className="text-black text-xs font-semibold uppercase tracking-wide">Required before verifying</span>
                                </div>
                                <ul className="space-y-0.5">
                                  {listingItems.map((it: any) => (
                                    <li key={it.code} className="text-gray-900 text-xs">{it.message}</li>
                                  ))}
                                  {tractItems.map((it: any) => (
                                    <li key={`${it.tract_number}-${it.code}`} className="text-gray-900 text-xs">{it.message}</li>
                                  ))}
                                </ul>
                              </div>
                            )
                          } else {
                            return (
                              <div className="mb-3 px-3 py-2.5 bg-yellow-300 border border-yellow-500 rounded-lg">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                  <AlertTriangle size={14} className="text-black flex-shrink-0" />
                                  <span className="text-black text-xs font-semibold uppercase tracking-wide">Incomplete fields (not yet enforced)</span>
                                </div>
                                <ul className="space-y-0.5">
                                  {listingItems.map((it: any) => (
                                    <li key={it.code} className="text-gray-900 text-xs">{it.message}</li>
                                  ))}
                                  {tractItems.map((it: any) => (
                                    <li key={`${it.tract_number}-${it.code}`} className="text-gray-900 text-xs">{it.message}</li>
                                  ))}
                                </ul>
                              </div>
                            )
                          }
                        })()}

                        {/* Action Buttons */}
                        {listingHasUnsaved(listing.id) && (
                          <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                            <AlertTriangle size={16} className="text-orange-400 flex-shrink-0" />
                            <span className="text-orange-400 text-sm">Save all tract edits before verifying.</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleVerify(listing.id)}
                            disabled={
                              actionLoading === listing.id ||
                              listingHasUnsaved(listing.id) ||
                              (validateResults[listing.id]?.enforce === true &&
                                (validateResults[listing.id]?.items?.length ?? 0) > 0)
                            }
                            title={
                              listingHasUnsaved(listing.id) ? 'Save all tract edits first' :
                              (validateResults[listing.id]?.enforce === true &&
                                (validateResults[listing.id]?.items?.length ?? 0) > 0)
                                ? 'Fix required fields above before verifying'
                              : undefined
                            }
                            className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionLoading === listing.id ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />}
                            {actionLoading === listing.id ? 'Verifying...' : listing.scraped_data?.rescrape_listing_id ? 'Update Tracts' : 'Verify'}
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
                            onClick={() => handleIgnore(listing.id)}
                            disabled={actionLoading === listing.id}
                            className="flex items-center gap-2 px-5 py-2.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionLoading === listing.id ? <Loader2 className="animate-spin" size={16} /> : <Clock size={16} />}
                            {actionLoading === listing.id ? 'Ignoring...' : 'Ignore'}
                          </button>
                          {listing.is_incomplete && (
                            <button
                              onClick={() => handlePublishIncomplete(listing.id)}
                              disabled={actionLoading === listing.id || listingHasUnsaved(listing.id)}
                              title={listingHasUnsaved(listing.id) ? 'Save all tract edits first' : undefined}
                              className="flex items-center gap-2 px-5 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-500 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {actionLoading === listing.id ? <Loader2 className="animate-spin" size={16} /> : <AlertTriangle size={16} />}
                              Publish Incomplete
                            </button>
                          )}
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

            {/* Pagination Controls */}
            {totalCount > PAGE_SIZE && (
              <div className="flex items-center justify-center gap-4 mt-6 mb-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page === 0}
                  className="flex items-center gap-1 px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
                >
                  <ChevronLeft size={16} />
                  Previous
                </button>
                <span className="text-sm text-gg-gray-400">
                  Page {page + 1} of {Math.ceil(totalCount / PAGE_SIZE)} ({totalCount} total)
                </span>
                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= totalCount}
                  className="flex items-center gap-1 px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm"
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
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
      {/* Duplicate Comparison Modal */}
      {duplicateModal && (
        <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gg-gray-900 border border-white/10 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[85vh] overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Duplicate Listing Detected</h2>
                <p className="text-xs text-gg-gray-400 mt-0.5">{duplicateModal.message}</p>
              </div>
              <button onClick={() => setDuplicateModal(null)} className="text-gg-gray-400 hover:text-white text-xl">✕</button>
            </div>

            {/* Comparison Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {duplicateModal.loading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="animate-spin text-gg-pink" size={28} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-6">
                  {/* Existing Listing */}
                  <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
                    <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-3">Existing Listing</div>
                    {duplicateModal.existingListing ? (() => {
                      const ex = duplicateModal.existingListing
                      return (
                        <div className="space-y-2 text-sm">
                          <div><span className="text-gg-gray-400">Company:</span> <span className="text-white font-medium">{ex.company_name || ex.company?.name || '—'}</span></div>
                          <div><span className="text-gg-gray-400">Location:</span> <span className="text-white">{ex.county}, {ex.state}</span></div>
                          <div><span className="text-gg-gray-400">Acres:</span> <span className="text-white">{ex.total_acres || '—'}</span></div>
                          <div><span className="text-gg-gray-400">Tracts:</span> <span className="text-white">{ex.tracts?.length || ex.tract_count || '—'}</span></div>
                          <div><span className="text-gg-gray-400">Auction:</span> <span className="text-white">{ex.auction_datetime ? new Date(ex.auction_datetime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span></div>
                          <div><span className="text-gg-gray-400">Status:</span> <span className="text-white">{ex.status || '—'}</span></div>
                          {ex.tracts && ex.tracts.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-white/5">
                              <div className="text-xs font-semibold text-gg-gray-400 mb-2">Tracts:</div>
                              {ex.tracts.map((t: any, i: number) => (
                                <div key={i} className="text-xs text-gg-gray-300 flex gap-2">
                                  <span>Tract {t.tract_number || i + 1}</span>
                                  <span>{t.total_acres ? `${t.total_acres} ac` : '—'}</span>
                                  <span>{t.polygon_coordinates ? '✓ Boundaries' : '✗ No boundaries'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })() : <p className="text-gg-gray-500 text-sm">Could not load existing listing details</p>}
                  </div>

                  {/* New Staging Data */}
                  <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4">
                    <div className="text-xs font-bold text-green-400 uppercase tracking-wider mb-3">New Staging Data</div>
                    {(() => {
                      const staging = listings.find(l => l.id === duplicateModal.stagingId)
                      if (!staging) return <p className="text-gg-gray-500 text-sm">Staging data not found</p>
                      const info = extractListingInfo(staging.scraped_data)
                      const tracts = info.tracts || []
                      return (
                        <div className="space-y-2 text-sm">
                          <div><span className="text-gg-gray-400">Company:</span> <span className="text-white font-medium">{staging.company_name || '—'}</span></div>
                          <div><span className="text-gg-gray-400">Location:</span> <span className="text-white">{info.county || '—'}, {info.state || '—'}</span></div>
                          <div><span className="text-gg-gray-400">Acres:</span> <span className="text-white">{info.acres || '—'}</span></div>
                          <div><span className="text-gg-gray-400">Tracts:</span> <span className="text-white">{info.tractCount || '—'}</span></div>
                          <div><span className="text-gg-gray-400">Auction:</span> <span className="text-white">{staging.auction_date ? new Date(staging.auction_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span></div>
                          <div><span className="text-gg-gray-400">Scraped:</span> <span className="text-white">{staging.created_at ? new Date(staging.created_at).toLocaleDateString() : '—'}</span></div>
                          {tracts.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-white/5">
                              <div className="text-xs font-semibold text-gg-gray-400 mb-2">Tracts:</div>
                              {tracts.map((t: any, i: number) => (
                                <div key={i} className="text-xs text-gg-gray-300 flex gap-2">
                                  <span>Tract {t.tract_number || i + 1}</span>
                                  <span>{t.acres ? `${t.acres} ac` : '—'}</span>
                                  <span>{t.polygon_coordinates ? '✓ Boundaries' : '✗ No boundaries'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3">
              <button
                onClick={() => setDuplicateModal(null)}
                className="px-4 py-2 text-sm text-gg-gray-400 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                onClick={handleKeepOriginal}
                className="px-4 py-2 text-sm bg-white/5 border border-white/10 text-white rounded-lg hover:bg-white/10 transition"
              >
                Keep Original
              </button>
              <button
                onClick={handleVerifyReplace}
                className="px-4 py-2 text-sm bg-gg-pink text-white font-semibold rounded-lg hover:bg-gg-pink/80 transition"
              >
                Replace with New
              </button>
            </div>
          </div>
        </div>
      )}

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

              {/* Primary Image Selector */}
              <div>
                <label className="block text-sm font-semibold text-white mb-2">Primary Listing Image</label>
                <div className="space-y-2">
                  {/* Auto option (default to first tract image) */}
                  <label className="flex items-center gap-3 p-2 rounded-lg bg-gg-gray-800 border border-gg-gray-700 cursor-pointer hover:border-gg-pink/50 transition-colors">
                    <input
                      type="radio"
                      name="primary_image_source"
                      value="auto"
                      checked={editForm.primary_image_source === 'auto'}
                      onChange={() => setEditForm((prev) => ({ ...prev, primary_image_source: 'auto' }))}
                      className="accent-pink-500"
                    />
                    <span className="text-sm text-gg-gray-300">Auto (first tract image, fallback to original)</span>
                  </label>

                  {/* Original image option */}
                  <label className="flex items-center gap-3 p-2 rounded-lg bg-gg-gray-800 border border-gg-gray-700 cursor-pointer hover:border-gg-pink/50 transition-colors">
                    <input
                      type="radio"
                      name="primary_image_source"
                      value="original"
                      checked={editForm.primary_image_source === 'original'}
                      onChange={() => setEditForm((prev) => ({ ...prev, primary_image_source: 'original' }))}
                      className="accent-pink-500"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gg-gray-300">Original Image</span>
                      {editForm.image_url && (
                        <img
                          src={editForm.image_url}
                          alt="Original"
                          className="h-12 w-16 rounded border border-gg-gray-600 object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                        />
                      )}
                    </div>
                  </label>

                  {/* Tract image options */}
                  {editingListing && editForm.tracts.map((tract) => {
                    const key = `${editingListing.id}-${tract.tract_number - 1}`
                    const cachedImage = tractImageCache[key]
                    const tractValue = `tract:${tract.tract_number}`

                    return (
                      <label
                        key={tract.tract_number}
                        className="flex items-center gap-3 p-2 rounded-lg bg-gg-gray-800 border border-gg-gray-700 cursor-pointer hover:border-gg-pink/50 transition-colors"
                      >
                        <input
                          type="radio"
                          name="primary_image_source"
                          value={tractValue}
                          checked={editForm.primary_image_source === tractValue}
                          onChange={() => setEditForm((prev) => ({ ...prev, primary_image_source: tractValue }))}
                          className="accent-pink-500"
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gg-gray-300">Tract {tract.tract_number}</span>
                          {cachedImage ? (
                            <img
                              src={`data:image/png;base64,${cachedImage}`}
                              alt={`Tract ${tract.tract_number}`}
                              className="h-12 w-16 rounded border border-gg-gray-600 object-cover"
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); loadTractImage(editingListing.id, tract.tract_number - 1) }}
                              className="text-xs text-gg-pink hover:text-gg-pink/80"
                            >
                              {loadingTractImage === key ? 'Loading...' : 'Load preview'}
                            </button>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Listing Image URL (hidden when tract image is selected) */}
              {(editForm.primary_image_source === 'original' || editForm.primary_image_source === 'auto') && (
                <div>
                  <label className="block text-sm text-gg-gray-400 mb-1">Listing Image URL</label>
                  <input
                    type="url"
                    placeholder="https://..."
                    value={editForm.image_url}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, image_url: e.target.value }))}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                  />
                </div>
              )}

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
                        <div>
                          <label className="block text-xs text-gg-gray-400 mb-1">Status</label>
                          <select
                            value={tract.sale_status}
                            onChange={(e) => updateTract(idx, 'sale_status', e.target.value)}
                            className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                          >
                            <option value="">— (auto)</option>
                            <option value="auction">Auction (upcoming)</option>
                            <option value="sold">Sold</option>
                            <option value="no_sale">No sale</option>
                            <option value="listed">Listed</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gg-gray-400 mb-1">Sale Price ($)</label>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="total sale $"
                            value={tract.sale_price}
                            onChange={(e) => updateTract(idx, 'sale_price', e.target.value)}
                            className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-1.5 text-white text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gg-gray-400 mb-1">$/acre</label>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="price per acre"
                            value={tract.price_per_acre}
                            onChange={(e) => updateTract(idx, 'price_per_acre', e.target.value)}
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


