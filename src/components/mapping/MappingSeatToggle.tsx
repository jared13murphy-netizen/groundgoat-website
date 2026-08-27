'use client'

/**
 * Configurable Mapping seat — the Ground Goat staff view.
 *
 * Same endpoint the firm admin's toggle uses, so support switching a
 * seat on bills the firm exactly as if they had done it themselves.
 * That is deliberate: a support action that quietly skips billing is
 * how firms end up with free seats nobody can account for.
 */
import { useEffect, useState } from 'react'
import { Loader2, Map as MapIcon } from 'lucide-react'
import { previewSeat, setSeat } from '@/lib/configurableMapping'

export default function MappingSeatToggle({
  userId, firmId, enabled: initial,
}: { userId: string; firmId?: string | null; enabled: boolean }) {
  const [enabled, setEnabled] = useState(initial)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { setEnabled(initial) }, [initial])

  if (!firmId) {
    return (
      <p className="text-sm text-gg-gray-500">
        Configurable Mapping is sold through management firms — this user
        is not on one.
      </p>
    )
  }

  const flip = async () => {
    const next = !enabled
    setBusy(true); setError(''); setMessage('')
    try {
      const p = await previewSeat(next, firmId).catch(() => null)
      if (p && !window.confirm(`${p.message}\n\nContinue?`)) return
      const res = await setSeat(userId, next, firmId)
      setEnabled(res.enabled)
      setMessage(
        res.charged_now
          ? `Seat added — the firm's add-on is now ${res.annual_total}/yr.`
          : res.note || 'Saved.'
      )
    } catch (e: any) {
      setError(e?.message || 'Could not change that seat')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-white">
          <MapIcon size={16} className="text-gg-pink" />
          Configurable Mapping
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Configurable Mapping seat"
          onClick={flip}
          disabled={busy}
          className={`relative w-12 h-6 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
            enabled ? 'bg-gg-pink' : 'bg-gg-gray-700'
          }`}
        >
          {busy ? (
            <Loader2 size={14} className="animate-spin absolute inset-0 m-auto text-white" />
          ) : (
            <span
              className={`absolute left-0 top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                enabled ? 'translate-x-6' : 'translate-x-0.5'
              }`}
            />
          )}
        </button>
      </div>
      {message && <p className="text-sm text-green-400 mt-2">{message}</p>}
      {error && <p className="text-sm text-red-400 mt-2">{error}</p>}
    </div>
  )
}
