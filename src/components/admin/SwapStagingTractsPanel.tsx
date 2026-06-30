'use client'

/**
 * SwapStagingTractsPanel — inline panel for swapping tract data within a
 * staging record's scraped_data.tracts array.
 *
 * Used on the Auction Staging and PT Staging screens where tracts have no
 * real DB IDs yet.  All three modes:
 *   polygons   — polygon_coordinates, tillable_polygon, tillable_acres
 *   data       — all non-polygon data fields
 *   everything — both sets
 *
 * The component calls onSwap(updatedTracts) and lets the parent persist the
 * change (via its existing PATCH scraped_data path) so there's no separate
 * network call from here.
 */

import { useState } from 'react'
import { Loader2, ChevronsUpDown, Check } from 'lucide-react'
import { formatAcres } from '@/lib/format'

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

const POLYGON_KEYS = [
  'polygon_coordinates', 'tillable_polygon', 'tillable_acres',
  'tillable_manual_polygons', 'tillable_cutout_polygons', 'tillable_clu_overrides',
] as const

const DATA_KEYS = [
  'acres', 'soil_rating', 'soil_rating_type',
  'description', 'name', 'latitude', 'longitude',
  'land_type', 'land_types',
  'has_house', 'has_building',
  'corn_acres', 'soybean_acres', 'wheat_acres', 'hay_acres',
  'other_crop_acres', 'non_ag_acres', 'pasture_acres', 'timber_acres', 'other_acres',
  // tillable_acres is in POLYGON_KEYS; in data-only mode we still swap it so
  // the acreage number follows the polygon assignment.
  'tillable_acres',
] as const

function swapKeys(a: any, b: any, keys: readonly string[]): [any, any] {
  const na = { ...a }
  const nb = { ...b }
  for (const k of keys) {
    const tmp = na[k]
    na[k] = nb[k]
    nb[k] = tmp
  }
  return [na, nb]
}

export default function SwapStagingTractsPanel({
  tracts,
  onSwap,
}: {
  /** The scraped_data.tracts array for this staging listing. */
  tracts: any[]
  /**
   * Called with the updated tracts array once the user confirms.
   * The parent is responsible for persisting it (PATCH scraped_data).
   * Return a Promise so the panel can show a spinner while it waits.
   */
  onSwap: (updatedTracts: any[]) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [idxA, setIdxA] = useState<string>('')
  const [idxB, setIdxB] = useState<string>('')
  const [mode, setMode] = useState<SwapMode>('polygons')
  const [swapping, setSwapping] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (tracts.length < 2) return null

  const handleOpen = () => {
    if (!open) {
      const sorted = tracts
        .map((t, i) => [i, t] as [number, any])
        .sort(([ia, a], [ib, b]) => (a.tract_number ?? ia) - (b.tract_number ?? ib))
      if (!idxA) setIdxA(String(sorted[0][0]))
      if (!idxB) setIdxB(String(sorted[1][0]))
      setResult(null)
      setError(null)
    }
    setOpen(!open)
  }

  const tractLabel = (t: any, i: number) =>
    `T${t.tract_number ?? i + 1}${t.acres != null ? ` (${formatAcres(Number(t.acres))} ac)` : ''}`

  const handleSwap = async () => {
    const ia = parseInt(idxA)
    const ib = parseInt(idxB)
    if (isNaN(ia) || isNaN(ib) || ia === ib) {
      setError('Select two different tracts.')
      return
    }

    const keys: readonly string[] =
      mode === 'polygons'
        ? POLYGON_KEYS
        : mode === 'data'
        ? DATA_KEYS
        : [...POLYGON_KEYS, ...DATA_KEYS.filter((k) => !POLYGON_KEYS.includes(k as any))]

    const updated = [...tracts]
    const [na, nb] = swapKeys(updated[ia], updated[ib], keys)
    // After a polygon swap the old images are stale — NULL both so they regenerate
    if (mode === 'polygons' || mode === 'everything') {
      na.image_base64 = null
      na.image_url = null
      nb.image_base64 = null
      nb.image_url = null
    }
    updated[ia] = na
    updated[ib] = nb

    setSwapping(true)
    setResult(null)
    setError(null)
    try {
      await onSwap(updated)
      setResult(`Swapped T${tracts[ia].tract_number ?? ia + 1} ↔ T${tracts[ib].tract_number ?? ib + 1}`)
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSwapping(false)
    }
  }

  return (
    <div className="mt-3 mb-2">
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
                value={idxA}
                onChange={(e) => { setIdxA(e.target.value); setResult(null) }}
                className="bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1.5 text-sm text-white"
              >
                <option value="">— pick —</option>
                {tracts.map((t, i) => (
                  <option key={i} value={String(i)}>{tractLabel(t, i)}</option>
                ))}
              </select>
            </div>
            <div className="text-gg-gray-500 font-bold mt-4">↔</div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-gg-gray-400">Tract B</label>
              <select
                value={idxB}
                onChange={(e) => { setIdxB(e.target.value); setResult(null) }}
                className="bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1.5 text-sm text-white"
              >
                <option value="">— pick —</option>
                {tracts.map((t, i) => (
                  <option key={i} value={String(i)}>{tractLabel(t, i)}</option>
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
                  name={`swap-mode-staging-${idxA}-${idxB}`}
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
              disabled={swapping || idxA === '' || idxB === '' || idxA === idxB}
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
