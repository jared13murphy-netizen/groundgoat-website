// Land types for a saved tract re-opened in Map It (owner 11/11).
//
// Map It always opens what is SAVED for the tract — the firm's own polygons,
// including every edit they made. The engine runs only the first time a
// tract is opened in Map It: a tract saved to a project from a comp report
// ("Save as project", 11/10) stores its outline and figures but no drawing
// (stats.source === 'report'). Every Map It save sets
// stats.land_types_saved (backend configurable_mapping.py), so after the
// first save even a drawing the user deliberately emptied stays as saved —
// the engine never comes back over a saved drawing.

/** True only for a report-saved tract that has never been drawn in Map It. */
export function savedTractNeedsEngine(
  polygons: { geometry?: unknown }[] | null | undefined,
  stats?: Record<string, unknown> | null,
): boolean {
  const drawn = (polygons || []).some((p) => p && p.geometry)
  return !drawn && stats?.source === 'report' && !stats?.land_types_saved
}
