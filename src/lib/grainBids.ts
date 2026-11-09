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
 * here so it needs no sprite file.
 */
import maplibregl from 'maplibre-gl'
import { fetchWithAuth } from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export const ELEVATOR_SOURCE = 'grain-elevators'
export const ELEVATOR_LAYER = 'grain-elevator-pins'
const PIN_IMAGE = 'gg-grain-bin-pin'
const PIN_FILL = '#FFD21F'
const PIN_INK = '#111111'

export interface ElevatorPin {
  id: number
  company: string | null
  name: string | null
  facility_type: string | null
  lat: number
  lng: number
  has_bids: boolean
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

/** Yellow teardrop pin, black grain bin (domed roof, ribbed body). */
function drawPin(): ImageData {
  const s = 2 // drawn at 2x, registered with pixelRatio 2
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
  ctx.fillStyle = PIN_FILL
  ctx.fill()
  ctx.lineWidth = 1.5 * s
  ctx.strokeStyle = PIN_INK
  ctx.stroke()
  // Grain bin
  ctx.fillStyle = PIN_INK
  const bw = 12 * s, bx = cx - bw / 2, top = cy - 2 * s, bottom = cy + 7 * s
  ctx.beginPath() // roof
  ctx.moveTo(bx - 1 * s, top)
  ctx.quadraticCurveTo(cx, top - 8 * s, bx + bw + 1 * s, top)
  ctx.closePath()
  ctx.fill()
  ctx.fillRect(cx - 1 * s, top - 6.5 * s, 2 * s, 2 * s) // roof cap
  ctx.fillRect(bx, top + 1 * s, bw, bottom - top - 1 * s) // body
  ctx.fillStyle = PIN_FILL // ribs
  for (const y of [top + 3.5 * s, top + 6 * s]) ctx.fillRect(bx, y, bw, 0.9 * s)
  return ctx.getImageData(0, 0, w, h)
}

export function ensureElevatorLayer(map: maplibregl.Map) {
  if (!map.hasImage(PIN_IMAGE)) {
    try { map.addImage(PIN_IMAGE, drawPin(), { pixelRatio: 2 }) } catch { /* added by a racing call */ }
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
        'icon-image': PIN_IMAGE,
        'icon-anchor': 'bottom',
        'icon-size': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 9, 0.8, 12, 1],
        // Every elevator always draws (owner: a pin on every elevator). Most
        // sit in a town, so with collision on, the town's own label hid its
        // elevator (Roseville IL, 11/9); ignore-placement keeps the labels too.
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      // An elevator with no bids in the last few days stays on the map, faded.
      paint: { 'icon-opacity': ['case', ['get', 'has_bids'], 1, 0.5] },
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
      properties: { id: p.id, has_bids: p.has_bids, company: p.company || '', name: p.name || '' },
    })),
  } as any)
  map.setLayoutProperty(ELEVATOR_LAYER, 'visibility', visible ? 'visible' : 'none')
  // Keep the pins above every other layer (parcels, dots and tract pins are
  // added after the map loads, some of them later than this).
  try { map.moveLayer(ELEVATOR_LAYER) } catch { /* torn down */ }
}
