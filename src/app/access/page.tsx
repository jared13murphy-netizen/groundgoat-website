'use client'

import { useState, useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, BarChart3, ArrowLeft } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { SHOW_PRIVATE_TREATY } from '@/lib/featureFlags'
import { toRings as toTractRings } from '@/lib/polygonRings'
import { getDistanceToCounty, getCountyCoordinates } from '@/data/countyCoordinates'
import PortalNavBar from '@/components/portal/PortalNavBar'
import PortalKPICards from '@/components/portal/PortalKPICards'
import PortalListPanel from '@/components/portal/PortalListPanel'
import PortalAnalyticsPanel from '@/components/portal/PortalAnalyticsPanel'
import PortalListingDetail from '@/components/portal/PortalListingDetail'
import PortalTractDetail, { TractDetailActionBar } from '@/components/portal/PortalTractDetail'
import { canUseReportsFor } from '@/lib/reportAccess'
import PortalComparablesReportPanel from '@/components/portal/PortalComparablesReportPanel'
import PortalReportPanel from '@/components/portal/PortalReportPanel'
import MapChatPanel from '@/components/portal/MapChatPanel'
import PortalWatchlistPanel from '@/components/portal/PortalWatchlistPanel'
import type { TractSaleData } from '@/components/portal/PortalTractDetail'
import type { OwnerParcelsResponse } from '@/components/map/exploreMapTypes'

const ExploreMap = dynamic(() => import('@/components/map/ExploreMap'), { ssr: false })
const Tract3DModal = dynamic(() => import('@/components/Tract3DModal'), { ssr: false })

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

const ALLOWED_ROLES = ['groundgoat_admin', 'groundgoat_sales', 'firm_admin', 'firm_user']

type TabType = 'map' | 'auctions' | 'private_treaty' | 'results'

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  account_type: string
  home_county?: string
  home_state?: string
  can_use_goat_search?: boolean
}

interface Listing {
  id: string
  county: string
  state: string
  total_acres: number
  listing_type: string
  status: string
  auction_datetime?: string
  auction_date?: string
  auction_time?: string
  primary_image_url?: string
  asking_price?: number
  sale_price?: number
  price_per_acre?: number
  company?: { id: string; name: string }
  company_name?: string
  tract_count?: number
  tracts?: { id: string; township?: string; total_acres?: number }[]
  created_at?: string
  _distance?: number
}

interface AnalyticsData {
  total_listings: number
  total_acres_sold: number
  total_sale_amount: number
}

function AccessPortalPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [user, setUser] = useState<User | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('map')
  const [showListPanel, setShowListPanel] = useState(false)
  const [showAnalyticsPanel, setShowAnalyticsPanel] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [activeFilters, setActiveFilters] = useState<{ stateFilter: string; countyFilters: string[] }>({ stateFilter: '', countyFilters: [] })
  const [listings, setListings] = useState<Listing[]>([])
  const [listingsLoading, setListingsLoading] = useState(false)
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [mapListingId, setMapListingId] = useState<string | null>(null)
  const [selectedTract, setSelectedTract] = useState<TractSaleData | null>(null)
  const [neighborParcels, setNeighborParcels] = useState<any[] | null>(null)
  const [neighborsLoading, setNeighborsLoading] = useState(false)
  // Report state
  const [reportIds, setReportIds] = useState<Set<string>>(new Set())
  const [reportTracts, setReportTracts] = useState<TractSaleData[]>([])
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set())
  const [watchlistListings, setWatchlistListings] = useState<Listing[]>([])
  const [showWatchlistPanel, setShowWatchlistPanel] = useState(false)
  const [watchlistLoading, setWatchlistLoading] = useState(false)
  const watchTogglePendingRef = useRef<Set<string>>(new Set())
  // Map zoom state
  const [zoomToLocation, setZoomToLocation] = useState<{ lat: number; lng: number; zoom: number } | null>(null)
  // Polygon-bounds zoom: fired when the user picks a listing or a
  // specific tract from the slide-out pane. ExploreMap fits the map
  // to these coords. `nonce` lets the same polygon retrigger if the
  // user clicks it again.
  // `coords` is a single flat ring OR a list of rings (multi-piece tract) —
  // see toRings in @/lib/polygonRings. ExploreMap normalizes either shape.
  const [zoomToBoundsSignal, setZoomToBoundsSignal] = useState<{ coords: [number, number][] | [number, number][][]; nonce: number } | null>(null)
  // Most-recently-clicked tract polygon. Force-rendered on the map even
  // if the tract's status would otherwise be filtered out by the
  // current view (e.g. a sold tract inside an upcoming-auction listing).
  // Same single-ring-or-list-of-rings shape as zoomToBoundsSignal.coords.
  const [pinnedTractPolygon, setPinnedTractPolygon] = useState<{ id: string; coords: [number, number][] | [number, number][][] } | null>(null)
  // Listing meta (county + state) captured when PortalListingDetail
  // finishes its async fetch — used to render the "<County> County,
  // <ST>" subtitle in the slide-out pane header. Cleared whenever
  // mapListingId changes so the subtitle doesn't stale on the next
  // listing's load.
  const [mapListingMeta, setMapListingMeta] = useState<{ county: string; state: string } | null>(null)
  useEffect(() => { setMapListingMeta(null) }, [mapListingId])
  // Deep-link focus: when the Explore map is opened with
  // ?focusLat=&focusLng=&focusZoom= (e.g. the "View on Map" button on
  // the staging screen), zoom there once the map is mounted. Fires a
  // single time so panning away doesn't get yanked back.
  const focusHandledRef = useRef(false)
  useEffect(() => {
    if (focusHandledRef.current || !user) return
    const latStr = searchParams.get('focusLat')
    const lngStr = searchParams.get('focusLng')
    if (!latStr || !lngStr) return
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    const zoom = parseFloat(searchParams.get('focusZoom') || '15')
    focusHandledRef.current = true
    // Set the target immediately. ExploreMap gates its flyTo on its own
    // mapLoaded state, so it will fire as soon as the map is ready (no need
    // to guess a delay here). Auto-clear after a generous window that still
    // covers a slow first map-load, so panning away later isn't yanked back.
    setZoomToLocation({ lat, lng, zoom: Number.isFinite(zoom) ? zoom : 15 })
    setTimeout(() => setZoomToLocation(null), 10000)
  }, [user, searchParams])
  const zoomToFirstTractWithBoundary = (listing: any) => {
    // Also capture county/state for the pane header subtitle.
    if (listing?.county || listing?.state) {
      setMapListingMeta({ county: listing.county || '', state: listing.state || '' })
    }
    // Ring-shape-agnostic: a tract has a boundary if polygon_coordinates
    // normalizes (single ring OR multi-ring list) to >=1 ring with >=3
    // points. A raw `.length >= 3` on the outer array wrongly rejected
    // multi-ring tracts (2 rings < 3 → skipped, map never zooms there).
    const tract = (listing?.tracts || []).find((t: any) =>
      toTractRings(t?.polygon_coordinates).some((r) => r.length >= 3)
    )
    if (tract) {
      setZoomToBoundsSignal({ coords: tract.polygon_coordinates, nonce: Date.now() })
      setPinnedTractPolygon({ id: tract.id, coords: tract.polygon_coordinates })
    }
  }
  const zoomToTractBoundary = (tract: any) => {
    const coords =
      tract?.polygonCoordinates ?? tract?.polygon_coordinates
    // Same ring-shape-agnostic check as zoomToFirstTractWithBoundary above.
    if (toTractRings(coords).some((r) => r.length >= 3)) {
      setZoomToBoundsSignal({ coords, nonce: Date.now() })
      const tractId = tract?.tractId ?? tract?.id
      if (tractId) {
        setPinnedTractPolygon({ id: tractId, coords })
      }
    }
  }
  // AI chat → map filter pipeline (admin only, see render below)
  const [chatAppliedFilters, setChatAppliedFilters] = useState<{ filters: any; clearUnspecified?: boolean; preserveCamera?: boolean; nonce: number } | null>(null)
  // AUDIT FIX (2026-07-10): tracks whether the map's CURRENTLY active
  // filters came from a chat map-filter search and haven't since been
  // overridden by a manual Filter Panel apply. Lives here (not inside
  // MapChatPanel) because this is the one place that sees BOTH apply
  // paths — chat via handleChatApplyFilters below, manual via
  // handleFiltersApplied (ExploreMap's onFiltersApplied callback,
  // fired by both its applyFilters() and resetFilters()). A ref inside
  // MapChatPanel can't see the manual path at all, which was the root
  // cause of a ship-blocker: an analytics/out-of-scope chat answer was
  // silently wiping filters the user had just set by hand in the panel.
  const chatFiltersActiveRef = useRef(false)
  const handleChatApplyFilters = (filters: Record<string, any>, clearUnspecified: boolean, preserveCamera = false) => {
    setChatAppliedFilters({ filters, clearUnspecified, preserveCamera, nonce: Date.now() })
    // Empty filters here means a chat-side "Clear search" — nothing
    // chat-sourced is left active. Non-empty means a real map-filter
    // search just took ownership of the map's filter state.
    chatFiltersActiveRef.current = Object.keys(filters).length > 0
  }
  // Called when a Goat Search response is an ANALYTICS or OUT-OF-SCOPE
  // answer (a report panel, not a map-filter result). That panel must
  // never sit on top of a PREVIOUS chat search's stale bubbles/pins —
  // but if the user has manually applied filters since (or the active
  // filters were never chat-sourced to begin with), those are the
  // user's own and must be left alone. Only reset when this search's
  // own chat filters are still the thing driving the map.
  //
  // LIGHTWEIGHT RESET (audit fix 2026-07-10): do NOT reuse the chat
  // wide-bbox pipeline (onApplyFilters({}, true) → applyExternalFilters)
  // here — that fires a continental-US /api/map/tracts fetch + a
  // nationwide durable-dots refetch + a camera fitBounds SNAP, all
  // behind the report panel, so the map visibly jumps to a different
  // pan/zoom the instant an analytics answer opens. Bumping
  // resetFiltersSignal instead reuses ExploreMap's existing
  // current-viewport-only reset (used today when leaving Comparables
  // mode): filters go back to INITIAL_FILTERS and the normal
  // viewport cell-loader repaints — no wide fetch, no camera move.
  const handleChatReportResult = () => {
    if (chatFiltersActiveRef.current) {
      setResetFiltersSignal(prev => prev + 1)
      chatFiltersActiveRef.current = false
      // The reset above just reverted the map to its unfiltered default,
      // so the active-search bubble must drop with it — otherwise it
      // keeps showing the old query text over a map it no longer
      // describes. Only inside this branch: an owner-parcels search
      // (chatFiltersActiveRef stays false) leaves its blue dots on the
      // map through an analytics answer, so its bubble must survive too
      // or the dots become unclearable.
      setActiveSearchQuery(null)
    }
  }
  // Bumped on every Goat Search submit — kicks off the map's loading
  // animation BEFORE the chat-filter response comes back, so the user
  // sees feedback immediately instead of staring at the still map for
  // ~1-2s while Claude runs.
  const [chatSearchStartSignal, setChatSearchStartSignal] = useState(0)
  const handleChatSearchStart = () => setChatSearchStartSignal(Date.now())
  // Mirror end-signal — ExploreMap stops the loading animation when this
  // changes. Needed because analytics responses don't apply filters,
  // so the map's own wide-bbox completion path never fires.
  const [chatSearchEndSignal, setChatSearchEndSignal] = useState(0)
  const handleChatSearchEnd = () => setChatSearchEndSignal(Date.now())
  // Surfaces a settled-but-unhelpful outcome from the post-chat-search
  // wide-bbox tract fetch — either zero matches ('info') or the fetch
  // itself failing ('err') — by this point the user already saw a
  // "Filters applied" toast from the chat-filter call succeeding, so
  // without this the map silently never updates and looks broken with
  // no explanation.
  const [chatMapError, setChatMapError] = useState<{ message: string; nonce: number; kind: 'info' | 'err' } | null>(null)
  const handleChatSearchError = (message: string, kind: 'info' | 'err' = 'err') =>
    setChatMapError({ message, nonce: Date.now(), kind })
  // Owner "show on map" chat search: renders the owner's parcels as
  // dots + zooms to them. `nonce` lets the same owner retrigger a
  // fitBounds if searched twice in a row.
  const [ownerParcelsResult, setOwnerParcelsResult] = useState<{
    data: OwnerParcelsResponse
    reply: string
    nonce: number
  } | null>(null)
  const handleOwnerParcels = (data: OwnerParcelsResponse, reply: string) => {
    setOwnerParcelsResult({ data, reply, nonce: Date.now() })
  }
  // Active Goat Search bubble (designer spec 2026-07-24) — replaces the
  // old owner chip (ExploreMap.tsx) and MapChatPanel's own "Clear search"
  // pill with one unified bubble. Set ONLY from MapChatPanel's
  // onSearchQueryStart, which itself only fires for the two branches of
  // submit() that actually change the map (owner_parcels_response and a
  // non-empty applied_filters) — never for analytics/out-of-scope/error,
  // which leave no map state for the bubble's X to clear.
  const [activeSearchQuery, setActiveSearchQuery] = useState<string | null>(null)
  // Bubble's X button: clears the bubble AND resets the map's
  // chat-applied filters. handleChatApplyFilters({}, true) bumps
  // chatAppliedFilters' nonce, which ExploreMap's applyExternalFilters
  // effect reacts to — that effect already calls clearOwnerParcels() and
  // resets filters to INITIAL_FILTERS, which (with the owner-search
  // display gate in ExploreMap) also restores every tract-pin/parcel-dot
  // layer an owner search had hidden.
  // preserveCamera: clear the search but leave the camera alone. The
  // bubble's X keeps the default (false); Find Comps passes true.
  const clearActiveSearch = (preserveCamera = false) => {
    setActiveSearchQuery(null)
    handleChatApplyFilters({}, true, preserveCamera)
  }
  // Comparables mode
  const [resetFiltersSignal, setResetFiltersSignal] = useState(0)
  const [subjectTractId, setSubjectTractId] = useState<string | null>(null)
  const [subjectTractLocation, setSubjectTractLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [comparablesSubjectInfo, setComparablesSubjectInfo] = useState<any>(null)
  const [showComparablesReportPanel, setShowComparablesReportPanel] = useState(false)
  const [showMainReportPanel, setShowMainReportPanel] = useState(false)
  // 3D viewer state
  const [showReportPanel, setShowReportPanel] = useState(false)
  const [show3DViewer, setShow3DViewer] = useState(false)
  const [viewer3DTractId, setViewer3DTractId] = useState('')
  const [viewer3DTractName, setViewer3DTractName] = useState('')

  // Auth check
  useEffect(() => {
    checkAuth()
  }, [])

  // Fetch analytics for home county on load + watchlist
  useEffect(() => {
    if (user) {
      if (user.home_county && user.home_state) {
        fetchAnalytics(user.home_county, user.home_state)
      }
      fetchWatchlist()
    }
  }, [user])

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.replace('/')
        return
      }

      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)
      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()

      if (!ALLOWED_ROLES.includes(userData.account_type)) {
        router.replace('/')
        return
      }

      setUser(userData)
    } catch {
      router.replace('/')
    } finally {
      setAuthLoading(false)
    }
  }

  const fetchListings = async (tab: TabType, filtersOverride?: { stateFilter: string; countyFilters: string[] }) => {
    if (tab === 'map') return
    setListingsLoading(true)
    const filters = filtersOverride || activeFilters
    try {
      let data: Listing[] = []

      if (tab === 'auctions') {
        const response = await fetchWithAuth(`${API_URL}/api/listings/upcoming/auctions`)
        if (response.ok) data = await response.json()
      } else if (tab === 'results') {
        const response = await fetchWithAuth(`${API_URL}/api/listings/recent/results?listing_type=auction`)
        if (response.ok) {
          const resultsData = await response.json()
          data = (resultsData as Listing[]).filter((l: Listing) =>
            ['sold', 'no_sale', 'pending'].includes(l.status)
          )
        }
      } else if (tab === 'private_treaty') {
        const response = await fetchWithAuth(`${API_URL}/api/listings?listing_type=private_treaty&status=listed,live&limit=100&offset=0`)
        if (response.ok) {
          data = await response.json()
          if (user?.home_state && user?.home_county) {
            data = data.map(listing => ({
              ...listing,
              _distance: getDistanceToCounty(user.home_state!, user.home_county!, listing.state, listing.county) ?? 999999,
            })).sort((a, b) => (a._distance ?? 999999) - (b._distance ?? 999999))
          }
        }
      }

      // Apply filters (state/county) client-side
      if (filters.stateFilter) {
        const states = filters.stateFilter.split(',').map(s => s.trim().toUpperCase())
        data = data.filter(l => states.includes(l.state?.toUpperCase()))
      }
      if (filters.countyFilters.length > 0) {
        const counties = filters.countyFilters.map(c => c.toLowerCase())
        data = data.filter(l => counties.includes(l.county?.toLowerCase()))
      }

      setListings(data)
    } catch (err) {
      console.error('Failed to fetch listings:', err)
    } finally {
      setListingsLoading(false)
    }
  }

  const fetchWatchlist = async () => {
    setWatchlistLoading(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/watchlist`)
      if (res.ok) {
        const data = await res.json()
        // PT hidden 2026-07-20, reversible — guard against a previously-
        // favorited PT listing still showing up client-side.
        const filtered = SHOW_PRIVATE_TREATY
          ? data
          : data.filter((w: any) => w.listing?.listing_type !== 'private_treaty')
        const ids = new Set<string>(filtered.map((w: any) => String(w.listing_id || w.listing?.id)))
        const listings = filtered.map((w: any) => w.listing).filter(Boolean)
        setWatchlistIds(ids)
        setWatchlistListings(listings)
      } else {
        console.error('Watchlist fetch failed:', res.status)
      }
    } catch (err) {
      console.error('Watchlist fetch error:', err)
    } finally {
      setWatchlistLoading(false)
    }
  }

  const handleToggleWatchlist = async (listingId: string) => {
    if (watchTogglePendingRef.current.has(listingId)) return
    watchTogglePendingRef.current.add(listingId)

    const wasWatched = watchlistIds.has(listingId)

    // Optimistic update
    setWatchlistIds(prev => {
      const next = new Set(prev)
      wasWatched ? next.delete(listingId) : next.add(listingId)
      return next
    })

    try {
      if (wasWatched) {
        const res = await fetchWithAuth(`${API_URL}/api/watchlist/${listingId}`, { method: 'DELETE' })
        if (!res.ok) {
          const errText = await res.text().catch(() => '')
          console.error('Watchlist DELETE failed:', res.status, errText)
          throw new Error('Delete failed')
        }
        setWatchlistListings(prev => prev.filter(l => l.id !== listingId))
      } else {
        const res = await fetchWithAuth(`${API_URL}/api/watchlist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listing_id: listingId }),
        })
        if (!res.ok) {
          // Ignore "Already watching" — it means it worked on a previous attempt
          const errText = await res.text().catch(() => '')
          if (res.status === 400 && errText.includes('Already watching')) {
            // already watching — no-op
          } else {
            console.error('Watchlist POST failed:', res.status, errText)
            throw new Error('Add failed')
          }
        }
        // Re-fetch to get full listing data
        await fetchWatchlist()
      }
    } catch (err) {
      console.error('Watchlist toggle error:', err)
      // Rollback
      setWatchlistIds(prev => {
        const next = new Set(prev)
        wasWatched ? next.add(listingId) : next.delete(listingId)
        return next
      })
    } finally {
      watchTogglePendingRef.current.delete(listingId)
    }
  }

  const fetchAnalytics = async (county: string, state: string) => {
    setAnalyticsLoading(true)
    try {
      const params = new URLSearchParams({ county, state })
      const response = await fetchWithAuth(`${API_URL}/api/admin/county-sales-detail?${params}`)
      if (response.ok) {
        const data = await response.json()
        setAnalyticsData(data)
      }
    } catch {
      // Silent fail
    } finally {
      setAnalyticsLoading(false)
    }
  }

  const handleToggleReport = (tract: TractSaleData) => {
    const isAdding = !reportIds.has(tract.id)
    // Both updaters are PURE and independent. They used to be nested —
    // setReportTracts was called from inside the setReportIds updater —
    // which is a side effect in a place React is allowed to run twice.
    // Under StrictMode it does exactly that, so one click appended the
    // tract to the array twice while the Set (idempotent) took it once:
    // the report showed "2 SALES" for a single parcel, both rows
    // identical. Verified 2026-08-17 in the browser on the comp-mode
    // add path. Do not nest these again.
    setReportIds(prev => {
      const next = new Set(prev)
      if (isAdding) next.add(tract.id)
      else next.delete(tract.id)
      return next
    })
    setReportTracts(prev => (
      isAdding
        // Guarded rather than a bare append: makes the add idempotent so
        // a double-invoke can never duplicate a row again, whatever the
        // caller does.
        ? (prev.some(t => t.id === tract.id) ? prev : [...prev, tract])
        : prev.filter(t => t.id !== tract.id)
    ))
    // Auto-open report panel when adding from main map (not comparables mode)
    if (isAdding && !showComparablesReportPanel) {
      setShowMainReportPanel(true)
    }
  }

  const handleView3DTerrain = (tractId: string, tractName: string) => {
    setViewer3DTractId(tractId)
    setViewer3DTractName(tractName)
    setShow3DViewer(true)
  }

  const handleCreateReport = () => {
    setShowReportPanel(true)
  }

  const handleRemoveFromReport = (tractId: string) => {
    setReportIds(prev => {
      const next = new Set(prev)
      next.delete(tractId)
      return next
    })
    setReportTracts(prev => prev.filter(t => t.id !== tractId))
  }

  // Close all left-side panels to prevent overlap
  const closeAllLeftPanels = () => {
    setShowListPanel(false)
    setMapListingId(null)
    setSelectedTract(null)
    setShowWatchlistPanel(false)
    setShowComparablesReportPanel(false)
    setShowReportPanel(false)
  }

  const handleViewListingFromMap = (listingId: string) => {
    // In comparables mode, layer the listing detail on top of the comp
    // report panel (z-520 over z-400) instead of tearing the comp panel
    // down. Otherwise: clicking "View Details" on a comp popup closes
    // the comp report; Back-to-list then has no comp report to return
    // to, and the close-on-comp-report can't exit comp mode because
    // the panel is already gone.
    if (showComparablesReportPanel) {
      setShowListPanel(false)
      setSelectedTract(null)
      setShowWatchlistPanel(false)
      setShowReportPanel(false)
      setMapListingId(listingId)
      return
    }
    closeAllLeftPanels()
    setMapListingId(listingId)
  }

  const handleTractSelected = (tract: any) => {
    // Just open the tract detail — it sits above everything else via z-index
    setSelectedTract(tract as TractSaleData)
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    // Close comparables mode first (it also resets map)
    if (showComparablesReportPanel) handleCloseComparables()
    closeAllLeftPanels()
    if (tab !== 'map') {
      setShowListPanel(true)
      fetchListings(tab)
    }
  }

  const handleFilterToggle = () => {
    setFilterOpen(!filterOpen)
  }

  const [comparablesLoading, setComparablesLoading] = useState(false)

  const handleFindComparables = async (tractId: string, county: string, state: string) => {
    // Show loading, close other panels, switch to map
    setComparablesLoading(true)
    setMapListingId(null)
    setSelectedTract(null)
    setShowListPanel(false)
    setShowReportPanel(false)
    // Hide the generic "main map" report panel — otherwise it would
    // silently sit underneath the comparables panel and re-appear when
    // the user closes comp mode, with subjectInfo=null (no subject card).
    setShowMainReportPanel(false)
    setActiveTab('map')
    setSubjectTractId(tractId)
    // Clear any explore-map status filter (Live/Listed pill) before
    // entering comp mode — otherwise a stale non-sold status survives
    // into the comp query. ExploreMap's own comp-mode override only
    // fires per-fetch inside loadTractsForBounds, which is a second
    // layer of defense; this reset is the one that actually clears the
    // pill's visible/active state instead of just overriding the param.
    // Same signal handleCloseComparables already uses to reset the map
    // cache when LEAVING comp mode.
    setResetFiltersSignal(prev => prev + 1)
    // Clear the Goat Search exactly the way the chip's X does. The owner
    // established the behaviour empirically: with a search active the comp
    // "+" dots don't render, and clicking the X makes them appear. So do
    // literally that, rather than reimplementing the teardown — earlier
    // attempts reset filter state by hand and never reproduced what this
    // call actually achieves (it routes through handleChatApplyFilters with
    // clearUnspecified, which rebuilds from INITIAL_FILTERS and commits
    // draft + applied together).
    // true = clear the search WITHOUT the wide-bbox refit, which would
    // otherwise fit the camera to every result in the country.
    clearActiveSearch(true)

    // Fetch subject tract info for the panel header
    try {
      const compResponse = await fetchWithAuth(`${API_URL}/api/comparables/tract/${tractId}?months_back=24&include_neighboring=true&limit=1`)
      if (compResponse.ok) {
        const compData = await compResponse.json()
        // Carry tract_id + listing_id forward so the report panel can include
        // them in the email/download payload — backend uses tract_id to fetch
        // the subject's polygon, satellite image, and DEM grid for the PDF.
        const sc = compData.search_criteria || {}
        setComparablesSubjectInfo({
          ...sc,
          county: sc.county || county,
          state: sc.state || state,
          tract_id: tractId,
          listing_id: sc.listing_id || null,
        })

        const subLat = compData.search_criteria?.subject_latitude
        const subLng = compData.search_criteria?.subject_longitude
        if (subLat && subLng) {
          setSubjectTractLocation({ lat: subLat, lng: subLng })
        }

        // Zoom to 11 (the real Regrid source floor — verified against
        // their CDN: z10 returns HTTP 204/empty, z11 returns tiles) so
        // the parcel outlines + "+" comp markers render immediately.
        // Centered on the subject tract.
        const zoomTarget = subLat && subLng
          ? { lat: subLat, lng: subLng, zoom: 13 }
          : (() => {
              const coords = getCountyCoordinates(state, county)
              return coords ? { lat: coords.latitude, lng: coords.longitude, zoom: 12 } : null
            })()

        if (zoomTarget) {
          setZoomToLocation(null)
          setTimeout(() => {
            setZoomToLocation(zoomTarget)
            setTimeout(() => setZoomToLocation(null), 3000)
          }, 100)
        }
      } else {
        setComparablesSubjectInfo({ county, state, tract_id: tractId })
      }
    } catch (err) {
      console.error('Failed to fetch subject info:', err)
      setComparablesSubjectInfo({ county, state, tract_id: tractId })
    }

    // Clear existing report and show the new panel
    setReportIds(new Set())
    setReportTracts([])
    setShowComparablesReportPanel(true)
    setComparablesLoading(false)
  }

  // Deep-link into comp mode: ?comparablesTractId=&county=&state= (e.g. the
  // "Find Comparables" link on a listing, or the retired
  // /listings/[id]/comparables route redirecting here) opens the REAL comp
  // map — mirrors the focusLat/focusLng pattern above. Fires a single time
  // so it doesn't re-trigger if the user closes comp mode and the params
  // are still in the URL.
  const comparablesParamHandledRef = useRef(false)
  useEffect(() => {
    if (comparablesParamHandledRef.current || !user) return
    const tractId = searchParams.get('comparablesTractId')
    if (!tractId) return
    const county = searchParams.get('county') || ''
    const state = searchParams.get('state') || ''
    comparablesParamHandledRef.current = true
    handleFindComparables(tractId, county, state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, searchParams])

  const handleCloseComparables = () => {
    setSubjectTractId(null)
    setSubjectTractLocation(null)
    setComparablesSubjectInfo(null)
    setShowComparablesReportPanel(false)
    // Clear the generic main-map report panel as well; otherwise it
    // would slide in to replace the comp panel because both render the
    // same component (subjectInfo=null), making "close" look broken and
    // hiding the subject card.
    setShowMainReportPanel(false)
    setReportIds(new Set())
    setReportTracts([])
    // Reset map cache so regular tracts reload
    setResetFiltersSignal(prev => prev + 1)
  }

  const handleFiltersApplied = (filters: { stateFilter: string; countyFilters: string[] }) => {
    setActiveFilters(filters)
    // AUDIT FIX (2026-07-10): ExploreMap fires onFiltersApplied from
    // BOTH its manual applyFilters() and its own resetFilters() — either
    // way, the user just took an explicit action in the Filter Panel,
    // so whatever was chat-sourced before no longer reflects the map's
    // active filters. Prevents a later analytics/out-of-scope chat
    // answer from wiping filters the user just set by hand.
    chatFiltersActiveRef.current = false
    // Re-fetch listings with new filters if list panel is open
    if (showListPanel && activeTab !== 'map') {
      fetchListings(activeTab, filters)
    }
  }

  const handleAnalyticsDataLoad = (data: AnalyticsData | null) => {
    if (data) setAnalyticsData(data)
  }

  // Loading state
  if (authLoading) {
    return (
      <div className="h-screen w-screen bg-gg-black flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin text-gg-pink mx-auto mb-3" size={32} />
          <p className="text-sm text-gg-gray-400">Loading portal...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  // Whether any left panel is showing
  const hasLeftPanel = showListPanel || !!mapListingId || !!selectedTract

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-gg-black">
      {/* Full-screen Map */}
      <div className="absolute inset-0">
        <ExploreMap
          height="100vh"
          homeState={user.home_state}
          homeCounty={user.home_county}
          portalMode={true}
          externalFilterOpen={filterOpen}
          onFilterOpenChange={setFilterOpen}
          onViewListing={handleViewListingFromMap}
          onTractSelected={handleTractSelected}
          externalTractSelection={selectedTract}
          onLandDetailOpen={() => setSelectedTract(null)}
          onToggleReport={(tract) => handleToggleReport(tract as unknown as TractSaleData)}
          onView3DTerrain={handleView3DTerrain}
          isInReport={(id) => reportIds.has(id)}
          reportIds={reportIds}
          onFiltersApplied={handleFiltersApplied}
          zoomToLocation={zoomToLocation}
          zoomToBoundsSignal={zoomToBoundsSignal}
          pinnedTractPolygon={pinnedTractPolygon}
          subjectTractId={subjectTractId}
          subjectTractLocation={subjectTractLocation}
          resetFiltersSignal={resetFiltersSignal}
          applyExternalFilters={chatAppliedFilters}
          chatSearchStartSignal={chatSearchStartSignal}
          chatSearchEndSignal={chatSearchEndSignal}
          onChatSearchError={handleChatSearchError}
          ownerParcelsResult={ownerParcelsResult}
          comparableVisibleIds={null}
          neighborParcels={neighborParcels}
          neighborsLoading={neighborsLoading}
        />
      </div>

      {/* Floating Logo (separate from nav bar) */}
      <Link
        href="/access"
        className="fixed top-3 left-4 z-[390]"
      >
        <img src="/logo-transparent.png" alt="Ground Goat" style={{ width: 140, height: 'auto', filter: 'drop-shadow(0 3px 12px rgba(0,0,0,0.7)) drop-shadow(0 1px 4px rgba(0,0,0,0.5))' }} />
      </Link>

      {/* Floating Nav Bar (shifted right to make room for logo) */}
      <PortalNavBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onFilterToggle={handleFilterToggle}
        filterOpen={filterOpen}
        onAnalyticsToggle={() => setShowAnalyticsPanel(!showAnalyticsPanel)}
        analyticsOpen={showAnalyticsPanel}
        onWatchlistToggle={() => setShowWatchlistPanel(!showWatchlistPanel)}
        watchlistOpen={showWatchlistPanel}
        watchlistCount={watchlistIds.size}
        user={user}
      />

      {/* Left Panel: Listing List */}
      <AnimatePresence>
        {showListPanel && activeTab !== 'map' && (
          <PortalListPanel
            listings={listings}
            loading={listingsLoading}
            activeTab={activeTab as 'auctions' | 'private_treaty' | 'results'}
            onClose={() => {
              setShowListPanel(false)
              setActiveTab('map')
            }}
            onTractSelected={(tract) => {
              setSelectedTract(tract as TractSaleData)
              zoomToTractBoundary(tract)
            }}
            onListingLoaded={zoomToFirstTractWithBoundary}
            onFindComparables={handleFindComparables}
            activeFilters={activeFilters}
            onClearFilters={() => {
              setActiveFilters({ stateFilter: '', countyFilters: [] })
              setResetFiltersSignal(prev => prev + 1)
            }}
            userAccountType={user?.account_type}
            watchlistIds={watchlistIds}
            onToggleWatchlist={handleToggleWatchlist}
          />
        )}
      </AnimatePresence>

      {/* Right Panel: Analytics */}
      <AnimatePresence>
        {showAnalyticsPanel && (
          <PortalAnalyticsPanel
            county=""
            state=""
            onClose={() => setShowAnalyticsPanel(false)}
            onDataLoad={handleAnalyticsDataLoad}
          />
        )}
      </AnimatePresence>

      {/* Map Listing Detail Panel (from clicking "View Listing" on a map tract) */}
      <AnimatePresence>
        {mapListingId && !showListPanel && (
          <motion.div
            initial={{ x: -500 }}
            animate={{ x: 0 }}
            exit={{ x: -500 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 left-0 bottom-0 w-[480px] z-[520] bg-black border-r border-white/10 shadow-2xl flex flex-col"
          >
            {/* Header matches the Tract Detail pane: Back button left
                of a bold "Listing Detail" title with the listing's
                "<County> County, <ST>" subtitle underneath. The
                subtitle appears once the async fetch in
                PortalListingDetail fires onListingLoaded (~300ms
                after open); until then it's blank. */}
            <div className="pt-8 px-5 pb-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMapListingId(null)}
                  aria-label="Back"
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gg-gray-300 hover:text-white transition shrink-0"
                >
                  <ArrowLeft size={16} />
                </button>
                <h2 className="text-lg font-bold text-white">Listing Detail</h2>
              </div>
              {mapListingMeta?.county && (
                <p className="text-sm text-white mt-1 ml-11">
                  {mapListingMeta.county} County{mapListingMeta.state ? `, ${mapListingMeta.state}` : ''}
                </p>
              )}
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <PortalListingDetail
                listingId={mapListingId}
                onBack={() => setMapListingId(null)}
                onTractSelected={(tract) => {
                  setSelectedTract(tract as TractSaleData)
                  zoomToTractBoundary(tract)
                }}
                onListingLoaded={zoomToFirstTractWithBoundary}
                onFindComparables={handleFindComparables}
                userAccountType={user?.account_type}
                isWatchlisted={watchlistIds.has(mapListingId!)}
                onToggleWatchlist={handleToggleWatchlist}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tract Detail Slide-out (from clicking map tract or tract in listing detail) */}
      <AnimatePresence>
        {selectedTract && (
          <motion.div
            initial={{ x: -500 }}
            animate={{ x: 0 }}
            exit={{ x: -500 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed top-0 left-0 bottom-0 w-[480px] z-[530] bg-black border-r border-white/10 shadow-2xl flex flex-col"
          >
            {/* Header: [← Back]  Tract Detail
                              <County> County, <ST>
                Back button sits on the same row as the title (left of
                the bold pane name), with the situs location on its own
                line right beneath in white for visibility. */}
            <div className="pt-8 px-5 pb-4 border-b border-white/5 shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedTract(null)}
                  aria-label="Back"
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-gg-gray-300 hover:text-white transition shrink-0"
                >
                  <ArrowLeft size={16} />
                </button>
                <h2 className="text-lg font-bold text-white">Tract Detail</h2>
              </div>
              <p className="text-sm text-white mt-1 ml-11">
                {selectedTract.county} County{selectedTract.state ? `, ${selectedTract.state}` : ''}
              </p>
            </div>
            {/* Scrollable content. pb-0 lets the action-bar's gradient
                overlay reach right to the buttons without an extra gap. */}
            <div className="flex-1 overflow-y-auto px-5 pt-4 pb-0">
              <PortalTractDetail
                tract={selectedTract}
                onBack={() => setSelectedTract(null)}
                onViewListing={(listingId) => {
                  setSelectedTract(null)
                  setMapListingId(listingId)
                }}
                onView3DTerrain={handleView3DTerrain}
                /* Report actions are premium (owner 2026-08-17): passing undefined
                   hides "+ Report" entirely, matching the parcel panel and the
                   mobile tract sheet, which already gate on premium access. */
                onToggleReport={!canUseReportsFor(user) ? undefined : (tract) => {
                  handleToggleReport(tract)
                  // Close tract detail panel after adding/removing from report
                  setSelectedTract(null)
                }}
                isInReport={reportIds.has(selectedTract.id)}
                onShowNeighbors={setNeighborParcels}
                onNeighborsLoadingChange={setNeighborsLoading}
                showNeighborsButton={user?.account_type === 'groundgoat_admin'}
                onFindComparables={handleFindComparables}
              />
            </div>
            {/* Action buttons as a TRUE footer of the slide-out — outside
                the scroll area, pinned to the bottom of the pane. */}
            <TractDetailActionBar
              tract={selectedTract}
              onView3DTerrain={handleView3DTerrain}
              /* Report actions are premium (owner 2026-08-17): passing undefined
                 hides "+ Report" entirely, matching the parcel panel and the
                 mobile tract sheet, which already gate on premium access. */
              onToggleReport={(!canUseReportsFor(user) && !subjectTractId) ? undefined : (tract) => {
                handleToggleReport(tract)
                setSelectedTract(null)
              }}
              isInReport={reportIds.has(selectedTract.id)}
              onViewListing={(listingId) => {
                setSelectedTract(null)
                setMapListingId(listingId)
              }}
              onFindComparables={handleFindComparables}
              /* Comp mode (2026-08-17): a tract "+" now opens THIS
                 slide-out instead of the old inline popup, narrowed to
                 the popup's three actions. `subjectTractId` is the same
                 signal ExploreMap uses to turn dots into "+" pickers, so
                 map and panel can't disagree about the mode.
                 Note the `&& !subjectTractId` above: the popup's Add to
                 Report was never premium-gated, so gating it here would
                 remove the only way to add a comparable for anyone who
                 reached comp mode without the flag. */
              compMode={Boolean(subjectTractId)}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparables Loading Overlay */}
      {comparablesLoading && (
        <div className="fixed inset-0 z-[600] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-gg-gray-900 rounded-2xl p-8 border border-white/10 text-center shadow-2xl">
            <Loader2 className="animate-spin text-gg-pink mx-auto mb-3" size={36} />
            <p className="text-sm font-medium">Loading Subject Tract...</p>
            <p className="text-xs text-gg-gray-400 mt-1">Preparing comparable sales view</p>
          </div>
        </div>
      )}

      {/* Comparables Report Panel (left side) */}
      <AnimatePresence>
        {showComparablesReportPanel && (
          <PortalComparablesReportPanel
            subjectInfo={comparablesSubjectInfo}
            reportTracts={reportTracts}
            onRemoveTract={(id) => {
              setReportIds(prev => { const next = new Set(prev); next.delete(id); return next })
              setReportTracts(prev => prev.filter(t => t.id !== id))
            }}
            onClose={handleCloseComparables}
            onView3DTerrain={handleView3DTerrain}
            onViewListing={(listingId) => setMapListingId(listingId)}
          />
        )}
      </AnimatePresence>

      {/* Watchlist Panel */}
      <AnimatePresence>
        {showWatchlistPanel && (
          <PortalWatchlistPanel
            listings={watchlistListings}
            loading={watchlistLoading}
            onClose={() => setShowWatchlistPanel(false)}
            onRemoveListing={handleToggleWatchlist}
            onSelectListing={(listingId) => {
              closeAllLeftPanels()
              setMapListingId(listingId)
            }}
          />
        )}
      </AnimatePresence>

      {/* Report Panel */}
      <AnimatePresence>
        {showReportPanel && (
          <PortalReportPanel
            tracts={reportTracts}
            onClose={() => setShowReportPanel(false)}
            onRemoveTract={handleRemoveFromReport}
            subjectInfo={comparablesSubjectInfo}
          />
        )}
      </AnimatePresence>

      {/* Main Map Report Panel (left side, no subject tract) */}
      <AnimatePresence>
        {showMainReportPanel && !showComparablesReportPanel && (
          <PortalComparablesReportPanel
            subjectInfo={null}
            reportTracts={reportTracts}
            onRemoveTract={(id) => {
              setReportIds(prev => { const next = new Set(prev); next.delete(id); return next })
              setReportTracts(prev => prev.filter(t => t.id !== id))
            }}
            onClose={() => {
              setShowMainReportPanel(false)
              setReportIds(new Set())
              setReportTracts([])
            }}
            onView3DTerrain={handleView3DTerrain}
            onViewListing={(listingId) => setMapListingId(listingId)}
          />
        )}
      </AnimatePresence>

      {/* 3D Terrain Viewer */}
      <Tract3DModal
        tractId={viewer3DTractId}
        tractName={viewer3DTractName}
        isOpen={show3DViewer}
        onClose={() => setShow3DViewer(false)}
      />

      {/* AI Map Search — gated on the backend's can_use_goat_search flag,
          with the admin account_type check kept as an OR fallback so
          admins never lose access if the backend flag isn't present yet
          (deploy-order safety: this frontend change can ship before the
          backend starts sending the field). */}
      {/* HIDDEN IN COMP MODE (owner ruling 2026-08-06). Goat Search fights
          the comparables flow in two ways: a search refits the camera to
          all of its results, throwing the user off the subject tract; and
          most queries set filters a parcel tile cannot answer (soil rating,
          land type, keyword), which hides the comp dots wholesale via
          shouldHideParcelDotsForFilters — leaving a comp map with nothing
          to click and no visible reason why.

          Nothing is lost: the Filters panel stays available in comp mode and
          narrows the dots correctly (county, acreage, price, date). Find
          Comps already clears any active search on entry, so hiding the
          panel here can't strand a search the user can no longer reach. */}
      {!subjectTractId &&
        (user?.can_use_goat_search || user?.account_type === 'groundgoat_admin') && (
        <MapChatPanel
          onApplyFilters={handleChatApplyFilters}
          onChatReportResult={handleChatReportResult}
          onSearchStart={handleChatSearchStart}
          onSearchEnd={handleChatSearchEnd}
          mapSearchError={chatMapError}
          onOwnerParcels={handleOwnerParcels}
          onSearchQueryStart={setActiveSearchQuery}
          activeSearchQuery={activeSearchQuery}
          clearActiveSearch={clearActiveSearch}
          hasActiveFilters={
            !!chatAppliedFilters?.filters &&
            Object.keys(chatAppliedFilters.filters).length > 0
          }
          currentFilters={chatAppliedFilters?.filters}
        />
      )}
    </div>
  )
}

export default function AccessPortalPage() {
  return (
    <Suspense fallback={null}>
      <AccessPortalPageInner />
    </Suspense>
  )
}