'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { MapPin, ArrowLeft, Loader2, ChevronDown, Lock } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface SubscribedArea {
  id: string
  state: string
  county: string | null
  subscription_type: string
  status: string
}

interface AreasResponse {
  unlimited: boolean
  areas: SubscribedArea[]
}

function UpgradePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [areasData, setAreasData] = useState<AreasResponse | null>(null)
  const [error, setError] = useState('')
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  const [availableStates, setAvailableStates] = useState<string[]>([])
  const [availableCounties, setAvailableCounties] = useState<string[]>([])
  const [selectedState, setSelectedState] = useState('')
  const [selectedCounty, setSelectedCounty] = useState('')
  const [addingArea, setAddingArea] = useState(false)
  const [loadingStates, setLoadingStates] = useState(false)
  const [loadingCounties, setLoadingCounties] = useState(false)
  const [showStateDropdown, setShowStateDropdown] = useState(false)
  const [showCountyDropdown, setShowCountyDropdown] = useState(false)

  // Get pre-filled values from URL params
  const prefilledState = searchParams.get('state') || ''
  const prefilledCounty = searchParams.get('county') || ''

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

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      setIsLoggedIn(false)
      setLoading(false)
      return
    }
    setIsLoggedIn(true)
    fetchAreas(token)
    fetchAvailableStates()
  }, [])

  // Pre-fill state and county from URL params once states are loaded
  useEffect(() => {
    if (prefilledState && availableStates.length > 0) {
      // Find matching state (case insensitive)
      const matchedState = availableStates.find(
        s => s.toLowerCase() === prefilledState.toLowerCase()
      )
      if (matchedState && !selectedState) {
        setSelectedState(matchedState)
        fetchAvailableCounties(matchedState)
      }
    }
  }, [prefilledState, availableStates])

  // Pre-fill county once counties are loaded
  useEffect(() => {
    if (prefilledCounty && availableCounties.length > 0 && selectedState) {
      // Find matching county (case insensitive)
      const matchedCounty = availableCounties.find(
        c => c.toLowerCase() === prefilledCounty.toLowerCase()
      )
      if (matchedCounty && !selectedCounty) {
        setSelectedCounty(matchedCounty)
      }
    }
  }, [prefilledCounty, availableCounties, selectedState])

  const fetchAreas = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/areas`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) {
        if (response.status === 401) {
          setIsLoggedIn(false)
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

  const handleAddArea = async () => {
    if (!selectedState) {
      setError('Please select a state')
      return
    }
    const token = localStorage.getItem('auth_token')
    if (!token) {
      // Redirect to signin with return URL
      const returnUrl = encodeURIComponent(`/upgrade?state=${selectedState}${selectedCounty ? `&county=${selectedCounty}` : ''}`)
      router.push(`/signin?redirect=${returnUrl}`)
      return
    }
    setAddingArea(true)
    setError('')
    try {
      const subscriptionType = selectedCounty ? 'county' : 'state'
      const hasCountySubscription = areasData?.areas?.some(a => a.subscription_type === 'county' && (a.status === 'active' || a.status === 'trialing'))
      const isUpgrade = subscriptionType === 'state' && hasCountySubscription

      const response = await fetch(`${API_URL}/api/subscriptions/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          subscription_type: subscriptionType,
          state: selectedState,
          county: selectedCounty || null,
          billing_cycle: 'monthly',
          is_upgrade: isUpgrade
        })
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || 'Failed to add area')
      }
      const data = await response.json()
      if (data.checkout_url) {
        window.location.href = data.checkout_url
      } else {
        router.push('/account/areas')
      }
    } catch (err: any) {
      setError(err.message || 'Failed to add area')
    } finally {
      setAddingArea(false)
    }
  }

  const handleSignInClick = () => {
    const returnUrl = encodeURIComponent(`/upgrade?state=${selectedState || prefilledState}${selectedCounty || prefilledCounty ? `&county=${selectedCounty || prefilledCounty}` : ''}`)
    router.push(`/signin?redirect=${returnUrl}`)
  }

  const handleSignUpClick = () => {
    const returnUrl = encodeURIComponent(`/upgrade?state=${selectedState || prefilledState}${selectedCounty || prefilledCounty ? `&county=${selectedCounty || prefilledCounty}` : ''}`)
    router.push(`/signup?redirect=${returnUrl}`)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    )
  }

  // Check if user already has this area subscribed
  const isAlreadySubscribed = areasData?.areas?.some(a =>
    a.status === 'active' &&
    (a.subscription_type === 'state' ||
     (a.state === selectedState && a.county === selectedCounty))
  )

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-lg mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gg-pink/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Lock className="text-gg-pink" size={32} />
          </div>
          <h1 className="font-display text-3xl font-bold text-white mb-2">
            Unlock {prefilledCounty ? `${prefilledCounty} County` : 'This Area'}
          </h1>
          <p className="text-gg-gray-400">
            Subscribe to access auction alerts, sale results, and market data for this territory.
          </p>
        </div>

        {/* Main Card */}
        <div className="bg-gg-gray-900 border border-gg-gray-700 rounded-2xl p-6">
          {/* State Selection */}
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

          {/* County/State Selection */}
          {selectedState && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gg-gray-300 mb-2">Subscription Type</label>
              <div className="space-y-3">
                {/* County option */}
                <button
                  onClick={() => setShowCountyDropdown(!showCountyDropdown)}
                  className={`w-full bg-gg-gray-800 border rounded-lg px-4 py-3 text-left transition-colors ${
                    selectedCounty ? 'border-gg-pink' : 'border-gg-gray-700 hover:border-gg-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">
                        {selectedCounty ? `${selectedCounty} County` : 'Select a county'}
                      </p>
                      <p className="text-gg-pink text-sm">$3.99/mo per county</p>
                    </div>
                    <ChevronDown size={20} className="text-gg-gray-500" />
                  </div>
                </button>
                {showCountyDropdown && (
                  <div className="bg-gg-gray-800 border border-gg-gray-700 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {loadingCounties ? (
                      <div className="px-4 py-3 text-gg-gray-400 flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        Loading counties...
                      </div>
                    ) : availableCounties.map(county => (
                      <button
                        key={county}
                        onClick={() => {
                          setSelectedCounty(county)
                          setShowCountyDropdown(false)
                        }}
                        className="w-full px-4 py-3 text-left text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white"
                      >
                        {county}
                      </button>
                    ))}
                  </div>
                )}

                {/* Divider */}
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 border-t border-gg-gray-700"></div>
                  <span className="text-xs text-gg-gray-500 uppercase">or</span>
                  <div className="flex-1 border-t border-gg-gray-700"></div>
                </div>

                {/* State option */}
                <button
                  onClick={() => {
                    setSelectedCounty('')
                    setShowCountyDropdown(false)
                  }}
                  className={`w-full bg-gg-gray-800 border rounded-lg px-4 py-3 text-left transition-colors ${
                    !selectedCounty && selectedState ? 'border-gg-pink' : 'border-gg-gray-700 hover:border-gg-gray-600'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">Entire {selectedState} state</p>
                      <p className="text-gg-pink text-sm">$19.99/mo (all counties included)</p>
                    </div>
                    {!selectedCounty && selectedState && (
                      <div className="w-5 h-5 bg-gg-pink rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-black" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    )}
                  </div>
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="text-red-400 text-sm mb-4">{error}</p>
          )}

          {isAlreadySubscribed && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
              <p className="text-green-400 text-sm">
                You already have an active subscription for this area.
              </p>
              <Link href="/account/areas" className="text-green-400 underline text-sm mt-1 inline-block">
                View your subscriptions
              </Link>
            </div>
          )}

          {/* Action Buttons */}
          {isLoggedIn ? (
            <button
              onClick={handleAddArea}
              disabled={!selectedState || addingArea || isAlreadySubscribed}
              className="w-full bg-gg-pink text-black font-semibold py-3 px-4 rounded-lg hover:bg-gg-pink-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {addingArea ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Processing...
                </>
              ) : (
                'Subscribe Now'
              )}
            </button>
          ) : (
            <div className="space-y-3">
              <button
                onClick={handleSignInClick}
                className="w-full bg-gg-pink text-black font-semibold py-3 px-4 rounded-lg hover:bg-gg-pink-dark transition-colors"
              >
                Sign In to Subscribe
              </button>
              <p className="text-center text-gg-gray-400 text-sm">
                Don't have an account?{' '}
                <button onClick={handleSignUpClick} className="text-gg-pink hover:underline">
                  Sign up
                </button>
              </p>
            </div>
          )}
        </div>

        {/* Back Link */}
        <div className="text-center mt-6">
          <Link href="/" className="text-gg-gray-400 hover:text-white text-sm inline-flex items-center gap-2">
            <ArrowLeft size={16} />
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function UpgradePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    }>
      <UpgradePageContent />
    </Suspense>
  )
}
