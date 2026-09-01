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
//
// Owner, 2026-09-01: "we're starting to over-use our pink color" — this
// component no longer uses gg-pink anywhere. Building = soft blue,
// success = emerald/green, error stays red.
//
// RESOLVE-AND-EXIT (owner, 2026-09-01, animation spec refined same day):
// a finished DOWNLOAD job auto-triggers the browser download exactly once,
// then plays a ring→checkmark completion before collapsing out. A finished
// EMAIL job holds its "Sent to your email" state, then collapses to just
// its icon and flies off. Both are pure CSS transforms/keyframes (see
// globals.css) driven by a per-job phase state machine here; both honor
// prefers-reduced-motion by skipping straight to a plain instant swap +
// hold + removal. Errors stay exactly as before: persistent, red, dismissed
// only by hand.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, FileText, Download, X, AlertCircle, Mail } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { onReportJobStarted } from '@/lib/reportJobStore'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const POLL_MS = 3000

// Timing (ms) for the non-reduced-motion sequences. Kept as named constants
// so the JS hold/collapse durations stay in lockstep with the CSS keyframe
// durations in globals.css instead of two copies of "250" drifting apart.
const DOWNLOAD_CHECK_HOLD_MS = 300 + 800 // ring+check draw, then hold before collapsing
const DOWNLOAD_COLLAPSE_MS = 250
const EMAIL_SENT_HOLD_MS = 4000
const EMAIL_COLLAPSE_MS = 200
const EMAIL_FLYOFF_MS = 450
const REDUCED_MOTION_HOLD_MS = 2000

type Job = {
  job_id: string
  job_type: string
  delivery: 'download' | 'email'
  status: 'queued' | 'running' | 'done' | 'error'
  filename: string | null
  error: string | null
}

// Local, client-only phase layered on top of the server's status — the
// server only knows queued/running/done/error; everything past "done" is
// this component choreographing its own exit.
type Phase =
  | 'download-fallback' // auto-download failed — manual button stays up
  | 'download-success'  // ring completing + checkmark drawing + hold
  | 'download-exit'     // collapsing out
  | 'email-hold'         // "Sent to your email", holding
  | 'email-collapse'     // content collapsing to icon-only
  | 'email-flyoff'       // icon flying off

const LABEL: Record<string, string> = {
  comparables: 'Comparables report',
  tract: 'Tract report',
  parcel: 'Parcel report',
}

// Owner, 2026-09-01 (second pass, after seeing the old chip live): it has
// to read as a floating layer over the map, not disappear into it — an
// elevated surface, a border tinted by what's happening, and a soft glow
// in the same color. One state color per job: sky while building, emerald
// once done (covers every non-error post-"done" phase, including the
// download-fallback state — the report DID finish, only the browser-side
// auto-download hiccuped), red on error.
type StateColor = 'sky' | 'emerald' | 'red'
const STATE_STYLE: Record<StateColor, { border: string; glow: string }> = {
  sky: {
    border: 'border-sky-400/45',
    glow: 'shadow-[0_20px_40px_-16px_rgba(0,0,0,0.6),0_0_16px_-2px_rgba(56,189,248,0.35)]',
  },
  emerald: {
    border: 'border-emerald-400/60',
    glow: 'shadow-[0_20px_40px_-16px_rgba(0,0,0,0.6),0_0_16px_-2px_rgba(52,211,153,0.4)]',
  },
  red: {
    border: 'border-red-400/60',
    glow: 'shadow-[0_20px_40px_-16px_rgba(0,0,0,0.6),0_0_16px_-2px_rgba(248,113,113,0.4)]',
  },
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

// Ring + self-drawing checkmark. pathLength=1 normalizes the checkmark
// path's length to exactly 1 regardless of its real geometry, so the draw
// animation can express itself as a simple 0→1 stroke-dashoffset in CSS
// (see .gg-report-check-draw in globals.css) instead of a magic pixel
// number tied to this exact path.
function SuccessCheck({ animate }: { animate: boolean }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" className={animate ? 'gg-report-ring-in' : ''}>
      <circle cx={12} cy={12} r={10} stroke="currentColor" strokeWidth={2} className="text-emerald-400" />
      <path
        d="M7 12.5l3 3 7-7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        className={`text-emerald-400 ${animate ? 'gg-report-check-draw' : ''}`}
      />
    </svg>
  )
}

export default function ReportJobsIndicator() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [downloading, setDownloading] = useState<string | null>(null)
  const [phase, setPhase] = useState<Record<string, Phase>>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopped = useRef(false)

  // Guards so the completion sequence (and the auto-download inside it)
  // only ever starts once per job, no matter how many more polls return
  // that same "done" job while the exit animation is still playing.
  const startedRef = useRef<Set<string>>(new Set())
  const autoDownloadedRef = useRef<Set<string>>(new Set())
  const exitTimers = useRef<Record<string, ReturnType<typeof setTimeout>[]>>({})

  const clearJobTimers = (jobId: string) => {
    ;(exitTimers.current[jobId] || []).forEach(clearTimeout)
    delete exitTimers.current[jobId]
  }
  const scheduleJobTimer = (jobId: string, fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms)
    exitTimers.current[jobId] = [...(exitTimers.current[jobId] || []), t]
  }

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
      Object.keys(exitTimers.current).forEach(clearJobTimers)
    }
  }, [poll])

  // Downloads the finished PDF exactly once. Returns whether it worked —
  // callers decide what to do with a failure (fall back to the manual
  // button rather than pretend it succeeded).
  const autoDownload = async (job: Job): Promise<boolean> => {
    if (autoDownloadedRef.current.has(job.job_id)) return true
    try {
      const res = await fetchWithAuth(`${API_URL}/api/reports/jobs/${job.job_id}/download`)
      if (!res.ok) return false
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
      autoDownloadedRef.current.add(job.job_id)
      return true
    } catch {
      return false
    }
  }

  const finishExit = (jobId: string) => {
    clearJobTimers(jobId)
    setDismissed((d) => new Set(d).add(jobId))
  }

  // Kicks off a job's whole completion choreography exactly once. Guarded
  // by startedRef in the effect below, not in here.
  const beginCompletion = useCallback(async (job: Job) => {
    const reduced = prefersReducedMotion()

    if (job.delivery === 'download') {
      const ok = await autoDownload(job)
      if (!ok) {
        setPhase((p) => ({ ...p, [job.job_id]: 'download-fallback' }))
        return
      }
      setPhase((p) => ({ ...p, [job.job_id]: 'download-success' }))
      if (reduced) {
        scheduleJobTimer(job.job_id, () => finishExit(job.job_id), REDUCED_MOTION_HOLD_MS)
        return
      }
      scheduleJobTimer(job.job_id, () => {
        setPhase((p) => ({ ...p, [job.job_id]: 'download-exit' }))
        scheduleJobTimer(job.job_id, () => finishExit(job.job_id), DOWNLOAD_COLLAPSE_MS)
      }, DOWNLOAD_CHECK_HOLD_MS)
      return
    }

    // Email
    setPhase((p) => ({ ...p, [job.job_id]: 'email-hold' }))
    if (reduced) {
      scheduleJobTimer(job.job_id, () => finishExit(job.job_id), REDUCED_MOTION_HOLD_MS)
      return
    }
    scheduleJobTimer(job.job_id, () => {
      setPhase((p) => ({ ...p, [job.job_id]: 'email-collapse' }))
      scheduleJobTimer(job.job_id, () => {
        setPhase((p) => ({ ...p, [job.job_id]: 'email-flyoff' }))
        scheduleJobTimer(job.job_id, () => finishExit(job.job_id), EMAIL_FLYOFF_MS)
      }, EMAIL_COLLAPSE_MS)
    }, EMAIL_SENT_HOLD_MS)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    jobs.forEach((job) => {
      if (job.status === 'done' && !startedRef.current.has(job.job_id)) {
        startedRef.current.add(job.job_id)
        beginCompletion(job)
      }
    })
  }, [jobs, beginCompletion])

  const manualDismiss = (jobId: string) => {
    clearJobTimers(jobId)
    setDismissed((d) => new Set(d).add(jobId))
  }

  // Fallback path only — the primary path is the automatic download inside
  // beginCompletion above. This stays essentially the old synchronous
  // "click to download" behavior for when the auto-attempt failed.
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
      manualDismiss(job.job_id)
    } catch {
      alert('That report could not be downloaded. Build it again.')
    } finally {
      setDownloading(null)
    }
  }

  const visible = jobs.filter((j) => !dismissed.has(j.job_id))
  if (visible.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {visible.map((job) => {
        const building = job.status === 'queued' || job.status === 'running'
        const isError = job.status === 'error'
        const p = phase[job.job_id]
        const name = LABEL[job.job_type] || 'Report'
        const reduced = prefersReducedMotion()
        const stateColor: StateColor = isError ? 'red' : building ? 'sky' : 'emerald'
        const style = STATE_STYLE[stateColor]

        const isSuccess = p === 'download-success' || p === 'download-exit'
        const isEmailDone = p === 'email-hold' || p === 'email-collapse' || p === 'email-flyoff'
        const exitingHard = p === 'download-exit' || p === 'email-flyoff' // clicks must pass through under these

        let icon: React.ReactNode
        if (building) icon = <Loader2 size={18} className="animate-spin text-sky-400" />
        else if (isError) icon = <AlertCircle size={18} className="text-red-400" />
        else if (isSuccess) icon = <SuccessCheck animate={!reduced && p === 'download-success'} />
        else if (isEmailDone) icon = <Mail size={18} className="text-emerald-400" />
        else if (job.delivery === 'email') icon = <Mail size={18} className="text-sky-400" />
        else icon = <FileText size={18} className="text-sky-400" />

        let subtitle: string
        if (building) subtitle = 'Building — you can keep browsing, this finishes on its own.'
        else if (isError) subtitle = job.error || 'That report did not finish.'
        else if (p === 'download-success' || p === 'download-exit') subtitle = 'Report downloaded'
        else if (isEmailDone) subtitle = 'Sent to your email'
        else if (p === 'download-fallback') subtitle = 'Ready to download.'
        else subtitle = job.delivery === 'email' ? 'Sent to your email.' : 'Ready to download.'

        return (
          <div
            key={job.job_id}
            className={`flex items-start gap-3 rounded-xl border ${style.border} bg-[#1e2430]/90 backdrop-blur-md p-3 ${style.glow}
              w-fit max-w-[min(22rem,calc(100vw-2rem))]
              ${p === 'download-exit' ? 'gg-report-exit-collapse' : ''}
              ${exitingHard ? 'pointer-events-none' : ''}`}
          >
            <div className={`mt-0.5 shrink-0 relative ${p === 'email-flyoff' ? 'gg-report-flyoff' : ''}`}>
              {p === 'email-flyoff' && (
                <Mail size={18} className="absolute inset-0 text-emerald-400 gg-report-flyoff-trail" aria-hidden="true" />
              )}
              {icon}
            </div>
            <div
              className={`min-w-0 gg-report-content ${
                p === 'email-collapse' || p === 'email-flyoff' ? 'gg-report-content-collapsed' : ''
              }`}
            >
              <p className="text-sm font-medium text-white">{name}</p>
              <p className="mt-0.5 text-xs text-gg-gray-400">{subtitle}</p>
              {p === 'download-fallback' && (
                <button
                  onClick={() => download(job)}
                  disabled={downloading === job.job_id}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5
                             text-xs font-medium text-white transition-colors hover:bg-sky-400
                             disabled:opacity-50"
                >
                  {downloading === job.job_id
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Download size={13} />}
                  {downloading === job.job_id ? 'Downloading…' : 'Download'}
                </button>
              )}
            </div>
            {!building && !exitingHard && (
              <button
                onClick={() => manualDismiss(job.job_id)}
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
