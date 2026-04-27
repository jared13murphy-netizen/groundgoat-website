'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import { ArrowLeft, Loader2, Database, Download, CheckCircle2, AlertTriangle } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

type ActionState = 'idle' | 'running' | 'done' | 'error'

interface ActionStatus {
  state: ActionState
  message?: string
}

export default function SetupNassPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [migrate, setMigrate] = useState<ActionStatus>({ state: 'idle' })
  const [backfill, setBackfill] = useState<ActionStatus>({ state: 'idle' })

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
    if (!token) {
      router.push('/signin')
      return
    }
    ;(async () => {
      try {
        const r = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!r.ok) throw new Error()
        const u = await r.json()
        if (u.account_type !== 'groundgoat_admin') {
          router.push('/account')
          return
        }
        setAuthChecked(true)
      } catch {
        router.push('/signin')
      }
    })()
  }, [router])

  const runMigration = async () => {
    setMigrate({ state: 'running' })
    try {
      const r = await fetchWithAuth(`${API_URL}/api/admin/migrate-nass-boundary`, {
        method: 'POST',
      })
      const data = await r.json()
      if (!r.ok || data.success === false) {
        setMigrate({ state: 'error', message: data.error || data.detail || `HTTP ${r.status}` })
      } else {
        setMigrate({ state: 'done', message: data.message || 'Migration applied.' })
      }
    } catch (e: any) {
      setMigrate({ state: 'error', message: e.message || 'Network error' })
    }
  }

  const runBackfill = async () => {
    setBackfill({ state: 'running' })
    try {
      const r = await fetchWithAuth(`${API_URL}/api/admin/backfill-nass?years=5`, {
        method: 'POST',
      })
      const data = await r.json()
      if (!r.ok || data.success === false) {
        setBackfill({ state: 'error', message: data.error || data.detail || `HTTP ${r.status}` })
      } else {
        setBackfill({ state: 'done', message: data.message || 'Backfill started.' })
      }
    } catch (e: any) {
      setBackfill({ state: 'error', message: e.message || 'Network error' })
    }
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gg-gray-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-white" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-gray-950 pt-24 pb-12">
      <div className="max-w-3xl mx-auto px-6">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-2 text-gg-gray-400 hover:text-white mb-6"
        >
          <ArrowLeft size={18} /> Admin dashboard
        </Link>

        <h1 className="text-3xl font-bold text-white mb-2">Set up Ground Truth (USDA NASS)</h1>
        <p className="text-gg-gray-400 mb-8">
          Two-step setup: apply the schema migration, then backfill data. Both endpoints are
          idempotent — safe to re-run.
        </p>

        {/* ---------- 1. Schema migration ---------- */}
        <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-6 mb-6">
          <div className="flex items-start gap-4">
            <Database className="text-gg-pink mt-1 flex-shrink-0" size={24} />
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-white">1. Schema migration</h2>
              <p className="text-gg-gray-400 text-sm mt-2">
                Adds 4 nullable boundary-tracking columns to the <code className="text-gg-pink">tracts</code> table
                (boundary_source, boundary_drawn_by, boundary_drawn_at, acres_from_polygon) and creates 3 new tables
                (nass_county_yields, nass_county_rent, nass_state_landvalue).
              </p>
              <p className="text-gg-gray-500 text-xs mt-2">
                Run this <strong>before</strong> the backfill. Uses ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.
              </p>
              <button
                onClick={runMigration}
                disabled={migrate.state === 'running'}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50"
              >
                {migrate.state === 'running' && <Loader2 className="animate-spin" size={16} />}
                {migrate.state === 'running' ? 'Running…' : 'Run schema migration'}
              </button>
              {migrate.state === 'done' && (
                <div className="mt-3 flex items-center gap-2 text-green-400 text-sm">
                  <CheckCircle2 size={16} /> {migrate.message}
                </div>
              )}
              {migrate.state === 'error' && (
                <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
                  <AlertTriangle size={16} /> {migrate.message}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---------- 2. NASS backfill ---------- */}
        <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <Download className="text-gg-pink mt-1 flex-shrink-0" size={24} />
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-white">2. NASS data backfill (5 years)</h2>
              <p className="text-gg-gray-400 text-sm mt-2">
                Pulls 5 years of county yields (corn/soy/wheat/hay), county cash rent, and state
                land values from USDA Quick Stats for IA, IL, IN, KS, MI, MN, MO, NE, ND, OH, SD, WI.
                Runs in the background — takes 3–7 minutes.
              </p>
              <p className="text-gg-gray-500 text-xs mt-2">
                Requires <code className="text-gg-pink">NASS_API_KEY</code> env var on the backend.
                Run the schema migration first.
              </p>
              <button
                onClick={runBackfill}
                disabled={backfill.state === 'running'}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50"
              >
                {backfill.state === 'running' && <Loader2 className="animate-spin" size={16} />}
                {backfill.state === 'running' ? 'Starting…' : 'Run NASS backfill'}
              </button>
              {backfill.state === 'done' && (
                <div className="mt-3 flex items-center gap-2 text-green-400 text-sm">
                  <CheckCircle2 size={16} /> {backfill.message}
                </div>
              )}
              {backfill.state === 'error' && (
                <div className="mt-3 flex items-center gap-2 text-red-400 text-sm">
                  <AlertTriangle size={16} /> {backfill.message}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="text-xs text-gg-gray-500 mt-8">
          After backfill completes, open any listing detail page — the &quot;Ground Truth&quot;
          section at the bottom shows USDA NASS county/state benchmarks for that location.
        </div>
      </div>
    </div>
  )
}
