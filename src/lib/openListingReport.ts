import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://practical-serenity-production.up.railway.app'

/**
 * Fetch the branded listing report PDF (auth-protected, so a plain
 * window.open won't carry the bearer token) and open it in a new tab.
 *
 * Used after a listing is verified on any of the 3 staging screens, and by
 * the "Report" / "Download report" buttons on listing rows.
 *
 * @param listingId  the listing UUID
 * @param opts.force regenerate the cached PDF (after data edits)
 * @returns true if the PDF was fetched + opened, false otherwise
 */
export async function openListingReport(
  listingId: string,
  opts: { force?: boolean } = {}
): Promise<boolean> {
  if (!listingId) return false
  try {
    const url = `${API_URL}/api/admin/listings/${listingId}/report.pdf${
      opts.force ? '?force=1' : ''
    }`
    const res = await fetchWithAuth(url)
    if (!res.ok) return false
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const win = window.open(objectUrl, '_blank')
    if (!win) {
      // Popup blocked — fall back to a same-tab navigation.
      window.location.href = objectUrl
    }
    // Revoke after a delay so the new tab has time to load it.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    return true
  } catch {
    return false
  }
}

export default openListingReport
