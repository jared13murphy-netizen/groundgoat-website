'use client'

// "Notes on this report" (owner 11/10): what Download PDF / Email Report
// print from each item's timeline. Internal entries never print, whatever
// is picked here — the server drops them before the report is built.
import { NOTES_PRINT_MODES, todayIso, type NotesPrint, type NotesPrintMode } from '@/lib/notes'

const input = {
  background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 8, color: '#111111',
  padding: '5px 8px', fontSize: 12, fontFamily: 'inherit',
} as const

export default function NotesPrintChoice({ value, onChange }: { value: NotesPrint; onChange: (v: NotesPrint) => void }) {
  return (
    <div data-testid="notes-print-choice" className="px-5 pt-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <label htmlFor="notes-print-mode" className="text-[11px] font-semibold text-gg-gray-400 uppercase tracking-wider whitespace-nowrap">
          Notes on this report
        </label>
        <select id="notes-print-mode" data-testid="notes-print-mode" style={{ ...input, flex: 1 }} value={value.mode}
                onChange={(e) => {
                  const mode = e.target.value as NotesPrintMode
                  onChange(mode === 'range' ? { mode, from: value.from || `${todayIso().slice(0, 4)}-01-01`, to: value.to || todayIso() } : { mode })
                }}>
          {NOTES_PRINT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      {value.mode === 'range' && (
        <div className="flex items-center gap-2 text-[11px] text-gg-gray-400">
          <span>From</span>
          <input type="date" data-testid="notes-print-from" style={{ ...input, flex: 1 }} value={value.from || ''}
                 onChange={(e) => onChange({ ...value, from: e.target.value || null })} />
          <span>to</span>
          <input type="date" data-testid="notes-print-to" style={{ ...input, flex: 1 }} value={value.to || ''}
                 onChange={(e) => onChange({ ...value, to: e.target.value || null })} />
        </div>
      )}
      <p className="text-[10px] text-gg-gray-500 m-0">Internal notes never print.</p>
    </div>
  )
}
