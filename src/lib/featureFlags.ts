// Soil-rating filter/search — hidden while soil data is being cleaned up
// across states (many states still have unreliable ratings). This flags
// gates every soil FILTER control (range inputs, applied query params,
// active-filter counts, popup sections). Tract-level soil-rating VALUE
// displays (e.g. comp popups, sale modals) are unaffected and stay visible.
//
// Flip to true to restore the soil filter UI everywhere it's gated.
export const SOIL_FILTER_ENABLED = false

// Private Treaty hidden from the public website UI (backend stops returning
// PT listings from data endpoints separately — this flag only gates the UI
// affordances that would otherwise be empty/dead: the browse tab on
// /listings and /access, the portal nav tab, and the watchlist client-side
// filter). PT hidden 2026-07-20, reversible — flip to true to restore.
export const SHOW_PRIVATE_TREATY = false
