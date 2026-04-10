'use client'

import { useState, useEffect, Suspense } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { User, CreditCard, LogOut, MapPin, ChevronRight, CheckCircle, AlertCircle, Loader2, Users, Mail, Trash2 } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

function AccountContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const subscriptionSuccess = searchParams.get('subscription') === 'success'
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null)
  const [subscriptionData, setSubscriptionData] = useState<any>(null)
  const [sendingVerification, setSendingVerification] = useState(false)
  const [verificationSent, setVerificationSent] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }

    // Try to get cached user first
    const cachedUser = localStorage.getItem('user')
    if (cachedUser) {
      setUser(JSON.parse(cachedUser))
    }

    // Fetch fresh user data and subscription status
    fetchUserAndSubscription(token)
  }, [router])

  const fetchUserAndSubscription = async (token: string) => {
    try {
      // Fetch user data
      const userResponse = await fetchWithAuth(`${API_URL}/api/auth/me`)

      if (!userResponse.ok) {
        throw new Error('Session expired')
      }

      const userData = await userResponse.json()
      setUser(userData)
      localStorage.setItem('user', JSON.stringify(userData))

      // Skip subscription check for admins and firm users (firm users inherit firm access)
      if (userData.account_type === 'groundgoat_admin' ||
          userData.account_type === 'groundgoat_sales' ||
          userData.account_type === 'firm_admin' ||
          userData.account_type === 'firm_user') {
        setHasSubscription(true)
        setLoading(false)
        return
      }

      // Check subscription status for individual users
      // If returning from Stripe checkout, poll for up to 10 seconds in case webhook hasn't fired yet
      const maxAttempts = subscriptionSuccess ? 5 : 1
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const subsResponse = await fetchWithAuth(`${API_URL}/api/subscriptions/areas`)

        if (subsResponse.ok) {
          const subsData = await subsResponse.json()
          setSubscriptionData(subsData)
          const hasActive = subsData.unlimited || (subsData.areas && subsData.areas.some((a: any) => a.status === 'active' || a.status === 'trialing'))
          setHasSubscription(hasActive)
          if (hasActive || !subscriptionSuccess) break
        } else {
          setHasSubscription(false)
          if (!subscriptionSuccess) break
        }

        // Wait 2 seconds before retrying (only if polling after checkout)
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
      }
    } catch (err) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('user')
      router.push('/signin')
    } finally {
      setLoading(false)
    }
  }

const handleResendVerification = async () => {
    const token = localStorage.getItem('auth_token')
    if (!token) return

    setSendingVerification(true)
    try {
      const response = await fetch(`${API_URL}/api/auth/send-verification`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (response.ok) {
        setVerificationSent(true)
      }
    } catch (err) {
      console.error('Failed to send verification email:', err)
    } finally {
      setSendingVerification(false)
    }
}
  
  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user')
    router.push('/')
  }

  const handleDeleteAccount = async () => {
    setDeleting(true)
    setDeleteError(null)

    try {
      const response = await fetchWithAuth(`${API_URL}/api/auth/me`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || 'Failed to delete account')
      }

      // Clear local storage and redirect to home
      localStorage.removeItem('auth_token')
      localStorage.removeItem('user')
      router.push('/')
    } catch (err: any) {
      setDeleteError(err.message)
    } finally {
      setDeleting(false)
    }
  }

  const getAccountTypeLabel = (type: string) => {
    switch (type) {
      case 'groundgoat_admin': return 'Admin'
      case 'groundgoat_sales': return 'Sales'
      case 'firm_admin': return 'Management Firm Admin'
      case 'firm_user': return 'Management Firm User'
      default: return 'Individual'
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Subscription Success Message */}
        {subscriptionSuccess && (
          <div className="mb-6 bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="text-green-500 flex-shrink-0" size={24} />
            <div>
              <p className="text-green-400 font-medium">Subscription activated!</p>
              <p className="text-green-400/70 text-sm">You now have access to your selected areas.</p>
            </div>
          </div>
        )}

{/* Email Verification Banner */}
        {user && !user.is_verified && (
          <div className="mb-6 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Mail className="text-blue-400 flex-shrink-0 mt-0.5" size={24} />
              <div className="flex-1">
                <p className="text-blue-400 font-medium">Verify your email address</p>
                <p className="text-blue-400/70 text-sm mb-3">
                  Please check your inbox and click the verification link to complete your account setup.
                </p>
                {verificationSent ? (
                  <p className="text-green-400 text-sm flex items-center gap-2">
                    <CheckCircle size={16} />
                    Verification email sent! Check your inbox.
                  </p>
                ) : (
                  <button
                    onClick={handleResendVerification}
                    disabled={sendingVerification}
                    className="text-blue-400 hover:text-blue-300 text-sm font-medium flex items-center gap-2"
                  >
                    {sendingVerification ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Sending...
                      </>
                    ) : (
                      'Resend verification email'
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        
        {/* No Subscription Warning */}
        {hasSubscription === false && (
          <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="text-yellow-500 flex-shrink-0 mt-0.5" size={24} />
              <div className="flex-1">
                <p className="text-yellow-400 font-medium">No active subscription</p>
                <p className="text-yellow-400/70 text-sm mb-3">Subscribe to access auction alerts, sale results, and more.</p>
                <Link href="/signup?step=2" className="btn-primary inline-flex items-center gap-2 text-sm py-2">
                  Choose a Plan
                  <ChevronRight size={16} />
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* Download App CTA */}
        <div className="mb-6 bg-gradient-to-r from-gg-pink/10 to-gg-pink-dark/10 border-2 border-gg-pink/40 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <div className="w-16 h-16 rounded-2xl flex-shrink-0 overflow-hidden">
              <Image
                src="/app-icon.png"
                alt="Ground Goat App"
                width={64}
                height={64}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex-1 text-center sm:text-left">
              <h3 className="font-display text-xl font-bold text-white mb-1">
                Download the Ground Goat App
              </h3>
              <p className="text-gg-gray-300 text-sm">
                Get real-time auction alerts, browse listings, and never miss a sale. The full Ground Goat experience, right in your pocket.
              </p>
            </div>
            <a
              href="https://apps.apple.com/us/app/ground-goat/id6753321116"
              target="_blank"
              className="btn-primary text-sm py-3 px-6 whitespace-nowrap font-semibold"
            >
              Download on the App Store
            </a>
          </div>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-4xl font-bold text-white mb-2">Account</h1>
          <p className="text-gg-gray-400">Manage your Ground Goat subscription and settings</p>
        </div>

        {/* Profile Card */}
        <div className="card mb-8">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 bg-gradient-to-br from-gg-pink to-gg-pink-dark rounded-full flex items-center justify-center">
              <span className="text-2xl font-bold text-black">
                {user?.first_name?.[0]}{user?.last_name?.[0]}
              </span>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">
                {user?.first_name} {user?.last_name}
              </h2>
              <p className="text-gg-gray-400">{user?.email}</p>
              <span className="inline-block mt-1 bg-gg-pink/20 text-gg-pink text-xs font-medium px-2 py-1 rounded-full">
                {getAccountTypeLabel(user?.account_type)}
              </span>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="space-y-4">
          <MenuItem
            icon={<User size={20} />}
            label="Edit Profile"
            description="Update your name and contact info"
            href="/account/profile"
          />
          
          {/* Subscription & Areas - Only for individual users */}
          {user?.account_type === 'individual' && (
            <>
              <MenuItem
                icon={<CreditCard size={20} />}
                label="Subscription"
                description="Manage your plan, states, and billing"
                href="/account/subscription"
              />
            </>
          )}

          {/* Team Management - Only for Firm Admins */}
          {user?.account_type === 'firm_admin' && (
            <MenuItem
              icon={<Users size={20} />}
              label="Team Management"
              description="Add and manage your firm's team members"
              href="/account/team"
            />
          )}
        </div>

        {/* App Settings Note */}
        <div className="mt-6 p-4 bg-gg-gray-800/50 rounded-lg">
          <p className="text-gg-gray-400 text-sm">
            <span className="text-gg-gray-300">Notifications & Settings</span> can be managed in the Ground Goat mobile app.
          </p>
        </div>

        {/* Admin Link */}
        {(user?.account_type === 'groundgoat_admin' || user?.account_type === 'groundgoat_sales') && (
          <div className="mt-8 pt-8 border-t border-gg-gray-800">
            <Link
              href="/admin/dashboard"
              className="card flex items-center justify-between hover:border-gg-pink"
            >
              <div>
                <h3 className="font-semibold text-white">Admin Dashboard</h3>
                <p className="text-sm text-gg-gray-400">Access admin tools and analytics</p>
              </div>
              <ChevronRight className="text-gg-gray-500" />
            </Link>
          </div>
        )}

        {/* Logout */}
        <div className="mt-8">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-red-400 hover:text-red-300 transition-colors"
          >
            <LogOut size={20} />
            Sign Out
          </button>
        </div>

        {/* Delete Account */}
        <div className="mt-8 pt-8 border-t border-gg-gray-800">
          <button
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-2 text-gg-gray-500 hover:text-red-400 transition-colors text-sm"
          >
            <Trash2 size={16} />
            Delete Account
          </button>
        </div>

        {/* Delete Account Modal */}
        {showDeleteModal && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gg-gray-900 rounded-xl p-6 max-w-md w-full border border-gg-gray-700">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center">
                  <Trash2 className="text-red-500" size={20} />
                </div>
                <h3 className="text-xl font-semibold text-white">Delete Account</h3>
              </div>

              <p className="text-gg-gray-400 mb-4">
                Are you sure you want to delete your account? This action cannot be undone and will permanently delete all your data.
              </p>

              {deleteError && (
                <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                  <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
                  <p className="text-red-400 text-sm">{deleteError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowDeleteModal(false)
                    setDeleteError(null)
                  }}
                  className="flex-1 btn-secondary"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2 px-4 rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {deleting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    'Delete Account'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

function MenuItem({ icon, label, description, href }: { icon: React.ReactNode, label: string, description: string, href: string }) {
  return (
    <Link href={href} className="card flex items-center justify-between hover:border-gg-gray-600">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-gg-gray-700 rounded-lg flex items-center justify-center text-gg-gray-300">
          {icon}
        </div>
        <div>
          <h3 className="font-medium text-white">{label}</h3>
          <p className="text-sm text-gg-gray-400">{description}</p>
        </div>
      </div>
      <ChevronRight className="text-gg-gray-500" />
    </Link>
  )
}

export default function AccountPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    }>
      <AccountContent />
    </Suspense>
  )
}
