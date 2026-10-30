'use client'

// Per-row notes on a report card (owner 2026-10-29): an "Add Notes" button
// opens a white input with black text and a Save button; saved notes show on
// the card and print at the top of that row's page in the PDF report.

import { useState } from 'react'
import { StickyNote, Check } from 'lucide-react'

interface Props {
  value: string | null | undefined
  onSave: (notes: string) => void
}

export default function ReportRowNotes({ value, onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value || '')
  const saved = (value || '').trim()

  const save = () => {
    onSave(draft.trim())
    setOpen(false)
  }

  if (open) {
    return (
      <div className="px-4 pb-3 pt-2 border-t border-white/5">
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Notes for this sale — printed on the PDF report"
          rows={3}
          className="w-full rounded-lg bg-white text-black text-xs p-2.5 border border-white/20 focus:outline-none focus:ring-2 focus:ring-gg-pink resize-y placeholder:text-gray-500"
        />
        <div className="flex gap-2 mt-2">
          <button
            type="button"
            onClick={save}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-md bg-gg-pink text-gg-black hover:bg-gg-pink/80 transition"
          >
            <Check size={12} /> Save
          </button>
          <button
            type="button"
            onClick={() => { setDraft(value || ''); setOpen(false) }}
            className="px-3 py-1.5 text-[11px] font-medium rounded-md bg-white/5 text-white/80 border border-white/10 hover:bg-white/10 transition"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pb-3 pt-2 border-t border-white/5">
      {saved && (
        <div className="text-[11px] text-white/85 whitespace-pre-wrap mb-2 bg-white/5 rounded-md px-2.5 py-2 border border-white/10">
          {saved}
        </div>
      )}
      <button
        type="button"
        onClick={() => { setDraft(value || ''); setOpen(true) }}
        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-md bg-white/5 text-white/80 border border-white/10 hover:bg-white/10 hover:text-white transition"
      >
        <StickyNote size={12} /> {saved ? 'Edit Notes' : 'Add Notes'}
      </button>
    </div>
  )
}
