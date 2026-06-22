'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

type Status = 'confirming' | 'confirmed' | 'expired' | 'invalid'

function ConfirmInner() {
  const params = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<Status>(token ? 'confirming' : 'invalid')

  // Re-subscribe form state (shown on expired/invalid)
  const [reEmail, setReEmail] = useState('')
  const [reSubmitting, setReSubmitting] = useState(false)
  const [reSuccess, setReSuccess] = useState(false)
  const [reError, setReError] = useState('')

  useEffect(() => {
    if (!token) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/updates/confirm?token=${encodeURIComponent(token)}`,
        )
        if (cancelled) return
        if (res.ok) {
          setStatus('confirmed')
        } else {
          setStatus('expired')
        }
      } catch {
        if (!cancelled) setStatus('expired')
      }
    })()
    return () => { cancelled = true }
  }, [token])

  const handleResubscribe = async (e: React.FormEvent) => {
    e.preventDefault()
    setReError('')
    if (!isValidEmail(reEmail)) {
      setReError('Please enter a valid email address.')
      return
    }
    setReSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/api/updates/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: reEmail.trim() }),
      })
      if (!res.ok) {
        setReError('Something went wrong. Please try again in a moment.')
        return
      }
      setReSuccess(true)
    } catch {
      setReError('Something went wrong. Please try again in a moment.')
    } finally {
      setReSubmitting(false)
    }
  }

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

        {status === 'confirming' && (
          <>
            <Loader2 className="mx-auto mb-4 text-gg-pink animate-spin" size={36} />
            <p className="text-gray-600">Confirming your subscription…</p>
          </>
        )}

        {status === 'confirmed' && (
          <>
            <CheckCircle2 className="mx-auto mb-4 text-green-500" size={40} />
            <h1 className="text-xl font-bold mb-2 text-gray-900">You're subscribed to Ground Goat Updates</h1>
            <p className="text-gray-600 mb-6">
              You'll hear from us when new listings, auction results, and market news are worth knowing.
            </p>
            <Link
              href="/"
              className="inline-block bg-gg-pink hover:bg-gg-pink/80 text-white font-semibold py-3 px-6 rounded-lg transition"
            >
              Browse Listings
            </Link>
          </>
        )}

        {(status === 'expired' || status === 'invalid') && (
          <>
            <XCircle className="mx-auto mb-4 text-orange-500" size={40} />
            <h1 className="text-xl font-bold mb-2 text-gray-900">
              {status === 'invalid' ? 'Invalid link' : 'This link has expired'}
            </h1>
            <p className="text-gray-600 mb-6">
              {status === 'invalid'
                ? 'The confirmation link is missing its token. Please use the original link from your email.'
                : 'Confirmation links expire after 7 days. Enter your email below to get a new one.'}
            </p>
            {!reSuccess ? (
              <form onSubmit={handleResubscribe} noValidate>
                <input
                  type="email"
                  value={reEmail}
                  onChange={e => { setReEmail(e.target.value); setReError('') }}
                  placeholder="your@email.com"
                  className="w-full bg-gray-100 border border-gray-300 rounded-lg px-4 py-3 text-gray-900 placeholder-gray-400 text-sm"
                />
                <button
                  type="submit"
                  disabled={reSubmitting}
                  className="btn-primary w-full mt-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {reSubmitting ? 'Sending…' : 'Send new confirmation link'}
                </button>
                {reError && <p className="text-red-500 text-sm mt-2">{reError}</p>}
              </form>
            ) : (
              <p className="text-green-600 text-sm mt-2">Check your email for a new confirmation link.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function UpdatesConfirmPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gg-gray-950" />}>
      <ConfirmInner />
    </Suspense>
  )
}
