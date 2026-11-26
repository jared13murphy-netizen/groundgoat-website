import { STATUS_COLORS } from './mapConstants'
import { formatAcres } from '@/lib/format'
import { formatAuctionDateTimeForViewer } from '@/lib/auctionTime'
import { soilRatingLabel } from '@/lib/soilRatingLabel'
import { gatedPpta, gatedPprating, totalLabelFor } from '@/lib/priceRules'

// Viewer's own time zone (owner 11/24); date-only strings stay a calendar day.
function formatDate(dateStr: string, state?: string): string {
  if (!dateStr) return 'TBD'
  return formatAuctionDateTimeForViewer(dateStr, state)
}

function formatCurrency(amount: number): string {
  if (amount <= 0) return '—'
  if (amount >= 1000000) {
    return '$' + (amount / 1000000).toFixed(2) + 'M'
  }
  return '$' + Math.round(amount).toLocaleString()
}

function getStatusBadgeStyle(status: string): string {
  const colors = STATUS_COLORS[status] || STATUS_COLORS.listed
  return `background: ${colors.fill}22; color: ${colors.fill}; border: 1px solid ${colors.fill}44;`
}

/** The two rate rows, shared by both popup builders.
 *
 *  ONE rule for every surface (owner 11/17, src/lib/priceRules.ts — the
 *  parcel panel's): $/tillable acre only when tillable is >= 1 ac AND >= 25%
 *  of the acres; $/rating only when tillable is >= 25%. Unguarded, a
 *  mostly-timber tract renders absurd figures ($1,765,863,665 per tillable
 *  acre on a 97%-timber parcel). Share is computed from acres, never from
 *  pct_tillable (0-100 in some states, a 0-1 fraction elsewhere).
 */
function buildRateRows(props: Record<string, unknown>): string {
  const totalAcres = props.totalAcres as number
  const tillableAcres = props.tillableAcres as number
  const perTillable = gatedPpta(props.pricePerTillableAcre as number, tillableAcres, totalAcres)
  const perRating = gatedPprating(props.pricePerSoilRating as number, tillableAcres, totalAcres)
  const ratingType = props.soilRatingType as string
  return `
    ${perTillable ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Price/Tillable Acre</span>
      <span class="tract-popup-value">${formatCurrency(perTillable)}</span>
    </div>` : ''}
    ${perRating && ratingType ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Price/${ratingType}</span>
      <span class="tract-popup-value">${formatCurrency(perRating)}</span>
    </div>` : ''}`
}

/** Price/Acre + the total, by the owner's 11/4 rule (priceMode 'total' →
 *  the total price only, labelled Sale / Asking Price). */
function buildPriceRows(props: Record<string, unknown>): string {
  const mode = props.priceMode as string | undefined
  const ppa = props.pricePerAcre as number
  const salePrice = props.salePrice as number
  const total = (props.totalPrice as number) || salePrice
  const label = totalLabelFor({
    basis: (props.priceBasis as 'sold' | 'asking' | null) ?? (salePrice > 0 ? 'sold' : null),
    scope: props.priceScope === 'listing' ? 'listing' : 'tract',
    listingTractCount: null,
  })
  return `
    ${mode !== 'total' && ppa > 0 ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Price/Acre</span>
      <span class="tract-popup-value">${formatCurrency(ppa)}</span>
    </div>` : ''}
    ${total > 0 ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">${label}</span>
      <span class="tract-popup-value">${formatCurrency(total)}</span>
    </div>` : ''}`
}

export function buildTractPopupHTML(props: Record<string, unknown>): string {
  const tractNumber = props.tractNumber as number
  const totalAcres = props.totalAcres as number
  const listingTitle = props.listingTitle as string
  const companyName = props.companyName as string
  const auctionDate = props.auctionDate as string
  const status = props.status as string
  const tillableAcres = props.tillableAcres as number
  const pricePerTillableAcre = props.pricePerTillableAcre as number
  const pricePerSoilRating = props.pricePerSoilRating as number
  const soilRatingType = props.soilRatingType as string
  const county = props.county as string
  const state = props.state as string
  const listingId = props.listingId as string
  const dataResolution = props.dataResolution as string

  const displayStatus = (status || 'listed').replace('_', ' ')

  const rateRows = buildRateRows(props)
  const precisionNote = dataResolution === 'centroid'
    ? '<div style="color:#6b7280;font-size:11px;margin-top:6px;font-style:italic;">Location approximate (county centroid)</div>'
    : ''

  return `
    <div class="tract-popup-title">
      ${tractNumber > 0 ? 'Tract ' + tractNumber + ' — ' : ''}${totalAcres > 0 ? formatAcres(totalAcres) + ' acres' : county + ' County, ' + state}
    </div>
    <div class="tract-popup-subtitle">${listingTitle}</div>
    <div class="tract-popup-divider"></div>
    <div class="tract-popup-row">
      <span class="tract-popup-label">Company</span>
      <span class="tract-popup-value">${companyName}</span>
    </div>
    ${totalAcres > 0 ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Acres</span>
      <span class="tract-popup-value">${formatAcres(totalAcres)}</span>
    </div>` : ''}
    ${buildPriceRows(props)}
    ${rateRows}
    <div class="tract-popup-row">
      <span class="tract-popup-label">Auction</span>
      <span class="tract-popup-value">${formatDate(auctionDate, state)}</span>
    </div>
    <div class="tract-popup-row">
      <span class="tract-popup-label">Status</span>
      <span class="tract-popup-badge" style="${getStatusBadgeStyle(status)}">${displayStatus}</span>
    </div>
    ${precisionNote}
    <a class="tract-popup-link" href="/admin/listings/${listingId}">View Listing →</a>
  `
}

export function buildExplorePopupHTML(props: Record<string, unknown>): string {
  const totalAcres = props.totalAcres as number
  const companyName = props.companyName as string
  const auctionDate = props.auctionDate as string
  const status = props.status as string
  const county = props.county as string
  const state = props.state as string
  const rawTownship = props.township as string
  const township = rawTownship ? (rawTownship.replace(/\s+(Township|CCD|Precinct)\s*$/i, '').replace(/\s+No\.?\s*\d+\s*$/i, '').replace(/^(in|of)\s+/i, '').trim() || rawTownship) : ''
  const listingId = props.listingId as string
  const soilRating = props.soilRating as number
  const soilRatingType = props.soilRatingType as string
  const pctTillable = props.pctTillable as number

  const rateRows = buildRateRows(props)
  const displayStatus = (status || 'listed').replace('_', ' ')

  return `
    <div class="tract-popup-title">
      ${totalAcres > 0 ? formatAcres(totalAcres) + ' acres' : county + ' County, ' + state}
    </div>
    <div class="tract-popup-subtitle">${county} County, ${state}</div>
    <div class="tract-popup-divider"></div>
    <div class="tract-popup-row">
      <span class="tract-popup-label">Company</span>
      <span class="tract-popup-value">${companyName}</span>
    </div>
    ${totalAcres > 0 ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Acres</span>
      <span class="tract-popup-value">${formatAcres(totalAcres)}</span>
    </div>` : ''}
    ${pctTillable ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Tillable</span>
      <span class="tract-popup-value">${pctTillable}%</span>
    </div>` : ''}
    ${buildPriceRows(props)}
    ${rateRows}
    ${soilRating ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">${soilRatingLabel({ soil_rating_type: soilRatingType })}</span>
      <span class="tract-popup-value">${soilRating}</span>
    </div>` : ''}
    ${township ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Township</span>
      <span class="tract-popup-value">${township}</span>
    </div>` : ''}
    <div class="tract-popup-row">
      <span class="tract-popup-label">Auction</span>
      <span class="tract-popup-value">${formatDate(auctionDate, state)}</span>
    </div>
    <div class="tract-popup-row">
      <span class="tract-popup-label">Status</span>
      <span class="tract-popup-badge" style="${getStatusBadgeStyle(status)}">${displayStatus}</span>
    </div>
    ${listingId ? `<a class="tract-popup-link" href="/listings/${listingId}">${String(props.listingType || props.listing_type || '').toLowerCase() === 'private_treaty' ? 'View Listing' : 'View Auction'} →</a>` : ''}
  `
}
