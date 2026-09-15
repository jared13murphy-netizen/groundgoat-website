/**
 * Single source of truth for "what do we call this record's soil rating".
 *
 * Owner rule (2026-09-13): whenever we show a soil rating anywhere on the
 * website or app, we must say what TYPE of rating it is (NCCPI, WAPI, PI,
 * CSR2, CPI, ...) — and that type must come from the record's own
 * `soil_rating_type` field, NEVER guessed from state. A state-based guess
 * can be wrong (some Indiana tracts are NCCPI not WAPI, some ND tracts are
 * PI not NCCPI), so this file replaces the five separate STATE_SOIL_LABELS
 * lookup tables that used to live in PortalListPanel, PortalComparablesPanel,
 * PortalComparablesReportPanel, PortalReportPanel, and subjectStats — the
 * owner's other hard rule is "never duplicate the same lookup in multiple
 * places."
 */

interface SoilTypeRecord {
  soil_rating_type?: string | null
  soilRatingType?: string | null
}

/**
 * Resolve the display label for a soil rating: the record's own type wins,
 * else the first non-empty type found among `tracts` (e.g. a listing's
 * tracts when the listing itself carries no type), else the generic
 * fallback 'Soil Rating'.
 */
export function soilRatingLabel(
  rec?: SoilTypeRecord | null,
  tracts?: Array<SoilTypeRecord | null> | null,
): string {
  const own = rec?.soil_rating_type ?? rec?.soilRatingType
  if (own) return own
  if (tracts) {
    for (const t of tracts) {
      const type = t?.soil_rating_type ?? t?.soilRatingType
      if (type) return type
    }
  }
  return 'Soil Rating'
}

/** "$/<type>" (or "$/Soil Rating" when no type is known). */
export function perSoilRatingLabel(
  rec?: SoilTypeRecord | null,
  tracts?: Array<SoilTypeRecord | null> | null,
): string {
  return '$/' + soilRatingLabel(rec, tracts)
}

/** "Avg <type>" (or "Avg Soil Rating" when no type is known). */
export function avgSoilRatingLabel(
  rec?: SoilTypeRecord | null,
  tracts?: Array<SoilTypeRecord | null> | null,
): string {
  return 'Avg ' + soilRatingLabel(rec, tracts)
}
