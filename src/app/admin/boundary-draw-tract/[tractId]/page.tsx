'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ArrowLeft, Save, RotateCcw, Trash2, Loader2, ExternalLink } from 'lucide-react'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'

type Pt = [number, number]

function buildDrawGeo(points: Pt[]) {
  if (points.length === 0) return { type: 'FeatureCollection', features: [] } as any
  if (points.length < 3) {
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: points },
      }],
    } as any
  }
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: {},
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

export default function BoundaryDrawTractPage() {
  const params = useParams()
  const router = useRouter()
  const tractId = String(params.tractId)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [points, setPoints] = useState<Pt[]>([])
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(`${SCRAPER_URL}/api/admin/tracts/${tractId}/details`)
        const body = await res.json()
        if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`)
        if (!cancelled) setData(body.tract)
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [tractId])

  useEffect(() => {
    if (!containerRef.current || !data) return
    const initLng = Number(data.longitude) || -93.5
    const initLat = Number(data.latitude) || 41.9

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
      zoom: data.latitude ? 16 : 6,
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

    map.on('click', (ev) => {
      const { lng, lat } = ev.lngLat
      setPoints(prev => [...prev, [lng, lat]])
    })

    return () => { map.remove() }
  }, [data])

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
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/save-boundary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon: points }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'save failed')
      setSaveResult(
        `✓ Saved! GIS acres: ${body.gis_acres}` +
        (body.nccpi != null ? ` · NCCPI: ${body.nccpi}` : '') +
        (body.tillable_acres != null ? ` · Tillable: ${body.tillable_acres}` : '') +
        (body.land_type ? ` · Land type: ${body.land_type}` : '') +
        '. Returning to list…'
      )
      setTimeout(() => router.push('/admin/missing-boundaries'), 2000)
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
  if (error || !data) return (
    <div className="min-h-screen bg-gg-gray-950 text-white p-8">
      <p className="text-red-400">{error || 'Tract not found'}</p>
      <button onClick={() => router.back()} className="mt-4 text-gg-gold underline">Back</button>
    </div>
  )

  const computedAcres = gisAcres(points)

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white">
      <div className="border-b border-gg-gray-800 px-4 py-3 flex items-center justify-between bg-gg-gray-900">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/admin/missing-boundaries')} className="p-2 hover:bg-gg-gray-800 rounded">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-semibold">
              Draw Boundary — {data.title || 'Listing'} / Tract {data.tract_number ?? '?'}
            </h1>
            <p className="text-xs text-gg-gray-400">
              {data.county || '?'} County, {data.state || '?'}
              {' · '}
              Claimed acres: {data.total_acres ?? '?'}
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

      <div className="flex" style={{ height: 'calc(100vh - 65px)' }}>
        <div className="w-1/3 overflow-y-auto bg-gg-gray-900 border-r border-gg-gray-800 p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Source Listing</h2>
            {data.source_url && (
              <a href={data.source_url} target="_blank" rel="noreferrer"
                 className="text-gg-gold text-sm flex items-center gap-1 hover:underline break-all">
                {data.source_url.slice(0, 80)} <ExternalLink size={12} />
              </a>
            )}
            {data.company_name && (
              <p className="text-xs text-gg-gray-400 mt-1">{data.company_name}</p>
            )}
          </div>
          {data.primary_image_base64 && (
            <div>
              <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Listing Image</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`data:image/png;base64,${data.primary_image_base64}`} alt="primary" className="w-full rounded border border-gg-gray-700" />
            </div>
          )}
          {!data.primary_image_base64 && data.primary_image_url && (
            <div>
              <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Listing Image</h2>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={data.primary_image_url} alt="primary" className="w-full rounded border border-gg-gray-700" />
            </div>
          )}
          {data.brochure_url && (
            <div>
              <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Brochure</h2>
              <a href={data.brochure_url} target="_blank" rel="noreferrer"
                 className="text-gg-gold text-sm flex items-center gap-1 hover:underline">
                Open brochure <ExternalLink size={12} />
              </a>
            </div>
          )}
          {data.description && (
            <div>
              <h2 className="text-sm font-semibold mb-2 text-gg-gray-300">Description</h2>
              <p className="text-xs text-gg-gray-400 whitespace-pre-wrap">{data.description.slice(0, 1000)}</p>
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
