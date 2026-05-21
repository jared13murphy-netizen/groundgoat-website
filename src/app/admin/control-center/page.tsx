'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Bell, ChevronDown, ChevronUp, RefreshCw, Save, ExternalLink, Lock } from 'lucide-react'

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
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [savingListing, setSavingListing] = useState<string | null>(null)
  // Track which listings have had notifications sent (persisted per session)
  const [notifiedListings, setNotifiedListings] = useState<Set<string>>(new Set())
  const [runningMigration, setRunningMigration] = useState(false)
  const [selectedDay, setSelectedDay] = useState<'today' | 'tomorrow'>('today')

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
    const soldAcres = calculateSoldAcres(allTracts, tractStatesNow)
    const listingPricePerAcre = newListingTotalAcres > 0 ? Math.round(totalSalePrice / newListingTotalAcres) : null
    const listingPPTA = totalTillableAcres > 0 ? Math.round(totalSalePrice / totalTillableAcres) : null
    const weightedAvgSoilRating = soilRatingAcresSum > 0 ? weightedSoilRatingSum / soilRatingAcresSum : null
    const listingPPSR = totalSalePrice && weightedAvgSoilRating ? Math.round(totalSalePrice / weightedAvgSoilRating) : null
    return {
      body: {
        sale_price: totalSalePrice,
        price_per_acre: listingPricePerAcre,
        price_per_tillable_acre: listingPPTA,
        price_per_soil_rating: listingPPSR,
        status: toDbStatus(listingStatus),
        sold_acres: soldAcres,
        total_acres: newListingTotalAcres,
      },
      listingStatus,
      newListingTotalAcres,
    }
  }

  // Save one tract + the listing's aggregated totals. CRITICAL: checks
  // response.ok on every PATCH. If anything fails, we surface the error
  // and leave the "originals" un-promoted so hasTractChanges still says
  // "unsaved." Prior version silently barreled past 5xxs and let the
  // user think a save had landed when it hadn't.
  const handleSaveTract = async (tractId: string, listingId: string) => {
    const state = tractStates[tractId]
    if (!state) return

    updateTractState(tractId, { saving: true })
    setError('')
    const token = localStorage.getItem('auth_token')

    try {
      const listing = listings.find(l => l.id === listingId)
      if (!listing) return
      const { salePrice, pricePerAcre } = computePrices(state, state.totalAcres)
      const tractPPTA = state.tillableAcres > 0 ? Math.round(salePrice / state.tillableAcres) : null
      const tractPPSR = state.soilRating && state.soilRating > 0 && salePrice ? Math.round(salePrice / state.soilRating) : null

      // 1) Tract PATCH
      const tractRes = await fetch(`${API_URL}/api/tracts/${tractId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sale_price: salePrice,
          price_per_acre: pricePerAcre,
          price_per_tillable_acre: tractPPTA,
          price_per_soil_rating: tractPPSR,
          sale_status: toDbStatus(state.status),
          total_acres: state.totalAcres,
          tillable_acres: state.tillableAcres,
          soil_rating: state.soilRating,
        }),
      })
      if (!tractRes.ok) {
        const b = await tractRes.json().catch(() => ({}))
        setError(`Tract save failed: ${b.detail || `HTTP ${tractRes.status}`}`)
        return
      }

      // 2) Listing-level aggregate PATCH
      const { body, listingStatus, newListingTotalAcres } = buildListingUpdateBody(
        listing,
        { ...tractStates, [tractId]: state },
      )
      const listingRes = await fetch(`${API_URL}/api/listings/${listingId}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!listingRes.ok) {
        const b = await listingRes.json().catch(() => ({}))
        setError(`Listing aggregate save failed: ${b.detail || `HTTP ${listingRes.status}`}`)
        return
      }

      // Update local state — only after BOTH PATCHes succeeded
      setListings(prev => prev.map(l => {
        if (l.id === listingId) {
          return {
            ...l,
            status: toDbStatus(listingStatus),
            total_acres: newListingTotalAcres,
            tracts: l.tracts.map(t =>
              t.id === tractId
                ? { ...t, sale_price: salePrice, sale_status: toDbStatus(state.status), price_per_acre: pricePerAcre, total_acres: state.totalAcres, tillable_acres: state.tillableAcres, soil_rating: state.soilRating }
                : t
            ),
          }
        }
        return l
      }))

      // Promote originals so the button reads "Up-to-Date"
      updateTractState(tractId, {
        originalEnteredPriceStr: state.enteredPriceStr,
        originalStatus: state.status,
        originalTotalAcres: state.totalAcres,
        originalTillableAcres: state.tillableAcres,
        originalSoilRating: state.soilRating,
      })
    } catch (err) {
      setError(`Tract save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      updateTractState(tractId, { saving: false })
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
                        {listing.control_center_locked ? 'Locked' : hasListingChanges(listing) ? 'Save' : 'Up-to-Date'}
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
                      // A tract is "locked" only if the LISTING is locked
                      // AND this specific tract had a price saved at the
                      // time of the lock. Per user verbatim requirement:
                      // "I NEVER want the Tract save button to say locked
                      // if the data isn't in the price field." This
                      // protects against Save & Notify locking the whole
                      // listing while one tract had a stale/empty input
                      // and orphaning that tract with no way to fill it.
                      const tractHasPersistedPrice = (tract.sale_price || 0) > 0
                      const isLocked = listing.control_center_locked && tractHasPersistedPrice

                      return (
                        <div key={tract.id} className="p-4">
                          {/* Tract Header with Inline Editing */}
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-white font-medium">Tract {tract.tract_number}</span>
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

                            {/* Action Buttons */}
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
                              <button
                                onClick={() => handleSaveTract(tract.id, listing.id)}
                                disabled={state.saving || !hasTractChanges(tract.id) || isLocked}
                                className={`flex-1 px-4 py-2 rounded-lg font-bold text-sm ${
                                  hasTractChanges(tract.id) && !isLocked
                                    ? 'bg-gg-pink text-white hover:bg-gg-pink/80'
                                    : 'bg-gg-gray-700 text-gg-gray-400 cursor-default'
                                } disabled:opacity-50`}
                              >
                                {state.saving ? 'Saving...' : isLocked ? 'Locked' : hasTractChanges(tract.id) ? 'Save Tract' : 'Up-to-Date'}
                              </button>
                            </div>
                          </div>
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
    </div>
  )
}
