'use client'

// Notifications settings — same shape as the app's screen (owner 10/2: "the
// website and app need to have the same push notification capabilities"):
//   1. Push notifications master switch
//   2. My counties — one row per subscribed state, opens a county picker
//      (checked = alerts on; nothing saved until Save)
//   3. What to send me — the four core switches
//   4. More options — the full per-category email + push lists, collapsed
// Endpoints are the ones the app uses: /api/me/notification-preferences,
// /api/me/notification-geo, /api/states/{id}/counties.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Bell, ChevronDown, ChevronUp, ChevronRight, Loader2, Search, X } from 'lucide-react'

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

interface PrefChange {
  channel: 'email' | 'push'
  category: string
  enabled: boolean
}

// The four simple switches. Keys match the server catalog
// (notification_catalog.py); labels are the fallback if a key ever changes.
const CORE_CATEGORIES = [
  { category: 'new_listings', label: 'New listings' },
  { category: 'auction_reminders', label: 'Auction reminders' },
  { category: 'results', label: 'Auction results' },
  { category: 'weekly_recap', label: 'Weekly Recap' },
]


const prefKey = (p: { channel: string; category: string }) => `${p.channel}:${p.category}`

// ─── Toggle ──────────────────────────────────────────────────────────────────

function Toggle({ value, disabled, onChange }: { value: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-center min-w-[44px] min-h-[44px]">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={onChange}
        disabled={disabled}
        className={[
          'relative w-11 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gg-pink',
          value ? 'bg-gg-pink' : 'bg-gg-gray-600',
          disabled ? 'opacity-50 pointer-events-none' : '',
        ].filter(Boolean).join(' ')}
      >
        <span
          className={[
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200',
            value ? 'translate-x-5' : 'translate-x-0',
          ].join(' ')}
        />
      </button>
    </div>
  )
}

// ─── Preference row ───────────────────────────────────────────────────────────

function PrefRow({
  label,
  description,
  isLast,
  locked,
  value,
  busy,
  onToggle,
}: {
  label: string
  description?: string | null
  isLast: boolean
  locked: boolean
  value: boolean
  busy: boolean
  onToggle: () => void
}) {
  return (
    <div className={`flex items-center justify-between py-3.5 ${isLast ? '' : 'border-b border-gg-gray-700'}`}>
      <div className="flex-1 pr-4 min-w-0">
        <span className="text-sm font-medium text-white">{label}</span>
        {description && <p className="text-xs text-gg-gray-400 mt-0.5">{description}</p>}
      </div>
      {locked ? (
        <span className="text-xs text-gg-gray-400 whitespace-nowrap bg-gg-gray-700 px-2 py-1 rounded-full">
          Always on
        </span>
      ) : (
        <Toggle value={value} disabled={busy} onChange={onToggle} />
      )}
    </div>
  )
}

// ─── County picker (modal) ────────────────────────────────────────────────────
//
// Checked = alerts ON = NOT muted. Nothing is written until Save; Save sends
// ONE PUT /api/me/notification-geo/state with the state's full muted list.

function CountyPicker({
  state,
  counties,
  mutedSet,
  onClose,
  onSaved,
  onReload,
}: {
  state: GeoState
  counties: County[] | null | undefined
  mutedSet: Set<string>
  onClose: () => void
  onSaved: (abbrev: string, nextMuted: Set<string>) => void
  onReload: () => void
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const mutedRef = useRef(mutedSet)
  mutedRef.current = mutedSet

  useEffect(() => {
    if (counties) {
      setChecked(new Set(counties.filter((c) => !mutedRef.current.has(c.name)).map((c) => c.name)))
      setSearch('')
      setSaveError(null)
    }
  }, [state.abbrev, counties])

  // Escape closes, like the app's back button.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const toggle = useCallback((name: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }, [])

  const visible = useMemo(() => {
    if (!counties) return []
    const q = search.trim().toLowerCase()
    return q ? counties.filter((c) => c.name.toLowerCase().includes(q)) : counties
  }, [counties, search])

  // Counties whose draft differs from what is saved on the server.
  const changes = useMemo(() => {
    if (!counties) return []
    return counties.filter((c) => checked.has(c.name) === mutedSet.has(c.name))
  }, [counties, checked, mutedSet])

  const handleSave = useCallback(async () => {
    if (!counties || changes.length === 0 || saving) return
    setSaving(true)
    setSaveError(null)
    // One request carries the whole state: every county not checked is
    // muted, everything checked is unmuted (was one PUT per changed county).
    const nextMuted = new Set(counties.filter((c) => !checked.has(c.name)).map((c) => c.name))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-geo/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: state.abbrev, muted_counties: Array.from(nextMuted) }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onSaved(state.abbrev, nextMuted)
      setSaving(false)
      onClose()
    } catch {
      setSaving(false)
      setSaveError("Your counties didn't save. Try again.")
    }
  }, [state.abbrev, counties, changes, checked, saving, onSaved, onClose])

  const total = counties ? counties.length : 0
  const onCount = counties ? counties.filter((c) => checked.has(c.name)).length : 0

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-6" role="dialog" aria-modal="true" aria-label={`${state.name} counties`}>
      <div className="w-full sm:max-w-lg bg-gg-gray-900 border border-gg-gray-700 rounded-t-2xl sm:rounded-2xl flex flex-col max-h-[92vh] sm:max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-gg-gray-700">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-white truncate">{state.name}</h2>
            <p className="text-xs text-gg-gray-400">
              {counties ? `${onCount} of ${total} counties on` : 'Loading counties…'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="w-9 h-9 rounded-lg bg-gg-gray-800 hover:bg-gg-gray-700 text-gg-gray-300 hover:text-white flex items-center justify-center disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search + bulk */}
        <div className="px-5 py-3 space-y-2 border-b border-gg-gray-700">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-500" />
            <input
              type="text"
              placeholder="Search counties…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white text-gg-black placeholder-gg-gray-500 border border-gg-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:border-gg-pink focus:outline-none"
            />
          </div>
          {counties && counties.length > 0 && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setChecked(new Set(counties.map((c) => c.name)))}
                className="px-3 py-1.5 rounded-lg bg-gg-gray-700 hover:bg-gg-gray-600 text-xs font-medium text-white"
              >
                All on
              </button>
              <button
                type="button"
                onClick={() => setChecked(new Set())}
                className="px-3 py-1.5 rounded-lg bg-gg-gray-700 hover:bg-gg-gray-600 text-xs font-medium text-white"
              >
                All off
              </button>
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5">
          {counties === undefined ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={20} className="animate-spin text-gg-pink" />
            </div>
          ) : counties === null ? (
            <div className="flex items-center justify-between py-6">
              <p className="text-sm text-red-400">Couldn&apos;t load counties.</p>
              <button type="button" onClick={onReload} className="px-3 py-1.5 rounded-lg bg-gg-pink text-white text-xs font-semibold">
                Try again
              </button>
            </div>
          ) : visible.length === 0 ? (
            <p className="text-sm text-gg-gray-400 py-6">No counties match.</p>
          ) : (
            visible.map((county, idx) => {
              const on = checked.has(county.name)
              return (
                <label
                  key={county.id}
                  className={`flex items-center justify-between py-3 cursor-pointer ${idx === visible.length - 1 ? '' : 'border-b border-gg-gray-800'}`}
                >
                  <span className="text-sm text-white">{county.name}</span>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(county.name)}
                    className="w-5 h-5 accent-[#f58cde] rounded"
                    aria-label={`${county.name} alerts`}
                  />
                </label>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gg-gray-700 space-y-2">
          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 py-2.5 rounded-lg bg-gg-gray-700 hover:bg-gg-gray-600 text-sm font-semibold text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || changes.length === 0}
              className="flex-1 py-2.5 rounded-lg bg-gg-pink hover:bg-gg-pink-dark text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {changes.length > 0 ? `Save ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}` : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [catalog, setCatalog] = useState<CatalogEntry[]>([])
  const [preferences, setPreferences] = useState<Preference[]>([])
  const prefsRef = useRef<Preference[]>([])
  prefsRef.current = preferences
  const [prefBusy, setPrefBusy] = useState<Set<string>>(new Set())
  const [prefError, setPrefError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)

  const [geoError, setGeoError] = useState<string | null>(null)
  const [geoStates, setGeoStates] = useState<GeoState[]>([])
  const [mutedByState, setMutedByState] = useState<Record<string, Set<string>>>({})
  // stateId -> counties | null (failed) | undefined (loading)
  const [countiesByState, setCountiesByState] = useState<Record<number, County[] | null | undefined>>({})
  const [pickerState, setPickerState] = useState<GeoState | null>(null)

  const loadCounties = useCallback(async (state: GeoState) => {
    setCountiesByState((prev) => ({ ...prev, [state.stateId]: undefined }))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/states/${state.stateId}/counties`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setCountiesByState((prev) => ({ ...prev, [state.stateId]: Array.isArray(data) ? data : [] }))
    } catch {
      setCountiesByState((prev) => ({ ...prev, [state.stateId]: null }))
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    setGeoError(null)
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
    if (!token) { router.push('/signin'); return }
    let prefsData: PrefsResponse
    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-preferences`)
      if (res.status === 401) { router.push('/signin'); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      prefsData = await res.json()
    } catch {
      setLoadError(true)
      setLoading(false)
      return
    }
    setCatalog(prefsData.catalog ?? [])
    setPreferences(prefsData.preferences ?? [])
    // Geo is optional — the counties section simply hides if it fails.
    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-geo`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const geo: GeoResponse = await res.json()
      const byState: Record<string, Set<string>> = {}
      for (const m of geo.muted ?? []) {
        if (!byState[m.state]) byState[m.state] = new Set()
        byState[m.state].add(m.county)
      }
      const states = geo.states ?? []
      setGeoStates(states)
      setMutedByState(byState)
      states.forEach((s) => { loadCounties(s) })
    } catch {
      setGeoError("Couldn't load your counties.")
      setGeoStates([])
    }
    setLoading(false)
  }, [router, loadCounties])

  useEffect(() => { load() }, [load])

  // ── Save one or more category changes in a single PUT (optimistic) ────────
  const applyPrefChanges = useCallback(async (changes: PrefChange[]) => {
    if (changes.length === 0) return
    const keys = changes.map(prefKey)
    const keySet = new Set(keys)
    const newValue: Record<string, boolean> = {}
    changes.forEach((c) => { newValue[prefKey(c)] = c.enabled })
    const oldValue: Record<string, boolean> = {}
    prefsRef.current.forEach((p) => { if (keySet.has(prefKey(p))) oldValue[prefKey(p)] = p.enabled })
    setPrefError(null)
    setPreferences((prev) => prev.map((p) => (keySet.has(prefKey(p)) ? { ...p, enabled: newValue[prefKey(p)] } : p)))
    setPrefBusy((prev) => { const next = new Set(prev); keys.forEach((k) => next.add(k)); return next })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-preferences`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: changes }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: PrefsResponse = await res.json()
      if (Array.isArray(data.preferences)) setPreferences(data.preferences)
    } catch {
      setPreferences((prev) => prev.map((p) => (keySet.has(prefKey(p)) ? { ...p, enabled: oldValue[prefKey(p)] } : p)))
      setPrefError("Couldn't save. Please try again.")
    } finally {
      setPrefBusy((prev) => { const next = new Set(prev); keys.forEach((k) => next.delete(k)); return next })
    }
  }, [])

  const handlePrefToggle = useCallback((pref: Preference) => {
    if (prefBusy.has(prefKey(pref))) return
    applyPrefChanges([{ channel: pref.channel, category: pref.category, enabled: !pref.enabled }])
  }, [prefBusy, applyPrefChanges])

  // ── Derived data ───────────────────────────────────────────────────────────
  const catalogByKey: Record<string, CatalogEntry> = {}
  for (const entry of catalog) for (const ch of entry.channels ?? []) catalogByKey[`${ch}:${entry.category}`] = entry

  const emailPrefs = preferences.filter((p) => p.channel === 'email')
  const pushPrefs = preferences.filter((p) => p.channel === 'push')

  // Resolve each core switch to the user's pref row: match by catalog key,
  // falling back to the label; prefer push, else the first channel. A
  // category the plan doesn't include has no pref row and is hidden.
  const coreRows: { pref: Preference; entry: CatalogEntry }[] = []
  for (const core of CORE_CATEGORIES) {
    const entry = catalog.find((e) => e.category === core.category)
      || catalog.find((e) => (e.label || '').toLowerCase() === core.label.toLowerCase())
    if (!entry) continue
    const channel = (entry.channels ?? []).includes('push') ? 'push' : (entry.channels ?? [])[0]
    const pref = preferences.find((p) => p.channel === channel && p.category === entry.category)
    if (pref) coreRows.push({ pref, entry })
  }
  const corePushPrefs = coreRows.map((r) => r.pref).filter((p) => p.channel === 'push' && !p.locked)
  const unlockedPushPrefs = pushPrefs.filter((p) => !p.locked)
  const masterOn = unlockedPushPrefs.some((p) => p.enabled)

  const handleMasterToggle = () => {
    if (!masterOn) {
      applyPrefChanges(corePushPrefs.filter((p) => !p.enabled).map((p) => ({ channel: 'push', category: p.category, enabled: true })))
    } else {
      applyPrefChanges(unlockedPushPrefs.filter((p) => p.enabled).map((p) => ({ channel: 'push', category: p.category, enabled: false })))
    }
  }

  const sortedGeoStates = [...geoStates].sort((a, b) => a.name.localeCompare(b.name))
  const countyCountText = (state: GeoState) => {
    const counties = countiesByState[state.stateId]
    if (counties === undefined) return 'Loading…'
    if (counties === null) return 'Tap to load counties'
    const muted = mutedByState[state.abbrev] || new Set<string>()
    const on = counties.filter((c) => !muted.has(c.name)).length
    return `${on} of ${counties.length} counties`
  }
  const openPicker = (state: GeoState) => {
    if (countiesByState[state.stateId] === null) loadCounties(state)
    setPickerState(state)
  }
  const handleCountiesSaved = useCallback((abbrev: string, nextMuted: Set<string>) => {
    setMutedByState((prev) => ({ ...prev, [abbrev]: nextMuted }))
  }, [])

  // Select all / Unselect all across every state (owner 10/6: most people
  // unselect everything, then open one state and pick the 3-5 counties
  // they follow). One request; the muted list is re-read afterwards so the
  // counts come from what was actually saved.
  const [bulkBusy, setBulkBusy] = useState(false)
  const applyBulk = async (muted: boolean) => {
    if (bulkBusy) return
    setBulkBusy(true)
    setGeoError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/me/notification-geo/bulk`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all', muted }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const geoRes = await fetchWithAuth(`${API_URL}/api/me/notification-geo`)
      if (!geoRes.ok) throw new Error(`HTTP ${geoRes.status}`)
      const geo: GeoResponse = await geoRes.json()
      const byState: Record<string, Set<string>> = {}
      for (const m of geo.muted ?? []) {
        if (!byState[m.state]) byState[m.state] = new Set()
        byState[m.state].add(m.county)
      }
      setMutedByState(byState)
    } catch {
      setGeoError("Couldn't update your counties. Please try again.")
    } finally {
      setBulkBusy(false)
    }
  }
  const handleUnselectAll = () => {
    if (window.confirm("Unselect all counties? You won't get any county alerts until you open a state and pick the counties you follow.")) {
      void applyBulk(true)
    }
  }
  const totalCounties = sortedGeoStates.reduce((n, st) => n + ((countiesByState[st.stateId] || []).length), 0)
  const totalOn = sortedGeoStates.reduce((n, st) => {
    const counties = countiesByState[st.stateId] || []
    const muted = mutedByState[st.abbrev] || new Set<string>()
    return n + counties.filter((c) => !muted.has(c.name)).length
  }, 0)

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    )
  }

  const sectionCard = 'bg-gg-gray-800 border border-gg-gray-700 rounded-xl px-5'

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
            <p className="text-gg-gray-400">Choose what you hear about and where</p>
          </div>
        </div>

        {loadError ? (
          <div className={`${sectionCard} py-6 text-center`}>
            <p className="text-sm text-white mb-3">Couldn&apos;t load notification settings.</p>
            <button type="button" onClick={load} className="px-4 py-2 rounded-lg bg-gg-pink text-white text-sm font-semibold">
              Try again
            </button>
          </div>
        ) : (
          <>
            {prefError && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">{prefError}</div>
            )}

            {/* 1. Master push switch */}
            {pushPrefs.length > 0 && (
              <div className={`${sectionCard} py-2 mb-6 flex items-center justify-between`}>
                <div>
                  <p className="text-base font-semibold text-white">Push notifications</p>
                  <p className="text-xs text-gg-gray-400">{masterOn ? 'On' : 'Off'} · delivered to the Ground Goat app on your phone</p>
                </div>
                <Toggle value={masterOn} disabled={prefBusy.size > 0} onChange={handleMasterToggle} />
              </div>
            )}

            {/* 2. My counties */}
            {geoError && (
              <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 flex items-center justify-between">
                <p className="text-sm text-red-400">{geoError}</p>
                <button type="button" onClick={load} className="px-3 py-1.5 rounded-lg bg-gg-pink text-white text-xs font-semibold">Try again</button>
              </div>
            )}
            {sortedGeoStates.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-semibold text-white uppercase tracking-wider mb-1">My counties</h2>
                <p className="text-xs text-gg-gray-400 mb-3">You&apos;ll only get alerts for the counties you pick. Change this any time.</p>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    type="button"
                    onClick={() => void applyBulk(false)}
                    disabled={bulkBusy}
                    className="px-3 py-1.5 rounded-full border border-gg-pink text-gg-pink text-xs font-semibold hover:bg-gg-pink/10 disabled:opacity-50"
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    onClick={handleUnselectAll}
                    disabled={bulkBusy}
                    className="px-3 py-1.5 rounded-full border border-gg-pink text-gg-pink text-xs font-semibold hover:bg-gg-pink/10 disabled:opacity-50"
                  >
                    Unselect all
                  </button>
                  {bulkBusy ? (
                    <Loader2 size={14} className="animate-spin text-gg-pink ml-auto" />
                  ) : totalCounties > 0 ? (
                    <span className="text-xs text-gg-gray-400 ml-auto">{totalOn} of {totalCounties} on</span>
                  ) : null}
                </div>
                <div className={sectionCard}>
                  {sortedGeoStates.map((state, i) => (
                    <button
                      type="button"
                      key={state.stateId}
                      onClick={() => openPicker(state)}
                      className={`w-full flex items-center justify-between py-3.5 text-left ${i === sortedGeoStates.length - 1 ? '' : 'border-b border-gg-gray-700'}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{state.name}</p>
                        <p className="text-xs text-gg-gray-400">{countyCountText(state)}</p>
                      </div>
                      <ChevronRight size={18} className="text-gg-gray-400 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 3. What to send me */}
            {coreRows.length > 0 && (
              <div className="mb-6">
                <h2 className="text-xs font-semibold text-white uppercase tracking-wider mb-3">What to send me</h2>
                <div className={sectionCard}>
                  {coreRows.map(({ pref, entry }, i) => (
                    <PrefRow
                      key={prefKey(pref)}
                      label={entry.label}
                      isLast={i === coreRows.length - 1}
                      locked={pref.locked}
                      value={pref.enabled}
                      busy={prefBusy.has(prefKey(pref))}
                      onToggle={() => handlePrefToggle(pref)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 4. More options — the full per-category list */}
            {(emailPrefs.length > 0 || pushPrefs.length > 0) && (
              <>
                <button
                  type="button"
                  onClick={() => setShowMore((v) => !v)}
                  className="w-full flex items-center justify-between py-3 text-sm font-medium text-white"
                >
                  <span>More options</span>
                  {showMore ? <ChevronUp size={18} className="text-gg-gray-400" /> : <ChevronDown size={18} className="text-gg-gray-400" />}
                </button>
                {showMore && (
                  <div className={`${sectionCard} py-3`}>
                    {emailPrefs.length > 0 && (
                      <>
                        <h3 className="text-xs font-semibold text-white uppercase tracking-wider pt-2 pb-1">Email notifications</h3>
                        {emailPrefs.map((pref, i) => {
                          const entry = catalogByKey[prefKey(pref)]
                          return (
                            <PrefRow
                              key={prefKey(pref)}
                              label={entry?.label ?? pref.category}
                              description={entry?.description}
                              isLast={i === emailPrefs.length - 1}
                              locked={pref.locked}
                              value={pref.enabled}
                              busy={prefBusy.has(prefKey(pref))}
                              onToggle={() => handlePrefToggle(pref)}
                            />
                          )
                        })}
                      </>
                    )}
                    {pushPrefs.length > 0 && (
                      <>
                        <h3 className={`text-xs font-semibold text-white uppercase tracking-wider pb-1 ${emailPrefs.length > 0 ? 'pt-5' : 'pt-2'}`}>Push notifications</h3>
                        {pushPrefs.map((pref, i) => {
                          const entry = catalogByKey[prefKey(pref)]
                          return (
                            <PrefRow
                              key={prefKey(pref)}
                              label={entry?.label ?? pref.category}
                              description={entry?.description}
                              isLast={i === pushPrefs.length - 1}
                              locked={pref.locked}
                              value={pref.enabled}
                              busy={prefBusy.has(prefKey(pref))}
                              onToggle={() => handlePrefToggle(pref)}
                            />
                          )
                        })}
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {pickerState && (
        <CountyPicker
          state={pickerState}
          counties={countiesByState[pickerState.stateId]}
          mutedSet={mutedByState[pickerState.abbrev] || new Set<string>()}
          onClose={() => setPickerState(null)}
          onSaved={handleCountiesSaved}
          onReload={() => loadCounties(pickerState)}
        />
      )}
    </div>
  )
}
