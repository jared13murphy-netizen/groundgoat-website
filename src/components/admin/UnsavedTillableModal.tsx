'use client'

import { AlertTriangle } from 'lucide-react'

/**
 * Shown when staff try to save a tract boundary while the Tillable Workshop
 * for the same tract still has unsaved edits. A boundary save makes the
 * Workshop re-load against the new boundary, which would silently throw
 * those edits away — so staff must choose first.
 *
 * Buttons are solid fills (owner rule): pink + black text = primary,
 * gray #E4E4E7 + black text = secondary.
 */
export default function UnsavedTillableModal({
  tractLabel,
  onGoBack,
  onDiscard,
}: {
  /** e.g. "Tract 2" — null hides the modal. */
  tractLabel: string | null
  /** Primary: close, do NOT save the boundary; staff save the tillable first. */
  onGoBack: () => void
  /** Secondary: save the boundary anyway and drop the unsaved tillable edits. */
  onDiscard: () => void
}) {
  if (!tractLabel) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onGoBack}
    >
      <div
        className="bg-gg-gray-900 border border-gg-gray-700 rounded-lg max-w-lg w-full p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Unsaved tillable changes"
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="text-yellow-400" size={22} />
          <h3 className="text-lg font-bold text-white">Save the tillable first?</h3>
        </div>
        <p className="text-sm text-gg-gray-300 mb-2">
          {tractLabel} has tillable changes in the Tillable Workshop that are not saved yet.
        </p>
        <p className="text-sm text-gg-gray-300 mb-5">
          Saving the boundary reloads the Workshop, and those changes would be lost. Go back and click
          Save in the Workshop, then save the boundary again. Or discard the tillable changes and save
          the boundary now.
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onDiscard}
            className="px-4 py-2 rounded text-sm font-semibold bg-[#E4E4E7] text-black hover:bg-[#d4d4d8]"
          >
            Discard tillable changes
          </button>
          <button
            type="button"
            onClick={onGoBack}
            autoFocus
            className="px-4 py-2 rounded text-sm font-semibold bg-[#F58CDE] text-black hover:bg-[#f7a3e5]"
          >
            Go back and save tillable
          </button>
        </div>
      </div>
    </div>
  )
}
