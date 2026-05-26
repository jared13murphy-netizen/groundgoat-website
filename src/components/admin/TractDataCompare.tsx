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

import { useEffect, useState } from 'react'

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
  tractNumber?: number | string
  scraped?: ScrapedComputed | null
  computed?: ScrapedComputed | null
  chosen?: Chosen | null
  onChosenChange?: (next: Chosen) => void
  /** Old-format tract dict (acres/tillable_acres at top level). When
   *  the new scraped/computed split isn't present, render this as the
   *  single source. */
  fallbackTract?: any
  /** All tract numbers in this listing (string-normalized) — used for
   *  client-side dedup when the user types a new number. The server
   *  enforces uniqueness too, but checking client-side gives instant
   *  feedback. */
  siblingTractNumbers?: string[]
  /** When set, the tract number is editable. Saves via
   *  POST /api/staging/{stagingId}/tracts/{tractIndex}/tract-number
   *  Per user 2026-05-26: tract↔polygon pairing bugs are common; the
   *  cleanest fix is letting the user re-type the correct tract number
   *  on a polygon that's labeled wrong. */
  stagingId?: number
  tractIndex?: number
  onTractNumberChange?: (newNumber: string) => void
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

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

export default function TractDataCompare({
  tractNumber,
  scraped,
  computed,
  chosen,
  onChosenChange,
  fallbackTract,
  siblingTractNumbers,
  stagingId,
  tractIndex,
  onTractNumberChange,
}: TractDataCompareProps) {
  // Editable tract number — per user 2026-05-26: when the scraper paired
  // the wrong polygon with the wrong tract number (Steffes-class bug),
  // typing the correct number here re-pairs everything in one click.
  // Server enforces uniqueness; we also check client-side for instant
  // feedback before hitting the network.
  const canEdit = stagingId != null && tractIndex != null
  const initialNumStr = tractNumber != null ? String(tractNumber) : ''
  const [numDraft, setNumDraft] = useState<string>(initialNumStr)
  const [numSaving, setNumSaving] = useState(false)
  const [numStatus, setNumStatus] = useState<string | null>(null)
  useEffect(() => { setNumDraft(initialNumStr); setNumStatus(null) }, [initialNumStr])

  const normalize = (s: string): string => {
    const m = s.trim().match(/\d+/)
    return m ? m[0] : s.trim()
  }
  const isDirty = canEdit && normalize(numDraft) !== normalize(initialNumStr)
  const wouldCollide = canEdit && isDirty && (() => {
    const want = normalize(numDraft)
    if (!want) return false
    const sibs = (siblingTractNumbers || [])
      .filter(s => normalize(s) !== normalize(initialNumStr))
    return sibs.some(s => normalize(s) === want)
  })()

  const handleSaveNumber = async () => {
    if (!canEdit) return
    const want = normalize(numDraft)
    if (!want) {
      setNumStatus('✗ Empty — type a tract number')
      return
    }
    if (wouldCollide) {
      setNumStatus(`✗ Tract ${want} already in this listing — pick a unique number`)
      return
    }
    setNumSaving(true)
    setNumStatus(null)
    try {
      const res = await fetch(
        `${SCRAPER_URL}/api/staging/${stagingId}/tracts/${tractIndex}/tract-number`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tract_number: want }),
        }
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setNumStatus(`✓ Saved as Tract ${want}`)
      onTractNumberChange?.(want)
    } catch (e: any) {
      setNumStatus(`✗ Save failed: ${e.message || e}`)
    } finally {
      setNumSaving(false)
    }
  }
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
  // Per user 2026-05-25 readability feedback: the highlighted card
  // uses full gg-pink (not /20 opacity which muddied to purple on
  // the dark Tract Details charcoal). Unhighlighted text stays
  // gray for visual hierarchy; highlighted text becomes white.
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
    const cardCls = (active: boolean) => active
      ? 'bg-gg-pink border border-gg-pink text-white'
      : 'border border-gg-gray-700 hover:bg-gg-gray-800/40 text-gg-gray-300'
    // Inside-card colors flip with active state so contrast is
    // legible on pink and on dark.
    const prefixCls = (active: boolean) => active
      ? 'text-white/80'
      : 'text-gg-gray-500'
    const valueCls = (active: boolean) => active
      ? 'text-white font-mono font-semibold'
      : 'font-mono'
    const defaultCls = (active: boolean) => active
      ? 'ml-1 text-[10px] text-white/70'
      : 'ml-1 text-[10px] text-gg-gray-500'
    return (
      <div className="grid grid-cols-12 gap-2 items-center py-1.5 border-b border-gg-gray-700 last:border-0">
        <div className="col-span-3 text-xs font-medium text-gg-gray-400">
          {label}
        </div>
        <label className={`col-span-4 flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${cardCls(picked === 'scraped')}`}>
          <input
            type="radio"
            name={`${field}-${tractNumber ?? 'x'}`}
            checked={picked === 'scraped'}
            onChange={() => pick(field, 'scraped')}
            className="cursor-pointer accent-gg-pink"
          />
          <span>
            <span className={prefixCls(picked === 'scraped')}>Scraped: </span>
            <span className={valueCls(picked === 'scraped')}>{scrapedVal}</span>
            {isDefault && picked === 'scraped' && (
              <span className={defaultCls(true)}>(default)</span>
            )}
          </span>
        </label>
        <label className={`col-span-5 flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${cardCls(picked === 'computed')}`}>
          <input
            type="radio"
            name={`${field}-${tractNumber ?? 'x'}`}
            checked={picked === 'computed'}
            onChange={() => pick(field, 'computed')}
            className="cursor-pointer accent-gg-pink"
          />
          <span>
            <span className={prefixCls(picked === 'computed')}>Computed: </span>
            <span className={valueCls(picked === 'computed')}>{computedVal}</span>
            {isDefault && picked === 'computed' && (
              <span className={defaultCls(true)}>(default)</span>
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
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="text-xs font-semibold text-gg-gray-300 flex items-center gap-2 flex-wrap">
          {canEdit ? (
            <>
              <span>Tract</span>
              <input
                type="text"
                value={numDraft}
                onChange={(e) => setNumDraft(e.target.value)}
                disabled={numSaving}
                // Inline style for bg/color wins over the browser's
                // user-agent default white-on-white for text inputs.
                // Per user 2026-05-26: the input was showing white text
                // on white bg (default Safari/Chrome text input).
                style={{
                  backgroundColor: '#ffffff',
                  color: '#000000',
                  caretColor: '#000000',
                }}
                className={`w-12 px-1.5 py-0.5 text-sm font-bold rounded border ${
                  wouldCollide
                    ? 'border-red-500'
                    : isDirty
                      ? 'border-gg-pink'
                      : 'border-gg-gray-600'
                } focus:outline-none focus:ring-2 focus:ring-gg-pink`}
                title="Type the tract number this polygon belongs to. Each tract in the listing must have a unique number."
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isDirty && !wouldCollide && !numSaving) {
                    handleSaveNumber()
                  }
                }}
              />
              {isDirty && (
                <button
                  onClick={handleSaveNumber}
                  disabled={numSaving || wouldCollide}
                  className="px-2 py-0.5 text-[10px] bg-gg-pink hover:bg-gg-pink-light text-white rounded disabled:opacity-40"
                  title={wouldCollide ? 'Duplicate — pick a unique number' : 'Save tract number'}
                >
                  {numSaving ? 'Saving…' : 'Save #'}
                </button>
              )}
              <span className="text-gg-gray-500">— Data comparison</span>
            </>
          ) : (
            tractNumber != null
              ? `Tract ${tractNumber} — Data comparison`
              : 'Data comparison'
          )}
        </div>
        <div className="text-[10px] text-gg-gray-500">
          Pick which value to save. Highlighted = chosen.
        </div>
      </div>
      {numStatus && (
        <div className={`mb-2 text-[10px] ${numStatus.startsWith('✓') ? 'text-green-300' : 'text-red-300'}`}>
          {numStatus}
        </div>
      )}
      {wouldCollide && !numStatus && (
        <div className="mb-2 text-[10px] text-red-300">
          ✗ Another tract in this listing is already number {normalize(numDraft)} — pick a unique number.
        </div>
      )}
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
