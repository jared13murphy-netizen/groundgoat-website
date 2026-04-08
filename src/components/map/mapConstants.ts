export const ZOOM_TIER_1_MAX = 7
export const ZOOM_TIER_3_MIN = 11

export const MAP_CENTER: [number, number] = [-91.5, 41.0] // [lng, lat] for MapLibre
export const MAP_INITIAL_ZOOM = 6

export const TILE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
export const TILE_ATTRIBUTION = '&copy; Esri, Maxar, Earthstar Geographics'
export const GLYPH_URL = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'
export const LABEL_TILE_URL = 'https://cartodb-basemaps-a.global.ssl.fastly.net/light_only_labels/{z}/{x}/{y}.png'

export const STATUS_COLORS: Record<string, { fill: string; border: string; opacity: number }> = {
  listed:  { fill: '#eab308', border: '#ca8a04', opacity: 0.25 },
  active:  { fill: '#eab308', border: '#ca8a04', opacity: 0.25 },
  live:    { fill: '#E91E8C', border: '#c4176f', opacity: 0.30 },
  sold:    { fill: '#22c55e', border: '#16a34a', opacity: 0.20 },
  pending: { fill: '#eab308', border: '#ca8a04', opacity: 0.20 },
  no_sale: { fill: '#ef4444', border: '#dc2626', opacity: 0.15 },
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
  KY: [[-89.571, 36.497], [-81.964, 39.147]],
  TN: [[-90.310, 34.982], [-81.646, 36.678]],
  OK: [[-103.002, 33.615], [-94.431, 37.002]],
  TX: [[-106.645, 25.837], [-93.508, 36.500]],
  MT: [[-116.050, 44.358], [-104.039, 49.001]],
  CO: [[-109.060, 36.992], [-102.041, 41.003]],
  MS: [[-91.655, 30.173], [-88.097, 34.996]],
  LA: [[-94.043, 28.924], [-88.817, 33.019]],
  WA: [[-124.849, 45.543], [-116.916, 49.002]],
  CA: [[-124.409, 32.534], [-114.131, 42.009]],
  FL: [[-87.634, 24.396], [-79.974, 31.001]],
  ID: [[-117.243, 41.988], [-111.043, 49.001]],
  VA: [[-83.675, 36.540], [-75.242, 39.466]],
  WV: [[-82.644, 37.201], [-77.719, 40.638]],
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
