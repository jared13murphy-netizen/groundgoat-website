'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowLeft, ShieldCheck, AlertTriangle, AlertCircle, Check, Pencil, MapPin } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface RuleBadge {
  key: string
  label: string
  severity: 'ERROR' | 'WARN'
  desc: string
}
interface TractFlag {
  tract_id: string
  tract_number: number | null
  rules: RuleBadge[]
}
interface FlaggedListing {
  listing_id: string
  title: string | null
  listing_type: string | null
  status: string | null
  county: string | null
  state: string | null
  company_name: string | null
  tract_count: number
  listing_rules: RuleBadge[]
  tracts: TractFlag[]
  error_count: number
  warn_count: number
}

function Badge({ b }: { b: RuleBadge }) {
  const err = b.severity === 'ERROR'
  return (
    <span
      title={b.desc}
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded ${
        err ? 'bg-red-500/15 text-red-400 border border-red-500/30'
            : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
      }`}
    >
      {err ? <AlertCircle size={12} /> : <AlertTriangle size={12} />}
      {b.label}
    </span>
  )
}

export default function AdminAuditPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<FlaggedListing[]>([])
  const [errCount, setErrCount] = useState(0)
  const [warnCount, setWarnCount] = useState(0)
  const [stateFilter, setStateFilter] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [dismissing, setDismissing] = useState<string | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }
    checkAuth()
  }, [router])

  const checkAuth = async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/auth/me`)
      if (!res.ok) throw new Error('unauth')
      const u = await res.json()
      if (u.account_type !== 'groundgoat_admin') { router.push('/account'); return }
      await load()
    } catch {
      router.push('/signin')
    }
  }

  const load = async () => {
    setLoading(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/audit`)
      if (!res.ok) throw new Error('audit fetch failed')
      const data = await res.json()
      setListings(data.listings || [])
      setErrCount(data.error_count || 0)
      setWarnCount(data.warn_count || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const markOk = async (L: FlaggedListing) => {
    if (!confirm(
      `Mark "${L.title || 'this listing'}" OK?\n\nIts current flags will be hidden from this screen. ` +
      `If the listing's data changes later, it will be re-checked automatically.`
    )) return
    setDismissing(L.listing_id)
    try {
      const violations = [
        ...L.listing_rules.map(r => ({ rule_key: r.key, tract_id: null })),
        ...L.tracts.flatMap(t => t.rules.map(r => ({ rule_key: r.key, tract_id: t.tract_id }))),
      ]
      const res = await fetchWithAuth(`${API_URL}/api/admin/audit/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: L.listing_id, violations }),
      })
      if (res.ok) {
        setListings(prev => prev.filter(x => x.listing_id !== L.listing_id))
      } else {
        alert('Failed to mark OK')
      }
    } catch {
      alert('Failed to mark OK')
    } finally {
      setDismissing(null)
    }
  }

  const states = Array.from(new Set(listings.map(l => l.state).filter(Boolean))).sort() as string[]
  const visible = listings.filter(l =>
    (!stateFilter || l.state === stateFilter) &&
    (!errorsOnly || l.error_count > 0)
  )

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-5xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-2">
          <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </Link>
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-gg-pink" size={28} />
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Audit</h1>
              <p className="text-gg-gray-400">
                Verified listings that may have incorrect data — the double-check on the staging process.
              </p>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="flex flex-wrap items-center gap-3 my-6">
          <div className="px-4 py-2 bg-gg-gray-900 border border-gg-gray-800 rounded-lg">
            <span className="text-white font-bold text-lg">{listings.length}</span>
            <span className="text-gg-gray-400 text-sm ml-2">listings flagged</span>
          </div>
          <div className="px-4 py-2 bg-red-500/10 border border-red-500/30 rounded-lg">
            <span className="text-red-400 font-bold text-lg">{errCount}</span>
            <span className="text-red-300/70 text-sm ml-2">errors</span>
          </div>
          <div className="px-4 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <span className="text-amber-400 font-bold text-lg">{warnCount}</span>
            <span className="text-amber-300/70 text-sm ml-2">warnings</span>
          </div>

          <div className="flex-1" />

          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="bg-white border border-gg-gray-300 rounded-lg px-3 py-2 text-black text-sm"
          >
            <option value="">All states</option>
            {states.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm text-gg-gray-300 cursor-pointer select-none">
            <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
            Errors only
          </label>
        </div>

        {/* Flagged listings */}
        {visible.length === 0 ? (
          <div className="text-center py-16">
            <ShieldCheck className="mx-auto text-green-500 mb-4" size={48} />
            <p className="text-white text-lg font-medium">Nothing to review</p>
            <p className="text-gg-gray-400">
              {listings.length === 0
                ? 'Every verified listing passes all audit rules. 🎉'
                : 'No listings match the current filters.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {visible.map(L => (
              <div key={L.listing_id} className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl p-5">
                {/* Top row: company + title + actions */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    {L.company_name && (
                      <p className="text-gg-pink font-semibold text-sm">{L.company_name}</p>
                    )}
                    <h3 className="text-white font-semibold truncate">{L.title || 'Untitled listing'}</h3>
                    <p className="text-gg-gray-400 text-sm flex items-center gap-2 mt-0.5">
                      <MapPin size={14} />
                      {[L.county && `${L.county} County`, L.state].filter(Boolean).join(', ') || '—'}
                      <span className="text-gg-gray-600">·</span>
                      <span className="capitalize">{(L.listing_type || '').replace('_', ' ')}</span>
                      <span className="text-gg-gray-600">·</span>
                      <span className="capitalize">{L.status}</span>
                      <span className="text-gg-gray-600">·</span>
                      {L.tract_count} tract{L.tract_count === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Link
                      href={`/admin/listings/${L.listing_id}`}
                      className="flex items-center gap-1.5 px-3 py-2 bg-white text-gg-black rounded-lg text-sm font-medium hover:bg-gg-gray-200"
                    >
                      <Pencil size={15} /> Edit
                    </Link>
                    <button
                      onClick={() => markOk(L)}
                      disabled={dismissing === L.listing_id}
                      className="flex items-center gap-1.5 px-3 py-2 bg-gg-gray-700 text-white rounded-lg text-sm font-medium hover:bg-gg-gray-600 disabled:opacity-50"
                    >
                      {dismissing === L.listing_id ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
                      Mark OK
                    </button>
                  </div>
                </div>

                {/* Listing-level rules */}
                {L.listing_rules.length > 0 && (
                  <div className="mt-3">
                    <p className="text-gg-gray-500 text-xs uppercase tracking-wide mb-1">Listing</p>
                    <div className="flex flex-wrap gap-2">
                      {L.listing_rules.map(r => <Badge key={r.key} b={r} />)}
                    </div>
                  </div>
                )}

                {/* Per-tract rules */}
                {L.tracts.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {L.tracts.map(t => (
                      <div key={t.tract_id} className="bg-gg-black/40 border border-gg-gray-800 rounded-lg p-3">
                        <p className="text-gg-gray-300 text-xs font-semibold mb-1">
                          Tract {t.tract_number ?? '?'}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {t.rules.map(r => <Badge key={r.key} b={r} />)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
