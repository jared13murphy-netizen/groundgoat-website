// Reports panel (owner 11/15): one panel for every report. Any screen opens
// it with openReports(); the single <ReportsPanel/> host in ExploreMap shows
// it over whatever panel is open, and back/close simply return there.

export type ReportsTarget =
  | { type: 'parcel'; title: string; meta?: string; llUuid?: string | null; lat?: number | null; lng?: number | null; noteKey?: string | null }
  | { type: 'tract'; title: string; meta?: string; tractId: string }
  | { type: 'farm'; title: string; meta?: string; parcelId: string; projectId: string | null; projectName: string | null }
  | { type: 'project'; title: string; meta?: string; projectId: string; projectName: string | null; farms: { id: string; name: string }[] }

export interface ReportsOpen {
  target: ReportsTarget
  /** What "‹" says, e.g. "Parcel", "Tract", "Farm", "Projects". */
  backLabel: string
  /** Parcel / Tract Report: the account's report access. */
  canUseReports: boolean
  /** Map It reports (Ground Goat, Applicator, Soil, Aerial, 3D). */
  canUseMapIt: boolean
}

let current: ReportsOpen | null = null
const listeners = new Set<(s: ReportsOpen | null) => void>()

export function openReports(s: ReportsOpen) { current = s; listeners.forEach((f) => f(current)) }
export function closeReports() { current = null; listeners.forEach((f) => f(current)) }
export function reportsSnapshot() { return current }
export function subscribeReports(f: (s: ReportsOpen | null) => void) {
  listeners.add(f)
  return () => { listeners.delete(f) }
}
