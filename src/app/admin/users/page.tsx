'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Search, UserCheck, UserX, Shield, Loader2, ChevronDown } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface User {
  id: string
  email: string
  first_name: string
  last_name: string
  account_type: string
  is_active: boolean
  is_verified: boolean
  created_at: string
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    fetchUsers(token)
  }, [router])

  const fetchUsers = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/admin/users`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setUsers(data.users || data || [])
      }
    } catch (err) {
      console.error('Failed to fetch users:', err)
    } finally {
      setLoading(false)
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
      'groundgoat_admin': { label: 'Admin', class: 'bg-red-500/20 text-red-400' },
      'groundgoat_sales': { label: 'Sales', class: 'bg-orange-500/20 text-orange-400' },
      'firm_admin': { label: 'Firm Admin', class: 'bg-purple-500/20 text-purple-400' },
      'firm_user': { label: 'Firm User', class: 'bg-blue-500/20 text-blue-400' },
      'individual': { label: 'Individual', class: 'bg-gray-500/20 text-gray-400' },
    }
    const badge = badges[type] || { label: type, class: 'bg-gray-500/20 text-gray-400' }
    return <span className={`px-2 py-1 rounded-full text-xs font-medium ${badge.class}`}>{badge.label}</span>
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
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
              <span>Filter: {filterType === 'all' ? 'All Types' : filterType}</span>
              <ChevronDown size={16} />
            </button>
            {showFilterDropdown && (
              <div className="absolute right-0 top-full mt-1 bg-gg-gray-800 border border-gg-gray-700 rounded-lg shadow-xl z-10">
                {['all', 'individual', 'firm_admin', 'firm_user', 'groundgoat_admin', 'groundgoat_sales'].map(type => (
                  <button
                    key={type}
                    onClick={() => { setFilterType(type); setShowFilterDropdown(false) }}
                    className="block w-full px-4 py-2 text-left text-gg-gray-300 hover:bg-gg-gray-700 hover:text-white"
                  >
                    {type === 'all' ? 'All Types' : type}
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
                  <th className="text-left py-4 px-4 text-gg-gray-400 font-medium">Joined</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-gg-gray-400">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(user => (
                    <tr key={user.id} className="border-b border-gg-gray-800 hover:bg-gg-gray-800/50">
                      <td className="py-4 px-4">
                        <div>
                          <p className="text-white font-medium">{user.first_name} {user.last_name}</p>
                          <p className="text-gg-gray-400 text-sm">{user.email}</p>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {getAccountTypeBadge(user.account_type)}
                      </td>
                      <td className="py-4 px-4">
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
                      </td>
                      <td className="py-4 px-4 text-gg-gray-400 text-sm">
                        {formatDate(user.created_at)}
                      </td>
                    </tr>
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
