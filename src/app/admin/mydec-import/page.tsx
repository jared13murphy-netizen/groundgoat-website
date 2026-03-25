'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  MapPin,
  Calendar,
  Layers,
  Trash2,
  Play,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Wheat,
  DollarSign,
  TreePine,
  Eye,
} from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

interface StagingItem {
  id: number
  source_url: string
  scraped_data: any
  auction_date: string | null
  status: string
  created_at: string
  listing_type: string
  source_type: string
}

// Expandable detail panel showing every field with its data source
function TractDetail({ item }: { item: StagingItem }) {
  const sd = item.scraped_data || {}
  const tract = sd.tracts?.[0] || {}
  const listing = sd.listing || {}
  const sources = sd.enrichment_sources || {}
  const cropBreakdown = sd.crop_breakdown || {}

  const sourceLabel = (src: string | null) => {
    if (!src) return <span className="text-red-400 font-medium">NOT AVAILABLE</span>
    const labels: Record<string, { text: string; color: string }> = {
      county_arcgis: { text: 'County ArcGIS (free)', color: 'text-green-400' },
      regrid: { text: 'Regrid API', color: 'text-blue-400' },
      county_centroid: { text: 'County centroid (inaccurate)', color: 'text-red-400' },
      usda_sda: { text: 'USDA Soil Data Access', color: 'text-green-400' },
      cropscape: { text: 'USDA CropScape CDL', color: 'text-green-400' },
      census_geocoder: { text: 'US Census Geocoder', color: 'text-green-400' },
      mydec: { text: 'IL MyDec PTAX-203', color: 'text-purple-400' },
      iowaassessors: { text: 'Iowa Assessors (Vanguard)', color: 'text-purple-400' },
      iowaassessors_csr: { text: 'Iowa Assessors CSR2', color: 'text-green-400' },
    }
    const l = labels[src] || { text: src, color: 'text-gg-gray-300' }
    return <span className={l.color}>{l.text}</span>
  }

  type FieldRow = { label: string; value: string | number | null | undefined; source: string | null; warn?: boolean }

  const isIowa = item.source_type === 'iowa' || !!sd.iowa_parcel_number
  const dataSource = isIowa ? 'iowaassessors' : 'mydec'

  const fields: FieldRow[] = [
    // Source-specific ID fields
    ...(isIowa ? [
      { label: 'Parcel Number', value: sd.iowa_parcel_number, source: dataSource },
      { label: 'Recording', value: sd.iowa_recording || 'N/A', source: dataSource },
      { label: 'Sale Date', value: sd.iowa_sale_date, source: dataSource },
    ] : [
      { label: 'PIN', value: sd.mydec_pin, source: dataSource },
      { label: 'Declaration ID', value: sd.mydec_declaration_id, source: dataSource },
      { label: 'Date Recorded', value: sd.mydec_date_recorded, source: dataSource },
      { label: 'Auction Sale', value: sd.mydec_auction_sale ? 'Yes' : 'No', source: dataSource },
    ]) as FieldRow[],
    { label: 'Acres', value: tract.acres, source: dataSource },
    { label: 'Sale Price', value: tract.sale_price ? `$${Number(tract.sale_price).toLocaleString()}` : null, source: dataSource },
    { label: 'Price/Acre', value: tract.price_per_acre ? `$${Math.round(tract.price_per_acre).toLocaleString()}/ac` : null, source: dataSource },
    { label: '---', value: '', source: null },
    { label: 'Latitude', value: tract.latitude, source: sources.boundary },
    { label: 'Longitude', value: tract.longitude, source: sources.boundary },
    { label: 'Boundary Points', value: tract.polygon_coordinates?.length || 0, source: sources.boundary, warn: !tract.polygon_coordinates },
    { label: '---', value: '', source: null },
    { label: 'State', value: `${tract.state_full} (${tract.state_abbr})`, source: 'census_geocoder' },
    { label: 'County', value: tract.county_name, source: 'census_geocoder' },
    { label: 'Township', value: tract.township, source: 'census_geocoder' },
    { label: '---', value: '', source: null },
    { label: 'NCCPI', value: tract.nccpi, source: sources.soil, warn: !tract.nccpi },
    { label: '$/NCCPI', value: tract.price_per_nccpi ? `$${Math.round(tract.price_per_nccpi).toLocaleString()}` : null, source: sources.soil },
    ...(isIowa ? [
      { label: 'Soil Rating (CSR2)', value: tract.soil_rating ? `${tract.soil_rating}` : 'N/A', source: sources.soil_rating || null },
      { label: '$/CSR', value: tract.price_per_soil_rating ? `$${Math.round(tract.price_per_soil_rating).toLocaleString()}` : null, source: sources.soil_rating || null },
      { label: 'Total CSR', value: sd.iowa_total_csr, source: dataSource },
    ] : [
      { label: 'Soil Rating (PI)', value: tract.soil_rating || 'N/A — PI not available from USDA', source: null },
    ]) as FieldRow[],
    { label: '---', value: '', source: null },
    { label: 'Tillable Acres', value: tract.tillable_acres, source: sources.tillable, warn: !tract.tillable_acres },
    { label: 'Price/Tillable Acre', value: tract.price_per_tillable_acre ? `$${Math.round(tract.price_per_tillable_acre).toLocaleString()}/ac` : null, source: sources.tillable },
    { label: '---', value: '', source: null },
    { label: 'Land Type', value: tract.land_type, source: dataSource },
    ...(!isIowa ? [
      { label: 'Seller', value: sd.mydec_seller || 'N/A', source: 'mydec' },
      { label: 'Buyer', value: sd.mydec_buyer || 'N/A', source: 'mydec' },
      { label: 'Legal Description', value: sd.mydec_legal_description || 'N/A', source: 'mydec' },
    ] : []) as FieldRow[],
  ]

  // Add crop breakdown rows
  if (Object.keys(cropBreakdown).length > 0) {
    fields.push({ label: '---', value: '', source: null })
    for (const [crop, pct] of Object.entries(cropBreakdown)) {
      fields.push({ label: `Crop: ${crop}`, value: `${pct}%`, source: sources.tillable })
    }
  }

  return (
    <div className="mt-3 bg-gg-gray-800/60 rounded-lg p-4 border border-gg-gray-700">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
        {/* Left: Data fields */}
        <div>
          <h3 className="text-sm font-semibold text-gg-pink mb-3">Field Verification</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gg-gray-500">
                <th className="text-left pb-2 w-[35%]">Field</th>
                <th className="text-left pb-2 w-[30%]">Value</th>
                <th className="text-left pb-2 w-[35%]">Source</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => {
                if (f.label === '---') {
                  return <tr key={i}><td colSpan={3} className="py-1"><hr className="border-gg-gray-700" /></td></tr>
                }
                return (
                  <tr key={i} className={f.warn ? 'text-red-400' : ''}>
                    <td className="py-0.5 text-gg-gray-400">{f.label}</td>
                    <td className="py-0.5 font-mono text-white">
                      {f.value !== null && f.value !== undefined ? String(f.value) : <span className="text-red-400">MISSING</span>}
                    </td>
                    <td className="py-0.5">{sourceLabel(f.source)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Right: Map preview + tract image */}
        <div className="mt-4 md:mt-0">
          <h3 className="text-sm font-semibold text-gg-pink mb-3">Visual Verification</h3>
          {tract.has_tract_image && (
            <div className="mb-3">
              <p className="text-xs text-gg-gray-500 mb-1">Satellite + Boundary Overlay (200×200)</p>
              <TractThumbnailLarge stagingId={item.id} tractIndex={0} />
            </div>
          )}
          {tract.latitude && tract.longitude && (
            <div className="space-y-2">
              <p className="text-xs text-gg-gray-500">Verify location on Google Maps:</p>
              <a
                href={`https://www.google.com/maps/@${tract.latitude},${tract.longitude},16z/data=!3m1!1e1`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Open in Google Maps (satellite) →
              </a>
              {isIowa && sd.iowa_parcel_number && (
                <>
                  <p className="text-xs text-gg-gray-500 mt-2">Verify on Iowa Assessor:</p>
                  <a
                    href={`https://${(sd as any).iowa_parcel_number ? (item.source_url?.split('.iowaassessors')[0]?.split('//')[1] || tract.county_name?.toLowerCase().replace(/ /g, '')) : ''}.iowaassessors.com/parcel.php?parcel=${sd.iowa_parcel_number.replace(/-/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300 underline"
                  >
                    Open Iowa Assessor parcel page →
                  </a>
                </>
              )}
              <p className="text-xs text-gg-gray-500 mt-2">Verify soil data:</p>
              <a
                href={`https://websoilsurvey.nrcs.usda.gov/app/WebSoilSurvey.aspx`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-400 hover:text-blue-300 underline"
              >
                Open USDA Web Soil Survey →
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Larger tract image for detail view
function TractThumbnailLarge({ stagingId, tractIndex }: { stagingId: number, tractIndex: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetchWithAuth(`${API_URL}/api/admin/staging/${stagingId}/tract-image/${tractIndex}`)
      .then(res => res.json())
      .then(data => {
        if (data.tract_image_base64) {
          setSrc(`data:image/png;base64,${data.tract_image_base64}`)
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [stagingId, tractIndex])

  if (!loaded) return <div className="w-48 h-48 rounded bg-gg-gray-800 animate-pulse" />
  if (!src) return <div className="w-48 h-48 rounded bg-gg-gray-800 flex items-center justify-center text-gg-gray-600"><MapPin size={24} /></div>
  return <img src={src} alt="Tract satellite" className="w-48 h-48 rounded object-cover border border-gg-gray-700" />
}

function TractThumbnail({ stagingId, tractIndex }: { stagingId: number, tractIndex: number }) {
  const [src, setSrc] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetchWithAuth(`${API_URL}/api/admin/staging/${stagingId}/tract-image/${tractIndex}`)
      .then(res => res.json())
      .then(data => {
        if (data.tract_image_base64) {
          setSrc(`data:image/png;base64,${data.tract_image_base64}`)
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [stagingId, tractIndex])

  if (!loaded) {
    return <div className="w-16 h-16 rounded bg-gg-gray-800 animate-pulse shrink-0" />
  }
  if (!src) {
    return <div className="w-16 h-16 rounded bg-gg-gray-800 shrink-0 flex items-center justify-center text-gg-gray-600"><MapPin size={16} /></div>
  }
  return <img src={src} alt="Tract" className="w-16 h-16 rounded object-cover shrink-0" />
}

export default function MyDecImportPage() {
  const router = useRouter()

  // Auth
  const [isAdmin, setIsAdmin] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)

  // State selector
  const [activeState, setActiveState] = useState<'IL' | 'IA'>('IL')

  // Import controls
  const [county, setCounty] = useState('LaSalle')
  const [monthsBack, setMonthsBack] = useState(12)
  const [importLimit, setImportLimit] = useState(50)
  const [importing, setImporting] = useState(false)
  const [importStats, setImportStats] = useState<any>(null)

  // Review list
  const [items, setItems] = useState<StagingItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set())
  const itemsPerPage = 20

  // Expanded detail view
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const toggleExpanded = (id: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // County tracker
  const [countyTracker, setCountyTracker] = useState<any[]>([])
  const [trackerLoading, setTrackerLoading] = useState(false)
  const [trackerExpanded, setTrackerExpanded] = useState(false)

  const fetchCountyTracker = useCallback(async () => {
    setTrackerLoading(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/mydec/county-tracker`)
      const data = await res.json()
      setCountyTracker(data.counties || [])
    } catch (e) {
      console.error('Failed to fetch county tracker:', e)
    }
    setTrackerLoading(false)
  }, [])

  // Rollback
  const [mydecCount, setMydecCount] = useState(0)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Auth check
  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    fetchWithAuth(`${API_URL}/api/auth/me`)
      .then(res => res.json())
      .then(data => {
        if (data.account_type !== 'groundgoat_admin' && data.account_type !== 'groundgoat_sales') {
          router.push('/account')
        } else {
          setIsAdmin(true)
        }
        setAuthChecked(true)
      })
      .catch(() => router.push('/signin'))
  }, [router])

  // Fetch staging items
  const sourceType = activeState === 'IA' ? 'iowa' : 'mydec'
  const fetchItems = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchWithAuth(
        `${API_URL}/api/admin/staging?source_type=${sourceType}&status=pending&limit=${itemsPerPage}&offset=${page * itemsPerPage}`
      )
      const data = await res.json()
      setItems(data.items || [])
      setTotal(data.total || 0)
    } catch (e) {
      console.error('Failed to fetch staging items:', e)
    }
    setLoading(false)
  }, [page, sourceType])

  // Fetch MyDec production count for rollback
  const fetchMydecCount = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/listings/by-external-id/count?prefix=mydec:`)
      const data = await res.json()
      setMydecCount(data.count || 0)
    } catch (e) {
      console.error('Failed to fetch mydec count:', e)
    }
  }, [])

  useEffect(() => {
    if (isAdmin) {
      fetchItems()
      fetchMydecCount()
      fetchCountyTracker()
    }
  }, [isAdmin, fetchItems, fetchMydecCount, fetchCountyTracker])

  // Run import
  const runImport = async () => {
    setImporting(true)
    setImportStats(null)
    const endpoint = activeState === 'IA' ? '/api/iowa/import' : '/api/mydec/import'
    try {
      const res = await fetch(`${SCRAPER_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          county: county || null,
          months_back: monthsBack,
          limit: importLimit,
        }),
      })
      const data = await res.json()
      setImportStats(data)
      // Refresh the review list and tracker
      setPage(0)
      fetchItems()
      fetchCountyTracker()
    } catch (e: any) {
      setImportStats({ success: false, error: e.message })
    }
    setImporting(false)
  }

  // Approve (verify) a staging item
  const approveItem = async (id: number) => {
    setProcessingIds(prev => new Set(prev).add(id))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}/verify`, { method: 'POST' })
      if (res.ok) {
        setItems(prev => prev.filter(item => item.id !== id))
        setTotal(prev => prev - 1)
        fetchMydecCount()
      } else {
        const err = await res.json()
        alert(`Verify failed: ${err.detail || 'Unknown error'}`)
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`)
    }
    setProcessingIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  // Skip (ignore) a staging item
  const skipItem = async (id: number) => {
    setProcessingIds(prev => new Set(prev).add(id))
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/staging/${id}/ignore`, { method: 'POST' })
      if (res.ok) {
        setItems(prev => prev.filter(item => item.id !== id))
        setTotal(prev => prev - 1)
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`)
    }
    setProcessingIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  // Batch approve all non-duplicate, no-warning items on current page
  const batchApprove = async () => {
    const clean = items.filter(item => {
      const sd = item.scraped_data || {}
      const warnings = sd.validation_warnings || []
      const isDup = !!sd.potential_duplicate
      return !isDup && warnings.length === 0
    })
    if (clean.length === 0) {
      alert('No clean items to approve on this page.')
      return
    }
    if (!confirm(`Approve ${clean.length} clean items?`)) return

    for (const item of clean) {
      await approveItem(item.id)
    }
  }

  // Mass delete rollback
  const massDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetchWithAuth(
        `${API_URL}/api/admin/listings/by-external-id?prefix=mydec:`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      alert(`Deleted ${data.deleted} MyDec listings`)
      setShowDeleteConfirm(false)
      fetchMydecCount()
    } catch (e: any) {
      alert(`Error: ${e.message}`)
    }
    setDeleting(false)
  }

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black text-white">
      {/* Header */}
      <div className="border-b border-gg-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="text-xl font-bold">State Farm Sale Import</h1>
              <p className="text-sm text-gg-gray-400">
                {activeState === 'IL' ? 'Illinois PTAX-203 transfer records' : 'Iowa Assessor ag sales'} &middot; {total} pending review
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {mydecCount > 0 && (
              <span className="text-sm text-gg-gray-400">
                {mydecCount} MyDec listings in production
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* State Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => { setActiveState('IL'); setCounty('LaSalle'); setImportStats(null); setPage(0) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeState === 'IL'
                ? 'bg-gg-pink text-white'
                : 'bg-gg-gray-800 text-gg-gray-400 hover:text-white hover:bg-gg-gray-700'
            }`}
          >
            🌽 Illinois (MyDec)
          </button>
          <button
            onClick={() => { setActiveState('IA'); setCounty('Washington'); setImportStats(null); setPage(0) }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeState === 'IA'
                ? 'bg-gg-pink text-white'
                : 'bg-gg-gray-800 text-gg-gray-400 hover:text-white hover:bg-gg-gray-700'
            }`}
          >
            🌾 Iowa (Assessors)
          </button>
        </div>

        {/* Import Controls */}
        <div className="bg-gg-gray-900 rounded-lg border border-gg-gray-800 p-5">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Play size={18} className="text-gg-pink" />
            Import Controls
          </h2>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">County (blank = all)</label>
              <input
                type="text"
                value={county}
                onChange={e => setCounty(e.target.value)}
                placeholder={activeState === 'IL' ? 'e.g., LaSalle' : 'e.g., Washington'}
                className="bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm w-40"
              />
            </div>
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Months Back</label>
              <input
                type="number"
                value={monthsBack}
                onChange={e => setMonthsBack(Number(e.target.value))}
                className="bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm w-20"
              />
            </div>
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Limit</label>
              <input
                type="number"
                value={importLimit}
                onChange={e => setImportLimit(Number(e.target.value))}
                className="bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-sm w-20"
              />
            </div>
            <button
              onClick={runImport}
              disabled={importing}
              className="bg-gg-pink hover:bg-gg-pink/80 disabled:opacity-50 text-white px-5 py-2 rounded text-sm font-medium flex items-center gap-2"
            >
              {importing ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {importing ? 'Importing...' : 'Run Import'}
            </button>
          </div>

          {/* Import stats */}
          {importStats && (
            <div className={`mt-4 p-3 rounded text-sm ${importStats.success ? 'bg-green-900/30 border border-green-800' : 'bg-red-900/30 border border-red-800'}`}>
              {importStats.success ? (
                <div className="space-y-1">
                  <div className="font-medium text-green-400">Import Complete</div>
                  <div className="text-gg-gray-300">
                    Fetched: {importStats.total_fetched} &middot;
                    Enriched: {importStats.enriched} &middot;
                    Staged: {importStats.staged} &middot;
                    Duplicates: {importStats.duplicates_flagged} &middot;
                    Regrid calls: {importStats.regrid_calls}
                    {importStats.skipped_existing > 0 && ` · Already staged: ${importStats.skipped_existing}`}
                  </div>
                  {importStats.errors?.length > 0 && (
                    <div className="text-red-400">Errors: {importStats.errors.length}</div>
                  )}
                </div>
              ) : (
                <div className="text-red-400">Error: {importStats.error}</div>
              )}
            </div>
          )}
        </div>

        {/* County Tracker */}
        {countyTracker.length > 0 && (
          <div className="bg-gg-gray-900 rounded-lg border border-gg-gray-800 p-5">
            <button
              onClick={() => setTrackerExpanded(!trackerExpanded)}
              className="w-full flex items-center justify-between"
            >
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <MapPin size={18} className="text-gg-pink" />
                County Import Tracker
                <span className="text-sm font-normal text-gg-gray-400">({countyTracker.length} counties)</span>
              </h2>
              {trackerExpanded ? <ChevronUp size={18} className="text-gg-gray-400" /> : <ChevronDown size={18} className="text-gg-gray-400" />}
            </button>
            {trackerExpanded && <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gg-gray-400 border-b border-gg-gray-800">
                    <th className="text-left py-2 pr-4">County</th>
                    <th className="text-right py-2 px-3">In Production</th>
                    <th className="text-right py-2 px-3">Pending</th>
                    <th className="text-right py-2 px-3">Skipped</th>
                    <th className="text-right py-2 px-3">Total Imported</th>
                    <th className="text-right py-2 pl-3">Last Import</th>
                  </tr>
                </thead>
                <tbody>
                  {countyTracker.map((c: any) => (
                    <tr key={c.county} className="border-b border-gg-gray-800/50 hover:bg-gg-gray-800/30">
                      <td className="py-1.5 pr-4 font-medium">{c.county}</td>
                      <td className="py-1.5 px-3 text-right text-green-400">{c.in_production || 0}</td>
                      <td className="py-1.5 px-3 text-right text-yellow-400">{c.pending || 0}</td>
                      <td className="py-1.5 px-3 text-right text-gg-gray-500">{c.ignored || 0}</td>
                      <td className="py-1.5 px-3 text-right">{(c.verified || 0) + (c.pending || 0) + (c.ignored || 0)}</td>
                      <td className="py-1.5 pl-3 text-right text-gg-gray-400">
                        {c.last_import ? new Date(c.last_import).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
          </div>
        )}

        {/* Review List */}
        <div className="bg-gg-gray-900 rounded-lg border border-gg-gray-800">
          <div className="flex items-center justify-between p-4 border-b border-gg-gray-800">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Layers size={18} className="text-gg-pink" />
              Pending Review ({total})
            </h2>
            <button
              onClick={batchApprove}
              disabled={items.length === 0}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-4 py-1.5 rounded text-sm font-medium"
            >
              Batch Approve Clean
            </button>
          </div>

          {loading ? (
            <div className="p-8 text-center">
              <Loader2 className="animate-spin text-gg-pink mx-auto" size={24} />
            </div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-gg-gray-500">
              No {activeState === 'IA' ? 'Iowa' : 'MyDec'} items pending review. Run an import to get started.
            </div>
          ) : (
            <div className="divide-y divide-gg-gray-800">
              {items.map(item => {
                const sd = item.scraped_data || {}
                const tract = sd.tracts?.[0] || {}
                const listing = sd.listing || {}
                const warnings = sd.validation_warnings || []
                const isDup = !!sd.potential_duplicate
                const dup = sd.potential_duplicate || {}
                const sources = sd.enrichment_sources || {}
                const cropBreakdown = sd.crop_breakdown || {}
                const isProcessing = processingIds.has(item.id)

                return (
                  <div key={item.id} className="p-4 hover:bg-gg-gray-800/50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      {/* Tract image thumbnail */}
                      {tract.has_tract_image && (
                        <TractThumbnail stagingId={item.id} tractIndex={0} />
                      )}
                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">
                            {tract.acres || '?'} Acres &mdash; {tract.county_name || listing.county || '?'} County
                          </span>
                          {isDup && (
                            <span className="bg-yellow-600/30 text-yellow-400 text-xs px-2 py-0.5 rounded">
                              Potential Duplicate
                            </span>
                          )}
                          {warnings.length > 0 && (
                            <span className="bg-orange-600/30 text-orange-400 text-xs px-2 py-0.5 rounded">
                              {warnings.length} Warning{warnings.length > 1 ? 's' : ''}
                            </span>
                          )}
                          {sources.boundary === 'county_arcgis' && (
                            <span className="bg-green-800/40 text-green-400 text-xs px-2 py-0.5 rounded">ArcGIS</span>
                          )}
                          {sources.boundary === 'regrid' && (
                            <span className="bg-blue-800/40 text-blue-400 text-xs px-2 py-0.5 rounded">Regrid</span>
                          )}
                          {sources.boundary === 'county_centroid' && (
                            <span className="bg-red-800/40 text-red-400 text-xs px-2 py-0.5 rounded">Centroid Only</span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-sm text-gg-gray-300">
                          <div className="flex items-center gap-1">
                            <DollarSign size={14} className="text-gg-gray-500" />
                            <span>${(tract.sale_price || 0).toLocaleString()}</span>
                            {tract.price_per_acre && (
                              <span className="text-gg-gray-500">(${Math.round(tract.price_per_acre).toLocaleString()}/ac)</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <MapPin size={14} className="text-gg-gray-500" />
                            <span>{tract.township || '?'} Twp</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Wheat size={14} className="text-gg-gray-500" />
                            <span>
                              NCCPI: {tract.nccpi || '?'}
                              {tract.tillable_acres ? ` · ${tract.tillable_acres} tillable` : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Calendar size={14} className="text-gg-gray-500" />
                            <span>{sd.mydec_date_recorded || sd.iowa_sale_date || '?'}</span>
                            {sd.mydec_auction_sale && (
                              <span className="text-gg-pink text-xs">(auction)</span>
                            )}
                          </div>
                        </div>

                        <div className="text-xs text-gg-gray-500 mt-1">
                          {sd.iowa_parcel_number ? `Parcel: ${sd.iowa_parcel_number}` : `PIN: ${sd.mydec_pin || '?'}`}
                          {tract.soil_rating && tract.soil_rating_type === 'CSR2' && ` · CSR2: ${tract.soil_rating}`}
                          {Object.entries(cropBreakdown).map(([crop, acres]) => ` · ${crop}: ${acres}ac`).join('')}
                          {tract.polygon_coordinates && ` · ${tract.polygon_coordinates.length} boundary pts`}
                        </div>

                        {/* Duplicate comparison */}
                        {isDup && (
                          <div className="mt-2 p-2 bg-yellow-900/20 rounded text-xs border border-yellow-800/50">
                            <div className="font-medium text-yellow-400 mb-1">Existing match:</div>
                            <div className="text-gg-gray-300">
                              {dup.title} &middot; {dup.total_acres}ac &middot; ${Number(dup.sale_price || 0).toLocaleString()}
                            </div>
                          </div>
                        )}

                        {/* Warnings */}
                        {warnings.length > 0 && (
                          <div className="mt-2 space-y-0.5">
                            {warnings.map((w: string, i: number) => (
                              <div key={i} className="flex items-center gap-1 text-xs text-orange-400">
                                <AlertTriangle size={12} />
                                <span>{w}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Expand/Collapse details */}
                        <button
                          onClick={() => toggleExpanded(item.id)}
                          className="mt-2 text-xs text-gg-gray-400 hover:text-white flex items-center gap-1"
                        >
                          {expandedIds.has(item.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          {expandedIds.has(item.id) ? 'Hide Details' : 'Show Details — Verify All Fields'}
                        </button>

                        {/* Expanded detail panel */}
                        {expandedIds.has(item.id) && <TractDetail item={item} />}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-col gap-2 shrink-0">
                        <button
                          onClick={() => approveItem(item.id)}
                          disabled={isProcessing}
                          className="bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1"
                        >
                          {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                          Add
                        </button>
                        <button
                          onClick={() => skipItem(item.id)}
                          disabled={isProcessing}
                          className="bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-50 text-white px-3 py-1.5 rounded text-sm font-medium flex items-center gap-1"
                        >
                          <XCircle size={14} />
                          Skip
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Pagination */}
          {total > itemsPerPage && (
            <div className="flex items-center justify-between p-4 border-t border-gg-gray-800">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="text-sm text-gg-gray-400 hover:text-white disabled:opacity-30 flex items-center gap-1"
              >
                <ChevronLeft size={16} /> Previous
              </button>
              <span className="text-sm text-gg-gray-500">
                Page {page + 1} of {Math.ceil(total / itemsPerPage)}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={(page + 1) * itemsPerPage >= total}
                className="text-sm text-gg-gray-400 hover:text-white disabled:opacity-30 flex items-center gap-1"
              >
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>

        {/* Rollback Section */}
        <div className="bg-gg-gray-900 rounded-lg border border-red-900/50 p-5">
          <h2 className="text-lg font-semibold mb-2 flex items-center gap-2 text-red-400">
            <Trash2 size={18} />
            Rollback
          </h2>
          <p className="text-sm text-gg-gray-400 mb-3">
            {mydecCount} MyDec-imported listings currently in production.
            Deleting will remove all listings and their tracts that were imported from MyDec.
          </p>
          {!showDeleteConfirm ? (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={mydecCount === 0}
              className="bg-red-800 hover:bg-red-700 disabled:opacity-30 text-white px-4 py-2 rounded text-sm font-medium"
            >
              Delete All MyDec Imports ({mydecCount})
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-red-400">Are you sure? This cannot be undone.</span>
              <button
                onClick={massDelete}
                disabled={deleting}
                className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded text-sm font-medium flex items-center gap-2"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Yes, Delete All
              </button>
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="bg-gg-gray-700 hover:bg-gg-gray-600 text-white px-4 py-2 rounded text-sm"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
