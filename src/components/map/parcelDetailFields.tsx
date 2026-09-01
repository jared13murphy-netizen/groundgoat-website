'use client'

/**
 * parcelDetailFields — formatters, field derivation, and the presentational
 * "Land Composition ... Mailing Address" section block shared between
 * LandDetailPanel.tsx (explore map) and CompInlinePopup in ExploreMap.tsx
 * (comp map). Lifted out of LandDetailPanel.tsx on 2026-08-16 (owner: "the
 * comp map parcel modal doesn't have all the data the explore map parcel
 * modal has ... I would like the data to be the same in the modal between
 * the two maps") so the two can't drift apart again the way
 * parcelDotsFilterGate's twins on this codebase have before — ONE place
 * computes what a section shows and how a value is formatted, and both
 * modals render it via this same component.
 *
 * `deriveParcelDetail` intentionally mirrors LandDetailPanel's original
 * inline derivation field-for-field, including its precedence rules
 * (`enrichData?.x ?? regridData?.x ?? null`, never falling back to raw tile
 * `parcelProps` for the enrichment-eligible fields). The comp map has no
 * enrichData (see CompInlinePopup) — passing `enrichData` as null/undefined
 * degrades that chain to `regridData?.x ?? null`, matching what the mobile
 * app's RegridParcelSheet.js already does by reading straight off the
 * /api/regrid/parcel record (see main.py's "parcel data contract" merge,
 * which folds land_types/tillable_acres/soil_rating/etc. onto that record
 * regardless of caller).
 */

// ─── Formatters ──────────────────────────────────────────────────────────

export function fmtMoney(n: any): string | null {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  if (!isFinite(v) || v === 0) return null
  return '$' + Math.round(v).toLocaleString('en-US')
}

export function fmtAcres(n: any): string | null {
  const v = typeof n === 'number' ? n : (n ? Number(n) : NaN)
  if (!isFinite(v) || v <= 0) return null
  return v.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' ac'
}

// Land Composition acres + Soil Rating value round to the owner-specified
// precision (tenths) locally — the shared `formatAcres` (@/lib/format) goes
// to 3dp and other screens depend on that, so it isn't touched here.
export function fmtAcres1(n: number): string {
  return n.toFixed(1)
}

export function fmtRating1(v: any): string {
  const n = typeof v === 'number' ? v : Number(v)
  return isFinite(n) ? n.toFixed(1) : String(v)
}

export function fmtDate(s: any): string | null {
  if (!s) return null
  const d = new Date(String(s))
  if (isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

const INSTRUMENT_LABELS: Record<string, string> = {
  WD: 'Warranty Deed', SWD: 'Special Warranty Deed', GWD: 'General Warranty Deed',
  QC: 'Quit Claim', QCD: 'Quit Claim Deed',
  TR: 'Trust Transfer', TRD: 'Trust Deed', TRUST: 'Trust Transfer',
  GFT: 'Gift Deed', GD: 'Gift Deed',
  TXD: 'Tax Deed', TAX: 'Tax Deed',
  CFD: 'Contract for Deed',
  PR: 'Personal Representative Deed', PRD: 'Personal Representative Deed',
  EXE: "Executor's Deed", ADM: "Administrator's Deed", SHF: "Sheriff's Deed",
  REL: 'Release', CD: 'Correction Deed',
  FORE: 'Foreclosure', AUC: 'Auction', ML: 'MLS',
}
export function fmtSaleType(raw: any): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  const code = s.toUpperCase().replace(/[^A-Z]/g, '')
  return INSTRUMENT_LABELS[code] || s
}

export function firstNonEmpty(...vals: any[]): any {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== '') return v
  }
  return null
}

export function titleCase(s: string): string {
  if (!s) return ''
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

export function extractTownship(record: any): string {
  const path: unknown = record?.path
  if (typeof path !== 'string') return ''
  const parts = path.split('/').filter(Boolean)
  if (parts.length < 5) return ''
  const slug = parts[3] || ''
  if (!slug || slug === parts[2]) return ''
  return titleCase(slug.replace(/-/g, ' '))
}

/**
 * Derive the state-correct soil rating label.
 * IA → CSR2, IL → PI, MN → CPI, else NCCPI. The enrichment endpoint returns
 * the correct `soil_rating_type` string directly; this fallback is for
 * cases where we only have the state code (e.g. from tile feature props
 * before enrichment resolves).
 */
export function deriveRatingLabel(soilRatingType: string | null | undefined, state: string | null | undefined): string {
  if (soilRatingType) return soilRatingType.toUpperCase()
  const s = (state || '').toUpperCase()
  // Mirrors the backend's soil_rating_registry (the source of truth):
  // every state with a native index gets its own label; NCCPI only for
  // states that genuinely display NCCPI. Owner bug 2026-09-01: an Indiana
  // parcel showed "NCCPI · IN" with a 141 value — WAPI is a 0-200
  // bushels-based scale, and labeling it NCCPI (0-100) reads as broken.
  const NATIVE: Record<string, string> = {
    IA: 'CSR2', IL: 'PI', MN: 'CPI', IN: 'WAPI', OH: 'WAPI',
    SD: 'PI', ND: 'PI',
  }
  return NATIVE[s] || 'NCCPI'
}

// Disclaimer — owner-requested (2026-08-14), verbatim text, do not edit.
export const PARCEL_DISCLAIMER_TEXT =
  'All parcel, land composition, and soil data are estimates provided for informational purposes only and should not be relied upon when making financial decisions.'

// ─── Field derivation ────────────────────────────────────────────────────

export interface ParcelDetailFields {
  owner: string
  county: string
  state: string
  countyState: string
  street: string
  cityLine: string
  township: string
  landTypes: string[] | null
  gisacre: number | null
  saleprice: number | null
  ppa: number | null
  /** Regrid's raw whole-deed figure, kept so a caller can show what the deed
   *  actually says alongside this parcel's allocated share. */
  rawSalePrice: number | null
  deedParcels: number | null
  deedAcres: number | null
  isDeedShare: boolean
  perTillable: number | null
  perRating: number | null
  ratingLabel: string
  soilRating: number | null
  soilRatingType: string | null
  tillableAcres: number | null
  pctTillable: number | null
  pastureAcres: number | null
  timberAcres: number | null
  pctTimber: number | null
  dominantLandcover: string | null
  backfillStatus: string | null
  saledate: string | null
  saleType: string | null
  previousOwner: string
  lastTransferDate: string | null
  deeded: number | null
  usedesc: string
  zoning: string
  parval: number | null
  taxamt: number | null
  taxyear: string | number | null
  landval: number | null
  improvval: number | null
  buildings: number | null
  bldgSqft: number | null
  yearbuilt: number | null
  mailStreet: string
  mailCityLine: string
  hasLandComposition: boolean
  hasSoilRatingRow: boolean
  hasLastSale: boolean
  hasProperty: boolean
  hasAssessed: boolean
  hasBuildings: boolean
  hasMailing: boolean
}

/**
 * `regridData` — the /api/regrid/parcel `parcel` record (already carries
 * land_types/tillable_acres/soil_rating/etc. per the backend's parcel data
 * contract merge — see main.py's get_regrid_parcel_endpoint).
 * `parcelProps` — lightweight tile feature properties, used only as a
 * fallback for owner/county/state/acres before `regridData` resolves.
 * `enrichData` — /api/parcel-enrichment/by-uuid, explore-map-only; pass
 * null/undefined (comp map has no equivalent fetch) to fall through to
 * `regridData` alone, same fields the mobile app already relies on.
 */
export function deriveParcelDetail(
  regridData: any,
  parcelProps: any,
  enrichData: any,
): ParcelDetailFields {
  const record = regridData ?? parcelProps ?? {}

  const owner = record?.owner || parcelProps?.owner || 'Unknown'
  const county = titleCase(record?.county || parcelProps?.county || '')
  const state = record?.state2 || record?.state || parcelProps?.state || parcelProps?.state_abbr || ''
  const countyState = county
    ? `${county} County${state ? ', ' + state : ''}`
    : state || ''
  // Regrid signals "no situs address" with a literal placeholder STRING, not
  // null, so a naive `|| ''` renders "NOT AVAILABLE" as the address — the
  // owner hit exactly that in the app 2026-08-21. Matched on the WHOLE
  // trimmed value so a real "Available Drive" or a town named "None"
  // survives.
  const PLACEHOLDER = /^(n\/?a|not\s*available|not\s*provided|not\s*applicable|unavailable|unknown|none|null|nil|-+|\.+)$/i
  const clean = (v: unknown) => {
    const str = (v == null ? '' : String(v)).trim()
    return (!str || PLACEHOLDER.test(str)) ? '' : str
  }
  const street = clean(record?.address) || clean(parcelProps?.address)
  // City / state / zip of the SITUS address, shown under the street line.
  const cityLine = [
    titleCase(clean(record?.scity) || clean(record?.city)),
    [clean(record?.state2) || clean(record?.state),
     clean(record?.szip5) || clean(record?.szip)].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
  const township = extractTownship(record)

  const gisacre: number | null = record?.ll_gisacre ?? record?.gisacre ?? parcelProps?.ll_gisacre ?? parcelProps?.gisacre ?? null
  // Regrid stamps the WHOLE deed price onto every parcel of a multi-parcel
  // sale — nine Henry County IA parcels each claiming $1,400,820, rendering
  // as $24k-$4.6M/ac. Prefer our allocated share; `?? raw` because the
  // column is NULL wherever we have not backfilled, so the fallback is
  // load-bearing rather than defensive.
  const rawSalePrice = record?.saleprice ?? null
  const allocated = record?.parcel_sale_price ?? null
  const deedParcels = record?.deed_parcel_count ?? null
  const deedAcres = record?.deed_total_acres ?? null
  const saleprice = allocated ?? rawSalePrice
  const validSalePrice = typeof saleprice === 'number' && saleprice > 0
  const ppa = (validSalePrice && typeof gisacre === 'number' && gisacre > 0) ? saleprice / gisacre : null
  const isDeedShare = allocated != null && typeof deedParcels === 'number' && deedParcels > 1

  const ratingLabel = deriveRatingLabel(enrichData?.soil_rating_type, state)
  const soilRating = enrichData?.soil_rating ?? regridData?.soil_rating ?? null
  const soilRatingType = enrichData?.soil_rating_type ?? regridData?.soil_rating_type ?? null
  const tillableAcres = enrichData?.tillable_acres ?? regridData?.tillable_acres ?? null
  const pctTillable = enrichData?.pct_tillable ?? regridData?.pct_tillable ?? null
  const dominantLandcover = enrichData?.dominant_landcover ?? null

  const landTypes: string[] | null = enrichData?.land_types ?? regridData?.land_types ?? null
  const pastureAcres = enrichData?.pasture_acres ?? regridData?.pasture_acres ?? null
  const timberAcres = enrichData?.timber_acres ?? regridData?.timber_acres ?? null
  const pctTimber = enrichData?.pct_timber ?? regridData?.pct_timber ?? null
  // water hidden per owner 8/15 (engine pond recall unreliable) — restore when water detection is fixed.
  const backfillStatus = enrichData?.backfill_status ?? regridData?.backfill_status ?? null

  const saledate = record?.saledate ?? null
  const saleType = fmtSaleType(firstNonEmpty(
    record?.salestype, record?.saletype, record?.sale_type,
    record?.recordtype, record?.record_type,
    record?.instrument, record?.instrumtyp, record?.instrumenttype,
    record?.legaldoc, record?.transrec, record?.deed_type,
    record?.deedtype, record?.s1deedtype, record?.deed,
  ))
  const previousOwner = typeof record?.previous_owner === 'string' && record.previous_owner.trim()
    ? record.previous_owner.trim() : ''
  const lastTransferDate = record?.last_ownership_transfer_date ?? null
  const deeded = record?.deeded_acres ?? null
  const usedescRaw = record?.usedesc
  const usedesc = (typeof usedescRaw === 'string' && usedescRaw.trim() && !/^\d+$/.test(usedescRaw.trim()))
    ? usedescRaw.trim() : ''
  const zoningRaw = record?.zoning_description || record?.zoning || ''
  const zoning = (typeof zoningRaw === 'string' && zoningRaw.trim() && !/^(no zoning|none|n\/a|na)$/i.test(zoningRaw.trim()))
    ? zoningRaw.trim() : ''
  const parval = record?.parval ?? null
  // Property tax (owner 2026-08-19): Regrid Premium Schema taxamt is the
  // annual property tax; taxyear its vintage. Counties that don't report
  // it send 0/blank — fmtMoney treats 0 as unknown (same $0-isn't-data
  // rule as parval/saleprice), so the row hides rather than showing $0.
  const taxamt = record?.taxamt ?? null
  const taxyear = record?.taxyear ?? null
  const landval = record?.landval ?? null
  const improvval = record?.improvval ?? null
  const buildings = record?.ll_bldg_count ?? null
  const bldgSqft = record?.ll_bldg_footprint_sqft ?? null
  const yearbuilt = record?.yearbuilt ?? null

  const hasLandCompositionData =
    tillableAcres != null || pastureAcres != null || timberAcres != null ||
    !!dominantLandcover ||
    pctTillable != null || pctTimber != null
  const hasLandComposition = hasLandCompositionData && backfillStatus !== 'partial_pending'
  const hasSoilRatingRow = soilRating != null && soilRatingType != null
  const hasLastSale = !!(fmtDate(saledate) || saleType || lastTransferDate || previousOwner)
  const hasProperty = !!(deeded || usedesc || zoning)
  const hasAssessed = !!(fmtMoney(parval) || fmtMoney(landval) || fmtMoney(improvval) || fmtMoney(taxamt))
  const hasBuildings = !!(buildings || bldgSqft || yearbuilt)

  const mailStreet = (record?.mailadd ?? '').toString().trim()
  const mailCityLine = [
    (record?.mail_city ?? '').toString().trim(),
    [(record?.mail_state2 ?? record?.mail_state ?? '').toString().trim(),
     (record?.mail_zip ?? '').toString().trim()].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
  const hasMailing = !!(mailStreet || mailCityLine)

  // $/tillable acre is only meaningful on ground that is actually farmed.
  // Owner rule 2026-08-22: hide it below 25% tillable. A `> 0` guard is not
  // enough — a 38.9 ac Fulton County parcel that is 97% TIMBER carries a
  // sliver of tillable, and $190,000 divided by that sliver rendered
  // "$1,765,863,665 / tillable acre" in front of the owner.
  //
  // Ratio computed from acres rather than pct_tillable on purpose:
  // pct_tillable is 0-100 in backfilled states but a 0-1 fraction
  // elsewhere, so keying the threshold off it would silently hide the row
  // for every state outside IL/IA.
  const TILLABLE_MIN_SHARE = 0.25
  const tillableShare = (typeof tillableAcres === 'number' && typeof gisacre === 'number' && gisacre > 0)
    ? tillableAcres / gisacre : null
  const perTillable = (validSalePrice && typeof tillableAcres === 'number' && tillableAcres > 0
                       && tillableShare != null && tillableShare >= TILLABLE_MIN_SHARE)
    ? (saleprice as number) / tillableAcres : null
  // Same 25% floor as $/tillable acre. A soil rating describes CROP
  // productivity, so dollars-per-rating-point is exactly as meaningless on
  // 97%-timber ground — owner 2026-08-22 asked for the rule to cover both.
  const perRating = (ppa != null && typeof soilRating === 'number' && soilRating > 0
                     && tillableShare != null && tillableShare >= TILLABLE_MIN_SHARE)
    ? ppa / soilRating : null

  return {
    owner, county, state, countyState, street, cityLine, township, landTypes,
    gisacre, saleprice, ppa,
    rawSalePrice, deedParcels, deedAcres, isDeedShare, perTillable, perRating,
    ratingLabel, soilRating, soilRatingType, tillableAcres, pctTillable,
    pastureAcres, timberAcres, pctTimber, dominantLandcover, backfillStatus,
    saledate, saleType, previousOwner, lastTransferDate, deeded, usedesc, zoning,
    parval, landval, improvval, taxamt, taxyear, buildings, bldgSqft, yearbuilt,
    mailStreet, mailCityLine,
    hasLandComposition, hasSoilRatingRow, hasLastSale, hasProperty, hasAssessed, hasBuildings, hasMailing,
  }
}

// ─── Presentational pieces ───────────────────────────────────────────────

export function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.8px',
      textTransform: 'uppercase',
      color: '#E91E8C',
      marginBottom: 6,
      marginTop: 2,
    }}>
      {title}
    </div>
  )
}

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 12,
      padding: '5px 0',
      fontSize: 12.5,
      borderBottom: '1px solid rgba(0,0,0,0.05)',
    }}>
      <span style={{ color: '#888', fontWeight: 500, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#1a1a1a', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{value}</span>
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '10px 16px 4px' }}>
      <SectionHeader title={title} />
      {children}
    </div>
  )
}

/** Land-type badge pills — Illinois parcels. Mirrors LandDetailPanel's
 *  header treatment (and PortalTractDetail.tsx / mobile's RegridParcelSheet
 *  LAND_TYPE_COLORS badges) so "Farm" reads the same everywhere. */
export function LandTypeBadges({ landTypes }: { landTypes: string[] | null }) {
  if (!landTypes || landTypes.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {landTypes.map(lt => (
        <span key={lt} style={{
          display: 'inline-flex',
          padding: '3px 10px',
          borderRadius: 999,
          fontSize: 10,
          fontWeight: 700,
          background: 'rgba(245,140,222,0.15)',
          color: '#F58CDE',
          border: '1px solid rgba(245,140,222,0.3)',
        }}>
          {lt}
        </span>
      ))}
    </div>
  )
}

/**
 * Sections C (Land Composition) through H (Mailing Address), plus the
 * disclaimer — exactly LandDetailPanel's original JSX, order preserved.
 * Both modals render this same block so they can't drift apart again.
 */
export function ParcelDetailSections({ d, afterSoilRating, hideComposition = false, hideLastSale = false }: {
  d: ParcelDetailFields
  afterSoilRating?: React.ReactNode
  /** Suppress LAST SALE — the slide-out panel renders it ABOVE the stat
   *  grid to match the app's sheet, so leaving it in the section list would
   *  print it twice, in the wrong order. */
  hideLastSale?: boolean
  /** Suppress Land Composition + Soil Rating. The slide-out panel renders
   *  those as the 2x2 stat grid at the top (matching the app's sheet), so
   *  leaving them here too printed tillable acres and the soil rating
   *  twice — owner 2026-08-22: "you have data duplicated". The comp popup
   *  has no stat grid, so it keeps them. */
  hideComposition?: boolean
}) {
  return (
    <>
      {/* ── C: Land Composition (Illinois parcels) ────────────────
          Hide-when-null throughout: each row is gated on `!= null`
          (not truthy), so a real 0.4-acre pond or 0% timber still
          renders instead of vanishing. Whole section is absent when
          backfill_status is 'partial_pending' or no land-composition
          field is present at all. */}
      {!hideComposition && d.hasLandComposition && (
        <Section title="Land Composition">
          {(d.tillableAcres != null || d.pctTillable != null) && (
            <DetailRow
              label="Tillable"
              value={
                d.tillableAcres != null
                  ? `${fmtAcres1(Number(d.tillableAcres))} ac${d.pctTillable != null ? ` (${Number(d.pctTillable).toFixed(0)}%)` : ''}`
                  : `${Number(d.pctTillable).toFixed(0)}%`
              }
            />
          )}
          {d.pastureAcres != null && (
            <DetailRow
              label="Pasture"
              value={`${fmtAcres1(Number(d.pastureAcres))} ac`}
            />
          )}
          {(d.timberAcres != null || d.pctTimber != null) && (
            <DetailRow
              label="Timber"
              value={
                d.timberAcres != null
                  ? `${fmtAcres1(Number(d.timberAcres))} ac${d.pctTimber != null ? ` (${Math.round(Number(d.pctTimber))}%)` : ''}`
                  : `${Math.round(Number(d.pctTimber))}%`
              }
            />
          )}
          {/* water hidden per owner 8/15 (engine pond recall unreliable) — restore when water detection is fixed. */}
          {d.dominantLandcover && (
            <DetailRow
              label="Dominant Cover"
              value={String(d.dominantLandcover).replace(/(^|[\s-])\S/g, m => m.toUpperCase())}
            />
          )}
        </Section>
      )}

      {/* ── C2: Soil Rating (Illinois parcels) — un-gated: independent
          of the LAND COMPOSITION backfill_status gate above. Renders
          whenever both halves of the combined "PI 128.0"-style value
          are present. */}
      {!hideComposition && d.hasSoilRatingRow && (
        <Section title="Soil Rating">
          <DetailRow label="Rating" value={`${d.soilRatingType} ${fmtRating1(d.soilRating)}`} />
        </Section>
      )}

      {/* Slot for the Crops Planted card (LandDetailPanel) — placed here by
          owner direction 8/20: crop history belongs with the land data, not
          buried under mailing address. Comp popup passes nothing. */}
      {afterSoilRating}

      {!hideLastSale && (
        <>
      {/* ── D: Last Sale ─────────────────────────────────────── */}
      {d.hasLastSale && (
        <Section title="Last Sale">
          {d.saleprice != null && d.saleprice > 0 && (
            <DetailRow label="Price" value={fmtMoney(d.saleprice)!} />
          )}
          {fmtDate(d.saledate) && <DetailRow label="Sale Date" value={fmtDate(d.saledate)!} />}
          {d.ppa != null && (
            <DetailRow label="$/Acre" value={'$' + Math.round(d.ppa).toLocaleString('en-US')} />
          )}
          {d.perTillable != null && (
            <DetailRow label="$/Tillable Acre" value={'$' + Math.round(d.perTillable).toLocaleString('en-US')} />
          )}
          {d.perRating != null && (
            <DetailRow label={`$/${d.ratingLabel}`} value={'$' + d.perRating.toFixed(2)} />
          )}
          {/* Never present an allocated share as the recorded price. $257,931
              is our arithmetic; $1,400,820 is what the deed says, and a
              lender will check. */}
          {d.isDeedShare && (
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', lineHeight: 1.45, padding: '6px 0 2px' }}>
              This parcel&apos;s share of a {d.deedParcels}-parcel sale
              {d.deedAcres != null ? ` covering ${fmtAcres(d.deedAcres)}` : ''}
              {d.rawSalePrice != null ? ` for ${fmtMoney(d.rawSalePrice)}` : ''}, allocated by acreage.
            </div>
          )}
          {d.saleType && <DetailRow label="Sale Type" value={d.saleType} />}
          {fmtDate(d.lastTransferDate) && fmtDate(d.lastTransferDate) !== fmtDate(d.saledate) && (
            <DetailRow label="Last Transfer" value={fmtDate(d.lastTransferDate)!} />
          )}
          {d.previousOwner && <DetailRow label="Previous Owner" value={d.previousOwner} />}
        </Section>
      )}

        </>
      )}

      {/* ── E: Property ─────────────────────────────────────── */}
      {d.hasProperty && (
        <Section title="Property">
          {d.deeded && d.deeded !== d.gisacre && fmtAcres(d.deeded) && (
            <DetailRow label="Deeded Acres" value={fmtAcres(d.deeded)!} />
          )}
          {d.usedesc && <DetailRow label="Use" value={d.usedesc} />}
          {d.zoning && <DetailRow label="Zoning" value={d.zoning} />}
        </Section>
      )}

      {/* ── F: Assessed Value ───────────────────────────────── */}
      {d.hasAssessed && (
        <Section title="Assessed Value">
          {fmtMoney(d.parval) && <DetailRow label="Total" value={fmtMoney(d.parval)!} />}
          {fmtMoney(d.landval) && <DetailRow label="Land" value={fmtMoney(d.landval)!} />}
          {fmtMoney(d.improvval) && <DetailRow label="Improvements" value={fmtMoney(d.improvval)!} />}
          {fmtMoney(d.taxamt) && (
            <DetailRow
              label={d.taxyear ? `Property Tax (${d.taxyear})` : 'Property Tax'}
              value={fmtMoney(d.taxamt)!}
            />
          )}
        </Section>
      )}

      {/* ── G: Buildings ─────────────────────────────────────── */}
      {d.hasBuildings && (
        <Section title="Buildings">
          {d.buildings && <DetailRow label="Count" value={String(d.buildings)} />}
          {d.bldgSqft && <DetailRow label="Footprint" value={`${Math.round(d.bldgSqft).toLocaleString()} sq ft`} />}
          {d.yearbuilt && <DetailRow label="Year Built" value={String(d.yearbuilt)} />}
        </Section>
      )}

      {/* ── H: Mailing Address ───────────────────────────────── */}
      {d.hasMailing && (
        <Section title="Mailing Address">
          {d.mailStreet && <DetailRow label="Street" value={d.mailStreet} />}
          {d.mailCityLine && <DetailRow label="City / State / Zip" value={d.mailCityLine} />}
        </Section>
      )}
    </>
  )
}


/** LAST SALE on its own, so the slide-out panel can place it above the stat
 *  grid exactly as the app's sheet does. Same markup as the section inside
 *  ParcelDetailSections — pass hideLastSale there when using this. */
export function ParcelLastSaleSection({ d }: { d: ParcelDetailFields }) {
  if (!d.hasLastSale) return null
  return (
    <>
      {/* ── D: Last Sale ─────────────────────────────────────── */}
      {true && (
        <Section title="Last Sale">
          {d.saleprice != null && d.saleprice > 0 && (
            <DetailRow label="Price" value={fmtMoney(d.saleprice)!} />
          )}
          {fmtDate(d.saledate) && <DetailRow label="Sale Date" value={fmtDate(d.saledate)!} />}
          {d.ppa != null && (
            <DetailRow label="$/Acre" value={'$' + Math.round(d.ppa).toLocaleString('en-US')} />
          )}
          {d.perTillable != null && (
            <DetailRow label="$/Tillable Acre" value={'$' + Math.round(d.perTillable).toLocaleString('en-US')} />
          )}
          {d.perRating != null && (
            <DetailRow label={`$/${d.ratingLabel}`} value={'$' + d.perRating.toFixed(2)} />
          )}
          {/* Never present an allocated share as the recorded price. $257,931
              is our arithmetic; $1,400,820 is what the deed says, and a
              lender will check. */}
          {d.isDeedShare && (
            <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', lineHeight: 1.45, padding: '6px 0 2px' }}>
              This parcel&apos;s share of a {d.deedParcels}-parcel sale
              {d.deedAcres != null ? ` covering ${fmtAcres(d.deedAcres)}` : ''}
              {d.rawSalePrice != null ? ` for ${fmtMoney(d.rawSalePrice)}` : ''}, allocated by acreage.
            </div>
          )}
          {d.saleType && <DetailRow label="Sale Type" value={d.saleType} />}
          {fmtDate(d.lastTransferDate) && fmtDate(d.lastTransferDate) !== fmtDate(d.saledate) && (
            <DetailRow label="Last Transfer" value={fmtDate(d.lastTransferDate)!} />
          )}
          {d.previousOwner && <DetailRow label="Previous Owner" value={d.previousOwner} />}
        </Section>
      )}

    </>
  )
}
