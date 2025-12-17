'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { User, CreditCard, Bell, LogOut, Settings, MapPin, ChevronRight, CheckCircle, AlertCircle } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

export default function AccountPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const subscriptionSuccess = searchParams.get('subscription') === 'success'
  const [user, setUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null)
  const [subscriptionData, setSubscriptionData] = useState<any>(null)

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
      const userResponse = await fetch(`${API_URL}/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (!userResponse.ok) {
        throw new Error('Session expired')
      }

      const userData = await userResponse.json()
      setUser(userData)
      localStorage.setItem('user', JSON.stringify(userData))

      // Skip subscription check for admins
      if (userData.account_type === 'groundgoat_admin' || userData.account_type === 'groundgoat_sales') {
        setHasSubscription(true)
        setLoading(false)
        return
      }

      // Check subscription status
      const subsResponse = await fetch(`${API_URL}/api/subscriptions/areas`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })

      if (subsResponse.ok) {
        const subsData = await subsResponse.json()
        setSubscriptionData(subsData)
        const hasActive = subsData.unlimited || (subsData.areas && subsData.areas.some((a: any) => a.status === 'active'))
        setHasSubscription(hasActive)
      } else {
        setHasSubscription(false)
      }
    } catch (err) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('user')
      router.push('/signin')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('auth_token')
    localStorage.removeItem('user')
    router.push('/')
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
          
          <MenuItem
            icon={<CreditCard size={20} />}
            label="Subscription"
            description="Manage your plan and billing"
            href="/account/subscription"
          />

          <MenuItem
            icon={<MapPin size={20} />}
            label="My Areas"
            description="View your subscribed counties and states"
            href="/account/areas"
          />

          <MenuItem
            icon={<Bell size={20} />}
            label="Notifications"
            description="Configure email and push notifications"
            href="/account/notifications"
          />

          <MenuItem
            icon={<Settings size={20} />}
            label="Settings"
            description="App preferences and security"
            href="/account/settings"
          />
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

        {/* Download App CTA */}
        <div className="mt-12 card bg-gradient-to-r from-gg-gray-800 to-gg-gray-900 border-gg-pink/30">
          <div className="flex flex-col md:flex-row items-center gap-6">
            <Image
              src="/logo.png"
              alt="Ground Goat"
              width={80}
              height={80}
              className="h-16 w-auto"
            />
            <div className="flex-1 text-center md:text-left">
              <h3 className="font-display text-xl font-semibold text-white mb-1">
                Get the Mobile App
              </h3>
              <p className="text-gg-gray-400">
                Browse auctions, get notifications, and access your watchlist on the go.
              </p>
            </div>
            <div className="flex gap-3">
              <a href="#" className="btn-secondary text-sm py-2">App Store</a>
              <a href="#" className="btn-secondary text-sm py-2">Google Play</a>
            </div>
          </div>
        </div>
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
