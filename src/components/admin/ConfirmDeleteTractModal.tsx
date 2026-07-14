'use client'

import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { formatAcres } from '@/lib/format'

interface ConfirmDeleteTractTarget {
  tract_number: number | null
  total_acres: number | null
  sale_status: string | null
}

interface ConfirmDeleteTractModalProps {
  tract: ConfirmDeleteTractTarget | null
  isSold: boolean
  /** True when this is the only tract left on the listing — a delete would
   *  leave a 0-tract listing, which the backend rejects (409) for published
   *  tracts. Renders a blocked/explain-only variant with no delete action. */
  isLastTract?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  loading: boolean
  error?: string | null
}

const STATUS_PILL_CLS = (status: string | null) =>
  status === 'sold'    ? 'bg-green-500/15 text-green-400 border border-green-500/40' :
  status === 'pending' ? 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/40' :
  status === 'live'    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/40' :
  status === 'no_sale' ? 'bg-red-500/15 text-red-400 border border-red-500/40' :
  'bg-gg-gray-700 text-gg-gray-300 border border-gg-gray-600'

export default function ConfirmDeleteTractModal({
  tract,
  isSold,
  isLastTract,
  onConfirm,
  onCancel,
  loading,
  error,
}: ConfirmDeleteTractModalProps) {
  if (!tract) return null

  const tractNumber = tract.tract_number ?? '—'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={() => { if (!loading) onCancel() }}
    >
      <div
        className="bg-gg-gray-900 border border-red-800 rounded-lg max-w-lg w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="text-red-400" size={22} />
          <h3 className="text-lg font-bold text-white">{isLastTract ? 'This is the listing’s only tract' : 'Delete this tract?'}</h3>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-sm text-white font-semibold">Tract {tractNumber}</span>
          <span className="text-sm text-gg-gray-400">
            {tract.total_acres != null ? `${formatAcres(tract.total_acres)} ac` : 'acres unknown'}
          </span>
          {tract.sale_status && (
            <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded font-medium capitalize ${STATUS_PILL_CLS(tract.sale_status)}`}>
              {tract.sale_status.replace('_', ' ')}
            </span>
          )}
        </div>

        {isLastTract ? (
          <p className="text-sm text-gg-gray-300 mb-5">
            You can&apos;t delete the only tract on a listing — that would leave an empty listing. To remove it, delete the entire listing instead using the listing&apos;s Delete button.
          </p>
        ) : (
          <>
            <p className="text-sm text-gg-gray-300 mb-4">
              This <span className="text-red-400 font-semibold">permanently deletes Tract {tractNumber}</span> and all of its data — polygon, images, soil ratings, and pricing. There is no undo.
            </p>

            {isSold && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-4">
                <AlertTriangle className="text-red-400 shrink-0 mt-0.5" size={16} />
                <p className="text-sm text-red-300">
                  This tract is marked sold. Deleting it also permanently erases its recorded sale price, buyer, and transaction history — this is real closed-sale data, not a draft.
                </p>
              </div>
            )}

            <ul className="text-xs text-gg-gray-400 list-disc pl-5 mb-5 space-y-1">
              <li>The tract is removed immediately — there is no undo.</li>
              <li>The listing&apos;s rollup totals (acres, $/acre, tract count) recompute without it.</li>
              {isSold && (
                <li className="text-red-400">Sale price, buyer, and sale date for this tract are lost — not recoverable from any other record.</li>
              )}
            </ul>
          </>
        )}

        {error && <div className="text-sm text-red-400 mb-3">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded text-sm font-medium border border-gg-gray-700 bg-gg-gray-800 text-white hover:bg-gg-gray-700 disabled:opacity-50"
          >
            {isLastTract ? 'Close' : 'Cancel'}
          </button>
          {!isLastTract && (
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
              {loading ? 'Deleting…' : 'Delete tract'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
