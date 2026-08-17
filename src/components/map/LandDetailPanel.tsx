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
import {
  fmtMoney, fmtAcres,
  PARCEL_DISCLAIMER_TEXT, deriveParcelDetail,
  DetailRow, Section, LandTypeBadges, ParcelDetailSections,
} from './parcelDetailFields'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

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

// Formatters, field derivation (deriveParcelDetail), and the "Land
// Composition ... Mailing Address" section block are shared with
// CompInlinePopup (ExploreMap.tsx, comp mode) — see parcelDetailFields.tsx.
// Both modals render the SAME derivation + JSX so they can't drift apart.

// ─── Types ────────────────────────────────────────────────────────────────────

/** Fixed right-docked panel width (see the `width: 380` style below). Exported
 *  so ExploreMap can pad camera moves (easeTo/fitBounds) by the same amount
 *  when this panel is open, instead of re-guessing the value. */
export const LAND_DETAIL_PANEL_WIDTH = 380

export interface LandDetailClickData {
  /** Tile-level props from the Regrid parcel fill layer (lightweight) */
  parcelProps: Record<string, any> | null
  /** Tile-level props from whichever soil fill layer was hit (soils-full-fill, explore-nccpi-fill, etc.) */
  soilProps: Record<string, any> | null
  /** Tile-level props from csb-fields-fill */
  csbProps: Record<string, any> | null
  /** Stable Regrid parcel UUID (from parcelProps.ll_uuid) */
  ll_uuid: string | null
  /** Raw map click coordinate (bug fix 2026-07-15), captured from the
      MapLibre click event regardless of what the tile itself carried.
      Ordinary Regrid parcel-fill tiles carry neither `ll_uuid` nor
      `parcelProps.centroid_lat/lng` — this is the only reliable way to
      resolve a report for that click (see fetchData's lat/lng fallback
      and the footer's `reportPoint` gate below). */
  clickLng: number | null
  clickLat: number | null
  /** Which overlay was active when the user clicked (drives which section leads) */
  activeOverlay: 'ssurgo' | 'nccpi' | 'crops' | 'csb' | 'fsa' | null
  /** Task #26: distinguishes a direct parcel/dot click (auto-dismiss if the
      fetch resolves nothing — an empty shell is worse than no panel) from an
      informational overlay click (soil/CSB — the "no additional data"
      empty state is a legitimate, expected result there, not a failure).
      Defaults to 'parcel' for any call site that doesn't set it. */
  source?: 'parcel' | 'overlay'
  /** Parcel Spotlight veil (2026-08-15): the TILE-CLIPPED geometry of the
      clicked feature, when the click landed on the Regrid parcel-fill
      layer directly (queryRenderedFeatures gives us the polygon for free
      at click time). A parcel crossing a tile boundary yields a partial
      ring here — good enough for immediate "fast feedback" veil placement,
      but ExploreMap replaces it with the authoritative rings once
      `onGeometryResolved` fires below. null/undefined for every other
      'parcel'-source call site (sale-dot clicks only carry a Point on the
      tile, not the parcel polygon) — those rely on `onGeometryResolved`
      alone. */
  tileGeometry?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
}

interface LandDetailPanelProps {
  clickData: LandDetailClickData | null
  onClose: () => void
  /** Parcel Spotlight veil (2026-08-15): fired once this click's own
      /api/regrid/parcel fetch has settled (success, miss, or error) with
      the record's authoritative `_geometry` — or null if none is
      available. `forClickData` is the exact `clickData` object this
      resolution belongs to; ExploreMap must ignore any call where that no
      longer matches the current selection (the user already moved on). */
  onGeometryResolved?: (
    geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null,
    forClickData: LandDetailClickData,
  ) => void
  /** "+ Report" (2026-08-17): same shared-report mechanism ExploreMap
      already threads into PortalTractDetail's TractDetailActionBar and
      CompInlinePopup's "Add to Report" — reused here, not reimplemented.
      `tract` is loosely typed (not ExploreMap's `SaleDetail`) to avoid a
      circular import (ExploreMap already imports this file). Untyped to
      `any` mirrors the existing `tract as unknown as TractSaleData` cast
      ExploreMap itself uses when wiring a comp popup's sale into the same
      callback. */
  onToggleReport?: (tract: any) => void
  /** Same `reportIds` Set ExploreMap already owns and passes to
      CompInlinePopup — membership test only, never mutated here. */
  reportIds?: Set<string> | null
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function LandDetailPanel({ clickData, onClose, onGeometryResolved, onToggleReport, reportIds }: LandDetailPanelProps) {
  const [regridData, setRegridData] = useState<any>(null)
  const [enrichData, setEnrichData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  // Fallback report id (bug fix 2026-07-15): custom Regrid tiles don't
  // reliably carry ll_uuid on the tile FEATURE itself (see the promoteId
  // comment in ExploreMap's Regrid-fill effect), so `clickData.ll_uuid`
  // is null for most direct parcel-polygon clicks even though the panel
  // still resolves and displays full parcel data via /api/regrid/parcel
  // (by lat/lng). That fetched record DOES carry its own (live-Regrid-
  // flavored) ll_uuid — captured here as a fallback once fetchData
  // resolves it, so the report buttons aren't gated on an id the tile
  // never had. Reset to null at the top of every fetchData call (same
  // moment regridData resets) so it never leaks a previous parcel's id
  // into a render for a newly-clicked one.
  const [fetchedLlUuid, setFetchedLlUuid] = useState<string | null>(null)
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

  // Parcel Spotlight veil: latest onGeometryResolved prop, read from a ref
  // inside fetchData so the callback's identity doesn't have to be a
  // useCallback dependency of fetchData itself — fetchData is deliberately
  // deps-free (see below) so the fetch-effect only reruns on a genuine
  // clickData change, never on an unrelated parent re-render.
  const onGeometryResolvedRef = useRef(onGeometryResolved)
  useEffect(() => { onGeometryResolvedRef.current = onGeometryResolved }, [onGeometryResolved])

  // "Email me this report" / "Download report" — single-parcel PDF, mirrors
  // TractDetailActionBar's handlers in PortalTractDetail.tsx. Backend
  // contract: POST /api/parcels/{ll_uuid}/report/email|pdf, no body, auth
  // header only. 403 = not entitled, 400 = no email on account.
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // Prefer the tile-carried ll_uuid (durable-dot clicks, which keep
  // working exactly as before). Fall back to the id captured off the
  // fetched /api/regrid/parcel record when the tile carried none — this
  // is what makes the buttons appear for every parcel the panel can
  // display, not just the subset whose tile happened to carry a uuid.
  const llUuid = clickData?.ll_uuid ?? fetchedLlUuid

  // Second-attempt fix (2026-07-15): an ordinary Regrid parcel-fill click
  // carries NEITHER a tile ll_uuid NOR a parcelProps centroid, so llUuid
  // above can stay null through the entire life of the click (before
  // fetchData's lat/lng fallback resolves one, or forever if that fetch
  // errors/misses — a Regrid hiccup must not remove the buttons). The raw
  // click point is captured on every clickData object (ExploreMap) and is
  // ALWAYS present for a real parcel click, so it's the fallback report
  // target the footer and both handlers use when no id has resolved yet.
  const reportPoint = (clickData?.clickLat != null && clickData?.clickLng != null)
    ? { lat: clickData.clickLat, lng: clickData.clickLng }
    : null

  // Reset transient send/download state whenever the clicked parcel changes.
  // Keyed on `clickData` itself (a fresh object literal per click — see
  // its declaration comment) rather than `llUuid`, so it resets on every
  // new click even in the point-fallback case where llUuid stays null
  // across two different parcels.
  useEffect(() => {
    setEmailStatus('idle')
    setEmailMessage(null)
    setDownloading(false)
    setDownloadError(null)
  }, [clickData])

  const parseReportError = async (res: Response): Promise<string> => {
    if (res.status === 403) return 'Not available for your account'
    if (res.status === 404) return 'No parcel found at that location'
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

  // Both handlers below prefer the resolved ll_uuid (existing single-
  // parcel endpoints, unchanged). When no id has resolved — the ordinary
  // parcel-fill click before/without fetchData's own id lookup landing —
  // they fall back to the by-point endpoints with the raw click
  // coordinate, which resolve their own ll_uuid server-side (see
  // main.py's _resolve_ll_uuid_by_point).
  const handleEmailReport = async () => {
    if (!llUuid && !reportPoint) return
    setEmailStatus('sending')
    setEmailMessage(null)
    try {
      const res = llUuid
        ? await fetchWithAuth(`${API_URL}/api/parcels/${llUuid}/report/email`, {
            method: 'POST',
          })
        : await fetchWithAuth(`${API_URL}/api/parcels/report/by-point/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportPoint),
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
    if (!llUuid && !reportPoint) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const res = llUuid
        ? await fetchWithAuth(`${API_URL}/api/parcels/${llUuid}/report/pdf`, {
            method: 'POST',
          })
        : await fetchWithAuth(`${API_URL}/api/parcels/report/by-point/pdf`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(reportPoint),
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

  // "+ Report" (2026-08-17) — same shared multi-tract comparables report
  // ExploreMap's `reportIds`/`onToggleReport` already drive for
  // PortalTractDetail's TractDetailActionBar and CompInlinePopup's "Add to
  // Report". No new report state here: this panel just needs a stable id
  // to key off, matching ExploreMap's own buildParcelSale synthetic-id
  // format (`parcel:lng,lat`, 6dp) so a parcel added from here dedupes
  // correctly against the same parcel later touched via the comp map.
  // Works with NO subject tract — reportTracts (access/page.tsx) is a
  // plain array/Set keyed by id, never gated on a subject existing.
  const reportId = llUuid
    || (reportPoint ? `parcel:${reportPoint.lng.toFixed(6)},${reportPoint.lat.toFixed(6)}` : null)
  const isInReport = !!(reportId && reportIds?.has(reportId))

  const handleToggleReport = () => {
    if (!onToggleReport || !reportId) return
    onToggleReport({
      id: reportId,
      listingId: null,
      tractId: null,
      auctionDate: typeof derived.saledate === 'string' ? derived.saledate.slice(0, 10) : null,
      totalAcres: gisacre,
      tillableAcres: derived.tillableAcres,
      soilRating: derived.soilRating,
      pctTillable: derived.pctTillable,
      // Bug parity with buildParcelSale: a parcel has no listing company,
      // only a Regrid owner — never stuff owner into companyName (that
      // renders under a "Company" label in emailed/report views).
      companyName: null,
      owner: owner !== 'Unknown' ? owner : null,
      latitude: reportPoint?.lat ?? null,
      longitude: reportPoint?.lng ?? null,
      salePrice: validSalePrice ? saleprice : null,
      pricePerAcre: ppa,
      county,
      state,
      township: township || null,
      saleStatus: 'sold',
    })
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
    setFetchedLlUuid(null)
    setLoading(true)

    const { ll_uuid, parcelProps, clickLat, clickLng } = data
    // Fall back to the raw click coordinate (bug fix 2026-07-15) when the
    // tile carried no centroid — an ordinary Regrid parcel-fill click has
    // neither ll_uuid nor centroid_lat/lng on parcelProps, which previously
    // left `qs` empty below and skipped this fetch entirely (so
    // fetchedLlUuid never got set and the report footer never resolved).
    const lat = parcelProps?.centroid_lat ?? clickLat ?? null
    const lng = parcelProps?.centroid_lng ?? clickLng ?? null

    const qs = new URLSearchParams()
    if (ll_uuid) qs.set('ll_uuid', ll_uuid)
    else if (lat != null && lng != null) { qs.set('lat', String(lat)); qs.set('lng', String(lng)) }

    const enrichPromise: Promise<any> = ll_uuid
      ? fetchWithAuth(`${API_URL}/api/parcel-enrichment/by-uuid?ll_uuid=${encodeURIComponent(ll_uuid)}`)
          .then(r => r.ok ? r.json() : null).catch(() => null)
      : Promise.resolve(null)

    // Parcel Spotlight veil: the authoritative polygon/multipolygon this
    // fetch resolves, if any. Reported to ExploreMap in `finally` below
    // regardless of outcome — null tells the map "don't/stop showing a
    // veil for this selection" just as clearly as a real geometry tells
    // it what hole to punch.
    let resolvedGeometry: GeoJSON.Polygon | GeoJSON.MultiPolygon | null = null

    try {
      const [regridRes, enrich] = await Promise.all([
        qs.toString() ? fetchWithAuth(`${API_URL}/api/regrid/parcel?${qs.toString()}`).catch(() => null) : Promise.resolve(null),
        enrichPromise,
      ])
      if (regridRes?.ok) {
        const body = await regridRes.json()
        const parcel = body?.parcel || null
        setRegridData(parcel)
        // Fallback report id — see fetchedLlUuid's declaration comment.
        // Only matters when the tile gave us no ll_uuid at all (the
        // lat/lng branch above); harmless to set otherwise since the
        // effective id always prefers clickData.ll_uuid when present.
        setFetchedLlUuid(parcel?.ll_uuid || null)
        const geom = parcel?._geometry
        if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
          resolvedGeometry = geom
        }
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
      onGeometryResolvedRef.current?.(resolvedGeometry, data)
    }
  }, [])

  useEffect(() => {
    if (!clickData) {
      setRegridData(null)
      setEnrichData(null)
      setFetchedLlUuid(null)
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

  // Owner/county/state/street/township/land-types/hero-strip figures and
  // every "Land Composition ... Mailing Address" section field/boolean are
  // shared with CompInlinePopup (comp map) via parcelDetailFields.tsx so the
  // two can't drift apart — same derivation, same precedence rules this
  // component used inline before (see that file's deriveParcelDetail doc
  // comment).
  const derived = deriveParcelDetail(regridData, parcelProps, enrichData)
  const { owner, county, state, countyState, street, township, landTypes,
    gisacre, saleprice, ppa, ratingLabel, soilRating, soilRatingType,
    tillableAcres, dominantLandcover } = derived
  const validSalePrice = typeof saleprice === 'number' && saleprice > 0
  const soilBreakdown: Array<{ mukey?: string; soil?: string; acres?: number; pi?: number }> =
    Array.isArray(enrichData?.soils) ? enrichData.soils : []

  // Soil at clicked point (from the tile feature)
  const clickedMuname = soilProps?.muname || soilProps?.mukey || null
  const clickedMusym = soilProps?.musym || null
  const clickedNccpi = soilProps?.nccpi ?? null

  // ── Crop history ──────────────────────────────────────────────────────────
  const CDL_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]
  const hasCropData = CDL_YEARS.some(yr => csbProps?.[`cdl${yr}`] && csbProps[`cdl${yr}`] !== 0)

  const hasSoilData = clickedMuname || soilRating != null || tillableAcres != null || soilBreakdown.length > 0

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
    visibleHasSoilData || hasCropData || derived.hasLandComposition || derived.hasSoilRatingRow ||
    derived.hasLastSale || derived.hasProperty || derived.hasAssessed || derived.hasBuildings || derived.hasMailing
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
      {/* Backdrop — inert (bug fix 2026-08-15). This used to sit
          `inset:0` over the WHOLE map with pointerEvents:'auto' any time
          the panel was open, which put it above the MapLibre canvas in
          the DOM/paint order for the panel's entire z-index-19 footprint —
          not just the strip to the right of the 380px panel. A DOM click
          hits whichever element is topmost at that pixel, so every click
          meant for the map underneath (a different parcel's fill, a
          tract, a sale dot) was being swallowed here and turned into
          onClose() before MapLibre's own canvas ever saw a 'click' event —
          the panel closed instead of switching to the newly-clicked
          parcel. pointerEvents is now unconditionally 'none': clicking a
          different parcel/tract/dot now reaches the map and its own
          handler (which already calls setLandDetail with the new
          selection, or closes this panel itself when something
          higher-priority wins). The one behavior this removes is
          "click a blank, non-interactive patch of map to dismiss the
          panel" — Escape and the X button (below) still close it. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 19,
          pointerEvents: 'none',
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
          width: LAND_DETAIL_PANEL_WIDTH,
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

          {/* Land-type badges (Illinois parcels) — shared with CompInlinePopup
              (parcelDetailFields.tsx) so the pill styling can't drift. */}
          <LandTypeBadges landTypes={landTypes} />

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

          {/* ── C through H: Land Composition, Soil Rating, Last Sale,
              Property, Assessed Value, Buildings, Mailing Address — shared
              with CompInlinePopup (parcelDetailFields.tsx) so the two
              modals' data/order/formatting can't drift apart. */}
          <ParcelDetailSections d={derived} />

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

          {/* ── Disclaimer — owner-requested (2026-08-14), always renders
              as the last item in the scroll area regardless of which
              sections above are present. Verbatim text (shared constant,
              parcelDetailFields.tsx), do not edit. */}
          <div style={{ padding: '18px 16px 4px', color: 'rgba(0,0,0,0.4)', fontSize: 11.5, lineHeight: 1.5 }}>
            {PARCEL_DISCLAIMER_TEXT}
          </div>
        </div>

        {/* ── Footer: Email me this report / Download report ──────────
            Visual language mirrors TractDetailActionBar's second row
            (PortalTractDetail.tsx) — same padding, rounded buttons, pink
            primary — reimplemented in this file's inline-style idiom
            since this panel doesn't use Tailwind classes. Gated on
            `llUuid || reportPoint` (second-attempt fix, 2026-07-15):
            llUuid covers durable-dot clicks and any parcel click whose
            id has resolved (tile-carried or fetched); reportPoint is the
            raw click coordinate, which is ALWAYS present for a real
            parcel/dot click (see clickLng/clickLat in ExploreMap's
            setLandDetail calls) — so the buttons show for every parcel,
            not just the subset with a resolved id. Hidden only for
            overlay-originated clicks (soil/CSB with no parcel underneath
            — clickData.source === 'overlay'), which never set a click
            point in the first place. */}
        {(llUuid || reportPoint) && (
          <div style={{ flexShrink: 0, borderTop: '1px solid rgba(0,0,0,0.06)', padding: '16px', background: '#fff' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* + Report — to the LEFT of Download/Email (owner
                  2026-08-17). Same toggle look as TractDetailActionBar's
                  "+ Report"/"− Report" (PortalTractDetail.tsx): pink
                  outline when already added, reimplemented in this
                  panel's inline-style idiom since it doesn't use
                  Tailwind. Hidden entirely when the parent didn't wire
                  onToggleReport (e.g. the public listings-page map). */}
              {onToggleReport && (
                <button
                  onClick={handleToggleReport}
                  disabled={!reportId}
                  title={isInReport ? 'Remove from report' : 'Add to report'}
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
                    border: isInReport ? '1px solid rgba(233,30,140,0.3)' : '1px solid rgba(0,0,0,0.12)',
                    background: isInReport ? 'rgba(233,30,140,0.08)' : '#fff',
                    color: isInReport ? '#E91E8C' : '#1a1a1a',
                    cursor: reportId ? 'pointer' : 'default',
                    opacity: reportId ? 1 : 0.5,
                  }}
                >
                  {isInReport ? '− Report' : '+ Report'}
                </button>
              )}
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
                  <><Download size={14} /> Download Parcel</>
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
                  <><Mail size={14} /> Email Parcel</>
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
