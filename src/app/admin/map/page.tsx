'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ArrowLeft, Loader2, Filter } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import type { ApiListing } from '@/components/map/mapTypes'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// Dynamically import the map component to avoid SSR issues
const TractMap = dynamic(() => import('@/components/map/TractMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[840px] bg-gg-gray-800 rounded-xl flex items-center justify-center">
      <Loader2 className="animate-spin text-gg-pink" size={32} />
    </div>
  )
})

export default function AdminMapPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<ApiListing[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [selectedCompany, setSelectedCompany] = useState<string>('all')

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    fetchData()
  }, [router])

  const fetchData = async () => {
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
      console.error('Failed to fetch data:', err)
    } finally {
      setLoading(false)
    }
  }

  const mapFilters = useMemo(() => ({
    company: selectedCompany,
  }), [selectedCompany])

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
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-4xl font-bold text-white">Tract Map</h1>
              <p className="text-gg-gray-400">
                Tract-level view • Zoom in for polygon detail
              </p>
            </div>
          </div>

          {/* Company Filter */}
          <div className="flex items-center gap-2">
            <Filter size={18} className="text-gg-gray-400" />
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value)}
              className="bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white min-w-[200px]"
            >
              <option value="all">All Companies</option>
              {companies.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Legend */}
        <div className="card mb-6 flex items-center gap-8">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ background: '#2563EB' }}></div>
            <span className="text-gg-gray-300 text-sm">Listed</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ background: '#16A34A' }}></div>
            <span className="text-gg-gray-300 text-sm">Live</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ background: '#DC2626' }}></div>
            <span className="text-gg-gray-300 text-sm">Sold</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full" style={{ background: '#6B7280' }}></div>
            <span className="text-gg-gray-300 text-sm">No Sale</span>
          </div>
        </div>

        {/* Map */}
        <div className="card p-0 overflow-hidden">
          <TractMap
            listings={listings}
            height="840px"
            filters={mapFilters}
          />
        </div>
      </div>
    </div>
  )
}
