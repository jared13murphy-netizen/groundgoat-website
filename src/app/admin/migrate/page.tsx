'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, CheckCircle, AlertCircle } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export default function MigratePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const token = localStorage.getItem('auth_token')
      if (!token) {
        router.push('/signin')
        return
      }

      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()

      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }

      setLoading(false)
    } catch (err) {
      router.push('/signin')
    }
  }

  const runMigration = async () => {
    setRunning(true)
    setError('')
    setResult(null)

    const token = localStorage.getItem('auth_token')

    try {
      const response = await fetch(`${API_URL}/api/admin/migrate-verified-column`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      const data = await response.json()

      if (response.ok) {
        setResult({ success: true, message: data.message })
      } else {
        setError(data.detail || 'Migration failed')
      }
    } catch (err) {
      setError('Failed to run migration: ' + err)
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-2xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Database Migration</h1>
            <p className="text-gg-gray-400">Add verified column to listings table</p>
          </div>
        </div>

        {/* Info Card */}
        <div className="card mb-6">
          <div className="flex items-start gap-3 mb-4">
            <AlertCircle className="text-blue-400 flex-shrink-0 mt-1" size={20} />
            <div>
              <h3 className="text-white font-semibold mb-2">Migration Required</h3>
              <p className="text-gg-gray-400 text-sm mb-2">
                This migration adds the <code className="text-gg-pink">verified</code> column to the listings table.
                This is required for the new verification feature to work.
              </p>
              <p className="text-gg-gray-400 text-sm">
                This is safe to run and will restore all your listings. Your data has not been deleted.
              </p>
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-xl text-red-400 flex items-start gap-3">
            <AlertCircle className="flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-semibold mb-1">Error</p>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Success Message */}
        {result?.success && (
          <div className="mb-6 p-4 bg-green-500/20 border border-green-500/50 rounded-xl text-green-400 flex items-start gap-3">
            <CheckCircle className="flex-shrink-0 mt-0.5" size={20} />
            <div>
              <p className="font-semibold mb-1">Migration Successful!</p>
              <p className="text-sm">{result.message}</p>
              <p className="text-sm mt-2">
                Your listings should now be visible. Go to{' '}
                <Link href="/admin/listings" className="underline hover:text-green-300">
                  Admin Listings
                </Link>
                {' '}to verify.
              </p>
            </div>
          </div>
        )}

        {/* Run Migration Button */}
        <div className="card">
          <h3 className="text-white font-semibold mb-4">Run Migration</h3>
          <p className="text-gg-gray-400 text-sm mb-6">
            Click the button below to add the verified column to your database.
            This will only take a few seconds.
          </p>
          <button
            onClick={runMigration}
            disabled={running || result?.success}
            className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50 disabled:cursor-not-allowed font-semibold"
          >
            {running ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Running Migration...
              </>
            ) : result?.success ? (
              <>
                <CheckCircle size={20} />
                Migration Complete
              </>
            ) : (
              'Run Migration'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
