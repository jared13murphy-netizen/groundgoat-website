'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, BarChart3 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { getDistanceToCounty } from '@/data/countyCoordinates'
import PortalNavBar from '@/components/portal/PortalNavBar'
import PortalKPICards from '@/components/portal/PortalKPICards'
import PortalListPanel from '@/components/portal/PortalListPanel'
import PortalAnalyticsPanel from '@/components/portal/PortalAnalyticsPanel'
import PortalListingDetail from '@/components/portal/PortalListingDetail'
import PortalTractDetail from '@/components/portal/PortalTractDetail'
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
  const [listings, setListings] = useState<Listing[]>([])
  const [listingsLoading, setListingsLoading] = useState(false)
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [mapListingId, setMapListingId] = useState<string | null>(null)
  const [selectedTract, setSelectedTract] = useState<TractSaleData | null>(null)
  // Report state
  const [reportIds, setReportIds] = useState<Set<string>>(new Set())
  const [reportTracts, setReportTracts] = useState<TractSaleData[]>([])
  // 3D viewer state
  const [show3DViewer, setShow3DViewer] = useState(false)
  const [viewer3DTractId, setViewer3DTractId] = useState('')
  const [viewer3DTractName, setViewer3DTractName] = useState('')

  // Auth check
  useEffect(() => {
    checkAuth()
  }, [])

  // Fetch analytics for home county on load
  useEffect(() => {
    if (user?.home_county && user?.home_state) {
      fetchAnalytics(user.home_county, user.home_state)
    }
  }, [user])

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/signin')
        return
      }

      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)
      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()

      if (!ALLOWED_ROLES.includes(userData.account_type)) {
        router.push('/account')
        return
      }

      setUser(userData)
    } catch {
      router.push('/signin')
    } finally {
      setAuthLoading(false)
    }
  }

  const fetchListings = async (tab: TabType) => {
    if (tab === 'map') return
    setListingsLoading(true)
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

      setListings(data)
    } catch (err) {
      console.error('Failed to fetch listings:', err)
    } finally {
      setListingsLoading(false)
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
    const reportData = {
      comparables: reportTracts.map(t => ({
        id: t.id,
        county: t.county,
        state: t.state,
        total_acres: t.totalAcres,
        tillable_acres: t.tillableAcres,
        soil_rating: t.soilRating,
        price_per_acre: t.pricePerAcre,
        sale_price: t.salePrice,
        auction_date: t.auctionDate,
        company_name: t.companyName,
      })),
    }
    sessionStorage.setItem('exploreReport', JSON.stringify(reportData))
    window.location.href = '/listings/report'
  }

  const handleViewListingFromMap = (listingId: string) => {
    setSelectedTract(null)
    setMapListingId(listingId)
  }

  const handleTractSelected = (tract: any) => {
    // Convert SaleDetail from ExploreMap to TractSaleData
    setMapListingId(null)
    setSelectedTract(tract as TractSaleData)
  }

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab)
    setMapListingId(null)
    setSelectedTract(null)
    if (tab === 'map') {
      setShowListPanel(false)
    } else {
      setShowListPanel(true)
      fetchListings(tab)
    }
  }

  const handleFilterToggle = () => {
    setFilterOpen(!filterOpen)
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
        />
      </div>

      {/* Floating Logo (separate from nav bar) */}
      <Link
        href="/access"
        className="fixed top-3 left-4 z-[510]"
      >
        <img src="/logo.png" alt="Ground Goat" style={{ width: 100, height: 100 }} className="rounded-xl shadow-lg" />
      </Link>

      {/* Floating Nav Bar (shifted right to make room for logo) */}
      <PortalNavBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onFilterToggle={handleFilterToggle}
        filterOpen={filterOpen}
        user={user}
      />

      {/* KPI cards removed — analytics panel covers this */}

      {/* Analytics Toggle Button */}
      <button
        onClick={() => setShowAnalyticsPanel(!showAnalyticsPanel)}
        className={`fixed bottom-4 right-4 z-[300] backdrop-blur-xl rounded-xl px-4 py-3 border flex items-center gap-2 transition group cursor-pointer ${
          showAnalyticsPanel
            ? 'bg-gg-pink/20 border-gg-pink/30 text-gg-pink'
            : 'bg-black/50 border-white/10 hover:border-gg-pink/30'
        }`}
      >
        <BarChart3 size={18} className="text-gg-pink" />
        <span className="text-sm font-medium group-hover:text-gg-pink transition">Analytics</span>
      </button>

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
            className="fixed top-0 left-0 bottom-0 w-[480px] z-[400] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
          >
            <div className="pt-20 px-5 pb-4 border-b border-white/5 flex items-center justify-between shrink-0">
              <h2 className="text-lg font-semibold">Listing Detail</h2>
              <button
                onClick={() => setMapListingId(null)}
                className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition"
              >
                <span className="text-gg-gray-400 text-sm">✕</span>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <PortalListingDetail
                listingId={mapListingId}
                onBack={() => setMapListingId(null)}
                onTractSelected={setSelectedTract}
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
            className="fixed top-0 left-0 bottom-0 w-[480px] z-[410] bg-gg-gray-900/95 backdrop-blur-xl border-r border-white/10 shadow-2xl flex flex-col"
          >
            <div className="pt-20 px-5 pb-4 border-b border-white/5 flex items-center justify-between shrink-0">
              <h2 className="text-lg font-semibold">Tract Detail</h2>
              <button
                onClick={() => setSelectedTract(null)}
                className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 transition"
              >
                <span className="text-gg-gray-400 text-sm">✕</span>
              </button>
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