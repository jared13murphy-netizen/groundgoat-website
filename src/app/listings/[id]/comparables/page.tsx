import { redirect } from 'next/navigation'

// This page is retired — it used to render the orphaned ComparablesMap.
// The REAL comp map lives on /access (comp mode via handleFindComparables).
// Redirect any existing/bookmarked links there, carrying the tract id
// forward via ?comparablesTractId= so comp mode opens automatically (see
// the deep-link effect in src/app/access/page.tsx). handleFindComparables
// fetches the subject tract's own county/state from the backend, so no
// county/state params are needed here for comp mode to open correctly.
// Server-side redirect (not client-side) so it fires immediately on
// request, before any client JS needs to load or hydrate.
export default function ComparablesPageRedirect({
  searchParams,
}: {
  searchParams: { tractId?: string }
}) {
  const tractId = searchParams?.tractId
  redirect(tractId ? `/access?comparablesTractId=${tractId}` : '/access')
}
