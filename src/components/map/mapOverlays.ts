/**
 * Map overlays shared by the Explore map and the Configurable Mapping
 * screen (owner 10/6: "I need a Layers button" on the map editor).
 *
 * The tile sources, state coverage lists and paint expressions here are
 * the SAME ones ExploreMap.tsx renders — any new overlay goes here first
 * so both screens stay in step. ExploreMap still owns its own effects
 * (its overlays interact with pins, parcels and the land-detail panel);
 * the editor uses the lighter `useCmOverlays` hook in
 * mapping/CmLayers.tsx, which is display-only.
 */

export const TILES_BASE_URL =
  process.env.NEXT_PUBLIC_TILES_URL ||
  'https://ground-goat-tiles-production.up.railway.app'

/** States with a pre-built _soils.pmtiles archive on the tile server
 *  (Soil Types + NCCPI overlays). Mirror of ExploreMap's list. */
export const SOIL_PMTILES_STATES = [
  'AL','AR','AZ','CA','CO','CT','DE','FL','GA','IA','ID','IL','IN','KS','KY',
  'LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ','NM',
  'NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA','VT','WA',
  'WI','WV','WY',
]
/** States with a _fsa.pmtiles archive (2008 CLU field boundaries). */
export const FSA_PMTILES_STATES = [
  'AR','AZ','CA','CO','CT','DE','GA','HI','IA','ID','IL','IN','KS','KY',
  'LA','MA','MD','ME','MI','MN','MO','MS','MT','NC','ND','NE','NH','NJ',
  'NM','NV','NY','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VA',
  'VT','WA','WI','WV','WY',
]

export type OverlayKey = 'ssurgo' | 'crops' | 'nccpi' | 'fsa' | 'precip'

/** The rows the Layers panel offers, in display order, with the swatch
 *  each one wears (same swatches as Explore's Layers view). */
export const OVERLAY_OPTIONS: Array<{ key: OverlayKey; label: string; swatchGradient?: string; swatchColor?: string }> = [
  { key: 'ssurgo', label: 'Soil Types', swatchGradient: 'linear-gradient(to right,#c94040,#c4b030,#29a068,#2878c8,#b03890)' },
  { key: 'crops', label: 'Crops by Year', swatchGradient: 'linear-gradient(to right,#FFD400,#267000,#A87000,#FFA8E3)' },
  { key: 'nccpi', label: 'NCCPI', swatchGradient: 'linear-gradient(to right,#d73027,#fee08b,#1a9850)' },
  { key: 'fsa', label: 'FSA', swatchColor: '#22d3ee' },
  { key: 'precip', label: 'Annual Precipitation', swatchGradient: 'linear-gradient(to right,#f7f4ec,#e6e0b4,#cfe2a0,#9fd3a3,#5fbfb0,#2f9fc6,#1f6fb5,#14468f,#0b2560)' },
]

/** Below this zoom an overlay draws nothing; the UI says "zoom in". */
export const OVERLAY_MIN_ZOOM: Record<OverlayKey, number> = { ssurgo: 6, nccpi: 6, crops: 10, fsa: 6, precip: 3 }

export const CROP_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024]

/** 16-colour categorical palette keyed on mukey % 16 (mukey is a STRING
 *  in PMTiles-encoded tiles, hence to-number). */
export const SOIL_TYPES_FILL_COLOR: any = [
  'step', ['%', ['to-number', ['get', 'mukey'], 0], 16],
  '#c94040', 1, '#d4753a', 2, '#c4b030', 3, '#5aaa2e', 4, '#29a068', 5, '#2878c8',
  6, '#6050c0', 7, '#b03890', 8, '#e06060', 9, '#e0a060', 10, '#d8d055', 11, '#80cc55',
  12, '#50c090', 13, '#5598e0', 14, '#9080d8', 15, '#d060b0',
]
export const NCCPI_FILL_COLOR: any = [
  'interpolate', ['linear'], ['to-number', ['get', 'nccpi'], 0],
  0, '#d73027', 25, '#fc8d59', 50, '#fee08b', 75, '#91cf60', 100, '#1a9850',
]

// ── CDL_PALETTE — USDA Cropland Data Layer code → {name, color} ─────────────
// Source: USDA NASS official CDL legend + audubon_FSA_fields.html color mapping.
// Code 0 / null = no data → rendered transparent (handled in buildCropColorExpr).
export const CDL_PALETTE: Record<number, { name: string; color: string }> = {
  1:   { name: 'Corn',                  color: '#FFD400' },
  2:   { name: 'Cotton',                color: '#FF2626' },
  3:   { name: 'Rice',                  color: '#00A8E2' },
  4:   { name: 'Sorghum',               color: '#FF9E0C' },
  5:   { name: 'Soybeans',              color: '#267000' },
  6:   { name: 'Sunflower',             color: '#FFFF00' },
  10:  { name: 'Peanuts',               color: '#267000' },
  11:  { name: 'Tobacco',               color: '#70A800' },
  12:  { name: 'Sweet Corn',            color: '#FFA8A8' },
  13:  { name: 'Pop/Orn Corn',          color: '#FFD400' },
  14:  { name: 'Mint',                  color: '#7AF5CA' },
  21:  { name: 'Barley',                color: '#E2007C' },
  22:  { name: 'Durum Wheat',           color: '#B56B00' },
  23:  { name: 'Spring Wheat',          color: '#D8B56B' },
  24:  { name: 'Winter Wheat',          color: '#A87000' },
  25:  { name: 'Other Small Grains',    color: '#D2CCC2' },
  26:  { name: 'Dbl Crop WinWht/Soybeans', color: '#D1FF00' },
  27:  { name: 'Rye',                   color: '#AC007C' },
  28:  { name: 'Oats',                  color: '#A05989' },
  29:  { name: 'Millet',                color: '#70A800' },
  30:  { name: 'Speltz',                color: '#D2CCC2' },
  31:  { name: 'Canola',                color: '#D1FF00' },
  32:  { name: 'Flaxseed',              color: '#7F7FFF' },
  33:  { name: 'Safflower',             color: '#BFBF77' },
  34:  { name: 'Rape Seed',             color: '#D1FF00' },
  35:  { name: 'Mustard',               color: '#D1FF00' },
  36:  { name: 'Alfalfa',               color: '#FFA8E3' },
  37:  { name: 'Other Hay/Non Alfalfa', color: '#A5F28C' },
  38:  { name: 'Camelina',              color: '#D1FF00' },
  39:  { name: 'Buckwheat',             color: '#D2CCC2' },
  41:  { name: 'Sugarbeets',            color: '#A800E4' },
  42:  { name: 'Dry Beans',             color: '#A87000' },
  43:  { name: 'Potatoes',              color: '#702600' },
  44:  { name: 'Other Crops',           color: '#CC9999' },
  45:  { name: 'Sugarcane',             color: '#267000' },
  46:  { name: 'Sweet Potatoes',        color: '#702600' },
  47:  { name: 'Misc Vegs & Fruits',    color: '#FF6666' },
  48:  { name: 'Watermelons',           color: '#FF6666' },
  49:  { name: 'Onions',                color: '#FFCC66' },
  50:  { name: 'Cucumbers',             color: '#FF6666' },
  51:  { name: 'Chick Peas',            color: '#D2CCC2' },
  52:  { name: 'Lentils',               color: '#D2CCC2' },
  53:  { name: 'Peas',                  color: '#267000' },
  54:  { name: 'Tomatoes',              color: '#FF6666' },
  55:  { name: 'Caneberries',           color: '#FF6666' },
  56:  { name: 'Hops',                  color: '#267000' },
  57:  { name: 'Herbs',                 color: '#267000' },
  58:  { name: 'Clover/Wildflowers',    color: '#A5F28C' },
  59:  { name: 'Sod/Grass Seed',        color: '#A5F28C' },
  61:  { name: 'Fallow/Idle Cropland',  color: '#BFBF77' },
  63:  { name: 'Forest',                color: '#93CC93' },
  64:  { name: 'Shrubland',             color: '#C6D69C' },
  65:  { name: 'Barren',                color: '#CCBEA3' },
  81:  { name: 'Clouds/No Data',        color: '#999999' },
  82:  { name: 'Developed',             color: '#D3D3D3' },
  83:  { name: 'Water',                 color: '#4970A3' },
  87:  { name: 'Wetlands',              color: '#7CB3D6' },
  111: { name: 'Open Water',            color: '#4970A3' },
  112: { name: 'Perennial Ice/Snow',    color: '#E8E8E8' },
  121: { name: 'Developed/Open Space',  color: '#D3D3D3' },
  122: { name: 'Developed/Low Intensity', color: '#D3D3D3' },
  123: { name: 'Developed/Med Intensity', color: '#D3D3D3' },
  124: { name: 'Developed/High Intensity', color: '#D3D3D3' },
  131: { name: 'Barren',                color: '#CCBEA3' },
  141: { name: 'Deciduous Forest',      color: '#93CC93' },
  142: { name: 'Evergreen Forest',      color: '#93CC93' },
  143: { name: 'Mixed Forest',          color: '#93CC93' },
  152: { name: 'Shrubland',             color: '#C6D69C' },
  176: { name: 'Grassland/Pasture',     color: '#E8FFBF' },
  190: { name: 'Woody Wetlands',        color: '#7CAFAF' },
  195: { name: 'Herbaceous Wetlands',   color: '#7CB3D6' },
}

// Legend rows shown in the CSB overlay legend (ordered for ag relevance).
export const CDL_LEGEND_ROWS: { code: number; name: string; color: string }[] = [
  { code: 1,   name: 'Corn',                  color: '#FFD400' },
  { code: 5,   name: 'Soybeans',              color: '#267000' },
  { code: 24,  name: 'Winter Wheat',          color: '#A87000' },
  { code: 23,  name: 'Spring Wheat',          color: '#D8B56B' },
  { code: 36,  name: 'Alfalfa',               color: '#FFA8E3' },
  { code: 37,  name: 'Other Hay',             color: '#A5F28C' },
  { code: 176, name: 'Grassland/Pasture',     color: '#E8FFBF' },
  { code: 61,  name: 'Fallow/Idle',           color: '#BFBF77' },
  { code: -1,  name: 'Other Crops',           color: '#999999' },
]

/** Build a MapLibre fill-color expression for the CSB fields layer keyed on cdlYYYY. */
export function buildCropColorExpr(year: number): any {
  const prop = `cdl${year}`
  // Use 'case': code 0 or null → transparent; otherwise match against palette.
  const matchExpr: any[] = ['match', ['coalesce', ['get', prop], 0]]
  for (const [code, { color }] of Object.entries(CDL_PALETTE)) {
    matchExpr.push(Number(code), color)
  }
  // match fallback: unknown codes → Other Crops color.
  matchExpr.push('#999999')
  // Outer case: zero/null → transparent; non-zero → matched color.
  return [
    'case',
    ['<=', ['coalesce', ['get', prop], 0], 0],
    'rgba(0,0,0,0)',
    matchExpr,
  ]
}

