'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Loader2, Sparkles, X } from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface MapChatPanelProps {
  /** Called when the model returns filter args. Frontend should merge
      them into the map's FilterState (using clearUnspecified to decide
      whether unrelated filters get reset). */
  onApplyFilters: (filters: Record<string, any>, clearUnspecified: boolean) => void
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
  mapSearchError?: { message: string; nonce: number } | null
}

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
    const rowsToShow = a.table.rows.slice(0, 10)
    rowsToShow.forEach((r, i) => {
      const parts = cols.map((c, j) => `${c}: ${r[j]}`)
      lines.push(`${i + 1}. ${parts.join(' · ')}`)
    })
    if (a.table.rows.length > rowsToShow.length) {
      lines.push(`…and ${a.table.rows.length - rowsToShow.length} more.`)
    }
  }
  return lines.join('\n')
}

export default function MapChatPanel({ onApplyFilters, currentFilters, hasActiveFilters, onSearchStart, onSearchEnd, mapSearchError }: MapChatPanelProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  /** Most recent confirmation/error to show inline. Auto-clears after 4s. */
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  /** Analytics modal state — populated when the LLM picks the analytics
      tool instead of apply_map_filters. Modal renders the answer as
      ChatGPT-style typed text on a full pink-gradient background. */
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  /** Typewriter — incrementally reveals the analytics answer text */
  const [typedChars, setTypedChars] = useState(0)
  const fullAnswer = buildAnalyticsAnswer(analytics)
  useEffect(() => {
    setTypedChars(0)
    if (!analytics) return
    const total = fullAnswer.length
    if (total === 0) return
    const id = window.setInterval(() => {
      setTypedChars((prev) => {
        if (prev >= total) { window.clearInterval(id); return prev }
        return Math.min(total, prev + 2)
      })
    }, 12)
    return () => window.clearInterval(id)
  }, [analytics, fullAnswer])
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The map's wide-bbox fetch failed AFTER we already showed a "Filters
  // applied" success toast for this same search — replace it with the
  // real outcome. The toast renders regardless of whether the pill is
  // open/collapsed, so this reaches the user even after auto-collapse.
  useEffect(() => {
    if (!mapSearchError) return
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ kind: 'err', text: mapSearchError.message })
    toastTimer.current = setTimeout(() => setToast(null), 4000)
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
    setToast(null)
    // Tell the map to start its loading animation NOW — covers the
    // chat-filter call AND the subsequent /api/map/tracts call.
    onSearchStart?.()
    try {
      const res = await fetchWithAuth(`${API_URL}/api/map/chat-filter`, {
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
      })
      const body = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        // Never surface raw `detail` here — historically that's a Python
        // exception string, not something a farmer should see. Show a
        // friendly generic message instead, but keep the real status/body
        // in the console so backend 4xx/5xx stay debuggable.
        console.error('chat-filter non-OK response:', res.status, body)
        setToast({ kind: 'err', text: 'Goat Search hit a snag — try again in a moment.' })
        return
      }
      // Two response shapes: filter (existing) or analytics (new).
      // Analytics opens a modal; filter applies to the map as before.
      if (body.analytics_response) {
        setAnalytics(body.analytics_response as AnalyticsResponse)
        setInput('')
        setToast(null)
        setOpen(false)
      } else {
        const af = body.applied_filters || {}
        if (af && Object.keys(af).length > 0) {
          onApplyFilters(af, !!body.clear_unspecified)
        }
        setInput('')
        setToast({ kind: 'ok', text: body.reply || 'Filters applied.' })
        // Auto-collapse after a successful filter so the pill gets out of the way
        setTimeout(() => setOpen(false), 600)
      }
    } catch (e: any) {
      // fetchWithAuth doesn't receive a caller-owned AbortSignal here, so
      // any AbortError is its own internal 20s timeout — not an unmount/
      // cancellation we can silently ignore. Never surface e.message
      // (e.g. "Failed to fetch", "The user aborted a request") — log the
      // real error for debugging and show the same friendly toast as the
      // non-OK path.
      console.error('chat-filter request failed:', e)
      setToast({ kind: 'err', text: 'Goat Search hit a snag — try again in a moment.' })
    } finally {
      setLoading(false)
      // Tell the map the search is done. The map otherwise relies on
      // the wide-bbox /api/map/tracts query (run after applied_filters)
      // to stop its loading animation — for analytics responses that
      // never runs, so without this signal the pulse + rising-stars
      // animation runs forever.
      onSearchEnd?.()
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), 4000)
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
            className={`px-4 py-2 rounded-full text-xs backdrop-blur-md border shadow-lg flex items-center gap-2 max-w-[min(620px,calc(100vw-32px))] ${
              toast.kind === 'ok'
                ? 'bg-gg-pink/15 border-gg-pink/40 text-gg-pink'
                : 'bg-red-900/40 border-red-600/50 text-red-200'
            }`}
          >
            <span className="truncate">{toast.text}</span>
            <button
              onClick={() => setToast(null)}
              className="opacity-60 hover:opacity-100 flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Clear search — visible whenever any filter is active. One
          click reverts the map to the unfiltered default view. */}
      <AnimatePresence>
        {hasActiveFilters && !loading && (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            onClick={() => {
              onApplyFilters({}, true)
              setToast({ kind: 'ok', text: 'Filters cleared.' })
            }}
            className="px-3 py-1 rounded-full text-[11px] bg-black/70 hover:bg-black/85 text-white border border-white/15 hover:border-gg-pink/50 backdrop-blur-md flex items-center gap-1 transition-colors"
            style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.5))' }}
          >
            <X size={11} /> Clear search
          </motion.button>
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
        }}
        className={`relative rounded-full flex items-center gap-2 pl-5 pr-1.5 py-1.5 overflow-hidden transition-colors duration-300 ${
          open
            ? 'bg-black/75 backdrop-blur-xl border border-white/15 focus-within:border-gg-pink/70'
            : 'bg-gg-pink hover:bg-gg-pink-light border border-gg-pink cursor-pointer'
        }`}
        onClick={!open ? () => setOpen(true) : undefined}
      >
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
                    already the best representation. Only render once
                    the typed answer is complete so it doesn't visually
                    fight the typewriter effect. */}
                {analytics?.chart && typedChars >= fullAnswer.length && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className="mt-6 bg-black/25 border border-white/10 rounded-xl p-3"
                  >
                    <ResponsiveContainer width="100%" height={200}>
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
                        <BarChart data={analytics.chart.data}>
                          <CartesianGrid stroke="rgba(255,255,255,0.08)" />
                          <XAxis
                            dataKey="label"
                            stroke="rgba(255,255,255,0.7)"
                            tick={{ fill: 'rgba(255,255,255,0.85)', fontSize: 10 }}
                            axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
                            tickLine={false}
                            interval={0}
                            angle={-25}
                            textAnchor="end"
                            height={50}
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
                            cursor={{ fill: 'rgba(255,255,255,0.06)' }}
                          />
                          <Bar
                            dataKey="value"
                            fill="rgba(255,255,255,0.85)"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      )}
                    </ResponsiveContainer>
                  </motion.div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.body
      )}
    </div>
  )
}
