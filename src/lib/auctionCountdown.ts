// Shared countdown maths for the auction timer (item 12, 2026-09-11).
// ONE source of truth for every surface: Home cards, Auctions list, auction
// details, Explore tract sheet. Website mirrors this file exactly
// (mobile src/utils/auctionCountdown.js) — keep the two in step.
//
// Rules (owner spec 2026-09-11):
//   • counts only when the auction starts within the next 7 days
//   • final hour = "urgent" (the UI pulses)
//   • once the auction has started the timer is "started" (UI fades out;
//     the Live badge already covers that state)
//   • the instant comes from listings.auction_datetime — stored WITH a
//     timezone — so we count to the real moment, never a local-midnight guess.
//     A midnight-exact timestamp means "no time set" (same convention as
//     the mobile app's auctionTime.js) and gets no countdown at all.

export const COUNTDOWN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const URGENT_WINDOW_MS = 60 * 60 * 1000;

export function parseAuctionInstant(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return null; // date only
  // Midnight-exact in the viewer's zone = time unknown (same convention as
  // the auctionTime helper). Deliberately NOT checked in UTC: a 7:00 PM
  // Central auction is 00:00 UTC and must still count down.
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) return null;
  return d;
}

// phase: 'hidden' | 'counting' | 'urgent' | 'started'
export type CountdownPhase = "hidden" | "counting" | "urgent" | "started";
export interface CountdownState { phase: CountdownPhase; remainingMs: number; days: number; hours: number; minutes: number; seconds: number }
export interface CountdownPart { key: string; text: string; suffix: string }
export function getCountdownState(instant: string | Date | null | undefined, nowMs: number = Date.now()): CountdownState {
  const target = instant instanceof Date ? instant : parseAuctionInstant(instant);
  if (!target) return { phase: 'hidden', remainingMs: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const remainingMs = target.getTime() - nowMs;
  if (remainingMs > COUNTDOWN_WINDOW_MS) return { phase: 'hidden', remainingMs, days: 0, hours: 0, minutes: 0, seconds: 0 };
  if (remainingMs <= 0) return { phase: 'started', remainingMs, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { phase: remainingMs <= URGENT_WINDOW_MS ? 'urgent' : 'counting', remainingMs, days, hours, minutes, seconds };
}

const two = (n: number) => String(n).padStart(2, '0');

// Digit groups for the odometer, owner format 2026-09-11: "x d, xx h, xx m, xx s".
// Leading zero units are dropped: days when 0; hours when 0 and no days;
// minutes when 0 and no hours. Seconds always show.
export function formatCountdownParts(state: CountdownState): CountdownPart[] {
  const parts: CountdownPart[] = [];
  const showDays = state.days > 0;
  const showHours = showDays || state.hours > 0;
  const showMinutes = showHours || state.minutes > 0;
  if (showDays) parts.push({ key: 'd', text: String(state.days), suffix: ' d, ' });
  if (showHours) parts.push({ key: 'h', text: two(state.hours), suffix: ' h, ' });
  if (showMinutes) parts.push({ key: 'm', text: two(state.minutes), suffix: ' m, ' });
  parts.push({ key: 's', text: two(state.seconds), suffix: ' s' });
  return parts;
}

export function formatCountdownText(state: CountdownState): string {
  return formatCountdownParts(state).map((p) => p.text + p.suffix).join('');
}
