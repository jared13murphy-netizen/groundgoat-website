'use client'

// The "we're building your report" indicator.
//
// Owner, 2026-08-31: "we need something on screen that tells the user it's
// building while allowing them to continue navigating and browsing to
// other pages/screens."
//
// It lives in the ROOT LAYOUT, above the pages, so navigating does not
// unmount it and does not abandon the report. The backend is the source of
// truth — GET /api/reports/jobs returns whatever this user is waiting on —
// so it also survives a reload, a second tab, and closing the laptop.
//
// POLLING IS DELIBERATELY LAZY. It checks once on mount, then every few
// seconds ONLY while something is actually building, and stops completely
// when nothing is. Starting a report wakes it immediately. A signed-in
// user who never generates a report costs one request per page load, and
// the query behind it is a single index scan over that user's own rows —
// its cost does not move with how many reports everyone else has queued.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, FileText, Download, X, AlertCircle, Mail } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { onReportJobStarted } from '@/lib/reportJobStore'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const POLL_MS = 3000

type Job = {
  job_id: string
  job_type: string
  delivery: 'download' | 'email'
  status: 'queued' | 'running' | 'done' | 'error'
  filename: string | null
  error: string | null
}

const LABEL: Record<string, string> = {
  comparables: 'Comparables report',
  tract: 'Tract report',
  parcel: 'Parcel report',
}

export default function ReportJobsIndicator() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopped = useRef(false)

  const poll = useCallback(async () => {
    if (stopped.current) return
    // No token means nobody is signed in — do not poll at all.
    if (typeof window === 'undefined' || !localStorage.getItem('auth_token')) return
    try {
      const res = await fetchWithAuth(`${API_URL}/api/reports/jobs`)
      if (!res.ok) return
      const body = await res.json()
      const next: Job[] = body.jobs || []
      setJobs(next)
      const live = next.some((j) => j.status === 'queued' || j.status === 'running')
      if (live && !stopped.current) {
        timer.current = setTimeout(poll, POLL_MS)
      }
    } catch {
      /* a blip between polls is not worth surfacing */
    }
  }, [])

  useEffect(() => {
    stopped.current = false
    poll()
    // Starting a report wakes the poller straight away rather than waiting
    // for a tick that may not be scheduled.
    const off = onReportJobStarted(() => {
      if (timer.current) clearTimeout(timer.current)
      poll()
    })
    return () => {
      stopped.current = true
      off()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [poll])

  const download = async (job: Job) => {
    setDownloading(job.job_id)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/reports/jobs/${job.job_id}/download`)
      if (!res.ok) {
        // 410 means someone already took it — the queue is a hand-off, not
        // an archive, so say that rather than failing silently.
        const body = await res.json().catch(() => null)
        alert(body?.detail || 'That report could not be downloaded. Build it again.')
        return
      }
      const blob = await res.blob()
      const dispo = res.headers.get('Content-Disposition') || ''
      const match = dispo.match(/filename="?([^";]+)"?/i)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = match?.[1] || job.filename || 'ground-goat-report.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setDismissed((d) => new Set(d).add(job.job_id))
    } catch {
      alert('That report could not be downloaded. Build it again.')
    } finally {
      setDownloading(null)
      poll()
    }
  }

  const visible = jobs.filter((j) => !dismissed.has(j.job_id))
  if (visible.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2">
      {visible.map((job) => {
        const building = job.status === 'queued' || job.status === 'running'
        const name = LABEL[job.job_type] || 'Report'
        return (
          <div key={job.job_id}
            className="flex items-start gap-3 rounded-xl border border-gg-gray-700 bg-gg-gray-800 p-3 shadow-2xl">
            <div className="mt-0.5 shrink-0">
              {building ? <Loader2 size={18} className="animate-spin text-gg-pink" />
                : job.status === 'error' ? <AlertCircle size={18} className="text-red-400" />
                : job.delivery === 'email' ? <Mail size={18} className="text-gg-pink" />
                : <FileText size={18} className="text-gg-pink" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white">{name}</p>
              <p className="mt-0.5 text-xs text-gg-gray-400">
                {building
                  ? 'Building — you can keep browsing, this finishes on its own.'
                  : job.status === 'error'
                    ? (job.error || 'That report did not finish.')
                    : job.delivery === 'email'
                      ? 'Sent to your email.'
                      : 'Ready to download.'}
              </p>
              {job.status === 'done' && job.delivery === 'download' && (
                <button
                  onClick={() => download(job)}
                  disabled={downloading === job.job_id}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-gg-pink px-3 py-1.5
                             text-xs font-medium text-black transition-colors hover:bg-gg-pink-dark
                             disabled:opacity-50"
                >
                  {downloading === job.job_id
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Download size={13} />}
                  {downloading === job.job_id ? 'Downloading…' : 'Download'}
                </button>
              )}
            </div>
            {!building && (
              <button
                onClick={() => setDismissed((d) => new Set(d).add(job.job_id))}
                aria-label="Dismiss"
                className="shrink-0 text-gg-gray-500 transition-colors hover:text-white"
              >
                <X size={15} />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
