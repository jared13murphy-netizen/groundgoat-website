'use client'

/**
 * useTractEditor — ONE tract's Configurable Mapping edit session, on an
 * existing MapLibre map (the Explore map's "Map It").
 *
 * Lifted out of ConfigureMap.tsx and cut down to a single tract: the
 * same geometry semantics (magnet snap to regrid-parcels-line, simplify
 * at 0.000004, normalize after every edit, outline -> land types), the
 * same server calls, the same save payload. ConfigureMap keeps its own
 * copy of the logic for the multi-tract page.
 *
 * The hook owns the cm-* sources/layers while `enabled` (added with
 * addCmEditLayers, removed on disable/unmount) and registers its map
 * handlers with map.on / map.off inside effects keyed on `enabled`.
 * The host is responsible for suspending its own map interactions
 * (Explore: mapInteractionSuspendedRef) while a session is live.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'
import {
  CLASS_COLOR, LAND_CLASSES, classifyBoundary, combineGeometry, fetchParcel, fitTracts, getSavedParcel,
  normalizeGeometry, parcelsUnder, previewSoil, saveParcel, splitGeometry, updateParcel,
  type LandClass, type ParcelDetail,
} from '@/lib/configurableMapping'
import {
  SRC, LYR_VERTS, LYR_FILL, nextId, geometryToPolys, explodeShapes, simplifyShapes,
  pointInRing, dropDegenerateHoles, pointInBoundary, ringCentre, polysToGeometry,
  shapeAcres, boundaryAcresOf, bboxOf, snapTargetsNear, type Shape,
} from '@/lib/cmShapes'
import {
  nearestSegmentIndex, simplifyRing, snapPoint, type Pt,
} from '@/lib/polygonEditing'
import { addCmEditLayers, removeCmEditLayers } from './cmMapLayers'

export type TractTool = 'draw' | 'drawtract' | 'cutpoly' | 'erase' | null
export type TractMode = 'outline' | 'landtypes'

export interface SavedInfo {
  id: string
  projectId: string | null
  projectName: string | null
  name: string
  stats: any
}

export interface SaveOptions {
  name: string
  /** Existing project to add to; null = none (the server makes its own). */
  projectId?: string | null
  /** Name for a project to create; ignored when projectId is set. */
  projectName?: string | null
  /** Display name of the chosen existing project (for the host's toast). */
  projectLabel?: string | null
}

/** How a Map It session starts:
 *  parcel — load that parcel's outline (the parcel-panel entry);
 *  tract  — open a saved tract for editing (boundary + land types, Save = PUT);
 *  empty  — nothing yet: draw a tract or choose a parcel (Add a New Tract). */
export type TractStart =
  | { kind: 'parcel'; ll_uuid: string }
  | { kind: 'tract'; id: string }
  | { kind: 'empty' }

interface Params {
  mapRef: { current: maplibregl.Map | null }
  enabled: boolean
  start: TractStart | null
  /** Locked project the tract belongs to (Add a New Tract / Edit). */
  projectId: string | null
  projectName?: string | null
  onSaved?: (info: SavedInfo) => void
  onBusy?: (msg: string | null) => void
  onError?: (msg: string | null) => void
}

type Snap = { boundary: Pt[][][]; shapes: Shape[]; classified: boolean }
type Hist =
  | { kind: 'shapes'; prev: Shape[] }
  | { kind: 'tract'; prev: Snap }
  | { kind: 'draft'; prev: Pt[] }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

const coarsePointer = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches

export function useTractEditor({
  mapRef, enabled, start, projectId, projectName, onSaved, onBusy, onError,
}: Params) {
  // ── state ────────────────────────────────────────────────────────
  const [detail, setDetail] = useState<ParcelDetail | null>(null)
  const [boundary, setBoundaryState] = useState<Pt[][][]>([])
  const [shapes, setShapesState] = useState<Shape[]>([])
  const [classified, setClassified] = useState(false)
  const [mode, setModeState] = useState<TractMode>('outline')
  const [tool, setTool] = useState<TractTool>(null)
  const [drawing, setDrawing] = useState(false)
  const [draft, setDraft] = useState<Pt[]>([])
  const [cutPts, setCutPts] = useState<Pt[]>([])
  const [marq, setMarq] = useState<[Pt, Pt] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawClass, setDrawClassState] = useState<LandClass>('tillable')
  const [frame, setFrame] = useState<{ ll_uuids: string[]; boundary: Pt[][][] } | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusyState] = useState<string | null>(null)
  const [error, setErrorState] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [soil, setSoil] = useState<{ rating: number | null; rating_type: string | null } | null>(null)
  const [soilBusy, setSoilBusy] = useState(false)
  const [layerTick, setLayerTick] = useState(0)
  const [savedName, setDefaultNameSaved] = useState('')
  const [, forceHist] = useState(0)

  // ── refs mirroring state for map handlers (registered once) ──────
  const boundaryRef = useRef(boundary); boundaryRef.current = boundary
  const shapesRef = useRef(shapes); shapesRef.current = shapes
  const classifiedRef = useRef(classified); classifiedRef.current = classified
  const detailRef = useRef(detail); detailRef.current = detail
  const modeRef = useRef(mode); modeRef.current = mode
  const toolRef = useRef(tool); toolRef.current = tool
  const drawingRef = useRef(drawing); drawingRef.current = drawing
  const draftRef = useRef(draft); draftRef.current = draft
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId
  const drawClassRef = useRef(drawClass); drawClassRef.current = drawClass
  const frameRef = useRef(frame); frameRef.current = frame
  const marqRef = useRef(marq); marqRef.current = marq
  const cutPtsRef = useRef(cutPts); cutPtsRef.current = cutPts
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved
  const onBusyRef = useRef(onBusy); onBusyRef.current = onBusy
  const onErrorRef = useRef(onError); onErrorRef.current = onError
  const projectIdRef = useRef(projectId); projectIdRef.current = projectId
  const projectNameRef = useRef(projectName); projectNameRef.current = projectName
  /** source parcels of a saved tract being edited (no detail record). */
  const sourceRef = useRef<string[]>([])

  const histRef = useRef<Hist[]>([])
  const redoRef = useRef<Hist[]>([])
  const cleanRef = useRef('')
  const savedIdRef = useRef<string | null>(null)
  const savingRef = useRef(false)
  const classifyingRef = useRef<Promise<void> | null>(null)
  const loadSeq = useRef(0)
  const prewarmRef = useRef<{ key: string; p: Promise<any> } | null>(null)

  const setBusy = useCallback((m: string | null) => {
    setBusyState(m); onBusyRef.current?.(m)
  }, [])
  const setError = useCallback((m: string | null) => {
    setErrorState(m); onErrorRef.current?.(m)
  }, [])

  // ── history ──────────────────────────────────────────────────────
  const pushHist = useCallback((e: Hist) => {
    histRef.current.push(clone(e))
    if (histRef.current.length > 200) histRef.current.shift()
    redoRef.current = []
    forceHist((t) => t + 1)
  }, [])
  const snapshotShapes = useCallback(() => {
    pushHist({ kind: 'shapes', prev: shapesRef.current })
  }, [pushHist])
  const snapshotTract = useCallback(() => {
    pushHist({
      kind: 'tract',
      prev: { boundary: boundaryRef.current, shapes: shapesRef.current, classified: classifiedRef.current },
    })
  }, [pushHist])
  const snapshotDraft = useCallback(() => {
    pushHist({ kind: 'draft', prev: draftRef.current })
  }, [pushHist])
  const dropDraftHist = useCallback(() => {
    histRef.current = histRef.current.filter((e) => e.kind !== 'draft')
    redoRef.current = redoRef.current.filter((e) => e.kind !== 'draft')
    forceHist((t) => t + 1)
  }, [])
  const dropShapesHist = useCallback(() => {
    histRef.current = histRef.current.filter((e) => e.kind !== 'shapes')
    redoRef.current = redoRef.current.filter((e) => e.kind !== 'shapes')
    forceHist((t) => t + 1)
  }, [])

  const mutate = useCallback((fn: (s: Shape[]) => Shape[]) => {
    // Snapshot OUTSIDE the updater (a side effect React may run twice).
    snapshotShapes()
    setShapesState(fn)
  }, [snapshotShapes])

  const undo = useCallback(() => {
    const e = histRef.current.pop(); if (!e) return
    if (e.kind === 'shapes') {
      redoRef.current.push({ kind: 'shapes', prev: clone(shapesRef.current) })
      setShapesState(e.prev)
    } else if (e.kind === 'tract') {
      redoRef.current.push({ kind: 'tract', prev: clone({
        boundary: boundaryRef.current, shapes: shapesRef.current, classified: classifiedRef.current }) })
      setBoundaryState(e.prev.boundary); setShapesState(e.prev.shapes); setClassified(e.prev.classified)
    } else {
      redoRef.current.push({ kind: 'draft', prev: clone(draftRef.current) })
      setDraft(e.prev)
    }
    forceHist((t) => t + 1)
  }, [])
  const redo = useCallback(() => {
    const e = redoRef.current.pop(); if (!e) return
    if (e.kind === 'shapes') {
      histRef.current.push({ kind: 'shapes', prev: clone(shapesRef.current) })
      setShapesState(e.prev)
    } else if (e.kind === 'tract') {
      histRef.current.push({ kind: 'tract', prev: clone({
        boundary: boundaryRef.current, shapes: shapesRef.current, classified: classifiedRef.current }) })
      setBoundaryState(e.prev.boundary); setShapesState(e.prev.shapes); setClassified(e.prev.classified)
    } else {
      histRef.current.push({ kind: 'draft', prev: clone(draftRef.current) })
      setDraft(e.prev)
    }
    forceHist((t) => t + 1)
  }, [])

  // ── dirty tracking ───────────────────────────────────────────────
  const fingerprint = (sh: Shape[], b: Pt[][][]) => JSON.stringify([sh.map((x) => [x.cls, x.polys]), b])
  const markClean = useCallback((sh: Shape[], b: Pt[][][]) => {
    cleanRef.current = fingerprint(sh, b)
    setDirty(false)
  }, [])
  useEffect(() => {
    if (!enabled) return
    setDirty(fingerprint(shapes, boundary) !== cleanRef.current || (drawing && draft.length > 0))
  }, [enabled, shapes, boundary, drawing, draft])

  /** An outline edit invalidates land types classified for the OLD
   *  outline — clear them so the engine re-reads the new shape. The
   *  caller has already taken its own undo snapshot. */
  const reclassifyOnBoundaryEdit = useCallback(() => {
    if (!shapesRef.current.length && !classifiedRef.current) return
    setShapesState([]); setClassified(false); setSelectedId(null)
    setNotice('Outline changed — land types re-read for the new shape.')
  }, [])

  // ── load the starting parcel ─────────────────────────────────────
  const fitMap = useCallback((bb: [[number, number], [number, number]] | null) => {
    const map = mapRef.current
    if (!map || !bb) return
    map.fitBounds(bb as any, { padding: { top: 90, bottom: 150, left: 60, right: 60 }, maxZoom: 18, duration: 700 })
  }, [mapRef])

  const resetSession = useCallback(() => {
    loadSeq.current++
    histRef.current = []; redoRef.current = []
    savedIdRef.current = null; classifyingRef.current = null; sourceRef.current = []
    setDetail(null); setBoundaryState([]); setShapesState([]); setClassified(false)
    setDefaultNameSaved('')
    setModeState('outline'); setTool(null); setDrawing(false); setDraft([]); setCutPts([])
    setMarq(null); setSelectedId(null); setFrame(null); setSoil(null)
    setBusyState(null); setErrorState(null); setNotice(null); setDirty(false); setLoading(false)
    cleanRef.current = fingerprint([], [])
  }, [])

  const startLlUuid = start?.kind === 'parcel' ? start.ll_uuid : null
  const startTractId = start?.kind === 'tract' ? start.id : null

  /** Load a parcel's outline as the tract outline. Used by the parcel
   *  entry and by "Choose Parcel" in an Add-a-New-Tract session. */
  const loadParcel = useCallback(async (llUuid: string, replacing = false) => {
    const seq = ++loadSeq.current
    setLoading(true); setBusy('Loading parcel…'); setError(null)
    try {
      const d = await fetchParcel(llUuid, { engine: false })
      if (seq !== loadSeq.current) return
      const rings = geometryToPolys(d.boundary)
      if (replacing) snapshotTract()
      setDetail(d)
      // Warm the engine for this outline in the background so the Land
      // Types step is instant when the outline is left as is. Discarded
      // by ensureClassified if the boundary changed in the meantime.
      prewarmRef.current = {
        key: JSON.stringify(d.boundary),
        p: classifyBoundary(d.boundary, d.parcel?.state ?? null).catch(() => null),
      }
      boundaryRef.current = rings; shapesRef.current = []; classifiedRef.current = false
      setBoundaryState(rings)
      setShapesState([]); setClassified(false); setSelectedId(null); setFrame(null)
      if (!replacing) markClean([], rings)
      fitMap(bboxOf(d.boundary?.coordinates))
    } catch (e: any) {
      if (seq === loadSeq.current) setError(e?.message || 'Could not load that parcel.')
    } finally {
      if (seq === loadSeq.current) { setLoading(false); setBusy(null) }
    }
  }, [fitMap, markClean, setBusy, setError, snapshotTract])

  useEffect(() => {
    if (!enabled) { resetSession(); return }
    resetSession()
    if (startLlUuid) { void loadParcel(startLlUuid); return }
    if (!startTractId) return
    const seq = loadSeq.current
    setLoading(true); setBusy('Opening map…')
    ;(async () => {
      try {
        const t = await getSavedParcel(startTractId)
        if (seq !== loadSeq.current) return
        const rings = geometryToPolys(t.boundary)
        const loaded = simplifyShapes(explodeShapes(t.polygons as any))
        savedIdRef.current = t.id
        sourceRef.current = t.source_ll_uuids || []
        boundaryRef.current = rings; shapesRef.current = loaded; classifiedRef.current = true
        setBoundaryState(rings)
        setShapesState(loaded); setClassified(true)
        setDefaultNameSaved(t.name || '')
        markClean(loaded, rings)
        fitMap(bboxOf(t.boundary?.coordinates))
      } catch (e: any) {
        if (seq === loadSeq.current) setError(e?.message || 'Could not open that map.')
      } finally {
        if (seq === loadSeq.current) { setLoading(false); setBusy(null) }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, startLlUuid, startTractId])

  // ── classify (outline -> land types) ─────────────────────────────
  const ensureClassified = useCallback(async (): Promise<void> => {
    if (classifiedRef.current) return
    if (classifyingRef.current) return classifyingRef.current
    const geom = polysToGeometry(boundaryRef.current)
    if (!geom) return
    const state = detailRef.current?.parcel?.state ?? null
    const run = (async () => {
      setBusy('Fitting land types to the boundary…'); setError(null)
      try {
        const warm = prewarmRef.current
        const fresh: Awaited<ReturnType<typeof classifyBoundary>> =
          (warm && warm.key === JSON.stringify(geom) ? await warm.p : null)
          ?? await classifyBoundary(geom, state)
        // Still normalise: the engine's classes are disjoint, but the
        // user may already have drawn shapes of their own over them.
        const res = await normalizeGeometry(
          geom, fresh.polygons.map((p) => ({ cls: p.cls, geometry: p.geometry })))
        if (!fresh.engine_covered) {
          setError('Part of this boundary is outside the mapped area — '
                 + 'the land types there have not been filled in.')
        }
        const loaded = simplifyShapes(explodeShapes(res.polygons as any))
        // Refs updated eagerly: save() reads them straight after the await,
        // before React has re-rendered.
        shapesRef.current = loaded; classifiedRef.current = true
        setShapesState(loaded)
        setClassified(true)
        setDetail((d) => (d ? { ...d, boundary: geom } : d))
        markClean(loaded, boundaryRef.current)
        dropShapesHist()
        setSelectedId(loaded.length
          ? loaded.reduce((a, b) => (shapeAcres(b) > shapeAcres(a) ? b : a)).id
          : null)
      } catch (e: any) {
        setError(e?.message || 'Could not fit the land types to that boundary.')
      } finally { setBusy(null); classifyingRef.current = null }
    })()
    classifyingRef.current = run
    return run
  }, [setBusy, setError, markClean, dropShapesHist])

  // Land types classify ONLY on entering 'landtypes' mode.
  useEffect(() => {
    if (enabled && mode === 'landtypes' && !classified && boundary.length) void ensureClassified()
  }, [enabled, mode, classified, boundary.length, ensureClassified])

  const setMode = useCallback((m: TractMode) => {
    if (m === modeRef.current) return
    // A draft never survives a mode change.
    setTool(null); setDrawing(false); setDraft([]); setCutPts([]); setMarq(null)
    dropDraftHist()
    setSelectedId(null)
    setModeState(m)
  }, [dropDraftHist])

  // ── overlap enforcement ──────────────────────────────────────────
  const enforceNoOverlap = useCallback(async (next: Shape[], keepId?: string | null) => {
    const bGeom = polysToGeometry(boundaryRef.current) || detailRef.current?.boundary
    if (!bGeom) return
    // Normalising rebuilds every shape with a fresh id, so keep a
    // fingerprint of the shape being edited and re-select its replacement.
    const keep = keepId ? next.find((sh) => sh.id === keepId) : undefined
    const mark = keep ? ringCentre(keep.polys) : null
    try {
      const res = await normalizeGeometry(bGeom, next
        .map((sh) => ({ cls: sh.cls, geometry: polysToGeometry(sh.polys) }))
        .filter((x) => x.geometry) as any)
      const rebuilt = explodeShapes(res.polygons as any)
      setShapesState(rebuilt)
      let again: string | null = null
      if (keep && mark) {
        let best = Infinity
        for (const sh of rebuilt) {
          if (sh.cls !== keep.cls) continue
          const c = ringCentre(sh.polys)
          if (!c) continue
          const d = (c[0] - mark[0]) ** 2 + (c[1] - mark[1]) ** 2
          if (d < best) { best = d; again = sh.id }
        }
      }
      setSelectedId(again)
    } catch (e: any) {
      setError(e?.message || 'Could not fit that shape to the others.')
    }
  }, [setError])
  const enforceRef = useRef(enforceNoOverlap); enforceRef.current = enforceNoOverlap

  // ── shape actions ────────────────────────────────────────────────
  const setClassOf = useCallback((id: string, cls: LandClass) => {
    mutate((prev) => prev.map((s) => (s.id === id ? { ...s, cls } : s)))
  }, [mutate])

  const setDrawClass = useCallback((c: LandClass) => {
    setDrawClassState(c)
    if (selectedRef.current) setClassOf(selectedRef.current, c)
  }, [setClassOf])

  const deleteShape = useCallback((id: string) => {
    const gone = shapesRef.current.find((s) => s.id === id)
    const rest = shapesRef.current.filter((s) => s.id !== id)
    const goneOuter = gone?.polys[0]?.[0]
    // Close the hole the deleted polygon was sitting in, so the ground
    // becomes part of its neighbour rather than a differently coloured
    // patch (unless another polygon still occupies that hole).
    const next = !goneOuter ? rest : rest.map((sh) => ({
      ...sh,
      polys: sh.polys.map((rings) => rings.filter((ring, ri) => {
        if (ri === 0) return true
        const c = ringCentre([[ring]])
        if (!c || !pointInRing(c, goneOuter)) return true
        return rest.some((o) => {
          if (o.id === sh.id) return false
          const oc = ringCentre(o.polys)
          return !!oc && pointInRing(oc, ring)
        })
      })),
    }))
    mutate(() => next)
    setSelectedId((cur) => (cur === id ? null : cur))
    void enforceRef.current(next, null)
  }, [mutate])
  const deleteSelected = useCallback(() => {
    if (selectedRef.current) deleteShape(selectedRef.current)
  }, [deleteShape])

  const fillHoles = useCallback(() => {
    const id = selectedRef.current
    if (!id) return
    const next = shapesRef.current.map((sh) => sh.id !== id ? sh : {
      ...sh, polys: sh.polys.map((rings) => rings.slice(0, 1)),
    })
    mutate(() => next)
    void enforceRef.current(next, id)
  }, [mutate])

  const clearPolygons = useCallback(() => {
    if (!shapesRef.current.length) return
    mutate(() => [])
    setSelectedId(null)
  }, [mutate])

  /** Back to the engine's land types for the current outline. No API
   *  call when the engine polygons are already loaded with the parcel;
   *  otherwise re-classifies. */
  const startOver = useCallback(() => {
    const d = detailRef.current
    if (d?.polygons?.length && sameBoundaryAsParcel(boundaryRef.current, d)) {
      mutate(() => simplifyShapes(explodeShapes(d.polygons as any)))
      setSelectedId(null)
      return
    }
    // Outline was edited — the parcel's own polygons no longer fit it.
    snapshotTract()
    setShapesState([]); setClassified(false); setSelectedId(null)
  }, [mutate, snapshotTract])

  const holesOnSelected = useMemo(() => {
    const sh = shapes.find((x) => x.id === selectedId)
    return sh ? sh.polys.reduce((n, rings) => n + Math.max(rings.length - 1, 0), 0) : 0
  }, [shapes, selectedId])

  // ── tools ────────────────────────────────────────────────────────
  const cancelDraft = useCallback(() => {
    setDraft([]); setDrawing(false); setTool(null); setCutPts([]); dropDraftHist()
  }, [dropDraftHist])

  const startDrawTract = useCallback(() => {
    if (toolRef.current === 'drawtract' && drawingRef.current) { cancelDraft(); return }
    setTool('drawtract'); setDrawing(true); setDraft([]); setCutPts([])
  }, [cancelDraft])
  const startDrawPolygon = useCallback(() => {
    if (toolRef.current === 'draw' && drawingRef.current) { cancelDraft(); return }
    setTool('draw'); setDrawing(true); setDraft([]); setCutPts([])
  }, [cancelDraft])
  const toggleCut = useCallback(() => {
    if (toolRef.current === 'cutpoly') { setTool(null); setCutPts([]); return }
    setTool('cutpoly'); setCutPts([]); setDrawing(false); setDraft([])
  }, [])
  const toggleErase = useCallback(() => {
    setTool(toolRef.current === 'erase' ? null : 'erase'); setMarq(null)
    setDrawing(false); setDraft([])
  }, [])

  /** Turn the current draft into a land-type polygon ('draw') or the
   *  tract outline ('drawtract'). Dblclick, Enter, and Save all use it. */
  const finishDraft = useCallback((): boolean => {
    const d = draftRef.current
    let made = false
    if (d.length >= 3) {
      const ring = simplifyRing(d, 0.000004)
      if (toolRef.current === 'drawtract') {
        // Single-tract session: the drawn ring REPLACES the outline.
        snapshotTract()
        boundaryRef.current = [[ring]]; shapesRef.current = []; classifiedRef.current = false
        setBoundaryState([[ring]])
        setShapesState([]); setClassified(false); setSelectedId(null)
        setFrame(null)
        made = true
      } else {
        const id = nextId()
        const next = [...shapesRef.current, { id, cls: drawClassRef.current, polys: [[ring]] }]
        mutate(() => next)
        shapesRef.current = next   // eager: Save may follow before the next render
        // Drawn last, so this one wins any overlap — then the server
        // trims the others and clips everything to the boundary.
        void enforceRef.current(next)
        setSelectedId(id)
        made = true
      }
    }
    dropDraftHist()
    setDraft([]); setDrawing(false); setTool(null)
    return made
  }, [mutate, snapshotTract, dropDraftHist])
  const finishDraftRef = useRef(finishDraft); finishDraftRef.current = finishDraft

  const runCut = useCallback(async (line: Pt[]) => {
    const id = selectedRef.current
    const target = shapesRef.current.find((sh) => sh.id === id)
    if (!target) { setError('Select a polygon first, then cut it.'); return }
    const geom = polysToGeometry(target.polys)
    if (!geom) return
    const [a, b] = line
    const dx = b[0] - a[0], dy = b[1] - a[1]
    // Extended well past both clicks so a click landing just inside the
    // polygon still cuts clean through.
    const ext: Pt[] = [[a[0] - dx, a[1] - dy], [b[0] + dx, b[1] + dy]]
    setBusy('Cutting…'); setError(null)
    try {
      const res = await splitGeometry(geom, { type: 'LineString', coordinates: ext })
      if (!res.pieces || res.pieces.length < 2) {
        setError('That line did not cut the polygon — click once on each side of it.')
        return
      }
      const next = shapesRef.current.filter((sh) => sh.id !== id).concat(
        res.pieces.map((pc) => ({
          id: nextId(), cls: target.cls, polys: geometryToPolys(pc.geometry),
        })).filter((x) => x.polys.length > 0))
      mutate(() => next)
      setSelectedId(null)
      setTool(null)
    } catch (e: any) {
      setError(e?.message || 'Could not cut that polygon.')
    } finally { setBusy(null) }
  }, [mutate, setBusy, setError])
  const runCutRef = useRef(runCut); runCutRef.current = runCut

  const eraseInBox = useCallback((b: [Pt, Pt]) => {
    const x0 = Math.min(b[0][0], b[1][0]), x1 = Math.max(b[0][0], b[1][0])
    const y0 = Math.min(b[0][1], b[1][1]), y1 = Math.max(b[0][1], b[1][1])
    if (Math.abs(x1 - x0) < 1e-9 || Math.abs(y1 - y0) < 1e-9) return
    const inside = (pt: Pt) => pt[0] >= x0 && pt[0] <= x1 && pt[1] >= y0 && pt[1] <= y1
    // Ring 0 must stay a polygon; rings 1+ are holes and may go entirely.
    const trim = (ring: Pt[], ri: number) => {
      const kept = ring.filter((pt) => !inside(pt))
      if (kept.length >= 3) return kept
      return ri === 0 ? ring : []
    }
    let removed = 0
    const id = selectedRef.current
    if (!id) { setError('Select a polygon first, then drag over its points.'); return }
    mutate((prev) => prev.map((sh) => sh.id !== id ? sh : {
      ...sh,
      polys: sh.polys.map((rings) => dropDegenerateHoles(
        rings.map((ring, ri) => {
          const t = trim(ring, ri); removed += ring.length - t.length; return t
        }))),
    }))
    if (!removed) setError('No points inside that box — drag a box right over the dots.')
  }, [mutate, setError])
  const eraseRef = useRef(eraseInBox); eraseRef.current = eraseInBox

  /** 'Snap to Parcel' for the one tract: fit it to the parcel lines
   *  underneath so the acres are exact. The parcel it came from is the
   *  frame; a free-hand tract finds the parcels under it. */
  const snapToParcel = useCallback(async () => {
    const own = polysToGeometry(boundaryRef.current)
    if (!own) return
    setBusy('Snapping to the parcel…'); setError(null)
    try {
      let frameGeom: any = null
      let frameParts: any[] = []
      let frameMeta: { ll_uuids: string[]; boundary: Pt[][][] } | null = null
      const d = detailRef.current
      if (d?.boundary) {
        frameGeom = d.boundary
        frameParts = [frameGeom]
        frameMeta = {
          ll_uuids: [String(d.parcel?.ll_uuid || '')].filter(Boolean),
          boundary: geometryToPolys(frameGeom),
        }
      } else {
        const under = (await parcelsUnder([own])).parcels
        frameParts = under.map((p) => p.geometry)
        if (under.length === 1) {
          frameGeom = under[0].geometry
          frameMeta = { ll_uuids: [under[0].ll_uuid], boundary: geometryToPolys(frameGeom) }
        } else if (under.length > 1) {
          frameGeom = (await combineGeometry(under.map((p) => p.geometry))).geometry
          frameMeta = { ll_uuids: under.map((p) => p.ll_uuid), boundary: geometryToPolys(frameGeom) }
        } else {
          setError('No recorded parcel lines under this tract to snap to — '
            + 'drag the corners to adjust it instead.')
          return
        }
      }
      setFrame(frameMeta)
      const res = await fitTracts(frameGeom, [{ id: 'tract', geometry: own }], frameParts)
      const hit = res.tracts.find((r) => r.id === 'tract')
      if (!hit || res.dropped.length) {
        setError('No ground was left after fitting to the parcel — check the outline.')
        return
      }
      snapshotTract()
      setBoundaryState(geometryToPolys(hit.geometry))
      setShapesState([]); setClassified(false); setSelectedId(null)
      if (res.unassigned_acres >= 0.5) {
        setNotice(`Snapped to the parcel lines — ${res.unassigned_acres.toFixed(1)} ac of the `
          + `${res.frame_acres.toFixed(1)} ac parcel is outside this tract.`)
      } else {
        setNotice(`Fit to ${res.frame_acres.toFixed(1)} ac.`)
      }
    } catch (e: any) {
      setError(e?.message || 'Could not snap this tract.')
    } finally { setBusy(null) }
  }, [setBusy, setError, snapshotTract])

  // ── soil preview (debounced, real SSURGO query) ──────────────────
  const tillableKey = useMemo(
    () => shapes.filter((sh) => sh.cls === 'tillable')
      .map((sh) => sh.polys.flat().flat().map((pt) => pt.join(',')).join(';')).join('|'),
    [shapes])
  useEffect(() => {
    if (!enabled || mode !== 'landtypes') { setSoil(null); return }
    const tillable = shapes.filter((sh) => sh.cls === 'tillable')
      .map((sh) => polysToGeometry(sh.polys)).filter(Boolean)
    if (!tillable.length) { setSoil(null); return }
    // A hand-drawn tract has no parcel record, so no state — the server
    // infers it from the ground under the polygons.
    const st = detailRef.current?.parcel?.state || null
    let cancelled = false
    setSoilBusy(true)
    const t = setTimeout(async () => {
      try {
        const r = await previewSoil(tillable, st,
          detailRef.current?.boundary ?? polysToGeometry(boundaryRef.current))
        if (!cancelled) setSoil({ rating: r.rating, rating_type: r.rating_type })
      } catch {
        if (!cancelled) setSoil(null)
      } finally {
        if (!cancelled) setSoilBusy(false)
      }
    }, 700)
    return () => { cancelled = true; clearTimeout(t); setSoilBusy(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tillableKey, mode, detail?.boundary])

  const totals = useMemo(() => {
    const t: Record<string, number> = {}
    for (const c of LAND_CLASSES) t[c] = 0
    for (const s of shapes) t[s.cls] += shapeAcres(s)
    return t
  }, [shapes])
  const boundaryAcres = useMemo(() => boundaryAcresOf(boundary), [boundary])

  // ── name suggestion ──────────────────────────────────────────────
  const defaultName = useMemo(() => {
    if (savedName) return savedName
    const p = detail?.parcel
    if (p?.parcelnumb) return `Parcel ${p.parcelnumb}`
    if (p?.owner) return String(p.owner)
    return ''
  }, [detail, savedName])

  // ── save ─────────────────────────────────────────────────────────
  const save = useCallback(async (opts: SaveOptions): Promise<boolean> => {
    if (savingRef.current) return false
    const name = opts.name.trim()
    if (!name) { setError('Name this tract before saving.'); return false }
    // Finish a ring in progress first.
    if (drawingRef.current && draftRef.current.length >= 3) finishDraftRef.current()
    if (!polysToGeometry(boundaryRef.current) && !detailRef.current?.boundary) {
      setError('Draw or pick an outline first.'); return false
    }
    savingRef.current = true
    try {
      // Saved without ever opening Land Types: classify now so the
      // tract is stored with the engine's land types, not an empty set.
      if (!classifiedRef.current) await ensureClassified()
      // let overlap normalisation from a just-finished ring land
      await new Promise((r) => setTimeout(r, 0))
      const boundaryGeom = polysToGeometry(boundaryRef.current) || detailRef.current?.boundary
      const payload = {
        name,
        boundary: boundaryGeom,
        polygons: shapesRef.current
          .map((s) => ({ cls: s.cls, geometry: polysToGeometry(s.polys) }))
          .filter((p) => p.geometry) as any,
        source_ll_uuids: detailRef.current?.parcel?.ll_uuid
          ? [String(detailRef.current.parcel.ll_uuid)]
          : sourceRef.current,
        project_id: opts.projectId ?? null,
        project_name: opts.projectId ? null : (opts.projectName?.trim() || null),
      }
      setBusy('Saving…'); setError(null)
      const res = savedIdRef.current
        ? await updateParcel(savedIdRef.current, payload)
        : await saveParcel(payload)
      savedIdRef.current = res.id
      markClean(shapesRef.current, boundaryRef.current)
      onSavedRef.current?.({
        id: res.id,
        projectId: 'project_id' in res ? (res as any).project_id : (opts.projectId ?? null),
        projectName: (opts.projectId ? opts.projectLabel : opts.projectName?.trim()) || null,
        name: res.name || name,
        stats: res.stats || {},
      })
      return true
    } catch (e: any) {
      setError(e?.message || 'Save failed.')
      return false
    } finally { setBusy(null); savingRef.current = false }
  }, [ensureClassified, markClean, setBusy, setError])

  // ── keyboard: Enter finishes a ring, Esc cancels, Cmd/Ctrl-Z undo ─
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'Enter' && drawingRef.current) { e.preventDefault(); finishDraftRef.current() }
      if (e.key === 'Escape') {
        if (drawingRef.current || draftRef.current.length || toolRef.current) {
          setDraft([]); setDrawing(false); setCutPts([]); setMarq(null); setTool(null); dropDraftHist()
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); e.shiftKey ? redo() : undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, undo, redo, dropDraftHist])

  // ── layers + double-click-zoom lifecycle ─────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!enabled || !map) return
    const hadDblZoom = map.doubleClickZoom.isEnabled()
    map.doubleClickZoom.disable()
    addCmEditLayers(map)
    // Re-add (and re-sync) if the style is swapped out underneath us.
    const onStyle = () => {
      if (!map.getSource(SRC.shapes)) { addCmEditLayers(map); setLayerTick((t) => t + 1) }
    }
    map.on('styledata', onStyle)
    setLayerTick((t) => t + 1)
    return () => {
      map.off('styledata', onStyle)
      removeCmEditLayers(map)
      if (hadDblZoom) map.doubleClickZoom.enable()
      try { map.getCanvas().style.cursor = '' } catch { /* gone */ }
    }
  }, [enabled, mapRef])

  // ── paint state into the cm-* sources ────────────────────────────
  const setSrc = (map: maplibregl.Map, id: string, features: any[]) => {
    ;(map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(
      { type: 'FeatureCollection', features } as any)
  }

  useEffect(() => {
    const map = mapRef.current
    if (!enabled || !map || !map.getSource(SRC.shapes)) return
    // Land-type shapes only in 'landtypes' mode; 'outline' is boundary-only.
    const feats: any[] = []
    if (mode === 'landtypes') {
      for (const s of shapes) {
        const g = polysToGeometry(s.polys)
        if (g) feats.push({
          type: 'Feature', geometry: g,
          properties: { id: s.id, color: CLASS_COLOR[s.cls], selected: s.id === selectedId },
        })
      }
    }
    setSrc(map, SRC.shapes, feats)

    // Handles: every boundary point in 'outline'; the selected shape's
    // points in 'landtypes' (the outline is not edited there).
    const verts: any[] = []
    if (mode === 'outline') {
      boundary.forEach((rings, pi) => rings.forEach((ring, ri) =>
        ring.forEach((pt, vi) => verts.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: pt },
          properties: { shapeId: '__boundary__', pi, ri, vi, active: true },
        }))))
    } else {
      const sel = shapes.find((sh) => sh.id === selectedId)
      sel?.polys.forEach((rings, pi) => rings.forEach((ring, ri) =>
        ring.forEach((pt, vi) => verts.push({
          type: 'Feature', geometry: { type: 'Point', coordinates: pt },
          properties: { shapeId: sel.id, pi, ri, vi, active: true },
        }))))
    }
    // Draft points share the vertex layer so they drag/remove like any other.
    if (drawing && draft.length) {
      const draftColor = tool === 'draw' ? (CLASS_COLOR[drawClass] || '#ffffff') : '#ffffff'
      draft.forEach((pt, vi) => verts.push({
        type: 'Feature', geometry: { type: 'Point', coordinates: pt },
        properties: { shapeId: '__draft__', pi: 0, ri: 0, vi, active: true, color: draftColor },
      }))
    }
    setSrc(map, SRC.verts, verts)
    if (map.getLayer('cm-draft-line')) {
      map.setPaintProperty('cm-draft-line', 'line-color', CLASS_COLOR[drawClass] || '#ffffff')
    }
  }, [enabled, mapRef, layerTick, shapes, selectedId, mode, boundary, draft, drawing, tool, drawClass])

  useEffect(() => {
    const map = mapRef.current
    if (!enabled || !map || !map.getSource(SRC.boundary)) return
    const geom = polysToGeometry(boundary) || detail?.boundary
    setSrc(map, SRC.boundary, geom ? [{ type: 'Feature', geometry: geom, properties: {} }] : [])
    // The pink wash is the outline step's look only.
    if (map.getLayer('cm-boundary-fill')) {
      map.setLayoutProperty('cm-boundary-fill', 'visibility', mode === 'outline' ? 'visible' : 'none')
    }
  }, [enabled, mapRef, layerTick, boundary, detail, mode])

  useEffect(() => {
    const map = mapRef.current
    if (!enabled || !map || !map.getSource(SRC.frame)) return
    const g = frame ? polysToGeometry(frame.boundary) : null
    setSrc(map, SRC.frame, g ? [{ type: 'Feature', geometry: g, properties: {} }] : [])
  }, [enabled, mapRef, layerTick, frame])

  useEffect(() => {
    const map = mapRef.current
    if (!enabled || !map || !map.getSource(SRC.marq)) return
    setSrc(map, SRC.marq, marq ? [{
      type: 'Feature', properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [marq[0][0], marq[0][1]], [marq[1][0], marq[0][1]],
          [marq[1][0], marq[1][1]], [marq[0][0], marq[1][1]],
          [marq[0][0], marq[0][1]],
        ]],
      },
    }] : [])
    setSrc(map, SRC.cut, cutPts.map((pt) => ({
      type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: pt },
    })))
  }, [enabled, mapRef, layerTick, cutPts, marq])

  useEffect(() => {
    const map = mapRef.current
    if (!enabled || !map || !map.getSource(SRC.draft)) return
    setSrc(map, SRC.draft, draft.length >= 2 ? [{
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: [...draft, draft[0]] },
    }] : [])
  }, [enabled, mapRef, layerTick, draft])

  // Crosshair while a drawing/cut tool is armed.
  useEffect(() => {
    const map = mapRef.current
    if (!enabled || !map) return
    map.getCanvas().style.cursor =
      (drawing || tool === 'cutpoly') ? 'crosshair' : tool === 'erase' ? 'cell' : ''
  }, [enabled, mapRef, tool, drawing])

  // ── map handlers ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!enabled || !map) return

    // erase box
    let box: Pt | null = null
    let boxStartPx: { x: number; y: number } | null = null
    let boxEndPx: { x: number; y: number } | null = null
    const onBoxStart = (e: any) => {
      if (toolRef.current !== 'erase') return
      e.preventDefault()
      box = [e.lngLat.lng, e.lngLat.lat]
      boxStartPx = { x: e.point.x, y: e.point.y }
      boxEndPx = boxStartPx
      setMarq([box, box])
      map.dragPan.disable()
      map.touchZoomRotate.disable()
    }
    const onBoxMove = (e: any) => {
      if (!box) return
      boxEndPx = { x: e.point.x, y: e.point.y }
      setMarq([box, [e.lngLat.lng, e.lngLat.lat]])
    }
    const endBox = () => {
      if (!box) return
      let b = marqRef.current
      // A tap (no real drag) erases the dots under the pointer.
      if (boxStartPx && boxEndPx
          && Math.abs(boxEndPx.x - boxStartPx.x) < 6 && Math.abs(boxEndPx.y - boxStartPx.y) < 6) {
        const r = coarsePointer() ? 22 : 10
        const a = map.unproject([boxEndPx.x - r, boxEndPx.y - r])
        const c = map.unproject([boxEndPx.x + r, boxEndPx.y + r])
        b = [[a.lng, a.lat], [c.lng, c.lat]]
      }
      box = null; boxStartPx = null; boxEndPx = null
      map.dragPan.enable()
      map.touchZoomRotate.enable()
      setMarq(null)
      if (b) eraseRef.current(b)
    }
    const onBoxTouchStart = (e: any) => { if (e.points.length === 1) onBoxStart(e) }
    const onBoxTouchMove = (e: any) => { if (box) { e.preventDefault(); onBoxMove(e) } }

    // vertex drag / remove
    let drag: { id: string; pi: number; ri: number; vi: number } | null = null
    let took = false
    let tookTract = false
    let tookDraft = false

    const removeVertex = (owner: string, pi: number, ri: number, vi: number) => {
      if (owner === '__draft__') {
        snapshotDraft()
        setDraft((prev) => prev.filter((_, i) => i !== vi))
        return true
      }
      if (owner === '__boundary__' && modeRef.current === 'outline') {
        snapshotTract()
        setBoundaryState((prev) => prev.map((rings, p2) => p2 !== pi ? rings
          : dropDegenerateHoles(rings.map((ring, i) => {
            if (i !== ri) return ring
            // Ring 0 is the outline and must stay a polygon; a hole
            // taken below three points goes away entirely.
            if (ring.length <= 3) return ri === 0 ? ring : []
            return ring.filter((_, v) => v !== vi)
          }))))
        reclassifyOnBoundaryEdit()
        return true
      }
      if (owner !== '__boundary__' && modeRef.current === 'landtypes') {
        mutate((prev) => prev.map((sh) => sh.id !== owner ? sh : {
          ...sh,
          polys: sh.polys.map((rings, p2) => p2 !== pi ? rings
            : dropDegenerateHoles(rings.map((ring, i) => {
              if (i !== ri) return ring
              if (ring.length <= 3) return ri === 0 ? ring : []
              return ring.filter((_, v) => v !== vi)
            }))),
        }))
        return true
      }
      return false
    }

    const onVertexDown = (e: any) => {
      // A draft dot wins the hit test over a finished shape's handle.
      const f = e.features?.find((ft: any) => String(ft.properties?.shapeId) === '__draft__') ?? e.features?.[0]
      if (!f) return
      const owner = String(f.properties!.shapeId)
      if (toolRef.current === 'erase') return
      e.preventDefault()
      // Right-click / Alt-click removes a handle (handled on mousedown;
      // 'contextmenu' fires inconsistently).
      const oe = e.originalEvent as MouseEvent
      if (oe.button === 2 || oe.altKey) {
        if (removeVertex(owner, Number(f.properties!.pi), Number(f.properties!.ri), Number(f.properties!.vi))) return
      }
      if (owner !== '__boundary__' && owner !== '__draft__' && owner !== selectedRef.current) setSelectedId(owner)
      drag = { id: owner, pi: f.properties!.pi, ri: f.properties!.ri, vi: f.properties!.vi }
      took = false; tookTract = false; tookDraft = false
      map.dragPan.disable()
    }

    const onDragMove = (e: { lngLat: maplibregl.LngLat }) => {
      if (!drag) return
      const { id, pi, ri, vi } = drag
      if (id === '__draft__') {
        const newPt: Pt = [e.lngLat.lng, e.lngLat.lat]
        if (toolRef.current === 'draw' && boundaryRef.current.length
            && !pointInBoundary(newPt, boundaryRef.current)) return
        if (!tookDraft) { snapshotDraft(); tookDraft = true }
        setDraft((prev) => prev.map((pt, i) => (i === vi ? newPt : pt)))
        return
      }
      if (id === '__boundary__') {
        let newPt: Pt = [e.lngLat.lng, e.lngLat.lat]
        // After a snap, an outer vertex stays projected onto the frame edge.
        if (frameRef.current) {
          const snapped = snapPoint(
            map, newPt, frameRef.current.boundary.flat().map((ring) => ({ ring })), 30)
          if (snapped.snapped) newPt = snapped.point
        }
        if (!tookTract) { snapshotTract(); tookTract = true }
        setBoundaryState((prev) => prev.map((rings, p2) => p2 !== pi ? rings
          : rings.map((r, i) => i !== ri ? r
            : r.map((pt, v) => v === vi ? newPt : pt))))
        return
      }
      if (!took) { snapshotShapes(); took = true }
      setShapesState((prev) => prev.map((s) => {
        if (s.id !== id) return s
        const polys = s.polys.map((rings, p) => p !== pi ? rings : rings.map((r, i) =>
          i !== ri ? r : r.map((pt, v) => v === vi ? [e.lngLat.lng, e.lngLat.lat] as Pt : pt)))
        return { ...s, polys }
      }))
    }

    const endDrag = () => {
      if (!drag) return
      if (drag.id === '__draft__') { drag = null; map.dragPan.enable(); return }
      const wasShape = drag.id !== '__boundary__'
      const draggedId = drag.id
      const movedBoundary = !wasShape && tookTract
      drag = null
      map.dragPan.enable()
      // Dragging rewrote `shapes` directly: re-check overlap when the
      // drag ENDS, not per mousemove.
      if (wasShape) void enforceRef.current(shapesRef.current, draggedId)
      // Dragging the OUTLINE invalidates the land types; the drag's own
      // 'tract' snapshot already covers both in one undo step.
      if (movedBoundary) reclassifyOnBoundaryEdit()
    }

    // touch: hold a dot to drag it; hold still to remove it
    let lpTimer: number | undefined
    let lpStart: { x: number; y: number } | null = null
    const onVertexTouchStart = (e: any) => {
      if (e.points.length !== 1) return
      const f = e.features?.find((ft: any) => String(ft.properties?.shapeId) === '__draft__') ?? e.features?.[0]
      if (!f || toolRef.current === 'erase') return
      onVertexDown(e)
      if (!drag) return
      map.touchZoomRotate.disable()
      lpStart = { x: e.point.x, y: e.point.y }
      const owner = String(f.properties!.shapeId)
      const pi = Number(f.properties!.pi), ri = Number(f.properties!.ri), vi = Number(f.properties!.vi)
      window.clearTimeout(lpTimer)
      lpTimer = window.setTimeout(() => {
        if (!drag || !lpStart) return
        drag = null; lpStart = null
        map.dragPan.enable(); map.touchZoomRotate.enable()
        if (removeVertex(owner, pi, ri, vi)) setNotice('Point removed — Undo brings it back.')
      }, 550)
    }
    const onTouchMove = (e: any) => {
      if (!drag) return
      e.preventDefault()
      if (lpStart && Math.hypot(e.point.x - lpStart.x, e.point.y - lpStart.y) > 8) {
        lpStart = null
        window.clearTimeout(lpTimer)
      }
      if (lpStart) return
      onDragMove(e)
    }
    const endTouchDrag = () => {
      window.clearTimeout(lpTimer)
      lpStart = null
      map.touchZoomRotate.enable()
      endDrag()
    }
    const vertEnter = () => { map.getCanvas().style.cursor = 'move' }
    const vertLeave = () => { map.getCanvas().style.cursor = '' }

    // boundary line: click to add a handle (outline step)
    const onBoundaryClick = (e: any) => {
      if (modeRef.current !== 'outline') return
      // While drawing a ring, a click on the old outline is a new point.
      if (drawingRef.current) return
      e.preventDefault()
      const pt = [e.lngLat.lng, e.lngLat.lat] as Pt
      snapshotTract()
      setBoundaryState((prev) => {
        if (!prev.length) return prev
        let best = { pi: 0, ri: 0, seg: 0, d: Infinity }
        prev.forEach((rings, pi) => rings.forEach((ring, ri) => {
          if (ring.length < 2) return
          const seg = nearestSegmentIndex(map, ring, e.point)
          const a = map.project(ring[seg] as [number, number])
          const b = map.project(ring[(seg + 1) % ring.length] as [number, number])
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const d = Math.hypot(mid.x - e.point.x, mid.y - e.point.y)
          if (d < best.d) best = { pi, ri, seg, d }
        }))
        return prev.map((rings, pi) => pi !== best.pi ? rings
          : rings.map((ring, ri) => ri !== best.ri ? ring
            : [...ring.slice(0, best.seg + 1), pt, ...ring.slice(best.seg + 1)]))
      })
      reclassifyOnBoundaryEdit()
    }
    const boundaryEnter = () => {
      if (modeRef.current === 'outline' && !drawingRef.current) map.getCanvas().style.cursor = 'copy'
    }
    const boundaryLeave = () => { map.getCanvas().style.cursor = '' }

    const insertOnNearestEdge = (s: Shape, screenPt: { x: number; y: number }, lngLat: maplibregl.LngLat) => {
      let bestPi = 0, bestRi = 0, bestSeg = 0, bestD = Infinity
      s.polys.forEach((rings, pi) => rings.forEach((ring, ri) => {
        const seg = nearestSegmentIndex(map, ring, screenPt)
        const a = map.project(ring[seg]); const b = map.project(ring[(seg + 1) % ring.length])
        const t = Math.hypot(screenPt.x - (a.x + b.x) / 2, screenPt.y - (a.y + b.y) / 2)
        if (t < bestD) { bestD = t; bestPi = pi; bestRi = ri; bestSeg = seg }
      }))
      mutate((prev) => prev.map((sh) => sh.id !== s.id ? sh : {
        ...sh,
        polys: sh.polys.map((rings, pi) => pi !== bestPi ? rings : rings.map((r, ri) =>
          ri !== bestRi ? r
            : [...r.slice(0, bestSeg + 1), [lngLat.lng, lngLat.lat] as Pt, ...r.slice(bestSeg + 1)])),
      }))
    }

    // clicks: draw a point, cut, or select a shape
    const onClick = (e: any) => {
      // A click on a draft dot / handle is a vertex gesture.
      if (map.getLayer(LYR_VERTS)
          && map.queryRenderedFeatures(e.point, { layers: [LYR_VERTS] }).length) return
      // On the outline in outline mode and not drawing: handled by the
      // boundary-line listener (add a handle).
      if (modeRef.current === 'outline' && !drawingRef.current && toolRef.current === null
          && map.getLayer('cm-boundary-line')
          && map.queryRenderedFeatures(e.point, { layers: ['cm-boundary-line'] }).length) return
      if (toolRef.current === 'cutpoly') {
        const pt = [e.lngLat.lng, e.lngLat.lat] as Pt
        const prev = cutPtsRef.current
        if (prev.length === 0) { cutPtsRef.current = [pt]; setCutPts([pt]) }
        else { cutPtsRef.current = []; setCutPts([]); void runCutRef.current([prev[0], pt]) }
        return
      }
      if (drawingRef.current) {
        let pt: Pt = [e.lngLat.lng, e.lngLat.lat]
        // "Draw a Tract": magnet-snap the corner onto a live Regrid
        // parcel line within ~30 ft.
        if (toolRef.current === 'drawtract') {
          const targets = snapTargetsNear(map, e.point, [])
          const snapped = snapPoint(map, pt, targets, 30)
          if (snapped.snapped) pt = snapped.point
        }
        // Land types stay inside the tract outline.
        if (toolRef.current === 'draw' && boundaryRef.current.length
            && !pointInBoundary(pt, boundaryRef.current)) {
          setNotice('Land types stay inside the tract outline.')
          return
        }
        snapshotDraft()
        setDraft((d) => [...d, pt])
        return
      }
      if (modeRef.current !== 'landtypes') return
      const onShape = map.getLayer(LYR_FILL)
        ? map.queryRenderedFeatures(e.point, { layers: [LYR_FILL] }) : []
      if (onShape.length) {
        const id = onShape[0].properties?.id
        if (id) {
          // Clicking an already-selected shape's edge inserts a vertex.
          const sel = shapesRef.current.find((s) => s.id === id)
          if (id === selectedRef.current && sel) insertOnNearestEdge(sel, e.point, e.lngLat)
          else setSelectedId(id)
          return
        }
      }
      setSelectedId(null)
    }

    const onDblClick = (e: any) => {
      if (!drawingRef.current) return
      e.preventDefault()
      finishDraftRef.current()
    }
    const stopMenu = (ev: Event) => ev.preventDefault()

    map.on('mousedown', onBoxStart)
    map.on('mousemove', onBoxMove)
    map.on('mouseup', endBox)
    map.on('touchstart', onBoxTouchStart)
    map.on('touchmove', onBoxTouchMove)
    map.on('touchend', endBox)
    map.on('touchcancel', endBox)
    map.on('mousedown', LYR_VERTS, onVertexDown)
    map.on('mousemove', onDragMove)
    map.on('mouseup', endDrag)
    map.on('mouseout', endDrag)
    map.on('touchstart', LYR_VERTS, onVertexTouchStart)
    map.on('touchmove', onTouchMove)
    map.on('touchend', endTouchDrag)
    map.on('touchcancel', endTouchDrag)
    map.on('mouseenter', LYR_VERTS, vertEnter)
    map.on('mouseleave', LYR_VERTS, vertLeave)
    map.on('click', 'cm-boundary-line', onBoundaryClick)
    map.on('mouseenter', 'cm-boundary-line', boundaryEnter)
    map.on('mouseleave', 'cm-boundary-line', boundaryLeave)
    map.on('click', onClick)
    map.on('dblclick', onDblClick)
    // Suppress the browser menu so right-click can remove a handle.
    map.getCanvas().addEventListener('contextmenu', stopMenu)

    return () => {
      window.clearTimeout(lpTimer)
      try {
        map.off('mousedown', onBoxStart)
        map.off('mousemove', onBoxMove)
        map.off('mouseup', endBox)
        map.off('touchstart', onBoxTouchStart)
        map.off('touchmove', onBoxTouchMove)
        map.off('touchend', endBox)
        map.off('touchcancel', endBox)
        map.off('mousedown', LYR_VERTS, onVertexDown)
        map.off('mousemove', onDragMove)
        map.off('mouseup', endDrag)
        map.off('mouseout', endDrag)
        map.off('touchstart', LYR_VERTS, onVertexTouchStart)
        map.off('touchmove', onTouchMove)
        map.off('touchend', endTouchDrag)
        map.off('touchcancel', endTouchDrag)
        map.off('mouseenter', LYR_VERTS, vertEnter)
        map.off('mouseleave', LYR_VERTS, vertLeave)
        map.off('click', 'cm-boundary-line', onBoundaryClick)
        map.off('mouseenter', 'cm-boundary-line', boundaryEnter)
        map.off('mouseleave', 'cm-boundary-line', boundaryLeave)
        map.off('click', onClick)
        map.off('dblclick', onDblClick)
        map.getCanvas().removeEventListener('contextmenu', stopMenu)
        map.dragPan.enable()
        map.touchZoomRotate.enable()
      } catch { /* map torn down */ }
    }
    // Handlers read everything through refs; registered once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, mapRef])

  return {
    // state
    loading, busy, error, notice, dirty,
    mode, tool, drawing, draft, selectedId, drawClass,
    shapes, boundary, detail, classified,
    totals, boundaryAcres, soil, soilBusy, holesOnSelected, defaultName,
    canUndo: histRef.current.length > 0,
    canRedo: redoRef.current.length > 0,
    hasEngineStart: !!detail?.polygons?.length,
    // actions
    setMode, setDrawClass, startDrawTract, startDrawPolygon, toggleCut, toggleErase,
    deleteSelected, fillHoles, clearPolygons, startOver, snapToParcel,
    finishDraft, cancelDraft, undo, redo, save, loadParcel,
    clearMessages: () => { setNotice(null); setError(null) },
  }
}

export type TractEditor = ReturnType<typeof useTractEditor>

/** True while the outline is still the parcel's own (no edits), so the
 *  engine polygons loaded with the parcel still fit it. */
function sameBoundaryAsParcel(boundary: Pt[][][], d: ParcelDetail): boolean {
  const orig = geometryToPolys(d.boundary)
  return JSON.stringify(orig) === JSON.stringify(boundary)
}
