// Report queue client. The backend moved PDF building off the web workers
// onto a dedicated report-worker fleet: POST creates a job and hands back
// its id — building happens in the background from there.
//
// FIRE-AND-FORGET BY DESIGN (owner, 2026-09-01: never trap the user on a
// "Building..." button). This resolves as soon as the job is CREATED, not
// when it finishes. Callers get back the raw create Response so their
// existing res.ok / res.json() / res.text() error handling keeps working
// unchanged — creation-time failures (403 not entitled, 429 too many in
// flight, 400 no email on file, etc.) still surface right here. On success
// there is nothing left to await: ReportJobsIndicator (mounted in the root
// layout) owns the rest of the job's lifecycle — polling, the auto-download
// hand-off, and the "sent"/"downloaded" confirmation.
import fetchWithAuth from '@/lib/fetchWithAuth'
import { reportJobStarted } from '@/lib/reportJobStore'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export type ReportJobType = 'comparables' | 'tract' | 'parcel' | 'parcel_by_point'
export type ReportDelivery = 'download' | 'email'

export default async function reportJobEnqueue(
  jobType: ReportJobType,
  delivery: ReportDelivery,
  params: Record<string, unknown>,
): Promise<Response> {
  const createRes = await fetchWithAuth(`${API_URL}/api/reports/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_type: jobType, delivery, params }),
  })
  if (createRes.ok) {
    // Wake the on-screen indicator immediately rather than leaving it to
    // its next lazy poll tick — it takes it from here.
    reportJobStarted()
  }
  return createRes // caller's existing !res.ok path shows its own message
}
