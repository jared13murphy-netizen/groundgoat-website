'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, 
  DollarSign, 
  Users, 
  ChevronDown, 
  ChevronUp,
  Calendar,
  TrendingUp,
  User,
  Briefcase
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface CommissionDetail {
  earner_id: string
  earner_name: string
  earner_email: string
  earner_type: string
  subscriber_id: string
  subscriber_name: string
  subscriber_email: string
  subscription_id: string
  subscription_type: string
  subscription_created: string
  period_month: number
  base_amount: number
  commission_rate: number
  commission_amount: number
}

interface Earner {
  earner_id: string
  earner_name: string
  earner_email: string
  earner_type: string
  total_commission: number
  subscription_count: number
  details: CommissionDetail[]
}

interface CommissionReport {
  year: number
  month: number
  report_period: string
  grand_total: number
  earners: Earner[]
}

interface SalesTeamMember {
  id: string
  email: string
  first_name: string
  last_name: string
  account_type: string
  sales_manager_id: string | null
  sales_manager_name: string | null
  referral_count: number
}

export default function CommissionsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'report' | 'team'>('report')
  
  // Report state
  const [report, setReport] = useState<CommissionReport | null>(null)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)
  const [expandedEarners, setExpandedEarners] = useState<Set<string>>(new Set())
  
  // Team state
  const [salesTeam, setSalesTeam] = useState<SalesTeamMember[]>([])
  const [assigningManager, setAssigningManager] = useState<string | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth(token)
  }, [router])

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      fetchCommissionReport(token)
    }
  }, [selectedYear, selectedMonth])

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

      await Promise.all([
        fetchCommissionReport(token),
        fetchSalesTeam(token)
      ])
    } catch (err) {
      router.push('/signin')
    } finally {
      setLoading(false)
    }
  }

  const fetchCommissionReport = async (token: string) => {
    try {
      const response = await fetch(
        `${API_URL}/api/admin/commission-report?year=${selectedYear}&month=${selectedMonth}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      )
      if (response.ok) {
        const data = await response.json()
        setReport(data)
      }
    } catch (err) {
      console.error('Failed to fetch commission report:', err)
    }
  }

  const fetchSalesTeam = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/admin/sales-team`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (response.ok) {
        const data = await response.json()
        setSalesTeam(data)
      }
    } catch (err) {
      console.error('Failed to fetch sales team:', err)
    }
  }

  const assignManager = async (salesRepId: string, managerId: string | null) => {
    const token = localStorage.getItem('auth_token')
    if (!token) return

    try {
      const response = await fetch(`${API_URL}/api/admin/assign-sales-manager?sales_rep_id=${salesRepId}${managerId ? `&manager_id=${managerId}` : ''}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (response.ok) {
        await fetchSalesTeam(token)
        setAssigningManager(null)
      }
    } catch (err) {
      console.error('Failed to assign manager:', err)
    }
  }

  const toggleEarnerExpanded = (earnerId: string) => {
    setExpandedEarners(prev => {
      const newSet = new Set(prev)
      if (newSet.has(earnerId)) {
        newSet.delete(earnerId)
      } else {
        newSet.add(earnerId)
      }
      return newSet
    })
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatPercent = (rate: number) => {
    return `${(rate * 100).toFixed(0)}%`
  }

  const getPeriodLabel = (month: number) => {
    if (month === 1) return 'Month 1'
    if (month <= 12) return `Month ${month}`
    const year = Math.ceil(month / 12)
    return `Year ${year}`
  }

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ]

  const managers = salesTeam.filter(m => m.account_type === 'groundgoat_sales_manager')

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
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
            <h1 className="font-display text-3xl font-bold text-white">Commissions</h1>
            <p className="text-gg-gray-400">Manage sales rep commissions and team</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 mb-8">
          <button
            onClick={() => setActiveTab('report')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'report'
                ? 'bg-gg-pink text-white'
                : 'bg-gg-gray-800 text-gg-gray-400 hover:text-white'
            }`}
          >
            <DollarSign className="inline-block mr-2" size={18} />
            Commission Report
          </button>
          <button
            onClick={() => setActiveTab('team')}
            className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
              activeTab === 'team'
                ? 'bg-gg-pink text-white'
                : 'bg-gg-gray-800 text-gg-gray-400 hover:text-white'
            }`}
          >
            <Users className="inline-block mr-2" size={18} />
            Sales Team
          </button>
        </div>

        {/* Commission Report Tab */}
        {activeTab === 'report' && (
          <>
            {/* Month/Year Selector */}
            <div className="card mb-6">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <Calendar size={20} className="text-gg-pink" />
                  <span className="text-white font-semibold">Report Period:</span>
                </div>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                >
                  {months.map((month, idx) => (
                    <option key={month} value={idx + 1}>{month}</option>
                  ))}
                </select>
                <select
                  value={selectedYear}
                  onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                  className="bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
                >
                  {[2024, 2025, 2026, 2027].map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Grand Total */}
            <div className="card mb-6 bg-gradient-to-r from-gg-pink/20 to-purple-600/20 border-gg-pink/50">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gg-gray-400 mb-1">Total Commissions for {report?.report_period}</p>
                  <p className="text-4xl font-bold text-white">{formatCurrency(report?.grand_total || 0)}</p>
                </div>
                <div className="w-16 h-16 bg-gg-pink/20 rounded-xl flex items-center justify-center">
                  <TrendingUp size={32} className="text-gg-pink" />
                </div>
              </div>
            </div>

            {/* Earners List */}
            {report?.earners && report.earners.length > 0 ? (
              <div className="space-y-4">
                {report.earners.map((earner) => (
                  <div key={earner.earner_id} className="card">
                    {/* Earner Header */}
                    <button
                      onClick={() => toggleEarnerExpanded(earner.earner_id)}
                      className="w-full flex items-center justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          earner.earner_type === 'sales_manager' 
                            ? 'bg-purple-500/20 text-purple-400' 
                            : 'bg-gg-pink/20 text-gg-pink'
                        }`}>
                          {earner.earner_type === 'sales_manager' ? <Briefcase size={20} /> : <User size={20} />}
                        </div>
                        <div className="text-left">
                          <p className="text-white font-semibold">{earner.earner_name}</p>
                          <p className="text-gg-gray-400 text-sm">{earner.earner_email}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          earner.earner_type === 'sales_manager'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-gg-pink/20 text-gg-pink'
                        }`}>
                          {earner.earner_type === 'sales_manager' ? 'Manager' : 'Sales Rep'}
                        </span>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-2xl font-bold text-white">{formatCurrency(earner.total_commission)}</p>
                          <p className="text-gg-gray-400 text-sm">{earner.subscription_count} subscriptions</p>
                        </div>
                        {expandedEarners.has(earner.earner_id) ? (
                          <ChevronUp className="text-gg-gray-400" />
                        ) : (
                          <ChevronDown className="text-gg-gray-400" />
                        )}
                      </div>
                    </button>

                    {/* Expanded Details */}
                    {expandedEarners.has(earner.earner_id) && (
                      <div className="mt-6 pt-6 border-t border-gg-gray-800">
                        <table className="w-full">
                          <thead>
                            <tr className="text-left text-gg-gray-400 text-sm">
                              <th className="pb-3">Subscriber</th>
                              <th className="pb-3">Type</th>
                              <th className="pb-3">Started</th>
                              <th className="pb-3">Period</th>
                              <th className="pb-3">Base</th>
                              <th className="pb-3">Rate</th>
                              <th className="pb-3 text-right">Commission</th>
                            </tr>
                          </thead>
                          <tbody className="text-white">
                            {earner.details.map((detail, idx) => (
                              <tr key={idx} className="border-t border-gg-gray-800">
                                <td className="py-3">
                                  <p className="font-medium">{detail.subscriber_name}</p>
                                  <p className="text-gg-gray-400 text-sm">{detail.subscriber_email}</p>
                                </td>
                                <td className="py-3 capitalize">{detail.subscription_type}</td>
                                <td className="py-3">{formatDate(detail.subscription_created)}</td>
                                <td className="py-3">{getPeriodLabel(detail.period_month)}</td>
                                <td className="py-3">{formatCurrency(detail.base_amount)}</td>
                                <td className="py-3">{formatPercent(detail.commission_rate)}</td>
                                <td className="py-3 text-right font-semibold text-gg-pink">
                                  {formatCurrency(detail.commission_amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="card text-center py-12">
                <DollarSign size={48} className="mx-auto text-gg-gray-600 mb-4" />
                <p className="text-gg-gray-400">No commissions for this period</p>
                <p className="text-gg-gray-500 text-sm mt-2">
                  Commissions are calculated from referrals made by sales reps
                </p>
              </div>
            )}
          </>
        )}

        {/* Sales Team Tab */}
        {activeTab === 'team' && (
          <>
            {salesTeam.length > 0 ? (
              <div className="space-y-4">
                {salesTeam.map((member) => (
                  <div key={member.id} className="card">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          member.account_type === 'groundgoat_sales_manager'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-gg-pink/20 text-gg-pink'
                        }`}>
                          {member.account_type === 'groundgoat_sales_manager' ? (
                            <Briefcase size={20} />
                          ) : (
                            <User size={20} />
                          )}
                        </div>
                        <div>
                          <p className="text-white font-semibold">
                            {member.first_name} {member.last_name}
                          </p>
                          <p className="text-gg-gray-400 text-sm">{member.email}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          member.account_type === 'groundgoat_sales_manager'
                            ? 'bg-purple-500/20 text-purple-400'
                            : 'bg-gg-pink/20 text-gg-pink'
                        }`}>
                          {member.account_type === 'groundgoat_sales_manager' ? 'Manager' : 'Sales Rep'}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-white font-semibold">{member.referral_count}</p>
                          <p className="text-gg-gray-400 text-sm">Referrals</p>
                        </div>
                        
                        {/* Manager Assignment (only for sales reps) */}
                        {member.account_type === 'groundgoat_sales' && (
                          <div className="min-w-[200px]">
                            {assigningManager === member.id ? (
                              <select
                                className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                                value={member.sales_manager_id || ''}
                                onChange={(e) => assignManager(member.id, e.target.value || null)}
                                onBlur={() => setAssigningManager(null)}
                                autoFocus
                              >
                                <option value="">No Manager</option>
                                {managers.map(m => (
                                  <option key={m.id} value={m.id}>
                                    {m.first_name} {m.last_name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <button
                                onClick={() => setAssigningManager(member.id)}
                                className="text-left w-full px-3 py-2 bg-gg-gray-800 rounded-lg hover:bg-gg-gray-700 transition-colors"
                              >
                                {member.sales_manager_name ? (
                                  <span className="text-white text-sm">
                                    Manager: {member.sales_manager_name}
                                  </span>
                                ) : (
                                  <span className="text-gg-gray-400 text-sm">
                                    Assign Manager...
                                  </span>
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="card text-center py-12">
                <Users size={48} className="mx-auto text-gg-gray-600 mb-4" />
                <p className="text-gg-gray-400">No sales team members yet</p>
                <p className="text-gg-gray-500 text-sm mt-2">
                  Users with @groundgoat.com emails who sign up will automatically become sales reps
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
