'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams, useParams } from 'next/navigation'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { ArrowLeft, Save, RotateCcw, Trash2, Loader2, ExternalLink, X } from 'lucide-react'
import fetchWithAuth, { fetchScraperProxy } from '@/lib/fetchWithAuth'
import { formatAcres } from '@/lib/format'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_PROXY = '/api/scraper-proxy'

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
  const [aligning, setAligning] = useState(false)
  const [saveResult, setSaveResult] = useState<string | null>(null)
  const [sourceScreenshot, setSourceScreenshot] = useState<string | null>(null)
  const [sourceImages, setSourceImages] = useState<{url: string; alt: string; w: number; h: number}[]>([])
  const [imagesLoading, setImagesLoading] = useState(false)
  const [enlargedImage, setEnlargedImage] = useState<string | null>(null)

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

  // Pre-fill the editor with any existing polygon — auto-enrichment
  // (item 3 / commit 948fb5e) populates polygon_coordinates during the
  // nightly scrape, so when the user opens this page for an already-
  // enriched tract, the editor should start with that polygon loaded
  // so they can fine-tune rather than redraw.
  useEffect(() => {
    if (!staging) return
    const t = (staging.scraped_data?.tracts || [])[tractIndex]
    const existing = t?.polygon_coordinates
    if (Array.isArray(existing) && existing.length >= 3) {
      // Drop closing-duplicate vertex if present; the editor's UX
      // expects unclosed point lists (closes the ring at render time).
      const cleaned = (
        existing[0]?.[0] === existing[existing.length - 1]?.[0]
        && existing[0]?.[1] === existing[existing.length - 1]?.[1]
      ) ? existing.slice(0, -1) : existing
      setPoints(cleaned as Pt[])
    }
  }, [staging, tractIndex])

  // Render the source listing with Playwright and pull a full-page
  // screenshot + every rendered image so the boundary diagram is
  // visible next to the satellite map.
  useEffect(() => {
    const src = staging?.source_url
    if (!src) return
    let cancelled = false
    setImagesLoading(true)
    fetchScraperProxy(`/api/admin/scrape-source-images?url=${encodeURIComponent(src)}`)
      .then(r => r.json())
      .then(body => {
        if (cancelled) return
        if (body.screenshot_base64) setSourceScreenshot(body.screenshot_base64)
        if (Array.isArray(body.images)) setSourceImages(body.images)
      })
      .catch(() => {/* ignore */})
      .finally(() => { if (!cancelled) setImagesLoading(false) })
    return () => { cancelled = true }
  }, [staging?.source_url])

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
        paint: { 'fill-color': '#f58cde', 'fill-opacity': 0.25 },
        filter: ['==', '$type', 'Polygon'],
      })
      map.addLayer({
        id: 'drawn-line', type: 'line', source: 'drawn',
        paint: { 'line-color': '#f58cde', 'line-width': 3 },
      })
      map.addLayer({
        id: 'verts', type: 'circle', source: 'verts',
        paint: {
          'circle-radius': 7,
          'circle-color': '#f58cde',
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

    // Force re-measure after the page paints — the map sometimes
    // initializes before flex children resolve their final size.
    const t1 = setTimeout(() => map.resize(), 50)
    const t2 = setTimeout(() => map.resize(), 250)
    const t3 = setTimeout(() => map.resize(), 1000)

    return () => {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      map.remove()
    }
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

  // Align Tract Acres button handler (roadmap item 4 per user
  // 2026-05-23):
  //   1. POST the current polygon + scraped target acres to the
  //      backend's /align-and-rebuild endpoint.
  //   2. Backend SCALES the polygon around its centroid to match the
  //      target, then REBUILDS the tillable polygon via the same
  //      hybrid classifier used in the nightly scrape pipeline.
  //   3. Response includes the scaled polygon — we re-load points
  //      from it so the user sees the aligned shape immediately.
  //   4. Tillable polygon + soil rating get saved into the staging
  //      JSONB by the backend; user sees them refresh after returning
  //      to the staging page.
  const align = async () => {
    if (points.length < 3) {
      setSaveResult('Need at least 3 points to align')
      return
    }
    const tract = (staging?.scraped_data?.tracts || [])[tractIndex] || {}
    const targetAcres = Number(tract.acres)
    if (!targetAcres || targetAcres <= 0) {
      setSaveResult('No scraped acres on this tract — cannot align')
      return
    }
    setAligning(true)
    setSaveResult(null)
    try {
      const res = await fetchScraperProxy(
        `/api/staging/${stagingId}/tracts/${tractIndex}/align-and-rebuild`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            polygon: points,
            target_acres: targetAcres,
          }),
        }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'align failed')
      }
      // Replace points with the scaled polygon so the user sees the
      // new shape on the map.
      const scaled = data.tract?.polygon_coordinates
      if (Array.isArray(scaled) && scaled.length >= 3) {
        const cleaned = (
          scaled[0]?.[0] === scaled[scaled.length - 1]?.[0]
          && scaled[0]?.[1] === scaled[scaled.length - 1]?.[1]
        ) ? scaled.slice(0, -1) : scaled
        setPoints(cleaned as Pt[])
      }
      // Refresh the local staging snapshot so the tillable shape +
      // soil rating shown on the page reflect the rebuild.
      setStaging((prev: any) => {
        if (!prev) return prev
        const next = { ...prev, scraped_data: { ...(prev.scraped_data || {}) } }
        const ts = [...(next.scraped_data.tracts || [])]
        ts[tractIndex] = data.tract
        next.scraped_data.tracts = ts
        return next
      })
      const s = data.stats || {}
      const tilParts: string[] = []
      if (s.tillable_acres != null) {
        tilParts.push(`tillable=${formatAcres(Number(s.tillable_acres))}ac`)
      }
      if (s.tillable_error) {
        tilParts.push(`tillable rebuild error: ${s.tillable_error}`)
      }
      setSaveResult(
        `✓ Aligned to ${targetAcres}ac` +
        (tilParts.length ? ` · ${tilParts.join(' · ')}` : '') +
        ` · ${s.elapsed_s || '?'}s`
      )
    } catch (e: any) {
      setSaveResult(`✗ Align failed: ${e.message || e}`)
    } finally {
      setAligning(false)
    }
  }

  const save = async () => {
    if (points.length < 3) {
      setSaveResult('Need at least 3 points to define a boundary')
      return
    }
    setSaving(true)
    setSaveResult(null)
    try {
      const res = await fetchScraperProxy(
        `/api/staging/${stagingId}/tracts/${tractIndex}/save-boundary`,
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
      <button onClick={() => router.back()} className="mt-4 text-gg-pink underline">Back</button>
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
    <div className="fixed inset-0 z-[100] bg-gg-gray-950 text-white flex flex-col">
      {/* Header bar */}
      <div className="border-b border-gg-gray-800 px-4 py-3 flex items-center justify-between bg-gg-gray-900 flex-shrink-0 gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <button onClick={() => router.back()} className="p-2 hover:bg-gg-gray-800 rounded flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="font-semibold truncate">Draw Boundary — Staging #{stagingId} / Tract {tractIndex + 1}</h1>
            <p className="text-xs text-gg-gray-400 truncate">
              {tract.county_name || sd.listing?.county || '?'} County, {tract.state_abbr || sd.listing?.state || '?'}
              {' · '}
              Claimed acres: {tract.acres ?? '?'}
              {' · '}
              Drawn acres: {points.length >= 3 ? formatAcres(computedAcres) : '—'}
              {' · '}
              {points.length} points
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={undoLast} disabled={points.length === 0} className="px-3 py-1.5 text-sm bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-40 rounded flex items-center gap-1 whitespace-nowrap">
            <RotateCcw size={14} /> Undo
          </button>
          <button onClick={clearAll} disabled={points.length === 0} className="px-3 py-1.5 text-sm bg-gg-gray-800 hover:bg-gg-gray-700 disabled:opacity-40 rounded flex items-center gap-1 whitespace-nowrap">
            <Trash2 size={14} /> Clear
          </button>
          <button onClick={() => router.back()} className="px-3 py-1.5 text-sm bg-gg-gray-800 hover:bg-gg-gray-700 rounded flex items-center gap-1 whitespace-nowrap">
            <X size={14} /> Cancel
          </button>
          {/* Align Tract Acres — scales the current polygon to match the
              scraped tract acres + auto-rebuilds the tillable polygon
              via the hybrid classifier. Roadmap item 4 per user
              2026-05-23. Disabled when fewer than 3 points exist or no
              scraped acres available. */}
          <button
            onClick={align}
            disabled={aligning || saving || points.length < 3 || !staging?.scraped_data?.tracts?.[tractIndex]?.acres}
            title={(staging?.scraped_data?.tracts?.[tractIndex]?.acres
              ? `Scale polygon to ${staging.scraped_data.tracts[tractIndex].acres}ac + rebuild tillable`
              : 'No scraped acres available — cannot align')}
            className="px-3 py-1.5 text-sm bg-gg-gold hover:bg-gg-gold-light text-white font-semibold disabled:opacity-40 disabled:hover:bg-gg-gold rounded flex items-center gap-1.5 whitespace-nowrap"
          >
            {aligning ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {aligning ? 'Aligning…' : 'Align Tract Acres'}
          </button>
          <button onClick={save} disabled={saving || aligning || points.length < 3} className="px-4 py-1.5 text-sm bg-gg-pink hover:bg-gg-pink-light text-white font-semibold disabled:opacity-40 disabled:hover:bg-gg-pink rounded flex items-center gap-1.5 whitespace-nowrap">
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {saveResult && (
        <div className={`px-4 py-2 ${saveResult.startsWith('✓') ? 'bg-green-900' : 'bg-red-900'}`}>
          {saveResult}
        </div>
      )}

      {/* Body: left = boundary reference, right = map */}
      <div className="flex flex-1 min-h-0">
        {/* Left rail — show the actual boundary reference. Priority:
            auctioneer tract diagram > brochure PDF (inline) > screenshot.
            Promotional listing photos are dropped — they don't help. */}
        <div className="w-[30%] min-w-[280px] flex-shrink-0 flex flex-col bg-gg-gray-900 border-r border-gg-gray-800">
          <div className="p-3 border-b border-gg-gray-800 flex flex-col gap-2 flex-shrink-0">
            {/* Scraped details — what the scraper already pulled. */}
            <div className="bg-gg-gray-800/60 rounded p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-gg-gray-500 mb-1.5">
                Scraped details
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <div>
                  <span className="text-gg-gray-400">Acres</span>
                  <div className="text-white font-medium">
                    {tract.acres != null ? tract.acres : '—'}
                  </div>
                </div>
                <div>
                  <span className="text-gg-gray-400">Tillable</span>
                  <div className="text-white font-medium">
                    {tract.tillable_acres != null ? `${tract.tillable_acres} ac` : '—'}
                  </div>
                </div>
                <div>
                  <span className="text-gg-gray-400">Land type</span>
                  <div className="text-gg-pink font-medium">
                    {tract.land_type || '—'}
                  </div>
                </div>
                <div>
                  <span className="text-gg-gray-400">NCCPI</span>
                  <div className="text-cyan-300 font-medium">
                    {tract.nccpi != null ? tract.nccpi : (tract.soil_rating != null ? tract.soil_rating : '—')}
                  </div>
                </div>
                {(tract.sale_price != null || tract.price_per_acre != null) && (
                  <>
                    <div>
                      <span className="text-gg-gray-400">Sale price</span>
                      <div className="text-white font-medium">
                        {tract.sale_price != null ? `$${Number(tract.sale_price).toLocaleString()}` : '—'}
                      </div>
                    </div>
                    <div>
                      <span className="text-gg-gray-400">$/acre</span>
                      <div className="text-white font-medium">
                        {tract.price_per_acre != null ? `$${Number(tract.price_per_acre).toLocaleString()}` : '—'}
                      </div>
                    </div>
                  </>
                )}
                <div className="col-span-2">
                  <span className="text-gg-gray-400">Location</span>
                  <div className="text-white font-medium">
                    {tract.county_name || sd.listing?.county || '?'} County, {tract.state_abbr || sd.listing?.state || '?'}
                  </div>
                </div>
              </div>
            </div>
            {sourceUrl && (
              <a href={sourceUrl} target="_blank" rel="noreferrer"
                 className="px-3 py-2 bg-gg-gray-800 hover:bg-gg-gray-700 rounded text-sm text-gg-pink flex items-center justify-between gap-2 truncate">
                <span className="truncate">Source listing ↗</span>
                <ExternalLink size={14} className="flex-shrink-0" />
              </a>
            )}
            {brochureUrl && (
              <a href={brochureUrl} target="_blank" rel="noreferrer"
                 className="px-3 py-2 bg-gg-pink/20 hover:bg-gg-pink/30 border border-gg-pink/40 rounded text-sm text-gg-pink flex items-center justify-between gap-2 truncate">
                <span className="truncate">Open brochure (full screen) ↗</span>
                <ExternalLink size={14} className="flex-shrink-0" />
              </a>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            <p className="text-xs text-gg-gray-400 uppercase tracking-wider">
              Boundary Reference
              {imagesLoading && (
                <span className="ml-2 text-gg-gray-500 normal-case">
                  (fetching source page…)
                </span>
              )}
              {!imagesLoading && sourceImages.length > 0 && (
                <span className="ml-2 text-gg-gray-500 normal-case">
                  ({sourceImages.length} from source)
                </span>
              )}
            </p>
            {mapImage && (
              <>
                <p className="text-[11px] text-gg-gray-500 uppercase tracking-wider">
                  Auctioneer Tract Diagram (scraped)
                </p>
                <button
                  onClick={() => setEnlargedImage(`data:image/png;base64,${mapImage}`)}
                  className="block w-full rounded border border-gg-pink/60 hover:border-gg-pink overflow-hidden"
                  title="Auctioneer tract diagram"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/png;base64,${mapImage}`} alt="auctioneer diagram"
                       className="w-full h-auto" />
                </button>
              </>
            )}
            {imagesLoading && !sourceScreenshot && sourceImages.length === 0 && !mapImage && (
              <div className="flex items-center gap-2 text-gg-gray-500 text-sm">
                <Loader2 className="animate-spin" size={14} />
                Fetching source listing (~10s)…
              </div>
            )}
            {sourceImages.length > 0 && (
              <p className="text-[11px] text-gg-gray-500 uppercase tracking-wider pt-1">
                Source Page Images ({sourceImages.length})
              </p>
            )}
            {sourceImages.map((img, i) => (
              <button
                key={i}
                onClick={() => setEnlargedImage(img.url)}
                className="block w-full rounded border border-gg-gray-700 hover:border-gg-pink transition-colors overflow-hidden"
                title={`${img.alt || `Source image ${i + 1}`} — ${img.w}×${img.h}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.alt || `Source ${i + 1}`}
                     className="w-full h-auto" loading="lazy" />
              </button>
            ))}
            {sourceScreenshot && (
              <>
                <p className="text-[11px] text-gg-gray-500 uppercase tracking-wider pt-1">
                  Full Page Screenshot
                </p>
                <button
                  onClick={() => setEnlargedImage(`data:image/jpeg;base64,${sourceScreenshot}`)}
                  className="block w-full rounded border border-gg-gray-700 hover:border-gg-pink transition-colors overflow-hidden"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/jpeg;base64,${sourceScreenshot}`} alt="source page"
                       className="w-full h-auto" />
                </button>
              </>
            )}
            {!mapImage && screenshot && !sourceScreenshot && sourceImages.length === 0 && (
              <button
                onClick={() => setEnlargedImage(`data:image/png;base64,${screenshot}`)}
                className="block w-full rounded border border-gg-gray-700 hover:border-gg-pink overflow-hidden"
                title="Page screenshot (cached)"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`data:image/png;base64,${screenshot}`} alt="screenshot"
                     className="w-full h-auto" />
              </button>
            )}
            {!mapImage && !imagesLoading && !sourceScreenshot && sourceImages.length === 0 && !screenshot && (
              <div className="text-xs text-gg-gray-500">
                No images found. Open the brochure or source listing in
                a new tab to see the tract layout.
              </div>
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
          {/* Live acreage bubble */}
          {points.length >= 3 && (() => {
            const claimed = tract.acres != null ? Number(tract.acres) : null
            const delta = claimed && claimed > 0 ? (computedAcres - claimed) / claimed : null
            const off = delta != null && Math.abs(delta) > 0.10
            return (
              <div className={`absolute top-3 right-3 bg-black/85 backdrop-blur-sm rounded-lg px-4 py-3 shadow-xl pointer-events-none border ${off ? 'border-amber-400/70' : 'border-gg-pink/50'}`}>
                <div className="text-[10px] uppercase tracking-wider text-gg-gray-400">
                  Drawn polygon
                </div>
                <div className="text-2xl font-semibold text-white leading-tight">
                  {formatAcres(computedAcres)}
                  <span className="text-sm font-normal text-gg-gray-300 ml-1">ac</span>
                </div>
                {claimed != null && (
                  <div className="text-[11px] mt-1 leading-tight">
                    <div className="text-gg-gray-400">
                      Claimed: <span className="text-white">{formatAcres(claimed)} ac</span>
                    </div>
                    <div className={off ? 'text-amber-300 font-medium' : 'text-gg-gray-400'}>
                      Δ {delta != null && delta >= 0 ? '+' : ''}{delta != null ? (delta * 100).toFixed(1) : '—'}%
                      {' '}
                      ({delta != null && delta >= 0 ? '+' : '-'}{formatAcres(Math.abs(computedAcres - claimed))} ac)
                    </div>
                  </div>
                )}
                <div className="text-[10px] text-gg-gray-500 mt-1">
                  {points.length} points
                </div>
              </div>
            )
          })()}
        </div>
      </div>
      {enlargedImage && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center p-6"
          onClick={() => setEnlargedImage(null)}
        >
          <button
            onClick={() => setEnlargedImage(null)}
            className="absolute top-4 right-4 text-white hover:text-gg-pink p-2 bg-black/60 rounded-full"
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
