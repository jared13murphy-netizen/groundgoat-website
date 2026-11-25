'use client'

/**
 * SaleStatusChips — two-pill toggle for tract sale_status (Sold / No Sale).
 *
 * Props:
 *   status   — current sale_status value (any string)
 *   onChange — called with 'sold', 'no_sale', or '' (null/auto = clear)
 *   disabled — grays out both chips
 *
 * Clicking an active chip clears the status (→ '' which callers map to null).
 * When the current status is not 'sold' or 'no_sale' it is shown as a small
 * "(auto)" badge next to the chips using the same status badge classes used
 * elsewhere in the admin.
 */

// Owner 11/25 + solid-button rule (11/12): real buttons, solid fills, readable on the gray card.
const SOLD_ACTIVE    = 'bg-green-600 text-white border-green-600'
const SOLD_HOVER     = 'hover:bg-green-600 hover:text-white hover:border-green-600'
const NO_SALE_ACTIVE = 'bg-red-600 text-white border-red-600'
const NO_SALE_HOVER  = 'hover:bg-red-600 hover:text-white hover:border-red-600'
const INACTIVE       = 'bg-[#E4E4E7] text-black border-[#D4D4D8]'
const BASE           = 'px-4 py-1.5 rounded-lg text-sm font-semibold border shadow-sm cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

// Status badge classes mirroring existing admin badge patterns.
const AUTO_BADGE_CLS: Record<string, string> = {
  auction: 'bg-blue-600 text-white border border-blue-600',
  listed:  'bg-[#E4E4E7] text-black border border-[#D4D4D8]',
  live:    'bg-blue-600 text-white border border-blue-600',
  pending: 'bg-yellow-400 text-black border border-yellow-400',
}
const AUTO_BADGE_DEFAULT = 'bg-[#E4E4E7] text-black border border-[#D4D4D8]'

interface SaleStatusChipsProps {
  status: string | null | undefined
  onChange: (next: string) => void
  disabled?: boolean
}

export default function SaleStatusChips({ status, onChange, disabled }: SaleStatusChipsProps) {
  const cur = status ?? ''

  const soldActive   = cur === 'sold'
  const noSaleActive = cur === 'no_sale'
  const isOther      = cur !== '' && cur !== 'sold' && cur !== 'no_sale'

  const handleSold = () => {
    if (disabled) return
    onChange(soldActive ? '' : 'sold')
  }
  const handleNoSale = () => {
    if (disabled) return
    onChange(noSaleActive ? '' : 'no_sale')
  }

  return (
    <div className="mb-2">
      <div className="text-[11px] font-semibold text-gray-700 mb-1 uppercase tracking-wide">Sale Status</div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          disabled={!!disabled}
          onClick={handleSold}
          className={`${BASE} ${soldActive ? SOLD_ACTIVE : `${INACTIVE} ${SOLD_HOVER}`}`}
        >
          {soldActive ? '✓ ' : ''}Sold
        </button>
        <button
          type="button"
          disabled={!!disabled}
          onClick={handleNoSale}
          className={`${BASE} ${noSaleActive ? NO_SALE_ACTIVE : `${INACTIVE} ${NO_SALE_HOVER}`}`}
        >
          {noSaleActive ? '✓ ' : ''}No Sale
        </button>
        {isOther && (
          <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded font-medium capitalize ${AUTO_BADGE_CLS[cur] ?? AUTO_BADGE_DEFAULT}`}>
            {cur.replace('_', ' ')} <span className="ml-1 opacity-80">(auto)</span>
          </span>
        )}
      </div>
    </div>
  )
}
