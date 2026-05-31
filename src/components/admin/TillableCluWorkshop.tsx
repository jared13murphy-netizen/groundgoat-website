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

import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2, Save, Calculator, Sprout } from 'lucide-react'
import { fetchWithAuth } from '@/lib/fetchWithAuth'

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
  /** Called after a successful Save with the persisted tillable acres /
   *  soil rating so the parent can patch tract.computed and the
   *  TractDataCompare radios reflect the new values without a re-fetch. */
  onSaved?: (r: {
    tillable_acres: number | null
    soil_rating: number | null
    soil_rating_type: string | null
  }) => void
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
  onSaved,
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

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  // Ref mirrors so the map's click closure reads the latest data without
  // stale capture (same trick TractMapEditor uses for its drag handlers).
  const clusRef = useRef<Clu[]>([])
  const selectionRef = useRef<Record<number, boolean>>({})
  useEffect(() => { clusRef.current = clus }, [clus])
  useEffect(() => { selectionRef.current = selection }, [selection])

  // Live tillable-acres total — client-side sum over selected CLUs.
  const tillableAcres = clus.reduce(
    (s, c) => s + ((selection[c.fsa_clu_id] ?? c.default_tillable) ? c.acres_within_tract : 0),
    0,
  )

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
        setTractPolygon(data.tract?.polygon || null)
        setTractAcres(data.tract?.total_acres ?? null)
        setReportedAcres(data.tract?.reported_acres ?? null)
        if (data.totals?.soil_rating != null) {
          setSoil({
            tillable_acres: data.totals.tillable_acres ?? 0,
            soil_rating: data.totals.soil_rating,
            soil_rating_type: data.totals.soil_rating_type || '',
            breakdown: [],
          })
        }
        if (data.error) setError(data.error)
        setLoaded(true)
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [hasBeenVisible, baseUrl])

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

      if (tractPolygon && tractPolygon.length >= 3) {
        const bounds = new maplibregl.LngLatBounds()
        for (const p of tractPolygon) bounds.extend(p as [number, number])
        try { map.fitBounds(bounds, { padding: 30, duration: 0, maxZoom: 17 }) } catch {}
      }

      map.on('mouseenter', 'clu-fill', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'clu-fill', () => { map.getCanvas().style.cursor = '' })
      map.on('click', 'clu-fill', (ev) => {
        const feat = ev.features?.[0]
        const id = (feat?.properties as any)?.fsa_clu_id
        if (typeof id === 'number') toggleClu(id)
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
        body: JSON.stringify({ selections }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`)
      setSoil(data)
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
      setStatus(`✓ Saved ${data.tillable_clu_count} CLUs · ${data.tillable_acres ?? '?'} tillable ac`)
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

  return (
    <div ref={wrapperRef} className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg overflow-hidden mb-2">
      <div className="px-3 py-1.5 bg-gg-gray-800 border-b border-gg-gray-700 flex items-center gap-2 text-xs text-gg-gray-300">
        <Sprout size={13} className="text-green-500" />
        <span className="font-semibold">Tillable Workshop</span>
        <span className="text-gg-gray-500">— click field polygons to toggle tillable (green) / not (red)</span>
      </div>

      <div className="relative bg-gg-gray-800">
        <div
          ref={containerRef}
          style={{ width: '100%', height: editorHeight }}
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
          {hasBeenVisible && !loading && !error && loaded && clus.length === 0 && (
            <span className="text-xs text-gg-gray-400 px-4 text-center">
              No FSA CLU field polygons intersect this tract.
            </span>
          )}
        </div>
      </div>

      {/* Toolbar — totals + actions. */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-gg-gray-800 border-t border-gg-gray-700">
        <div className="flex flex-col gap-0.5 text-xs">
          <div className="flex items-center gap-3">
            <span className="px-2 py-0.5 rounded bg-green-700 text-white font-bold">
              Tillable: {tillableAcres.toFixed(2)} ac
            </span>
            <span className="text-gg-gray-400">
              of {tractAcres != null ? tractAcres.toFixed(2) : '?'} tract ac
              {reportedAcres != null && ` · reported ${Number(reportedAcres).toFixed(2)}`}
            </span>
            <span className="text-gg-gray-500">
              ({tillableCount}/{clus.length} CLUs)
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
            disabled={computing || saving || clus.length === 0 || tillableCount === 0}
            className="px-2.5 py-1 text-xs bg-gg-gray-700 hover:bg-gg-gray-600 disabled:opacity-40 text-white rounded flex items-center gap-1"
            title="Area-weight the state soil rating (PI / CSR2 / WAPI / NCCPI) over the tillable selection"
          >
            {computing ? <Loader2 size={12} className="animate-spin" /> : <Calculator size={12} />}
            {computing ? 'Computing…' : 'Compute Soil Rating'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || computing || clus.length === 0}
            className="px-3 py-1 text-xs bg-gg-pink hover:bg-gg-pink-light text-white font-semibold disabled:opacity-40 rounded flex items-center gap-1"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
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
