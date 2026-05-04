/**
 * Single source of truth for listing/tract status badges across the
 * portal. Colors mirror the map pin palette in ExploreMap (PIN_COLORS)
 * so a "Sold" badge in the list visually matches the pink dot on the
 * map, an "Auction" badge matches the blue dot, etc.
 *
 * Usage:
 *   const { label, className } = getStatusBadge(listing.status, listing.listing_type)
 *   <span className={className}>{label}</span>
 */

export type StatusBadge = {
  label: string
  /** Tailwind classes for solid-fill badges. Omit padding/rounding —
      the consuming component supplies layout/sizing classes. */
  className: string
}

export function getStatusBadge(
  status: string | null | undefined,
  listingType?: string | null,
): StatusBadge {
  const s = (status || '').toLowerCase()
  const lt = (listingType || '').toLowerCase()

  // live > sold > pending > no_sale > auction (upcoming) > listed (PT)
  if (s === 'live') {
    return { label: 'Live Now', className: 'bg-[#22c55e] text-white animate-pulse' }
  }
  if (s === 'sold') {
    return { label: 'Sold', className: 'bg-[#f58cde] text-white' }
  }
  if (s === 'pending') {
    return { label: 'Pending', className: 'bg-[#eab308] text-white' }
  }
  if (s === 'no_sale') {
    return { label: 'No Sale', className: 'bg-[#9ca3af] text-white' }
  }
  // status is 'listed' (or null/unknown). Distinguish auction vs PT.
  if (lt === 'auction') {
    return { label: 'Auction', className: 'bg-[#2563eb] text-white' }
  }
  if (lt === 'private_treaty' || lt === 'private treaty') {
    return { label: 'Private Treaty', className: 'bg-[#eab308] text-white' }
  }
  // Fallback when listing_type isn't known — treat as upcoming.
  return { label: 'Upcoming', className: 'bg-[#2563eb] text-white' }
}
