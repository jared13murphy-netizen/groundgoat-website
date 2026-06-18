'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CatalogEntry {
  category: string
  label: string
  description: string
  channels: string[]
  tier: 'optional' | 'transactional'
}

interface Preference {
  channel: 'email' | 'push'
  category: string
  enabled: boolean
  locked: boolean
}

interface PrefsResponse {
  catalog: CatalogEntry[]
  preferences: Preference[]
}

// Per-row save state: idle | saving | saved | error
type RowState = 'idle' | 'saving' | 'saved' | 'error'

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({
  value,
  disabled,
  onChange,
}: {
  value: boolean
  disabled: boolean
  onChange: () => void
}) {
  return (
    // Outer wrapper gives the 44×44 minimum tap target
    <div className="flex items-center justify-center min-w-[44px] min-h-[44px]">
      <button
        role="switch"
        aria-checked={value}
        onClick={onChange}
        disabled={disabled}
        className={[
          'relative w-10 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gg-pink',
          value ? 'bg-gg-pink' : 'bg-gg-gray-600',
          disabled ? 'opacity-50 pointer-events-none' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200',
            value ? 'translate-x-4' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

function SkeletonRow({ last = false }: { last?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between py-4 ${last ? '' : 'border-b border-gg-gray-700'}`}
    >
      <div className="flex-1 space-y-2 pr-4">
        <div className="h-4 w-32 bg-gg-gray-700 animate-pulse rounded" />
        <div className="h-3 w-56 bg-gg-gray-700 animate-pulse rounded" />
      </div>
      <div className="w-10 h-6 bg-gg-gray-700 animate-pulse rounded-full" />
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  // Local mirror of email preferences (channel === 'email')
  const [prefs, setPrefs] = useState<Record<string, boolean>>({})
  // Per-row UI state
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({})
  // Track which categories have locked === true (must not render as a toggle)
  const [lockedCategories, setLockedCategories] = useState<Set<string>>(new Set())
  // Timeout IDs for "Saved" indicator — cleared on unmount to avoid setState-after-unmount
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // Synchronous in-flight guard — prevents two concurrent PUTs for the same category
  // regardless of React render timing (ref reads are always current, unlike state).
  const inFlight = useRef<Set<string>>(new Set())

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadPrefs = useCallback(async () => {
    setLoading(true)
    setFetchError(false)

    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }

    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-preferences`)
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/signin')
          return
        }
        throw new Error(`HTTP ${res.status}`)
      }

      const data: PrefsResponse = await res.json()
      setCatalog(data.catalog)

      // Build a map: category → enabled, for email channel only
      const emailPrefs: Record<string, boolean> = {}
      const locked = new Set<string>()
      for (const p of data.preferences) {
        if (p.channel === 'email') {
          emailPrefs[p.category] = p.enabled
          if (p.locked) locked.add(p.category)
        }
      }
      setPrefs(emailPrefs)
      setLockedCategories(locked)
      setRowStates({})
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    loadPrefs()
  }, [router, loadPrefs])

  // Clear all pending "Saved" timers when the component unmounts (MEDIUM 4)
  useEffect(() => {
    const timers = savedTimers.current
    return () => {
      for (const id of Object.values(timers)) {
        clearTimeout(id)
      }
    }
  }, [])

  // ── Save single preference ────────────────────────────────────────────────

  const handleToggle = async (category: string) => {
    // HIGH: synchronous ref-based guard — immune to React's deferred state updates.
    // Two rapid calls both read the ref synchronously; the second returns before any await.
    if (inFlight.current.has(category)) return
    inFlight.current.add(category)

    const newValue = !prefs[category]

    // Optimistic update
    setPrefs((prev) => ({ ...prev, [category]: newValue }))
    setRowStates((prev) => ({ ...prev, [category]: 'saving' }))

    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: [{ channel: 'email', category, enabled: newValue }],
        }),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      // Re-read the canonical state from the server response
      const data: PrefsResponse = await res.json()
      const emailPrefs: Record<string, boolean> = {}
      // MEDIUM: also rebuild lockedCategories from the PUT response so a server-side
      // lock flip is reflected immediately (prevents a stale toggle causing a future 400).
      const newLocked = new Set<string>()
      for (const p of data.preferences) {
        if (p.channel === 'email') {
          emailPrefs[p.category] = p.enabled
          if (p.locked) newLocked.add(p.category)
        }
      }
      setPrefs(emailPrefs)
      setLockedCategories(newLocked)

      setRowStates((prev) => ({ ...prev, [category]: 'saved' }))

      // Clear "Saved" indicator after 2 s (store timer ID so it can be cancelled on unmount)
      if (savedTimers.current[category]) clearTimeout(savedTimers.current[category])
      savedTimers.current[category] = setTimeout(() => {
        setRowStates((prev) => {
          if (prev[category] === 'saved') return { ...prev, [category]: 'idle' }
          return prev
        })
      }, 2000)
    } catch {
      // Revert optimistic update
      setPrefs((prev) => ({ ...prev, [category]: !newValue }))
      setRowStates((prev) => ({ ...prev, [category]: 'error' }))
    } finally {
      // Always release the in-flight lock — even if fetch throws — so the row
      // becomes retryable. Does NOT touch rowState (already set to 'saved'/'error').
      inFlight.current.delete(category)
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

  const emailCatalog = catalog.filter((c) => c.channels.includes('email'))
  // MEDIUM 3: exclude locked categories — they belong in the always-on section even if
  // the catalog lists them as optional. A server-side lock flip must be respected immediately.
  const optionalCategories = emailCatalog.filter(
    (c) => c.tier === 'optional' && !lockedCategories.has(c.category),
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-2xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/account"
            className="w-10 h-10 bg-gg-gray-800 rounded-lg flex items-center justify-center text-gg-gray-400 hover:text-white hover:bg-gg-gray-700 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Notifications</h1>
            <p className="text-gg-gray-400">Choose which emails you receive</p>
          </div>
        </div>

        {/* Full-page fetch error */}
        {fetchError && !loading && (
          <div className="card mb-6">
            <p className="text-sm text-red-400 mb-3">Could not load preferences.</p>
            <button
              onClick={loadPrefs}
              className="text-sm text-gg-pink hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Card: Email Notifications (optional) */}
        <div className="bg-gg-gray-800 rounded-2xl p-6 border border-gg-gray-700 mb-6">
          <h2 className="text-lg font-semibold text-white mb-1">Email Notifications</h2>
          <p className="text-xs text-gg-gray-400 mb-4">
            Turn off any email type you no longer want to receive.
          </p>

          {loading ? (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow last />
            </>
          ) : optionalCategories.length === 0 ? (
            <p className="text-sm text-gg-gray-400">No optional email preferences at this time.</p>
          ) : (
            optionalCategories.map((entry, idx) => {
              const isLast = idx === optionalCategories.length - 1
              const rowState = rowStates[entry.category] ?? 'idle'
              const isSaving = rowState === 'saving'
              const currentValue = prefs[entry.category] ?? true

              return (
                <div
                  key={entry.category}
                  className={`flex items-center justify-between py-4 ${isLast ? '' : 'border-b border-gg-gray-700'}`}
                >
                  {/* Left: label + helper + inline feedback */}
                  <div className="flex-1 pr-4 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{entry.label}</span>
                      {rowState === 'saved' && (
                        <span className="flex items-center gap-1 text-xs text-green-400">
                          <Check size={12} />
                          Saved
                        </span>
                      )}
                      {rowState === 'error' && (
                        <button
                          onClick={() => handleToggle(entry.category)}
                          disabled={isSaving}
                          className="text-xs text-red-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Could not save. Tap to try again.
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-gg-gray-400 mt-0.5">{entry.description}</p>
                  </div>

                  {/* Right: toggle */}
                  <Toggle
                    value={currentValue}
                    disabled={isSaving}
                    onChange={() => handleToggle(entry.category)}
                  />
                </div>
              )
            })
          )}
        </div>

        {/* Card: Account emails (transactional / always-on) */}
        <div className="bg-gg-gray-800 rounded-2xl p-6 border border-gg-gray-700">
          <h2 className="text-lg font-semibold text-white mb-1">Account emails</h2>
          <p className="text-xs text-gg-gray-400 mb-4">
            Required emails tied to your account activity.
          </p>

          {loading ? (
            <SkeletonRow last />
          ) : (
            <div className="flex items-center justify-between py-4">
              <div className="flex-1 pr-4 min-w-0">
                <span className="text-sm font-medium text-white">Transactional</span>
                <p className="text-xs text-gg-gray-400 mt-0.5">
                  Sign-in links, payment confirmations, billing notices, and receipts. These are
                  always sent.
                </p>
              </div>
              <span className="text-xs text-gg-gray-500 whitespace-nowrap">Always on</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
