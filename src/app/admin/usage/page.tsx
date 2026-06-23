'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, BarChart2, Loader2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface TopUser {
  user_id: string
  email: string
  requests_30: number
  active_days_30: number
  last_active_at: string | null
  top_features: { label: string; count: number }[]
}

interface MetricsData {
  dau: number
  wau: number
  mau: number
  top_users: TopUser[]
}

export default function UsageDashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<MetricsData | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }

    fetchWithAuth(`${API_URL}/api/auth/me`)
      .then(res => {
        if (!res.ok) {
          router.push('/signin')
          return null
        }
        return res.json()
      })
      .then(me => {
        if (!me) return
        if (me.account_type !== 'groundgoat_admin') {
          router.push('/account')
          return
        }

        fetchWithAuth(`${API_URL}/api/admin/metrics/user-summary`)
          .then(r => r.json())
          .then(metrics => {
            setData(metrics)
            setLoading(false)
          })
          .catch(err => {
            setError(err.message || 'Failed to load metrics')
            setLoading(false)
          })
      })
      .catch(() => {
        router.push('/signin')
      })
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-gg-gray-400 mb-4">{error || 'Failed to load metrics'}</p>
          <Link href="/admin/dashboard" className="text-gg-pink hover:underline text-sm">
            Back to Dashboard
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-6">
          <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </Link>
        </div>

        <div className="flex items-center gap-4 mb-8">
          <BarChart2 size={24} className="text-gg-pink" />
          <div>
            <h1 className="font-display text-4xl font-bold text-white">Usage Dashboard</h1>
            <p className="text-gg-gray-400 mt-1">Active users and top activity across the platform.</p>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6 mb-8">
          <div className="card text-center">
            <p className="text-sm text-gg-gray-400 mb-1">Daily Active</p>
            <p className="text-3xl font-bold text-white">{data.dau}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gg-gray-400 mb-1">Weekly Active</p>
            <p className="text-3xl font-bold text-white">{data.wau}</p>
          </div>
          <div className="card text-center">
            <p className="text-sm text-gg-gray-400 mb-1">Monthly Active</p>
            <p className="text-3xl font-bold text-white">{data.mau}</p>
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Top Users (30d)</h2>
          {data.top_users.length === 0 ? (
            <p className="text-sm text-gg-gray-500">No user activity data yet.</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr>
                  <th className="text-left py-2 px-3 text-gg-gray-400 font-medium text-xs border-b border-gg-gray-700">#</th>
                  <th className="text-left py-2 px-3 text-gg-gray-400 font-medium text-xs border-b border-gg-gray-700">User</th>
                  <th className="text-left py-2 px-3 text-gg-gray-400 font-medium text-xs border-b border-gg-gray-700">Requests (30d)</th>
                  <th className="text-left py-2 px-3 text-gg-gray-400 font-medium text-xs border-b border-gg-gray-700">Active Days (30d)</th>
                  <th className="text-left py-2 px-3 text-gg-gray-400 font-medium text-xs border-b border-gg-gray-700">Last Active</th>
                  <th className="text-left py-2 px-3 text-gg-gray-400 font-medium text-xs border-b border-gg-gray-700">Top Feature</th>
                </tr>
              </thead>
              <tbody>
                {data.top_users.map((row, i) => (
                  <tr key={row.user_id} className="border-b border-gg-gray-800">
                    <td className="py-2 px-3 text-sm text-gg-gray-500">{i + 1}</td>
                    <td className="py-2 px-3 text-sm text-gg-gray-300">
                      <Link href={`/admin/users/${row.user_id}`} className="text-gg-pink hover:underline">
                        {row.email}
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-sm text-gg-gray-300">{row.requests_30}</td>
                    <td className="py-2 px-3 text-sm text-gg-gray-300">{row.active_days_30}</td>
                    <td className="py-2 px-3 text-sm text-gg-gray-300">{timeAgo(row.last_active_at)}</td>
                    <td className="py-2 px-3 text-sm text-gg-gray-300">{row.top_features[0]?.label || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
