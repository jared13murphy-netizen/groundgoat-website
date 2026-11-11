'use client'

// "Add a neighboring state" upsell (owner 11/11). Slides up after someone picks
// their first state while signing up: every bordering state as a card with its
// outline; one click adds it (again removes it). It stays up until they close
// it or click "No More States". It only edits the selection, so it is still one
// checkout.

import { Check, X } from 'lucide-react'
import { neighborsOf } from '@/data/stateNeighbors'
import { getStateAbbreviation, getStateFullName } from '@/data/counties'

interface Props {
  open: boolean
  homeState: string // full name, as the sign-up form stores states
  selected: string[] // full names
  maxStates: number
  addPriceLabel: string // e.g. "$2.50/month"
  onToggle: (state: string) => void
  onClose: () => void
}

export default function NeighborStatesUpsell({ open, homeState, selected, maxStates, addPriceLabel, onToggle, onClose }: Props) {
  const neighbors = neighborsOf(getStateAbbreviation(homeState))
  if (!open || neighbors.length === 0) return null
  const atLimit = selected.length >= maxStates
  const added = neighbors.filter(ab => selected.includes(getStateFullName(ab))).length

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full sm:max-w-xl bg-gg-gray-900 border border-gg-gray-700 rounded-t-3xl sm:rounded-3xl p-6 sm:p-8 max-h-[90vh] overflow-y-auto animate-slide-up">
        <div className="flex items-start gap-4 mb-6">
          <div className="flex-1">
            <p className="text-gg-pink text-xs font-bold tracking-[0.2em] uppercase mb-2">Nearly half price</p>
            <h3 className="font-display text-2xl sm:text-3xl font-bold text-white">Add the states next to {homeState}</h3>
            <p className="text-gg-gray-400 mt-2">
              Each extra state is only <span className="text-gg-pink font-semibold">{addPriceLabel}</span> — every county, every auction, every sale.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gg-gray-400 hover:text-white" aria-label="Close">
            <X size={24} />
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {neighbors.map(ab => {
            const name = getStateFullName(ab)
            const on = selected.includes(name)
            const disabled = !on && atLimit
            return (
              <button
                key={ab}
                type="button"
                onClick={() => onToggle(name)}
                disabled={disabled}
                className={`rounded-2xl border-2 px-3 py-5 flex flex-col items-center transition-colors ${
                  on ? 'border-gg-pink bg-gg-pink/10' : 'border-gg-gray-700 bg-black hover:border-gg-gray-500'
                } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                <span
                  aria-hidden
                  className="block w-24 h-16 mb-3"
                  style={{
                    backgroundColor: on ? '#f58cde' : '#3a3a3a',
                    WebkitMaskImage: `url(/state-shapes/${ab}.png)`,
                    maskImage: `url(/state-shapes/${ab}.png)`,
                    WebkitMaskSize: 'contain',
                    maskSize: 'contain',
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    maskPosition: 'center',
                  }}
                />
                <span className="text-white font-semibold">{name}</span>
                {on ? (
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-gg-pink px-2.5 py-0.5 text-xs font-bold text-black">
                    <Check size={12} /> Added
                  </span>
                ) : (
                  <span className="mt-1.5 text-xs font-bold text-gg-pink">+{addPriceLabel}</span>
                )}
              </button>
            )
          })}
        </div>

        {atLimit && <p className="text-center text-gg-gray-400 text-sm mt-4">{maxStates} states is the most a plan can include.</p>}
        {added > 0 && (
          <button type="button" onClick={onClose} className="btn-primary w-full mt-6">
            Continue with {selected.length} states
          </button>
        )}
        <button type="button" onClick={onClose} className="w-full text-center text-gg-gray-400 hover:text-white underline mt-4 py-2">
          No More States
        </button>
      </div>
    </div>
  )
}
