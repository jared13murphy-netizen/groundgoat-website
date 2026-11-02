/**
 * The Configurable Mapping EDITING layers (cm-*) as a standalone add /
 * remove pair, so the Explore map's "Map It" editor can draw them on its
 * own map. Same sources, ids, paint and filters as the inline layer code
 * in ConfigureMap.tsx (which keeps its own copy and is not changed).
 *
 * Only the editing layers live here: frame, shapes, boundary, draft,
 * marquee, cut and vertices. No peer-tract, comps or badge layers.
 */
import type maplibregl from 'maplibre-gl'
import { PARCEL_LINE, VERTEX_LINE } from '@/lib/configurableMapping'
import { SRC, LYR_FILL, LYR_VERTS } from '@/lib/cmShapes'

const EDIT_SOURCES = [SRC.frame, SRC.shapes, SRC.boundary, SRC.draft, SRC.marq, SRC.cut, SRC.verts]

const EDIT_LAYERS = [
  'cm-frame-fill', 'cm-frame-line', LYR_FILL, 'cm-shapes-line',
  'cm-boundary-fill', 'cm-boundary-line', 'cm-draft-line',
  'cm-marq-fill', 'cm-marq-line', 'cm-cut-line', 'cm-cut-marks', LYR_VERTS,
]

const coarsePointer = () =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches

export function addCmEditLayers(map: maplibregl.Map, beforeId?: string) {
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined
  const add = (layer: any) => { if (!map.getLayer(layer.id)) map.addLayer(layer, before) }

  for (const id of EDIT_SOURCES) {
    if (!map.getSource(id)) {
      map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } as any })
    }
  }

  add({
    id: 'cm-frame-fill', type: 'fill', source: SRC.frame,
    paint: { 'fill-color': '#60a5fa', 'fill-opacity': 0.10 },
  })
  add({
    id: 'cm-frame-line', type: 'line', source: SRC.frame,
    paint: { 'line-color': '#60a5fa', 'line-width': 2.5, 'line-dasharray': [3, 2] },
  })
  add({
    id: LYR_FILL, type: 'fill', source: SRC.shapes,
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.42, 0.22],
    },
  })
  add({
    id: 'cm-shapes-line', type: 'line', source: SRC.shapes,
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['case', ['boolean', ['get', 'selected'], false], 3, 2],
    },
  })
  add({
    id: 'cm-boundary-fill', type: 'fill', source: SRC.boundary,
    paint: { 'fill-color': '#f58cde', 'fill-opacity': 0.22 },
  })
  add({
    id: 'cm-boundary-line', type: 'line', source: SRC.boundary,
    paint: { 'line-color': PARCEL_LINE, 'line-width': 5.5 },
  })
  add({
    id: 'cm-draft-line', type: 'line', source: SRC.draft,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#ffffff', 'line-width': 2.5, 'line-dasharray': [2, 1.5] },
  })

  // White disc with a scissors glyph, drawn on a canvas so it does not
  // depend on the glyph server carrying U+2702.
  if (!map.hasImage('cm-scissors')) {
    const S = 44
    const cv = document.createElement('canvas'); cv.width = S; cv.height = S
    const g = cv.getContext('2d')!
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2)
    g.fillStyle = '#ffffff'; g.fill()
    g.lineWidth = 3; g.strokeStyle = '#111827'; g.stroke()
    g.fillStyle = '#111827'
    g.font = '22px system-ui, "Apple Color Emoji", sans-serif'
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText('✂', S / 2, S / 2 + 1)
    map.addImage('cm-scissors', g.getImageData(0, 0, S, S) as any, { pixelRatio: 2 })
  }

  add({
    id: 'cm-marq-fill', type: 'fill', source: SRC.marq,
    paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.12 },
  })
  add({
    id: 'cm-marq-line', type: 'line', source: SRC.marq,
    paint: { 'line-color': '#ffffff', 'line-width': 1.5, 'line-dasharray': [2, 2] },
  })
  add({
    id: 'cm-cut-line', type: 'line', source: SRC.cut,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: { 'line-color': '#ffffff', 'line-width': 2, 'line-dasharray': [1.5, 1.5] },
  })
  add({
    id: 'cm-cut-marks', type: 'symbol', source: SRC.cut,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'icon-image': 'cm-scissors', 'icon-size': 0.6,
              'icon-allow-overlap': true, 'icon-ignore-placement': true },
  })
  add({
    id: LYR_VERTS, type: 'circle', source: SRC.verts,
    paint: {
      'circle-radius': ['case', ['boolean', ['get', 'active'], false], 5, 3.2],
      'circle-color': '#ffffff',
      'circle-stroke-color': ['coalesce', ['get', 'color'], VERTEX_LINE],
      'circle-stroke-width': ['case', ['boolean', ['get', 'active'], false], 2, 1.2],
    },
  })
  if (coarsePointer()) {
    map.setPaintProperty(LYR_VERTS, 'circle-radius',
      ['case', ['boolean', ['get', 'active'], false], 9, 6])
    map.setPaintProperty(LYR_VERTS, 'circle-stroke-width',
      ['case', ['boolean', ['get', 'active'], false], 3, 2])
  }
}

/** Remove every layer and source addCmEditLayers added. Safe to call
 *  twice, and safe on a map that has already been removed. */
export function removeCmEditLayers(map: maplibregl.Map) {
  try {
    for (const id of [...EDIT_LAYERS].reverse()) if (map.getLayer(id)) map.removeLayer(id)
    for (const id of EDIT_SOURCES) if (map.getSource(id)) map.removeSource(id)
    if (map.hasImage('cm-scissors')) map.removeImage('cm-scissors')
  } catch { /* map torn down underneath us */ }
}
