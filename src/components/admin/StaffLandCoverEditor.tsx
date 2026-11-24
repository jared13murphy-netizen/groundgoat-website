'use client'

/**
 * StaffLandCoverEditor — the Tillable Workshop for a STAGED tract, built on
 * the customer "Map It" polygon editor (useTractEditor + LandTypeTools).
 *
 * Owner 11/24: staff edit tillable / pasture / timber / water / other on the
 * staging screens exactly the way customers do in Map It. No name, no
 * project list, no Reports, no outline step — the tract boundary is drawn in
 * the boundary editor above and is not editable here.
 *
 *   load   GET  /api/admin/staging/{id}/tracts/{i}/land-cover?uid=
 *   save   POST /api/admin/staging/{id}/tracts/{i}/clu?uid=   { land_cover }
 *   soil   POST /api/admin/staging/{id}/tracts/{i}/clu/compute-soil?uid=
 *   FSA    GET  /api/admin/staging/{id}/tracts/{i}/clu?uid=   (field outlines)
 *
 * Rendered by TillableCluWorkshop for staged mounts (published tracts and
 * `?oldworkshop=1` keep the old Workshop). Same props, same save-safety
 * wiring: `?uid=`, onSaved(tract), 409 → message + reload + onSaveConflict,
 * and the dirty callback behind UnsavedTillableModal.
 */
import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2, Maximize2, Minimize2, RefreshCw, Sprout } from 'lucide-react'
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import { classifyBoundary } from '@/lib/configurableMapping'
import { useTractEditor, type TractEditorStorage } from '@/components/mapping/useTractEditor'
import LandTypeTools, { Btn, stat } from '@/components/mapping/LandTypeTools'
import {
  cleanFsaFields, fsaFieldClick, pruneTickedFields, readLandCoverLoad, savedShapesOf, soilRequestBody,
  type FsaField, type StaffLandCoverLoad,
} from '@/lib/staffLandCover'
import type { TillableCluWorkshopProps } from './TillableCluWorkshop'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'
const FSA_SOURCE = 'staff-fsa'
const FSA_LAYER = 'staff-fsa-line'

const fsaGeo = (fields: FsaField[]) => ({
  type: 'FeatureCollection',
  features: fields.map((f) => ({ type: 'Feature', properties: { id: f.fsa_clu_id }, geometry: f.geometry })),
})

export default function StaffLandCoverEditor({
  stagingId, tractIndex, tractUid, latitude, longitude, editorHeight = 380, reloadKey = 0,
  onSaved, onDirtyChange, onSaveConflict,
}: TillableCluWorkshopProps) {
  const base = `${API_URL}/api/admin/staging/${stagingId}/tracts/${tractIndex}`
  // `?uid=<_uid>` on every call, read through a ref so a uid that arrives
  // later does not re-load the editor and throw away unsaved edits.
  const tractUidRef = useRef<string | null>(tractUid ?? null)
  tractUidRef.current = tractUid ?? null
  /** uid the server reported on the last load / save (until the page has one). */
  const loadedUidRef = useRef<string | null>(null)
  const url = (path: string) => {
    const uid = tractUidRef.current || loadedUidRef.current
    return `${base}${path}${uid ? `?uid=${encodeURIComponent(uid)}` : ''}`
  }

  const [hasBeenVisible, setHasBeenVisible] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [expanded, setExpanded] = useState(false)
  /** Bumped to re-load the editor (after a 409 on Save, or Reload). */
  const [selfReload, setSelfReload] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [info, setInfo] = useState<StaffLandCoverLoad | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [blankStart, setBlankStart] = useState(false)
  // FSA field lines: on by default, as the old Workshop showed them.
  const [showFsa, setShowFsa] = useState(true)
  const [fields, setFields] = useState<FsaField[]>([])
  const [fsaNote, setFsaNote] = useState<string | null>(null)
  /** Fields ticked in this session (editor-side only; never sent). */
  const [ticked, setTicked] = useState<number[]>([])

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const hoverRef = useRef(false)
  const infoRef = useRef<StaffLandCoverLoad | null>(null)
  const dirtyRef = useRef(false)
  /** Rating stored with the shapes as loaded / saved: shown while the
   *  shapes are unchanged, so opening a tract costs no soil request. */
  const savedSoilRef = useRef<{ rating: number | null; rating_type: string | null } | null>(null)
  const reloadsRef = useRef(0); reloadsRef.current = reloadKey + selfReload
  const showFsaRef = useRef(showFsa); showFsaRef.current = showFsa
  const fieldsRef = useRef(fields); fieldsRef.current = fields
  const tickedRef = useRef(ticked); tickedRef.current = ticked
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved
  const onDirtyChangeRef = useRef(onDirtyChange); onDirtyChangeRef.current = onDirtyChange
  const onSaveConflictRef = useRef(onSaveConflict); onSaveConflictRef.current = onSaveConflict

  const readLandCover = async (): Promise<StaffLandCoverLoad> => {
    const res = await fetchWithAuth(url('/land-cover'))
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
    return readLandCoverLoad(data)
  }

  /** Engine land types for the outline. Never throws: where the engine has
   *  nothing (or cannot be reached) the editor opens blank. */
  const classify: NonNullable<TractEditorStorage['classify']> = async (boundary, state) => {
    try {
      const r = await classifyBoundary(boundary, state)
      if (r.polygons.length) { setBlankStart(false); return { polygons: r.polygons, engine_covered: r.engine_covered } }
    } catch { /* blank start */ }
    setBlankStart(true)
    return { polygons: [], engine_covered: true }
  }

  const storage: TractEditorStorage = {
    load: async () => {
      setLoadFailed(false)
      try {
        const loaded = await readLandCover()
        loadedUidRef.current = loaded.uid
        infoRef.current = loaded; setInfo(loaded)
        // (a staff save of nothing is a decision, not a missing engine result)
        setBlankStart(!!loaded.boundary && loaded.origin !== 'staff' && loaded.shapes != null && loaded.shapes.length === 0)
        savedSoilRef.current = (loaded.origin === 'staff' || loaded.origin === 'legacy') && loaded.soilRating != null
          ? { rating: loaded.soilRating, rating_type: loaded.soilRatingType } : null
        setTicked([])
        // A fresh load is clean, whatever a failed earlier re-load told the page.
        onDirtyChangeRef.current?.(false)
        return { boundary: loaded.boundary, shapes: loaded.shapes, state: loaded.state, needsNormalize: loaded.needsNormalize }
      } catch (e) {
        setLoadFailed(true)
        // A RE-load that fails (boundary save, the page's discard flow, a 409)
        // reverted nothing the page may already have assumed reverted: keep
        // the page's commit buttons blocked.
        if (reloadsRef.current > 0) onDirtyChangeRef.current?.(true)
        throw e
      }
    },
    classify,
    soil: async (tillable) => {
      const body = soilRequestBody(tillable)
      // Never call compute-soil with no tillable piece: an empty selection
      // there means "the FSA default fields".
      if (!body) return { rating: null, rating_type: null }
      if (savedSoilRef.current && !dirtyRef.current) return savedSoilRef.current
      const res = await fetchWithAuth(url('/clu/compute-soil'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      return { rating: data.soil_rating ?? null, rating_type: data.soil_rating_type || null }
    },
    save: async ({ polygons }) => {
      setStatus(null)
      const res = await fetchWithAuth(url('/clu'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ land_cover: polygons }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 409) {
        // The boundary changed while this save was computing: the shapes on
        // screen were drawn against the old boundary. NOT saved — re-load
        // against the current boundary and let the page re-read the tract.
        setStatus('✗ The boundary changed while saving. Nothing was saved. The tract has been reloaded; check it and save again.')
        setSelfReload((n) => n + 1)
        onSaveConflictRef.current?.()
        throw new Error('The boundary changed while saving. Nothing was saved.')
      }
      if (!res.ok) {
        throw new Error(`Save failed: ${data.detail || `HTTP ${res.status}`}`)
      }
      if (typeof data.tract_uid === 'string' && data.tract_uid) loadedUidRef.current = data.tract_uid
      savedSoilRef.current = { rating: data.soil_rating ?? null, rating_type: data.soil_rating_type || null }
      if (infoRef.current) { infoRef.current = { ...infoRef.current, origin: 'staff' }; setInfo(infoRef.current) }
      setStatus(`✓ Saved · ${data.tillable_acres ?? 0} tillable ac`)
      onSavedRef.current?.({
        tillable_acres: data.tillable_acres ?? null,
        soil_rating: data.soil_rating ?? null,
        soil_rating_type: data.soil_rating_type ?? null,
        price_per_acre: data.price_per_acre ?? null,
        price_per_tillable_acre: data.price_per_tillable_acre ?? null,
        price_per_soil_rating: data.price_per_soil_rating ?? null,
        sale_price: data.sale_price ?? null,
        sale_status: data.sale_status ?? null,
        tract_uid: data.tract_uid ?? null,
        tillable_rev: data.tillable_rev ?? null,
        tract: data.tract && typeof data.tract === 'object' ? data.tract : null,
      })
      return { shapes: savedShapesOf(data) }
    },
    startOver: async () => {
      setTicked([])
      const cur = infoRef.current
      if (!cur?.boundary) return []
      // The engine result stored on the tract, when that is what was opened.
      if (cur.origin === 'engine') {
        try {
          const again = await readLandCover()
          if (again.origin === 'engine' && again.shapes) return again.shapes
        } catch { /* fall through to the engine itself */ }
      }
      return (await classify(cur.boundary, cur.state)).polygons
    },
  }

  const editorRef = useRef<ReturnType<typeof useTractEditor> | null>(null)
  const editor = useTractEditor({
    mapRef,
    enabled: mapReady,
    start: { kind: 'staff', key: `${stagingId}:${tractIndex}:${reloadKey}:${selfReload}` },
    projectId: null,
    storage,
    lockOutline: true,
    fitPadding: 30,
    // Several workshops share a page: only the one under the pointer hears
    // Enter / Esc / Cmd-Z.
    keyboardActive: () => hoverRef.current,
    // FSA fields: a plain click on a field ticks it (adds it as tillable) or
    // un-ticks it. The editor only calls this with no tool armed, no ring
    // being drawn, and the click not on a handle.
    onPlainClick: (e) => {
      const ed = editorRef.current
      if (!ed) return false
      const act = fsaFieldClick({
        enabled: showFsaRef.current, toolActive: !!ed.tool || ed.drawing,
        point: [e.lngLat.lng, e.lngLat.lat], fields: fieldsRef.current,
        shapes: ed.shapes, ticked: tickedRef.current,
      })
      if (act.action === 'add') {
        ed.addGeometry('tillable', act.field.geometry)
        setTicked((t) => (t.includes(act.field.fsa_clu_id) ? t : [...t, act.field.fsa_clu_id]))
        return true
      }
      if (act.action === 'remove') {
        ed.deleteShapes(act.shapeIds)
        setTicked((t) => t.filter((id) => id !== act.field.fsa_clu_id))
        return true
      }
      return false
    },
  })
  editorRef.current = editor
  dirtyRef.current = editor.dirty

  // Unsaved-edits flag for the page (UnsavedTillableModal, Verify / Done).
  // A pre-loaded engine or legacy map is NOT dirty: only a staff edit is.
  useEffect(() => { onDirtyChangeRef.current?.(editor.dirty) }, [editor.dirty])
  useEffect(() => () => { onDirtyChangeRef.current?.(false) }, [])

  // A tick whose shapes are gone (deleted, undone, cleared) is forgotten.
  useEffect(() => {
    setTicked((t) => {
      if (!t.length) return t
      const kept = pruneTickedFields(t, fields, editor.shapes)
      return kept.length === t.length ? t : kept
    })
  }, [editor.shapes, fields])

  // ── lazy mount: nothing loads until the card scrolls into view ──
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || hasBeenVisible) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) { setHasBeenVisible(true); observer.disconnect(); break }
      }
    }, { rootMargin: '200px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasBeenVisible])

  // ── FSA field outlines (non-blocking; the editor works without them) ──
  useEffect(() => {
    if (!hasBeenVisible) return
    let cancelled = false
    setFsaNote(null)
    ;(async () => {
      try {
        const res = await fetchWithAuth(url('/clu'))
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
        if (!cancelled) setFields(cleanFsaFields(data.clus))
      } catch {
        if (!cancelled) { setFields([]); setFsaNote('FSA field lines could not be loaded.') }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBeenVisible, base, reloadKey, selfReload])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    try {
      ;(map.getSource(FSA_SOURCE) as maplibregl.GeoJSONSource | undefined)?.setData(fsaGeo(fields) as any)
      if (map.getLayer(FSA_LAYER)) map.setLayoutProperty(FSA_LAYER, 'visibility', showFsa ? 'visible' : 'none')
    } catch { /* map torn down */ }
  }, [mapReady, fields, showFsa])

  // ── the map (created once, on first visibility) ──
  // Declared AFTER useTractEditor so that on unmount the editor's own
  // clean-up (layers, handlers) runs before the map is removed.
  useEffect(() => {
    if (!hasBeenVisible) return
    const container = containerRef.current
    if (!container || mapRef.current) return
    const hasCentre = longitude != null && latitude != null
      && Number.isFinite(Number(longitude)) && Number.isFinite(Number(latitude))
    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: { imagery: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION } },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
      },
      center: hasCentre ? [Number(longitude), Number(latitude)] : [-93.5, 41.9],
      zoom: hasCentre ? 15 : 14,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    const timers: ReturnType<typeof setTimeout>[] = []
    map.on('load', () => {
      // FSA field lines sit UNDER the land-type shapes: added before the
      // editor adds its own layers.
      map.addSource(FSA_SOURCE, { type: 'geojson', data: fsaGeo(fieldsRef.current) as any })
      map.addLayer({
        id: FSA_LAYER, type: 'line', source: FSA_SOURCE,
        layout: { visibility: showFsaRef.current ? 'visible' : 'none' },
        paint: { 'line-color': '#fde047', 'line-width': 1.2, 'line-opacity': 0.9 },
      })
      timers.push(setTimeout(() => map.resize(), 50), setTimeout(() => map.resize(), 250))
      setMapReady(true)
    })
    return () => {
      timers.forEach(clearTimeout)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBeenVisible])

  // After the container height changes MapLibre must re-read its size.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t1 = setTimeout(() => map.resize(), 0)
    const t2 = setTimeout(() => map.resize(), 220)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [expanded])

  const noBoundary = !!info && !info.boundary
  const ready = mapReady && !!info?.boundary && !editor.loading
  const tickedCount = ticked.length

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={() => { hoverRef.current = true }}
      onMouseLeave={() => { hoverRef.current = false }}
      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg overflow-hidden mb-2"
    >
      <div className="px-3 py-1.5 bg-gg-gray-800 border-b border-gg-gray-700 flex items-center gap-2 text-xs text-gg-gray-300">
        <Sprout size={13} className="text-green-500" />
        <span className="font-semibold">Tillable Workshop</span>
        <span className="text-gg-gray-500 hidden sm:inline">
          {showFsa && fields.length > 0
            ? '— click a polygon to select it · click an FSA field (yellow lines) to make it tillable'
            : '— click a polygon to select it, drag its dots to reshape it'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {loadFailed && (
            <Btn tone="solid" icon={<RefreshCw size={13} />} text="Reload"
                 title="Load this tract's land types again" onClick={() => setSelfReload((n) => n + 1)} />
          )}
          <Btn tone="solid" icon={expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
               text={expanded ? 'Shrink' : 'Expand'}
               title={expanded ? 'Shrink the workshop back to normal height' : 'Expand the workshop to double height'}
               onClick={() => setExpanded((v) => !v)} />
        </div>
      </div>

      <div className="relative bg-gg-gray-800">
        <div ref={containerRef} style={{ width: '100%', height: expanded ? editorHeight * 2 : editorHeight }} />
        {(!hasBeenVisible || !mapReady || editor.loading || noBoundary || (loadFailed && !info)) && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-gg-gray-800/70">
            {!hasBeenVisible ? (
              <span className="text-xs text-gg-gray-500">Map loads on scroll</span>
            ) : noBoundary ? (
              <span className="text-xs text-red-400 px-4 text-center">
                {info?.error || 'Tract has no boundary polygon'} — draw the tract boundary first.
              </span>
            ) : loadFailed && !editor.loading ? (
              <span className="text-xs text-red-400 px-4 text-center">
                Could not load the land types{editor.error ? `: ${editor.error}` : ''}. Use Reload to try again.
              </span>
            ) : (
              <span className="text-xs text-gg-gray-300 flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" /> Loading land types…
              </span>
            )}
          </div>
        )}
      </div>

      {ready && (
        <LandTypeTools
          editor={editor} docked tone="solid" showOutlineButton={false} noSoil="no rating"
          onSave={() => { void editor.save({ name: '' }) }}
          header={(
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <span style={stat}>
                Boundary {editor.boundaryAcres.toFixed(2)} ac
                {info?.reportedAcres != null ? ` · reported ${info.reportedAcres}` : ''}
              </span>
              {editor.dirty && <span style={{ ...stat, color: '#fde047', fontWeight: 600 }}>Unsaved changes</span>}
              {blankStart && !editor.shapes.length && (
                <span style={stat}>No engine land types for this tract — draw them{fields.length ? ', or click FSA fields' : ''}.</span>
              )}
              {showFsa && tickedCount > 0 && (
                <span style={stat}>{tickedCount} FSA field{tickedCount === 1 ? '' : 's'} ticked — click one again to un-tick it</span>
              )}
              {showFsa && fsaNote && <span style={stat}>{fsaNote}</span>}
            </div>
          )}
          beforeSave={(
            <Btn tone="solid" text={showFsa ? 'FSA fields: On' : 'FSA fields: Off'}
                 title={showFsa
                   ? 'Hide the FSA field lines (clicks then only select polygons)'
                   : 'Show the FSA field lines; click a field to make it tillable'}
                 onClick={() => setShowFsa((v) => !v)} />
          )}
        />
      )}

      {status && (
        <div
          onClick={() => setStatus(null)}
          className={`px-3 py-2 text-sm cursor-pointer flex items-center justify-between ${
            status.startsWith('✓')
              ? 'bg-green-700 text-white border-t border-green-600'
              : 'bg-red-700 text-white border-t border-red-600'
          }`}
          title="Click to dismiss"
        >
          <span>{status}</span>
          <span className="text-xs opacity-70 ml-3">Dismiss ×</span>
        </div>
      )}
    </div>
  )
}
