// node --experimental-strip-types src/lib/mapFilterParams.test.ts
import assert from 'node:assert/strict'
import {
  resolveParcelDataScope, parcelDataFilterParams, anyParcelDataFilterSet, parcelDataControls,
} from './mapFilterParams.ts'
import { countActiveFilters } from './filterBadgeCount.ts'

const empty = {
  stateFilter: '', soilRatingMin: '', soilRatingMax: '', pctTillableMin: '', pctTillableMax: '',
  tillableAcresMin: '', tillableAcresMax: '', pricePerSoilRatingMin: '', pricePerSoilRatingMax: '',
}
const REGISTRY = ['IL']

// Goat Search: "land in Adams County IL and Lee County IA with soil rating
// over 80 and over 90% tillable" — two states, so the old code (exactly one
// registry state) sent neither filter.
const gs = { ...empty, stateFilter: 'IL,IA', soilRatingMin: '80', pctTillableMin: '90' }
assert.equal(resolveParcelDataScope(gs.stateFilter, REGISTRY), null)
assert.deepEqual(parcelDataFilterParams(gs), { soil_rating_min: '80', pct_tillable_min: '90' })

// $ per soil point was never sent before; now always, any scope.
assert.deepEqual(
  parcelDataFilterParams({ ...empty, stateFilter: 'IA', pricePerSoilRatingMin: '100', pricePerSoilRatingMax: '200' }),
  { price_per_soil_rating_min: '100', price_per_soil_rating_max: '200' },
)
// Tillable acres + no state at all.
assert.deepEqual(
  parcelDataFilterParams({ ...empty, tillableAcresMin: '50', tillableAcresMax: '300', soilRatingMax: '120' }),
  { soil_rating_max: '120', tillable_acres_min: '50', tillable_acres_max: '300' },
)
// Unset values are never sent; '0' is a real value and is.
assert.deepEqual(parcelDataFilterParams(empty), {})
assert.deepEqual(parcelDataFilterParams({ ...empty, pctTillableMin: '0' }), { pct_tillable_min: '0' })
assert.equal(anyParcelDataFilterSet(empty), false)
assert.equal(anyParcelDataFilterSet(gs), true)

// Scope rule unchanged: one registry state only.
assert.equal(resolveParcelDataScope('il', REGISTRY), 'IL')
assert.equal(resolveParcelDataScope('IA', REGISTRY), null)
assert.equal(resolveParcelDataScope('IL', null), null)

// Panel: a set value always has a visible, clearable control.
let c = parcelDataControls(gs, gs, null)
assert.equal(c.soil?.label, 'Soil Rating (NCCPI)') // 2 states → backend filters NCCPI
assert.deepEqual(c.tillable.map(t => t.label), ['% Tillable'])
c = parcelDataControls(empty, empty, null)
assert.equal(c.soil, null)
assert.deepEqual(c.tillable, [])
// Registry state keeps the old default controls, native-scale label.
c = parcelDataControls({ ...empty, stateFilter: 'IL' }, empty, 'IL')
assert.equal(c.soil?.label, 'Soil Rating')
assert.deepEqual(c.tillable.map(t => t.label), ['% Tillable'])
// Chat-only pairs appear only when set; applied-but-cleared-in-draft stays visible until Apply.
const pps = { ...empty, stateFilter: 'IA', pricePerSoilRatingMax: '150', tillableAcresMin: '40' }
c = parcelDataControls({ ...empty, stateFilter: 'IA' }, pps, null)
assert.deepEqual(c.tillable.map(t => t.label), ['Tillable Acres', '$ / Soil Rating'])
// Flags still widen the defaults.
c = parcelDataControls({ ...empty, stateFilter: 'IA' }, empty, null, { soil: true, tillable: true })
assert.equal(c.soil?.label, 'Soil Rating')
assert.deepEqual(c.tillable.map(t => t.label), ['% Tillable', 'Tillable Acres'])

// Filter badge counts them now that they filter.
assert.equal(countActiveFilters({ ...gs, countyFilters: ['Adams', 'Lee'] }, 'default6y'), 4) // state, county, soil, tillable
assert.equal(countActiveFilters({ ...empty, pricePerSoilRatingMin: '90' }, 'default6y'), 1)

console.log('mapFilterParams ok')
