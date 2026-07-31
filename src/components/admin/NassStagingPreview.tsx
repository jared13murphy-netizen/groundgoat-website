'use client'

/**
 * NassStagingPreview — compact NASS readout for staging review screens.
 *
 * Drops into a staging row to confirm at-a-glance that:
 *   1. The listing's county resolves to a real NASS-tracked county
 *      (admin sanity-check that county_id will populate correctly when
 *      the listing graduates to the live `tracts` table).
 *   2. Recent USDA values exist for the area (yields, rent, landvalue).
 *
 * Uses /api/ground-truth/county/{state}/{county} — works even though
 * staging rows don't have a tract_id yet.
 *
 * Renders a single line: "NASS · Corn 211 bu/ac (2024) · Rent $219/ac (2025) · Cropland $10,300/ac (2025)"
 * Yellow warning when county doesn't match. Quietly empty when no data
 * and no state/county provided.
 */
import { useEffect, useState } from 'react'
import { Sprout, AlertTriangle } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

interface YieldRow { year: number; practice: string | null; ypa: number | null; unit: string | null }
interface RentRow { year: number; dpa: number | null }
interface ValueRow { year: number; dpa: number | null }

interface GroundTruth {
  state: string | null
  county: string | null
  yields: Record<string, YieldRow[]>
  rent: Record<string, RentRow[]>
  landvalue: Record<string, ValueRow[]>
  note?: string
}

interface NassStagingPreviewProps {
  /** Two-letter state abbreviation OR full state name. The component
      tries the abbreviation first; full names get a 2-char prefix lookup
      as a best-effort fallback. */
  state?: string | null
  county?: string | null
}

const STATE_NAME_TO_ABBR: Record<string, string> = {
  'illinois': 'IL', 'iowa': 'IA', 'missouri': 'MO', 'indiana': 'IN',
  'minnesota': 'MN', 'north dakota': 'ND', 'nebraska': 'NE', 'kansas': 'KS',
  'south dakota': 'SD', 'ohio': 'OH', 'michigan': 'MI', 'kentucky': 'KY',
  'wisconsin': 'WI',
}

function normalizeStateAbbr(s: string): string | null {
  const trimmed = s.trim()
  if (trimmed.length === 2) return trimmed.toUpperCase()
  const lookup = STATE_NAME_TO_ABBR[trimmed.toLowerCase()]
  return lookup || null
}

function pickPrimaryYieldRow(rows: YieldRow[] | undefined, wantPractice: string): YieldRow | null {
  if (!rows || rows.length === 0) return null
  const filtered = rows.filter(r => r.practice === wantPractice && r.ypa != null)
  const pool = filtered.length > 0 ? filtered : rows.filter(r => r.ypa != null)
  if (pool.length === 0) return null
  return [...pool].sort((a, b) => b.year - a.year)[0]
}

function pickLatest<T extends { year: number; dpa: number | null }>(rows: T[] | undefined): T | null {
  if (!rows || rows.length === 0) return null
  const valid = rows.filter(r => r.dpa != null)
  if (valid.length === 0) return null
  return [...valid].sort((a, b) => b.year - a.year)[0]
}

const dollar = (v: number) => '$' + Math.round(v).toLocaleString('en-US')

export default function NassStagingPreview({ state, county }: NassStagingPreviewProps) {
  const [data, setData] = useState<GroundTruth | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!state || !county) return
    const abbr = normalizeStateAbbr(state)
    if (!abbr) return

    let cancelled = false
    setLoading(true)
    fetchWithAuth(`${API_URL}/api/ground-truth/county/${abbr}/${encodeURIComponent(county)}`)
      .then(r => r.ok ? r.json() : null)
      .then((body: GroundTruth | null) => { if (!cancelled && body) setData(body) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [state, county])

  if (!state || !county) return null
  if (loading) {
    return <div className="text-[11px] text-gg-gray-500 italic">Loading NASS…</div>
  }
  if (!data) return null

  // County mismatch warning — admin should fix the county field on the
  // staging row before approving.
  if (data.note) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-amber-400">
        <AlertTriangle size={11} />
        <span>NASS · {data.note}</span>
      </div>
    )
  }

  const corn = pickPrimaryYieldRow(data.yields?.CORN, 'GRAIN')
  const beans = pickPrimaryYieldRow(data.yields?.SOYBEANS, 'ALL UTILIZATION PRACTICES')
  const rentNonIrr = pickLatest(data.rent?.CROPLAND_NON_IRR)
  const landCropland = pickLatest(data.landvalue?.CROPLAND)

  const parts: string[] = []
  if (corn) parts.push(`Corn ${corn.ypa!.toFixed(0)} bu/ac (${corn.year})`)
  if (beans) parts.push(`Soy ${beans.ypa!.toFixed(0)} bu/ac (${beans.year})`)
  if (rentNonIrr) parts.push(`Rent ${dollar(rentNonIrr.dpa!)}/ac (${rentNonIrr.year})`)
  if (landCropland) parts.push(`Cropland ${dollar(landCropland.dpa!)}/ac (${landCropland.year})`)

  if (parts.length === 0) return null

  return (
    <div className="flex items-center gap-1.5 text-[11px] text-gg-gray-400">
      <Sprout size={11} className="text-emerald-500 flex-shrink-0" />
      <span className="text-gg-gray-500 font-medium">NASS</span>
      <span className="text-gg-gray-600">·</span>
      <span className="truncate">{parts.join(' · ')}</span>
    </div>
  )
}
