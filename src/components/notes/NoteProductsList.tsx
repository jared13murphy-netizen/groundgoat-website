'use client'

/** A note's products, one compact line each (owner 11/12):
 *  "Potash 0-0-60 · Mosaic · 150 lb/ac", chemical adds "EPA 100-497". */
import type { CSSProperties } from 'react'
import { Package } from 'lucide-react'
import { productLineText, type NoteProductLine } from '@/lib/notes'

export default function NoteProductsList({ products, color, iconColor, style }: {
  products: NoteProductLine[] | undefined
  color: string
  iconColor?: string
  style?: CSSProperties
}) {
  if (!products?.length) return null
  return (
    <ul data-testid="notes-entry-products" style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 2, ...style }}>
      {products.map((p, i) => (
        <li key={`${p.product_id || 'x'}-${i}`} data-testid="notes-entry-product"
            style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 11.5, lineHeight: 1.35, color, wordBreak: 'break-word' }}>
          <Package size={11} style={{ flexShrink: 0, marginTop: 2, color: iconColor || color }} aria-label={p.kind_label} />
          <span title={p.kind_label}>{productLineText(p)}</span>
        </li>
      ))}
    </ul>
  )
}
