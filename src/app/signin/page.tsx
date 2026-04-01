'use client'

import { useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { Eye, EyeOff, ArrowRight, CheckCircle } from 'lucide-react'
import { parseApiError } from '@/lib/parseApiError'

const API_URL = 'https://practical-serenity-production.up.railway.app'

function SignInContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const justRegistered = searchParams.get('registered') === 'true'
  
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [resetEmailSent, setResetEmailSent] = useState(false)
  
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(parseApiError(data, 'Invalid email or password'))
      }

      const data = await response.json()
      
      // Store tokens
      localStorage.setItem('auth_token', data.access_token)
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token)
      }
      
      // Fetch user to check account type
      const userResponse = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${data.access_token}`,
        },
      })
      
      if (userResponse.ok) {
        const userData = await userResponse.json()
        localStorage.setItem('user', JSON.stringify(userData))
        
        // Redirect based on account type
        if (userData.account_type === 'groundgoat_admin' || userData.account_type === 'groundgoat_sales') {
          // Admin/Sales - go to access portal
          router.push('/access')
        } else if (userData.account_type === 'firm_admin' || userData.account_type === 'firm_user') {
          // Firm users - go to access portal
          router.push('/access')
        } else {
          // Individual users - check if they have an active subscription
          const subsResponse = await fetch(`${API_URL}/api/subscriptions/areas`, {
            headers: {
              'Authorization': `Bearer ${data.access_token}`,
            },
          })
          
          if (subsResponse.ok) {
            const subsData = await subsResponse.json()
            const hasActiveSubscription = subsData.unlimited || (subsData.areas && subsData.areas.length > 0)
            
            if (hasActiveSubscription) {
              router.push('/account')
            } else {
              // No subscription - redirect to choose a plan
              router.push('/signup?step=2')
            }
          } else {
            // If we can't check subscriptions, go to account and let that page handle it
            router.push('/account')
          }
        }
      }
      
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.email) {
      setError('Please enter your email address')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: formData.email }),
      })

      // Always show success to prevent email enumeration
      setResetEmailSent(true)
      
    } catch (err) {
      setResetEmailSent(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gg-black flex items-center justify-center pt-24 pb-12">
      <div className="max-w-md w-full mx-auto px-6">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-8">
            <Image src="/logo.png" alt="Ground Goat" width={150} height={50} className="h-12 w-auto" />
          </Link>
          <h1 className="font-display text-3xl font-bold text-white mb-2">
            {showForgotPassword ? 'Reset Password' : 'Welcome Back'}
          </h1>
          <p className="text-gg-gray-400">
            {showForgotPassword 
              ? 'Enter your email to receive a reset link' 
              : 'Sign in to your Ground Goat account'
            }
          </p>
        </div>

        {/* Success message for new registration */}
        {justRegistered && !showForgotPassword && (
          <div className="mb-6 bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="text-green-500" size={20} />
            <p className="text-green-400 text-sm">Account created! Please sign in.</p>
          </div>
        )}

        {/* Password Reset Success */}
        {resetEmailSent && (
          <div className="card text-center">
            <CheckCircle className="text-gg-pink mx-auto mb-4" size={48} />
            <h2 className="font-display text-xl font-semibold text-white mb-2">Check Your Email</h2>
            <p className="text-gg-gray-400 mb-6">
              If an account exists with that email, we've sent a password reset link.
            </p>
            <button
              onClick={() => {
                setShowForgotPassword(false)
                setResetEmailSent(false)
              }}
              className="btn-secondary"
            >
              Back to Sign In
            </button>
          </div>
        )}

        {/* Sign In Form */}
        {!resetEmailSent && !showForgotPassword && (
          <form onSubmit={handleSignIn} className="card">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gg-gray-300 mb-2">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500"
                  placeholder="john@example.com"
                  required
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gg-gray-300">Password</label>
                  <button
                    type="button"
                    onClick={() => setShowForgotPassword(true)}
                    className="text-sm text-gg-pink hover:underline"
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 pr-12"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gg-gray-500 hover:text-gg-gray-300"
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? 'Signing in...' : 'Sign In'}
                <ArrowRight size={20} />
              </button>

              <p className="text-center text-gg-gray-500 text-sm">
                Don't have an account?{' '}
                <Link href="/signup" className="text-gg-pink hover:underline">Create one</Link>
              </p>
            </div>
          </form>
        )}

        {/* Forgot Password Form */}
        {!resetEmailSent && showForgotPassword && (
          <form onSubmit={handleForgotPassword} className="card">
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gg-gray-300 mb-2">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500"
                  placeholder="john@example.com"
                  required
                />
              </div>

              {error && (
                <p className="text-red-400 text-sm">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
                <ArrowRight size={20} />
              </button>

              <button
                type="button"
                onClick={() => setShowForgotPassword(false)}
                className="w-full text-center text-gg-gray-400 hover:text-white text-sm"
              >
                Back to Sign In
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <SignInContent />
    </Suspense>
  )
}
