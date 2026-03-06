'use client'

import { useState, useEffect } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { Loader2, ArrowLeft, MapPin, Mail, Check, BarChart3, Filter, CheckCircle, List, Map } from 'lucide-react'

const ComparablesMap = dynamic(() => import('@/components/map/ComparablesMap'), { ssr: false })

const API_URL = 'https://practical-serenity-production.up.railway.app'
const FALLBACK_IMAGE = 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=600'

interface Company {
  id: string
  name: string
}

interface Tract {
  id: string
  tract_number?: number
  total_acres?: number
  tillable_acres?: number
  soil_rating?: number
  land_type?: string
}

interface Listing {
  id: string
  county: string
  state: string
  tracts?: Tract[]
}

interface Comparable {
  id: string
  tract_id?: string
  county: string
  state: string
  tract_number?: number
  total_acres?: number
  tillable_acres?: number
  pct_tillable?: number
  soil_rating?: number
  price_per_acre?: number
  auction_datetime?: string
  auction_date?: string
  primary_image_url?: string
  is_same_county?: boolean
  latitude?: number | null
  longitude?: number | null
  company?: Company
  company_name?: string
  listing_company?: Company
}

interface SearchCriteria {
  county?: string
  state?: string
  subject_latitude?: number | null
  subject_longitude?: number | null
}

interface User {
  email: string
  account_type: string
}

const ALLOWED_ROLES = ['groundgoat_admin', 'groundgoat_sales', 'firm_admin', 'firm_user']

export default function ComparablesPage({ params }: { params: { id: string } }) {
  const { id } = params
  const router = useRouter()
  const searchParams = useSearchParams()
  const tractId = searchParams.get('tractId')

  const [user, setUser] = useState<User | null>(null)
  const [listing, setListing] = useState<Listing | null>(null)
  const [tract, setTract] = useState<Tract | null>(null)
  const [comparables, setComparables] = useState<Comparable[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [loadingComparables, setLoadingComparables] = useState(true)
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [searchCriteria, setSearchCriteria] = useState<SearchCriteria | null>(null)
  const [stateSales, setStateSales] = useState<any[]>([])

  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    if (user) {
      fetchListing()
    }
  }, [user, id])

  useEffect(() => {
    if (listing && tractId) {
      const foundTract = listing.tracts?.find(t => t.id === tractId)
      setTract(foundTract || null)
      if (foundTract) {
        fetchComparables(foundTract.id)
      }
    }
  }, [listing, tractId])

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
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchListing = async () => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/listings/${id}`)
      if (response.ok) {
        const data = await response.json()
        setListing(data)
      } else {
        router.push('/listings')
      }
    } catch (err) {
      console.error('Failed to fetch listing:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchComparables = async (tractIdToFetch: string) => {
    setLoadingComparables(true)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/comparables/tract/${tractIdToFetch}`)
      if (response.ok) {
        const data = await response.json()
        setComparables(data?.comparables || [])
        setSearchCriteria(data?.search_criteria || null)

        // Fetch all sold tracts in state for map background pins
        if (listing?.state) {
          try {
            const salesResponse = await fetchWithAuth(
              `${API_URL}/api/comparables/state-sales/${encodeURIComponent(listing.state)}`
            )
            if (salesResponse.ok) {
              const salesData = await salesResponse.json()
              setStateSales(salesData?.tracts || [])
            }
          } catch (e) {
            console.log('Error fetching state sales:', e)
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch comparables:', err)
      setComparables([])
    } finally {
      setLoadingComparables(false)
    }
  }

  const toggleSelection = (comp: Comparable) => {
    const itemId = comp.tract_id || comp.id
    setSelectedIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  const handleEmailComparables = async () => {
    const selectedComps = comparables.filter(c => selectedIds.has(c.tract_id || c.id))

    if (selectedComps.length === 0) {
      alert('Please select comparables to include in the email.')
      return
    }

    setSendingEmail(true)
    setEmailSent(false)

    try {
      const subjectPct = tract?.tillable_acres && tract?.total_acres
        ? `${Math.round((tract.tillable_acres / tract.total_acres) * 100)}%`
        : undefined

      const response = await fetchWithAuth(`${API_URL}/api/comparables/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: id,
          tract_id: tractId,
          subject_county: listing?.county,
          subject_state: listing?.state,
          subject_tract_number: tract?.tract_number?.toString() || '—',
          subject_acres: formatAcres(tract?.total_acres),
          subject_tillable_pct: subjectPct || null,
          subject_soil_rating: tract?.soil_rating?.toString() || null,
          comparables: selectedComps.map(comp => ({
            county: comp.county,
            state: comp.state,
            tract_number: comp.tract_number?.toString() || null,
            total_acres: comp.total_acres || null,
            tillable_acres: comp.tillable_acres || null,
            pct_tillable: comp.pct_tillable || null,
            soil_rating: comp.soil_rating || null,
            price_per_acre: comp.price_per_acre || null,
            auction_datetime: comp.auction_datetime || null,
            auction_date: comp.auction_date || null,
            company_name: comp.company?.name || comp.company_name || comp.listing_company?.name || null,
          })),
        }),
      })

      if (response.ok) {
        setEmailSent(true)
        setTimeout(() => setEmailSent(false), 4000)
      } else {
        const data = await response.json().catch(() => ({}))
        alert(data.detail || 'Failed to send email. Please try again.')
      }
    } catch (err) {
      console.error('Failed to send comparables email:', err)
      alert('Failed to send email. Please try again.')
    } finally {
      setSendingEmail(false)
    }
  }

  const formatCurrency = (value: number | undefined) => {
    if (!value) return '—'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
  }

  const formatAcres = (acres: number | undefined) => {
    if (!acres && acres !== 0) return '—'
    return acres.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  const formatDate = (dateString: string | undefined) => {
    if (!dateString) return '—'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatPctTillable = (pct: number | undefined) => {
    if (pct === null || pct === undefined) return '—'
    return `${Math.round(pct)}%`
  }

  const getCompanyName = (comp: Comparable) => {
    if (comp.company?.name) return comp.company.name
    if (comp.company_name) return comp.company_name
    if (comp.listing_company?.name) return comp.listing_company.name
    return null
  }

  const getSubjectPctTillable = () => {
    if (!tract?.total_acres || !tract?.tillable_acres) return null
    const total = tract.total_acres
    const tillable = tract.tillable_acres
    if (total <= 0) return null
    return (tillable / total) * 100
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  if (!listing || !tract) {
    return (
      <div className="min-h-screen bg-gg-black pt-24 flex items-center justify-center">
        <div className="text-center">
          <BarChart3 className="mx-auto text-gg-gray-600 mb-4" size={48} />
          <p className="text-gg-gray-400 mb-4">Tract not found</p>
          <Link href={`/listings/${id}`} className="text-gg-pink hover:underline">
            Back to Listing
          </Link>
        </div>
      </div>
    )
  }

  const subjectPctTillable = getSubjectPctTillable()
  const canEmail = selectedIds.size > 0
  const hasSubjectCoords = !!(searchCriteria?.subject_latitude && searchCriteria?.subject_longitude)

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-5xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              href={`/listings/${id}`}
              className="text-gg-gray-400 hover:text-white"
            >
              <ArrowLeft size={24} />
            </Link>
            <h1 className="font-display text-2xl font-bold text-white">Comparables</h1>
          </div>
          <button
            onClick={handleEmailComparables}
            disabled={!canEmail || sendingEmail}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
              emailSent
                ? 'bg-green-600 text-white'
                : canEmail && !sendingEmail
                  ? 'bg-gg-pink text-white hover:bg-gg-pink/80'
                  : 'bg-gg-gray-800 text-gg-gray-500 cursor-not-allowed'
            }`}
          >
            {sendingEmail ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Sending...
              </>
            ) : emailSent ? (
              <>
                <CheckCircle size={18} />
                Sent!
              </>
            ) : (
              <>
                <Mail size={18} />
                Email Selected ({selectedIds.size})
              </>
            )}
          </button>
        </div>

        {/* Subject Tract Info */}
        <div className="bg-gg-gray-900 border-l-4 border-gg-pink rounded-lg p-4 mb-6">
          <div className="text-gg-gray-400 text-sm mb-1">Finding comparables for:</div>
          <div className="text-white text-xl font-semibold mb-2">
            {listing.county} County, {listing.state}
          </div>
          <div className="text-gg-gray-300">
            Tract {tract.tract_number || '—'} • {formatAcres(tract.total_acres)} acres
            {subjectPctTillable !== null && ` • ${Math.round(subjectPctTillable)}% tillable`}
            {tract.soil_rating && ` • ${tract.soil_rating} Soil Rating`}
          </div>
          {tract.land_type && (
            <span className="inline-block mt-2 px-2 py-1 bg-gg-pink text-white text-xs font-semibold rounded-full">
              {tract.land_type}
            </span>
          )}
        </div>

        {/* Map / List Toggle — only shown when subject tract has coordinates */}
        {hasSubjectCoords && (
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'list'
                  ? 'bg-gg-pink text-white'
                  : 'bg-gg-gray-800 text-gg-gray-400 hover:text-white'
              }`}
            >
              <List size={16} />
              List
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                viewMode === 'map'
                  ? 'bg-gg-pink text-white'
                  : 'bg-gg-gray-800 text-gg-gray-400 hover:text-white'
              }`}
            >
              <Map size={16} />
              Map
            </button>
          </div>
        )}

        {(viewMode === 'map' && hasSubjectCoords) ? (
          /* Map View */
          loadingComparables ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="animate-spin text-gg-pink mb-4" size={32} />
              <span className="text-gg-gray-400">Finding comparable sales...</span>
            </div>
          ) : comparables.length === 0 ? (
            <div className="text-center py-12">
              <BarChart3 className="mx-auto text-gg-gray-600 mb-4" size={48} />
              <h3 className="text-white text-lg font-semibold mb-2">No Comparables Found</h3>
              <p className="text-gg-gray-400 max-w-md mx-auto">
                We couldn't find any comparable sales matching your criteria in {listing.state}.
              </p>
            </div>
          ) : (
            <ComparablesMap
              comparables={comparables.map(c => ({
                id: c.tract_id || c.id,
                county: c.county,
                state: c.state,
                latitude: c.latitude,
                longitude: c.longitude,
                price_per_acre: c.price_per_acre,
                total_acres: c.total_acres,
                tract_number: c.tract_number,
                company_name: c.company?.name || c.company_name || c.listing_company?.name,
                auction_date: c.auction_datetime || c.auction_date,
                is_same_county: c.is_same_county,
              }))}
              stateSales={stateSales}
              subjectCounty={listing.county}
              subjectState={listing.state}
              subjectLatitude={searchCriteria?.subject_latitude}
              subjectLongitude={searchCriteria?.subject_longitude}
              subjectAcres={tract.total_acres}
              height="550px"
            />
          )
        ) : (
          /* List View */
          <>
            {/* Selection Hint */}
            <div className="bg-gg-pink/10 border border-gg-pink/20 rounded-lg px-4 py-3 mb-4 flex items-center gap-2">
              <span className="text-gg-pink">👆</span>
              <span className="text-gg-pink text-sm font-medium">
                Click comparables to select them for email
              </span>
            </div>

            {/* Filter Info */}
            <div className="flex items-center gap-2 text-gg-gray-500 text-sm mb-4">
              <Filter size={14} />
              <span>Showing sold tracts in {listing.state}, ranked by similarity</span>
            </div>

            {/* Results Count */}
            {!loadingComparables && comparables.length > 0 && (
              <div className="text-gg-gray-400 text-sm mb-4 font-medium">
                {comparables.length} comparable{comparables.length !== 1 ? 's' : ''} found
                {selectedIds.size > 0 && ` • ${selectedIds.size} selected`}
                {comparables.filter(c => c.is_same_county).length > 0 && (
                  <span> ({comparables.filter(c => c.is_same_county).length} in same county)</span>
                )}
              </div>
            )}

            {/* Comparables List */}
            {loadingComparables ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="animate-spin text-gg-pink mb-4" size={32} />
                <span className="text-gg-gray-400">Finding comparable sales...</span>
              </div>
            ) : comparables.length === 0 ? (
              <div className="text-center py-12">
                <BarChart3 className="mx-auto text-gg-gray-600 mb-4" size={48} />
                <h3 className="text-white text-lg font-semibold mb-2">No Comparables Found</h3>
                <p className="text-gg-gray-400 max-w-md mx-auto">
                  We couldn't find any comparable sales matching your criteria in {listing.state}.
                  Try checking back later as more sales are added.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {comparables.map((comp) => {
                  const itemId = comp.tract_id || comp.id
                  const isSelected = selectedIds.has(itemId)

                  return (
                    <button
                      key={itemId}
                      onClick={() => toggleSelection(comp)}
                      className={`w-full flex items-stretch bg-gg-gray-900 rounded-lg overflow-hidden border-2 transition-all text-left ${
                        isSelected
                          ? 'border-gg-pink shadow-lg shadow-gg-pink/20'
                          : comp.is_same_county
                            ? 'border-gg-pink/30 hover:border-gg-pink/50'
                            : 'border-transparent hover:border-gg-gray-700'
                      }`}
                    >
                      {/* Image */}
                      <div className="w-28 h-28 flex-shrink-0 bg-gg-gray-800">
                        <img
                          src={comp.primary_image_url || FALLBACK_IMAGE}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).src = FALLBACK_IMAGE }}
                        />
                      </div>

                      {/* Content */}
                      <div className="flex-1 p-3 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-white font-semibold truncate">
                            {comp.county} County, {comp.state}
                          </span>
                          {comp.is_same_county && (
                            <span className="px-2 py-0.5 bg-gg-pink/20 text-gg-pink text-xs font-semibold rounded">
                              Same County
                            </span>
                          )}
                        </div>
                        <div className="text-gg-pink text-sm mb-1">
                          {comp.tract_number ? `Tract ${comp.tract_number} • ` : ''}
                          Sold {formatDate(comp.auction_datetime || comp.auction_date)}
                        </div>
                        {getCompanyName(comp) && (
                          <div className="text-gg-gray-400 text-sm mb-2 truncate">
                            {getCompanyName(comp)}
                          </div>
                        )}

                        {/* Stats */}
                        <div className="grid grid-cols-4 gap-2 text-center">
                          <div>
                            <div className="text-white font-medium text-sm">{formatAcres(comp.total_acres)}</div>
                            <div className="text-gg-gray-500 text-xs">Acres</div>
                          </div>
                          <div>
                            <div className="text-white font-medium text-sm">
                              {comp.price_per_acre ? formatCurrency(comp.price_per_acre) : '—'}
                            </div>
                            <div className="text-gg-gray-500 text-xs">$/Acre</div>
                          </div>
                          <div>
                            <div className="text-white font-medium text-sm">{formatPctTillable(comp.pct_tillable)}</div>
                            <div className="text-gg-gray-500 text-xs">Tillable</div>
                          </div>
                          <div>
                            <div className="text-white font-medium text-sm">{comp.soil_rating || '—'}</div>
                            <div className="text-gg-gray-500 text-xs">Soil Rating</div>
                          </div>
                        </div>
                      </div>

                      {/* Selection Indicator */}
                      {isSelected && (
                        <div className="flex items-center justify-center px-3 bg-gg-pink/10">
                          <div className="w-6 h-6 bg-gg-pink rounded-full flex items-center justify-center">
                            <Check size={14} className="text-white" />
                          </div>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
