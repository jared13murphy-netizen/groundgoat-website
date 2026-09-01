'use client'

// "Go to Sandbox" — dropdown action for signed-in @groundgoat.com staff
// (owner 2026-09-01). Calls POST /api/sandbox/login, which mirrors the
// account into the sandbox DB and returns a one-time sign-in URL on
// sandbox.groundgoat.com. Only rendered for @groundgoat.com emails, so a
// firm customer never sees it. The production session is untouched — the
// two sites keep separate sessions — so this opens the sandbox without
// signing the user out of live.

import { useState } from 'react'
import { FlaskConical, Loader2 } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.groundgoat.com'

export function isGroundGoatStaff(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith('@groundgoat.com')
}

export default function GoToSandboxButton({ className }: { className?: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/sandbox/login`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.detail || 'Could not open the sandbox. Try again in a moment.')
        return
      }
      const { url } = await res.json()
      // Same tab: the user is switching environments, not opening a
      // reference. The banner in the sandbox carries the link back.
      window.location.href = url
    } catch {
      setError('Could not open the sandbox. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={go}
      disabled={loading}
      className={className || 'flex items-center gap-2 px-4 py-2 text-sm text-sky-400 hover:bg-gg-gray-700 w-full text-left disabled:opacity-60'}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <FlaskConical size={16} />}
      {loading ? 'Opening sandbox…' : 'Go to Sandbox'}
      {error && <span className="ml-2 text-[11px] text-red-400">{error}</span>}
    </button>
  )
}
