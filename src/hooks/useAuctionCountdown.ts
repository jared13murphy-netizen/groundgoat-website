'use client';
// ONE ticker for every mounted countdown; client-side only (the home page is
// pre-rendered under UTC in CI, so nothing here may run at build time).
// Ticks only while the tab is visible and the element is on screen.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCountdownState, parseAuctionInstant, type CountdownState } from '../lib/auctionCountdown';

const subscribers = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

// Poll 4x per second and notify only when the wall-clock second changes.
// A single 1 s timeout aligned to the second was fragile on the Explore page:
// map tile work can delay a timeout by hundreds of ms, so two ticks landed
// ~1.9 s apart and the display visibly skipped a second (owner 9/11).
let lastSecond = -1;
function tick() {
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  if (sec === lastSecond) return;
  lastSecond = sec;
  subscribers.forEach((fn) => fn(now));
}
function visible() { return typeof document === 'undefined' || document.visibilityState !== 'hidden'; }
function schedule() {
  if (timer || subscribers.size === 0 || !visible()) return;
  timer = setInterval(tick, 250);
}
function stop() { if (timer) { clearInterval(timer); timer = null; } }
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (visible()) { lastSecond = -1; tick(); schedule(); } else { stop(); } });
}
export function subscribeTicker(fn: (now: number) => void) {
  subscribers.add(fn); schedule();
  return () => { subscribers.delete(fn); if (subscribers.size === 0) stop(); };
}

/** Returns the countdown state plus a ref to attach to the timer's root so
 *  it stops ticking while scrolled out of view. */
export function useAuctionCountdown(value: string | Date | null | undefined, active = true) {
  const instant = useMemo(() => parseAuctionInstant(value), [value]);
  // Callback ref (not useRef): the component renders null until mounted, so
  // the element only exists on a LATER render — a useRef+effect pair never
  // re-ran and the observer never attached (reviewer catch 2026-09-11).
  const [el, setEl] = useState<HTMLElement | null>(null);
  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);
  const [onScreen, setOnScreen] = useState(true);
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => { io.disconnect(); setOnScreen(true); };
  }, [el]);

  const live = !!instant && active && onScreen;
  useEffect(() => {
    if (!live) return undefined;
    setNow(Date.now());
    return subscribeTicker(setNow);
  }, [live]);

  const state: CountdownState = useMemo(() => getCountdownState(instant, now), [instant, now]);
  return { state, ref };
}
