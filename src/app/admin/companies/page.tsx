'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Pencil, Trash2, Building2, ArrowLeft, ExternalLink } from 'lucide-react'

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
      const [companiesResponse, countsResponse] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/companies`),
        fetchWithAuth(`${API_URL}/api/companies/listing-counts`)
      ])
      
      if (!companiesResponse.ok) throw new Error('Failed to fetch companies')
      
      const companiesData = await companiesResponse.json()
      const listingCounts = countsResponse.ok ? await countsResponse.json() : {}
      
      const companiesWithCounts = companiesData.map((company: Company) => ({
        ...company,
        listing_count: listingCounts[company.id] || 0
      }))
      
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
              <p className="text-gg-gray-400">{companies.length} auction companies</p>
            </div>
          </div>
        </div>

        {/* Companies List */}
        <div className="space-y-2">
          {companies.map((company) => (
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

              {/* Listing Count */}
              <div className="flex-shrink-0 px-3 py-1 bg-gg-pink/20 text-gg-pink rounded-full text-sm font-medium">
                {company.listing_count || 0} listings
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
