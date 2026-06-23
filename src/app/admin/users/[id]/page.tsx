'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, User, Loader2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface UsageData {
  user_id: string
  last_active_at: string | null
  active_days_30: number
  active_days_7: number
  requests_30: number
  requests_7: number
  top_features: { label: string; count: number }[]
  sparkline: { date: string; requests: number }[]
  summary_updated_at: string | null
}

interface UserInfo {
  id: string
  email: string
  first_name: string
  last_name: string
  subscription_count: number
}

export default function UserDetailPage() {
  const router = useRouter()
  const params = useParams()
  const id = params.id as string

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)

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

        Promise.all([
          fetchWithAuth(`${API_URL}/api/admin/users?limit=200`).then(r => r.json()),
          fetchWithAuth(`${API_URL}/api/admin/users/${id}/usage`).then(r => r.json()),
        ])
          .then(([usersData, usageData]) => {
            const users: UserInfo[] = usersData.users || usersData || []
            const found = users.find((u: UserInfo) => u.id === id) || null
            setUserInfo(found)
            setUsage(usageData)
            setLoading(false)
          })
          .catch(err => {
            setError(err.message || 'Failed to load data')
            setLoading(false)
          })
      })
      .catch(() => {
        router.push('/signin')
      })
  }, [id, router])

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  if (error || !usage) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-gg-gray-400 mb-4">{error || 'User not found'}</p>
          <Link href="/admin/users" className="text-gg-pink hover:underline text-sm">
            Back to Users
          </Link>
        </div>
      </div>
    )
  }

  const hasSparkline = usage.sparkline.length > 0 && usage.sparkline.some(d => d.requests > 0)

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-6">
          <Link href="/admin/users" className="text-gg-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </Link>
        </div>

        <div className="flex items-center gap-4 mb-8">
          <User size={24} className="text-gg-pink" />
          <div>
            <h1 className="font-display text-4xl font-bold text-white">User Detail</h1>
            {userInfo && (
              <p className="text-gg-gray-400 mt-1">{userInfo.email}</p>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Usage</h2>

          <div className="flex flex-wrap gap-6 mb-6">
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Last Active</p>
              <p className="text-2xl font-bold text-white">{timeAgo(usage.last_active_at)}</p>
            </div>
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Active Days (30d)</p>
              <p className="text-2xl font-bold text-white">{usage.active_days_30}</p>
            </div>
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Active Days (7d)</p>
              <p className="text-2xl font-bold text-white">{usage.active_days_7}</p>
            </div>
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Requests (30d)</p>
              <p className="text-2xl font-bold text-white">{usage.requests_30}</p>
            </div>
            <div>
              <p className="text-xs text-gg-gray-400 mb-1">Requests (7d)</p>
              <p className="text-2xl font-bold text-white">{usage.requests_7}</p>
            </div>
            {userInfo && typeof userInfo.subscription_count === 'number' && (
              <div>
                <p className="text-xs text-gg-gray-400 mb-1">Subscriptions</p>
                <p className="text-2xl font-bold text-white">{userInfo.subscription_count}</p>
              </div>
            )}
          </div>

          <div className="border-t border-gg-gray-700 my-6" />

          <p className="text-sm font-medium text-gg-gray-400 mb-3">Top Features</p>
          {usage.top_features.length === 0 ? (
            <p className="text-sm text-gg-gray-500">No activity yet.</p>
          ) : (
            <div>
              {usage.top_features.slice(0, 5).map((feature, i) => (
                <div key={feature.label}>
                  {i > 0 && <div className="border-t border-gg-gray-800" />}
                  <div className="flex items-center justify-between py-1.5">
                    <span className="text-sm text-white">{feature.label}</span>
                    <span className="text-sm text-gg-gray-400">{feature.count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-gg-gray-700 my-6" />

          <p className="text-sm font-medium text-gg-gray-400 mb-3">Activity (30 days)</p>
          {!hasSparkline ? (
            <p className="text-sm text-gg-gray-500">No activity yet.</p>
          ) : (
            <Sparkline data={usage.sparkline} />
          )}

          {usage.summary_updated_at && (
            <p className="text-xs text-gg-gray-500 mt-4">
              Data as of {new Date(usage.summary_updated_at).toLocaleString()}
            </p>
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

function Sparkline({ data }: { data: { date: string; requests: number }[] }) {
  const max = Math.max(...data.map(d => d.requests), 1)
  const W = 600, H = 48, gap = 2
  const barW = (W - gap * (data.length - 1)) / data.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = Math.max((d.requests / max) * H, d.requests > 0 ? 2 : 0)
        return <rect key={i} x={i * (barW + gap)} y={H - h} width={barW} height={h} fill="#e91e8c" opacity="0.8" rx="1" />
      })}
    </svg>
  )
}
