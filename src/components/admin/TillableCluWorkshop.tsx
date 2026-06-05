'use client'

/**
 * TillableCluWorkshop — the FSA-CLU tillable picker for staging cards.
 *
 * Replaces the old "derive a tillable polygon in the scraper" flow
 * (2026-05-31 rescope). The scraper now produces only the tract polygon;
 * the admin decides which FSA CLU field polygons count as tillable for
 * the tract by clicking them on this map.
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │  tract outline (white) + every intersecting FSA CLU     │
 *   │  clipped to the tract:  green = tillable, red = not      │
 *   │  click a CLU to toggle it in / out                       │
 *   └───────────────────────────────────────────────────────┘
 *   Tillable: NN.N ac of TT.T ac    [Compute Soil Rating] [Save]
 *
 * Backed by three backend endpoints (admin-auth, on practical-serenity):
 *   GET  /api/admin/staging/{id}/tracts/{idx}/clu          → clus + selection
 *   POST /api/admin/staging/{id}/tracts/{idx}/clu/compute-soil → soil rating
 *   POST /api/admin/staging/{id}/tracts/{idx}/clu          → persist selection
 *
 * Soil rating is computed on demand (button), NOT live-per-click, and is
 * state-aware (PI / CSR2 / WAPI / NCCPI resolved on the backend from the
 * tract's state). Tillable acres update live, client-side.
 *
 * Lazy-mounts the MapLibre instance on first visibility (WebGL context
 * cap) — same pattern as TractMapEditor.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2, Save, Calculator, Sprout, Pencil, Check, Undo2, Trash2, Maximize2, Minimize2 } from 'lucide-react'
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import { polygonAcres } from '@/lib/polygonGeometry'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'

type Pt = [number, number]

interface Clu {
  fsa_clu_id: number
  geometry: any
  acres_within_tract: number
  default_tillable: boolean
  current_tillable: boolean
}

interface SoilResult {
  tillable_acres: number
  soil_rating: number | null
  soil_rating_type: string
  breakdown: { mukey: any; name: string | null; acres: number; rating: number }[]
}

// Stable signature of everything Save persists (per-CLU tillable verdict,
// drawn polygons, computed soil rating). Used to drive the Save button's
// dirty-state: Save is enabled only when the current signature differs from
// the last-saved one, and re-disables itself after a successful save.
function tillableSig(
  clus: Clu[],
  selection: Record<number, boolean>,
  manualPolygons: Pt[][],
  soilRating: number | null,
  soilType: string,
): string {
  const sel = clus
    .map((c) => `${c.fsa_clu_id}:${(selection[c.fsa_clu_id] ?? c.default_tillable) ? 1 : 0}`)
    .sort()
    .join(',')
  const man = JSON.stringify(manualPolygons)
  const soil = soilRating != null ? `${soilType}:${soilRating}` : ''
  return `${sel}|${man}|${soil}`
}

interface TillableCluWorkshopProps {
  /** Staging mode — workshop edits a tract inside ListingStaging.scraped_data.
   *  Provide stagingId + tractIndex. Mutually exclusive with tractId. */
  stagingId?: number
  tractIndex?: number
  /** Published mode — workshop edits an already-live tract by tracts.id
   *  (UUID), used by the missing-boundaries page. Mutually exclusive with
   *  stagingId/tractIndex; persists straight to the tract_tillable_clu
   *  junction + the tract's own columns. */
  tractId?: string
  /** Center fallback when the tract has no polygon yet. */
  latitude?: number | null
  longitude?: number | null
  /** Map height in px. Default 380. */
  editorHeight?: number
  /** Bumped by the parent whenever the tract boundary is (re)saved in the
   *  editor above. A change forces the workshop to re-fetch CLUs against
   *  the now-current polygon + re-fit the map — otherwise the workshop
   *  keeps the empty data it loaded before the polygon existed. */
  reloadKey?: number
  /** Called after a successful Save with the persisted tillable acres /
   *  soil rating so the parent can patch tract.computed and the
   *  TractDataCompare radios reflect the new values without a re-fetch. */
  onSaved?: (r: {
    tillable_acres: number | null
    soil_rating: number | null
    soil_rating_type: string | null
  }) => void
  /** Called on each Compute Soil Rating (BEFORE save) with the freshly computed
   *  values, so a parent can show them as the "Computed" option in a
   *  Current/Computed/Manual comparison (data-cleanup). */
  onComputed?: (r: {
    tillable_acres: number | null
    soil_rating: number | null
    soil_rating_type: string | null
  }) => void
  /** Called whenever the workshop's unsaved-edits (dirty) state flips, so the
   *  parent can disable commit buttons until the admin clicks Save. */
  onDirtyChange?: (dirty: boolean) => void
}

// ---------------------------------------------------------------------------
// GeoJSON builders
// ---------------------------------------------------------------------------

function buildCluGeo(clus: Clu[], selection: Record<number, boolean>): any {
  return {
    type: 'FeatureCollection',
    features: clus.map((c) => ({
      type: 'Feature',
      properties: {
        fsa_clu_id: c.fsa_clu_id,
        tillable: selection[c.fsa_clu_id] ?? c.default_tillable,
        acres: c.acres_within_tract,
      },
      geometry: c.geometry,
    })),
  }
}

function buildTractGeo(poly: Pt[] | null): any {
  if (!poly || poly.length < 3) {
    return { type: 'FeatureCollection', features: [] }
  }
  const ring = [...poly]
  const f = ring[0]
  const l = ring[ring.length - 1]
  if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f)
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    }],
  }
}

// Finished, admin-drawn tillable polygons (green override layer).
function buildManualGeo(polys: Pt[][]): any {
  return {
    type: 'FeatureCollection',
    features: polys
      .filter((p) => p.length >= 3)
      .map((p, i) => {
        const ring = [...p]
        const f = ring[0]; const l = ring[ring.length - 1]
        if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f)
        return {
          type: 'Feature',
          properties: { idx: i },
          geometry: { type: 'Polygon', coordinates: [ring] },
        }
      }),
  }
}

// In-progress polygon: a LineString while < 3 pts, a closed Polygon at >= 3.
function buildDrawGeo(points: Pt[]): any {
  if (points.length === 0) return { type: 'FeatureCollection', features: [] }
  if (points.length < 3) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: points } }],
    }
  }
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {},
      geometry: { type: 'Polygon', coordinates: [[...points, points[0]]] } }],
  }
}

function buildVertexGeo(points: Pt[]): any {
  return {
    type: 'FeatureCollection',
    features: points.map((p, i) => ({
      type: 'Feature', properties: { i },
      geometry: { type: 'Point', coordinates: p },
    })),
  }
}

// GeoJSON Polygon geometry → outer ring (Pt[]). Used to hydrate saved
// manual polygons (backend returns them as GeoJSON geometries).
function geomToRing(geom: any): Pt[] | null {
  const ring = geom?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 3) return null
  return ring.map((p: any) => [Number(p[0]), Number(p[1])] as Pt)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TillableCluWorkshop({
  stagingId,
  tractIndex,
  tractId,
  latitude,
  longitude,
  editorHeight = 380,
  reloadKey = 0,
  onSaved,
  onComputed,
  onDirtyChange,
}: TillableCluWorkshopProps) {
  // Base URL for the three CLU endpoints — published-tract mode (tractId)
  // vs staging mode (stagingId + tractIndex). Both expose the same
  // {GET clu, POST clu/compute-soil, POST clu} shape.
  const baseUrl = tractId != null
    ? `${API_URL}/api/admin/tracts/${tractId}/clu`
    : `${API_URL}/api/admin/staging/${stagingId}/tracts/${tractIndex}/clu`
  const [hasBeenVisible, setHasBeenVisible] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const [clus, setClus] = useState<Clu[]>([])
  const [selection, setSelection] = useState<Record<number, boolean>>({})
  const [tractPolygon, setTractPolygon] = useState<Pt[] | null>(null)
  const [tractAcres, setTractAcres] = useState<number | null>(null)
  const [reportedAcres, setReportedAcres] = useState<number | null>(null)

  const [soil, setSoil] = useState<SoilResult | null>(null)
  const [computing, setComputing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Signature of the last-saved state (set on load + after each save). The
  // Save button is dirty only when the live signature diverges from this.
  const [savedSig, setSavedSig] = useState<string | null>(null)

  // ── Manual draw: used when the 2008 FSA CLU data is wrong for the tract.
  //    When ≥1 polygon is drawn it OVERRIDES the CLU selection entirely. ──
  const [drawMode, setDrawMode] = useState(false)
  const [manualPolygons, setManualPolygons] = useState<Pt[][]>([])
  const [currentDraw, setCurrentDraw] = useState<Pt[]>([])
  const drawModeRef = useRef(false)
  const manualPolygonsRef = useRef<Pt[][]>([])
  const currentDrawRef = useRef<Pt[]>([])
  useEffect(() => { drawModeRef.current = drawMode }, [drawMode])
  useEffect(() => { manualPolygonsRef.current = manualPolygons }, [manualPolygons])
  useEffect(() => { currentDrawRef.current = currentDraw }, [currentDraw])

  // True once the admin has drawn at least one polygon → CLU selection is
  // overridden (drawn polygons are the tillable area).
  const manualActive = manualPolygons.length > 0

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  // Expand toggle — doubles the map height so the admin has more room to
  // see/draw tillable fields. Off by default; persists only for the
  // current session per workshop instance.
  const [expanded, setExpanded] = useState(false)
  // After the container height changes, MapLibre must be told to re-read
  // its size or the canvas keeps the old dimensions (gray bar / clipped map).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t1 = setTimeout(() => map.resize(), 0)
    const t2 = setTimeout(() => map.resize(), 220)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [expanded])

  // Ref mirrors so the map's click closure reads the latest data without
  // stale capture (same trick TractMapEditor uses for its drag handlers).
  const clusRef = useRef<Clu[]>([])
  const selectionRef = useRef<Record<number, boolean>>({})
  useEffect(() => { clusRef.current = clus }, [clus])
  useEffect(() => { selectionRef.current = selection }, [selection])

  // ── Instant client-side tillable acres (no round-trip) so the badge moves
  //    on EVERY interaction: each CLU toggle, each drawn vertex, each drawn
  //    field. Two regimes:
  //      • drawing/manual: shoelace area of the finished drawn fields plus the
  //        in-progress polygon (≥3 pts) — updates as vertices are placed.
  //      • CLU selection: sum of the selected CLUs' clipped acres. get_tract_clus
  //        already de-dupes overlapping fsa_clu_2008 vintages into a NON-
  //        overlapping set, so this sum equals the true union — exact, instant.
  //    The debounced server fetch below then reconciles (it's authoritative for
  //    the union of OVERLAPPING drawn fields, and is what Save persists). ──
  const clientTillableAcres = useMemo(() => {
    if (manualActive || currentDraw.length >= 3) {
      let a = 0
      for (const ring of manualPolygons) a += polygonAcres(ring)
      if (currentDraw.length >= 3) a += polygonAcres(currentDraw)
      return a
    }
    return clus.reduce(
      (sum, c) => sum + ((selection[c.fsa_clu_id] ?? c.default_tillable) ? c.acres_within_tract : 0),
      0,
    )
  }, [clus, selection, manualPolygons, currentDraw, manualActive])

  // Optimistic: show the instant client value immediately on every change. The
  // server fetch below overwrites it with the authoritative union once settled.
  useEffect(() => { setTillableAcres(clientTillableAcres) }, [clientTillableAcres])

  // ── Authoritative tillable acres: refetch the server-side UNION whenever
  //    the selection or drawn polygons change. Debounced (300ms) so a flurry
  //    of toggles makes one call. The value returned is identical to what
  //    Save persists, so the badge can never disagree with the saved acreage. ──
  useEffect(() => {
    if (!hasBeenVisible) return
    // Mid-draw (vertices being placed) the server can't union an open ring —
    // the instant client estimate above carries the badge until the field is
    // finished, at which point manualPolygons changes and this re-reconciles.
    if (currentDraw.length > 0) return
    if (clus.length === 0 && manualPolygons.length === 0) {
      setTillableAcres(0)
      return
    }
    const selections = clus.map((c) => ({
      fsa_clu_id: c.fsa_clu_id,
      is_tillable: selection[c.fsa_clu_id] ?? c.default_tillable,
    }))
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await fetchWithAuth(`${baseUrl}/tillable-acres`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selections, manual_polygons: manualPolygons }),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && typeof data.tillable_acres === 'number') {
          setTillableAcres(data.tillable_acres)
        }
      } catch {
        /* transient backend blip — keep the prior value, don't zero it */
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [hasBeenVisible, clus, selection, manualPolygons, currentDraw, baseUrl])

  // Live tillable-acres total = geometric UNION area of the selected
  // polygons, computed server-side (debounced fetch below). Summing per-CLU
  // acres is WRONG: the fsa_clu_2008 table carries overlapping CLU vintages,
  // so a sum double-counts the same ground (151-ac field shown as 261). The
  // backend union is the single source of truth — the same value Save
  // persists and the soil rating weights over.
  const [tillableAcres, setTillableAcres] = useState(0)

  // ── Lazy mount: only load data + map after the card scrolls in. ──
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || hasBeenVisible) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setHasBeenVisible(true)
          observer.disconnect()
          break
        }
      }
    }, { rootMargin: '200px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasBeenVisible])

  // ── Fetch CLU data on first visibility. ──
  useEffect(() => {
    if (!hasBeenVisible) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchWithAuth(baseUrl)
        const data = await res.json()
        if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
        if (cancelled) return
        const list: Clu[] = data.clus || []
        const sel: Record<number, boolean> = {}
        for (const c of list) sel[c.fsa_clu_id] = c.current_tillable
        setClus(list)
        setSelection(sel)
        // Hydrate any saved admin-drawn tillable polygons.
        const savedManual: Pt[][] = ((data.manual_polygons || []) as any[])
          .map(geomToRing)
          .filter((r: Pt[] | null): r is Pt[] => r != null)
        setManualPolygons(savedManual)
        setTractPolygon(data.tract?.polygon || null)
        setTractAcres(data.tract?.total_acres ?? null)
        setReportedAcres(data.tract?.reported_acres ?? null)
        const savedRating: number | null = data.totals?.soil_rating ?? null
        const savedRatingType: string = data.totals?.soil_rating_type || ''
        if (savedRating != null) {
          setSoil({
            tillable_acres: data.totals.tillable_acres ?? 0,
            soil_rating: savedRating,
            soil_rating_type: savedRatingType,
            breakdown: [],
          })
        }
        // Baseline signature of the just-loaded saved state → Save starts
        // disabled until the admin actually changes something.
        setSavedSig(tillableSig(list, sel, savedManual, savedRating, savedRatingType))
        if (data.error) setError(data.error)
        setLoaded(true)
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [hasBeenVisible, baseUrl, reloadKey])

  // After a re-fetch (reloadKey bump) the map already exists — it was
  // created once on first load — so the fresh tract polygon + CLUs won't
  // appear unless we push them into the existing sources and re-fit. The
  // map's own load handler only runs the first time. fitBounds is gated to
  // tractPolygon changes (this effect, not the toggle path) so toggling a
  // CLU doesn't recenter the map.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return
    const apply = () => {
      try {
        ;(map.getSource('clu') as maplibregl.GeoJSONSource | undefined)?.setData(buildCluGeo(clus, selection))
        ;(map.getSource('tract') as maplibregl.GeoJSONSource | undefined)?.setData(buildTractGeo(tractPolygon))
        ;(map.getSource('manual') as maplibregl.GeoJSONSource | undefined)?.setData(buildManualGeo(manualPolygons))
        if (tractPolygon && tractPolygon.length >= 3) {
          const bounds = new maplibregl.LngLatBounds()
          for (const p of tractPolygon) bounds.extend(p as [number, number])
          map.fitBounds(bounds, { padding: 30, duration: 0, maxZoom: 17 })
        }
      } catch {/* style not ready */}
    }
    if (map.isStyleLoaded()) apply()
    else map.once('idle', apply)
    // Re-sync only when the tract polygon identity changes (i.e. a reload),
    // not on every selection toggle — toggleClu pushes its own clu data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tractPolygon, loaded])

  // ── Toggle one CLU's tillable verdict (and update the map in place). ──
  const toggleClu = (id: number) => {
    setSelection((prev) => {
      const cur = prev[id]
      const base = clusRef.current.find((c) => c.fsa_clu_id === id)?.default_tillable ?? true
      const next = { ...prev, [id]: !(cur ?? base) }
      selectionRef.current = next
      const src = mapRef.current?.getSource('clu') as maplibregl.GeoJSONSource | undefined
      if (src) src.setData(buildCluGeo(clusRef.current, next))
      return next
    })
    // Selection changed → any prior soil rating is now stale.
    setSoil(null)
    setStatus(null)
  }

  // ── Manual draw helpers ──
  const pushMapSource = (id: string, data: any) => {
    const src = mapRef.current?.getSource(id) as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(data)
  }

  const addVertex = (pt: Pt) => {
    setCurrentDraw((prev) => {
      const next = [...prev, pt]
      currentDrawRef.current = next
      pushMapSource('draw', buildDrawGeo(next))
      pushMapSource('draw-vertex', buildVertexGeo(next))
      return next
    })
  }

  const finishPolygon = () => {
    // A double-click fires two near-identical click events before dblclick,
    // so drop consecutive duplicate vertices before closing.
    const raw = currentDrawRef.current
    const pts = raw.filter((p, i) =>
      i === 0 || Math.abs(p[0] - raw[i - 1][0]) > 1e-7 || Math.abs(p[1] - raw[i - 1][1]) > 1e-7,
    )
    if (pts.length < 3) return
    setManualPolygons((prev) => {
      const next = [...prev, pts]
      manualPolygonsRef.current = next
      pushMapSource('manual', buildManualGeo(next))
      return next
    })
    setCurrentDraw(() => {
      currentDrawRef.current = []
      pushMapSource('draw', buildDrawGeo([]))
      pushMapSource('draw-vertex', buildVertexGeo([]))
      return []
    })
    setSoil(null); setStatus(null)
  }

  // Undo: drop the last in-progress vertex, or (if none) the last finished
  // polygon.
  const undoDraw = () => {
    if (currentDrawRef.current.length > 0) {
      setCurrentDraw((prev) => {
        const next = prev.slice(0, -1)
        currentDrawRef.current = next
        pushMapSource('draw', buildDrawGeo(next))
        pushMapSource('draw-vertex', buildVertexGeo(next))
        return next
      })
    } else if (manualPolygonsRef.current.length > 0) {
      setManualPolygons((prev) => {
        const next = prev.slice(0, -1)
        manualPolygonsRef.current = next
        pushMapSource('manual', buildManualGeo(next))
        return next
      })
      setSoil(null)
    }
    setStatus(null)
  }

  const clearManual = () => {
    setManualPolygons(() => { manualPolygonsRef.current = []; pushMapSource('manual', buildManualGeo([])); return [] })
    setCurrentDraw(() => {
      currentDrawRef.current = []
      pushMapSource('draw', buildDrawGeo([]))
      pushMapSource('draw-vertex', buildVertexGeo([]))
      return []
    })
    setSoil(null); setStatus(null)
  }

  const toggleDrawMode = () => {
    setDrawMode((prev) => {
      const next = !prev
      drawModeRef.current = next
      const map = mapRef.current
      if (map) {
        if (next) map.doubleClickZoom.disable()
        else map.doubleClickZoom.enable()
      }
      // Leaving draw mode with an unfinished polygon → auto-finish it.
      if (!next && currentDrawRef.current.length >= 3) finishPolygon()
      return next
    })
  }

  // ── Map lifecycle: create once data is loaded + container visible. ──
  useEffect(() => {
    if (!hasBeenVisible || !loaded) return
    const container = containerRef.current
    if (!container || mapRef.current) return

    let centerLng = -93.5
    let centerLat = 41.9
    let initZoom = 14
    if (tractPolygon && tractPolygon.length >= 3) {
      centerLng = tractPolygon.reduce((s, p) => s + p[0], 0) / tractPolygon.length
      centerLat = tractPolygon.reduce((s, p) => s + p[1], 0) / tractPolygon.length
      initZoom = 15
    } else if (longitude != null && latitude != null) {
      centerLng = Number(longitude)
      centerLat = Number(latitude)
      initZoom = 15
    }

    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          imagery: {
            type: 'raster',
            tiles: [TILE_URL],
            tileSize: 256,
            attribution: TILE_ATTRIBUTION,
          },
        },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
      },
      center: [centerLng, centerLat],
      zoom: initZoom,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    map.on('load', () => {
      map.addSource('clu', { type: 'geojson', data: buildCluGeo(clusRef.current, selectionRef.current) })
      map.addSource('tract', { type: 'geojson', data: buildTractGeo(tractPolygon) })
      map.addSource('manual', { type: 'geojson', data: buildManualGeo(manualPolygonsRef.current) })
      map.addSource('draw', { type: 'geojson', data: buildDrawGeo(currentDrawRef.current) })
      map.addSource('draw-vertex', { type: 'geojson', data: buildVertexGeo(currentDrawRef.current) })

      // CLU fill — data-driven green (tillable) / red (not). Click toggles.
      map.addLayer({
        id: 'clu-fill',
        type: 'fill',
        source: 'clu',
        paint: {
          'fill-color': ['case', ['get', 'tillable'], '#22c55e', '#ef4444'],
          'fill-opacity': 0.4,
        },
      })
      map.addLayer({
        id: 'clu-line',
        type: 'line',
        source: 'clu',
        paint: {
          'line-color': ['case', ['get', 'tillable'], '#16a34a', '#dc2626'],
          'line-width': 1.5,
        },
      })
      // Tract outline — always visible on top, white so it reads against
      // both green and red fills.
      map.addLayer({
        id: 'tract-line',
        type: 'line',
        source: 'tract',
        paint: { 'line-color': '#ffffff', 'line-width': 3 },
      })

      // Admin-drawn tillable polygons (override layer) — solid green.
      map.addLayer({
        id: 'manual-fill', type: 'fill', source: 'manual',
        paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.45 },
      })
      map.addLayer({
        id: 'manual-line', type: 'line', source: 'manual',
        paint: { 'line-color': '#15803d', 'line-width': 2 },
      })
      // In-progress polygon being drawn — dashed yellow line + fill + vertices.
      map.addLayer({
        id: 'draw-fill', type: 'fill', source: 'draw',
        paint: { 'fill-color': '#facc15', 'fill-opacity': 0.25 },
      })
      map.addLayer({
        id: 'draw-line', type: 'line', source: 'draw',
        paint: { 'line-color': '#facc15', 'line-width': 2, 'line-dasharray': [2, 1] },
      })
      map.addLayer({
        id: 'draw-vertex', type: 'circle', source: 'draw-vertex',
        paint: { 'circle-radius': 4, 'circle-color': '#facc15',
                 'circle-stroke-color': '#000', 'circle-stroke-width': 1 },
      })

      if (tractPolygon && tractPolygon.length >= 3) {
        const bounds = new maplibregl.LngLatBounds()
        for (const p of tractPolygon) bounds.extend(p as [number, number])
        try { map.fitBounds(bounds, { padding: 30, duration: 0, maxZoom: 17 }) } catch {}
      }

      map.on('mouseenter', 'clu-fill', () => {
        if (!drawModeRef.current) map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'clu-fill', () => {
        if (!drawModeRef.current) map.getCanvas().style.cursor = ''
      })
      // CLU click toggles — but only when NOT drawing (in draw mode the
      // map-level click handler below lays vertices instead).
      map.on('click', 'clu-fill', (ev) => {
        if (drawModeRef.current) return
        const feat = ev.features?.[0]
        const id = (feat?.properties as any)?.fsa_clu_id
        if (typeof id === 'number') toggleClu(id)
      })

      // Map-level click: in draw mode, add a vertex to the current polygon.
      map.on('click', (ev) => {
        if (!drawModeRef.current) return
        addVertex([ev.lngLat.lng, ev.lngLat.lat])
      })
      // Double-click finishes the current polygon (zoom already disabled).
      map.on('dblclick', (ev) => {
        if (!drawModeRef.current) return
        ev.preventDefault?.()
        finishPolygon()
      })

      const t1 = setTimeout(() => map.resize(), 50)
      const t2 = setTimeout(() => map.resize(), 250)
      ;(map as any).__resizeTimers = [t1, t2]
    })

    return () => {
      const timers = (map as any).__resizeTimers as any[] | undefined
      if (timers) timers.forEach(clearTimeout)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBeenVisible, loaded])

  // Dim the CLU layer when a manual override is active (drawn polygons win),
  // and switch the cursor to a crosshair while in draw mode.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    try {
      map.setPaintProperty('clu-fill', 'fill-opacity', manualActive ? 0.12 : 0.4)
      map.setPaintProperty('clu-line', 'line-opacity', manualActive ? 0.3 : 1)
    } catch {/* layers not ready yet */}
    map.getCanvas().style.cursor = drawMode ? 'crosshair' : ''
  }, [manualActive, drawMode, loaded])

  // ── Compute Soil Rating (state-aware, on demand). ──
  const handleComputeSoil = async () => {
    setComputing(true)
    setStatus(null)
    try {
      const selections = clus.map((c) => ({
        fsa_clu_id: c.fsa_clu_id,
        is_tillable: selection[c.fsa_clu_id] ?? c.default_tillable,
      }))
      const res = await fetchWithAuth(`${baseUrl}/compute-soil`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selections, manual_polygons: manualPolygons }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setSoil(data)
      onComputed?.({
        tillable_acres: data.tillable_acres ?? null,
        soil_rating: data.soil_rating ?? null,
        soil_rating_type: data.soil_rating_type ?? null,
      })
      setStatus(
        data.soil_rating != null
          ? `✓ ${data.soil_rating_type}: ${data.soil_rating} over ${data.tillable_acres} tillable ac`
          : '✓ Computed — no soil rating available for this selection',
      )
    } catch (e: any) {
      setStatus(`✗ Compute failed: ${e.message || e}`)
    } finally {
      setComputing(false)
    }
  }

  // ── Save the selection (+ computed acres / rating). ──
  const handleSave = async () => {
    setSaving(true)
    setStatus(null)
    try {
      const selections = clus.map((c) => ({
        fsa_clu_id: c.fsa_clu_id,
        is_tillable: selection[c.fsa_clu_id] ?? c.default_tillable,
      }))
      const body: any = {
        selections,
        manual_polygons: manualPolygons,
        tillable_acres: Math.round(tillableAcres * 100) / 100,
      }
      if (soil?.soil_rating != null) {
        body.soil_rating = soil.soil_rating
        body.soil_rating_type = soil.soil_rating_type
      }
      const res = await fetchWithAuth(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setStatus(
        data.manual_polygon_count
          ? `✓ Saved ${data.manual_polygon_count} drawn field${data.manual_polygon_count === 1 ? '' : 's'} · ${data.tillable_acres ?? '?'} tillable ac`
          : `✓ Saved ${data.tillable_clu_count} CLUs · ${data.tillable_acres ?? '?'} tillable ac`,
      )
      // Persisted → this is the new baseline, so Save re-disables itself
      // until the admin changes something again.
      setSavedSig(tillableSig(clus, selection, manualPolygons,
        soil?.soil_rating ?? null, soil?.soil_rating_type ?? ''))
      onSaved?.({
        tillable_acres: data.tillable_acres ?? null,
        soil_rating: data.soil_rating ?? null,
        soil_rating_type: data.soil_rating_type ?? null,
      })
    } catch (e: any) {
      setStatus(`✗ Save failed: ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const tillableCount = clus.filter(
    (c) => selection[c.fsa_clu_id] ?? c.default_tillable,
  ).length

  // Live signature vs the last-saved baseline → is there anything to save?
  const currentSig = useMemo(
    () => tillableSig(clus, selection, manualPolygons,
      soil?.soil_rating ?? null, soil?.soil_rating_type ?? ''),
    [clus, selection, manualPolygons, soil],
  )
  const isDirty = savedSig != null && currentSig !== savedSig

  // Report dirty-state flips to the parent so it can gate commit buttons, and
  // clear the flag on unmount so a collapsed/closed workshop never leaves the
  // parent stuck thinking there are unsaved edits.
  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  useEffect(() => { onDirtyChangeRef.current?.(isDirty) }, [isDirty])
  useEffect(() => () => { onDirtyChangeRef.current?.(false) }, [])

  return (
    <div ref={wrapperRef} className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg overflow-hidden mb-2">
      <div className="px-3 py-1.5 bg-gg-gray-800 border-b border-gg-gray-700 flex items-center gap-2 text-xs text-gg-gray-300">
        <Sprout size={13} className="text-green-500" />
        <span className="font-semibold">Tillable Workshop</span>
        <span className="text-gg-gray-500 hidden sm:inline">
          {drawMode
            ? '— click to add points, double-click to finish a field'
            : manualActive
              ? '— drawn polygons override FSA CLUs'
              : '— click field polygons to toggle tillable (green) / not (red)'}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setExpanded(e => !e)}
            className="px-2 py-1 rounded flex items-center gap-1 bg-gg-gray-600 hover:bg-gg-gray-500 border border-gg-gray-400/60 text-white"
            title={expanded ? 'Shrink the workshop back to normal height' : 'Expand the workshop to double height'}
          >
            {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {expanded ? 'Shrink' : 'Expand'}
          </button>
          <button
            onClick={toggleDrawMode}
            disabled={!loaded}
            className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1 font-semibold disabled:opacity-40 ${
              drawMode ? 'bg-yellow-500 text-black' : 'bg-gg-pink hover:bg-gg-pink-light text-white'
            }`}
            title="Draw tillable polygons by hand (use when the 2008 FSA CLU is wrong for this tract)"
          >
            <Pencil size={14} />
            {drawMode ? 'Drawing…' : 'Draw Tillable'}
          </button>
          {drawMode && (
            <button
              onClick={finishPolygon}
              disabled={currentDraw.length < 3}
              className="px-2 py-1 rounded flex items-center gap-1 bg-green-700 hover:bg-green-600 text-white disabled:opacity-40"
              title="Close the current polygon and start a new one"
            >
              <Check size={12} /> Finish
            </button>
          )}
          {(currentDraw.length > 0 || manualActive) && (
            <button
              onClick={undoDraw}
              className="px-2 py-1 rounded flex items-center gap-1 bg-gg-gray-600 hover:bg-gg-gray-500 border border-gg-gray-400/60 text-white"
              title="Undo last point / last polygon"
            >
              <Undo2 size={12} /> Undo
            </button>
          )}
          {(currentDraw.length > 0 || manualActive) && (
            <button
              onClick={clearManual}
              className="px-2 py-1 rounded flex items-center gap-1 bg-red-800 hover:bg-red-700 text-white"
              title="Clear all drawn polygons"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="relative bg-gg-gray-800">
        <div
          ref={containerRef}
          style={{ width: '100%', height: expanded ? editorHeight * 2 : editorHeight }}
          className={loaded && !error ? '' : 'flex items-center justify-center'}
        >
          {!hasBeenVisible && (
            <span className="text-xs text-gg-gray-500">Map loads on scroll</span>
          )}
          {hasBeenVisible && loading && (
            <span className="text-xs text-gg-gray-400 flex items-center gap-2">
              <Loader2 size={14} className="animate-spin" /> Loading FSA CLUs…
            </span>
          )}
          {hasBeenVisible && !loading && error && (
            <span className="text-xs text-red-400 px-4 text-center">{error}</span>
          )}
          {hasBeenVisible && !loading && !error && loaded && clus.length === 0 && !manualActive && (
            <span className="text-xs text-gg-gray-400 px-4 text-center">
              No FSA CLU field polygons intersect this tract — use “Draw Tillable” to draw the tillable area by hand.
            </span>
          )}
        </div>
        {drawMode && (
          <div className="absolute top-2 left-2 px-2 py-1 rounded bg-black/70 text-yellow-300 text-[11px] pointer-events-none">
            Click to add points · double-click (or Finish) to close · draw multiple fields
          </div>
        )}
      </div>

      {/* Toolbar — totals + actions. */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gg-gray-800 border-t border-gg-gray-700">
        <div className="flex flex-col gap-0.5 text-xs">
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded bg-green-700 text-white font-bold">
              Tillable: {tillableAcres.toFixed(2)} ac
            </span>
            <span className="text-gg-gray-400">
              of {tractPolygon && tractPolygon.length >= 3
                    ? polygonAcres(tractPolygon).toFixed(2)
                    : tractAcres != null ? tractAcres.toFixed(2) : '?'} tract ac
              {reportedAcres != null && ` · reported ${Number(reportedAcres).toFixed(2)}`}
            </span>
            <span className="text-gg-gray-500">
              {manualActive
                ? `(${manualPolygons.length} drawn field${manualPolygons.length === 1 ? '' : 's'} · CLUs overridden)`
                : `(${tillableCount}/${clus.length} CLUs)`}
            </span>
          </div>
          <div className="text-[11px]">
            {soil?.soil_rating != null ? (
              <span className="text-green-400 font-bold">
                Soil: {soil.soil_rating.toFixed(1)} {soil.soil_rating_type}
              </span>
            ) : (
              <span className="text-gg-gray-500">
                Soil rating not computed — click Compute Soil Rating
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleComputeSoil}
            disabled={computing || saving}
            className="px-3 py-1.5 text-sm bg-gg-pink hover:bg-gg-pink-light disabled:opacity-40 text-white font-semibold rounded-lg flex items-center gap-1"
            title="Area-weight the state soil rating (PI / CSR2 / WAPI / NCCPI) over the tillable selection"
          >
            {computing ? <Loader2 size={14} className="animate-spin" /> : <Calculator size={14} />}
            {computing ? 'Computing…' : 'Compute Soil Rating'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || computing}
            title="Save tillable selection + computed soil rating"
            className="px-3 py-1.5 text-sm bg-gg-pink hover:bg-gg-pink-light text-white font-semibold disabled:opacity-40 rounded-lg flex items-center gap-1"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

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
