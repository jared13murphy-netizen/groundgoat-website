'use client'

// Single-line number that shrinks its font to fit its box (owner 2026-10-27:
// "make sure the text resizes appropriately so it doesn't go beyond the card
// AND do not let a number go onto 2 rows"). Starts at `max` px and steps
// down to `min` px until the text no longer overflows; re-fits on resize.

import { useLayoutEffect, useRef, useState } from 'react'

interface Props {
  children: React.ReactNode
  max?: number
  min?: number
  className?: string
}

export default function FitText({ children, max = 18, min = 10, className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(max)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      let s = max
      el.style.fontSize = `${s}px`
      while (s > min && el.scrollWidth > el.clientWidth) {
        s -= 1
        el.style.fontSize = `${s}px`
      }
      setSize(s)
    }
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [children, max, min])

  return (
    <div
      ref={ref}
      className={`whitespace-nowrap overflow-hidden leading-tight ${className}`}
      style={{ fontSize: size }}
    >
      {children}
    </div>
  )
}
