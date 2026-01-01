'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  DollarSign,
  Users,
  FileText,
  Building2,
  TrendingUp,
  Clock,
  AlertCircle,
  ChevronRight,
  RefreshCw,
  Radio,
  Filter,
  Loader2,
  Moon
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import countyCentroids from '@/data/countyCentroids'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Dynamically import map to avoid SSR issues
const MapComponent = dynamic(() => import('./MapComponent'), { 
  ssr: false,
  loading: () => (
    <div className="h-[500px] bg-gg-gray-800 rounded-xl flex items-center justify-center">
      <Loader2 className="animate-spin text-gg-pink" size={32} />
    </div>
  )
})

interface Listing {
  id: string
  title: string
  county: string
  state: string
  listing_type: string
  status: string
  company_name?: string
  listing_company_id?: string
  auction_date?: string
  auction_time?: string
  price_per_acre?: number
  sale_price?: number
  total_acres?: number
  sold_acres?: number
  tract_count?: number
}

interface MapListing {
  id: string
  title: string
  county: string
  state: string
  lat: number
  lng: number
  pricePerAcre: number
  totalPrice: number
  listedAcres: number
  soldAcres: number
  tractCount: number
  auctionDate: string
  auctionTime: string
  companyName: string
  companyId: string
  status: string
}

export default function AdminDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<Listing[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [selectedCompany, setSelectedCompany] = useState<string>('all')
  const [mapLoading, setMapLoading] = useState(true)

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
      const response = await fetchWithAuth(API_URL + '/api/auth/me')

      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()
      
      // Check if user is admin
      if (userData.account_type !== 'groundgoat_admin' && userData.account_type !== 'groundgoat_sales') {
        router.push('/account')
        return
      }

      setUser(userData)
      fetchStats()
      fetchListings()
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchStats = async () => {
    try {
      const response = await fetchWithAuth(API_URL + '/api/admin/stats')

      if (response.ok) {
        const data = await response.json()
        setStats(data)
      } else {
        setStats({
          total_users: 0,
          total_listings: 0,
          total_companies: 0,
          active_subscriptions: 0,
          upcoming_auctions: 0,
          recent_results: 0,
        })
      }
    } catch (err) {
      setStats({
        total_users: 0,
        total_listings: 0,
        total_companies: 0,
        active_subscriptions: 0,
        upcoming_auctions: 0,
        recent_results: 0,
      })
    } finally {
      setLoading(false)
    }
  }

  const fetchListings = async () => {
    try {
      const allListings: Listing[] = []
      let offset = 0
      const limit = 100

      while (true) {
        const response = await fetchWithAuth(
          API_URL + '/api/listings?limit=' + limit + '&offset=' + offset
        )
        if (!response.ok) break
        const batch = await response.json()
        if (!batch || batch.length === 0) break
        allListings.push(...batch)
        if (batch.length < limit) break
        offset += limit
      }

      setListings(allListings)

      // Extract unique companies
      const companyMap = new Map<string, string>()
      allListings.forEach(l => {
        if (l.listing_company_id && l.company_name) {
          companyMap.set(l.listing_company_id, l.company_name)
        }
      })
      const uniqueCompanies = Array.from(companyMap.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setCompanies(uniqueCompanies)
    } catch (err) {
      console.error('Failed to fetch listings:', err)
    } finally {
      setMapLoading(false)
    }
  }

  // Convert listings to map format with coordinates
  const mapListings = useMemo(() => {
    const result: MapListing[] = []

    listings.forEach(listing => {
      const stateAbbr = getStateAbbr(listing.state)
      const key = listing.county + ', ' + stateAbbr

      const coords = countyCentroids[key]
      if (!coords) return

      // Use direct fields from API
      const pricePerAcre = listing.price_per_acre || 0
      const totalPrice = listing.sale_price || (pricePerAcre * (listing.total_acres || 0))
      const listedAcres = listing.total_acres || 0
      const soldAcres = listing.sold_acres || 0
      const tractCount = listing.tract_count || 0

      if (selectedCompany !== 'all' && listing.listing_company_id !== selectedCompany) {
        return
      }

      result.push({
        id: listing.id,
        title: listing.title || listing.county + ' County, ' + listing.state,
        county: listing.county,
        state: listing.state,
        lat: coords[0],
        lng: coords[1],
        pricePerAcre,
        totalPrice,
        listedAcres,
        soldAcres,
        tractCount,
        auctionDate: listing.auction_date || '',
        auctionTime: listing.auction_time || '',
        companyName: listing.company_name || 'Unknown',
        companyId: listing.listing_company_id || '',
        status: listing.status
      })
    })

    return result
  }, [listings, selectedCompany])

  const priceRange = useMemo(() => {
    const prices = mapListings.filter(l => l.pricePerAcre > 0).map(l => l.pricePerAcre)
    if (prices.length === 0) return { min: 0, max: 20000 }
    return {
      min: Math.min(...prices),
      max: Math.max(...prices)
    }
  }, [mapListings])

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-4xl font-bold text-white mb-2">Admin Dashboard</h1>
            <p className="text-gg-gray-400">Welcome back, {user?.first_name}</p>
          </div>
        </div>

        {/* Control Center Banner */}
        <Link
          href="/admin/control-center"
          className="block mb-8 p-6 bg-gradient-to-r from-gg-pink/20 to-purple-600/20 border border-gg-pink/50 rounded-xl hover:border-gg-pink transition-colors group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gg-pink/20 rounded-xl flex items-center justify-center text-gg-pink group-hover:bg-gg-pink/30 transition-colors">
                <Radio size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Auction Control Center</h2>
                <p className="text-gg-gray-400">Manage live auctions in real-time</p>
              </div>
            </div>
            <ChevronRight className="text-gg-pink" size={24} />
          </div>
        </Link>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          <QuickActionCard
            title="Scraper"
            description="Run the auction scraper to fetch new listings"
            href="/admin/scraper"
            icon={<RefreshCw />}
          />
          <QuickActionCard
            title="Private Treaty Check"
            description="View status check reports for private treaty listings"
            href="/admin/private-treaty-reports"
            icon={<Clock />}
          />
          <QuickActionCard
            title="Nightly Updates"
            description="Price & status changes from nightly monitoring"
            href="/admin/nightly-updates"
            icon={<Moon />}
          />
          <QuickActionCard
            title="Manage Users"
            description="View and manage user accounts"
            href="/admin/users"
            icon={<Users />}
            count={stats?.total_users}
          />
          <QuickActionCard
            title="Commissions"
            description="View sales rep commissions"
            href="/admin/commissions"
            icon={<DollarSign />}
          />
          <QuickActionCard
            title="Manage Listings"
            description="Edit or remove auction listings"
            href="/admin/listings"
            icon={<FileText />}
            count={stats?.total_listings}
          />
          <QuickActionCard
            title="Companies"
            description="Manage auction company records"
            href="/admin/companies"
            icon={<Building2 />}
            count={stats?.total_companies}
          />
          <QuickActionCard
            title="Reports"
            description="View analytics and reports"
            href="/admin/reports"
            icon={<TrendingUp />}
          />
          <QuickActionCard
            title="Settings"
            description="Configure system settings"
            href="/admin/settings"
            icon={<AlertCircle />}
          />
        </div>

        {/* Listings Map */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">Listings Map</h2>
              <p className="text-gg-gray-400 text-sm">
                {mapListings.length} listings • Circle size = price/acre
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Filter size={18} className="text-gg-gray-400" />
              <select
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
                className="bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm min-w-[180px]"
              >
                <option value="all">All Companies</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-6 mb-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-green-500 opacity-70"></div>
              <span className="text-gg-gray-300">Sold</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gg-pink opacity-70"></div>
              <span className="text-gg-gray-300">Listed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-yellow-500 opacity-70"></div>
              <span className="text-gg-gray-300">Pending</span>
            </div>
            <div className="text-gg-gray-500 ml-auto">
              ${priceRange.min.toLocaleString()} - ${priceRange.max.toLocaleString()}/acre
            </div>
          </div>

          {/* Map */}
          {mapLoading ? (
            <div className="h-[500px] bg-gg-gray-800 rounded-xl flex items-center justify-center">
              <Loader2 className="animate-spin text-gg-pink" size={32} />
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden">
              <MapComponent listings={mapListings} priceRange={priceRange} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function QuickActionCard({ title, description, href, icon, count }: { title: string, description: string, href: string, icon: React.ReactNode, count?: number }) {
  return (
    <Link href={href} className="card hover:border-gg-pink group">
      <div className="flex items-start justify-between">
        <div className="w-12 h-12 bg-gg-pink/10 rounded-xl flex items-center justify-center text-gg-pink mb-4 group-hover:bg-gg-pink/20 transition-colors">
          {icon}
        </div>
        {count !== undefined ? (
          <span className="text-2xl font-bold text-gg-pink">{count.toLocaleString()}</span>
        ) : (
          <ChevronRight className="text-gg-gray-500 group-hover:text-gg-pink transition-colors" />
        )}
      </div>
      <h3 className="font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-gg-gray-400">{description}</p>
    </Link>
  )
}

function getStateAbbr(state: string): string {
  const abbrs: Record<string, string> = {
    'Illinois': 'IL',
    'Iowa': 'IA',
    'Missouri': 'MO',
    'Minnesota': 'MN',
    'Indiana': 'IN',
    'Wisconsin': 'WI',
    'Kansas': 'KS',
    'Nebraska': 'NE',
    'Ohio': 'OH',
    'Michigan': 'MI',
  }
  return abbrs[state] || state
}
