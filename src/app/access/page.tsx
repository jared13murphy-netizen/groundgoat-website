'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, BarChart3 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { getDistanceToCounty, getCountyCoordinates } from '@/data/countyCoordinates'
import PortalNavBar from '@/components/portal/PortalNavBar'
import PortalKPICards from '@/components/portal/PortalKPICards'
import PortalListPanel from '@/components/portal/PortalListPanel'
import PortalAnalyticsPanel from '@/components/portal/PortalAnalyticsPanel'
import PortalListingDetail from '@/components/portal/PortalListingDetail'
import PortalTractDetail from '@/components/portal/PortalTractDetail'
import PortalComparablesPanel from '@/components/portal/PortalComparablesPanel'
import PortalReportPanel from '@/components/portal/PortalReportPanel'
import PortalWatchlistPanel from '@/components/portal/PortalWatchlistPanel'
import type { TractSaleData } from '@/components/portal/PortalTractDetail'

const ExploreMap = dynamic(() => import('@/components/map/ExploreMap'), { ssr: false })
const Tract3DModal = dynamic(() => import('@/components/Tract3DModal'), { ssr: false })

const API_URL = 'https://practical-serenity-production.up.railway.app'

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

export default function AccessPortalPage() {
  const router = useRouter()
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
  // Comparables mode
  const [resetFiltersSignal, setResetFiltersSignal] = useState(0)
  const [subjectTractId, setSubjectTractId] = useState<string | null>(null)
  const [subjectTractLocation, setSubjectTractLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [comparablesData, setComparablesData] = useState<any>(null)
  const [showComparablesPanel, setShowComparablesPanel] = useState(false)
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
        console.log('Watchlist API response:', data.length, 'items', data.length > 0 ? JSON.stringify(data[0]).slice(0, 200) : 'empty')
        const ids = new Set<string>(data.map((w: any) => String(w.listing_id || w.listing?.id)))
        const listings = data.map((w: any) => w.listing).filter(Boolean)
        console.log('Watchlist IDs:', Array.from(ids))
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
            console.log('Already on watchlist, ignoring')
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
    setReportIds(prev => {
      const next = new Set(prev)
      if (next.has(tract.id)) {
        next.delete(tract.id)
        setReportTracts(prev => prev.filter(t => t.id !== tract.id))
      } else {
        next.add(tract.id)
        setReportTracts(prev => [...prev, tract])
      }
      return next
    })
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
    setShowComparablesPanel(false)
    setShowReportPanel(false)
  }

  const handleViewListingFromMap = (listingId: string) => {
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
    if (showComparablesPanel) handleCloseComparables()
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
    // Show loading state, close panels, switch to map, clear filters
    setComparablesLoading(true)
    setMapListingId(null)
    setSelectedTract(null)
    setShowListPanel(false)
    setActiveTab('map')
    setSubjectTractId(tractId)
    setActiveFilters({ stateFilter: '', countyFilters: [] })
    setResetFiltersSignal(prev => prev + 1)

    try {
      // Fetch scored comparables AND all state sales in parallel
      // First fetch scored comparables to get subject tract coordinates
      const compResponse = await fetchWithAuth(`${API_URL}/api/comparables/tract/${tractId}?months_back=24&include_neighboring=true&limit=50`)
      const compData = compResponse.ok ? await compResponse.json() : { comparables: [], summary: { count: 0, avg_price_per_acre: 0, median_price_per_acre: 0, min_price_per_acre: 0, max_price_per_acre: 0, avg_acres: 0 }, search_criteria: { county, state } }

      // Use subject coordinates for distance-sorted state sales
      const subLat = compData.search_criteria?.subject_latitude
      const subLng = compData.search_criteria?.subject_longitude
      const latLngParams = subLat && subLng ? `&lat=${subLat}&lng=${subLng}` : ''
      const salesResponse = await fetchWithAuth(`${API_URL}/api/comparables/state-sales/${state}?county=${encodeURIComponent(county)}&months_back=24&neighbor_depth=2&limit=2000${latLngParams}`)

      if (!compResponse.ok) {
        console.error('Comparables API error:', compResponse.status)
      }

      const salesData = salesResponse.ok ? await salesResponse.json() : { tracts: [] }

      // Merge: attach similarity scores from scored comps to the full sales dataset
      const scoreMap = new Map<string, number>()
      for (const c of compData.comparables) {
        scoreMap.set(String(c.id), c.similarity_score ?? 0)
      }

      // Build all_tracts from state-sales, enriched with similarity scores — only tracts with boundaries
      const allTracts = (salesData.tracts || [])
        .filter((t: any) => t.polygon_coordinates && Array.isArray(t.polygon_coordinates) && t.polygon_coordinates.length >= 3)
        .map((t: any) => ({
          ...t,
          similarity_score: scoreMap.get(String(t.id)) ?? null,
        }))

      // Store both datasets — panel will use allTracts for sorting/filtering
      const mergedData = {
        ...compData,
        all_tracts: allTracts,
      }

      setComparablesData(mergedData)
      setShowComparablesPanel(true)

      if (compResponse.ok) {
        // Zoom to subject tract location
        if (subLat && subLng) {
          setSubjectTractLocation({ lat: subLat, lng: subLng })
        }

        const zoomTarget = subLat && subLng
          ? { lat: subLat, lng: subLng, zoom: 11 }
          : (() => {
              const coords = getCountyCoordinates(state, county)
              return coords ? { lat: coords.latitude, lng: coords.longitude, zoom: 10 } : null
            })()

        if (zoomTarget) {
          setZoomToLocation(null)
          setTimeout(() => {
            setZoomToLocation(zoomTarget)
            setTimeout(() => setZoomToLocation(null), 3000)
          }, 100)
        }
      }
    } catch (err) {
      console.error('Failed to fetch comparables:', err)
    } finally {
      setComparablesLoading(false)
    }
  }

  const handleCloseComparables = () => {
    setSubjectTractId(null)
    setSubjectTractLocation(null)
    setComparablesData(null)
    setShowComparablesPanel(false)
    // Reset map cache so regular tracts reload
    setResetFiltersSignal(prev => prev + 1)
  }

  const handleFiltersApplied = (filters: { stateFilter: string; countyFilters: string[] }) => {
    setActiveFilters(filters)
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
          onToggleReport={(tract) => handleToggleReport(tract as unknown as TractSaleData)}
          onView3DTerrain={handleView3DTerrain}
          isInReport={(id) => reportIds.has(id)}
          reportIds={reportIds}
          onFiltersApplied={handleFiltersApplied}
          zoomToLocation={zoomToLocation}
          subjectTractId={subjectTractId}
          subjectTractLocation={subjectTractLocation}
          resetFiltersSignal={resetFiltersSignal}
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
            onTractSelected={setSelectedTract}
            onFindComparables={handleFindComparables}
            activeFilters={activeFilters}
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
            className="fixed top-0 left-0 bottom-0 w-[480px] z-[520] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
          >
            <div className="pt-8 px-5 pb-4 border-b border-white/5 shrink-0">
              <h2 className="text-lg font-semibold">Listing Detail</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <PortalListingDetail
                listingId={mapListingId}
                onBack={() => setMapListingId(null)}
                onTractSelected={setSelectedTract}
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
            className="fixed top-0 left-0 bottom-0 w-[480px] z-[530] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
          >
            <div className="pt-8 px-5 pb-4 border-b border-white/5 shrink-0">
              <h2 className="text-lg font-semibold">Tract Detail</h2>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <PortalTractDetail
                tract={selectedTract}
                onBack={() => setSelectedTract(null)}
                onViewListing={(listingId) => {
                  setSelectedTract(null)
                  setMapListingId(listingId)
                }}
                onView3DTerrain={handleView3DTerrain}
                onToggleReport={handleToggleReport}
                isInReport={reportIds.has(selectedTract.id)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparables Loading Overlay */}
      {comparablesLoading && (
        <div className="fixed inset-0 z-[600] bg-black/60 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-gg-gray-900 rounded-2xl p-8 border border-white/10 text-center shadow-2xl">
            <Loader2 className="animate-spin text-gg-pink mx-auto mb-3" size={36} />
            <p className="text-sm font-medium">Finding Comparables...</p>
            <p className="text-xs text-gg-gray-400 mt-1">Analyzing similar sales in the area</p>
          </div>
        </div>
      )}

      {/* Comparables Panel */}
      <AnimatePresence>
        {showComparablesPanel && (
          <PortalComparablesPanel
            data={comparablesData}
            onClose={handleCloseComparables}
            onToggleReport={(comp) => {
              // Convert comparable to TractSaleData format for report
              const tractData = {
                id: comp.id,
                county: comp.county,
                state: comp.state,
                totalAcres: comp.total_acres,
                tillableAcres: comp.tillable_acres,
                pricePerAcre: comp.price_per_acre,
                salePrice: comp.sale_price,
                soilRating: comp.soil_rating || comp.csr2,
                auctionDate: comp.auction_date,
                companyName: comp.company_name,
                township: comp.township,
              } as TractSaleData
              handleToggleReport(tractData)
            }}
            isInReport={(id) => reportIds.has(id)}
            reportCount={reportIds.size}
            onViewReport={handleCreateReport}
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
            subjectInfo={comparablesData?.search_criteria}
          />
        )}
      </AnimatePresence>

      {/* Floating Report Bar */}
      {reportIds.size > 0 && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 bg-gg-pink rounded-full px-6 py-3 shadow-2xl">
          <span className="text-white font-bold text-sm">
            {reportIds.size} Selected
          </span>
          <button
            onClick={handleCreateReport}
            className="bg-white/20 text-white font-semibold text-sm px-4 py-2 rounded-full hover:bg-white/30 transition"
          >
            Create Report
          </button>
          <button
            onClick={() => { setReportIds(new Set()); setReportTracts([]) }}
            className="text-white/70 hover:text-white text-lg"
          >
            ✕
          </button>
        </div>
      )}

      {/* 3D Terrain Viewer */}
      <Tract3DModal
        tractId={viewer3DTractId}
        tractName={viewer3DTractName}
        isOpen={show3DViewer}
        onClose={() => setShow3DViewer(false)}
      />
    </div>
  )
}