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

  // Tokens chosen so the hex matches PIN_COLORS in ExploreMap exactly:
  //   gg-pink    = #f58cde (sold)
  //   blue-600   = #2563eb (auction)
  //   yellow-500 = #eab308 (pending / private-treaty listed)
  //   green-500  = #22c55e (live)
  //   gray-400   = #9ca3af (no_sale)
  // Using named tokens (not arbitrary hex) so Tailwind always compiles
  // them even from files outside the JIT content scan.
  if (s === 'live') {
    return { label: 'Live Now', className: 'bg-green-500 text-white animate-pulse' }
  }
  if (s === 'sold') {
    return { label: 'Sold', className: 'bg-gg-pink text-white' }
  }
  if (s === 'pending') {
    return { label: 'Pending', className: 'bg-yellow-500 text-white' }
  }
  if (s === 'no_sale') {
    return { label: 'No Sale', className: 'bg-gray-400 text-white' }
  }
  // status is 'listed' (or null/unknown). Distinguish auction vs PT.
  if (lt === 'auction') {
    return { label: 'Auction', className: 'bg-blue-600 text-white' }
  }
  if (lt === 'private_treaty' || lt === 'private treaty') {
    return { label: 'Private Treaty', className: 'bg-yellow-500 text-white' }
  }
  // Fallback when listing_type isn't known — treat as upcoming.
  return { label: 'Upcoming', className: 'bg-blue-600 text-white' }
}
