'use client'

/**
 * Marketing unsubscribe landing page.
 *
 * Arrived at from the one-click "Unsubscribe" link in the footer of
 * every reminder email. The link carries the user's unsubscribe_token
 * as ?token=...; the backend looks up the user by that token and flips
 * marketing_emails_opted_out=true. No auth required — the token IS
 * the auth (it's a 48-char hex that only the user has, in their email).
 *
 * On load we auto-POST the unsubscribe immediately so the user is
 * actually opted out the moment they click — no extra confirm step.
 * The page just shows the result. This matches RFC 8058 one-click
 * unsubscribe expectations from Gmail/Apple Mail.
 */

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

type Status = 'loading' | 'success' | 'error' | 'missing-token'

function UnsubscribeInner() {
  const params = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<Status>('loading')
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setStatus('missing-token')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/marketing/unsubscribe?token=${encodeURIComponent(token)}`,
          { method: 'POST' },
        )
        if (cancelled) return
        if (!res.ok) {
          setStatus('error')
          return
        }
        const data = await res.json()
        setEmail(data?.email ?? null)
        setStatus('success')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [token])

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white text-gray-900 rounded-2xl shadow-xl p-8 text-center">
        <Image
          src="/logo-transparent.png"
          alt="Ground Goat"
          width={140}
          height={88}
          className="mx-auto mb-6"
          priority
        />

        {status === 'loading' && (
          <>
            <Loader2 className="mx-auto mb-4 text-gg-pink animate-spin" size={36} />
            <p className="text-gray-600">Unsubscribing…</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 className="mx-auto mb-4 text-green-500" size={40} />
            <h1 className="text-xl font-bold mb-2 text-gray-900">You're unsubscribed</h1>
            <p className="text-gray-600 mb-6">
              {email ? (
                <>We won't send any more marketing emails to <strong>{email}</strong>.</>
              ) : (
                <>We won't send any more marketing emails.</>
              )}
              <br />
              You'll still receive transactional emails (verification, password
              reset, receipts) when relevant to your account.
            </p>
            <Link
              href="/"
              className="inline-block bg-gg-pink hover:bg-gg-pink/80 text-white font-semibold py-3 px-6 rounded-lg transition"
            >
              Back to Ground Goat
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle className="mx-auto mb-4 text-red-500" size={40} />
            <h1 className="text-xl font-bold mb-2 text-gray-900">Something went wrong</h1>
            <p className="text-gray-600 mb-6">
              We couldn't process your unsubscribe right now. Please try again,
              or contact <a href="mailto:support@groundgoat.com" className="text-gg-pink hover:underline">support@groundgoat.com</a> and we'll opt you out manually.
            </p>
          </>
        )}

        {status === 'missing-token' && (
          <>
            <XCircle className="mx-auto mb-4 text-orange-500" size={40} />
            <h1 className="text-xl font-bold mb-2 text-gray-900">Invalid link</h1>
            <p className="text-gray-600 mb-6">
              The unsubscribe link is missing its token. If you copied the URL
              from your email, please use the original link instead — or email
              <a href="mailto:support@groundgoat.com" className="text-gg-pink hover:underline ml-1">support@groundgoat.com</a>
              and we'll opt you out manually.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gg-gray-950" />}>
      <UnsubscribeInner />
    </Suspense>
  )
}
