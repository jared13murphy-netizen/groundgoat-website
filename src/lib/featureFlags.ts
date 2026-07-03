// Soil-rating filter/search — hidden while soil data is being cleaned up
// across states (many states still have unreliable ratings). This flags
// gates every soil FILTER control (range inputs, applied query params,
// active-filter counts, popup sections). Tract-level soil-rating VALUE
// displays (e.g. comp popups, sale modals) are unaffected and stay visible.
//
// Flip to true to restore the soil filter UI everywhere it's gated.
export const SOIL_FILTER_ENABLED = false
