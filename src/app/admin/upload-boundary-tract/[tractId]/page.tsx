'use client'

/**
 * Upload-Boundary admin page — paste an auction-website screenshot
 * and let Claude Vision extract the tract boundary automatically.
 *
 * Flow:
 *   1. Page loads tract context (acres, county, lat/lng)
 *   2. Admin pastes/drops/picks an image with the boundary highlighted
 *   3. Click "Extract with Claude Vision"
 *   4. Backend calls Vision, returns lat/lng polygon
 *   5. Polygon renders on satellite map with acreage check
 *   6. Click Save → existing /save-boundary endpoint persists the
 *      polygon, generates a thumbnail, runs enrichment
 *
 * This page is the auto path. The existing /admin/boundary-draw-tract/[id]
 * page is the manual fallback for when Vision can't find the boundary.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ArrowLeft, Sparkles, Save, Loader2, RotateCcw, ImageIcon } from 'lucide-react'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'

type Pt = [number, number]

function buildPolyGeo(points: Pt[]) {
  if (points.length < 3) return { type: 'FeatureCollection', features: [] } as any
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

export default function UploadBoundaryTractPage() {
  const params = useParams()
  const router = useRouter()
  const tractId = String(params.tractId)

  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [tract, setTract] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [polygon, setPolygon] = useState<Pt[]>([])
  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)
  const [extractMeta, setExtractMeta] = useState<{
    extracted_acres?: number
    expected_acres?: number
    acreage_match?: 'good' | 'loose' | 'off' | null
    confidence?: 'high' | 'medium' | 'low'
    notes?: string
  } | null>(null)

  // Load tract details
  useEffect(() => {
    let cancelled = false
    fetch(`${SCRAPER_URL}/api/admin/tracts/${tractId}/details`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (!body.success) throw new Error(body.error)
        setTract(body)
      })
      .catch(e => { if (!cancelled) setError(String(e.message || e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tractId])

  // Init map once tract is loaded
  useEffect(() => {
    if (!tract || !containerRef.current || mapRef.current) return
    const lat = Number(tract.latitude)
    const lng = Number(tract.longitude)
    if (!lat || !lng) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: { sat: { type: 'raster', tiles: [TILE_URL], tileSize: 256, attribution: TILE_ATTRIBUTION } },
        layers: [{ id: 'sat', type: 'raster', source: 'sat' }],
      },
      center: [lng, lat],
      zoom: 16,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.on('load', () => {
      map.addSource('vision-poly', { type: 'geojson', data: buildPolyGeo([]) })
      map.addLayer({
        id: 'vision-fill', type: 'fill', source: 'vision-poly',
        paint: { 'fill-color': '#E91E8C', 'fill-opacity': 0.18 },
      })
      map.addLayer({
        id: 'vision-line', type: 'line', source: 'vision-poly',
        paint: { 'line-color': '#E91E8C', 'line-width': 2.5 },
      })
    })
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [tract])

  // Update polygon overlay
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const src = map.getSource('vision-poly') as maplibregl.GeoJSONSource | undefined
    if (src) src.setData(buildPolyGeo(polygon))
    if (polygon.length >= 3) {
      const lngs = polygon.map(p => p[0])
      const lats = polygon.map(p => p[1])
      map.fitBounds([
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ], { padding: 60, duration: 600, maxZoom: 17 })
    }
  }, [polygon])

  // Listen for paste anywhere on the page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (!blob) continue
          const reader = new FileReader()
          reader.onload = () => setImageDataUrl(String(reader.result))
          reader.readAsDataURL(blob)
          e.preventDefault()
          return
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  const onFilePicked = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => setImageDataUrl(String(reader.result))
    reader.readAsDataURL(file)
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file && file.type.startsWith('image/')) onFilePicked(file)
  }

  const extract = async () => {
    if (!imageDataUrl) return
    setExtracting(true); setStatusMsg(null); setPolygon([]); setExtractMeta(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/extract-boundary-from-image`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image_base64: imageDataUrl }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) {
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const poly: Pt[] = (body.polygon || []).map((p: any) => [Number(p[0]), Number(p[1])])
      if (poly.length < 3) throw new Error('Vision returned an empty polygon')
      setPolygon(poly)
      setExtractMeta({
        extracted_acres: body.extracted_acres,
        expected_acres: body.expected_acres,
        acreage_match: body.acreage_match,
        confidence: body.vision_confidence,
        notes: body.vision_notes,
      })
      setStatusMsg(null)
    } catch (e: any) {
      setStatusMsg(`✗ Extract failed: ${e.message || e}`)
    } finally {
      setExtracting(false)
    }
  }

  const save = async () => {
    if (polygon.length < 3) return
    setSaving(true); setStatusMsg(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/admin/tracts/${tractId}/save-boundary`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon }),
        }
      )
      const body = await res.json()
      if (!res.ok || !body.success) throw new Error(body.error || 'save failed')
      setStatusMsg(
        `✓ Saved! GIS acres: ${body.gis_acres}` +
        (body.nccpi != null ? ` · NCCPI: ${body.nccpi}` : '') +
        (body.tillable_acres != null ? ` · Tillable: ${body.tillable_acres}` : '') +
        '. Returning…'
      )
      setTimeout(() => router.push('/admin/missing-boundaries'), 1800)
    } catch (e: any) {
      setStatusMsg(`✗ Save failed: ${e.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => {
    setImageDataUrl(null); setPolygon([]); setExtractMeta(null); setStatusMsg(null)
  }

  if (loading) return (
    <div className="min-h-screen bg-gg-gray-950 text-white flex items-center justify-center">
      <Loader2 className="animate-spin" size={28} />
    </div>
  )
  if (error || !tract) return (
    <div className="min-h-screen bg-gg-gray-950 text-white p-8">
      <p className="text-red-400">{error || 'Tract not found'}</p>
      <button onClick={() => router.back()} className="mt-4 text-gg-pink underline">Back</button>
    </div>
  )

  const computedAcres = gisAcres(polygon)
  const matchColor =
    extractMeta?.acreage_match === 'good' ? 'text-emerald-400' :
    extractMeta?.acreage_match === 'loose' ? 'text-amber-400' :
    extractMeta?.acreage_match === 'off' ? 'text-red-400' : 'text-gg-gray-400'

  return (
    <div className="fixed inset-0 z-[100] bg-gg-gray-950 text-white flex flex-col">
      {/* Header */}
      <div className="border-b border-gg-gray-800 px-4 py-3 flex items-center gap-3 bg-gg-gray-900">
        <button
          onClick={() => router.back()}
          className="p-1 text-gg-gray-400 hover:text-white"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{tract.title || 'Tract'}</div>
          <div className="text-xs text-gg-gray-400 truncate">
            {tract.county}, {tract.state} · {tract.total_acres} ac · centroid ({Number(tract.latitude).toFixed(4)}, {Number(tract.longitude).toFixed(4)})
          </div>
        </div>
        <a
          href={`/admin/boundary-draw-tract/${tractId}`}
          className="text-xs px-3 py-1.5 rounded bg-gg-gray-800 hover:bg-gg-gray-700 text-gg-gray-300"
          title="Switch to manual draw"
        >
          Draw manually instead
        </a>
      </div>

      {/* Body: two-column layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left: image upload + controls */}
        <div className="w-1/2 border-r border-gg-gray-800 flex flex-col p-4 gap-3 overflow-y-auto">
          <div className="text-xs text-gg-gray-400 uppercase tracking-wider font-semibold">
            1. Paste auction-website image
          </div>
          {!imageDataUrl ? (
            <label
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              className="flex-1 min-h-[400px] border-2 border-dashed border-gg-gray-700 rounded-lg flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-gg-pink/50 transition-colors p-8"
            >
              <ImageIcon size={36} className="text-gg-gray-500" />
              <div className="text-center">
                <div className="font-medium">Paste, drop, or click to pick</div>
                <div className="text-xs text-gg-gray-400 mt-1">
                  Use the auction screenshot showing the highlighted boundary
                </div>
              </div>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFilePicked(e.target.files[0])}
              />
            </label>
          ) : (
            <div className="flex-1 flex flex-col gap-3 min-h-0">
              <div className="rounded-lg border border-gg-gray-800 overflow-hidden bg-black flex-1 min-h-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageDataUrl} alt="Auction screenshot" className="w-full h-full object-contain" />
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={extract}
                  disabled={extracting}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-gg-pink hover:bg-gg-pink/85 disabled:opacity-50 text-white font-semibold rounded-lg transition"
                >
                  {extracting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                  {extracting ? 'Extracting…' : polygon.length > 0 ? 'Re-extract' : 'Extract with Claude Vision'}
                </button>
                <button
                  onClick={reset}
                  disabled={extracting || saving}
                  className="px-4 py-3 bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-50 text-gg-gray-300 rounded-lg"
                  title="Clear image and start over"
                >
                  <RotateCcw size={16} />
                </button>
              </div>
            </div>
          )}

          {/* Extract result summary */}
          {extractMeta && (
            <div className="bg-gg-gray-900 border border-gg-gray-800 rounded-lg p-3 text-sm space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-gg-gray-400">Extracted acres</span>
                <span className={`font-semibold ${matchColor}`}>
                  {extractMeta.extracted_acres?.toFixed(1) || '—'} ac
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gg-gray-400">Expected acres</span>
                <span>{extractMeta.expected_acres?.toFixed(1) || '—'} ac</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gg-gray-400">Acreage match</span>
                <span className={`font-medium ${matchColor}`}>
                  {extractMeta.acreage_match === 'good' && '✓ within 30%'}
                  {extractMeta.acreage_match === 'loose' && '⚠ within 60% — verify on map'}
                  {extractMeta.acreage_match === 'off' && '✗ way off — Vision may have misidentified the boundary'}
                  {!extractMeta.acreage_match && '—'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gg-gray-400">Vision confidence</span>
                <span className="capitalize">{extractMeta.confidence || '—'}</span>
              </div>
              {extractMeta.notes && (
                <div className="text-xs text-gg-gray-400 mt-2 pt-2 border-t border-gg-gray-800">
                  {extractMeta.notes}
                </div>
              )}
            </div>
          )}

          {/* Save row */}
          {polygon.length >= 3 && (
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-lg transition"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saving ? 'Saving…' : `Save boundary (${computedAcres.toFixed(1)} ac)`}
            </button>
          )}

          {statusMsg && (
            <div className={`text-sm rounded p-2 ${
              statusMsg.startsWith('✓')
                ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700/50'
                : 'bg-red-900/30 text-red-300 border border-red-700/50'
            }`}>
              {statusMsg}
            </div>
          )}
        </div>

        {/* Right: satellite map */}
        <div className="w-1/2 relative">
          <div className="absolute top-3 left-3 bg-gg-gray-900/85 backdrop-blur rounded-lg px-3 py-2 z-10">
            <div className="text-[10px] text-gg-gray-400 uppercase tracking-wider font-semibold">2. Result</div>
            <div className="text-xs text-gg-gray-300 mt-0.5">
              {polygon.length === 0
                ? 'Boundary will appear here after extraction'
                : `${polygon.length} vertices · ${computedAcres.toFixed(1)} ac`}
            </div>
          </div>
          <div ref={containerRef} className="absolute inset-0" />
        </div>
      </div>
    </div>
  )
}
