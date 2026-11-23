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
  // ONE price per tract (owner 11/17 — backend price_display.tract_price_fields).
  // asking_price above is the tract's OWN (single-tract listing) only.
  price_basis?: 'sold' | 'asking' | null
  price_scope?: 'tract' | 'listing'
  price_mode?: 'per_acre' | 'total'
  display_price_per_acre?: number | null
  display_price_per_tillable_acre?: number | null
  display_price_per_soil_rating?: number | null
  display_total_price?: number | null
  listing_asking_price?: number | null
  listing_tract_count?: number | null
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
  /** kind (11/23): absent = 'owner'. 'address' = the typed street address
      (id may be 'geocode'), 'mailing' = owner mailing address matches,
      'section' = inside a searched PLSS section. path = Regrid parcel path. */
  dots: { id: string; lat: number; lng: number; acres: number; kind?: 'owner' | 'mailing' | 'address' | 'section'; path?: string | null; owner?: string | null }[]
  bbox: [[number, number], [number, number]] | null
  /** Searched PLSS section's dissolved outline. */
  outline?: GeoJSON.Polygon | GeoJSON.MultiPolygon | null
  mailing?: { count: number; acres: number; addresses: string[]; owners: { owner: string; count: number; acres: number }[] }
}
