'use client'

import { Loader2, Trash2, X } from 'lucide-react'

export interface DeleteCompanyOption {
  id: string
  name: string
}

/**
 * Reassign-then-delete confirmation modal for listing companies. A company
 * with referencing listings can never just be deleted — the backend
 * (DELETE /api/companies/{id}) 409s unless `reassign_to` names another
 * company, then repoints every referencing listing to it before deleting.
 * This modal is the picker for that `reassign_to` id.
 *
 * `listingCount` is optional: the companies list screen already has an
 * accurate cached count per company and shows it; the single-company edit
 * screen only learns a company has references from the backend's 409 (it
 * doesn't pre-fetch counts), so it renders the generic copy instead.
 *
 * Shared by /admin/companies (list) and /admin/companies/[id] (edit) so the
 * two delete flows can't drift out of sync.
 */
export default function DeleteCompanyModal({
  companyToDelete,
  listingCount,
  companies,
  reassignTo,
  onReassignToChange,
  onCancel,
  onConfirm,
  deleting,
}: {
  companyToDelete: DeleteCompanyOption
  listingCount?: number
  companies: DeleteCompanyOption[]
  reassignTo: string
  onReassignToChange: (id: string) => void
  onCancel: () => void
  onConfirm: () => void
  deleting: boolean
}) {
  const countKnown = typeof listingCount === 'number'
  const plural = !countKnown || listingCount !== 1

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gg-gray-900 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 border-b border-gg-gray-800">
          <h2 className="text-xl font-bold text-white">Delete Company</h2>
          <button onClick={onCancel} className="text-gg-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-gg-gray-300 text-sm">
            <span className="text-white font-semibold">{companyToDelete.name}</span> has{' '}
            {countKnown ? `${listingCount} listing${plural ? 's' : ''}` : 'listings'} referencing
            it. Choose a company to reassign {plural ? 'them' : 'it'} to before deleting — a
            listing can never be left without a company.
          </p>
          <div>
            <label className="block text-gg-gray-400 text-sm mb-1">Reassign listings to *</label>
            <select
              value={reassignTo}
              onChange={(e) => onReassignToChange(e.target.value)}
              className="w-full bg-white border border-gg-gray-300 rounded-lg px-4 py-2 text-black"
            >
              <option value="">Select a company</option>
              {companies
                .filter((c) => c.id !== companyToDelete.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-3 p-4 border-t border-gg-gray-800">
          <button
            onClick={onCancel}
            className="px-4 py-2 bg-gg-gray-700 text-white rounded-lg hover:bg-gg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={deleting || !reassignTo}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-50"
          >
            {deleting ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
            {deleting ? 'Reassigning…' : 'Reassign & Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
