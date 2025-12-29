'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  DollarSign,
  Users, 
  FileText, 
  Building2, 
  TrendingUp, 
  Clock, 
  AlertCircle,
  ChevronRight,
  RefreshCw,
  Radio
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Token refresh helper
async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  let token = localStorage.getItem('auth_token')
  
  const headers = new Headers(options.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response = await fetch(url, { ...options, headers })

  // If 401, try to refresh the token
  if (response.status === 401) {
    const refreshToken = localStorage.getItem('refresh_token')
    if (refreshToken) {
      const refreshResponse = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })

      if (refreshResponse.ok) {
        const data = await refreshResponse.json()
        localStorage.setItem('auth_token', data.access_token)
        if (data.refresh_token) {
          localStorage.setItem('refresh_token', data.refresh_token)
        }
        // Retry original request with new token
        headers.set('Authorization', `Bearer ${data.access_token}`)
        response = await fetch(url, { ...options, headers })
      } else {
        // Refresh failed, clear tokens
        localStorage.removeItem('auth_token')
        localStorage.removeItem('refresh_token')
        localStorage.removeItem('user')
      }
    }
  }

  return response
}

export default function AdminDashboard() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

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
      const response = await fetchWithAuth(`${API_URL}/api/auth/me`)

      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()
      
      // Check if user is admin
      if (userData.account_type !== 'groundgoat_admin' && userData.account_type !== 'groundgoat_sales') {
        router.push('/account')
        return
      }

      setUser(userData)
      fetchStats()
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchStats = async () => {
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/stats`)

      if (response.ok) {
        const data = await response.json()
        setStats(data)
      } else {
        // Use mock stats if endpoint doesn't exist
        setStats({
          total_users: 0,
          total_listings: 0,
          total_companies: 0,
          active_subscriptions: 0,
          upcoming_auctions: 0,
          recent_results: 0,
        })
      }
    } catch (err) {
      setStats({
        total_users: 0,
        total_listings: 0,
        total_companies: 0,
        active_subscriptions: 0,
        upcoming_auctions: 0,
        recent_results: 0,
      })
    } finally {
      setLoading(false)
    }
  }

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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="font-display text-4xl font-bold text-white mb-2">Admin Dashboard</h1>
            <p className="text-gg-gray-400">Welcome back, {user?.first_name}</p>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          <StatCard icon={<Users />} label="Total Users" value={stats?.total_users || 0} />
          <StatCard icon={<FileText />} label="Listings" value={stats?.total_listings || 0} />
          <StatCard icon={<Building2 />} label="Companies" value={stats?.total_companies || 0} />
          <StatCard icon={<TrendingUp />} label="Active Subs" value={stats?.active_subscriptions || 0} />
          <StatCard icon={<Clock />} label="Upcoming" value={stats?.upcoming_auctions || 0} />
          <StatCard icon={<AlertCircle />} label="Results" value={stats?.recent_results || 0} />
        </div>

        {/* Control Center Banner */}
        <Link 
          href="/admin/control-center" 
          className="block mb-8 p-6 bg-gradient-to-r from-gg-pink/20 to-purple-600/20 border border-gg-pink/50 rounded-xl hover:border-gg-pink transition-colors group"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gg-pink/20 rounded-xl flex items-center justify-center text-gg-pink group-hover:bg-gg-pink/30 transition-colors">
                <Radio size={28} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Auction Control Center</h2>
                <p className="text-gg-gray-400">Manage live auctions in real-time</p>
              </div>
            </div>
            <ChevronRight className="text-gg-pink" size={24} />
          </div>
        </Link>

        {/* Quick Actions */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          <QuickActionCard
            title="Scraper"
            description="Run the auction scraper to fetch new listings"
            href="/admin/scraper"
            icon={<RefreshCw />}
          />
          <QuickActionCard
            title="Private Treaty Check"
            description="View status check reports for private treaty listings"
            href="/admin/private-treaty-reports"
            icon={<Clock />}
          />
          <QuickActionCard
            title="Manage Users"
            description="View and manage user accounts"
            href="/admin/users"
            icon={<Users />}
          />
          <QuickActionCard
            title="Commissions"
            description="View sales rep commissions"
            href="/admin/commissions"
            icon={<DollarSign />}
          />
          <QuickActionCard
            title="Manage Listings"
            description="Edit or remove auction listings"
            href="/admin/listings"
            icon={<FileText />}
          />
          <QuickActionCard
            title="Companies"
            description="Manage auction company records"
            href="/admin/companies"
            icon={<Building2 />}
          />
          <QuickActionCard
            title="Reports"
            description="View analytics and reports"
            href="/admin/reports"
            icon={<TrendingUp />}
          />
          <QuickActionCard
            title="Settings"
            description="Configure system settings"
            href="/admin/settings"
            icon={<AlertCircle />}
          />
        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value }: { icon: React.ReactNode, label: string, value: number }) {
  return (
    <div className="card text-center">
      <div className="w-10 h-10 bg-gg-pink/10 rounded-lg flex items-center justify-center text-gg-pink mx-auto mb-2">
        {icon}
      </div>
      <div className="text-2xl font-bold text-white">{value.toLocaleString()}</div>
      <div className="text-xs text-gg-gray-400">{label}</div>
    </div>
  )
}

function QuickActionCard({ title, description, href, icon }: { title: string, description: string, href: string, icon: React.ReactNode }) {
  return (
    <Link href={href} className="card hover:border-gg-pink group">
      <div className="flex items-start justify-between">
        <div className="w-12 h-12 bg-gg-pink/10 rounded-xl flex items-center justify-center text-gg-pink mb-4 group-hover:bg-gg-pink/20 transition-colors">
          {icon}
        </div>
        <ChevronRight className="text-gg-gray-500 group-hover:text-gg-pink transition-colors" />
      </div>
      <h3 className="font-semibold text-white mb-1">{title}</h3>
      <p className="text-sm text-gg-gray-400">{description}</p>
    </Link>
  )
}
