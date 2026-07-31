'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, TrendingUp, Users, FileText, DollarSign, Calendar, MapPin, Loader2 } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export default function AdminReportsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<any>(null)
  const [dateRange, setDateRange] = useState('30')

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    fetchStats(token)
  }, [router, dateRange])

  const fetchStats = async (token: string) => {
    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/api/admin/stats`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setStats(data)
      } else {
        // Use mock data if endpoint doesn't exist yet
        setStats({
          total_users: 127,
          new_users_this_month: 23,
          total_listings: 1432,
          new_listings_this_month: 89,
          total_companies: 45,
          active_subscriptions: 84,
          monthly_revenue: 2499.00,
          top_states: [
            { state: 'Illinois', count: 342 },
            { state: 'Iowa', count: 287 },
            { state: 'Missouri', count: 198 },
            { state: 'Indiana', count: 156 },
            { state: 'Wisconsin', count: 134 },
          ],
          listings_by_month: [
            { month: 'Jul', count: 45 },
            { month: 'Aug', count: 62 },
            { month: 'Sep', count: 78 },
            { month: 'Oct', count: 95 },
            { month: 'Nov', count: 112 },
            { month: 'Dec', count: 89 },
          ],
        })
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err)
    } finally {
      setLoading(false)
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
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-4xl font-bold text-white">Reports</h1>
              <p className="text-gg-gray-400">Analytics and insights</p>
            </div>
          </div>
          <select
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <MetricCard
            icon={<Users />}
            label="Total Users"
            value={stats?.total_users || 0}
            change={`+${stats?.new_users_this_month || 0} this month`}
            positive={true}
          />
          <MetricCard
            icon={<FileText />}
            label="Total Listings"
            value={stats?.total_listings || 0}
            change={`+${stats?.new_listings_this_month || 0} this month`}
            positive={true}
          />
          <MetricCard
            icon={<TrendingUp />}
            label="Active Subscriptions"
            value={stats?.active_subscriptions || 0}
            change="65% conversion"
            positive={true}
          />
          <MetricCard
            icon={<DollarSign />}
            label="Monthly Revenue"
            value={`$${(stats?.monthly_revenue || 0).toLocaleString()}`}
            change="+12% vs last month"
            positive={true}
          />
        </div>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Listings by Month */}
          <div className="card">
            <h3 className="font-semibold text-white mb-6 flex items-center gap-2">
              <Calendar size={20} className="text-gg-pink" />
              Listings by Month
            </h3>
            <div className="space-y-4">
              {stats?.listings_by_month?.map((item: any) => (
                <div key={item.month} className="flex items-center gap-4">
                  <span className="text-gg-gray-400 w-12">{item.month}</span>
                  <div className="flex-1 h-8 bg-gg-gray-800 rounded-lg overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-gg-pink to-gg-pink-dark rounded-lg"
                      style={{ width: `${(item.count / 120) * 100}%` }}
                    />
                  </div>
                  <span className="text-white font-medium w-12 text-right">{item.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Top States */}
          <div className="card">
            <h3 className="font-semibold text-white mb-6 flex items-center gap-2">
              <MapPin size={20} className="text-gg-pink" />
              Top States by Listings
            </h3>
            <div className="space-y-4">
              {stats?.top_states?.map((item: any, index: number) => (
                <div key={item.state} className="flex items-center gap-4">
                  <span className="text-gg-pink font-bold w-6">{index + 1}</span>
                  <span className="text-white flex-1">{item.state}</span>
                  <span className="text-gg-gray-400">{item.count} listings</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Subscription Breakdown */}
        <div className="card mt-8">
          <h3 className="font-semibold text-white mb-6 flex items-center gap-2">
            <TrendingUp size={20} className="text-gg-pink" />
            Subscription Breakdown
          </h3>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="bg-gg-gray-800 rounded-xl p-6 text-center">
              <div className="text-3xl font-bold text-white mb-2">52</div>
              <div className="text-gg-gray-400">County Plans</div>
              <div className="text-gg-pink text-sm mt-1">$415.48/mo</div>
            </div>
            <div className="bg-gg-gray-800 rounded-xl p-6 text-center">
              <div className="text-3xl font-bold text-white mb-2">28</div>
              <div className="text-gg-gray-400">State Plans</div>
              <div className="text-gg-pink text-sm mt-1">$839.72/mo</div>
            </div>
            <div className="bg-gg-gray-800 rounded-xl p-6 text-center">
              <div className="text-3xl font-bold text-white mb-2">4</div>
              <div className="text-gg-gray-400">Management Firms</div>
              <div className="text-gg-pink text-sm mt-1">$759.96/mo</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value, change, positive }: { 
  icon: React.ReactNode, 
  label: string, 
  value: string | number, 
  change: string,
  positive: boolean 
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-gg-pink/10 rounded-lg flex items-center justify-center text-gg-pink">
          {icon}
        </div>
        <span className="text-gg-gray-400 text-sm">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white mb-1">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      <div className={`text-sm ${positive ? 'text-green-400' : 'text-red-400'}`}>
        {change}
      </div>
    </div>
  )
}
