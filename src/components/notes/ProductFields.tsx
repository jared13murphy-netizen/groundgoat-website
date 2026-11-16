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

// The backend requires only the type and the product name; the Add / Save
// buttons stay disabled until the name is filled.
export const productReady = (p: ProductInput) => p.name.trim() !== ''

// Native select arrows sit against the edge; draw our own with room on the right.
const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23111111' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")"

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
        <select style={{ ...inputStyle, appearance: 'none', WebkitAppearance: 'none', paddingRight: 32,
                         backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                value={value.kind} data-testid={`${testPrefix}-kind`}
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
