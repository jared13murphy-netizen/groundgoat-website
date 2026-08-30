/**
 * Configurable Mapping — API client and shared types.
 *
 * Backend lives at /api/mapping (see configurable_mapping.py). Access is
 * firm-only for now; `fetchMappingAccess` drives whether the two menu
 * links render at all.
 */
import { fetchWithAuth } from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

/** The land types a user can assign.
 *
 *  There is deliberately NO waterway type. The engine's grassed waterway
 *  is a mown drainage run through a field — it is grass, not water.
 *  Owner rule 2026-08-28: it gets no polygon and no colour, and counts as
 *  untillable. The backend drops the class, so its acreage arrives inside
 *  "unclassified". It was briefly teal, and before that blue, and neither
 *  is wanted — do not re-add it without asking. */
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
  /** false = part of the parcel sits on ground the engine has not
   *  published; do not present the gap as unclassified ground. */
  engine_covered?: boolean
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

/** Whether the signed-in user may use Configurable Mapping.
 *
 *  Returns null when we could NOT find out — an expired session, a
 *  network failure. That case used to collapse into `false`, which told
 *  a paying customer the feature "isn't enabled on your account" when
 *  the truth was that their token had lapsed. Callers must treat null
 *  as "ask them to sign in again", not as "not entitled".
 */
export async function fetchMappingAccessState(): Promise<boolean | null> {
  try {
    const r = await j<{ enabled: boolean }>('/api/mapping/access')
    return !!r.enabled
  } catch (e: any) {
    const msg = String(e?.message || '')
    if (/\(401\)|\(403\)|Not authenticated|credentials/i.test(msg)) return null
    return null
  }
}

/** Convenience for places that only decide whether to render a link —
 *  there, "could not check" and "not entitled" both mean "hide it". */
export async function fetchMappingAccess(): Promise<boolean> {
  return (await fetchMappingAccessState()) === true
}

export function searchMap(
  q: string, state?: string | null, county?: string | null,
): Promise<SearchResult> {
  const qs = new URLSearchParams({ q })
  if (state) qs.set('state', state)
  // Only ever sent alongside a state; the API drops it otherwise.
  if (state && county) qs.set('county', county)
  return j<SearchResult>(`/api/mapping/search?${qs}`)
}

/** Counties in a state, for the search filter. */
export function listCounties(state: string) {
  return j<{ counties: string[] }>(
    `/api/mapping/counties?state=${encodeURIComponent(state)}`)
}

/** Look a parcel up by whichever id the caller has.
 *  The map's vector tiles carry `path`, never `ll_uuid`, so a click can
 *  only supply the former — sending it as ll_uuid found nothing and the
 *  click silently did nothing. */
export function fetchParcel(id: string): Promise<ParcelDetail> {
  const key = id.startsWith('/') ? 'path' : 'll_uuid'
  return j<ParcelDetail>(`/api/mapping/parcel?${key}=${encodeURIComponent(id)}`)
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

export interface ProjectTractGeometry {
  id: string
  name: string
  acres: number | null
  boundary: any
  label_point: any
  polygons: { cls: LandClass; geometry: any }[]
}

export interface PortfolioTract extends ProjectTractGeometry {
  project_id: string
  project_name: string
}

/** Every saved tract across every project — outline and label only.
 *  Land-type polygons come from projectGeometry when one is opened. */
export function allTractsGeometry() {
  return j<{ tracts: PortfolioTract[] }>('/api/mapping/tracts/geometry')
}

/** Every tract in a project with its geometry — drawn as context around
 *  whatever the editor currently has open. */
export function projectGeometry(id: string) {
  return j<{ tracts: ProjectTractGeometry[] }>(
    `/api/mapping/projects/${id}/geometry`)
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

/** Rename a tract. Does not touch its geometry — the full save
 *  recomputes acreage and soil, which is far too much for a name. */
export function renameParcel(id: string, name: string) {
  return j<{ id: string; name: string }>(`/api/mapping/parcels/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
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

export const REPORT_KINDS =
  ['tillable', 'elevation_3d', 'fsa', 'topography', 'ground_goat'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export const REPORT_LABEL: Record<string, string> = {
  tillable: 'Tillable Map',
  fsa: 'FSA Map',
  ground_goat: 'Ground Goat Report',
  elevation_3d: '3D Elevation Map',
  topography: 'Topography Map',
  cma: 'Market Analysis',
}

/** What a report button says while it is building.
 *
 *  Rendering happens on a worker and can take a while, so the button
 *  needs to say something. Kept short so the button does not jump width,
 *  and kept dry rather than jokey — this is a tool a farm manager shows
 *  to a client. */
export const REPORT_BUSY_LABEL: Record<string, string> = {
  tillable: 'Counting rows…',
  fsa: 'Pulling the file…',
  ground_goat: 'Rounding it up…',
  elevation_3d: 'Climbing the hill…',
  topography: 'Walking contours…',
  cma: 'Reading the market…',
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

/** Reports that read the elevation slider. */
export const USES_ELEVATION: readonly string[] = ['elevation_3d', 'topography']

export function queueReport(parcelId: string, kind: ReportKind, params: Record<string, any> = {}) {
  return j<{ id: string; kind: string; status: string }>('/api/mapping/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parcel_id: parcelId, kind, params }),
  })
}

export function listReports(parcelId?: string) {
  const qs = parcelId ? `?parcel_id=${encodeURIComponent(parcelId)}` : ''
  return j<{ reports: ReportRow[] }>(`/api/mapping/reports${qs}`)
}

/** Removes one built report — the row and the stored PDF. */
export function deleteReport(id: string) {
  return j<{ ok: boolean }>(`/api/mapping/reports/${id}`, { method: 'DELETE' })
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

/** Re-fill a boundary with the ENGINE'S land types.
 *  Confirming a boundary used to trim whatever polygons the parcel first
 *  loaded with, so an enlarged boundary could never gain ground. This
 *  asks the engine about the boundary the user actually drew.
 *  `engine_covered` false = part of it sits on ground the engine has not
 *  published; say so rather than drawing it as bare. */
export function classifyBoundary(boundary: any, state?: string | null) {
  return j<{ polygons: { cls: LandClass; acres: number; geometry: any }[]
             source: string; engine_covered: boolean; state: string | null }>(
    '/api/mapping/geometry/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ boundary, state: state || null }),
    })
}

/** Weighted soil rating for a tillable selection, for live display while
 *  polygons are being dragged. Narrow on purpose so the round trip stays
 *  short enough to run on every edit. */
export function previewSoil(tillable: any[], state: string | null, boundary?: any) {
  return j<{ rating: number | null; rating_type: string | null; acres: number
             breakdown: { name: string; rating: number; acres: number }[] }>(
    '/api/mapping/geometry/soil', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tillable, state, boundary }),
    })
}

// ── CMA ─────────────────────────────────────────────────────────────
// One analysis can carry several subject parcels, each with its own
// chosen comparables, combined into a single report.

export interface CmaSubject {
  parcel_id: string
  name: string | null
  comps: string[]
  stats?: Record<string, any>
  county?: string | null
  state?: string | null
}

export interface Cma {
  id: string
  project_id: string
  name: string
  subjects: CmaSubject[]
  criteria?: Record<string, any>
}

export interface CompCandidate {
  id: string
  name: string | null
  total_acres: number | null
  tillable_acres: number | null
  soil_rating: number | null
  price_per_acre: number | null
  sale_price: number | null
  county: string | null
  state: string | null
  auction_date: string | null
  company_name: string | null
  latitude: number | null
  longitude: number | null
  selected: boolean
}

export function createCma(projectId: string, name: string, parcelIds: string[]) {
  return j<Cma>('/api/mapping/cma', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, name, parcel_ids: parcelIds }),
  })
}

export function listCmas(projectId?: string) {
  const qs = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
  return j<{ cmas: Cma[] }>(`/api/mapping/cma${qs}`)
}

export function getCma(id: string) {
  return j<Cma>(`/api/mapping/cma/${id}`)
}

export function cmaCandidates(cmaId: string, parcelId: string, monthsBack = 24) {
  return j<{ comparables: CompCandidate[]; summary: any; criteria: any }>(
    `/api/mapping/cma/${cmaId}/candidates?parcel_id=${encodeURIComponent(parcelId)}`
    + `&months_back=${monthsBack}`)
}

export function setCmaComps(cmaId: string, parcelId: string, comps: string[]) {
  return j<{ ok: true; comps: number }>(
    `/api/mapping/cma/${cmaId}/subjects/${encodeURIComponent(parcelId)}/comps`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comps }),
    })
}

export function updateCma(id: string, patch: { name?: string; archived?: boolean; parcel_ids?: string[] }) {
  return j<{ ok: true }>(`/api/mapping/cma/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

export function queueCmaReport(cmaId: string) {
  return j<{ id: string; kind: string; status: string }>('/api/mapping/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'cma', cma_id: cmaId }),
  })
}

// ─────────────────────────────────────────────────────────────────────
// Seats — the firm admin's per-user toggle
//
// Seats are capacity the firm buys for the term. Switching a user on
// buys one only if none are spare; switching a user off frees it but
// refunds nothing, so the firm can reassign it. Never call setSeat
// without showing previewSeat()'s message first — it is the only thing
// that tells the admin whether this click costs money.
// ─────────────────────────────────────────────────────────────────────
export interface SeatPrice {
  configured: boolean
  price_id: string | null
  amount_cents: number | null
  amount: string | null
  interval: string
}

export interface SeatMember {
  id: string
  email: string
  name: string
  account_type: string
  enabled: boolean
}

export interface SeatSummary {
  firm_id: string
  firm_name: string
  subscription_status: string
  billable: boolean
  price: SeatPrice
  /** Users switched on right now. */
  seats_in_use: number
  /** Capacity bought for this term. Never shrinks mid-term. */
  seats_paid: number
  /** Paid seats nobody is using — free to hand to another user. */
  seats_spare: number
  annual_total_cents: number | null
  annual_total: string | null
  renewal_total: string | null
  members: SeatMember[]
}

export interface SeatPreview {
  seats_now: number
  seats_after: number
  seats_paid: number
  seats_paid_after: number
  price: SeatPrice
  annual_total_after: string | null
  renewal_total_after: string | null
  /** True only when the toggle actually buys new capacity. */
  will_be_charged: boolean
  message: string
}

export function fetchSeats(firmId?: string) {
  const q = firmId ? `?firm_id=${encodeURIComponent(firmId)}` : ''
  return j<SeatSummary>(`/api/mapping/seats${q}`)
}

export function previewSeat(enabled: boolean, firmId?: string) {
  const q = firmId ? `&firm_id=${encodeURIComponent(firmId)}` : ''
  return j<SeatPreview>(`/api/mapping/seats/preview?enabled=${enabled}${q}`)
}

export function setSeat(userId: string, enabled: boolean, firmId?: string) {
  const q = firmId ? `?firm_id=${encodeURIComponent(firmId)}` : ''
  return j<{
    user_id: string
    enabled: boolean
    seats_in_use: number
    seats_paid: number
    charged_now: boolean
    billed: boolean
    note: string | null
    annual_total: string | null
    renewal_total: string | null
  }>(`/api/mapping/seats/${encodeURIComponent(userId)}${q}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}
