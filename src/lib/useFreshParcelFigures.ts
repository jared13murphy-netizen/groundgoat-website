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

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function parcelRowUuid(t: TractSaleData): string | null {
  if (t.tractId || t.savedId) return null
  const id = t.llUuid || t.id
  return id && UUID_RE.test(id) ? id : null
}

export function figuresPatch(f: any): Partial<TractSaleData> {
  const patch: Partial<TractSaleData> = {}
  if (!f) return patch
  if (f.tillable_acres != null) patch.tillableAcres = Number(f.tillable_acres)
  if (f.pct_tillable != null) patch.pctTillable = Number(f.pct_tillable)
  if (f.soil_rating != null) patch.soilRating = Number(f.soil_rating)
  if (f.soil_rating_type) patch.soilRatingType = String(f.soil_rating_type)
  return patch
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
          const patch = figuresPatch(f)
          if (Object.keys(patch).length) onUpdateRef.current?.(rowId, patch)
        })
        .catch(() => { done.current.delete(rowId) })
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}
