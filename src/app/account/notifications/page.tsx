'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Bell, ChevronDown, ChevronUp, Check, Loader2 } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CatalogEntry {
  category: string
  label: string
  description: string | null
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

interface GeoState {
  stateId: number
  abbrev: string
  name: string
}

interface MutedEntry {
  state: string
  county: string
}

interface GeoResponse {
  states: GeoState[]
  muted: MutedEntry[]
}

interface County {
  id: number
  name: string
}

// Per-row save state for preference toggles: idle | saving | saved | error
type RowState = 'idle' | 'saving' | 'saved' | 'error'

// Per-county save state: idle | saving | error
type CountyRowState = 'idle' | 'saving' | 'error'

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

// ─── Preference row ───────────────────────────────────────────────────────────

function PrefRow({
  entry,
  isLast,
  locked,
  value,
  rowState,
  onToggle,
}: {
  entry: CatalogEntry
  isLast: boolean
  locked: boolean
  value: boolean
  rowState: RowState
  onToggle: () => void
}) {
  const isSaving = rowState === 'saving'

  if (locked) {
    return (
      <div
        className={`flex items-center justify-between py-4 ${isLast ? '' : 'border-b border-gg-gray-700'}`}
      >
        <div className="flex-1 pr-4 min-w-0">
          <span className="text-sm font-medium text-white">{entry.label}</span>
          {entry.description && (
            <p className="text-xs text-gg-gray-400 mt-0.5">{entry.description}</p>
          )}
        </div>
        <span className="text-xs text-gg-gray-500 whitespace-nowrap bg-gg-gray-700 px-2 py-1 rounded-full">
          Always on
        </span>
      </div>
    )
  }

  return (
    <div
      className={`flex items-center justify-between py-4 ${isLast ? '' : 'border-b border-gg-gray-700'}`}
    >
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
              onClick={onToggle}
              disabled={isSaving}
              className="text-xs text-red-400 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Could not save. Tap to try again.
            </button>
          )}
        </div>
        {entry.description && (
          <p className="text-xs text-gg-gray-400 mt-0.5">{entry.description}</p>
        )}
      </div>
      <Toggle value={value} disabled={isSaving} onChange={onToggle} />
    </div>
  )
}

// ─── Channel sub-section ──────────────────────────────────────────────────────

function ChannelSection({
  title,
  channel,
  catalog,
  prefs,
  lockedSet,
  rowStates,
  loading,
  onToggle,
}: {
  title: string
  channel: 'email' | 'push'
  catalog: CatalogEntry[]
  prefs: Record<string, boolean>
  lockedSet: Set<string>
  // rowStates keyed by `${channel}:${category}`
  rowStates: Record<string, RowState>
  loading: boolean
  onToggle: (category: string, channel: string) => void
}) {
  if (!loading && catalog.length === 0) return null

  return (
    <div className="mb-6">
      <h3 className="text-xs font-semibold text-gg-gray-400 uppercase tracking-wider mb-4">
        {title}
      </h3>
      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow last />
        </>
      ) : (
        catalog.map((entry, idx) => {
          const isLast = idx === catalog.length - 1
          const locked = lockedSet.has(entry.category)
          const value = prefs[entry.category] ?? true
          const rowStateKey = `${channel}:${entry.category}`
          const rowState = rowStates[rowStateKey] ?? 'idle'
          return (
            <PrefRow
              key={entry.category}
              entry={entry}
              isLast={isLast}
              locked={locked}
              value={value}
              rowState={rowState}
              onToggle={() => onToggle(entry.category, channel)}
            />
          )
        })
      )}
    </div>
  )
}

// ─── State accordion ──────────────────────────────────────────────────────────

function StateAccordion({
  state,
  mutedForState,
  autoExpand,
}: {
  state: GeoState
  mutedForState: Set<string>
  autoExpand: boolean
}) {
  const [open, setOpen] = useState(autoExpand)
  const [counties, setCounties] = useState<County[] | null>(null)
  const [loadingCounties, setLoadingCounties] = useState(false)
  const [countyError, setCountyError] = useState(false)
  const [search, setSearch] = useState('')
  // Per-county muted state (local mirror)
  const [muted, setMuted] = useState<Set<string>>(new Set(mutedForState))
  // Per-county save state
  const [countyStates, setCountyStates] = useState<Record<string, CountyRowState>>({})
  // In-flight guard per county name
  const inFlight = useRef<Set<string>>(new Set())
  // Error messages per county
  const [countyErrors, setCountyErrors] = useState<Record<string, string>>({})

  // Load counties on first expand
  const loadCounties = useCallback(async () => {
    if (counties !== null) return // already cached
    setLoadingCounties(true)
    setCountyError(false)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/states/${state.stateId}/counties`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: County[] = await res.json()
      setCounties(data)
    } catch {
      setCountyError(true)
    } finally {
      setLoadingCounties(false)
    }
  // `counties` is intentionally omitted: the early-return guard (`if (counties !== null) return`)
  // reads the state at call time via the closure captured inside the async body,
  // so including it in the dep array would recreate the callback on every county load
  // without changing behavior. The guard itself is what prevents duplicate fetches.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.stateId])

  const handleToggle = useCallback(() => {
    const next = !open
    setOpen(next)
    if (next && counties === null) {
      loadCounties()
    }
  }, [open, counties, loadCounties])

  // Auto-expand on mount if requested
  useEffect(() => {
    if (autoExpand && counties === null) {
      loadCounties()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCountyToggle = async (countyName: string) => {
    if (inFlight.current.has(countyName)) return
    inFlight.current.add(countyName)

    const currentlyMuted = muted.has(countyName)
    const newMuted = !currentlyMuted // toggling ON means unmuting; toggling OFF means muting

    // Optimistic update
    setMuted((prev) => {
      const next = new Set(prev)
      if (newMuted) {
        next.add(countyName)
      } else {
        next.delete(countyName)
      }
      return next
    })
    setCountyStates((prev) => ({ ...prev, [countyName]: 'saving' }))
    setCountyErrors((prev) => {
      const next = { ...prev }
      delete next[countyName]
      return next
    })

    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-geo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: state.abbrev,
          county: countyName,
          muted: newMuted,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setCountyStates((prev) => ({ ...prev, [countyName]: 'idle' }))
    } catch {
      // Revert
      setMuted((prev) => {
        const next = new Set(prev)
        if (newMuted) {
          next.delete(countyName)
        } else {
          next.add(countyName)
        }
        return next
      })
      setCountyStates((prev) => ({ ...prev, [countyName]: 'error' }))
      setCountyErrors((prev) => ({ ...prev, [countyName]: 'Could not save. Try again.' }))
    } finally {
      inFlight.current.delete(countyName)
    }
  }

  const handleSelectAll = () => {
    if (!counties) return
    // Snapshot which counties need to change NOW (currently muted → unmute).
    // Using muted directly here is safe — we only read the snapshot to build
    // the work list; each county's own PUT+revert uses functional setState.
    const toUnmute = counties.filter((c) => muted.has(c.name) && !inFlight.current.has(c.name))
    for (const county of toUnmute) {
      const countyName = county.name
      if (inFlight.current.has(countyName)) continue
      inFlight.current.add(countyName)

      // Optimistic: unmute this county
      setMuted((prev) => {
        const next = new Set(prev)
        next.delete(countyName)
        return next
      })
      setCountyStates((prev) => ({ ...prev, [countyName]: 'saving' }))
      setCountyErrors((prev) => {
        const next = { ...prev }
        delete next[countyName]
        return next
      })

      fetchWithAuth(`${API_URL}/api/me/notification-geo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: state.abbrev, county: countyName, muted: false }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          setCountyStates((prev) => ({ ...prev, [countyName]: 'idle' }))
        })
        .catch(() => {
          // Revert only this county
          setMuted((prev) => {
            const next = new Set(prev)
            next.add(countyName)
            return next
          })
          setCountyStates((prev) => ({ ...prev, [countyName]: 'error' }))
          setCountyErrors((prev) => ({ ...prev, [countyName]: 'Could not save. Try again.' }))
        })
        .finally(() => {
          inFlight.current.delete(countyName)
        })
    }
  }

  const handleClearAll = () => {
    if (!counties) return
    // Snapshot which counties need to change NOW (currently unmuted → mute).
    const toMute = counties.filter((c) => !muted.has(c.name) && !inFlight.current.has(c.name))
    for (const county of toMute) {
      const countyName = county.name
      if (inFlight.current.has(countyName)) continue
      inFlight.current.add(countyName)

      // Optimistic: mute this county
      setMuted((prev) => {
        const next = new Set(prev)
        next.add(countyName)
        return next
      })
      setCountyStates((prev) => ({ ...prev, [countyName]: 'saving' }))
      setCountyErrors((prev) => {
        const next = { ...prev }
        delete next[countyName]
        return next
      })

      fetchWithAuth(`${API_URL}/api/me/notification-geo`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: state.abbrev, county: countyName, muted: true }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          setCountyStates((prev) => ({ ...prev, [countyName]: 'idle' }))
        })
        .catch(() => {
          // Revert only this county
          setMuted((prev) => {
            const next = new Set(prev)
            next.delete(countyName)
            return next
          })
          setCountyStates((prev) => ({ ...prev, [countyName]: 'error' }))
          setCountyErrors((prev) => ({ ...prev, [countyName]: 'Could not save. Try again.' }))
        })
        .finally(() => {
          inFlight.current.delete(countyName)
        })
    }
  }

  const filteredCounties = counties
    ? counties.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : []

  const countyCount = counties ? counties.length : null

  return (
    <div className="border border-gg-gray-700 rounded-xl overflow-hidden mb-3">
      {/* Accordion header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center justify-between px-5 py-4 bg-gg-gray-800 hover:bg-gg-gray-700 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{state.name}</span>
          {countyCount !== null && (
            <span className="text-xs text-gg-gray-400">
              ({countyCount} {countyCount === 1 ? 'county' : 'counties'})
            </span>
          )}
          {loadingCounties && <Loader2 size={14} className="animate-spin text-gg-pink" />}
        </div>
        {open ? (
          <ChevronUp size={16} className="text-gg-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown size={16} className="text-gg-gray-400 flex-shrink-0" />
        )}
      </button>

      {/* Accordion body */}
      {open && (
        <div className="bg-gg-gray-900 px-5 py-4">
          {countyError ? (
            <div className="flex items-center justify-between">
              <p className="text-sm text-red-400">Failed to load counties.</p>
              <button
                onClick={() => {
                  setCountyError(false)
                  loadCounties()
                }}
                className="text-sm text-gg-pink hover:underline"
              >
                Try again
              </button>
            </div>
          ) : loadingCounties ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className="animate-spin text-gg-pink" />
            </div>
          ) : counties !== null && counties.length === 0 ? (
            <p className="text-sm text-gg-gray-400">No counties available for this state.</p>
          ) : counties !== null ? (
            <>
              {/* Search + Select all / Clear all */}
              <div className="mb-3 space-y-2">
                <input
                  type="text"
                  placeholder="Search counties…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                />
                <div className="flex gap-3">
                  <button
                    onClick={handleSelectAll}
                    className="text-xs text-gg-pink hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    onClick={handleClearAll}
                    className="text-xs text-gg-gray-400 hover:text-white hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              </div>

              {/* County list */}
              {filteredCounties.length === 0 ? (
                <p className="text-sm text-gg-gray-400 py-2">No counties match.</p>
              ) : (
                <div className="max-h-72 overflow-y-auto -mx-5 px-5 space-y-0">
                  {filteredCounties.map((county, idx) => {
                    const isLast = idx === filteredCounties.length - 1
                    const isMuted = muted.has(county.name)
                    const isOn = !isMuted
                    const cState = countyStates[county.name] ?? 'idle'
                    const isSaving = cState === 'saving'
                    const errMsg = countyErrors[county.name]

                    return (
                      <div
                        key={county.id}
                        className={`flex items-center justify-between py-3 ${isLast ? '' : 'border-b border-gg-gray-800'}`}
                      >
                        <div className="flex-1 pr-4 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-white">{county.name}</span>
                            {errMsg && (
                              <span className="text-xs text-red-400">{errMsg}</span>
                            )}
                          </div>
                        </div>
                        <Toggle
                          value={isOn}
                          disabled={isSaving}
                          onChange={() => handleCountyToggle(county.name)}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const router = useRouter()

  // ── Prefs state ─────────────────────────────────────────────────────────────
  const [prefsLoading, setPrefsLoading] = useState(true)
  const [prefsFetchError, setPrefsFetchError] = useState(false)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  // Local mirror: `${channel}:${category}` → enabled
  const [prefs, setPrefs] = useState<Record<string, boolean>>({})
  // Per-row UI state keyed by `${channel}:${category}`
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({})
  // Set of `${channel}:${category}` that are locked
  const [lockedKeys, setLockedKeys] = useState<Set<string>>(new Set())
  // Timeout IDs for "Saved" indicator — cleared on unmount
  const savedTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // In-flight guard keyed by `${channel}:${category}`
  const inFlight = useRef<Set<string>>(new Set())

  // ── Geo state ────────────────────────────────────────────────────────────────
  const [geoLoading, setGeoLoading] = useState(true)
  const [geoFetchError, setGeoFetchError] = useState(false)
  const [geoStates, setGeoStates] = useState<GeoState[]>([])
  const [geoMuted, setGeoMuted] = useState<MutedEntry[]>([])
  // Whether the user has location-enabled categories (determines if we even call geo)
  const [hasLocationCategories, setHasLocationCategories] = useState(false)

  // ── Load prefs ───────────────────────────────────────────────────────────────

  const loadPrefs = useCallback(async () => {
    setPrefsLoading(true)
    setPrefsFetchError(false)

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

      const prefMap: Record<string, boolean> = {}
      const locked = new Set<string>()
      for (const p of data.preferences) {
        const key = `${p.channel}:${p.category}`
        prefMap[key] = p.enabled
        if (p.locked) locked.add(key)
      }
      setPrefs(prefMap)
      setLockedKeys(locked)
      setRowStates({})

      // Determine if user has any location-gated categories in the catalog
      // (i.e. categories that appear with push channel — location alerts require subscription)
      // We gate the geo section: only show it if the user has push prefs returned.
      const hasPush = data.preferences.some((p) => p.channel === 'push')
      setHasLocationCategories(hasPush)
    } catch {
      setPrefsFetchError(true)
    } finally {
      setPrefsLoading(false)
    }
  }, [router])

  // ── Load geo ─────────────────────────────────────────────────────────────────

  const loadGeo = useCallback(async () => {
    setGeoLoading(true)
    setGeoFetchError(false)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-geo`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data: GeoResponse = await res.json()
      setGeoStates(data.states.sort((a, b) => a.name.localeCompare(b.name)))
      setGeoMuted(data.muted)
    } catch {
      setGeoFetchError(true)
    } finally {
      setGeoLoading(false)
    }
  }, [])

  // ── Bootstrap ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    loadPrefs()
  }, [router, loadPrefs])

  // Start geo load once we know the user has push prefs (location categories)
  useEffect(() => {
    if (hasLocationCategories) {
      loadGeo()
    } else if (!prefsLoading) {
      // Prefs loaded and no push categories — skip geo entirely
      setGeoLoading(false)
    }
  }, [hasLocationCategories, prefsLoading, loadGeo])

  // Clear all pending "Saved" timers on unmount
  useEffect(() => {
    const timers = savedTimers.current
    return () => {
      for (const id of Object.values(timers)) clearTimeout(id)
    }
  }, [])

  // ── Save single preference ────────────────────────────────────────────────────

  const handleToggle = async (category: string, channel: string) => {
    // rowState and inFlight both keyed by `${channel}:${category}` to avoid
    // cross-channel collision when a category appears in both email and push.
    const key = `${channel}:${category}`
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)

    const newValue = !prefs[key]

    // Optimistic update
    setPrefs((prev) => ({ ...prev, [key]: newValue }))
    setRowStates((prev) => ({ ...prev, [key]: 'saving' }))

    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: [{ channel, category, enabled: newValue }],
        }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      // Re-read canonical state from server response
      const data: PrefsResponse = await res.json()
      const prefMap: Record<string, boolean> = {}
      const newLocked = new Set<string>()
      for (const p of data.preferences) {
        const k = `${p.channel}:${p.category}`
        prefMap[k] = p.enabled
        if (p.locked) newLocked.add(k)
      }
      setPrefs(prefMap)
      setLockedKeys(newLocked)

      setRowStates((prev) => ({ ...prev, [key]: 'saved' }))

      if (savedTimers.current[key]) clearTimeout(savedTimers.current[key])
      savedTimers.current[key] = setTimeout(() => {
        setRowStates((prev) => {
          if (prev[key] === 'saved') return { ...prev, [key]: 'idle' }
          return prev
        })
      }, 2000)
    } catch {
      setPrefs((prev) => ({ ...prev, [key]: !newValue }))
      setRowStates((prev) => ({ ...prev, [key]: 'error' }))
    } finally {
      inFlight.current.delete(key)
    }
  }

  // ── Derived: split catalog by channel ────────────────────────────────────────

  const emailCatalog = catalog.filter((c) => c.channels.includes('email'))
  const pushCatalog = catalog.filter((c) => c.channels.includes('push'))

  // Build per-channel locked sets (just the category string, not the composite key)
  const emailLockedSet = new Set(
    Array.from(lockedKeys)
      .filter((k) => k.startsWith('email:'))
      .map((k) => k.slice('email:'.length)),
  )
  const pushLockedSet = new Set(
    Array.from(lockedKeys)
      .filter((k) => k.startsWith('push:'))
      .map((k) => k.slice('push:'.length)),
  )

  // Build per-channel prefs maps (just the category portion as key)
  const emailPrefs: Record<string, boolean> = {}
  const pushPrefs: Record<string, boolean> = {}
  for (const [key, val] of Object.entries(prefs)) {
    if (key.startsWith('email:')) emailPrefs[key.slice('email:'.length)] = val
    else if (key.startsWith('push:')) pushPrefs[key.slice('push:'.length)] = val
  }

  // rowStates is keyed by `${channel}:${category}` — the same composite key used by
  // prefs/lockedKeys/inFlight. ChannelSection receives the full map and looks up each
  // entry by `${channel}:${entry.category}`, so email and push rows never share state.

  // ── Loading state ─────────────────────────────────────────────────────────────

  const isFullPageLoading = prefsLoading || (hasLocationCategories && geoLoading)

  if (isFullPageLoading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  const showGeoSection = hasLocationCategories && !geoFetchError && geoStates.length > 0
  const autoExpandSingleState = geoStates.length === 1

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
            <div className="flex items-center gap-2">
              <Bell size={20} className="text-gg-pink" />
              <h1 className="font-display text-3xl font-bold text-white">Notifications</h1>
            </div>
            <p className="text-gg-gray-400">Choose what you hear about and how</p>
          </div>
        </div>

        {/* Full-page fetch error (prefs failed) */}
        {prefsFetchError && (
          <div className="card mb-6">
            <p className="text-sm text-red-400 mb-3">Could not load notification preferences.</p>
            <button onClick={loadPrefs} className="text-sm text-gg-pink hover:underline">
              Try again
            </button>
          </div>
        )}

        {/* Geo error banner (prefs ok, geo failed) */}
        {!prefsFetchError && hasLocationCategories && geoFetchError && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4 flex items-center justify-between">
            <p className="text-sm text-red-400">
              Could not load alert location settings.
            </p>
            <button
              onClick={loadGeo}
              className="text-sm text-gg-pink hover:underline whitespace-nowrap ml-4"
            >
              Try again
            </button>
          </div>
        )}

        {/* Section 1: Category toggles */}
        {!prefsFetchError && (
          <div className="card mb-6">
            <ChannelSection
              title="Email notifications"
              channel="email"
              catalog={emailCatalog}
              prefs={emailPrefs}
              lockedSet={emailLockedSet}
              rowStates={rowStates}
              loading={prefsLoading}
              onToggle={handleToggle}
            />
            <ChannelSection
              title="Push notifications"
              channel="push"
              catalog={pushCatalog}
              prefs={pushPrefs}
              lockedSet={pushLockedSet}
              rowStates={rowStates}
              loading={prefsLoading}
              onToggle={handleToggle}
            />
          </div>
        )}

        {/* Section 2: Alert locations (county filter) */}
        {showGeoSection && (
          <div className="card">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-white mb-1">Alert locations</h2>
              <p className="text-xs text-gg-gray-400">
                All counties in your subscribed states are on by default — turn off any county you
                don&apos;t want alerts for.
              </p>
            </div>

            {geoStates.map((state) => {
              const mutedForState = new Set(
                geoMuted.filter((m) => m.state === state.abbrev).map((m) => m.county),
              )
              return (
                <StateAccordion
                  key={state.stateId}
                  state={state}
                  mutedForState={mutedForState}
                  autoExpand={autoExpandSingleState}
                />
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
