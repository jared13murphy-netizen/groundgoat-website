'use client'

/**
 * Width (px) of whatever panel is docked on the right edge of the map right
 * now — 0 when none is open (owner 11/17).
 *
 * The Goat Search result bar ("Show me Parcel… · Add All to Report") is
 * centred on the screen and layered above the parcel panel, so it landed
 * right on the panel's Reports / Add Comp buttons and swallowed the click.
 * A Fortress Bank user could not start a comp report. Bars that float over
 * the map centre themselves on the visible map with this instead.
 *
 * Right-docked panels mark themselves with `data-gg-right-panel`.
 */
import { useEffect, useState } from 'react'

export function rightPanelInset(): number {
  if (typeof document === 'undefined') return 0
  let inset = 0
  document.querySelectorAll<HTMLElement>('[data-gg-right-panel]').forEach(el => {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) inset = Math.max(inset, window.innerWidth - r.left)
  })
  // A panel covering most of the screen (phones) leaves no map to centre on.
  if (inset > window.innerWidth * 0.75) return 0
  return Math.max(0, Math.round(inset))
}

export function useRightPanelInset(): number {
  const [inset, setInset] = useState(0)
  useEffect(() => {
    const update = () => setInset(rightPanelInset())
    update()
    const mo = new MutationObserver(update)
    mo.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', update)
    // The panel slides in; re-measure once it has settled.
    const t = window.setInterval(update, 500)
    return () => { mo.disconnect(); window.removeEventListener('resize', update); window.clearInterval(t) }
  }, [])
  return inset
}
