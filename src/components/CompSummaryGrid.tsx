'use client'

// The comp-report summary block every report surface renders (owner
// 2026-10-27): a TOTALS row (acres, tillable acres + %, sale dollars) above
// the AVERAGES, with the soil rating weighted by tillable acres and a
// "n of N rated" note. Numbers come from summarizeComps — the one helper —
// so the slide-out panel, the listing report pages, the PDF and the app all
// show the same figures for the same comps.

import { useMemo } from 'react'
import { summarizeComps, type CompAverageInput } from '@/lib/compAverages'
import { formatAcres } from '@/lib/format'
import FitText from '@/components/FitText'

export function fmtDollars(val?: number | null): string {
  if (!val) return '—'
  return '$' + Math.round(val).toLocaleString()
}

/** " · 63%" — tillable share of the total acres, on the tile's label line so
 *  the value stays a single number and never wraps. */
function pct(v?: number | null): string {
  return v ? ` \u00B7 ${Math.round(v)}%` : ''
}

function fmtRating(val?: number | null): string {
  if (val == null) return '—'
  return val.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** The server's comp-report totals (POST /api/comparables/summary, via
 *  useServerCompTotals): `display` strings are printed verbatim. */
export interface ServerCompTotals {
  display?: Record<string, string> | null
  ratedCount?: number | null
  count?: number | null
}

interface Props {
  comps: CompAverageInput[]
  /** Server totals (owner 11/20): when this prop is passed (even while
   *  loading, display null) every tile prints the server's display string, or
   *  "—", and nothing is aggregated on the client. Omit it only for the
   *  tract-only listing report pages. */
  totals?: ServerCompTotals | null
  /** label for the soil rating tiles, e.g. "Avg PI" / "Avg Soil Rating" */
  soilLabel: string
  /** label for the $/soil tile, e.g. "Avg $/PI" */
  perSoilLabel: string
  /** 'panel' = dark slide-out tiles; 'page' = the /listings report pages */
  tone?: 'panel' | 'page'
  /** section heading; omit to render just the tiles */
  title?: string
}

export default function CompSummaryGrid({ comps, totals, soilLabel, perSoilLabel, tone = 'panel', title }: Props) {
  const serverMode = totals !== undefined
  const s = useMemo(() => summarizeComps(serverMode ? [] : comps), [comps, serverMode])
  const tile = tone === 'panel'
    ? 'bg-white/[0.03] rounded-xl p-3 border border-white/5'
    : 'bg-gg-gray-900 rounded-lg p-3'
  // Totals read differently from the averages (owner 2026-10-27): a pink
  // tinted surface and border, pink labels.
  const totalTile = 'bg-gg-pink/10 rounded-xl p-3 border border-gg-pink/30'
  const totalLabel = tone === 'panel' ? 'text-[10px] text-gg-pink/80 mt-0.5' : 'text-xs text-gg-pink/80 uppercase'
  const value = 'font-bold'
  const label = tone === 'panel' ? 'text-[10px] text-gg-gray-400 mt-0.5' : 'text-xs text-gray-400 uppercase'
  const maxPx = tone === 'panel' ? 18 : 20
  const rowLabel = 'text-[10px] font-semibold text-gg-gray-500 uppercase tracking-wider mb-1.5'
  // Server display strings win; a key the server did not send is "—".
  const sd = totals?.display ?? null
  const T = (key: string, fallback: string) => (serverMode ? (sd?.[key] || '—') : fallback)
  const nCountShown = serverMode ? comps.length : s.count
  const nRated = serverMode ? totals?.ratedCount ?? null : s.ratedCount
  const nCount = serverMode ? totals?.count ?? null : s.count
  const soilRated = nRated != null && nCount != null && nRated < nCount && nCount > 0 ? ` · ${nRated} of ${nCount} rated` : ''

  return (
    <div data-testid="comp-summary">
      {title && (
        <h3 className="text-xs font-semibold text-gg-gray-400 uppercase tracking-wider mb-3">
          {title}{nCountShown > 0 ? ` (${nCountShown} sale${nCountShown !== 1 ? 's' : ''})` : ''}
        </h3>
      )}
      <div className={`${rowLabel} text-gg-pink/80`}>Totals</div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className={totalTile}>
          <FitText max={maxPx} className={value}>{T('total_acres', s.totalAcres ? formatAcres(s.totalAcres) : '—')}</FitText>
          <div className={totalLabel}>Total Acres</div>
        </div>
        <div className={totalTile}>
          <FitText max={maxPx} className={value}>{T('total_tillable', s.totalTillable ? formatAcres(s.totalTillable) : '—')}</FitText>
          <div className={totalLabel}>Total Tillable{serverMode ? (sd?.pct_tillable && sd.pct_tillable !== '—' ? ` \u00B7 ${sd.pct_tillable}` : '') : pct(s.pctTillable)}</div>
        </div>
        <div className={totalTile}>
          <FitText max={maxPx} className={`${value} text-gg-pink`}>{T('total_sale', fmtDollars(s.totalSale))}</FitText>
          <div className={totalLabel}>Total Sales</div>
        </div>
      </div>
      <div className={rowLabel}>Averages</div>
      <div className="grid grid-cols-3 gap-2">
        <div className={tile}>
          <FitText max={maxPx} className={`${value} text-gg-pink`}>{T('avg_ppa', fmtDollars(s.avgPricePerAcre))}</FitText>
          <div className={label}>Avg $/Acre</div>
        </div>
        <div className={tile}>
          <FitText max={maxPx} className={`${value} text-gg-pink`}>{T('avg_ppta', fmtDollars(s.avgPricePerTillable))}</FitText>
          <div className={label}>Avg $/Till Ac</div>
        </div>
        <div className={tile}>
          <FitText max={maxPx} className={`${value} text-gg-pink`}>{T('avg_ppsr', fmtDollars(s.avgPricePerSoil))}</FitText>
          <div className={label}>{perSoilLabel}</div>
        </div>
        <div className={tile}>
          <FitText max={maxPx} className={value}>{T('avg_acres', s.avgAcres ? formatAcres(s.avgAcres) : '—')}</FitText>
          <div className={label}>Avg Acres</div>
        </div>
        <div className={tile}>
          <FitText max={maxPx} className={value}>{T('avg_till', s.avgTillable ? formatAcres(s.avgTillable) : '—')}</FitText>
          <div className={label}>Avg Tillable{serverMode ? (sd?.pct_tillable && sd.pct_tillable !== '—' ? ` \u00B7 ${sd.pct_tillable}` : '') : pct(s.pctTillable)}</div>
        </div>
        <div className={tile}>
          <FitText max={maxPx} className={value}>{T('soil_rating', fmtRating(s.soilRating))}</FitText>
          <div className={label}>{soilLabel}{soilRated}</div>
        </div>
      </div>
    </div>
  )
}
