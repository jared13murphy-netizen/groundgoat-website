'use client'

// Force dynamic rendering — admin pages must never be cached at the edge
// (a 1-year static HTML cache would pin an old JS bundle hash after redeploy).
export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Loader2, ExternalLink, MapPin, ChevronLeft, ChevronRight,
  ChevronDown, ChevronUp, CheckCircle2, ArrowLeft, AlertTriangle, RefreshCw,
  Pencil, Check, X, Plus, Trash2,
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { formatAcres } from '@/lib/format'
import CompanyLinkEditor, { type CompanyOption } from '@/components/admin/CompanyLinkEditor'
import openListingReport from '@/lib/openListingReport'
import TractMapEditor from '@/components/admin/TractMapEditor'
import TillableCluWorkshop from '@/components/admin/TillableCluWorkshop'
import LandTypeButtons from '@/components/admin/LandTypeButtons'
import TractDataCompare from '@/components/admin/TractDataCompare'
import SwapTractsPanel from '@/components/admin/SwapTractsPanel'
import SaleStatusChips from '@/components/admin/SaleStatusChips'
import { toRings } from '@/lib/polygonRings'
import ConfirmDeleteTractModal from '@/components/admin/ConfirmDeleteTractModal'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

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
  sale_status: string | null
  sale_price: number | null
  price_per_acre: number | null
  price_per_tillable_acre: number | null
  price_per_soil_rating: number | null
  price_basis: 'per_acre' | 'lump_sum' | null
  has_house: boolean | null
  has_buildings: boolean | null
  land_types: string[] | null
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
  image_base64: string | null
}

// $ formatter for the read-only derived stats (— when null/blank).
const fmtMoney = (v: number | null | undefined) =>
  v == null ? '—' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

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

  // Listing-company picker (fix an "Unknown Company" listing). These edit
  // PUBLISHED listings, so the save goes to the tract-cleanup company endpoint.
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [editingCompanyId, setEditingCompanyId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchWithAuth(`${API_URL}/api/companies`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled || !Array.isArray(data)) return
        setCompanies(data.map((c: any) => ({ id: c.id, name: c.name })))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
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
  // Per-tract discard signal ("Collapse anyway" confirms below), same shape
  // as cluReloadKeys ("${listingId}-${tractId}" -> nonce). Bumped when the
  // admin confirms discarding a dirty tract's edits so TractMapEditor and
  // TractDataCompare revert their local edited state back to server truth —
  // a tract's body stays mounted-but-hidden when just that tract is
  // collapsed (CSS `hidden`, not unmounted — same MapLibre zero-height-race
  // reason as the staging screens), so without this the editors would keep
  // reporting dirty forever.
  const [discardNonces, setDiscardNonces] = useState<Record<string, number>>({})
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

  // Completeness validation state for published listings.
  // enforce=false → amber advisory, never blocks Verify. enforce=true → also disables Verify.
  const [validateResults, setValidateResults] = useState<Record<string, { items: any[]; enforce: boolean; loading: boolean }>>({})
  const fetchValidation = async (id: string) => {
    setValidateResults(prev => ({ ...prev, [id]: { items: prev[id]?.items ?? [], enforce: prev[id]?.enforce ?? false, loading: true } }))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/listings/${id}/validate`)
      if (res.ok) {
        const data = await res.json()
        setValidateResults(prev => ({ ...prev, [id]: { items: data.items ?? [], enforce: data.enforce ?? false, loading: false } }))
      } else {
        setValidateResults(prev => ({ ...prev, [id]: { items: prev[id]?.items ?? [], enforce: prev[id]?.enforce ?? false, loading: false } }))
      }
    } catch {
      setValidateResults(prev => ({ ...prev, [id]: { items: prev[id]?.items ?? [], enforce: prev[id]?.enforce ?? false, loading: false } }))
    }
  }

  // Per-tract expand/collapse. Key: tract.id. Default: all collapsed.
  const [openTractIds, setOpenTractIds] = useState<Set<string>>(new Set())
  const toggleTract = (lid: string, id: string) => {
    const isOpen = openTractIds.has(id)
    if (isOpen) {
      // Collapsing — the tract body stays mounted-but-hidden (CSS `hidden`),
      // so check for unsaved edits and offer to discard, same as the
      // staging screens.
      const dirtyPrefix = `${lid}::${id}::`
      const hasDirty = Object.keys(dirtyTracts).some(k => k.startsWith(dirtyPrefix) && dirtyTracts[k])
      if (hasDirty) {
        if (!window.confirm('Unsaved changes on this tract will be discarded. Collapse anyway?')) {
          return
        }
        // Confirmed discard: tell the tract editors to revert their local
        // edited state to server truth (TractMapEditor + TractDataCompare via
        // discardNonce, TillableCluWorkshop via its existing reloadKey — a
        // re-fetch resets its own dirty flag), then clear the dirty keys
        // immediately so Verify/Done unblocks right away instead of waiting
        // for the editors' effects to report back.
        const key = `${lid}-${id}`
        setDiscardNonces(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }))
        setCluReloadKeys(prev => ({ ...prev, [key]: (prev[key] || 0) + 1 }))
        setDirtyTracts(prev => {
          const next = { ...prev }
          Object.keys(next).forEach(k => { if (k.startsWith(dirtyPrefix)) delete next[k] })
          return next
        })
      }
    }
    setOpenTractIds(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id); else s.add(id)
      return s
    })
  }

  // Per-tract in-flight marker for the Mark Reviewed button.
  const [reviewingTractId, setReviewingTractId] = useState<string | null>(null)
  // Editable tract number: which tract is being edited, its draft value, and
  // an in-flight marker. Saving writes ONLY tract_number via a restricted endpoint.
  const [editingTractNumId, setEditingTractNumId] = useState<string | null>(null)
  const [tractNumDraft, setTractNumDraft] = useState('')
  const [savingTractNumId, setSavingTractNumId] = useState<string | null>(null)
  // Listing-level Verify: in-flight marker for the whole-listing verify button.
  const [verifyingId, setVerifyingId] = useState<string | null>(null)
  // Delete & Rescrape (destructive clean re-scrape). Target = the row awaiting
  // confirmation in the modal; deleteRescrapingId = the row mid-request.
  const [deleteRescrapeTarget, setDeleteRescrapeTarget] = useState<QueueItem | null>(null)
  const [deleteRescrapingId, setDeleteRescrapingId] = useState<string | null>(null)
  // Per-tract delete (ConfirmDeleteTractModal). Data Cleanup only ever shows
  // published tracts (real DB id), so this always hits DELETE /api/tracts/{id}
  // then refetches the listing to refresh the tract list + rollups.
  const [deleteTractTarget, setDeleteTractTarget] = useState<{ listingId: string; tract: LiveTract } | null>(null)
  const [deleteTractLoading, setDeleteTractLoading] = useState(false)
  const [deleteTractError, setDeleteTractError] = useState<string | null>(null)
  async function confirmDeleteTract() {
    if (!deleteTractTarget) return
    const { listingId, tract } = deleteTractTarget
    setDeleteTractLoading(true)
    setDeleteTractError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`
        throw new Error(String(detail))
      }
      setDeleteTractTarget(null)
      await loadListing(listingId)
      fetchValidation(listingId)
    } catch (e: any) {
      setDeleteTractError(e.message || 'Failed to delete tract')
    } finally {
      setDeleteTractLoading(false)
    }
  }
  // Which staging screen the fresh scrape should land on. Defaults to the
  // listing's current type but is overridable in the modal — a listing's type
  // can change (e.g. an unsold auction relisted as a private treaty).
  const [rescrapeAsType, setRescrapeAsType] = useState<'auction' | 'private_treaty'>('auction')
  // Proposed boundaries keyed by tract id; bumping `nonce` makes that tract's
  // TractMapEditor load the proposed boundary as a dirty edit for review.
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
        sale_status: t.sale_status ?? null,
        sale_price: t.sale_price != null ? Number(t.sale_price) : null,
        price_per_acre: t.price_per_acre != null ? Number(t.price_per_acre) : null,
        price_per_tillable_acre: t.price_per_tillable_acre != null ? Number(t.price_per_tillable_acre) : null,
        price_per_soil_rating: t.price_per_soil_rating != null ? Number(t.price_per_soil_rating) : null,
        price_basis: t.price_basis ?? null,
        has_house: t.has_house ?? null,
        has_buildings: t.has_buildings ?? null,
        land_types: Array.isArray(t.land_types) ? t.land_types : (t.land_type ? [t.land_type] : []),
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
        image_base64: null,
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
    if (expandedId === lid) {
      // Collapsing — check if any tract under this listing has unsaved edits.
      const dirtyPrefix = `${lid}::`
      const dirtyKeysHere = Object.keys(dirtyTracts).filter(k => k.startsWith(dirtyPrefix) && dirtyTracts[k])
      if (dirtyKeysHere.length > 0 && !window.confirm('Unsaved changes on one or more tracts will be discarded. Collapse anyway?')) {
        return
      }
      if (dirtyKeysHere.length > 0) {
        // Confirmed discard: bump discard/reload nonces for every dirty
        // tract under this listing (the whole editor block unmounts right
        // after, which also clears dirty via each editor's own unmount
        // cleanup — this just makes the clear immediate/explicit rather
        // than depending on unmount-effect ordering) and clear dirtyTracts
        // right away so Verify Listing / each tract's Done button unblock
        // without waiting a render cycle.
        const tractIds = new Set(dirtyKeysHere.map(k => k.slice(dirtyPrefix.length).split('::')[0]))
        setDiscardNonces(prev => {
          const next = { ...prev }
          tractIds.forEach(tid => { const key = `${lid}-${tid}`; next[key] = (next[key] || 0) + 1 })
          return next
        })
        setCluReloadKeys(prev => {
          const next = { ...prev }
          tractIds.forEach(tid => { const key = `${lid}-${tid}`; next[key] = (next[key] || 0) + 1 })
          return next
        })
        setDirtyTracts(prev => {
          const next = { ...prev }
          Object.keys(next).forEach(k => { if (k.startsWith(dirtyPrefix)) delete next[k] })
          return next
        })
      }
      setExpandedId(null)
      return
    }
    setExpandedId(lid)
    if (!loadedListings[lid] || loadedListings[lid].error) loadListing(lid)
    // Fetch completeness validation for the amber advisory
    if (!validateResults[lid]) fetchValidation(lid)
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

  // Edit 3: TractDataCompare on Data Clean-Up. For each tract we hold the
  // freshly-COMPUTED values (acres from the map editor's live polygon, tillable
  // + soil from the CLU workshop's Compute) and the per-field source PICK. The
  // left "Current (saved)" column is the live DB value; choosing Computed or
  // typing a Manual value writes through update_tract (PATCH /api/tracts/{id}),
  // which reconciles $/acre + rolls listing totals via recalculate_listing_totals.
  const [computedVals, setComputedVals] = useState<Record<string, {
    acres?: number | null; tillable_acres?: number | null
    soil_rating?: number | null; soil_rating_type?: string | null
  }>>({})
  const [chosenVals, setChosenVals] = useState<Record<string, {
    acres?: 'scraped' | 'computed' | null
    tillable_acres?: 'scraped' | 'computed' | null
    soil_rating?: 'scraped' | 'computed' | null
  }>>({})

  function setComputedField(tractId: string, patch: Record<string, number | string | null>) {
    setComputedVals((prev) => ({ ...prev, [tractId]: { ...(prev[tractId] || {}), ...patch } }))
  }

  // Save resolved field(s) to a live tract through the canonical update_tract
  // endpoint, then optimistically reflect locally. Fields use DB column names
  // (total_acres / tillable_acres / soil_rating / soil_rating_type).
  async function saveTractFields(lid: string, tract: LiveTract, fields: Record<string, any>) {
    if (!Object.keys(fields).length) return
    // GUARD: never let an acre change touch a recorded price until the admin has
    // declared which price is the truth. Block the edit client-side with a clear
    // prompt (the backend also rejects it as a hard backstop).
    const changingAcres = 'total_acres' in fields && fields.total_acres != null
    const needsBasis = ['sold', 'pending', 'no_sale'].includes(String(tract.sale_status || ''))
    if (changingAcres && needsBasis && !tract.price_basis && fields.price_basis == null) {
      alert('Before changing this sold tract’s acres, choose which price is correct — the total price or the $/acre — using the "Which price is correct?" selector above. That keeps the price from being changed incorrectly.')
      patchTract(lid, tract.id, { total_acres: tract.total_acres })  // revert optimistic
      return
    }
    patchTract(lid, tract.id, fields as Partial<LiveTract>)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({})))?.detail || `HTTP ${res.status}`
        if (String(detail).includes('PRICE_BASIS_REQUIRED')) {
          throw new Error('Choose which price is correct (total or $/acre) before changing this tract’s acres.')
        }
        throw new Error(String(detail))
      }
      // The PATCH reconciles the price triangle + rolls listing totals, so the
      // response carries the recomputed $/x. Reflect them so the read-only
      // panel updates immediately when acres / tillable / price changed.
      const u = await res.json().catch(() => null)
      if (u) {
        patchTract(lid, tract.id, {
          total_acres: u.total_acres != null ? Number(u.total_acres) : null,
          tillable_acres: u.tillable_acres != null ? Number(u.tillable_acres) : null,
          soil_rating: u.soil_rating != null ? Number(u.soil_rating) : null,
          soil_rating_type: u.soil_rating_type ?? null,
          sale_status: u.sale_status ?? null,
          sale_price: u.sale_price != null ? Number(u.sale_price) : null,
          price_per_acre: u.price_per_acre != null ? Number(u.price_per_acre) : null,
          price_per_tillable_acre: u.price_per_tillable_acre != null ? Number(u.price_per_tillable_acre) : null,
          price_per_soil_rating: u.price_per_soil_rating != null ? Number(u.price_per_soil_rating) : null,
          price_basis: u.price_basis ?? null,
        })
      }
      fetchValidation(lid)
    } catch (e: any) {
      alert(`Could not save tract value: ${e.message || e}`)
      loadListing(lid) // reload to revert the optimistic patch
    }
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
      fetchValidation(lid)
    } catch (e: any) {
      alert(`Could not update tract number: ${e.message || e}`)
    } finally { setSavingTractNumId(null) }
  }

  // Per-tract "House on this tract" — saves immediately via the tract PATCH
  // (update_tract). (Per user 2026-06-05: the staging screens need an editable
  // Has House checkbox that saves correctly.)
  async function saveTractHasHouse(lid: string, tract: LiveTract, next: boolean) {
    // optimistic
    setLoadedListings((prev) => {
      const cur = prev[lid]
      if (!cur) return prev
      const tracts = cur.tracts.map((t) => (t.id === tract.id ? { ...t, has_house: next } : t))
      return { ...prev, [lid]: { ...cur, tracts } }
    })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ has_house: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e: any) {
      // revert on failure
      setLoadedListings((prev) => {
        const cur = prev[lid]
        if (!cur) return prev
        const tracts = cur.tracts.map((t) => (t.id === tract.id ? { ...t, has_house: !next } : t))
        return { ...prev, [lid]: { ...cur, tracts } }
      })
      showToast(`Could not save House flag: ${e.message || e}`, 'error')
      return
    }
    // A house on the tract implies a Residential land type — keep them in sync.
    const cur = (tract.land_types || []).filter(Boolean)
    const hasRes = cur.includes('Residential')
    if (next && !hasRes) saveTractLandTypes(lid, tract, [...cur, 'Residential'])
    else if (!next && hasRes) saveTractLandTypes(lid, tract, cur.filter((t) => t !== 'Residential'))
  }

  // Per-tract "Buildings on this tract" — saves immediately via the tract PATCH.
  async function saveTractHasBuilding(lid: string, tract: LiveTract, next: boolean) {
    setLoadedListings((prev) => {
      const cur = prev[lid]
      if (!cur) return prev
      const tracts = cur.tracts.map((t) => (t.id === tract.id ? { ...t, has_buildings: next } : t))
      return { ...prev, [lid]: { ...cur, tracts } }
    })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ has_buildings: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e: any) {
      setLoadedListings((prev) => {
        const cur = prev[lid]
        if (!cur) return prev
        const tracts = cur.tracts.map((t) => (t.id === tract.id ? { ...t, has_buildings: !next } : t))
        return { ...prev, [lid]: { ...cur, tracts } }
      })
      showToast(`Could not save Buildings flag: ${e.message || e}`, 'error')
    }
  }

  // Per-tract Land Types — saves immediately via the tract PATCH (update_tract
  // syncs the legacy land_type singular server-side).
  async function saveTractLandTypes(lid: string, tract: LiveTract, next: string[]) {
    const prevTypes = tract.land_types
    setLoadedListings((prev) => {
      const cur = prev[lid]
      if (!cur) return prev
      const tracts = cur.tracts.map((t) => (t.id === tract.id ? { ...t, land_types: next } : t))
      return { ...prev, [lid]: { ...cur, tracts } }
    })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ land_types: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      fetchValidation(lid)
    } catch (e: any) {
      setLoadedListings((prev) => {
        const cur = prev[lid]
        if (!cur) return prev
        const tracts = cur.tracts.map((t) => (t.id === tract.id ? { ...t, land_types: prevTypes } : t))
        return { ...prev, [lid]: { ...cur, tracts } }
      })
      showToast(`Could not save land types: ${e.message || e}`, 'error')
    }
  }

  // Add a new empty tract to a listing — seeds location from a sibling tract so
  // the map opens near the others; everything else is blank until the admin
  // draws the boundary. create_tract recalcs listing totals server-side.
  const [addingTractFor, setAddingTractFor] = useState<string | null>(null)
  async function addTractToListing(lid: string) {
    const cur = loadedListings[lid]
    if (!cur || addingTractFor) return
    setAddingTractFor(lid)
    try {
      const nums = cur.tracts.map((t) => t.tract_number || 0)
      const nextNum = (nums.length ? Math.max(...nums) : 0) + 1
      const sib = cur.tracts.find((t) => t.latitude != null && t.longitude != null)
      const res = await fetchWithAuth(`${API_URL}/api/listings/${lid}/tracts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tract_number: nextNum }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const created = await res.json()
      if (created?.id && sib?.latitude != null && sib?.longitude != null) {
        await fetchWithAuth(`${API_URL}/api/tracts/${created.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: sib.latitude, longitude: sib.longitude }),
        })
      }
      await loadListing(lid)
      fetchValidation(lid)
      showToast(`Tract ${nextNum} added — draw its boundary to compute acres/soil.`, 'success')
    } catch (e: any) {
      showToast(`Could not add tract: ${e.message || e}`, 'error')
    } finally {
      setAddingTractFor(null)
    }
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
      const opened = await openListingReport(lid, { force: true })
      if (!opened) {
        showToast('Listing verified, but the PDF could not be regenerated — open the report manually from the Edit Listing screen.', 'error')
      }
    } catch (e: any) {
      showToast(`Could not verify listing: ${e.message || e}`, 'error')
    } finally { setVerifyingId(null) }
  }

  // DESTRUCTIVE: delete this listing and re-scrape its URL from scratch into
  // Staging. Confirmed via the modal. Removes the row on success.
  async function deleteAndRescrape(item: QueueItem) {
    const lid = item.listing_id
    setDeleteRescrapingId(lid)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/${lid}/delete-and-rescrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_type: rescrapeAsType }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.detail || `HTTP ${res.status}`)
      if (expandedId === lid) setExpandedId(null)
      setItems((prev) => prev.filter((i) => i.listing_id !== lid))
      setTotal((prev) => Math.max(0, prev - 1))
      setDeleteRescrapeTarget(null)
      showToast(
        data.rescrape_started
          ? 'Listing deleted. Re-scraping now — it will appear in Auction/PT Staging for review in a few minutes.'
          : 'Listing deleted, but the re-scrape did not start. Re-scrape the URL manually from the Scraper page.',
        data.rescrape_started ? 'success' : 'error',
      )
    } catch (e: any) {
      showToast(`Delete & Rescrape failed: ${e.message || e}`, 'error')
    } finally {
      setDeleteRescrapingId(null)
    }
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
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
            <StatCard label="Listings to verify" value={stats.listings - (stats.by_status?.done ?? 0)} />
            <StatCard label="Tracts to verify (active states)" value={stats.tracts_to_verify} />
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
                      {editingCompanyId === it.listing_id ? (
                        <div className="mb-1" onClick={(e) => e.stopPropagation()}>
                          <CompanyLinkEditor
                            companies={companies}
                            onPick={async (c) => {
                              const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/${it.listing_id}/company`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ listing_company_id: c.id }),
                              })
                              const d = await res.json()
                              if (!res.ok || !d.success) throw new Error(d.detail || `HTTP ${res.status}`)
                              patchRow(it.listing_id, { company_name: d.company_name || c.name })
                              setEditingCompanyId(null)
                              fetchValidation(it.listing_id)
                            }}
                            onClose={() => setEditingCompanyId(null)}
                          />
                        </div>
                      ) : (
                        <p className="text-lg font-bold text-white truncate max-w-xl leading-tight flex items-center gap-2">
                          {it.company_name
                            ? <span className="truncate">{it.company_name}</span>
                            : <span className="text-orange-400">Unknown Company</span>}
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingCompanyId(it.listing_id) }}
                            title="Link a listing company"
                            className="text-gg-gray-400 hover:text-gg-pink shrink-0"
                          >
                            <Pencil size={14} />
                          </button>
                        </p>
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
                      {/* Open this listing in the full Edit Listing screen. */}
                      <Link
                        href={`/admin/listings/${it.listing_id}`}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border border-gg-gray-700 bg-gg-gray-800 text-white hover:bg-gg-gray-700"
                      >
                        <Pencil size={13} />
                        Edit Listing
                      </Link>
                      {/* DESTRUCTIVE: delete the listing and re-scrape its URL
                          from scratch into Staging. For listings whose scraped
                          data is wrong end-to-end. Confirmed via modal. */}
                      <button
                        onClick={() => {
                          setRescrapeAsType(it.listing_type === 'private_treaty' ? 'private_treaty' : 'auction')
                          setDeleteRescrapeTarget(it)
                        }}
                        disabled={deleteRescrapingId === it.listing_id || !it.source_url}
                        title={it.source_url ? 'Delete this listing and re-scrape the URL from scratch (clean slate)' : 'No source URL to rescrape'}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleteRescrapingId === it.listing_id
                          ? <Loader2 className="animate-spin" size={13} />
                          : <Trash2 size={13} />}
                        Delete &amp; Rescrape
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

                      {loaded && !loaded.loading && !loaded.error && loaded.tracts.length === 0 && (
                        <div className="text-gg-gray-400 text-sm py-4">This listing has no tracts.</div>
                      )}

                      {/* Swap Tracts — only shown when >= 2 live tracts are loaded */}
                      {loaded && !loaded.loading && loaded.tracts.length >= 2 && (
                        <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-700/40 rounded-lg">
                          <p className="text-xs text-gray-900 mb-2">
                            <strong>Tract data mismatched?</strong> If you changed a tract number and the acres, soil rating, or polygon are now on the wrong tract, use Swap Tracts to fix it.
                          </p>
                          <SwapTractsPanel
                            listingId={it.listing_id}
                            tracts={loaded.tracts.map((t) => ({
                              id: t.id,
                              tract_number: t.tract_number,
                              total_acres: t.total_acres,
                            }))}
                            onSwapped={() => { loadListing(it.listing_id); fetchValidation(it.listing_id) }}
                          />
                        </div>
                      )}

                      {loaded && !loaded.loading && loaded.tracts.length > 0 && (
                        <div className="space-y-6">
                          {loaded.tracts.map((tract) => {
                            const tractKey = `${it.listing_id}-${tract.id}`
                            const reviewed = !!tract.boundary_reviewed_by
                            // View on Map target: polygon centroid → tract coord → null.
                            // flatMap through toRings so a multi-ring tract averages
                            // points across ALL its pieces instead of iterating the
                            // outer ring-list as if it were one flat ring (every
                            // point would then fail Number.isFinite and silently
                            // fall back to tract lat/lng).
                            let fLat: number | null = tract.latitude
                            let fLng: number | null = tract.longitude
                            // Raw polygon_coordinates (single ring OR multi-ring list)
                            // — kept as-is for the point-count badge below and for
                            // initialPolygon, which accepts either shape directly.
                            const ring = tract.polygon_coordinates
                            const allPts = toRings(ring).flat()
                            if (allPts.length) {
                              let sx = 0, sy = 0, n = 0
                              for (const p of allPts) {
                                if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
                                  sx += p[0]; sy += p[1]; n++
                                }
                              }
                              if (n) { fLng = sx / n; fLat = sy / n }
                            }
                            const mapDisabled = fLat == null || fLng == null
                            // Price basis only applies to result-recorded auctions (sold / pending /
                            // no_sale). Listed / Live (asking-price) tracts skip it entirely. When a
                            // result tract has no basis yet, ALL editing is gated until it's picked.
                            const needsBasis = ['sold', 'pending', 'no_sale'].includes(String(tract.sale_status || ''))
                            // Only an EXACT valid basis unlocks editing — any other value (null, '', junk) gates.
                            const hasValidBasis = tract.price_basis === 'per_acre' || tract.price_basis === 'lump_sum'
                            const basisGate = needsBasis && !hasValidBasis
                            // The basis question block — loud colors, shown for result-recorded tracts.
                            const basisBlock = needsBasis ? (
                              <div className={`mb-4 rounded-lg border-2 px-4 py-3 text-center ${tract.price_basis ? 'border-gg-gray-700 bg-gg-gray-900' : 'border-amber-400 bg-amber-400/15'}`}>
                                <div className="flex items-center justify-center gap-3 flex-wrap">
                                  <span className={`text-sm font-bold ${tract.price_basis ? 'text-white' : 'text-amber-300'}`}>
                                    {tract.price_basis
                                      ? 'Which price is correct?'
                                      : '⚠ First, which price is correct for this sale?'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => saveTractFields(it.listing_id, tract, { price_basis: 'lump_sum' })}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                                    style={tract.price_basis === 'lump_sum'
                                      ? { backgroundColor: '#c563ad', color: '#ffffff', border: '2px solid #000000' }
                                      : { backgroundColor: '#2a2a2a', color: '#bbbbbb' }}
                                  >
                                    {tract.price_basis === 'lump_sum' ? '✓ ' : ''}Total price is correct
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => saveTractFields(it.listing_id, tract, { price_basis: 'per_acre' })}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
                                    style={tract.price_basis === 'per_acre'
                                      ? { backgroundColor: '#c563ad', color: '#ffffff', border: '2px solid #000000' }
                                      : { backgroundColor: '#2a2a2a', color: '#bbbbbb' }}
                                  >
                                    {tract.price_basis === 'per_acre' ? '✓ ' : ''}$/acre is correct
                                  </button>
                                </div>
                                {/* Current values to help decide which price is correct. */}
                                <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-gg-gray-400">
                                  <span>Total price: <span className="text-white font-semibold">{fmtMoney(tract.sale_price)}</span></span>
                                  <span>$/acre: <span className="text-white font-semibold">{fmtMoney(tract.price_per_acre)}</span></span>
                                  <span>Saved acres: <span className="text-white font-semibold">{tract.total_acres != null ? `${formatAcres(tract.total_acres)} ac` : '—'}</span></span>
                                </div>
                                <p className="text-[11px] text-gg-gray-400 mt-1.5">
                                  {tract.price_basis === 'per_acre'
                                    ? 'Locked: $/acre. Changing acres will recompute the TOTAL price.'
                                    : tract.price_basis === 'lump_sum'
                                    ? 'Locked: total price. Changing acres will recompute the $/acre.'
                                    : 'You must answer this before editing the polygon, tillable, or acres.'}
                                </p>
                              </div>
                            ) : null
                            // Read-only stat box — dark, centered, shown down by the action button.
                            const statsBox = (
                              <div className="flex-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 rounded-lg bg-gg-gray-900 border border-gg-gray-800 px-4 py-3 text-xs text-gg-gray-300 text-center">
                                <span>Total: <span className="text-white font-medium">{tract.total_acres != null ? `${formatAcres(tract.total_acres)} ac` : '—'}</span></span>
                                <span>Tillable: <span className="text-white font-medium">{tract.tillable_acres != null ? `${formatAcres(tract.tillable_acres)} ac` : '—'}</span></span>
                                <span>Soil: <span className="text-white font-medium">{tract.soil_rating != null ? `${tract.soil_rating.toFixed(1)} ${tract.soil_rating_type || ''}` : '—'}</span></span>
                                <span>Sale: <span className="text-white font-medium">{tract.sale_status ? tract.sale_status.replace('_', ' ') : '—'}</span></span>
                                <span>Sold price: <span className="text-white font-medium">{fmtMoney(tract.sale_price)}</span></span>
                                <span>$/acre: <span className="text-white font-medium">{fmtMoney(tract.price_per_acre)}</span></span>
                                <span>$/tillable: <span className="text-white font-medium">{fmtMoney(tract.price_per_tillable_acre)}</span></span>
                                <span>$/soil pt: <span className="text-white font-medium">{fmtMoney(tract.price_per_soil_rating)}</span></span>
                                <span>Polygon: <span className="text-white font-medium">{ring && ring.length ? `${ring.length} pts` : 'none'}</span></span>
                              </div>
                            )
                            const tractIsOpen = openTractIds.has(tract.id)
                            const dcStatus = tract.sale_status ?? null
                            const dcStatusCls =
                              dcStatus === 'sold'    ? 'bg-green-500/15 text-green-400 border border-green-500/40' :
                              dcStatus === 'pending' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/40' :
                              dcStatus === 'live'    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/40' :
                              dcStatus === 'no_sale' ? 'bg-red-500/15 text-red-400 border border-red-500/40' :
                              dcStatus              ? 'bg-gg-gray-700 text-gg-gray-300 border border-gg-gray-600' : ''
                            const dcSummaryParts = [
                              tract.total_acres != null ? `${formatAcres(tract.total_acres)} ac` : null,
                              tract.price_per_acre != null ? `$${Number(tract.price_per_acre).toLocaleString(undefined, { maximumFractionDigits: 0 })}/ac` : null,
                              tract.sale_price != null ? `$${Number(tract.sale_price).toLocaleString(undefined, { maximumFractionDigits: 0 })} total` : null,
                            ].filter(Boolean).join(' · ')
                            return (
                              <div key={tract.id} className="border-t border-gg-gray-800 pt-2 first:border-t-0 first:pt-0">
                                {/* Collapsed summary row */}
                                <button
                                  type="button"
                                  onClick={() => toggleTract(it.listing_id, tract.id)}
                                  className="group w-full flex items-center gap-2 py-2 text-left hover:bg-gg-pink hover:text-white rounded-lg px-2 -mx-2 transition-colors"
                                >
                                  <span className="text-gg-gray-400 text-xs w-3 shrink-0">{tractIsOpen ? '▼' : '▶'}</span>
                                  <span className="text-base text-white font-bold tracking-tight shrink-0">
                                    Tract {tract.tract_number}
                                  </span>
                                  {dcStatus && (
                                    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded font-medium capitalize ${dcStatusCls}`}>
                                      {dcStatus.replace('_', ' ')}
                                    </span>
                                  )}
                                  {dcSummaryParts && (
                                    <span className="text-xs text-gg-gray-400 ml-1">{dcSummaryParts}</span>
                                  )}
                                  <div className="ml-auto flex items-center gap-3 shrink-0">
                                    {tract.total_acres != null && (
                                      <span className="text-xs text-gg-gray-300">{formatAcres(tract.total_acres)} ac</span>
                                    )}
                                    <span className={`text-xs ${tract.polygon_coordinates ? 'text-green-400' : 'text-yellow-400'}`}>
                                      {tract.polygon_coordinates ? '◼ Polygon' : '○ No polygon'}
                                    </span>
                                    {tract.boundary_reviewed_at && (
                                      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/40 shrink-0">
                                        ✓ Reviewed
                                      </span>
                                    )}
                                    {/* Tract image thumbnail — only shown when a polygon exists */}
                                    {tract.polygon_coordinates && (() => {
                                      const imgSrc = tract.image_base64
                                        ? `data:image/png;base64,${tract.image_base64}`
                                        : tract.image_url ?? null
                                      return (
                                        <>
                                          {imgSrc ? (
                                            <img
                                              src={imgSrc}
                                              alt="Tract polygon"
                                              onError={(e) => {
                                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                                                (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex';
                                              }}
                                              className="w-12 h-12 rounded-md object-cover border border-white/20 flex-none group-hover:border-white/40"
                                            />
                                          ) : null}
                                          <div
                                            style={{ display: imgSrc ? 'none' : 'flex' }}
                                            className="w-12 h-12 rounded-md border border-white/20 bg-gray-700 flex-none items-center justify-center group-hover:border-white/40"
                                          >
                                            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 20.25h18M3.75 3h16.5A.75.75 0 0121 3.75v16.5a.75.75 0 01-.75.75H3.75a.75.75 0 01-.75-.75V3.75A.75.75 0 013.75 3z" />
                                            </svg>
                                          </div>
                                        </>
                                      );
                                    })()}
                                  </div>
                                </button>

                                <div className={tractIsOpen ? '' : 'hidden'}>
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
                                    {tract.boundary_valid === false && (
                                      <span className="text-[11px] px-2 py-0.5 rounded bg-yellow-300 border border-yellow-500 text-black">
                                        Acreage check
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => setDeleteTractTarget({ listingId: it.listing_id, tract })}
                                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm"
                                    >
                                      <Trash2 size={14} /> Delete tract
                                    </button>
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
                                </div>

                                {/* Has House / Has Buildings — for locked tracts only (actionable
                                    tracts edit these in the comparison box below). The read-only
                                    stat box moved down next to the action button (see statsBox). */}
                                {!actionable && (
                                  <div className="flex flex-wrap gap-x-5 gap-y-1 mb-2 text-xs text-gg-gray-400">
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Check if this tract has a house. Saves immediately.">
                                      <input
                                        type="checkbox"
                                        checked={!!tract.has_house}
                                        onChange={(e) => saveTractHasHouse(it.listing_id, tract, e.target.checked)}
                                        className="cursor-pointer accent-gg-pink w-4 h-4"
                                      />
                                      <span className="text-white font-medium">House</span>
                                    </label>
                                    <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Check if this tract has buildings. Saves immediately.">
                                      <input
                                        type="checkbox"
                                        checked={!!tract.has_buildings}
                                        onChange={(e) => saveTractHasBuilding(it.listing_id, tract, e.target.checked)}
                                        className="cursor-pointer accent-gg-pink w-4 h-4"
                                      />
                                      <span className="text-white font-medium">Buildings</span>
                                    </label>
                                  </div>
                                )}

                                {/* Land Types — add/remove, saves instantly. For actionable
                                    tracts this lives INSIDE the comparison box below; here we
                                    only render it for locked tracts so they can still edit it. */}
                                {!actionable && (
                                  <div className="mb-2">
                                    <div className="text-[10px] text-gg-gray-500 mb-1 uppercase tracking-wide">Land Types (click to add / remove)</div>
                                    <LandTypeButtons
                                      value={tract.land_types}
                                      onChange={(next) => saveTractLandTypes(it.listing_id, tract, next)}
                                    />
                                  </div>
                                )}

                                {actionable ? (
                                  <>
                                    {/* Sale Status chips — always accessible regardless of basisGate.
                                        Saves via saveTractFields so prices + listing rollup follow. */}
                                    <SaleStatusChips
                                      status={tract.sale_status}
                                      onChange={(next) => saveTractFields(it.listing_id, tract, { sale_status: next || null })}
                                      disabled={savingId === it.listing_id}
                                    />
                                    {/* The price-basis question comes FIRST and gates all editing for
                                        result-recorded tracts (sold/pending/no_sale). */}
                                    {basisBlock}
                                    {basisGate ? (
                                      <div className="mb-2 text-sm text-gg-gray-400 italic">
                                        Answer the price question above to unlock the polygon, tillable, and acreage editors.
                                      </div>
                                    ) : (
                                    <>
                                    {proposals[tract.id] && (
                                      <div className="flex items-start gap-2 mb-2 px-3 py-2 bg-sky-500/10 border border-sky-500/40 rounded-lg text-sky-700 text-xs">
                                        <RefreshCw size={13} className="flex-shrink-0 mt-0.5" />
                                        <span>
                                          Rescrape proposed a boundary: {proposals[tract.id].coords.length} pts
                                          {proposals[tract.id].proposed_acres != null && ` · ${formatAcres(proposals[tract.id].proposed_acres)} ac`}
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
                                      // OTHER live tracts' polygons → shared-boundary
                                      // reference + snap / copy-edge targets. flatMap
                                      // through toRings so a multi-ring neighbor
                                      // contributes ALL of its pieces as separate snap
                                      // targets instead of being dropped or pushed as
                                      // one corrupted "ring". Single-ring neighbors
                                      // are unaffected.
                                      neighborPolygons={loaded.tracts
                                        .filter((t) => t.id !== tract.id)
                                        .flatMap((t) => toRings(t.polygon_coordinates as any))
                                        .filter((r) => Array.isArray(r) && r.length >= 3)}
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
                                      listingCounty={tract.county_name || it.county || null}
                                      listingAddress={loaded.address}
                                      scrapedAcres={tract.total_acres}
                                      latitude={tract.latitude}
                                      longitude={tract.longitude}
                                      onUpdate={(updated) => {
                                        patchTract(it.listing_id, tract.id, {
                                          polygon_coordinates: updated.polygon_coordinates ?? ring,
                                          boundary_valid: updated.boundary_valid ?? tract.boundary_valid,
                                          ...(updated.image_url !== undefined ? { image_url: updated.image_url } : {}),
                                          ...(updated.image_base64 !== undefined ? { image_base64: updated.image_base64 } : {}),
                                        })
                                        // Proposal applied → clear it so the banner disappears.
                                        setProposals((prev) => {
                                          if (!prev[tract.id]) return prev
                                          const next = { ...prev }; delete next[tract.id]; return next
                                        })
                                        setCluReloadKeys((prev) => ({ ...prev, [tractKey]: (prev[tractKey] || 0) + 1 }))
                                        fetchValidation(it.listing_id)
                                      }}
                                      onDirtyChange={(d) => setTractDirty(`${it.listing_id}::${tract.id}::map`, d)}
                                      discardNonce={discardNonces[tractKey] || 0}
                                      // Capture the live polygon's GIS acreage as the "Computed"
                                      // total-acres source for the comparison box below.
                                      onPolygonChange={(_pts, ac) => setComputedField(tract.id, { acres: ac })}
                                    />
                                    {/* FSA-CLU tillable workshop — live published-tract mode. */}
                                    <TillableCluWorkshop
                                      tractId={tract.id}
                                      reloadKey={cluReloadKeys[tractKey] || 0}
                                      latitude={tract.latitude}
                                      longitude={tract.longitude}
                                      onSaved={(r) => {
                                        patchTract(it.listing_id, tract.id, {
                                          // Use key-presence so a successful null save
                                          // (e.g. soil_rating cleared) is reflected in the
                                          // UI rather than silently falling back to the old
                                          // value.  The CLU save endpoint always returns
                                          // these keys (even when null) so `in` is reliable.
                                          tillable_acres: 'tillable_acres' in r ? r.tillable_acres : tract.tillable_acres,
                                          soil_rating: 'soil_rating' in r ? r.soil_rating : tract.soil_rating,
                                          soil_rating_type: 'soil_rating_type' in r ? r.soil_rating_type : tract.soil_rating_type,
                                          // Derived $/x recomputed server-side on save → refresh the panel.
                                          sale_price: 'sale_price' in r ? r.sale_price : tract.sale_price,
                                          sale_status: 'sale_status' in r ? r.sale_status : tract.sale_status,
                                          price_per_acre: 'price_per_acre' in r ? r.price_per_acre : tract.price_per_acre,
                                          price_per_tillable_acre: 'price_per_tillable_acre' in r ? r.price_per_tillable_acre : tract.price_per_tillable_acre,
                                          price_per_soil_rating: 'price_per_soil_rating' in r ? r.price_per_soil_rating : tract.price_per_soil_rating,
                                        })
                                        fetchValidation(it.listing_id)
                                      }}
                                      // Capture the freshly-computed tillable + soil as the "Computed"
                                      // source (fires on Compute, BEFORE the admin saves).
                                      onComputed={(c) => setComputedField(tract.id, {
                                        tillable_acres: c.tillable_acres ?? null,
                                        soil_rating: c.soil_rating ?? null,
                                        soil_rating_type: c.soil_rating_type ?? null,
                                      })}
                                      onDirtyChange={(d) => setTractDirty(`${it.listing_id}::${tract.id}::till`, d)}
                                    />
                                    {/* Edit 3: source comparison — Current (saved) vs Computed vs hand-typed,
                                        per field. Writes through update_tract so $/acre + listing totals follow. */}
                                    <div className="mt-3">
                                      <TractDataCompare
                                        scrapedLabel="Current (saved)"
                                        computedLabel="Computed"
                                        hasHouse={!!tract.has_house}
                                        onHasHouseChange={(next) => saveTractHasHouse(it.listing_id, tract, next)}
                                        hasBuilding={!!tract.has_buildings}
                                        onHasBuildingChange={(next) => saveTractHasBuilding(it.listing_id, tract, next)}
                                        landTypes={tract.land_types}
                                        onLandTypesChange={(next) => saveTractLandTypes(it.listing_id, tract, next)}
                                        scraped={{
                                          acres: tract.total_acres,
                                          tillable_acres: tract.tillable_acres,
                                          soil_rating: tract.soil_rating,
                                          soil_rating_type: tract.soil_rating_type,
                                        }}
                                        computed={computedVals[tract.id] || {}}
                                        chosen={chosenVals[tract.id] || null}
                                        onChosenChange={(next) => {
                                          const prev = chosenVals[tract.id] || {}
                                          setChosenVals((p) => ({ ...p, [tract.id]: next }))
                                          const cv = computedVals[tract.id] || {}
                                          const fields: Record<string, any> = {}
                                          ;(['acres', 'tillable_acres', 'soil_rating'] as const).forEach((f) => {
                                            if (next[f] === prev[f]) return
                                            if (next[f] === 'computed') {
                                              const val = (cv as any)[f] ?? null
                                              if (f === 'acres') fields.total_acres = val
                                              else if (f === 'tillable_acres') fields.tillable_acres = val
                                              else {
                                                fields.soil_rating = val
                                                fields.soil_rating_type = val != null && cv.soil_rating_type ? cv.soil_rating_type : null
                                              }
                                            } else if (next[f] === 'scraped') {
                                              // Admin reverted to Current (saved). Re-send the tract's
                                              // current DB values so a prior Computed click is undone.
                                              if (f === 'acres') fields.total_acres = tract.total_acres
                                              else if (f === 'tillable_acres') fields.tillable_acres = tract.tillable_acres
                                              else {
                                                fields.soil_rating = tract.soil_rating
                                                fields.soil_rating_type = tract.soil_rating_type
                                              }
                                            }
                                          })
                                          saveTractFields(it.listing_id, tract, fields)
                                        }}
                                        onManualChange={(field, value) => {
                                          // value == null means the admin cleared the field — send null
                                          // so the backend persists the clear (D11 fix).
                                          const fields: Record<string, any> = {}
                                          if (field === 'acres') fields.total_acres = value
                                          else if (field === 'tillable_acres') fields.tillable_acres = value
                                          else {
                                            fields.soil_rating = value
                                            // D12: derive soil_rating_type from the tract's state so a
                                            // manual rating entry doesn't leave a stale mismatched type.
                                            if (value != null) {
                                              const STATE_SOIL_LABELS: Record<string, string> = {
                                                IL: 'PI', IA: 'CSR2', IN: 'WAPI', MO: 'NCCPI', MN: 'CPI',
                                                NE: 'NCCPI', SD: 'PI', ND: 'PI', KS: 'NCCPI', OH: 'NCCPI',
                                                MI: 'NCCPI', WI: 'PI', KY: 'NCCPI', TN: 'NCCPI', WV: 'NCCPI', VA: 'NCCPI',
                                              }
                                              const st = (tract.state_abbr || '').toUpperCase()
                                              fields.soil_rating_type = STATE_SOIL_LABELS[st] ?? tract.soil_rating_type ?? null
                                            } else {
                                              fields.soil_rating_type = null
                                            }
                                          }
                                          saveTractFields(it.listing_id, tract, fields)
                                        }}
                                        onDirtyChange={(d) => setTractDirty(`${it.listing_id}::${tract.id}::data`, d)}
                                        discardNonce={discardNonces[tractKey] || 0}
                                      />
                                    </div>
                                    {/* Done = human confirmed polygon + tillable + soil. */}
                                    <div className="flex items-center gap-3 mt-3">
                                      <button
                                        onClick={() => toggleReviewed(it.listing_id, tract)}
                                        disabled={reviewingTractId === tract.id || !!dirtyTracts[`${it.listing_id}::${tract.id}::data`] || !!dirtyTracts[`${it.listing_id}::${tract.id}::map`] || !!dirtyTracts[`${it.listing_id}::${tract.id}::till`]}
                                        title={dirtyTracts[`${it.listing_id}::${tract.id}::data`] || dirtyTracts[`${it.listing_id}::${tract.id}::map`] || dirtyTracts[`${it.listing_id}::${tract.id}::till`] ? 'Save changes first' : undefined}
                                        className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
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
                                        <span className="text-xs text-gg-gray-500 whitespace-nowrap">
                                          {new Date(tract.boundary_reviewed_at).toLocaleString()}
                                        </span>
                                      )}
                                      {statsBox}
                                    </div>
                                    </>
                                    )}
                                  </>
                                ) : (
                                  <div className="flex items-center gap-3 py-2">
                                    <span className="text-sm text-gg-gray-500 italic whitespace-nowrap">
                                      Editors locked — {it.state || 'this state'} soil mapping pending.
                                    </span>
                                    {statsBox}
                                  </div>
                                )}
                                </div> {/* end tractIsOpen */}
                              </div>
                            )
                          })}

                          {/* Add a new empty tract to this listing. */}
                          <button
                            onClick={() => addTractToListing(it.listing_id)}
                            disabled={addingTractFor === it.listing_id}
                            className="mt-2 mb-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gg-pink text-white hover:bg-gg-pink/80 disabled:opacity-50"
                          >
                            {addingTractFor === it.listing_id
                              ? <Loader2 className="animate-spin" size={15} />
                              : <Plus size={15} />}
                            Add Tract
                          </button>

                          {/* Listing-level Verify — finalize once every tract has
                              been updated + saved. Marks ALL tracts Reviewed and
                              flips the workflow status to Done. Does NOT touch
                              polygon/tillable/soil (those save on their own editors). */}
                          {(() => {
                            const allReviewed = loaded.tracts.every((t) => !!t.boundary_reviewed_by)
                            const hasUnsaved = listingHasUnsaved(it.listing_id)
                            const vr = validateResults[it.listing_id]
                            const hasViolations = (vr?.items?.length ?? 0) > 0
                            // Only block Verify when the gate is actively enforced
                            const violationsBlock = hasViolations && vr?.enforce === true
                            return (
                              <>
                                {/* Amber advisory — always amber (never red) on data-cleanup */}
                                {hasViolations && (
                                  <div className="mb-3 px-3 py-2.5 bg-yellow-300 border border-yellow-500 rounded-lg">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                      <AlertTriangle size={14} className="text-black flex-shrink-0" />
                                      <span className="text-black text-xs font-semibold uppercase tracking-wide">Incomplete fields (not yet enforced)</span>
                                    </div>
                                    <ul className="space-y-0.5">
                                      {vr!.items.map((itm: any) => (
                                        <li key={`${itm.scope}-${itm.tract_number ?? ''}-${itm.code}`} className="text-gray-900 text-xs">{itm.message}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                <div className="flex items-center justify-end gap-3 border-t border-gg-gray-800 pt-4">
                                  {!hasUnsaved && allReviewed && !hasViolations && (
                                    <span className="text-xs text-green-600 inline-flex items-center gap-1">
                                      <CheckCircle2 size={13} /> All tracts reviewed
                                    </span>
                                  )}
                                  <button
                                    onClick={() => verifyListing(it.listing_id)}
                                    disabled={verifyingId === it.listing_id}
                                    title="Mark every tract on this listing Reviewed and set the listing to Done"
                                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-bold bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                                  >
                                    {verifyingId === it.listing_id
                                      ? <Loader2 className="animate-spin" size={16} />
                                      : <CheckCircle2 size={16} />}
                                    Verify Listing
                                  </button>
                                </div>
                              </>
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

      {/* Delete & Rescrape confirmation — destructive, so make the consequence
          explicit before anything is deleted. */}
      {deleteRescrapeTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => { if (!deleteRescrapingId) setDeleteRescrapeTarget(null) }}
        >
          <div
            className="bg-gg-gray-900 border border-red-800 rounded-lg max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="text-red-400 flex-shrink-0" size={22} />
              <h3 className="text-lg font-bold text-white">Delete &amp; Rescrape this listing?</h3>
            </div>
            {(() => {
              const t = deleteRescrapeTarget
              const kind = t.listing_type === 'private_treaty' ? 'private-treaty listing'
                : t.listing_type === 'auction' ? 'auction listing' : 'listing'
              const loc = [t.county ? `${t.county} County` : null, t.state].filter(Boolean).join(', ')
              const when = (t.listing_type === 'auction' && t.auction_datetime)
                ? new Date(t.auction_datetime).toLocaleString(undefined, {
                    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
                  })
                : null
              const descriptor = [t.company_name || 'Unknown Company', loc || null, when]
                .filter(Boolean).join(' · ')
              return (
                <p className="text-sm text-gg-gray-300 mb-3">
                  This <span className="text-red-400 font-semibold">permanently deletes this {kind}</span>:{' '}
                  <span className="text-white font-medium">{descriptor}</span> — and all of its tracts.{' '}
                  <span className="text-gg-gray-400">(The listing company is not affected — only this one listing.)</span>{' '}
                  It then scrapes its source URL <span className="font-semibold">from scratch</span> into
                  Staging as a brand-new listing.
                </p>
              )
            })()}
            {deleteRescrapeTarget.source_url && (
              <a
                href={deleteRescrapeTarget.source_url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Open this listing in a new tab to confirm it's the right one"
                className="flex items-start gap-1.5 mb-4 text-xs text-gg-pink hover:underline break-all"
              >
                <ExternalLink size={13} className="flex-shrink-0 mt-0.5" />
                {deleteRescrapeTarget.source_url}
              </a>
            )}
            {/* Destination staging screen. Defaults to the listing's current
                type, but a listing's type can change (unsold auction -> PT), so
                let the operator pick where the fresh scrape lands. */}
            <div className="mb-5">
              <div className="text-xs text-gg-gray-400 mb-1.5">Re-scrape into:</div>
              <div className="inline-flex rounded-md overflow-hidden border border-gg-gray-700">
                {([
                  ['auction', 'Auction Staging'],
                  ['private_treaty', 'PT Staging'],
                ] as const).map(([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setRescrapeAsType(val)}
                    disabled={!!deleteRescrapingId}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                      rescrapeAsType === val
                        ? 'bg-gg-pink text-white'
                        : 'bg-gg-gray-800 text-gg-gray-300 hover:bg-gg-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {deleteRescrapeTarget.listing_type
                && rescrapeAsType !== deleteRescrapeTarget.listing_type && (
                <div className="text-[11px] text-amber-400 mt-1.5">
                  Note: this listing is currently{' '}
                  {deleteRescrapeTarget.listing_type === 'private_treaty' ? 'private treaty' : 'an auction'},
                  but you’re sending the rescrape to{' '}
                  {rescrapeAsType === 'private_treaty' ? 'PT' : 'Auction'} Staging.
                </div>
              )}
            </div>
            <ul className="text-xs text-gg-gray-400 list-disc pl-5 mb-5 space-y-1">
              <li>The current listing is removed <span className="text-gg-gray-300">immediately — there is no undo</span>.</li>
              <li>Nothing from the old (wrong) data carries over — including sale price/date.</li>
              <li>The fresh scrape lands in <span className="text-white">Auction / PT Staging</span> for you to review and Verify (it can take a few minutes).</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteRescrapeTarget(null)}
                disabled={!!deleteRescrapingId}
                className="px-4 py-2 rounded text-sm font-medium border border-gg-gray-700 bg-gg-gray-800 text-white hover:bg-gg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteAndRescrape(deleteRescrapeTarget)}
                disabled={!!deleteRescrapingId}
                className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteRescrapingId ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
                Delete &amp; Rescrape
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteTractModal
        tract={deleteTractTarget ? {
          tract_number: deleteTractTarget.tract.tract_number ?? null,
          total_acres: deleteTractTarget.tract.total_acres ?? null,
          sale_status: deleteTractTarget.tract.sale_status ?? null,
        } : null}
        isSold={deleteTractTarget?.tract.sale_status === 'sold'}
        isLastTract={!!deleteTractTarget && (loadedListings[deleteTractTarget.listingId]?.tracts.length ?? 0) <= 1}
        onConfirm={confirmDeleteTract}
        onCancel={() => { setDeleteTractTarget(null); setDeleteTractError(null) }}
        loading={deleteTractLoading}
        error={deleteTractError}
      />
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
