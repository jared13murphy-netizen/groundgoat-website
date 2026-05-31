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
 *   - Regrid parcels with a real sale (saleprice > 0) ALSO show a +
 *     icon. These are detected directly from the rendered Regrid
 *     vector TILES (which carry saleprice/saledate baked in),
 *     de-duplicated against tract sales, and pinned at each parcel
 *     centroid. The full Regrid parcel layer is rendered underneath
 *     as normal (every parcel boundary visible). Tapping a parcel +
 *     fetches the authoritative parcel record (/api/regrid/parcel)
 *     for the popup / report content — the tile only drives detection.
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

// Distinct, flashy highlight color for the SUBJECT tract — intentionally
// different from the pink sale pins (#E91E8C) so the focal tract always
// stands out. Shared with the mobile comp map (ComparablesMapView.js).
const SUBJECT_COLOR = '#0EA5E9'

// Inject the subject-marker pulse keyframes once (module-scoped guard).
function ensureSubjectPulseCSS() {
  if (typeof document === 'undefined') return
  if (document.getElementById('gg-subject-pulse-css')) return
  const style = document.createElement('style')
  style.id = 'gg-subject-pulse-css'
  style.textContent = `
    .gg-subject-pulse {
      width: 18px; height: 18px; border-radius: 50%;
      background: ${SUBJECT_COLOR}; border: 2.5px solid #fff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4); position: relative;
    }
    .gg-subject-pulse::before {
      content: ''; position: absolute; inset: -5px; border-radius: 50%;
      background: ${SUBJECT_COLOR};
      animation: gg-subject-pulse 1.8s ease-out infinite; z-index: -1;
    }
    @keyframes gg-subject-pulse {
      0%   { transform: scale(0.55); opacity: 0.55; }
      100% { transform: scale(2.6);  opacity: 0; }
    }
  `
  document.head.appendChild(style)
}

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
  const subjectMarkerRef = useRef<maplibregl.Marker | null>(null)
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
  const tractByIdRef = useRef(tractById)
  useEffect(() => { tractByIdRef.current = tractById }, [tractById])
  // Signature of the last parcel-pin set we pushed to the source. The
  // tile-extraction effect compares against this to skip redundant
  // setData calls — setData triggers a repaint → another 'idle' →
  // re-extract, which would loop forever if we wrote every time.
  const lastParcelSigRef = useRef<string>('')
  // Persistent accumulator of every Regrid parcel we've detected this
  // session, keyed by parcel `path`. We UNION new detections in (never
  // replace), so the "+" pins behave exactly like the tract pins: once
  // found they stay pinned at every zoom, instead of being culled to
  // whatever tiles happen to be rendered this frame. Tile DETECTION only
  // works at z>=12, but DISPLAY is no longer gated on zoom. Reset when
  // the subject tract (data) changes — tracked by parcelAccDataRef.
  const parcelAccRef = useRef<Map<string, {
    id: string; minLng: number; minLat: number; maxLng: number; maxLat: number
    salePrice: number; saleDate: any; acres: number | null; owner: any
  }>>(new Map())
  const parcelAccDataRef = useRef<any>(null)

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
      zoom: 14,  // open tight on the subject so Regrid parcels (minzoom 12) render
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
    // clicks to the parcel popup branch. Populated on demand by the
    // tile-extraction effect (querySourceFeatures on the Regrid tiles),
    // so it starts empty here.
    map.addSource('parcel-pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any })
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

    // Subject highlight — a pulsing DOM marker in the distinct
    // SUBJECT_COLOR at the focal tract. A DOM marker (vs a GPU circle
    // layer) is an HTML overlay that's never collision-hidden or dropped,
    // so the subject stays visible, and CSS keyframes give it the pulse.
    if (data.subject) {
      ensureSubjectPulseCSS()
      const el = document.createElement('div')
      el.className = 'gg-subject-pulse'
      subjectMarkerRef.current?.remove()
      subjectMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([data.subject.lng, data.subject.lat])
        .addTo(map)
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
          paint: { 'line-color': SUBJECT_COLOR, 'line-width': 3.5, 'line-opacity': 1.0 },
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
    // Parcel pins are detected from the Regrid TILE (saleprice baked in)
    // and carry the tile-derived fields in their feature properties. We
    // open the popup IMMEDIATELY from those (so the user sees the sale
    // price / acres with no spinner), then fetch the authoritative parcel
    // record (/api/regrid/parcel?lat=&lng=) and merge richer fields
    // (county, owner, soil rating, tillable acres) in when it lands.
    const onParcelClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (!f) return
      const props: any = f.properties || {}
      const lat = num(props.lat), lng = num(props.lng)
      if (lat == null || lng == null) return
      const pos = map.project([lng, lat])
      const baseRec: PopupRecord = {
        kind: 'parcel',
        id: String(props.id),
        lat, lng,
        polygon: null,
        sale_date: props.sale_date ?? null,
        sale_price: num(props.sale_price),
        price_per_acre: num(props.price_per_acre),
        total_acres: num(props.total_acres),
        tillable_acres: null,
        soil_rating: null,
        soil_rating_type: null,
        county: null,
        township: null,
        owner: props.owner ?? null,
        source_url: null,  // parcels never show the Details button
      }
      setOpenRecord({ rec: baseRec, pos: { x: pos.x, y: pos.y } })
      e.preventDefault?.()

      // Authoritative fetch — the report CONTENT comes from the parcel
      // record, not the tile. Merge only if the same popup is still open.
      const fetchId = baseRec.id
      ;(async () => {
        try {
          const res = await fetchWithAuth(`${API_URL}/api/regrid/parcel?lat=${lat}&lng=${lng}`)
          if (!res.ok) return
          const body = await res.json().catch(() => null)
          const rp = body?.parcel
          if (!rp) return
          const acres = num(rp.ll_gisacre) ?? num(rp.gisacre) ?? baseRec.total_acres
          const salePrice = num(rp.saleprice) ?? baseRec.sale_price
          const ppa = (salePrice != null && acres != null && acres > 0)
            ? salePrice / acres
            : baseRec.price_per_acre
          const merged: PopupRecord = {
            ...baseRec,
            total_acres: acres,
            sale_price: salePrice,
            sale_date: rp.saledate ?? baseRec.sale_date,
            price_per_acre: ppa,
            county: rp.county ?? null,
            township: rp.township ?? null,
            owner: rp.owner ?? baseRec.owner,
            // Soil rating + tillable acres are being added to the parcel
            // record by a parallel effort; these rows self-hide until the
            // backend exposes them.
            soil_rating: num(rp.soil_rating),
            soil_rating_type: rp.soil_rating_type ?? null,
            tillable_acres: num(rp.tillable_acres),
            source_url: null,
          }
          setOpenRecord(prev => (prev && prev.rec.id === fetchId)
            ? { rec: merged, pos: prev.pos }
            : prev)
        } catch { /* keep the tile-derived popup */ }
      })()
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

    // Open zoomed into the SUBJECT tract (not fitBounds to the whole
    // subject+comps bbox). A county-wide comp report fits at ~z9–11,
    // which is BELOW the Regrid parcel minzoom (12) — so the parcels
    // never render and the "+" sale pins can't be detected until the
    // user manually zooms in. Landing at z14 on the subject (matching
    // the mobile app) makes the Regrid parcels render and the "+" pins
    // appear immediately. The comp sale pins remain on the map; the
    // user can zoom out to see the full comp set.
    const subjectCenter: [number, number] = data.subject
      ? [data.subject.lng, data.subject.lat]
      : [(data.bbox.min_lng + data.bbox.max_lng) / 2, (data.bbox.min_lat + data.bbox.max_lat) / 2]
    try {
      map.jumpTo({ center: subjectCenter, zoom: 14 })
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
      subjectMarkerRef.current?.remove()
      subjectMarkerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, data])

  // Update source data when GeoJSON changes (after layers exist)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    ;(map.getSource('tract-pins') as maplibregl.GeoJSONSource | undefined)?.setData(tractPinsGeo)
    ;(map.getSource('tract-polys') as maplibregl.GeoJSONSource | undefined)?.setData(tractPolysGeo)
  }, [tractPinsGeo, tractPolysGeo, mapReady])

  // Regrid parcel layer (all parcels, no filter)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !regridConfig?.tile_url_template) return
    const beforeId = map.getLayer('tract-polys-fill') ? 'tract-polys-fill' : undefined
    // minZoom 11 matches the mobile comp map (REGRID_MIN_ZOOM), so parcels
    // render — and "+" pins detect — across a wider zoom range, closer to
    // the tract-pin zoom.
    const cleanup = addRegridLayer(map, regridConfig, { beforeId, minZoom: 11 })
    return cleanup
  }, [regridConfig, mapReady])

  // --- Tile-driven parcel "+" detection ------------------------------
  // The Regrid vector TILES carry `saleprice` (and `saledate`) baked in.
  // We read the RENDERED parcel-fill features in the viewport, keep
  // parcels with a real sale (saleprice > 0, parsed in plain JS so we're
  // robust to the string/int encoding the tiles use), de-dup against
  // tract sales, and drop a pink "+" at each parcel centroid. We use
  // queryRenderedFeatures (not querySourceFeatures) because the rendered
  // query returns geometry in lng/lat — querySourceFeatures can hand back
  // tile-local coordinates, which placed the pins off-map. The tile only
  // drives DETECTION — the report content is fetched on tap (onParcelClick).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !data) return

    // New subject tract → start a fresh parcel accumulation. (The effect
    // also re-runs when regridConfig arrives; only reset on data change.)
    if (parcelAccDataRef.current !== data) {
      parcelAccRef.current = new Map()
      parcelAccDataRef.current = data
      lastParcelSigRef.current = ''
    }

    // Tract sale polygons — suppress a parcel pin wherever a tract sale
    // already shows its own "+" (dedup parcels vs tracts).
    const tractRings: number[][][] = (data.sales || [])
      .filter(s => s.polygon_coordinates && s.polygon_coordinates.length >= 3)
      .map(s => s.polygon_coordinates as number[][])

    // Build the pin GeoJSON from the FULL accumulated parcel set and push
    // it (skipping a redundant setData when nothing changed). Because we
    // render every parcel we've ever detected — not just the current
    // viewport — the "+" pins stay put at every zoom, matching the tract
    // pins instead of being chained to the Regrid tile zoom.
    const commit = () => {
      const out: any[] = []
      for (const p of Array.from(parcelAccRef.current.values())) {
        const lng = (p.minLng + p.maxLng) / 2
        const lat = (p.minLat + p.maxLat) / 2
        // Skip if this parcel sits under an existing tract sale pin.
        if (tractRings.some(r => pointInRing([lng, lat], r))) continue
        const ppa = (p.acres != null && p.acres > 0) ? p.salePrice / p.acres : null
        out.push({
          type: 'Feature',
          properties: {
            id: p.id,
            source: 'parcel',
            lat, lng,
            sale_price: p.salePrice,
            sale_date: p.saleDate,
            total_acres: p.acres,
            price_per_acre: ppa,
            owner: p.owner,
          },
          geometry: { type: 'Point', coordinates: [lng, lat] },
        })
      }
      const sig = out.map(f => f.properties.id).sort().join('|')
      if (sig === lastParcelSigRef.current) return  // unchanged → skip
      lastParcelSigRef.current = sig
      ;(map.getSource('parcel-pins') as maplibregl.GeoJSONSource | undefined)
        ?.setData({ type: 'FeatureCollection', features: out } as any)
    }

    const extract = () => {
      // Tile DETECTION only works where Regrid parcels render (z >= 11,
      // addRegridLayer minZoom). Below that — or before the layer mounts
      // — we do NOT clear: we keep showing everything already detected so
      // the pins persist at every zoom like the tract pins.
      if (map.getZoom() < 11 || !map.getLayer('regrid-parcels-fill')) {
        commit()
        return
      }
      let feats: maplibregl.MapGeoJSONFeature[] = []
      try {
        const canvas = map.getCanvas()
        feats = map.queryRenderedFeatures(
          [[0, 0], [canvas.clientWidth, canvas.clientHeight]] as any,
          { layers: ['regrid-parcels-fill'] },
        )
      } catch { return }

      // Merge this frame's detections into the PERSISTENT accumulator,
      // keyed by stable parcel identity (`path`) and unioning the bbox of
      // every clipped tile fragment so the "+" lands at the true parcel
      // center — queryRenderedFeatures hands back a parcel cut into one
      // fragment per tile, and a single fragment's centroid sits off to
      // one side. The keyed map also dedups repeated fragments and keeps
      // parcels detected in earlier viewports.
      const acc = parcelAccRef.current
      for (const f of feats) {
        const props: any = f.properties || {}
        const saleValue = parseSalePrice(props.saleprice)
        if (!(Number.isFinite(saleValue) && saleValue > 0)) continue
        const acres = num(props.ll_gisacre) ?? num(props.gisacre)
        // Comp map rule: never pin a parcel under 10 acres. Drops the
        // dense clusters of tiny town/residential lots and keeps real
        // farmland comps.
        if (!(acres != null && acres >= 10)) continue
        const bb = bboxOf(f.geometry as any)
        if (!bb) continue
        const cLng = (bb.minLng + bb.maxLng) / 2
        const cLat = (bb.minLat + bb.maxLat) / 2
        // `path` is the stable parcel identity on custom Regrid tiles
        // (no ll_uuid present); fall back to ogc_fid / parcelnumb.
        const key = props.path != null ? String(props.path)
          : props.ogc_fid != null ? String(props.ogc_fid)
          : props.parcelnumb != null ? String(props.parcelnumb)
          : `${cLng.toFixed(6)},${cLat.toFixed(6)}`
        const existing = acc.get(key)
        if (existing) {
          existing.minLng = Math.min(existing.minLng, bb.minLng)
          existing.minLat = Math.min(existing.minLat, bb.minLat)
          existing.maxLng = Math.max(existing.maxLng, bb.maxLng)
          existing.maxLat = Math.max(existing.maxLat, bb.maxLat)
        } else {
          acc.set(key, {
            id: key,
            minLng: bb.minLng, minLat: bb.minLat, maxLng: bb.maxLng, maxLat: bb.maxLat,
            salePrice: saleValue, saleDate: props.saledate ?? null,
            acres, owner: props.owner ?? null,
          })
        }
      }
      commit()
    }

    // Re-detect as the Regrid tiles stream in. A single 'idle' on a fresh
    // open can fire before every viewport tile has actually rendered, so
    // queryRenderedFeatures returns only a few parcels (or none) and — with
    // the user not panning — detection never re-runs to fill in the rest.
    // The MOBILE app avoids this by re-detecting on every region settle plus
    // a timed call after the camera lands; we mirror that here with
    // moveend + sourcedata + a few delayed retries. extract() is idempotent
    // (it accumulates into parcelAccRef and dedups via lastParcelSigRef), so
    // firing it repeatedly only ever ADDS pins, never removes them.
    const onSourceData = (e: maplibregl.MapSourceDataEvent) => {
      if ((e as any).sourceId === 'regrid-parcels' && (e as any).isSourceLoaded) extract()
    }
    map.on('idle', extract)
    map.on('moveend', extract)
    map.on('sourcedata', onSourceData)
    extract()
    const retryTimers = [400, 1200, 2500, 4500, 7000].map(ms => setTimeout(extract, ms))
    return () => {
      map.off('idle', extract)
      map.off('moveend', extract)
      map.off('sourcedata', onSourceData)
      retryTimers.forEach(clearTimeout)
    }
  }, [mapReady, data, regridConfig])

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

// Coerce any value (number | numeric string | null) to a finite number
// or null. Used throughout the parcel path since tile properties and the
// /api/regrid/parcel record both mix numbers and strings.
function num(v: any): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// Parse a tile `saleprice` that may be a number OR a string (the custom
// Regrid tiles encode it inconsistently). Mirrors the locked detection
// filter shared with the mobile app. Returns NaN when unparseable.
function parseSalePrice(sp: any): number {
  if (typeof sp === 'number') return sp
  if (sp == null) return NaN
  return Number(String(sp).replace(/[^0-9.]/g, ''))
}

// Bounding box (lng/lat extent) of a rendered tile feature's geometry.
// queryRenderedFeatures hands back a parcel CLIPPED into one fragment per
// rendered tile, so a parcel straddling a tile seam arrives as 2+ pieces.
// Unioning the bbox of every fragment that shares a `path` recovers the
// parcel's full extent, so the bbox center is a stable "center of the
// parcel" even when the polygon is cut by a seam.
function bboxOf(geom: any): { minLng: number; minLat: number; maxLng: number; maxLat: number } | null {
  if (!geom) return null
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  const visit = (coords: any[]) => {
    for (const c of coords) {
      if (typeof c[0] === 'number') {
        if (c[0] < minLng) minLng = c[0]
        if (c[0] > maxLng) maxLng = c[0]
        if (c[1] < minLat) minLat = c[1]
        if (c[1] > maxLat) maxLat = c[1]
      } else {
        visit(c)
      }
    }
  }
  if (geom.type === 'Point') {
    const [lng, lat] = geom.coordinates
    return { minLng: lng, maxLng: lng, minLat: lat, maxLat: lat }
  }
  if (!geom.coordinates) return null
  visit(geom.coordinates)
  if (!Number.isFinite(minLng)) return null
  return { minLng, minLat, maxLng, maxLat }
}

// Ray-casting point-in-polygon for the parcel/tract dedup check.
function pointInRing(pt: number[], ring: number[][]): boolean {
  const x = pt[0], y = pt[1]
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
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

          {rec.tillable_acres != null && <>
            <span style={{ color: '#666' }}>Tillable acres</span>
            <span style={{ fontWeight: 600 }}>{FMT_NUM(rec.tillable_acres)}</span>
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
