'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ArrowLeft, Loader2, Filter } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import countyCentroids from '@/data/countyCentroids'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Dynamically import the map component to avoid SSR issues with Leaflet
const MapComponent = dynamic(() => import('./MapComponent'), { 
  ssr: false,
  loading: () => (
    <div className="h-[600px] bg-gg-gray-800 rounded-xl flex items-center justify-center">
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
  tracts?: { price_per_acre?: number; total_acres?: number }[]
}

interface MapListing {
  id: string
  title: string
  county: string
  state: string
  lat: number
  lng: number
  pricePerAcre: number
  totalAcres: number
  companyName: string
  companyId: string
  status: string
}

export default function AdminMapPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<Listing[]>([])
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
      // Fetch all listings
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
      console.error('Failed to fetch data:', err)
    } finally {
      setLoading(false)
    }
  }

  // Convert listings to map format with coordinates
  const mapListings = useMemo(() => {
    const result: MapListing[] = []

    listings.forEach(listing => {
      // Get state abbreviation
      const stateAbbr = getStateAbbr(listing.state)
      const key = listing.county + ', ' + stateAbbr

      const coords = countyCentroids[key]
      if (!coords) return

      // Calculate average price per acre from tracts
      let pricePerAcre = 0
      let totalAcres = 0
      if (listing.tracts && listing.tracts.length > 0) {
        const tractsWithPrice = listing.tracts.filter(t => t.price_per_acre && t.price_per_acre > 0)
        if (tractsWithPrice.length > 0) {
          pricePerAcre = tractsWithPrice.reduce((sum, t) => sum + (t.price_per_acre || 0), 0) / tractsWithPrice.length
        }
        totalAcres = listing.tracts.reduce((sum, t) => sum + (t.total_acres || 0), 0)
      }

      // Filter by company if selected
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
        totalAcres,
        companyName: listing.company_name || 'Unknown',
        companyId: listing.listing_company_id || '',
        status: listing.status
      })
    })

    return result
  }, [listings, selectedCompany])

  // Calculate price range for circle sizing
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
              <h1 className="font-display text-4xl font-bold text-white">Listings Map</h1>
              <p className="text-gg-gray-400">
                {mapListings.length} listings displayed • Circle size = price/acre
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
            <div className="w-4 h-4 rounded-full bg-green-500 opacity-70"></div>
            <span className="text-gg-gray-300 text-sm">Sold</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-blue-500 opacity-70"></div>
            <span className="text-gg-gray-300 text-sm">Listed/Active</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-yellow-500 opacity-70"></div>
            <span className="text-gg-gray-300 text-sm">Pending</span>
          </div>
          <div className="text-gg-gray-500 text-sm ml-auto">
            Price range: ${priceRange.min.toLocaleString()} - ${priceRange.max.toLocaleString()}/acre
          </div>
        </div>

        {/* Map */}
        <div className="card p-0 overflow-hidden">
          <MapComponent listings={mapListings} priceRange={priceRange} />
        </div>
      </div>
    </div>
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
