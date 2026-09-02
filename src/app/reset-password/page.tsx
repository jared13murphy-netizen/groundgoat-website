'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Loader2, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

function ResetPasswordForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  // FIRST-TIME SETUP, NOT A RESET. A firm invite sends people here with
  // &setup=1 after an email whose button says "Set Up Your Account" — and
  // the page has always greeted them with "Reset Your Password" and
  // "Enter your new password below", for an account they have never had a
  // password on. The flag was added with the invite and the page never
  // read it (2026-08-31). Same form, same endpoint; only the wording
  // changes, so nothing about the reset flow moves.
  const isSetup = searchParams.get('setup') === '1'

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!token) {
      setError('Invalid reset link. Please request a new password reset.')
    }
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!password) {
      setError('Please enter a new password')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, new_password: password }),
      })

      if (response.ok) {
        // Owner 2026-09-01: setting a password signs you in — never hand
        // someone a login form right after they chose their password.
        // Same storage sequence as the signin page; if the backend is an
        // older build without tokens in this response, fall back to the
        // old "now sign in" success screen.
        const data = await response.json().catch(() => null)
        if (data?.access_token) {
          localStorage.setItem('auth_token', data.access_token)
          if (data.refresh_token) {
            localStorage.setItem('refresh_token', data.refresh_token)
          }
          try {
            const userResponse = await fetch(`${API_URL}/api/auth/me`, {
              headers: { 'Authorization': `Bearer ${data.access_token}` },
            })
            if (userResponse.ok) {
              localStorage.setItem('user', JSON.stringify(await userResponse.json()))
            }
          } catch {
            /* profile fetch is a nicety — the session itself is stored */
          }
          router.push('/access')
          return
        }
        setSuccess(true)
      } else {
        const data = await response.json()
        setError(data.detail || 'Failed to reset password. The link may have expired.')
      }
    } catch (err) {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle className="text-green-500" size={40} />
          </div>
          <h1 className="font-display text-3xl font-bold text-white mb-4">
            Password Reset!
          </h1>
          <p className="text-gg-gray-400 mb-8">
            Your password has been successfully reset. You can now sign in with your new password.
          </p>
          <Link
            href="/signin"
            className="btn-primary inline-block px-8 py-3"
          >
            Sign In
          </Link>
        </div>
      </div>
    )
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <XCircle className="text-red-500" size={40} />
          </div>
          <h1 className="font-display text-3xl font-bold text-white mb-4">
            Invalid Link
          </h1>
          <p className="text-gg-gray-400 mb-8">
            {isSetup
              ? 'This invitation link is invalid or has expired. Ask your firm admin to send you a new one.'
              : 'This password reset link is invalid or has expired. Please request a new one.'}
          </p>
          <Link
            href="/signin"
            className="btn-primary inline-block px-8 py-3"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black flex items-center justify-center px-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold text-white mb-2">
            {isSetup ? 'Set Up Your Account' : 'Reset Your Password'}
          </h1>
          <p className="text-gg-gray-400">
            {isSetup
              ? 'Choose a password and your Ground Goat account is ready.'
              : 'Enter your new password below.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="card">
          {error && (
            <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-gg-gray-400 text-sm mb-2">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-[#1a1a1a] pr-12 focus:border-gg-pink focus:outline-none"
                  placeholder="Enter new password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gg-gray-500 hover:text-white"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-gg-gray-400 text-sm mb-2">
                Confirm Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full bg-white border border-gray-300 rounded-lg px-4 py-3 text-[#1a1a1a] focus:border-gg-pink focus:outline-none"
                placeholder="Confirm new password"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full btn-primary mt-6 py-3 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Resetting...
              </>
            ) : (
              'Reset Password'
            )}
          </button>

          <p className="text-center text-gg-gray-500 text-sm mt-6">
            Remember your password?{' '}
            <Link href="/signin" className="text-gg-pink hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    }>
      <ResetPasswordForm />
    </Suspense>
  )
}
