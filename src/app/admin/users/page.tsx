'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Search, UserCheck, UserX, Shield, Loader2, ChevronDown, Edit2, X, Check, DollarSign } from 'lucide-react'

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
    setExpandedUser(expandedUser === userId ? null : userId)
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
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="font-display text-4xl font-bold text-white">Manage Users</h1>
            <p className="text-gg-gray-400">{users.length} total users</p>
          </div>
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
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">User</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Type</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Status</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Source</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Subscription</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Monthly</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Joined</th>
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Sales Rep</th>
                  {canEdit && <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 8 : 7} className="text-center py-8 text-gg-gray-400">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(user => (
                    <>
                      <tr key={user.id} className="border-b border-gg-gray-800 hover:bg-gg-gray-800/50">
                        <td className="py-4 px-4">
                          <div>
                            <p className="text-white font-medium">{user.first_name} {user.last_name}</p>
                            <p className="text-gg-gray-400 text-sm">{user.email}</p>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          {editingUser === user.id ? (
                            <select
                              value={editForm.account_type}
                              onChange={(e) => setEditForm(prev => ({ ...prev, account_type: e.target.value }))}
                              className="bg-gg-gray-800 border border-gg-gray-600 rounded px-2 py-1 text-white text-sm"
                            >
                              {ACCOUNT_TYPES.map(type => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                              ))}
                            </select>
                          ) : (
                            getAccountTypeBadge(user.account_type)
                          )}
                        </td>
                        <td className="py-4 px-4">
                          {editingUser === user.id ? (
                            <select
                              value={editForm.is_active ? 'active' : 'inactive'}
                              onChange={(e) => setEditForm(prev => ({ ...prev, is_active: e.target.value === 'active' }))}
                              className="bg-gg-gray-800 border border-gg-gray-600 rounded px-2 py-1 text-white text-sm"
                            >
                              <option value="active">Active</option>
                              <option value="inactive">Inactive</option>
                            </select>
                          ) : (
                            <div className="flex items-center gap-2">
                              {user.is_active ? (
                                <span className="flex items-center gap-1 text-green-400 text-sm">
                                  <UserCheck size={16} /> Active
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-red-400 text-sm">
                                  <UserX size={16} /> Inactive
                                </span>
                              )}
                              {user.is_verified && (
                                <span className="flex items-center gap-1 text-blue-400 text-sm">
                                  <Shield size={14} />
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4">
                          {getPaymentSourceBadge(user.payment_source)}
                        </td>
                        <td className="py-4 px-4">
                          <button
                            onClick={() => toggleExpand(user.id)}
                            className="flex items-center gap-1"
                          >
                            {getSubscriptionStatusBadge(user.subscription_status, user.subscription_count)}
                            {user.subscription_count > 0 && (
                              <span className="text-gg-gray-400 text-xs ml-1">
                                ({user.subscription_count})
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="py-4 px-4">
                          {user.total_monthly > 0 ? (
                            <span className="flex items-center gap-1 text-green-400 text-sm">
                              <DollarSign size={14} />
                              {formatCurrency(user.total_monthly)}/mo
                            </span>
                          ) : user.subscription_count > 0 ? (
                            <span className="flex items-center gap-1 text-orange-400 text-sm">
                              <DollarSign size={14} />
                              $0
                            </span>
                          ) : (
                            <span className="text-gg-gray-500 text-sm">–</span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-gg-gray-400 text-sm">
                          {formatDate(user.created_at)}
                        </td>
                        <td className="py-4 px-4">
                          {editingUser === user.id ? (
                            <select
                              value={editForm.sales_rep_id || ''}
                              onChange={(e) => setEditForm(prev => ({ ...prev, sales_rep_id: e.target.value || null }))}
                              className="bg-gg-gray-800 border border-gg-gray-600 rounded px-2 py-1 text-white text-sm min-w-[120px]"
                            >
                              <option value="">No Rep</option>
                              {salesReps.map(rep => (
                                <option key={rep.id} value={rep.id}>
                                  {rep.first_name} {rep.last_name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            user.sales_rep ? (
                              <span className="text-gg-gray-300 text-sm">
                                {user.sales_rep.first_name} {user.sales_rep.last_name}
                              </span>
                            ) : (
                              <span className="text-gg-gray-500 text-sm">-</span>
                            )
                          )}
                        </td>
                        {canEdit && (
                          <td className="py-4 px-4">
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
                      {/* Expanded Subscription Details */}
                      {expandedUser === user.id && user.subscriptions && user.subscriptions.length > 0 && (
                        <tr key={`${user.id}-subs`} className="bg-gg-gray-800/30">
                          <td colSpan={canEdit ? 9 : 8} className="py-3 px-8">
                            <div className="text-sm">
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
