export const ZOOM_TIER_1_MAX = 7
export const ZOOM_TIER_3_MIN = 11

export const MAP_CENTER: [number, number] = [-91.5, 41.0] // [lng, lat] for MapLibre
export const MAP_INITIAL_ZOOM = 6

export const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'
export const GLYPH_URL = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'
export const LABEL_TILE_URL = 'https://cartodb-basemaps-a.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png'

export const STATUS_COLORS: Record<string, { fill: string; border: string; opacity: number }> = {
  listed:  { fill: '#2563EB', border: '#1D4ED8', opacity: 0.25 },
  active:  { fill: '#2563EB', border: '#1D4ED8', opacity: 0.25 },
  live:    { fill: '#16A34A', border: '#15803D', opacity: 0.30 },
  sold:    { fill: '#DC2626', border: '#B91C1C', opacity: 0.20 },
  pending: { fill: '#DC2626', border: '#B91C1C', opacity: 0.20 },
  no_sale: { fill: '#6B7280', border: '#4B5563', opacity: 0.15 },
}

export const HOVER_OPACITY = 0.45

// State bounding boxes: [[sw_lng, sw_lat], [ne_lng, ne_lat]]
export const STATE_BOUNDS: Record<string, [[number, number], [number, number]]> = {
  IL: [[-91.513, 36.970], [-87.019, 42.508]],
  IA: [[-96.639, 40.375], [-90.140, 43.501]],
  MO: [[-95.774, 35.995], [-89.098, 40.613]],
  MN: [[-97.239, 43.499], [-89.489, 49.384]],
  IN: [[-88.097, 37.771], [-84.784, 41.760]],
  WI: [[-92.889, 42.491], [-86.249, 47.080]],
  KS: [[-102.051, 36.993], [-94.588, 40.003]],
  NE: [[-104.053, 39.999], [-95.308, 43.001]],
  OH: [[-84.820, 38.403], [-80.518, 41.977]],
  MI: [[-90.418, 41.696], [-82.122, 48.306]],
  SD: [[-104.057, 42.479], [-96.436, 45.945]],
  ND: [[-104.048, 45.935], [-96.554, 49.000]],
}

// State center points [lng, lat] for Tier 1 card placement
export const STATE_CENTERS: Record<string, [number, number]> = {
  IL: [-89.3, 40.0],
  IA: [-93.5, 42.0],
  MO: [-92.5, 38.5],
  MN: [-94.3, 46.3],
  IN: [-86.3, 39.8],
  WI: [-89.8, 44.5],
  KS: [-98.3, 38.5],
  NE: [-99.8, 41.5],
  OH: [-82.7, 40.3],
  MI: [-84.5, 44.3],
  SD: [-100.2, 44.2],
  ND: [-100.3, 47.5],
}

export const STATE_ABBR: Record<string, string> = {
  Illinois: 'IL',
  Iowa: 'IA',
  Missouri: 'MO',
  Minnesota: 'MN',
  Indiana: 'IN',
  Wisconsin: 'WI',
  Kansas: 'KS',
  Nebraska: 'NE',
  Ohio: 'OH',
  Michigan: 'MI',
  'South Dakota': 'SD',
  'North Dakota': 'ND',
}

// Full state names keyed by abbreviation (for display)
export const STATE_NAMES: Record<string, string> = {
  IL: 'Illinois',
  IA: 'Iowa',
  MO: 'Missouri',
  MN: 'Minnesota',
  IN: 'Indiana',
  WI: 'Wisconsin',
  KS: 'Kansas',
  NE: 'Nebraska',
  OH: 'Ohio',
  MI: 'Michigan',
  SD: 'South Dakota',
  ND: 'North Dakota',
}
