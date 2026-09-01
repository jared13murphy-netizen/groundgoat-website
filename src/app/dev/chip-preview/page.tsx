'use client'

// LOCAL-ONLY preview harness for ReportJobsIndicator — never committed.
// Mocks fetch for the report-jobs endpoints so the REAL component renders
// its real states and animations without a signed-in session.

import { useEffect, useState } from 'react'
import { reportJobStarted } from '@/lib/reportJobStore'

type MockJob = {
  job_id: string
  job_type: string
  delivery: 'download' | 'email'
  status: 'queued' | 'running' | 'done' | 'error'
  filename: string | null
  error: string | null
}

let MOCK_JOBS: MockJob[] = []

export default function ChipPreview() {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    localStorage.setItem('auth_token', 'preview-dummy-token')
    const realFetch = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/api/reports/jobs') && url.includes('/download')) {
        const pdf = new Blob(['%PDF-1.4 preview'], { type: 'application/pdf' })
        return new Response(pdf, {
          status: 200,
          headers: { 'Content-Disposition': 'attachment; filename="preview-report.pdf"' },
        })
      }
      if (url.includes('/api/reports/jobs')) {
        return new Response(JSON.stringify({ jobs: MOCK_JOBS }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }
      return realFetch(input, init)
    }
    setArmed(true)
    return () => { window.fetch = realFetch }
  }, [])

  const run = (delivery: 'download' | 'email', fail = false) => {
    const id = `${delivery}-${Date.now()}`
    MOCK_JOBS = [...MOCK_JOBS, {
      job_id: id, job_type: 'comparables', delivery,
      status: 'queued', filename: null, error: null,
    }]
    reportJobStarted()
    setTimeout(() => {
      MOCK_JOBS = MOCK_JOBS.map(j => j.job_id === id ? { ...j, status: 'running' } : j)
    }, 2500)
    setTimeout(() => {
      MOCK_JOBS = MOCK_JOBS.map(j => j.job_id === id
        ? (fail
            ? { ...j, status: 'error', error: 'That report did not finish. Try again.' }
            : { ...j, status: 'done', filename: 'ground-goat-comp-report-preview.pdf' })
        : j)
    }, 7000)
  }

  if (!armed) return null
  return (
    <div className="min-h-screen bg-gg-gray-900 p-10 text-white">
      <h1 className="text-xl font-semibold">Report chip preview (local only)</h1>
      <p className="mt-1 text-sm text-gg-gray-400">
        Each button queues a fake job: ~2.5s queued, done at ~7s.
      </p>
      <div className="mt-6 flex gap-3">
        <button onClick={() => run('download')} className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-black">
          Simulate download report
        </button>
        <button onClick={() => run('email')} className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-black">
          Simulate email report
        </button>
        <button onClick={() => run('email', true)} className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-black">
          Simulate failure
        </button>
      </div>
      {/* The root layout already mounts the real ReportJobsIndicator. */}
    </div>
  )
}
