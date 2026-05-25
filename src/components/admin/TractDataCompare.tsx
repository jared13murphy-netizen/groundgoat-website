'use client'

/**
 * TractDataCompare — side-by-side comparison of per-tract data,
 * with per-field radio so the admin picks which source to save.
 *
 * Per user 2026-05-25 requirement:
 *   "I need a side-by-side comparison of the following:
 *    - tract scraped acres vs drawn polygon calculated acres
 *    - tract scraped tillable acres vs drawn tillable polygon acres
 *    - tract scraped soil rating vs drawn tillable polygon soil rating
 *    Then I need to be able to choose what to use prior to saving."
 *
 * Data shape (set by scraper's enrich_scraped_tracts_with_polygons
 * after CHUNK C2a):
 *   tract.scraped  = {acres, tillable_acres, soil_rating, soil_rating_type, source}
 *                    (auctioneer / company-scraper / Claude page text)
 *   tract.computed = {acres, tillable_acres, soil_rating, soil_rating_type, source}
 *                    (magic-lab Stage 2+5 — polygon area, Stage 5 tillable, SSURGO
 *                    area-weighted across the tillable polygon only)
 *   tract.chosen   = {acres, tillable_acres, soil_rating, soil_rating_type}
 *                    (user picks via the radios below; null until picked)
 *
 * On Verify (next chunk), the staging backend reads tract.chosen and
 * writes those values to the canonical tracts table. If a field is
 * null in chosen, default to the more-trusted source per field:
 *   acres        → scraped (auctioneer is authoritative on tract size)
 *   tillable     → computed (no auctioneer measures tillable polygons)
 *   soil_rating  → computed (SSURGO area-weighted beats point lookups)
 *
 * Backwards compat: if `scraped` / `computed` keys aren't present (old
 * staging row format), this component renders a single "Original data"
 * panel reading from top-level tract fields. Old rows still display.
 */

import { useState } from 'react'

interface ScrapedComputed {
  acres?: number | null
  tillable_acres?: number | null
  soil_rating?: number | null
  soil_rating_type?: string | null
  source?: string | null
}

interface Chosen {
  acres?: 'scraped' | 'computed' | null
  tillable_acres?: 'scraped' | 'computed' | null
  soil_rating?: 'scraped' | 'computed' | null
}

interface TractDataCompareProps {
  tractNumber?: number
  scraped?: ScrapedComputed | null
  computed?: ScrapedComputed | null
  chosen?: Chosen | null
  onChosenChange?: (next: Chosen) => void
  /** Old-format tract dict (acres/tillable_acres at top level). When
   *  the new scraped/computed split isn't present, render this as the
   *  single source. */
  fallbackTract?: any
}

function fmtAcres(v?: number | null): string {
  if (v == null) return '—'
  const n = Number(v)
  if (!isFinite(n)) return '—'
  return `${n.toFixed(2)} ac`
}

function fmtSoil(rating?: number | null, type?: string | null): string {
  if (rating == null) return '—'
  const n = Number(rating)
  if (!isFinite(n)) return '—'
  return type ? `${n.toFixed(1)} ${type}` : n.toFixed(1)
}

export default function TractDataCompare({
  tractNumber,
  scraped,
  computed,
  chosen,
  onChosenChange,
  fallbackTract,
}: TractDataCompareProps) {
  // Backwards compat: if neither scraped nor computed is present, this
  // is an old-format staging row. Render single-source view from the
  // fallback tract dict.
  const hasNewFormat = !!(scraped || computed)
  if (!hasNewFormat) {
    const t = fallbackTract || {}
    return (
      <div className="bg-gg-gray-800/60 rounded-lg px-3 py-2 text-xs text-gg-gray-400">
        {tractNumber != null && (
          <span className="font-semibold text-gg-gray-300 mr-3">
            Tract {tractNumber} (old format)
          </span>
        )}
        <span className="mr-3">Acres: {fmtAcres(t.acres)}</span>
        <span className="mr-3">Tillable: {fmtAcres(t.tillable_acres)}</span>
        <span>Soil: {fmtSoil(t.soil_rating, t.soil_rating_type)}</span>
      </div>
    )
  }

  // Local copy so the radios feel snappy even before the parent
  // commits the change.
  const [local, setLocal] = useState<Chosen>(chosen || {})

  const pick = (field: keyof Chosen, src: 'scraped' | 'computed') => {
    const next = { ...local, [field]: src }
    setLocal(next)
    onChosenChange?.(next)
  }

  // Per-field default highlight (used when chosen is null) — matches
  // the "default to the more-trusted source per field" rule from the
  // header comment.
  const defaultFor = (field: keyof Chosen): 'scraped' | 'computed' => {
    if (field === 'acres') return 'scraped'         // auctioneer is authoritative on size
    if (field === 'tillable_acres') return 'computed' // no auctioneer measures this
    if (field === 'soil_rating') return 'computed'    // SSURGO area-weighted is better
    return 'scraped'
  }

  // Row helper. Renders the field name, two source columns, two
  // radio buttons. Highlights the default if user hasn't picked.
  const Row = ({
    label,
    field,
    scrapedVal,
    computedVal,
  }: {
    label: string
    field: keyof Chosen
    scrapedVal: string
    computedVal: string
  }) => {
    const picked = local[field] || defaultFor(field)
    const isDefault = !local[field]
    return (
      <div className="grid grid-cols-12 gap-2 items-center py-1.5 border-b border-gg-gray-700 last:border-0">
        <div className="col-span-3 text-xs font-medium text-gg-gray-400">
          {label}
        </div>
        <label
          className={`col-span-4 flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${
            picked === 'scraped'
              ? 'bg-gg-pink/20 border border-gg-pink/50'
              : 'border border-transparent hover:bg-gg-gray-800/40'
          }`}
        >
          <input
            type="radio"
            name={`${field}-${tractNumber ?? 'x'}`}
            checked={picked === 'scraped'}
            onChange={() => pick(field, 'scraped')}
            className="cursor-pointer"
          />
          <span>
            <span className="text-gg-gray-500">Scraped: </span>
            <span className="font-mono">{scrapedVal}</span>
            {isDefault && picked === 'scraped' && (
              <span className="ml-1 text-[10px] text-gg-gray-500">(default)</span>
            )}
          </span>
        </label>
        <label
          className={`col-span-5 flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${
            picked === 'computed'
              ? 'bg-gg-pink/20 border border-gg-pink/50'
              : 'border border-transparent hover:bg-gg-gray-800/40'
          }`}
        >
          <input
            type="radio"
            name={`${field}-${tractNumber ?? 'x'}`}
            checked={picked === 'computed'}
            onChange={() => pick(field, 'computed')}
            className="cursor-pointer"
          />
          <span>
            <span className="text-gg-gray-500">Computed: </span>
            <span className="font-mono">{computedVal}</span>
            {isDefault && picked === 'computed' && (
              <span className="ml-1 text-[10px] text-gg-gray-500">(default)</span>
            )}
          </span>
        </label>
      </div>
    )
  }

  const s = scraped || {}
  const c = computed || {}

  return (
    <div className="bg-gg-gray-800/60 rounded-lg px-3 py-2 mt-2">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-gg-gray-300">
          {tractNumber != null
            ? `Tract ${tractNumber} — Data comparison`
            : 'Data comparison'}
        </div>
        <div className="text-[10px] text-gg-gray-500">
          Pick which value to save. Highlighted = chosen.
        </div>
      </div>
      <Row
        label="Acres"
        field="acres"
        scrapedVal={fmtAcres(s.acres)}
        computedVal={fmtAcres(c.acres)}
      />
      <Row
        label="Tillable"
        field="tillable_acres"
        scrapedVal={fmtAcres(s.tillable_acres)}
        computedVal={fmtAcres(c.tillable_acres)}
      />
      <Row
        label="Soil rating"
        field="soil_rating"
        scrapedVal={fmtSoil(s.soil_rating, s.soil_rating_type)}
        computedVal={fmtSoil(c.soil_rating, c.soil_rating_type)}
      />
      <div className="flex justify-between mt-1 pt-1 text-[10px] text-gg-gray-600">
        <span>Scraped source: {s.source || 'unknown'}</span>
        <span>Computed source: {c.source || 'magic-lab'}</span>
      </div>
    </div>
  )
}
