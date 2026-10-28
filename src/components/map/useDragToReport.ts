'use client'

// Drag-to-report (owner 2026-10-27): press and hold a parcel or tract on the
// map for half a second, it lifts into a chip under the pointer, drag it
// onto the report panel and release to add it. The + Report button stays.
//
//   - hold 500 ms without moving more than 6 px → "captured" (short vibration
//     on phones); the map stops panning for the rest of the gesture
//   - the chip follows the pointer; any element with [data-report-dropzone]
//     under the pointer is the drop target and gets a pink ring
//   - release over the target → onDrop(candidate); anywhere else → cancel
//   - the map never sees the release as a click (captured at document level)
//
// Works for mouse, pen and touch through Pointer Events; the map canvas
// already has touch-action: none, so a captured touch does not scroll the
// page.

import { useEffect, useRef, useState } from 'react'
import type maplibregl from 'maplibre-gl'

export interface DragCandidate {
  /** text shown in the chip, e.g. "McDonough, IL · 61.3 ac" */
  label: string
  /** stable id, so a drop on an item already in the report is a no-op */
  id: string | null
  /** resolves the report row (a parcel needs a fetch; a tract is immediate) */
  resolve: () => Promise<unknown>
}

export interface DragChip { x: number; y: number; label: string; over: boolean; busy?: boolean }

interface Options {
  map: maplibregl.Map | null
  container: HTMLElement | null
  enabled: boolean
  /** what is under this map point, or null when nothing draggable is there */
  candidateAt: (point: { x: number; y: number }) => DragCandidate | null
  onStart?: () => void
  onDrop: (candidate: DragCandidate) => void | Promise<void>
}

const HOLD_MS = 500
const SLOP_PX = 6
const ZONE = '[data-report-dropzone]'

export default function useDragToReport({ map, container, enabled, candidateAt, onStart, onDrop }: Options): DragChip | null {
  const [chip, setChip] = useState<DragChip | null>(null)
  const latest = useRef({ candidateAt, onStart, onDrop })
  latest.current = { candidateAt, onStart, onDrop }

  useEffect(() => {
    if (!map || !container || !enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let start: { x: number; y: number; pointerId: number } | null = null
    let dragging: DragCandidate | null = null
    let zoneEl: HTMLElement | null = null

    const zoneUnder = (x: number, y: number): HTMLElement | null => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null
      return (el?.closest(ZONE) as HTMLElement | null) || null
    }
    const setZone = (el: HTMLElement | null) => {
      if (zoneEl === el) return
      zoneEl?.classList.remove('ring-2', 'ring-gg-pink', 'ring-inset')
      zoneEl = el
      zoneEl?.classList.add('ring-2', 'ring-gg-pink', 'ring-inset')
    }
    const cleanup = () => {
      if (timer) { clearTimeout(timer); timer = null }
      start = null
      if (dragging) {
        dragging = null
        try { map.dragPan.enable() } catch {}
        setZone(null)
        setChip(null)
        container.style.cursor = ''
      }
    }

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return
      const rect = container.getBoundingClientRect()
      const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      start = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
      timer = setTimeout(() => {
        timer = null
        if (!start) return
        const cand = latest.current.candidateAt(pt)
        if (!cand) { start = null; return }
        dragging = cand
        try { map.dragPan.disable() } catch {}
        try { (navigator as any).vibrate?.(30) } catch {}
        container.style.cursor = 'grabbing'
        latest.current.onStart?.()
        setChip({ x: start.x, y: start.y, label: cand.label, over: false })
      }, HOLD_MS)
    }
    const onMove = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.pointerId) return
      if (!dragging) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > SLOP_PX) cleanup()  // a pan, not a hold
        return
      }
      e.preventDefault()
      const z = zoneUnder(e.clientX, e.clientY)
      setZone(z)
      setChip(c => (c ? { ...c, x: e.clientX, y: e.clientY, over: !!z } : c))
    }
    const onUp = async (e: PointerEvent) => {
      if (!start || e.pointerId !== start.pointerId) return
      if (!dragging) { cleanup(); return }
      // the map must not treat this release as a click
      e.preventDefault(); e.stopPropagation()
      const cand = dragging
      const z = zoneUnder(e.clientX, e.clientY)
      if (z) {
        setChip(c => (c ? { ...c, busy: true } : c))
        try { await latest.current.onDrop(cand) } catch {}
      }
      cleanup()
    }
    const onCancel = () => cleanup()

    container.addEventListener('pointerdown', onDown)
    document.addEventListener('pointermove', onMove, { capture: true, passive: false })
    document.addEventListener('pointerup', onUp, true)
    document.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('blur', onCancel)
    return () => {
      cleanup()
      container.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('blur', onCancel)
    }
  }, [map, container, enabled])

  return chip
}
