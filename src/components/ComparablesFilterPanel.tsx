'use client'

import { useState } from 'react'
import { X, SlidersHorizontal } from 'lucide-react'
import { SOIL_FILTER_ENABLED } from '@/lib/featureFlags'

export interface FilterState {
  dateRange: 'all' | 'upcoming' | '1month' | '6months' | '1year' | '18months' | '2years'
  statuses: string[]
  countyScope: 'same' | 'neighbors' | 'state'
  distance: 'any' | '10' | '25' | '50' | '100'
  soilRatingMin: string
  soilRatingMax: string
  acreageMin: string
  acreageMax: string
  tillableMin: string
  tillableMax: string
}

export const DEFAULT_FILTERS: FilterState = {
  dateRange: 'all',
  statuses: [],
  countyScope: 'neighbors',
  distance: 'any',
  soilRatingMin: '',
  soilRatingMax: '',
  acreageMin: '',
  acreageMax: '',
  tillableMin: '',
  tillableMax: '',
}

export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959 // miles
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function countActiveFilters(filters: FilterState): number {
  let count = 0
  if (filters.dateRange !== 'all') count++
  if (filters.statuses?.length > 0) count++
  if (filters.countyScope !== 'neighbors') count++
  if (filters.distance !== 'any') count++
  if (SOIL_FILTER_ENABLED && (filters.soilRatingMin || filters.soilRatingMax)) count++
  if (filters.acreageMin || filters.acreageMax) count++
  if (filters.tillableMin || filters.tillableMax) count++
  return count
}

export function applyFilters(
  items: any[],
  filters: FilterState,
  subjectLat?: number | null,
  subjectLng?: number | null,
  subjectCounty?: string,
  subjectState?: string,
): any[] {
  return items.filter(item => {
    // Status filter
    if (filters.statuses?.length > 0) {
      const status = (item.sale_status || '').toLowerCase()
      const allStatuses = filters.statuses.flatMap((s: string) => s.split(','))
      if (!allStatuses.includes(status)) return false
    }

    // Date range
    if (filters.dateRange === 'upcoming') {
      const saleDate = item.auction_date || item.auction_datetime
      if (saleDate) {
        const d = new Date(saleDate)
        if (d <= new Date()) return false
      }
    } else if (filters.dateRange !== 'all') {
      const saleDate = item.auction_date || item.auction_datetime
      if (saleDate) {
        const d = new Date(saleDate)
        const now = new Date()
        const months = filters.dateRange === '1month' ? 1
          : filters.dateRange === '6months' ? 6
          : filters.dateRange === '1year' ? 12
          : filters.dateRange === '18months' ? 18
          : 24
        const cutoff = new Date(now.getFullYear(), now.getMonth() - months, now.getDate())
        if (d < cutoff) return false
      }
    }

    // County scope
    if (filters.countyScope === 'same' && subjectCounty) {
      const itemCounty = item.county || item.county_name || ''
      if (itemCounty.toLowerCase() !== subjectCounty.toLowerCase()) return false
    }

    // State scope: filter out tracts from other states
    if (filters.countyScope === 'state' && subjectState) {
      const itemState = (item.state || '').toLowerCase()
      if (itemState !== subjectState.toLowerCase()) return false
    }

    // Distance
    if (filters.distance !== 'any' && subjectLat && subjectLng) {
      const lat = parseFloat(item.latitude || item.lat || 0)
      const lng = parseFloat(item.longitude || item.lng || 0)
      if (lat && lng) {
        const dist = haversineDistance(subjectLat, subjectLng, lat, lng)
        if (dist > parseInt(filters.distance)) return false
      }
    }

    // Soil rating range
    const sr = parseFloat(item.soil_rating || 0)
    if (SOIL_FILTER_ENABLED && filters.soilRatingMin && sr && sr < parseFloat(filters.soilRatingMin)) return false
    if (SOIL_FILTER_ENABLED && filters.soilRatingMax && sr && sr > parseFloat(filters.soilRatingMax)) return false

    // Acreage range
    const acres = parseFloat(item.total_acres || item.acres || 0)
    if (filters.acreageMin && acres && acres < parseFloat(filters.acreageMin)) return false
    if (filters.acreageMax && acres && acres > parseFloat(filters.acreageMax)) return false

    // % Tillable range
    const tillable = parseFloat(item.tillable_acres || 0)
    const pctTillable = acres && tillable ? (tillable / acres) * 100 : 0
    if (filters.tillableMin && pctTillable && pctTillable < parseFloat(filters.tillableMin)) return false
    if (filters.tillableMax && pctTillable && pctTillable > parseFloat(filters.tillableMax)) return false

    return true
  })
}

interface FilterPanelProps {
  filters: FilterState
  onApply: (filters: FilterState) => void
  onClose: () => void
}

function ChipGroup({ label, options, value, onChange }: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="mb-4">
      <label className="text-sm text-gray-400 mb-2 block">{label}</label>
      <div className="flex flex-wrap gap-2">
        {options.map(opt => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              value === opt.value
                ? 'bg-gg-pink text-white'
                : 'bg-gg-gray-800 text-gray-300 hover:bg-gg-gray-700'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function RangeInput({ label, minValue, maxValue, onMinChange, onMaxChange, placeholder }: {
  label: string
  minValue: string
  maxValue: string
  onMinChange: (v: string) => void
  onMaxChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="mb-4">
      <label className="text-sm text-gray-400 mb-2 block">{label}</label>
      <div className="flex gap-2 items-center">
        <input
          type="number"
          value={minValue}
          onChange={e => onMinChange(e.target.value)}
          placeholder={placeholder || 'Min'}
          className="w-24 px-3 py-1.5 bg-gg-gray-800 border border-gg-gray-700 rounded text-white text-sm focus:outline-none focus:border-gg-pink"
        />
        <span className="text-gray-500">—</span>
        <input
          type="number"
          value={maxValue}
          onChange={e => onMaxChange(e.target.value)}
          placeholder={placeholder || 'Max'}
          className="w-24 px-3 py-1.5 bg-gg-gray-800 border border-gg-gray-700 rounded text-white text-sm focus:outline-none focus:border-gg-pink"
        />
      </div>
    </div>
  )
}

export default function ComparablesFilterPanel({ filters, onApply, onClose }: FilterPanelProps) {
  const [local, setLocal] = useState<FilterState>({ ...filters })

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-sm h-full bg-gg-gray-900 border-l border-gg-gray-700 overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gg-gray-700">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <SlidersHorizontal size={18} />
            Filters
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          {/* Status */}
          <div className="mb-5">
            <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Status</div>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Listed', value: 'active' },
                { label: 'Live', value: 'live,pending' },
                { label: 'Sold', value: 'sold' },
              ].map(opt => {
                const isActive = (local.statuses || []).includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    onClick={() => {
                      const current = local.statuses || []
                      const next = isActive ? current.filter(s => s !== opt.value) : [...current, opt.value]
                      setLocal({ ...local, statuses: next })
                    }}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                      isActive
                        ? 'border-pink-500 bg-pink-500/20 text-pink-400'
                        : 'border-gray-600 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <ChipGroup
            label="Date Range"
            options={[
              { value: 'upcoming', label: 'Upcoming' },
              { value: '1month', label: 'Last mo' },
              { value: '6months', label: 'Last 6 mo' },
              { value: '1year', label: 'Last 1 yr' },
              { value: '18months', label: 'Last 18 mo' },
              { value: '2years', label: 'Last 2 yr' },
              { value: 'all', label: 'All time' },
            ]}
            value={local.dateRange}
            onChange={v => setLocal({ ...local, dateRange: v as FilterState['dateRange'] })}
          />

          <ChipGroup
            label="County / State"
            options={[
              { value: 'same', label: 'Same county' },
              { value: 'neighbors', label: 'County + neighbors' },
              { value: 'state', label: 'Entire state' },
            ]}
            value={local.countyScope}
            onChange={v => setLocal({ ...local, countyScope: v as FilterState['countyScope'] })}
          />

          <ChipGroup
            label="Distance from Subject"
            options={[
              { value: '10', label: '10 mi' },
              { value: '25', label: '25 mi' },
              { value: '50', label: '50 mi' },
              { value: '100', label: '100 mi' },
              { value: 'any', label: 'Any' },
            ]}
            value={local.distance}
            onChange={v => setLocal({ ...local, distance: v as FilterState['distance'] })}
          />

          {SOIL_FILTER_ENABLED && (
            <RangeInput
              label="Soil Rating"
              minValue={local.soilRatingMin}
              maxValue={local.soilRatingMax}
              onMinChange={v => setLocal({ ...local, soilRatingMin: v })}
              onMaxChange={v => setLocal({ ...local, soilRatingMax: v })}
            />
          )}

          <RangeInput
            label="Acreage"
            minValue={local.acreageMin}
            maxValue={local.acreageMax}
            onMinChange={v => setLocal({ ...local, acreageMin: v })}
            onMaxChange={v => setLocal({ ...local, acreageMax: v })}
          />

          <RangeInput
            label="% Tillable"
            minValue={local.tillableMin}
            maxValue={local.tillableMax}
            onMinChange={v => setLocal({ ...local, tillableMin: v })}
            onMaxChange={v => setLocal({ ...local, tillableMax: v })}
          />

        </div>

        <div className="sticky bottom-0 p-4 bg-gg-gray-900 border-t border-gg-gray-700 flex gap-3">
          <button
            onClick={() => {
              setLocal({ ...DEFAULT_FILTERS })
              onApply({ ...DEFAULT_FILTERS })
              onClose()
            }}
            className="flex-1 py-2 px-4 rounded-lg border border-gg-gray-600 text-gray-300 hover:bg-gg-gray-800 text-sm"
          >
            Reset Filters
          </button>
          <button
            onClick={() => {
              onApply(local)
              onClose()
            }}
            className="flex-1 py-2 px-4 rounded-lg bg-gg-pink text-white font-medium text-sm hover:bg-gg-pink/90"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
