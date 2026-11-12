'use client'

// Reports for one saved map (tract) and its project: load, poll while any is
// building, queue, download, delete. Same API calls and behaviour as the
// Reports section of SavedProjectsPanel; used by the saved-tract slide-out.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteReport, downloadReport, getProject, listReports, queueReport, reportFilename, USES_ELEVATION,
  type ReportKind, type ReportRow,
} from '@/lib/configurableMapping'
import { DEFAULT_NOTES_PRINT, notesPrintBody, type NotePickItem, type NotesPrint } from '@/lib/notes'

/** Same default the Saved Projects panel's 3D report starts at. */
const DEFAULT_EXAGGERATION = 2.5
const POLL_MS = 3000
const POLL_CAP_MS = 5 * 60 * 1000

export default function useMapReports(enabled: boolean, projectId: string | null, parcelId: string | null, projectName: string | null) {
  const [rows, setRows] = useState<ReportRow[]>([])
  const [queuing, setQueuing] = useState<string | null>(null)   // '<kind>:<parcelId|"">'
  const [deleting, setDeleting] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  // "Notes on this report" (owner 11/10): which timeline entries print.
  const [notesPrint, setNotesPrint] = useState<NotesPrint>(DEFAULT_NOTES_PRINT)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  // "Choose notes" (owner 11/11): this map first, then the project's other
  // maps (the Aerial Map prints every one). Loaded only when the user picks.
  const [projectMaps, setProjectMaps] = useState<NotePickItem[] | null>(null)
  useEffect(() => { setProjectMaps(null) }, [projectId])
  useEffect(() => {
    if (!enabled || notesPrint.mode !== 'pick' || !projectId || projectMaps) return
    let live = true
    getProject(projectId)
      .then((r) => { if (live) setProjectMaps((r.parcels || []).map((p) => ({ key: `cm:${String(p.id).toLowerCase()}`, label: p.name || 'Untitled' }))) })
      .catch(() => { if (live) setProjectMaps([]) })
    return () => { live = false }
  }, [enabled, notesPrint.mode, projectId, projectMaps])
  const noteItems = useMemo<NotePickItem[]>(() => {
    const own = parcelId ? [{ key: `cm:${parcelId.toLowerCase()}`, label: 'This map' }] : []
    const rest = (projectMaps || []).filter((m) => !own.some((o) => o.key === m.key))
    const mine = parcelId && projectMaps?.find((m) => m.key === own[0].key)
    return [...own.map((o) => (mine ? { ...o, label: mine.label } : o)), ...rest]
  }, [parcelId, projectMaps])

  const load = useCallback(async () => {
    if (!projectId) return
    try {
      const r = await listReports({ projectId })
      // This map's reports plus the project-level ones (the Aerial Map).
      if (alive.current) setRows((r.reports || []).filter((x) => !x.parcel_id || x.parcel_id === parcelId))
    } catch (e: any) {
      if (alive.current) setMsg(e?.message || 'Could not load the reports.')
    }
  }, [projectId, parcelId])

  useEffect(() => { setRows([]); setMsg(null); if (enabled) void load() }, [enabled, load])

  const pending = rows.some((r) => r.status === 'queued' || r.status === 'running')
  useEffect(() => {
    if (!enabled || !pending) return
    const started = Date.now()
    const t = setInterval(() => {
      if (Date.now() - started > POLL_CAP_MS) { clearInterval(t); return }
      void load()
    }, POLL_MS)
    return () => clearInterval(t)
  }, [enabled, pending, load])

  const queue = async (kind: ReportKind, projectLevel: boolean) => {
    if (!projectId) return
    const key = `${kind}:${projectLevel ? '' : parcelId || ''}`
    setQueuing(key); setMsg(null)
    try {
      await queueReport(
        projectLevel ? { projectId } : { parcelId: parcelId || undefined }, kind,
        { ...(USES_ELEVATION.includes(kind) ? { exaggeration: DEFAULT_EXAGGERATION } : {}), notes_print: notesPrintBody(notesPrint) })
      await load()
    } catch (e: any) {
      if (alive.current) setMsg(e?.message || 'Could not start that report.')
    } finally { if (alive.current) setQueuing(null) }
  }

  const download = async (r: ReportRow) => {
    setMsg(null)
    try { await downloadReport(r.id, reportFilename(projectName, r.kind)) }
    catch (e: any) { setMsg(e?.message || 'That report could not be downloaded.') }
  }

  const remove = async (r: ReportRow, label: string) => {
    if (!window.confirm(`Delete this ${label}?`)) return
    setDeleting(r.id); setMsg(null)
    try {
      await deleteReport(r.id)
      setRows((x) => x.filter((o) => o.id !== r.id))
    } catch (e: any) {
      setMsg(e?.message || 'That report could not be deleted.')
    } finally { setDeleting(null) }
  }

  return { rows, queuing, deleting, msg, setMsg, pending, queue, download, remove, reload: load, notesPrint, setNotesPrint, noteItems }
}
