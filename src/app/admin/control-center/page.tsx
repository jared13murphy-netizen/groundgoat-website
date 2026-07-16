'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Bell, ChevronDown, ChevronUp, RefreshCw, Save, ExternalLink, Lock, MapPin, AlertTriangle, X } from 'lucide-react'
import { toRings } from '@/lib/polygonRings'
import TractMapEditor from '@/components/admin/TractMapEditor'
import TillableCluWorkshop from '@/components/admin/TillableCluWorkshop'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const BID_INCREMENTS = [5000, 2500, 1000, 500, 250, 150, 100, 50, 25]
const TRACT_STATUSES = ['Listed', 'Live', 'Pending', 'Sold', 'No Sale']
const LISTING_STATUSES = ['Listed', 'Live', 'Sold', 'No Sale']

interface Tract {
  id: string
  tract_number: number
  total_acres: number
  tillable_acres: number
  land_type: string
  sale_price: number | null
  price_per_acre: number | null
  sale_status: string | null
  soil_rating: number | null
  // Additive read-only flags from GET /api/listings/today — let the condensed
  // list show which tracts need polygon/tillable/image attention without a
  // per-tract fetch. All optional since older cached payloads may lack them.
  has_polygon?: boolean
  boundary_valid?: boolean | null
  has_tillable?: boolean
  has_image?: boolean
  // Additive, read-only boundary-on-satellite thumbnail URL from GET
  // /api/listings/today (Tract.image_url — already a full renderable URL,
  // e.g. f"{backend}/api/tracts/{id}/image"). Used ONLY for the condensed
  // list's at-a-glance thumbnail; never image_base64 (too heavy for a list).
  image_url?: string | null
  // Derived read-only DISPLAY fields the CLU save authoritatively
  // recomputes alongside tillable_acres/soil_rating. price_per_tillable_acre
  // and price_per_soil_rating are already present (untyped) in the
  // /api/listings/today payload; soil_rating_type is populated only after a
  // CLU save this session (not part of the /today projection).
  soil_rating_type?: string | null
  price_per_tillable_acre?: number | null
  price_per_soil_rating?: number | null
}

interface Company {
  id: string
  name: string
}

interface Listing {
  id: string
  title: string
  description: string
  county: string
  state: string
  total_acres: number
  auction_date: string
  auction_datetime: string
  auction_time: string
  status: string
  company: Company | null
  source_url: string
  tracts: Tract[]
  control_center_locked: boolean
  notified_at: string | null
  // Already present in the /api/listings/today JSON (untyped here until
  // now) — used as the polygon editor's fallback reference image and to
  // gate the verified-listing confirm dialog below.
  primary_image_url?: string | null
  verified?: boolean
}

// Full geometry for one tract — fetched lazily via GET /api/tracts/{id}
// ONLY when its row is expanded, so the lean /api/listings/today load
// stays fast. Not part of the Tract row shape above on purpose.
interface TractGeometry {
  polygon_coordinates: any
  tillable_polygon: any
  image_url: string | null
  boundary_valid: boolean | null
  latitude: number | null
  longitude: number | null
}

interface TractState {
  // The exact string the user typed in the price input — source of truth.
  // We DO NOT derive this from a back-and-forth division and multiplication,
  // because that's what corrupted the saved prices on prior versions of
  // this page (e.g. 1,200,000 in Lump Sum became 1,199,999.999999... after
  // round-tripping through state.pricePerAcre). Save handlers parse this
  // string ONCE and send rounded integer dollars to the backend.
  enteredPriceStr: string
  originalEnteredPriceStr: string

  bidIncrement: number
  status: string
  saving: boolean
  bidMode: 'per_acre' | 'lump_sum'
  // Editable tract fields
  totalAcres: number
  tillableAcres: number
  soilRating: number | null
  // Track original values to detect changes
  originalStatus: string
  originalTotalAcres: number
  originalTillableAcres: number
  originalSoilRating: number | null
}

export default function ControlCenterPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [listings, setListings] = useState<Listing[]>([])
  const [tractStates, setTractStates] = useState<Record<string, TractState>>({})
  const [expandedListings, setExpandedListings] = useState<Set<string>>(new Set())
  // --- Per-tract polygon/tillable/soil editor (condensed — collapsed by
  // default; mirrors expandedListings). Opening a tract lazy-fetches its
  // full geometry via GET /api/tracts/{id}; the editors themselves reuse
  // the data-cleanup TractMapEditor / TillableCluWorkshop components AS-IS
  // (same save endpoints: /api/admin/tract-fix-boundary/{id}/apply and
  // /api/admin/tracts/{id}/clu). No new save logic lives in this file.
  const [expandedTracts, setExpandedTracts] = useState<Set<string>>(new Set())
  const [tractGeometry, setTractGeometry] = useState<Record<string, TractGeometry>>({})
  const [geometryLoading, setGeometryLoading] = useState<Record<string, boolean>>({})
  const [geometryError, setGeometryError] = useState<Record<string, string>>({})
  // Sibling-polygon cache for map snapping — listingId -> {tractId: polygon_coordinates}.
  // Loaded ONCE per listing (not per tract) via GET /api/listings/{id}, the same
  // listing-level fetch data-cleanup's loadListing uses, so neighborPolygons has
  // every sibling tract's boundary available for snapping, at parity with
  // data-cleanup — not just tracts individually expanded this session.
  const [listingPolygons, setListingPolygons] = useState<Record<string, Record<string, any>>>({})
  const [listingPolygonsLoading, setListingPolygonsLoading] = useState<Record<string, boolean>>({})
  // tractId -> visible warning when a polygon save reported
  // image_regenerated:false (business rule: every polygon tract must keep
  // image_base64 + image_url — a failed regen must never look silent).
  const [imageIssues, setImageIssues] = useState<Record<string, string>>({})
  // Bumped per tract to force TillableCluWorkshop to reload CLUs after the
  // polygon is saved (same pattern as data-cleanup's cluReloadKeys).
  const [cluReloadKeys, setCluReloadKeys] = useState<Record<string, number>>({})
  // tractId -> true once the polygon editor reports unsaved edits, so we can
  // show a "save the boundary first" note near the CLU workshop (data-cleanup
  // doesn't gate/hide the CLU workshop on this either — see report).
  const [polygonDirty, setPolygonDirty] = useState<Record<string, boolean>>({})
  // listingIds the admin has already confirmed "save anyway" for, this
  // session, when the listing is verified. Gate lives at the editor-mount
  // level (see the tract row's expanded panel below) so no save endpoint
  // can fire before the admin acknowledges — new guard, does not exist
  // upstream.
  const [verifiedAcked, setVerifiedAcked] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [savingListing, setSavingListing] = useState<string | null>(null)
  // Track which listings have had notifications sent (persisted per session)
  const [notifiedListings, setNotifiedListings] = useState<Set<string>>(new Set())
  const [runningMigration, setRunningMigration] = useState(false)
  const [selectedDay, setSelectedDay] = useState<'today' | 'tomorrow'>('today')
  // Condensed-row thumbnail lightbox — DISPLAY ONLY, no save path. Clicking a
  // tract's thumbnail (when it has an image) opens this instead of the
  // polygon editor, so the admin can see the boundary large without
  // committing to editing it. Carries the listing/tract through so the
  // in-lightbox "Edit Map" button can still jump straight to toggleTract.
  const [lightboxTract, setLightboxTract] = useState<{ imageUrl: string; label: string; listingId: string; tract: Tract } | null>(null)

  const getDateParam = (day: 'today' | 'tomorrow'): string | undefined => {
    if (day === 'today') return undefined
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toISOString().split('T')[0]
  }

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth(token)
  }, [router])

  const checkAuth = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()
      
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }

      await fetchTodaysAuctions(token, getDateParam(selectedDay))
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchTodaysAuctions = async (token: string, date?: string) => {
    try {
      const url = date
        ? `${API_URL}/api/listings/today?date=${date}`
        : `${API_URL}/api/listings/today`
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const listingsWithTracts = await response.json()
        setListings(listingsWithTracts)

        const initialStates: Record<string, TractState> = {}
        const expandedIds: string[] = []
        listingsWithTracts.forEach((listing: Listing) => {
          listing.tracts?.forEach((tract: Tract) => {
            const ppa = tract.price_per_acre || 0
            // Display dollars-only by default — no cents. Auctions are
            // never priced in fractions of a cent, but our DB used to
            // contain 99999.99999998 because of float division. Round
            // hard so the input field shows a clean integer string.
            const initialStr = ppa > 0 ? Math.round(ppa).toString() : ''
            const status = normalizeStatus(tract.sale_status || 'listed')
            initialStates[tract.id] = {
              enteredPriceStr: initialStr,
              originalEnteredPriceStr: initialStr,
              bidIncrement: 1000,
              status,
              saving: false,
              bidMode: 'per_acre',
              totalAcres: tract.total_acres || 0,
              tillableAcres: tract.tillable_acres || 0,
              soilRating: tract.soil_rating,
              originalStatus: status,
              originalTotalAcres: tract.total_acres || 0,
              originalTillableAcres: tract.tillable_acres || 0,
              originalSoilRating: tract.soil_rating,
            }
          })
          expandedIds.push(listing.id)
        })
        setTractStates(initialStates)
        setExpandedListings(new Set(expandedIds))
      }
    } catch (err) {
      setError('Failed to fetch auctions')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  const normalizeStatus = (status: string): string => {
    if (!status) return 'Listed'
    const lower = status.toLowerCase().replace('_', ' ')
    if (lower === 'no sale') return 'No Sale'
    return lower.charAt(0).toUpperCase() + lower.slice(1)
  }

  const toDbStatus = (status: string): string => {
    return status.toLowerCase().replace(' ', '_')
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    const token = localStorage.getItem('auth_token')
    if (token) {
      await fetchTodaysAuctions(token, getDateParam(selectedDay))
    }
  }

  // Re-fetch when switching between Today/Tomorrow
  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (token && !loading) {
      setRefreshing(true)
      fetchTodaysAuctions(token, getDateParam(selectedDay))
    }
  }, [selectedDay])

  // Esc closes the thumbnail lightbox — only wired while it's open.
  useEffect(() => {
    if (!lightboxTract) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxTract(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxTract])

  const handleRunMigration = async () => {
    if (!confirm('Run database migration to add lock columns? This is safe to run multiple times.')) {
      return
    }

    setRunningMigration(true)
    try {
      const response = await fetchWithAuth(`${API_URL}/api/admin/migrate-lock-columns`, {
        method: 'POST'
      })

      const data = await response.json()

      if (data.success) {
        alert('Migration completed successfully! Refreshing page...')
        window.location.reload()
      } else {
        alert(`Migration failed: ${data.error}`)
      }
    } catch (error) {
      console.error('Migration error:', error)
      alert('Migration failed. Check console for details.')
    } finally {
      setRunningMigration(false)
    }
  }

  const toggleListing = (listingId: string) => {
    setExpandedListings(prev => {
      const newSet = new Set(prev)
      if (newSet.has(listingId)) {
        newSet.delete(listingId)
      } else {
        newSet.add(listingId)
      }
      return newSet
    })
  }

  // GET /api/tracts/{id} — read-only fetch, same endpoint the subscriber
  // side uses. Only called lazily on expand; never touches a save path.
  const loadTractGeometry = async (tractId: string) => {
    setGeometryLoading(prev => ({ ...prev, [tractId]: true }))
    setGeometryError(prev => {
      if (!(tractId in prev)) return prev
      const next = { ...prev }
      delete next[tractId]
      return next
    })
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tractId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setTractGeometry(prev => ({
        ...prev,
        [tractId]: {
          polygon_coordinates: Array.isArray(data.polygon_coordinates) ? data.polygon_coordinates : null,
          tillable_polygon: data.tillable_polygon ?? null,
          image_url: data.image_url ?? null,
          boundary_valid: data.boundary_valid ?? null,
          latitude: data.latitude != null ? Number(data.latitude) : null,
          longitude: data.longitude != null ? Number(data.longitude) : null,
        },
      }))
    } catch (err) {
      setGeometryError(prev => ({ ...prev, [tractId]: err instanceof Error ? err.message : 'Failed to load tract geometry' }))
    } finally {
      setGeometryLoading(prev => ({ ...prev, [tractId]: false }))
    }
  }

  // GET /api/listings/{id} — the same listing-level fetch data-cleanup's
  // loadListing uses (main.py: ListingDetailResponse, tracts: List[TractResponse],
  // each carrying polygon_coordinates). Read-only, loaded once per listing and
  // cached — gives neighborPolygons every sibling tract's boundary up front,
  // at parity with data-cleanup, instead of only tracts individually expanded.
  const loadListingPolygons = async (listingId: string) => {
    setListingPolygonsLoading(prev => ({ ...prev, [listingId]: true }))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/listings/${listingId}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      const byTract: Record<string, any> = {}
      ;(data.tracts || []).forEach((t: any) => {
        if (t?.id) byTract[t.id] = Array.isArray(t.polygon_coordinates) ? t.polygon_coordinates : null
      })
      setListingPolygons(prev => ({ ...prev, [listingId]: byTract }))
    } catch {
      // Best-effort — a failed sibling-polygon prefetch just means neighbor
      // snapping falls back to whatever's individually loaded (or nothing).
      // It must never block opening the tract's own editor.
    } finally {
      setListingPolygonsLoading(prev => ({ ...prev, [listingId]: false }))
    }
  }

  // Single-open accordion, ON PURPOSE: TractMapEditor + TillableCluWorkshop
  // each mount their own maplibre-gl WebGL context, and both lazy-mount via
  // IntersectionObserver-on-scroll-into-view but then NEVER tear down while
  // mounted (see TractMapEditor's "hasBeenVisible" comment) — browsers cap
  // WebGL contexts at roughly 8-16, so letting an admin expand many tract
  // rows at once (then scroll through all of them) could silently exhaust
  // that cap and drop an earlier map. Capping to one expanded tract at a
  // time means at most 2 contexts are ever alive (this file DOES fully
  // unmount the editors on collapse, since they're behind `isTractExpanded
  // && (...)` — unlike data-cleanup, which deliberately keeps collapsed
  // tract bodies mounted-but-hidden and so never frees theirs). The
  // sibling-polygon prefetch above (listingPolygons) means an admin no
  // longer needs two tracts open at once just to see a shared boundary —
  // neighborPolygons is populated regardless of whether the sibling itself
  // is expanded, so there's no functional loss from this cap.
  const toggleTract = (listingId: string, tract: Tract) => {
    const opening = !expandedTracts.has(tract.id)
    setExpandedTracts(() => (opening ? new Set([tract.id]) : new Set()))
    if (opening && !tractGeometry[tract.id] && !geometryLoading[tract.id]) {
      loadTractGeometry(tract.id)
    }
    if (opening && !listingPolygons[listingId] && !listingPolygonsLoading[listingId]) {
      loadListingPolygons(listingId)
    }
  }

  // Patch a single tract's server-recomputed fields into BOTH the source
  // `listings` state (so the condensed row's read-only numbers reflect what
  // was actually saved) AND `tractStates` — but ONLY the geometry/tillable/
  // soil fields the polygon-save and CLU-save endpoints actually recompute
  // (totalAcres from a polygon re-measure, tillableAcres/soilRating from
  // the CLU union). It must NEVER touch enteredPriceStr / status (or their
  // "original" baselines): those are the admin's own in-progress price +
  // sale-status entry for the existing Save All / Save & Notify flow, and
  // neither the boundary-apply nor the CLU endpoint changes price or sale
  // status server-side. A prior version of this function also synced price/
  // status from `fields.sale_price`/`fields.sale_status`/`fields.price_per_acre`
  // — but the CLU save response ALWAYS echoes those (unchanged) alongside the
  // tillable/soil values it does recompute, so that sync silently reverted
  // any unsaved price+status edit the admin was mid-typing and reset the
  // dirty baseline so no indicator caught it. Removed entirely; see 2026-07-16
  // review. Only `listings` (read-only display) gets those fields — the
  // editable tractStates map for price/status is single-source-of-truth from
  // the existing Save All / Save & Notify inputs alone.
  const patchListingTract = (listingId: string, tractId: string, fields: Partial<Tract>) => {
    setListings(prev => prev.map(l => (
      l.id === listingId
        ? { ...l, tracts: l.tracts.map(t => (t.id === tractId ? { ...t, ...fields } : t)) }
        : l
    )))
    setTractStates(prev => {
      const cur = prev[tractId]
      if (!cur) return prev
      const next = { ...cur }
      if ('total_acres' in fields) {
        next.totalAcres = fields.total_acres ?? 0
        next.originalTotalAcres = fields.total_acres ?? 0
      }
      if ('tillable_acres' in fields) {
        next.tillableAcres = fields.tillable_acres ?? 0
        next.originalTillableAcres = fields.tillable_acres ?? 0
      }
      if ('soil_rating' in fields) {
        next.soilRating = fields.soil_rating ?? null
        next.originalSoilRating = fields.soil_rating ?? null
      }
      return { ...prev, [tractId]: next }
    })
  }

  // Verified-listing confirm — gate lives at editor-mount time (see JSX
  // below): the editors simply aren't rendered for a verified listing until
  // this returns true, so no save endpoint can fire before the admin
  // acknowledges. Confirming once covers the whole listing (all its tracts),
  // matching "before the FIRST polygon or tillable save on that listing."
  const confirmVerifiedListing = (listing: Listing) => {
    if (!window.confirm('This listing is verified — save anyway?')) return
    setVerifiedAcked(prev => new Set(prev).add(listing.id))
  }

  const updateTractState = (tractId: string, updates: Partial<TractState>) => {
    setTractStates(prev => ({
      ...prev,
      [tractId]: { ...prev[tractId], ...updates }
    }))
  }

  // The single price-input change handler — stores whatever the user
  // typed verbatim. No division, no derived values. Per-acre vs Lump-Sum
  // is just a label on the same field.
  const handlePriceInputChange = (tractId: string, value: string) => {
    updateTractState(tractId, { enteredPriceStr: value })
  }

  const handleAddBid = (tractId: string, acres: number) => {
    const state = tractStates[tractId]
    if (!state) return
    const current = parseFloat(state.enteredPriceStr) || 0
    const next = Math.round(current + state.bidIncrement)
    updateTractState(tractId, { enteredPriceStr: next.toString() })
  }

  const handleSetIncrement = (tractId: string, increment: number) => {
    updateTractState(tractId, { bidIncrement: increment })
  }

  const handleSetStatus = (tractId: string, status: string) => {
    updateTractState(tractId, { status })
  }

  // Toggle between Per-Acre and Lump-Sum interpretation of the input.
  // The number in the field gets re-scaled by acres so the user's
  // economic intent is preserved (e.g. $2,950/acre × 152ac ↔ $448,400
  // lump sum). Rounded to whole dollars on conversion.
  const handleToggleBidMode = (tractId: string, acres: number) => {
    const state = tractStates[tractId]
    if (!state) return
    const current = parseFloat(state.enteredPriceStr) || 0
    let converted = current
    if (state.bidMode === 'per_acre' && acres > 0) {
      converted = Math.round(current * acres)
    } else if (state.bidMode === 'lump_sum' && acres > 0) {
      converted = Math.round(current / acres)
    }
    updateTractState(tractId, {
      bidMode: state.bidMode === 'per_acre' ? 'lump_sum' : 'per_acre',
      enteredPriceStr: current > 0 ? converted.toString() : '',
    })
  }

  const handleSetListingStatus = async (listingId: string, status: string) => {
    setListings(prev => prev.map(l => 
      l.id === listingId ? { ...l, status: toDbStatus(status) } : l
    ))
  }

  // Compute what the listing-level status SHOULD be given the current
  // tract states. The current listing.status is passed in so we can
  // preserve 'Live' while an auction is in progress (the scheduler
  // sets 'Live' 15 min before auction_datetime; we shouldn't overwrite
  // it back to 'Listed' just because the user is mid-marking-tracts).
  const calculateListingStatus = (
    tracts: Tract[],
    tractStates: Record<string, TractState>,
    currentListingStatus?: string,
  ): string => {
    if (!tracts || tracts.length === 0) return 'Listed'

    const statuses = tracts.map(t => tractStates[t.id]?.status || normalizeStatus(t.sale_status || 'listed'))

    // EVERY tract has a final status (Sold or No Sale) → the auction
    // is over. Flip to Sold or No Sale based on whether anything sold.
    // This is the ONLY path that flips the listing to a terminal
    // status — covers the McDonough bug: the previous version flipped
    // the listing to 'Sold' the moment the FIRST tract was marked sold,
    // even while other tracts were still 'Auction' (mid-bid).
    const isFinal = (s: string) => s === 'Sold' || s === 'No Sale'
    if (statuses.every(isFinal)) {
      return statuses.some(s => s === 'Sold') ? 'Sold' : 'No Sale'
    }

    // Auction is still in progress. If the scheduler already flipped
    // the listing to 'Live' (it does this 15 min before auction_datetime),
    // preserve that — overwriting it back to 'Listed' would suppress
    // the green pulse on the map mid-auction. Once all tracts are
    // marked final, the branch above kicks in and flips to Sold/No Sale.
    if (currentListingStatus && currentListingStatus.toLowerCase() === 'live') {
      return 'Live'
    }

    // Tract-level 'Live' is a niche path — tracts in our data model
    // generally don't carry 'Live' (it's a listing-level status), but
    // if a tract somehow does, treat the whole listing as Live.
    if (statuses.some(s => s === 'Live')) return 'Live'

    // All pending → Pending (buyer on paper, not closed).
    if (statuses.every(s => s === 'Pending')) return 'Pending'

    // Otherwise the listing is still open.
    return 'Listed'
  }

  const calculateSoldAcres = (tracts: Tract[], tractStates: Record<string, TractState>): number => {
    if (!tracts || tracts.length === 0) return 0

    return tracts.reduce((sum, tract) => {
      const tState = tractStates[tract.id]
      const status = tState?.status || normalizeStatus(tract.sale_status || 'listed')
      if (status === 'Sold') {
        return sum + (tState?.totalAcres || tract.total_acres || 0)
      }
      return sum
    }, 0)
  }

  // Compute the canonical {sale_price, price_per_acre} pair from what
  // the user actually typed in the active mode + the tract's acres.
  // All math is in JS floats but the final values are rounded to whole
  // dollars before going to the backend — preventing the 99999.99998
  // and similar artifacts that have corrupted saved prices.
  const computePrices = (state: TractState, acres: number): { salePrice: number; pricePerAcre: number } => {
    const parsed = parseFloat(state.enteredPriceStr) || 0
    if (parsed <= 0) return { salePrice: 0, pricePerAcre: 0 }
    if (state.bidMode === 'lump_sum') {
      const salePrice = Math.round(parsed)
      const pricePerAcre = acres > 0 ? Math.round(salePrice / acres) : 0
      return { salePrice, pricePerAcre }
    } else {
      // per_acre
      const pricePerAcre = Math.round(parsed)
      const salePrice = acres > 0 ? Math.round(pricePerAcre * acres) : 0
      return { salePrice, pricePerAcre }
    }
  }

  // Backwards-compat alias so other code can ask "what's the total?"
  // without knowing the mode. Returns 0 if no entry / no acres.
  const getTotalPrice = (tractId: string, acres: number): number => {
    const state = tractStates[tractId]
    if (!state) return 0
    return computePrices(state, acres).salePrice
  }

  // Shared helper: build the listing-level aggregated body from a
  // fully up-to-date tractStates map. Uses computePrices() so every
  // tract's salePrice is rounded to whole dollars — no float cruft
  // hits the backend.
  const buildListingUpdateBody = (
    listing: Listing,
    tractStatesNow: Record<string, TractState>,
  ) => {
    const allTracts = listing.tracts || []
    let totalSalePrice = 0
    let newListingTotalAcres = 0
    let totalTillableAcres = 0
    let weightedSoilRatingSum = 0
    let soilRatingAcresSum = 0
    allTracts.forEach(t => {
      const tState = tractStatesNow[t.id]
      const tractAcres = tState?.totalAcres || t.total_acres || 0
      const tractTillable = tState?.tillableAcres || t.tillable_acres || 0
      const tractSoilRating = tState?.soilRating ?? t.soil_rating ?? null
      newListingTotalAcres += tractAcres
      totalTillableAcres += tractTillable
      if (tractSoilRating && tractSoilRating > 0 && tractAcres > 0) {
        weightedSoilRatingSum += tractSoilRating * tractAcres
        soilRatingAcresSum += tractAcres
      }
      const tractSalePrice = tState
        ? computePrices(tState, tractAcres).salePrice
        : Number(t.sale_price || 0)
      totalSalePrice += tractSalePrice
    })
    const listingStatus = calculateListingStatus(allTracts, tractStatesNow, listing.status)
    const listingPricePerAcre = newListingTotalAcres > 0 ? Math.round(totalSalePrice / newListingTotalAcres) : null
    const listingPPTA = totalTillableAcres > 0 ? Math.round(totalSalePrice / totalTillableAcres) : null
    const weightedAvgSoilRating = soilRatingAcresSum > 0 ? weightedSoilRatingSum / soilRatingAcresSum : null
    const listingPPSR = totalSalePrice && weightedAvgSoilRating ? Math.round(totalSalePrice / weightedAvgSoilRating) : null

    // Only include sold_acres when the listing has fully closed. Every tract must
    // have a final status (Sold or No Sale) AND the resolved listing status must
    // itself be terminal (Sold / No Sale / Results). Mid-auction or active listings
    // must never receive a sold_acres value.
    const tractStatuses = allTracts.map(t => tractStatesNow[t.id]?.status || normalizeStatus(t.sale_status || 'listed'))
    const allTractsFinal = allTracts.length > 0 && tractStatuses.every(s => s === 'Sold' || s === 'No Sale')
    const listingTerminal = listingStatus === 'Sold' || listingStatus === 'No Sale' || listingStatus === 'Results'
    const soldAcresPayload: { sold_acres?: number } = {}
    if (allTractsFinal && listingTerminal) {
      soldAcresPayload.sold_acres = calculateSoldAcres(allTracts, tractStatesNow)
    }

    return {
      body: {
        sale_price: totalSalePrice,
        price_per_acre: listingPricePerAcre,
        price_per_tillable_acre: listingPPTA,
        price_per_soil_rating: listingPPSR,
        status: toDbStatus(listingStatus),
        ...soldAcresPayload,
        total_acres: newListingTotalAcres,
      },
      listingStatus,
      newListingTotalAcres,
    }
  }

  // SAVE & NOTIFY: the high-stakes button. This is the path that has
  // been firing wrong prices to customers in production. Hard rules:
  //  1) Refuse to fire if ANY tract is mid-edit with no price (Save & Notify
  //     used to clear tract 2's input and send a notification with the
  //     wrong price — never again).
  //  2) Every PATCH response.ok is checked; on the FIRST failure we abort
  //     without sending the notification. Prior version barreled past
  //     500s and sent notifications based on un-persisted state.
  //  3) Notification only fires if BOTH the tract saves AND the listing
  //     aggregate save succeeded.
  //  4) Once notify succeeds, lock is mirrored locally so the UI flips
  //     to "Locked" without a refresh.
  const handleSaveAndNotify = async (listingId: string) => {
    setSavingListing(listingId)
    setError('')
    const token = localStorage.getItem('auth_token')
    const listing = listings.find(l => l.id === listingId)

    if (!listing) {
      setSavingListing(null)
      return
    }

    try {
      // Preflight: a tract with a final status (Sold / Pending) MUST have
      // a price. If the user has somehow set status=Sold with an empty
      // price input, refuse to notify and tell them which tracts to fix.
      const allTracts = listing.tracts || []
      const missingPriceTracts: number[] = []
      for (const t of allTracts) {
        const ts = tractStates[t.id]
        if (!ts) continue
        const parsed = parseFloat(ts.enteredPriceStr) || 0
        const finalStatus = ts.status === 'Sold' || ts.status === 'Pending'
        if (finalStatus && parsed <= 0) {
          missingPriceTracts.push(t.tract_number)
        }
      }
      if (missingPriceTracts.length > 0) {
        setError(`Cannot send notification — tract ${missingPriceTracts.join(', ')} has no price but is marked Sold/Pending. Enter a price first.`)
        setSavingListing(null)
        return
      }

      // 1) PATCH every tract; fail fast if any save errors out.
      for (const tract of allTracts) {
        const tState = tractStates[tract.id]
        if (!tState) continue
        const { salePrice, pricePerAcre } = computePrices(tState, tState.totalAcres)
        const tractPPTA = tState.tillableAcres > 0 ? Math.round(salePrice / tState.tillableAcres) : null
        const tractPPSR = tState.soilRating && tState.soilRating > 0 && salePrice ? Math.round(salePrice / tState.soilRating) : null
        const tractRes = await fetch(`${API_URL}/api/tracts/${tract.id}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sale_price: salePrice,
            price_per_acre: pricePerAcre,
            price_per_tillable_acre: tractPPTA,
            price_per_soil_rating: tractPPSR,
            sale_status: toDbStatus(tState.status),
            total_acres: tState.totalAcres,
            tillable_acres: tState.tillableAcres,
            soil_rating: tState.soilRating,
          }),
        })
        if (!tractRes.ok) {
          const b = await tractRes.json().catch(() => ({}))
          setError(`Tract ${tract.tract_number} save failed — notification NOT sent: ${b.detail || `HTTP ${tractRes.status}`}`)
          setSavingListing(null)
          return
        }
      }

      // 2) Listing-level aggregate PATCH (status + totals).
      const { body, listingStatus, newListingTotalAcres } = buildListingUpdateBody(listing, tractStates)
      const listingRes = await fetch(`${API_URL}/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!listingRes.ok) {
        const b = await listingRes.json().catch(() => ({}))
        setError(`Listing save failed — notification NOT sent: ${b.detail || `HTTP ${listingRes.status}`}`)
        setSavingListing(null)
        return
      }

      // 3) Only AFTER both PATCH paths succeeded, fire the notification.
      const notifyResponse = await fetch(`${API_URL}/api/notifications/listing-result`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId }),
      })

      if (!notifyResponse.ok) {
        const b = await notifyResponse.json().catch(() => ({}))
        setError(`Notification failed: ${b.detail || `HTTP ${notifyResponse.status}`}`)
        setSavingListing(null)
        return
      }

      // Mirror lock locally so the UI updates immediately (no refresh
      // required). Backend already persisted control_center_locked=true
      // in the notify endpoint.
      setListings(prev => prev.map(l => {
        if (l.id === listingId) {
          return {
            ...l,
            status: toDbStatus(listingStatus),
            total_acres: newListingTotalAcres,
            control_center_locked: true,
            notified_at: new Date().toISOString(),
            tracts: l.tracts.map(t => {
              const ts = tractStates[t.id]
              if (!ts) return t
              const { salePrice, pricePerAcre } = computePrices(ts, ts.totalAcres)
              return {
                ...t,
                sale_price: salePrice,
                price_per_acre: pricePerAcre,
                sale_status: toDbStatus(ts.status),
                total_acres: ts.totalAcres,
                tillable_acres: ts.tillableAcres,
                soil_rating: ts.soilRating,
              }
            }),
          }
        }
        return l
      }))

      // Promote originals so per-tract Save button reads "Up-to-Date".
      for (const tract of allTracts) {
        const tState = tractStates[tract.id]
        if (tState) {
          updateTractState(tract.id, {
            originalEnteredPriceStr: tState.enteredPriceStr,
            originalStatus: tState.status,
            originalTotalAcres: tState.totalAcres,
            originalTillableAcres: tState.tillableAcres,
            originalSoilRating: tState.soilRating,
          })
        }
      }

      setNotifiedListings(prev => new Set(Array.from(prev).concat(listingId)))
    } catch (err) {
      setError(`Save & Notify failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingListing(null)
    }
  }

  // SAVE WITHOUT NOTIFY: same persistence path as Save & Notify, minus
  // the push step. Still response.ok-checks every PATCH so we never lie
  // about a save that didn't land.
  const handleSaveWithoutNotify = async (listingId: string) => {
    setSavingListing(listingId)
    setError('')
    const token = localStorage.getItem('auth_token')
    const listing = listings.find(l => l.id === listingId)

    if (!listing) {
      setSavingListing(null)
      return
    }

    try {
      const allTracts = listing.tracts || []
      for (const tract of allTracts) {
        const tState = tractStates[tract.id]
        if (!tState) continue
        const { salePrice, pricePerAcre } = computePrices(tState, tState.totalAcres)
        const tractPPTA = tState.tillableAcres > 0 ? Math.round(salePrice / tState.tillableAcres) : null
        const tractPPSR = tState.soilRating && tState.soilRating > 0 && salePrice ? Math.round(salePrice / tState.soilRating) : null
        const tractRes = await fetch(`${API_URL}/api/tracts/${tract.id}`, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sale_price: salePrice,
            price_per_acre: pricePerAcre,
            price_per_tillable_acre: tractPPTA,
            price_per_soil_rating: tractPPSR,
            sale_status: toDbStatus(tState.status),
            total_acres: tState.totalAcres,
            tillable_acres: tState.tillableAcres,
            soil_rating: tState.soilRating,
          }),
        })
        if (!tractRes.ok) {
          const b = await tractRes.json().catch(() => ({}))
          setError(`Tract ${tract.tract_number} save failed: ${b.detail || `HTTP ${tractRes.status}`}`)
          setSavingListing(null)
          return
        }
      }

      const { body, listingStatus, newListingTotalAcres } = buildListingUpdateBody(listing, tractStates)
      const listingRes = await fetch(`${API_URL}/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!listingRes.ok) {
        const b = await listingRes.json().catch(() => ({}))
        setError(`Listing save failed: ${b.detail || `HTTP ${listingRes.status}`}`)
        setSavingListing(null)
        return
      }

      // Mirror the persisted state locally so per-tract and listing
      // displays update without a refresh.
      setListings(prev => prev.map(l => {
        if (l.id === listingId) {
          return {
            ...l,
            status: toDbStatus(listingStatus),
            total_acres: newListingTotalAcres,
            tracts: l.tracts.map(t => {
              const ts = tractStates[t.id]
              if (!ts) return t
              const { salePrice, pricePerAcre } = computePrices(ts, ts.totalAcres)
              return {
                ...t,
                sale_price: salePrice,
                price_per_acre: pricePerAcre,
                sale_status: toDbStatus(ts.status),
                total_acres: ts.totalAcres,
                tillable_acres: ts.tillableAcres,
                soil_rating: ts.soilRating,
              }
            }),
          }
        }
        return l
      }))

      // Promote originals so per-tract Save button reads "Up-to-Date".
      for (const tract of allTracts) {
        const tState = tractStates[tract.id]
        if (tState) {
          updateTractState(tract.id, {
            originalEnteredPriceStr: tState.enteredPriceStr,
            originalStatus: tState.status,
            originalTotalAcres: tState.totalAcres,
            originalTillableAcres: tState.tillableAcres,
            originalSoilRating: tState.soilRating,
          })
        }
      }
    } catch (err) {
      setError(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSavingListing(null)
    }
  }

  // Format datetime - convert UTC to local time for display
  const formatDateTime = (dateTimeStr: string | null) => {
    if (!dateTimeStr) return 'TBD'
    try {
      const date = new Date(dateTimeStr)
      if (isNaN(date.getTime())) return 'TBD'

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
      const month = monthNames[date.getMonth()]
      const day = date.getDate()
      const year = date.getFullYear()
      const hours = date.getHours()
      const minutes = String(date.getMinutes()).padStart(2, '0')
      const ampm = hours >= 12 ? 'PM' : 'AM'
      const displayHours = hours % 12 || 12

      return `${month} ${day}, ${year}, ${displayHours}:${minutes} ${ampm}`
    } catch {
      return 'TBD'
    }
  }

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '-'
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
  }

  const getStatusColor = (status: string) => {
    const normalized = normalizeStatus(status)
    switch (normalized) {
      case 'Listed': return 'bg-blue-500'
      case 'Live': return 'bg-green-500'
      case 'Pending': return 'bg-yellow-500 text-black'
      case 'Sold': return 'bg-purple-500'
      case 'No Sale': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getSoilRatingLabel = (state: string | undefined): string => {
    const labels: Record<string, string> = {
      'IL': 'PI', 'MO': 'NCCPI', 'IA': 'CSR2', 'MN': 'CPI',
      'NE': 'NCCPI', 'IN': 'WAPI', 'SD': 'PI', 'ND': 'PI',
    }
    return labels[state || ''] || 'Soil'
  }

  // The Save button is enabled whenever ANY editable field has drifted
  // from its last-saved value. Note we compare the raw entered string —
  // not a derived float — so the Save button doesn't randomly grey out
  // when the user types a number that round-trips into a slightly
  // different float. Prior version checked pricePerAcre as a number,
  // which is what caused "Save button is usually grayed out so I can't
  // even click it" in production.
  const hasTractChanges = (tractId: string): boolean => {
    const state = tractStates[tractId]
    if (!state) return false
    return (
      state.enteredPriceStr !== state.originalEnteredPriceStr ||
      state.status !== state.originalStatus ||
      state.totalAcres !== state.originalTotalAcres ||
      state.tillableAcres !== state.originalTillableAcres ||
      state.soilRating !== state.originalSoilRating
    )
  }

  const hasListingChanges = (listing: Listing): boolean => {
    if (!listing.tracts || listing.tracts.length === 0) return false
    return listing.tracts.some(tract => hasTractChanges(tract.id))
  }

  const isListingLive = (listing: Listing): boolean => {
    return normalizeStatus(listing.status) === 'Live'
  }

  const canNotifyListing = (listing: Listing): boolean => {
    const status = normalizeStatus(listing.status)
    return status === 'Sold' || status === 'No Sale' || status === 'Pending'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-200 pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gray-600 hover:text-black">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-black">Auction Control Center</h1>
              <p className="text-gray-600">
                {(() => {
                  const d = selectedDay === 'tomorrow' ? new Date(Date.now() + 86400000) : new Date()
                  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
                })()}
                {' • '}{listings.length} auction{listings.length !== 1 ? 's' : ''} {selectedDay}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Today/Tomorrow Toggle */}
            <div className="flex items-center bg-gg-gray-800 rounded-lg p-1">
              <button
                onClick={() => setSelectedDay('today')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  selectedDay === 'today'
                    ? 'bg-gg-pink text-white'
                    : 'text-gg-gray-400 hover:text-white'
                }`}
              >
                Today
              </button>
              <button
                onClick={() => setSelectedDay('tomorrow')}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  selectedDay === 'tomorrow'
                    ? 'bg-gg-pink text-white'
                    : 'text-gg-gray-400 hover:text-white'
                }`}
              >
                Tomorrow
              </button>
            </div>
          <div className="flex items-center gap-2">
            {listings.length === 0 && !loading && (
              <button
                onClick={handleRunMigration}
                disabled={runningMigration}
                className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-500 disabled:opacity-50 font-medium"
              >
                <Loader2 className={runningMigration ? 'animate-spin' : 'hidden'} size={16} />
                {runningMigration ? 'Running Migration...' : 'Run DB Migration'}
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700 disabled:opacity-50"
            >
              <RefreshCw className={refreshing ? 'animate-spin' : ''} size={16} />
              Refresh
            </button>
          </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400">
            {error}
            <button onClick={() => setError('')} className="ml-4 underline">Dismiss</button>
          </div>
        )}

        {/* No Auctions */}
        {listings.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-600 text-lg">No auctions scheduled for {selectedDay}</p>
          </div>
        )}

        {/* Auctions List */}
        <div className="space-y-4">
          {listings.map(listing => (
            <div
              key={listing.id}
              className={`bg-gg-gray-900 rounded-xl overflow-hidden ${
                isListingLive(listing)
                  ? 'border-[5px] border-gg-pink'
                  : 'border border-gg-gray-800'
              }`}
            >
              {/* Listing Header */}
              <div 
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-gg-gray-800/50"
                onClick={() => toggleListing(listing.id)}
              >
                <div className="flex-1">
                  <p className="text-gg-gray-400 text-sm mb-1">{formatDateTime(listing.auction_datetime)}</p>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-bold text-gg-pink">{listing.company?.name || 'Unknown Company'}</span>
                    <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${getStatusColor(listing.status)}`}>
                      {normalizeStatus(listing.status)}
                    </span>
                    {listing.control_center_locked && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-amber-900/30 text-amber-400 border border-amber-700">
                        <Lock size={12} />
                        Locked
                      </span>
                    )}
                    {listing.source_url && (
                      <a
                        href={listing.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600 hover:text-white transition-colors"
                        title="Open listing URL"
                      >
                        <ExternalLink size={12} />
                        View Listing
                      </a>
                    )}
                  </div>
                  <h3 className="text-white font-medium mt-1">
                    {listing.county} County, {listing.state} • {listing.total_acres} acres
                  </h3>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-gg-gray-400 text-sm">{listing.tracts?.length || 0} tracts</p>
                  </div>
                  {expandedListings.has(listing.id) ? (
                    <ChevronUp className="text-gg-gray-400" size={20} />
                  ) : (
                    <ChevronDown className="text-gg-gray-400" size={20} />
                  )}
                </div>
              </div>

              {/* Expanded Content */}
              {expandedListings.has(listing.id) && (
                <div className="border-t border-gg-gray-800">
                  {/* Listing Actions */}
                  <div className="p-4 bg-gg-gray-800/30 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/listings/${listing.id}`}
                        className="px-3 py-1.5 bg-gg-gray-700 text-white text-sm rounded-lg hover:bg-gg-gray-600"
                      >
                        Edit Listing
                      </Link>
                      {/* Listing Status Selector */}
                      <div className="flex items-center gap-1 ml-4">
                        <span className="text-gg-gray-400 text-sm mr-2">Status:</span>
                        {LISTING_STATUSES.map(status => (
                          <button
                            key={status}
                            onClick={(e) => { e.stopPropagation(); handleSetListingStatus(listing.id, status) }}
                            disabled={listing.control_center_locked}
                            className={`px-2 py-1 text-xs rounded-lg ${
                              normalizeStatus(listing.status) === status
                                ? getStatusColor(status) + ' text-white'
                                : listing.control_center_locked
                                ? 'bg-gg-gray-800 text-gg-gray-600 cursor-not-allowed'
                                : 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
                            }`}
                          >
                            {status}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* "Save All" — single button that saves every
                          tract's currently-entered values + the listing
                          aggregate, without sending notifications. The
                          per-tract Save buttons used to live in the
                          tract cards but were removed; this is the only
                          save path now. */}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSaveWithoutNotify(listing.id) }}
                        disabled={savingListing === listing.id || !hasListingChanges(listing) || listing.control_center_locked}
                        className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
                          hasListingChanges(listing) && !listing.control_center_locked
                            ? 'bg-gg-gray-600 text-white hover:bg-gg-gray-500'
                            : 'bg-gg-gray-700 text-gg-gray-400 cursor-default'
                        }`}
                      >
                        <Save size={14} />
                        {savingListing === listing.id ? 'Saving...' : listing.control_center_locked ? 'Locked' : hasListingChanges(listing) ? 'Save All' : 'Up-to-Date'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSaveAndNotify(listing.id) }}
                        disabled={savingListing === listing.id || notifiedListings.has(listing.id) || listing.control_center_locked || !canNotifyListing(listing)}
                        className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 ${
                          notifiedListings.has(listing.id) || listing.control_center_locked || !canNotifyListing(listing)
                            ? 'bg-gg-gray-700 text-gg-gray-400 cursor-default'
                            : 'bg-purple-600 text-white hover:bg-purple-500'
                        }`}
                      >
                        <Bell size={14} />
                        {savingListing === listing.id ? 'Saving...' : notifiedListings.has(listing.id) || listing.control_center_locked ? 'Notified' : !canNotifyListing(listing) ? 'Set Final Status' : 'Save & Notify'}
                      </button>
                    </div>
                  </div>

                  {/* Tracts */}
                  <div className="divide-y divide-gg-gray-800">
                    {listing.tracts?.length === 0 && (
                      <p className="p-4 text-gg-gray-400 text-center">No tracts for this listing</p>
                    )}
                    {[...(listing.tracts || [])].sort((a, b) => (a.tract_number || 0) - (b.tract_number || 0)).map(tract => {
                      const fallback: TractState = {
                        enteredPriceStr: '',
                        originalEnteredPriceStr: '',
                        bidIncrement: 1000,
                        status: 'Listed',
                        saving: false,
                        bidMode: 'per_acre',
                        totalAcres: tract.total_acres || 0,
                        tillableAcres: tract.tillable_acres || 0,
                        soilRating: tract.soil_rating,
                        originalStatus: 'Listed',
                        originalTotalAcres: tract.total_acres || 0,
                        originalTillableAcres: tract.tillable_acres || 0,
                        originalSoilRating: tract.soil_rating,
                      }
                      const state = tractStates[tract.id] || fallback
                      const tractAcres = state.totalAcres || tract.total_acres || 0
                      const prices = computePrices(state, tractAcres)
                      const totalPrice = prices.salePrice
                      const derivedPerAcre = prices.pricePerAcre
                      const isPerAcre = state.bidMode === 'per_acre'
                      // Lock model: NOTHING is locked until Save & Notify
                      // is clicked. That action sets control_center_locked
                      // on the listing, and at that moment all tracts +
                      // listing inputs lock together. Per the user's
                      // spec: "individual tracts don't lock until Save &
                      // Notify is clicked, and then all tracts and
                      // listing information is locked."
                      const isLocked = listing.control_center_locked
                      const isTractExpanded = expandedTracts.has(tract.id)
                      // Needs-attention flags come straight from the additive
                      // /api/listings/today fields — read-only, no fetch needed
                      // just to show the badge.
                      const needsPolygonAttention = tract.has_polygon === false || tract.boundary_valid === false
                      const needsImageAttention = !!imageIssues[tract.id] || (tract.has_polygon && tract.has_image === false)
                      // Condensed-row thumbnail state (display-only — no save path).
                      // Placeholder when there's no polygon yet or no renderable
                      // image; amber corner badge when a polygon exists but its
                      // acreage/geometry failed the boundary_valid check.
                      const showThumbnailPlaceholder = tract.has_polygon === false || !tract.image_url
                      const showBoundaryWarningBadge = tract.has_polygon === true && tract.boundary_valid === false

                      return (
                        <div key={tract.id} className="p-4">
                          {/* Tract Header with Inline Editing */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3">
                              {/* Boundary-on-satellite thumbnail — lets the owner see
                                  the drawn polygon without opening the editor. When
                                  there's an image, click opens a large lightbox (the
                                  56px thumbnail is too small to read); the Edit Map
                                  button next to it is the actual edit affordance. A
                                  "No boundary" tile has nothing to enlarge, so it
                                  still opens the editor directly so one can be drawn.
                                  Amber corner badge when the boundary exists but
                                  failed the acreage check. */}
                              <button
                                type="button"
                                onClick={() => {
                                  if (showThumbnailPlaceholder) {
                                    toggleTract(listing.id, tract)
                                  } else {
                                    setLightboxTract({
                                      imageUrl: tract.image_url as string,
                                      label: `Tract ${tract.tract_number} — ${listing.county}, ${listing.state}`,
                                      listingId: listing.id,
                                      tract,
                                    })
                                  }
                                }}
                                title={
                                  showThumbnailPlaceholder
                                    ? 'No boundary drawn — click to edit'
                                    : showBoundaryWarningBadge
                                    ? 'Boundary saved but acreage looks off — click to view large'
                                    : 'Click to view larger'
                                }
                                className="relative flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-gg-gray-700 hover:border-gg-pink transition-colors"
                              >
                                {showThumbnailPlaceholder ? (
                                  <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 bg-red-900/40 text-red-400">
                                    <AlertTriangle size={14} />
                                    <span className="text-[8px] leading-none font-semibold text-center px-0.5">No boundary</span>
                                  </div>
                                ) : (
                                  <img
                                    src={tract.image_url || undefined}
                                    alt={`Tract ${tract.tract_number} boundary`}
                                    loading="lazy"
                                    className="w-full h-full object-cover bg-gg-gray-800"
                                  />
                                )}
                                {showBoundaryWarningBadge && (
                                  <span
                                    className="absolute top-0 right-0 flex items-center justify-center w-4 h-4 bg-amber-600 text-white rounded-bl"
                                    title="Check acres — boundary saved but acreage looks off"
                                  >
                                    <AlertTriangle size={10} />
                                  </span>
                                )}
                              </button>
                              <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-white font-medium">Tract {tract.tract_number}</span>
                              {/* Polygon/tillable/soil editor toggle — collapsed by
                                  default so the condensed list is unchanged until
                                  opened. Reuses TractMapEditor + TillableCluWorkshop
                                  exactly as the data-cleanup screen does. Restyled to
                                  GG-pink so it reads as the primary per-tract action
                                  (was subtle gray) — amber attention-needed styling
                                  still takes priority when the tract needs a look. */}
                              <button
                                type="button"
                                onClick={() => toggleTract(listing.id, tract)}
                                title={isTractExpanded ? 'Hide polygon/tillable editor' : 'Edit polygon/tillable/soil'}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors ${
                                  needsPolygonAttention || needsImageAttention
                                    ? 'bg-amber-900/30 text-amber-400 border-amber-700 hover:bg-amber-900/50'
                                    : isTractExpanded
                                    ? 'bg-gg-pink text-white border-gg-pink hover:bg-gg-pink/90'
                                    : 'bg-gg-pink/10 text-gg-pink border-gg-pink hover:bg-gg-pink/20'
                                }`}
                              >
                                <MapPin size={12} />
                                {isTractExpanded ? 'Hide Map' : 'Edit Map'}
                                {(needsPolygonAttention || needsImageAttention) && <AlertTriangle size={12} />}
                              </button>
                              <span className="text-gg-gray-600">|</span>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={state.totalAcres || ''}
                                  onChange={(e) => updateTractState(tract.id, { totalAcres: parseFloat(e.target.value) || 0 })}
                                  disabled={isLocked}
                                  className={`w-20 bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-0.5 text-sm ${isLocked ? 'text-gg-gray-500 cursor-not-allowed' : 'text-white'}`}
                                  step="0.01"
                                />
                                <span className="text-gg-gray-400 text-sm">ac</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={state.tillableAcres || ''}
                                  onChange={(e) => updateTractState(tract.id, { tillableAcres: parseFloat(e.target.value) || 0 })}
                                  disabled={isLocked}
                                  className={`w-20 bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-0.5 text-sm ${isLocked ? 'text-gg-gray-500 cursor-not-allowed' : 'text-white'}`}
                                  step="0.01"
                                />
                                <span className="text-gg-gray-400 text-sm">till</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={state.soilRating ?? ''}
                                  onChange={(e) => updateTractState(tract.id, { soilRating: e.target.value === '' ? null : parseFloat(e.target.value) })}
                                  disabled={isLocked}
                                  className={`w-16 bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-0.5 text-sm ${isLocked ? 'text-gg-gray-500 cursor-not-allowed' : 'text-white'}`}
                                  step="0.1"
                                />
                                <span className="text-gg-gray-400 text-sm">{getSoilRatingLabel(listing.state)}</span>
                              </div>
                              <span className="text-gg-gray-400 text-sm">{tract.land_type || ''}</span>
                              </div>
                            </div>
                            <span className={`px-2 py-0.5 rounded-lg text-xs font-medium ${getStatusColor(state.status)}`}>
                              {state.status}
                            </span>
                          </div>

                          {/* Price Controls */}
                          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                            {/* Price Input with Toggle */}
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-gg-gray-400 text-xs">
                                  {isPerAcre ? 'Price/Acre' : 'Total Price'}
                                </label>
                                <button
                                  onClick={() => handleToggleBidMode(tract.id, tractAcres)}
                                  disabled={isLocked}
                                  className={`text-xs ${isLocked ? 'text-gg-gray-600 cursor-not-allowed' : 'text-gg-pink hover:text-gg-pink/80'}`}
                                >
                                  {isPerAcre ? '→ Lump Sum' : '→ Per Acre'}
                                </button>
                              </div>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gg-gray-400">$</span>
                                {/* SINGLE controlled input bound to the raw
                                    string the user typed. No round-trip
                                    division. Only one input per mode so
                                    React doesn't lose focus between toggles. */}
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={state.enteredPriceStr}
                                  onChange={(e) => handlePriceInputChange(tract.id, e.target.value)}
                                  disabled={isLocked}
                                  className={`w-full bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 pl-7 text-lg font-bold ${isLocked ? 'text-gg-gray-500 cursor-not-allowed' : 'text-white'}`}
                                />
                              </div>
                              <p className="text-gg-gray-400 text-xs mt-1">
                                {isPerAcre
                                  ? `Total: ${formatCurrency(totalPrice)}`
                                  : `${formatCurrency(derivedPerAcre)}/acre`
                                }
                              </p>
                            </div>

                            {/* Status Selector */}
                            <div>
                              <label className="block text-gg-gray-400 text-xs mb-1">Status</label>
                              <div className="flex flex-wrap gap-1">
                                {TRACT_STATUSES.map(status => (
                                  <button
                                    key={status}
                                    onClick={() => handleSetStatus(tract.id, status)}
                                    disabled={isLocked}
                                    className={`px-2 py-1 text-xs rounded-lg ${
                                      state.status === status
                                        ? getStatusColor(status) + ' text-white'
                                        : isLocked
                                        ? 'bg-gg-gray-800 text-gg-gray-600 cursor-not-allowed'
                                        : 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
                                    }`}
                                  >
                                    {status}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Bid Increment Selector */}
                            <div className="lg:col-span-2">
                              <label className="block text-gg-gray-400 text-xs mb-1">
                                Bid Increment {isPerAcre ? '(per acre)' : '(lump sum)'}
                              </label>
                              <div className="flex flex-wrap gap-1">
                                {BID_INCREMENTS.map(inc => (
                                  <button
                                    key={inc}
                                    onClick={() => handleSetIncrement(tract.id, inc)}
                                    disabled={isLocked}
                                    className={`px-2 py-1 text-xs rounded-lg ${
                                      state.bidIncrement === inc
                                        ? 'bg-gg-pink text-white'
                                        : isLocked
                                        ? 'bg-gg-gray-800 text-gg-gray-600 cursor-not-allowed'
                                        : 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
                                    }`}
                                  >
                                    ${inc.toLocaleString()}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Action Buttons — quick-bid helper only.
                                There used to be a per-tract Save Tract
                                button here; we removed it because the
                                listing-level "Save All" button at the
                                top of the listing card now writes every
                                tract's currently-entered values in a
                                single click. One save path = one place
                                to audit for the float-precision and
                                response.ok-check bugs. */}
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => handleAddBid(tract.id, tractAcres)}
                                disabled={isLocked}
                                className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm ${
                                  isLocked
                                    ? 'bg-gg-gray-800 text-gg-gray-600 cursor-not-allowed'
                                    : 'bg-green-600 text-white hover:bg-green-500'
                                }`}
                              >
                                + {formatCurrency(state.bidIncrement)}{isPerAcre ? '/ac' : ''}
                              </button>
                            </div>
                          </div>

                          {/* Polygon / tillable / soil editor — collapsed by default.
                              Reuses TractMapEditor + TillableCluWorkshop EXACTLY as
                              data-cleanup:1497-1591 does: same props, same save
                              endpoints (tract-fix-boundary/apply and tracts/{id}/clu).
                              No new save logic is added here. */}
                          {isTractExpanded && (
                            <div className="mt-4 pt-4 border-t border-gg-gray-800">
                              {isLocked ? (
                                <p className="text-sm text-gg-gray-400 italic">
                                  This listing is locked (Save & Notify already sent) — the polygon and tillable/soil editors are read-only until it's unlocked.
                                </p>
                              ) : listing.verified && !verifiedAcked.has(listing.id) ? (
                                // Verified-listing confirm gate: the editors below are
                                // simply not mounted until the admin acknowledges, so no
                                // save endpoint can fire before this confirm. Covers the
                                // whole listing (all its tracts) once acknowledged.
                                <div className="p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg flex items-center justify-between gap-3">
                                  <p className="text-sm text-amber-300 flex items-center gap-2">
                                    <AlertTriangle size={16} />
                                    This listing is verified — editing its polygon/tillable data will overwrite verified data.
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => confirmVerifiedListing(listing)}
                                    className="px-3 py-1.5 text-sm rounded-lg bg-amber-700 text-white hover:bg-amber-600 whitespace-nowrap"
                                  >
                                    Save anyway
                                  </button>
                                </div>
                              ) : geometryLoading[tract.id] ? (
                                <div className="flex items-center gap-2 text-gg-gray-400 text-sm">
                                  <Loader2 className="animate-spin" size={16} /> Loading tract geometry…
                                </div>
                              ) : geometryError[tract.id] ? (
                                <div className="p-3 bg-red-900/20 border border-red-700/40 rounded-lg flex items-center justify-between gap-3">
                                  <p className="text-sm text-red-400">Failed to load tract geometry: {geometryError[tract.id]}</p>
                                  <button
                                    type="button"
                                    onClick={() => loadTractGeometry(tract.id)}
                                    className="px-3 py-1.5 text-sm rounded-lg bg-gg-gray-700 text-white hover:bg-gg-gray-600 whitespace-nowrap"
                                  >
                                    Retry
                                  </button>
                                </div>
                              ) : tractGeometry[tract.id] ? (
                                <>
                                  {imageIssues[tract.id] && (
                                    <div className="mb-3 p-3 bg-red-900/20 border border-red-700/40 rounded-lg text-sm text-red-400 flex items-center gap-2">
                                      <AlertTriangle size={16} className="flex-shrink-0" />
                                      <span>{imageIssues[tract.id]}</span>
                                    </div>
                                  )}
                                  {polygonDirty[tract.id] && (
                                    <div className="mb-3 p-2 bg-amber-900/20 border border-amber-700/40 rounded-lg text-xs text-amber-400">
                                      Unsaved boundary changes — save the boundary above before editing tillable/soil below; the CLU workshop loads CLUs clipped to the SAVED polygon.
                                    </div>
                                  )}
                                  {/* LIVE-TRACT boundary editor — saves ONLY the polygon via
                                      the restricted tract-fix-boundary/apply endpoint. */}
                                  <TractMapEditor
                                    stagingId={0}
                                    tractIndex={0}
                                    liveTractId={tract.id}
                                    tractNumber={tract.tract_number}
                                    siblingTracts={listing.tracts.map((t) => ({
                                      tract_number: t.tract_number ?? null,
                                      total_acres: t.total_acres ?? null,
                                      tillable_acres: t.tillable_acres ?? null,
                                    }))}
                                    // ALL other tracts on this listing, at parity with
                                    // data-cleanup: prefer tractGeometry (this session's
                                    // own GET /api/tracts/{id} fetch — reflects any
                                    // just-saved edit to that sibling) and fall back to
                                    // listingPolygons (the bulk GET /api/listings/{id}
                                    // snapshot loaded once on first expand of any tract
                                    // on this listing) so every sibling boundary is
                                    // available for snapping, not just ones individually
                                    // opened this session.
                                    neighborPolygons={listing.tracts
                                      .filter((t) => t.id !== tract.id)
                                      .flatMap((t) => toRings(
                                        tractGeometry[t.id]?.polygon_coordinates
                                        ?? listingPolygons[listing.id]?.[t.id]
                                        ?? null
                                      ))
                                      .filter((r) => Array.isArray(r) && r.length >= 3)}
                                    initialPolygon={tractGeometry[tract.id].polygon_coordinates}
                                    hideTillable
                                    tillablePolygon={null}
                                    showTillable={false}
                                    sourceImageUrl={tractGeometry[tract.id].image_url || listing.primary_image_url || null}
                                    sourceImageKind="listing_image"
                                    listingUrl={listing.source_url}
                                    listingState={listing.state}
                                    listingCounty={listing.county}
                                    scrapedAcres={tract.total_acres}
                                    latitude={tractGeometry[tract.id].latitude}
                                    longitude={tractGeometry[tract.id].longitude}
                                    onUpdate={(updated) => {
                                      setTractGeometry((prev) => ({
                                        ...prev,
                                        [tract.id]: {
                                          ...prev[tract.id],
                                          polygon_coordinates: updated.polygon_coordinates ?? prev[tract.id]?.polygon_coordinates ?? null,
                                          boundary_valid: updated.boundary_valid ?? prev[tract.id]?.boundary_valid ?? null,
                                          ...(updated.image_url !== undefined ? { image_url: updated.image_url } : {}),
                                        },
                                      }))
                                      patchListingTract(listing.id, tract.id, {
                                        boundary_valid: updated.boundary_valid,
                                        has_polygon: true,
                                        ...(updated.image_url !== undefined ? { has_image: !!updated.image_url } : {}),
                                      })
                                      // Business rule: every polygon tract must have
                                      // image_base64 AND image_url — surface a failed
                                      // regen as a visible per-tract error instead of
                                      // treating the save as fully successful.
                                      setImageIssues((prev) => {
                                        const next = { ...prev }
                                        if (updated.image_regenerated === false) {
                                          next[tract.id] = `Image not regenerated — retry${updated.image_error ? `: ${updated.image_error}` : ''}.`
                                        } else if (updated.image_regenerated === true) {
                                          delete next[tract.id]
                                        }
                                        return next
                                      })
                                      setCluReloadKeys((prev) => ({ ...prev, [tract.id]: (prev[tract.id] || 0) + 1 }))
                                    }}
                                    onDirtyChange={(d) => setPolygonDirty((prev) => ({ ...prev, [tract.id]: d }))}
                                  />
                                  {/* FSA-CLU tillable workshop — live published-tract mode. */}
                                  <TillableCluWorkshop
                                    tractId={tract.id}
                                    reloadKey={cluReloadKeys[tract.id] || 0}
                                    latitude={tractGeometry[tract.id].latitude}
                                    longitude={tractGeometry[tract.id].longitude}
                                    onSaved={(r) => {
                                      // Patch from the SERVER-RECOMPUTED values only —
                                      // never from client-sent values — so the condensed
                                      // row's numbers match exactly what was persisted.
                                      // tillable_acres is a non-nullable number on this
                                      // screen's Tract type (matches how the rest of the
                                      // page already treats it, e.g. `tract.tillable_acres
                                      // || 0`), so a cleared value coerces to 0 same as
                                      // everywhere else here.
                                      //
                                      // ONLY fields the CLU endpoint actually recomputes —
                                      // tillable acres / soil rating + their derived
                                      // price-per-* display fields. Deliberately does NOT
                                      // include sale_price / sale_status / price_per_acre:
                                      // the CLU response always echoes those back UNCHANGED
                                      // (it never modifies price or sale status), and
                                      // patching them here previously clobbered an admin's
                                      // in-progress price+status edit mid-typing (silently
                                      // reverted the entered value AND reset the dirty
                                      // baseline so no indicator caught it) — fixed per
                                      // 2026-07-16 review. Note: the backend CLU response
                                      // also includes `nccpi`, but it isn't forwarded here
                                      // because TillableCluWorkshop's onSaved prop type
                                      // doesn't expose it (see that component's interface)
                                      // — out of scope to add without touching the reused
                                      // component's callback shape.
                                      patchListingTract(listing.id, tract.id, {
                                        tillable_acres: r.tillable_acres ?? 0,
                                        soil_rating: r.soil_rating ?? null,
                                        soil_rating_type: r.soil_rating_type ?? null,
                                        price_per_tillable_acre: r.price_per_tillable_acre ?? null,
                                        price_per_soil_rating: r.price_per_soil_rating ?? null,
                                        has_tillable: r.tillable_acres != null,
                                      })
                                    }}
                                    onDirtyChange={() => { /* no gating action needed here today */ }}
                                  />
                                </>
                              ) : null}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Tract thumbnail lightbox — DISPLAY ONLY, no save path. Opened by
          clicking a tract's boundary thumbnail (see the tract row above);
          the "Edit Map" button here just closes this and re-uses the
          existing toggleTract editor-open flow, same as clicking Edit Map
          directly on the row. */}
      {lightboxTract && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 cursor-pointer"
          onClick={() => setLightboxTract(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[85vh] flex flex-col items-center cursor-default"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setLightboxTract(null)}
              className="absolute -top-2 -right-2 bg-black/60 text-white rounded-full p-1.5 hover:bg-black/80 z-10"
              title="Close"
            >
              <X size={20} />
            </button>
            <img
              src={lightboxTract.imageUrl}
              alt={lightboxTract.label}
              className="max-w-[90vw] max-h-[75vh] object-contain rounded-lg bg-gg-gray-800"
            />
            <div className="mt-3 flex items-center gap-3">
              <p className="text-white text-sm font-medium">{lightboxTract.label}</p>
              <button
                type="button"
                onClick={() => {
                  const { listingId, tract } = lightboxTract
                  setLightboxTract(null)
                  toggleTract(listingId, tract)
                }}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border bg-gg-pink/10 text-gg-pink border-gg-pink hover:bg-gg-pink/20"
              >
                <MapPin size={12} />
                Edit this boundary
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
