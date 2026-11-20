// THE parcel figures for every website surface (owner 11/20, "one number
// everywhere"): the website DISPLAYS parcel figures, it never computes or
// formats them. The backend sends one `figures` object on every parcel
// payload (parcel detail, map parcel enrichment, comps lists, saved tracts,
// owner lookup) and ONE Python formatter turns it into `figures.display` —
// ready-to-print strings the site renders verbatim:
//
//   display.acres / tillable_acres / timber_acres / water_acres /
//     pasture_acres / pond_acres      "1,234.57"
//   display.price                     "$1,234,567"
//   display.price_per_acre / price_per_tillable_acre / price_per_rating
//                                     "$9,644"
//   display.pct_tillable              "88%"
//   display.rating / rating_label     "69.2" / "CSR2"
//   display.sale_date                 "MM/DD/YYYY"
//   (every value "—" when null; "Updating…" while the parcel is re-measured)
//   price_mode  "total" | "per_acre"  decided once server-side (owner 11/4)
//   updating    true while remeasuring
//
// There is NO fallback: a parcel payload without `figures` shows "—", never
// a number derived from tile props, pin props or an older payload.
//
// The numeric fields stay on ParcelFigures for logic only (is there a price,
// is it split) — never for printing a parcel figure.
//
// Zero local imports on purpose (see tillable.ts): runnable with
// `node src/lib/parcelFigures.test.ts`.

export type RatingLabel = 'PI' | 'CSR2' | 'CPI' | 'WAPI' | 'NCCPI'

/** Ready-to-print strings from the backend's one formatter (contract keys). */
export interface ServerDisplay {
  acres?: string
  tillable_acres?: string
  timber_acres?: string
  water_acres?: string
  pasture_acres?: string
  pond_acres?: string
  price?: string
  price_per_acre?: string
  price_per_tillable_acre?: string
  price_per_rating?: string
  pct_tillable?: string
  rating?: string
  rating_label?: string
  sale_date?: string
}
export type DisplayKey = keyof ServerDisplay

/** What every surface prints for a figure that is missing. */
export const DASH = '\u2014'

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
  display?: ServerDisplay | null
  price_mode?: 'total' | 'per_acre' | string | null
  updating?: boolean | null
}

/** One parcel's figures, as every surface shows them. Percents are 0-100. */
export interface ParcelFigures {
  /** true = read from the server's `figures`; false = the payload had none
   *  (every figure null, display null → "—" everywhere) */
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
  /** server `updating` (or the older `remeasuring`) */
  remeasuring: boolean
  landTypes: string[] | null
  /** the server's print strings — render verbatim */
  display: ServerDisplay | null
  /** server-decided: 'total' → show the total price labelled "Sale Price",
   *  no $/acre; null = payload did not say */
  priceMode: 'total' | 'per_acre' | null
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
    remeasuring: f.updating === true || f.remeasuring === true,
    landTypes: Array.isArray(f.land_types) ? f.land_types.map(String) : null,
    display: f.display && typeof f.display === 'object' ? f.display : null,
    priceMode: f.price_mode === 'total' || f.price_mode === 'per_acre' ? f.price_mode : null,
  }
}

/** A parcel payload with no `figures`: every figure null, nothing to print. */
export function emptyParcelFigures(): ParcelFigures {
  return {
    fromServer: false,
    price: null, priceSource: null, regridSalePrice: null, saledate: null,
    acres: null, tillableAcres: null, pctTillable: null,
    timberAcres: null, pctTimber: null, waterAcres: null, pctWater: null,
    pastureAcres: null, pctPasture: null, pondAcres: null, pctPond: null,
    rating: null, ratingLabel: null,
    pricePerAcre: null, pricePerTillableAcre: null, pricePerRating: null,
    remeasuring: false, landTypes: null, display: null, priceMode: null,
  }
}

/** The server's string for one figure, verbatim; "\u2014" when absent. */
export function figDisplay(f: { display?: ServerDisplay | null } | null | undefined, key: DisplayKey): string {
  const v = f?.display?.[key]
  return typeof v === 'string' && v !== '' ? v : DASH
}

/** true when a display string is a real value (not "\u2014" / empty). */
export function figShown(v: string | null | undefined): boolean {
  return !!v && v !== DASH
}

/**
 * The ONE read. `record` = the parcel record (/api/regrid/parcel `parcel`),
 * `enrich` = /api/parcel-enrichment/by-uuid. Server `figures` win from
 * whichever payload carries them (enrichment first — it is re-read on
 * demand). No `figures` anywhere → empty figures (every surface prints "\u2014").
 */
export function parcelFigures(record: any, enrich?: any): ParcelFigures {
  const f = findServerFigures(enrich, record)
  return f ? fromServerFigures(f) : emptyParcelFigures()
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
    display: null, priceMode: null,
  }
}

// ── Report rows ──────────────────────────────────────────────────────────

/** The figure fields of a parcel report row (TractSaleData, camelCase).
 *  From server figures the row carries `figuresDisplay` (the server's print
 *  strings — every renderer shows those verbatim) and `price` (the
 *  ResolvedTractPrice shape) so rowPrice() reads the server's rates and never
 *  re-derives them. `mode` is only the fallback when the server sent no
 *  `price_mode`. A row from a payload with no figures is all dashes. */
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
    figuresDisplay: f.display,
    pricePerTillableAcre: f.pricePerTillableAcre,
    pricePerSoilRating: f.pricePerRating,
    landTypes: f.landTypes,
    remeasuring: f.remeasuring,
    price: {
      basis: validPrice || f.pricePerAcre ? ('sold' as const) : null,
      scope: 'tract' as const,
      mode: f.priceMode ?? mode,
      pricePerAcre: f.pricePerAcre,
      pricePerTillableAcre: f.pricePerTillableAcre,
      pricePerSoilRating: f.pricePerRating,
      totalPrice: validPrice ? f.price : null,
      listingTractCount: null,
    },
  }
}

/** What a report row prints for one figure: the server's string verbatim
 *  when the row carries `figuresDisplay`; "\u2014" for a parcel row without it
 *  (never a number built from the row's numeric copy); `null` for any other
 *  row (tracts) so the caller keeps its own tract formatting. */
export function rowDisplay(
  t: { figuresDisplay?: ServerDisplay | null; tractId?: string | null; savedId?: string | null },
  key: DisplayKey,
): string | null {
  if (t.figuresDisplay) return figDisplay({ display: t.figuresDisplay }, key)
  return t.tractId || t.savedId ? null : DASH
}

/** "38.69 ac (52%)" — the server's acres string plus its % tillable string
 *  when it sent one (it has no % for timber); "Updating…" alone while the
 *  parcel is re-measured; "—" when neither exists. */
export function compositionText(f: { display?: ServerDisplay | null }, which: 'tillable' | 'timber'): string {
  const acres = figDisplay(f, which === 'tillable' ? 'tillable_acres' : 'timber_acres')
  const pct = which === 'tillable' ? figDisplay(f, 'pct_tillable') : DASH
  if (!figShown(acres)) return figShown(pct) ? pct : DASH
  if (acres === UPDATING) return acres
  return figShown(pct) ? `${acres} ac (${pct})` : `${acres} ac`
}

/** "PI 131.2" — the server's label and rating strings; "Updating…" alone
 *  while re-measured. `fallbackLabel` only names the rating when the server
 *  sent no rating_label. */
export function ratingText(f: { display?: ServerDisplay | null }, fallbackLabel: string): string {
  const rating = figDisplay(f, 'rating')
  if (rating === UPDATING) return rating
  const label = figDisplay(f, 'rating_label')
  return `${figShown(label) ? label : fallbackLabel} ${rating}`
}

/** The strings a parcel report-row card prints (owner 11/20): all the
 *  server's, verbatim. `null` for a row that is not server-figures driven
 *  (an auction tract) — that row keeps its tract formatting. A parcel row
 *  whose payload carried no `figures` is all "\u2014". `totalLabel` is the
 *  caller's "Sale Price" label for price_mode "total". */
export interface RowCells {
  acres: string
  /** "$/Acre", or `totalLabel` when the server's price_mode is "total" */
  priceLabel: string
  /** price_per_acre, or the total price when price_mode is "total" */
  priceValue: string
  tillable: string
  rating: string
  sale: string
  pricePerTillable: string
  pricePerRating: string
  date: string
}
export function rowCells(
  t: { figuresDisplay?: ServerDisplay | null; tractId?: string | null; savedId?: string | null; price?: { mode?: string } | null },
  totalLabel: string,
): RowCells | null {
  if (rowDisplay(t, 'acres') === null) return null
  const d = { display: t.figuresDisplay ?? null }
  const total = t.price?.mode === 'total'
  return {
    acres: figDisplay(d, 'acres'),
    priceLabel: total ? totalLabel : '$/Acre',
    priceValue: total ? figDisplay(d, 'price') : figDisplay(d, 'price_per_acre'),
    tillable: figDisplay(d, 'pct_tillable'),
    rating: figDisplay(d, 'rating'),
    sale: figDisplay(d, 'price'),
    pricePerTillable: figDisplay(d, 'price_per_tillable_acre'),
    pricePerRating: figDisplay(d, 'price_per_rating'),
    date: figDisplay(d, 'sale_date'),
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
