'use client'

/**
 * The note editor's "Products" section (owner 11/12, management firms
 * only): pick from the firm's active products — or add a new one right
 * here — and give each its own rate for this note. The note saves a COPY
 * of each product; the rate lives on the note, never on the product.
 *
 * Owner rules: inputs WHITE with a light gray border; buttons SOLID
 * (pink + black text = primary, gray #E4E4E7 + black text = secondary).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Loader2, Package, Plus, Search, X } from 'lucide-react'
import {
  MAX_NOTE_PRODUCTS, addFirmProduct, firmProductsSnapshot, loadFirmProducts, productDetailParts, productMatches,
  subscribeFirmProducts, type FirmProduct, type NoteProductLine, type ProductInput, type ProductsState,
} from '@/lib/notes'
import ProductFields, { blankProduct } from './ProductFields'

const PINK = '#F58CDE'
export const solidPrimary: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11, fontWeight: 700,
  borderRadius: 7, background: PINK, color: '#000', border: 'none', cursor: 'pointer',
}
export const solidSecondary: CSSProperties = { ...solidPrimary, background: '#E4E4E7', fontWeight: 600 }

/** The firm's active products, shared by every editor on the page. */
export function useFirmProducts(enabled: boolean): ProductsState {
  const [s, setS] = useState<ProductsState>(firmProductsSnapshot())
  useEffect(() => {
    if (!enabled) return
    const off = subscribeFirmProducts(setS)
    void loadFirmProducts().then(setS)
    return off
  }, [enabled])
  return s
}

export const lineFromProduct = (p: FirmProduct, rate = ''): NoteProductLine => ({
  product_id: p.id, kind: p.kind, kind_label: p.kind_label, name: p.name, brand: p.brand,
  epa_reg_no: p.epa_reg_no, variety: p.variety, rate,
})

export default function NoteProductsEditor({
  lines, onChange, canAdd, inputStyle, colors,
}: {
  lines: NoteProductLine[]
  onChange: (lines: NoteProductLine[]) => void
  canAdd: boolean
  inputStyle: CSSProperties
  colors: { text: string; muted: string; faint: string; line: string }
}) {
  const st = useFirmProducts(true)
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState<ProductInput | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const chosen = useMemo(() => new Set(lines.map((l) => l.product_id).filter(Boolean) as string[]), [lines])
  const matches = useMemo(
    () => st.products.filter((p) => !chosen.has(p.id) && productMatches(p, q)).slice(0, 50),
    [st.products, chosen, q],
  )
  const full = lines.length >= MAX_NOTE_PRODUCTS

  const pick = (p: FirmProduct) => {
    onChange([...lines, lineFromProduct(p)])
    setPicking(false); setQ(''); setErr(null)
  }

  const saveNew = async () => {
    if (!adding) return
    if (!adding.name.trim()) { setErr('Enter the product name'); return }
    setSaving(true); setErr(null)
    try {
      const p = await addFirmProduct(adding)
      onChange([...lines, lineFromProduct(p)])
      setAdding(null); setPicking(false); setQ('')
    } catch (e: any) {
      setErr(e?.message || 'Could not add that product')
    } finally { setSaving(false) }
  }

  const iconBtn: CSSProperties = { background: 'none', border: 'none', color: colors.muted, cursor: 'pointer', padding: 2, display: 'inline-flex', flexShrink: 0 }

  return (
    <div data-testid="notes-products" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ fontSize: 10, color: colors.muted }}>Products</div>

      {lines.map((l, i) => {
        const gone = !l.product_id
        return (
          <div key={l.id || `${l.product_id || 'gone'}-${i}`} data-testid="notes-product-line"
               style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px', borderRadius: 8, border: `1px solid ${colors.line}` }}>
            <Package size={12} style={{ color: colors.muted, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: colors.text, wordBreak: 'break-word' }}>
                {productDetailParts(l).join(' · ')}
              </div>
              <div style={{ fontSize: 10, color: colors.faint }}>
                {l.kind_label}{gone ? ' · no longer in your products list' : ''}
              </div>
            </div>
            <input style={{ ...inputStyle, width: 110, flexShrink: 0 }} value={l.rate} maxLength={60}
                   placeholder={l.kind === 'seed' ? '34,000 seeds/ac' : l.kind === 'chemical' ? '32 oz/ac' : '150 lb/ac'}
                   aria-label={`Rate for ${l.name}`} data-testid="notes-product-rate" title="Rate on this note"
                   onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)))} />
            <button type="button" style={iconBtn} aria-label={`Remove ${l.name}`} data-testid="notes-product-remove"
                    onClick={() => onChange(lines.filter((_, j) => j !== i))}><X size={13} /></button>
          </div>
        )
      })}

      {full ? (
        <div style={{ fontSize: 10, color: colors.faint }}>Up to {MAX_NOTE_PRODUCTS} products on a note.</div>
      ) : adding ? (
        <div data-testid="notes-product-new" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, borderRadius: 8, border: `1px solid ${colors.line}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: colors.text }}>New product</div>
          <ProductFields value={adding} onChange={setAdding} inputStyle={inputStyle} labelStyle={{ color: colors.muted }}
                         onEnter={() => void saveNew()} autoFocus testPrefix="notes-product-new" />
          <div style={{ fontSize: 10, color: err ? '#f87171' : colors.faint }}>
            {err || 'Everyone in your firm will see this product.'}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={{ ...solidPrimary, opacity: saving ? 0.7 : 1 }} disabled={saving}
                    data-testid="notes-product-new-save" onClick={() => void saveNew()}>
              {saving ? <Loader2 size={11} className="animate-spin" /> : null} Add product
            </button>
            <button type="button" style={solidSecondary} disabled={saving} onClick={() => { setAdding(null); setErr(null) }}>Cancel</button>
          </div>
        </div>
      ) : picking ? (
        <div data-testid="notes-product-picker" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={12} style={{ position: 'absolute', left: 8, top: 8, color: '#9CA3AF' }} />
              <input style={{ ...inputStyle, paddingLeft: 26 }} autoFocus placeholder="Search name, brand, EPA no." value={q}
                     data-testid="notes-product-search" onChange={(e) => setQ(e.target.value)}
                     onKeyDown={(e) => {
                       if (e.key === 'Escape') { setPicking(false); setQ('') }
                       if (e.key === 'Enter') { e.preventDefault(); if (matches.length === 1) pick(matches[0]) }
                     }} />
            </div>
            <button type="button" style={solidSecondary} onClick={() => { setPicking(false); setQ('') }}>Close</button>
          </div>
          <div style={{ maxHeight: 180, overflowY: 'auto', borderRadius: 8, border: '1px solid #D1D5DB', background: '#FFFFFF' }}>
            {!st.loaded ? (
              <div style={{ padding: '6px 8px', fontSize: 11, color: '#6B7280' }}>Loading…</div>
            ) : matches.length === 0 ? (
              <div style={{ padding: '6px 8px', fontSize: 11, color: '#6B7280' }}>
                {st.products.length === 0 ? 'No products yet.' : q.trim() ? 'No match.' : 'All your products are on this note.'}
              </div>
            ) : matches.map((p) => (
              <button key={p.id} type="button" data-testid="notes-product-option" onClick={() => pick(p)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', background: '#FFFFFF', border: 'none',
                               borderBottom: '1px solid #F3F4F6', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: '#111' }}>{productDetailParts(p).join(' · ')}</span>
                <span style={{ display: 'block', fontSize: 10, color: '#6B7280' }}>{p.kind_label}</span>
              </button>
            ))}
            {canAdd && (
              <button type="button" data-testid="notes-product-add-new"
                      onClick={() => { setErr(null); setAdding({ ...blankProduct(), name: q.trim() }) }}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%', textAlign: 'left', padding: '7px 8px', background: '#FFFFFF',
                               border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: '#111', fontFamily: 'inherit' }}>
                <Plus size={12} /> Add new product{q.trim() ? ` "${q.trim()}"` : ''}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <button type="button" style={solidSecondary} data-testid="notes-product-add" onClick={() => { setPicking(true); setErr(null) }}>
            <Plus size={11} /> Add product
          </button>
        </div>
      )}
    </div>
  )
}
