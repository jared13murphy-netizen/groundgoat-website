import type { ApiMapTract } from './exploreMapTypes'
import type { StateAggregate } from './mapTypes'
import { STATE_ABBR, STATE_BOUNDS, STATE_CENTERS, STATE_NAMES } from './mapConstants'

function getStateAbbr(state: string): string {
  return STATE_ABBR[state] || state
}

function getPolygonCentroid(polygon: [number, number][]): [number, number] {
  let sumLng = 0, sumLat = 0
  for (const [lng, lat] of polygon) {
    sumLng += lng
    sumLat += lat
  }
  return [sumLng / polygon.length, sumLat / polygon.length]
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

      // Use polygon centroid for point placement if available
      const poly = t.polygon_coordinates
      if (poly && poly.length >= 3) {
        const centroid = getPolygonCentroid(poly)
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

      const hasPolygon = poly && poly.length >= 3
      const dataResolution = hasPolygon ? 'polygon' : 'point'

      // For pending, show asking price per acre if available
      const isPending = t.sale_status?.toLowerCase() === 'pending'
      const displayPricePerAcre = isPending && t.asking_price && t.total_acres
        ? t.asking_price / t.total_acres
        : t.price_per_acre

      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [lng, lat],
        },
        properties: {
          tractId: t.id,
          listingId: t.listing_id,
          totalAcres: t.total_acres,
          tillableAcres: t.tillable_acres,
          salePrice: t.sale_price,
          pricePerAcre: displayPricePerAcre,
          status: t.sale_status || 'listed',
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

export function buildExplorePolygonGeoJSON(tracts: ApiMapTract[]): GeoJSON.FeatureCollection {
  const polygonTracts = tracts.filter(
    t => t.polygon_coordinates && t.polygon_coordinates.length >= 3
  )

  return {
    type: 'FeatureCollection',
    features: polygonTracts.map(t => {
      const coords = [...t.polygon_coordinates!]
      const first = coords[0]
      const last = coords[coords.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]])
      }

      return {
        type: 'Feature' as const,
        id: t.id,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [coords],
        },
        properties: {
          tractId: t.id,
          listingId: t.listing_id,
          status: t.sale_status || 'listed',
          totalAcres: t.total_acres,
          pricePerAcre: t.price_per_acre,
          salePrice: t.sale_price,
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
    const status = tract.sale_status || 'listed'
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
