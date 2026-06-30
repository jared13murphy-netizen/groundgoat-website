import type { ApiMapTract } from './exploreMapTypes'
import type { StateAggregate } from './mapTypes'
import { STATE_ABBR, STATE_BOUNDS, STATE_CENTERS, STATE_NAMES, derivePinStatus } from './mapConstants'
import { formatAcres } from '@/lib/format'

function getStateAbbr(state: string): string {
  return STATE_ABBR[state] || state
}

// Display formatters — kept consistent with the shared formatAcres/formatCurrency
// so the native symbol-layer labels read exactly like the sidebar labels.
// (We pre-format here instead of in a MapLibre number-format expression because
// maplibre's number-format can't do "$1,234,567" + "/ac" / "1,234.567 ac" cleanly.)
function fmtCurrency(amount: number | null | undefined): string {
  if (!amount) return '—'
  return '$' + Math.round(amount).toLocaleString('en-US')
}
function fmtAcres(acres: number | null | undefined): string {
  return formatAcres(acres)
}

function getPolygonCentroid(polygon: [number, number][]): [number, number] {
  let sumLng = 0, sumLat = 0
  for (const [lng, lat] of polygon) {
    sumLng += lng
    sumLat += lat
  }
  return [sumLng / polygon.length, sumLat / polygon.length]
}

// A tract boundary is one ring [[lng,lat],...] (legacy) or a list of rings
// [[[lng,lat],...],...] for a multi-piece tract. toRings normalizes either to a
// list of rings (a single ring → one-element list).
type Ring = [number, number][]
function toRings(coords: any): Ring[] {
  if (!Array.isArray(coords) || coords.length === 0) return []
  const first = coords[0]
  if (Array.isArray(first) && typeof first[0] === 'number') return [coords as Ring]
  return (coords as any[]).filter((r) => Array.isArray(r) && r.length >= 3) as Ring[]
}
function closeRing(ring: Ring): Ring {
  if (ring.length < 3) return ring
  const f = ring[0]; const l = ring[ring.length - 1]
  return (f[0] !== l[0] || f[1] !== l[1]) ? [...ring, [f[0], f[1]]] : ring
}

export function buildExplorePointGeoJSON(tracts: ApiMapTract[]): GeoJSON.FeatureCollection {
  const filtered = tracts.filter(t => t.latitude != null && t.longitude != null)

  // Handle co-located tracts with offset
  const coordCounts: Record<string, number> = {}

  return {
    type: 'FeatureCollection',
    features: filtered.map(t => {
      let lng = t.longitude!
      let lat = t.latitude!

      // Use polygon centroid for point placement if available. For a
      // multi-piece tract, place the dot on the LARGEST piece's centroid.
      const rings = toRings(t.polygon_coordinates).filter(r => r.length >= 3)
      if (rings.length) {
        const biggest = rings.reduce((a, b) => (b.length > a.length ? b : a))
        const centroid = getPolygonCentroid(biggest)
        lng = centroid[0]
        lat = centroid[1]
      }

      // Offset co-located points
      const key = `${lat.toFixed(4)},${lng.toFixed(4)}`
      const index = coordCounts[key] || 0
      coordCounts[key] = index + 1
      if (index > 0) {
        const offset = 0.003
        const angle = index * (2 * Math.PI / 6)
        lng += offset * Math.cos(angle)
        lat += offset * Math.sin(angle)
      }

      const hasPolygon = rings.length > 0
      const dataResolution = hasPolygon ? 'polygon' : 'point'

      // Private-treaty listings (status=listed) show asking-price/acre.
      // Pending auctions also fall back to asking_price/acre when set.
      // Otherwise use the recorded sale_price/acre.
      const isPrivateTreaty = (t.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = t.sale_status?.toLowerCase() === 'pending'
      const displayPricePerAcre = (isPrivateTreaty || isPending) && t.asking_price && t.total_acres
        ? t.asking_price / t.total_acres
        : t.price_per_acre

      // Pre-format the label exactly as the old DOM marker did:
      //   line 1: "$1,234/ac"  (only when pricePerAcre is truthy)
      //   line 2: "123.4 ac"   (only when total_acres is truthy)
      // The native tract-pin-labels symbol layer renders this string
      // verbatim via text-field=['get','pinLabel'].
      const labelLines: string[] = []
      if (displayPricePerAcre) labelLines.push(`${fmtCurrency(displayPricePerAcre)}/ac`)
      if (t.total_acres) labelLines.push(`${fmtAcres(t.total_acres)} ac`)
      const pinLabel = labelLines.join('\n')

      return {
        type: 'Feature' as const,
        // feature.id is REQUIRED for setFeatureState (report highlight /
        // comp-visibility). MapLibre feature-state keys on the top-level id.
        id: t.id,
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat],
        },
        properties: {
          tractId: t.id,
          listingId: t.listing_id,
          pinLabel,
          totalAcres: t.total_acres,
          tillableAcres: t.tillable_acres,
          salePrice: t.sale_price,
          pricePerAcre: displayPricePerAcre,
          askingPrice: t.asking_price,
          status: derivePinStatus(t.sale_status, t.listing_type),
          dataResolution,
          companyName: t.company_name || 'Unknown',
          county: t.county,
          state: t.state,
          stateAbbr: getStateAbbr(t.state),
          auctionDate: t.auction_date,
          township: t.township,
          listingType: t.listing_type,
          soilRating: t.soil_rating,
          pctTillable: t.pct_tillable,
        },
      }
    }),
  }
}

// Today's-auction green dots for the NATIVE GL circle layer (county/tract
// tiers). Uses each tract's STORED lat/lng (NOT the polygon centroid) — today's
// set includes boundary_valid=false tracts whose polygons are unreliable. A GL
// circle drapes on the terrain mesh, so it sits at the correct location in BOTH
// 2D and 3D (a DOM marker would be flat-projected and float off the terrain).
export function buildTodayPointGeoJSON(tracts: ApiMapTract[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  for (const t of tracts) {
    const lng = t.longitude
    const lat = t.latitude
    if (lng == null || lat == null) continue
    features.push({
      type: 'Feature',
      id: t.id,
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: { tractId: t.id, listingId: t.listing_id },
    })
  }
  return { type: 'FeatureCollection', features }
}

export function buildExplorePolygonGeoJSON(tracts: ApiMapTract[]): GeoJSON.FeatureCollection {
  const polygonTracts = tracts.filter(
    t => toRings(t.polygon_coordinates).some(r => r.length >= 3)
  )

  return {
    type: 'FeatureCollection',
    features: polygonTracts.map(t => {
      // All rings (each closed). One ring → Polygon; multiple → MultiPolygon.
      const rings = toRings(t.polygon_coordinates).filter(r => r.length >= 3).map(closeRing)
      const geometry = rings.length <= 1
        ? { type: 'Polygon' as const, coordinates: [rings[0]] }
        : { type: 'MultiPolygon' as const, coordinates: rings.map(r => [r]) }

      // Same display-price-per-acre rule as the point layer
      const isPrivateTreaty = (t.listing_type || '').toLowerCase() === 'private_treaty'
      const isPending = t.sale_status?.toLowerCase() === 'pending'
      const displayPricePerAcre = (isPrivateTreaty || isPending) && t.asking_price && t.total_acres
        ? t.asking_price / t.total_acres
        : t.price_per_acre

      return {
        type: 'Feature' as const,
        id: t.id,
        geometry,
        properties: {
          tractId: t.id,
          listingId: t.listing_id,
          status: derivePinStatus(t.sale_status, t.listing_type),
          totalAcres: t.total_acres,
          pricePerAcre: displayPricePerAcre,
          salePrice: t.sale_price,
          askingPrice: t.asking_price,
          listingType: t.listing_type,
          companyName: t.company_name || 'Unknown',
          county: t.county,
          state: t.state,
          auctionDate: t.auction_date,
          township: t.township,
        },
      }
    }),
  }
}

export function buildExploreStateAggregates(tracts: ApiMapTract[]): StateAggregate[] {
  const stateMap = new Map<string, { count: number; statusBreakdown: Record<string, number> }>()

  for (const tract of tracts) {
    const abbr = getStateAbbr(tract.state)
    if (!stateMap.has(abbr)) {
      stateMap.set(abbr, { count: 0, statusBreakdown: {} })
    }
    const entry = stateMap.get(abbr)!
    entry.count++
    const status = derivePinStatus(tract.sale_status, tract.listing_type)
    entry.statusBreakdown[status] = (entry.statusBreakdown[status] || 0) + 1
  }

  const aggregates: StateAggregate[] = []
  stateMap.forEach((data, abbr) => {
    const center = STATE_CENTERS[abbr]
    const bounds = STATE_BOUNDS[abbr]
    if (!center || !bounds) return

    aggregates.push({
      state: STATE_NAMES[abbr] || abbr,
      stateAbbr: abbr,
      count: data.count,
      centerLat: center[1],
      centerLng: center[0],
      bounds,
      statusBreakdown: data.statusBreakdown,
    })
  })

  return aggregates
}
