'use client'

/**
 * TractCleanupEditor — self-contained, single-tract clone of the Data Clean-Up
 * screen's "actionable" per-tract editor (src/app/admin/data-cleanup/page.tsx,
 * the `actionable ? (...)` branch). Logic copied VERBATIM from that page; the
 * only adaptations are page-level state → per-component state and the
 * optimistic patch/reload calls → a parent `onChanged()` refetch.
 *
 * Used by the Edit Listing v2 preview (/admin/listings/[id]/v2). Edit Listing
 * tracts are ALWAYS actionable, so the locked branch + add-tract + tract-number
 * pencil + View-on-Map + rescrape proposal banner are intentionally omitted.
 */

import { useState } from 'react'
import { Loader2, CheckCircle2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import TractMapEditor from '@/components/admin/TractMapEditor'
import TillableCluWorkshop from '@/components/admin/TillableCluWorkshop'
import TractDataCompare from '@/components/admin/TractDataCompare'
import SaleStatusChips from '@/components/admin/SaleStatusChips'
import { toRings } from '@/lib/polygonGeometry'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// $ formatter — — when null/blank (per spec deliverable 1).
const fmtMoney = (n: any) =>
  n != null && n !== '' ? '$' + Math.round(Number(n)).toLocaleString() : '—'

// The listings API serializes Decimal columns (total_acres, soil_rating, …) as
// STRINGS. Coerce to a real number (or null) before any .toFixed()/math or before
// passing to sub-components that expect numbers — otherwise "167.16".toFixed() throws
// and crashes the whole editor. (data-cleanup holds these as Numbers already.)
const num = (v: any): number | null => (v == null || v === '' ? null : Number(v))

interface TractCleanupEditorProps {
  tract: any
  listing: any
  onChanged: () => void | Promise<void>
  onDirtyChange?: (dirty: boolean) => void
}

// Whether the "Which price is correct?" basis question applies (and therefore
// gates the editors). Result-recorded AUCTIONS (sold/pending/no_sale) need it.
// PRIVATE TREATY listings only need it when SOLD — a listed/active or unsold PT
// has only an asking price, so there's no sale total vs $/acre to reconcile.
function priceBasisApplies(tract: any, listing: any): boolean {
  const status = String(tract?.sale_status || '')
  if (listing?.listing_type === 'private_treaty') return status === 'sold'
  return ['sold', 'pending', 'no_sale'].includes(status)
}

export default function TractCleanupEditor({ tract, listing, onChanged, onDirtyChange }: TractCleanupEditorProps) {
  // Per-tract COMPUTED values (acres from the map editor's live polygon, tillable
  // + soil from the CLU workshop's Compute) and the per-field source PICK.
  const [computed, setComputed] = useState<{
    acres?: number | null; tillable_acres?: number | null
    soil_rating?: number | null; soil_rating_type?: string | null
  }>({})
  const [chosen, setChosen] = useState<{
    acres?: 'scraped' | 'computed' | null
    tillable_acres?: 'scraped' | 'computed' | null
    soil_rating?: 'scraped' | 'computed' | null
  } | null>(null)

  // Bumped whenever the tract boundary is (re)saved so the CLU workshop re-fetches
  // CLUs against the now-current polygon (mirrors cluReloadKeys in data-cleanup).
  const [cluReload, setCluReload] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const [dataCompareDirty, setDataCompareDirty] = useState(false)
  const [mapDirty, setMapDirty] = useState(false)
  const [tillDirty, setTillDirty] = useState(false)

  // First ring of the saved polygon (data-cleanup uses tract.polygon_coordinates
  // directly; here we normalize through toRings so multi-polygon tracts work).
  const ring = toRings(tract.polygon_coordinates)[0] ?? null

  // ---- Savers (copied verbatim from data-cleanup, page-state → onChanged) ----

  // Save resolved field(s) to a live tract through the canonical update_tract
  // endpoint. Fields use DB column names (total_acres / tillable_acres /
  // soil_rating / soil_rating_type).
  async function saveTractFields(fields: Record<string, any>) {
    if (!Object.keys(fields).length) return
    // GUARD: never let an acre change touch a recorded price until the admin has
    // declared which price is the truth. Block the edit client-side with a clear
    // prompt (the backend also rejects it as a hard backstop).
    const changingAcres = 'total_acres' in fields && fields.total_acres != null
    const needsBasis = priceBasisApplies(tract, listing)
    if (changingAcres && needsBasis && !tract.edit_price_basis && fields.price_basis == null) {
      alert('Before changing this sold tract’s acres, choose which price is correct — the total price or the $/acre — using the "Which price is correct?" selector above. That keeps the price from being changed incorrectly.')
      await onChanged()  // revert optimistic
      return
    }
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) {
        const detail = (await res.json().catch(() => ({})))?.detail || `HTTP ${res.status}`
        if (String(detail).includes('PRICE_BASIS_REQUIRED')) {
          throw new Error('Choose which price is correct (total or $/acre) before changing this tract’s acres.')
        }
        throw new Error(String(detail))
      }
      // The PATCH reconciles the price triangle + rolls listing totals server-side,
      // so re-pull the listing to reflect the recomputed $/x.
      await onChanged()
    } catch (e: any) {
      alert(`Could not save tract value: ${e.message || e}`)
      await onChanged() // reload to revert the optimistic patch
    }
  }

  // Mark a tract human-reviewed-correct (or clear it). Writes ONLY the review
  // columns via the restricted endpoint — never polygon/tillable/soil/price.
  async function toggleReviewed() {
    const next = !tract.boundary_reviewed_by
    setReviewing(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/tract/${tract.id}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewed: next }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.detail || `HTTP ${res.status}`)
      await onChanged()
    } catch (e: any) {
      alert(`Could not update review state: ${e.message || e}`)
    } finally { setReviewing(false) }
  }

  // Per-tract "House on this tract" — saves immediately via the tract PATCH
  // (update_tract). A house on the tract implies a Residential land type — when
  // turning it ON, also add 'Residential' to land_types (don't remove on uncheck).
  async function saveTractHasHouse(next: boolean) {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ has_house: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch (e: any) {
      alert(`Could not save House flag: ${e.message || e}`)
      return
    }
    // Deliverable 1b: turning Has house ON also adds 'Residential' to land_types
    // (if not already present) and persists it. Do NOT remove on uncheck.
    const cur = (tract.land_types || []).filter(Boolean)
    const hasRes = cur.includes('Residential')
    if (next && !hasRes) {
      await saveTractLandTypes([...cur, 'Residential'])
    } else {
      await onChanged()
    }
  }

  // Per-tract "Buildings on this tract" — saves immediately via the tract PATCH.
  async function saveTractHasBuilding(next: boolean) {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ has_buildings: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await onChanged()
    } catch (e: any) {
      alert(`Could not save Buildings flag: ${e.message || e}`)
    }
  }

  // Per-tract Land Types — saves immediately via the tract PATCH (update_tract
  // syncs the legacy land_type singular server-side).
  async function saveTractLandTypes(next: string[]) {
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ land_types: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await onChanged()
    } catch (e: any) {
      alert(`Could not save land types: ${e.message || e}`)
    }
  }

  // ---- Render (copied verbatim from data-cleanup actionable branch) ----

  const reviewed = !!tract.boundary_reviewed_by

  // See priceBasisApplies(): result-recorded auctions need it; private treaty
  // needs it only when SOLD. When it applies and no basis is picked yet, ALL
  // editing is gated until the admin chooses.
  const needsBasis = priceBasisApplies(tract, listing)
  // Only an EXACT valid basis unlocks editing — any other value (null, '', junk) gates.
  const hasValidBasis = tract.edit_price_basis === 'per_acre' || tract.edit_price_basis === 'lump_sum'
  const basisGate = needsBasis && !hasValidBasis

  // The basis question block — loud colors, shown for result-recorded tracts.
  const basisBlock = needsBasis ? (
    <div className={`mb-4 rounded-lg border-2 px-4 py-3 text-center ${tract.edit_price_basis ? 'border-gg-gray-700 bg-gg-gray-900' : 'border-amber-400 bg-amber-400/15'}`}>
      <div className="flex items-center justify-center gap-3 flex-wrap">
        <span className={`text-sm font-bold ${tract.edit_price_basis ? 'text-white' : 'text-amber-300'}`}>
          {tract.edit_price_basis
            ? 'Which price is correct?'
            : '⚠ First, which price is correct for this sale?'}
        </span>
        <button
          type="button"
          onClick={() => saveTractFields({ price_basis: 'lump_sum' })}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
          style={tract.edit_price_basis === 'lump_sum'
            ? { backgroundColor: '#c563ad', color: '#ffffff', border: '2px solid #000000' }
            : { backgroundColor: '#2a2a2a', color: '#bbbbbb' }}
        >
          {tract.edit_price_basis === 'lump_sum' ? '✓ ' : ''}Total price is correct
        </button>
        <button
          type="button"
          onClick={() => saveTractFields({ price_basis: 'per_acre' })}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors"
          style={tract.edit_price_basis === 'per_acre'
            ? { backgroundColor: '#c563ad', color: '#ffffff', border: '2px solid #000000' }
            : { backgroundColor: '#2a2a2a', color: '#bbbbbb' }}
        >
          {tract.edit_price_basis === 'per_acre' ? '✓ ' : ''}$/acre is correct
        </button>
      </div>
      {/* Current values to help decide which price is correct. */}
      <div className="mt-2 flex flex-wrap justify-center gap-x-5 gap-y-1 text-xs text-gg-gray-400">
        <span>Total price: <span className="text-white font-semibold">{fmtMoney(tract.sale_price)}</span></span>
        <span>$/acre: <span className="text-white font-semibold">{fmtMoney(tract.price_per_acre)}</span></span>
        <span>Saved acres: <span className="text-white font-semibold">{num(tract.total_acres) != null ? `${num(tract.total_acres)!.toFixed(2)} ac` : '—'}</span></span>
      </div>
      <p className="text-[11px] text-gg-gray-400 mt-1.5">
        {tract.edit_price_basis === 'per_acre'
          ? 'Locked: $/acre. Changing acres will recompute the TOTAL price.'
          : tract.edit_price_basis === 'lump_sum'
          ? 'Locked: total price. Changing acres will recompute the $/acre.'
          : 'You must answer this before editing the polygon, tillable, or acres.'}
      </p>
    </div>
  ) : null

  // Read-only stat box — dark, centered, shown down by the action button.
  const statsBox = (
    <div className="flex-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 rounded-lg bg-gg-gray-900 border border-gg-gray-800 px-4 py-3 text-xs text-gg-gray-300 text-center">
      <span>Total: <span className="text-white font-medium">{num(tract.total_acres) != null ? `${num(tract.total_acres)!.toFixed(1)} ac` : '—'}</span></span>
      <span>Tillable: <span className="text-white font-medium">{num(tract.tillable_acres) != null ? `${num(tract.tillable_acres)!.toFixed(1)} ac` : '—'}</span></span>
      <span>Soil: <span className="text-white font-medium">{num(tract.soil_rating) != null ? `${num(tract.soil_rating)!.toFixed(1)} ${tract.soil_rating_type || ''}` : '—'}</span></span>
      <span>Sale: <span className="text-white font-medium">{tract.sale_status ? tract.sale_status.replace('_', ' ') : '—'}</span></span>
      <span>Sold price: <span className="text-white font-medium">{fmtMoney(tract.sale_price)}</span></span>
      <span>$/acre: <span className="text-white font-medium">{fmtMoney(tract.price_per_acre)}</span></span>
      <span>$/tillable: <span className="text-white font-medium">{fmtMoney(tract.price_per_tillable_acre)}</span></span>
      <span>$/soil pt: <span className="text-white font-medium">{fmtMoney(tract.price_per_soil_rating)}</span></span>
      <span>Polygon: <span className="text-white font-medium">{ring && ring.length ? `${ring.length} pts` : 'none'}</span></span>
    </div>
  )

  return (
    <div>
      {/* Sale Status chips — always accessible regardless of basisGate.
          Saves via existing saveTractFields so prices + listing rollup follow. */}
      <SaleStatusChips
        status={tract.sale_status}
        onChange={(next) => saveTractFields({ sale_status: next || null })}
        disabled={reviewing}
      />
      {/* The price-basis question comes FIRST and gates all editing for
          result-recorded tracts (sold/pending/no_sale). */}
      {basisBlock}
      {basisGate ? (
        <div className="mb-2 text-sm text-gg-gray-400 italic">
          Answer the price question above to unlock the polygon, tillable, and acreage editors.
        </div>
      ) : (
        <>
          {/* LIVE-TRACT boundary editor — saves ONLY the polygon via
              the restricted tract-fix-boundary/apply endpoint. */}
          <TractMapEditor
            stagingId={0}
            tractIndex={0}
            liveTractId={tract.id}
            tractNumber={tract.tract_number}
            // Pass the listing's full tract list so an Upload Image routes
            // through the VALIDATED multi-tract overview tracer.
            siblingTracts={(listing.tracts || []).map((t: any) => ({
              tract_number: t.tract_number ?? null,
              total_acres: t.total_acres ?? null,
              tillable_acres: t.tillable_acres ?? null,
            }))}
            // OTHER live tracts' polygons → shared-boundary reference + snap targets.
            neighborPolygons={(listing.tracts || [])
              .filter((t: any) => t.id !== tract.id)
              .map((t: any) => t.polygon_coordinates as any)
              .filter((p: any) => Array.isArray(p) && p.length >= 3)}
            initialPolygon={ring}
            // No rescrape proposals in Edit Listing.
            proposedPolygon={null}
            proposedNonce={0}
            hideTillable
            tillablePolygon={null}
            showTillable={false}
            sourceImageUrl={tract.image_url || listing.primary_image_url}
            sourceImageKind="listing_image"
            listingUrl={listing.source_url}
            listingState={tract.state_abbr || listing.state}
            listingAddress={listing.address}
            scrapedAcres={num(tract.total_acres)}
            latitude={num(tract.latitude)}
            longitude={num(tract.longitude)}
            onUpdate={() => {
              setCluReload((n) => n + 1)
              onChanged()
            }}
            onDirtyChange={(d) => {
              setMapDirty(d)
              onDirtyChange?.(d || tillDirty || dataCompareDirty)
            }}
            // Capture the live polygon's GIS acreage as the "Computed"
            // total-acres source for the comparison box below.
            onPolygonChange={(_pts, ac) => setComputed((prev) => ({ ...prev, acres: ac }))}
          />
          {/* FSA-CLU tillable workshop — live published-tract mode. */}
          <TillableCluWorkshop
            tractId={tract.id}
            reloadKey={cluReload}
            latitude={num(tract.latitude)}
            longitude={num(tract.longitude)}
            onSaved={() => { onChanged() }}
            // Capture the freshly-computed tillable + soil as the "Computed"
            // source (fires on Compute, BEFORE the admin saves).
            onComputed={(c) => setComputed((prev) => ({
              ...prev,
              tillable_acres: c.tillable_acres ?? null,
              soil_rating: c.soil_rating ?? null,
              soil_rating_type: c.soil_rating_type ?? null,
            }))}
            onDirtyChange={(d) => {
              setTillDirty(d)
              onDirtyChange?.(d || mapDirty || dataCompareDirty)
            }}
          />
          {/* Source comparison — Current (saved) vs Computed vs hand-typed,
              per field. Writes through update_tract so $/acre + listing totals follow. */}
          <div className="mt-3">
            <TractDataCompare
              scrapedLabel="Current (saved)"
              computedLabel="Computed"
              hasHouse={!!tract.has_house}
              onHasHouseChange={(next) => saveTractHasHouse(next)}
              hasBuilding={!!tract.has_buildings}
              onHasBuildingChange={(next) => saveTractHasBuilding(next)}
              landTypes={tract.land_types}
              onLandTypesChange={(next) => saveTractLandTypes(next)}
              scraped={{
                acres: num(tract.total_acres),
                tillable_acres: num(tract.tillable_acres),
                soil_rating: num(tract.soil_rating),
                soil_rating_type: tract.soil_rating_type,
              }}
              computed={computed}
              chosen={chosen}
              onChosenChange={(next) => {
                const prev = chosen || {}
                setChosen(next)
                const cv = computed
                const fields: Record<string, any> = {}
                ;(['acres', 'tillable_acres', 'soil_rating'] as const).forEach((f) => {
                  if (next[f] === prev[f]) return
                  if (next[f] === 'computed') {
                    const val = (cv as any)[f] ?? null
                    if (f === 'acres') fields.total_acres = val
                    else if (f === 'tillable_acres') fields.tillable_acres = val
                    else {
                      fields.soil_rating = val
                      fields.soil_rating_type = val != null && cv.soil_rating_type ? cv.soil_rating_type : null
                    }
                  } else if (next[f] === 'scraped') {
                    // Admin reverted to Current (saved). Re-send the tract's
                    // current DB values so a prior Computed click is undone.
                    if (f === 'acres') fields.total_acres = tract.total_acres
                    else if (f === 'tillable_acres') fields.tillable_acres = tract.tillable_acres
                    else {
                      fields.soil_rating = tract.soil_rating
                      fields.soil_rating_type = tract.soil_rating_type
                    }
                  }
                })
                saveTractFields(fields)
              }}
              onManualChange={(field, value) => {
                // value == null means the admin cleared the field — send null
                // so the backend persists the clear (D11 fix).
                const fields: Record<string, any> = {}
                if (field === 'acres') fields.total_acres = value
                else if (field === 'tillable_acres') fields.tillable_acres = value
                else {
                  fields.soil_rating = value
                  // D12: derive soil_rating_type from the tract's state so a
                  // manual rating entry doesn't leave a stale mismatched type.
                  if (value != null) {
                    const STATE_SOIL_LABELS: Record<string, string> = {
                      IL: 'PI', IA: 'CSR2', IN: 'WAPI', MO: 'NCCPI', MN: 'CPI',
                      NE: 'NCCPI', SD: 'PI', ND: 'PI', KS: 'NCCPI', OH: 'NCCPI',
                      MI: 'NCCPI', WI: 'PI', KY: 'NCCPI', TN: 'NCCPI', WV: 'NCCPI', VA: 'NCCPI',
                    }
                    const st = (tract.state_abbr || '').toUpperCase()
                    fields.soil_rating_type = STATE_SOIL_LABELS[st] ?? tract.soil_rating_type ?? null
                  } else {
                    fields.soil_rating_type = null
                  }
                }
                saveTractFields(fields)
              }}
              onDirtyChange={(d) => { setDataCompareDirty(d); onDirtyChange?.(d || mapDirty || tillDirty) }}
            />
          </div>
          {/* Done = human confirmed polygon + tillable + soil. */}
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={() => toggleReviewed()}
              disabled={reviewing || dataCompareDirty || mapDirty || tillDirty}
              title={dataCompareDirty || mapDirty || tillDirty ? 'Save changes first' : undefined}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                reviewed
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-gg-gray-800 text-white border border-gg-gray-700 hover:bg-gg-gray-700'
              }`}
            >
              {reviewing
                ? <Loader2 className="animate-spin" size={16} />
                : <CheckCircle2 size={16} />}
              {reviewed ? 'Reviewed ✓ (click to undo)' : 'Mark tract reviewed'}
            </button>
            {reviewed && tract.boundary_reviewed_at && (
              <span className="text-xs text-gg-gray-500 whitespace-nowrap">
                {new Date(tract.boundary_reviewed_at).toLocaleString()}
              </span>
            )}
            {statsBox}
          </div>
        </>
      )}
    </div>
  )
}
