'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Pencil, Trash2, Building2, ArrowLeft, ExternalLink, Plus, X, Search } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const PAGE_SIZE = 50

interface Company {
  id: string
  name: string
  website: string
  logo_url: string
  city: string
  state: string
  listing_count?: number
  latest_listing_date?: string
  status_counts?: {
    no_sale: number
    sold: number
    pending: number
  }
  type_counts?: {
    listed: number
    live: number
  }
}

const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
  "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky",
  "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico",
  "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania",
  "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont",
  "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"
]

export default function AdminCompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newCompany, setNewCompany] = useState({
    name: '',
    website: '',
    city: '',
    state: '',
    phone: '',
    email: '',
    logo_url: '',
    auction_list_url: '',
    private_treaty_list_url: ''
  })

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth(token)
  }, [router])

  const checkAuth = async (token: string) => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)

      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()
      
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }

      await fetchCompaniesWithListingCounts(token)
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchCompaniesWithListingCounts = async (token: string) => {
    try {
      // Fetch companies, listing counts (with status breakdown), and latest dates in parallel
      const [companiesResponse, countsResponse, datesResponse] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/companies`),
        fetchWithAuth(`${API_URL}/api/companies/listing-counts`),
        fetchWithAuth(`${API_URL}/api/companies/latest-listing-dates`)
      ])

      if (!companiesResponse.ok) throw new Error('Failed to fetch companies')

      const companiesData = await companiesResponse.json()
      const listingCounts = countsResponse.ok ? await countsResponse.json() : {}
      const latestDates = datesResponse.ok ? await datesResponse.json() : {}

      const companiesWithCounts = companiesData.map((company: Company) => {
        const counts = listingCounts[company.id] || { total: 0, no_sale: 0, sold: 0, pending: 0, listed: 0, live: 0 }
        return {
          ...company,
          listing_count: counts.total,
          latest_listing_date: latestDates[company.id] || null,
          status_counts: { no_sale: counts.no_sale, sold: counts.sold, pending: counts.pending },
          type_counts: { listed: counts.listed, live: counts.live }
        }
      })

      companiesWithCounts.sort((a: Company, b: Company) =>
        a.name.localeCompare(b.name)
      )

      setCompanies(companiesWithCounts)
    } catch (err) {
      console.error('Failed to fetch companies:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleAddCompany = async () => {
    if (!newCompany.name.trim()) {
      alert('Company name is required')
      return
    }

    setSaving(true)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/companies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCompany)
      })

      if (response.ok) {
        const created = await response.json()
        setCompanies(prev => [...prev, { ...created, listing_count: 0 }].sort((a, b) => a.name.localeCompare(b.name)))
        setShowAddModal(false)
        setNewCompany({
          name: '',
          website: '',
          city: '',
          state: '',
          phone: '',
          email: '',
          logo_url: '',
          auction_list_url: '',
          private_treaty_list_url: ''
        })
      } else {
        const error = await response.json()
        alert(error.detail || 'Failed to create company')
      }
    } catch (err) {
      console.error('Failed to create company:', err)
      alert('Failed to create company')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    
    if (!confirm('Are you sure you want to delete this company? This may affect associated listings.')) return

    try {
      const response = await fetchWithAuth(`${API_URL}/api/companies/${id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setCompanies(prev => prev.filter(c => c.id !== id))
      } else {
        alert('Failed to delete company. It may have associated listings.')
      }
    } catch (err) {
      console.error('Failed to delete company:', err)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  // Search by company name, city, or state (case-insensitive substring).
  const q = search.trim().toLowerCase()
  const filteredCompanies = q
    ? companies.filter((c) =>
        [c.name, c.city, c.state]
          .filter(Boolean)
          .some((f) => f!.toLowerCase().includes(q))
      )
    : companies

  const totalPages = Math.max(1, Math.ceil(filteredCompanies.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageStart = (safePage - 1) * PAGE_SIZE
  const paginatedCompanies = filteredCompanies.slice(pageStart, pageStart + PAGE_SIZE)

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-5xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Companies</h1>
              <p className="text-gg-gray-400">
                {q ? (
                  <>{filteredCompanies.length} of {companies.length} companies</>
                ) : (
                  <>{companies.length} auction companies</>
                )}
                {filteredCompanies.length > PAGE_SIZE && (
                  <> · showing {pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, filteredCompanies.length)}</>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80"
          >
            <Plus size={18} />
            Add Company
          </button>
        </div>

        {/* Search — filter by company name, city, or state */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-500" size={18} />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by company name, city, or state…"
            className="w-full bg-gg-gray-900 border border-gg-gray-800 rounded-lg pl-10 pr-10 py-2.5 text-white placeholder-gg-gray-500 focus:outline-none focus:border-gg-pink"
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setPage(1) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gg-gray-500 hover:text-white"
              aria-label="Clear search"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Add Company Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gg-gray-900 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between p-4 border-b border-gg-gray-800">
                <h2 className="text-xl font-bold text-white">Add Company</h2>
                <button onClick={() => setShowAddModal(false)} className="text-gg-gray-400 hover:text-white">
                  <X size={24} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <div>
                  <label className="block text-gg-gray-400 text-sm mb-1">Company Name *</label>
                  <input
                    type="text"
                    value={newCompany.name}
                    onChange={(e) => setNewCompany(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    placeholder="e.g. Sullivan Auctioneers"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">City</label>
                    <input
                      type="text"
                      value={newCompany.city}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, city: e.target.value }))}
                      className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">State</label>
                    <select
                      value={newCompany.state}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, state: e.target.value }))}
                      className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-2 text-black"
                    >
                      <option value="">Select State</option>
                      {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-gg-gray-400 text-sm mb-1">Website</label>
                  <input
                    type="url"
                    value={newCompany.website}
                    onChange={(e) => setNewCompany(prev => ({ ...prev, website: e.target.value }))}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    placeholder="https://example.com"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Phone</label>
                    <input
                      type="tel"
                      value={newCompany.phone}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, phone: e.target.value }))}
                      className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-gg-gray-400 text-sm mb-1">Email</label>
                    <input
                      type="email"
                      value={newCompany.email}
                      onChange={(e) => setNewCompany(prev => ({ ...prev, email: e.target.value }))}
                      className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-gg-gray-400 text-sm mb-1">Logo URL</label>
                  <input
                    type="url"
                    value={newCompany.logo_url}
                    onChange={(e) => setNewCompany(prev => ({ ...prev, logo_url: e.target.value }))}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-gg-gray-400 text-sm mb-1">Auction List URL</label>
                  <input
                    type="url"
                    value={newCompany.auction_list_url}
                    onChange={(e) => setNewCompany(prev => ({ ...prev, auction_list_url: e.target.value }))}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    placeholder="URL to scrape auctions from"
                  />
                </div>
                <div>
                  <label className="block text-gg-gray-400 text-sm mb-1">Private Treaty List URL</label>
                  <input
                    type="url"
                    value={newCompany.private_treaty_list_url}
                    onChange={(e) => setNewCompany(prev => ({ ...prev, private_treaty_list_url: e.target.value }))}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                    placeholder="URL to scrape private treaties from"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 p-4 border-t border-gg-gray-800">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-gg-gray-700 text-white rounded-lg hover:bg-gg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddCompany}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
                  {saving ? 'Creating...' : 'Create Company'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Companies List */}
        <div className="space-y-2">
          {paginatedCompanies.map((company) => (
            <Link
              key={company.id}
              href={`/admin/listings?company=${company.id}`}
              className="flex items-center gap-4 p-3 bg-gg-gray-900 border border-gg-gray-800 rounded-lg hover:border-gg-pink transition-colors group"
            >
              {/* Logo */}
              <div className="w-12 h-12 flex-shrink-0 bg-white rounded-lg flex items-center justify-center overflow-hidden">
                {company.logo_url ? (
                  <img
                    src={company.logo_url}
                    alt={company.name}
                    className="h-10 w-10 object-contain"
                  />
                ) : (
                  <Building2 className="text-gg-gray-400" size={24} />
                )}
              </div>

              {/* Company Info */}
              <div className="flex-1 min-w-0">
                <h3 className="text-white font-semibold truncate group-hover:text-gg-pink transition-colors">
                  {company.name}
                </h3>
                <p className="text-gg-gray-400 text-sm truncate">
                  {[company.city, company.state].filter(Boolean).join(', ') || 'No location'}
                </p>
              </div>

              {/* Website */}
              {company.website && (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="hidden sm:flex items-center gap-1 px-3 py-1.5 text-xs text-gg-gray-400 hover:text-white transition-colors"
                >
                  <ExternalLink size={14} />
                  <span className="max-w-[150px] truncate">
                    {company.website.replace(/^https?:\/\/(www\.)?/, '')}
                  </span>
                </a>
              )}

              {/* Last Listing Date */}
              <div className="hidden md:block flex-shrink-0 text-xs text-gg-gray-400 w-24 text-right">
                {company.latest_listing_date ? (
                  <span title="Last listing created">
                    {new Date(company.latest_listing_date).toLocaleDateString()}
                  </span>
                ) : (
                  <span className="text-gg-gray-600">—</span>
                )}
              </div>

              {/* Status Counts */}
              <div className="hidden lg:flex items-center gap-2 flex-shrink-0">
                <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 rounded text-xs" title="No Sale">
                  {company.status_counts?.no_sale || 0} NS
                </span>
                <span className="px-2 py-0.5 bg-green-500/20 text-green-400 rounded text-xs" title="Sold">
                  {company.status_counts?.sold || 0} S
                </span>
                <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs" title="Pending">
                  {company.status_counts?.pending || 0} P
                </span>
              </div>

              {/* Type Counts */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="px-2 py-1 bg-gg-gray-700 text-gg-gray-300 rounded text-xs" title="Listed">
                  {company.type_counts?.listed || 0} listed
                </span>
                <span className="px-2 py-1 bg-gg-pink/20 text-white rounded text-xs font-medium" title="Live">
                  {company.type_counts?.live || 0} live
                </span>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/companies/${company.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="p-2 text-gg-gray-400 hover:text-white hover:bg-gg-gray-800 rounded-lg transition-colors"
                >
                  <Pencil size={16} />
                </Link>
                <button
                  onClick={(e) => handleDelete(company.id, e)}
                  className="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </Link>
          ))}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-6">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="text-gg-gray-400 text-sm">
              Page {safePage} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        )}

        {/* Empty State */}
        {filteredCompanies.length === 0 && (
          <div className="text-center py-12">
            <Building2 className="mx-auto text-gg-gray-600 mb-4" size={48} />
            <p className="text-gg-gray-400">
              {q ? `No companies match "${search.trim()}"` : 'No companies found'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
