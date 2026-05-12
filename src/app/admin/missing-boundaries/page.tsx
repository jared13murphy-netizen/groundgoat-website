'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ExternalLink, MapPin, Trash2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const API_URL = 'https://practical-serenity-production.up.railway.app'

type Item = {
  tract_id: string
  tract_number: number | null
  total_acres: number | null
  land_type: string | null
  has_image: boolean
  listing_id: string
  title: string | null
  county: string | null
  state: string | null
  auction_datetime: string | null
  primary_image_url: string | null
  brochure_url: string | null
  source_url: string | null
  company_name: string | null
  boundary_status?: 'missing' | 'wrong' | 'ok'
}

type StateCount = { state: string; total: number; missing: number; wrong: number }
type CompanyCount = { company: string; total: number; missing: number; wrong: number }

function formatDate(iso: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export default function MissingBoundariesPage() {
  const [items, setItems] = useState<Item[]>([])
  const [byState, setByState] = useState<StateCount[]>([])
  const [byCompany, setByCompany] = useState<CompanyCount[]>([])
  const [deletingListingId, setDeletingListingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Per-listing Surety overview extract state. Keyed by listing_id.
  const [overviewUrlByListing, setOverviewUrlByListing] = useState<Record<string, string>>({})
  const [overviewRunningId, setOverviewRunningId] = useState<string | null>(null)
  const [overviewResultByListing, setOverviewResultByListing] = useState<
    Record<string, { tracts: any[]; unmatched_polygons: any[]; notes?: string; error?: string }>
  >({})
  const [stateFilter, setStateFilter] = useState<string>('')
  const [companyFilter, setCompanyFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing' | 'wrong' | 'ok'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [geocodeStatus, setGeocodeStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const qs = new URLSearchParams()
        if (stateFilter) qs.set('state', stateFilter)
        if (statusFilter !== 'all') qs.set('status', statusFilter)
        if (companyFilter) qs.set('company', companyFilter)
        const url = `${SCRAPER_URL}/api/admin/missing-boundary-tracts${qs.toString() ? '?' + qs.toString() : ''}`
        setLoading(true)
        const res = await fetch(url)
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) {
          setItems(data.items || [])
          if (Array.isArray(data.by_state)) setByState(data.by_state)
          if (Array.isArray(data.by_company)) setByCompany(data.by_company)
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    // Fire-and-forget: ensure every listing on this screen has a
    // geocoded lat/lng so the boundary editor opens with the map
    // already centered on the correct township.
    setGeocodeStatus('Geocoding listings…')
    fetch(`${SCRAPER_URL}/api/admin/geocode-missing-listings`, { method: 'POST' })
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (body.success) {
          setGeocodeStatus(`Geocoded ${body.geocoded}/${body.processed} listings`)
        } else {
          setGeocodeStatus(`Geocode failed: ${body.error || 'unknown'}`)
        }
      })
      .catch(e => {
        if (!cancelled) setGeocodeStatus(`Geocode failed: ${e.message || e}`)
      })
    return () => { cancelled = true }
  }, [stateFilter, statusFilter, companyFilter])

  // Delete a listing (cascades to tracts via FK ON DELETE CASCADE).
  // Triple-checks before issuing the DELETE — accidental click is a
  // hard-to-undo destructive operation. The native window.confirm
  // requires explicit user assent and blocks the UI thread until
  // the user clicks Cancel or OK.
  const deleteListing = async (listingId: string, title: string | null,
                                company: string | null,
                                tractCount: number) => {
    const niceTitle = (title || '(untitled)').slice(0, 80)
    const msg = (
      `Delete this listing PERMANENTLY?\n\n` +
      `Title: ${niceTitle}\n` +
      `Company: ${company || '—'}\n` +
      `${tractCount} tract${tractCount === 1 ? '' : 's'} will also be deleted.\n\n` +
      `This cannot be undone.`
    )
    if (!window.confirm(msg)) return
    setDeletingListingId(listingId)
    setDeleteError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/listings/${listingId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          detail = body.detail || body.message || detail
        } catch {}
        throw new Error(detail)
      }
      // Remove from local state immediately so the UI updates without
      // needing a full reload.
      setItems(prev => prev.filter(it => it.listing_id !== listingId))
    } catch (e: any) {
      setDeleteError(`Delete failed: ${e.message || e}`)
    } finally {
      setDeletingListingId(null)
    }
  }

  const runOverviewExtract = async (listingId: string) => {
    const url = (overviewUrlByListing[listingId] || '').trim()
    if (!url) return
    setOverviewRunningId(listingId)
    setOverviewResultByListing(prev => {
      const next = { ...prev }
      delete next[listingId]
      return next
    })
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/listings/${listingId}/extract-boundaries-from-surety-overview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_url: url }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) {
        setOverviewResultByListing(prev => ({
          ...prev,
          [listingId]: { tracts: [], unmatched_polygons: [], error: body.error || `HTTP ${res.status}` },
        }))
      } else {
        setOverviewResultByListing(prev => ({
          ...prev,
          [listingId]: {
            tracts: body.tracts || [],
            unmatched_polygons: body.unmatched_polygons || [],
            notes: body.notes,
          },
        }))
      }
    } catch (e: any) {
      setOverviewResultByListing(prev => ({
        ...prev,
        [listingId]: { tracts: [], unmatched_polygons: [], error: e.message || String(e) },
      }))
    } finally {
      setOverviewRunningId(null)
    }
  }

  // Group by listing_id so multiple tracts on the same auction show together
  const grouped: Record<string, Item[]> = {}
  for (const it of items) {
    if (!grouped[it.listing_id]) grouped[it.listing_id] = []
    grouped[it.listing_id].push(it)
  }
  const listingIds = Object.keys(grouped).sort((a, b) => {
    const da = grouped[a][0].auction_datetime || ''
    const db = grouped[b][0].auction_datetime || ''
    return da.localeCompare(db)
  })

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Missing Boundaries</h1>
            <p className="text-sm text-gg-gray-400 mt-1">
              Lists every tract on any listing that has at least one missing
              or wrong boundary. Tracts that pass validation get a green
              <span className="text-emerald-300"> Correct</span> badge —
              spot-check those too, since if one tract on a listing is wrong
              the others often are.
            </p>
          </div>
          <div className="text-sm text-gg-gray-400 text-right">
            <div>{loading ? '…' : `${items.length} tract${items.length === 1 ? '' : 's'} across ${listingIds.length} listing${listingIds.length === 1 ? '' : 's'}`}</div>
            {geocodeStatus && (
              <div className="text-xs text-gg-gray-500 mt-1">{geocodeStatus}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="text-xs text-gg-gray-400 uppercase tracking-wide">State:</label>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-gg-pink"
          >
            <option value="">All states ({byState.reduce((s, x) => s + x.total, 0)})</option>
            {byState.map((s) => (
              <option key={s.state} value={s.state}>
                {s.state} ({s.total} — {s.missing} missing, {s.wrong} wrong)
              </option>
            ))}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Company:</label>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-gg-pink max-w-xs"
          >
            <option value="">
              All companies ({byCompany.reduce((s, x) => s + x.total, 0)})
            </option>
            {byCompany.map((c) => (
              <option key={c.company} value={c.company}>
                {c.company} ({c.total})
              </option>
            ))}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Type:</label>
          <div className="inline-flex rounded overflow-hidden border border-gg-gray-700">
            {(['all', 'missing', 'wrong', 'ok'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setStatusFilter(opt)}
                className={`px-3 py-1 text-xs ${statusFilter === opt ? 'bg-gg-pink/30 text-gg-pink' : 'bg-gg-gray-900 text-gg-gray-300 hover:bg-gg-gray-800'}`}
              >
                {opt === 'all' ? 'All' : opt === 'missing' ? 'Missing' : opt === 'wrong' ? 'Wrong' : 'Correct'}
              </button>
            ))}
          </div>

          {companyFilter && (
            <button
              onClick={() => setCompanyFilter('')}
              className="text-xs text-gg-pink underline hover:no-underline"
            >
              Clear company filter
            </button>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-gg-gray-400">
            <Loader2 className="animate-spin" size={18} /> Loading…
          </div>
        )}
        {error && (
          <div className="bg-red-900/40 border border-red-600 rounded p-3 text-red-300">
            {error}
          </div>
        )}
        {deleteError && (
          <div className="bg-red-900/40 border border-red-600 rounded p-3 text-red-300 mb-3 flex items-center justify-between gap-3">
            <span>{deleteError}</span>
            <button
              onClick={() => setDeleteError(null)}
              className="text-xs px-2 py-1 text-red-200 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-6 text-gg-gray-400">
            🎉 Every upcoming auction tract already has a boundary. Nothing to draw.
          </div>
        )}

        <div className="space-y-4">
          {listingIds.map((lid) => {
            const tracts = grouped[lid]
            const head = tracts[0]
            return (
              <div key={lid} className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-gg-gray-800 flex items-start gap-4">
                  {head.primary_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={head.primary_image_url}
                      alt=""
                      className="w-20 h-20 object-cover rounded border border-gg-gray-700 flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-white truncate">{head.title || '(untitled)'}</h2>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gg-gray-400">
                      {head.company_name && <span>{head.company_name}</span>}
                      <span className="flex items-center gap-1"><MapPin size={11} />{head.county}, {head.state}</span>
                      <span>Auction: {formatDate(head.auction_datetime)}</span>
                      {head.source_url && (
                        <a
                          href={head.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gg-pink hover:underline flex items-center gap-1"
                        >
                          Source <ExternalLink size={10} />
                        </a>
                      )}
                      {head.brochure_url && (
                        <a
                          href={head.brochure_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gg-pink hover:underline flex items-center gap-1"
                        >
                          Brochure <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteListing(lid, head.title, head.company_name, tracts.length)}
                    disabled={deletingListingId === lid}
                    className="text-xs px-3 py-1.5 rounded bg-red-500/15 hover:bg-red-500/25 disabled:opacity-50 text-red-300 border border-red-500/40 transition-colors flex items-center gap-1.5 flex-shrink-0 self-start"
                    title="Delete this listing and all its tracts. Confirmation required."
                  >
                    {deletingListingId === lid ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> Deleting…
                      </>
                    ) : (
                      <>
                        <Trash2 size={12} /> Delete Listing
                      </>
                    )}
                  </button>
                </div>

                {/* Surety overview map extract — one image populates ALL
                    tracts on this listing (polygons + tillable + soil
                    rating). Returns results inline; admin reviews and
                    saves each tract via the per-tract editor. */}
                <div className="px-4 py-3 border-b border-gg-gray-800 bg-gg-gray-950/40">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-gg-gray-400 mb-1.5">
                        Surety Overview Map (extract all {tracts.length} tract{tracts.length === 1 ? '' : 's'} at once)
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="url"
                          value={overviewUrlByListing[lid] || ''}
                          onChange={(e) => setOverviewUrlByListing(prev => ({ ...prev, [lid]: e.target.value }))}
                          placeholder="Paste Surety overview map URL (shows all tracts with boundary lines)"
                          disabled={overviewRunningId === lid}
                          className="flex-1 min-w-0 px-2 py-1.5 bg-gg-gray-900 border border-gg-gray-800 rounded text-xs text-white placeholder-gg-gray-500 focus:outline-none focus:border-gg-pink disabled:opacity-50"
                        />
                        <button
                          onClick={() => runOverviewExtract(lid)}
                          disabled={overviewRunningId === lid || !(overviewUrlByListing[lid] || '').trim()}
                          className="px-3 py-1.5 text-xs rounded bg-gg-pink/30 hover:bg-gg-pink/50 disabled:opacity-50 text-gg-pink border border-gg-pink/40 flex-shrink-0"
                          title="Run Vision + OpenCV pipeline on the overview map. Returns proposed polygons + tillable + soil rating for each tract."
                        >
                          {overviewRunningId === lid ? 'Extracting…' : 'Extract All Tracts'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {overviewResultByListing[lid] && (
                    <div className="mt-3 text-xs">
                      {overviewResultByListing[lid].error && (
                        <div className="bg-red-900/30 border border-red-700 rounded p-2 text-red-300">
                          ✗ {overviewResultByListing[lid].error}
                        </div>
                      )}
                      {overviewResultByListing[lid].tracts.length > 0 && (
                        <div>
                          <div className="text-emerald-300 mb-1.5">
                            ✓ Extracted {overviewResultByListing[lid].tracts.length} polygon{overviewResultByListing[lid].tracts.length === 1 ? '' : 's'}.
                            {overviewResultByListing[lid].notes && (
                              <span className="text-gg-gray-400"> {overviewResultByListing[lid].notes}</span>
                            )}
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                            {overviewResultByListing[lid].tracts.map((t: any) => (
                              <div key={t.tract_id} className="bg-gg-gray-900 border border-gg-gray-800 rounded px-2 py-1.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium">Tract {t.tract_number ?? '?'}</span>
                                  <span className="text-[10px] text-gg-gray-400">{t.identification_method}</span>
                                </div>
                                <div className="text-gg-gray-300 text-[11px] mt-0.5">
                                  Polygon: {t.polygon_acres?.toFixed?.(2) ?? '—'} ac
                                  {' · '}
                                  Tillable: {t.tillable_acres ?? '—'} ac
                                  {' · '}
                                  {t.soil_rating_type || '—'}: {t.soil_rating ?? '—'}
                                </div>
                                <Link
                                  href={`/admin/upload-boundary-tract/${t.tract_id}`}
                                  className="text-[11px] text-gg-pink hover:underline mt-0.5 inline-block"
                                >
                                  Review on map →
                                </Link>
                              </div>
                            ))}
                          </div>
                          {overviewResultByListing[lid].unmatched_polygons.length > 0 && (
                            <div className="mt-2 text-amber-300">
                              ⚠ {overviewResultByListing[lid].unmatched_polygons.length} polygon{overviewResultByListing[lid].unmatched_polygons.length === 1 ? '' : 's'} could not be matched to a listing tract.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="divide-y divide-gg-gray-800">
                  {tracts.map((t) => (
                    <div key={t.tract_id} className="px-4 py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-white font-medium">Tract {t.tract_number ?? '?'}</span>
                        <span className="text-sm text-gg-gray-300">
                          {t.total_acres != null ? `${t.total_acres} ac` : 'acres unknown'}
                        </span>
                        {t.boundary_status === 'wrong' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40"
                            title="Polygon area differs from scraped acres by > 1 ac — boundary is likely wrong"
                          >
                            Wrong
                          </span>
                        )}
                        {t.boundary_status === 'missing' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            title="No boundary on file"
                          >
                            Missing
                          </span>
                        )}
                        {t.boundary_status === 'ok' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            title="Boundary passes auto-validation. Spot-check anyway — if other tracts on this listing are wrong, this one might be too."
                          >
                            Correct
                          </span>
                        )}
                        {t.land_type && (
                          <span className="text-xs text-gg-pink">{t.land_type}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/upload-boundary-tract/${t.tract_id}`}
                          className="px-3 py-1.5 text-xs rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors flex items-center gap-1"
                          title="Paste an auction-website screenshot and let Claude Vision extract the boundary"
                        >
                          📷 Upload Image
                        </Link>
                        <Link
                          href={`/admin/boundary-draw-tract/${t.tract_id}`}
                          className="px-3 py-1.5 text-xs rounded bg-gg-pink/20 hover:bg-gg-pink/30 text-gg-pink border border-gg-pink/40 transition-colors flex items-center gap-1"
                        >
                          ✏️ Draw Boundary
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
