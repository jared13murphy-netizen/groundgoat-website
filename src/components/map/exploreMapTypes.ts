export interface ApiMapTract {
  id: string
  latitude: number | null
  longitude: number | null
  price_per_acre: number | null
  total_acres: number | null
  tillable_acres: number | null
  price_per_tillable_acre: number | null
  price_per_soil_rating: number | null
  sale_price: number | null
  soil_rating: number | null
  sale_status: string | null
  listing_id: string | null
  listing_type: string | null
  asking_price: number | null
  pct_tillable: number | null
  township: string | null
  polygon_coordinates: [number, number][] | null
  county: string
  state: string
  auction_date: string | null
  company_name: string | null
  listing_status: string | null
}

export interface MapTractsResponse {
  count: number
  tracts: ApiMapTract[]
}
