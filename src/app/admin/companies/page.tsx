'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Search, Building2, Globe, Phone, Loader2, Plus, FileText } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Company {
  id: string
  name: string
  website: string
  phone: string
  email: string
  listing_count: number
  created_at: string
}

export default function AdminCompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    fetchCompanies(token)
  }, [router])

  const fetchCompanies = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/companies`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setCompanies(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Failed to fetch companies:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredCompanies = companies.filter(company => {
    return company.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
           company.email?.toLowerCase().includes(searchTerm.toLowerCase())
  })

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
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
              <h1 className="font-display text-4xl font-bold text-white">Companies</h1>
              <p className="text-gg-gray-400">{companies.length} listing companies</p>
            </div>
          </div>
          <button className="btn-primary flex items-center gap-2">
            <Plus size={20} />
            Add Company
          </button>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-500" size={20} />
            <input
              type="text"
              placeholder="Search companies..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
            />
          </div>
        </div>

        {/* Companies Grid */}
        {filteredCompanies.length === 0 ? (
          <div className="card text-center py-12">
            <Building2 className="mx-auto text-gg-gray-600 mb-4" size={48} />
            <p className="text-gg-gray-400">No companies found</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCompanies.map(company => (
              <div key={company.id} className="card hover:border-gg-gray-600">
                <div className="flex items-start justify-between mb-4">
                  <div className="w-12 h-12 bg-gg-pink/10 rounded-xl flex items-center justify-center">
                    <Building2 className="text-gg-pink" size={24} />
                  </div>
                  <div className="flex items-center gap-1 text-gg-gray-400 text-sm">
                    <FileText size={14} />
                    <span>{company.listing_count || 0} listings</span>
                  </div>
                </div>
                
                <h3 className="font-semibold text-white text-lg mb-3">{company.name}</h3>
                
                <div className="space-y-2 text-sm">
                  {company.website && (
                    <div className="flex items-center gap-2 text-gg-gray-400">
                      <Globe size={14} className="flex-shrink-0" />
                      <a 
                        href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-gg-pink truncate"
                      >
                        {company.website.replace(/^https?:\/\//, '')}
                      </a>
                    </div>
                  )}
                  {company.phone && (
                    <div className="flex items-center gap-2 text-gg-gray-400">
                      <Phone size={14} className="flex-shrink-0" />
                      <span>{company.phone}</span>
                    </div>
                  )}
                </div>
                
                <div className="mt-4 pt-4 border-t border-gg-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gg-gray-500">
                    Added {formatDate(company.created_at)}
                  </span>
                  <button className="text-gg-pink text-sm hover:underline">
                    Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
