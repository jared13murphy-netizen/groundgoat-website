import type React from 'react'
'use client'

/**
 * AuctionCountdown — countdown timer UI (item 12, 2026-09-11). Pure
 * presentation over useAuctionCountdown/getCountdownState (src/lib &
 * src/hooks). Client-only: the home page is pre-rendered under UTC in CI,
 * so this never computes anything until after mount.
 *
 *   'hidden'          → renders null
 *   'counting'/'urgent' → shows "Dd HH:MM:SS" (no days once < 24h)
 *   'started'          → fades to opacity 0 over 400ms, then null
 *
 * variant 'modal' renders a `.sale-modal-row` (ComparablesMap.css) to match
 * the sale detail modal. variant 'row' renders a plain label/value row
 * (text-sm, tabular-nums) for the portal panels (PortalListingDetail /
 * PortalTractDetail), which don't use sale-modal-* classes — pass
 * `className` to place/size it like the panel's neighbouring rows.
 */

import { useEffect, useRef, useState } from 'react'
import { useAuctionCountdown } from '@/hooks/useAuctionCountdown'
import { formatCountdownParts, type CountdownPart } from '@/lib/auctionCountdown'
import './AuctionCountdown.css'

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** One character slot. Pure CSS keyframes keyed on the character: when the
 *  char changes, the new glyph mounts (new key) and plays the enter animation
 *  while the previous glyph plays the leave animation and unmounts on
 *  animationend. No timeouts, no rAF — a tick arriving mid-roll simply
 *  re-keys the glyphs, so nothing can lag or skip (owner 9/11: "skips
 *  seconds"). Only fires when this slot's own character actually changes. */
function OdometerDigit({ char, reduceMotion }: { char: string; reduceMotion: boolean }) {
  const prevRef = useRef(char)
  const seqRef = useRef(0)
  const [leaving, setLeaving] = useState<{ ch: string; id: number } | null>(null)

  useEffect(() => {
    if (prevRef.current === char) return
    const from = prevRef.current
    prevRef.current = char
    if (!reduceMotion) setLeaving({ ch: from, id: ++seqRef.current })
  }, [char, reduceMotion])

  return (
    <span className="gg-countdown-digit">
      {leaving && (
        <span
          key={`l${leaving.id}`}
          className="gg-countdown-glyph gg-countdown-glyph--leave"
          onAnimationEnd={() => setLeaving((l) => (l && l.id === leaving.id ? null : l))}
        >
          {leaving.ch}
        </span>
      )}
      <span key={`c${char}`} className={`gg-countdown-glyph${leaving ? ' gg-countdown-glyph--enter' : ''}`}>
        {char}
      </span>
    </span>
  )
}

function CountdownValue({ parts, reduceMotion }: { parts: CountdownPart[]; reduceMotion: boolean }) {
  return (
    <span className="gg-countdown-value">
      {parts.map((p) => (
        <span key={p.key} className="gg-countdown-part">
          {p.text.split('').map((ch, i) => (
            <OdometerDigit key={`${p.key}-${i}`} char={ch} reduceMotion={reduceMotion} />
          ))}
          {p.suffix && <span className="gg-countdown-suffix">{p.suffix}</span>}
        </span>
      ))}
    </span>
  )
}

export interface AuctionCountdownProps {
  value: string | Date | null | undefined
  variant: 'modal' | 'row' | 'card'
  className?: string
  labelClassName?: string
  valueClassName?: string
  /** label above the value (PortalListingDetail's icon + stacked rows) */
  stacked?: boolean
  icon?: React.ReactNode
}

export default function AuctionCountdown({ value, variant, className, labelClassName, valueClassName, stacked, icon }: AuctionCountdownProps) {
  const { state, ref } = useAuctionCountdown(value, true)
  const reduceMotion = useReducedMotion()
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // Freeze the last non-'started' parts so the fade-out has something to
  // show while it animates — getCountdownState zeroes everything once the
  // auction has started.
  const partsRef = useRef<CountdownPart[]>(formatCountdownParts(state))
  if (state.phase !== 'started') partsRef.current = formatCountdownParts(state)
  // Only an auction we were actually counting down gets the fade-out. One
  // that was already over when the card mounted (sold / past listings on
  // the same list) must never flash "00 s" (reviewer catch 9/11).
  const wasCountingRef = useRef(false)
  if (state.phase === 'counting' || state.phase === 'urgent') wasCountingRef.current = true

  const [fading, setFading] = useState(false)
  const [gone, setGone] = useState(false)
  useEffect(() => {
    if (state.phase === 'started') {
      if (!fading && !gone) {
        setFading(true)
        const t = setTimeout(() => setGone(true), reduceMotion ? 0 : 400)
        return () => clearTimeout(t)
      }
    } else if (fading || gone) {
      setFading(false)
      setGone(false)
    }
    return undefined
  }, [state.phase, fading, gone, reduceMotion])

  if (!mounted || state.phase === 'hidden' || gone) return null
  if (state.phase === 'started' && !wasCountingRef.current) return null

  const urgent = state.phase === 'urgent'
  const timer = <CountdownValue parts={partsRef.current} reduceMotion={reduceMotion} />
  const stateClasses = `gg-countdown${fading ? ' gg-countdown--fading' : ''}${urgent ? ' gg-countdown--urgent' : ''}`

  if (variant === 'card') {
    // Auction list card: bottom-left of the image, no pill, bold white digits,
    // gray unit letters, text shadow — mirrors the app's Auctions cards.
    return (
      <div ref={ref} className={`${stateClasses} gg-countdown-card${className ? ' ' + className : ''}`}>
        {timer}
      </div>
    )
  }

  if (variant === 'modal') {
    return (
      <div
        ref={ref}
        className={`sale-modal-row ${stateClasses}${className ? ' ' + className : ''}`}
      >
        <span className="sale-modal-label">Starts in</span>
        <span className="sale-modal-value gg-countdown-modal-value">{timer}</span>
      </div>
    )
  }

  // variant 'row' — plain label/value pair (text-sm, tabular-nums) for the
  // portal panels; `className` places/sizes it to match the caller's
  // neighbouring rows (they don't share one layout, see PortalListingDetail
  // vs PortalTractDetail's own DetailRow).
  const labelCls = labelClassName ?? 'text-[10px] text-gg-gray-500'
  const valueCls = `${valueClassName ?? 'text-sm'} tabular-nums`
  return (
    <div className={`${stateClasses}${className ? ' ' + className : ''}`}>
      {icon}
      {stacked ? (
        <div>
          <div className={labelCls}>Starts in</div>
          <div ref={ref} className={valueCls}>{timer}</div>
        </div>
      ) : (
        <>
          <span className={labelCls}>Starts in</span>
          <span ref={ref} className={valueCls}>{timer}</span>
        </>
      )}
    </div>
  )
}
