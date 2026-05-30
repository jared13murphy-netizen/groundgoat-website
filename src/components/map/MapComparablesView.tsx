'use client'

/**
 * Find Comparables — map view (Phase 1, click-based redesign).
 *
 * Behavior (per user 2026-05-18 redesign):
 *   - NO hover. Pins/parcels with sales render as click-target "+"
 *     icons. Click → popup opens. Popup has explicit X to close
 *     (and click-outside-to-close). Stays open while admin reads /
 *     clicks 3D / Details. Closes when Add-to-Report is clicked.
 *   - All tract sales from /api/comparables/map-view show a + icon.
 *   - Regrid parcels with cached sale data ALSO show a + icon (from
 *     the same response's `parcels_with_sales` array — sparse but
 *     real). The full Regrid parcel layer is rendered underneath as
 *     normal (every parcel boundary visible).
 *
 * Subject highlight = blue ring at the focal tract. Sale polygons
 * stay rendered as semi-transparent pink fills for visual context.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TILE_URL, TILE_ATTRIBUTION, GLYPH_URL } from './mapConstants'
import { addRegridLayer, fetchRegridConfig, type RegridConfig } from './regridLayer'
import fetchWithAuth from '@/lib/fetchWithAuth'
import Tract3DModal from '@/components/Tract3DModal'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface MapSale {
  tract_id: string
  listing_id: string
  kind: 'auction_tract' | 'mydec' | 'ia_attom' | 'pt_other'
  lat: number | null
  lng: number | null
  polygon_coordinates: number[][] | null
  sale_date: string | null
  sale_price: number | null
  price_per_acre: number | null
  total_acres: number | null
  tillable_acres: number | null
  soil_rating: number | null
  soil_rating_type: string | null
  county: string | null
  state: string | null
  township: string | null
  owner: string | null
  company_name: string | null
  source_url: string | null
}

interface ParcelWithSale {
  ll_uuid: string
  lat: number | null
  lng: number | null
  polygon_coordinates: number[][] | null
  sale_date: string | null
  sale_price: number | null
  price_per_acre: number | null
  total_acres: number | null
  owner: string | null
  address: string | null
  county: string | null
  state: string | null
  parcelnumb: string | null
}

interface Subject {
  tract_id: string
  lat: number
  lng: number
  total_acres: number | null
  county: string | null
  state: string | null
  polygon_coordinates: number[][] | null
}

interface MapViewResponse {
  subject: Subject | null
  bbox: { min_lat: number; max_lat: number; min_lng: number; max_lng: number }
  sales: MapSale[]
  parcels_with_sales: ParcelWithSale[]
}

// A normalized record that the popup renders. Either kind of source
// (tract sale OR Regrid parcel with sale) maps onto this shape.
interface PopupRecord {
  kind: 'tract' | 'parcel'
  id: string
  tract_id?: string
  listing_id?: string
  lat: number
  lng: number
  polygon: number[][] | null
  sale_date: string | null
  sale_price: number | null
  price_per_acre: number | null
  total_acres: number | null
  tillable_acres: number | null
  soil_rating: number | null
  soil_rating_type: string | null
  county: string | null
  township: string | null
  owner: string | null
  source_url: string | null
}

const FMT_USD = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const FMT_NUM = (n: number | null | undefined, digits = 1) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const FMT_DATE = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function MapComparablesView({ subjectTractId }: { subjectTractId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [data, setData] = useState<MapViewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // Currently-open popup. Click a + → set this. Close = set null.
  const [openRecord, setOpenRecord] = useState<{ rec: PopupRecord; pos: { x: number; y: number } } | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [show3D, setShow3D] = useState<{ tractId: string } | null>(null)
  const [regridConfig, setRegridConfig] = useState<RegridConfig | null>(null)

  // --- Data fetch -----------------------------------------------------
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        setError(null); setLoading(true)
        const res = await fetchWithAuth(
          `${API_URL}/api/comparables/map-view?subject_tract_id=${subjectTractId}`,
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail || `HTTP ${res.status}`)
        }
        const body = (await res.json()) as MapViewResponse
        if (!cancelled) setData(body)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [subjectTractId])

  useEffect(() => {
    let cancelled = false
    fetchRegridConfig().then(cfg => { if (!cancelled) setRegridConfig(cfg) })
    return () => { cancelled = true }
  }, [])

  // --- Memoized GeoJSON sources --------------------------------------
  const tractPinsGeo = useMemo(() => {
    if (!data) return { type: 'FeatureCollection', features: [] } as any
    return {
      type: 'FeatureCollection',
      features: data.sales
        // Only tracts with a real polygon boundary get a pin — tracts
        // without a boundary should never show a pin on the map.
        .filter(s => s.lat != null && s.lng != null && s.polygon_coordinates && s.polygon_coordinates.length >= 3)
        .map(s => ({
          type: 'Feature',
          properties: { id: s.tract_id, source: 'tract' },
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        })),
    } as any
  }, [data])

  const parcelPinsGeo = useMemo(() => {
    if (!data) return { type: 'FeatureCollection', features: [] } as any
    return {
      type: 'FeatureCollection',
      features: (data.parcels_with_sales || [])
        // Only parcels with a real polygon boundary get a pin — parcels
        // without a boundary should never show a pin on the map.
        .filter(p => p.lat != null && p.lng != null && p.polygon_coordinates && p.polygon_coordinates.length >= 3)
        .map(p => ({
          type: 'Feature',
          properties: { id: p.ll_uuid, source: 'parcel' },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        })),
    } as any
  }, [data])

  const tractPolysGeo = useMemo(() => {
    if (!data) return { type: 'FeatureCollection', features: [] } as any
    return {
      type: 'FeatureCollection',
      features: data.sales
        .filter(s => s.polygon_coordinates && s.polygon_coordinates.length >= 3)
        .map(s => {
          let coords = s.polygon_coordinates as number[][]
          if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
            coords = [...coords, coords[0]]
          }
          return {
            type: 'Feature',
            properties: { id: s.tract_id },
            geometry: { type: 'Polygon', coordinates: [coords] },
          }
        }),
    } as any
  }, [data])

  // Lookup tables — referenced in click handlers via refs so they
  // see the latest data without re-registering events.
  const tractById = useMemo(() => {
    const m = new Map<string, MapSale>()
    if (data) for (const s of data.sales) m.set(s.tract_id, s)
    return m
  }, [data])
  const parcelById = useMemo(() => {
    const m = new Map<string, ParcelWithSale>()
    if (data) for (const p of data.parcels_with_sales || []) m.set(p.ll_uuid, p)
    return m
  }, [data])
  const tractByIdRef = useRef(tractById)
  const parcelByIdRef = useRef(parcelById)
  useEffect(() => { tractByIdRef.current = tractById }, [tractById])
  useEffect(() => { parcelByIdRef.current = parcelById }, [parcelById])

  // --- Map init (once, on first data arrival) ------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !data) return
    const center: [number, number] = data.subject
      ? [data.subject.lng, data.subject.lat]
      : [(data.bbox.min_lng + data.bbox.max_lng) / 2, (data.bbox.min_lat + data.bbox.max_lat) / 2]
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: GLYPH_URL,  // required for symbol-layer text rendering (the + icons)
        sources: { imagery: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION } },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
      },
      center,
      zoom: 11,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => setMapReady(true))

    // Reposition open popup when the map pans/zooms.
    map.on('move', () => {
      setOpenRecord(prev => {
        if (!prev) return prev
        const p = map.project([prev.rec.lng, prev.rec.lat])
        return { rec: prev.rec, pos: { x: p.x, y: p.y } }
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // --- Layers + click handlers (after map ready + data) --------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !data) return
    if (map.getSource('tract-pins')) return  // already wired

    // Sale POLYGONS (pink fill behind everything)
    map.addSource('tract-polys', { type: 'geojson', data: tractPolysGeo })
    map.addLayer({
      id: 'tract-polys-fill',
      type: 'fill',
      source: 'tract-polys',
      paint: { 'fill-color': '#E91E8C', 'fill-opacity': 0.18 },
    })
    map.addLayer({
      id: 'tract-polys-line',
      type: 'line',
      source: 'tract-polys',
      paint: { 'line-color': '#E91E8C', 'line-width': 2, 'line-opacity': 1.0 },
    })

    // Tract sale PINS — circle background
    map.addSource('tract-pins', { type: 'geojson', data: tractPinsGeo })
    map.addLayer({
      id: 'tract-pins-bg',
      type: 'circle',
      source: 'tract-pins',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 14],
        'circle-color': '#E91E8C',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    // The + symbol on top of the circle
    map.addLayer({
      id: 'tract-pins-plus',
      type: 'symbol',
      source: 'tract-pins',
      layout: {
        'text-field': '+',
        'text-font': ['Open Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 14, 14, 20],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    })

    // Parcel sale PINS — same look, separate source so we can route
    // clicks to the parcel popup branch.
    map.addSource('parcel-pins', { type: 'geojson', data: parcelPinsGeo })
    map.addLayer({
      id: 'parcel-pins-bg',
      type: 'circle',
      source: 'parcel-pins',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 9, 14, 14],
        'circle-color': '#E91E8C',
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
      },
    })
    map.addLayer({
      id: 'parcel-pins-plus',
      type: 'symbol',
      source: 'parcel-pins',
      layout: {
        'text-field': '+',
        'text-font': ['Open Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 14, 14, 20],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#ffffff' },
    })

    // Subject highlight — blue ring at the focal tract
    if (data.subject) {
      map.addSource('subject', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [data.subject.lng, data.subject.lat] } } as any,
      })
      map.addLayer({
        id: 'subject-circle',
        type: 'circle',
        source: 'subject',
        paint: {
          'circle-radius': 16,
          'circle-color': '#2563EB',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      })
      if (data.subject.polygon_coordinates && data.subject.polygon_coordinates.length >= 3) {
        let sc = data.subject.polygon_coordinates
        if (sc[0][0] !== sc[sc.length - 1][0] || sc[0][1] !== sc[sc.length - 1][1]) {
          sc = [...sc, sc[0]]
        }
        map.addSource('subject-poly', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [sc] } } as any,
        })
        map.addLayer({
          id: 'subject-poly-line',
          type: 'line',
          source: 'subject-poly',
          paint: { 'line-color': '#2563EB', 'line-width': 3, 'line-opacity': 1.0 },
        })
      }
    }

    // Click handlers — open popup. Pointer cursor on hover too so the
    // UI feels clickable (NO popup on hover; just cursor change).
    const setPointer = () => { map.getCanvas().style.cursor = 'pointer' }
    const clearPointer = () => { map.getCanvas().style.cursor = '' }
    map.on('mouseenter', 'tract-pins-bg', setPointer)
    map.on('mouseleave', 'tract-pins-bg', clearPointer)
    map.on('mouseenter', 'parcel-pins-bg', setPointer)
    map.on('mouseleave', 'parcel-pins-bg', clearPointer)

    const onTractClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (!f) return
      const id = (f.properties as any)?.id as string
      const s = tractByIdRef.current.get(id)
      if (!s || s.lat == null || s.lng == null) return
      const p = map.project([s.lng, s.lat])
      setOpenRecord({
        rec: tractToPopupRecord(s),
        pos: { x: p.x, y: p.y },
      })
      e.preventDefault?.()  // suppress map click below
    }
    const onParcelClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (!f) return
      const id = (f.properties as any)?.id as string
      const p = parcelByIdRef.current.get(id)
      if (!p || p.lat == null || p.lng == null) return
      const pos = map.project([p.lng, p.lat])
      setOpenRecord({
        rec: parcelToPopupRecord(p),
        pos: { x: pos.x, y: pos.y },
      })
      e.preventDefault?.()
    }
    map.on('click', 'tract-pins-bg', onTractClick)
    map.on('click', 'tract-pins-plus', onTractClick)
    map.on('click', 'parcel-pins-bg', onParcelClick)
    map.on('click', 'parcel-pins-plus', onParcelClick)

    // General map click — closes the popup ONLY if the click didn't
    // hit a + pin (and thus didn't open a new popup). MapLibre's
    // layer-specific click handlers above call e.preventDefault(),
    // so e.defaultPrevented is the reliable signal. Without this,
    // the previous mousedown-capture click-outside approach raced
    // the layer handler and closed every newly-opened popup.
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if ((e as any).defaultPrevented) return
      setOpenRecord(null)
    }
    map.on('click', onMapClick)

    // Fit bounds to subject + sales bbox
    const padLng = (data.bbox.max_lng - data.bbox.min_lng) * 0.1
    const padLat = (data.bbox.max_lat - data.bbox.min_lat) * 0.1
    try {
      map.fitBounds(
        [
          [data.bbox.min_lng - padLng, data.bbox.min_lat - padLat],
          [data.bbox.max_lng + padLng, data.bbox.max_lat + padLat],
        ],
        { padding: 40, duration: 0 },
      )
    } catch {}

    return () => {
      map.off('mouseenter', 'tract-pins-bg' as any, setPointer)
      map.off('mouseleave', 'tract-pins-bg' as any, clearPointer)
      map.off('mouseenter', 'parcel-pins-bg' as any, setPointer)
      map.off('mouseleave', 'parcel-pins-bg' as any, clearPointer)
      map.off('click', 'tract-pins-bg' as any, onTractClick as any)
      map.off('click', 'tract-pins-plus' as any, onTractClick as any)
      map.off('click', 'parcel-pins-bg' as any, onParcelClick as any)
      map.off('click', 'parcel-pins-plus' as any, onParcelClick as any)
      map.off('click', onMapClick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, data])

  // Update source data when GeoJSON changes (after layers exist)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    ;(map.getSource('tract-pins') as maplibregl.GeoJSONSource | undefined)?.setData(tractPinsGeo)
    ;(map.getSource('parcel-pins') as maplibregl.GeoJSONSource | undefined)?.setData(parcelPinsGeo)
    ;(map.getSource('tract-polys') as maplibregl.GeoJSONSource | undefined)?.setData(tractPolysGeo)
  }, [tractPinsGeo, parcelPinsGeo, tractPolysGeo, mapReady])

  // Regrid parcel layer (all parcels, no filter)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !regridConfig?.tile_url_template) return
    const beforeId = map.getLayer('tract-polys-fill') ? 'tract-polys-fill' : undefined
    const cleanup = addRegridLayer(map, regridConfig, { beforeId })
    return cleanup
  }, [regridConfig, mapReady])

  // ESC closes the popup (UX nicety)
  useEffect(() => {
    if (!openRecord) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenRecord(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openRecord])

  const closePopup = () => setOpenRecord(null)

  const onAddToReport = (rec: PopupRecord) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(rec.id)) next.delete(rec.id); else next.add(rec.id)
      return next
    })
    closePopup()  // per spec: only Add-to-Report closes the popup
  }
  const onView3D = (rec: PopupRecord) => {
    // For tract records we have a tract_id → existing 3D modal works.
    // For parcel records (no tract_id) the 3D modal would need the
    // polygon-elevation endpoint; deferred to a follow-up so we don't
    // ship a broken button.
    if (rec.kind === 'tract' && rec.tract_id) {
      setShow3D({ tractId: rec.tract_id })
    }
  }
  const onViewDetails = (rec: PopupRecord) => {
    if (rec.kind === 'tract' && rec.listing_id) {
      window.open(`/listings/${rec.listing_id}`, '_blank', 'noopener,noreferrer')
    } else if (rec.kind === 'parcel' && rec.source_url) {
      window.open(rec.source_url, '_blank', 'noopener,noreferrer')
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>Loading comparables map…</div>
  }
  if (error) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#ff6b6b' }}>Failed to load comparables: {error}</div>
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {openRecord && (
        <ComparablePopup
          rec={openRecord.rec}
          pos={openRecord.pos}
          isSelected={selectedIds.has(openRecord.rec.id)}
          onClose={closePopup}
          onView3D={() => onView3D(openRecord.rec)}
          onViewDetails={() => onViewDetails(openRecord.rec)}
          onAddToReport={() => onAddToReport(openRecord.rec)}
          show3DButton={openRecord.rec.kind === 'tract' && !!openRecord.rec.tract_id}
          showDetailsButton={
            (openRecord.rec.kind === 'tract' && !!openRecord.rec.listing_id) ||
            (openRecord.rec.kind === 'parcel' && !!openRecord.rec.source_url)
          }
        />
      )}
      {/* Floating count badge */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          backgroundColor: '#E91E8C', color: '#fff', borderRadius: 30, padding: '12px 24px',
          fontWeight: 700, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 500,
        }}>
          {selectedIds.size} comparable{selectedIds.size === 1 ? '' : 's'} selected
        </div>
      )}
      <Tract3DModal
        tractId={show3D?.tractId || ''}
        isOpen={!!show3D}
        onClose={() => setShow3D(null)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function tractToPopupRecord(s: MapSale): PopupRecord {
  return {
    kind: 'tract',
    id: s.tract_id,
    tract_id: s.tract_id,
    listing_id: s.listing_id,
    lat: s.lat as number,
    lng: s.lng as number,
    polygon: s.polygon_coordinates,
    sale_date: s.sale_date,
    sale_price: s.sale_price,
    price_per_acre: s.price_per_acre,
    total_acres: s.total_acres,
    tillable_acres: s.tillable_acres,
    soil_rating: s.soil_rating,
    soil_rating_type: s.soil_rating_type,
    county: s.county,
    township: s.township,
    owner: s.owner || s.company_name,
    source_url: s.source_url,
  }
}

function parcelToPopupRecord(p: ParcelWithSale): PopupRecord {
  return {
    kind: 'parcel',
    id: p.ll_uuid,
    lat: p.lat as number,
    lng: p.lng as number,
    polygon: p.polygon_coordinates,
    sale_date: p.sale_date,
    sale_price: p.sale_price,
    price_per_acre: p.price_per_acre,
    total_acres: p.total_acres,
    tillable_acres: null,
    soil_rating: null,
    soil_rating_type: null,
    county: p.county,
    township: null,
    owner: p.owner,
    source_url: null,
  }
}

// ---------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------

function ComparablePopup({
  rec, pos, isSelected,
  onClose, onView3D, onViewDetails, onAddToReport,
  show3DButton, showDetailsButton,
}: {
  rec: PopupRecord
  pos: { x: number; y: number }
  isSelected: boolean
  onClose: () => void
  onView3D: () => void
  onViewDetails: () => void
  onAddToReport: () => void
  show3DButton: boolean
  showDetailsButton: boolean
}) {
  // Click-outside-to-close is handled at the MAP level (general map
  // click → close if no + was hit). For DOM clicks outside the map
  // (topbar, browser chrome) we don't auto-close — the user closes
  // with X / Esc / Add-to-Report instead. The previous mousedown-
  // capture approach raced the map's layer-click handler and closed
  // newly-opened popups on every consecutive pin click.
  const ref = useRef<HTMLDivElement | null>(null)

  // Position: anchor below the pin if it's close to the top of the
  // viewport (would otherwise clip), else above. Horizontal clamp keeps
  // popup inside left/right edges.
  const POPUP_WIDTH = 300
  const ABOVE_HEIGHT = 320  // conservative
  const showBelow = pos.y < ABOVE_HEIGHT
  const clampedX = typeof window !== 'undefined' ? Math.max(
    POPUP_WIDTH / 2 + 8,
    Math.min(pos.x, window.innerWidth - POPUP_WIDTH / 2 - 8),
  ) : pos.x

  const ratingLabel = rec.soil_rating != null
    ? `${rec.soil_rating_type || 'Soil'}: ${FMT_NUM(rec.soil_rating)}`
    : null

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: clampedX,
        top: pos.y,
        transform: showBelow
          ? 'translate(-50%, 18px)'
          : 'translate(-50%, calc(-100% - 18px))',
        background: '#fff',
        color: '#111',
        borderRadius: 12,
        boxShadow: '0 12px 36px rgba(0,0,0,0.45)',
        width: POPUP_WIDTH,
        zIndex: 1000,
      }}
    >
      {/* Header row with close button */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 12px 6px',
        borderBottom: '1px solid rgba(0,0,0,0.06)',
      }}>
        <strong style={{ fontSize: 13, color: '#555' }}>
          {rec.kind === 'tract' ? 'Tract sale' : 'Parcel sale'}
        </strong>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 22, lineHeight: 1, color: '#666', padding: 0,
            width: 28, height: 28, borderRadius: 14,
          }}
          onMouseOver={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.06)' }}
          onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
        >×</button>
      </div>

      <div style={{ padding: '8px 14px 12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 13 }}>
          <span style={{ color: '#666' }}>Sale date</span>
          <span style={{ fontWeight: 600 }}>{FMT_DATE(rec.sale_date)}</span>

          <span style={{ color: '#666' }}>Total acres</span>
          <span style={{ fontWeight: 600 }}>{FMT_NUM(rec.total_acres)}</span>

          <span style={{ color: '#666' }}>Sale price</span>
          <span style={{ fontWeight: 600 }}>{FMT_USD(rec.sale_price)}</span>

          <span style={{ color: '#666' }}>Price / acre</span>
          <span style={{ fontWeight: 600 }}>{rec.price_per_acre != null ? `$${FMT_NUM(rec.price_per_acre, 0)}/ac` : '—'}</span>

          {ratingLabel && <>
            <span style={{ color: '#666' }}>{rec.soil_rating_type || 'Soil rating'}</span>
            <span style={{ fontWeight: 600 }}>{FMT_NUM(rec.soil_rating)}</span>
          </>}

          <span style={{ color: '#666' }}>County</span>
          <span style={{ fontWeight: 600 }}>{rec.county || '—'}</span>

          {rec.township && <>
            <span style={{ color: '#666' }}>Township</span>
            <span style={{ fontWeight: 600 }}>{rec.township}</span>
          </>}

          <span style={{ color: '#666' }}>Owner</span>
          <span style={{ fontWeight: 600, textAlign: 'right' }}>{rec.owner || '—'}</span>
        </div>
      </div>

      {/* Three horizontal action buttons */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `${show3DButton ? '1fr' : ''} ${showDetailsButton ? '1fr' : ''} 1fr`.trim(),
        borderTop: '1px solid rgba(0,0,0,0.08)',
        background: '#fafafa',
        borderRadius: '0 0 12px 12px',
      }}>
        {show3DButton && (
          <button onClick={onView3D} style={popupBtnStyle('left')} title="View 3D terrain map">
            🏔 3D
          </button>
        )}
        {showDetailsButton && (
          <button
            onClick={onViewDetails}
            style={popupBtnStyle(show3DButton ? 'mid' : 'left')}
            title="See more details"
          >
            🔎 Details
          </button>
        )}
        <button
          onClick={onAddToReport}
          style={{
            ...popupBtnStyle('right'),
            color: isSelected ? '#E91E8C' : '#111',
            background: isSelected ? 'rgba(233,30,140,0.08)' : 'transparent',
          }}
          title={isSelected ? 'Remove from report' : 'Add to report'}
        >
          {isSelected ? '✓ Added' : '＋ Report'}
        </button>
      </div>
    </div>
  )
}

function popupBtnStyle(pos: 'left' | 'mid' | 'right'): React.CSSProperties {
  return {
    border: 'none',
    background: 'transparent',
    padding: '10px 8px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    color: '#111',
    borderRight: pos !== 'right' ? '1px solid rgba(0,0,0,0.08)' : 'none',
    borderRadius:
      pos === 'left' ? '0 0 0 12px' : pos === 'right' ? '0 0 12px 0' : 0,
  }
}
