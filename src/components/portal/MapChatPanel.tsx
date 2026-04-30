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
}

export default function MapChatPanel({ onApplyFilters, currentFilters }: MapChatPanelProps) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  /** Most recent confirmation/error to show inline. Auto-clears after 4s. */
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
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
      const af = body.applied_filters || {}
      if (af && Object.keys(af).length > 0) {
        onApplyFilters(af, !!body.clear_unspecified)
      }
      setInput('')
      setToast({ kind: 'ok', text: body.reply || 'Filters applied.' })
      // Auto-collapse after a successful filter so the pill gets out of the way
      setTimeout(() => setOpen(false), 600)
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
      {/* Toast */}
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

      {/* Morphing pill — collapsed = button, expanded = input. layout
          prop on the parent makes the height + width animate smoothly. */}
      <motion.form
        ref={formRef}
        layout
        onSubmit={(e) => { e.preventDefault(); submit(input) }}
        animate={{
          width: open
            ? Math.min(620, typeof window !== 'undefined' ? window.innerWidth - 32 : 620)
            : 'auto',
        }}
        transition={{ type: 'spring', damping: 26, stiffness: 280 }}
        className={`relative bg-black/75 backdrop-blur-xl border border-white/15 hover:border-gg-pink/50 focus-within:border-gg-pink/70 rounded-full shadow-2xl flex items-center transition-colors overflow-hidden ${
          open ? 'pl-5 pr-1.5 py-1.5' : 'p-0'
        }`}
        onClick={(e) => {
          // When collapsed, clicking anywhere on the button opens the pill
          if (!open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white whitespace-nowrap"
          >
            <Sparkles size={18} className="text-gg-pink" />
            Goat Search
          </button>
        )}

        {open && (
          <>
            <Sparkles size={18} className="text-gg-pink flex-shrink-0" />
            <motion.input
              ref={inputRef}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15, duration: 0.15 }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the map…  e.g. Iowa CSR2 75+ upcoming auctions"
              disabled={loading}
              className="flex-1 bg-transparent outline-none text-sm text-white placeholder-gg-gray-400 py-2 px-3 min-w-0"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="bg-gg-pink hover:bg-gg-pink-light disabled:opacity-40 disabled:hover:bg-gg-pink text-white rounded-full w-9 h-9 flex items-center justify-center transition-colors flex-shrink-0"
              aria-label="Submit"
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : <Send size={15} />}
            </button>
          </>
        )}
      </motion.form>
    </div>
  )
}
