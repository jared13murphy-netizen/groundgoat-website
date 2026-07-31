'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { MapPin, ArrowLeft, Loader2, ChevronDown, Lock } from 'lucide-react'
import { parseApiError } from '@/lib/parseApiError'
import { PRICING, formatPrice } from '@/config/pricing'
import { STATE_ABBREVIATIONS, getStateAbbreviation, getStateFullName } from '@/data/counties'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

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

  // Valid 2-letter state abbreviations to sanity-filter against. Listing.state
  // (and UserSubscription.state) are stored abbreviated on the backend, so
  // availableStates/selectedState must carry abbreviations end-to-end —
  // otherwise the isAlreadySubscribed/isPastDueForState checks below and the
  // backend "already subscribed" guards never string-match (double-charge
  // gap: a picked full name like "Illinois" would sail past every guard).
  const VALID_STATE_ABBRS = new Set(Object.values(STATE_ABBREVIATIONS))
  const FALLBACK_STATE_CODES = ['IL', 'IA', 'MO', 'IN', 'WI']

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

  // Pre-fill state and county from URL params once states are loaded.
  // The URL param may arrive as a full name (older links) or an abbreviation
  // (mobile TerritoryModal) — normalize to the abbreviation availableStates
  // now carries before matching.
  useEffect(() => {
    if (prefilledState && availableStates.length > 0) {
      const prefilledAbbr = getStateAbbreviation(prefilledState)
      const matchedState = availableStates.find(
        s => s.toLowerCase() === prefilledAbbr.toLowerCase()
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
        let codes: string[] = []
        if (Array.isArray(data)) {
          codes = data
            .map((item: any) => typeof item === 'string' ? item : item.state)
            .filter((s: string) => !!s)
            // Normalize defensively (the API returns abbreviations already,
            // but this passes through unchanged if it ever doesn't).
            .map((s: string) => getStateAbbreviation(s))
            .filter((s: string) => VALID_STATE_ABBRS.has(s))
        }
        // Show every state the API returns — no slicing/capping.
        const uniqueSorted = Array.from(new Set(codes)).sort()
        setAvailableStates(uniqueSorted.length > 0 ? uniqueSorted : FALLBACK_STATE_CODES)
      }
    } catch (err) {
      setAvailableStates(FALLBACK_STATE_CODES)
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
      // Determine subscription type from existing subscriptions or default to basic_state
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
          // selectedState is already an abbreviation (availableStates carries
          // codes end-to-end), but normalize here too — same belt-and-
          // suspenders as signup/page.tsx's getStateAbbreviation() calls —
          // so this never regresses to sending a full name the backend
          // guards can't string-match against UserSubscription.state.
          state: getStateAbbreviation(selectedState),
          county: null,
          billing_cycle: 'annual', // all plans bill annually
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

  // New plans are state-only. Price the added state from the user's current
  // plan tier (default Basic for new subscribers).
  const activeSub = areasData?.areas?.find(a => a.status === 'active' || a.status === 'trialing')
  const planTier = activeSub?.subscription_type === 'premium_state' ? 'premium_state' : 'basic_state'
  const perStateAnnual = PRICING[planTier].annualPerState

  // Check if user already has this area subscribed
  const isAlreadySubscribed = areasData?.areas?.some(a =>
    (a.status === 'active' || a.status === 'trialing') && a.state === selectedState
  )

  // A past_due subscription for this state is still owned — its payment is
  // just lapsed. It must NOT be treated as "available to buy": starting a
  // brand-new checkout here would double-charge the user once their
  // original subscription's payment retries succeed. Route them to renew
  // instead of purchasing again.
  const isPastDueForState = areasData?.areas?.some(a =>
    a.status === 'past_due' && a.state === selectedState
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

        {/* Free-trial reassurance — so a trialing user knows changes don't end
            their trial or trigger an immediate charge. */}
        {activeSub?.status === 'trialing' && (activeSub as any).trial_end && (
          <div className="mb-6 rounded-xl border-2 border-gg-pink/50 bg-gg-pink/10 p-4">
            <p className="text-white font-semibold text-sm">You&apos;re on a free trial — this keeps it.</p>
            <p className="text-gg-gray-300 text-sm mt-1">
              Your free trial runs until{' '}
              <span className="text-white font-medium">
                {new Date((activeSub as any).trial_end).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
              </span>. You won&apos;t be charged until then.
            </p>
          </div>
        )}

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
                  {selectedState ? getStateFullName(selectedState) : 'Select a state...'}
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
                      {getStateFullName(state)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* State plan summary */}
          {selectedState && (
            <div className="mb-6">
              <div className="w-full bg-gg-gray-800 border border-gg-pink rounded-lg px-4 py-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">Entire {getStateFullName(selectedState)} state</p>
                    <p className="text-gg-pink text-sm">${formatPrice(perStateAnnual)}/year (all counties included)</p>
                  </div>
                  <div className="w-5 h-5 bg-gg-pink rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-black" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                </div>
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

          {!isAlreadySubscribed && isPastDueForState && (
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-4">
              <p className="text-yellow-400 text-sm">
                Your subscription for this area needs renewing — your last payment didn&apos;t go through.
              </p>
              <Link href="/account/subscription" className="text-yellow-400 underline text-sm mt-1 inline-block">
                Update payment
              </Link>
            </div>
          )}

          {/* Action Buttons */}
          {isLoggedIn ? (
            <button
              onClick={handleAddArea}
              disabled={!selectedState || addingArea || isAlreadySubscribed || isPastDueForState}
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
