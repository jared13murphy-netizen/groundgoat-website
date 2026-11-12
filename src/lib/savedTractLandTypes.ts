// Land types for a saved tract re-opened in Map It (owner 11/11).
//
// A saved tract normally carries the land-type polygons it was drawn with.
// Some saved tracts carry NONE: a tract or parcel saved to a project from a
// comp report ("Save as project", 11/10) stores its outline and figures but
// no drawing. Map It used to open such a tract as already classified with an
// empty set, so Land Types showed nothing — while the same ground drawn
// fresh in Map It showed the engine's polygons. A tract with no stored
// polygons must go through the engine exactly like a first draw.

/** True when the stored polygons hold no usable geometry, i.e. the tract
 *  has never had land types drawn and Map It must ask the engine. */
export function savedTractNeedsEngine(
  polygons: { geometry?: unknown }[] | null | undefined,
): boolean {
  return !(polygons || []).some((p) => p && p.geometry)
}
