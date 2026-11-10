/**
 * Elevator cash grain bids on the Explore map (owner 11/6, 11/9).
 *
 * The backend copies Barchart's elevator list and bids into its own tables
 * on a schedule; this module only reads ours:
 *   GET /api/grain/elevators          every elevator, for the pin layer
 *   GET /api/grain/elevators/{id}     that elevator's bids + the 15 closest
 *                                     within 75 miles, each with its current bid
 *
 * Pin (owner 11/9): yellow map pin with a black grain bin, drawn on a canvas
 * here so it needs no sprite file. Zoomed in to about county level (owner
 * 11/10) it becomes a yellow price tag: the bin, then corn over beans with
 * the elevator's nearest-delivery cash price for each.
 */
import maplibregl from 'maplibre-gl'
import { fetchWithAuth } from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export const ELEVATOR_SOURCE = 'grain-elevators'
export const ELEVATOR_LAYER = 'grain-elevator-pins'
const PIN_IMAGE = 'gg-grain-bin-pin'
const TAG_IMAGE = 'gg-grain-price-tag'
/** Pin below this zoom, price tag at it and above (hundreds of tags overlap
 *  in a zoomed-out Iowa). */
export const TAG_ZOOM = 10
const PIN_FILL = '#FFD21F'
const PIN_INK = '#111111'
// Owner 11/10: a slight top-to-bottom gradient on the yellow, lighter above,
// the same yellow through the middle, a touch deeper at the bottom.
const PIN_FILL_TOP = '#FFE45C'
const PIN_FILL_BOTTOM = '#F2BF0A'

function yellowFill(ctx: CanvasRenderingContext2D, top: number, bottom: number): CanvasGradient {
  const g = ctx.createLinearGradient(0, top, 0, bottom)
  g.addColorStop(0, PIN_FILL_TOP)
  g.addColorStop(0.5, PIN_FILL)
  g.addColorStop(1, PIN_FILL_BOTTOM)
  return g
}

export interface ElevatorPin {
  id: number
  company: string | null
  name: string | null
  facility_type: string | null
  lat: number
  lng: number
  has_bids: boolean
  corn?: number | null
  beans?: number | null
}

export interface GrainBid {
  commodity: string
  delivery: string | null
  delivery_start: string | null
  delivery_end: string | null
  cash_price: number | null
  basis_cents: number | null
  futures_month: string | null
  change: number | null
  as_of: string | null
  bid_date: string
}

export interface Elevator {
  id: number
  company: string | null
  name: string | null
  facility_type: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  lat: number
  lng: number
  phone: string | null
  url: string | null
  distance_mi?: number
  bids: GrainBid[]
}

export interface ElevatorDetail {
  source: string
  updated_at: string | null
  radius_mi: number
  elevator: Elevator
  nearby: Elevator[]
}

export class GrainAccessError extends Error {}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetchWithAuth(`${API_URL}${path}`)
  if (res.status === 401 || res.status === 403) throw new GrainAccessError('Grain bids are included with a subscription.')
  if (!res.ok) throw new Error(`Could not load grain bids (${res.status}).`)
  return res.json()
}

export function getElevatorPins() {
  return getJson<{ source: string; elevators: ElevatorPin[] }>('/api/grain/elevators')
}

export function getElevatorDetail(id: number) {
  return getJson<ElevatorDetail>(`/api/grain/elevators/${id}`)
}

// ── formatting ──────────────────────────────────────────────────────────

/** "Corn (#2 Yellow)" → "Corn"; other grades keep their qualifier. */
export function commodityLabel(c: string): string {
  return c.replace(/\s*\(#2 Yellow\)$/, '')
}

export const fmtCash = (v: number | null) => (v == null ? '—' : `$${v.toFixed(2)}`)

/** Basis in cents against its futures month: "-38 Dec". */
export function fmtBasis(cents: number | null, futuresMonth: string | null): string {
  if (cents == null) return '—'
  const n = Math.round(cents)
  const month = futuresMonth ? ` ${futuresMonth.split(' ')[0]}` : ''
  return `${n > 0 ? '+' : ''}${n}${month}`
}

/** Change in dollars shown as cents: "-2¼". Quarter cents are common. */
export function fmtChange(v: number | null): string {
  if (v == null) return ''
  const cents = v * 100
  if (Math.abs(cents) < 0.01) return 'unch'
  const whole = Math.trunc(Math.abs(cents))
  const frac = Math.abs(cents) - whole
  const q = frac >= 0.625 ? '¾' : frac >= 0.375 ? '½' : frac >= 0.125 ? '¼' : ''
  return `${cents < 0 ? '-' : '+'}${whole}${q}`
}

export function fmtTime(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const sameDay = d.toDateString() === new Date().toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`
}

// ── map layer ───────────────────────────────────────────────────────────

/** Yellow teardrop pin, black grain bin (domed roof, ribbed body). Drawn at
 *  `s`x (the map registers the 2x one; the app's PNGs are this at 1-3x). */
export function drawPin(s = 2): ImageData {
  const w = 30 * s, h = 40 * s
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  const cx = w / 2, r = 13 * s, cy = r + 1.5 * s
  // Pin body
  ctx.beginPath()
  ctx.arc(cx, cy, r, Math.PI * 0.82, Math.PI * 0.18)
  ctx.quadraticCurveTo(cx + r * 0.55, cy + r * 1.25, cx, h - 1.5 * s)
  ctx.quadraticCurveTo(cx - r * 0.55, cy + r * 1.25, cx - r * Math.cos(Math.PI * 0.18), cy + r * Math.sin(Math.PI * 0.18))
  ctx.closePath()
  ctx.fillStyle = yellowFill(ctx, cy - r, h)
  ctx.fill()
  ctx.lineWidth = 1.5 * s
  ctx.strokeStyle = PIN_INK
  ctx.stroke()
  drawBin(ctx, cx, cy, s)
  return ctx.getImageData(0, 0, w, h)
}

/** Black grain bin (domed roof, ribbed body) whose whole outline, roof cap to
 *  base, is centred on cx, cy; `u` = px per unit. Owner 11/10: centred in
 *  the tag, not riding high. */
function drawBin(ctx: CanvasRenderingContext2D, cx: number, cyVisual: number, u: number) {
  ctx.fillStyle = PIN_INK
  // Measured from the body's own centre cy: cap top at cy - 11u, base at
  // cy + 4.5u, so the outline's middle is cy - 3.25u.
  const cy = cyVisual + 3.25 * u
  const bw = 12 * u, bx = cx - bw / 2, top = cy - 4.5 * u, bottom = cy + 4.5 * u
  ctx.beginPath()
  ctx.moveTo(bx - 1 * u, top)
  ctx.quadraticCurveTo(cx, top - 8 * u, bx + bw + 1 * u, top)
  ctx.closePath()
  ctx.fill()
  ctx.fillRect(cx - 1 * u, top - 6.5 * u, 2 * u, 2 * u)
  ctx.fillRect(bx, top + 1 * u, bw, bottom - top - 1 * u)
  ctx.fillStyle = PIN_FILL
  for (const y of [top + 3.5 * u, top + 6 * u]) ctx.fillRect(bx, y, bw, 0.9 * u)
}

// Price tag geometry in CSS px; the map draws the two prices as text, right
// aligned at TAG_PRICE_RIGHT, so one image serves every elevator.
const TAG_W = 104, TAG_BODY = 42, TAG_POINTER = 9
const TAG_PRICE_RIGHT = TAG_W - 7
const TAG_TEXT_SIZE = 12

/** Yellow tag, black outline, pointer at the bottom centre; bin, divider and
 *  the Corn / Beans labels on the left. */
export function drawTag(s = 2): ImageData {
  const w = TAG_W * s, h = (TAG_BODY + TAG_POINTER + 2) * s
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  const lw = 1.5 * s, x0 = lw / 2 + 0.5 * s, y0 = lw / 2 + 0.5 * s
  const x1 = w - x0, y1 = TAG_BODY * s, r = 7 * s, cx = w / 2
  ctx.beginPath()
  ctx.moveTo(x0 + r, y0)
  ctx.arcTo(x1, y0, x1, y1, r)
  ctx.arcTo(x1, y1, x0, y1, r)
  ctx.lineTo(cx + 6 * s, y1)
  ctx.lineTo(cx, (TAG_BODY + TAG_POINTER) * s)
  ctx.lineTo(cx - 6 * s, y1)
  ctx.arcTo(x0, y1, x0, y0, r)
  ctx.arcTo(x0, y0, x1, y0, r)
  ctx.closePath()
  ctx.fillStyle = yellowFill(ctx, y0, y1)
  ctx.fill()
  ctx.lineWidth = lw
  ctx.strokeStyle = PIN_INK
  ctx.lineJoin = 'round'
  ctx.stroke()
  drawBin(ctx, 15 * s, (y0 + y1) / 2, 1.3 * s)
  ctx.fillStyle = PIN_INK
  ctx.fillRect(29 * s, 7 * s, 1 * s, (TAG_BODY - 14) * s)
  ctx.font = `${10 * s}px "Open Sans", Arial, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillText('Corn', 35 * s, 12 * s)
  ctx.fillText('Beans', 35 * s, 30 * s)
  return ctx.getImageData(0, 0, w, h)
}

/** "4.22\n11.48"; a dash where the elevator posts no bid for that crop. */
export function tagText(p: Pick<ElevatorPin, 'corn' | 'beans'>): string {
  const f = (v?: number | null) => (v == null ? '—' : v.toFixed(2))
  return `${f(p.corn)}\n${f(p.beans)}`
}

export function ensureElevatorLayer(map: maplibregl.Map) {
  if (!map.hasImage(PIN_IMAGE)) {
    try { map.addImage(PIN_IMAGE, drawPin(), { pixelRatio: 2 }) } catch { /* added by a racing call */ }
  }
  if (!map.hasImage(TAG_IMAGE)) {
    try { map.addImage(TAG_IMAGE, drawTag(), { pixelRatio: 2 }) } catch { /* added by a racing call */ }
  }
  if (!map.getSource(ELEVATOR_SOURCE)) {
    map.addSource(ELEVATOR_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  }
  if (!map.getLayer(ELEVATOR_LAYER)) {
    map.addLayer({
      id: ELEVATOR_LAYER,
      type: 'symbol',
      source: ELEVATOR_SOURCE,
      minzoom: 7,
      layout: {
        // One layer, so every click / hover / layer-order rule that names
        // ELEVATOR_LAYER covers the tag too.
        'icon-image': ['step', ['zoom'], PIN_IMAGE, TAG_ZOOM, TAG_IMAGE],
        'icon-anchor': 'bottom',
        // One zoom curve only (MapLibre allows one per expression): the pin
        // grows to 0.85, then the tag takes over at full size.
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 9, 0.8, TAG_ZOOM - 0.01, 0.85, TAG_ZOOM, 1],
        'text-field': ['step', ['zoom'], '', TAG_ZOOM, ['get', 'tag']],
        'text-font': ['Open Sans Bold'],
        'text-size': TAG_TEXT_SIZE,
        'text-anchor': 'right',
        'text-justify': 'right',
        'text-line-height': 1.5,
        // From the pointer tip (the elevator) to the right end of the price
        // column, vertically centred on the two rows.
        'text-offset': [(TAG_PRICE_RIGHT - TAG_W / 2) / TAG_TEXT_SIZE, -(TAG_POINTER + TAG_BODY / 2) / TAG_TEXT_SIZE],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
        // Every elevator always draws (owner: a pin on every elevator). Most
        // sit in a town, so with collision on, the town's own label hid its
        // elevator (Roseville IL, 11/9); ignore-placement keeps the labels too.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      // An elevator with no bids in the last few days stays on the map, faded.
      paint: {
        'icon-opacity': ['case', ['get', 'has_bids'], 1, 0.5],
        'text-opacity': ['case', ['get', 'has_bids'], 1, 0.5],
        'text-color': PIN_INK,
      },
    })
  }
}

export function setElevatorPins(map: maplibregl.Map, pins: ElevatorPin[], visible: boolean) {
  ensureElevatorLayer(map)
  ;(map.getSource(ELEVATOR_SOURCE) as maplibregl.GeoJSONSource)?.setData({
    type: 'FeatureCollection',
    features: pins.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, has_bids: p.has_bids, company: p.company || '', name: p.name || '', tag: tagText(p) },
    })),
  } as any)
  map.setLayoutProperty(ELEVATOR_LAYER, 'visibility', visible ? 'visible' : 'none')
  // Keep the pins above every other layer (parcels, dots and tract pins are
  // added after the map loads, some of them later than this).
  try { map.moveLayer(ELEVATOR_LAYER) } catch { /* torn down */ }
}
