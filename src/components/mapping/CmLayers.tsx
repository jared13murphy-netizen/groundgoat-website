'use client'
/**
 * Layers for the Configurable Mapping screen (owner 10/6: "When I'm
 * editing a map on the configurable map screen, I need a layers button
 * so I can choose to add layers on top of my map").
 *
 * `useCmOverlays` owns one mutually-exclusive overlay on the editor's
 * MapLibre map — the same sources and paint Explore uses (mapOverlays.ts)
 * — and `CmLayersPanel` is the popup the round "Layers" button opens.
 * Display-only: no clicks, no land-detail panel; the editor's own
 * drawing layers always stay on top (overlays insert beneath the first
 * `cm-` layer).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { Protocol as PMTilesProtocol } from 'pmtiles'
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import {
  CDL_LEGEND_ROWS, CROP_YEARS, FSA_PMTILES_STATES, NCCPI_FILL_COLOR, OVERLAY_MIN_ZOOM,
  OVERLAY_OPTIONS, SOIL_PMTILES_STATES, SOIL_TYPES_FILL_COLOR, TILES_BASE_URL,
  buildCropColorExpr, type OverlayKey,
} from '@/components/map/mapOverlays'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

type OverlayConfig = { tiles?: { precip?: string }; precip_years?: number[]; precip_attribution?: string } | null

/** The first editor layer; overlays go in just under it so drawn
 *  tracts, parcels and handles stay on top. Falls back to "on top of
 *  everything" if the editor has not added its layers yet. */
function beforeIdFor(map: maplibregl.Map): string | undefined {
  const layers = map.getStyle()?.layers ?? []
  return layers.find((l) => l.id.startsWith('cm-'))?.id
}

export function useCmOverlays(mapRef: React.MutableRefObject<maplibregl.Map | null>, ready: boolean) {
  const [overlay, setOverlayState] = useState<OverlayKey | null>(null)
  const [cropYear, setCropYear] = useState<number>(2024)
  const [precipYear, setPrecipYear] = useState<number | null>(null)
  const [overlayConfig, setOverlayConfig] = useState<OverlayConfig>(null)
  const [zoomTooFar, setZoomTooFar] = useState<string | null>(null)
  const addedRef = useRef<Set<string>>(new Set())

  // Precipitation tiles are entitlement-gated: the backend omits
  // tiles.precip for callers who may not see them, and the row is
  // hidden until the config says otherwise (same rule as Explore).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetchWithAuth(`${API_URL}/api/tiles/overlay-config`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) {
          setOverlayConfig(data)
          const yrs: number[] = data?.precip_years ?? []
          if (yrs.length) setPrecipYear((y) => y ?? yrs[yrs.length - 1])
        }
      } catch { /* no precip row */ }
    })()
    return () => { cancelled = true }
  }, [])

  const options = useMemo(
    () => OVERLAY_OPTIONS.filter((o) => o.key !== 'precip' || !!overlayConfig?.tiles?.precip),
    [overlayConfig],
  )

  /** Add (once) every source + layer an overlay needs, hidden. */
  const ensure = useCallback((map: maplibregl.Map, key: OverlayKey) => {
    if (addedRef.current.has(key)) return
    const w = window as any
    if (!w.__ggPmtilesRegistered) {
      maplibregl.addProtocol('pmtiles', new PMTilesProtocol().tile as any)
      w.__ggPmtilesRegistered = true
    }
    const before = beforeIdFor(map)
    const add = (layer: any) => { if (!map.getLayer(layer.id)) map.addLayer(layer, before) }
    if (key === 'ssurgo' || key === 'nccpi') {
      for (const st of SOIL_PMTILES_STATES) {
        const src = `cm-ov-soils-${st}`
        if (!map.getSource(src)) {
          map.addSource(src, { type: 'vector', url: `pmtiles://${TILES_BASE_URL}/tiles/${st}_soils.pmtiles` } as any)
        }
        add({
          id: `cm-ov-${key}-fill-${st}`, type: 'fill', source: src, 'source-layer': 'soils', minzoom: 6,
          layout: { visibility: 'none' },
          paint: {
            'fill-color': key === 'ssurgo' ? SOIL_TYPES_FILL_COLOR : NCCPI_FILL_COLOR,
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0, 7, key === 'ssurgo' ? 0.60 : 0.65],
          },
        })
        add({
          id: `cm-ov-${key}-line-${st}`, type: 'line', source: src, 'source-layer': 'soils', minzoom: 6,
          layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': 'rgba(0,0,0,0.12)', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 16, 1.2] },
        })
      }
    } else if (key === 'fsa') {
      for (const st of FSA_PMTILES_STATES) {
        const src = `cm-ov-fsa-${st}`
        if (!map.getSource(src)) {
          map.addSource(src, { type: 'vector', url: `pmtiles://${TILES_BASE_URL}/tiles/${st.toUpperCase()}_fsa.pmtiles`, maxzoom: 14 } as any)
        }
        add({
          id: `cm-ov-fsa-line-${st}`, type: 'line', source: src, 'source-layer': 'fsa', minzoom: 6,
          layout: { visibility: 'none', 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#22d3ee', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.3, 10, 0.8, 14, 1.5], 'line-opacity': 0.9 },
        })
      }
    } else if (key === 'crops') {
      if (!map.getSource('cm-ov-csb')) {
        map.addSource('cm-ov-csb', { type: 'vector', tiles: [`${API_URL}/api/tiles/csb-fields/{z}/{x}/{y}.mvt`], minzoom: 10, maxzoom: 14 })
      }
      add({
        id: 'cm-ov-crops-fill', type: 'fill', source: 'cm-ov-csb', 'source-layer': 'csb_fields', minzoom: 10,
        layout: { visibility: 'none' },
        paint: { 'fill-color': buildCropColorExpr(cropYear), 'fill-opacity': 0.65, 'fill-outline-color': 'rgba(255,255,255,0.25)' },
      })
    }
    // precip is (re)built per year in its own effect below.
    if (key !== 'precip') addedRef.current.add(key)
  }, [cropYear])

  /** Show exactly one overlay's layers, hide the rest. */
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (overlay && overlay !== 'precip') ensure(map, overlay)
    const layers = map.getStyle()?.layers ?? []
    for (const l of layers) {
      if (!l.id.startsWith('cm-ov-')) continue
      const mine = overlay !== null && l.id.startsWith(`cm-ov-${overlay}-`)
      map.setLayoutProperty(l.id, 'visibility', mine ? 'visible' : 'none')
    }
  }, [mapRef, ready, overlay, ensure])

  // Crops: recolour on year change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer('cm-ov-crops-fill')) return
    map.setPaintProperty('cm-ov-crops-fill', 'fill-color', buildCropColorExpr(cropYear))
  }, [mapRef, ready, cropYear])

  // Precipitation: a raster source whose URL carries the year.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const SRC = 'cm-ov-precip-src', LAYER = 'cm-ov-precip-tiles'
    const template = overlayConfig?.tiles?.precip
    const active = overlay === 'precip' && !!template && precipYear !== null
    if (!active) {
      if (map.getLayer(LAYER)) map.removeLayer(LAYER)
      if (map.getSource(SRC)) map.removeSource(SRC)
      return
    }
    const url = template!.replace('{year}', String(precipYear))
    const existing = map.getSource(SRC) as maplibregl.RasterTileSource | undefined
    if (existing) existing.setTiles([url])
    else map.addSource(SRC, { type: 'raster', tiles: [url], tileSize: 256, minzoom: 3, maxzoom: 10,
      attribution: `Rainfall &copy; ${overlayConfig?.precip_attribution || 'PRISM Group, Oregon State University'}` } as any)
    if (!map.getLayer(LAYER)) {
      map.addLayer({ id: LAYER, type: 'raster', source: SRC, layout: { visibility: 'visible' },
        paint: { 'raster-opacity': 0.72, 'raster-resampling': 'linear' } } as any, beforeIdFor(map))
    }
  }, [mapRef, ready, overlay, overlayConfig, precipYear])

  // "Zoom in to see …" while the map sits below the overlay's minzoom.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const check = () => {
      if (!overlay) { setZoomTooFar(null); return }
      const label = OVERLAY_OPTIONS.find((o) => o.key === overlay)?.label ?? overlay
      setZoomTooFar(map.getZoom() < OVERLAY_MIN_ZOOM[overlay] ? `Zoom in to see ${label}` : null)
    }
    check()
    map.on('zoom', check)
    return () => { map.off('zoom', check); setZoomTooFar(null) }
  }, [mapRef, ready, overlay])

  const setOverlay = useCallback((k: OverlayKey | null) => setOverlayState((cur) => (cur === k ? null : k)), [])

  return {
    overlay, setOverlay, options, cropYear, setCropYear,
    precipYear, setPrecipYear, precipYears: overlayConfig?.precip_years ?? [], zoomTooFar,
  }
}

function OverlayRow({ active, label, swatchGradient, swatchColor, onClick }: {
  active: boolean; label: string; swatchGradient?: string; swatchColor?: string; onClick: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const base = active
    ? { background: 'linear-gradient(135deg,#E91E8C 0%,#c4186f 100%)', border: '1px solid #E91E8C', color: '#fff', boxShadow: '0 2px 10px rgba(233,30,140,0.40)' }
    : hovered
    ? { background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.22)', color: 'rgba(255,255,255,0.80)' }
    : { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.55)' }
  return (
    <div role="button" aria-pressed={active} onClick={onClick}
         onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
         style={{ display: 'flex', alignItems: 'center', height: 32, borderRadius: 7, padding: '0 9px', fontSize: 11,
                  fontWeight: 500, cursor: 'pointer', gap: 8, transition: 'background 0.12s, border-color 0.12s', ...base }}>
      <span style={{ width: 22, height: 8, borderRadius: 2, flex: 'none',
                     background: swatchGradient ?? swatchColor ?? 'transparent', opacity: active ? 1 : 0.85 }} />
      <span style={{ flex: 1 }}>{label}</span>
      {active && <span style={{ fontSize: 10, opacity: 0.9 }}>on</span>}
    </div>
  )
}

const chip = (sel: boolean): React.CSSProperties => ({
  height: 22, padding: '0 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center',
  background: sel ? '#E91E8C' : 'rgba(255,255,255,0.08)', color: sel ? '#fff' : 'rgba(255,255,255,0.75)',
})

/** The popup the round Layers button opens. `openUp` anchors it above
 *  the button (desktop, bottom-left); otherwise it drops below. */
export function CmLayersPanel({ ov, openUp }: { ov: ReturnType<typeof useCmOverlays>; openUp: boolean }) {
  return (
    <div style={{
      position: 'absolute', left: 0,
      ...(openUp ? { bottom: '100%', marginBottom: 8 } : { top: '100%', marginTop: 8 }),
      width: 236, padding: 10, borderRadius: 10, zIndex: 40,
      background: 'rgba(15,21,32,0.96)', border: '1px solid rgba(255,255,255,0.14)',
      boxShadow: '0 8px 24px rgba(0,0,0,0.55)', backdropFilter: 'blur(10px)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ color: 'rgba(255,255,255,0.40)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, paddingBottom: 2 }}>
        Layers
      </div>
      {ov.options.map((o) => (
        <OverlayRow key={o.key} active={ov.overlay === o.key} label={o.label}
                    swatchGradient={o.swatchGradient} swatchColor={o.swatchColor} onClick={() => ov.setOverlay(o.key)} />
      ))}
      {ov.overlay === 'crops' && (
        <div style={{ paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {CROP_YEARS.map((yr) => (
              <div key={yr} onClick={() => ov.setCropYear(yr)} style={chip(ov.cropYear === yr)}>{yr}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
            {CDL_LEGEND_ROWS.map((r) => (
              <div key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: r.color, flex: 'none' }} />
                <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 9 }}>{r.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {ov.overlay === 'nccpi' && (
        <div style={{ padding: '2px 0 2px' }}>
          <div style={{ display: 'flex', gap: 2, marginBottom: 2 }}>
            {[['#d73027','0'],['#fc8d59','25'],['#fee08b','50'],['#91cf60','75'],['#1a9850','100']].map(([c, l]) => (
              <div key={l} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ height: 5, background: c, borderRadius: 2 }} />
                <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 8 }}>{l}</span>
              </div>
            ))}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 8, textAlign: 'center' }}>Low → High productivity</div>
        </div>
      )}
      {ov.overlay === 'fsa' && (
        <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: 9, paddingTop: 2 }}>
          FSA field boundaries · 2008 snapshot · not available in AL, FL, AK
        </div>
      )}
      {ov.overlay === 'precip' && ov.precipYears.length > 0 && (
        <div style={{ paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 10 }}>PRISM rainfall by year, inches</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ov.precipYears.map((yr) => (
              <div key={yr} onClick={() => ov.setPrecipYear(yr)} style={chip(ov.precipYear === yr)}>{yr}</div>
            ))}
          </div>
        </div>
      )}
      {ov.zoomTooFar && (
        <div style={{ color: '#f58cde', fontSize: 10, fontWeight: 600, paddingTop: 4 }}>{ov.zoomTooFar}</div>
      )}
    </div>
  )
}
