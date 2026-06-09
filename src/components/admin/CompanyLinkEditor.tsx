'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { Search, X } from 'lucide-react'

export interface CompanyOption {
  id: string
  name: string
}

/**
 * Inline searchable picker to link a listing company to a record. Type to
 * filter the company list; clicking a match calls `onPick`, which the parent
 * implements to persist the link (it differs per screen — staging PATCH vs.
 * published-listing update). Throw inside `onPick` to surface an error; resolve
 * to let the parent close the editor.
 *
 * Shared by Auction Staging, PT Staging, and Data Cleanup.
 */
export default function CompanyLinkEditor({
  companies,
  onPick,
  onClose,
}: {
  companies: CompanyOption[]
  onPick: (company: CompanyOption) => Promise<void>
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies
    return list.slice(0, 10)
  }, [query, companies])

  async function pick(c: CompanyOption) {
    setSaving(true)
    setError(null)
    try {
      await onPick(c)
      // Parent closes on success.
    } catch (e: any) {
      setError(e?.message || 'Failed to link company')
      setSaving(false)
    }
  }

  return (
    <div className="relative w-72">
      <div className="flex items-center gap-2">
        <Search size={14} className="text-gg-gray-400 shrink-0" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
          placeholder="Search listing companies…"
          disabled={saving}
          className="flex-1 bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-gg-pink"
        />
        <button onClick={onClose} className="text-gg-gray-400 hover:text-white shrink-0" title="Cancel">
          <X size={16} />
        </button>
      </div>
      {error && <div className="text-xs text-red-400 mt-1">{error}</div>}
      <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto bg-gg-gray-800 border border-gg-gray-700 rounded shadow-lg">
        {matches.length === 0 ? (
          <div className="px-3 py-2 text-sm text-gg-gray-500">No matching companies</div>
        ) : (
          matches.map((c) => (
            <button
              key={c.id}
              onClick={() => pick(c)}
              disabled={saving}
              className="block w-full text-left px-3 py-2 text-sm text-white hover:bg-gg-pink/20 disabled:opacity-50"
            >
              {c.name}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
