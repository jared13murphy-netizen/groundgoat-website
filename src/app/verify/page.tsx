'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

function VerifyContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('No verification token provided')
      return
    }

    const verifyEmail = async () => {
      try {
        const response = await fetch(`${API_URL}/api/auth/verify?token=${token}`)
        const data = await response.json()
        
        if (response.ok) {
          setStatus('success')
          setMessage('Your email has been verified!')
        } else {
          setStatus('error')
          setMessage(data.detail || 'Verification failed. The link may be expired.')
        }
      } catch (err) {
        setStatus('error')
        setMessage('Something went wrong. Please try again.')
      }
    }

    verifyEmail()
  }, [token])

  return (
    <div className="min-h-screen bg-gg-black flex items-center justify-center pt-24 pb-12">
      <div className="max-w-md w-full mx-auto px-6">
        <div className="card text-center">
          {status === 'loading' && (
            <>
              <Loader2 className="text-gg-pink mx-auto mb-4 animate-spin" size={64} />
              <h1 className="font-display text-2xl font-bold text-white mb-4">
                Verifying Your Email
              </h1>
              <p className="text-gg-gray-400">
                Please wait...
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="text-green-500 mx-auto mb-4" size={64} />
              <h1 className="font-display text-2xl font-bold text-white mb-4">
                Email Verified!
              </h1>
              <p className="text-gg-gray-400 mb-8">
                {message}
              </p>
              <Link href="/account" className="btn-primary inline-block">
                Go to Account
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="text-red-500 mx-auto mb-4" size={64} />
              <h1 className="font-display text-2xl font-bold text-white mb-4">
                Verification Failed
              </h1>
              <p className="text-gg-gray-400 mb-8">
                {message}
              </p>
              <div className="space-y-4">
                <Link href="/account" className="btn-primary inline-block w-full">
                  Go to Account
                </Link>
                <p className="text-gg-gray-500 text-sm">
                  You can request a new verification email from your account page.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="text-gg-pink animate-spin" size={48} />
      </div>
    }>
      <VerifyContent />
    </Suspense>
  )
}
