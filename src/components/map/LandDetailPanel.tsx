'use client'

/**
 * LandDetailPanel — right-side docked slide-out drawer.
 *
 * ONE click = ONE location.  A clicked point may intersect a Regrid parcel
 * polygon, a soil polygon, and a CSB crop field simultaneously.  This panel
 * unifies all of those layers into a single scrollable card instead of
 * stacking competing MapLibre anchored Popups.
 *
 * Self-fetches:
 *   • /api/regrid/parcel      — full Regrid Premium Schema record
 *   • /api/parcel-enrichment/by-uuid — soil rating, tillable acres, soils[]
 *
 * Props carry the lightweight feature properties already on the tile so we
 * can render a useful skeleton before the API calls resolve.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { Mail, Download, Check, Loader2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { formatAcres } from '@/lib/format'
import { SOIL_FILTER_ENABLED } from '@/lib/featureFlags'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// ─── CDL palette (re-declared here so this file is self-contained) ──────────
const CDL_PALETTE: Record<number, { name: string; color: string }> = {
  1:   { name: 'Corn',                  color: '#FFD400' },
  2:   { name: 'Cotton',                color: '#FF2626' },
  3:   { name: 'Rice',                  color: '#00A8E2' },
  4:   { name: 'Sorghum',               color: '#FF9E0C' },
  5:   { name: 'Soybeans',              color: '#267000' },
  6:   { name: 'Sunflower',             color: '#FFFF00' },
  10:  { name: 'Peanuts',               color: '#267000' },
  11:  { name: 'Tobacco',               color: '#70A800' },
  12:  { name: 'Sweet Corn',            color: '#FFA8A8' },
  13:  { name: 'Pop/Orn Corn',          color: '#FFD400' },
  14:  { name: 'Mint',                  color: '#7AF5CA' },
  21:  { name: 'Barley',                color: '#E2007C' },
  22:  { name: 'Durum Wheat',           color: '#B56B00' },
  23:  { name: 'Spring Wheat',          color: '#D8B56B' },
  24:  { name: 'Winter Wheat',          color: '#A87000' },
  25:  { name: 'Other Small Grains',    color: '#D2CCC2' },
  26:  { name: 'Dbl Crop WinWht/Soybeans', color: '#D1FF00' },
  27:  { name: 'Rye',                   color: '#AC007C' },
  28:  { name: 'Oats',                  color: '#A05989' },
  29:  { name: 'Millet',                color: '#70A800' },
  30:  { name: 'Speltz',                color: '#D2CCC2' },
  31:  { name: 'Canola',                color: '#D1FF00' },
  32:  { name: 'Flaxseed',              color: '#7F7FFF' },
  33:  { name: 'Safflower',             color: '#BFBF77' },
  34:  { name: 'Rape Seed',             color: '#D1FF00' },
  35:  { name: 'Mustard',               color: '#D1FF00' },
  36:  { name: 'Alfalfa',               color: '#FFA8E3' },
  37:  { name: 'Other Hay/Non Alfalfa', color: '#A5F28C' },
  38:  { name: 'Camelina',              color: '#D1FF00' },
  39:  { name: 'Buckwheat',             color: '#D2CCC2' },
  41:  { name: 'Sugarbeets',            color: '#A800E4' },
  42:  { name: 'Dry Beans',             color: '#A87000' },
  43:  { name: 'Potatoes',              color: '#702600' },
  44:  { name: 'Other Crops',           color: '#CC9999' },
  45:  { name: 'Sugarcane',             color: '#267000' },
  46:  { name: 'Sweet Potatoes',        color: '#702600' },
  47:  { name: 'Misc Vegs & Fruits',    color: '#FF6666' },
  48:  { name: 'Watermelons',           color: '#FF6666' },
  49:  { name: 'Onions',                color: '#FFCC66' },
  50:  { name: 'Cucumbers',             color: '#FF6666' },
  51:  { name: 'Chick Peas',            color: '#D2CCC2' },
  52:  { name: 'Lentils',               color: '#D2CCC2' },
  53:  { name: 'Peas',                  color: '#267000' },
  54:  { name: 'Tomatoes',              color: '#FF6666' },
  55:  { name: 'Caneberries',           color: '#FF6666' },
  56:  { name: 'Hops',                  color: '#267000' },
  57:  { name: 'Herbs',                 color: '#267000' },
  58:  { name: 'Clover/Wildflowers',    color: '#A5F28C' },
  59:  { name: 'Sod/Grass Seed',        color: '#A5F28C' },
  61:  { name: 'Fallow/Idle Cropland',  color: '#BFBF77' },
  63:  { name: 'Forest',                color: '#93CC93' },
  64:  { name: 'Shrubland',             color: '#C6D69C' },
  65:  { name: 'Barren',                color: '#CCBEA3' },
  81:  { name: 'Clouds/No Data',        color: '#999999' },
  82:  { name: 'Developed',             color: '#D3D3D3' },
  83:  { name: 'Water',                 color: '#4970A3' },
  87:  { name: 'Wetlands',              color: '#7CB3D6' },
  111: { name: 'Open Water',            color: '#4970A3' },
  112: { name: 'Perennial Ice/Snow',    color: '#E8E8E8' },
  121: { name: 'Developed/Open Space',  color: '#D3D3D3' },
  122: { name: 'Developed/Low Intensity', color: '#D3D3D3' },
  123: { name: 'Developed/Med Intensity', color: '#D3D3D3' },
  124: { name: 'Developed/High Intensity', color: '#D3D3D3' },
  131: { name: 'Barren',                color: '#CCBEA3' },
  141: { name: 'Deciduous Forest',      color: '#93CC93' },
  142: { name: 'Evergreen Forest',      color: '#93CC93' },
  143: { name: 'Mixed Forest',          color: '#93CC93' },
  152: { name: 'Shrubland',             color: '#C6D69C' },
  176: { name: 'Grassland/Pasture',     color: '#E8FFBF' },
  190: { name: 'Woody Wetlands',        color: '#7CAFAF' },
  195: { name: 'Herbaceous Wetlands',   color: '#7CB3D6' },
}

// ─── Formatters (mirrors the module-level helpers in ExploreMap.tsx) ─────────

function fmtMoney(n: any): string | null {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  if (!isFinite(v) || v === 0) return null
  return '$' + Math.round(v).toLocaleString('en-US')
}

function fmtAcres(n: any): string | null {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  if (!isFinite(v) || v <= 0) return null
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' ac'
}

function fmtDate(s: any): string | null {
  if (!s) return null
  const d = new Date(String(s))
  if (isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const INSTRUMENT_LABELS: Record<string, string> = {
  WD: 'Warranty Deed', SWD: 'Special Warranty Deed', GWD: 'General Warranty Deed',
  QC: 'Quit Claim', QCD: 'Quit Claim Deed',
  TR: 'Trust Transfer', TRD: 'Trust Deed', TRUST: 'Trust Transfer',
  GFT: 'Gift Deed', GD: 'Gift Deed',
  TXD: 'Tax Deed', TAX: 'Tax Deed',
  CFD: 'Contract for Deed',
  PR: 'Personal Representative Deed', PRD: 'Personal Representative Deed',
  EXE: "Executor's Deed", ADM: "Administrator's Deed", SHF: "Sheriff's Deed",
  REL: 'Release', CD: 'Correction Deed',
  FORE: 'Foreclosure', AUC: 'Auction', ML: 'MLS',
}
function fmtSaleType(raw: any): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  const code = s.toUpperCase().replace(/[^A-Z]/g, '')
  return INSTRUMENT_LABELS[code] || s
}

function firstNonEmpty(...vals: any[]): any {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}

function titleCase(s: string): string {
  if (!s) return ''
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

function extractTownship(record: any): string {
  const path: unknown = record?.path
  if (typeof path !== 'string') return ''
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 5) return ''
  const slug = parts[3] || ''
  if (!slug || slug === parts[2]) return ''
  return titleCase(slug.replace(/-/g, ' '))
}

/**
 * Derive the state-correct soil rating label.
 * Logic mirrors the comment in ExploreMap:
 *   IA → CSR2, IL → PI, MN → CPI, else NCCPI
 * The enrichment endpoint returns the correct `soil_rating_type` string
 * directly; this fallback is for cases where we only have the state code
 * (e.g. from tile feature props before enrichment resolves).
 */
function deriveRatingLabel(soilRatingType: string | null | undefined, state: string | null | undefined): string {
  if (soilRatingType) return soilRatingType.toUpperCase()
  const s = (state || '').toUpperCase()
  if (s === 'IA') return 'CSR2'
  if (s === 'IL') return 'PI'
  if (s === 'MN') return 'CPI'
  return 'NCCPI'
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LandDetailClickData {
  /** Tile-level props from the Regrid parcel fill layer (lightweight) */
  parcelProps: Record<string, any> | null
  /** Tile-level props from whichever soil fill layer was hit (soils-full-fill, explore-nccpi-fill, etc.) */
  soilProps: Record<string, any> | null
  /** Tile-level props from csb-fields-fill */
  csbProps: Record<string, any> | null
  /** Stable Regrid parcel UUID (from parcelProps.ll_uuid) */
  ll_uuid: string | null
  /** Which overlay was active when the user clicked (drives which section leads) */
  activeOverlay: 'ssurgo' | 'nccpi' | 'crops' | 'csb' | 'fsa' | null
  /** Task #26: distinguishes a direct parcel/dot click (auto-dismiss if the
      fetch resolves nothing — an empty shell is worse than no panel) from an
      informational overlay click (soil/CSB — the "no additional data"
      empty state is a legitimate, expected result there, not a failure).
      Defaults to 'parcel' for any call site that doesn't set it. */
  source?: 'parcel' | 'overlay'
}

interface LandDetailPanelProps {
  clickData: LandDetailClickData | null
  onClose: () => void
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.8px',
      textTransform: 'uppercase',
      color: '#E91E8C',
      marginBottom: 6,
      marginTop: 2,
    }}>
      {title}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 12,
      padding: '5px 0',
      fontSize: 12.5,
      borderBottom: '1px solid rgba(0,0,0,0.05)',
    }}>
      <span style={{ color: '#888', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#1a1a1a', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 16px 4px' }}>
      <SectionHeader title={title} />
      {children}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LandDetailPanel({ clickData, onClose }: LandDetailPanelProps) {
  const [regridData, setRegridData] = useState<any>(null)
  const [enrichData, setEnrichData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  // Race guard for the auto-close effect below (task #26 defect 2 round-2
  // fix). `clickData` is a fresh object literal at every setLandDetail(...)
  // call site (never reused/mutated), so each click's object is referentially
  // unique. This ref is written ONLY at the end of fetchData's `finally`,
  // to the exact `data` object that fetch was called with — i.e. only once
  // that specific click's fetch has fully settled (success or failure).
  // Comparing it by === against the current render's clickData means
  // "settled" can never read true for a click whose own fetch hasn't
  // actually finished, regardless of what `loading` (which can lag a
  // render behind setLoading(true)) looks like on an intermediate render.
  const settledForRef = useRef<LandDetailClickData | null>(null)

  // "Email me this report" / "Download report" — single-parcel PDF, mirrors
  // TractDetailActionBar's handlers in PortalTractDetail.tsx. Backend
  // contract: POST /api/parcels/{ll_uuid}/report/email|pdf, no body, auth
  // header only. 403 = not entitled, 400 = no email on account.
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const llUuid = clickData?.ll_uuid ?? null

  // Reset transient send/download state whenever the clicked parcel changes
  // — this panel's component instance persists across clicks (only the
  // `clickData` prop changes), so a stale "Sent!" from a previous parcel
  // must not carry over to the next one.
  useEffect(() => {
    setEmailStatus('idle')
    setEmailMessage(null)
    setDownloading(false)
    setDownloadError(null)
  }, [llUuid])

  const parseReportError = async (res: Response): Promise<string> => {
    if (res.status === 403) return 'Not available for your account'
    if (res.status === 400) {
      try {
        const body = await res.json()
        return body?.detail || body?.message || 'No email on file for your account'
      } catch {
        return 'No email on file for your account'
      }
    }
    return 'Something went wrong — try again'
  }

  const handleEmailReport = async () => {
    if (!llUuid) return
    setEmailStatus('sending')
    setEmailMessage(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/parcels/${llUuid}/report/email`, {
        method: 'POST',
      })
      if (!res.ok) {
        setEmailStatus('error')
        setEmailMessage(await parseReportError(res))
        return
      }
      const data = await res.json()
      setEmailStatus('sent')
      setEmailMessage(data?.message || 'Sent!')
    } catch (e) {
      console.error('Parcel report email error:', e)
      setEmailStatus('error')
      setEmailMessage('Something went wrong — try again')
    }
  }

  const handleDownloadReport = async () => {
    if (!llUuid) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/parcels/${llUuid}/report/pdf`, {
        method: 'POST',
      })
      if (!res.ok) {
        setDownloadError(await parseReportError(res))
        return
      }
      const blob = await res.blob()
      const dispo = res.headers.get('Content-Disposition') || ''
      const match = dispo.match(/filename="?([^";]+)"?/i)
      const filename = match?.[1] || 'parcel-report.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Parcel report download error:', e)
      setDownloadError('Something went wrong — try again')
    } finally {
      setDownloading(false)
    }
  }

  const isOpen = clickData !== null

  // Esc closes the panel
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  // Fetch parcel + enrichment whenever the click target changes
  const fetchData = useCallback(async (data: LandDetailClickData) => {
    setRegridData(null)
    setEnrichData(null)
    setLoading(true)

    const { ll_uuid, parcelProps } = data
    const lat = parcelProps?.centroid_lat ?? null
    const lng = parcelProps?.centroid_lng ?? null

    const qs = new URLSearchParams()
    if (ll_uuid) qs.set('ll_uuid', ll_uuid)
    else if (lat != null && lng != null) { qs.set('lat', String(lat)); qs.set('lng', String(lng)) }

    const enrichPromise: Promise<any> = ll_uuid
      ? fetchWithAuth(`${API_URL}/api/parcel-enrichment/by-uuid?ll_uuid=${encodeURIComponent(ll_uuid)}`)
          .then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null)

    try {
      const [regridRes, enrich] = await Promise.all([
        qs.toString() ? fetchWithAuth(`${API_URL}/api/regrid/parcel?${qs.toString()}`).catch(() => null) : Promise.resolve(null),
        enrichPromise,
      ])
      if (regridRes?.ok) {
        const body = await regridRes.json()
        setRegridData(body?.parcel || null)
      }
      setEnrichData(enrich)
    } catch {
      // keep nulls — panel renders skeleton from tile props
    } finally {
      setLoading(false)
      // Mark THIS click's fetch as settled — see settledForRef's declaration
      // comment for the race-freedom argument. Written last, after the
      // records this fetch resolved are already in state, so a render
      // triggered by this write always sees the up-to-date regridData/
      // enrichData alongside settledForRef.current === data.
      settledForRef.current = data
    }
  }, [])

  useEffect(() => {
    if (!clickData) {
      setRegridData(null)
      setEnrichData(null)
      setLoading(false)
      settledForRef.current = null
      return
    }
    fetchData(clickData)
  }, [clickData, fetchData])

  // Merge: prefer API record when available, fall back to tile props
  const record = regridData ?? clickData?.parcelProps ?? {}
  const parcelProps = clickData?.parcelProps ?? {}
  const soilProps = clickData?.soilProps ?? {}
  const csbProps = clickData?.csbProps ?? {}

  // ── Derived parcel fields ─────────────────────────────────────────────────
  const owner = record?.owner || parcelProps?.owner || 'Unknown'
  const county = titleCase(record?.county || parcelProps?.county || '')
  const state = record?.state2 || record?.state || parcelProps?.state || parcelProps?.state_abbr || ''
  const countyState = county
    ? `${county} County${state ? ', ' + state : ''}`
    : state || ''
  const street = typeof record?.address === 'string' && record.address.trim()
    ? record.address.trim()
    : (typeof parcelProps?.address === 'string' ? parcelProps.address.trim() : '')
  const township = extractTownship(record)

  // ── Hero strip ─────────────────────────────────────────────────────────────
  const gisacre: number | null = record?.ll_gisacre ?? record?.gisacre ?? parcelProps?.ll_gisacre ?? parcelProps?.gisacre ?? null
  const saleprice = record?.saleprice ?? null
  const validSalePrice = typeof saleprice === 'number' && saleprice > 0
  const ppa = (validSalePrice && typeof gisacre === 'number' && gisacre > 0) ? saleprice / gisacre : null

  // ── Soil section ─────────────────────────────────────────────────────────
  const ratingLabel = deriveRatingLabel(enrichData?.soil_rating_type, state)
  const soilRating = enrichData?.soil_rating ?? null
  const tillableAcres = enrichData?.tillable_acres ?? null
  const pctTillable = enrichData?.pct_tillable ?? null
  const dominantLandcover = enrichData?.dominant_landcover ?? null
  const soilBreakdown: Array<{ mukey?: string; soil?: string; acres?: number; pi?: number }> =
    Array.isArray(enrichData?.soils) ? enrichData.soils : []

  // Soil at clicked point (from the tile feature)
  const clickedMuname = soilProps?.muname || soilProps?.mukey || null
  const clickedMusym = soilProps?.musym || null
  const clickedNccpi = soilProps?.nccpi ?? null

  // ── Crop history ──────────────────────────────────────────────────────────
  const CDL_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]
  const hasCropData = CDL_YEARS.some(yr => csbProps?.[`cdl${yr}`] && csbProps[`cdl${yr}`] !== 0)

  // ── Regrid property fields ────────────────────────────────────────────────
  const saledate = record?.saledate ?? null
  const saleType = fmtSaleType(firstNonEmpty(
    record?.salestype, record?.saletype, record?.sale_type,
    record?.recordtype, record?.record_type,
    record?.instrument, record?.instrumtyp, record?.instrumenttype,
    record?.legaldoc, record?.transrec, record?.deed_type,
    record?.deedtype, record?.s1deedtype, record?.deed,
  ))
  const previousOwner = typeof record?.previous_owner === 'string' && record.previous_owner.trim()
    ? record.previous_owner.trim() : ''
  const lastTransferDate = record?.last_ownership_transfer_date ?? null
  const deeded = record?.deeded_acres ?? null
  const usedescRaw = record?.usedesc
  const usedesc = (typeof usedescRaw === 'string' && usedescRaw.trim() && !/^\d+$/.test(usedescRaw.trim()))
    ? usedescRaw.trim() : ''
  const zoningRaw = record?.zoning_description || record?.zoning || ''
  const zoning = (typeof zoningRaw === 'string' && zoningRaw.trim() && !/^(no zoning|none|n\/a|na)$/i.test(zoningRaw.trim()))
    ? zoningRaw.trim() : ''
  const parval = record?.parval ?? null
  const landval = record?.landval ?? null
  const improvval = record?.improvval ?? null
  const buildings = record?.ll_bldg_count ?? null
  const bldgSqft = record?.ll_bldg_footprint_sqft ?? null
  const yearbuilt = record?.yearbuilt ?? null

  const hasSoilData = clickedMuname || soilRating != null || tillableAcres != null || soilBreakdown.length > 0
  const hasTillable = tillableAcres != null || dominantLandcover
  const hasLastSale = !!(fmtDate(saledate) || saleType || lastTransferDate || previousOwner)
  const hasProperty = !!(deeded || usedesc || zoning)
  const hasAssessed = !!(fmtMoney(parval) || fmtMoney(landval) || fmtMoney(improvval))
  const hasBuildings = !!(buildings || bldgSqft || yearbuilt)

  const activeOverlay = clickData?.activeOverlay ?? null

  // Whether a section should auto-expand (the active overlay's section leads)
  const soilLeads = hasSoilData && (activeOverlay === 'ssurgo' || activeOverlay === 'nccpi')
  // Whether the Soil Section actually renders (gated by the feature flag on
  // top of hasSoilData) — used by the no-data empty state below so it
  // doesn't stay blank when the only available data is soil data.
  const visibleHasSoilData = SOIL_FILTER_ENABLED && hasSoilData
  const cropLeads = hasCropData && (activeOverlay === 'crops' || activeOverlay === 'csb')

  // Task #26 defect 2: a dot/parcel click that resolves to nothing (e.g. a
  // durable-dot lookup with no matching Regrid record) must never present
  // the empty "Parcel Unknown" shell — an empty panel reads as a broken
  // click, worse than no panel at all. "Meaningful record" mirrors the
  // hero-strip + header gating: a real owner name, address, or acreage/sale
  // figure. Overlay clicks (soil/CSB) are informational by design — their
  // "No additional parcel data available" state is an expected, legitimate
  // result, not a failure, so they're exempt via clickData.source.
  const hasMeaningfulRecord = !!(
    (typeof record?.owner === 'string' && record.owner.trim()) ||
    street ||
    (typeof gisacre === 'number' && gisacre > 0) ||
    validSalePrice
  )
  const hasAnyDataSection =
    visibleHasSoilData || hasCropData || hasTillable || hasLastSale || hasProperty || hasAssessed || hasBuildings
  const isEmptyResult = !hasMeaningfulRecord && !hasAnyDataSection
  // ROUND-2 AUDITOR BLOCKER FIX: gating on `!loading` alone raced the fetch.
  // On the render right after a NEW click, `loading` can still hold its
  // stale (false) value from the previous click for one commit, while
  // `record` is only the sparse tile props (durable-dot sets just
  // {ll_uuid, centroid_lat, centroid_lng}) — so isEmptyResult reads true
  // and the panel closed itself before fetchData's setLoading(true) had
  // even committed, let alone the fetch resolving. `settledForRef.current
  // === clickData` (see its declaration comment) can only be true once
  // THIS click's own fetch has fully finished, so gating on it instead of
  // `!loading` removes the race entirely.
  // 'parcel' (dot/fill click) auto-dismisses on an empty result; 'overlay'
  // (soil/CSB informational click) keeps showing the "No additional parcel
  // data available" empty state below. Undefined source (shouldn't happen —
  // every open site sets it) defaults to the safer 'parcel' behavior.
  const fetchSettledForThisClick = settledForRef.current === clickData
  const shouldAutoClose = isOpen && fetchSettledForThisClick && isEmptyResult && clickData?.source !== 'overlay'

  // Task #26 defect 2: once the fetch settles, if this was a dot/parcel
  // click and it resolved to nothing meaningful, close the panel instead of
  // rendering the empty "Parcel Unknown" shell.
  useEffect(() => {
    if (shouldAutoClose) onClose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoClose])

  return (
    <>
      {/* Backdrop — clicking it closes the panel */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 19,
          pointerEvents: isOpen ? 'auto' : 'none',
          // transparent — just catches clicks outside the panel
          background: 'transparent',
          display: isOpen ? 'block' : 'none',
        }}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-label="Land detail"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          width: 380,
          zIndex: 20,
          background: '#fff',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 220ms cubic-bezier(0.2,0,0.1,1)',
          pointerEvents: isOpen ? 'auto' : 'none',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Dark header ─────────────────────────────────────────── */}
        <div style={{
          flexShrink: 0,
          background: 'linear-gradient(135deg,#1f1f23 0%,#2a2a30 100%)',
          color: '#fff',
          padding: '14px 44px 12px 16px',
          position: 'relative',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: '#F58CDE', marginBottom: 4 }}>
            Parcel
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, color: '#fff', wordBreak: 'break-word' }}>
            {owner}
          </div>
          {street && (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginTop: 4, lineHeight: 1.3 }}>{street}</div>
          )}
          {countyState && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2, lineHeight: 1.3 }}>{countyState}</div>
          )}
          {township && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 1, lineHeight: 1.3 }}>{township} Township</div>
          )}

          {/* Close button */}
          <button
            onClick={onClose}
            aria-label="Close panel"
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              background: 'rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.8)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
              lineHeight: 1,
              padding: 0,
              transition: 'background 150ms',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.22)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
          >
            ✕
          </button>
        </div>

        {/* ── Hero strip ──────────────────────────────────────────── */}
        {(gisacre != null || ppa != null || saleprice != null) && (
          <div style={{
            flexShrink: 0,
            display: 'flex',
            padding: '12px 16px',
            borderBottom: '1px solid rgba(0,0,0,0.06)',
            background: '#fafbfc',
          }}>
            {[
              gisacre != null ? { label: 'Acres', value: fmtAcres(gisacre)!, emphasize: false } : null,
              ppa != null ? { label: '$ / Acre', value: '$' + Math.round(ppa).toLocaleString('en-US'), emphasize: true } : null,
              fmtMoney(saleprice) != null ? { label: 'Sale Price', value: fmtMoney(saleprice)!, emphasize: false } : null,
            ].filter(Boolean).map((cell, i, arr) => {
              const c = cell!
              const isFirst = i === 0
              const isLast = i === arr.length - 1
              const align = isFirst ? 'left' : isLast ? 'right' : 'center'
              return (
                <div key={c.label} style={{
                  flex: c.emphasize ? 1.4 : 1,
                  textAlign: align,
                  borderLeft: isFirst ? 'none' : '1px solid rgba(0,0,0,0.06)',
                  paddingLeft: isFirst ? 0 : 8,
                  paddingRight: isLast ? 0 : 8,
                }}>
                  <div style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: '0.8px',
                    textTransform: 'uppercase',
                    color: c.emphasize ? '#E91E8C' : '#888',
                  }}>
                    {c.label}
                  </div>
                  <div style={{
                    fontSize: c.emphasize ? 19 : 15,
                    fontWeight: c.emphasize ? 800 : 700,
                    color: '#1a1a1a',
                    marginTop: 2,
                    letterSpacing: c.emphasize ? -0.3 : 0,
                  }}>
                    {c.value}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* ── Scrollable body ─────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 24 }}>

          {/* Loading state */}
          {loading && (
            <div style={{ padding: '16px', color: 'rgba(0,0,0,0.45)', fontSize: 12, fontStyle: 'italic', textAlign: 'center' }}>
              Loading parcel details…
            </div>
          )}

          {/* ── A: Soil at this point (leads when soil overlay active) ──
              Hidden until soil data is cleaned up nationwide
              (SOIL_FILTER_ENABLED = false). Derived booleans above
              (hasSoilData, soilLeads) are left as-is; flip the flag to
              restore this section. */}
          {visibleHasSoilData && (
            <div style={{ order: soilLeads ? -1 : 0 }}>
              <Section title={`Soil (${ratingLabel})`}>
                {/* Point-specific soil from tile */}
                {clickedMuname && <DetailRow label="Soil Type" value={clickedMuname} />}
                {clickedMusym && <DetailRow label="Symbol" value={clickedMusym} />}
                {clickedNccpi != null && <DetailRow label="NCCPI" value={String(clickedNccpi)} />}

                {/* Parcel-wide from enrichment */}
                {soilRating != null && (
                  <DetailRow label={`Rating (${ratingLabel})`} value={String(soilRating)} />
                )}
              </Section>

              {/* Parcel soils breakdown */}
              {soilBreakdown.length > 0 && (
                <Section title="Soils — by acreage">
                  {soilBreakdown.slice(0, 5).map((s, i) => {
                    const name = s.soil ? String(s.soil) : (s.mukey ? `Mukey ${s.mukey}` : 'Soil')
                    const ac = typeof s.acres === 'number' ? `${formatAcres(s.acres)} ac` : ''
                    const pi = typeof s.pi === 'number' ? `${ratingLabel} ${s.pi}` : ''
                    const suffix = [ac, pi].filter(Boolean).join(' · ') || '—'
                    return <DetailRow key={i} label={name} value={suffix} />
                  })}
                </Section>
              )}
            </div>
          )}

          {/* ── B: Crop history (leads when crop overlay active) ── */}
          {hasCropData && (
            <div style={{ order: cropLeads ? -1 : 0 }}>
              <Section title="Crop History">
                {csbProps?.acres != null && (
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 6 }}>
                    {formatAcres(Number(csbProps.acres))} acres
                  </div>
                )}
                {CDL_YEARS.map(yr => {
                  const code = csbProps?.[`cdl${yr}`]
                  if (!code || code === 0) {
                    return (
                      <div key={yr} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 12 }}>
                        <span style={{ color: 'rgba(0,0,0,0.35)' }}>{yr}</span>
                        <span style={{ color: 'rgba(0,0,0,0.28)' }}>—</span>
                      </div>
                    )
                  }
                  const entry = CDL_PALETTE[code as number]
                  const name = entry ? entry.name : `Code ${code}`
                  const color = entry ? entry.color : '#999999'
                  return (
                    <div key={yr} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0', fontSize: 12 }}>
                      <span style={{ color: 'rgba(0,0,0,0.5)', width: 34, flexShrink: 0 }}>{yr}</span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: 2,
                          background: color,
                          border: '1px solid rgba(0,0,0,0.15)',
                          flexShrink: 0,
                          display: 'inline-block',
                        }} />
                        <span style={{ color: '#1a1a1a', fontSize: 11.5 }}>{name}</span>
                      </span>
                    </div>
                  )
                })}
              </Section>
            </div>
          )}

          {/* ── C: Tillable ─────────────────────────────────────── */}
          {hasTillable && (
            <Section title="Tillable">
              {tillableAcres != null && (
                <DetailRow
                  label="Tillable Acres"
                  value={`${formatAcres(Number(tillableAcres))} ac${pctTillable != null ? ` (${Number(pctTillable).toFixed(0)}%)` : ''}`}
                />
              )}
              {dominantLandcover && (
                <DetailRow
                  label="Land Cover"
                  value={String(dominantLandcover).replace(/(^|[\s-])\S/g, m => m.toUpperCase())}
                />
              )}
            </Section>
          )}

          {/* ── D: Last Sale ─────────────────────────────────────── */}
          {hasLastSale && (
            <Section title="Last Sale">
              {fmtDate(saledate) && <DetailRow label="Sale Date" value={fmtDate(saledate)!} />}
              {saleType && <DetailRow label="Sale Type" value={saleType} />}
              {fmtDate(lastTransferDate) && fmtDate(lastTransferDate) !== fmtDate(saledate) && (
                <DetailRow label="Last Transfer" value={fmtDate(lastTransferDate)!} />
              )}
              {previousOwner && <DetailRow label="Previous Owner" value={previousOwner} />}
            </Section>
          )}

          {/* ── E: Property ─────────────────────────────────────── */}
          {hasProperty && (
            <Section title="Property">
              {deeded && deeded !== gisacre && fmtAcres(deeded) && (
                <DetailRow label="Deeded Acres" value={fmtAcres(deeded)!} />
              )}
              {usedesc && <DetailRow label="Use" value={usedesc} />}
              {zoning && <DetailRow label="Zoning" value={zoning} />}
            </Section>
          )}

          {/* ── F: Assessed Value ───────────────────────────────── */}
          {hasAssessed && (
            <Section title="Assessed Value">
              {fmtMoney(parval) && <DetailRow label="Total" value={fmtMoney(parval)!} />}
              {fmtMoney(landval) && <DetailRow label="Land" value={fmtMoney(landval)!} />}
              {fmtMoney(improvval) && <DetailRow label="Improvements" value={fmtMoney(improvval)!} />}
            </Section>
          )}

          {/* ── G: Buildings ─────────────────────────────────────── */}
          {hasBuildings && (
            <Section title="Buildings">
              {buildings && <DetailRow label="Count" value={String(buildings)} />}
              {bldgSqft && <DetailRow label="Footprint" value={`${Math.round(bldgSqft).toLocaleString()} sq ft`} />}
              {yearbuilt && <DetailRow label="Year Built" value={String(yearbuilt)} />}
            </Section>
          )}

          {/* No-data state — shown only when skeleton props are also empty.
              Task #26 defect 2: only for overlay-originated clicks (soil/CSB,
              informational by design). A dot/parcel-originated empty result
              auto-closes via shouldAutoClose above instead of rendering this
              — this condition just prevents a one-frame flash of the empty
              shell before that effect fires. Gated on fetchSettledForThisClick
              (not `!loading`) for the same reason shouldAutoClose is — avoids
              a stale-render flash of "no data" on the render right after a
              new click, before this click's own fetch has actually settled. */}
          {fetchSettledForThisClick && isEmptyResult && clickData?.source === 'overlay' && (
            <div style={{ padding: '24px 16px', color: 'rgba(0,0,0,0.4)', fontSize: 12, textAlign: 'center', fontStyle: 'italic' }}>
              No additional parcel data available.
            </div>
          )}
        </div>

        {/* ── Footer: Email me this report / Download report ──────────
            Visual language mirrors TractDetailActionBar's second row
            (PortalTractDetail.tsx) — same padding, rounded buttons, pink
            primary — reimplemented in this file's inline-style idiom
            since this panel doesn't use Tailwind classes. Requires
            ll_uuid (the panel's stable parcel identifier); hidden
            otherwise (e.g. a click that resolved via lat/lng only). */}
        {llUuid && (
          <div style={{ flexShrink: 0, borderTop: '1px solid rgba(0,0,0,0.06)', padding: '16px', background: '#fff' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={handleDownloadReport}
                disabled={downloading}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '11px 10px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 600,
                  border: '1px solid rgba(0,0,0,0.12)',
                  background: downloading ? 'rgba(0,0,0,0.03)' : '#fff',
                  color: downloading ? 'rgba(0,0,0,0.4)' : '#1a1a1a',
                  cursor: downloading ? 'wait' : 'pointer',
                }}
              >
                {downloading ? (
                  <><Loader2 size={14} className="animate-spin" /> Building PDF...</>
                ) : (
                  <><Download size={14} /> Download report</>
                )}
              </button>
              <button
                onClick={handleEmailReport}
                disabled={emailStatus === 'sending' || emailStatus === 'sent'}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '11px 10px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 700,
                  border: 'none',
                  background: emailStatus === 'sent' ? 'rgba(52,199,89,0.15)' : '#E91E8C',
                  color: emailStatus === 'sent' ? '#1a9146' : '#fff',
                  cursor: (emailStatus === 'sending' || emailStatus === 'sent') ? 'default' : 'pointer',
                  opacity: emailStatus === 'sending' ? 0.7 : 1,
                }}
              >
                {emailStatus === 'sent' ? (
                  <><Check size={14} /> Sent!</>
                ) : emailStatus === 'sending' ? (
                  <><Loader2 size={14} className="animate-spin" /> Sending...</>
                ) : (
                  <><Mail size={14} /> Email me this report</>
                )}
              </button>
            </div>
            {(emailStatus === 'sent' || emailStatus === 'error' || downloadError) && (
              <div style={{ marginTop: 8 }}>
                {emailStatus === 'sent' && emailMessage && (
                  <p style={{ fontSize: 11, color: '#1a9146', margin: 0 }}>{emailMessage}</p>
                )}
                {emailStatus === 'error' && emailMessage && (
                  <p style={{ fontSize: 11, color: '#d33', margin: 0 }}>{emailMessage}</p>
                )}
                {downloadError && (
                  <p style={{ fontSize: 11, color: '#d33', margin: 0 }}>{downloadError}</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
