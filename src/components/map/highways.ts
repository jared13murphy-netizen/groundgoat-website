/**
 * Major highways as landmarks (owner 2026-10-08): interstates, US highways
 * and limited-access state highways from the Census Bureau's TIGER 2024
 * primary-roads file, built into one 7 MB tile archive on our tile server
 * (`highways.pmtiles`, layer `highways`, props name / ref / cls).
 *
 * Colour by class, route number along the road, and each class fades in
 * by zoom so the state view stays clean: interstates from z5, US highways
 * from z7, state highways from z9. Roads go in BENEATH whatever `beforeId`
 * names (county borders, pins, parcel outlines), so they never cover data.
 *
 * One module for every map on the site — Explore, the Configurable Mapping
 * editor, Saved Maps, the comparables map — so they all look the same.
 */
import maplibregl from 'maplibre-gl'
import { Protocol as PMTilesProtocol } from 'pmtiles'

const TILES_BASE_URL =
  process.env.NEXT_PUBLIC_TILES_URL || 'https://tiles.groundgoat.com'

export const HIGHWAYS_SOURCE = 'gg-highways'
const CASING = 'gg-highways-casing'
const LINE = 'gg-highways-line'
const LABEL = 'gg-highways-label'
export const HIGHWAY_LAYER_IDS = [CASING, LINE, LABEL]

const COLOR: Record<string, string> = { interstate: '#f2b84b', us: '#f7e6a3', state: '#e8e8e8' }
const MINZOOM: any = ['match', ['get', 'cls'], 'interstate', 5, 'us', 7, 9]

export function addHighways(map: maplibregl.Map, beforeId?: string): () => void {
  const w = window as any
  if (!w.__ggPmtilesRegistered) {
    maplibregl.addProtocol('pmtiles', new PMTilesProtocol().tile as any)
    w.__ggPmtilesRegistered = true
  }
  if (!map.getSource(HIGHWAYS_SOURCE)) {
    map.addSource(HIGHWAYS_SOURCE, {
      type: 'vector',
      url: `pmtiles://${TILES_BASE_URL}/tiles/highways.pmtiles`,
      minzoom: 4,
      maxzoom: 12,
    } as any)
  }
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined
  // Only draw a road once the map is zoomed to its class's threshold.
  const zoomGate: any = ['>=', ['zoom'], MINZOOM]
  if (!map.getLayer(CASING)) {
    map.addLayer({
      id: CASING, type: 'line', source: HIGHWAYS_SOURCE, 'source-layer': 'highways', minzoom: 5,
      filter: zoomGate,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': 'rgba(0,0,0,0.55)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.2, 9, 4, 13, 7],
      },
    }, before)
  }
  if (!map.getLayer(LINE)) {
    map.addLayer({
      id: LINE, type: 'line', source: HIGHWAYS_SOURCE, 'source-layer': 'highways', minzoom: 5,
      filter: zoomGate,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ['match', ['get', 'cls'], 'interstate', COLOR.interstate, 'us', COLOR.us, COLOR.state],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 9, 2.4, 13, 4.5],
        'line-opacity': 0.95,
      },
    }, before)
  }
  if (!map.getLayer(LABEL)) {
    map.addLayer({
      id: LABEL, type: 'symbol', source: HIGHWAYS_SOURCE, 'source-layer': 'highways', minzoom: 6,
      filter: zoomGate,
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 320,
        'text-field': ['get', 'ref'],
        'text-font': ['Open Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 10, 12, 13, 13],
        'text-letter-spacing': 0.05,
        'text-max-angle': 30,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
        'text-padding': 4,
      },
      paint: {
        'text-color': ['match', ['get', 'cls'], 'interstate', COLOR.interstate, 'us', COLOR.us, COLOR.state],
        'text-halo-color': 'rgba(0,0,0,0.9)',
        'text-halo-width': 1.6,
      },
    }, before)
  }
  return () => {
    try {
      if (!map.getStyle()) return
      for (const id of HIGHWAY_LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id)
      if (map.getSource(HIGHWAYS_SOURCE)) map.removeSource(HIGHWAYS_SOURCE)
    } catch { /* map already torn down */ }
  }
}
