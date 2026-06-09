export interface ApiTract {
  id: string
  listing_id: string
  tract_number: number
  name?: string
  total_acres: number | null
  tillable_acres: number | null
  sale_price: number | null
  price_per_acre: number | null
  sale_status: string | null
  latitude: number | null
  longitude: number | null
  polygon_coordinates: [number, number][] | [number, number][][] | null
}

export interface ApiListing {
  id: string
  title: string
  county: string
  state: string
  status: string
  listing_type: string
  company_name?: string
  listing_company_id?: string
  auction_date?: string
  auction_time?: string
  price_per_acre?: number
  total_acres?: number
  tracts?: ApiTract[]
}

export interface MapTract {
  tractId: string
  listingId: string
  tractNumber: number
  totalAcres: number
  tillableAcres: number
  salePrice: number
  pricePerAcre: number
  status: string
  polygon: [number, number][] | [number, number][][] | null
  lat: number | null
  lng: number | null
  countyLat: number
  countyLng: number
  dataResolution: 'polygon' | 'point' | 'centroid'
  listingTitle: string
  companyName: string
  companyId: string
  county: string
  state: string
  stateAbbr: string
  auctionDate: string
  auctionTime: string
  listingType: string
}

export interface StateAggregate {
  state: string
  stateAbbr: string
  count: number
  centerLat: number
  centerLng: number
  bounds: [[number, number], [number, number]]
  statusBreakdown: Record<string, number>
}

export interface TractMapProps {
  listings: ApiListing[]
  height?: string
  filters?: {
    company?: string
    status?: string
    type?: string
    dateFrom?: string
    dateTo?: string
  }
}
