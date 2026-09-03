/**
 * Shared "Subject Tract" tile row — FOUR tiles, fixed order, matching the
 * owner-approved PDF strip exactly: Total Acres, Tillable Acres,
 * % Tillable, then the state's native soil-rating tile (PI/CSR2/WAPI/
 * NCCPI/CPI, or `subject_soil_rating_type` when the backend supplies one).
 *
 * Used by PortalComparablesReportPanel, PortalReportPanel,
 * PortalComparablesPanel, and the listings comp-report page
 * (src/app/listings/[id]/comparables/report/page.tsx) so the four callers
 * can't drift from each other or from the PDF again.
 *
 * Every tile renders "—" only for a null/undefined value — never for a
 * genuine 0 — via explicit numeric coercion (toNum / subjectTillableAcres),
 * not truthiness checks. See src/lib/subjectStats.ts for why that matters.
 */
import { toNum } from '@/lib/format'
import { subjectTillableAcres, getSoilRatingLabel } from '@/lib/subjectStats'

interface SubjectStripProps {
  totalAcres?: number | string | null
  tillableAcres?: number | string | null
  /** Raw subject_pct_tillable when the caller has it; falls back to
   *  tillable/total when it doesn't (the listings report page's subject
   *  shape carries no raw pct field at all). */
  pctTillable?: number | string | null
  soilRating?: number | string | null
  soilRatingType?: string | null
  state?: string | null
  /** 'grid' (default): compact 4-col portal tile — label above value.
   *  'flex': wider listings-report layout — value above label, larger text. */
  variant?: 'grid' | 'flex'
}

function fmtDecimal(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

export default function SubjectStrip({
  totalAcres,
  tillableAcres,
  pctTillable,
  soilRating,
  soilRatingType,
  state,
  variant = 'grid',
}: SubjectStripProps) {
  const totalNum = toNum(totalAcres)
  const tillable = subjectTillableAcres(totalAcres, tillableAcres, pctTillable)

  const explicitPct = toNum(pctTillable)
  const derivedPct = tillable != null && totalNum != null && totalNum !== 0
    ? Math.round((tillable / totalNum) * 100)
    : null
  const pct = explicitPct != null ? Math.round(explicitPct) : derivedPct

  const soil = toNum(soilRating)
  const soilLabel = soilRatingType || getSoilRatingLabel(state)

  const tiles: [string, string][] = [
    ['Total Acres', fmtDecimal(toNum(totalAcres))],  // one decimal, same as the PDF and the app
    ['Tillable Acres', fmtDecimal(tillable)],
    ['% Tillable', pct != null ? pct + '%' : '—'],
    [soilLabel, fmtDecimal(soil)],
  ]

  if (variant === 'flex') {
    return (
      <div className="flex gap-6 mt-2 text-sm">
        {tiles.map(([label, value]) => (
          <div key={label}>
            <span className="text-lg font-bold">{value}</span><br />
            <span className="text-gray-400">{label}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-4 gap-3 mt-3">
      {tiles.map(([label, value]) => (
        <div key={label}>
          <div className="text-[10px] text-gg-gray-400">{label}</div>
          <div className="text-sm font-semibold">{value}</div>
        </div>
      ))}
    </div>
  )
}
