'use client'

import { useState, useEffect, Suspense } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { MapPin, ArrowLeft, Plus, Loader2, Crown, X, ChevronDown, Smartphone } from 'lucide-react'
import { parseApiError } from '@/lib/parseApiError'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface SubscribedArea {
  id: string
  state: string
  county: string | null
  subscription_type: string
  status: string
  billing_cycle: string
}

interface AreasResponse {
  unlimited: boolean
  areas: SubscribedArea[]
}

function MyAreasContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromApp = searchParams.get('from') === 'app'
  const [loading, setLoading] = useState(true)
  const [areasData, setAreasData] = useState<AreasResponse | null>(null)
  const [error, setError] = useState('')
  const [showAddModal, setShowAddModal] = useState(false)
  
  const [availableStates, setAvailableStates] = useState<string[]>([])
  const [availableCounties, setAvailableCounties] = useState<string[]>([])
  const [selectedState, setSelectedState] = useState('')
  const [selectedCounty, setSelectedCounty] = useState('')
  const [addingArea, setAddingArea] = useState(false)
  const [loadingStates, setLoadingStates] = useState(false)
  const [loadingCounties, setLoadingCounties] = useState(false)
  const [showStateDropdown, setShowStateDropdown] = useState(false)
  const [showCountyDropdown, setShowCountyDropdown] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    fetchAreas(token)
  }, [router])

  const fetchAreas = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/areas`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/signin')
          return
        }
        throw new Error('Failed to fetch areas')
      }
      const data = await response.json()
      setAreasData(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load areas')
    } finally {
      setLoading(false)
    }
  }

  // Valid US states to filter against
  const VALID_STATES = [
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
    'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
    'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
    'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
    'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
    'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
    'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
    'Wisconsin', 'Wyoming'
  ]

  const fetchAvailableStates = async () => {
    setLoadingStates(true)
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/available-states`)
      if (response.ok) {
        const data = await response.json()
        let states: string[] = []
        if (Array.isArray(data)) {
          states = data
            .map((item: any) => typeof item === 'string' ? item : item.state)
            .filter((s: string) => VALID_STATES.includes(s))
            .sort()
        }
        setAvailableStates(states.length > 0 ? states : VALID_STATES.slice(0, 10))
      }
    } catch (err) {
      setAvailableStates(['Illinois', 'Iowa', 'Missouri', 'Indiana', 'Wisconsin'])
    } finally {
      setLoadingStates(false)
    }
  }

  const fetchAvailableCounties = async (state: string) => {
    setLoadingCounties(true)
    setAvailableCounties([])
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/available-counties/${encodeURIComponent(state)}`)
      if (response.ok) {
        const data = await response.json()
        let counties: string[] = []
        if (Array.isArray(data)) {
          counties = data
            .map((item: any) => typeof item === 'string' ? item : item.county)
            .filter((c: string) => c && !c.includes('Township') && !c.includes('Precinct') && !c.match(/^\d/))
            .sort()
        }
        setAvailableCounties(counties)
      }
    } catch (err) {
      console.error('Failed to fetch counties:', err)
    } finally {
      setLoadingCounties(false)
    }
  }

  const handleOpenAddModal = () => {
    setShowAddModal(true)
    fetchAvailableStates()
  }

  const handleAddArea = async () => {
    if (!selectedState) {
      setError('Please select a state')
      return
    }
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    setAddingArea(true)
    setError('')
    try {
      // Determine subscription type from existing subscriptions
      const existingSub = areasData?.areas?.find(a => a.status === 'active' || a.status === 'trialing')
      const subscriptionType = existingSub?.subscription_type || 'basic_state'

      const response = await fetch(`${API_URL}/api/subscriptions/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subscription_type: subscriptionType,
          state: selectedState,
          county: null,
          billing_cycle: existingSub?.billing_cycle || 'monthly',
        })
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(parseApiError(data, 'Failed to add area'))
      }
      const data = await response.json()
      if (data.checkout_url) {
        window.location.href = data.checkout_url
      } else {
        await fetchAreas(token)
        setShowAddModal(false)
        setSelectedState('')
        setSelectedCounty('')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add area')
    } finally {
      setAddingArea(false)
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">Active</span>
      case 'pending':
        return <span className="text-xs bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">Pending</span>
      case 'cancelled':
        return <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">Cancelled</span>
      default:
        return <span className="text-xs bg-gg-gray-700 text-gg-gray-400 px-2 py-0.5 rounded">{status}</span>
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/account" className="w-10 h-10 bg-gg-gray-800 rounded-lg flex items-center justify-center text-gg-gray-400 hover:text-white hover:bg-gg-gray-700 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex-1">
            <h1 className="font-display text-3xl font-bold text-white">My Areas</h1>
            <p className="text-gg-gray-400">Manage your subscribed states</p>
          </div>
          {!areasData?.unlimited && (
            <button onClick={handleOpenAddModal} className="btn-primary flex items-center gap-2">
              <Plus size={18} />
              Add Area
            </button>
          )}
        </div>

        {fromApp && (
          <div className="card bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-blue-500/20 mb-6">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <Smartphone className="text-blue-400" size={20} />
              </div>
              <div>
                <p className="text-white font-medium">Welcome from the Ground Goat app!</p>
                <p className="text-gg-gray-400 text-sm">Add additional states here at the same per-state price.</p>
              </div>
            </div>
          </div>
        )}

        {areasData?.unlimited && (
          <div className="card bg-gradient-to-r from-gg-pink/20 to-purple-500/20 border-gg-pink/30 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gg-pink/20 rounded-xl flex items-center justify-center">
                <Crown className="text-gg-pink" size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-white">Unlimited Access</h3>
                <p className="text-gg-gray-400 text-sm">Your Management Firm subscription includes access to all states and counties.</p>
              </div>
            </div>
          </div>
        )}

        {error && !showAddModal && (
          <div className="card bg-red-500/10 border-red-500/30 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {areasData?.areas && areasData.areas.length > 0 ? (
          <div className="space-y-4">
            {areasData.areas.map((area) => (
              <div key={area.id} className="card flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-gg-pink/10 rounded-lg flex items-center justify-center">
                    <MapPin className="text-gg-pink" size={20} />
                  </div>
                  <div>
                    <h3 className="font-medium text-white">
                      {area.county ? `${area.county}, ${area.state}` : area.state}
                    </h3>
                    <p className="text-sm text-gg-gray-400">
                      {area.subscription_type === 'county' ? 'County' : area.subscription_type === 'premium_state' ? 'Premium State' : area.subscription_type === 'basic_state' ? 'Basic State' : 'State'} subscription
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {getStatusBadge(area.status)}
                </div>
              </div>
            ))}
          </div>
        ) : !areasData?.unlimited && (
          <div className="card text-center py-12">
            <MapPin size={48} className="text-gg-gray-600 mx-auto mb-4" />
            <h3 className="font-display text-xl font-semibold text-white mb-2">No Areas Yet</h3>
            <p className="text-gg-gray-400 mb-6">Add your first area to start receiving auction alerts and access sale data.</p>
            <button onClick={handleOpenAddModal} className="btn-primary inline-flex items-center gap-2">
              <Plus size={18} />
              Add Your First Area
            </button>
          </div>
        )}

        {showAddModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
            <div className="bg-gg-gray-900 border border-gg-gray-700 rounded-2xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-display text-xl font-semibold text-white">Add New Area</h2>
                <button onClick={() => setShowAddModal(false)} className="text-gg-gray-500 hover:text-white">
                  <X size={24} />
                </button>
              </div>

              <div className="mb-4">
                <label className="block text-sm font-medium text-gg-gray-300 mb-2">State</label>
                <div className="relative">
                  <button
                    onClick={() => setShowStateDropdown(!showStateDropdown)}
                    className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-3 text-left text-white flex items-center justify-between"
                  >
                    <span className={selectedState ? 'text-white' : 'text-gg-gray-500'}>
                      {selectedState || 'Select a state...'}
                    </span>
                    <ChevronDown size={20} className="text-gg-gray-500" />
                  </button>
                  {showStateDropdown && (
                    <div className="absolute z-10 w-full mt-1 bg-gg-gray-800 border border-gg-gray-700 rounded-lg shadow-xl max-h-60 overflow-y-auto">
                      {loadingStates ? (
                        <div className="px-4 py-3 text-gg-gray-400 flex items-center gap-2">
                          <Loader2 size={16} className="animate-spin" />
                          Loading...
                        </div>
                      ) : availableStates.map(state => (
                        <button
                          key={state}
                          onClick={() => {
                            setSelectedState(state)
                            setSelectedCounty('')
                            setShowStateDropdown(false)
                            fetchAvailableCounties(state)
                          }}
                          className="w-full px-4 py-3 text-left text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white"
                        >
                          {state}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {selectedState && (
                <div className="mb-6">
                  <div className="bg-gg-gray-800 rounded-lg p-4 border border-gg-gray-700">
                    <p className="text-white font-medium">Add {selectedState}</p>
                    <p className="text-gg-gray-400 text-sm mt-1">
                      Full state coverage — all counties included
                    </p>
                  </div>
                </div>
              )}

              {error && showAddModal && (
                <p className="text-red-400 text-sm mb-4">{error}</p>
              )}

              <div className="flex gap-3">
                <button onClick={() => setShowAddModal(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button
                  onClick={handleAddArea}
                  disabled={!selectedState || addingArea}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {addingArea ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Processing...
                    </>
                  ) : (
                    'Add Area'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MyAreasPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    }>
      <MyAreasContent />
    </Suspense>
  )
}
