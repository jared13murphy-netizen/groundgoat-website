import type { ApiListing, MapTract, StateAggregate } from './mapTypes'
import countyCentroids from '@/data/countyCentroids'
import { STATE_ABBR, STATE_BOUNDS, STATE_CENTERS, STATE_NAMES } from './mapConstants'

interface Filters {
  company?: string
  status?: string
  type?: string
  dateFrom?: string
  dateTo?: string
}

function getStateAbbr(state: string): string {
  return STATE_ABBR[state] || state
}

export function transformListingsToMapTracts(
  listings: ApiListing[],
  filters?: Filters
): MapTract[] {
  const tracts: MapTract[] = []

  for (const listing of listings) {
    // Apply filters at listing level
    if (filters) {
      if (filters.company && filters.company !== 'all' && listing.listing_company_id !== filters.company) {
        continue
      }
      if (filters.status && filters.status !== 'all' && listing.status !== filters.status) {
        continue
      }
      if (filters.type && filters.type !== 'all' && listing.listing_type !== filters.type) {
        continue
      }
      if (filters.dateFrom || filters.dateTo) {
        const listingDate = listing.auction_date ? new Date(listing.auction_date + 'T00:00:00') : null
        if (!listingDate) continue
        if (filters.dateFrom && listingDate < new Date(filters.dateFrom + 'T00:00:00')) continue
        if (filters.dateTo) {
          const toDate = new Date(filters.dateTo + 'T23:59:59')
          if (listingDate > toDate) continue
        }
      }
    }

    const stateAbbr = getStateAbbr(listing.state)
    const centroidKey = listing.county + ', ' + stateAbbr
    const centroid = countyCentroids[centroidKey]
    if (!centroid) continue

    const countyLat = centroid[0]
    const countyLng = centroid[1]

    if (listing.tracts && listing.tracts.length > 0) {
      for (const tract of listing.tracts) {
        const hasPolygon = tract.polygon_coordinates
          && Array.isArray(tract.polygon_coordinates)
          && tract.polygon_coordinates.length >= 3
        const hasLatLng = tract.latitude != null && tract.longitude != null

        let dataResolution: 'polygon' | 'point' | 'centroid'
        if (hasPolygon) {
          dataResolution = 'polygon'
        } else if (hasLatLng) {
          dataResolution = 'point'
        } else {
          dataResolution = 'centroid'
        }

        tracts.push({
          tractId: tract.id,
          listingId: listing.id,
          tractNumber: tract.tract_number,
          totalAcres: tract.total_acres || 0,
          tillableAcres: tract.tillable_acres || 0,
          salePrice: tract.sale_price || 0,
          pricePerAcre: tract.price_per_acre || 0,
          status: tract.sale_status || listing.status,
          polygon: hasPolygon ? tract.polygon_coordinates : null,
          lat: tract.latitude ?? null,
          lng: tract.longitude ?? null,
          countyLat,
          countyLng,
          dataResolution,
          listingTitle: listing.title || listing.county + ' County, ' + listing.state,
          companyName: listing.company_name || 'Unknown',
          companyId: listing.listing_company_id || '',
          county: listing.county,
          state: listing.state,
          stateAbbr,
          auctionDate: listing.auction_date || '',
          auctionTime: listing.auction_time || '',
          listingType: listing.listing_type,
        })
      }
    } else {
      // Listing with no tracts — create a synthetic entry at county centroid
      tracts.push({
        tractId: listing.id + '-listing',
        listingId: listing.id,
        tractNumber: 0,
        totalAcres: listing.total_acres || 0,
        tillableAcres: 0,
        salePrice: 0,
        pricePerAcre: listing.price_per_acre || 0,
        status: listing.status,
        polygon: null,
        lat: null,
        lng: null,
        countyLat,
        countyLng,
        dataResolution: 'centroid',
        listingTitle: listing.title || listing.county + ' County, ' + listing.state,
        companyName: listing.company_name || 'Unknown',
        companyId: listing.listing_company_id || '',
        county: listing.county,
        state: listing.state,
        stateAbbr,
        auctionDate: listing.auction_date || '',
        auctionTime: listing.auction_time || '',
        listingType: listing.listing_type,
      })
    }
  }

  return tracts
}

function getTractPointCoords(tract: MapTract): [number, number] {
  if (tract.dataResolution === 'polygon' && tract.polygon) {
    // Centroid of polygon for the point layer
    let sumLng = 0, sumLat = 0
    for (const [lng, lat] of tract.polygon) {
      sumLng += lng
      sumLat += lat
    }
    return [sumLng / tract.polygon.length, sumLat / tract.polygon.length]
  }
  if (tract.dataResolution === 'point' && tract.lat != null && tract.lng != null) {
    return [tract.lng, tract.lat]
  }
  // Centroid fallback
  return [tract.countyLng, tract.countyLat]
}

export function buildPointGeoJSON(tracts: MapTract[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: tracts.map(tract => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: getTractPointCoords(tract),
      },
      properties: {
        tractId: tract.tractId,
        listingId: tract.listingId,
        tractNumber: tract.tractNumber,
        totalAcres: tract.totalAcres,
        tillableAcres: tract.tillableAcres,
        salePrice: tract.salePrice,
        pricePerAcre: tract.pricePerAcre,
        status: tract.status,
        dataResolution: tract.dataResolution,
        listingTitle: tract.listingTitle,
        companyName: tract.companyName,
        county: tract.county,
        state: tract.state,
        auctionDate: tract.auctionDate,
        auctionTime: tract.auctionTime,
        listingType: tract.listingType,
      },
    })),
  }
}

export function buildPolygonGeoJSON(tracts: MapTract[]): GeoJSON.FeatureCollection {
  const polygonTracts = tracts.filter(t => t.dataResolution === 'polygon' && t.polygon)

  return {
    type: 'FeatureCollection',
    features: polygonTracts.map(tract => {
      // Close the ring if not already closed
      const coords = [...tract.polygon!]
      const first = coords[0]
      const last = coords[coords.length - 1]
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]])
      }

      return {
        type: 'Feature' as const,
        id: tract.tractId,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [coords],
        },
        properties: {
          tractId: tract.tractId,
          listingId: tract.listingId,
          tractNumber: tract.tractNumber,
          totalAcres: tract.totalAcres,
          tillableAcres: tract.tillableAcres,
          salePrice: tract.salePrice,
          pricePerAcre: tract.pricePerAcre,
          status: tract.status,
          dataResolution: tract.dataResolution,
          listingTitle: tract.listingTitle,
          companyName: tract.companyName,
          county: tract.county,
          state: tract.state,
          auctionDate: tract.auctionDate,
          auctionTime: tract.auctionTime,
          listingType: tract.listingType,
        },
      }
    }),
  }
}

export function buildStateAggregates(tracts: MapTract[]): StateAggregate[] {
  const stateMap = new Map<string, { count: number; statusBreakdown: Record<string, number> }>()

  for (const tract of tracts) {
    const abbr = tract.stateAbbr
    if (!stateMap.has(abbr)) {
      stateMap.set(abbr, { count: 0, statusBreakdown: {} })
    }
    const entry = stateMap.get(abbr)!
    entry.count++
    entry.statusBreakdown[tract.status] = (entry.statusBreakdown[tract.status] || 0) + 1
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
