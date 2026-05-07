'use client'

/**
 * Boundary Creator — admin upload tool.
 *
 * Drop an auctioneer's plat / aerial map image, optionally provide
 * lat/lng/acres hints, and the scraper's existing extract-boundary
 * pipeline (Vision + OpenCV color extraction + projection) returns
 * a real-world polygon. Polygon is rendered on a satellite map
 * for visual confirmation and the lat/lng coords are copy-pasteable.
 *
 * Admin-only. Reuses the production tract-extraction endpoint via
 * the tract_id="upload" sentinel.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Upload, Loader2, Copy, Check } from 'lucide-react'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'
const API_URL = 'https://practical-serenity-production.up.railway.app'

interface ExtractionResult {
  success: boolean
  polygon?: [number, number][]    // [lng, lat], ...
  extracted_acres?: number
  expected_acres?: number
  acreage_match?: boolean
  reference_image_b64?: string
  error?: string
  notes?: string
  scale_source?: string
  anchor_source?: string
}

export default function BoundaryCreatorPage() {
  const router = useRouter()
  const [authChecked, setAuthChecked] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [acres, setAcres] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<ExtractionResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)

  // Admin gate
  useEffect(() => {
    const check = async () => {
      const token = localStorage.getItem('auth_token')
      if (!token) { router.replace('/'); return }
      try {
        const r = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!r.ok) throw new Error()
        const me = await r.json()
        if (me.account_type !== 'groundgoat_admin') { router.replace('/'); return }
        setAuthChecked(true)
      } catch {
        router.replace('/')
      }
    }
    check()
  }, [router])

  const onFile = useCallback((file: File) => {
    setImageFile(file)
    setImagePreviewUrl(URL.createObjectURL(file))
    setResult(null)
    setError(null)
  }, [])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (f && f.type.startsWith('image/')) onFile(f)
  }

  const submit = async () => {
    if (!imageFile) { setError('Pick an image first.'); return }
    if (!lat || !lng) {
      setError('Latitude + longitude are required (rough is fine — they anchor the reference satellite).')
      return
    }
    setSubmitting(true)
    setResult(null)
    setError(null)

    // Read image as base64
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string  // "data:image/jpeg;base64,..."
        const b64 = dataUrl.split(',')[1]
        const mediaType = dataUrl.split(';')[0].split(':')[1]
        const body = {
          image_base64: `data:${mediaType};base64,${b64}`,
          lat: parseFloat(lat),
          lng: parseFloat(lng),
          acres: acres ? parseFloat(acres) : undefined,
        }
        const r = await fetch(
          `${SCRAPER_URL}/api/admin/tracts/upload/extract-boundary-from-image`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        )
        const data = await r.json().catch(() => ({}))
        if (!r.ok) {
          setError(data.error || `HTTP ${r.status}`)
        } else {
          setResult(data)
        }
      } catch (e: any) {
        setError(e?.message || 'Upload failed.')
      } finally {
        setSubmitting(false)
      }
    }
    reader.readAsDataURL(imageFile)
  }

  // Render the polygon on the map once a result arrives
  useEffect(() => {
    if (!result?.polygon || !mapContainerRef.current) return
    const polygon = result.polygon
    if (polygon.length < 3) return

    // Compute bbox for fit
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
    for (const [lng, lat] of polygon) {
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    }

    // Init map if first time
    if (!mapRef.current) {
      mapRef.current = new maplibregl.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {
            satellite: {
              type: 'raster',
              tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
              tileSize: 256,
              maxzoom: 19,
            },
          },
          layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }],
        },
        center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
        zoom: 14,
      })
    }
    const map = mapRef.current

    const setupLayer = () => {
      // Close polygon for GeoJSON
      const closed = polygon.length > 0 && polygon[0][0] === polygon[polygon.length - 1][0]
        ? polygon : [...polygon, polygon[0]]
      const source = map.getSource('result-polygon') as maplibregl.GeoJSONSource | undefined
      const data = {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closed] },
      } as any
      if (source) {
        source.setData(data)
      } else {
        map.addSource('result-polygon', { type: 'geojson', data })
        map.addLayer({
          id: 'result-fill',
          type: 'fill',
          source: 'result-polygon',
          paint: { 'fill-color': '#EC4899', 'fill-opacity': 0.35 },
        })
        map.addLayer({
          id: 'result-line',
          type: 'line',
          source: 'result-polygon',
          paint: { 'line-color': '#EC4899', 'line-width': 3 },
        })
      }
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, maxZoom: 16, duration: 800 })
    }

    if (map.loaded()) setupLayer()
    else map.once('load', setupLayer)
  }, [result])

  // Cleanup map on unmount
  useEffect(() => () => { mapRef.current?.remove() }, [])

  const copyJson = () => {
    if (!result?.polygon) return
    navigator.clipboard.writeText(JSON.stringify(result.polygon))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!authChecked) {
    return <div className="p-8 text-gg-gray-400">Checking authorization…</div>
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold text-white mb-2">Boundary Creator</h1>
      <p className="text-sm text-gg-gray-400 mb-6">
        Upload an auctioneer plat / aerial map. The pipeline runs Claude Vision (color +
        anchor + scale identification) → OpenCV color extraction (precise tracing) →
        projection to lat/lng. Best on Surety / AcreValue / professional plat-style
        maps with a printed coordinate + scale bar.
      </p>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Inputs */}
        <div className="space-y-4">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className="border-2 border-dashed border-white/15 rounded-2xl p-6 text-center hover:border-gg-pink/50 transition-colors bg-black/30"
          >
            {imagePreviewUrl ? (
              <img src={imagePreviewUrl} alt="upload preview" className="max-h-64 mx-auto rounded" />
            ) : (
              <>
                <Upload className="mx-auto mb-2 text-gg-gray-400" size={32} />
                <p className="text-sm text-gg-gray-300">Drop an image here, or</p>
              </>
            )}
            <label className="inline-block mt-3 cursor-pointer text-xs text-gg-pink hover:text-gg-pink-light">
              <input
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
              {imagePreviewUrl ? 'Change image' : 'Choose image'}
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Latitude (rough OK)</label>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                placeholder="40.41"
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gg-gray-400 mb-1">Longitude (rough OK)</label>
              <input
                type="number"
                step="any"
                value={lng}
                onChange={(e) => setLng(e.target.value)}
                placeholder="-90.68"
                className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gg-gray-400 mb-1">Expected acres (optional — improves scale fallback)</label>
            <input
              type="number"
              step="any"
              value={acres}
              onChange={(e) => setAcres(e.target.value)}
              placeholder="75.6"
              className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm text-white"
            />
          </div>

          <button
            onClick={submit}
            disabled={submitting || !imageFile || !lat || !lng}
            className="w-full bg-gg-pink hover:bg-gg-pink-light disabled:opacity-40 text-white font-semibold rounded-lg py-3 flex items-center justify-center gap-2 transition-colors"
          >
            {submitting ? <><Loader2 className="animate-spin" size={16} /> Extracting…</> : 'Extract Boundary'}
          </button>

          {error && (
            <div className="bg-red-900/30 border border-red-600/40 text-red-200 text-sm rounded p-3">{error}</div>
          )}
        </div>

        {/* Result */}
        <div className="space-y-4">
          <div
            ref={mapContainerRef}
            className="w-full h-[420px] rounded-2xl border border-white/10 bg-gg-gray-900"
          />
          {result?.polygon && (
            <div className="bg-black/30 border border-white/10 rounded-xl p-4 space-y-2 text-sm">
              <div className="text-white font-semibold">{result.polygon.length} vertices</div>
              <div className="text-gg-gray-300">
                <span className="text-gg-gray-400">Extracted acres:</span> {result.extracted_acres?.toFixed(1) ?? '—'}
                {result.expected_acres && (
                  <span className="text-gg-gray-500 ml-2">
                    (expected {result.expected_acres.toFixed(1)} —{' '}
                    {Math.abs((result.extracted_acres ?? 0) - result.expected_acres) / result.expected_acres < 0.1
                      ? <span className="text-emerald-400">within 10%</span>
                      : <span className="text-amber-400">{(100 * Math.abs((result.extracted_acres ?? 0) - result.expected_acres) / result.expected_acres).toFixed(0)}% off</span>})
                  </span>
                )}
              </div>
              {result.notes && <div className="text-xs text-gg-gray-400">{result.notes}</div>}
              <button
                onClick={copyJson}
                className="text-xs px-3 py-1.5 rounded bg-gg-gray-800 hover:bg-gg-gray-700 text-white flex items-center gap-1"
              >
                {copied ? <><Check size={12}/> Copied</> : <><Copy size={12}/> Copy polygon JSON</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
