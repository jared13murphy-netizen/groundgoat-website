'use client'

/**
 * Find Comparables — map view (Phase 1).
 *
 * Renders ALL sold tracts + private-treaty / MyDec / ATTOM listings in
 * the viewport for a given subject tract. Hover a pin → popup with
 * sale data + 3 horizontal action buttons (3D / Details / Add to
 * Report). Popup stays open when the cursor moves onto it so admin
 * can click a button without it disappearing.
 *
 * ISOLATED FROM the existing ComparablesMap.tsx — that one powers the
 * /listings/[id]/comparables similarity-ranked report and stays
 * unchanged. This is a separate, purely-visual map view.
 *
 * Data source: GET /api/comparables/map-view?subject_tract_id=…
 * (added 2026-05-16 — viewport-bounded GeoJSON of sales).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { TILE_URL, TILE_ATTRIBUTION } from './mapConstants'
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
  count: number
}

const FMT_USD = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

const FMT_NUM = (n: number | null | undefined, digits = 1) =>
  n == null ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

const FMT_DATE = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

type AddToReportFn = (sale: MapSale) => void

export default function MapComparablesView({ subjectTractId }: { subjectTractId: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [data, setData] = useState<MapViewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<{ sale: MapSale; pos: { x: number; y: number } } | null>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [show3D, setShow3D] = useState<{ tractId: string } | null>(null)
  const [regridConfig, setRegridConfig] = useState<RegridConfig | null>(null)

  // Fetch the comparables payload
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

  // Regrid tile config (parcel layer)
  useEffect(() => {
    let cancelled = false
    fetchRegridConfig().then(cfg => { if (!cancelled) setRegridConfig(cfg) })
    return () => { cancelled = true }
  }, [])

  // Build GeoJSON for pins + polygons
  const pinsGeo = useMemo(() => {
    if (!data) return { type: 'FeatureCollection', features: [] } as any
    return {
      type: 'FeatureCollection',
      features: data.sales
        .filter(s => s.lat != null && s.lng != null)
        .map(s => ({
          type: 'Feature',
          properties: { tract_id: s.tract_id, kind: s.kind },
          geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        })),
    } as any
  }, [data])

  const polysGeo = useMemo(() => {
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
            properties: { tract_id: s.tract_id, kind: s.kind },
            geometry: { type: 'Polygon', coordinates: [coords] },
          }
        }),
    } as any
  }, [data])

  const saleById = useMemo(() => {
    const m = new Map<string, MapSale>()
    if (data) for (const s of data.sales) m.set(s.tract_id, s)
    return m
  }, [data])

  // Initialize map once after data first arrives
  useEffect(() => {
    if (!containerRef.current || mapRef.current || !data) return
    const center: [number, number] = data.subject
      ? [data.subject.lng, data.subject.lat]
      : [(data.bbox.min_lng + data.bbox.max_lng) / 2, (data.bbox.min_lat + data.bbox.max_lat) / 2]
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: { imagery: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION } },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
      },
      center,
      zoom: 11,
      attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      // Sale POLYGONS — pink, semi-transparent
      map.addSource('sale-polys', { type: 'geojson', data: polysGeo })
      map.addLayer({
        id: 'sale-polys-fill',
        type: 'fill',
        source: 'sale-polys',
        paint: { 'fill-color': '#E91E8C', 'fill-opacity': 0.18 },
      })
      map.addLayer({
        id: 'sale-polys-line',
        type: 'line',
        source: 'sale-polys',
        paint: { 'line-color': '#E91E8C', 'line-width': 2, 'line-opacity': 1.0 },
      })

      // Sale PINS — circle markers
      map.addSource('sale-pins', { type: 'geojson', data: pinsGeo })
      map.addLayer({
        id: 'sale-pins-circle',
        type: 'circle',
        source: 'sale-pins',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 14, 10],
          'circle-color': '#E91E8C',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
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
            'circle-radius': 14,
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

      // Pin hover handlers — open popup; cancel any pending close
      map.on('mousemove', 'sale-pins-circle', (e: any) => {
        const f = e.features?.[0]
        if (!f) return
        map.getCanvas().style.cursor = 'pointer'
        const tid = f.properties?.tract_id as string
        const sale = saleByIdRef.current.get(tid)
        if (!sale) return
        const point = map.project([sale.lng!, sale.lat!])
        if (closeTimerRef.current) { window.clearTimeout(closeTimerRef.current); closeTimerRef.current = null }
        setHovered({ sale, pos: { x: point.x, y: point.y } })
      })
      map.on('mouseleave', 'sale-pins-circle', () => {
        map.getCanvas().style.cursor = ''
        // Short delay so the cursor can transit onto the popup
        if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = window.setTimeout(() => setHovered(null), 150)
      })

      // Reposition popup when map pans/zooms
      map.on('move', () => {
        setHovered(h => {
          if (!h) return h
          const p = map.project([h.sale.lng!, h.sale.lat!])
          return { sale: h.sale, pos: { x: p.x, y: p.y } }
        })
      })
    })

    // Fit bounds to subject + sales bbox
    const padLng = (data.bbox.max_lng - data.bbox.min_lng) * 0.1
    const padLat = (data.bbox.max_lat - data.bbox.min_lat) * 0.1
    map.once('load', () => {
      try {
        map.fitBounds(
          [
            [data.bbox.min_lng - padLng, data.bbox.min_lat - padLat],
            [data.bbox.max_lng + padLng, data.bbox.max_lat + padLat],
          ],
          { padding: 40, duration: 0 },
        )
      } catch {}
    })

    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // Keep a ref to saleById so the map event handlers see the latest
  // value without needing to re-register handlers on every render.
  const saleByIdRef = useRef(saleById)
  useEffect(() => { saleByIdRef.current = saleById }, [saleById])

  // Update GeoJSON sources when data changes (after map already exists)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const pinsSrc = map.getSource('sale-pins') as maplibregl.GeoJSONSource | undefined
    if (pinsSrc) pinsSrc.setData(pinsGeo)
    const polysSrc = map.getSource('sale-polys') as maplibregl.GeoJSONSource | undefined
    if (polysSrc) polysSrc.setData(polysGeo)
  }, [pinsGeo, polysGeo])

  // Add Regrid layer after map loads + config arrives
  useEffect(() => {
    const map = mapRef.current
    if (!map || !regridConfig?.tile_url_template || !map.isStyleLoaded()) return
    const cleanup = addRegridLayer(map, regridConfig, { beforeId: 'sale-polys-fill' })
    return cleanup
  }, [regridConfig, data])

  // Add-to-Report behavior — closes popup after click (per spec)
  const onAddToReport = (sale: MapSale) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(sale.tract_id)) next.delete(sale.tract_id)
      else next.add(sale.tract_id)
      return next
    })
    setHovered(null)
  }

  // 3D + Details — keep popup open per spec. For Phase 1 every sale
  // has a tract_id (they're all from our DB), so the existing
  // /api/tracts/{id}/elevation path is used. Phase 2 (Regrid parcel
  // overlay) will switch to /api/elevation/polygon since those
  // parcels won't have tract_ids — the backend endpoint is already
  // in place.
  const onView3D = (sale: MapSale) => {
    setShow3D({ tractId: sale.tract_id })
  }
  const onViewDetails = (sale: MapSale) => {
    window.open(`/listings/${sale.listing_id}`, '_blank', 'noopener,noreferrer')
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>
        Loading comparables map…
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#ff6b6b' }}>
        Failed to load comparables: {error}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {hovered && (
        <ComparableSaleHoverPopup
          sale={hovered.sale}
          pos={hovered.pos}
          onMouseEnter={() => {
            if (closeTimerRef.current) {
              window.clearTimeout(closeTimerRef.current)
              closeTimerRef.current = null
            }
          }}
          onMouseLeave={() => {
            if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current)
            closeTimerRef.current = window.setTimeout(() => setHovered(null), 150)
          }}
          onView3D={() => onView3D(hovered.sale)}
          onViewDetails={() => onViewDetails(hovered.sale)}
          onAddToReport={() => onAddToReport(hovered.sale)}
          isSelected={selectedIds.has(hovered.sale.tract_id)}
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

/**
 * Popup that opens on pin-hover. Three horizontal action buttons.
 * The container has its own onMouseEnter/Leave so the cursor can
 * transit FROM the pin → onto the popup without the close timer firing.
 */
function ComparableSaleHoverPopup({
  sale, pos, onMouseEnter, onMouseLeave, onView3D, onViewDetails, onAddToReport, isSelected,
}: {
  sale: MapSale
  pos: { x: number; y: number }
  onMouseEnter: () => void
  onMouseLeave: () => void
  onView3D: () => void
  onViewDetails: () => void
  onAddToReport: () => void
  isSelected: boolean
}) {
  const ppa = sale.price_per_acre
  const rating = sale.soil_rating
  const ratingLabel = rating != null
    ? `${sale.soil_rating_type || 'Soil'}: ${FMT_NUM(rating)}`
    : null
  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        transform: 'translate(-50%, calc(-100% - 14px))',  // anchor above the pin
        background: '#fff',
        color: '#111',
        borderRadius: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
        minWidth: 260,
        maxWidth: 320,
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    >
      {/* Body */}
      <div style={{ padding: '12px 14px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, fontSize: 13 }}>
          <span style={{ color: '#666' }}>Sale date</span>
          <span style={{ fontWeight: 600 }}>{FMT_DATE(sale.sale_date)}</span>

          <span style={{ color: '#666' }}>Total acres</span>
          <span style={{ fontWeight: 600 }}>{FMT_NUM(sale.total_acres)}</span>

          <span style={{ color: '#666' }}>Sale price</span>
          <span style={{ fontWeight: 600 }}>{FMT_USD(sale.sale_price)}</span>

          <span style={{ color: '#666' }}>Price / acre</span>
          <span style={{ fontWeight: 600 }}>{ppa != null ? `$${FMT_NUM(ppa, 0)}/ac` : '—'}</span>

          {ratingLabel && <>
            <span style={{ color: '#666' }}>{sale.soil_rating_type || 'Soil rating'}</span>
            <span style={{ fontWeight: 600 }}>{FMT_NUM(rating)}</span>
          </>}

          <span style={{ color: '#666' }}>County</span>
          <span style={{ fontWeight: 600 }}>{sale.county || '—'}</span>

          {sale.township && <>
            <span style={{ color: '#666' }}>Township</span>
            <span style={{ fontWeight: 600 }}>{sale.township}</span>
          </>}

          <span style={{ color: '#666' }}>Owner</span>
          <span style={{ fontWeight: 600, textAlign: 'right' }}>{sale.owner || sale.company_name || '—'}</span>
        </div>
      </div>

      {/* Three horizontal action buttons */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        borderTop: '1px solid rgba(0,0,0,0.08)',
        background: '#fafafa',
        borderRadius: '0 0 12px 12px',
      }}>
        <button
          onClick={onView3D}
          style={popupBtnStyle('left')}
          title="View 3D terrain map"
        >
          🏔 3D
        </button>
        <button
          onClick={onViewDetails}
          style={popupBtnStyle('mid')}
          title="See more details"
        >
          🔎 Details
        </button>
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
