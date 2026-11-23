/**
 * Shared "Subject Tract" tile row — FOUR tiles, fixed order, matching the
 * owner-approved PDF strip exactly: Total Acres, Tillable Acres,
 * % Tillable, then the subject's own soil-rating tile — labeled from
 * `soilRatingType` (PI/CSR2/WAPI/NCCPI/CPI/...), never guessed from state.
 * See src/lib/soilRatingLabel.ts.
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
import { subjectTillableAcres } from '@/lib/subjectStats'
import { soilRatingLabel } from '@/lib/soilRatingLabel'
import { UPDATING, figDisplay, figShown, DASH, type ServerDisplay } from '@/lib/parcelFigures'

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
  /** A parcel subject whose server `figures` say it is being re-measured
   *  (src/lib/parcelFigures.ts): tillable / % / rating read "Updating…". */
  remeasuring?: boolean | null
  /** A PARCEL subject (owner 11/20): the server's print strings
   *  (figures.display), rendered verbatim — the numeric props above are
   *  ignored. Tract subjects leave this unset and keep the numeric path. */
  display?: ServerDisplay | null
  /** true for a parcel subject: with no `display` every tile is "—" (never a
   *  number built from the numeric props). */
  serverOnly?: boolean
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
  remeasuring,
  display,
  serverOnly,
  variant = 'grid',
}: SubjectStripProps) {
  const totalNum = toNum(totalAcres)
  const tillable = subjectTillableAcres(totalAcres, tillableAcres, pctTillable)

  const explicitPct = toNum(pctTillable)
  const derivedPct = tillable != null && totalNum != null && totalNum !== 0
    ? Math.round((tillable / totalNum) * 100)
    : null
  // A parcel subject always carries the server's pct (parcelFigures), so the
  // derived fallback only runs for tract subjects / old API payloads.
  const pct = explicitPct != null ? Math.round(explicitPct) : derivedPct

  const soil = toNum(soilRating)
  const soilLabel = soilRatingLabel({ soil_rating_type: soilRatingType })

  const fromServer = !!display || !!serverOnly
  const d = { display: display ?? null }
  const serverLabel = figDisplay(d, 'rating_label')
  const tiles: [string, string][] = fromServer
    ? [
        ['Total Acres', figDisplay(d, 'acres')],
        ['Tillable Acres', figDisplay(d, 'tillable_acres')],
        ['% Tillable', figDisplay(d, 'pct_tillable')],
        [figShown(serverLabel) ? serverLabel : soilLabel, figDisplay(d, 'rating')],
      ]
    : [
        ['Total Acres', fmtDecimal(toNum(totalAcres))],  // one decimal, same as the PDF and the app
        ['Tillable Acres', remeasuring ? UPDATING : fmtDecimal(tillable)],
        ['% Tillable', remeasuring ? UPDATING : pct != null ? pct + '%' : DASH],
        [soilLabel, remeasuring ? UPDATING : fmtDecimal(soil)],
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
