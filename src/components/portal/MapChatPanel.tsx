'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Loader2, Sparkles, X } from 'lucide-react'
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
}

interface AnalyticsResponse {
  title: string
  summary: string
  stats: { label: string; value: string }[]
  table: { columns: string[]; rows: string[][] } | null
  analytics_type: string
}

export default function MapChatPanel({ onApplyFilters, currentFilters, hasActiveFilters, onSearchStart }: MapChatPanelProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  /** Most recent confirmation/error to show inline. Auto-clears after 4s. */
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  /** Analytics modal state — populated when the LLM picks the analytics
      tool instead of apply_map_filters. Charts are deferred to v2 (the
      modal renders text + stats grid + table for now). */
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
          current_filters: currentFilters || {},
        }),
      })
      const body = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        setToast({ kind: 'err', text: body.detail || `HTTP ${res.status}` })
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
      setToast({ kind: 'err', text: e.message || String(e) })
    } finally {
      setLoading(false)
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

      {/* Analytics modal — opens when the LLM picks the analytics tool
          instead of apply_map_filters (e.g. "avg $/acre in Henry County
          2025"). v1 = text + stats grid + table. Charts deferred to v2
          (will use Recharts for bar/line and a server-rendered PNG for
          mobile parity). */}
      <AnimatePresence>
        {analytics && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[600] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
            onClick={() => setAnalytics(null)}
          >
            <motion.div
              initial={{ scale: 0.96, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 8 }}
              transition={{ duration: 0.18 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gg-gray-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-white/10">
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-semibold text-white truncate">{analytics.title}</h3>
                  <p className="text-xs text-gg-gray-400 mt-0.5 capitalize">{analytics.analytics_type.replace(/_/g, ' ')}</p>
                </div>
                <button
                  onClick={() => setAnalytics(null)}
                  className="text-gg-gray-400 hover:text-white p-1 rounded transition-colors flex-shrink-0"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="px-6 py-4 overflow-y-auto">
                <p className="text-sm text-gg-gray-200 leading-relaxed">{analytics.summary}</p>

                {analytics.stats && analytics.stats.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {analytics.stats.map((s) => (
                      <div key={s.label} className="bg-black/40 border border-white/10 rounded-lg px-3 py-2">
                        <div className="text-[11px] uppercase tracking-wide text-gg-gray-400">{s.label}</div>
                        <div className="text-base font-semibold text-white mt-0.5">{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}

                {analytics.table && analytics.table.rows.length > 0 && (
                  <div className="mt-5 border border-white/10 rounded-lg overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-black/40 text-gg-gray-300">
                          <tr>
                            {analytics.table.columns.map((c) => (
                              <th key={c} className="text-left font-medium px-3 py-2 whitespace-nowrap">{c}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {analytics.table.rows.map((row, i) => (
                            <tr key={i} className="border-t border-white/5 text-gg-gray-200 hover:bg-white/5">
                              {row.map((cell, j) => (
                                <td key={j} className="px-3 py-2 whitespace-nowrap">{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <div className="px-6 py-3 border-t border-white/10 flex justify-end">
                <button
                  onClick={() => setAnalytics(null)}
                  className="text-xs px-4 py-1.5 rounded-full bg-gg-pink hover:bg-gg-pink-light text-white transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
