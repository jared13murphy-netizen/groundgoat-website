'use client'

/**
 * LandTypeButtons — horizontal add/remove buttons for a tract's land_types.
 *
 * Per user 2026-06-05: show every land type as a chip; the ones currently
 * saved to the tract are filled (✓, click to remove), the rest are outlined
 * (+, click to add). Every click fires onChange with the new array — the
 * parent saves IMMEDIATELY (no Save button). Used on all 4 tract-editing
 * screens (auction staging, PT staging, data-cleanup, edit-listing).
 */

// Canonical set (matches the backend ALLOWED_LAND_TYPES). Confirmed by user.
export const LAND_TYPES = [
  'Farm', 'Recreational', 'Pasture', 'Commercial',
  'Residential', 'Development', 'Vacant Land', 'Other',
] as const

export default function LandTypeButtons({
  value,
  onChange,
  disabled,
}: {
  value?: string[] | null
  onChange: (next: string[]) => void
  disabled?: boolean
}) {
  const active = new Set((value || []).filter(Boolean))
  const toggle = (t: string) => {
    if (disabled) return
    const next = new Set(active)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    // Emit in canonical order so the saved array is stable/deterministic.
    onChange(LAND_TYPES.filter((x) => next.has(x)))
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {LAND_TYPES.map((t) => {
        const on = active.has(t)
        return (
          <button
            key={t}
            type="button"
            disabled={disabled}
            onClick={() => toggle(t)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              on
                ? 'bg-gg-pink text-white border-gg-pink hover:bg-gg-pink/80'
                : 'bg-transparent text-gg-gray-400 border-gg-gray-600 hover:border-gg-gray-400 hover:text-gg-gray-200'
            }`}
            title={on ? `Remove ${t}` : `Add ${t}`}
          >
            {on ? '✓ ' : '+ '}{t}
          </button>
        )
      })}
    </div>
  )
}
