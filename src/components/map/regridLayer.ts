/**
 * Shared Regrid vector-tile layer wiring.
 *
 * Used by ExploreMap (browse view AND comp-mode; the comp report view
 * is comp mode inside ExploreMap, not a separate component). Same
 * tiles, same click → popup behavior on both.
 *
 * The popup ALWAYS renders Owner / Address / Acres / Last Sale.
 * Missing values display as "—". Regrid is the ONLY source of parcel sale
 * data (owner rule 11/19): the backend never fills a price from state
 * declarations (MyDec / SDF / IA / NE).
 */
import maplibregl from 'maplibre-gl'
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import { parcelFigures, figDisplay, figShown } from '@/lib/parcelFigures'
import { parcelLabelSegments } from '@/lib/parcelLabel'
import {
  parcelSourceSpecs, parcelLayerId, setParcelFeatureState, type StateTilesConfig,
} from '@/lib/parcelSources'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export interface RegridConfig {
  tile_url_template: string
  // Internal MVT layer name. Default Regrid tile uses 'parcels';
  // custom-source tiles use the source UUID. Fall back to 'parcels'
  // for any deploy where the backend hasn't been updated yet.
  source_layer?: string
  is_sandbox: boolean
  has_token: boolean
  attribution: string
  // State-plan gate. unlimited=true → no filter; otherwise show only
  // parcels whose `path` starts with /us/<one of these>/.
  unlimited?: boolean
  subscribed_state_abbrevs?: string[]
  // Pre-built per-state parcel archives (STATE_TILES_CONTRACT.md §3).
  // Present → one source per state; absent → the legacy single source.
  state_tiles?: StateTilesConfig | null
}

// Build the MapLibre filter expression that hides parcels outside
// the user's subscribed state(s). The Regrid custom tile carries
// `path` = "/us/<state>/<county>/..." in lowercase. Slice positions
// 4–6 yields the 2-letter state. Returns `null` when no filter
// should apply (unlimited or unknown).
export function buildRegridStateFilter(config: RegridConfig | null): any | null {
  if (!config) return null
  if (config.unlimited) return null
  const states = (config.subscribed_state_abbrevs || []).map((s) => s.toLowerCase())
  if (states.length === 0) return null
  return ['in', ['slice', ['get', 'path'], 4, 6], ['literal', states]]
}

export async function fetchRegridConfig(): Promise<RegridConfig | null> {
  try {
    // header_auth=1 → backend returns a clean tile_url_template with no
    // embedded ?t= token; auth is sent via Authorization header in
    // transformRequest instead. Accept the config as long as
    // tile_url_template is present — has_token will be false in this mode.
    const res = await fetchWithAuth(`${API_URL}/api/regrid/config?header_auth=1`)
    if (!res.ok) return null
    const data: RegridConfig = await res.json()
    if (data?.tile_url_template) return data
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
// All formatters return `null` when the value is missing/zero, so the
// HTML builder can simply skip the row instead of writing "—".
function fmtMoney(n: any): string | null {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  // $0 → null: a recorded $0 deed isn't a market sale.
  if (!isFinite(v) || v === 0) return null
  return '$' + Math.round(v).toLocaleString('en-US')
}
function fmtAcres(n: any): string | null {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  if (!isFinite(v) || v <= 0) return null
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' ac'
}
function esc(s: any): string {
  if (s === null || s === undefined) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!))
}

// Common Regrid deed-instrument codes → human-readable labels. The
// field name varies by dataset (salestype, saletype, instrument,
// recordtype, legaldoc) — we try each in `firstNonEmpty` below. The
// instrument tells you whether a recorded sale is an arms-length
// market transaction or a family/legal transfer (which has no relation
// to market price). Knowing that distinction is the whole point — a
// $93k sale on 40 ac is almost certainly a quit-claim or trust
// transfer, not a market comp.
const INSTRUMENT_LABELS: Record<string, string> = {
  WD: 'Warranty Deed',
  SWD: 'Special Warranty Deed',
  GWD: 'General Warranty Deed',
  QC: 'Quit Claim',
  QCD: 'Quit Claim Deed',
  TR: 'Trust Transfer',
  TRD: 'Trust Deed',
  TRUST: 'Trust Transfer',
  GFT: 'Gift Deed',
  GD: 'Gift Deed',
  TXD: 'Tax Deed',
  TAX: 'Tax Deed',
  CFD: 'Contract for Deed',
  PR: 'Personal Representative Deed',
  PRD: 'Personal Representative Deed',
  EXE: "Executor's Deed",
  ADM: "Administrator's Deed",
  SHF: "Sheriff's Deed",
  REL: 'Release',
  CD: 'Correction Deed',
  FORE: 'Foreclosure',
  AUC: 'Auction',
  ML: 'MLS',
}
function fmtSaleType(raw: any): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  const code = s.toUpperCase().replace(/[^A-Z]/g, '')
  if (INSTRUMENT_LABELS[code]) return INSTRUMENT_LABELS[code]
  // Otherwise return the original value (Regrid sometimes already
  // gives a readable description).
  return s
}
function firstNonEmpty(...vals: any[]): any {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}

// Task #26 defect-2 parity (round-2 audit WARN): mirrors LandDetailPanel.tsx's
// hasMeaningfulRecord test. A parcel-fill click whose lookup resolves to no
// real owner/address/acres/sale figure must not show the "Unknown" fallback
// shell — same empty-panel-is-worse-than-no-panel rule as ExploreMap.
function hasMeaningfulRecord(record: any): boolean {
  const owner = record?.owner
  const address = record?.address
  const gisacre = record?.ll_gisacre ?? record?.gisacre ?? null
  const saleprice = record?.saleprice
  return !!(
    (typeof owner === 'string' && owner.trim()) ||
    (typeof address === 'string' && address.trim()) ||
    (typeof gisacre === 'number' && gisacre > 0) ||
    (typeof saleprice === 'number' && saleprice > 0)
  )
}

// ── New popup design — mirrors the comp-report popup ────────────────
// Dark gradient header (charcoal w/ pink accent label), light hero
// stat strip (Acres / $-per-Acre / Sale Price), then white detail
// sections. Only renders rows whose underlying value is present.

const POPUP_WIDTH = 320

function popupHeader(opts: {
  label: string
  owner: string
  address: string
  countyState: string
}): string {
  const { label, owner, address, countyState } = opts
  return `
    <div style="
      padding: 14px 38px 12px 16px;
      background: linear-gradient(135deg, #1f1f23 0%, #2a2a30 100%);
      color: #fff;
    ">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:#F58CDE;margin-bottom:4px;">${esc(label)}</div>
      <div style="font-size:14px;font-weight:700;line-height:1.3;color:#fff;word-wrap:break-word;">${esc(owner)}</div>
      ${address ? `<div style="font-size:12px;color:rgba(255,255,255,0.65);margin-top:4px;line-height:1.3;">${esc(address)}</div>` : ''}
      ${countyState ? `<div style="font-size:11px;color:rgba(255,255,255,0.45);margin-top:2px;">${esc(countyState)}</div>` : ''}
    </div>
  `
}

function popupShell(inner: string): string {
  return `<div style="background:#fff;color:#1a1a1a;width:${POPUP_WIDTH}px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">${inner}</div>`
}

function detailRow(label: string, value: string): string {
  return `
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:5px 0;font-size:12.5px;border-bottom:1px solid rgba(0,0,0,0.04);">
      <span style="color:#888;font-weight:500;">${esc(label)}</span>
      <span style="color:#1a1a1a;font-weight:600;text-align:right;">${esc(value)}</span>
    </div>
  `
}

function section(title: string, rows: string[]): string {
  if (!rows.length) return ''
  return `
    <div style="padding:12px 16px 4px;">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#F58CDE;margin-bottom:4px;">${esc(title)}</div>
      ${rows.join('')}
    </div>
  `
}

function regridLoadingHTML(tileProps: any): string {
  return popupShell(
    popupHeader({
      label: 'Parcel',
      owner: tileProps?.owner || 'Loading…',
      address: tileProps?.address || '',
      countyState: '',
    }) +
    `<div style="padding:14px 16px;font-style:italic;color:rgba(0,0,0,0.5);font-size:12px;">Loading parcel details…</div>`,
  )
}

function regridFallbackHTML(tileProps: any): string {
  return popupShell(popupHeader({
    label: 'Parcel',
    owner: tileProps?.owner || 'Unknown',
    address: tileProps?.address || '',
    countyState: '',
  }))
}

function regridPopupHTML(record: any): string {
  // Acres / price / $ per acre: the server's print strings, verbatim (owner
  // 11/20). Never computed or re-formatted here.
  const fig = parcelFigures(record)
  const deeded = record?.deeded_acres
  const parval = record?.parval
  const landval = record?.landval
  const improvval = record?.improvval
  const yearbuilt = record?.yearbuilt
  const usedesc = record?.usedesc || record?.usecode || ''
  const zoning = record?.zoning_description || record?.zoning || ''
  const buildings = record?.ll_bldg_count
  const bldgSqft = record?.ll_bldg_footprint_sqft
  const mailadd = record?.mailadd || ''

  // Sale type / deed instrument — Regrid's field name varies by
  // dataset; try all the common ones.
  const saleType = fmtSaleType(firstNonEmpty(
    record?.salestype, record?.saletype, record?.recordtype,
    record?.instrument, record?.legaldoc, record?.transrec,
    record?.deed_type,
  ))

  const county = record?.county || ''
  const state = record?.state2 || record?.state || ''
  const countyState = [county, state].filter(Boolean).join(', ')

  // Hero stat strip — Acres, $/Acre, Sale Price. Each cell rendered
  // only if its value is present; row hidden entirely if all three
  // are missing.
  // price_mode "total" (owner 11/4, decided server-side): the Sale Price
  // cell leads and $ / Acre is dropped.
  const acresLabel = figShown(figDisplay(fig, 'acres')) ? `${figDisplay(fig, 'acres')} ac` : null
  const priceLabel = figShown(figDisplay(fig, 'price')) ? figDisplay(fig, 'price') : null
  const ppaLabel = fig.priceMode !== 'total' && figShown(figDisplay(fig, 'price_per_acre')) ? figDisplay(fig, 'price_per_acre') : null

  const heroCells: { label: string; value: string; emphasize?: boolean }[] = []
  if (acresLabel) heroCells.push({ label: 'Acres', value: acresLabel })
  if (ppaLabel) heroCells.push({ label: '$ / Acre', value: ppaLabel, emphasize: true })
  if (priceLabel) heroCells.push({ label: 'Sale Price', value: priceLabel, emphasize: fig.priceMode === 'total' })

  const heroHTML = heroCells.length === 0 ? '' : (() => {
    const cellHTML = heroCells.map((c, i) => {
      const isFirst = i === 0
      const isLast = i === heroCells.length - 1
      const align = isFirst && !c.emphasize ? 'left'
        : isLast && !c.emphasize ? 'right'
        : 'center'
      return `
        <div style="
          flex:${c.emphasize ? 1.4 : 1};
          text-align:${align};
          border-left:${isFirst ? 'none' : '1px solid rgba(0,0,0,0.06)'};
          padding-left:${isFirst ? 0 : 8}px;
          padding-right:${isLast ? 0 : 8}px;
        ">
          <div style="font-size:9.5px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${c.emphasize ? '#F58CDE' : '#888'};">${esc(c.label)}</div>
          <div style="font-size:${c.emphasize ? 19 : 15}px;font-weight:${c.emphasize ? 800 : 700};color:#1a1a1a;margin-top:2px;letter-spacing:${c.emphasize ? -0.3 : 0}px;">${esc(c.value)}</div>
        </div>
      `
    }).join('')
    return `<div style="display:flex;padding:14px 16px 12px;border-bottom:1px solid rgba(0,0,0,0.06);background:#fafbfc;">${cellHTML}</div>`
  })()

  // Sections — each filtered to only include populated rows. The
  // section header itself is hidden if no rows survive.
  const lastSaleRows: string[] = []
  if (figShown(figDisplay(fig, 'sale_date'))) lastSaleRows.push(detailRow('Date', figDisplay(fig, 'sale_date')))
  if (saleType) lastSaleRows.push(detailRow('Sale Type', saleType))

  const propertyRows: string[] = []
  if (deeded && deeded !== fig.acres && fmtAcres(deeded)) {
    propertyRows.push(detailRow('Deeded Acres', fmtAcres(deeded)!))
  }
  if (usedesc) propertyRows.push(detailRow('Use', String(usedesc)))
  if (zoning) propertyRows.push(detailRow('Zoning', String(zoning)))

  const assessedRows: string[] = []
  if (fmtMoney(parval)) assessedRows.push(detailRow('Total', fmtMoney(parval)!))
  if (fmtMoney(landval)) assessedRows.push(detailRow('Land', fmtMoney(landval)!))
  if (fmtMoney(improvval)) assessedRows.push(detailRow('Improvements', fmtMoney(improvval)!))

  const buildingRows: string[] = []
  if (buildings) buildingRows.push(detailRow('Count', String(buildings)))
  if (bldgSqft) buildingRows.push(detailRow('Footprint', `${Math.round(bldgSqft).toLocaleString()} sq ft`))
  if (yearbuilt) buildingRows.push(detailRow('Year Built', String(yearbuilt)))

  const mailadrHTML = mailadd
    ? `
      <div style="padding:12px 16px 14px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#F58CDE;margin-bottom:4px;">Mailing Address</div>
        <div style="color:rgba(0,0,0,0.8);font-size:12.5px;line-height:1.45;">${esc(mailadd)}</div>
      </div>`
    : ''

  return popupShell(
    popupHeader({
      label: 'Parcel',
      owner: record?.owner || 'Unknown',
      address: record?.address || '',
      countyState,
    }) +
    heroHTML +
    section('Last Sale', lastSaleRows) +
    section('Property', propertyRows) +
    section('Assessed Value', assessedRows) +
    section('Buildings', buildingRows) +
    mailadrHTML,
  )
}

// ── Layer mounting ──────────────────────────────────────────────────
export interface AddRegridLayerOptions {
  /** Layer-id beforeId so tract polygons paint on top. Optional. */
  beforeId?: string
  /** Minimum zoom at which boundaries/fill are visible. Default 14. */
  minZoom?: number
  /** Minimum zoom at which the owner/acres/$/date text label renders.
   *  Kept separate from minZoom (and higher) so boundaries can appear
   *  at browse zoom without the dense text cluttering the map.
   *  Default 14. */
  labelMinZoom?: number
  /** When false, skip the built-in fill hover-highlight + click→popup
   *  wiring so the caller owns all interaction. The Comparables map sets
   *  this false and drives its own "+" button click instead. Default true. */
  interactive?: boolean
}

/** Adds the Regrid vector-tile source + fill / line / label layers to
 * the map, wires hover-highlight + click → popup, and returns a
 * cleanup function the caller invokes on unmount. */
export function addRegridLayer(
  map: maplibregl.Map,
  config: RegridConfig,
  options: AddRegridLayerOptions = {},
): () => void {
  // Default 14 — callers that want the lower Regrid tile floor (z=11,
  // see ExploreMap.tsx REGRID_MIN_ZOOM comment) pass minZoom explicitly.
  const minzoom = options.minZoom ?? 14
  // Label sub-layer stays gated higher — dense owner/acres/$/date text
  // only once the user is meaningfully zoomed in.
  const labelMinzoom = options.labelMinZoom ?? 14
  // One source per state when the config carries state_tiles, else the
  // legacy single 'regrid-parcels' source (src/lib/parcelSources.ts).
  const specs = parcelSourceSpecs(config, { legacyMinzoom: minzoom, legacyMaxzoom: 14 })
  if (!specs.length) return () => {}
  const sourceLayer = specs[0].sourceLayer
  const FILL_LAYERS = specs.map((sp) => parcelLayerId(sp, 'fill'))

  if (specs.some((sp) => map.getSource(sp.id))) {
    // Already mounted (HMR or duplicate caller) — no-op cleanup.
    return () => {}
  }

  for (const sp of specs) map.addSource(sp.id, sp.source as any)

  const beforeId = options.beforeId && map.getLayer(options.beforeId)
    ? options.beforeId
    : undefined

  // State-plan gate filter — null = no filter (unlimited users).
  const stateFilter = buildRegridStateFilter(config)

  for (const sp of specs) map.addLayer({
    id: parcelLayerId(sp, 'fill'),
    type: 'fill',
    source: sp.id,
    'source-layer': sp.sourceLayer,
    minzoom,
    ...(stateFilter ? { filter: stateFilter } : {}),
    paint: {
      'fill-color': '#EC4899',
      'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.22, 0.06],
    },
  }, beforeId)
  for (const sp of specs) map.addLayer({
    id: parcelLayerId(sp, 'line'),
    type: 'line',
    source: sp.id,
    'source-layer': sp.sourceLayer,
    minzoom,
    ...(stateFilter ? { filter: stateFilter } : {}),
    paint: { 'line-color': '#000000', 'line-width': 2.2, 'line-opacity': 0.85 },
  }, beforeId)
  for (const sp of specs) map.addLayer({
    id: parcelLayerId(sp, 'label'),
    type: 'symbol',
    source: sp.id,
    'source-layer': sp.sourceLayer,
    minzoom: labelMinzoom,
    ...(stateFilter ? { filter: stateFilter } : {}),
    layout: {
      // Four segments: owner (bold) → acres → sale price → sale date.
      // Conditional segments render '' when the underlying property is
      // missing so a parcel without sale data doesn't show a "Sale: $-"
      // row or a stray newline. Same expression as ExploreMap.tsx so
      // Explore and Comparables maps stay visually identical.
      'text-field': [
        'format',
        ['coalesce', ['get', 'owner'], 'Coming Soon'], {
          'font-scale': 1.0,
          'text-font': ['literal', ['Open Sans Bold']],
        },
        // Acres / $ per acre (or total price) / sale date: the server's
        // gg_label_* strings, printed as sent (src/lib/parcelLabel.ts).
        ...parcelLabelSegments('Sale Date: '),
      ],
      'text-font': ['Open Sans Regular'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 14, 10, 16, 12, 18, 14],
      // Anchor at top + text-offset so the label grows DOWN from the
      // polygon centroid. Pin layers (if any caller adds them) can
      // then sit at the centroid without overlapping the label.
      'text-anchor': 'top', 'text-justify': 'center',
      'text-offset': [0, 1.6],
      'text-max-width': 9, 'text-line-height': 1.15,
      'text-allow-overlap': false, 'text-ignore-placement': false,
      'text-padding': 2,
    },
    paint: {
      'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.85)',
      'text-halo-width': 1.4, 'text-halo-blur': 0.4,
    },
  }, beforeId)

  // Push the host's tract polygon layers to the TOP of the layer
  // stack — beforeId='tract-polygon-fill' above only works when the
  // tract layer mounted first. If Regrid loaded first, the tract gets
  // covered. moveLayer w/o second arg lifts the layer to the top.
  if (map.getLayer('tract-polygon-fill')) map.moveLayer('tract-polygon-fill')
  if (map.getLayer('tract-polygon-line')) map.moveLayer('tract-polygon-line')

  // Hover highlight (toggles fill-opacity via feature-state). Keyed on
  // `path` (promoted above) — NOT ll_uuid, which custom Regrid tiles
  // never populate on the tile feature itself.
  let hoveredPath: string | null = null
  const onMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
    if (!e.features?.length) return
    map.getCanvas().style.cursor = 'pointer'
    const newPath = (e.features[0].properties as any)?.path as string | undefined
    if (!newPath || newPath === hoveredPath) return
    if (hoveredPath) setParcelFeatureState(map, hoveredPath, [sourceLayer], { hover: false })
    hoveredPath = newPath
    setParcelFeatureState(map, newPath, [sourceLayer], { hover: true })
  }
  const onLeave = () => {
    map.getCanvas().style.cursor = ''
    if (hoveredPath) {
      setParcelFeatureState(map, hoveredPath, [sourceLayer], { hover: false })
      hoveredPath = null
    }
  }

  // Click → fetch Premium Schema record + open popup.
  const onClick = async (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
    const f = e.features?.[0]
    if (!f) return
    // A tract ALWAYS wins over the parcel underneath it. If a tract polygon or
    // pin sits under this click, its own handler opens the tract details — do
    // NOT also open the Regrid parcel popup for land that has a tract on top.
    const tractLayers = ['tract-polygon-fill', 'tract-pin-circles'].filter(id => map.getLayer(id))
    if (tractLayers.length) {
      try {
        if (map.queryRenderedFeatures(e.point, { layers: tractLayers }).length) return
      } catch {/* layer torn down mid-click */}
    }
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
    // Task #26 defect-2 parity: a lookup that resolves to nothing meaningful
    // (no owner/address/acres/sale figure on the record OR the tile props)
    // must not show the "Unknown" fallback shell — close the popup instead,
    // same rule LandDetailPanel.tsx applies on the Explore map.
    if (!hasMeaningfulRecord(record) && !hasMeaningfulRecord(props)) {
      popup.remove()
      return
    }
    popup.setHTML(record ? regridPopupHTML(record) : regridFallbackHTML(props))
  }

  const interactive = options.interactive !== false
  if (interactive) {
    map.on('mousemove', FILL_LAYERS, onMove)
    map.on('mouseleave', FILL_LAYERS, onLeave)
    map.on('click', FILL_LAYERS, onClick)
  }

  return () => {
    try {
      if (!map.getStyle()) return
      if (interactive) {
        map.off('mousemove', FILL_LAYERS, onMove)
        map.off('mouseleave', FILL_LAYERS, onLeave)
        map.off('click', FILL_LAYERS, onClick)
      }
      for (const sp of specs) {
        for (const kind of ['label', 'line', 'fill'] as const) {
          const id = parcelLayerId(sp, kind)
          if (map.getLayer(id)) map.removeLayer(id)
        }
        if (map.getSource(sp.id)) map.removeSource(sp.id)
      }
    } catch {
      // map already torn down
    }
  }
}
