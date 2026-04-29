'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ArrowLeft, Save, RotateCcw, Trash2, Loader2, ExternalLink } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'

type Pt = [number, number]   // [lng, lat]

// Build the GeoJSON for an in-progress polygon. Open polyline while
// drawing, closed polygon once we have ≥3 points.
function buildDrawGeo(points: Pt[]) {
  if (points.length === 0) {
    return { type: 'FeatureCollection', features: [] } as any
  }
  if (points.length < 3) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: points },
      }],
    } as any
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [[...points, points[0]]],
      },
    }],
  } as any
}

function buildVertexGeo(points: Pt[]) {
  return {
    type: 'FeatureCollection',
    features: points.map((p, i) => ({
      type: 'Feature',
      properties: { idx: i },
      geometry: { type: 'Point', coordinates: p },
    })),
  } as any
}

// Cosine-corrected acres approximation (lat/lng -> acres). Same math
// the scraper backend uses for boundary validation.
function gisAcres(points: Pt[]): number {
  if (points.length < 3) return 0
  let area = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const [x1, y1] = points[i]
    const [x2, y2] = points[(i + 1) % n]
    area += x1 * y2 - x2 * y1
  }
  area = Math.abs(area) / 2
  const centerLat = points.reduce((s, p) => s + p[1], 0) / n
  const latMiles = 69.0
  const lngMiles = 69.0 * Math.cos(centerLat * Math.PI / 180)
  return area * latMiles * lngMiles * 640
}

export default function BoundaryDrawPage() {
  const params = useParams()
  const search = useSearchParams()
  const router = useRouter()
  const stagingId = Number(params.stagingId)
  const tractIndex = Number(search.get('tract') || 0)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [staging, setStaging] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [points, setPoints] = useState<Pt[]>([])
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)

  // Load staging item
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/admin/staging?source_type=&status=&limit=1&staging_id=${stagingId}`)
        // Fall back: the list endpoint doesn't accept staging_id; load via direct row fetch
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        const item = (data.items || []).find((x: any) => x.id === stagingId)
        if (!item) {
          // Use the screenshot endpoint to confirm it exists at minimum
          const sres = await fetchWithAuth(`${API_URL}/api/admin/staging/${stagingId}/screenshot`)
          if (!sres.ok) throw new Error('staging item not found')
          // We need scraped_data — make a direct staging row fetch
          // (the list filtered by source_type may have excluded it)
          const directRes = await fetchWithAuth(`${API_URL}/api/admin/staging?status=pending&limit=200&offset=0`)
          if (!directRes.ok) throw new Error(`HTTP ${directRes.status}`)
          const direct = await directRes.json()
          const found = (direct.items || []).find((x: any) => x.id === stagingId)
          if (!found) throw new Error(`staging ${stagingId} not in pending list`)
          if (!cancelled) setStaging(found)
        } else if (!cancelled) {
          setStaging(item)
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [stagingId])

  // Init map
  useEffect(() => {
    if (!containerRef.current || !staging) return
    const sd = staging.scraped_data || {}
    const tract = (sd.tracts || [])[tractIndex] || {}
    // Best initial center: tract lat/lng if known, else listing lat/lng,
    // else Iowa center.
    const initLng = Number(tract.longitude) || Number(sd.listing?.longitude) || -93.5
    const initLat = Number(tract.latitude) || Number(sd.listing?.latitude) || 41.9

    const map = new maplibregl.Map({
      container: containerRef.current,
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
      center: [initLng, initLat],
      zoom: tract.latitude ? 16 : 14,
    })
    mapRef.current = map

    map.on('load', () => {
      map.addSource('drawn', { type: 'geojson', data: buildDrawGeo([]) })
      map.addSource('verts', { type: 'geojson', data: buildVertexGeo([]) })
      map.addLayer({
        id: 'drawn-fill', type: 'fill', source: 'drawn',
        paint: { 'fill-color': '#FFD700', 'fill-opacity': 0.25 },
        filter: ['==', '$type', 'Polygon'],
      })
      map.addLayer({
        id: 'drawn-line', type: 'line', source: 'drawn',
        paint: { 'line-color': '#FFD700', 'line-width': 3 },
      })
      map.addLayer({
        id: 'verts', type: 'circle', source: 'verts',
        paint: {
          'circle-radius': 7,
          'circle-color': '#FFD700',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#000',
        },
      })
    })

    // Click to add a vertex
    map.on('click', (ev) => {
      const { lng, lat } = ev.lngLat
      setPoints(prev => [...prev, [lng, lat]])
    })

    return () => { map.remove() }
  }, [staging, tractIndex])

  // Update map data on points change
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return
    const drawSrc = map.getSource('drawn') as maplibregl.GeoJSONSource | undefined
    const vertSrc = map.getSource('verts') as maplibregl.GeoJSONSource | undefined
    if (drawSrc) drawSrc.setData(buildDrawGeo(points))
    if (vertSrc) vertSrc.setData(buildVertexGeo(points))
  }, [points])

  const undoLast = () => setPoints(prev => prev.slice(0, -1))
  const clearAll = () => setPoints([])

  const save = async () => {
    if (points.length < 3) {
      setSaveResult('Need at least 3 points to define a boundary')
      return
    }
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/staging/${stagingId}/tracts/${tractIndex}/save-boundary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon: points }),
        }
      )
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'save failed')
      setSaveResult(`✓ Saved! GIS acres: ${data.gis_acres}. Re-enrichment ran. Returning to staging...`)
      setTimeout(() => {
        // Pick the right return URL based on which staging type this came from
        const sourceType = staging?.source_type || ''
        const isPT = (staging?.scraped_data?.listing?.listing_type || '').toLowerCase().includes('private')
            || sourceType.startsWith('iowa') || sourceType === 'mydec'
            || sourceType === 'indiana_sdf' || sourceType === 'nebraska_gworks'
        router.push(isPT ? '/admin/private-treaty-staging' : '/admin/staging')
      }, 1500)
    } catch (e: any) {
      setSaveResult(`✗ Save failed: ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gg-gray-950 text-white flex items-center justify-center">
      <Loader2 className="animate-spin" size={28} />
    </div>
  )

  if (error || !staging) return (
    <div className="min-h-screen bg-gg-gray-950 text-white p-8">
      <p className="text-red-400">{error || 'Staging item not found'}</p>
      <button onClick={() => router.back()} className="mt-4 text-gg-gold underline">Back</button>
    </div>
  )

  const sd = staging.scraped_data || {}
  const tract = (sd.tracts || [])[tractIndex] || {}
  const screenshot = staging.screenshot_base64
  const mapImage = staging.map_image_base64 || sd.map_image_base64
  const primaryImage = sd.listing?.primary_image_url
  const brochureUrl = sd.listing?.brochure_url
  const sourceUrl = staging.source_url
  const computedAcres = gisAcres(points)

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white">
      {/* Header bar */}
      <div className="border-b border-gg-gray-800 px-4 py-3 flex items-center justify-between bg-gg-gray-900">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 hover:bg-gg-gray-800 rounded">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-semibold">Draw Boundary — Staging #{stagingId} / Tract {tractIndex + 1}</h1>
            <p className="text-xs text-gg-gray-400">
              {tract.county_name || sd.listing?.county || '?'} County, {tract.state_abbr || sd.listing?.state || '?'}
              {' · '}
              Claimed acres: {tract.acres ?? '?'}
              {' · '}
              Drawn acres: {points.length >= 3 ? computedAcres.toFixed(2) : '—'}
              {' · '}
              {points.length} points
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={undoLast} disabled={points.length === 0} className="px-3 py-2 bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-40 rounded flex items-center gap-1">
            <RotateCcw size={16} /> Undo
          </button>
          <button onClick={clearAll} disabled={points.length === 0} className="px-3 py-2 bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-40 rounded flex items-center gap-1">
            <Trash2 size={16} /> Clear
          </button>
          <button onClick={save} disabled={saving || points.length < 3} className="px-4 py-2 bg-gg-gold hover:bg-yellow-500 text-black font-semibold disabled:opacity-40 rounded flex items-center gap-1">
            {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save & Re-enrich'}
          </button>
        </div>
      </div>
      {saveResult && (
        <div className={`px-4 py-2 ${saveResult.startsWith('✓') ? 'bg-green-900' : 'bg-red-900'}`}>
          {saveResult}
        </div>
      )}

      {/* Body: left = source images, right = map */}
      <div className="flex" style={{ height: 'calc(100vh - 65px)' }}>
        <div className="w-1/3 overflow-y-auto bg-gg-gray-900 border-r border-gg-gray-800 p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Source Listing</h2>
            <a href={sourceUrl} target="_blank" rel="noreferrer"
               className="text-gg-gold text-sm flex items-center gap-1 hover:underline">
              {sourceUrl?.slice(0, 80)} <ExternalLink size={12} />
            </a>
          </div>
          {mapImage && (
            <div>
              <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Auctioneer Tract Diagram</h2>
              <img src={`data:image/png;base64,${mapImage}`} alt="map" className="w-full rounded border border-gg-gray-700" />
            </div>
          )}
          {primaryImage && (
            <div>
              <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Listing Image</h2>
              <img src={primaryImage} alt="primary" className="w-full rounded border border-gg-gray-700" />
            </div>
          )}
          {brochureUrl && (
            <div>
              <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Brochure</h2>
              <a href={brochureUrl} target="_blank" rel="noreferrer"
                 className="text-gg-gold text-sm flex items-center gap-1 hover:underline">
                Open brochure <ExternalLink size={12} />
              </a>
            </div>
          )}
          {screenshot && (
            <div>
              <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Page Screenshot</h2>
              <img src={`data:image/png;base64,${screenshot}`} alt="screenshot" className="w-full rounded border border-gg-gray-700" />
            </div>
          )}
        </div>
        <div className="flex-1 relative">
          <div ref={containerRef} className="absolute inset-0" />
          <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-3 py-2 rounded space-y-1">
            <div>Click on the map to add boundary points</div>
            <div>≥ 3 points = closed polygon</div>
            <div>Use Undo / Clear if you mis-click</div>
            <div>Save when the polygon matches the source diagram</div>
          </div>
        </div>
      </div>
    </div>
  )
}
