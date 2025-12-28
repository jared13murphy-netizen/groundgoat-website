'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Bell, ChevronDown, ChevronUp, RefreshCw, Save } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const BID_INCREMENTS = [5000, 2500, 1000, 500, 250, 150, 100, 50, 25]
const TRACT_STATUSES = ['Listed', 'Live', 'Pending', 'Sold', 'No Sale']
const LISTING_STATUSES = ['Listed', 'Live', 'Sold', 'No Sale']

interface Tract {
  id: string
  tract_number: number
  total_acres: number
  tillable_acres: number
  land_type: string
  sale_price: number | null
  price_per_acre: number | null
  sale_status: string | null
  soil_rating: number | null
}

interface Company {
  id: string
  name: string
}

interface Listing {
  id: string
  title: string
  description: string
  county: string
  state: string
  total_acres: number
  auction_date: string
  auction_datetime: string
  auction_time: string
  status: string
  company: Company | null
  source_url: string
  tracts: Tract[]
}

interface TractState {
  pricePerAcre: number
  bidIncrement: number
  status: string
  saving: boolean
  bidMode: 'per_acre' | 'lump_sum'
}

export default function ControlCenterPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<Listing[]>([])
  const [tractStates, setTractStates] = useState<Record<string, TractState>>({})
  const [expandedListings, setExpandedListings] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [savingListing, setSavingListing] = useState<string | null>(null)

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

      await fetchTodaysAuctions(token)
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchTodaysAuctions = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/listings/today`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const listingsWithTracts = await response.json()
        setListings(listingsWithTracts)

        const initialStates: Record<string, TractState> = {}
        const expandedIds: string[] = []
        listingsWithTracts.forEach((listing: Listing) => {
          listing.tracts?.forEach((tract: Tract) => {
            initialStates[tract.id] = {
              pricePerAcre: tract.price_per_acre || 0,
              bidIncrement: 1000,
              status: normalizeStatus(tract.sale_status || 'listed'),
              saving: false,
              bidMode: 'per_acre',
            }
          })
          expandedIds.push(listing.id)
        })
        setTractStates(initialStates)
        setExpandedListings(new Set(expandedIds))
      }
    } catch (err) {
      setError('Failed to fetch auctions')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const normalizeStatus = (status: string): string => {
    if (!status) return 'Listed'
    const lower = status.toLowerCase().replace('_', ' ')
    if (lower === 'no sale') return 'No Sale'
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }

  const toDbStatus = (status: string): string => {
    return status.toLowerCase().replace(' ', '_')
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    const token = localStorage.getItem('auth_token')
    if (token) {
      await fetchTodaysAuctions(token)
    }
  }

  const toggleListing = (listingId: string) => {
    setExpandedListings(prev => {
      const newSet = new Set(prev)
      if (newSet.has(listingId)) {
        newSet.delete(listingId)
      } else {
        newSet.add(listingId)
      }
      return newSet
    })
  }

  const updateTractState = (tractId: string, updates: Partial<TractState>) => {
    setTractStates(prev => ({
      ...prev,
      [tractId]: { ...prev[tractId], ...updates }
    }))
  }

  const handlePricePerAcreChange = (tractId: string, price: string) => {
    const numPrice = parseFloat(price) || 0
    updateTractState(tractId, { pricePerAcre: numPrice })
  }

  const handleLumpSumChange = (tractId: string, totalPrice: string, acres: number) => {
    const numPrice = parseFloat(totalPrice) || 0
    const pricePerAcre = acres > 0 ? numPrice / acres : 0
    updateTractState(tractId, { pricePerAcre })
  }

  const handleAddBid = (tractId: string, acres: number) => {
    const state = tractStates[tractId]
    if (state) {
      if (state.bidMode === 'per_acre') {
        // Add increment to price per acre
        updateTractState(tractId, { pricePerAcre: state.pricePerAcre + state.bidIncrement })
      } else {
        // Add increment to total price, then convert to price per acre
        const currentTotal = state.pricePerAcre * acres
        const newTotal = currentTotal + state.bidIncrement
        const newPricePerAcre = acres > 0 ? newTotal / acres : 0
        updateTractState(tractId, { pricePerAcre: newPricePerAcre })
      }
    }
  }

  const handleSetIncrement = (tractId: string, increment: number) => {
    updateTractState(tractId, { bidIncrement: increment })
  }

  const handleSetStatus = (tractId: string, status: string) => {
    updateTractState(tractId, { status })
  }

  const handleToggleBidMode = (tractId: string) => {
    const state = tractStates[tractId]
    if (state) {
      updateTractState(tractId, { 
        bidMode: state.bidMode === 'per_acre' ? 'lump_sum' : 'per_acre' 
      })
    }
  }

  const handleSetListingStatus = async (listingId: string, status: string) => {
    setListings(prev => prev.map(l => 
      l.id === listingId ? { ...l, status: toDbStatus(status) } : l
    ))
  }

  const calculateListingStatus = (tracts: Tract[], tractStates: Record<string, TractState>): string => {
    if (!tracts || tracts.length === 0) return 'Listed'
    
    const statuses = tracts.map(t => tractStates[t.id]?.status || normalizeStatus(t.sale_status || 'listed'))
    
    // If at least one tract is Live, listing is Live
    if (statuses.some(s => s === 'Live')) return 'Live'
    
    // If at least one tract is Sold AND no tracts are Listed or Live, listing is Sold
    const hasSold = statuses.some(s => s === 'Sold')
    const hasListedOrLive = statuses.some(s => s === 'Listed' || s === 'Live')
    if (hasSold && !hasListedOrLive) return 'Sold'
    
    // If all tracts are Pending, listing is Pending
    if (statuses.every(s => s === 'Pending')) return 'Pending'
    
    // If all tracts are No Sale, listing is No Sale
    if (statuses.every(s => s === 'No Sale')) return 'No Sale'
    
    // Otherwise listing is Listed
    return 'Listed'
  }

  const calculateSoldAcres = (tracts: Tract[], tractStates: Record<string, TractState>): number => {
    if (!tracts || tracts.length === 0) return 0
    
    return tracts.reduce((sum, tract) => {
      const status = tractStates[tract.id]?.status || normalizeStatus(tract.sale_status || 'listed')
      if (status === 'Sold') {
        return sum + (tract.total_acres || 0)
      }
      return sum
    }, 0)
  }

  const getTotalPrice = (tractId: string, acres: number): number => {
    const state = tractStates[tractId]
    if (!state) return 0
    return state.pricePerAcre * acres
  }

  const handleSaveTract = async (tractId: string, listingId: string) => {
    const state = tractStates[tractId]
    if (!state) return

    updateTractState(tractId, { saving: true })
    const token = localStorage.getItem('auth_token')

    try {
      const listing = listings.find(l => l.id === listingId)
      const tract = listing?.tracts?.find(t => t.id === tractId)
      const totalPrice = tract?.total_acres ? state.pricePerAcre * tract.total_acres : 0

      // Update tract
      const response = await fetch(`${API_URL}/api/tracts/${tractId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sale_price: totalPrice,
          price_per_acre: state.pricePerAcre,
          sale_status: toDbStatus(state.status),
        }),
      })

      if (response.ok) {
        // Calculate total sale price from all tracts for this listing
        const allTracts = listing?.tracts || []
        let totalSalePrice = 0
        allTracts.forEach(t => {
          if (t.id === tractId) {
            totalSalePrice += totalPrice
          } else {
            const tState = tractStates[t.id]
            totalSalePrice += tState ? tState.pricePerAcre * (t.total_acres || 0) : (t.sale_price || 0)
          }
        })

        // Calculate listing status and sold acres
        const listingStatus = calculateListingStatus(allTracts, { ...tractStates, [tractId]: state })
        const soldAcres = calculateSoldAcres(allTracts, { ...tractStates, [tractId]: state })

        // Update listing
        const listingPricePerAcre = listing?.total_acres ? totalSalePrice / listing.total_acres : null
        
        await fetch(`${API_URL}/api/listings/${listingId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sale_price: totalSalePrice,
            price_per_acre: listingPricePerAcre,
            status: toDbStatus(listingStatus),
            sold_acres: soldAcres,
          }),
        })

        // Update local state
        setListings(prev => prev.map(l => {
          if (l.id === listingId) {
            return {
              ...l,
              status: toDbStatus(listingStatus),
              tracts: l.tracts.map(t => {
                if (t.id === tractId) {
                  return { ...t, sale_price: totalPrice, sale_status: toDbStatus(state.status), price_per_acre: state.pricePerAcre }
                }
                return t
              })
            }
          }
          return l
        }))
      } else {
        setError('Failed to save tract')
      }
    } catch (err) {
      setError('Failed to save tract')
    } finally {
      updateTractState(tractId, { saving: false })
    }
  }

  const handleSaveAndNotify = async (listingId: string) => {
    setSavingListing(listingId)
    const token = localStorage.getItem('auth_token')
    const listing = listings.find(l => l.id === listingId)
    
    if (!listing) return

    try {
      // Save all tracts first
      for (const tract of listing.tracts || []) {
        const state = tractStates[tract.id]
        if (state) {
          const totalPrice = tract.total_acres ? state.pricePerAcre * tract.total_acres : 0
          await fetch(`${API_URL}/api/tracts/${tract.id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sale_price: totalPrice,
              price_per_acre: state.pricePerAcre,
              sale_status: toDbStatus(state.status),
            }),
          })
        }
      }

      // Calculate totals
      const allTracts = listing.tracts || []
      let totalSalePrice = 0
      allTracts.forEach(t => {
        const tState = tractStates[t.id]
        totalSalePrice += tState ? tState.pricePerAcre * (t.total_acres || 0) : (t.sale_price || 0)
      })

      const listingStatus = calculateListingStatus(allTracts, tractStates)
      const soldAcres = calculateSoldAcres(allTracts, tractStates)
      const listingPricePerAcre = listing.total_acres ? totalSalePrice / listing.total_acres : null

      // Update listing
      await fetch(`${API_URL}/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sale_price: totalSalePrice,
          price_per_acre: listingPricePerAcre,
          status: toDbStatus(listingStatus),
          sold_acres: soldAcres,
        }),
      })

      // Send notification
      await fetch(`${API_URL}/api/notifications/listing-result`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          listing_id: listingId,
        }),
      })

      // Update local state
      setListings(prev => prev.map(l => {
        if (l.id === listingId) {
          return { ...l, status: toDbStatus(listingStatus) }
        }
        return l
      }))

      alert('Listing saved and notifications sent!')
    } catch (err) {
      setError('Failed to save and notify')
    } finally {
      setSavingListing(null)
    }
  }

  const handleSaveWithoutNotify = async (listingId: string) => {
    setSavingListing(listingId)
    const token = localStorage.getItem('auth_token')
    const listing = listings.find(l => l.id === listingId)
    
    if (!listing) return

    try {
      // Save all tracts first
      for (const tract of listing.tracts || []) {
        const state = tractStates[tract.id]
        if (state) {
          const totalPrice = tract.total_acres ? state.pricePerAcre * tract.total_acres : 0
          await fetch(`${API_URL}/api/tracts/${tract.id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sale_price: totalPrice,
              price_per_acre: state.pricePerAcre,
              sale_status: toDbStatus(state.status),
            }),
          })
        }
      }

      // Calculate totals
      const allTracts = listing.tracts || []
      let totalSalePrice = 0
      allTracts.forEach(t => {
        const tState = tractStates[t.id]
        totalSalePrice += tState ? tState.pricePerAcre * (t.total_acres || 0) : (t.sale_price || 0)
      })

      const listingStatus = calculateListingStatus(allTracts, tractStates)
      const soldAcres = calculateSoldAcres(allTracts, tractStates)
      const listingPricePerAcre = listing.total_acres ? totalSalePrice / listing.total_acres : null

      // Update listing
      await fetch(`${API_URL}/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sale_price: totalSalePrice,
          price_per_acre: listingPricePerAcre,
          status: toDbStatus(listingStatus),
          sold_acres: soldAcres,
        }),
      })

      // Update local state
      setListings(prev => prev.map(l => {
        if (l.id === listingId) {
          return { ...l, status: toDbStatus(listingStatus) }
        }
        return l
      }))

      alert('Listing saved!')
    } catch (err) {
      setError('Failed to save listing')
    } finally {
      setSavingListing(null)
    }
  }

  const formatDateTime = (dateTimeStr: string | null) => {
    if (!dateTimeStr) return 'TBD'
    try {
      const date = new Date(dateTimeStr)
      return date.toLocaleString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric',
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      })
    } catch {
      return 'TBD'
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '-'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
  }

  const getStatusColor = (status: string) => {
    const normalized = normalizeStatus(status)
    switch (normalized) {
      case 'Listed': return 'bg-blue-500'
      case 'Live': return 'bg-green-500'
      case 'Pending': return 'bg-yellow-500 text-black'
      case 'Sold': return 'bg-purple-500'
      case 'No Sale': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const isListingLive = (listing: Listing): boolean => {
    return normalizeStatus(listing.status) === 'Live'
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
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Auction Control Center</h1>
              <p className="text-gg-gray-400">
                {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                {' • '}{listings.length} auction{listings.length !== 1 ? 's' : ''} today
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 disabled:opacity-50"
          >
            <RefreshCw className={refreshing ? 'animate-spin' : ''} size={16} />
            Refresh
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400">
            {error}
            <button onClick={() => setError('')} className="ml-4 underline">Dismiss</button>
          </div>
        )}

        {/* No Auctions */}
        {listings.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gg-gray-400 text-lg">No auctions scheduled for today</p>
          </div>
        )}

        {/* Auctions List */}
        <div className="space-y-4">
          {listings.map(listing => (
            <div 
              key={listing.id} 
              className={`bg-gg-gray-900 rounded-xl overflow-hidden ${
                isListingLive(listing) 
                  ? 'border-2 border-white' 
                  : 'border border-gg-gray-800'
              }`}
            >
              {/* Listing Header */}
              <div 
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gg-gray-800/50"
                onClick={() => toggleListing(listing.id)}
              >
                <div className="flex-1">
                  <p className="text-gg-gray-400 text-sm mb-1">{formatDateTime(listing.auction_datetime)}</p>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gg-pink">{listing.company?.name || 'Unknown Company'}</span>
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${getStatusColor(listing.status)}`}>
                      {normalizeStatus(listing.status)}
                    </span>
                  </div>
                  <h3 className="text-white font-medium mt-1">
                    {listing.county} County, {listing.state} • {listing.total_acres} acres
                  </h3>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-gg-gray-400 text-sm">{listing.tracts?.length || 0} tracts</p>
                  </div>
                  {expandedListings.has(listing.id) ? (
                    <ChevronUp className="text-gg-gray-400" size={20} />
                  ) : (
                    <ChevronDown className="text-gg-gray-400" size={20} />
                  )}
                </div>
              </div>

              {/* Expanded Content */}
              {expandedListings.has(listing.id) && (
                <div className="border-t border-gg-gray-800">
                  {/* Listing Actions */}
                  <div className="p-4 bg-gg-gray-800/30 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/listings/${listing.id}`}
                        className="px-3 py-1.5 bg-gg-gray-700 text-white text-sm rounded-lg hover:bg-gg-gray-600"
                      >
                        Edit Listing
                      </Link>
                      {/* Listing Status Selector */}
                      <div className="flex items-center gap-1 ml-4">
                        <span className="text-gg-gray-400 text-sm mr-2">Status:</span>
                        {LISTING_STATUSES.map(status => (
                          <button
                            key={status}
                            onClick={(e) => { e.stopPropagation(); handleSetListingStatus(listing.id, status) }}
                            className={`px-2 py-1 text-xs rounded-lg ${
                              normalizeStatus(listing.status) === status
                                ? getStatusColor(status) + ' text-white'
                                : 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
                            }`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSaveWithoutNotify(listing.id) }}
                        disabled={savingListing === listing.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-gg-gray-600 text-white text-sm rounded-lg hover:bg-gg-gray-500 disabled:opacity-50"
                      >
                        <Save size={14} />
                        Save
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSaveAndNotify(listing.id) }}
                        disabled={savingListing === listing.id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-500 disabled:opacity-50"
                      >
                        <Bell size={14} />
                        {savingListing === listing.id ? 'Saving...' : 'Save & Notify'}
                      </button>
                    </div>
                  </div>

                  {/* Tracts */}
                  <div className="divide-y divide-gg-gray-800">
                    {listing.tracts?.length === 0 && (
                      <p className="p-4 text-gg-gray-400 text-center">No tracts for this listing</p>
                    )}
                    {listing.tracts?.map(tract => {
                      const state = tractStates[tract.id] || { pricePerAcre: 0, bidIncrement: 1000, status: 'Listed', saving: false, bidMode: 'per_acre' }
                      const totalPrice = getTotalPrice(tract.id, tract.total_acres)
                      const isPerAcre = state.bidMode === 'per_acre'
                      
                      return (
                        <div key={tract.id} className="p-4">
                          {/* Tract Header */}
                          <div className="flex items-center justify-between mb-3">
                            <div>
                              <span className="text-white font-medium">Tract {tract.tract_number}</span>
                              <span className="text-gg-gray-400 ml-3">
                                {tract.total_acres} acres • {tract.land_type || 'N/A'}
                                {tract.soil_rating && ` • PI: ${tract.soil_rating}`}
                              </span>
                            </div>
                            <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${getStatusColor(state.status)}`}>
                              {state.status}
                            </span>
                          </div>

                          {/* Price Controls */}
                          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                            {/* Price Input with Toggle */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-gg-gray-400 text-xs">
                                  {isPerAcre ? 'Price/Acre' : 'Total Price'}
                                </label>
                                <button
                                  onClick={() => handleToggleBidMode(tract.id)}
                                  className="text-xs text-gg-pink hover:text-gg-pink/80"
                                >
                                  {isPerAcre ? '→ Lump Sum' : '→ Per Acre'}
                                </button>
                              </div>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-400">$</span>
                                {isPerAcre ? (
                                  <input
                                    type="number"
                                    value={state.pricePerAcre || ''}
                                    onChange={(e) => handlePricePerAcreChange(tract.id, e.target.value)}
                                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 pl-7 text-white text-lg font-bold"
                                  />
                                ) : (
                                  <input
                                    type="number"
                                    value={totalPrice || ''}
                                    onChange={(e) => handleLumpSumChange(tract.id, e.target.value, tract.total_acres)}
                                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 pl-7 text-white text-lg font-bold"
                                  />
                                )}
                              </div>
                              <p className="text-gg-gray-400 text-xs mt-1">
                                {isPerAcre 
                                  ? `Total: ${formatCurrency(totalPrice)}`
                                  : `${formatCurrency(state.pricePerAcre)}/acre`
                                }
                              </p>
                            </div>

                            {/* Status Selector */}
                            <div>
                              <label className="block text-gg-gray-400 text-xs mb-1">Status</label>
                              <div className="flex flex-wrap gap-1">
                                {TRACT_STATUSES.map(status => (
                                  <button
                                    key={status}
                                    onClick={() => handleSetStatus(tract.id, status)}
                                    className={`px-2 py-1 text-xs rounded-lg ${
                                      state.status === status
                                        ? getStatusColor(status) + ' text-white'
                                        : 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
                                    }`}
                                  >
                                    {status}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Bid Increment Selector */}
                            <div className="lg:col-span-2">
                              <label className="block text-gg-gray-400 text-xs mb-1">
                                Bid Increment {isPerAcre ? '(per acre)' : '(lump sum)'}
                              </label>
                              <div className="flex flex-wrap gap-1">
                                {BID_INCREMENTS.map(inc => (
                                  <button
                                    key={inc}
                                    onClick={() => handleSetIncrement(tract.id, inc)}
                                    className={`px-2 py-1 text-xs rounded-lg ${
                                      state.bidIncrement === inc
                                        ? 'bg-gg-pink text-white'
                                        : 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
                                    }`}
                                  >
                                    ${inc.toLocaleString()}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => handleAddBid(tract.id, tract.total_acres)}
                                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg font-bold hover:bg-green-500 text-sm"
                              >
                                + {formatCurrency(state.bidIncrement)}{isPerAcre ? '/ac' : ''}
                              </button>
                              <button
                                onClick={() => handleSaveTract(tract.id, listing.id)}
                                disabled={state.saving}
                                className="flex-1 px-4 py-2 bg-gg-pink text-white rounded-lg font-bold hover:bg-gg-pink/80 disabled:opacity-50 text-sm"
                              >
                                {state.saving ? 'Saving...' : 'Save Tract'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
