'use client'

/**
 * The fields of one firm product (owner 11/12): type, name, and — by type —
 * Company / Brand + Hybrid / variety (seed) or Brand / Manufacturer + EPA
 * Reg. No. (everything else). Used by the note editor's "Add new product"
 * and the map's Products slide-out.
 *
 * Owner rule: inputs are ALWAYS white with a light gray border, dark text.
 */
import type { CSSProperties } from 'react'
import { PRODUCT_KINDS, productFieldLabels, type ProductInput, type ProductKind } from '@/lib/notes'

export const blankProduct = (kind: ProductKind = 'fertilizer'): ProductInput => ({ kind, name: '', brand: '', epa_reg_no: '', variety: '' })

export default function ProductFields({
  value, onChange, inputStyle, labelStyle, onEnter, autoFocus = false, testPrefix = 'product',
}: {
  value: ProductInput
  onChange: (p: ProductInput) => void
  inputStyle: CSSProperties
  labelStyle?: CSSProperties
  onEnter?: () => void
  autoFocus?: boolean
  testPrefix?: string
}) {
  const f = productFieldLabels(value.kind)
  const lab: CSSProperties = { display: 'block', fontSize: 10, ...labelStyle }
  const key = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter() } }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6 }}>
      <label style={lab}>Type
        <select style={inputStyle} value={value.kind} data-testid={`${testPrefix}-kind`}
                onChange={(e) => onChange({ ...value, kind: e.target.value as ProductKind })}>
          {PRODUCT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label style={lab}>Product name
        <input style={inputStyle} value={value.name} maxLength={120} autoFocus={autoFocus} data-testid={`${testPrefix}-name`}
               placeholder={value.kind === 'seed' ? 'Corn' : value.kind === 'chemical' ? 'Roundup PowerMAX' : 'Potash 0-0-60'}
               onKeyDown={key} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      </label>
      <label style={lab}>{f.brand}
        <input style={inputStyle} value={value.brand} maxLength={120} data-testid={`${testPrefix}-brand`}
               onKeyDown={key} onChange={(e) => onChange({ ...value, brand: e.target.value })} />
      </label>
      <label style={lab}>{f.extra}
        <input style={inputStyle} value={value[f.extraKey]} maxLength={f.extraKey === 'variety' ? 120 : 40}
               data-testid={`${testPrefix}-${f.extraKey === 'variety' ? 'variety' : 'epa'}`}
               onKeyDown={key} onChange={(e) => onChange({ ...value, [f.extraKey]: e.target.value })} />
      </label>
    </div>
  )
}
