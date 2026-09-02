/**
 * State / county / town outlines and labels — the Explore map's styling,
 * packaged so another map can render exactly the same thing.
 *
 * The values here are lifted verbatim from ExploreMap so the two screens
 * match: the same GeoJSON in /public/data, the same dark pill for
 * counties, the same white-pill-with-pink-border for towns, and the same
 * population-per-zoom ladder that the owner tuned against a real view of
 * west-central Illinois (see the ladder comment below).
 *
 * ExploreMap is deliberately NOT refactored to import this. It is the
 * busiest screen in the product and this module exists to serve a
 * feature that is not live yet; rewiring live code to prove a point
 * about duplication is not worth the risk to it. If Explore is ever
 * touched here, it should adopt this module and the copies collapse.
 */
import type maplibregl from 'maplibre-gl'

// Explore hands the low-zoom job to its state silhouettes, which this
// map deliberately does not draw — so state NAMES take that tier here
// and counties start one step later. Without this the default view
// (z6) opened on ~2,000 county pills and no state names at all.
const STATE_LABEL_MAX = 7
const COUNTY_LABEL_MIN = 7
const COUNTY_LABEL_MAX = 9
const TOWN_LABEL_MIN = 6

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Population floor per zoom. Owner-tuned: >=1,000 at z9-10 is what makes
 *  Carthage, Rushville, Havana, Mount Sterling, Pittsfield and Winchester
 *  appear — every one named as a town that must be visible there. */
const TOWN_ZOOM_STEP: any = [
  'step', ['zoom'],
  false,
  6, ['>=', ['get', 'pop'], 100000],
  8, ['>=', ['get', 'pop'], 20000],
  9, ['>=', ['get', 'pop'], 1000],
  11, ['>=', ['get', 'pop'], 500],
  12, ['>=', ['get', 'pop'], 200],
  13, true,
]

/** 9-slice rounded-rect used as a text background; MapLibre has no
 *  native text-background, so the pill is an icon behind the label. */
function makePillSprite(opts: { border: string; fill?: string }) {
  const W = 32, H = 32, r = 8
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const inset = 1.5
  const x = inset, y = inset, w = W - inset * 2, h = H - inset * 2
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
  ctx.fillStyle = opts.fill ?? 'rgba(15,15,18,0.86)'
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = opts.border
  ctx.stroke()
  const img = ctx.getImageData(0, 0, W, H)
  return {
    image: { width: W, height: H, data: new Uint8Array(img.data.buffer) },
    options: {
      pixelRatio: 2,
      content: [r + 2, r + 2, W - r - 2, H - r - 2],
      stretchX: [[r + 2, W - r - 2]],
      stretchY: [[r + 2, H - r - 2]],
    } as any,
  }
}

function addPill(map: maplibregl.Map, id: string, border: string, fill?: string) {
  try {
    if (!map.hasImage(id)) {
      const p = makePillSprite({ border, fill })
      map.addImage(id, p.image as any, p.options)
    }
  } catch { /* a racing call already added it */ }
}

/**
 * Draw state + county outlines and state/county/town labels.
 * Returns a teardown that removes everything it added.
 */
export function addPlaceLabels(map: maplibregl.Map): () => void {
  const sources = ['pl-counties', 'pl-states', 'pl-state-points', 'pl-towns']
  const layers = [
    'pl-county-borders', 'pl-state-borders',
    'pl-state-labels', 'pl-county-labels', 'pl-town-labels',
  ]

  map.addSource('pl-counties', { type: 'geojson', data: '/data/us-counties.json' })
  map.addSource('pl-states', { type: 'geojson', data: '/data/us-states.json' })
  // Labels need POINT geometry. A symbol layer over polygons places one
  // label per tile the polygon covers, so a big state like Illinois was
  // captioned two or three times across the view. One centroid per
  // state means exactly one label per state.
  map.addSource('pl-state-points', { type: 'geojson', data: EMPTY_FC })

  map.addLayer({
    id: 'pl-county-borders',
    type: 'line',
    source: 'pl-counties',
    paint: {
      'line-color': '#888888',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.1, 5, 0.3, 7, 0.6, 10, 1.0],
      'line-opacity': 0.35,
    },
  })
  map.addLayer({
    id: 'pl-state-borders',
    type: 'line',
    source: 'pl-states',
    paint: {
      'line-color': '#bbbbbb',
      'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 5, 1.5, 7, 2.0, 10, 2.5],
      'line-opacity': 0.6,
    },
  })

  addPill(map, 'pl-pill-county', '#f58cde')
  addPill(map, 'pl-pill-town', '#f58cde', '#ffffff')

  // State names. Explore shows these as silhouette markers, which the
  // owner does not want here, so they are drawn as plain text — no pill,
  // so a state never competes with a county badge for attention.
  map.addLayer({
    id: 'pl-state-labels',
    type: 'symbol',
    source: 'pl-state-points',
    maxzoom: STATE_LABEL_MAX,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 3, 11, 6, 16],
      'text-transform': 'uppercase',
      'text-letter-spacing': 0.12,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.55)',
      'text-halo-width': 1.2,
    },
  })

  map.addLayer({
    id: 'pl-county-labels',
    type: 'symbol',
    source: 'pl-counties',
    minzoom: COUNTY_LABEL_MIN,
    maxzoom: COUNTY_LABEL_MAX,
    layout: {
      'text-field': ['get', 'NAME'],
      'text-font': ['Open Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 9, 13],
      'text-anchor': 'center',
      'text-max-width': 8,
      'text-allow-overlap': false,
      'icon-image': 'pl-pill-county',
      'icon-text-fit': 'both',
      'icon-text-fit-padding': [3, 7, 3, 7],
      'icon-allow-overlap': false,
      'icon-optional': false,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.4)',
      'text-halo-width': 0.6,
    },
  })

  // One label point per state, from the bounding box of its outline.
  // Good enough for a caption and far cheaper than a true centroid.
  fetch('/data/us-states.json')
    .then((r) => (r.ok ? r.json() : null))
    .then((gj: any) => {
      if (cancelled || !gj?.features || !map.getStyle()) return
      const pts: GeoJSON.Feature[] = []
      for (const f of gj.features) {
        const name = f?.properties?.NAME || f?.properties?.name
        if (!name) continue
        let minX = 180, minY = 90, maxX = -180, maxY = -90
        const walk = (a: any) => {
          if (typeof a?.[0] === 'number') {
            const [x, y] = a
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
            return
          }
          if (Array.isArray(a)) a.forEach(walk)
        }
        walk(f.geometry?.coordinates)
        if (minX > maxX) continue
        pts.push({
          type: 'Feature',
          properties: { name },
          geometry: { type: 'Point', coordinates: [(minX + maxX) / 2, (minY + maxY) / 2] },
        })
      }
      const src = map.getSource('pl-state-points') as maplibregl.GeoJSONSource | undefined
      src?.setData({ type: 'FeatureCollection', features: pts })
    })
    .catch(() => { /* labels are an enhancement, never block the map */ })

  // Towns arrive asynchronously: the file is a flat record array, not
  // GeoJSON, so it cannot use the `data: <url>` shorthand.
  let cancelled = false
  fetch('/data/town-centroids.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((rows: any[]) => {
      if (cancelled || !Array.isArray(rows) || !map.getStyle()) return
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: rows
          .filter((r) => typeof r?.lng === 'number' && typeof r?.lat === 'number')
          .map((r) => ({
            type: 'Feature',
            properties: { name: r.name, pop: r.pop ?? 0 },
            geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
          })),
      }
      if (map.getSource('pl-towns')) {
        (map.getSource('pl-towns') as maplibregl.GeoJSONSource).setData(fc)
        return
      }
      map.addSource('pl-towns', { type: 'geojson', data: fc })
      map.addLayer({
        id: 'pl-town-labels',
        type: 'symbol',
        source: 'pl-towns',
        minzoom: TOWN_LABEL_MIN,
        filter: ['all', ['>', ['get', 'pop'], 0], TOWN_ZOOM_STEP],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Open Sans Bold'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 6, 9, 14, 13],
          'text-anchor': 'center',
          'text-max-width': 8,
          'text-allow-overlap': false,
          'icon-image': 'pl-pill-town',
          'icon-text-fit': 'both',
          'icon-text-fit-padding': [3, 7, 3, 7],
          'icon-allow-overlap': false,
          'icon-optional': false,
        },
        paint: { 'text-color': '#000000' },
      })
    })
    .catch(() => { /* labels are an enhancement, never block the map */ })

  return () => {
    cancelled = true
    try {
      if (!map.getStyle()) return
      for (const id of layers) if (map.getLayer(id)) map.removeLayer(id)
      for (const id of sources) if (map.getSource(id)) map.removeSource(id)
    } catch { /* map already torn down */ }
  }
}
