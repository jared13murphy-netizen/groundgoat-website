'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Pencil, Trash2, Building2, ArrowLeft, Plus, ExternalLink } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Company {
  id: string
  name: string
  website: string
  logo_url: string
  city: string
  state: string
  listing_count?: number
}

export default function AdminCompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)

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
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

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
      // Fetch companies and listing counts in parallel
      const [companiesResponse, countsResponse] = await Promise.all([
        fetch(`${API_URL}/api/companies`, {
          headers: { 'Authorization': `Bearer ${token}` },
        }),
        fetch(`${API_URL}/api/companies/listing-counts`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
      ])
      
      if (!companiesResponse.ok) throw new Error('Failed to fetch companies')
      
      const companiesData = await companiesResponse.json()
      const listingCounts = countsResponse.ok ? await countsResponse.json() : {}
      
      // Add listing counts to companies
      const companiesWithCounts = companiesData.map((company: Company) => ({
        ...company,
        listing_count: listingCounts[company.id] || 0
      }))
      
      // Sort alphabetically by name
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

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this company? This may affect associated listings.')) return

    const token = localStorage.getItem('auth_token')
    try {
      const response = await fetch(`${API_URL}/api/companies/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
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

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Companies</h1>
              <p className="text-gg-gray-400">{companies.length} auction companies</p>
            </div>
          </div>
        </div>

        {/* Companies Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5">
          {companies.map((company) => (
            <div key={company.id} className="card overflow-hidden">
              {/* Header with logo */}
              <div className="relative h-20 bg-gg-gray-800 flex items-center justify-center">
                {company.logo_url ? (
                  <div className="bg-white rounded-lg p-2 flex items-center justify-center">
                    <img
                      src={company.logo_url}
                      alt={company.name}
                      className="h-8 object-contain max-w-[100px]"
                    />
                  </div>
                ) : (
                  <Building2 className="text-gg-gray-600" size={28} />
                )}
                {/* Listing count badge */}
                <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-gg-pink text-black rounded-full text-[10px] font-semibold">
                  {company.listing_count || 0} listings
                </div>
              </div>

              {/* Content */}
              <div className="p-4">
                <h3 className="text-white font-semibold text-sm mb-0.5 line-clamp-1">{company.name}</h3>
                {(company.city || company.state) && (
                  <p className="text-gg-gray-400 text-xs mb-2">
                    {[company.city, company.state].filter(Boolean).join(', ')}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-1.5 pt-2 border-t border-gg-gray-800">
                  {company.website && (
                    <a
                      href={company.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1 px-2 py-1.5 bg-gg-gray-800 text-white rounded-md hover:bg-gg-gray-700 transition-colors text-xs"
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                  <Link
                    href={`/admin/companies/${company.id}`}
                    className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-gg-gray-800 text-white rounded-md hover:bg-gg-gray-700 transition-colors text-xs"
                  >
                    <Pencil size={12} />
                    Edit
                  </Link>
                  <button
                    onClick={() => handleDelete(company.id)}
                    className="flex items-center justify-center px-2 py-1.5 bg-red-500/20 text-red-400 rounded-md hover:bg-red-500/30 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {companies.length === 0 && (
          <div className="text-center py-12">
            <Building2 className="mx-auto text-gg-gray-600 mb-4" size={48} />
            <p className="text-gg-gray-400">No companies found</p>
          </div>
        )}
      </div>
    </div>
  )
}
