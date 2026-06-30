import { STATUS_COLORS } from './mapConstants'
import { formatAcres } from '@/lib/format'

function formatDate(dateStr: string): string {
  if (!dateStr) return 'TBD'
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

export function buildTractPopupHTML(props: Record<string, unknown>): string {
  const tractNumber = props.tractNumber as number
  const totalAcres = props.totalAcres as number
  const listingTitle = props.listingTitle as string
  const companyName = props.companyName as string
  const auctionDate = props.auctionDate as string
  const status = props.status as string
  const pricePerAcre = props.pricePerAcre as number
  const salePrice = props.salePrice as number
  const county = props.county as string
  const state = props.state as string
  const listingId = props.listingId as string
  const dataResolution = props.dataResolution as string

  const displayStatus = (status || 'listed').replace('_', ' ')
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
    ${pricePerAcre > 0 ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Price/Acre</span>
      <span class="tract-popup-value">${formatCurrency(pricePerAcre)}</span>
    </div>` : ''}
    ${salePrice > 0 ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Sale Price</span>
      <span class="tract-popup-value">${formatCurrency(salePrice)}</span>
    </div>` : ''}
    <div class="tract-popup-row">
      <span class="tract-popup-label">Auction</span>
      <span class="tract-popup-value">${formatDate(auctionDate)}</span>
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
  const pricePerAcre = props.pricePerAcre as number
  const salePrice = props.salePrice as number
  const county = props.county as string
  const state = props.state as string
  const rawTownship = props.township as string
  const township = rawTownship ? (rawTownship.replace(/\s+(Township|CCD|Precinct)\s*$/i, '').replace(/\s+No\.?\s*\d+\s*$/i, '').replace(/^(in|of)\s+/i, '').trim() || rawTownship) : ''
  const listingId = props.listingId as string
  const soilRating = props.soilRating as number
  const pctTillable = props.pctTillable as number

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
    ${pricePerAcre > 0 ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Price/Acre</span>
      <span class="tract-popup-value">${formatCurrency(pricePerAcre)}</span>
    </div>` : ''}
    ${salePrice > 0 ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Sale Price</span>
      <span class="tract-popup-value">${formatCurrency(salePrice)}</span>
    </div>` : ''}
    ${soilRating ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Soil Rating</span>
      <span class="tract-popup-value">${soilRating}</span>
    </div>` : ''}
    ${township ? `
    <div class="tract-popup-row">
      <span class="tract-popup-label">Township</span>
      <span class="tract-popup-value">${township}</span>
    </div>` : ''}
    <div class="tract-popup-row">
      <span class="tract-popup-label">Auction</span>
      <span class="tract-popup-value">${formatDate(auctionDate)}</span>
    </div>
    <div class="tract-popup-row">
      <span class="tract-popup-label">Status</span>
      <span class="tract-popup-badge" style="${getStatusBadgeStyle(status)}">${displayStatus}</span>
    </div>
    ${listingId ? `<a class="tract-popup-link" href="/listings/${listingId}">View Listing →</a>` : ''}
  `
}
