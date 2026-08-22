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
  /** Which rating soil_rating IS (PI / CSR2 / NCCPI / WAPI / CPI).
   *  Sent by the API so clients label $/<rating> without keeping
   *  their own copy of the state->label map. */
  soil_rating_type: string | null
  sale_status: string | null
  listing_id: string | null
  listing_type: string | null
  asking_price: number | null
  pct_tillable: number | null
  township: string | null
  polygon_coordinates: [number, number][] | [number, number][][] | null
  county: string
  state: string
  auction_date: string | null
  company_name: string | null
  listing_status: string | null
  source_url: string | null
  land_type: string | null
  land_types: string[] | null
}

export interface MapTractsResponse {
  count: number
  tracts: ApiMapTract[]
}

/** Owner "show on map" chat-search result — POST /api/map/chat-filter
    returns this under `owner_parcels_response` instead of
    `analytics_response` / `applied_filters` / `out_of_scope_response`
    when the user asks to see a specific owner's parcels. `dots` is
    empty when the owner has no parcels; render the `reply` text as an
    honest "none found" message in that case instead of drawing
    anything on the map. */
export interface OwnerParcelsResponse {
  owner: string
  count: number
  total_acres: number
  dots: { id: string; lat: number; lng: number; acres: number }[]
  bbox: [[number, number], [number, number]] | null
}
