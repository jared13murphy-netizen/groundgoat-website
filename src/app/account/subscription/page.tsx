'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, CreditCard, Calendar, AlertTriangle, CheckCircle, Crown, MapPin, Plus, ExternalLink, Building2 } from 'lucide-react'

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

export default function SubscriptionPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [subscriptionData, setSubscriptionData] = useState<SubscriptionData | null>(null)
  const [error, setError] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState<string | null>(null)
  const [user, setUser] = useState<any>(null)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    
    // Get user info
    const cachedUser = localStorage.getItem('user')
    if (cachedUser) {
      setUser(JSON.parse(cachedUser))
    }
    
    fetchSubscriptions(token)
  }, [router])

  // Helper to check if user can manage subscriptions
  const canManageSubscription = () => {
    if (!user) return false
    // Admins, sales, firm admins, and individual users can manage
    return ['groundgoat_admin', 'groundgoat_sales', 'firm_admin', 'individual'].includes(user.account_type)
  }

  // Helper to check if user is a firm member (not admin)
  const isFirmMember = () => {
    return user?.account_type === 'firm_user'
  }

  const fetchSubscriptions = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/subscriptions/areas`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/signin')
          return
        }
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

  const handleCancelSubscription = async (subscriptionId: string) => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }

    setCancellingId(subscriptionId)
    setError('')

    try {
      const response = await fetch(`${API_URL}/api/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to cancel subscription')
      }

      // Refresh subscriptions
      await fetchSubscriptions(token)
      setShowCancelConfirm(null)
    } catch (err: any) {
      setError(err.message || 'Failed to cancel subscription')
    } finally {
      setCancellingId(null)
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
            <CheckCircle size={12} />
            Active
          </span>
        )
      case 'cancelled':
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-red-500/20 text-red-400 px-2 py-1 rounded-full">
            <AlertTriangle size={12} />
            Cancelled
          </span>
        )
      case 'past_due':
        return (
          <span className="inline-flex items-center gap-1 text-xs bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full">
            <AlertTriangle size={12} />
            Past Due
          </span>
        )
      default:
        return (
          <span className="text-xs bg-gg-gray-700 text-gg-gray-400 px-2 py-1 rounded-full">
            {status}
          </span>
        )
    }
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    })
  }

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
            <p className="text-gg-gray-400">Manage your plan and billing</p>
          </div>
        </div>

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

        {/* Unlimited Access Banner (for firm admins) */}
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

        {/* Billing Summary - only show if user can manage */}
        {activeSubscriptions.length > 0 && !subscriptionData?.unlimited && canManageSubscription() && (
          <div className="card mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Billing Summary</h2>
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
                  {activeSubscriptions.length} active {activeSubscriptions.length === 1 ? 'subscription' : 'subscriptions'}
                </p>
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

        {/* Active Subscriptions */}
        {activeSubscriptions.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-white">Active Subscriptions</h2>
              <Link href="/account/areas" className="text-gg-pink hover:underline text-sm">
                Add Area →
              </Link>
            </div>
            <div className="space-y-4">
              {activeSubscriptions.map((sub) => (
                <div key={sub.id} className="card">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 bg-gg-pink/10 rounded-lg flex items-center justify-center mt-1">
                        <MapPin className="text-gg-pink" size={20} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-medium text-white">
                            {sub.county ? `${sub.county}, ${sub.state}` : sub.state}
                          </h3>
                          {getStatusBadge(sub.status)}
                          {sub.is_primary && (
                            <span className="text-xs bg-gg-gray-700 text-gg-gray-400 px-2 py-0.5 rounded">
                              Primary
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gg-gray-400">
                          {sub.subscription_type === 'county' ? 'County' : 'State'} subscription
                        </p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-gg-gray-500">
                          <span className="flex items-center gap-1">
                            <CreditCard size={14} />
                            ${sub.monthly_price?.toFixed(2) || '0.00'}/mo
                          </span>
                          {sub.current_period_end && (
                            <span className="flex items-center gap-1">
                              <Calendar size={14} />
                              {sub.cancelled_at ? `Cancels ${formatDate(sub.current_period_end)}` : `Renews ${formatDate(sub.current_period_end)}`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div>
                      {showCancelConfirm === sub.id ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setShowCancelConfirm(null)}
                            className="text-sm text-gg-gray-400 hover:text-white"
                          >
                            Keep
                          </button>
                          <button
                            onClick={() => handleCancelSubscription(sub.id)}
                            disabled={cancellingId === sub.id}
                            className="text-sm text-red-400 hover:text-red-300 flex items-center gap-1"
                          >
                            {cancellingId === sub.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : null}
                            Confirm Cancel
                          </button>
                        </div>
                      ) : (
                        canManageSubscription() && !sub.cancelled_at && (
                          <button
                            onClick={() => setShowCancelConfirm(sub.id)}
                            className="text-sm text-gg-gray-500 hover:text-red-400"
                          >
                            Cancel
                          </button>
                        )
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cancelled Subscriptions */}
        {cancelledSubscriptions.length > 0 && (
          <div>
            <h2 className="font-semibold text-white mb-4">Cancelled Subscriptions</h2>
            <div className="space-y-4">
              {cancelledSubscriptions.map((sub) => (
                <div key={sub.id} className="card opacity-60">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-gg-gray-700 rounded-lg flex items-center justify-center mt-1">
                      <MapPin className="text-gg-gray-500" size={20} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-white">
                          {sub.county ? `${sub.county}, ${sub.state}` : sub.state}
                        </h3>
                        {getStatusBadge(sub.status)}
                      </div>
                      <p className="text-sm text-gg-gray-400">
                        {sub.subscription_type === 'county' ? 'County' : 'State'} subscription
                      </p>
                      {sub.current_period_end && (
                        <p className="text-sm text-gg-gray-500 mt-1">
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
      </div>
    </div>
  )
}
