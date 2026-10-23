'use client'

/**
 * "Add to Calendar" — owner 2026-10-23: a calendar+ button beside every
 * Add to Watchlist button, for auctions and tracts, on the website and in
 * the app. Tapping it opens a small modal asking which calendar to add
 * the auction to: Apple (iPhone/Mac), Google (Gmail) or Outlook.
 *
 * The event itself (title, start/end, location, notes) is built by ONE
 * backend endpoint, GET /api/calendar/event?listing_id=…&tract_id=…, so
 * the website, the app and the .ics file always agree. Apple and Outlook
 * desktop take the .ics file; Google and Outlook on the web take a
 * pre-filled compose link.
 */
import { useEffect, useState } from 'react'
import { CalendarPlus, X, Loader2 } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export interface CalendarEvent {
  title: string
  start: string | null
  end: string | null
  all_day: boolean
  date: string | null
  location: string
  description: string
  when_text: string
  ics_url: string
  google_url: string
  outlook_url: string
}

export async function fetchCalendarEvent(listingId: string, tractId?: string | null): Promise<CalendarEvent> {
  const qs = new URLSearchParams({ listing_id: listingId })
  if (tractId) qs.set('tract_id', tractId)
  const r = await fetch(`${API_URL}/api/calendar/event?${qs.toString()}`)
  if (!r.ok) {
    const body = await r.json().catch(() => ({}))
    throw new Error(body.detail || 'This auction has no date to add.')
  }
  return r.json()
}

interface Props {
  listingId: string
  tractId?: string | null
  /** Match the bookmark next to it. */
  className?: string
  iconSize?: number
  iconClassName?: string
  stopPropagation?: boolean
}

export default function AddToCalendarButton({ listingId, tractId, className, iconSize = 14, iconClassName = 'text-white', stopPropagation = true }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => { if (stopPropagation) e.stopPropagation(); setOpen(true) }}
        aria-label="Add to calendar"
        title="Add to calendar"
        className={className || 'p-2 bg-black/40 backdrop-blur-sm rounded-lg hover:bg-black/60 transition'}
      >
        <CalendarPlus size={iconSize} className={iconClassName} />
      </button>
      {open && <AddToCalendarModal listingId={listingId} tractId={tractId} onClose={() => setOpen(false)} />}
    </>
  )
}

export function AddToCalendarModal({ listingId, tractId, onClose }: { listingId: string; tractId?: string | null; onClose: () => void }) {
  const [event, setEvent] = useState<CalendarEvent | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    fetchCalendarEvent(listingId, tractId)
      .then(ev => { if (alive) setEvent(ev) })
      .catch(e => { if (alive) setError(e?.message || 'Could not build the calendar event.') })
    return () => { alive = false }
  }, [listingId, tractId])

  const choices = event ? [
    { key: 'apple', label: 'Apple Calendar', hint: 'iPhone, iPad, Mac', href: event.ics_url, download: true },
    { key: 'google', label: 'Google Calendar', hint: 'Gmail', href: event.google_url, download: false },
    { key: 'outlook', label: 'Outlook', hint: 'Outlook.com, Microsoft 365', href: event.outlook_url, download: false },
  ] : []

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="bg-gg-gray-900 border border-gg-gray-700 rounded-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-white flex items-center gap-2"><CalendarPlus size={18} className="text-gg-pink" /> Add to Calendar</h3>
            {event && <p className="text-sm text-gg-gray-300 mt-1">{event.title}</p>}
            {event && <p className="text-xs text-gg-gray-400">{event.when_text}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-gg-gray-400 hover:text-white"><X size={18} /></button>
        </div>
        {error && <p className="text-sm text-yellow-400 mb-2">{error}</p>}
        {!event && !error && <div className="flex items-center gap-2 text-gg-gray-400 text-sm py-4"><Loader2 size={16} className="animate-spin" /> Building the event…</div>}
        {event && (
          <div className="space-y-2">
            {choices.map(c => (
              <a
                key={c.key}
                href={c.href}
                target={c.download ? undefined : '_blank'}
                rel="noreferrer"
                onClick={() => setTimeout(onClose, 300)}
                className="flex items-center justify-between w-full px-4 py-3 rounded-lg bg-gg-gray-800 hover:bg-gg-gray-700 text-white transition"
              >
                <span className="font-medium">{c.label}</span>
                <span className="text-xs text-gg-gray-400">{c.hint}</span>
              </a>
            ))}
            <p className="text-[11px] text-gg-gray-500 pt-1">Apple opens a calendar file; Google and Outlook open a pre-filled event in a new tab.</p>
          </div>
        )}
      </div>
    </div>
  )
}
