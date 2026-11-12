'use client'

/**
 * The notes Category dropdown (owner 11/11): the built-ins plus the firm's
 * own categories, and — for any member of a management firm — an
 * "Add New Category" choice at the bottom that opens a small input + Save.
 * The new category is selected at once and shows for everyone in the firm.
 * The firm admin renames / deletes them on Account → Note Categories.
 *
 * Owner rule: inputs are ALWAYS white with a light gray border, dark text.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import { Loader2 } from 'lucide-react'
import {
  FIRM_CATEGORY_MAX, addNoteCategory, loadNoteCategories, noteCategoriesSnapshot, subscribeNoteCategories,
  type NoteCategoriesState,
} from '@/lib/notes'

const ADD = '__add_new_category__'
const PINK = '#F58CDE'

/** The shared category list; re-renders when any dropdown adds one. */
export function useNoteCategories(): NoteCategoriesState {
  const [s, setS] = useState<NoteCategoriesState>(noteCategoriesSnapshot())
  useEffect(() => {
    const off = subscribeNoteCategories(setS)
    void loadNoteCategories().then(setS)
    return off
  }, [])
  return s
}

export default function NoteCategorySelect({
  value, onChange, inputStyle, mutedColor, testId = 'notes-category',
}: {
  value: string
  onChange: (v: string) => void
  inputStyle: CSSProperties
  mutedColor?: string
  testId?: string
}) {
  const cats = useNoteCategories()
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // An entry whose category is not in the list (deleted / another firm's)
  // still shows its current value rather than silently switching.
  const known = cats.categories.some((c) => c.value === value)

  const save = async () => {
    const l = label.replace(/\s+/g, ' ').trim()
    if (!l) { setErr('Enter a category name'); return }
    setSaving(true); setErr(null)
    try {
      const cat = await addNoteCategory(l)
      onChange(cat.value)
      setAdding(false); setLabel('')
    } catch (e: any) {
      setErr(e?.message || 'Could not add that category')
    } finally { setSaving(false) }
  }

  return (
    <>
      <select style={inputStyle} value={value} data-testid={testId}
              onChange={(e) => {
                if (e.target.value === ADD) { setAdding(true); setErr(null); return }
                onChange(e.target.value)
              }}>
        {cats.categories.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        {!known && <option value={value}>Note</option>}
        {cats.can_add && <option value={ADD}>+ Add New Category…</option>}
      </select>
      {adding && (
        <span data-testid="notes-category-add" style={{ display: 'block', marginTop: 4 }}>
          {/* Input on its own line, buttons under it: the Category column is
              narrow in the side panels, and a side-by-side row cut the typed
              name off after a few letters. */}
          <input style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} autoFocus maxLength={FIRM_CATEGORY_MAX} placeholder="New category"
                 value={label} data-testid="notes-category-new"
                 onChange={(e) => setLabel(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') { e.preventDefault(); void save() }
                   if (e.key === 'Escape') { setAdding(false); setLabel(''); setErr(null) }
                 }} />
          <span style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <button type="button" disabled={saving} data-testid="notes-category-save" onClick={() => void save()}
                  style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, borderRadius: 7, cursor: 'pointer',
                           background: PINK, color: '#0a0a0a', border: `1px solid ${PINK}`, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {saving ? <Loader2 size={11} className="animate-spin" /> : null} Save
          </button>
          <button type="button" disabled={saving} onClick={() => { setAdding(false); setLabel(''); setErr(null) }}
                  style={{ padding: '4px 8px', fontSize: 11, borderRadius: 7, cursor: 'pointer', background: 'transparent',
                           color: mutedColor || 'inherit', border: '1px solid rgba(128,128,128,0.4)' }}>
            Cancel
          </button>
          </span>
        </span>
      )}
      {adding && <span style={{ display: 'block', fontSize: 10, color: err ? '#f87171' : mutedColor, marginTop: 2 }}>
        {err || 'Everyone in your firm will see this category.'}
      </span>}
    </>
  )
}
