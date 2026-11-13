/**
 * Firm products on notes (owner 11/12): plain helpers with no imports so
 * the unit test can run them under bare node.
 */

export type ProductKind = 'fertilizer' | 'chemical' | 'seed' | 'other'

export const PRODUCT_KINDS: { value: ProductKind; label: string }[] = [
  { value: 'fertilizer', label: 'Fertilizer' },
  { value: 'chemical', label: 'Chemical / Herbicide' },
  { value: 'seed', label: 'Seed' },
  { value: 'other', label: 'Other' },
]

/** The product's own details (no rate). Seed: brand = Company / Brand and
 *  variety = Hybrid / variety, no EPA number. Others: brand = Brand /
 *  Manufacturer and an optional EPA Reg. No., no variety. */
export interface ProductDetails {
  kind: string
  name: string
  brand?: string | null
  epa_reg_no?: string | null
  variety?: string | null
}

/** "Potash 0-0-60", "Mosaic", "EPA 100-497" / variety — what identifies it. */
export function productDetailParts(p: ProductDetails): string[] {
  const seed = p.kind === 'seed'
  const out = [p.name, p.brand]
  if (seed) out.push(p.variety)
  else if (p.epa_reg_no) out.push(`EPA ${p.epa_reg_no}`)
  return out.map((x) => (x || '').trim()).filter(Boolean)
}

/** One note line: "Potash 0-0-60 · Mosaic · 150 lb/ac". */
export function productLineText(p: ProductDetails & { rate?: string | null }): string {
  return [...productDetailParts(p), (p.rate || '').trim()].filter(Boolean).join(' · ')
}

/** Does a product match the picker's search text? Name, brand, EPA, variety. */
export function productMatches(p: ProductDetails, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return true
  const hay = [p.name, p.brand, p.epa_reg_no, p.variety].map((x) => (x || '').toLowerCase()).join(' ')
  return words.every((w) => hay.includes(w))
}

/** The labels for the brand / extra fields of a kind. */
export function productFieldLabels(kind: string): { brand: string; extra: string; extraKey: 'variety' | 'epa_reg_no' } {
  return kind === 'seed'
    ? { brand: 'Company / Brand', extra: 'Hybrid / variety', extraKey: 'variety' }
    : { brand: 'Brand / Manufacturer', extra: 'EPA Reg. No. (optional)', extraKey: 'epa_reg_no' }
}
