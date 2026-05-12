'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, ExternalLink, MapPin } from 'lucide-react'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

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
  boundary_status?: 'missing' | 'wrong'
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
  const [stateFilter, setStateFilter] = useState<string>('')
  const [companyFilter, setCompanyFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing' | 'wrong'>('all')
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
              Production auction tracts without polygon_coordinates, scoped to
              upcoming auctions. Use this screen to test the boundary drawing
              tool — pick a tract and draw its polygon.
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
            {(['all', 'missing', 'wrong'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setStatusFilter(opt)}
                className={`px-3 py-1 text-xs ${statusFilter === opt ? 'bg-gg-pink/30 text-gg-pink' : 'bg-gg-gray-900 text-gg-gray-300 hover:bg-gg-gray-800'}`}
              >
                {opt === 'all' ? 'All' : opt === 'missing' ? 'Missing' : 'Wrong'}
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
