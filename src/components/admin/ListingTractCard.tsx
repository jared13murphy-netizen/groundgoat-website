'use client'

import { useEffect, useMemo, useState } from 'react'
import { Pencil, Check, X, Loader2, Save, CheckCircle2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import TractMapEditor from '@/components/admin/TractMapEditor'
import TillableCluWorkshop from '@/components/admin/TillableCluWorkshop'
import LandTypeButtons from '@/components/admin/LandTypeButtons'

const API_URL = 'https://practical-serenity-production.up.railway.app'

const LAND_TYPES = ['Farm', 'Recreational', 'Pasture', 'Timber', 'Hunting', 'Vacant Land', 'CRP', 'Commercial', 'Residential', 'Development', 'Other']
const SOIL_TYPES = ['PI', 'CSR2', 'CPI', 'NCCPI', 'WAPI']
const SALE_STATUSES = ['auction', 'listed', 'pending', 'sold', 'no_sale']
const SALE_TYPES = ['auction', 'private_treaty', 'estate', 'exchange', 'other']

type Pt = [number, number]

interface Props {
  tract: any
  listing: any
  /** Refetch the listing after any save so derived $/x + rollups refresh. */
  onChanged: () => void | Promise<void>
}

const money = (v: any) =>
  v == null || v === '' ? '—' : `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const acres = (v: any) =>
  v == null || v === '' ? '—' : `${Number(v).toFixed(2)} ac`

// Scalar fields the card edits via PATCH /api/tracts/{id}. We send only the
// fields the admin actually changed, so the backend's price-triangle driver
// logic fires correctly (edit $/acre → sale_price; edit sale_price → $/acre;
// edit total_acres → $/acre; etc.) and never gets a conflicting pair.
// 'land_type' is NOT here — land types are managed by the auto-saving
// LandTypeButtons (multi-value land_types), not the scalar form Save.
const STR_FIELDS = ['name', 'description', 'soil_rating_type', 'sale_status', 'sale_type', 'price_basis', 'buyer', 'seller']
const NUM_FIELDS = ['total_acres', 'tillable_acres', 'soil_rating', 'csr2', 'sale_price', 'price_per_acre']
const BOOL_FIELDS = ['has_house', 'has_buildings']

export default function ListingTractCard({ tract, listing, onChanged }: Props) {
  const ring: Pt[] | null = useMemo(() => {
    const p = tract.polygon_coordinates
    return Array.isArray(p) && p.length >= 3 ? (p as Pt[]) : null
  }, [tract.polygon_coordinates])

  // ----- scalar form state (initialized from the tract) -----
  const initial = useMemo(() => {
    const o: Record<string, any> = {}
    for (const f of STR_FIELDS) o[f] = tract[f] ?? ''
    for (const f of NUM_FIELDS) o[f] = tract[f] != null ? String(tract[f]) : ''
    for (const f of BOOL_FIELDS) o[f] = !!tract[f]
    return o
  }, [tract])

  const [form, setForm] = useState<Record<string, any>>(initial)
  const [savingScalars, setSavingScalars] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  const dirty = useMemo(
    () => [...STR_FIELDS, ...NUM_FIELDS, ...BOOL_FIELDS].some((f) => String(form[f]) !== String(initial[f])),
    [form, initial]
  )

  // Editing any field clears the "Saved ✓" confirmation. Nothing here writes to
  // the server — scalar fields persist ONLY when the user clicks Save tract.
  const set = (f: string, v: any) => { setSaved(false); setForm((p) => ({ ...p, [f]: v })) }

  // ----- tract number inline edit (swap-safe endpoint) -----
  const [editingNum, setEditingNum] = useState(false)
  const [numDraft, setNumDraft] = useState(String(tract.tract_number ?? ''))
  const [savingNum, setSavingNum] = useState(false)
  const [cluReload, setCluReload] = useState(0)

  const saveTractNumber = async () => {
    const n = parseInt(numDraft, 10)
    if (!Number.isFinite(n) || n < 1) { setErr('Tract number must be ≥ 1'); return }
    setSavingNum(true); setErr('')
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/tract/${tract.id}/tract-number`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tract_number: n }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `HTTP ${res.status}`)
      setEditingNum(false)
      await onChanged()
    } catch (e: any) {
      setErr(e.message || 'Failed to save tract number')
    } finally {
      setSavingNum(false)
    }
  }

  const saveScalars = async () => {
    setSavingScalars(true); setErr('')
    try {
      const payload: Record<string, any> = {}
      for (const f of STR_FIELDS) {
        if (String(form[f]) !== String(initial[f])) payload[f] = form[f] === '' ? null : form[f]
      }
      for (const f of NUM_FIELDS) {
        if (String(form[f]) !== String(initial[f])) payload[f] = form[f] === '' ? null : parseFloat(form[f])
      }
      for (const f of BOOL_FIELDS) {
        if (!!form[f] !== !!initial[f]) payload[f] = !!form[f]
      }
      // Save any changed scalar fields.
      if (Object.keys(payload).length > 0) {
        const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const detail = (await res.json().catch(() => ({})))?.detail || `HTTP ${res.status}`
          if (String(detail).includes('PRICE_BASIS_REQUIRED')) {
            throw new Error('Choose which price is correct (Total price or $/acre) below before changing this tract’s acres.')
          }
          throw new Error(String(detail))
        }
      }
      // Saving a tract = confirming it: stamp boundary_reviewed_by/at so the
      // tract counts as reviewed (same flag the data-cleanup screen sets).
      const rev = await fetchWithAuth(`${API_URL}/api/admin/tract-cleanup/tract/${tract.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewed: true }),
      })
      if (!rev.ok) throw new Error((await rev.json().catch(() => ({}))).detail || `HTTP ${rev.status}`)
      await onChanged()
      setSaved(true)  // show "Saved ✓" until the next edit
    } catch (e: any) {
      setErr(e.message || 'Failed to save tract')
    } finally {
      setSavingScalars(false)
    }
  }

  // ----- Land Types: add/remove buttons, auto-saved (no Save button) -----
  const [landTypes, setLandTypes] = useState<string[]>(
    Array.isArray(tract.land_types) && tract.land_types.length
      ? tract.land_types
      : (tract.land_type ? [tract.land_type] : [])
  )
  useEffect(() => {
    setLandTypes(
      Array.isArray(tract.land_types) && tract.land_types.length
        ? tract.land_types
        : (tract.land_type ? [tract.land_type] : [])
    )
  }, [tract])
  const saveLandTypes = async (next: string[]) => {
    const prev = landTypes
    setLandTypes(next)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ land_types: next }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await onChanged()
    } catch (e: any) {
      setLandTypes(prev)
      setErr(e.message || 'Failed to save land types')
    }
  }

  const labelCls = 'block text-[11px] uppercase tracking-wide text-gg-gray-400 mb-1'
  const inputCls = 'w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm'
  const selectCls = 'w-full bg-white text-gray-900 border border-gg-gray-300 rounded-lg px-3 py-2 text-sm'

  return (
    <div className="border-t border-gg-gray-800 pt-5 first:border-t-0 first:pt-0">
      {/* Header: tract number (editable) + derived summary */}
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
        {editingNum ? (
          <div className="flex items-center gap-1.5">
            <span className="text-2xl text-white font-extrabold tracking-tight">Tract</span>
            <input
              type="number" min={1} step={1} autoFocus
              value={numDraft}
              onChange={(e) => setNumDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveTractNumber(); if (e.key === 'Escape') setEditingNum(false) }}
              disabled={savingNum}
              className="w-20 bg-gg-gray-800 border border-gg-gray-600 rounded px-2 py-1 text-xl text-white font-bold disabled:opacity-50"
            />
            <button onClick={saveTractNumber} disabled={savingNum} title="Save tract number"
              className="p-1.5 rounded bg-white text-gray-900 hover:bg-gray-100 disabled:opacity-50">
              {savingNum ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
            </button>
            <button onClick={() => setEditingNum(false)} disabled={savingNum} title="Cancel"
              className="p-1.5 rounded bg-gg-gray-800 text-gg-gray-300 border border-gg-gray-700 hover:bg-gg-gray-700 disabled:opacity-50">
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <p className="text-2xl text-white font-extrabold tracking-tight">Tract {tract.tract_number}</p>
            <button onClick={() => { setEditingNum(true); setNumDraft(String(tract.tract_number ?? '')) }}
              title="Edit tract number (scraper sometimes orders them wrong)"
              className="p-1 rounded text-gg-gray-400 hover:text-gg-pink hover:bg-gg-gray-800">
              <Pencil size={14} />
            </button>
          </div>
        )}
        {tract.boundary_reviewed_at && (
          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-green-500/15 text-green-400 border border-green-500/40">
            <CheckCircle2 size={12} /> Reviewed
          </span>
        )}
        </div>
      </div>

      {/* Derived, read-only — refreshes after any save (recomputed server-side) */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 mb-4 text-xs text-gg-gray-400">
        <span>$/acre: <span className="text-white font-medium">{money(tract.price_per_acre)}</span></span>
        <span>$/tillable: <span className="text-white font-medium">{money(tract.price_per_tillable_acre)}</span></span>
        <span>$/soil pt: <span className="text-white font-medium">{money(tract.price_per_soil_rating)}</span></span>
        <span>Polygon: <span className="text-white font-medium">{ring ? `${ring.length} pts` : 'none'}</span></span>
      </div>

      {/* Scalar fields */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div>
          <label className={labelCls}>Total acres</label>
          <input type="number" step="0.01" className={inputCls} value={form.total_acres} onChange={(e) => set('total_acres', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Tillable acres</label>
          <input type="number" step="0.01" className={inputCls} value={form.tillable_acres} onChange={(e) => set('tillable_acres', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Soil rating</label>
          <input type="number" step="0.01" className={inputCls} value={form.soil_rating} onChange={(e) => set('soil_rating', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Soil type</label>
          <select className={selectCls} value={form.soil_rating_type} onChange={(e) => set('soil_rating_type', e.target.value)}>
            <option value="">—</option>
            {SOIL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Sale price ($)</label>
          <input type="number" step="0.01" className={inputCls} value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Price / acre ($)</label>
          <input type="number" step="0.01" className={inputCls} value={form.price_per_acre} onChange={(e) => set('price_per_acre', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Sale status</label>
          <select className={selectCls} value={form.sale_status} onChange={(e) => set('sale_status', e.target.value)}>
            <option value="">—</option>
            {SALE_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className={labelCls}>Land types (click to add / remove — saves instantly)</label>
          <LandTypeButtons value={landTypes} onChange={saveLandTypes} />
        </div>
        <div>
          <label className={labelCls}>CSR2</label>
          <input type="number" step="0.01" className={inputCls} value={form.csr2} onChange={(e) => set('csr2', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Sale type</label>
          <select className={selectCls} value={form.sale_type} onChange={(e) => set('sale_type', e.target.value)}>
            <option value="">—</option>
            {SALE_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Buyer</label>
          <input type="text" className={inputCls} value={form.buyer} onChange={(e) => set('buyer', e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Seller</label>
          <input type="text" className={inputCls} value={form.seller} onChange={(e) => set('seller', e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm text-white mt-5">
          <input type="checkbox" checked={!!form.has_house} onChange={(e) => set('has_house', e.target.checked)} />
          Has house
        </label>
        <label className="flex items-center gap-2 text-sm text-white mt-5">
          <input type="checkbox" checked={!!form.has_buildings} onChange={(e) => set('has_buildings', e.target.checked)} />
          Has buildings
        </label>
      </div>

      {/* PRICE BASIS — required on a sold tract before its acres can change, so an
          acre edit recomputes the correct field instead of corrupting the price. */}
      {['sold', 'pending', 'no_sale'].includes(form.sale_status) && (
        <div className={`mb-3 rounded-lg border-2 px-3 py-2 ${form.price_basis ? 'border-gg-gray-700 bg-gg-gray-900' : 'border-amber-400 bg-amber-400/15'}`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-sm font-bold ${form.price_basis ? 'text-white' : 'text-amber-300'}`}>
              {form.price_basis ? 'Which price is correct?' : '⚠ Set which price is correct before changing acres:'}
            </span>
            <button
              type="button"
              onClick={() => set('price_basis', 'lump_sum')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                form.price_basis === 'lump_sum'
                  ? 'bg-gg-pink text-white border-2 border-black'
                  : 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
              }`}
            >
              {form.price_basis === 'lump_sum' ? '✓ ' : ''}Total price is correct
            </button>
            <button
              type="button"
              onClick={() => set('price_basis', 'per_acre')}
              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
                form.price_basis === 'per_acre'
                  ? 'bg-gg-pink text-white border-2 border-black'
                  : 'bg-gg-gray-700 text-gg-gray-300 hover:bg-gg-gray-600'
              }`}
            >
              {form.price_basis === 'per_acre' ? '✓ ' : ''}$/acre is correct
            </button>
          </div>
          <p className="text-[11px] text-gg-gray-500 mt-1">
            {form.price_basis === 'per_acre'
              ? 'Changing acres recomputes the TOTAL price ($/acre held). Save to apply.'
              : form.price_basis === 'lump_sum'
              ? 'Changing acres recomputes the $/acre (total price held). Save to apply.'
              : 'Pick the one your records show as correct, then Save.'}
          </p>
        </div>
      )}

      {err && <div className="mb-3 text-sm text-red-400">{err}</div>}

      <div className="flex justify-end items-center gap-3 mb-4">
        {saved && !dirty && !savingScalars && (
          <span className="inline-flex items-center gap-1 text-sm text-green-400 font-medium">
            <CheckCircle2 size={16} /> Saved
          </span>
        )}
        <button
          onClick={saveScalars}
          disabled={!dirty || savingScalars}
          title={dirty ? 'Save changes and mark this tract reviewed' : 'No unsaved changes'}
          className="flex items-center gap-2 px-4 py-2 bg-white text-gray-900 font-medium rounded-lg hover:bg-gray-100 disabled:opacity-40"
        >
          {savingScalars ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          {savingScalars ? 'Saving…' : 'Save tract'}
        </button>
      </div>

      {/* Boundary editor — saves polygon via tract-fix-boundary/apply */}
      <TractMapEditor
        stagingId={0}
        tractIndex={0}
        liveTractId={tract.id}
        tractNumber={tract.tract_number}
        siblingTracts={(listing.tracts || []).map((t: any) => ({
          tract_number: t.tract_number ?? null,
          total_acres: t.total_acres ?? null,
          tillable_acres: t.tillable_acres ?? null,
        }))}
        // OTHER tracts' polygons → shared-boundary reference + snap targets.
        neighborPolygons={(listing.tracts || [])
          .filter((t: any) => t.id !== tract.id)
          .map((t: any) => t.polygon_coordinates)
          .filter((p: any) => Array.isArray(p) && p.length >= 3)}
        initialPolygon={ring}
        hideTillable
        tillablePolygon={null}
        showTillable={false}
        sourceImageUrl={tract.image_url || listing.primary_image_url}
        sourceImageKind="listing_image"
        listingUrl={listing.source_url}
        listingState={tract.state_abbr || listing.state}
        listingAddress={listing.address}
        scrapedAcres={tract.total_acres}
        latitude={tract.latitude}
        longitude={tract.longitude}
        onUpdate={() => { setCluReload((k) => k + 1); onChanged() }}
      />

      {/* Tillable + soil workshop — saves via tracts/{id}/clu */}
      <TillableCluWorkshop
        tractId={tract.id}
        reloadKey={cluReload}
        latitude={tract.latitude}
        longitude={tract.longitude}
        onSaved={() => onChanged()}
      />
    </div>
  )
}
