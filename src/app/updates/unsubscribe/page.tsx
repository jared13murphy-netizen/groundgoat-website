'use client'

/**
 * Ground Goat Updates unsubscribe landing page.
 *
 * Arrived at from the unsubscribe link in Ground Goat Updates emails.
 * The link carries the subscriber's unsubscribe_token as ?token=...;
 * the backend looks up the subscriber by that token and sets status=unsubscribed.
 * No auth required — the token IS the auth.
 *
 * On load we auto-POST the unsubscribe immediately so the user is
 * actually opted out the moment they click — no extra confirm step.
 */

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

type Status = 'loading' | 'success' | 'error' | 'missing-token'

function UpdatesUnsubscribeInner() {
  const params = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<Status>('loading')

  useEffect(() => {
    if (!token) {
      setStatus('missing-token')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/api/updates/unsubscribe`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        if (cancelled) return
        if (!res.ok) {
          setStatus('error')
          return
        }
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
            <h1 className="text-xl font-bold mb-2 text-gray-900">You've been unsubscribed from Ground Goat Updates</h1>
            <p className="text-gray-600 mb-6">
              We won't send you any more Ground Goat Updates emails.
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
              or contact{' '}
              <a href="mailto:support@groundgoat.com" className="text-gg-pink hover:underline">support@groundgoat.com</a>
              {' '}and we'll opt you out manually.
            </p>
          </>
        )}

        {status === 'missing-token' && (
          <>
            <XCircle className="mx-auto mb-4 text-orange-500" size={40} />
            <h1 className="text-xl font-bold mb-2 text-gray-900">Invalid link</h1>
            <p className="text-gray-600 mb-6">
              The unsubscribe link is missing its token. If you copied the URL
              from your email, please use the original link instead — or email{' '}
              <a href="mailto:support@groundgoat.com" className="text-gg-pink hover:underline">support@groundgoat.com</a>
              {' '}and we'll opt you out manually.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

export default function UpdatesUnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gg-gray-950" />}>
      <UpdatesUnsubscribeInner />
    </Suspense>
  )
}
