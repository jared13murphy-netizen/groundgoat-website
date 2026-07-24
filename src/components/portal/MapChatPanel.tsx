'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Loader2, Sparkles, X, Check, Info, AlertTriangle, Compass } from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import fetchWithAuth from '@/lib/fetchWithAuth'
import type { OwnerParcelsResponse } from '@/components/map/exploreMapTypes'

const API_URL = 'https://practical-serenity-production.up.railway.app'

type ToastKind = 'ok' | 'info' | 'err'

// Per-kind accent color — used for the 3px left border and the leading
// icon. Everything else about the toast shell (bg, text color, blur) is
// identical across kinds; only these two things carry meaning.
const TOAST_ACCENT: Record<ToastKind, string> = {
  ok: '#f58cde',
  info: '#f5b800',
  err: '#f87171',
}

interface MapChatPanelProps {
  /** Called when the model returns filter args. Frontend should merge
      them into the map's FilterState (using clearUnspecified to decide
      whether unrelated filters get reset). */
  onApplyFilters: (filters: Record<string, any>, clearUnspecified: boolean) => void
  /** Fired when this search's response is an ANALYTICS or OUT-OF-SCOPE
      answer (a report panel, not a map-filter result) — never fired for
      a filter response. The parent (access/page.tsx) decides whether an
      actual map reset is warranted: it's the one place that sees BOTH
      this chat-apply path AND the manual Filter Panel's apply path, so
      it alone knows whether the map's current filters are still
      chat-sourced or were since overridden manually. This panel must
      NOT make that call itself (previously did, via a local ref — that
      couldn't see manual applies and would silently wipe them). */
  onChatReportResult?: () => void
  /** Frontend's current FilterState — sent to the model so it can do
      partial updates ("CSR2 80+" without losing the existing state filter). */
  currentFilters?: Record<string, any>
  /** True when filters are non-default — shows a "Clear search" link. */
  hasActiveFilters?: boolean
  /** Fired the moment the user submits a query. Lifts loading-state up
      so the map can start its animation overlay BEFORE the chat-filter
      response comes back. The map handles turning the flag back off. */
  onSearchStart?: () => void
  /** Fired when the chat-filter response arrives, regardless of whether
      it's a filter response (the map will also stop on its own when
      the wide-bbox query completes) or an analytics response (the map
      never gets applied_filters and would otherwise leave the loading
      animation running forever). */
  onSearchEnd?: () => void
  /** Set by the parent (a fresh object each time, per the nonce) when
      the map's post-chat-search wide-bbox tract fetch fails. By this
      point the user already saw the "Filters applied" success toast,
      so this replaces it with the real outcome. */
  mapSearchError?: { message: string; nonce: number; kind: 'info' | 'err' } | null
  /** Fired when the model returns an owner "show on map" result instead
      of a filter/analytics/out-of-scope response — e.g. "show me
      parcels owned by William Sullivan". The map renders the owner's
      parcels as dots and zooms to them; `reply` is the human-readable
      summary line (or "none found" message when count is 0). */
  onOwnerParcels?: (data: OwnerParcelsResponse, reply: string) => void
  /** Fired ONLY in the two branches of submit() that actually change what
      the map shows — owner_parcels_response and a non-empty
      applied_filters — with the raw query text the user typed. Lets the
      parent (access/page.tsx) surface the active-search bubble below.
      Deliberately distinct from onSearchStart (which fires unconditionally,
      the instant ANY search is submitted, to kick off the map's loading
      animation before the response shape is even known) — this one only
      fires when there's real map state for the bubble's X to clear. */
  onSearchQueryStart?: (text: string) => void
  /** Active Goat Search bubble (designer spec 2026-07-24) — replaces the
      old owner chip (ExploreMap.tsx) and this panel's own "Clear search"
      pill with one unified bubble. Text of the search currently driving
      the map, or null when nothing is active. Owned by the parent since
      it must survive independent of this panel's own submit() calls. */
  activeSearchQuery?: string | null
  /** Clears activeSearchQuery AND resets the map's chat-applied filters
      (which, via ExploreMap's applyExternalFilters effect, also clears
      any owner-parcels dots) — the bubble's X button. */
  clearActiveSearch?: () => void
}

interface OutOfScopeResponse {
  topic: string | null
}

// The 5 example phrases shown in the out-of-scope panel. Each is a
// verified-working query shape (owner lookup / recreational map filter /
// soil map filter / analytics / radius map filter) — tapping one fills
// the Goat Search input with this exact text and submits it immediately.
const OUT_OF_SCOPE_EXAMPLES = [
  'How many acres does John Smith own in Illinois?',
  'Show me hunting land for sale in Missouri',
  'Iowa cropland with CSR2 80 or higher',
  "What's the average sale price per acre in Illinois this year?",
  'Farms for sale within 20 miles of Springfield, IL',
]

interface AnalyticsResponse {
  title: string
  summary: string
  stats: { label: string; value: string }[]
  table: { columns: string[]; rows: string[][] } | null
  /** Optional chart for time series (line) and grouped rankings (bar).
      summary_stats / top_n omit this — they're already best-served by
      the stats grid or table. */
  chart?: {
    type: 'line' | 'bar'
    x_label: string
    y_label: string
    data: { label: string; value: number }[]
  } | null
  analytics_type: string
}

// Build a single block of natural-language text from the analytics
// response so the modal reads like a ChatGPT answer (typed out
// char-by-char) instead of a stats grid + table layout.
function buildAnalyticsAnswer(a: AnalyticsResponse | null): string {
  if (!a) return ''
  const lines: string[] = []
  if (a.summary) lines.push(a.summary)
  if (a.stats?.length) {
    lines.push('')
    for (const s of a.stats) lines.push(`• ${s.label}: ${s.value}`)
  }
  if (a.table?.rows?.length) {
    lines.push('')
    const cols = a.table.columns
    // Never cap result counts (product rule) — the panel scrolls via
    // overflow-y-auto, so list every row. This is also the full-name
    // recovery path for chart bars 11+, whose axis labels are
    // truncated with no reliable hover on touch devices.
    a.table.rows.forEach((r, i) => {
      const parts = cols.map((c, j) => `${c}: ${r[j]}`)
      lines.push(`${i + 1}. ${parts.join(' · ')}`)
    })
  }
  return lines.join('\n')
}

export default function MapChatPanel({ onApplyFilters, onChatReportResult, currentFilters, hasActiveFilters, onSearchStart, onSearchEnd, mapSearchError, onOwnerParcels, onSearchQueryStart, activeSearchQuery, clearActiveSearch }: MapChatPanelProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  /** Most recent confirmation/caveat/error to show inline. 'ok' toasts
      auto-clear on a short, message-length-scaled timer; 'info'/'err'
      toasts are sticky (dismissed via the X, a new search, or Clear
      search) with a 30s defensive fallback — see scheduleToastDismiss. */
  const [toast, setToast] = useState<{ kind: ToastKind; text: string } | null>(null)
  /** Analytics modal state — populated when the LLM picks the analytics
      tool instead of apply_map_filters. Modal renders the answer as
      ChatGPT-style typed text on a full pink-gradient background. */
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  /** Out-of-scope redirect state — populated when the LLM picks
      answer_out_of_scope (the question is genuinely outside what Ground
      Goat can answer: weather, commodity/livestock prices, zoning,
      taxes, etc). Renders the same slide-out shell as analytics but with
      a neutral tone and 5 tappable example queries instead of an
      answer. No auto-dismiss — stays until the user taps a chip or
      closes it. */
  const [outOfScope, setOutOfScope] = useState<OutOfScopeResponse | null>(null)
  /** Typewriter — incrementally reveals the analytics answer text.
      Step size is dynamic (not a fixed +2/tick) so the worst case is
      bounded: a large uncapped comparison (n up to 50, several
      thousand chars) still finishes in ~2s instead of the ~20s a fixed
      rate would take — HARD RULE, no user-facing loading state may
      exceed 5s. Short answers still get the original slow, readable
      reveal since the floor of 2 chars/tick only kicks in below ~320
      chars. */
  const [typedChars, setTypedChars] = useState(0)
  const fullAnswer = buildAnalyticsAnswer(analytics)
  useEffect(() => {
    setTypedChars(0)
    if (!analytics) return
    const total = fullAnswer.length
    if (total === 0) return
    const step = Math.max(2, Math.ceil(total / 160))
    const id = window.setInterval(() => {
      setTypedChars((prev) => {
        if (prev >= total) { window.clearInterval(id); return prev }
        return Math.min(total, prev + step)
      })
    }, 12)
    return () => window.clearInterval(id)
  }, [analytics, fullAnswer])
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearToastTimer = () => {
    if (toastTimer.current) {
      clearTimeout(toastTimer.current)
      toastTimer.current = null
    }
  }

  // Schedules the auto-dismiss for a toast. 'ok' toasts scale their
  // duration with message length so longer confirmations get more
  // reading time; 'info'/'err' toasts are sticky — the user dismisses
  // them via the X, a new search, or Clear search — but still get a
  // 30s defensive fallback so nothing can get stuck on screen forever.
  const scheduleToastDismiss = (kind: ToastKind, text: string) => {
    clearToastTimer()
    if (kind === 'ok') {
      const wordCount = text.trim().split(/\s+/).filter(Boolean).length
      const duration = Math.min(4200, Math.max(2200, 2200 + wordCount * 140))
      toastTimer.current = setTimeout(() => setToast(null), duration)
    } else {
      toastTimer.current = setTimeout(() => setToast(null), 30000)
    }
  }

  // The map's wide-bbox fetch settled (zero results or a load failure)
  // AFTER we already showed a "Filters applied" success toast for this
  // same search — replace it with the real outcome. The toast renders
  // regardless of whether the pill is open/collapsed, so this reaches
  // the user even after auto-collapse.
  useEffect(() => {
    if (!mapSearchError) return
    setToast({ kind: mapSearchError.kind, text: mapSearchError.message })
    scheduleToastDismiss(mapSearchError.kind, mapSearchError.message)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapSearchError?.nonce])

  // Focus input when the pill opens; close on Esc
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 250)
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          if (input) {
            setInput('')
          } else {
            setOpen(false)
          }
        }
      }
      window.addEventListener('keydown', onKey)
      return () => {
        clearTimeout(t)
        window.removeEventListener('keydown', onKey)
      }
    }
  }, [open, input])

  // Click outside collapses the pill
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        if (!input && !loading) setOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, input, loading])

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  const submit = async (raw: string) => {
    const text = raw.trim()
    if (!text || loading) return
    setLoading(true)
    clearToastTimer()
    setToast(null)
    // Every new Goat Search is fresh — close any open analytics/
    // out-of-scope panel from a PRIOR search right away, before this
    // one's response decides whether to show a new one. Owner
    // screenshot (2026-07-10): a stale analytics/out-of-scope panel
    // from the last search must never still be up once a new search is
    // in flight.
    setAnalytics(null)
    setOutOfScope(null)
    // Tell the map to start its loading animation NOW — covers the
    // chat-filter call AND the subsequent /api/map/tracts call.
    onSearchStart?.()
    // Set true only when we hand off to ExploreMap's own wide-bbox fetch
    // (a non-empty applied_filters response) — that fetch reliably calls
    // stopChatSearchingSoon() itself on completion (success OR failure).
    // Every OTHER outcome (analytics, empty filters, non-OK response,
    // thrown exception) never reaches that fetch, so onSearchEnd must
    // fire from here instead or the loading animation runs forever.
    // BUG (2026-07-09 incident contributor): this used to be called
    // unconditionally in `finally` below, which fired the instant this
    // chat-filter POST resolved — well before ExploreMap's own wide-bbox
    // /api/map/tracts fetch (kicked off in a separate effect after
    // onApplyFilters) had even started, let alone finished. That flipped
    // `chatSearching` off early, re-arming the normal moveend cell-loader
    // while the filtered search was still in flight and the camera
    // hadn't snapped to the new results yet.
    let handedOffToMapFetch = false
    // Backend does bounded LLM-call retries within a ~24s budget, so this
    // request needs to outlast that — 30s, passed as a per-call override
    // so we don't slow down fetchWithAuth's 20s default for every other
    // endpoint on the site.
    const CHAT_FILTER_TIMEOUT_MS = 30_000
    // A failure inside 6s is a transient network/connection blip (dropped
    // socket, DNS hiccup) — worth one silent retry before bothering the
    // user. A failure that took longer means the backend already spent
    // its own ~24s retry budget and genuinely gave up; retrying THAT would
    // just double the wait for the same outcome, so we don't.
    const FAST_FAIL_THRESHOLD_MS = 6_000
    // A SLOW failure (>= 6s) usually means our own 30s client abort fired,
    // or a late network error, while the backend's hardened budget is only
    // ~24s and typical success is 2-6s. That shape matches a lost-response
    // blip (backend finished, client never got it) more often than a truly
    // stuck backend, so it still deserves one retry — just with a shorter
    // 15s timeout so the worst case is ~45s total, not 60s.
    const SLOW_RETRY_TIMEOUT_MS = 15_000
    const requestChatFilter = (timeoutMs: number = CHAT_FILTER_TIMEOUT_MS) =>
      fetchWithAuth(
        `${API_URL}/api/map/chat-filter`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            // Per user spec 2026-05-08: every new search is FRESH, not a
            // refinement of the previous results. Sending {} means the
            // LLM has no prior-filter context to inherit — queries like
            // "Steffes Dec 2025 auctions" don't get intersected with a
            // previous "Iowa CSR2 70+" filter.
            current_filters: {},
          }),
        },
        timeoutMs,
      )
    try {
      let res: Response
      const attemptStart = Date.now()
      try {
        res = await requestChatFilter()
      } catch (firstError) {
        const elapsed = Date.now() - attemptStart
        if (elapsed < FAST_FAIL_THRESHOLD_MS) {
          // Silent retry — spinner (loading state) stays up, no toast yet.
          console.warn('chat-filter fast-fail, retrying once:', firstError)
          res = await requestChatFilter()
        } else {
          // Slow first failure (30s abort or late network error) — one
          // more silent retry with a shorter 15s timeout. Max attempts
          // stays at 2 total: this branch only runs on the FIRST attempt's
          // failure, so a fast-fail retry that then fails slowly lands in
          // the outer catch below instead of looping back here.
          console.warn('chat-filter slow-fail, retrying once with shorter timeout:', firstError)
          res = await requestChatFilter(SLOW_RETRY_TIMEOUT_MS)
        }
      }
      const body = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        // Never surface raw `detail` here — historically that's a Python
        // exception string, not something a farmer should see. Show a
        // friendly generic message instead, but keep the real status/body
        // in the console so backend 4xx/5xx stay debuggable.
        console.error('chat-filter non-OK response:', res.status, body)
        setToast({ kind: 'err', text: 'Goat Search hit a snag — try again in a moment.' })
        scheduleToastDismiss('err', 'Goat Search hit a snag — try again in a moment.')
        return
      }
      // Four response shapes: owner-parcels (new) / out-of-scope /
      // analytics / filter (existing). owner_parcels_response is checked
      // FIRST — it's a distinct, unambiguous shape the backend only sends
      // for "show me X's parcels" queries, and it draws directly on the
      // map rather than opening a report panel, so it doesn't go through
      // onChatReportResult like the other two report-panel shapes below.
      if (body.owner_parcels_response) {
        onOwnerParcels?.(body.owner_parcels_response as OwnerParcelsResponse, body.reply || '')
        onSearchQueryStart?.(text)
        setInput('')
        setToast(null)
        setOpen(false)
      } else if (body.out_of_scope_response) {
        setOutOfScope(body.out_of_scope_response as OutOfScopeResponse)
        setInput('')
        setToast(null)
        setOpen(false)
        // This is a report panel, not a map-filter search — it must
        // never sit on top of a PREVIOUS search's stale bubbles/pins.
        // The parent decides whether an actual reset is warranted (only
        // if the map's active filters are still chat-sourced) — this
        // panel has no visibility into manual Filter Panel applies and
        // must never make that call itself.
        onChatReportResult?.()
      } else if (body.analytics_response) {
        setAnalytics(body.analytics_response as AnalyticsResponse)
        setInput('')
        setToast(null)
        setOpen(false)
        // Same stale-bubbles fix as out-of-scope above.
        onChatReportResult?.()
      } else {
        const af = body.applied_filters || {}
        if (af && Object.keys(af).length > 0) {
          onApplyFilters(af, !!body.clear_unspecified)
          handedOffToMapFetch = true
          onSearchQueryStart?.(text)
        }
        setInput('')
        const okText = body.reply || 'Filters applied.'
        setToast({ kind: 'ok', text: okText })
        scheduleToastDismiss('ok', okText)
        // Auto-collapse after a successful filter so the pill gets out of the way
        setTimeout(() => setOpen(false), 600)
      }
    } catch (e: any) {
      // fetchWithAuth doesn't receive a caller-owned AbortSignal here, so
      // any AbortError is its own internal timeout (CHAT_FILTER_TIMEOUT_MS
      // or SLOW_RETRY_TIMEOUT_MS above) — not an unmount/cancellation we
      // can silently ignore. Reaching this catch means the retry (fast-fail
      // OR slow-fail, whichever branch ran above) also failed — total
      // attempts are always capped at 2, so there's no further retry from
      // here. Never surface e.message (e.g. "Failed to fetch", "The user
      // aborted a request") — log the real error for debugging and show
      // the same friendly toast as the non-OK path.
      console.error('chat-filter request failed:', e)
      setToast({ kind: 'err', text: 'Goat Search hit a snag — try again in a moment.' })
      scheduleToastDismiss('err', 'Goat Search hit a snag — try again in a moment.')
    } finally {
      setLoading(false)
      // Tell the map the search is done — UNLESS we just handed off to
      // ExploreMap's own wide-bbox fetch, which owns stopping the
      // animation itself once THAT request actually completes (success
      // or failure). Firing it here too would race ahead of that fetch
      // and re-arm the normal cell-loader mid-search (see the note on
      // `handedOffToMapFetch` above).
      if (!handedOffToMapFetch) onSearchEnd?.()
    }
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[540] flex flex-col items-center gap-2">
      {/* Toast + optional Clear-search link */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.text}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="relative overflow-hidden rounded-full backdrop-blur-lg border border-white/15 flex items-center gap-2 px-5 py-3 max-w-[calc(100vw-32px)] sm:max-w-[440px] text-[13px] leading-[1.5]"
            style={{
              backgroundColor: 'rgba(10,10,10,0.92)',
              color: '#f5f5f5',
              filter: 'drop-shadow(0 3px 12px rgba(0,0,0,0.7))',
            }}
          >
            {/* Kind accent — 3px left bar, same color as the leading icon */}
            <span
              className="absolute left-0 top-0 bottom-0 w-[3px]"
              style={{ backgroundColor: TOAST_ACCENT[toast.kind] }}
            />
            {toast.kind === 'ok' && (
              <Check size={16} className="flex-shrink-0" style={{ color: TOAST_ACCENT.ok }} />
            )}
            {toast.kind === 'info' && (
              <Info size={16} className="flex-shrink-0" style={{ color: TOAST_ACCENT.info }} />
            )}
            {toast.kind === 'err' && (
              <AlertTriangle size={16} className="flex-shrink-0" style={{ color: TOAST_ACCENT.err }} />
            )}
            <span>{toast.text}</span>
            <button
              onClick={() => { clearToastTimer(); setToast(null) }}
              className="p-4 -m-4 opacity-60 hover:opacity-100 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Goat Search bubble (designer spec 2026-07-24) — replaces
          the old "Clear search" pill above AND the owner chip that used
          to live in ExploreMap.tsx with one unified affordance. Shows the
          raw query text that's currently driving the map (filter search
          OR owner-parcels search); its X clears both activeSearchQuery
          and the map's chat-applied filters (which, via ExploreMap's
          applyExternalFilters effect, also clears owner-parcels dots and
          restores every layer that search hid). */}
      <AnimatePresence>
        {activeSearchQuery && !loading && (
          <motion.div
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-2 pl-4 pr-1.5 py-1.5 rounded-full text-[12px] font-medium bg-black/70 border border-gg-pink/40 backdrop-blur-md text-white"
            style={{ maxWidth: 'min(520px, calc(100vw - 96px))', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))' }}
          >
            <span className="truncate">{activeSearchQuery}</span>
            <button onClick={clearActiveSearch} aria-label="Clear search"
              className="flex-shrink-0 w-6 h-6 rounded-full bg-white/12 hover:bg-white/20 flex items-center justify-center transition-colors">
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Morphing pill — single consistent layout. Width animates
          smoothly between two numeric values; padding stays constant
          so the spring never "catches" mid-animation. Inner content
          (label vs input + send) crossfades in place. */}
      <motion.form
        ref={formRef}
        onSubmit={(e) => { e.preventDefault(); submit(input) }}
        animate={{
          width: open
            ? Math.min(620, typeof window !== 'undefined' ? window.innerWidth - 32 : 620)
            : 168,
        }}
        transition={{ type: 'spring', damping: 28, stiffness: 240 }}
        style={{
          filter: 'drop-shadow(0 3px 12px rgba(0,0,0,0.7)) drop-shadow(0 1px 4px rgba(0,0,0,0.5))',
          // Collapsed state gets the brand pink→magenta gradient (same
          // family as the Goat Analysis pane's gradient) instead of a
          // flat fill. Expanded state keeps its dark glass look.
          ...(!open && {
            background: 'linear-gradient(135deg, #F58CDE 0%, #EC4899 100%)',
            borderColor: 'rgba(255,255,255,0.35)',
          }),
        }}
        className={`group relative rounded-full flex items-center gap-2 pl-5 pr-1.5 py-1.5 overflow-hidden transition-colors duration-300 ${
          open
            ? 'bg-black/75 backdrop-blur-xl border border-white/15 focus-within:border-gg-pink/70'
            : 'border cursor-pointer hover:brightness-110'
        }`}
        onClick={!open ? () => setOpen(true) : undefined}
      >
        {/* Shiny sheen — a soft top highlight over the gradient so the
            collapsed pill reads as glossy rather than a flat fill.
            Pointer-events-none so it never blocks the click-to-open
            handler on the form above. */}
        {!open && (
          <span
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 32%, rgba(255,255,255,0) 58%)',
            }}
          />
        )}
        <Sparkles
          size={18}
          className={`flex-shrink-0 transition-colors duration-300 ${
            open ? 'text-gg-pink' : 'text-white'
          }`}
        />

        {/* Crossfade label vs input. Both rendered, only one visible/
            interactive at a time. Stays in the same flex slot so the
            width animation has nothing to fight with. */}
        <div className="relative flex-1 min-w-0 h-9 flex items-center">
          <motion.span
            animate={{ opacity: open ? 0 : 1 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 flex items-center text-sm font-semibold text-black whitespace-nowrap pointer-events-none"
          >
            Goat Search
          </motion.span>
          <motion.input
            ref={inputRef}
            animate={{ opacity: open ? 1 : 0 }}
            transition={{ duration: 0.18, delay: open ? 0.12 : 0 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the map…  e.g. Iowa CSR2 75+ upcoming auctions"
            disabled={loading || !open}
            tabIndex={open ? 0 : -1}
            className="absolute inset-0 w-full bg-transparent outline-none text-sm text-white placeholder-gg-gray-400 px-1"
            style={{ pointerEvents: open ? 'auto' : 'none' }}
          />
        </div>

        {/* Send button — fades + scales in once expanded */}
        <motion.button
          type="submit"
          animate={{
            opacity: open ? 1 : 0,
            scale: open ? 1 : 0.4,
          }}
          transition={{ duration: 0.18, delay: open ? 0.15 : 0 }}
          style={{ pointerEvents: open ? 'auto' : 'none' }}
          disabled={loading || !input.trim()}
          aria-label="Submit"
          className="bg-gg-pink hover:bg-gg-pink-light disabled:opacity-40 disabled:hover:bg-gg-pink text-white rounded-full w-9 h-9 flex items-center justify-center transition-colors flex-shrink-0"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Send size={15} />}
        </motion.button>
      </motion.form>

      {/* Analytics RIGHT-SIDE slide-out pane — PORTALED to document.body
          because the chat-panel wrapper above has CSS transform
          (-translate-x-1/2). Any ancestor with `transform` becomes the
          containing block for fixed-positioned children, which made
          the "right-side pane" render inside the small bottom-center
          chat-pill container instead of against the viewport edge. */}
      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {analytics && (
          <>
            {/* Backdrop — click anywhere outside to close */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setAnalytics(null)}
              className="fixed inset-0 z-[680] bg-black/55 backdrop-blur-[2px]"
            />
            {/* Right-side pane */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 240 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.x > 100 || info.velocity.x > 600) setAnalytics(null)
              }}
              className="fixed top-0 right-0 bottom-0 z-[690] w-full max-w-md rounded-l-3xl shadow-[-14px_0_50px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden"
              style={{
                background:
                  'linear-gradient(155deg, #F58CDE 0%, #EC4899 18%, #7B2455 55%, #2a0a1c 100%)',
              }}
            >
              {/* Rising sparkles inside the pane background — same
                  goatSparkle vibe as the chat-search overlay. Sits
                  between the gradient and the text. pointer-events-none
                  so it never blocks interactions. */}
              <div className="absolute inset-0 pointer-events-none overflow-hidden">
                {[10, 22, 34, 46, 58, 70, 82, 94].map((leftPct, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: `${leftPct}%`,
                      bottom: -10,
                      width: 6,
                      height: 6,
                      background: 'rgba(255, 255, 255, 0.85)',
                      borderRadius: '50%',
                      boxShadow: '0 0 12px rgba(255, 255, 255, 0.7)',
                      animation: 'paneSparkle 4.5s ease-in infinite',
                      animationDelay: `${i * 0.5}s`,
                      opacity: 0,
                    }}
                  />
                ))}
                <style>{`
                  @keyframes paneSparkle {
                    0%   { opacity: 0; transform: translateY(0) scale(0.5); }
                    25%  { opacity: 0.9; }
                    100% { opacity: 0; transform: translateY(-100vh) scale(0.3); }
                  }
                `}</style>
              </div>

              <div className="absolute left-2 top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10">
                <div className="w-1.5 h-12 rounded-full bg-white/70" />
              </div>

              <div className="relative flex items-start justify-between gap-3 px-7 pt-7 pb-4">
                <div className="flex-1 min-w-0">
                  <h3 className="text-2xl font-extrabold text-white tracking-[0.01em] leading-tight drop-shadow-sm">
                    Goat Analysis
                  </h3>
                  <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-white/85 mt-1">
                    Goat Search
                  </p>
                </div>
                <button
                  onClick={() => setAnalytics(null)}
                  className="w-9 h-9 rounded-full bg-black/30 hover:bg-black/45 text-white flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="relative px-7 pb-8 overflow-y-auto flex-1">
                <p
                  className="text-white text-base leading-relaxed font-medium whitespace-pre-line"
                  style={{ textShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
                >
                  {fullAnswer.slice(0, typedChars)}
                  {typedChars < fullAnswer.length && (
                    <span className="text-white/85 inline-block animate-pulse">▍</span>
                  )}
                </p>

                {/* Optional chart — backend includes one for by_month
                    (line) and group_by n>1 (bar). Skipped for
                    summary_stats and top_n where the table/stats are
                    already the best representation. Mounts as soon as
                    analytics.chart exists — NOT gated on the typewriter
                    finishing. A large uncapped comparison (n up to 50)
                    types for ~2s; gating the chart on that would delay
                    the user's first paint of the exact thing they
                    asked for, breaking the no-loading-state-over-5s
                    rule. It fights the typewriter a little less than
                    it looks — the text above is still mid-reveal while
                    this fades in, but that's a better trade than a
                    blank panel. */}
                {analytics?.chart && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className="mt-6 bg-black/25 border border-white/10 rounded-xl p-3"
                  >
                    <ResponsiveContainer
                      width="100%"
                      height={
                        analytics.chart.type === 'line'
                          ? 200
                          : Math.max(180, analytics.chart.data.length * 34)
                      }
                    >
                      {analytics.chart.type === 'line' ? (
                        <LineChart data={analytics.chart.data}>
                          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                          <XAxis
                            dataKey="label"
                            stroke="rgba(255,255,255,0.7)"
                            tick={{ fill: 'rgba(255,255,255,0.85)', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                            tickLine={false}
                          />
                          <YAxis
                            stroke="rgba(255,255,255,0.7)"
                            tick={{ fill: 'rgba(255,255,255,0.85)', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                            tickLine={false}
                          />
                          <Tooltip
                            contentStyle={{
                              background: 'rgba(0,0,0,0.85)',
                              border: '1px solid rgba(255,255,255,0.18)',
                              borderRadius: 8,
                              color: '#fff',
                              fontSize: 12,
                            }}
                            cursor={{ stroke: 'rgba(255,255,255,0.25)' }}
                          />
                          <Line
                            type="monotone"
                            dataKey="value"
                            stroke="#fff"
                            strokeWidth={2.5}
                            dot={{ fill: '#fff', r: 3 }}
                            activeDot={{ r: 5 }}
                          />
                        </LineChart>
                      ) : (
                        <BarChart layout="vertical" data={analytics.chart.data}>
                          <CartesianGrid stroke="rgba(255,255,255,0.08)" horizontal={false} />
                          <XAxis
                            type="number"
                            stroke="rgba(255,255,255,0.7)"
                            tick={{ fill: 'rgba(255,255,255,0.85)', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                            tickLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={130}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: 'rgba(255,255,255,0.85)', fontSize: 11 }}
                            tickFormatter={(v) =>
                              typeof v === 'string' && v.length > 18 ? v.slice(0, 17) + '…' : v
                            }
                          />
                          <Tooltip
                            contentStyle={{
                              background: 'rgba(0,0,0,0.85)',
                              border: '1px solid rgba(255,255,255,0.18)',
                              borderRadius: 8,
                              color: '#fff',
                              fontSize: 12,
                            }}
                            labelFormatter={(_label, payload) =>
                              payload?.[0]?.payload?.label ?? _label
                            }
                            cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                          />
                          <Bar
                            dataKey="value"
                            fill="rgba(255,255,255,0.85)"
                            radius={[0, 4, 4, 0]}
                          />
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </motion.div>
                )}

                {/* Disclaimer — owner-approved copy (2026-07-22). Sits as
                    the last element in the scrollable content, below the
                    chart when present, so it's always visible once the
                    user scrolls to the end of the analysis. */}
                <p className="mt-6 pt-4 border-t border-white/15 text-[11px] leading-relaxed text-white/50">
                  This analysis is based on Ground Goat&apos;s data and may not encompass all real estate transactions in the area.
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
      )}

      {/* Out-of-scope RIGHT-SIDE slide-out — same portaled shell/mechanics
          as the analytics pane above (right slide-out, max-w-md,
          rounded-l-3xl, drag/backdrop dismiss, drag handle) but with a
          neutral dark shell instead of the pink success gradient, no
          rising-sparkle animation, and no typewriter — the copy renders
          instantly with a quick fade. No auto-dismiss timer; stays open
          until a chip is tapped or the user closes it. */}
      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {outOfScope && (
          <>
            {/* Backdrop — click anywhere outside to close */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setOutOfScope(null)}
              className="fixed inset-0 z-[680] bg-black/55 backdrop-blur-[2px]"
            />
            {/* Right-side pane */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 240 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 0.6 }}
              onDragEnd={(_, info) => {
                if (info.offset.x > 100 || info.velocity.x > 600) setOutOfScope(null)
              }}
              className="fixed top-0 right-0 bottom-0 z-[690] w-full max-w-md rounded-l-3xl shadow-[-14px_0_50px_rgba(0,0,0,0.6)] flex flex-col overflow-hidden bg-[#0a0a0a]"
            >
              <div className="absolute left-2 top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing z-10">
                <div className="w-1.5 h-12 rounded-full bg-white/25" />
              </div>

              <div className="relative flex items-start justify-between gap-3 px-7 pt-7 pb-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full bg-gg-pink/20 border border-gg-pink/40 flex items-center justify-center flex-shrink-0">
                      <Compass size={13} className="text-gg-pink" />
                    </span>
                    <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-white/60">
                      Goat Search
                    </p>
                  </div>
                  <h3 className="text-2xl font-extrabold text-white tracking-[0.01em] leading-tight">
                    I can&apos;t show that here
                  </h3>
                </div>
                <button
                  onClick={() => setOutOfScope(null)}
                  className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/15 text-white flex items-center justify-center transition-colors flex-shrink-0"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              {/* No typewriter for this state — render instantly with a
                  quick 200ms fade instead of the analytics char-by-char
                  reveal. */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className="relative px-7 pb-8 overflow-y-auto flex-1"
              >
                <p className="text-white/85 text-base leading-relaxed font-medium">
                  {outOfScope.topic
                    ? `I can't help with ${outOfScope.topic} — but I can dig into farmland and hunting land: ownership, past sales and auctions, listings, soil ratings, tillable acres, and buildings. Try one of these:`
                    : "That's outside what I can look up here. I can dig into farmland and hunting land: ownership, past sales and auctions, listings, soil ratings, tillable acres, and buildings. Try one of these:"}
                </p>

                <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-white/40 mt-6 mb-3">
                  Try asking
                </p>

                <div className="flex flex-col gap-2">
                  {OUT_OF_SCOPE_EXAMPLES.map((phrase) => (
                    <button
                      key={phrase}
                      type="button"
                      onClick={() => {
                        setOutOfScope(null)
                        setInput(phrase)
                        submit(phrase)
                      }}
                      className="text-left px-4 py-3 rounded-xl bg-white/[0.07] hover:bg-white/[0.12] border border-white/10 text-white text-sm transition-colors"
                    >
                      {phrase}
                    </button>
                  ))}
                </div>
              </motion.div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
      )}
    </div>
  )
}
