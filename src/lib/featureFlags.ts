// Soil-rating filter/search — hidden while soil data is being cleaned up
// across states (many states still have unreliable ratings). This flags
// gates every soil FILTER control (range inputs, applied query params,
// active-filter counts, popup sections). Tract-level soil-rating VALUE
// displays (e.g. comp popups, sale modals) are unaffected and stay visible.
//
// Flip to true to restore the soil filter UI everywhere it's gated.
export const SOIL_FILTER_ENABLED = false

// "% Tillable" map filter — hidden 2026-07-27 because PARCELS carry no
// tillable data. parcel_sale_dots holds only location / saleprice / saledate
// / acres / county; % tillable is a TRACT-only column. Setting the filter
// therefore makes every pink parcel dot vanish (shouldHideParcelDotsForFilters
// treats pctTillable as unrepresentable) AND silently drops the county count
// circles to tract-only counts (the backend's dots_representable guard returns
// dot_count=None) — which reads as a broken map, not as a filtered one.
//
// Unlike SOIL_FILTER_ENABLED this also gates the query-param forwarding and
// the active-filter count: a control the user can't see or clear must not keep
// filtering in the background.
//
// Owner: re-enable once the parcel backfill lands, together with soil rating
// range and land types. Flip to true to restore.
export const TILLABLE_FILTER_ENABLED = false

// Private Treaty hidden from the public website UI (backend stops returning
// PT listings from data endpoints separately — this flag only gates the UI
// affordances that would otherwise be empty/dead: the browse tab on
// /listings and /access, the portal nav tab, and the watchlist client-side
// filter). PT hidden 2026-07-20, reversible — flip to true to restore.
export const SHOW_PRIVATE_TREATY = false
