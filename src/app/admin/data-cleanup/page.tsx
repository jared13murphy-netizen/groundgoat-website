'use client'

// Force dynamic rendering — admin pages must never be cached at the edge
// (a 1-year static HTML cache would pin an old JS bundle hash after redeploy).
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Loader2, ExternalLink, MapPin, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp, CheckCircle2, ArrowLeft, AlertTriangle, RefreshCw,
  Pencil, Check, X,
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import openListingReport from '@/lib/openListingReport'
import TractMapEditor from '@/components/admin/TractMapEditor'
import TillableCluWorkshop from '@/components/admin/TillableCluWorkshop'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Which states are "not held" (soil + FSA CLU finished) is the BACKEND's call —
// it's served in the stats response as `actionable_states`, the single source
// of truth. To unhold a state, edit ACTIONABLE_STATES in the backend (main.py);
// this screen picks it up automatically. (See `actionableStates` below.)
const STAFF = ['Isaac', 'Haley', 'Brandt', 'Truly', 'Jared']
const STATUSES = ['queued', 'in_progress', 'done', 'unfixable'] as const
const PAGE_SIZE = 25

// Defect-reason → short label + tailwind color. These ONLY order/annotate the
// queue; they never decide "this is the full defect set" (early-scraper fakes
// pass every check), so a human still eyeballs every tract against the URL.
const REASON_META: Record<string, { label: string; cls: string }> = {
  poly_missing:           { label: 'No polygon',        cls: 'bg-red-500/20 text-red-600 border-red-500/40' },
  poly_invalid:           { label: 'Invalid geom',      cls: 'bg-red-500/20 text-red-600 border-red-500/40' },
  poly_degenerate:        { label: 'Degenerate',        cls: 'bg-red-500/20 text-red-600 border-red-500/40' },
  duplicate_polygon:      { label: 'Duplicate',         cls: 'bg-orange-500/20 text-orange-600 border-orange-500/40' },
  acreage_mismatch:       { label: 'Acreage off',       cls: 'bg-amber-500/20 text-amber-600 border-amber-500/40' },
  boundary_valid_false:   { label: 'Flagged wrong',     cls: 'bg-amber-500/20 text-amber-600 border-amber-500/40' },
  tillable_acres_missing: { label: 'No tillable',       cls: 'bg-sky-500/20 text-sky-600 border-sky-500/40' },
  rating_missing:         { label: 'No soil rating',    cls: 'bg-purple-500/20 text-purple-600 border-purple-500/40' },
  rating_wrong_type:      { label: 'Wrong rating type', cls: 'bg-purple-500/20 text-purple-600 border-purple-500/40' },
}

type QueueItem = {
  listing_id: string
  cleanup_status: string
  assigned_to: string | null
  priority: boolean
  is_sold: boolean
  state: string | null
  tract_count: number
  defect_tract_count: number
  flagged_reasons: Record<string, number> | null
  audited_at: string | null
  updated_at: string | null
  title: string | null
  company_name: string | null
  county: string | null
  source_url: string | null
  listing_type: string | null
  auction_datetime: string | null
  listing_created_at: string | null
}

type Stats = {
  listings: number
  defect_tracts: number
  priority_listings: number
  tracts_to_verify: number
  actionable_states: string[]
  by_status: Record<string, number>
  by_state: Record<string, number>
  by_assignee: Record<string, number>
}

// Minimal shape we read off /api/listings/{id} tracts. The endpoint returns
// the full TractResponse; we only touch these fields.
type LiveTract = {
  id: string
  tract_number: number
  total_acres: number | null
  tillable_acres: number | null
  soil_rating: number | null
  soil_rating_type: string | null
  county_name: string | null
  state_abbr: string | null
  latitude: number | null
  longitude: number | null
  polygon_coordinates: [number, number][] | null
  tillable_polygon: any
  boundary_valid: boolean | null
  boundary_reviewed_by: string | null
  boundary_reviewed_at: string | null
  image_url: string | null
}

type LoadedListing = {
  loading: boolean
  error: string | null
  source_url: string | null
  primary_image_url: string | null
  state: string | null
  address: string | null
  tracts: LiveTract[]
}

function statusLabel(s: string) {
  return s === 'in_progress' ? 'In progress'
    : s.charAt(0).toUpperCase() + s.slice(1)
}

// "Auction · Jun 14, 2026, 10:00 AM" for auctions; private-treaty listings
// have no auction date, so show when the listing was added instead.
function listingMeta(it: QueueItem): { typeLabel: string; dateLabel: string } {
  const isPT = it.listing_type === 'private_treaty'
  const typeLabel = isPT ? 'Private Treaty' : 'Auction'
  if (!isPT && it.auction_datetime) {
    return {
      typeLabel,
      dateLabel: new Date(it.auction_datetime).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      }),
    }
  }
  if (it.listing_created_at) {
    return {
      typeLabel,
      dateLabel: 'added ' + new Date(it.listing_created_at).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      }),
    }
  }
  return { typeLabel, dateLabel: 'no date' }
}

export default function TractDataCleanupPage() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Single source of truth = backend stats.actionable_states. null until stats
  // load (or if stats fail) → treat everything as actionable so a transient
  // stats hiccup never locks the whole team out of editing.
  const actionableStates: string[] | null = stats?.actionable_states ?? null
  const isActionable = (st?: string | null) =>
    actionableStates == null ? true : (st ? actionableStates.includes(st) : false)

  // Filters
  const [stateFilter, setStateFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('') // '', '__unassigned__', or a name
  const [statusFilter, setStatusFilter] = useState('')      // '' = all
  const [soldOnly, setSoldOnly] = useState(false)
  const [priorityOnly, setPriorityOnly] = useState(false)
  const [offset, setOffset] = useState(0)

  // Per-row in-flight markers so dropdowns disable while saving.
  const [savingId, setSavingId] = useState<string | null>(null)

  // Expanded card → its loaded live tracts (lazy-fetched from /api/listings/{id}).
  // Only the expanded listing mounts the heavy MapLibre editors, mirroring how
  // the staging page lazy-mounts maps to avoid WebGL context exhaustion.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loadedListings, setLoadedListings] = useState<Record<string, LoadedListing>>({})
  // Bumped per-tract whenever a boundary is saved so the CLU workshop re-fetches
  // its field polygons against the new tract polygon.
  const [cluReloadKeys, setCluReloadKeys] = useState<Record<string, number>>({})
  // Tracks unsaved edits per tract editor so the listing's Verify button stays
  // disabled until every tract is saved. Keys: `${listingId}::${tractId}::map`
  // for the boundary editor and `::till` for the tillable workshop.
  const [dirtyTracts, setDirtyTracts] = useState<Record<string, boolean>>({})
  const setTractDirty = (key: string, dirty: boolean) =>
    setDirtyTracts((prev) => {
      if (!!prev[key] === dirty) return prev
      const next = { ...prev }
      if (dirty) next[key] = true
      else delete next[key]
      return next
    })
  const listingHasUnsaved = (lid: string) =>
    Object.keys(dirtyTracts).some((k) => k.startsWith(`${lid}::`) && dirtyTracts[k])
  // Per-tract in-flight marker for the Mark Reviewed button.
  const [reviewingTractId, setReviewingTractId] = useState<string | null>(null)
  // Editable tract number: which tract is being edited, its draft value, and
  // an in-flight marker. Saving writes ONLY tract_number via a restricted endpoint.
  const [editingTractNumId, setEditingTractNumId] = useState<string | null>(null)
  const [tractNumDraft, setTractNumDraft] = useState('')
  const [savingTractNumId, setSavingTractNumId] = useState<string | null>(null)
  // Listing-level Verify: in-flight marker for the whole-listing verify button.
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  // Rescrape: listing in-flight + per-listing result banner. Proposals are keyed
  // by tract id; bumping `nonce` makes that tract's TractMapEditor load the
  // proposed boundary as a dirty edit for review-then-Save. NOTHING is written
  // to our DB until the human Saves — and the rescrape never touches Auction/PT
  // staging (no listing_staging record is created).
  const [rescrapingId, setRescrapingId] = useState<string | null>(null)
  const [rescrapeMsg, setRescrapeMsg] = useState<Record<string, string | null>>({})
  const [proposals, setProposals] = useState<Record<string, {
    coords: [number, number][]
    proposed_acres: number | null
    reported_acres: number | null
    pct_difference: number | null
    source: string | null
    nonce: number
  }>>({})

  const loadStats = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/stats`)
      if (res.ok) setStats(await res.json())
    } catch { /* non-fatal: header counts just won't show */ }
  }, [])

  const loadQueue = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const qs = new URLSearchParams()
      if (stateFilter) qs.set('state', stateFilter)
      if (assigneeFilter === '__unassigned__') qs.set('assigned_to', '')
      else if (assigneeFilter) qs.set('assigned_to', assigneeFilter)
      if (statusFilter) qs.set('cleanup_status', statusFilter)
      if (soldOnly) qs.set('is_sold', 'true')
      if (priorityOnly) qs.set('priority', 'true')
      qs.set('limit', String(PAGE_SIZE))
      qs.set('offset', String(offset))
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/queue?${qs.toString()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [stateFilter, assigneeFilter, statusFilter, soldOnly, priorityOnly, offset])

  useEffect(() => { loadStats() }, [loadStats])
  useEffect(() => { loadQueue() }, [loadQueue])
  // Reset to first page + collapse whenever a filter changes.
  useEffect(() => { setOffset(0); setExpandedId(null) }, [stateFilter, assigneeFilter, statusFilter, soldOnly, priorityOnly])

  const patchRow = (lid: string, fields: Partial<QueueItem>) =>
    setItems((prev) => prev.map((it) => (it.listing_id === lid ? { ...it, ...fields } : it)))

  // Lightweight toast (no dependency) — auto-dismisses after 4s.
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null)
  const showToast = (msg: string, kind: 'success' | 'error' = 'success') => {
    setToast({ msg, kind })
    window.setTimeout(() => setToast(null), 4000)
  }

  // Fetch the full listing (with tracts) for an expanded card. Read-only:
  // the queue endpoint returns no polygons, so we pull them here.
  const loadListing = useCallback(async (lid: string) => {
    setLoadedListings((prev) => ({
      ...prev,
      [lid]: { loading: true, error: null, source_url: null, primary_image_url: null, state: null, address: null, tracts: prev[lid]?.tracts || [] },
    }))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/listings/${lid}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      const tracts: LiveTract[] = (data.tracts || []).map((t: any) => ({
        id: t.id,
        tract_number: t.tract_number,
        total_acres: t.total_acres != null ? Number(t.total_acres) : null,
        tillable_acres: t.tillable_acres != null ? Number(t.tillable_acres) : null,
        soil_rating: t.soil_rating != null ? Number(t.soil_rating) : null,
        soil_rating_type: t.soil_rating_type ?? null,
        county_name: t.county_name ?? null,
        state_abbr: t.state_abbr ?? null,
        latitude: t.latitude != null ? Number(t.latitude) : null,
        longitude: t.longitude != null ? Number(t.longitude) : null,
        polygon_coordinates: Array.isArray(t.polygon_coordinates) ? t.polygon_coordinates : null,
        tillable_polygon: t.tillable_polygon ?? null,
        boundary_valid: t.boundary_valid ?? null,
        boundary_reviewed_by: t.boundary_reviewed_by ?? null,
        boundary_reviewed_at: t.boundary_reviewed_at ?? null,
        image_url: t.image_url ?? null,
      }))
      // Sort by tract number so the order matches the listing page.
      tracts.sort((a, b) => (a.tract_number ?? 0) - (b.tract_number ?? 0))
      setLoadedListings((prev) => ({
        ...prev,
        [lid]: {
          loading: false, error: null,
          source_url: data.source_url ?? null,
          primary_image_url: data.primary_image_url ?? null,
          state: data.state ?? (tracts[0]?.state_abbr ?? null),
          address: data.address ?? null,
          tracts,
        },
      }))
    } catch (e: any) {
      setLoadedListings((prev) => ({
        ...prev,
        [lid]: { loading: false, error: e.message || String(e), source_url: null, primary_image_url: null, state: null, address: null, tracts: [] },
      }))
    }
  }, [])

  function toggleExpand(lid: string) {
    if (expandedId === lid) { setExpandedId(null); return }
    setExpandedId(lid)
    if (!loadedListings[lid] || loadedListings[lid].error) loadListing(lid)
  }

  // Patch a single live tract in the loaded-listing cache.
  function patchTract(lid: string, tractId: string, fields: Partial<LiveTract>) {
    setLoadedListings((prev) => {
      const cur = prev[lid]
      if (!cur) return prev
      return {
        ...prev,
        [lid]: { ...cur, tracts: cur.tracts.map((t) => (t.id === tractId ? { ...t, ...fields } : t)) },
      }
    })
  }

  async function setAssignee(lid: string, value: string) {
    const assigned_to = value || null
    const prev = items.find((i) => i.listing_id === lid)?.assigned_to ?? null
    setSavingId(lid)
    patchRow(lid, { assigned_to })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/${lid}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_to }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      loadStats()
    } catch (e: any) {
      patchRow(lid, { assigned_to: prev }) // revert
      alert(`Could not update assignee: ${e.message || e}`)
    } finally { setSavingId(null) }
  }

  async function setStatus(lid: string, value: string) {
    const prev = items.find((i) => i.listing_id === lid)?.cleanup_status ?? 'queued'
    setSavingId(lid)
    patchRow(lid, { cleanup_status: value })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/${lid}/status`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleanup_status: value }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      loadStats()
    } catch (e: any) {
      patchRow(lid, { cleanup_status: prev }) // revert
      alert(`Could not update status: ${e.message || e}`)
    } finally { setSavingId(null) }
  }

  // Mark a tract human-reviewed-correct (or clear it). Writes ONLY the review
  // columns via the restricted endpoint — never polygon/tillable/soil/price.
  async function toggleReviewed(lid: string, tract: LiveTract) {
    const next = !tract.boundary_reviewed_by
    setReviewingTractId(tract.id)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/tract/${tract.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewed: next }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.detail || `HTTP ${res.status}`)
      patchTract(lid, tract.id, {
        boundary_reviewed_by: next ? 'you' : null,
        boundary_reviewed_at: next ? new Date().toISOString() : null,
      })
    } catch (e: any) {
      alert(`Could not update review state: ${e.message || e}`)
    } finally { setReviewingTractId(null) }
  }

  // Save a corrected tract number. Writes ONLY tract_number via the restricted
  // endpoint — never polygon/tillable/soil/status/price. Re-sorts the tract list
  // so the new order matches the listing page.
  async function saveTractNumber(lid: string, tract: LiveTract) {
    const parsed = parseInt(tractNumDraft, 10)
    if (!Number.isFinite(parsed) || parsed < 1) { alert('Tract number must be a whole number ≥ 1'); return }
    if (parsed === tract.tract_number) { setEditingTractNumId(null); return }
    setSavingTractNumId(tract.id)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/tract/${tract.id}/tract-number`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tract_number: parsed }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.detail || `HTTP ${res.status}`)
      setLoadedListings((prev) => {
        const cur = prev[lid]
        if (!cur) return prev
        const tracts = cur.tracts
          .map((t) => (t.id === tract.id ? { ...t, tract_number: parsed } : t))
          .sort((a, b) => (a.tract_number ?? 0) - (b.tract_number ?? 0))
        return { ...prev, [lid]: { ...cur, tracts } }
      })
      setEditingTractNumId(null)
    } catch (e: any) {
      alert(`Could not update tract number: ${e.message || e}`)
    } finally { setSavingTractNumId(null) }
  }

  // Verify the whole listing: mark every tract Reviewed and flip status to Done.
  // Per the user, this finalizes a listing AFTER each tract has been saved — it
  // does NOT touch polygon/tillable/soil (those save on their own editors).
  async function verifyListing(lid: string) {
    setVerifyingId(lid)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/${lid}/verify`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.detail || `HTTP ${res.status}`)
      // Verify marks every tract Reviewed + sets the listing status to Done on
      // the server in one call — no need for the admin to do either manually.
      // All its tracts are now reviewed, so it drops off this screen: collapse
      // + remove the row and decrement the total.
      const count = data.reviewed_count ?? loadedListings[lid]?.tracts.length ?? 0
      if (expandedId === lid) setExpandedId(null)
      setItems((prev) => prev.filter((it) => it.listing_id !== lid))
      setTotal((prev) => Math.max(0, prev - 1))
      loadStats()
      showToast(`Listing verified — ${count} tract${count === 1 ? '' : 's'} marked reviewed and set to Done.`, 'success')
      // Open the branded report PDF so the admin can double-check the data.
      openListingReport(lid, { force: true })
    } catch (e: any) {
      showToast(`Could not verify listing: ${e.message || e}`, 'error')
    } finally { setVerifyingId(null) }
  }

  // Rescrape a listing's source URL and load proposed boundaries into each
  // tract's editor for review. Stays entirely within this screen — the backend
  // endpoint creates NO staging record, so nothing appears on Auction/PT Staging.
  async function rescrapeListing(lid: string) {
    // Editors must be mounted for proposals to land, so expand + load first.
    setExpandedId(lid)
    if (!loadedListings[lid] || loadedListings[lid].error) await loadListing(lid)
    setRescrapingId(lid)
    setRescrapeMsg((prev) => ({ ...prev, [lid]: null }))
    // A rescrape re-runs the full extraction pipeline (backend waits up to
    // 300s on the scraper). fetchWithAuth's default 20s timeout aborts that
    // mid-flight — surfaced as "signal is aborted without reason". Supplying
    // our own signal makes fetchWithAuth skip its 20s cap; we abort at 280s,
    // just under the backend's 300s scraper timeout.
    const ctrl = new AbortController()
    const timeoutId = window.setTimeout(() => ctrl.abort(), 280_000)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/${lid}/rescrape`, { method: 'POST', signal: ctrl.signal })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.detail || `HTTP ${res.status}`)
      setProposals((prev) => {
        const next = { ...prev }
        for (const p of (data.proposals || [])) {
          if (p.found && Array.isArray(p.proposed_coordinates) && p.proposed_coordinates.length >= 3) {
            next[p.tract_id] = {
              coords: p.proposed_coordinates,
              proposed_acres: p.proposed_acres ?? null,
              reported_acres: p.reported_acres ?? null,
              pct_difference: p.pct_difference ?? null,
              source: p.coordinates_source ?? null,
              nonce: (prev[p.tract_id]?.nonce || 0) + 1,
            }
          }
        }
        return next
      })
      const matched = data.matched_count || 0
      const total = (data.proposals || []).length
      setRescrapeMsg((prev) => ({
        ...prev,
        [lid]: matched > 0
          ? `Loaded ${matched} of ${total} proposed boundar${matched === 1 ? 'y' : 'ies'} onto the map — review each against the source, then Save to apply (or Cancel to discard).`
          : `Rescrape extracted no usable boundaries (scraped ${data.scraped_tracts_total || 0} tract(s)). Draw or upload manually.`,
      }))
    } catch (e: any) {
      const msg = e?.name === 'AbortError'
        ? 'Rescrape timed out (the source page took too long to extract). Try again, or draw/upload manually.'
        : `Rescrape failed: ${e.message || e}`
      setRescrapeMsg((prev) => ({ ...prev, [lid]: msg }))
    } finally { window.clearTimeout(timeoutId); setRescrapingId(null) }
  }

  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + PAGE_SIZE, total)

  return (
    // `staging-light` (defined in globals.css) flips the dark gg-* tokens to a
    // light theme — matches the Auction Staging screen the user wants this to
    // look and work just like.
    <div className="staging-light min-h-screen bg-gg-black pt-24 pb-12">
      {/* Toast — fixed, top-right, auto-dismisses. */}
      {toast && (
        <div className="fixed top-20 right-6 z-50 max-w-sm">
          <div className={`flex items-start gap-2 px-4 py-3 rounded-lg shadow-lg border text-sm font-medium ${
            toast.kind === 'success'
              ? 'bg-green-600 text-white border-green-500'
              : 'bg-red-600 text-white border-red-500'
          }`}>
            {toast.kind === 'success'
              ? <CheckCircle2 size={18} className="flex-shrink-0 mt-0.5" />
              : <AlertTriangle size={18} className="flex-shrink-0 mt-0.5" />}
            <span>{toast.msg}</span>
            <button onClick={() => setToast(null)} className="ml-1 opacity-80 hover:opacity-100">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white transition-colors">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Tract Data Clean-Up</h1>
              <p className="text-gg-gray-400 text-sm">
                {total} listing{total === 1 ? '' : 's'} with tracts{total > PAGE_SIZE && ` (page ${Math.floor(offset / PAGE_SIZE) + 1} of ${Math.ceil(total / PAGE_SIZE)})`}
              </p>
            </div>
          </div>
          <button
            onClick={() => { loadQueue(); loadStats() }}
            className="px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 transition-colors text-sm"
          >
            Refresh
          </button>
        </div>
        <p className="text-sm text-gg-gray-400 mb-4 max-w-3xl">
          Every listing with tracts is here. Expand one to fix each tract against
          its source URL — correct polygon, tillable polygon (CLU workshop), and
          soil rating — exactly like the staging screen. Reason badges only order
          the queue; a human still confirms every tract.
        </p>

        {/* Header stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <StatCard label="Listings" value={stats.listings} />
            <StatCard label="Tracts to verify (active states)" value={stats.tracts_to_verify} />
            <StatCard label="Done" value={stats.by_status?.done || 0} />
            <StatCard label="Unfixable" value={stats.by_status?.unfixable || 0} />
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <label className="text-xs text-gg-gray-400 uppercase tracking-wide">State:</label>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
            className="bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white">
            <option value="">All states</option>
            {stats && Object.entries(stats.by_state)
              .sort((a, b) => b[1] - a[1])
              .map(([st, n]) => (
                <option key={st || 'none'} value={st || ''}>
                  {st || '(none)'} ({n}){actionableStates && !actionableStates.includes(st) ? ' — held' : ''}
                </option>
              ))}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Assigned:</label>
          <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)}
            className="bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white">
            <option value="">All</option>
            <option value="__unassigned__">Unassigned</option>
            {STAFF.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Status:</label>
          <div className="inline-flex rounded overflow-hidden border border-gg-gray-700">
            {['', ...STATUSES].map((opt) => (
              <button key={opt || 'all'} onClick={() => setStatusFilter(opt)}
                className={`px-3 py-1 text-xs ${statusFilter === opt ? 'bg-gg-pink/30 text-gg-pink' : 'bg-gg-gray-800 text-gg-gray-300 hover:bg-gg-gray-700'}`}>
                {opt ? statusLabel(opt) : 'All'}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1 text-xs text-gg-gray-300 ml-2 cursor-pointer">
            <input type="checkbox" checked={soldOnly} onChange={(e) => setSoldOnly(e.target.checked)} /> Sold only
          </label>
          <label className="flex items-center gap-1 text-xs text-gg-gray-300 ml-1 cursor-pointer">
            <input type="checkbox" checked={priorityOnly} onChange={(e) => setPriorityOnly(e.target.checked)} /> Priority only
          </label>
        </div>

        {/* Pagination header */}
        <div className="flex items-center justify-between mb-3 text-sm text-gg-gray-400">
          <span>{loading ? 'Loading…' : `${pageStart}–${pageEnd} of ${total} listings`}</span>
          <div className="flex items-center gap-2">
            <button disabled={offset === 0 || loading} onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setExpandedId(null) }}
              className="px-2 py-1 rounded border border-gg-gray-700 disabled:opacity-40 hover:bg-gg-gray-700 flex items-center gap-1">
              <ChevronLeft size={14} /> Prev
            </button>
            <button disabled={pageEnd >= total || loading} onClick={() => { setOffset(offset + PAGE_SIZE); setExpandedId(null) }}
              className="px-2 py-1 rounded border border-gg-gray-700 disabled:opacity-40 hover:bg-gg-gray-700 flex items-center gap-1">
              Next <ChevronRight size={14} />
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/40 border border-red-600 rounded p-3 text-red-300 mb-3">{error}</div>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-gg-gray-400 py-8 justify-center">
            <Loader2 className="animate-spin" size={18} /> Loading queue…
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-3">
            {items.map((it) => {
              const actionable = isActionable(it.state)
              const reasons = it.flagged_reasons ? Object.entries(it.flagged_reasons) : []
              const expanded = expandedId === it.listing_id
              const loaded = loadedListings[it.listing_id]
              return (
                <div key={it.listing_id}
                  className={`bg-gg-gray-900 border rounded-lg ${it.priority ? 'border-gg-pink/40' : 'border-gg-gray-800'}`}>
                  {/* Summary row (always shown) */}
                  <div className="flex items-start gap-3 p-3">
                    <button
                      onClick={() => toggleExpand(it.listing_id)}
                      className="mt-0.5 text-gg-gray-400 hover:text-gg-pink shrink-0"
                      title={expanded ? 'Collapse' : 'Open editor'}
                    >
                      {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => toggleExpand(it.listing_id)}>
                      {it.company_name && (
                        <p className="text-lg font-bold text-white truncate max-w-xl leading-tight">{it.company_name}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-sm font-semibold text-gg-gray-300 truncate max-w-xl">{it.title || '(untitled)'}</h2>
                        {it.is_sold && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gg-gray-800 text-gg-gray-300 border border-gg-gray-700">Sold</span>}
                        {it.priority && <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-gg-pink/20 text-gg-pink border border-gg-pink/40">Priority</span>}
                        {!actionable && (
                          <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-600 border border-yellow-500/40"
                            title="Soil mapping not done for this state — view only, don't update tillable/soil yet">
                            Soil not mapped — hold
                          </span>
                        )}
                      </div>
                      {/* Listing type + date, below the title (queue is sorted
                          newest→oldest by auction date server-side). */}
                      {(() => {
                        const { typeLabel, dateLabel } = listingMeta(it)
                        const isPT = it.listing_type === 'private_treaty'
                        return (
                          <div className="flex items-center gap-2 mt-0.5 text-xs">
                            <span className={`uppercase tracking-wide font-medium px-1.5 py-0.5 rounded border ${
                              isPT
                                ? 'bg-indigo-500/15 text-indigo-600 border-indigo-500/40'
                                : 'bg-emerald-500/15 text-emerald-600 border-emerald-500/40'
                            }`}>
                              {typeLabel}
                            </span>
                            <span className="text-gg-gray-400">{dateLabel}</span>
                          </div>
                        )
                      })()}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gg-gray-400">
                        <span className="flex items-center gap-1"><MapPin size={11} />{it.county || '—'}, {it.state || '—'}</span>
                        <span>{it.tract_count} tract{it.tract_count === 1 ? '' : 's'}{it.defect_tract_count > 0 ? ` · ${it.defect_tract_count} flagged` : ''}</span>
                        {it.source_url && (
                          <a href={it.source_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                            className="text-gg-pink hover:underline flex items-center gap-1">
                            Source <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                      {reasons.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {reasons.map(([r, n]) => {
                            const m = REASON_META[r] || { label: r, cls: 'bg-gg-gray-800 text-gg-gray-300 border-gg-gray-700' }
                            return (
                              <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded border ${m.cls}`}>
                                {m.label}{n > 1 ? ` ×${n}` : ''}
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* Workflow controls */}
                    <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                      <select value={it.assigned_to || ''} disabled={savingId === it.listing_id}
                        onChange={(e) => setAssignee(it.listing_id, e.target.value)}
                        className="bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1 text-xs text-white disabled:opacity-50">
                        <option value="">Unassigned</option>
                        {STAFF.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <select value={it.cleanup_status} disabled={savingId === it.listing_id}
                        onChange={(e) => setStatus(it.listing_id, e.target.value)}
                        className="bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1 text-xs text-white disabled:opacity-50">
                        {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                      </select>
                      {/* Rescrape this listing's source URL and load proposed
                          boundaries into the editors below. Stays in Data
                          Clean-Up — never goes to Auction/PT Staging. */}
                      <button
                        onClick={() => rescrapeListing(it.listing_id)}
                        disabled={rescrapingId === it.listing_id || !it.source_url}
                        title={it.source_url ? 'Re-scrape the source URL for fresh boundaries (review here, not in staging)' : 'No source URL to rescrape'}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border border-gg-gray-700 bg-gg-gray-800 text-white hover:bg-gg-gray-700 disabled:opacity-50"
                      >
                        {rescrapingId === it.listing_id
                          ? <Loader2 className="animate-spin" size={13} />
                          : <RefreshCw size={13} />}
                        Rescrape
                      </button>
                    </div>
                  </div>

                  {/* Expanded editor — the staging-style per-tract blocks */}
                  {expanded && (
                    <div className="border-t border-gg-gray-800 p-4">
                      {/* Source website URL (full, copyable) so reviewers can
                          open the exact auction/PT page the tracts came from. */}
                      {(loaded?.source_url || it.source_url) && (
                        <div className="flex items-center gap-2 mb-4 text-xs">
                          <span className="text-gg-gray-400 shrink-0">Source URL:</span>
                          <a href={loaded?.source_url || it.source_url || undefined}
                            target="_blank" rel="noreferrer"
                            className="text-gg-pink hover:underline break-all inline-flex items-center gap-1">
                            {loaded?.source_url || it.source_url}
                            <ExternalLink size={11} className="shrink-0" />
                          </a>
                        </div>
                      )}
                      {loaded?.loading && (
                        <div className="flex items-center gap-2 text-gg-gray-400 py-6 justify-center">
                          <Loader2 className="animate-spin" size={16} /> Loading tracts…
                        </div>
                      )}
                      {loaded?.error && (
                        <div className="bg-red-900/40 border border-red-600 rounded p-3 text-red-300 text-sm">
                          Failed to load tracts: {loaded.error}
                          <button onClick={() => loadListing(it.listing_id)} className="ml-3 underline">Retry</button>
                        </div>
                      )}

                      {!actionable && (
                        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-yellow-500/10 border border-yellow-500/40 rounded-lg">
                          <AlertTriangle size={16} className="text-yellow-600 flex-shrink-0" />
                          <span className="text-yellow-700 text-sm">
                            Soil mapping isn&apos;t done for {it.state || 'this state'} yet — tracts are shown for
                            review but the polygon / tillable / soil editors are locked. Don&apos;t update these yet.
                          </span>
                        </div>
                      )}

                      {rescrapeMsg[it.listing_id] && (
                        <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-sky-500/10 border border-sky-500/40 rounded-lg text-sky-700 text-sm">
                          <RefreshCw size={14} className="flex-shrink-0" />
                          {rescrapeMsg[it.listing_id]}
                        </div>
                      )}

                      {loaded && !loaded.loading && !loaded.error && loaded.tracts.length === 0 && (
                        <div className="text-gg-gray-400 text-sm py-4">This listing has no tracts.</div>
                      )}

                      {loaded && !loaded.loading && loaded.tracts.length > 0 && (
                        <div className="space-y-6">
                          {loaded.tracts.map((tract) => {
                            const tractKey = `${it.listing_id}-${tract.id}`
                            const reviewed = !!tract.boundary_reviewed_by
                            // View on Map target: polygon centroid → tract coord → null.
                            let fLat: number | null = tract.latitude
                            let fLng: number | null = tract.longitude
                            const ring = tract.polygon_coordinates
                            if (ring && ring.length) {
                              let sx = 0, sy = 0, n = 0
                              for (const p of ring) {
                                if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
                                  sx += p[0]; sy += p[1]; n++
                                }
                              }
                              if (n) { fLng = sx / n; fLat = sy / n }
                            }
                            const mapDisabled = fLat == null || fLng == null
                            return (
                              <div key={tract.id} className="border-t border-gg-gray-800 pt-4 first:border-t-0 first:pt-0">
                                {/* Tract header + View on Map */}
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {editingTractNumId === tract.id ? (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-2xl text-white font-extrabold tracking-tight">Tract</span>
                                        <input
                                          type="number" min={1} step={1} autoFocus
                                          value={tractNumDraft}
                                          onChange={(e) => setTractNumDraft(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveTractNumber(it.listing_id, tract)
                                            if (e.key === 'Escape') setEditingTractNumId(null)
                                          }}
                                          disabled={savingTractNumId === tract.id}
                                          className="w-20 bg-gg-gray-800 border border-gg-gray-600 rounded px-2 py-1 text-xl text-white font-bold disabled:opacity-50"
                                        />
                                        <button
                                          onClick={() => saveTractNumber(it.listing_id, tract)}
                                          disabled={savingTractNumId === tract.id}
                                          title="Save tract number"
                                          className="p-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
                                          {savingTractNumId === tract.id ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
                                        </button>
                                        <button
                                          onClick={() => setEditingTractNumId(null)}
                                          disabled={savingTractNumId === tract.id}
                                          title="Cancel"
                                          className="p-1.5 rounded bg-gg-gray-800 text-gg-gray-300 border border-gg-gray-700 hover:bg-gg-gray-700 disabled:opacity-50">
                                          <X size={16} />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5">
                                        <p className="text-2xl text-white font-extrabold tracking-tight">
                                          Tract {tract.tract_number}
                                        </p>
                                        <button
                                          onClick={() => { setEditingTractNumId(tract.id); setTractNumDraft(String(tract.tract_number ?? '')) }}
                                          title="Edit tract number (use if a rescrape pulled it in wrong)"
                                          className="p-1 rounded text-gg-gray-400 hover:text-gg-pink hover:bg-gg-gray-800">
                                          <Pencil size={14} />
                                        </button>
                                      </div>
                                    )}
                                    {reviewed && (
                                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-green-500/15 text-green-600 border border-green-500/40">
                                        <CheckCircle2 size={12} /> Reviewed
                                      </span>
                                    )}
                                    {tract.boundary_valid === false && (
                                      <span className="text-[11px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 border border-amber-500/40">
                                        Acreage check
                                      </span>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    disabled={mapDisabled}
                                    title={mapDisabled ? 'No location available for this tract' : 'Open this tract on the Explore map'}
                                    onClick={() => {
                                      const params = new URLSearchParams({
                                        focusLat: String(fLat), focusLng: String(fLng), focusZoom: '15',
                                      })
                                      window.open(`/access?${params.toString()}`, '_blank')
                                    }}
                                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors shadow-sm ${
                                      mapDisabled ? 'bg-gg-gray-800 text-gg-gray-600 cursor-not-allowed' : 'bg-gg-pink text-white hover:bg-gg-pink-light'
                                    }`}
                                  >
                                    <MapPin size={14} /> View on Map
                                  </button>
                                </div>

                                {/* Read-only data summary */}
                                <div className="flex flex-wrap gap-x-5 gap-y-1 mb-2 text-xs text-gg-gray-400">
                                  <span>Total: <span className="text-white font-medium">{tract.total_acres != null ? `${tract.total_acres.toFixed(1)} ac` : '—'}</span></span>
                                  <span>Tillable: <span className="text-white font-medium">{tract.tillable_acres != null ? `${tract.tillable_acres.toFixed(1)} ac` : '—'}</span></span>
                                  <span>Soil: <span className="text-white font-medium">{tract.soil_rating != null ? `${tract.soil_rating.toFixed(1)} ${tract.soil_rating_type || ''}` : '—'}</span></span>
                                  <span>Polygon: <span className="text-white font-medium">{ring && ring.length ? `${ring.length} pts` : 'none'}</span></span>
                                </div>

                                {actionable ? (
                                  <>
                                    {proposals[tract.id] && (
                                      <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-sky-500/10 border border-sky-500/40 rounded-lg text-sky-700 text-xs">
                                        <RefreshCw size={13} className="flex-shrink-0 mt-0.5" />
                                        <span>
                                          Rescrape proposed a boundary: {proposals[tract.id].coords.length} pts
                                          {proposals[tract.id].proposed_acres != null && ` · ${proposals[tract.id].proposed_acres!.toFixed(1)} ac`}
                                          {proposals[tract.id].pct_difference != null && ` (${proposals[tract.id].pct_difference}% vs listed ${proposals[tract.id].reported_acres ?? '—'} ac)`}
                                          {proposals[tract.id].source && ` · ${proposals[tract.id].source}`}.
                                          {' '}It&apos;s loaded on the map as an unsaved edit — eyeball it against the source, then <b>Save</b> to apply, or <b>Cancel</b> to discard.
                                        </span>
                                      </div>
                                    )}
                                    {/* LIVE-TRACT boundary editor — saves ONLY the polygon via
                                        the restricted tract-fix-boundary/apply endpoint. */}
                                    <TractMapEditor
                                      stagingId={0}
                                      tractIndex={0}
                                      liveTractId={tract.id}
                                      tractNumber={tract.tract_number}
                                      // Pass the listing's full tract list so an Upload Image
                                      // routes through the VALIDATED multi-tract overview tracer
                                      // (same as the Auction/PT staging screens) instead of the
                                      // weaker legacy full-image color trace.
                                      siblingTracts={loaded.tracts.map((t) => ({
                                        tract_number: t.tract_number ?? null,
                                        total_acres: t.total_acres ?? null,
                                        tillable_acres: t.tillable_acres ?? null,
                                      }))}
                                      initialPolygon={ring}
                                      proposedPolygon={proposals[tract.id]?.coords ?? null}
                                      proposedNonce={proposals[tract.id]?.nonce ?? 0}
                                      hideTillable
                                      tillablePolygon={null}
                                      showTillable={false}
                                      sourceImageUrl={tract.image_url || loaded.primary_image_url}
                                      sourceImageKind="listing_image"
                                      listingUrl={loaded.source_url || it.source_url}
                                      listingState={tract.state_abbr || it.state}
                                      listingAddress={loaded.address}
                                      scrapedAcres={tract.total_acres}
                                      latitude={tract.latitude}
                                      longitude={tract.longitude}
                                      onUpdate={(updated) => {
                                        patchTract(it.listing_id, tract.id, {
                                          polygon_coordinates: updated.polygon_coordinates ?? ring,
                                          boundary_valid: updated.boundary_valid ?? tract.boundary_valid,
                                        })
                                        // Proposal applied → clear it so the banner disappears.
                                        setProposals((prev) => {
                                          if (!prev[tract.id]) return prev
                                          const next = { ...prev }; delete next[tract.id]; return next
                                        })
                                        setCluReloadKeys((prev) => ({ ...prev, [tractKey]: (prev[tractKey] || 0) + 1 }))
                                      }}
                                      onDirtyChange={(d) => setTractDirty(`${it.listing_id}::${tract.id}::map`, d)}
                                    />
                                    {/* FSA-CLU tillable workshop — live published-tract mode. */}
                                    <TillableCluWorkshop
                                      tractId={tract.id}
                                      reloadKey={cluReloadKeys[tractKey] || 0}
                                      latitude={tract.latitude}
                                      longitude={tract.longitude}
                                      onSaved={(r) => {
                                        patchTract(it.listing_id, tract.id, {
                                          tillable_acres: r.tillable_acres ?? tract.tillable_acres,
                                          soil_rating: r.soil_rating ?? tract.soil_rating,
                                          soil_rating_type: r.soil_rating_type ?? tract.soil_rating_type,
                                        })
                                      }}
                                      onDirtyChange={(d) => setTractDirty(`${it.listing_id}::${tract.id}::till`, d)}
                                    />
                                    {/* Done = human confirmed polygon + tillable + soil. */}
                                    <div className="flex items-center gap-3 mt-3">
                                      <button
                                        onClick={() => toggleReviewed(it.listing_id, tract)}
                                        disabled={reviewingTractId === tract.id}
                                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 ${
                                          reviewed
                                            ? 'bg-green-600 text-white hover:bg-green-700'
                                            : 'bg-gg-gray-800 text-white border border-gg-gray-700 hover:bg-gg-gray-700'
                                        }`}
                                      >
                                        {reviewingTractId === tract.id
                                          ? <Loader2 className="animate-spin" size={16} />
                                          : <CheckCircle2 size={16} />}
                                        {reviewed ? 'Reviewed ✓ (click to undo)' : 'Mark tract reviewed'}
                                      </button>
                                      {reviewed && tract.boundary_reviewed_at && (
                                        <span className="text-xs text-gg-gray-500">
                                          {new Date(tract.boundary_reviewed_at).toLocaleString()}
                                        </span>
                                      )}
                                    </div>
                                  </>
                                ) : (
                                  <div className="text-sm text-gg-gray-500 italic py-2">
                                    Editors locked — {it.state || 'this state'} soil mapping pending.
                                  </div>
                                )}
                              </div>
                            )
                          })}

                          {/* Listing-level Verify — finalize once every tract has
                              been updated + saved. Marks ALL tracts Reviewed and
                              flips the workflow status to Done. Does NOT touch
                              polygon/tillable/soil (those save on their own editors). */}
                          {(() => {
                            const allReviewed = loaded.tracts.every((t) => !!t.boundary_reviewed_by)
                            const hasUnsaved = listingHasUnsaved(it.listing_id)
                            return (
                              <div className="flex items-center justify-end gap-3 border-t border-gg-gray-800 pt-4">
                                {hasUnsaved && (
                                  <span className="text-xs text-orange-400 inline-flex items-center gap-1">
                                    <AlertTriangle size={13} /> Save all tract edits first
                                  </span>
                                )}
                                {!hasUnsaved && allReviewed && (
                                  <span className="text-xs text-green-600 inline-flex items-center gap-1">
                                    <CheckCircle2 size={13} /> All tracts reviewed
                                  </span>
                                )}
                                <button
                                  onClick={() => verifyListing(it.listing_id)}
                                  disabled={verifyingId === it.listing_id || hasUnsaved}
                                  title={hasUnsaved
                                    ? 'Save all tract edits first'
                                    : 'Mark every tract on this listing Reviewed and set the listing to Done'}
                                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                >
                                  {verifyingId === it.listing_id
                                    ? <Loader2 className="animate-spin" size={16} />
                                    : <CheckCircle2 size={16} />}
                                  Verify Listing
                                </button>
                              </div>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {items.length === 0 && (
              <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-6 text-gg-gray-400 text-center">
                No listings match these filters.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg px-4 py-3">
      <div className="text-2xl font-bold text-white">{value.toLocaleString()}</div>
      <div className="text-xs text-gg-gray-400 mt-0.5">{label}</div>
    </div>
  )
}
