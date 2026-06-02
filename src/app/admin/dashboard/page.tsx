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
  AlertCircle,
  ChevronRight,
  Radio,
  Filter,
  Loader2,
  Moon,
  ClipboardList,
  ClipboardCheck,
  MapPin,
  Activity,
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import type { ApiListing } from '@/components/map/mapTypes'
import type { CountySalesData } from '@/components/map/CountySalesMap'
import { COMPANY_COLORS } from '@/components/map/CountySalesMap'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Temporary button for one-time scripts
const SHOW_SOLD_ACRES_BUTTON = false

// Dynamically import maps to avoid SSR issues
const TractMap = dynamic(() => import('@/components/map/TractMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[700px] bg-gg-gray-800 rounded-xl flex items-center justify-center">
      <Loader2 className="animate-spin text-gg-pink" size={32} />
    </div>
  )
})

const CountySalesMap = dynamic(() => import('@/components/map/CountySalesMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[600px] bg-gg-gray-800 rounded-xl flex items-center justify-center">
      <Loader2 className="animate-spin text-gg-pink" size={32} />
    </div>
  )
})

const CountyDetailPanel = dynamic(() => import('@/components/map/CountyDetailPanel'), {
  ssr: false,
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

  // County Sales Map state
  const [countySalesData, setCountySalesData] = useState<CountySalesData | null>(null)
  const [countySalesLoading, setCountySalesLoading] = useState(true)
  const [selectedCountyDetail, setSelectedCountyDetail] = useState<{ county: string; state: string } | null>(null)
  const [countyCompanyFilter, setCountyCompanyFilter] = useState<Set<string>>(new Set())
  const [countyStateFilter, setCountyStateFilter] = useState<string>('all')
  const [countyDateFrom, setCountyDateFrom] = useState<string>('')
  const [countyDateTo, setCountyDateTo] = useState<string>('')
  const [countyListingType, setCountyListingType] = useState<string>('auction')
  const [countyStatuses, setCountyStatuses] = useState<Set<string>>(new Set(['sold']))
  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false)
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false)

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

  // Fetch county sales data
  const fetchCountySalesData = async () => {
    setCountySalesLoading(true)
    try {
      const params = new URLSearchParams()
      countyCompanyFilter.forEach(id => params.append('company_ids', id))
      if (countyStateFilter !== 'all') params.set('state', countyStateFilter)
      if (countyDateFrom) params.set('date_from', countyDateFrom)
      if (countyDateTo) params.set('date_to', countyDateTo)
      if (countyListingType !== 'all') params.set('listing_type', countyListingType)
      if (countyStatuses.size > 0) params.set('statuses', Array.from(countyStatuses).join(','))

      const response = await fetchWithAuth(
        `${API_URL}/api/admin/county-sales-summary?${params}`
      )
      if (response.ok) {
        const data = await response.json()
        setCountySalesData(data)
      }
    } catch (err) {
      console.error('Failed to fetch county sales data:', err)
    } finally {
      setCountySalesLoading(false)
    }
  }

  const countyCompanyFilterKey = Array.from(countyCompanyFilter).sort().join(',')
  const countyStatusesKey = Array.from(countyStatuses).sort().join(',')

  useEffect(() => {
    if (user) {
      fetchCountySalesData()
    }
  }, [countyCompanyFilterKey, countyStateFilter, countyDateFrom, countyDateTo, countyListingType, countyStatusesKey, user])

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
                title="Health Monitor"
                description="Usage, performance, Regrid cost, and database storage"
                href="/admin/health"
                icon={<Activity />}
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
                title="Tract Data Clean-Up"
                description="Confirm every tract's polygon, tillable & soil vs its source"
                href="/admin/data-cleanup"
                icon={<MapPin />}
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
                title="MyDec Import"
                description="Import Illinois MyDec declarations"
                href="/admin/mydec-import"
                icon={<ClipboardList />}
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

        {/* County Sales Map */}
        <div className="card mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-white">County Sales Map</h2>
              <p className="text-gg-gray-400 text-sm">
                County-level view of sold acres by listing company
              </p>
            </div>
          </div>

          {/* Filters Row 1 */}
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-gg-gray-400" />
              <span className="text-gg-gray-400 text-sm">Filters:</span>
            </div>

            {/* Listing Type */}
            <select
              value={countyListingType}
              onChange={(e) => setCountyListingType(e.target.value)}
              className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
            >
              <option value="auction">Auction</option>
              <option value="private_treaty">Private Treaty</option>
              <option value="all">All Types</option>
            </select>

            {/* Listing Status - multi-select dropdown */}
            <div className="relative">
              <button
                onClick={() => setStatusDropdownOpen(!statusDropdownOpen)}
                className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm flex items-center gap-2 min-w-[140px]"
              >
                <span>
                  {countyStatuses.size === 0
                    ? 'No Status'
                    : countyStatuses.size === 5
                    ? 'All Statuses'
                    : Array.from(countyStatuses).map(s => s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' ')).join(', ')}
                </span>
                <svg className="w-4 h-4 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {statusDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gg-gray-300 rounded-lg shadow-lg z-20 min-w-[180px]">
                  <label className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
                    <input
                      type="checkbox"
                      checked={countyStatuses.size === 5}
                      onChange={() => {
                        if (countyStatuses.size === 5) {
                          setCountyStatuses(new Set())
                        } else {
                          setCountyStatuses(new Set(['listed', 'live', 'sold', 'pending', 'no_sale']))
                        }
                      }}
                      className="accent-pink-500"
                    />
                    <span className="text-sm text-black font-medium">Select All</span>
                  </label>
                  {[
                    { value: 'sold', label: 'Sold' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'listed', label: 'Listed' },
                    { value: 'live', label: 'Live' },
                    { value: 'no_sale', label: 'No Sale' },
                  ].map(opt => (
                    <label key={opt.value} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={countyStatuses.has(opt.value)}
                        onChange={() => {
                          const next = new Set(countyStatuses)
                          if (next.has(opt.value)) {
                            next.delete(opt.value)
                          } else {
                            next.add(opt.value)
                          }
                          setCountyStatuses(next)
                        }}
                        className="accent-pink-500"
                      />
                      <span className="text-sm text-black">{opt.label}</span>
                    </label>
                  ))}
                  <div className="border-t border-gray-100 px-3 py-2">
                    <button
                      onClick={() => setStatusDropdownOpen(false)}
                      className="text-sm text-gg-pink hover:underline w-full text-left"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Company Multi-Select */}
            <div className="relative">
              <button
                onClick={() => setCompanyDropdownOpen(!companyDropdownOpen)}
                className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm flex items-center gap-2 min-w-[160px]"
              >
                <span className="truncate max-w-[200px]">
                  {countyCompanyFilter.size === 0
                    ? 'All Companies'
                    : countyCompanyFilter.size === 1
                    ? companies.find(c => countyCompanyFilter.has(c.id))?.name || '1 Company'
                    : `${countyCompanyFilter.size} Companies`}
                </span>
                <svg className="w-4 h-4 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {companyDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gg-gray-300 rounded-lg shadow-lg z-20 min-w-[240px] max-h-[300px] overflow-y-auto">
                  <label className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer border-b border-gray-100">
                    <input
                      type="checkbox"
                      checked={countyCompanyFilter.size === 0}
                      onChange={() => setCountyCompanyFilter(new Set())}
                      className="accent-pink-500"
                    />
                    <span className="text-sm text-black font-medium">All Companies</span>
                  </label>
                  {companies.map(c => (
                    <label key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={countyCompanyFilter.has(c.id)}
                        onChange={() => {
                          const next = new Set(countyCompanyFilter)
                          if (next.has(c.id)) {
                            next.delete(c.id)
                          } else {
                            next.add(c.id)
                          }
                          setCountyCompanyFilter(next)
                        }}
                        className="accent-pink-500"
                      />
                      <span className="text-sm text-black">{c.name}</span>
                    </label>
                  ))}
                  <div className="border-t border-gray-100 px-3 py-2 sticky bottom-0 bg-white">
                    <button
                      onClick={() => setCompanyDropdownOpen(false)}
                      className="text-sm text-gg-pink hover:underline w-full text-left"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* State */}
            <select
              value={countyStateFilter}
              onChange={(e) => setCountyStateFilter(e.target.value)}
              className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
            >
              <option value="all">All States</option>
              <option value="IL">Illinois</option>
              <option value="IA">Iowa</option>
              <option value="IN">Indiana</option>
              <option value="KS">Kansas</option>
              <option value="MI">Michigan</option>
              <option value="MN">Minnesota</option>
              <option value="MO">Missouri</option>
              <option value="NE">Nebraska</option>
              <option value="ND">North Dakota</option>
              <option value="OH">Ohio</option>
              <option value="SD">South Dakota</option>
              <option value="WI">Wisconsin</option>
            </select>

            {/* Date range */}
            <div className="flex items-center gap-2">
              <span className="text-gg-gray-400 text-sm">Date:</span>
              <input
                type="date"
                value={countyDateFrom}
                onChange={(e) => setCountyDateFrom(e.target.value)}
                className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
              />
              <span className="text-gg-gray-500">to</span>
              <input
                type="date"
                value={countyDateTo}
                onChange={(e) => setCountyDateTo(e.target.value)}
                className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
              />
            </div>

            {(countyCompanyFilter.size > 0 || countyStateFilter !== 'all' || countyDateFrom || countyDateTo || countyListingType !== 'auction' || !countyStatuses.has('sold') || countyStatuses.size !== 1) && (
              <button
                onClick={() => {
                  setCountyCompanyFilter(new Set())
                  setCountyStateFilter('all')
                  setCountyDateFrom('')
                  setCountyDateTo('')
                  setCountyListingType('auction')
                  setCountyStatuses(new Set(['sold']))
                }}
                className="text-gg-pink text-sm hover:underline"
              >
                Reset filters
              </button>
            )}
          </div>

          {/* Map */}
          <div className="rounded-xl overflow-hidden">
            <CountySalesMap
              data={countySalesData}
              loading={countySalesLoading}
              onCountyClick={(county, state) => setSelectedCountyDetail({ county, state })}
              height="600px"
            />
          </div>
        </div>

        {/* County Detail Panel */}
        {selectedCountyDetail && (
          <CountyDetailPanel
            county={selectedCountyDetail.county}
            state={selectedCountyDetail.state}
            onClose={() => setSelectedCountyDetail(null)}
            dateFrom={countyDateFrom}
            dateTo={countyDateTo}
            listingType={countyListingType !== 'all' ? countyListingType : undefined}
            statuses={countyStatuses.size > 0 ? Array.from(countyStatuses).join(',') : undefined}
          />
        )}

      </div>
    </div>
  )
}

function QuickActionCard({ title, description, href, icon, count }: { title: string, description: string, href: string, icon: React.ReactNode, count?: number | null }) {
  return (
    <Link href={href} className="card hover:border-gg-pink group">
      <div className="flex items-start justify-between">
        <div className="w-12 h-12 bg-gg-pink/10 rounded-xl flex items-center justify-center text-gg-pink mb-4 group-hover:bg-gg-pink/20 transition-colors">
          {icon}
        </div>
        {typeof count === 'number' ? (
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

