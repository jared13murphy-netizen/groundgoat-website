// Sandbox environment banner (owner 2026-09-01). Renders ONLY when this
// build is the sandbox site — gated by NEXT_PUBLIC_IS_SANDBOX, set as a
// build arg on the sandbox-web image and unset on production, so it can
// never appear on the live site. Fixed to the top; the app's own top
// chrome is offset by the body padding added in globals.css under the
// same flag.

const IS_SANDBOX = process.env.NEXT_PUBLIC_IS_SANDBOX === 'true'
const LIVE_URL = process.env.NEXT_PUBLIC_LIVE_URL || 'https://www.groundgoat.com'

export default function SandboxBanner() {
  if (!IS_SANDBOX) return null
  return (
    <div
      role="status"
      className="fixed top-0 left-0 right-0 z-[10000] flex items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-center text-sm font-semibold text-black"
    >
      <span>🧪 You're in the Ground Goat Sandbox — test data only.</span>
      <a
        href={LIVE_URL}
        className="underline underline-offset-2 hover:no-underline"
      >
        Switch to the live site →
      </a>
    </div>
  )
}
