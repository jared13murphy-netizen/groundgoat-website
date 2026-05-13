'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, ExternalLink, MapPin, Trash2 } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import fetchWithAuth from '@/lib/fetchWithAuth'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const API_URL = 'https://practical-serenity-production.up.railway.app'
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '© Esri, Maxar, Earthstar Geographics'

// Per-tract colors for full polygon outline. Cycled in tract_number order.
const TRACT_COLORS = ['#ff3b3b', '#3b9fff', '#ffd83b', '#a83bff', '#3bffa8', '#ff7a3b']

type ExtractedTract = {
  tract_id: string
  tract_number: number | null
  acres?: number
  tillable_acres?: number | null
  soil_rating?: number | null
  soil_rating_type?: string | null
  identification_method?: string
  polygon_coordinates?: number[][] | null
  tillable_polygon?: number[][] | null
}

// Ramer-Douglas-Peucker line simplification for [lng, lat] coords.
// Removes near-collinear vertices so dragging straight-edge boundaries
// works (a rectangular tract shouldn't have 80 vertex handles).
function _perpDistance(p: number[], a: number[], b: number[]): number {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - ax, py - ay)
  }
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}
function simplifyPolygon(points: number[][], epsilon = 0.00008): number[][] {
  // epsilon in degrees ≈ 9m at mid-US latitudes. Big enough to
  // collapse near-collinear noise, small enough to preserve real
  // corners (>30° bends).
  if (points.length < 4) return points
  // Detect closed-ring: drop trailing duplicate before simplifying,
  // re-close after.
  const closed = points[0][0] === points[points.length - 1][0]
              && points[0][1] === points[points.length - 1][1]
  const open = closed ? points.slice(0, -1) : points
  // Iterative DP via stack
  const keep = new Array(open.length).fill(false)
  keep[0] = true
  keep[open.length - 1] = true
  const stack: [number, number][] = [[0, open.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()!
    let maxDist = 0, maxIdx = -1
    for (let i = s + 1; i < e; i++) {
      const d = _perpDistance(open[i], open[s], open[e])
      if (d > maxDist) { maxDist = d; maxIdx = i }
    }
    if (maxDist > epsilon && maxIdx > 0) {
      keep[maxIdx] = true
      stack.push([s, maxIdx], [maxIdx, e])
    }
  }
  const result = open.filter((_, i) => keep[i])
  return closed ? [...result, result[0]] : result
}

type EditableTract = ExtractedTract & {
  // Current polygon state — mutated by vertex drag / body drag
  current_polygon?: number[][]
  // Last-calculated tillable polygon + values (from /recalculate-from-polygon)
  current_tillable_polygon?: number[][] | null
  current_tillable_acres?: number | null
  current_soil_rating?: number | null
  current_soil_rating_type?: string | null
  current_polygon_acres?: number | null
}

function EditableExtractMap({
  tracts,
  onPolygonChange,
}: {
  tracts: EditableTract[]
  onPolygonChange: (tractId: string, newPolygon: number[][]) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  // Ref-mirrored state for drag handlers (avoid stale closures)
  const tractsRef = useRef(tracts)
  const onChangeRef = useRef(onPolygonChange)
  tractsRef.current = tracts
  onChangeRef.current = onPolygonChange

  // Drag state
  const draggingRef = useRef<{
    type: 'vertex' | 'body'
    tractId: string
    vertexIdx?: number  // for vertex drag
    lastLng?: number    // for body drag
    lastLat?: number
  } | null>(null)

  // Build features for a tract's polygon + vertex handles
  const buildPolyGeo = (polygon: number[][]) => {
    if (polygon.length < 3) return { type: 'FeatureCollection', features: [] }
    const closed = [...polygon]
    if (JSON.stringify(closed[0]) !== JSON.stringify(closed[closed.length - 1])) {
      closed.push(closed[0])
    }
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closed] },
      }],
    } as any
  }
  const buildVertexGeo = (polygon: number[][], tractId: string) => ({
    type: 'FeatureCollection',
    features: polygon.map((p, i) => ({
      type: 'Feature',
      properties: { idx: i, tractId },
      geometry: { type: 'Point', coordinates: p },
    })),
  } as any)

  // Trigger map init when tracts first arrives with polygon data.
  // Previously the dep array was [] so the effect only ran once on
  // mount — at that moment editStateByTract was still empty (it gets
  // synced from autoExtractResultByListing in a separate effect that
  // fires later), so the map saw 0 tracts and bailed.
  const hasData = tracts.some(t => t.current_polygon && t.current_polygon.length >= 3)

  useEffect(() => {
    if (!containerRef.current) return
    if (mapRef.current) return  // Only init once
    const usable = tractsRef.current.filter(
      t => t.current_polygon && t.current_polygon.length >= 3
    )
    if (usable.length === 0) return

    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity
    for (const t of usable) {
      for (const [lng, lat] of t.current_polygon!) {
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
      }
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          imagery: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION },
        },
        layers: [{ id: 'imagery', type: 'raster', source: 'imagery' }],
      },
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      zoom: 14,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      const labels: any[] = []
      for (let i = 0; i < usable.length; i++) {
        const t = usable[i]
        const color = TRACT_COLORS[i % TRACT_COLORS.length]
        const fullId = `full_${t.tract_id}`
        const tilId = `til_${t.tract_id}`
        const vertId = `vert_${t.tract_id}`

        // Full polygon — fill + line + vertex handles
        map.addSource(fullId, { type: 'geojson', data: buildPolyGeo(t.current_polygon!) })
        map.addLayer({ id: `${fullId}_fill`, type: 'fill', source: fullId,
          paint: { 'fill-color': color, 'fill-opacity': 0.12 } })
        map.addLayer({ id: `${fullId}_line`, type: 'line', source: fullId,
          paint: { 'line-color': color, 'line-width': 3 } })

        // Tillable polygon (rendered only when current_tillable_polygon is set)
        map.addSource(tilId, {
          type: 'geojson',
          data: t.current_tillable_polygon
            ? buildPolyGeo(t.current_tillable_polygon)
            : { type: 'FeatureCollection', features: [] } as any,
        })
        map.addLayer({ id: `${tilId}_fill`, type: 'fill', source: tilId,
          paint: { 'fill-color': '#22c55e', 'fill-opacity': 0.40 } })

        // Vertex handles for drag
        map.addSource(vertId, { type: 'geojson', data: buildVertexGeo(t.current_polygon!, t.tract_id) })
        map.addLayer({
          id: `${vertId}_circle`, type: 'circle', source: vertId,
          paint: {
            'circle-radius': 6, 'circle-color': '#ffffff',
            'circle-stroke-color': color, 'circle-stroke-width': 2,
          },
        })

        // Label
        const cx = t.current_polygon!.reduce((s, p) => s + p[0], 0) / t.current_polygon!.length
        const cy = t.current_polygon!.reduce((s, p) => s + p[1], 0) / t.current_polygon!.length
        labels.push({ type: 'Feature',
          properties: { label: `T${t.tract_number ?? '?'}`, color },
          geometry: { type: 'Point', coordinates: [cx, cy] } })

        // Wire vertex drag
        map.on('mousedown', `${vertId}_circle`, (e: any) => {
          e.preventDefault()
          const f = e.features?.[0]
          if (!f) return
          draggingRef.current = {
            type: 'vertex',
            tractId: f.properties.tractId,
            vertexIdx: f.properties.idx,
          }
          map.getCanvas().style.cursor = 'grabbing'
          map.dragPan.disable()
        })
        map.on('mouseenter', `${vertId}_circle`, () => { map.getCanvas().style.cursor = 'grab' })
        map.on('mouseleave', `${vertId}_circle`, () => {
          if (!draggingRef.current) map.getCanvas().style.cursor = ''
        })

        // Wire polygon body drag (mousedown on FILL, not vertex)
        map.on('mousedown', `${fullId}_fill`, (e: any) => {
          // Skip if mousedown is on a vertex
          const vertexHits = map.queryRenderedFeatures(e.point, { layers: [`${vertId}_circle`] })
          if (vertexHits.length > 0) return
          e.preventDefault()
          const f = e.features?.[0]
          if (!f) return
          draggingRef.current = {
            type: 'body', tractId: t.tract_id,
            lastLng: e.lngLat.lng, lastLat: e.lngLat.lat,
          }
          map.getCanvas().style.cursor = 'grabbing'
          map.dragPan.disable()
        })
      }

      map.addSource('labels', { type: 'geojson', data: { type: 'FeatureCollection', features: labels } as any })
      map.addLayer({
        id: 'labels', type: 'symbol', source: 'labels',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 16, 'text-anchor': 'center',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 2 },
      })

      const padLng = (maxLng - minLng) * 0.15
      const padLat = (maxLat - minLat) * 0.15
      map.fitBounds(
        [[minLng - padLng, minLat - padLat], [maxLng + padLng, maxLat + padLat]],
        { padding: 30, duration: 0 },
      )
    })

    // Window-level mousemove/mouseup so the drag works even if cursor
    // leaves the map briefly.
    const onMouseMove = (ev: MouseEvent) => {
      const drag = draggingRef.current
      if (!drag || !mapRef.current) return
      const rect = (mapRef.current.getCanvas() as any).getBoundingClientRect()
      const lngLat = mapRef.current.unproject([ev.clientX - rect.left, ev.clientY - rect.top])
      const allTracts = tractsRef.current
      const t = allTracts.find(x => x.tract_id === drag.tractId)
      if (!t || !t.current_polygon) return

      if (drag.type === 'vertex' && drag.vertexIdx !== undefined) {
        const newPoly = t.current_polygon.map((p, i) =>
          i === drag.vertexIdx ? [lngLat.lng, lngLat.lat] : p
        )
        onChangeRef.current(drag.tractId, newPoly)
      } else if (drag.type === 'body' && drag.lastLng !== undefined && drag.lastLat !== undefined) {
        const dLng = lngLat.lng - drag.lastLng
        const dLat = lngLat.lat - drag.lastLat
        const newPoly = t.current_polygon.map(p => [p[0] + dLng, p[1] + dLat])
        draggingRef.current = { ...drag, lastLng: lngLat.lng, lastLat: lngLat.lat }
        onChangeRef.current(drag.tractId, newPoly)
      }
    }
    const onMouseUp = () => {
      if (draggingRef.current && mapRef.current) {
        mapRef.current.getCanvas().style.cursor = ''
        mapRef.current.dragPan.enable()
      }
      draggingRef.current = null
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      map.remove(); mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData])

  // Re-render layers when polygons change (without remounting the map)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const labels: any[] = []
    for (let i = 0; i < tracts.length; i++) {
      const t = tracts[i]
      const color = TRACT_COLORS[i % TRACT_COLORS.length]
      const fullSrc = map.getSource(`full_${t.tract_id}`) as maplibregl.GeoJSONSource | undefined
      const tilSrc = map.getSource(`til_${t.tract_id}`) as maplibregl.GeoJSONSource | undefined
      const vertSrc = map.getSource(`vert_${t.tract_id}`) as maplibregl.GeoJSONSource | undefined
      if (fullSrc && t.current_polygon) fullSrc.setData(buildPolyGeo(t.current_polygon))
      if (vertSrc && t.current_polygon) vertSrc.setData(buildVertexGeo(t.current_polygon, t.tract_id))
      if (tilSrc) {
        tilSrc.setData(t.current_tillable_polygon
          ? buildPolyGeo(t.current_tillable_polygon)
          : { type: 'FeatureCollection', features: [] } as any)
      }
      // Re-compute label centroid from the CURRENT polygon so labels
      // move with the polygon when admin drags it.
      if (t.current_polygon && t.current_polygon.length >= 3) {
        const cx = t.current_polygon.reduce((s, p) => s + p[0], 0) / t.current_polygon.length
        const cy = t.current_polygon.reduce((s, p) => s + p[1], 0) / t.current_polygon.length
        labels.push({
          type: 'Feature',
          properties: { label: `T${t.tract_number ?? '?'}`, color },
          geometry: { type: 'Point', coordinates: [cx, cy] },
        })
      }
    }
    const labelsSrc = map.getSource('labels') as maplibregl.GeoJSONSource | undefined
    if (labelsSrc) {
      labelsSrc.setData({ type: 'FeatureCollection', features: labels } as any)
    }
  }, [tracts])

  return (
    <div className="relative">
      <div ref={containerRef} className="w-full h-[450px] rounded border border-gg-gray-700 overflow-hidden bg-black" />
      <div className="absolute bottom-1.5 left-1.5 text-[10px] text-white bg-black/60 px-2 py-1 rounded pointer-events-none">
        <strong>Drag</strong> any white circle to move a vertex · drag inside polygon to move it · scroll to zoom
        <br />
        <span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={{ background: '#ff3b3b' }} /> tract boundary
        {' · '}
        <span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={{ background: '#22c55e', opacity: 0.6 }} /> tillable (after Calculate)
      </div>
    </div>
  )
}

type Item = {
  tract_id: string
  tract_number: number | null
  total_acres: number | null
  land_type: string | null
  has_image: boolean
  listing_id: string
  title: string | null
  county: string | null
  state: string | null
  auction_datetime: string | null
  primary_image_url: string | null
  brochure_url: string | null
  source_url: string | null
  company_name: string | null
  boundary_status?: 'missing' | 'wrong' | 'ok'
  // Scraped values from the auction listing (ground truth for verification)
  scraped_tillable_acres?: number | null
  scraped_soil_rating?: number | null
  scraped_soil_rating_type?: string | null
}

type StateCount = { state: string; total: number; missing: number; wrong: number }
type CompanyCount = { company: string; total: number; missing: number; wrong: number }

function formatDate(iso: string | null) {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  } catch {
    return iso
  }
}

export default function MissingBoundariesPage() {
  const [items, setItems] = useState<Item[]>([])
  const [byState, setByState] = useState<StateCount[]>([])
  const [byCompany, setByCompany] = useState<CompanyCount[]>([])
  const [deletingListingId, setDeletingListingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Per-listing auto-extract state. Keyed by listing_id.
  const [autoExtractRunningId, setAutoExtractRunningId] = useState<string | null>(null)
  const [autoExtractResultByListing, setAutoExtractResultByListing] = useState<
    Record<string, {
      succeeded: any[]; failed: any[]; image_url?: string;
      image_url_reason?: string; map_type?: string;
      anchor_method?: string; error?: string;
      skipped?: boolean; skipped_reason?: string;
    }>
  >({})
  const [approvingTractId, setApprovingTractId] = useState<string | null>(null)
  const [approveAllRunningId, setApproveAllRunningId] = useState<string | null>(null)
  const [rejectingTractId, setRejectingTractId] = useState<string | null>(null)
  // Edit state per tract: current_polygon = whatever the admin has dragged
  // it to. current_tillable_polygon/acres/soil_rating = last result from
  // Calculate. The approve call ships these as overrides.
  const [editStateByTract, setEditStateByTract] = useState<Record<string, EditableTract>>({})
  const [calculatingTractId, setCalculatingTractId] = useState<string | null>(null)
  const [stateFilter, setStateFilter] = useState<string>('')
  const [companyFilter, setCompanyFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'missing' | 'wrong' | 'ok'>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [geocodeStatus, setGeocodeStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const qs = new URLSearchParams()
        if (stateFilter) qs.set('state', stateFilter)
        if (statusFilter !== 'all') qs.set('status', statusFilter)
        if (companyFilter) qs.set('company', companyFilter)
        const url = `${SCRAPER_URL}/api/admin/missing-boundary-tracts${qs.toString() ? '?' + qs.toString() : ''}`
        setLoading(true)
        const res = await fetch(url)
        const data = await res.json()
        if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`)
        if (!cancelled) {
          setItems(data.items || [])
          if (Array.isArray(data.by_state)) setByState(data.by_state)
          if (Array.isArray(data.by_company)) setByCompany(data.by_company)
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    // Fire-and-forget: ensure every listing on this screen has a
    // geocoded lat/lng so the boundary editor opens with the map
    // already centered on the correct township.
    setGeocodeStatus('Geocoding listings…')
    fetch(`${SCRAPER_URL}/api/admin/geocode-missing-listings`, { method: 'POST' })
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (body.success) {
          setGeocodeStatus(`Geocoded ${body.geocoded}/${body.processed} listings`)
        } else {
          setGeocodeStatus(`Geocode failed: ${body.error || 'unknown'}`)
        }
      })
      .catch(e => {
        if (!cancelled) setGeocodeStatus(`Geocode failed: ${e.message || e}`)
      })
    return () => { cancelled = true }
  }, [stateFilter, statusFilter, companyFilter])

  // Delete a listing (cascades to tracts via FK ON DELETE CASCADE).
  // Triple-checks before issuing the DELETE — accidental click is a
  // hard-to-undo destructive operation. The native window.confirm
  // requires explicit user assent and blocks the UI thread until
  // the user clicks Cancel or OK.
  const deleteListing = async (listingId: string, title: string | null,
                                company: string | null,
                                tractCount: number) => {
    const niceTitle = (title || '(untitled)').slice(0, 80)
    const msg = (
      `Delete this listing PERMANENTLY?\n\n` +
      `Title: ${niceTitle}\n` +
      `Company: ${company || '—'}\n` +
      `${tractCount} tract${tractCount === 1 ? '' : 's'} will also be deleted.\n\n` +
      `This cannot be undone.`
    )
    if (!window.confirm(msg)) return
    setDeletingListingId(listingId)
    setDeleteError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/listings/${listingId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const body = await res.json()
          detail = body.detail || body.message || detail
        } catch {}
        throw new Error(detail)
      }
      // Remove from local state immediately so the UI updates without
      // needing a full reload.
      setItems(prev => prev.filter(it => it.listing_id !== listingId))
    } catch (e: any) {
      setDeleteError(`Delete failed: ${e.message || e}`)
    } finally {
      setDeletingListingId(null)
    }
  }

  const runAutoExtract = async (listingId: string, force = false) => {
    setAutoExtractRunningId(listingId)
    setAutoExtractResultByListing(prev => {
      const next = { ...prev }; delete next[listingId]; return next
    })
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/listings/${listingId}/auto-extract`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) {
        setAutoExtractResultByListing(prev => ({
          ...prev,
          [listingId]: {
            succeeded: [], failed: [],
            error: body.error || `HTTP ${res.status}`,
            image_url: body.image_url,
          },
        }))
      } else if (body.skipped) {
        // Endpoint refused to re-run because tracts already have
        // proposed_* values waiting for review. Surface this clearly
        // and offer a Force button.
        setAutoExtractResultByListing(prev => ({
          ...prev,
          [listingId]: {
            succeeded: [], failed: [],
            skipped: true,
            skipped_reason: body.reason || 'already extracted',
          },
        }))
      } else {
        setAutoExtractResultByListing(prev => ({
          ...prev,
          [listingId]: {
            succeeded: body.succeeded || [],
            failed: body.failed || [],
            image_url: body.image_url,
            image_url_reason: body.image_url_reason,
            map_type: body.map_type,
            anchor_method: body.anchor_method,
          },
        }))
      }
    } catch (e: any) {
      setAutoExtractResultByListing(prev => ({
        ...prev,
        [listingId]: { succeeded: [], failed: [], error: e.message || String(e) },
      }))
    } finally {
      setAutoExtractRunningId(null)
    }
  }

  const approveTract = async (tractId: string, listingId: string) => {
    // Require admin to have clicked Calculate first — otherwise we'd
    // be saving stale tillable/rating values that don't match the
    // drag-corrected polygon.
    const edit = editStateByTract[tractId]
    if (edit && edit.current_polygon && edit.current_tillable_acres == null) {
      if (!window.confirm('Calculate has not been run since the last drag. Approve anyway with no tillable/soil rating?')) return
    }
    setApprovingTractId(tractId)
    try {
      const payload: any = {}
      if (edit?.current_polygon) payload.polygon = edit.current_polygon
      if (edit?.current_tillable_polygon) payload.tillable_polygon = edit.current_tillable_polygon
      if (edit?.current_tillable_acres != null) payload.tillable_acres = edit.current_tillable_acres
      if (edit?.current_soil_rating != null) payload.soil_rating = edit.current_soil_rating
      if (edit?.current_soil_rating_type) payload.soil_rating_type = edit.current_soil_rating_type

      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/approve-proposed`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      )
      const body = await res.json()
      if (res.ok && body.success) {
        setItems(prev => prev.filter(it => it.tract_id !== tractId))
      } else {
        alert(`Approve failed: ${body.error || `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      alert(`Approve error: ${e.message || e}`)
    } finally {
      setApprovingTractId(null)
    }
  }

  // Initialize edit state when Auto-Extract returns results for a listing.
  // Each tract's current_polygon starts as the auto-extracted polygon;
  // current_tillable_polygon starts as the auto-extracted tillable.
  // Admin drags + clicks Calculate to update these.
  useEffect(() => {
    const updates: Record<string, EditableTract> = {}
    for (const lid of Object.keys(autoExtractResultByListing)) {
      const result = autoExtractResultByListing[lid]
      for (const t of result.succeeded || []) {
        if (!editStateByTract[t.tract_id]) {
          // Simplify the auto-extracted polygon so admin sees ~5-15
          // vertex handles instead of 80+ near-collinear ones. Real
          // corners (e.g. field bends >30°) are preserved.
          const simplified = t.polygon_coordinates
            ? simplifyPolygon(t.polygon_coordinates)
            : undefined
          updates[t.tract_id] = {
            ...t,
            current_polygon: simplified,
            current_tillable_polygon: t.tillable_polygon ?? null,
            current_tillable_acres: t.tillable_acres ?? null,
            current_soil_rating: t.soil_rating ?? null,
            current_soil_rating_type: t.soil_rating_type ?? null,
            current_polygon_acres: t.acres ?? null,
          }
        }
      }
    }
    if (Object.keys(updates).length > 0) {
      setEditStateByTract(prev => ({ ...prev, ...updates }))
    }
  }, [autoExtractResultByListing, editStateByTract])

  const onTractPolygonChange = (tractId: string, newPolygon: number[][]) => {
    setEditStateByTract(prev => {
      const existing = prev[tractId]
      if (!existing) return prev
      return {
        ...prev,
        [tractId]: {
          ...existing,
          current_polygon: newPolygon,
          // Drag invalidates the calculated values until admin clicks Calculate again
          current_tillable_polygon: null,
          current_tillable_acres: null,
          current_soil_rating: null,
          current_polygon_acres: null,
        },
      }
    })
  }

  const calculateTract = async (tractId: string) => {
    const edit = editStateByTract[tractId]
    if (!edit?.current_polygon) return
    setCalculatingTractId(tractId)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/recalculate-from-polygon`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon: edit.current_polygon }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) {
        alert(`Calculate failed: ${body.error || `HTTP ${res.status}`}`)
        return
      }
      setEditStateByTract(prev => ({
        ...prev,
        [tractId]: {
          ...prev[tractId],
          current_polygon_acres: body.polygon_acres ?? null,
          current_tillable_polygon: body.tillable_polygon ?? null,
          current_tillable_acres: body.tillable_acres ?? null,
          current_soil_rating: body.soil_rating ?? null,
          current_soil_rating_type: body.soil_rating_type ?? null,
        },
      }))
    } catch (e: any) {
      alert(`Calculate error: ${e.message || e}`)
    } finally {
      setCalculatingTractId(null)
    }
  }

  const rejectProposed = async (tractId: string, listingId: string) => {
    if (!window.confirm('Reject this proposed boundary? It will be discarded. Live data is NOT changed; tract stays on the list so you can re-extract / upload / draw.')) return
    setRejectingTractId(tractId)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/reject-proposed`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      )
      const body = await res.json()
      if (res.ok && body.success) {
        // Remove this tract from the local extracted-results list
        setAutoExtractResultByListing(prev => {
          const cur = prev[listingId]
          if (!cur) return prev
          return {
            ...prev,
            [listingId]: {
              ...cur,
              succeeded: cur.succeeded.filter((t: any) => t.tract_id !== tractId),
            },
          }
        })
      } else {
        alert(`Reject failed: ${body.error || `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      alert(`Reject error: ${e.message || e}`)
    } finally {
      setRejectingTractId(null)
    }
  }

  const approveAllTracts = async (listingId: string) => {
    setApproveAllRunningId(listingId)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/listings/${listingId}/approve-all-proposed`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
      )
      const body = await res.json()
      if (res.ok && body.success) {
        const approvedIds = new Set((body.approved || []).map((x: any) => x.tract_id))
        setItems(prev => prev.filter(it => !approvedIds.has(it.tract_id)))
        if (body.errors && body.errors.length > 0) {
          alert(`Approved ${body.n_approved}; ${body.errors.length} failed (check those tracts).`)
        }
      } else {
        alert(`Approve-all failed: ${body.error || `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      alert(`Approve-all error: ${e.message || e}`)
    } finally {
      setApproveAllRunningId(null)
    }
  }

  // Group by listing_id so multiple tracts on the same auction show together
  const grouped: Record<string, Item[]> = {}
  for (const it of items) {
    if (!grouped[it.listing_id]) grouped[it.listing_id] = []
    grouped[it.listing_id].push(it)
  }
  const listingIds = Object.keys(grouped).sort((a, b) => {
    const da = grouped[a][0].auction_datetime || ''
    const db = grouped[b][0].auction_datetime || ''
    return da.localeCompare(db)
  })

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white pt-24 pb-12 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Missing Boundaries</h1>
            <p className="text-sm text-gg-gray-400 mt-1">
              Lists every tract on any listing that has at least one missing
              or wrong boundary. Tracts that pass validation get a green
              <span className="text-emerald-300"> Correct</span> badge —
              spot-check those too, since if one tract on a listing is wrong
              the others often are.
            </p>
          </div>
          <div className="text-sm text-gg-gray-400 text-right">
            <div>{loading ? '…' : `${items.length} tract${items.length === 1 ? '' : 's'} across ${listingIds.length} listing${listingIds.length === 1 ? '' : 's'}`}</div>
            {geocodeStatus && (
              <div className="text-xs text-gg-gray-500 mt-1">{geocodeStatus}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <label className="text-xs text-gg-gray-400 uppercase tracking-wide">State:</label>
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-gg-pink"
          >
            <option value="">All states ({byState.reduce((s, x) => s + x.total, 0)})</option>
            {byState.map((s) => (
              <option key={s.state} value={s.state}>
                {s.state} ({s.total} — {s.missing} missing, {s.wrong} wrong)
              </option>
            ))}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Company:</label>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="bg-gg-gray-900 border border-gg-gray-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-gg-pink max-w-xs"
          >
            <option value="">
              All companies ({byCompany.reduce((s, x) => s + x.total, 0)})
            </option>
            {byCompany.map((c) => (
              <option key={c.company} value={c.company}>
                {c.company} ({c.total})
              </option>
            ))}
          </select>

          <label className="text-xs text-gg-gray-400 uppercase tracking-wide ml-2">Type:</label>
          <div className="inline-flex rounded overflow-hidden border border-gg-gray-700">
            {(['all', 'missing', 'wrong', 'ok'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setStatusFilter(opt)}
                className={`px-3 py-1 text-xs ${statusFilter === opt ? 'bg-gg-pink/30 text-gg-pink' : 'bg-gg-gray-900 text-gg-gray-300 hover:bg-gg-gray-800'}`}
              >
                {opt === 'all' ? 'All' : opt === 'missing' ? 'Missing' : opt === 'wrong' ? 'Wrong' : 'Correct'}
              </button>
            ))}
          </div>

          {companyFilter && (
            <button
              onClick={() => setCompanyFilter('')}
              className="text-xs text-gg-pink underline hover:no-underline"
            >
              Clear company filter
            </button>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-gg-gray-400">
            <Loader2 className="animate-spin" size={18} /> Loading…
          </div>
        )}
        {error && (
          <div className="bg-red-900/40 border border-red-600 rounded p-3 text-red-300">
            {error}
          </div>
        )}
        {deleteError && (
          <div className="bg-red-900/40 border border-red-600 rounded p-3 text-red-300 mb-3 flex items-center justify-between gap-3">
            <span>{deleteError}</span>
            <button
              onClick={() => setDeleteError(null)}
              className="text-xs px-2 py-1 text-red-200 hover:text-white"
            >
              Dismiss
            </button>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-6 text-gg-gray-400">
            🎉 Every upcoming auction tract already has a boundary. Nothing to draw.
          </div>
        )}

        <div className="space-y-4">
          {listingIds.map((lid) => {
            const tracts = grouped[lid]
            const head = tracts[0]
            return (
              <div key={lid} className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-gg-gray-800 flex items-start gap-4">
                  {head.primary_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={head.primary_image_url}
                      alt=""
                      className="w-20 h-20 object-cover rounded border border-gg-gray-700 flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-white truncate">{head.title || '(untitled)'}</h2>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1 text-xs text-gg-gray-400">
                      {head.company_name && <span>{head.company_name}</span>}
                      <span className="flex items-center gap-1"><MapPin size={11} />{head.county}, {head.state}</span>
                      <span>Auction: {formatDate(head.auction_datetime)}</span>
                      {head.source_url && (
                        <a
                          href={head.source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gg-pink hover:underline flex items-center gap-1"
                        >
                          Source <ExternalLink size={10} />
                        </a>
                      )}
                      {head.brochure_url && (
                        <a
                          href={head.brochure_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gg-pink hover:underline flex items-center gap-1"
                        >
                          Brochure <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteListing(lid, head.title, head.company_name, tracts.length)}
                    disabled={deletingListingId === lid}
                    className="text-xs px-3 py-1.5 rounded bg-red-500/15 hover:bg-red-500/25 disabled:opacity-50 text-red-300 border border-red-500/40 transition-colors flex items-center gap-1.5 flex-shrink-0 self-start"
                    title="Delete this listing and all its tracts. Confirmation required."
                  >
                    {deletingListingId === lid ? (
                      <>
                        <Loader2 size={12} className="animate-spin" /> Deleting…
                      </>
                    ) : (
                      <>
                        <Trash2 size={12} /> Delete Listing
                      </>
                    )}
                  </button>
                </div>

                {/* Auto-extract: the software finds the Surety overview
                    image, runs the multi-tract pipeline, derives tillable
                    via CDL, and computes soil rating — all in one click.
                    Admin reviews the results and approves per-tract (or
                    Approve All for the whole listing). */}
                <div className="px-4 py-3 border-b border-gg-gray-800 bg-gg-gray-950/40">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] uppercase tracking-wide text-gg-gray-400 mb-1.5">
                        Auto-Extract Boundaries
                      </div>
                      <div className="text-[11px] text-gg-gray-400 mb-2">
                        Software fetches the listing source, finds the Surety overview map,
                        extracts polygons + tillable + soil rating for all tracts. You review and approve.
                      </div>
                      <div className="flex gap-2 flex-wrap">
                        <button
                          onClick={() => runAutoExtract(lid)}
                          disabled={autoExtractRunningId === lid}
                          className="px-3 py-1.5 text-xs rounded bg-gg-pink/30 hover:bg-gg-pink/50 disabled:opacity-50 text-gg-pink border border-gg-pink/40"
                        >
                          {autoExtractRunningId === lid ? 'Extracting…' : 'Auto-Extract'}
                        </button>
                        {autoExtractResultByListing[lid]?.skipped && (
                          <button
                            onClick={() => runAutoExtract(lid, true)}
                            disabled={autoExtractRunningId === lid}
                            className="px-3 py-1.5 text-xs rounded bg-amber-500/25 hover:bg-amber-500/40 disabled:opacity-50 text-amber-200 border border-amber-500/40"
                          >
                            {autoExtractRunningId === lid ? 'Re-extracting…' : '↻ Force Re-Extract'}
                          </button>
                        )}
                        {autoExtractResultByListing[lid]?.succeeded?.length > 0 && (
                          <button
                            onClick={() => approveAllTracts(lid)}
                            disabled={approveAllRunningId === lid}
                            className="px-3 py-1.5 text-xs rounded bg-emerald-500/25 hover:bg-emerald-500/40 disabled:opacity-50 text-emerald-200 border border-emerald-500/40"
                          >
                            {approveAllRunningId === lid ? 'Approving All…' : `✓ Approve All (${autoExtractResultByListing[lid].succeeded.length})`}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {autoExtractResultByListing[lid] && (
                    <div className="mt-3 text-xs">
                      {autoExtractResultByListing[lid].error && (
                        <div className="bg-red-900/30 border border-red-700 rounded p-2 text-red-300">
                          ✗ {autoExtractResultByListing[lid].error}
                          {autoExtractResultByListing[lid].image_url && (
                            <div className="mt-1 text-[10px] text-gg-gray-400">
                              Tried image: <a href={autoExtractResultByListing[lid].image_url} target="_blank" rel="noreferrer" className="text-gg-pink hover:underline">{autoExtractResultByListing[lid].image_url}</a>
                            </div>
                          )}
                        </div>
                      )}
                      {autoExtractResultByListing[lid].skipped && (
                        <div className="bg-amber-900/30 border border-amber-700 rounded p-2 text-amber-200">
                          ⚠ Already extracted previously. Click <strong>Force Re-Extract</strong> to run again, or open each tract via the "Review on map" link to approve.
                          <div className="text-[10px] text-gg-gray-400 mt-1">
                            {autoExtractResultByListing[lid].skipped_reason}
                          </div>
                        </div>
                      )}
                      {autoExtractResultByListing[lid].succeeded?.length > 0 && (
                        <div>
                          <div className="text-emerald-300 mb-1.5">
                            ✓ Extracted {autoExtractResultByListing[lid].succeeded.length} tract{autoExtractResultByListing[lid].succeeded.length === 1 ? '' : 's'} via {autoExtractResultByListing[lid].anchor_method} anchor
                            {autoExtractResultByListing[lid].image_url && (
                              <>
                                {' '}from{' '}
                                <a href={autoExtractResultByListing[lid].image_url} target="_blank" rel="noreferrer" className="underline hover:no-underline">overview map</a>
                              </>
                            )}
                          </div>

                          {/* Editable inline map — drag vertices or
                              the polygon body to align. The map source
                              comes from editStateByTract (admin-mutable),
                              not the auto-extract result (immutable). */}
                          <div className="mb-2">
                            <EditableExtractMap
                              tracts={(autoExtractResultByListing[lid].succeeded as any[])
                                .map(t => editStateByTract[t.tract_id])
                                .filter(Boolean) as EditableTract[]}
                              onPolygonChange={onTractPolygonChange}
                            />
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-1.5">
                            {autoExtractResultByListing[lid].succeeded.map((t: any) => {
                              const e = editStateByTract[t.tract_id]
                              const needsCalc = e && e.current_tillable_acres == null
                              // Find the scraped listing values for this tract
                              const listingTract = tracts.find(it => it.tract_id === t.tract_id)
                              return (
                                <div key={t.tract_id} className="bg-gg-gray-900 border border-gg-gray-800 rounded px-2 py-1.5">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">Tract {t.tract_number ?? '?'}</span>
                                    <span className="text-[10px] text-gg-gray-400">{t.identification_method}</span>
                                  </div>
                                  <div className="text-gg-gray-300 text-[11px] mt-0.5">
                                    <span className="text-gg-gray-500">Calc:</span>{' '}
                                    Polygon: <span className={needsCalc ? 'text-amber-300' : ''}>{(e?.current_polygon_acres ?? t.acres)?.toFixed?.(2) ?? '—'} ac</span>
                                    {' · '}
                                    Tillable: <span className={needsCalc ? 'text-amber-300' : ''}>{e?.current_tillable_acres ?? '—'} ac</span>
                                    {' · '}
                                    {e?.current_soil_rating_type || t.soil_rating_type || '—'}: <span className={needsCalc ? 'text-amber-300' : ''}>{e?.current_soil_rating ?? '—'}</span>
                                  </div>
                                  {listingTract && (listingTract.total_acres != null || listingTract.scraped_tillable_acres != null || listingTract.scraped_soil_rating != null) && (
                                    <div className="text-[11px] mt-0.5">
                                      <span className="text-gg-gray-500">Scraped:</span>{' '}
                                      <span className="text-gg-gray-400">
                                        Polygon: {listingTract.total_acres != null ? `${listingTract.total_acres} ac` : '—'}
                                        {' · '}
                                        Tillable: {listingTract.scraped_tillable_acres != null ? `${listingTract.scraped_tillable_acres} ac` : '—'}
                                        {' · '}
                                        {listingTract.scraped_soil_rating_type || '—'}: {listingTract.scraped_soil_rating != null ? listingTract.scraped_soil_rating : '—'}
                                      </span>
                                    </div>
                                  )}
                                  {needsCalc && (
                                    <div className="text-[10px] text-amber-300 mt-0.5">
                                      ⚠ Drag detected — click Calculate to refresh tillable + rating
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <button
                                      onClick={() => calculateTract(t.tract_id)}
                                      disabled={calculatingTractId === t.tract_id}
                                      className="text-[11px] px-2 py-0.5 rounded bg-blue-500/25 hover:bg-blue-500/40 disabled:opacity-50 text-blue-200 border border-blue-500/40"
                                      title="Compute tillable polygon, tillable acres, and soil rating from the current dragged polygon."
                                    >
                                      {calculatingTractId === t.tract_id ? 'Calculating…' : '↻ Calculate'}
                                    </button>
                                    <button
                                      onClick={() => approveTract(t.tract_id, lid)}
                                      disabled={approvingTractId === t.tract_id || rejectingTractId === t.tract_id || calculatingTractId === t.tract_id}
                                      className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/25 hover:bg-emerald-500/40 disabled:opacity-50 text-emerald-200 border border-emerald-500/40"
                                    >
                                      {approvingTractId === t.tract_id ? 'Approving…' : '✓ Approve'}
                                    </button>
                                    <button
                                      onClick={() => rejectProposed(t.tract_id, lid)}
                                      disabled={approvingTractId === t.tract_id || rejectingTractId === t.tract_id}
                                      className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/35 disabled:opacity-50 text-red-300 border border-red-500/40"
                                      title="Discard this proposed boundary. Tract stays on the list."
                                    >
                                      {rejectingTractId === t.tract_id ? 'Rejecting…' : '✗ Reject'}
                                    </button>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {autoExtractResultByListing[lid].failed?.length > 0 && (
                        <div className="mt-2 bg-amber-900/30 border border-amber-700 rounded p-2 text-amber-200">
                          ⚠ {autoExtractResultByListing[lid].failed.length} tract{autoExtractResultByListing[lid].failed.length === 1 ? '' : 's'} could not be matched. Use Upload Image / Draw Boundary for those.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="divide-y divide-gg-gray-800">
                  {tracts.map((t) => (
                    <div key={t.tract_id} className="px-4 py-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Tract thumbnail — current image_base64 if any.
                            Image endpoint returns 404 when not yet stored,
                            in which case onError swaps in a placeholder. */}
                        {t.has_image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={`${SCRAPER_URL}/api/admin/tracts/${t.tract_id}/image`}
                            alt={`Tract ${t.tract_number ?? '?'}`}
                            className="w-16 h-16 object-cover rounded border border-gg-gray-700 flex-shrink-0"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                          />
                        ) : (
                          <div
                            className="w-16 h-16 rounded border border-gg-gray-800 bg-gg-gray-900 flex-shrink-0 flex items-center justify-center text-gg-gray-600 text-[10px]"
                            title="No tract image stored yet"
                          >
                            no image
                          </div>
                        )}
                        <span className="text-white font-medium">Tract {t.tract_number ?? '?'}</span>
                        <span className="text-sm text-gg-gray-300">
                          {t.total_acres != null ? `${t.total_acres} ac` : 'acres unknown'}
                        </span>
                        {t.boundary_status === 'wrong' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40"
                            title="Polygon area differs from scraped acres by > 1 ac — boundary is likely wrong"
                          >
                            Wrong
                          </span>
                        )}
                        {t.boundary_status === 'missing' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40"
                            title="No boundary on file"
                          >
                            Missing
                          </span>
                        )}
                        {t.boundary_status === 'ok' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            title="Boundary passes auto-validation. Spot-check anyway — if other tracts on this listing are wrong, this one might be too."
                          >
                            Correct
                          </span>
                        )}
                        {t.land_type && (
                          <span className="text-xs text-gg-pink">{t.land_type}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/upload-boundary-tract/${t.tract_id}`}
                          className="px-3 py-1.5 text-xs rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 transition-colors flex items-center gap-1"
                          title="Paste an auction-website screenshot and let Claude Vision extract the boundary"
                        >
                          📷 Upload Image
                        </Link>
                        <Link
                          href={`/admin/boundary-draw-tract/${t.tract_id}`}
                          className="px-3 py-1.5 text-xs rounded bg-gg-pink/20 hover:bg-gg-pink/30 text-gg-pink border border-gg-pink/40 transition-colors flex items-center gap-1"
                        >
                          ✏️ Draw Boundary
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
