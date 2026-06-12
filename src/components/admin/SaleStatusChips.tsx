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

const SOLD_ACTIVE    = 'bg-green-500/20 text-green-400 border-green-500/50'
const SOLD_HOVER     = 'hover:border-green-500/60 hover:text-green-400'
const NO_SALE_ACTIVE = 'bg-red-500/20 text-red-400 border-red-500/50'
const NO_SALE_HOVER  = 'hover:border-red-500/60 hover:text-red-400'
const INACTIVE       = 'bg-transparent text-gg-gray-400 border-gg-gray-600'
const BASE           = 'px-2.5 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

// Status badge classes mirroring existing admin badge patterns.
const AUTO_BADGE_CLS: Record<string, string> = {
  auction: 'bg-blue-500/15 text-blue-400 border border-blue-500/40',
  listed:  'bg-gg-gray-700 text-gg-gray-300 border border-gg-gray-600',
  live:    'bg-blue-500/15 text-blue-400 border border-blue-500/40',
  pending: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/40',
}
const AUTO_BADGE_DEFAULT = 'bg-gg-gray-700 text-gg-gray-300 border border-gg-gray-600'

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
      <div className="text-[10px] text-gg-gray-500 mb-1 uppercase tracking-wide">Sale Status</div>
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
            {cur.replace('_', ' ')} <span className="ml-1 opacity-60">(auto)</span>
          </span>
        )}
      </div>
    </div>
  )
}
