// Comp-report totals and averages come from the SERVER (owner 11/20): the
// selected rows go to POST /api/comparables/summary — the same body as the
// report PDF request, the same resolvers and the same comps_summary.summarize
// the PDF and Excel use — and the response's `summary.display` strings are
// printed verbatim by CompSummaryGrid. Debounced on every row change. While
// loading, or if the call fails, display is null → every tile reads "—"; the
// client NEVER sums the rows itself.
import { useEffect, useRef, useState } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const DEBOUNCE_MS = 400

export interface ServerCompSummary {
  /** summary.display — ready-to-print strings (count, total_acres, total_tillable,
   *  pct_tillable, total_sale, avg_ppa, avg_ppta, avg_ppsr, avg_acres, avg_till, soil_rating) */
  display: Record<string, string> | null
  /** rows that contributed a rating, and rows in total (for "n of N rated") */
  ratedCount: number | null
  count: number | null
  loading: boolean
}

const EMPTY: ServerCompSummary = { display: null, ratedCount: null, count: null, loading: false }

export default function useServerCompTotals(buildBody: () => Record<string, unknown>, rowCount: number): ServerCompSummary {
  const [state, setState] = useState<ServerCompSummary>(EMPTY)
  const bodyRef = useRef(buildBody)
  bodyRef.current = buildBody
  // The rows (figures included) are the request; re-ask whenever they change.
  const body = rowCount > 0 ? bodyRef.current() : null
  const key = body ? JSON.stringify(body) : ''

  useEffect(() => {
    if (!key) { setState(EMPTY); return }
    let cancelled = false
    setState(s => ({ ...s, display: null, loading: true }))
    const timer = setTimeout(async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/comparables/summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: key,
        })
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.json()
        const s = data?.summary
        if (cancelled) return
        setState({
          display: s?.display && typeof s.display === 'object' ? s.display : null,
          ratedCount: typeof s?.rated_count === 'number' ? s.rated_count : null,
          count: typeof s?.count === 'number' ? s.count : null,
          loading: false,
        })
      } catch {
        if (!cancelled) setState(EMPTY)
      }
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [key])

  return state
}
