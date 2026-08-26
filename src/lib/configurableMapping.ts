/**
 * Configurable Mapping — API client and shared types.
 *
 * Backend lives at /api/mapping (see configurable_mapping.py). Access is
 * firm-only for now; `fetchMappingAccess` drives whether the two menu
 * links render at all.
 */
import { fetchWithAuth } from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

/** The land types a user can assign. `water` covers the engine's
 *  separate `waterway` class — a customer reads both as water. */
export const LAND_CLASSES = ['tillable', 'pasture', 'timber', 'water', 'other'] as const
export type LandClass = (typeof LAND_CLASSES)[number]

export const CLASS_LABEL: Record<LandClass, string> = {
  tillable: 'Tillable',
  pasture: 'Pasture',
  timber: 'Timber',
  water: 'Water',
  other: 'Other',
}

/** Fill tints only. Every polygon OUTLINE is pink (owner spec) — the
 *  label inside the polygon is what tells the user the land type. */
export const CLASS_TINT: Record<LandClass, string> = {
  tillable: '#22c55e',
  pasture: '#a3e635',
  timber: '#15803d',
  water: '#38bdf8',
  other: '#e5e7eb',
}

export const POLY_LINE = '#ff4fa3'      // pink, per spec
export const PARCEL_LINE = '#000000'    // black outer boundary, per spec
export const SEARCH_DOT = '#2563eb'     // blue search dots, per spec

export interface ParcelSummary {
  ll_uuid: string
  parcelnumb: string | null
  owner: string | null
  county: string | null
  state: string | null
  lat: number
  lng: number
  acres: number | null
}

export interface EnginePolygon {
  cls: LandClass
  engine_class: string
  acres: number
  geometry: any // GeoJSON Polygon | MultiPolygon
}

export interface ParcelDetail {
  parcel: Record<string, any>
  boundary: any
  polygons: EnginePolygon[]
  source: 'engine' | 'none'
  unclassified_acres: number
}

export type SearchResult =
  | { kind: 'flyto'; center?: [number, number]; bounds?: [[number, number], [number, number]]; zoom?: number; label: string }
  | { kind: 'parcels'; parcels: ParcelSummary[] }
  | { kind: 'need_state'; message: string }
  | { kind: 'unsupported'; message: string }
  | { kind: 'none'; message: string }

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(`${API_URL}${path}`, init)
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.detail) detail = body.detail
    } catch {
      /* non-JSON error body — keep the status message */
    }
    throw new Error(detail)
  }
  return res.json()
}

export async function fetchMappingAccess(): Promise<boolean> {
  try {
    const r = await j<{ enabled: boolean }>('/api/mapping/access')
    return !!r.enabled
  } catch {
    return false
  }
}

export function searchMap(q: string, state?: string | null): Promise<SearchResult> {
  const qs = new URLSearchParams({ q })
  if (state) qs.set('state', state)
  return j<SearchResult>(`/api/mapping/search?${qs}`)
}

export function fetchParcel(llUuid: string): Promise<ParcelDetail> {
  return j<ParcelDetail>(`/api/mapping/parcel?ll_uuid=${encodeURIComponent(llUuid)}`)
}

export interface SaveBody {
  name: string
  boundary: any
  polygons: { cls: LandClass; geometry: any }[]
  source_ll_uuids: string[]
}

export function saveParcel(body: SaveBody) {
  return j<{ id: string; name: string; stats: any }>('/api/mapping/parcels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateParcel(id: string, body: SaveBody) {
  return j<{ id: string; name: string; stats: any }>(`/api/mapping/parcels/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function listParcels() {
  return j<{ parcels: any[] }>('/api/mapping/parcels')
}
