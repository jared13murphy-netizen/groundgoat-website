'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ArrowLeft, Save, RotateCcw, Trash2, Loader2, ExternalLink, X } from 'lucide-react'

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
  const [sourceScreenshot, setSourceScreenshot] = useState<string | null>(null)
  const [sourceImages, setSourceImages] = useState<{url: string; alt: string; w: number; h: number}[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null)

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

  // Once we have the listing's source URL, render it with Playwright
  // and pull back a full-page screenshot + every rendered image so the
  // operator can see the actual boundary diagram.
  useEffect(() => {
    if (!data?.source_url) return
    let cancelled = false
    setImagesLoading(true)
    fetch(`${SCRAPER_URL}/api/admin/scrape-source-images?url=${encodeURIComponent(data.source_url)}`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (body.screenshot_base64) setSourceScreenshot(body.screenshot_base64)
        if (Array.isArray(body.images)) setSourceImages(body.images)
      })
      .catch(() => {/* ignore */})
      .finally(() => { if (!cancelled) setImagesLoading(false) })
    return () => { cancelled = true }
  }, [data?.source_url])

  useEffect(() => {
    if (!containerRef.current || !data) return
    // Best center: tract lat/lng > listing lat/lng > Iowa fallback.
    // Zoom: 16 for a tract-level coord, 13 for listing-level (county/town).
    let initLng: number, initLat: number, initZoom: number
    if (data.latitude != null && data.longitude != null) {
      initLng = Number(data.longitude); initLat = Number(data.latitude)
      initZoom = 16
    } else if (data.listing_latitude != null && data.listing_longitude != null) {
      initLng = Number(data.listing_longitude); initLat = Number(data.listing_latitude)
      initZoom = 13
    } else {
      initLng = -93.5; initLat = 41.9; initZoom = 6
    }

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
      zoom: initZoom,
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

    // Force re-measure after the page paints — the map sometimes
    // initializes before flex children resolve their final size.
    const t1 = setTimeout(() => map.resize(), 50)
    const t2 = setTimeout(() => map.resize(), 250)
    const t3 = setTimeout(() => map.resize(), 1000)

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      map.remove()
    }
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
    <div className="fixed inset-0 z-[100] bg-gg-gray-950 text-white flex flex-col">
      <div className="border-b border-gg-gray-800 px-4 py-3 flex items-center justify-between bg-gg-gray-900 flex-shrink-0 gap-4">
        {/* Left: back arrow + title block (truncated so it can't push
            the action buttons off-screen on long descriptions) */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button onClick={() => router.push('/admin/missing-boundaries')} className="p-2 hover:bg-gg-gray-800 rounded flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="font-semibold truncate" title={`${data.title || 'Listing'} / Tract ${data.tract_number ?? '?'}`}>
              Draw Boundary — Tract {data.tract_number ?? '?'}
              <span className="text-gg-gray-400 font-normal ml-2 truncate">
                {(data.title || 'Listing').slice(0, 60)}
                {(data.title || '').length > 60 ? '…' : ''}
              </span>
            </h1>
            <p className="text-xs text-gg-gray-400 truncate">
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
        {/* Right: action buttons. flex-shrink-0 so they NEVER get pushed
            off the right edge by a long title. */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={undoLast} disabled={points.length === 0} className="px-3 py-2 bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-40 rounded flex items-center gap-1">
            <RotateCcw size={16} /> Undo
          </button>
          <button onClick={clearAll} disabled={points.length === 0} className="px-3 py-2 bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-40 rounded flex items-center gap-1">
            <Trash2 size={16} /> Clear
          </button>
          <button onClick={() => router.push('/admin/missing-boundaries')} className="px-3 py-2 bg-gg-gray-800 hover:bg-gg-gray-700 rounded flex items-center gap-1">
            <X size={16} /> Cancel
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

      <div className="flex flex-1 min-h-0">
        {/* Left rail — boundary reference. ~30% width. Brochure PDF
            embedded inline so the operator can scroll its tract maps
            while drawing on the satellite view to the right. */}
        <div className="w-[30%] min-w-[280px] flex-shrink-0 flex flex-col bg-gg-gray-900 border-r border-gg-gray-800">
          <div className="p-3 border-b border-gg-gray-800 flex flex-col gap-1.5 flex-shrink-0">
            {data.source_url && (
              <a href={data.source_url} target="_blank" rel="noreferrer"
                 className="px-3 py-2 bg-gg-gray-800 hover:bg-gg-gray-700 rounded text-sm text-gg-gold flex items-center justify-between gap-2 truncate">
                <span className="truncate">Source listing ↗</span>
                <ExternalLink size={14} className="flex-shrink-0" />
              </a>
            )}
            {data.brochure_url && (
              <a href={data.brochure_url} target="_blank" rel="noreferrer"
                 className="px-3 py-2 bg-gg-gold/20 hover:bg-gg-gold/30 border border-gg-gold/40 rounded text-sm text-gg-gold flex items-center justify-between gap-2 truncate">
                <span className="truncate">Open brochure (full screen) ↗</span>
                <ExternalLink size={14} className="flex-shrink-0" />
              </a>
            )}
            {data.company_name && (
              <p className="text-xs text-gg-gray-500 px-1">{data.company_name}</p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <p className="text-xs text-gg-gray-400 uppercase tracking-wider">
              Boundary Reference
              {imagesLoading && (
                <span className="ml-2 text-gg-gray-500 normal-case">
                  (rendering source page, ~10s)…
                </span>
              )}
            </p>
            {imagesLoading && !sourceScreenshot && sourceImages.length === 0 && (
              <div className="flex items-center gap-2 text-gg-gray-500 text-sm">
                <Loader2 className="animate-spin" size={14} />
                Fetching source listing…
              </div>
            )}
            {!imagesLoading && !sourceScreenshot && sourceImages.length === 0 && (
              <div className="text-xs text-gg-gray-500">
                Could not fetch the source listing. Click the Brochure or
                Source buttons above to view in a new tab.
              </div>
            )}
            {sourceImages.length > 0 && (
              <p className="text-[11px] text-gg-gray-500 uppercase tracking-wider pt-1">
                Images ({sourceImages.length})
              </p>
            )}
            {sourceImages.map((img, i) => (
              <button
                key={i}
                onClick={() => setEnlargedImage(img.url)}
                className="block w-full rounded border border-gg-gray-700 hover:border-gg-gold transition-colors overflow-hidden"
                title={`${img.alt || `Source image ${i + 1}`} — ${img.w}×${img.h}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.alt || `Source ${i + 1}`}
                  className="w-full h-auto"
                  loading="lazy"
                />
              </button>
            ))}
            {sourceScreenshot && (
              <>
                <p className="text-[11px] text-gg-gray-500 uppercase tracking-wider pt-1">
                  Full Page Screenshot
                </p>
                <button
                  onClick={() => setEnlargedImage(`data:image/jpeg;base64,${sourceScreenshot}`)}
                  className="block w-full rounded border border-gg-gray-700 hover:border-gg-gold transition-colors overflow-hidden"
                  title="Click to enlarge — full page screenshot"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`data:image/jpeg;base64,${sourceScreenshot}`}
                    alt="source page"
                    className="w-full h-auto"
                  />
                </button>
              </>
            )}
            {data.description && (
              <details className="text-xs text-gg-gray-400 pt-2">
                <summary className="cursor-pointer hover:text-white">
                  Description
                </summary>
                <p className="whitespace-pre-wrap mt-2">{data.description}</p>
              </details>
            )}
          </div>
        </div>
        {/* Map — gets the rest of the screen */}
        <div className="flex-1 min-w-0 relative">
          <div
            ref={containerRef}
            style={{ width: '100%', height: '100%' }}
          />
          <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-3 py-2 rounded space-y-1 pointer-events-none">
            <div>Click the map to drop a boundary point</div>
            <div>≥ 3 points = closed polygon</div>
            <div>Use Undo / Clear if you mis-click</div>
          </div>
        </div>
      </div>
      {enlargedImage && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-6"
          onClick={() => setEnlargedImage(null)}
        >
          <button
            onClick={() => setEnlargedImage(null)}
            className="absolute top-4 right-4 text-white hover:text-gg-gold p-2 bg-black/60 rounded-full"
          >
            <X size={24} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enlargedImage}
            alt="enlarged"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
