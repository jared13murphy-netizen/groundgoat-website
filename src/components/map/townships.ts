/**
 * Township outlines + names (owner 2026-10-26): "show an outline of a
 * township and then show the township name label in a different color than
 * we use for counties and cities" on the Explore map and the comp report map,
 * website and app.
 *
 * Data: Census TIGER 2025 county subdivisions filtered to civil townships
 * (LSAD 44/45/49, plus Wisconsin towns) for the 12 Midwest township states
 * (IL IN IA KS MI MN MO NE ND OH SD WI) → townships.pmtiles (outlines) and
 * township_labels.pmtiles (one interior point per township) on
 * tiles.groundgoat.com, same pipeline as highways.ts.
 *
 * Look: thin dashed sky-blue outline from z8, name in the same sky blue
 * (counties are white-on-dark pills, towns black-on-white pills, so a third
 * colour with no pill reads as "township" at a glance). Labels from z9,
 * which is where county labels switch off.
 */
import type maplibregl from 'maplibre-gl'

const TILES_BASE_URL = process.env.NEXT_PUBLIC_TILES_URL || 'https://tiles.groundgoat.com'

export const TOWNSHIPS_SOURCE = 'gg-townships'
export const TOWNSHIP_LABELS_SOURCE = 'gg-township-labels'
const LINE = 'gg-townships-line'
const LABEL = 'gg-townships-label'
export const TOWNSHIP_LAYER_IDS = [LINE, LABEL]
export const TOWNSHIP_COLOR = '#7dd3fc'   // sky-300: distinct from county pink/white and town black

export function addTownships(map: maplibregl.Map, beforeId?: string): () => void {
  if (!map.getSource(TOWNSHIPS_SOURCE)) {
    map.addSource(TOWNSHIPS_SOURCE, {
      type: 'vector',
      url: `pmtiles://${TILES_BASE_URL}/tiles/townships.pmtiles`,
      minzoom: 5,
      maxzoom: 12,
    })
  }
  if (!map.getSource(TOWNSHIP_LABELS_SOURCE)) {
    map.addSource(TOWNSHIP_LABELS_SOURCE, {
      type: 'vector',
      url: `pmtiles://${TILES_BASE_URL}/tiles/township_labels.pmtiles`,
      minzoom: 8,
      maxzoom: 12,
    })
  }
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined

  if (!map.getLayer(LINE)) {
    map.addLayer({
      id: LINE,
      type: 'line',
      source: TOWNSHIPS_SOURCE,
      'source-layer': 'townships',
      minzoom: 8,
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': TOWNSHIP_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 11, 1.6, 14, 2.4],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.45, 10, 0.8],
        'line-dasharray': [3, 2],
      },
    }, before)
  }
  if (!map.getLayer(LABEL)) {
    map.addLayer({
      id: LABEL,
      type: 'symbol',
      source: TOWNSHIP_LABELS_SOURCE,
      'source-layer': 'township_labels',
      minzoom: 9,
      layout: {
        'text-field': ['concat', ['upcase', ['get', 'name']], ' TWP'],
        'text-font': ['Open Sans Bold'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 12, 14, 13],
        'text-letter-spacing': 0.08,
        'text-max-width': 10,
        'text-padding': 6,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': TOWNSHIP_COLOR,
        'text-halo-color': 'rgba(0,0,0,0.85)',
        'text-halo-width': 1.4,
      },
    }, before)
  }

  return () => {
    for (const id of TOWNSHIP_LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id)
    for (const s of [TOWNSHIPS_SOURCE, TOWNSHIP_LABELS_SOURCE]) if (map.getSource(s)) map.removeSource(s)
  }
}
