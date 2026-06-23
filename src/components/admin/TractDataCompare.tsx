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

import { useEffect, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import LandTypeButtons from '@/components/admin/LandTypeButtons'
import { fetchScraperProxy } from '@/lib/fetchWithAuth'

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
  /** Per-field hand-typed overrides (acres / tillable_acres / soil_rating).
   *  When a field has a value here it WINS over Scraped/Computed, which then
   *  show un-highlighted. onManualChange fires with the parsed number (or null
   *  to clear). */
  manual?: ScrapedComputed | null
  onManualChange?: (field: 'acres' | 'tillable_acres' | 'soil_rating', value: number | null) => void
  /** Labels for the two source columns. Defaults to Scraped/Computed; the
   *  data-cleanup screen passes "Current (saved)" for the left column since
   *  that value is the live DB value, not scraper output. */
  scrapedLabel?: string
  computedLabel?: string
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
  /** Whether the scraper / admin marked this tract as having buildings
   *  on it. Auto-seeded from the scraper's has_building output; the
   *  admin can toggle it here in case the scraper got it wrong. Feeds
   *  the map's "has buildings" show/hide filter at verify time. */
  hasBuilding?: boolean
  onHasBuildingChange?: (next: boolean) => void
  /** Whether the scraper / admin marked this tract as having a house on it.
   *  Auto-seeded from the scraper's has_house output; the admin can toggle it
   *  here when the scraper got it wrong. Saved into scraped_data so Verify
   *  persists it. */
  hasHouse?: boolean
  onHasHouseChange?: (next: boolean) => void
  /** Current land_types for this tract + an auto-save callback. Rendered as
   *  the add/remove Land Types buttons; saved into scraped_data on change. */
  landTypes?: string[] | null
  onLandTypesChange?: (next: string[]) => void
  /** Fires true when the comparison box has unsaved changes (manual text typed
   *  but not committed, or a radio/checkbox changed but the parent hasn't
   *  updated the corresponding prop yet). Fires false once clean. */
  onDirtyChange?: (dirty: boolean) => void
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

const SCRAPER_PROXY = '/api/scraper-proxy'

export default function TractDataCompare({
  tractNumber,
  scraped,
  computed,
  chosen,
  onChosenChange,
  manual,
  onManualChange,
  scrapedLabel = 'Scraped',
  computedLabel = 'Computed',
  fallbackTract,
  siblingTractNumbers,
  stagingId,
  tractIndex,
  onTractNumberChange,
  hasBuilding,
  onHasBuildingChange,
  hasHouse,
  onHasHouseChange,
  landTypes,
  onLandTypesChange,
  onDirtyChange,
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
      const res = await fetchScraperProxy(
        `/api/staging/${stagingId}/tracts/${tractIndex}/tract-number`,
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
  // Local copy so the radios feel snappy even before the parent
  // commits the change.
  //
  // IMPORTANT: this hook MUST be declared before the early-return
  // below. Previously it lived after the `if (!hasNewFormat) return ...`
  // block, which violated Rules of Hooks: if the same component
  // instance flipped between old-format and new-format renders (which
  // happens during SSR→client hydration when scraped/computed arrive
  // asynchronously), the hook count changed between renders and React
  // threw error #310 "Rendered more hooks than during the previous
  // render." It also caused hydration mismatches (#418/#425/#423)
  // because server and client rendered different DOM shapes. The fix
  // is to ALWAYS call every hook on every render; the conditional
  // early-return now happens AFTER all hooks have been declared.
  const [local, setLocal] = useState<Chosen>(chosen || {})

  // Hand-typed override drafts (string per field, seeded from the persisted
  // `manual` values). When a draft is non-empty it WINS over Scraped/Computed.
  // Declared before the early-return to satisfy Rules of Hooks.
  const seedManual = (): Record<string, string> => ({
    acres: manual?.acres != null ? String(manual.acres) : '',
    tillable_acres: manual?.tillable_acres != null ? String(manual.tillable_acres) : '',
    soil_rating: manual?.soil_rating != null ? String(manual.soil_rating) : '',
  })
  const [manualDraft, setManualDraft] = useState<Record<string, string>>(seedManual)
  useEffect(() => { setManualDraft(seedManual()) },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [manual?.acres, manual?.tillable_acres, manual?.soil_rating])
  // Commit a manual draft → parse + tell the parent to save (or clear on empty).
  // Clear the draft immediately after committing so hasManualPending goes false
  // right away (for parents that don't pass a `manual` prop back, e.g.
  // TractCleanupEditor, the draft would otherwise stay non-empty forever).
  const commitManual = (field: 'acres' | 'tillable_acres' | 'soil_rating') => {
    const raw = (manualDraft[field] ?? '').trim()
    if (raw === '') { onManualChange?.(field, null); return }
    const n = parseFloat(raw)
    onManualChange?.(field, isFinite(n) ? n : null)
    setManualDraft((p) => ({ ...p, [field]: '' }))
  }
  const clearManual = (field: 'acres' | 'tillable_acres' | 'soil_rating') => {
    setManualDraft((p) => ({ ...p, [field]: '' }))
    onManualChange?.(field, null)
  }

  // Has-buildings checkbox state. Seeded from the scraper's value;
  // local copy keeps the checkbox snappy before the parent commits.
  // Declared before the early-return below to satisfy Rules of Hooks.
  const [bldg, setBldg] = useState<boolean>(!!hasBuilding)
  useEffect(() => { setBldg(!!hasBuilding) }, [hasBuilding])
  const toggleBldg = () => {
    const next = !bldg
    setBldg(next)
    onHasBuildingChange?.(next)
  }
  const BuildingCheckbox = () => (
    !onHasBuildingChange ? null :
    <label
      className="flex items-center gap-2 mt-2 pt-2 border-t border-gg-gray-700 cursor-pointer text-xs text-gg-gray-300 select-none"
      title="Auto-checked when the scraper detects buildings on this tract. Uncheck if the scraper is wrong. Feeds the map's 'has buildings' filter."
    >
      <input
        type="checkbox"
        checked={bldg}
        onChange={toggleBldg}
        className="cursor-pointer accent-gg-pink w-4 h-4"
      />
      <span className="font-medium">Buildings on this tract</span>
      <span className="text-[10px] text-gg-gray-500">(auto-detected by scraper — edit if wrong)</span>
    </label>
  )

  // Has-house checkbox — mirrors Buildings. Auto-seeded from the scraper's
  // (now whole-word) has_house detection; the admin's value wins and is saved
  // into scraped_data so Verify persists it.
  const [house, setHouse] = useState<boolean>(!!hasHouse)
  useEffect(() => { setHouse(!!hasHouse) }, [hasHouse])
  const toggleHouse = () => {
    const next = !house
    setHouse(next)
    onHasHouseChange?.(next)
    // A house on the tract implies a Residential land type. Add it when the
    // box is checked, remove it when unchecked — keeps the two in sync.
    if (onLandTypesChange) {
      const cur = (landTypes || []).filter(Boolean)
      const hasRes = cur.includes('Residential')
      if (next && !hasRes) onLandTypesChange([...cur, 'Residential'])
      else if (!next && hasRes) onLandTypesChange(cur.filter((t) => t !== 'Residential'))
    }
  }
  const HouseCheckbox = () => (
    !onHasHouseChange ? null :
    <label
      className="flex items-center gap-2 mt-2 pt-2 border-t border-gg-gray-700 cursor-pointer text-xs text-gg-gray-300 select-none"
      title="Auto-checked when the scraper detects a house on this tract. Uncheck if the scraper is wrong. Saved on Verify."
    >
      <input
        type="checkbox"
        checked={house}
        onChange={toggleHouse}
        className="cursor-pointer accent-gg-pink w-4 h-4"
      />
      <span className="font-medium">House on this tract</span>
      <span className="text-[10px] text-gg-gray-500">(auto-detected by scraper — edit if wrong)</span>
    </label>
  )

  // Land Types add/remove buttons — auto-save into scraped_data on each click.
  const LandTypeRow = () => (
    onLandTypesChange ? (
      <div className="mt-2 pt-2 border-t border-gg-gray-700">
        <div className="text-[10px] text-gg-gray-500 mb-1 uppercase tracking-wide">Land Types (click to add / remove — saves instantly)</div>
        <LandTypeButtons value={landTypes} onChange={onLandTypesChange} />
      </div>
    ) : null
  )

  // Dirty: any manual draft is non-empty AND differs from the already-persisted
  // `manual` prop (i.e. the user typed a NEW value that hasn't been saved yet),
  // OR local chosen differs from the saved chosen prop (radio changed, parent
  // hasn't confirmed the save yet), OR a checkbox differs from its saved prop.
  //
  // NOTE: after commitManual() the draft is cleared to '' so this is false
  // immediately. For parents that DO pass a `manual` prop back (staging screens),
  // the useEffect re-seeds manualDraft from manual — we compare numerically so
  // a re-seeded draft that matches the saved value is NOT treated as pending.
  const hasManualPending = (['acres', 'tillable_acres', 'soil_rating'] as const).some((f) => {
    const draft = (manualDraft[f] ?? '').trim()
    if (draft === '') return false
    const savedNum = manual?.[f] ?? null
    const draftNum = parseFloat(draft)
    if (!isFinite(draftNum)) return true  // unparseable input → pending
    // If the draft parses to the same number already in the manual prop, it's
    // already been saved — not pending. If manual is absent/null the field
    // hasn't been persisted yet, so any non-empty draft IS pending.
    return savedNum == null || draftNum !== savedNum
  })
  const chosenDirty = ((['acres', 'tillable_acres', 'soil_rating'] as const) as string[]).some(
    (f) => (local as any)[f] !== ((chosen || {}) as any)[f]
  )
  const bldgDirty = bldg !== !!hasBuilding
  const houseDirty = house !== !!hasHouse
  const dataCompareDirty = hasManualPending || chosenDirty || bldgDirty || houseDirty || isDirty

  const onDirtyChangeRef = useRef(onDirtyChange)
  onDirtyChangeRef.current = onDirtyChange
  useEffect(() => { onDirtyChangeRef.current?.(dataCompareDirty) }, [dataCompareDirty])
  useEffect(() => () => { onDirtyChangeRef.current?.(false) }, [])

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
        <HouseCheckbox />
        <BuildingCheckbox />
        <LandTypeRow />
      </div>
    )
  }

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
    computedRaw,
  }: {
    label: string
    field: keyof Chosen
    scrapedVal: string
    computedVal: string
    /** Raw (unformatted) computed value — used to decide the default highlight.
     *  When null/undefined, Computed is not a meaningful default. */
    computedRaw?: number | string | null
  }) => {
    const f = field as 'acres' | 'tillable_acres' | 'soil_rating'
    // Only default to 'computed' when the computed value is actually present;
    // when computed is null/undefined the "Computed: —" card was being
    // highlighted even though no value had been saved, making it look like null
    // was selected when no save had ever fired.
    const picked = local[field] || (computedRaw != null ? defaultFor(field) : 'scraped')
    const isDefault = !local[field]
    // A non-empty hand-typed value WINS — neither source is then highlighted.
    const hasManual = (manualDraft[f] ?? '').trim() !== ''
    const scrapedActive = !hasManual && picked === 'scraped'
    const computedActive = !hasManual && picked === 'computed'
    const cardCls = (active: boolean) => active
      ? 'bg-gg-pink border border-gg-pink text-white'
      : 'border border-gg-gray-700 hover:bg-gg-gray-800/40 text-gg-gray-300'
    const prefixCls = (active: boolean) => active ? 'text-white/80' : 'text-gg-gray-500'
    const valueCls = (active: boolean) => active ? 'text-white font-mono font-semibold' : 'font-mono'
    const defaultCls = (active: boolean) => active ? 'ml-1 text-[10px] text-white/70' : 'ml-1 text-[10px] text-gg-gray-500'
    const dim = hasManual ? 'opacity-50' : ''
    return (
      <div className="py-1.5 border-b border-gg-gray-700 last:border-0">
        <div className="grid grid-cols-12 gap-2 items-center">
          <div className="col-span-3 text-xs font-medium text-gg-gray-400">{label}</div>
          <label className={`col-span-4 flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${dim} ${cardCls(scrapedActive)}`}>
            <input type="radio" name={`${field}-${tractNumber ?? 'x'}`} checked={scrapedActive}
              onClick={() => { setManualDraft((p) => ({ ...p, [f]: '' })); pick(field, 'scraped') }}
              className="cursor-pointer accent-gg-pink" />
            <span>
              <span className={prefixCls(scrapedActive)}>{scrapedLabel}: </span>
              <span className={valueCls(scrapedActive)}>{scrapedVal}</span>
              {isDefault && scrapedActive && <span className={defaultCls(true)}>(default)</span>}
            </span>
          </label>
          <label className={`col-span-5 flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-xs ${dim} ${cardCls(computedActive)}`}>
            <input type="radio" name={`${field}-${tractNumber ?? 'x'}`} checked={computedActive}
              onClick={() => { setManualDraft((p) => ({ ...p, [f]: '' })); pick(field, 'computed') }}
              className="cursor-pointer accent-gg-pink" />
            <span>
              <span className={prefixCls(computedActive)}>{computedLabel}: </span>
              <span className={valueCls(computedActive)}>{computedVal}</span>
              {isDefault && computedActive && <span className={defaultCls(true)}>(default)</span>}
            </span>
          </label>
        </div>
        {/* Hand-typed override — wins over both sources when filled. */}
        <div className="grid grid-cols-12 gap-2 items-center mt-1">
          <div className="col-span-3 text-[10px] text-gg-gray-500">↳ or hand-type</div>
          <div className="col-span-9 flex items-center gap-2">
            <input
              type="text" inputMode="decimal"
              value={manualDraft[f] ?? ''}
              onChange={(e) => setManualDraft((p) => ({ ...p, [f]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitManual(f) } }}
              placeholder="type a value, then ✓ to save"
              style={{ backgroundColor: '#ffffff', color: '#000000', caretColor: '#000000' }}
              className={`w-36 px-2 py-0.5 text-xs font-mono rounded border focus:outline-none ${hasManual ? 'border-gg-pink ring-1 ring-gg-pink' : 'border-gg-gray-600'}`}
            />
            {hasManual && (
              <button
                type="button"
                onClick={() => commitManual(f)}
                title="Save this value to the tract"
                className="px-2 py-1 text-xs bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-1 flex-shrink-0"
              >
                <Check size={14} />
              </button>
            )}
            {hasManual && <span className="text-[10px] text-gg-pink font-semibold">← saving this</span>}
            {hasManual && (
              <button type="button" onClick={() => clearManual(f)}
                className="text-[10px] text-gg-gray-400 hover:text-white underline">clear</button>
            )}
          </div>
        </div>
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
      {/* Call Row as a function (not <Row/>) so it does NOT remount on every
          keystroke — otherwise the hand-typed input loses focus after one
          character (and previously auto-saved on that blur). */}
      {Row({
        label: 'Acres',
        field: 'acres',
        scrapedVal: fmtAcres(s.acres),
        computedVal: fmtAcres(c.acres),
        computedRaw: c.acres,
      })}
      {Row({
        label: 'Tillable',
        field: 'tillable_acres',
        scrapedVal: fmtAcres(s.tillable_acres),
        computedVal: fmtAcres(c.tillable_acres),
        computedRaw: c.tillable_acres,
      })}
      {Row({
        label: 'Soil rating',
        field: 'soil_rating',
        scrapedVal: fmtSoil(s.soil_rating, s.soil_rating_type),
        computedVal: fmtSoil(c.soil_rating, c.soil_rating_type),
        computedRaw: c.soil_rating,
      })}
      <HouseCheckbox />
      <BuildingCheckbox />
      <LandTypeRow />
      <div className="flex justify-between mt-1 pt-1 text-[10px] text-gg-gray-600">
        <span>Scraped source: {s.source || 'unknown'}</span>
        <span>Computed source: {c.source || 'magic-lab'}</span>
      </div>
    </div>
  )
}
