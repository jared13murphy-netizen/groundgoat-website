// Sandbox environment badge (owner 2026-09-01; reshaped 2026-09-08 — the
// full-width bar "was in the way", so it is now a small pill pinned to the
// top-left corner). Renders ONLY when this build is the sandbox site —
// gated by NEXT_PUBLIC_IS_SANDBOX, set as a build arg on the sandbox-web
// image and unset on production, so it can never appear on the live site.
// No layout offset: nothing is pushed down any more.

const IS_SANDBOX = process.env.NEXT_PUBLIC_IS_SANDBOX === 'true'
const LIVE_URL = process.env.NEXT_PUBLIC_LIVE_URL || 'https://www.groundgoat.com'

export default function SandboxBanner() {
  if (!IS_SANDBOX) return null
  return (
    <a
      href={LIVE_URL}
      role="status"
      title="You're in the Ground Goat Sandbox — test data only. Click to switch to the live site."
      aria-label="Sandbox — test data only. Switch to the live site"
      className="fixed left-3 top-3 z-[10000] inline-flex items-center gap-1.5 rounded-full bg-amber-500/95 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-black shadow-md hover:bg-amber-400"
    >
      <span aria-hidden="true">🧪</span>
      <span>Sandbox</span>
    </a>
  )
}
