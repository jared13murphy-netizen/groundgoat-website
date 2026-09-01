'use client'

import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

function MagicLinkContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')
  const redirect = searchParams.get('redirect') || '/account/areas'

  const [status, setStatus] = useState<'loading' | 'error'>('loading')
  const [error, setError] = useState('')
  // A magic-link token is single-use: the backend consumes it on the first
  // exchange. This effect can run more than once (re-render, or the router
  // dep changing identity), and a second call would hit an already-used
  // token and surface a false "Link Expired" AFTER the first call already
  // signed the user in. This ref makes the exchange fire exactly once.
  const exchangedRef = useRef(false)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setError('No token provided')
      return
    }
    if (exchangedRef.current) return
    exchangedRef.current = true

    const exchangeToken = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/auth/exchange-magic-link?token=${encodeURIComponent(token)}`
        )

        if (!response.ok) {
          const data = await response.json()
          throw new Error(data.detail || 'Failed to authenticate')
        }

        const data = await response.json()

        // Store tokens (same pattern as signin page)
        localStorage.setItem('auth_token', data.access_token)
        if (data.refresh_token) {
          localStorage.setItem('refresh_token', data.refresh_token)
        }

        // Fetch user data
        const userResponse = await fetch(`${API_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${data.access_token}` },
        })
        if (userResponse.ok) {
          const userData = await userResponse.json()
          localStorage.setItem('user', JSON.stringify(userData))
        }

        // Redirect to target page
        router.push(redirect)
      } catch (err: unknown) {
        setStatus('error')
        setError(err instanceof Error ? err.message : 'Something went wrong')
      }
    }

    exchangeToken()
  }, [token, redirect, router])

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="bg-[#16213e] rounded-2xl p-8 border border-white/10">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Link Expired</h1>
            <p className="text-gray-400 mb-6">
              {error === 'This magic link has already been used'
                ? 'This link has already been used. Please generate a new one from the app.'
                : error === 'This magic link has expired'
                ? 'This link has expired. Please generate a new one from the app.'
                : 'This link is no longer valid. Please try again from the app or sign in manually.'}
            </p>
            <Link
              href="/signin"
              className="inline-block px-6 py-3 bg-[#c9a0dc] text-black font-semibold rounded-lg hover:bg-[#d4b3e6] transition-colors"
            >
              Sign In Manually
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Loading state
  return (
    <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="bg-[#16213e] rounded-2xl p-8 border border-white/10">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#c9a0dc]/20 flex items-center justify-center animate-pulse">
            <svg className="w-8 h-8 text-[#c9a0dc]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Signing you in...</h1>
          <p className="text-gray-400">Please wait while we verify your link.</p>
        </div>
      </div>
    </div>
  )
}

export default function MagicLinkPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#1a1a2e] flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    }>
      <MagicLinkContent />
    </Suspense>
  )
}
