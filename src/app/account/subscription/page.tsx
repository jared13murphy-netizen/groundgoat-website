'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, CreditCard, Calendar, AlertTriangle, CheckCircle, Crown, MapPin, Plus, ExternalLink, Building2, X, ChevronDown, ArrowUpCircle, Minus, Tag } from 'lucide-react'
import { parseApiError } from '@/lib/parseApiError'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Subscription {
  id: string
  subscription_type: string
  state: string
  county: string | null
  status: string
  is_primary: boolean
  monthly_price: number
  billing_cycle: string
  current_period_end: string | null
  cancelled_at: string | null
  stripe_subscription_id: string | null
}

interface SubscriptionData {
  unlimited: boolean
  areas: Subscription[]
}

interface PromoValidation {
  valid: boolean
  code: string
  discount_type?: string
  discount_value?: number
  description?: string
  error?: string
}

// Valid US states
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

// State name to abbreviation
const STATE_TO_ABBR: Record<string, string> = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
  'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
  'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
  'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
  'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
  'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
}

const ABBR_TO_STATE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_TO_ABBR).map(([k, v]) => [v, k])
)

export default function SubscriptionPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [user, setUser] = useState<any>(null)

  // Add state modal
  const [showAddModal, setShowAddModal] = useState(false)
  const [availableStates, setAvailableStates] = useState<string[]>([])
  const [selectedState, setSelectedState] = useState('')
  const [showStateDropdown, setShowStateDropdown] = useState(false)
  const [loadingStates, setLoadingStates] = useState(false)
  const [addingState, setAddingState] = useState(false)
  const [addStateStep, setAddStateStep] = useState<'select' | 'confirm'>('select')

  // Promo code
  const [promoCode, setPromoCode] = useState('')
  const [promoValidation, setPromoValidation] = useState<PromoValidation | null>(null)
  const [validatingPromo, setValidatingPromo] = useState(false)

  // Remove state
  const [showRemoveConfirm, setShowRemoveConfirm] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)

  // Upgrade plan
  const [showUpgradeConfirm, setShowUpgradeConfirm] = useState(false)
  const [upgrading, setUpgrading] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    const cachedUser = localStorage.getItem('user')
    if (cachedUser) {
      setUser(JSON.parse(cachedUser))
    }
    fetchSubscriptions(token)
  }, [router])

  const canManageSubscription = () => {
    if (!user) return false
    return ['groundgoat_admin', 'groundgoat_sales', 'firm_admin', 'individual'].includes(user.account_type)
  }

  const isFirmMember = () => user?.account_type === 'firm_user'

  const fetchSubscriptions = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/areas`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) {
        if (response.status === 401) { router.push('/signin'); return }
        throw new Error('Failed to fetch subscriptions')
      }
      const data = await response.json()
      setSubscriptionData(data)
    } catch (err: any) {
      setError(err.message || 'Failed to load subscriptions')
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
        setAvailableStates(states.length > 0 ? states : VALID_STATES)
      }
    } catch {
      setAvailableStates(VALID_STATES)
    } finally {
      setLoadingStates(false)
    }
  }

  const validatePromoCode = async () => {
    if (!promoCode.trim()) return
    setValidatingPromo(true)
    setPromoValidation(null)
    try {
      const subType = activeSubscriptions[0]?.subscription_type || 'basic_state'
      const response = await fetch(`${API_URL}/api/promo-codes/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: promoCode.trim().toUpperCase(),
          subscription_type: subType,
        })
      })
      const data = await response.json()
      setPromoValidation(data)
    } catch {
      setPromoValidation({ valid: false, code: promoCode, error: 'Failed to validate promo code' })
    } finally {
      setValidatingPromo(false)
    }
  }

  // Step 1: user clicks "Add State" → move to confirmation step
  const proceedToConfirm = () => {
    if (!selectedState) { setError('Please select a state'); return }
    setError('')
    setAddStateStep('confirm')
  }

  // Step 2: user clicks "Confirm" → actually charge the card and add the state
  const handleAddState = async () => {
    if (!selectedState) { setError('Please select a state'); return }
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }

    setAddingState(true)
    setError('')

    try {
      const stateAbbr = STATE_TO_ABBR[selectedState] || selectedState
      const response = await fetchWithAuth(`${API_URL}/api/subscriptions/add-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: stateAbbr,
          promo_code: promoValidation?.valid ? promoCode.trim().toUpperCase() : null,
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (data.detail === 'no_existing_subscription') {
          throw new Error("You don't have an active subscription. Please subscribe from the pricing page first.")
        }
        throw new Error(parseApiError(data, 'Failed to add state'))
      }

      const data = await response.json()
      setSuccessMessage(data.message || `Added ${selectedState} to your subscription.`)
      setShowAddModal(false)
      setSelectedState('')
      setPromoCode('')
      setPromoValidation(null)
      setAddStateStep('select')
      await fetchSubscriptions(token)
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (err: any) {
      setError(err.message || 'Failed to add state')
    } finally {
      setAddingState(false)
    }
  }

  // Price math for the confirm step
  const computeDiscountedPrice = (base: number): { discountAmount: number; newPrice: number } => {
    if (!promoValidation?.valid || !promoValidation.discount_type || promoValidation.discount_value === undefined) {
      return { discountAmount: 0, newPrice: base }
    }
    if (promoValidation.discount_type === 'percentage') {
      const discountAmount = base * (promoValidation.discount_value / 100)
      return { discountAmount, newPrice: Math.max(0, base - discountAmount) }
    }
    // fixed amount
    return { discountAmount: Math.min(base, promoValidation.discount_value), newPrice: Math.max(0, base - promoValidation.discount_value) }
  }

  const handleRemoveState = async (subscriptionId: string) => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }

    setRemovingId(subscriptionId)
    setError('')

    try {
      const response = await fetchWithAuth(`${API_URL}/api/subscriptions/remove-state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription_id: subscriptionId })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(parseApiError(data, 'Failed to remove state'))
      }

      const data = await response.json()
      setSuccessMessage(data.message || 'State removed from your subscription.')
      setShowRemoveConfirm(null)
      await fetchSubscriptions(token)
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (err: any) {
      setError(err.message || 'Failed to remove state')
    } finally {
      setRemovingId(null)
    }
  }

  const handleUpgradePlan = async () => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }

    setUpgrading(true)
    setError('')

    try {
      const response = await fetchWithAuth(`${API_URL}/api/subscriptions/upgrade-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_type: 'premium_state' })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(parseApiError(data, 'Failed to upgrade plan'))
      }

      const data = await response.json()
      setSuccessMessage(data.message || 'Successfully upgraded to Premium State.')
      setShowUpgradeConfirm(false)
      await fetchSubscriptions(token)
      setTimeout(() => setSuccessMessage(''), 5000)
    } catch (err: any) {
      setError(err.message || 'Failed to upgrade plan')
    } finally {
      setUpgrading(false)
    }
  }

  const handleManageBilling = async () => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/billing-portal`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        window.location.href = data.url
      } else {
        setError('Unable to open billing portal')
      }
    } catch {
      setError('Unable to open billing portal')
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-green-500/20 text-green-400 px-2 py-1 rounded-full">
            <CheckCircle size={12} /> Active
          </span>
        )
      case 'trialing':
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full">
            <CheckCircle size={12} /> Trial
          </span>
        )
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded-full">
            <AlertTriangle size={12} /> Cancelled
          </span>
        )
      case 'past_due':
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full">
            <AlertTriangle size={12} /> Past Due
          </span>
        )
      default:
        return (
          <span className="text-xs bg-gg-gray-700 text-gg-gray-400 px-2 py-1 rounded-full">{status}</span>
        )
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric'
    })
  }

  const getPlanLabel = (type: string) => {
    switch (type) {
      case 'basic_state': return 'Basic State'
      case 'premium_state': return 'Premium State'
      case 'county': return 'County'
      case 'state': return 'State'
      default: return type
    }
  }

  const getStateName = (abbr: string) => ABBR_TO_STATE[abbr] || abbr

  const calculateTotalMonthly = () => {
    if (!subscriptionData?.areas) return 0
    return subscriptionData.areas
      .filter(sub => sub.status === 'active' || sub.status === 'trialing')
      .reduce((total, sub) => total + (sub.monthly_price || 0), 0)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    )
  }

  const activeSubscriptions = subscriptionData?.areas?.filter(sub => sub.status === 'active' || sub.status === 'trialing') || []
  const cancelledSubscriptions = subscriptionData?.areas?.filter(sub => sub.status === 'cancelled') || []
  const currentPlanType = activeSubscriptions[0]?.subscription_type || null
  const currentBillingCycle = activeSubscriptions[0]?.billing_cycle || null
  const isBasicPlan = currentPlanType === 'basic_state'
  // Use the user's ACTUAL per-state price from their existing subscription so
  // legacy-priced users (e.g. $19.99/mo) see the correct base in the Add State
  // modal. Fall back to the default plan price only if we somehow don't have a
  // subscription record loaded.
  const actualPerStatePrice = activeSubscriptions[0]?.monthly_price
  const perStatePrice = (actualPerStatePrice && actualPerStatePrice > 0)
    ? actualPerStatePrice
    : (currentPlanType === 'premium_state' ? 74.99 : 24.99)

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-3xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/account"
            className="w-10 h-10 bg-gg-gray-800 rounded-lg flex items-center justify-center text-gg-gray-400 hover:text-white hover:bg-gg-gray-700 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Subscription</h1>
            <p className="text-gg-gray-400">Manage your plan, states, and billing</p>
          </div>
        </div>

        {/* Success Message */}
        {successMessage && (
          <div className="card bg-green-500/10 border-green-500/30 mb-6">
            <div className="flex items-center gap-2">
              <CheckCircle size={18} className="text-green-400" />
              <p className="text-green-400">{successMessage}</p>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="card bg-red-500/10 border-red-500/30 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {/* Firm Member Banner */}
        {isFirmMember() && (
          <div className="card bg-gradient-to-r from-blue-500/20 to-indigo-500/20 border-blue-500/30 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-500/20 rounded-xl flex items-center justify-center">
                <Building2 className="text-blue-400" size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-white">Firm Member Access</h3>
                <p className="text-gg-gray-400 text-sm">Your access is managed by your firm administrator. Contact them for any subscription changes.</p>
              </div>
            </div>
          </div>
        )}

        {/* Unlimited Access Banner */}
        {subscriptionData?.unlimited && !isFirmMember() && (
          <div className="card bg-gradient-to-r from-gg-pink/20 to-purple-500/20 border-gg-pink/30 mb-8">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-gg-pink/20 rounded-xl flex items-center justify-center">
                <Crown className="text-gg-pink" size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-white">Management Firm - Unlimited Access</h3>
                <p className="text-gg-gray-400 text-sm">You have access to all states and counties.</p>
              </div>
            </div>
          </div>
        )}

        {/* Plan Overview Card */}
        {activeSubscriptions.length > 0 && !subscriptionData?.unlimited && canManageSubscription() && (
          <div className="card mb-8">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <h2 className="font-semibold text-white">Plan Overview</h2>
                <span className="text-xs bg-gg-pink/20 text-gg-pink px-2 py-1 rounded-full font-medium">
                  {getPlanLabel(currentPlanType || '')}
                </span>
                {currentBillingCycle && (
                  <span className="text-xs bg-gg-gray-700 text-gg-gray-400 px-2 py-1 rounded-full">
                    {currentBillingCycle === 'annual' ? 'Annual' : 'Monthly'}
                  </span>
                )}
              </div>
              <button
                onClick={handleManageBilling}
                className="text-gg-pink hover:underline text-sm flex items-center gap-1"
              >
                Manage Billing
                <ExternalLink size={14} />
              </button>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-gg-gray-400 text-sm">Monthly Total</p>
                <p className="text-3xl font-bold text-white">${calculateTotalMonthly().toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-gg-gray-400 text-sm">
                  {activeSubscriptions.length} {activeSubscriptions.length === 1 ? 'state' : 'states'}
                </p>
                {activeSubscriptions[0]?.current_period_end && (
                  <p className="text-gg-gray-500 text-xs mt-1">
                    {activeSubscriptions[0]?.cancelled_at ? 'Access until' : 'Renews'} {formatDate(activeSubscriptions[0].current_period_end)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* No Subscription State */}
        {!subscriptionData?.unlimited && activeSubscriptions.length === 0 && (
          <div className="card text-center py-12 mb-8">
            <CreditCard size={48} className="text-gg-gray-600 mx-auto mb-4" />
            <h3 className="font-display text-xl font-semibold text-white mb-2">No Active Subscription</h3>
            <p className="text-gg-gray-400 mb-6">Subscribe to access auction alerts and sale data.</p>
            <Link href="/signup?step=2" className="btn-primary inline-flex items-center gap-2">
              <Plus size={18} />
              Choose a Plan
            </Link>
          </div>
        )}

        {/* Your States */}
        {activeSubscriptions.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Your States</h2>
              {canManageSubscription() && (
                <button
                  onClick={() => {
                    setShowAddModal(true)
                    setError('')
                    setAddStateStep('select')
                    setSelectedState('')
                    setPromoCode('')
                    setPromoValidation(null)
                    fetchAvailableStates()
                  }}
                  className="text-gg-pink hover:underline text-sm flex items-center gap-1"
                >
                  <Plus size={14} />
                  Add State
                </button>
              )}
            </div>
            <div className="space-y-3">
              {activeSubscriptions.map((sub) => (
                <div key={sub.id} className="card">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-gg-pink/10 rounded-lg flex items-center justify-center">
                        <MapPin className="text-gg-pink" size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-white">
                            {sub.county ? `${sub.county}, ${getStateName(sub.state)}` : getStateName(sub.state)}
                          </h3>
                          {getStatusBadge(sub.status)}
                        </div>
                        <p className="text-sm text-gg-gray-500">
                          ${sub.monthly_price?.toFixed(2) || '0.00'}/mo
                        </p>
                      </div>
                    </div>
                    <div>
                      {canManageSubscription() && !sub.cancelled_at && (
                        showRemoveConfirm === sub.id ? (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setShowRemoveConfirm(null)}
                              className="text-sm text-gg-gray-400 hover:text-white"
                            >
                              Keep
                            </button>
                            <button
                              onClick={() => handleRemoveState(sub.id)}
                              disabled={removingId === sub.id}
                              className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1"
                            >
                              {removingId === sub.id ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : null}
                              {activeSubscriptions.length === 1 ? 'Cancel Subscription' : 'Remove'}
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setShowRemoveConfirm(sub.id)}
                            className="text-sm text-gg-gray-500 hover:text-red-400 flex items-center gap-1"
                          >
                            <Minus size={14} />
                            Remove
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  {showRemoveConfirm === sub.id && activeSubscriptions.length === 1 && (
                    <div className="mt-3 pt-3 border-t border-gg-gray-700">
                      <p className="text-yellow-400 text-xs flex items-center gap-1">
                        <AlertTriangle size={12} />
                        This is your only state. Removing it will cancel your entire subscription.
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upgrade Plan Card */}
        {isBasicPlan && canManageSubscription() && activeSubscriptions.length > 0 && (
          <div className="card mb-8 bg-gradient-to-r from-purple-500/10 to-gg-pink/10 border-purple-500/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                  <ArrowUpCircle className="text-purple-400" size={20} />
                </div>
                <div>
                  <h3 className="font-medium text-white">Upgrade to Premium State</h3>
                  <p className="text-sm text-gg-gray-400">
                    Get premium features for $74.99/state/mo (currently $24.99/state/mo)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowUpgradeConfirm(true)}
                className="btn-primary text-sm py-2 px-4"
              >
                Upgrade
              </button>
            </div>
          </div>
        )}

        {/* Cancelled Subscriptions */}
        {cancelledSubscriptions.length > 0 && (
          <div className="mb-8">
            <h2 className="font-semibold text-white mb-4">Cancelled</h2>
            <div className="space-y-3">
              {cancelledSubscriptions.map((sub) => (
                <div key={sub.id} className="card opacity-60">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-gg-gray-700 rounded-lg flex items-center justify-center">
                      <MapPin className="text-gg-gray-500" size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-white">
                          {sub.county ? `${sub.county}, ${getStateName(sub.state)}` : getStateName(sub.state)}
                        </h3>
                        {getStatusBadge(sub.status)}
                      </div>
                      {sub.current_period_end && (
                        <p className="text-sm text-gg-gray-500">
                          Access until {formatDate(sub.current_period_end)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Help Section */}
        <div className="card mt-8 bg-gg-gray-800/50">
          <h3 className="font-semibold text-white mb-2">Need Help?</h3>
          <p className="text-gg-gray-400 text-sm mb-4">
            Have questions about your subscription or billing? We're here to help.
          </p>
          <Link href="/contact" className="text-gg-pink hover:underline text-sm">
            Contact Support →
          </Link>
        </div>

        {/* Add State Modal */}
        {showAddModal && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
            <div className="bg-gg-gray-900 border border-gg-gray-700 rounded-2xl w-full max-w-md p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-display text-xl font-semibold text-white">
                  {addStateStep === 'confirm' ? 'Confirm & Add State' : 'Add a State'}
                </h2>
                <button
                  onClick={() => {
                    setShowAddModal(false)
                    setSelectedState('')
                    setPromoCode('')
                    setPromoValidation(null)
                    setError('')
                    setAddStateStep('select')
                  }}
                  className="text-gg-gray-500 hover:text-white"
                >
                  <X size={24} />
                </button>
              </div>

              {addStateStep === 'select' && (
                <>
                  {/* State Dropdown */}
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
                              <Loader2 size={16} className="animate-spin" /> Loading...
                            </div>
                          ) : availableStates.map(state => {
                            const isSubscribed = activeSubscriptions.some(
                              sub => getStateName(sub.state) === state || sub.state === STATE_TO_ABBR[state]
                            )
                            return (
                              <button
                                key={state}
                                onClick={() => {
                                  if (!isSubscribed) {
                                    setSelectedState(state)
                                    setShowStateDropdown(false)
                                  }
                                }}
                                disabled={isSubscribed}
                                className={`w-full px-4 py-3 text-left ${isSubscribed ? 'text-gg-gray-600 cursor-not-allowed' : 'text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white'}`}
                              >
                                {state} {isSubscribed ? '(subscribed)' : ''}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Selected State Preview */}
                  {selectedState && (
                    <div className="mb-4 bg-gg-gray-800 rounded-lg p-4 border border-gg-gray-700">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-white font-medium">{selectedState}</p>
                          <p className="text-gg-gray-400 text-sm">Full state coverage</p>
                        </div>
                        <p className="text-white font-semibold">${perStatePrice.toFixed(2)}/mo</p>
                      </div>
                    </div>
                  )}

                  {/* Promo Code */}
                  <div className="mb-6">
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">
                      <Tag size={14} className="inline mr-1" />
                      Promo Code (optional)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={promoCode}
                        onChange={(e) => { setPromoCode(e.target.value); setPromoValidation(null) }}
                        placeholder="Enter code"
                        className="flex-1 bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                      />
                      <button
                        onClick={validatePromoCode}
                        disabled={!promoCode.trim() || validatingPromo}
                        className="btn-secondary text-sm px-4 disabled:opacity-50"
                      >
                        {validatingPromo ? <Loader2 size={16} className="animate-spin" /> : 'Apply'}
                      </button>
                    </div>
                    {promoValidation && !promoValidation.valid && (
                      <p className="text-sm mt-2 text-red-400">
                        {promoValidation.error || 'Invalid promo code'}
                      </p>
                    )}
                    {promoValidation && promoValidation.valid && (() => {
                      const { discountAmount, newPrice } = computeDiscountedPrice(perStatePrice)
                      const label = promoValidation.discount_type === 'percentage'
                        ? `${promoValidation.discount_value}% off`
                        : `$${(promoValidation.discount_value || 0).toFixed(2)} off`
                      return (
                        <div className="mt-2 bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-sm">
                          <p className="text-green-400 font-medium flex items-center gap-1">
                            <CheckCircle size={14} /> Promo applied: {label}
                          </p>
                          <div className="mt-2 space-y-1 text-xs">
                            <div className="flex justify-between text-gg-gray-400">
                              <span>Base price</span>
                              <span>${perStatePrice.toFixed(2)}/mo</span>
                            </div>
                            <div className="flex justify-between text-green-400">
                              <span>Discount</span>
                              <span>−${discountAmount.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-white font-semibold pt-1 border-t border-gg-gray-700">
                              <span>New price</span>
                              <span>${newPrice.toFixed(2)}/mo</span>
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                  {error && (
                    <p className="text-red-400 text-sm mb-4">{error}</p>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowAddModal(false)
                        setSelectedState('')
                        setPromoCode('')
                        setPromoValidation(null)
                        setError('')
                        setAddStateStep('select')
                      }}
                      className="btn-secondary flex-1"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={proceedToConfirm}
                      disabled={!selectedState}
                      className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      Continue
                    </button>
                  </div>
                </>
              )}

              {addStateStep === 'confirm' && (() => {
                const { discountAmount, newPrice } = computeDiscountedPrice(perStatePrice)
                const hasPromo = promoValidation?.valid
                return (
                  <>
                    <p className="text-gg-gray-300 text-sm mb-4">
                      Please confirm to add <span className="text-white font-medium">{selectedState}</span> to your subscription.
                    </p>

                    <div className="bg-gg-gray-800 border border-gg-gray-700 rounded-lg p-4 mb-4 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gg-gray-400">State</span>
                        <span className="text-white font-medium">{selectedState}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gg-gray-400">Base price</span>
                        <span className="text-white">${perStatePrice.toFixed(2)}/mo</span>
                      </div>
                      {hasPromo && (
                        <>
                          <div className="flex justify-between text-sm">
                            <span className="text-gg-gray-400">
                              Promo <span className="text-gg-pink">({promoCode.toUpperCase()})</span>
                            </span>
                            <span className="text-green-400">−${discountAmount.toFixed(2)}</span>
                          </div>
                        </>
                      )}
                      <div className="flex justify-between pt-2 border-t border-gg-gray-700">
                        <span className="text-white font-semibold">New monthly charge</span>
                        <span className="text-white font-semibold">${newPrice.toFixed(2)}/mo</span>
                      </div>
                    </div>

                    <p className="text-gg-gray-500 text-xs mb-4">
                      Your card on file will be charged a prorated amount today based on the days remaining in your current billing cycle. Future invoices will include this state at ${newPrice.toFixed(2)}/mo.
                    </p>

                    {error && (
                      <p className="text-red-400 text-sm mb-4">{error}</p>
                    )}

                    <div className="flex gap-3">
                      <button
                        onClick={() => { setAddStateStep('select'); setError('') }}
                        disabled={addingState}
                        className="btn-secondary flex-1 disabled:opacity-50"
                      >
                        Back
                      </button>
                      <button
                        onClick={handleAddState}
                        disabled={addingState}
                        className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {addingState ? (
                          <><Loader2 size={18} className="animate-spin" /> Charging...</>
                        ) : (
                          <><CheckCircle size={18} /> Confirm & Charge</>
                        )}
                      </button>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        )}

        {/* Upgrade Confirmation Modal */}
        {showUpgradeConfirm && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-6">
            <div className="bg-gg-gray-900 border border-gg-gray-700 rounded-2xl w-full max-w-md p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                  <ArrowUpCircle className="text-purple-400" size={20} />
                </div>
                <h3 className="text-xl font-semibold text-white">Upgrade to Premium</h3>
              </div>
              <p className="text-gg-gray-400 mb-4">
                Your plan will switch from Basic State ($24.99/state/mo) to Premium State ($74.99/state/mo) for all {activeSubscriptions.length} {activeSubscriptions.length === 1 ? 'state' : 'states'}.
              </p>
              <p className="text-gg-gray-500 text-sm mb-6">
                Prorated charges will be applied to your next invoice.
              </p>
              <div className="flex gap-3">
                <button onClick={() => setShowUpgradeConfirm(false)} className="btn-secondary flex-1" disabled={upgrading}>
                  Cancel
                </button>
                <button
                  onClick={handleUpgradePlan}
                  disabled={upgrading}
                  className="btn-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {upgrading ? (
                    <><Loader2 size={16} className="animate-spin" /> Upgrading...</>
                  ) : (
                    'Confirm Upgrade'
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
