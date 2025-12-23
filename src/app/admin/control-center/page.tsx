'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Bell, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const BID_INCREMENTS = [5000, 2500, 1000, 500, 250, 150, 100, 50, 25]
const TRACT_STATUSES = ['listed', 'live', 'pending', 'sold', 'no_sale']

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

interface Listing {
  id: string
  title: string
  description: string
  county: string
  state: string
  total_acres: number
  auction_date: string
  auction_time: string
  status: string
  company_name: string
  source_url: string
  tracts: Tract[]
}

interface TractState {
  currentPrice: number
  bidIncrement: number
  status: string
  saving: boolean
}

export default function ControlCenterPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<Listing[]>([])
  const [tractStates, setTractStates] = useState<Record<string, TractState>>({})
  const [expandedListings, setExpandedListings] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

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
      // Get today's date in YYYY-MM-DD format
      const today = new Date()
      const todayStr = today.toISOString().split('T')[0]
      
      // Fetch all auction listings
      const response = await fetch(`${API_URL}/api/listings?limit=100&listing_type=auction`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const allListings = await response.json()
        
        // Filter for today's auctions
        const todaysAuctions = allListings.filter((listing: any) => {
          if (!listing.auction_date) return false
          const auctionDate = listing.auction_date.split('T')[0]
          return auctionDate === todayStr
        })

        // Sort by auction time (earliest first)
        todaysAuctions.sort((a: any, b: any) => {
          const timeA = a.auction_time || '23:59:59'
          const timeB = b.auction_time || '23:59:59'
          return timeA.localeCompare(timeB)
        })

        // Fetch full details with tracts for each listing
        const listingsWithTracts = await Promise.all(
          todaysAuctions.map(async (listing: any) => {
            const detailResponse = await fetch(`${API_URL}/api/listings/${listing.id}`, {
              headers: { 'Authorization': `Bearer ${token}` },
            })
            if (detailResponse.ok) {
              return await detailResponse.json()
            }
            return { ...listing, tracts: [] }
          })
        )

        setListings(listingsWithTracts)

        // Initialize tract states
        const initialStates: Record<string, TractState> = {}
        listingsWithTracts.forEach((listing: Listing) => {
          listing.tracts?.forEach((tract: Tract) => {
            initialStates[tract.id] = {
              currentPrice: tract.sale_price || 0,
              bidIncrement: 1000,
              status: tract.sale_status || 'listed',
              saving: false,
            }
          })
          // Expand all listings by default
          setExpandedListings(prev => new Set([...prev, listing.id]))
        })
        setTractStates(initialStates)
      }
    } catch (err) {
      setError('Failed to fetch auctions')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
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

  const handlePriceChange = (tractId: string, price: string) => {
    const numPrice = parseFloat(price) || 0
    updateTractState(tractId, { currentPrice: numPrice })
  }

  const handleAddBid = (tractId: string) => {
    const state = tractStates[tractId]
    if (state) {
      updateTractState(tractId, { currentPrice: state.currentPrice + state.bidIncrement })
    }
  }

  const handleSetIncrement = (tractId: string, increment: number) => {
    updateTractState(tractId, { bidIncrement: increment })
  }

  const handleSetStatus = (tractId: string, status: string) => {
    updateTractState(tractId, { status })
  }

  const handleSaveTract = async (tractId: string, listingId: string) => {
    const state = tractStates[tractId]
    if (!state) return

    updateTractState(tractId, { saving: true })
    const token = localStorage.getItem('auth_token')

    try {
      // Find the tract to get acres for price_per_acre calculation
      const listing = listings.find(l => l.id === listingId)
      const tract = listing?.tracts?.find(t => t.id === tractId)
      const pricePerAcre = tract?.total_acres ? state.currentPrice / tract.total_acres : null

      // Update tract
      const response = await fetch(`${API_URL}/api/tracts/${tractId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sale_price: state.currentPrice,
          price_per_acre: pricePerAcre,
          sale_status: state.status,
        }),
      })

      if (response.ok) {
        // Calculate total sale price from all tracts for this listing
        const allTracts = listing?.tracts || []
        let totalSalePrice = 0
        allTracts.forEach(t => {
          if (t.id === tractId) {
            totalSalePrice += state.currentPrice || 0
          } else {
            totalSalePrice += tractStates[t.id]?.currentPrice || t.sale_price || 0
          }
        })

        // Update listing sale price
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
          }),
        })

        // Update local state
        setListings(prev => prev.map(l => {
          if (l.id === listingId) {
            return {
              ...l,
              tracts: l.tracts.map(t => {
                if (t.id === tractId) {
                  return { ...t, sale_price: state.currentPrice, sale_status: state.status, price_per_acre: pricePerAcre }
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

  const handleNotifyUsers = async (listingId: string, status: 'sold' | 'no_sale') => {
    const token = localStorage.getItem('auth_token')
    
    try {
      // Update listing status
      await fetch(`${API_URL}/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      })

      // TODO: Trigger notification to subscribed users
      // This would call a notification endpoint when implemented
      
      alert(`Listing marked as ${status.replace('_', ' ')}. Notification feature coming soon!`)
      
      // Update local state
      setListings(prev => prev.map(l => {
        if (l.id === listingId) {
          return { ...l, status }
        }
        return l
      }))
    } catch (err) {
      setError('Failed to update listing status')
    }
  }

  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return 'TBD'
    try {
      const date = new Date(timeStr)
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    } catch {
      return timeStr
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '-'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'listed': return 'bg-blue-500'
      case 'live': return 'bg-green-500'
      case 'pending': return 'bg-yellow-500 text-black'
      case 'sold': return 'bg-purple-500'
      case 'no_sale': return 'bg-red-500'
      default: return 'bg-gray-500'
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
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400">
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
            <div key={listing.id} className="bg-gg-gray-900 rounded-lg border border-gg-gray-800 overflow-hidden">
              {/* Listing Header */}
              <div 
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gg-gray-800/50"
                onClick={() => toggleListing(listing.id)}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gg-pink">{formatTime(listing.auction_time)}</span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(listing.status)}`}>
                      {listing.status.replace('_', ' ')}
                    </span>
                  </div>
                  <h3 className="text-white font-medium mt-1">
                    {listing.county} County, {listing.state} • {listing.total_acres} acres
                  </h3>
                  <p className="text-gg-gray-400 text-sm">{listing.company_name}</p>
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
                      {listing.source_url && (
                        <a
                          href={listing.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-gg-gray-700 text-white text-sm rounded hover:bg-gg-gray-600"
                        >
                          View Source
                        </a>
                      )}
                      <Link
                        href={`/admin/listings/${listing.id}`}
                        className="px-3 py-1.5 bg-gg-gray-700 text-white text-sm rounded hover:bg-gg-gray-600"
                      >
                        Edit Listing
                      </Link>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleNotifyUsers(listing.id, 'sold') }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-sm rounded hover:bg-purple-500"
                      >
                        <Bell size={14} />
                        Mark Sold & Notify
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleNotifyUsers(listing.id, 'no_sale') }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-sm rounded hover:bg-red-500"
                      >
                        <Bell size={14} />
                        Mark No Sale & Notify
                      </button>
                    </div>
                  </div>

                  {/* Tracts */}
                  <div className="divide-y divide-gg-gray-800">
                    {listing.tracts?.length === 0 && (
                      <p className="p-4 text-gg-gray-400 text-center">No tracts for this listing</p>
                    )}
                    {listing.tracts?.map(tract => {
                      const state = tractStates[tract.id] || { currentPrice: 0, bidIncrement: 1000, status: 'listed', saving: false }
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
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(state.status)}`}>
                              {state.status.replace('_', ' ')}
                            </span>
                          </div>

                          {/* Price Controls */}
                          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                            {/* Current Price Input */}
                            <div>
                              <label className="block text-gg-gray-400 text-xs mb-1">Current Price</label>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-400">$</span>
                                <input
                                  type="number"
                                  value={state.currentPrice || ''}
                                  onChange={(e) => handlePriceChange(tract.id, e.target.value)}
                                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 pl-7 text-white text-lg font-bold"
                                />
                              </div>
                              {tract.total_acres > 0 && state.currentPrice > 0 && (
                                <p className="text-gg-gray-400 text-xs mt-1">
                                  {formatCurrency(state.currentPrice / tract.total_acres)}/acre
                                </p>
                              )}
                            </div>

                            {/* Bid Increment Selector */}
                            <div>
                              <label className="block text-gg-gray-400 text-xs mb-1">Bid Increment</label>
                              <div className="flex flex-wrap gap-1">
                                {BID_INCREMENTS.map(inc => (
                                  <button
                                    key={inc}
                                    onClick={() => handleSetIncrement(tract.id, inc)}
                                    className={`px-2 py-1 text-xs rounded ${
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

                            {/* Status Selector */}
                            <div>
                              <label className="block text-gg-gray-400 text-xs mb-1">Status</label>
                              <div className="flex flex-wrap gap-1">
                                {TRACT_STATUSES.map(status => (
                                  <button
                                    key={status}
                                    onClick={() => handleSetStatus(tract.id, status)}
                                    className={`px-2 py-1 text-xs rounded capitalize ${
                                      state.status === status
                                        ? getStatusColor(status) + ' text-white'
                                        : 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
                                    }`}
                                  >
                                    {status.replace('_', ' ')}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => handleAddBid(tract.id)}
                                className="flex-1 px-4 py-2 bg-green-600 text-white rounded font-bold hover:bg-green-500 text-sm"
                              >
                                + {formatCurrency(state.bidIncrement)}
                              </button>
                              <button
                                onClick={() => handleSaveTract(tract.id, listing.id)}
                                disabled={state.saving}
                                className="flex-1 px-4 py-2 bg-gg-pink text-white rounded font-bold hover:bg-gg-pink/80 disabled:opacity-50 text-sm"
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
