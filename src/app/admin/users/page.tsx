'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Search, UserCheck, UserX, Shield, Loader2, ChevronDown, Edit2, X, Check, DollarSign, RefreshCw } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const ACCOUNT_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'firm_admin', label: 'Firm Admin' },
  { value: 'firm_user', label: 'Firm User' },
  { value: 'groundgoat_sales', label: 'GG Sales' },
  { value: 'groundgoat_admin', label: 'GG Admin' },
]

interface Subscription {
  county: string | null
  state: string
  status: string
  monthly_price: number | null
  billing_cycle: string
  current_period_end: string | null
  payment_method: string | null
  promo_code: string | null
}

interface Payment {
  source: 'stripe' | 'apple'
  id: string
  number?: string | null
  status: string | null
  amount_due?: number
  amount_paid?: number | null
  currency: string
  created: string | null
  period_start?: string | null
  period_end?: string | null
  hosted_invoice_url?: string | null
  invoice_pdf?: string | null
  description?: string | null
  subscription_type?: string
  state?: string | null
  county?: string | null
  billing_cycle?: string
}

interface PaymentHistory {
  payments: Payment[]
  stripe_error?: string | null
}

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  phone: string | null
  account_type: string
  is_active: boolean
  is_verified: boolean
  created_at: string
  subscription_count: number
  total_monthly: number
  subscription_status: string | null
  subscriptions: Subscription[]
  sales_rep_id: string | null
  sales_rep?: { id: string; first_name: string; last_name: string; email: string } | null
  referred_by?: { id: string; first_name: string; last_name: string; email: string } | null
  payment_source: string | null
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [users, setUsers] = useState<User[]>([])
  const [salesReps, setSalesReps] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ account_type: string; is_active: boolean; sales_rep_id: string | null }>({ account_type: '', is_active: true, sales_rep_id: null })
  const [saving, setSaving] = useState(false)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [paymentHistory, setPaymentHistory] = useState<Record<string, PaymentHistory>>({})
  const [loadingPayments, setLoadingPayments] = useState<string | null>(null)

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
      setCurrentUser(userData)
      
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }

      fetchUsers(token)
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchUsers = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/admin/users?limit=200`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        const allUsers = data.users || data || []
        setUsers(allUsers)
        
        // Filter sales reps (GG Sales and GG Admin) and sort by first name
        const reps = allUsers
          .filter((u: User) => 
            u.account_type === 'groundgoat_sales' || u.account_type === 'groundgoat_admin'
          )
          .sort((a: User, b: User) => 
            (a.first_name || '').localeCompare(b.first_name || '')
          )
        setSalesReps(reps)
      }
    } catch (err) {
      console.error('Failed to fetch users:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (user: User) => {
    setEditingUser(user.id)
    setEditForm({
      account_type: user.account_type,
      is_active: user.is_active,
      sales_rep_id: user.sales_rep_id,
    })
  }

  const handleSave = async (userId: string) => {
    setSaving(true)
    const token = localStorage.getItem('auth_token')

    try {
      const response = await fetch(`${API_URL}/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editForm),
      })

      if (response.ok) {
        // Update local state
        const assignedRep = salesReps.find(r => r.id === editForm.sales_rep_id)
        setUsers(prev => prev.map(u => 
          u.id === userId 
            ? { 
                ...u, 
                account_type: editForm.account_type, 
                is_active: editForm.is_active,
                sales_rep_id: editForm.sales_rep_id,
                sales_rep: assignedRep ? { 
                  id: assignedRep.id, 
                  first_name: assignedRep.first_name, 
                  last_name: assignedRep.last_name,
                  email: assignedRep.email 
                } : null
              }
            : u
        ))
        setEditingUser(null)
      }
    } catch (err) {
      console.error('Failed to update user:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setEditingUser(null)
  }

  const toggleExpand = (userId: string) => {
    const next = expandedUser === userId ? null : userId
    setExpandedUser(next)
    if (next && !paymentHistory[next]) {
      fetchPaymentHistory(next)
    }
  }

  const fetchPaymentHistory = async (userId: string) => {
    setLoadingPayments(userId)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/users/${userId}/payment-history`)
      if (res.ok) {
        const data = await res.json()
        setPaymentHistory(prev => ({ ...prev, [userId]: { payments: data.payments || [], stripe_error: data.stripe_error } }))
      }
    } catch {
      // leave history unset; the row will show an empty state
    } finally {
      setLoadingPayments(null)
    }
  }

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.last_name?.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesFilter = filterType === 'all' || user.account_type === filterType
    
    return matchesSearch && matchesFilter
  })

  const getAccountTypeBadge = (type: string) => {
    const badges: Record<string, { label: string, class: string }> = {
      'groundgoat_admin': { label: 'GG Admin', class: 'bg-red-500/20 text-red-400' },
      'groundgoat_sales': { label: 'GG Sales', class: 'bg-orange-500/20 text-orange-400' },
      'firm_admin': { label: 'Firm Admin', class: 'bg-purple-500/20 text-purple-400' },
      'firm_user': { label: 'Firm User', class: 'bg-blue-500/20 text-blue-400' },
      'individual': { label: 'Individual', class: 'bg-gray-500/20 text-gray-400' },
    }
    const badge = badges[type] || { label: type, class: 'bg-gray-500/20 text-gray-400' }
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge.class}`}>{badge.label}</span>
  }

  const getSubscriptionStatusBadge = (status: string | null, count: number) => {
    if (count === 0) {
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">No Sub</span>
    }
    if (status === 'active') {
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-500/20 text-green-400">Active</span>
    }
    if (status === 'trialing') {
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">trialing</span>
    }
    if (status === 'cancelled') {
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">Cancelled</span>
    }
    return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-400">{status || 'Unknown'}</span>
  }

  const getPaymentSourceBadge = (source: string | null) => {
    if (source === 'stripe') {
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-purple-500/20 text-purple-400">Stripe</span>
    }
    if (source === 'apple') {
      return <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-500/20 text-gray-300">Apple</span>
    }
    return <span className="text-gray-600">–</span>
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
  }

  // Check if current user can edit (only jmurphy@groundgoat.com)
  const canEdit = currentUser?.email === 'jmurphy@groundgoat.com'

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
        <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-4xl font-bold text-white">Manage Users</h1>
              <p className="text-gg-gray-400">{users.length} total users</p>
            </div>
          </div>
          {/* Force-refresh subscription prices from Stripe. Use this before
              running commission reports or doing bookkeeping reconciliation
              so the displayed amounts reflect the actual Stripe-billed
              prices (incl. promo discounts + annual-plan discounts).
              Apple IAP subs already show the price captured at signup
              from the Apple webhook — those don't need refreshing
              because Apple subscription prices don't change without the
              user re-accepting. */}
          <RefreshStripePricesButton onDone={() => {
            const t = localStorage.getItem('auth_token')
            if (t) fetchUsers(t)
          }} />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-500" size={20} />
            <input
              type="text"
              placeholder="Search users..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg pl-10 pr-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
            />
          </div>
          <div className="relative">
            <button
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="flex items-center gap-2 bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
            >
              <span>Filter: {filterType === 'all' ? 'All Types' : ACCOUNT_TYPES.find(t => t.value === filterType)?.label || filterType}</span>
              <ChevronDown size={16} />
            </button>
            {showFilterDropdown && (
              <div className="absolute right-0 top-full mt-1 bg-gg-gray-800 border border-gg-gray-700 rounded-lg shadow-xl z-10 min-w-[150px]">
                <button
                  onClick={() => { setFilterType('all'); setShowFilterDropdown(false) }}
                  className="block w-full px-4 py-2 text-left text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white"
                >
                  All Types
                </button>
                {ACCOUNT_TYPES.map(type => (
                  <button
                    key={type.value}
                    onClick={() => { setFilterType(type.value); setShowFilterDropdown(false) }}
                    className="block w-full px-4 py-2 text-left text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white"
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Users Table */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gg-gray-700">
                  <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">User</th>
                  <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">Type</th>
                  <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">Status</th>
                  <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">Sub</th>
                  <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">Price</th>
                  <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">Billing</th>
                  <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">Promo / Trial</th>
                  <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">Joined</th>
                  <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">Referred By</th>
                  {canEdit && <th className="text-left py-2 px-2 text-gg-gray-400 font-medium text-xs">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 10 : 9} className="text-center py-8 text-gg-gray-400">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(user => (
                    <>
                      <tr key={user.id} className="border-b border-gg-gray-800 hover:bg-gg-gray-800/50">
                        <td className="py-2 px-2">
                          <div>
                            <p className="text-white font-medium text-xs">{user.first_name} {user.last_name}</p>
                            <p className="text-gg-gray-500 text-[10px]">{user.email}</p>
                            <Link href={`/admin/users/${user.id}`} className="text-gg-pink text-[10px] hover:underline">View</Link>
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          {editingUser === user.id ? (
                            <select
                              value={editForm.account_type}
                              onChange={(e) => setEditForm(prev => ({ ...prev, account_type: e.target.value }))}
                              className="bg-gg-gray-800 border border-gg-gray-600 rounded px-2 py-1 text-white text-xs"
                            >
                              {ACCOUNT_TYPES.map(type => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                              ))}
                            </select>
                          ) : (
                            getAccountTypeBadge(user.account_type)
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {editingUser === user.id ? (
                            <select
                              value={editForm.is_active ? 'active' : 'inactive'}
                              onChange={(e) => setEditForm(prev => ({ ...prev, is_active: e.target.value === 'active' }))}
                              className="bg-gg-gray-800 border border-gg-gray-600 rounded px-2 py-1 text-white text-xs"
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>
                          ) : (
                            <div className="flex items-center gap-1">
                              {user.is_active ? (
                                <span className="flex items-center gap-1 text-green-400 text-xs"><UserCheck size={12} /> Active</span>
                              ) : (
                                <span className="flex items-center gap-1 text-red-400 text-xs"><UserX size={12} /> Inactive</span>
                              )}
                              {user.is_verified && <Shield size={10} className="text-blue-400" />}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <button onClick={() => toggleExpand(user.id)} className="flex items-center gap-1">
                            {getSubscriptionStatusBadge(user.subscription_status, user.subscription_count)}
                            {user.subscription_count > 0 && <span className="text-gg-gray-400 text-[10px] ml-1">({user.subscription_count})</span>}
                          </button>
                        </td>
                        <td className="py-2 px-2">
                          {user.total_monthly > 0 ? (
                            <span className="text-green-400 text-xs">{formatCurrency(user.total_monthly)}/{user.subscriptions.length > 0 && user.subscriptions[0].billing_cycle === 'annual' ? 'yr' : 'mo'}</span>
                          ) : user.subscription_count > 0 ? (
                            <span className="text-orange-400 text-xs">$0</span>
                          ) : (
                            <span className="text-gg-gray-500 text-xs">–</span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {user.subscriptions.length > 0 ? (
                            <div>
                              <span className={`text-xs ${user.subscriptions[0].billing_cycle === 'annual' ? 'text-purple-400' : 'text-blue-400'}`}>{user.subscriptions[0].billing_cycle === 'annual' ? 'Annual' : 'Monthly'}</span>
                              {user.subscriptions[0].current_period_end && (
                                <div className={`text-[10px] ${new Date(user.subscriptions[0].current_period_end) < new Date() ? 'text-red-400' : 'text-gg-gray-500'}`}>{formatDate(user.subscriptions[0].current_period_end)}</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-gg-gray-500 text-xs">–</span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          {user.subscriptions.length > 0 && user.subscriptions[0].promo_code ? (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-pink-500/20 text-pink-400">{user.subscriptions[0].promo_code}</span>
                          ) : null}
                          {user.subscription_status === 'trialing' && user.subscriptions.length > 0 && user.subscriptions[0].current_period_end && Math.ceil((new Date(user.subscriptions[0].current_period_end).getTime() - Date.now()) / 86400000) > 0 ? (
                            <span className={`text-[10px] font-medium ${Math.ceil((new Date(user.subscriptions[0].current_period_end).getTime() - Date.now()) / 86400000) <= 7 ? 'text-red-400' : Math.ceil((new Date(user.subscriptions[0].current_period_end).getTime() - Date.now()) / 86400000) <= 14 ? 'text-yellow-400' : 'text-green-400'}`}>{' '}{Math.ceil((new Date(user.subscriptions[0].current_period_end).getTime() - Date.now()) / 86400000)}d trial</span>
                          ) : null}
                          {!(user.subscriptions.length > 0 && user.subscriptions[0].promo_code) && user.subscription_status !== 'trialing' ? (
                            <span className="text-gg-gray-500 text-xs">–</span>
                          ) : null}
                        </td>
                        <td className="py-2 px-2 text-gg-gray-400 text-xs">{formatDate(user.created_at)}</td>
                        <td className="py-2 px-2">
                          {user.referred_by ? (
                            <span className="text-gg-gray-300 text-xs">{user.referred_by.first_name} {user.referred_by.last_name}</span>
                          ) : user.sales_rep ? (
                            <span className="text-gg-gray-300 text-xs">{user.sales_rep.first_name} {user.sales_rep.last_name}</span>
                          ) : (
                            <span className="text-gg-gray-500 text-xs">–</span>
                          )}
                        </td>
                        {canEdit && (
                          <td className="py-2 px-2">
                            {editingUser === user.id ? (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleSave(user.id)}
                                  disabled={saving}
                                  className="p-1 text-green-400 hover:bg-green-500/20 rounded"
                                >
                                  {saving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                                </button>
                                <button
                                  onClick={handleCancel}
                                  className="p-1 text-red-400 hover:bg-red-500/20 rounded"
                                >
                                  <X size={16} />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleEdit(user)}
                                className="p-1 text-gg-gray-400 hover:text-white hover:bg-gg-gray-700 rounded"
                              >
                                <Edit2 size={16} />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                      {/* Expanded Subscription + Payment Details */}
                      {expandedUser === user.id && (
                        <tr key={`${user.id}-subs`} className="bg-gg-gray-800/30">
                          <td colSpan={canEdit ? 14 : 13} className="py-3 px-8">
                            <div className="text-sm space-y-4">
                              {user.subscriptions && user.subscriptions.length > 0 && (
                                <div>
                                  <p className="text-gg-gray-400 mb-2 font-medium">Subscriptions:</p>
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {user.subscriptions.map((sub, idx) => (
                                      <div key={idx} className="bg-gg-gray-800 rounded px-3 py-2">
                                        <div className="flex items-center justify-between">
                                          <span className="text-white">
                                            {sub.county ? `${sub.county} County, ${sub.state}` : sub.state}
                                          </span>
                                          <div className="flex items-center gap-2">
                                            <span className={`px-2 py-0.5 rounded text-xs ${
                                              sub.status === 'active' ? 'bg-green-500/20 text-green-400' :
                                              sub.status === 'trialing' ? 'bg-yellow-500/20 text-yellow-400' :
                                              'bg-gray-500/20 text-gray-400'
                                            }`}>
                                              {sub.status === 'trialing' ? 'trialing' : sub.status}
                                            </span>
                                            {sub.monthly_price && (
                                              <span className="text-gg-gray-400 text-xs">
                                                ${formatCurrency(sub.monthly_price)}/{sub.billing_cycle === 'annual' ? 'yr' : 'mo'}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-3 mt-1 text-xs text-gg-gray-500">
                                          {sub.payment_method && (
                                            <span>via {sub.payment_method === 'stripe' ? 'Stripe' : sub.payment_method === 'apple' ? 'Apple' : sub.payment_method}</span>
                                          )}
                                          {sub.current_period_end && (
                                            <span>
                                              {sub.status === 'cancelled' || sub.status === 'expired' ? 'Expires' : 'Renews'}: {formatDate(sub.current_period_end)}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Payment / Invoice History */}
                              <div>
                                <p className="text-gg-gray-400 mb-2 font-medium">Payment History:</p>
                                {loadingPayments === user.id ? (
                                  <div className="flex items-center gap-2 text-gg-gray-500 text-xs">
                                    <Loader2 className="animate-spin" size={14} /> Loading payments…
                                  </div>
                                ) : (() => {
                                  const history = paymentHistory[user.id]
                                  if (!history) {
                                    return <p className="text-gg-gray-500 text-xs">No payment data loaded.</p>
                                  }
                                  if (history.payments.length === 0) {
                                    return (
                                      <p className="text-gg-gray-500 text-xs">
                                        No payments on record.
                                        {history.stripe_error && <span className="text-red-400 ml-1">(Stripe: {history.stripe_error})</span>}
                                      </p>
                                    )
                                  }
                                  return (
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-gg-gray-500 text-left">
                                            <th className="py-1 pr-4 font-medium">Date</th>
                                            <th className="py-1 pr-4 font-medium">Source</th>
                                            <th className="py-1 pr-4 font-medium">Description</th>
                                            <th className="py-1 pr-4 font-medium">Amount</th>
                                            <th className="py-1 pr-4 font-medium">Status</th>
                                            <th className="py-1 pr-4 font-medium">Invoice</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {history.payments.map((p, idx) => {
                                            const amount = p.amount_paid ?? p.amount_due ?? 0
                                            const desc = p.source === 'apple'
                                              ? [p.subscription_type, p.county ? `${p.county} County, ${p.state}` : p.state].filter(Boolean).join(' — ')
                                              : (p.description || p.number || '—')
                                            return (
                                              <tr key={`${p.source}-${p.id}-${idx}`} className="border-t border-gg-gray-800">
                                                <td className="py-1 pr-4 text-gg-gray-300 whitespace-nowrap">{p.created ? formatDate(p.created) : '—'}</td>
                                                <td className="py-1 pr-4 text-gg-gray-400">{p.source === 'apple' ? 'Apple' : 'Stripe'}</td>
                                                <td className="py-1 pr-4 text-gg-gray-300">{desc || '—'}</td>
                                                <td className="py-1 pr-4 text-green-400 whitespace-nowrap">{formatCurrency(amount)} {p.currency?.toUpperCase()}</td>
                                                <td className="py-1 pr-4">
                                                  <span className={`px-2 py-0.5 rounded ${
                                                    p.status === 'paid' || p.status === 'active' ? 'bg-green-500/20 text-green-400' :
                                                    p.status === 'open' || p.status === 'trialing' ? 'bg-yellow-500/20 text-yellow-400' :
                                                    'bg-gray-500/20 text-gray-400'
                                                  }`}>
                                                    {p.status || 'unknown'}
                                                  </span>
                                                </td>
                                                <td className="py-1 pr-4">
                                                  {p.hosted_invoice_url ? (
                                                    <a href={p.hosted_invoice_url} target="_blank" rel="noopener noreferrer" className="text-gg-pink hover:underline">View</a>
                                                  ) : p.invoice_pdf ? (
                                                    <a href={p.invoice_pdf} target="_blank" rel="noopener noreferrer" className="text-gg-pink hover:underline">PDF</a>
                                                  ) : (
                                                    <span className="text-gg-gray-600">—</span>
                                                  )}
                                                </td>
                                              </tr>
                                            )
                                          })}
                                        </tbody>
                                      </table>
                                      {history.stripe_error && (
                                        <p className="text-red-400 text-[11px] mt-1">Stripe: {history.stripe_error}</p>
                                      )}
                                    </div>
                                  )
                                })()}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}


/**
 * Pulls fresh prices for every active Stripe subscription via
 * POST /api/admin/refresh-all-stripe-prices, then refreshes the table.
 * Use this before running commission reports / bookkeeping so the
 * displayed amounts reflect the actual Stripe-billed price (incl.
 * promo codes + annual discounts). Apple IAP subs already show the
 * grandfathered price captured at signup; not refreshable from here
 * because Apple subscription prices don't change without user
 * re-acceptance.
 */
function RefreshStripePricesButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const refresh = async () => {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/refresh-all-stripe-prices`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setResult({
        kind: 'ok',
        text: `Synced ${body.synced} of ${body.stripe_subscriptions_processed} Stripe subs${body.failed > 0 ? ` (${body.failed} failed)` : ''}`,
      })
      onDone()
    } catch (e: any) {
      setResult({ kind: 'err', text: e?.message || String(e) })
    } finally {
      setBusy(false)
      // Auto-clear toast after 6s
      setTimeout(() => setResult(null), 6000)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {result && (
        <span className={`text-xs ${result.kind === 'ok' ? 'text-green-300' : 'text-red-300'}`}>
          {result.text}
        </span>
      )}
      <button
        onClick={refresh}
        disabled={busy}
        title="Pull current prices from Stripe so commission/bookkeeping math reflects what customers are actually billed"
        className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition ${
          busy
            ? 'bg-gg-gray-800 border-gg-gray-700 text-gg-gray-400 cursor-wait'
            : 'bg-gg-pink/10 border-gg-pink/40 text-gg-pink hover:bg-gg-pink/20'
        }`}
      >
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <RefreshCw size={14} />
        )}
        {busy ? 'Refreshing prices…' : 'Refresh prices from Stripe'}
      </button>
    </div>
  )
}
