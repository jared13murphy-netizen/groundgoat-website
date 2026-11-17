'use client'

/**
 * ProductsPanel — the firm's product list as a slide-out over the Explore
 * map (owner 11/13: nobody leaves the map to manage products). Opened from
 * the My Maps "Products" row; the shared My Maps screen design
 * (MyMapsShell, owner 11/15).
 *
 * Everyone in the firm views and adds; the firm admin edits (with Retire /
 * Restore inside Edit) and deletes. A note keeps a COPY of each product as
 * saved: an edit changes only this list unless "Also update notes that
 * already use this product" is ticked (unticked by default).
 * Backend: /api/notes/products (firm_products.py).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Archive, Check, ChevronDown, ChevronRight, Loader2, Package, RotateCcw, Trash2 } from 'lucide-react'
import {
  addFirmProduct, deleteFirmProduct, fetchFirmProducts, productDetailParts, productMatches, updateFirmProduct,
  type FirmProduct, type ProductInput,
} from '@/lib/notes'
import ProductFields, { blankProduct, productReady } from '@/components/notes/ProductFields'
import MyMapsShell, { CardPicture, ListEmpty, MyMapsCard, Tag, applyControls, fmtModified, useListControls } from '@/components/mapping/MyMapsShell'

const PINK = '#F58CDE'

// Owner 11/3: inputs are ALWAYS white with a light gray border.
const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#FFFFFF',
  border: '1px solid #D1D5DB', borderRadius: 8, color: '#111111',
  padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', marginTop: 3,
}
const label: CSSProperties = { color: 'rgba(255,255,255,0.6)', fontSize: 10 }
const muted: CSSProperties = { color: 'rgba(255,255,255,0.6)', fontSize: 11 }
// Owner 11/12: buttons are SOLID — pink + black text = primary,
// gray #E4E4E7 + black text = secondary.
const pinkBtn: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 999,
  background: PINK, color: '#000', border: `1px solid ${PINK}`, fontSize: 12, fontWeight: 700,
  cursor: 'pointer', whiteSpace: 'nowrap',
}
const grayBtn: CSSProperties = { ...pinkBtn, background: '#E4E4E7', border: '1px solid #E4E4E7' }
// Disabled primary: solid gray, muted text (owner 11/15: Add stays off until the required fields are filled).
const offBtn: CSSProperties = { ...pinkBtn, background: '#E4E4E7', border: '1px solid #E4E4E7', color: '#71717A', cursor: 'not-allowed' }
const redBtn: CSSProperties = { ...pinkBtn, background: '#EF4444', border: '1px solid #EF4444', color: '#fff' }

const toInput = (p: FirmProduct): ProductInput => ({ kind: p.kind, name: p.name, brand: p.brand, epa_reg_no: p.epa_reg_no, variety: p.variety })
const notesWord = (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`

interface Props {
  open: boolean
  onClose: () => void
  /** Back to the My Maps menu. */
  onBack: () => void
  /** Bumped by My Maps "+ New Product": open with the Add form showing. */
  addNonce?: number
}

export default function ProductsPanel({ open, onClose, onBack, addNonce = 0 }: Props) {
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [products, setProducts] = useState<FirmProduct[]>([])
  const [canManage, setCanManage] = useState(false)
  // Ground Goat admins share one staff list (owner 11/16): no firm, no team.
  const [staff, setStaff] = useState(false)
  const [adding, setAdding] = useState<ProductInput | null>(null)
  const [editing, setEditing] = useState<{ id: string; p: ProductInput; updateExisting: boolean } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [retiredOpen, setRetiredOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const c = useListControls()

  // The admin's list includes retired products (their own section below).
  const load = useCallback(async () => {
    setLoading(true)
    try {
      let r = await fetchFirmProducts(false)
      if (r.can_manage) r = await fetchFirmProducts(true)
      setProducts(r.products || [])
      setCanManage(!!r.can_manage)
      setStaff(r.scope === 'staff')
      setLoaded(true)
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not load products.' })
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (!open) return
    setMsg(null); setAdding(null); setEditing(null); setConfirmDelete(null)
    void load()
  }, [open, load])
  // "+ New Product" in My Maps: the panel opens with the Add form up.
  const firstAdd = useRef(addNonce)
  useEffect(() => {
    if (addNonce === firstAdd.current) return
    setAdding(blankProduct()); setEditing(null); setConfirmDelete(null); setMsg(null)
  }, [addNonce])

  const ctl = useMemo(() => applyControls(products.filter((p) => !p.retired), c, {
    mine: (p) => !!p.mine,
    name: (p) => `${p.name} ${p.brand} ${p.variety}`,
    modified: (p) => p.updated_at || p.created_at,
    text: (p) => [p.name, p.brand, p.variety, p.epa_reg_no, p.kind_label].join(' '),
  }), [products, c])
  const active = ctl.shown
  // Retired (admin only) stay in their own section; the search still finds them.
  const retired = useMemo(() => products.filter((p) => p.retired && productMatches(p, c.q)), [products, c.q])

  const add = async () => {
    if (!adding) return
    if (!adding.name.trim()) { setMsg({ kind: 'err', text: 'Enter the product name.' }); return }
    setBusy('new'); setMsg(null)
    try {
      const p = await addFirmProduct(adding)
      setAdding(null)
      setMsg({ kind: 'ok', text: `Added "${p.name}". ${staff ? 'Every Ground Goat admin' : 'Everyone in your firm'} can pick it on a note.` })
      await load()
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
      await load()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not save that product.' })
    } finally { setBusy(null) }
  }

  const setRetired = async (p: FirmProduct, isRetired: boolean) => {
    setBusy(p.id); setMsg(null)
    try {
      await updateFirmProduct(p.id, { retired: isRetired, update_existing: false })
      setMsg({
        kind: 'ok',
        text: isRetired
          ? `Retired "${p.name}". It no longer shows when adding products to a note. Notes that used it keep it.`
          : `Restored "${p.name}". It shows on notes again.`,
      })
      setEditing(null)
      await load()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not change that product.' })
    } finally { setBusy(null) }
  }

  const remove = async (p: FirmProduct) => {
    setBusy(p.id); setMsg(null)
    try {
      const r = await deleteFirmProduct(p.id)
      setConfirmDelete(null)
      setMsg({ kind: 'ok', text: `Deleted "${p.name}".${r.notes_kept ? ` ${r.notes_kept === 1 ? 'The note that used it keeps its copy.' : `The ${r.notes_kept} notes that used it keep their copy.`}` : ''}` })
      await load()
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.message || 'Could not delete that product.' })
    } finally { setBusy(null) }
  }

  const row = (p: FirmProduct) => (
    <MyMapsCard key={p.id} testId="product-row" dim={p.retired}
                picture={<CardPicture icon={<Package size={26} />} />}
                title={p.name}
                sub={[productDetailParts(p).slice(1).join(' · '), fmtModified(p.updated_at || p.created_at)].filter(Boolean).join(' · ')}
                tags={[<Tag key="k">{p.kind_label}</Tag>,
                       canManage && p.notes_using != null ? <Tag key="u">{p.notes_using === 0 ? 'Not used yet' : `Used on ${notesWord(p.notes_using)}`}</Tag> : null,
                       p.retired ? <Tag key="r">Retired</Tag> : null]}
                actions={canManage && !busy ? [
                  { label: 'Edit', testId: 'product-edit-btn', onClick: () => { setEditing({ id: p.id, p: toInput(p), updateExisting: false }); setConfirmDelete(null); setAdding(null); setMsg(null) } },
                  { label: p.retired ? 'Restore' : 'Retire', testId: p.retired ? 'product-restore-menu' : 'product-retire-menu', onClick: () => void setRetired(p, !p.retired) },
                  { label: 'Delete', danger: true, testId: 'product-delete', onClick: () => { setConfirmDelete(p.id); setEditing(null); setMsg(null) } },
                ] : []}>
      <div data-retired={p.retired ? '1' : '0'}>
      {editing?.id === p.id ? (
        <div data-testid="product-edit" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ProductFields value={editing.p} onChange={(np) => setEditing({ ...editing, p: np })} inputStyle={input}
                         labelStyle={label} onEnter={() => { if (productReady(editing.p)) void saveEdit() }} autoFocus testPrefix="product-edit" />
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, cursor: 'pointer' }}>
            <input type="checkbox" style={{ marginTop: 2 }} checked={editing.updateExisting} data-testid="product-update-existing"
                   onChange={(e) => setEditing({ ...editing, updateExisting: e.target.checked })} />
            <span>
              Also update notes that already use this product
              <span style={{ ...muted, display: 'block' }} data-testid="product-update-existing-help">
                {editing.updateExisting
                  ? `Every note using it${p.notes_using != null ? ` (${notesWord(p.notes_using)})` : ''} gets the new details. Each note keeps its own rate.`
                  : 'Off: only the product list changes. Notes keep what they saved.'}
              </span>
            </span>
          </label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" style={productReady(editing.p) ? pinkBtn : offBtn} disabled={busy === p.id || !productReady(editing.p)} onClick={() => void saveEdit()} data-testid="product-save">
              {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
            </button>
            <button type="button" style={grayBtn} disabled={busy === p.id} onClick={() => setEditing(null)}>Cancel</button>
            <button type="button" style={{ ...grayBtn, marginLeft: 'auto' }} disabled={busy === p.id}
                    data-testid={p.retired ? 'product-restore' : 'product-retire'}
                    title={p.retired ? 'Show it on notes again' : 'Hide it when adding products to a note. Notes that used it keep it.'}
                    onClick={() => void setRetired(p, !p.retired)}>
              {p.retired ? <RotateCcw size={13} /> : <Archive size={13} />} {p.retired ? 'Restore' : 'Retire'}
            </button>
          </div>
        </div>
      ) : confirmDelete === p.id ? (
        <div data-testid="product-delete-confirm" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 12 }}>
            Delete &quot;{p.name}&quot; from your products?{' '}
            <span style={muted}>
              {p.notes_using ? (p.notes_using === 1 ? 'The note that uses it keeps its copy.' : `The ${p.notes_using} notes that use it keep their copy.`) : 'No notes use it.'} This can&apos;t be undone.
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={redBtn} disabled={busy === p.id} onClick={() => void remove(p)} data-testid="product-delete-yes">
              {busy === p.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
            </button>
            <button type="button" style={grayBtn} disabled={busy === p.id} onClick={() => setConfirmDelete(null)}>Cancel</button>
          </div>
        </div>
      ) : null}
      </div>
    </MyMapsCard>
  )

  return (
    <MyMapsShell open={open} title="Products" onBack={onBack} onClose={onClose} controls={c}
                 searchPlaceholder="Search products" showChips={!staff} counts={ctl.counts} testId="products-panel"
                 dataAttr={{ 'data-gg-products-panel': '' }}
                 onNew={() => { setAdding(adding ? null : blankProduct()); setEditing(null); setConfirmDelete(null); setMsg(null) }}
                 top={<>
                   {adding && (
                     <div data-testid="products-add-form" style={{ display: 'flex', flexDirection: 'column', gap: 8, background: '#161616', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, padding: 10 }}>
                       <div style={{ fontWeight: 700, fontSize: 14 }}>New product</div>
                       <ProductFields value={adding} onChange={setAdding} inputStyle={input} labelStyle={label}
                                      onEnter={() => { if (productReady(adding)) void add() }} autoFocus testPrefix="products-new" />
                       <div style={{ display: 'flex', gap: 6 }}>
                         <button type="button" style={productReady(adding) ? pinkBtn : offBtn} disabled={busy === 'new' || !productReady(adding)} onClick={() => void add()} data-testid="products-new-save">
                           {busy === 'new' ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Add
                         </button>
                         <button type="button" style={grayBtn} disabled={busy === 'new'} onClick={() => setAdding(null)}>Cancel</button>
                       </div>
                     </div>
                   )}
                   {msg && (
                     <div data-testid="products-msg" style={{ fontSize: 12, color: msg.kind === 'err' ? '#fca5a5' : '#86efac' }}>{msg.text}</div>
                   )}
                 </>}>
      <div data-testid="products-list" style={{ display: 'contents' }}>
        {loading && !loaded && (
          <div style={{ ...muted, padding: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Loader2 size={13} className="animate-spin" /> Loading…
          </div>
        )}
        {loaded && !products.length && (
          <ListEmpty>No products yet. Add your fertilizers, chemicals and seed so your team can pick them on a note.</ListEmpty>
        )}
        {loaded && products.length > 0 && !active.length && !retired.length && <ListEmpty>Nothing matches.</ListEmpty>}
        {active.map(row)}
        {canManage && retired.length > 0 && (
          <div data-testid="products-retired" style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button type="button" onClick={() => setRetiredOpen((v) => !v)}
                    style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}>
              {retiredOpen || c.q ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Retired ({retired.length})
            </button>
            {(retiredOpen || !!c.q) && retired.map(row)}
          </div>
        )}
        {loaded && (
          <div style={{ ...muted, padding: '4px 2px' }}>
            {staff
              ? 'Shared by every Ground Goat admin: anyone can add, edit or delete. Firms never see this list.'
              : <>Anyone on your team can add a product here or from a note.
                  {canManage ? ' Only you can edit or delete them.' : ' Your firm admin can edit or delete them.'}</>}
          </div>
        )}
      </div>
    </MyMapsShell>
  )
}
