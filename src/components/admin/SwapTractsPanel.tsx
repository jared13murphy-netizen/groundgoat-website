'use client'

/**
 * SwapTractsPanel — inline panel for swapping data between two live DB tracts.
 *
 * Shown on the Data Clean-Up and Edit Listing screens where tracts already
 * have real DB IDs.  Only renders when the listing has >= 2 tracts.
 *
 * Usage:
 *   <SwapTractsPanel
 *     listingId="uuid"
 *     tracts={[{ id: 'uuid', tract_number: 1, total_acres: 45.5 }, ...]}
 *     onSwapped={() => reloadTracts()}
 *   />
 */

import { useState } from 'react'
import { Loader2, ChevronsUpDown, Check } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

type SwapTract = {
  id: string
  tract_number: number
  total_acres?: number | null
}

type SwapMode = 'polygons' | 'data' | 'everything'

const MODE_LABELS: Record<SwapMode, { label: string; desc: string }> = {
  polygons: {
    label: 'Swap Polygons',
    desc: 'Move the tract and tillable boundary drawings between these two tracts',
  },
  data: {
    label: 'Swap Data',
    desc: 'Move the acres, soil rating, and description between these two tracts (keeps polygons in place)',
  },
  everything: {
    label: 'Swap Everything',
    desc: 'Fully swap these two tracts — all data and polygons trade places',
  },
}

export default function SwapTractsPanel({
  listingId: _listingId,
  tracts,
  onSwapped,
}: {
  listingId: string
  tracts: SwapTract[]
  onSwapped: () => void
}) {
  const [open, setOpen] = useState(false)
  const [tractIdA, setTractIdA] = useState<string>('')
  const [tractIdB, setTractIdB] = useState<string>('')
  const [mode, setMode] = useState<SwapMode>('polygons')
  const [swapping, setSwapping] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (tracts.length < 2) return null

  // Default to first two tracts when opening the panel.
  const handleOpen = () => {
    if (!open) {
      const sorted = [...tracts].sort((a, b) => (a.tract_number ?? 0) - (b.tract_number ?? 0))
      setTractIdA(tractIdA || sorted[0]?.id || '')
      setTractIdB(tractIdB || sorted[1]?.id || '')
      setResult(null)
      setError(null)
    }
    setOpen(!open)
  }

  const tractLabel = (t: SwapTract) =>
    `T${t.tract_number}${t.total_acres != null ? ` (${Number(t.total_acres).toFixed(1)} ac)` : ''}`

  const handleSwap = async () => {
    if (!tractIdA || !tractIdB || tractIdA === tractIdB) {
      setError('Select two different tracts.')
      return
    }
    setSwapping(true)
    setResult(null)
    setError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tracts/swap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tract_id_a: tractIdA, tract_id_b: tractIdB, mode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || `Error ${res.status}`)
        return
      }
      const a = tracts.find((t) => t.id === tractIdA)
      const b = tracts.find((t) => t.id === tractIdB)
      setResult(`Swapped T${a?.tract_number ?? '?'} ↔ T${b?.tract_number ?? '?'}`)
      onSwapped()
    } catch (e: any) {
      setError(e.message || 'Network error')
    } finally {
      setSwapping(false)
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-gg-gray-700 bg-gg-gray-800 text-white hover:bg-gg-gray-700 transition-colors"
      >
        <ChevronsUpDown size={13} />
        Swap Tracts
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-gg-gray-700 bg-gg-gray-900 p-4 space-y-4">
          <p className="text-xs font-semibold text-gg-gray-300 uppercase tracking-wide">Swap Tracts</p>

          {/* Tract pickers */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gg-gray-400">Tract A</label>
              <select
                value={tractIdA}
                onChange={(e) => { setTractIdA(e.target.value); setResult(null) }}
                className="bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1.5 text-sm text-white"
              >
                <option value="">— pick —</option>
                {[...tracts]
                  .sort((a, b) => (a.tract_number ?? 0) - (b.tract_number ?? 0))
                  .map((t) => (
                    <option key={t.id} value={t.id}>{tractLabel(t)}</option>
                  ))}
              </select>
            </div>
            <div className="text-gg-gray-500 font-bold mt-4">↔</div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gg-gray-400">Tract B</label>
              <select
                value={tractIdB}
                onChange={(e) => { setTractIdB(e.target.value); setResult(null) }}
                className="bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1.5 text-sm text-white"
              >
                <option value="">— pick —</option>
                {[...tracts]
                  .sort((a, b) => (a.tract_number ?? 0) - (b.tract_number ?? 0))
                  .map((t) => (
                    <option key={t.id} value={t.id}>{tractLabel(t)}</option>
                  ))}
              </select>
            </div>
          </div>

          {/* Mode radio */}
          <div className="space-y-2">
            {(Object.keys(MODE_LABELS) as SwapMode[]).map((m) => (
              <label key={m} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="swap-mode"
                  value={m}
                  checked={mode === m}
                  onChange={() => { setMode(m); setResult(null) }}
                  className="mt-0.5 accent-gg-pink"
                />
                <div>
                  <span className="text-sm text-white font-medium">{MODE_LABELS[m].label}</span>
                  <p className="text-xs text-gg-gray-400">{MODE_LABELS[m].desc}</p>
                </div>
              </label>
            ))}
          </div>

          {/* Action row */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleSwap}
              disabled={swapping || !tractIdA || !tractIdB || tractIdA === tractIdB}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-gg-pink text-white hover:bg-gg-pink/80 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {swapping ? (
                <><Loader2 className="animate-spin" size={14} /> Swapping…</>
              ) : (
                <><ChevronsUpDown size={14} /> Confirm Swap</>
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-gg-gray-400 hover:text-white"
            >
              Cancel
            </button>
            {result && (
              <span className="inline-flex items-center gap-1 text-sm text-green-400 font-medium">
                <Check size={14} /> {result}
              </span>
            )}
            {error && (
              <span className="text-sm text-red-400">{error}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
