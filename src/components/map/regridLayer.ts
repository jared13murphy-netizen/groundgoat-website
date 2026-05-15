/**
 * Shared Regrid vector-tile layer wiring.
 *
 * Used by ExploreMap (browse view) and ComparablesMap (comp report
 * view). Same tiles, same click → popup behavior on both surfaces.
 *
 * The popup ALWAYS renders Owner / Address / Acres / Last Sale.
 * Missing values display as "—". Backend (`/api/regrid/parcel`) is
 * responsible for filling sale price from MyDec when Regrid has $0
 * or null for IL / IN / IA / NE parcels.
 */
import maplibregl from 'maplibre-gl'
import { fetchWithAuth } from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

export interface RegridConfig {
  tile_url_template: string
  is_sandbox: boolean
  has_token: boolean
  attribution: string
}

export async function fetchRegridConfig(): Promise<RegridConfig | null> {
  try {
    const res = await fetchWithAuth(`${API_URL}/api/regrid/config`)
    if (!res.ok) return null
    const data: RegridConfig = await res.json()
    if (data?.tile_url_template && data?.has_token) return data
    return null
  } catch {
    return null
  }
}

async function fetchRegridParcel(qs: URLSearchParams): Promise<any | null> {
  try {
    const res = await fetchWithAuth(`${API_URL}/api/regrid/parcel?${qs.toString()}`)
    if (!res.ok) return null
    const data = await res.json()
    return data?.parcel || null
  } catch {
    return null
  }
}

// ── Popup HTML helpers ──────────────────────────────────────────────
function fmtMoney(n: any): string {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  // $0 → "—": a recorded $0 deed isn't a market sale. (See backend
  // MyDec enrichment.)
  if (!isFinite(v) || v === 0) return '—'
  return '$' + Math.round(v).toLocaleString('en-US')
}
function fmtAcres(n: any): string {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  if (!isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' ac'
}
function fmtDate(s: any): string {
  if (!s) return '—'
  const d = new Date(String(s))
  if (isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
function esc(s: any): string {
  if (s === null || s === undefined) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}

function headerHTML(opts: { owner: string; acres: string | null; address: string; countyState: string }): string {
  const { owner, acres, address, countyState } = opts
  return `
    <div class="regrid-popup-owner">${esc(owner)}</div>
    ${address ? `<div class="regrid-popup-addr">${esc(address)}</div>` : ''}
    ${acres ? `<div class="regrid-popup-acres">${acres}</div>` : ''}
    ${countyState ? `<div class="regrid-popup-addr regrid-popup-addr-sub">${esc(countyState)}</div>` : ''}
  `
}

function regridLoadingHTML(tileProps: any): string {
  return `
    <div class="regrid-popup">
      ${headerHTML({
        owner: tileProps?.owner || 'Loading…',
        acres: null,
        address: tileProps?.address || '',
        countyState: '',
      })}
      <div class="regrid-popup-loading">Loading parcel details…</div>
    </div>
  `
}

function regridFallbackHTML(tileProps: any): string {
  return `
    <div class="regrid-popup">
      ${headerHTML({
        owner: tileProps?.owner || 'Unknown',
        acres: null,
        address: tileProps?.address || '',
        countyState: '',
      })}
    </div>
  `
}

function regridPopupHTML(record: any): string {
  const gisacre = record?.ll_gisacre ?? record?.gisacre
  const deeded = record?.deeded_acres
  const saleprice = record?.saleprice
  const saledate = record?.saledate
  const parval = record?.parval
  const landval = record?.landval
  const improvval = record?.improvval
  const yearbuilt = record?.yearbuilt
  const usedesc = esc(record?.usedesc || record?.usecode || '')
  const zoning = esc(record?.zoning_description || record?.zoning || '')
  const buildings = record?.ll_bldg_count
  const bldgSqft = record?.ll_bldg_footprint_sqft
  const mailadd = esc(record?.mailadd || '')

  const row = (label: string, value: string) =>
    `<div class="regrid-popup-row"><span>${label}</span><span>${value}</span></div>`

  const county = record?.county || ''
  const state = record?.state2 || record?.state || ''
  const countyState = [county, state].filter(Boolean).join(', ')

  return `
    <div class="regrid-popup">
      ${headerHTML({
        owner: record?.owner || 'Unknown',
        acres: fmtAcres(gisacre),
        address: record?.address || '',
        countyState,
      })}
      <div class="regrid-popup-section">
        <div class="regrid-popup-section-title">Last Sale</div>
        ${row('Price', fmtMoney(saleprice))}
        ${row('Date', fmtDate(saledate))}
      </div>
      ${(deeded && deeded !== gisacre) || usedesc || zoning ? `
        <div class="regrid-popup-section">
          ${deeded && deeded !== gisacre ? row('Deeded Acres', fmtAcres(deeded)) : ''}
          ${usedesc ? row('Use', usedesc) : ''}
          ${zoning ? row('Zoning', zoning) : ''}
        </div>` : ''}
      ${(parval || landval || improvval) ? `
        <div class="regrid-popup-section">
          <div class="regrid-popup-section-title">Assessed Value</div>
          ${parval ? row('Total', fmtMoney(parval)) : ''}
          ${landval ? row('Land', fmtMoney(landval)) : ''}
          ${improvval ? row('Improvements', fmtMoney(improvval)) : ''}
        </div>` : ''}
      ${(buildings || bldgSqft || yearbuilt) ? `
        <div class="regrid-popup-section">
          <div class="regrid-popup-section-title">Buildings</div>
          ${buildings ? row('Count', String(buildings)) : ''}
          ${bldgSqft ? row('Footprint', `${Math.round(bldgSqft).toLocaleString()} sq ft`) : ''}
          ${yearbuilt ? row('Year Built', String(yearbuilt)) : ''}
        </div>` : ''}
      ${mailadd ? `
        <div class="regrid-popup-section">
          <div class="regrid-popup-section-title">Mailing Address</div>
          <div class="regrid-popup-mailadd">${mailadd}</div>
        </div>` : ''}
    </div>
  `
}

// ── Layer mounting ──────────────────────────────────────────────────
export interface AddRegridLayerOptions {
  /** Layer-id beforeId so tract polygons paint on top. Optional. */
  beforeId?: string
  /** Minimum zoom at which the Regrid layer is visible. Default 14. */
  minZoom?: number
}

/** Adds the Regrid vector-tile source + fill / line / label layers to
 * the map, wires hover-highlight + click → popup, and returns a
 * cleanup function the caller invokes on unmount. */
export function addRegridLayer(
  map: maplibregl.Map,
  config: RegridConfig,
  options: AddRegridLayerOptions = {},
): () => void {
  const SOURCE_ID = 'regrid-parcels'
  const FILL_LAYER = 'regrid-parcels-fill'
  const LINE_LAYER = 'regrid-parcels-line'
  const LABEL_LAYER = 'regrid-parcels-label'
  const minzoom = options.minZoom ?? 14

  if (map.getSource(SOURCE_ID)) {
    // Already mounted (HMR or duplicate caller) — no-op cleanup.
    return () => {}
  }

  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [config.tile_url_template],
    minzoom,
    maxzoom: 21,
    promoteId: { parcels: 'll_uuid' },
    attribution: 'Parcel data &copy; <a href="https://regrid.com" target="_blank" rel="noopener">Regrid</a>',
  } as any)

  const beforeId = options.beforeId && map.getLayer(options.beforeId)
    ? options.beforeId
    : undefined

  map.addLayer({
    id: FILL_LAYER,
    type: 'fill',
    source: SOURCE_ID,
    'source-layer': 'parcels',
    minzoom,
    paint: {
      'fill-color': '#EC4899',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.22, 0.06],
    },
  }, beforeId)
  map.addLayer({
    id: LINE_LAYER,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'parcels',
    minzoom,
    paint: { 'line-color': '#000000', 'line-width': 2.2, 'line-opacity': 0.85 },
  }, beforeId)
  map.addLayer({
    id: LABEL_LAYER,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'parcels',
    minzoom,
    layout: {
      'text-field': [
        'format',
        ['coalesce', ['get', 'owner'], 'Coming Soon'], {
          'font-scale': 1.0,
          'text-font': ['literal', ['Open Sans Bold']],
        },
        [
          'case',
          ['has', 'll_gisacre'],
          ['concat', '\n', ['concat',
            ['number-format', ['get', 'll_gisacre'], { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }],
            ' ac',
          ]],
          ['case', ['has', 'gisacre'],
            ['concat', '\n', ['concat',
              ['number-format', ['get', 'gisacre'], { 'min-fraction-digits': 1, 'max-fraction-digits': 1 }],
              ' ac',
            ]],
            '',
          ],
        ],
        { 'font-scale': 0.85 },
      ],
      'text-font': ['Open Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 16, 12, 18, 14],
      'text-anchor': 'center', 'text-justify': 'center',
      'text-max-width': 9, 'text-line-height': 1.15,
      'text-allow-overlap': false, 'text-ignore-placement': false,
      'text-padding': 2,
    },
    paint: {
      'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)',
      'text-halo-width': 1.4, 'text-halo-blur': 0.4,
    },
  }, beforeId)

  // Hover highlight (toggles fill-opacity via feature-state).
  let hoveredUuid: string | null = null
  const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
    if (!e.features?.length) return
    map.getCanvas().style.cursor = 'pointer'
    const newUuid = (e.features[0].properties as any)?.ll_uuid as string | undefined
    if (!newUuid || newUuid === hoveredUuid) return
    if (hoveredUuid) {
      map.setFeatureState({ source: SOURCE_ID, sourceLayer: 'parcels', id: hoveredUuid }, { hover: false })
    }
    hoveredUuid = newUuid
    map.setFeatureState({ source: SOURCE_ID, sourceLayer: 'parcels', id: hoveredUuid }, { hover: true })
  }
  const onLeave = () => {
    map.getCanvas().style.cursor = ''
    if (hoveredUuid) {
      map.setFeatureState({ source: SOURCE_ID, sourceLayer: 'parcels', id: hoveredUuid }, { hover: false })
      hoveredUuid = null
    }
  }

  // Click → fetch Premium Schema record + open popup.
  const onClick = async (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
    const f = e.features?.[0]
    if (!f) return
    const props: any = f.properties || {}
    const ll_uuid = props.ll_uuid as string | undefined
    const lng = e.lngLat.lng
    const lat = e.lngLat.lat

    const popup = new maplibregl.Popup({
      closeButton: true, closeOnClick: true, maxWidth: '320px',
      className: 'regrid-parcel-popup',
    })
      .setLngLat(e.lngLat)
      .setHTML(regridLoadingHTML(props))
      .addTo(map)

    const qs = new URLSearchParams()
    if (ll_uuid) qs.set('ll_uuid', ll_uuid)
    else { qs.set('lat', String(lat)); qs.set('lng', String(lng)) }
    const record = await fetchRegridParcel(qs)
    popup.setHTML(record ? regridPopupHTML(record) : regridFallbackHTML(props))
  }

  map.on('mousemove', FILL_LAYER, onMove)
  map.on('mouseleave', FILL_LAYER, onLeave)
  map.on('click', FILL_LAYER, onClick)

  return () => {
    try {
      if (!map.getStyle()) return
      map.off('mousemove', FILL_LAYER, onMove)
      map.off('mouseleave', FILL_LAYER, onLeave)
      map.off('click', FILL_LAYER, onClick)
      for (const id of [LABEL_LAYER, LINE_LAYER, FILL_LAYER]) {
        if (map.getLayer(id)) map.removeLayer(id)
      }
      if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID)
    } catch {
      // map already torn down
    }
  }
}
