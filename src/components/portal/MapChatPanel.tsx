'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, MessageSquare, X, Loader2, Sparkles } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface ChatMessage {
  role: 'user' | 'assistant' | 'error'
  text: string
  applied?: Record<string, any>
}

interface MapChatPanelProps {
  /** Bumped each time we want the map to apply new filters. */
  onApplyFilters: (filters: Record<string, any>, clearUnspecified: boolean) => void
  /** Frontend's current FilterState — sent to the model so it can do
      partial updates ("show me CSR2 80+" without losing the state filter). */
  currentFilters?: Record<string, any>
}

const STARTER_PROMPTS = [
  'Iowa CSR2 75+ upcoming auctions',
  'Private treaty over 200 acres in Missouri',
  'Sold farms in Adair County last year',
  'Recreational land with a house',
]

export default function MapChatPanel({ onApplyFilters, currentFilters }: MapChatPanelProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100)
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || loading) return
    setMessages(prev => [...prev, { role: 'user', text: trimmed }])
    setInput('')
    setLoading(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/map/chat-filter`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          current_filters: currentFilters || {},
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setMessages(prev => [...prev, { role: 'error', text: body.detail || `HTTP ${res.status}` }])
      } else {
        const reply = body.reply || 'Filters applied.'
        const af = body.applied_filters || {}
        setMessages(prev => [...prev, { role: 'assistant', text: reply, applied: af }])
        if (af && Object.keys(af).length > 0) {
          onApplyFilters(af, !!body.clear_unspecified)
        }
      }
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'error', text: e.message || String(e) }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-[540] bg-gg-pink hover:bg-gg-pink-light text-white p-4 rounded-full shadow-2xl flex items-center gap-2 transition-all hover:scale-105"
          title="Search the map with natural language"
        >
          <Sparkles size={20} />
          <span className="hidden md:inline text-sm font-semibold">AI Search</span>
        </button>
      )}

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed bottom-6 right-6 z-[540] w-[360px] max-w-[calc(100vw-32px)] h-[500px] bg-gg-gray-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-gg-pink" />
                <h3 className="text-sm font-semibold text-white">AI Map Search</h3>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="p-1 hover:bg-white/10 rounded text-gg-gray-400 hover:text-white"
              >
                <X size={16} />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="text-xs text-gg-gray-400 space-y-2">
                  <p>Type what you want to see on the map. Examples:</p>
                  <div className="flex flex-col gap-1.5">
                    {STARTER_PROMPTS.map(p => (
                      <button
                        key={p}
                        onClick={() => send(p)}
                        className="text-left px-3 py-1.5 bg-white/5 hover:bg-gg-pink/15 hover:text-gg-pink border border-white/10 rounded-lg text-xs transition-colors"
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    m.role === 'user'
                      ? 'ml-auto max-w-[85%] bg-gg-pink/20 border border-gg-pink/40 text-white text-sm px-3 py-2 rounded-2xl rounded-br-sm'
                      : m.role === 'error'
                      ? 'mr-auto max-w-[85%] bg-red-900/40 border border-red-600/50 text-red-200 text-sm px-3 py-2 rounded-2xl rounded-bl-sm'
                      : 'mr-auto max-w-[85%] bg-white/5 border border-white/10 text-white text-sm px-3 py-2 rounded-2xl rounded-bl-sm'
                  }
                >
                  <div>{m.text}</div>
                  {m.applied && Object.keys(m.applied).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10 text-[10px] text-gg-gray-400 space-y-0.5">
                      {Object.entries(m.applied).map(([k, v]) => (
                        <div key={k}>
                          <span className="text-gg-gray-500">{k}:</span>{' '}
                          {Array.isArray(v) ? v.join(', ') || '—' : String(v) || '—'}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="mr-auto bg-white/5 border border-white/10 text-gg-gray-300 text-sm px-3 py-2 rounded-2xl rounded-bl-sm flex items-center gap-2">
                  <Loader2 className="animate-spin" size={14} />
                  Thinking…
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={(e) => { e.preventDefault(); send(input) }}
              className="p-3 border-t border-white/10 flex gap-2"
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Iowa CSR2 75+ upcoming auctions…"
                className="flex-1 bg-white/5 border border-white/10 focus:border-gg-pink/60 outline-none rounded-lg px-3 py-2 text-sm text-white placeholder-gg-gray-500"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="bg-gg-pink hover:bg-gg-pink-light disabled:opacity-40 text-white rounded-lg px-3 py-2 transition-colors"
              >
                <Send size={16} />
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
