// Owner 2026-11-03: "These cards should never read cached data, only the
// exact data that goes along with the parcel or tract." A parcel report row
// is built once (click, drag, Add All) and then lives in page state; the
// parcel's stored figures can change underneath it (a state recompute, the
// on-demand per-parcel refresh the detail panel triggers). So every time a
// report panel opens, each parcel row re-reads its tillable acres, % tillable
// and soil rating from the ONE parcel source the detail panel reads
// (/api/parcel-enrichment/by-uuid) and patches the row. Tract and saved-tract
// rows are untouched.
import { useEffect, useRef } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import type { TractSaleData } from '@/components/portal/PortalTractDetail'
import { figuresPatch } from '@/lib/parcelFiguresPatch'
import { findServerFigures, fromServerFigures, parcelRowFields } from '@/lib/parcelFigures'
import { tractPriceMode } from '@/lib/priceDisplay'

export { figuresPatch }

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parcelRowUuid(t: TractSaleData): string | null {
  if (t.tractId || t.savedId) return null
  const id = t.llUuid || t.id
  return id && UUID_RE.test(id) ? id : null
}

export default function useFreshParcelFigures(
  rows: TractSaleData[],
  onUpdate?: (id: string, patch: Partial<TractSaleData>) => void,
) {
  const done = useRef<Set<string>>(new Set())
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate
  const key = rows.map(t => t.id).join('|')
  useEffect(() => {
    for (const t of rows) {
      const uuid = parcelRowUuid(t)
      if (!uuid || done.current.has(t.id)) continue
      done.current.add(t.id)
      const rowId = t.id
      fetchWithAuth(`${API_URL}/api/parcel-enrichment/by-uuid?ll_uuid=${encodeURIComponent(uuid)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(f => {
          // Server `figures` (owner 11/19): the row takes every figure from
          // it — price, acres, tillable, rating and the rates. Old API: the
          // tillable / % / rating patch as before.
          const sf = findServerFigures(f)
          const patch: Partial<TractSaleData> = sf
            ? parcelRowFields(fromServerFigures(sf), tractPriceMode({ total_acres: sf.acres as any, land_types: sf.land_types ?? null }))
            : figuresPatch(f)
          if (Object.keys(patch).length) onUpdateRef.current?.(rowId, patch)
        })
        .catch(() => { done.current.delete(rowId) })
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}
