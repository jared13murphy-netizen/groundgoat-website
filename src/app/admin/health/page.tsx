'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { ArrowLeft, Activity, Loader2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// Lazy-load the heavy chart-bearing panels so the first paint of the
// Health Monitor isn't gated on Recharts.
const UsageMetricsPanel = dynamic(() => import('@/components/admin/UsageMetricsPanel'), {
  ssr: false,
  loading: () => (
    <div className="card h-32 flex items-center justify-center text-gg-gray-500">
      <Loader2 className="animate-spin mr-2" size={18} /> Loading metrics…
    </div>
  ),
})

const DatabaseStoragePanel = dynamic(() => import('@/components/admin/DatabaseStoragePanel'), {
  ssr: false,
  loading: () => (
    <div className="card mt-6 h-32 flex items-center justify-center text-gg-gray-500">
      <Loader2 className="animate-spin mr-2" size={18} /> Loading database stats…
    </div>
  ),
})

// Service health, Subscriptions, Background Jobs, External APIs — all
// share a single fetch via HealthPanels.
const HealthPanels = dynamic(() => import('@/components/admin/HealthPanels'), {
  ssr: false,
  loading: () => (
    <div className="card mt-6 h-32 flex items-center justify-center text-gg-gray-500">
      <Loader2 className="animate-spin mr-2" size={18} /> Loading health…
    </div>
  ),
})

/**
 * Health Monitor — single ops view for the website + mobile app + Railway
 * Postgres. Today this hosts the Usage Metrics + Regrid + Database Storage
 * panels. Future additions slot in below: service health badges, background-
 * job freshness, external-API health (NASS / Mapbox / Anthropic / Stripe /
 * Resend), subscription health, mobile crash + OTA-version distribution.
 */
export default function HealthMonitorPage() {
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  // Standard admin gate — same shape as the other /admin/* pages.
  useEffect(() => {
    fetchWithAuth(`${API_URL}/api/auth/me`)
      .then(r => r.ok ? r.json() : null)
      .then(u => {
        if (!u || u.account_type !== 'groundgoat_admin') {
          router.replace('/signin')
          return
        }
        setUser(u)
        setLoading(false)
      })
      .catch(() => router.replace('/signin'))
  }, [router])

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center text-gg-gray-400">
        <Loader2 className="animate-spin mr-2" size={20} /> Loading…
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black text-white pt-8 pb-16">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/admin/dashboard"
              className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition"
              aria-label="Back to dashboard"
            >
              <ArrowLeft size={16} className="text-gg-gray-300" />
            </Link>
            <div>
              <h1 className="text-2xl font-display font-bold flex items-center gap-2">
                <Activity size={22} className="text-gg-pink" />
                Health Monitor
              </h1>
              <p className="text-sm text-gg-gray-400 mt-0.5">
                Live ops view for the website, mobile app, and Railway database.
              </p>
            </div>
          </div>
        </div>

        {/* Panels — order is intentional: top-of-funnel monitors at the
            top (service up/down, subscriptions, jobs, external APIs),
            usage + DB-size detail below. */}
        <HealthPanels />
        <UsageMetricsPanel />
        <DatabaseStoragePanel />

        {/* Future additions slotted here: Mobile crash rate + OTA-version
            distribution (needs Sentry or similar — deferred). */}
      </div>
    </div>
  )
}
