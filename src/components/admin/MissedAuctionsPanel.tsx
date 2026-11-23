'use client'

/**
 * MissedAuctionsPanel — the "Missed" tab on the admin auction staging screen.
 *
 * Shows staff what the nightly scraper missed and what the nightly AI check
 * did about it. Sections, in order: Needs a person, Waiting for tonight's AI
 * check, Rejected by AI as not real estate, Duplicates the AI caught, Handled
 * (closed until opened). Empty sections are hidden.
 *
 * The page owns the data through useMissedAuctions() so the count on the tab
 * is known before the tab is opened. All backend calls live in
 * @/lib/scraperMisses; a missing endpoint shows a quiet message, never an error.
 */

import { useCallback, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import {
  type Miss,
  type MissedData,
  HANDLED_LABELS,
  groupMisses,
  loadMissed,
  needsPersonCount,
  nightsFailedText,
  reasonLabel,
  restoreRejection,
  safeHref,
  setMissStatus,
  shortDate,
  summaryLine,
  withMissResolved,
  withRejectionRestored,
} from '@/lib/scraperMisses'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// House style: solid fills only. Primary = pink with black text, secondary = gray with black text.
const BTN_BASE = 'px-3 py-1.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0'
const BTN_PRIMARY = `${BTN_BASE} bg-[#F58CDE] text-black`
const BTN_SECONDARY = `${BTN_BASE} bg-[#E4E4E7] text-black`

export interface MissedAuctionsState {
  data: MissedData
  loading: boolean
  loaded: boolean
  needsPerson: number
  reload: () => Promise<void>
  setData: (updater: (prev: MissedData) => MissedData) => void
}

export function useMissedAuctions(): MissedAuctionsState {
  const [data, setDataState] = useState<MissedData>({ misses: null, rejections: null })
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setDataState(await loadMissed(fetchWithAuth, API_URL))
    } finally {
      setLoading(false)
      setLoaded(true)
    }
  }, [])

  const setData = useCallback((updater: (prev: MissedData) => MissedData) => setDataState(updater), [])

  return { data, loading, loaded, needsPerson: needsPersonCount(data.misses), reload, setData }
}

function PageLink({ url }: { url: string | null | undefined }) {
  const href = safeHref(url)
  if (!href) return url ? <span className="text-sm text-gg-gray-400 break-all">{url}</span> : null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-gg-gray-400 underline hover:text-gg-pink break-all"
    >
      <span>{href}</span>
      <ExternalLink size={12} className="shrink-0" />
    </a>
  )
}

function Section({
  title,
  count,
  prominent,
  action,
  children,
}: {
  title: string
  count: number
  prominent?: boolean
  action?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <section
      className={`mb-6 bg-gg-gray-900 rounded-xl border ${prominent ? 'border-gg-pink' : 'border-gg-gray-800'}`}
      aria-label={title}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <h2 className={`font-bold text-white ${prominent ? 'text-xl' : 'text-base'}`}>{title}</h2>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-bold ${
            prominent ? 'bg-[#F58CDE] text-black' : 'bg-[#E4E4E7] text-black'
          }`}
        >
          {count}
        </span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}

function MissRow({
  miss,
  busy,
  onDone,
  statusLabel,
}: {
  miss: Miss
  busy?: boolean
  onDone?: () => void
  statusLabel?: string
}) {
  return (
    <div className="px-4 py-3 flex items-start gap-4 border-t border-gg-gray-800" data-testid={`miss-${miss.id}`}>
      <div className="min-w-0 flex-1">
        <div className="text-white font-semibold">{miss.company_name || 'Unknown company'}</div>
        <PageLink url={miss.url} />
        <div className="mt-1 text-sm text-gg-gray-300">
          {reasonLabel(miss.reason)}
          <span className="text-gg-gray-500"> · </span>
          {nightsFailedText(miss.nights_failed)}
          {statusLabel && (
            <>
              <span className="text-gg-gray-500"> · </span>
              {statusLabel}
            </>
          )}
        </div>
        {miss.ai_note && (
          <div className="mt-1 text-sm text-gg-gray-400">
            <span className="text-gg-gray-300">AI note:</span> {miss.ai_note}
          </div>
        )}
      </div>
      {onDone && (
        <button type="button" onClick={onDone} disabled={busy} className={BTN_PRIMARY}>
          {busy ? 'Saving...' : 'Done'}
        </button>
      )}
    </div>
  )
}

export default function MissedAuctionsPanel({ state }: { state: MissedAuctionsState }) {
  const { data, loading, loaded, setData } = state
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoredNote, setRestoredNote] = useState(false)
  const [handledOpen, setHandledOpen] = useState(false)

  const markDone = async (id: number) => {
    setBusy(`miss-${id}`)
    setError(null)
    const ok = await setMissStatus(fetchWithAuth, API_URL, id, 'resolved')
    setBusy(null)
    if (ok) setData((prev) => withMissResolved(prev, id))
    else setError('Could not save. Please try again.')
  }

  const restore = async (id: number) => {
    setBusy(`rej-${id}`)
    setError(null)
    const ok = await restoreRejection(fetchWithAuth, API_URL, id)
    setBusy(null)
    if (ok) {
      setData((prev) => withRejectionRestored(prev, id))
      setRestoredNote(true)
    } else {
      setError('Could not restore. Please try again.')
    }
  }

  if (!loaded || (loading && !data.misses && !data.rejections)) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  if (!data.misses && !data.rejections) {
    return (
      <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl text-center py-12 px-4">
        <p className="text-gg-gray-400">Nothing to show yet.</p>
      </div>
    )
  }

  const groups = groupMisses(data.misses?.misses)
  const rejections = data.rejections?.rejections || []
  const duplicates = data.rejections?.duplicates_caught || []
  const nothing =
    groups.needsPerson.length + groups.waiting.length + groups.handled.length + rejections.length + duplicates.length === 0

  return (
    <div>
      <p className="mb-6 text-sm text-gg-gray-300">{summaryLine(data.misses)}</p>

      {error && (
        <div className="mb-4 rounded-lg px-4 py-3 text-sm bg-red-500/10 border border-red-500/30 text-red-300" role="alert">
          {error}
        </div>
      )}

      {nothing && !restoredNote && (
        <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-xl text-center py-12 px-4">
          <p className="text-gg-gray-400">Nothing was missed.</p>
        </div>
      )}

      {groups.needsPerson.length > 0 && (
        <Section title="Needs a person" count={groups.needsPerson.length} prominent>
          {groups.needsPerson.map((m) => (
            <MissRow key={m.id} miss={m} busy={busy === `miss-${m.id}`} onDone={() => markDone(m.id)} />
          ))}
        </Section>
      )}

      {groups.waiting.length > 0 && (
        <Section title="Waiting for tonight's AI check" count={groups.waiting.length}>
          {groups.waiting.map((m) => (
            <MissRow key={m.id} miss={m} busy={busy === `miss-${m.id}`} onDone={() => markDone(m.id)} />
          ))}
        </Section>
      )}

      {restoredNote && (
        <p className="mb-3 text-sm text-gg-gray-300">It will be picked up again on the next nightly run.</p>
      )}

      {rejections.length > 0 && (
        <Section title="Rejected by AI as not real estate" count={rejections.length}>
          {rejections.map((r) => (
            <div key={r.id} className="px-4 py-3 flex items-start gap-4 border-t border-gg-gray-800" data-testid={`rejection-${r.id}`}>
              <div className="min-w-0 flex-1">
                <div className="text-white font-semibold">{r.company_name || 'Unknown company'}</div>
                {r.title && <div className="text-sm text-gg-gray-300">{r.title}</div>}
                <PageLink url={r.source_url} />
                <div className="mt-1 text-sm text-gg-gray-300">
                  What was sold: {r.what_was_sold || 'Not stated'}
                  {shortDate(r.rejected_at) && (
                    <>
                      <span className="text-gg-gray-500"> · </span>
                      {shortDate(r.rejected_at)}
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => restore(r.id)}
                disabled={busy === `rej-${r.id}`}
                className={BTN_SECONDARY}
              >
                {busy === `rej-${r.id}` ? 'Restoring...' : 'Restore'}
              </button>
            </div>
          ))}
        </Section>
      )}

      {duplicates.length > 0 && (
        <Section title="Duplicates the AI caught" count={duplicates.length}>
          {duplicates.map((d, i) => (
            <div key={`${d.source_url}-${d.created_at}-${i}`} className="px-4 py-3 border-t border-gg-gray-800">
              <PageLink url={d.source_url} />
              <div className="mt-1 text-sm text-gg-gray-300">
                {d.detail || d.reason || 'Duplicate of an auction we already have'}
                {shortDate(d.created_at) && (
                  <>
                    <span className="text-gg-gray-500"> · </span>
                    {shortDate(d.created_at)}
                  </>
                )}
              </div>
            </div>
          ))}
        </Section>
      )}

      {groups.handled.length > 0 && (
        <Section
          title="Handled"
          count={groups.handled.length}
          action={
            <button
              type="button"
              onClick={() => setHandledOpen((v) => !v)}
              aria-expanded={handledOpen}
              className={BTN_SECONDARY}
            >
              {handledOpen ? 'Hide' : 'Show'}
            </button>
          }
        >
          {handledOpen
            ? groups.handled.map((m) => <MissRow key={m.id} miss={m} statusLabel={HANDLED_LABELS[m.status]} />)
            : null}
        </Section>
      )}
    </div>
  )
}
