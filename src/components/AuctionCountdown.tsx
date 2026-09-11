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

/** One character slot. Old glyph slides out to -1.1em while the new one
 *  enters from +1.1em, opposite directions so it reads as a roll. Only
 *  fires when this slot's own character actually changes. */
function OdometerDigit({ char, reduceMotion }: { char: string; reduceMotion: boolean }) {
  const [displayChar, setDisplayChar] = useState(char)
  const [incoming, setIncoming] = useState<string | null>(null)
  const [animate, setAnimate] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (char === displayChar) return
    if (reduceMotion) { setDisplayChar(char); return }
    setIncoming(char)
    setAnimate(false)
    const raf = requestAnimationFrame(() => setAnimate(true))
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => {
      setDisplayChar(char)
      setIncoming(null)
      setAnimate(false)
    }, 220)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char, reduceMotion])

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current) }, [])

  return (
    <span className="gg-countdown-digit">
      <span className={`gg-countdown-glyph${animate && incoming ? ' gg-countdown-glyph--leaving' : ''}`}>
        {displayChar}
      </span>
      {incoming !== null && (
        <span className={`gg-countdown-glyph${animate ? '' : ' gg-countdown-glyph--entering-from'}`}>
          {incoming}
        </span>
      )}
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
  variant: 'modal' | 'row'
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

  const urgent = state.phase === 'urgent'
  const timer = <CountdownValue parts={partsRef.current} reduceMotion={reduceMotion} />
  const stateClasses = `gg-countdown${fading ? ' gg-countdown--fading' : ''}${urgent ? ' gg-countdown--urgent' : ''}`

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
