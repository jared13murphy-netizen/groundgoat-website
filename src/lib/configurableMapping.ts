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

/** Owner-specified 2026-08-26: tillable green, timber red, pasture
 *  orange, water blue. The polygon IS the colour — no text labels on the
 *  map — and a legend on the panel says what each colour means. */
export const CLASS_COLOR: Record<LandClass, string> = {
  tillable: '#22c55e',
  timber: '#ef4444',
  pasture: '#f97316',
  water: '#3b82f6',
  other: '#9ca3af',
}

export const PARCEL_LINE = '#000000'    // black outer boundary, per spec
export const VERTEX_LINE = '#111827'    // ring around a draggable handle
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
  /** Omit to have a project created automatically — a single-parcel user
   *  never has to think about projects. */
  project_id?: string | null
  project_name?: string | null
}

export interface ProjectSummary {
  parcels: number
  acres: number
  tillable_acres: number
}

export interface Project {
  id: string
  name: string
  state: string | null
  county: string | null
  summary: ProjectSummary
  thumb_key: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface SavedParcelRow {
  id: string
  name: string
  state: string | null
  county: string | null
  stats: Record<string, any>
  source_ll_uuids: string[]
  updated_at: string
}

export function saveParcel(body: SaveBody) {
  return j<{ id: string; project_id: string; name: string; stats: any
             project_summary: ProjectSummary }>('/api/mapping/parcels', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateParcel(id: string, body: SaveBody) {
  return j<{ id: string; name: string; stats: any
             project_summary: ProjectSummary }>(`/api/mapping/parcels/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function listParcels(projectId?: string) {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
  return j<{ parcels: SavedParcelRow[] }>(`/api/mapping/parcels${qs}`)
}

// ── Projects / Map Portfolio ────────────────────────────────────────

export function listProjects(includeArchived = false) {
  return j<{ projects: Project[] }>(
    `/api/mapping/projects${includeArchived ? '?include_archived=true' : ''}`)
}

export function createProject(name: string) {
  return j<{ id: string; name: string }>('/api/mapping/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export function getProject(id: string) {
  return j<{ project: Project; parcels: SavedParcelRow[] }>(`/api/mapping/projects/${id}`)
}

export function updateProject(id: string, patch: { name?: string; archived?: boolean }) {
  return j<{ ok: true }>(`/api/mapping/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function duplicateProject(id: string) {
  return j<{ id: string; name: string; parcels: number }>(
    `/api/mapping/projects/${id}/duplicate`, { method: 'POST' })
}

export function archiveParcel(id: string) {
  return j<{ ok: true }>(`/api/mapping/parcels/${id}`, { method: 'DELETE' })
}

export function getSavedParcel(id: string) {
  return j<{
    id: string; project_id: string; name: string; boundary: any
    polygons: { cls: LandClass; acres: number; geometry: any }[]
    stats: Record<string, any>; source_ll_uuids: string[]
  }>(`/api/mapping/parcels/${id}`)
}

// ── Geometry ops, done server-side in PostGIS ───────────────────────
// Combining parcels and splitting a boundary with a drawn line are the
// 20-tract auction workflow. PostGIS already has a polygon clipper;
// re-implementing one in the browser would be a source of quiet errors.

export function combineGeometry(geometries: any[]) {
  return j<{ geometry: any; acres: number }>('/api/mapping/geometry/combine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometries }),
  })
}

export function splitGeometry(geometry: any, line: any) {
  return j<{ pieces: { geometry: any; acres: number }[] }>('/api/mapping/geometry/split', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometry, line }),
  })
}

// ── Reports ─────────────────────────────────────────────────────────
// The API only queues; a worker renders. The UI polls until a report
// reports itself done, then downloads it through the API — the storage
// bucket is private, so there is no direct link to hand out.

export const REPORT_KINDS = ['tillable', 'fsa', 'ground_goat'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export const REPORT_LABEL: Record<string, string> = {
  tillable: 'Tillable Map',
  fsa: 'FSA Map',
  ground_goat: 'Ground Goat Report',
  elevation_3d: '3D Elevation Map',
  topography: 'Topography Map',
  cma: 'Market Analysis',
}

export interface ReportRow {
  id: string
  parcel_id: string
  project_id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed'
  error: string | null
  ready: boolean
  created_at: string
  updated_at: string
}

export function queueReport(parcelId: string, kind: ReportKind) {
  return j<{ id: string; kind: string; status: string }>('/api/mapping/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parcel_id: parcelId, kind }),
  })
}

export function listReports(parcelId?: string) {
  const qs = parcelId ? `?parcel_id=${encodeURIComponent(parcelId)}` : ''
  return j<{ reports: ReportRow[] }>(`/api/mapping/reports${qs}`)
}

/** Pulls the PDF through the authenticated API and hands it to the
 *  browser as a download. */
export async function downloadReport(id: string, filename: string): Promise<void> {
  const res = await fetchWithAuth(`${API_URL}/api/mapping/reports/${id}/download`)
  if (!res.ok) throw new Error(`That report could not be downloaded (${res.status}).`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function getBranding() {
  return j<{ name: string | null; has_logo: boolean }>('/api/mapping/branding')
}

export function setBranding(patch: { name?: string; logo_base64?: string }) {
  return j<{ ok: true }>('/api/mapping/branding', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** Force drawn polygons to be non-overlapping and inside the boundary.
 *  Order matters: later shapes win, the way painting over something
 *  works. Run in PostGIS — boolean polygon algebra done by hand in the
 *  browser produces slivers you only notice later. */
export function normalizeGeometry(boundary: any, polygons: { cls: LandClass; geometry: any }[]) {
  return j<{ polygons: { cls: LandClass; acres: number; geometry: any }[] }>(
    '/api/mapping/geometry/normalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boundary, polygons }),
    })
}
