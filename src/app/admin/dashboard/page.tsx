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
  AlertCircle,
  ChevronRight,
  RefreshCw,
  Radio,
  Filter,
  Loader2,
  Moon,
  ClipboardList,
  ClipboardCheck
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import type { ApiListing } from '@/components/map/mapTypes'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Temporary button for one-time scripts
const SHOW_SOLD_ACRES_BUTTON = false

// Dynamically import map to avoid SSR issues
const TractMap = dynamic(() => import('@/components/map/TractMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[700px] bg-gg-gray-800 rounded-xl flex items-center justify-center">
      <Loader2 className="animate-spin text-gg-pink" size={32} />
    </div>
  )
})

export default function AdminDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<ApiListing[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [selectedCompany, setSelectedCompany] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [selectedType, setSelectedType] = useState<string>('all')
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [mapLoading, setMapLoading] = useState(true)
  const [soldAcresRunning, setSoldAcresRunning] = useState(false)
  const [soldAcresResult, setSoldAcresResult] = useState<string | null>(null)

  const runSoldAcresUpdate = async () => {
    setSoldAcresRunning(true)
    setSoldAcresResult(null)
    try {
      const response = await fetchWithAuth(API_URL + '/api/admin/update-sold-acres', {
        method: 'POST'
      })
      if (response.ok) {
        const data = await response.json()
        setSoldAcresResult(`Updated ${data.listings_updated} listings, marked ${data.tracts_marked_sold} tracts as sold`)
      } else {
        const error = await response.json()
        setSoldAcresResult(`Error: ${error.detail || 'Unknown error'}`)
      }
    } catch (err) {
      setSoldAcresResult('Error: Failed to run update')
    } finally {
      setSoldAcresRunning(false)
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
      const allListings: ApiListing[] = []
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

  const mapFilters = useMemo(() => ({
    company: selectedCompany,
    status: selectedStatus,
    type: selectedType,
    dateFrom,
    dateTo,
  }), [selectedCompany, selectedStatus, selectedType, dateFrom, dateTo])

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

        {/* Control Center Banner - Admin only */}
        {user?.account_type === 'groundgoat_admin' && (
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
        )}

        {/* Quick Actions */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {/* Admin-only actions */}
          {user?.account_type === 'groundgoat_admin' && (
            <>
              <QuickActionCard
                title="Scraper"
                description="Run the auction scraper to fetch new listings"
                href="/admin/scraper"
                icon={<RefreshCw />}
              />
              <QuickActionCard
                title="Nightly Updates"
                description="Price & status changes from nightly monitoring"
                href="/admin/nightly-updates"
                icon={<Moon />}
              />
              <QuickActionCard
                title="Auction Staging"
                description="Review scraped auction listings before publishing"
                href="/admin/staging"
                icon={<ClipboardCheck />}
              />
              <QuickActionCard
                title="PT Staging"
                description="Review scraped private treaty listings"
                href="/admin/private-treaty-staging"
                icon={<ClipboardList />}
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
            </>
          )}
          {/* Visible to both Admin and Sales */}
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
          {/* Admin-only actions */}
          {user?.account_type === 'groundgoat_admin' && (
            <>
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
            </>
          )}
        </div>

        {/* One-time Script Button */}
        {SHOW_SOLD_ACRES_BUTTON && (
          <div className="card mb-8">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">Update Sold Acres</h3>
                <p className="text-sm text-gg-gray-400">
                  Calculate and update sold_acres for sold auction listings based on tract data
                </p>
              </div>
              <button
                onClick={runSoldAcresUpdate}
                disabled={soldAcresRunning}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {soldAcresRunning ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    Running...
                  </>
                ) : (
                  <>
                    <ClipboardList size={18} />
                    Run Update
                  </>
                )}
              </button>
            </div>
            {soldAcresResult && (
              <div className={`mt-4 p-3 rounded-lg ${soldAcresResult.startsWith('Error') ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
                {soldAcresResult}
              </div>
            )}
          </div>
        )}

        {/* Tract Map */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">Tract Map</h2>
              <p className="text-gg-gray-400 text-sm">
                Tract-level view • Zoom in for polygon detail
              </p>
            </div>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-gg-gray-400" />
              <span className="text-gg-gray-400 text-sm">Filters:</span>
            </div>
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
            >
              <option value="all">All Companies</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="active">Listed/Active</option>
              <option value="live">Live</option>
              <option value="sold">Sold</option>
              <option value="pending">Pending</option>
              <option value="no_sale">No Sale</option>
            </select>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
            >
              <option value="all">All Types</option>
              <option value="auction">Auction</option>
              <option value="private_treaty">Private Treaty</option>
            </select>
            <div className="flex items-center gap-2">
              <span className="text-gg-gray-400 text-sm">Date:</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
                placeholder="From"
              />
              <span className="text-gg-gray-500">to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
                placeholder="To"
              />
            </div>
            {(selectedCompany !== 'all' || selectedStatus !== 'all' || selectedType !== 'all' || dateFrom || dateTo) && (
              <button
                onClick={() => {
                  setSelectedCompany('all')
                  setSelectedStatus('all')
                  setSelectedType('all')
                  setDateFrom('')
                  setDateTo('')
                }}
                className="text-gg-pink text-sm hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-6 mb-4 text-sm flex-wrap">
            <span className="text-gg-gray-400">Status:</span>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: '#2563EB' }}></div>
              <span className="text-gg-gray-300">Listed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: '#16A34A' }}></div>
              <span className="text-gg-gray-300">Live</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: '#DC2626' }}></div>
              <span className="text-gg-gray-300">Sold</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ background: '#6B7280' }}></div>
              <span className="text-gg-gray-300">No Sale</span>
            </div>
          </div>

          {/* Map */}
          {mapLoading ? (
            <div className="h-[700px] bg-gg-gray-800 rounded-xl flex items-center justify-center">
              <Loader2 className="animate-spin text-gg-pink" size={32} />
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden">
              <TractMap
                listings={listings}
                height="700px"
                filters={mapFilters}
              />
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

