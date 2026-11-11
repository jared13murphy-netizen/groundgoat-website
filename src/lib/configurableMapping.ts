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

export const PARCEL_LINE = '#ff33cc'    // bright brand pink outer boundary (owner 2026-09-29; brighter than gg-pink so it reads on imagery)
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

/** Counties are proper nouns. Tracts saved before the API started
 *  tidying them still carry whatever the county typed, so anything that
 *  puts a county on screen goes through here. */
export function niceCounty(name?: string | null): string {
  if (!name) return ''
  return String(name).trim().replace(/\S+/g, (w) =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
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
/** `engine: false` = outline + figures only (no engine land types) — the
 *  Map It editor loads that first so the outline is on screen at once
 *  (owner 10/30), then classifies through classifyBoundary. */
export function fetchParcel(id: string, opts: { engine?: boolean } = {}): Promise<ParcelDetail> {
  const key = id.startsWith('/') ? 'path' : 'll_uuid'
  const eng = opts.engine === false ? '&engine=false' : ''
  return j<ParcelDetail>(`/api/mapping/parcel?${key}=${encodeURIComponent(id)}${eng}`)
}

export interface SaveBody {
  name: string
  boundary: any
  polygons: { cls: LandClass; geometry: any }[]
  source_ll_uuids: string[]
  /** Auction tract(s) the outline came from: their stated acres are THE acres
   *  while the outline is unchanged (owner 11/5). */
  source_tract_ids?: string[]
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
  /** True when a colleague shared this with you rather than you making it. */
  shared?: boolean
  /** Who shared it. Null on your own projects. */
  shared_by?: string | null
  /** On YOUR projects: who you have shared it with. Empty when nobody. */
  shared_with?: { id: string; name: string }[]
  /** Esri Wayback archive year the Configure Map + Aerial Map report use
   *  for this project. Null = "Latest" (the current mosaic). */
  aerial_year?: number | null
}

export interface SavedParcelRow {
  id: string
  name: string
  state: string | null
  county: string | null
  stats: Record<string, any>
  source_ll_uuids: string[]
  updated_at: string
  /** v2 (owner 11/10): a farm can be in many projects. Every project
   *  linking this farm that the caller can open. Absent on older APIs. */
  projects?: FarmProjectRef[]
  owner_id?: string | null
}

/** A project a farm (one saved drawing) is linked to. */
export interface FarmProjectRef {
  id: string
  name: string
  owned?: boolean
  shared?: boolean
}

/** ?farms=1 on every farm write: the backend gives the farms-in-many-
 *  projects meaning (merge into the one drawing, link instead of move, delete
 *  = everywhere) ONLY to callers that send it; an old tab without it keeps
 *  the old meaning (owner 11/10). */
const FARMS = 'farms=1'

export function saveParcel(body: SaveBody) {
  return j<{ id: string; project_id: string; name: string; stats: any
             project_summary: ProjectSummary; merged?: boolean }>(`/api/mapping/parcels?${FARMS}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function updateParcel(id: string, body: SaveBody) {
  return j<{ id: string; name: string; stats: any
             project_summary: ProjectSummary }>(`/api/mapping/parcels/${id}?${FARMS}`, {
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

export function createProject(name: string, aerialYear?: number | null) {
  const body: Record<string, any> = { name }
  // Omit entirely when not given, rather than sending `undefined` —
  // the backend treats a present `null` as "Latest", so leaving the
  // key out entirely must mean "not set" (default), not "Latest".
  if (aerialYear !== undefined) body.aerial_year = aerialYear
  return j<{ id: string; name: string }>('/api/mapping/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  /** The farm's first project (by name) — back-compat. Use `projects` for membership. */
  project_id: string
  project_name: string
  /** v2: ONE entry per farm; every project it is in. Absent on older APIs. */
  projects?: FarmProjectRef[]
  /** Carried so the Explore map can build a comparable from a tract
   *  without a second request per tract. */
  tillable_acres?: number | null
  county?: string | null
  state?: string | null
  soil_rating?: number | null
  soil_rating_type?: string | null
}

/** Every saved tract across every project — outline and label only.
 *  Land-type polygons come from projectGeometry when one is opened. */
export function allTractsGeometry(includePolygons = false) {
  const qs = includePolygons ? '?include_polygons=1' : ''
  return j<{ tracts: PortfolioTract[] }>(`/api/mapping/tracts/geometry${qs}`)
}

/** Every tract in a project with its geometry — drawn as context around
 *  whatever the editor currently has open. */
export function projectGeometry(id: string) {
  return j<{ tracts: ProjectTractGeometry[] }>(
    `/api/mapping/projects/${id}/geometry`)
}

export interface FirmMember {
  id: string
  email: string
  full_name: string | null
  role: string | null
}

/** Everyone in the caller's firm — who a project can be shared with. */
export function firmMembers() {
  return j<{ members: FirmMember[] }>('/api/mapping/firm/members')
}

export function projectShares(id: string) {
  return j<{ user_ids: string[]; owned: boolean }>(`/api/mapping/projects/${id}/shares`)
}

/** Sends the COMPLETE set, not a delta — what the dialog shows is what
 *  it saves, so a stale checkbox cannot silently re-share. */
export function setProjectShares(id: string, userIds: string[]) {
  return j<{ user_ids: string[] }>(`/api/mapping/projects/${id}/shares`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_ids: userIds }),
  })
}

/** `aerial_year` omitted = unchanged, `null` = Latest, a number = that
 *  Wayback year. Callers that only want to touch the year should use
 *  `updateProjectAerialYear` below rather than build this patch by hand. */
export function updateProject(
  id: string, patch: { name?: string; archived?: boolean; aerial_year?: number | null },
) {
  return j<{ ok: true }>(`/api/mapping/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** Persist the Configure Map imagery-year choice on a project. Split out
 *  from `updateProject` so a caller that only has a year in hand (no
 *  name/archived state to preserve) cannot accidentally send those keys
 *  as `undefined` and have `JSON.stringify` silently drop them wrong. */
export function updateProjectAerialYear(id: string, aerialYear: number | null) {
  return updateProject(id, { aerial_year: aerialYear })
}

export function duplicateProject(id: string) {
  return j<{ id: string; name: string; parcels: number }>(
    `/api/mapping/projects/${id}/duplicate`, { method: 'POST' })
}

/** Rename a tract. Does not touch its geometry — the full save
 *  recomputes acreage and soil, which is far too much for a name. */
export function renameParcel(id: string, name: string) {
  return j<{ id: string; name: string }>(`/api/mapping/parcels/${id}?${FARMS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

/** v2: PATCH project_id LINKS the farm to that project; with
 *  `fromProjectId` it also unlinks it from that one (= a move). The UI no
 *  longer offers Move (owner 11/10) — kept for callers that need it. */
export function moveParcel(id: string, projectId: string, fromProjectId?: string | null) {
  const body: Record<string, any> = { project_id: projectId }
  if (fromProjectId) body.from_project_id = fromProjectId
  return j<{ id: string; name: string; project_id: string }>(`/api/mapping/parcels/${id}?${FARMS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Add to project: LINK farms to a project (they keep their one drawing). */
export function linkParcels(projectId: string, parcelIds: string[]) {
  return j<{ ok: true; linked: number; already: number }>(
    `/api/mapping/projects/${encodeURIComponent(projectId)}/parcels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parcel_ids: parcelIds }),
    })
}

/** Remove from project: unlinks only — the farm, its drawing and its other
 *  projects are untouched. */
export function unlinkParcel(projectId: string, parcelId: string) {
  return j<{ ok: true; remaining_projects: FarmProjectRef[] }>(
    `/api/mapping/projects/${encodeURIComponent(projectId)}/parcels/${encodeURIComponent(parcelId)}`,
    { method: 'DELETE' })
}

/** EVERY project a farm is in (for the Delete farm confirm). `can_open`
 *  false = a teammate's project the caller cannot open (name still listed). */
export interface FarmProjectListing { id: string; name: string; owner_name: string | null; owned: boolean; can_open: boolean }
export function parcelProjects(id: string) {
  return j<{ projects: FarmProjectListing[]; count: number }>(
    `/api/mapping/parcels/${encodeURIComponent(id)}/projects`)
}

/** Delete farm: removes it from EVERY project (archived server-side). */
export function deleteFarm(id: string) {
  return j<{ ok: true; removed_from?: FarmProjectRef[] }>(
    `/api/mapping/parcels/${encodeURIComponent(id)}?${FARMS}`, { method: 'DELETE' })
}

/** Same call as deleteFarm (v2: removes the farm from every project). */
export const archiveParcel = deleteFarm

export function getSavedParcel(id: string) {
  return j<{
    id: string; project_id: string; name: string; boundary: any
    polygons: { cls: LandClass; acres: number; geometry: any }[]
    stats: Record<string, any>; source_ll_uuids: string[]
    projects?: FarmProjectRef[]
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

export interface FitTractsResult {
  tracts: { id: string; geometry: any; acres: number }[]
  frame_acres: number
  /** Ground inside the frame no sketch drew (a tract drawn over half a
   *  parcel stays half a parcel — the fit only absorbs THIN gaps between
   *  a rough edge and the parcel line, owner 9/16). Tell the user. */
  unassigned_acres: number
  /** Sketch ids that ended with no ground after the fit — tell the
   *  user; never drop their tract without saying so. */
  dropped: string[]
}

/** 'Snap tracts' / 'Snap to Parcel' (owner spec 2026-09-15): fit a set
 *  of drawn tract sketches to a FRAME — a combined multi-parcel
 *  boundary for a reshape, or a single parcel for 'Snap to Parcel' on
 *  one drawn tract — and to each other, so shared edges align and
 *  acreage reconciles to the frame's true area rather than the sum of
 *  independently-drawn sketches (which double-counts or leaves gaps on
 *  any tile-overlap boundary — never sum client acres for a frame
 *  total; read it off this response instead).
 *
 *  NEW backend endpoint (POST /api/mapping/geometry/fit-tracts) — not
 *  called from the UI yet; this is the client half only, landing ahead
 *  of the map-handler wiring so it can be reviewed on its own. */
export function fitTracts(frame: any, tracts: { id: string; geometry: any }[], parts: any[] = []) {
  // `parts`: the individual parcels the frame was combined from, so the
  // server can judge each sketch's claim on EACH parcel (a strip that
  // strayed over the line into the neighbour is drawing slop, not a claim).
  return j<FitTractsResult>('/api/mapping/geometry/fit-tracts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frame, tracts, parts }),
  })
}

export interface ParcelUnder { ll_uuid: string; geometry: any; acres: number }

/** Every Regrid parcel actually underneath a set of tract boundaries —
 *  the automatic replacement for the old "Select frame parcels" pick
 *  (owner 2026-09-16: the manual tool read as confusing). `snapTracts`
 *  calls this to build the fit-tracts FRAME without making the user
 *  click every parcel first; zero parcels back means fall through to
 *  the tracts' own boundaries. */
export function parcelsUnder(geometries: any[]) {
  return j<{ parcels: ParcelUnder[] }>('/api/mapping/geometry/parcels-under', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometries }),
  })
}

/** A parcel's ground not already covered by this project's OTHER
 *  tracts — lets a second click on the same parcel fill in what a
 *  first tract left over instead of re-selecting the whole parcel
 *  (owner spec 2026-09-16, "remainder fill"). Null geometry means
 *  nothing is left uncovered. */
export function differenceGeometry(geometry: any, subtract: any[]) {
  return j<{ geometry: any | null; acres: number }>('/api/mapping/geometry/difference', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ geometry, subtract }),
  })
}

// ── Reports ─────────────────────────────────────────────────────────
// The API only queues; a worker renders. The UI polls until a report
// reports itself done, then downloads it through the API — the storage
// bucket is private, so there is no direct link to hand out.

/** The report buttons on the Reports card. 'tillable' still exists on
 *  the API (old rows keep their label below) but is no longer offered —
 *  owner 2026-09-24: "remove the Tillable Map report". */
export const REPORT_KINDS =
  ['aerial', 'soil_map', 'ground_goat', 'elevation_3d'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

/** Reports queued at the PROJECT level (no parcel_id) rather than per
 *  tract — right now just the Aerial Map, which prints the whole
 *  project's ground at the chosen imagery year in one PDF. */
export const PROJECT_REPORT_KINDS: readonly string[] = ['aerial']

export const REPORT_LABEL: Record<string, string> = {
  aerial: 'Aerial Map',
  soil_map: 'Soil Map',
  tillable: 'Tillable Map',
  ground_goat: 'Ground Goat Report',
  elevation_3d: '3D Elevation Map',
  cma: 'Market Analysis',
}

/** What a report button says while it is building.
 *
 *  Rendering happens on a worker and can take a while, so the button
 *  needs to say something. Kept short so the button does not jump width,
 *  and kept dry rather than jokey — this is a tool a farm manager shows
 *  to a client. */
export const REPORT_BUSY_LABEL: Record<string, string> = {
  aerial: 'Framing the ground…',
  soil_map: 'Reading the soils…',
  tillable: 'Counting rows…',
  ground_goat: 'Rounding it up…',
  elevation_3d: 'Climbing the hill…',
  cma: 'Reading the market…',
}

export interface ReportRow {
  id: string
  /** Null on a project-level report (e.g. `aerial`) — those print the
   *  whole project rather than one tract. */
  parcel_id: string | null
  project_id: string
  kind: string
  status: 'queued' | 'running' | 'done' | 'failed'
  error: string | null
  ready: boolean
  created_at: string
  updated_at: string
}

/** Reports that read the elevation slider. */
export const USES_ELEVATION: readonly string[] = ['elevation_3d']

export function queueReport(
  target: { parcelId?: string; projectId?: string },
  kind: ReportKind,
  params: Record<string, any> = {},
) {
  const body: Record<string, any> = { kind, params }
  if (target.parcelId) body.parcel_id = target.parcelId
  if (target.projectId) body.project_id = target.projectId
  return j<{ id: string; kind: string; status: string }>('/api/mapping/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export function listReports(opts: { parcelId?: string; projectId?: string } = {}) {
  const qs = new URLSearchParams()
  if (opts.parcelId) qs.set('parcel_id', opts.parcelId)
  if (opts.projectId) qs.set('project_id', opts.projectId)
  const s = qs.toString()
  return j<{ reports: ReportRow[] }>(`/api/mapping/reports${s ? `?${s}` : ''}`)
}

/** Removes one built report — the row and the stored PDF. */
export function deleteReport(id: string) {
  return j<{ ok: boolean }>(`/api/mapping/reports/${id}`, { method: 'DELETE' })
}

/** Pulls the PDF through the authenticated API and hands it to the
 *  browser as a download. */
/** Letters and digits kept; every other run of characters becomes one
 *  underscore, none leading or trailing. */
function filenameSlug(value: string | null | undefined): string {
  return String(value || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** The saved PDF's name (owner 2026-09-24): project name, then report
 *  type, then the date — underscores only, no dashes or periods, e.g.
 *  "Smith_Estate_Auction_Ground_Goat_Report_2026_09_24.pdf". The API
 *  sends the same name in Content-Disposition; this is the fallback
 *  when that header cannot be read. */
export function reportFilename(projectName: string | null | undefined, kind: string, when = new Date()): string {
  const d = `${when.getFullYear()}_${String(when.getMonth() + 1).padStart(2, '0')}_${String(when.getDate()).padStart(2, '0')}`
  return `${filenameSlug(projectName) || 'Project'}_${filenameSlug(REPORT_LABEL[kind] || kind) || 'Report'}_${d}.pdf`
}

export async function downloadReport(id: string, fallbackFilename: string): Promise<void> {
  const res = await fetchWithAuth(`${API_URL}/api/mapping/reports/${id}/download`)
  if (!res.ok) throw new Error(`That report could not be downloaded (${res.status}).`)
  // Prefer the name the API chose (one rule, one place); fall back to
  // the same rule computed here if the header is not readable.
  const disposition = res.headers.get('content-disposition') || ''
  const m = /filename="?([^";]+)"?/i.exec(disposition)
  const filename = m?.[1] || fallbackFilename
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

/** Owner 10/2: a project's built reports are thrown away when the editor
 *  closes — they are rebuilt on demand, never kept. `keepalive` so the
 *  request survives a tab close / navigation. */
export function clearProjectReports(projectId: string) {
  return j<{ ok: true; deleted: number }>(
    `/api/mapping/reports?project_id=${encodeURIComponent(projectId)}`,
    { method: 'DELETE', keepalive: true })
}

export interface LibraryLogo { id: string; name: string; selected: boolean; scope: 'mine' | 'firm'; url: string }
export function getBranding() {
  return j<{ name: string | null; has_logo: boolean; firm_logo_url?: string | null
             logo_source?: 'report' | 'firm' | 'library' | null
             logos?: LibraryLogo[]; selected_logo_id?: string | null; logo_url?: string | null }>('/api/mapping/branding')
}

/** Owner 10/2 logo library: upload one more logo (becomes the pick unless
 *  select=false); remove one; pick which prints with setBranding({logo_id}). */
export function addLibraryLogo(name: string, logo_base64: string, select = true) {
  return j<LibraryLogo>('/api/mapping/branding/logos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, logo_base64, select }),
  })
}
export function deleteLibraryLogo(id: string) {
  return j<{ ok: true }>(`/api/mapping/branding/logos/${id}`, { method: 'DELETE' })
}
export async function fetchLibraryLogoUrl(id: string): Promise<string | null> {
  try {
    const res = await fetchWithAuth(`${API_URL}/api/mapping/branding/logos/${id}.png`)
    if (!res.ok) return null
    return URL.createObjectURL(await res.blob())
  } catch { return null }
}

export function setBranding(patch: { name?: string; logo_base64?: string; logo_id?: string }) {
  return j<{ ok: true }>('/api/mapping/branding', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** The firm's current logo, as a local blob URL — the endpoint is
 *  authenticated, so a plain `<img src>` can't carry the bearer token.
 *  Null on any failure (no logo yet, 404, network) — callers treat that
 *  as "no preview available", never as an error to surface. Caller must
 *  revoke the returned URL when done with it. */
export async function fetchBrandingLogoUrl(cacheBust?: number): Promise<string | null> {
  try {
    const qs = cacheBust ? `?v=${cacheBust}` : ''
    const res = await fetchWithAuth(`${API_URL}/api/mapping/branding/logo${qs}`)
    if (!res.ok) return null
    const blob = await res.blob()
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
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
/** Quick Draw stats (owner 10/2): engine land-type acres + the state soil
 *  rating over the tillable ground for ANY drawn polygon; `covered` is
 *  false outside the six engine states (then only `acres` is real). */
export interface DrawStats {
  acres: number; state: string | null; county: string | null; covered: boolean
  tillable_acres: number | null; timber_acres: number | null; pasture_acres: number | null
  water_acres: number | null; rating: number | null; rating_type: string | null
}
export function drawStats(boundary: any) {
  return j<DrawStats>('/api/mapping/geometry/draw-stats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ boundary }),
  })
}

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

// ── Saved tract detail (slide-out panel on the Explore map) ────────
// Owner 11/2: tapping a saved tract opens a panel like Tract Details.
// Every field is optional on the client: the panel renders whatever the
// API sent and leaves the rest out.

export interface SavedTractSoil {
  name: string
  acres: number | null
  rating: number | null
  pct_of_tillable: number | null
}

export interface SavedTractDetail {
  id: string
  name: string | null
  /** The farm's first project (back-compat). */
  project?: { id: string; name: string | null } | null
  /** v2: every project this farm is in (the chips on its panel). */
  projects?: FarmProjectRef[] | null
  project_tract_count?: number | null
  county?: string | null
  state?: string | null
  acres?: number | null
  tillable_acres?: number | null
  pasture_acres?: number | null
  timber_acres?: number | null
  water_acres?: number | null
  other_acres?: number | null
  soil?: {
    rating: number | null
    rating_type: string | null
    breakdown?: SavedTractSoil[] | null
  } | null
  centroid?: { lat: number; lng: number } | null
  bbox?: [[number, number], [number, number]] | null
  boundary?: any
  tillable_polygon?: any
  source_parcels?: { ll_uuid: string; owner: string | null; acres: number | null; parcelnumb: string | null }[] | null
  created_at?: string
  updated_at?: string
}

export function getSavedTractDetail(id: string) {
  return j<SavedTractDetail>(`/api/mapping/parcels/${encodeURIComponent(id)}/detail`)
}

/** Queue one report, wait for the worker, then download it. Lives outside
 *  any component so a download the user asked for still lands if they
 *  close the panel while it builds (~5 min cap, polled every 3 s). */
export async function queueAndDownloadReport(
  target: { parcelId?: string; projectId?: string },
  kind: ReportKind,
  projectName: string | null | undefined,
  params: Record<string, any> = {},
): Promise<void> {
  const q = await queueReport(target, kind, params)
  const started = Date.now()
  while (Date.now() - started < 5 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 3000))
    const { reports } = await listReports(
      target.parcelId ? { parcelId: target.parcelId } : { projectId: target.projectId })
    const row = (reports || []).find((r) => r.id === q.id)
    if (!row) throw new Error('That report went missing.')
    if (row.status === 'failed') throw new Error(row.error || 'The report failed to build.')
    if (row.status === 'done' && row.ready) {
      await downloadReport(row.id, reportFilename(projectName, kind))
      return
    }
  }
  throw new Error('The report is taking too long — check Reports in Saved Projects.')
}

// ── Saved reports (owner 2026-11-03) ───────────────────────────────────
// A report saved as its recipe (subject + item ids + notes), never figures
// or a PDF. Every emailed/downloaded comp report is saved automatically by
// the API; the panel's Save button saves one explicitly.
export interface SavedReportItem {
  source: 'tract' | 'parcel' | 'saved'
  tract_id?: string | null
  ll_uuid?: string | null
  cm_id?: string | null
  county?: string | null
  state?: string | null
  notes?: string | null
  latitude?: number | null
  longitude?: number | null
  sale_price?: number | null
  total_acres?: number | null
  price_per_acre?: number | null
}
export interface SavedReportRow {
  id: string
  user_id: string
  kind: string
  name: string
  subject: Record<string, any>
  items: SavedReportItem[]
  /** Stored at save time: sales, priced, total_acres, avg_price_per_acre (acre-weighted). */
  summary?: { sales?: number; priced?: number; total_acres?: number | null; avg_price_per_acre?: number | null }
  item_count: number
  parcel_id: string | null
  project_id: string | null
  created_at: string | null
  updated_at: string | null
  last_opened_at: string | null
  mine?: boolean
}
export function listSavedReports(opts: { parcelId?: string } = {}) {
  const s = opts.parcelId ? `?parcel_id=${encodeURIComponent(opts.parcelId)}` : ''
  return j<{ reports: SavedReportRow[] }>(`/api/mapping/saved-reports${s}`)
}
export function getSavedReport(id: string) {
  return j<{ report: SavedReportRow; tracts: any[] }>(`/api/mapping/saved-reports/${encodeURIComponent(id)}`)
}
export function saveReport(body: { name?: string | null; subject: Record<string, any>; items: SavedReportItem[] }) {
  return j<{ report: SavedReportRow }>('/api/mapping/saved-reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}
export function renameSavedReport(id: string, name: string) {
  return j<{ report: SavedReportRow }>(`/api/mapping/saved-reports/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
}
export function deleteSavedReport(id: string) {
  return j<{ ok: boolean }>(`/api/mapping/saved-reports/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
