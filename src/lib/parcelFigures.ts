// THE parcel figures for every website surface (owner 11/19): the website
// DISPLAYS parcel figures, it never computes them. The backend sends one
// `figures` object on every parcel payload (parcel detail, map parcel
// enrichment, comps lists, saved tracts, owner lookup):
//
//   price            split share or Regrid price — the server decides
//   acres            Regrid GIS acres
//   pct_tillable     tillable ÷ Regrid acres (0..1)
//   price_per_acre   price ÷ acres
//   price_per_tillable_acre   price ÷ tillable acres
//   price_per_rating $/acre ÷ the state rating ("$/<rating_label>", never "soil point")
//   remeasuring      true → tillable / timber / water / rating show "Updating…"
//
// Every surface reads `parcelFigures(...)` and formats with the fmtFig*
// helpers below — display rounding only: whole dollars, acres 2 decimals,
// whole percent, rating 1 decimal.
//
// OLD API (no `figures`): `legacyParcelFigures` is the derivation the parcel
// panel (parcelDetailFields.deriveParcelDetail) used before 11/19, moved here
// verbatim so the site keeps working against production unchanged. Delete it
// once every backend payload carries `figures`.
//
// Zero local imports on purpose (see tillable.ts): runnable with
// `node src/lib/parcelFigures.test.ts`.

export type RatingLabel = 'PI' | 'CSR2' | 'CPI' | 'WAPI' | 'NCCPI'

/** The backend's `figures` object, exactly as sent (snake_case, pct 0..1). */
export interface ServerParcelFigures {
  price?: number | string | null
  price_source?: 'split' | 'regrid' | null
  regrid_saleprice?: number | string | null
  saledate?: string | null
  acres?: number | string | null
  tillable_acres?: number | string | null
  pct_tillable?: number | string | null
  timber_acres?: number | string | null
  pct_timber?: number | string | null
  water_acres?: number | string | null
  pct_water?: number | string | null
  pasture_acres?: number | string | null
  pct_pasture?: number | string | null
  pond_acres?: number | string | null
  pct_pond?: number | string | null
  rating?: number | string | null
  rating_label?: RatingLabel | string | null
  price_per_acre?: number | string | null
  price_per_tillable_acre?: number | string | null
  price_per_rating?: number | string | null
  remeasuring?: boolean | null
  land_types?: string[] | null
}

/** One parcel's figures, as every surface shows them. Percents are 0-100. */
export interface ParcelFigures {
  /** true = read from the server's `figures`; false = old-API fallback */
  fromServer: boolean
  price: number | null
  priceSource: 'split' | 'regrid' | null
  /** Regrid's whole-deed price (what the deed says) */
  regridSalePrice: number | null
  saledate: string | null
  acres: number | null
  tillableAcres: number | null
  /** 0-100 */
  pctTillable: number | null
  timberAcres: number | null
  pctTimber: number | null
  waterAcres: number | null
  pctWater: number | null
  pastureAcres: number | null
  pctPasture: number | null
  pondAcres: number | null
  pctPond: number | null
  rating: number | null
  /** 'PI' | 'CSR2' | 'CPI' | 'WAPI' | 'NCCPI' | null */
  ratingLabel: string | null
  pricePerAcre: number | null
  pricePerTillableAcre: number | null
  pricePerRating: number | null
  remeasuring: boolean
  landTypes: string[] | null
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** 0..1 server fraction → 0-100 percent (no rounding). */
function pct(v: unknown): number | null {
  const n = num(v)
  return n === null ? null : n * 100
}

const RATING_LABELS = new Set(['PI', 'CSR2', 'CPI', 'WAPI', 'NCCPI'])

/** The first `figures` object carried by any of the payloads given. */
export function findServerFigures(...payloads: any[]): ServerParcelFigures | null {
  for (const p of payloads) {
    const f = p?.figures
    if (f && typeof f === 'object' && !Array.isArray(f)) return f as ServerParcelFigures
  }
  return null
}

export function fromServerFigures(f: ServerParcelFigures): ParcelFigures {
  const label = f.rating_label ? String(f.rating_label).toUpperCase() : null
  return {
    fromServer: true,
    price: num(f.price),
    priceSource: f.price_source === 'split' || f.price_source === 'regrid' ? f.price_source : null,
    regridSalePrice: num(f.regrid_saleprice),
    saledate: f.saledate ?? null,
    acres: num(f.acres),
    tillableAcres: num(f.tillable_acres),
    pctTillable: pct(f.pct_tillable),
    timberAcres: num(f.timber_acres),
    pctTimber: pct(f.pct_timber),
    waterAcres: num(f.water_acres),
    pctWater: pct(f.pct_water),
    pastureAcres: num(f.pasture_acres),
    pctPasture: pct(f.pct_pasture),
    pondAcres: num(f.pond_acres),
    pctPond: pct(f.pct_pond),
    rating: num(f.rating),
    ratingLabel: label && RATING_LABELS.has(label) ? label : null,
    pricePerAcre: num(f.price_per_acre),
    pricePerTillableAcre: num(f.price_per_tillable_acre),
    pricePerRating: num(f.price_per_rating),
    remeasuring: f.remeasuring === true,
    landTypes: Array.isArray(f.land_types) ? f.land_types.map(String) : null,
  }
}

// ── OLD API fallback — the pre-11/19 parcel-panel derivation, unchanged ──
// $/tillable only when tillable >= 1 ac and >= 25% of the acres; $/rating
// only when tillable >= 25% (owner 8/22). pct_tillable passes through in
// whatever unit the old payload used (0-100 in backfilled states).
const LEGACY_MIN_TILL_SHARE = 0.25

export function legacyParcelFigures(record: any, enrich?: any, tileProps?: any): ParcelFigures {
  const r = record ?? tileProps ?? {}
  const acres = num(r?.ll_gisacre ?? r?.gisacre ?? tileProps?.ll_gisacre ?? tileProps?.gisacre)
  const raw = num(r?.saleprice)
  const allocated = num(r?.parcel_sale_price)
  const price = allocated ?? raw
  const validPrice = price !== null && price > 0
  const ppa = validPrice && acres !== null && acres > 0 ? price! / acres : null
  const tillableAcres = num(enrich?.tillable_acres ?? record?.tillable_acres)
  const rating = num(enrich?.soil_rating ?? record?.soil_rating)
  const share = tillableAcres !== null && acres !== null && acres > 0 ? tillableAcres / acres : null
  const pptaOk = validPrice && tillableAcres !== null && tillableAcres >= 1 && share !== null && share >= LEGACY_MIN_TILL_SHARE
  const prOk = ppa !== null && rating !== null && rating > 0 && share !== null && share >= LEGACY_MIN_TILL_SHARE
  const deedParcels = num(r?.deed_parcel_count)
  const timberAcres = num(enrich?.timber_acres ?? record?.timber_acres)
  const landTypes = enrich?.land_types ?? record?.land_types ?? null
  return {
    fromServer: false,
    price,
    priceSource: allocated !== null && deedParcels !== null && deedParcels > 1 ? 'split' : (price !== null ? 'regrid' : null),
    regridSalePrice: raw,
    saledate: r?.saledate ?? null,
    acres,
    tillableAcres,
    pctTillable: num(enrich?.pct_tillable ?? record?.pct_tillable),
    timberAcres,
    // The slide-out's old "x% of parcel" under Timber was timber ÷ acres.
    pctTimber: num(enrich?.pct_timber ?? record?.pct_timber)
      ?? (timberAcres !== null && acres !== null && acres > 0 ? (timberAcres / acres) * 100 : null),
    waterAcres: null,
    pctWater: null,
    pastureAcres: num(enrich?.pasture_acres ?? record?.pasture_acres),
    pctPasture: null,
    pondAcres: null,
    pctPond: null,
    rating,
    ratingLabel: (enrich?.soil_rating_type ?? record?.soil_rating_type) || null,
    pricePerAcre: ppa,
    pricePerTillableAcre: pptaOk ? price! / tillableAcres! : null,
    pricePerRating: prOk ? ppa! / rating! : null,
    remeasuring: false,
    landTypes: Array.isArray(landTypes) ? landTypes : null,
  }
}

/**
 * The ONE read. `record` = the parcel record (/api/regrid/parcel `parcel`),
 * `enrich` = /api/parcel-enrichment/by-uuid, `tileProps` = tile feature
 * properties. Server `figures` win from whichever payload carries them
 * (enrichment first — it is re-read on demand); otherwise the old derivation.
 */
export function parcelFigures(record: any, enrich?: any, tileProps?: any): ParcelFigures {
  const f = findServerFigures(enrich, record, tileProps)
  return f ? fromServerFigures(f) : legacyParcelFigures(record, enrich, tileProps)
}

/**
 * A saved tract (Map It) — its detail payload carries `figures` from the
 * server like every parcel payload. Old API: the pre-11/19 numbers the
 * saved-tract panel and report row used (% tillable = tillable ÷ drawn acres).
 */
export function savedTractFigures(d: any): ParcelFigures {
  const f = findServerFigures(d)
  if (f) return fromServerFigures(f)
  const acres = num(d?.acres)
  const tillableAcres = num(d?.tillable_acres)
  return {
    fromServer: false,
    price: null, priceSource: null, regridSalePrice: null, saledate: null,
    acres,
    tillableAcres,
    pctTillable: acres && tillableAcres !== null ? (tillableAcres / acres) * 100 : null,
    timberAcres: num(d?.timber_acres), pctTimber: null,
    waterAcres: num(d?.water_acres), pctWater: null,
    pastureAcres: num(d?.pasture_acres), pctPasture: null,
    pondAcres: null, pctPond: null,
    rating: num(d?.soil?.rating),
    ratingLabel: d?.soil?.rating_type ?? null,
    pricePerAcre: null, pricePerTillableAcre: null, pricePerRating: null,
    remeasuring: false,
    landTypes: null,
  }
}

// ── Report rows ──────────────────────────────────────────────────────────

/** The figure fields of a parcel report row (TractSaleData, camelCase).
 *  From server figures the row also carries `price` (ResolvedTractPrice
 *  shape) so rowPrice() shows the server's rates and never re-derives them;
 *  `mode` is the caller's tractPriceMode (a display choice, not a figure).
 *  From the old API the row keeps its pre-11/19 fields and no `price`, so
 *  rowPrice() behaves exactly as before. */
export function parcelRowFields(f: ParcelFigures, mode: 'per_acre' | 'total') {
  const validPrice = f.price !== null && f.price > 0
  const base = {
    totalAcres: f.acres,
    tillableAcres: f.tillableAcres,
    pctTillable: f.pctTillable,
    soilRating: f.rating,
    soilRatingType: f.ratingLabel,
    salePrice: validPrice ? f.price : null,
    pricePerAcre: f.pricePerAcre,
  }
  if (!f.fromServer) return base
  return {
    ...base,
    serverFigures: true,
    pricePerTillableAcre: f.pricePerTillableAcre,
    pricePerSoilRating: f.pricePerRating,
    landTypes: f.landTypes,
    remeasuring: f.remeasuring,
    price: {
      basis: validPrice || f.pricePerAcre ? ('sold' as const) : null,
      scope: 'tract' as const,
      mode,
      pricePerAcre: f.pricePerAcre,
      pricePerTillableAcre: f.pricePerTillableAcre,
      pricePerSoilRating: f.pricePerRating,
      totalPrice: validPrice ? f.price : null,
      listingTractCount: null,
    },
  }
}

/** % tillable (0-100) for a report row. A row built from server figures
 *  shows the server's value only (null = dash); any other row (tracts,
 *  old API) keeps the pre-11/19 fallback of tillable ÷ acres. */
export function rowPctTillable(t: {
  pctTillable?: number | null; tillableAcres?: number | null; totalAcres?: number | null; serverFigures?: boolean | null
}): number | null {
  if (t.pctTillable != null) return t.pctTillable
  if (t.serverFigures) return null
  return t.tillableAcres && t.totalAcres ? (t.tillableAcres / t.totalAcres) * 100 : null
}

// ── Display (rounding only) ──────────────────────────────────────────────

export const UPDATING = 'Updating…'

/** Whole dollars, "$12,345"; null when absent or not positive. */
export function fmtFigMoney(n: unknown): string | null {
  const v = num(n)
  if (v === null || v <= 0) return null
  return '$' + Math.round(v).toLocaleString('en-US')
}

/** Acres to 2 decimals, "38.69"; null when absent or negative. */
export function fmtFigAcres(n: unknown): string | null {
  const v = num(n)
  if (v === null || v < 0) return null
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Whole percent from a 0-100 value, "52%". */
export function fmtFigPct(n: unknown): string | null {
  const v = num(n)
  return v === null ? null : `${Math.round(v)}%`
}

/** Rating to 1 decimal, "131.2". */
export function fmtFigRating(n: unknown): string | null {
  const v = num(n)
  return v === null ? null : v.toFixed(1)
}

/** "$/PI", "$/CSR2" … or "$/Soil Rating" — never "soil point". */
export function perRatingLabel(label: string | null | undefined): string {
  return label ? `$/${label}` : '$/Soil Rating'
}

/** Fields that read "Updating…" while the parcel is being re-measured. */
export type RemeasuredField = 'tillable' | 'timber' | 'water' | 'rating' | 'pricePerTillable' | 'pricePerRating'

/** The text for one figure: "Updating…" while remeasuring, else the formatted
 *  value (null = hide / dash, the caller decides). */
export function figText(f: Pick<ParcelFigures, 'remeasuring'>, field: RemeasuredField | null, formatted: string | null): string | null {
  if (field && f.remeasuring) return UPDATING
  return formatted
}
