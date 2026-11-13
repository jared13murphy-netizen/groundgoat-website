'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, Pencil, Trash2, AlertCircle, Archive, RotateCcw, Plus, Search, Package } from 'lucide-react'
import {
  addFirmProduct, deleteFirmProduct, fetchFirmProducts, productDetailParts, productMatches, updateFirmProduct,
  type FirmProduct, type ProductInput,
} from '@/lib/notes'
import ProductFields, { blankProduct } from '@/components/notes/ProductFields'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// Owner rules: inputs WHITE with a light gray border and dark text; buttons
// SOLID — pink + black text = primary, gray #E4E4E7 + black text = secondary.
const INPUT: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#FFFFFF', border: '1px solid #D1D5DB', borderRadius: 8,
  color: '#111111', padding: '8px 10px', fontSize: 14, fontFamily: 'inherit', marginTop: 3,
}
const LABEL: CSSProperties = { color: '#9CA3AF', fontSize: 12 }
const BTN = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-black whitespace-nowrap disabled:opacity-50'
const PRIMARY = `${BTN} bg-[#F58CDE] hover:brightness-95`
const SECONDARY = `${BTN} bg-[#E4E4E7] hover:bg-[#D4D4D8]`
const DANGER = `${BTN} bg-red-500 hover:bg-red-600 text-white`

const toInput = (p: FirmProduct): ProductInput => ({ kind: p.kind, name: p.name, brand: p.brand, epa_reg_no: p.epa_reg_no, variety: p.variety })
const notesWord = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`

/** Firm portal → Products (owner 11/12): the firm's fertilizer, chemical /
 *  herbicide, seed and other products used on notes. Everyone in the firm
 *  views and adds; the firm admin edits, retires / restores and deletes. A
 *  note keeps a COPY of each product as saved (plus its own rate): an edit
 *  changes only this list unless "Also update notes that already use this
 *  product" is ticked (unticked by default). Individuals never get here. */
export default function ProductsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<FirmProduct[]>([])
  const [canManage, setCanManage] = useState(false)
  const [showRetired, setShowRetired] = useState(false)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState<ProductInput | null>(null)
  const [editing, setEditing] = useState<{ id: string; p: ProductInput; updateExisting: boolean } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async (retired: boolean) => {
    const r = await fetchFirmProducts(retired)
    setProducts(r.products || [])
    setCanManage(!!r.can_manage)
    return r
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }
    fetchWithAuth(`${API_URL}/api/auth/me`)
      .then((r) => (r.ok ? r.json() : null))
      .then(async (me) => {
        if (!me || (me.account_type !== 'firm_admin' && me.account_type !== 'firm_user')) { router.push('/account'); return }
        const r = await load(false)
        if (!r.can_add) { router.push('/account'); return }
        setLoading(false)
      })
      .catch(() => router.push('/account'))
  }, [router, load])

  const toggleRetired = async (v: boolean) => {
    setShowRetired(v); setMsg(null)
    try { await load(v) } catch (e: any) { setMsg({ kind: 'err', text: e?.message || 'Could not load products.' }) }
  }

  const shown = useMemo(() => products.filter((p) => productMatches(p, q)), [products, q])

  const add = async () => {
    if (!adding) return
    if (!adding.name.trim()) { setMsg({ kind: 'err', text: 'Enter the product name.' }); return }
    setBusy('new'); setMsg(null)
    try {
      const p = await addFirmProduct(adding)
      setAdding(null)
      setMsg({ kind: 'ok', text: `Added "${p.name}". Everyone in your firm can pick it on a note.` })
      await load(showRetired)
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not add that product.' })
    } finally { setBusy(null) }
  }

  const saveEdit = async () => {
    if (!editing) return
    if (!editing.p.name.trim()) { setMsg({ kind: 'err', text: 'Enter the product name.' }); return }
    setBusy(editing.id); setMsg(null)
    try {
      const r = await updateFirmProduct(editing.id, { ...editing.p, update_existing: editing.updateExisting })
      setMsg({
        kind: 'ok',
        text: editing.updateExisting
          ? `Saved. Updated ${notesWord(r.updated_notes)}.`
          : 'Saved. Existing notes keep what they saved.',
      })
      setEditing(null)
      await load(showRetired)
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not save that product.' })
    } finally { setBusy(null) }
  }

  const setRetired = async (p: FirmProduct, retired: boolean) => {
    setBusy(p.id); setMsg(null)
    try {
      await updateFirmProduct(p.id, { retired, update_existing: false })
      setMsg({
        kind: 'ok',
        text: retired
          ? `Retired "${p.name}". It no longer shows when adding products to a note. Notes that used it keep it.`
          : `Restored "${p.name}". It shows on notes again.`,
      })
      await load(showRetired)
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not change that product.' })
    } finally { setBusy(null) }
  }

  const remove = async (p: FirmProduct) => {
    setBusy(p.id); setMsg(null)
    try {
      const r = await deleteFirmProduct(p.id)
      setConfirmDelete(null)
      setMsg({ kind: 'ok', text: `Deleted "${p.name}".${r.notes_kept ? ` ${notesWord(r.notes_kept)} keep their copy.` : ''}` })
      await load(showRetired)
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not delete that product.' })
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
            <h1 className="font-display text-3xl font-bold text-white">Products</h1>
            <p className="text-gg-gray-400">Your firm&apos;s products for notes. The rate goes on each note.</p>
          </div>
        </div>

        {/* Add — every firm member */}
        <div className="card mb-6" data-testid="products-add-card">
          {adding ? (
            <div className="flex flex-col gap-3">
              <div className="text-white font-medium">New product</div>
              <ProductFields value={adding} onChange={setAdding} inputStyle={INPUT} labelStyle={LABEL}
                             onEnter={() => void add()} autoFocus testPrefix="products-new" />
              <div className="flex gap-2">
                <button onClick={() => void add()} disabled={busy === 'new'} className={PRIMARY} data-testid="products-new-save">
                  {busy === 'new' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Add product
                </button>
                <button onClick={() => setAdding(null)} disabled={busy === 'new'} className={SECONDARY}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <p className="flex-1 text-sm text-gg-gray-400">
                Anyone on your team can add a product here or from a note.
                {canManage ? ' Only you can edit, retire or delete them.' : ' Your firm admin can edit, retire or delete them.'}
              </p>
              <button onClick={() => { setAdding(blankProduct()); setMsg(null) }} className={PRIMARY} data-testid="products-add">
                <Plus size={14} /> Add product
              </button>
            </div>
          )}
        </div>

        {msg && (
          <div data-testid="products-msg" className={`mb-4 flex items-center gap-2 text-sm ${msg.kind === 'err' ? 'text-red-400' : 'text-green-400'}`}>
            {msg.kind === 'err' ? <AlertCircle size={16} /> : <Check size={16} />}
            {msg.text}
          </div>
        )}

        <div className="card" data-testid="products-list">
          <div className="flex items-center gap-3 mb-3 flex-wrap">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={14} className="absolute left-3 top-[14px] text-gray-400" />
              <input style={{ ...INPUT, paddingLeft: 32 }} placeholder="Search name, brand, EPA no." value={q}
                     data-testid="products-search" onChange={(e) => setQ(e.target.value)} />
            </div>
            {canManage && (
              <label className="flex items-center gap-2 text-sm text-gg-gray-300 cursor-pointer">
                <input type="checkbox" checked={showRetired} data-testid="products-show-retired"
                       onChange={(e) => void toggleRetired(e.target.checked)} />
                Show retired
              </label>
            )}
          </div>

          {products.length === 0 ? (
            <p className="text-sm text-gg-gray-400">No products yet. Add your fertilizers, chemicals and seed so your team can pick them on a note.</p>
          ) : shown.length === 0 ? (
            <p className="text-sm text-gg-gray-400">No products match.</p>
          ) : (
            <ul className="divide-y divide-gg-gray-800">
              {shown.map((p) => (
                <li key={p.id} className="py-3" data-testid="product-row" data-retired={p.retired ? '1' : '0'}>
                  {editing?.id === p.id ? (
                    <div className="flex flex-col gap-3" data-testid="product-edit">
                      <ProductFields value={editing.p} onChange={(np) => setEditing({ ...editing, p: np })} inputStyle={INPUT}
                                     labelStyle={LABEL} onEnter={() => void saveEdit()} autoFocus testPrefix="product-edit" />
                      <label className="flex items-start gap-2 text-sm text-white cursor-pointer">
                        <input type="checkbox" className="mt-1" checked={editing.updateExisting} data-testid="product-update-existing"
                               onChange={(e) => setEditing({ ...editing, updateExisting: e.target.checked })} />
                        <span>
                          Also update notes that already use this product
                          <span className="block text-xs text-gg-gray-400" data-testid="product-update-existing-help">
                            {editing.updateExisting
                              ? `Every note using it${p.notes_using != null ? ` (${notesWord(p.notes_using)})` : ''} gets the new details. Each note keeps its own rate.`
                              : 'Off: only the product list changes. Notes keep what they saved.'}
                          </span>
                        </span>
                      </label>
                      <div className="flex gap-2">
                        <button onClick={() => void saveEdit()} disabled={busy === p.id} className={PRIMARY} data-testid="product-save">
                          {busy === p.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
                        </button>
                        <button onClick={() => setEditing(null)} disabled={busy === p.id} className={SECONDARY}>Cancel</button>
                      </div>
                    </div>
                  ) : confirmDelete === p.id ? (
                    <div className="flex flex-col gap-2" data-testid="product-delete-confirm">
                      <div className="text-sm text-white">
                        Delete &quot;{p.name}&quot; from your products?{' '}
                        <span className="text-gg-gray-400">
                          {p.notes_using ? `${notesWord(p.notes_using)} keep their copy.` : 'No notes use it.'} This can&apos;t be undone.
                          {!p.retired && ' To just hide it from notes, Retire it instead.'}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => void remove(p)} disabled={busy === p.id} className={DANGER} data-testid="product-delete-yes">
                          {busy === p.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Delete
                        </button>
                        <button onClick={() => setConfirmDelete(null)} disabled={busy === p.id} className={SECONDARY}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 flex-wrap">
                      <Package size={16} className={p.retired ? 'text-gg-gray-600' : 'text-gg-gray-400'} />
                      <div className="flex-1 min-w-[160px]">
                        <div className={`font-medium break-words ${p.retired ? 'text-gg-gray-500' : 'text-white'}`}>
                          {productDetailParts(p).join(' · ')}
                        </div>
                        <div className="text-xs text-gg-gray-500">
                          {p.kind_label}
                          {p.retired && <span className="ml-2 px-1.5 py-0.5 rounded bg-gg-gray-700 text-gg-gray-300">Retired</span>}
                          {canManage && p.notes_using != null && (
                            <span className="ml-2">{p.notes_using === 0 ? 'Not used yet' : `Used on ${notesWord(p.notes_using)}`}</span>
                          )}
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex gap-2 flex-wrap">
                          <button onClick={() => { setEditing({ id: p.id, p: toInput(p), updateExisting: false }); setConfirmDelete(null); setMsg(null) }}
                                  disabled={!!busy} className={SECONDARY} data-testid="product-edit-btn">
                            <Pencil size={14} /> Edit
                          </button>
                          <button onClick={() => void setRetired(p, !p.retired)} disabled={!!busy} className={SECONDARY}
                                  data-testid={p.retired ? 'product-restore' : 'product-retire'}
                                  title={p.retired ? 'Show it on notes again' : 'Hide it when adding products to a note. Notes that used it keep it.'}>
                            {busy === p.id ? <Loader2 size={14} className="animate-spin" /> : p.retired ? <RotateCcw size={14} /> : <Archive size={14} />}
                            {p.retired ? 'Restore' : 'Retire'}
                          </button>
                          <button onClick={() => { setConfirmDelete(p.id); setEditing(null); setMsg(null) }} disabled={!!busy}
                                  className={SECONDARY} data-testid="product-delete">
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
