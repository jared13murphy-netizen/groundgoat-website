'use client'

import { useEffect, useState } from 'react'

/**
 * Enter/exit animation helper for panels and menus that are conditionally
 * rendered. `mounted` stays true for `ms` after `open` goes false so the
 * exit transition can play; `shown` flips true one frame after mount so
 * the enter transition plays from the hidden state (owner 10/30: panels
 * must slide, not appear).
 */
export default function useSlide(open: boolean, ms = 220) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  useEffect(() => {
    if (open) {
      setMounted(true)
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), ms)
    return () => clearTimeout(t)
  }, [open, ms])
  return { mounted, shown }
}
