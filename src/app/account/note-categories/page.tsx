'use client'

import { useCallback, useEffect, useState } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, Pencil, Trash2, X, AlertCircle, Tags } from 'lucide-react'
import {
  FIRM_CATEGORY_MAX, NOTE_CATEGORIES, deleteNoteCategory, loadNoteCategories, renameNoteCategory,
  type FirmNoteCategory,
} from '@/lib/notes'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// Owner rule: inputs are ALWAYS white with a light gray border and dark text.
const INPUT = 'flex-1 min-w-0 bg-white border border-gray-300 rounded-lg px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-gg-pink focus:outline-none'

/** Firm portal → Note Categories (owner 11/11): the firm's own categories in
 *  the notes Category dropdown. Any firm member adds one from the dropdown;
 *  the firm admin fixes a misspelling or removes an unused one here. A
 *  rename shows on every existing note; a deleted category's notes become
 *  "Note". Firm admins only. */
export default function NoteCategoriesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [cats, setCats] = useState<FirmNoteCategory[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // false when the server says this account can't manage categories
  const load = useCallback(async (): Promise<boolean> => {
    const s = await loadNoteCategories(true)
    setCats(s.custom)
    return s.can_manage
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }
    fetchWithAuth(`${API_URL}/api/auth/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (me) => {
        if (!me || me.account_type !== 'firm_admin' || !(await load())) {
          router.push('/account')
          return
        }
        setLoading(false)
      })
      .catch(() => router.push('/account'))
  }, [router, load])

  const save = async (c: FirmNoteCategory) => {
    const l = label.replace(/\s+/g, ' ').trim()
    if (!l) { setMsg({ kind: 'err', text: 'Enter a category name.' }); return }
    if (l === c.label) { setEditing(null); return }
    setBusy(c.id); setMsg(null)
    try {
      await renameNoteCategory(c.id, l)
      setEditing(null)
      setMsg({ kind: 'ok', text: `Renamed to "${l}". Every note in it shows the new name.` })
      await load()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not rename that category.' })
    } finally { setBusy(null) }
  }

  const remove = async (c: FirmNoteCategory) => {
    const n = c.used || 0
    const what = n ? `${n} ${n === 1 ? 'note uses' : 'notes use'} it and will show as "Note".` : 'No notes use it.'
    if (!window.confirm(`Delete the category "${c.label}"? ${what}`)) return
    setBusy(c.id); setMsg(null)
    try {
      await deleteNoteCategory(c.id)
      setMsg({ kind: 'ok', text: `Deleted "${c.label}".` })
      await load()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not delete that category.' })
    } finally { setBusy(null) }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-2xl mx-auto px-6">
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/account"
            className="w-10 h-10 bg-gg-gray-800 rounded-lg flex items-center justify-center text-gg-gray-400 hover:text-white hover:bg-gg-gray-700 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Note Categories</h1>
            <p className="text-gg-gray-400">Your firm&apos;s own categories in the notes Category dropdown</p>
          </div>
        </div>

        <div className="card mb-6" data-testid="note-categories-list">
          {cats.length === 0 ? (
            <p className="text-sm text-gg-gray-400">
              No firm categories yet. Anyone on your team can add one with <span className="text-white">Add New Category</span> at
              the bottom of the Category dropdown when writing a note.
            </p>
          ) : (
            <ul className="divide-y divide-gg-gray-800">
              {cats.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3" data-testid="note-category-row">
                  {editing === c.id ? (
                    <>
                      <input
                        className={INPUT}
                        value={label}
                        autoFocus
                        maxLength={FIRM_CATEGORY_MAX}
                        data-testid="note-category-edit-input"
                        onChange={(e) => setLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); void save(c) }
                          if (e.key === 'Escape') setEditing(null)
                        }}
                      />
                      <button onClick={() => void save(c)} disabled={busy === c.id}
                              className="btn-primary flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                              data-testid="note-category-save">
                        {busy === c.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                      </button>
                      <button onClick={() => setEditing(null)} disabled={busy === c.id} aria-label="Cancel"
                              className="p-2 rounded-lg border border-gg-gray-700 text-gg-gray-300 hover:text-white">
                        <X size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate">{c.label}</div>
                        <div className="text-xs text-gg-gray-500">
                          {(c.used || 0) === 0 ? 'Not used yet' : `Used on ${c.used} ${c.used === 1 ? 'note' : 'notes'}`}
                        </div>
                      </div>
                      <button onClick={() => { setEditing(c.id); setLabel(c.label); setMsg(null) }} disabled={!!busy}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gg-gray-700 text-gg-gray-300 hover:text-white hover:border-gg-gray-500 disabled:opacity-50"
                              data-testid="note-category-edit">
                        <Pencil size={14} /> Edit
                      </button>
                      <button onClick={() => void remove(c)} disabled={!!busy}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gg-gray-700 text-gg-gray-300 hover:text-red-400 hover:border-red-400/60 disabled:opacity-50"
                              data-testid="note-category-delete">
                        {busy === c.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="flex items-center gap-2 text-sm font-medium text-gg-gray-300 mb-2"><Tags size={16} /> Built-in categories</div>
          <p className="text-sm text-gg-gray-400">
            {NOTE_CATEGORIES.map((c) => c.label).join(' · ')}. These are always in the dropdown and can&apos;t be changed.
          </p>
        </div>

        {msg && (
          <div className={`mt-6 flex items-center gap-2 text-sm ${msg.kind === 'err' ? 'text-red-400' : 'text-green-400'}`}>
            {msg.kind === 'err' ? <AlertCircle size={16} /> : <Check size={16} />}
            {msg.text}
          </div>
        )}
      </div>
    </div>
  )
}
