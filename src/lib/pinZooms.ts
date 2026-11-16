/**
 * Zoom floors for the pins you pick comps from (sale dots + tract pins).
 *
 * Owner 11/12: on the Explore map they first show at the parcel-label zoom
 * (12). Owner 11/16: while BUILDING A COMP REPORT they show from zoom 9 again,
 * as they did before 11/12 ("I need them to show up when more zoomed out like
 * they used to"). Owner 11/13: a Goat Search on the map shows its pins at any
 * zoom. The app uses the same rule (src/utils/pinZooms.js).
 */

/** Comp-report mode: the pre-11/12 floor for sale dots and tract pins. */
export const COMP_PIN_MIN_ZOOM = 9
/** Comp-report mode: the live Regrid-tile sale-dot layer, pre-11/12
 *  (= REGRID_MIN_ZOOM, the Regrid tile floor). */
export const COMP_TILE_DOT_MIN_ZOOM = 11
/** Goat Search on the map: result pins at any zoom. */
export const SEARCH_PIN_MIN_ZOOM = 0

export interface PinMode { search?: boolean; comp?: boolean }

/** Lowest zoom a sale dot / tract pin draws (and loads) at. `exploreFloor`
 *  is the normal Explore-map floor; comp mode and a Goat Search lower it,
 *  never raise it. */
export function pinMinZoom(mode: PinMode, exploreFloor: number): number {
  if (mode.search) return Math.min(SEARCH_PIN_MIN_ZOOM, exploreFloor)
  if (mode.comp) return Math.min(COMP_PIN_MIN_ZOOM, exploreFloor)
  return exploreFloor
}

/** Floor of the live Regrid-tile sale-dot layer (it takes over from the
 *  durable dots at the Regrid tile floor in comp mode). */
export function tileDotMinZoom(mode: PinMode, exploreFloor: number): number {
  return mode.comp ? Math.min(COMP_TILE_DOT_MIN_ZOOM, exploreFloor) : exploreFloor
}

/** Fade-in for the sale dots: none at a zero floor, else a short ramp that
 *  ends just above the floor. */
export function saleDotFade(minZoom: number): number | unknown[] {
  if (minZoom <= 0) return 1
  return ['interpolate', ['linear'], ['zoom'], minZoom - 0.2, 0, minZoom + 0.3, 1]
}
