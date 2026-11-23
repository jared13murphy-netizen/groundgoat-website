/**
 * Street / road NAMES when zoomed way in (owner 2026-11-23: "we need street
 * names to show up when zoomed way in"). Names only — no road lines; the
 * aerial already shows the road, and our highways layer (highways.ts) keeps
 * drawing the major routes at every zoom.
 *
 * Source: OpenFreeMap's free OpenMapTiles vector tiles (no key, no account,
 * no usage limits; layer `transportation_name`). Map data is OpenStreetMap
 * (ODbL), so the credit "© OpenMapTiles, Data from OpenStreetMap" must show —
 * the TileJSON carries it and MapLibre's attribution control adds it
 * automatically while the source is on screen.
 *
 * The SAME constants drive the mobile app (ground-goat-mobile
 * ExploreMapView 'gg-street-names') so both look identical.
 */
import maplibregl from 'maplibre-gl'

export const STREET_NAMES_TILEJSON = 'https://tiles.openfreemap.org/planet'
export const STREET_NAMES_SOURCE = 'gg-street-names'
export const STREET_NAMES_LAYER = 'gg-street-names-label'
/** First zoom the names show at. Parcel owner labels start at 12 (web). */
export const STREET_NAMES_MIN_ZOOM = 14

// Interstates/motorways are left out — the highways layer already labels
// them with their route number. Service drives, tracks and paths are left
// out too (driveways, field lanes, trails = clutter).
const ROAD_CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'minor']

export function addStreetNames(map: maplibregl.Map, beforeId?: string): void {
  if (!map.getSource(STREET_NAMES_SOURCE)) {
    map.addSource(STREET_NAMES_SOURCE, {
      type: 'vector',
      url: STREET_NAMES_TILEJSON,
    })
  }
  if (map.getLayer(STREET_NAMES_LAYER)) return
  const before = beforeId && map.getLayer(beforeId) ? beforeId : undefined
  map.addLayer({
    id: STREET_NAMES_LAYER,
    type: 'symbol',
    source: STREET_NAMES_SOURCE,
    'source-layer': 'transportation_name',
    minzoom: STREET_NAMES_MIN_ZOOM,
    filter: ['all', ['has', 'name'], ['match', ['get', 'class'], ROAD_CLASSES, true, false]],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 300,
      'text-field': ['get', 'name'],
      'text-font': ['Open Sans Semibold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 13, 16, 15, 18, 17],
      // Sit just beside the road, not on it: the black parcel line that runs
      // down most road centres sliced the name in half (sandbox check 11/23).
      'text-offset': [0, -0.85],
      'text-letter-spacing': 0.03,
      'text-max-angle': 30,
      'text-rotation-alignment': 'map',
      'text-pitch-alignment': 'viewport',
      'text-padding': 2,
      // Never forced on top of anything: a name that would collide with a
      // parcel label (placed first — it sits higher in the stack) is dropped.
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.95)',
      'text-halo-width': 2,
      'text-halo-blur': 0.3,
    },
  }, before)
}

/**
 * Keep the street names ABOVE the parcel boundary lines (so a line along a
 * road centre never strikes through the name) and BELOW the parcel labels
 * (so parcel labels win every collision). Call after the parcel layers are
 * (re)added. `parcelLabelIds` = the parcel label layer ids, bottom-to-top.
 */
export function placeStreetNames(map: maplibregl.Map, parcelLabelIds: string[]): void {
  try {
    if (!map.getStyle() || !map.getLayer(STREET_NAMES_LAYER)) return
    const before = parcelLabelIds.find((id) => map.getLayer(id))
    if (before) map.moveLayer(STREET_NAMES_LAYER, before)
  } catch { /* map mid-teardown */ }
}
