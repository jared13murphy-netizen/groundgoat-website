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
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  /** Most recent confirmation/error to show inline. Auto-clears after 4s. */
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    } catch (e: any) {
      setToast({ kind: 'err', text: e.message || String(e) })
    } finally {
      setLoading(false)
      if (toastTimer.current) clearTimeout(toastTimer.current)
      toastTimer.current = setTimeout(() => setToast(null), 4000)
    }
  }

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
  }, [])

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[540] w-[min(620px,calc(100vw-32px))] flex flex-col items-center gap-2">
      {/* Toast — confirmation or error, auto-fades */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.text}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.15 }}
            className={`px-4 py-2 rounded-full text-xs backdrop-blur-md border shadow-lg flex items-center gap-2 ${
              toast.kind === 'ok'
                ? 'bg-gg-pink/15 border-gg-pink/40 text-gg-pink'
                : 'bg-red-900/40 border-red-600/50 text-red-200'
            }`}
          >
            <span>{toast.text}</span>
            <button
              onClick={() => setToast(null)}
              className="opacity-60 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pill input bar */}
      <form
        onSubmit={(e) => { e.preventDefault(); submit(input) }}
        className="w-full bg-black/70 backdrop-blur-xl border border-white/15 rounded-full shadow-2xl flex items-center gap-2 pl-5 pr-1.5 py-1.5 hover:border-gg-pink/40 focus-within:border-gg-pink/60 transition-colors"
      >
        <Sparkles size={18} className="text-gg-pink flex-shrink-0" />
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the map…  e.g. Iowa CSR2 75+ upcoming auctions"
          disabled={loading}
          className="flex-1 bg-transparent outline-none text-sm text-white placeholder-gg-gray-400 py-2"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-gg-pink hover:bg-gg-pink-light disabled:opacity-40 disabled:hover:bg-gg-pink text-white rounded-full w-9 h-9 flex items-center justify-center transition-colors flex-shrink-0"
          aria-label="Submit"
        >
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Send size={15} />}
        </button>
      </form>
    </div>
  )
}
