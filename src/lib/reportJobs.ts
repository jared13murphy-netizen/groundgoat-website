// Report queue client (backend audit #3). The backend moved PDF building
// off the web workers onto a dedicated report-worker fleet: POST creates a
// job, we poll its status, and for downloads we fetch the bytes exactly
// once (the backend deletes the row on fetch — it's a hand-off, not an
// archive).
//
// This helper deliberately RETURNS A Response so every existing call site
// keeps its blob()/Content-Disposition/res.ok handling unchanged — swapping
// a direct `fetchWithAuth(POST /report/pdf)` call for `reportJobFetch(...)`
// is a one-line change. Email delivery resolves to a synthetic JSON
// Response shaped like the old endpoints' {success, message} payload.
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

const POLL_MS = 2000
const TIMEOUT_MS = 180_000

export type ReportJobType = 'comparables' | 'tract' | 'parcel' | 'parcel_by_point'
export type ReportDelivery = 'download' | 'email'

function syntheticError(detail: string, status = 500): Response {
  return new Response(JSON.stringify({ detail }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export default async function reportJobFetch(
  jobType: ReportJobType,
  delivery: ReportDelivery,
  params: Record<string, unknown>,
): Promise<Response> {
  const createRes = await fetchWithAuth(`${API_URL}/api/reports/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_type: jobType, delivery, params }),
  })
  if (!createRes.ok) return createRes // caller's existing !res.ok path shows its own message

  const { job_id } = await createRes.json()
  const deadline = Date.now() + TIMEOUT_MS

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    let status: { status: string; error?: string | null; filename?: string | null; message?: string | null }
    try {
      const pollRes = await fetchWithAuth(`${API_URL}/api/reports/jobs/${job_id}`)
      if (!pollRes.ok) continue // transient poll failure — keep waiting until the deadline
      status = await pollRes.json()
    } catch {
      continue
    }
    if (status.status === 'error') {
      return syntheticError(status.error || 'Report build failed')
    }
    if (status.status === 'done') {
      if (delivery === 'download') {
        return fetchWithAuth(`${API_URL}/api/reports/jobs/${job_id}/download`)
      }
      return new Response(
        // Server's message is personalized ("Parcel report sent to <email>")
        // — pass it through, same wording the sync endpoints returned.
        JSON.stringify({ success: true, message: status.message || 'Report sent to your email' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
  }
  return syntheticError('Report timed out — please try again', 504)
}
