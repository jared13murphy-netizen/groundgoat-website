'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Check, User } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

export default function ProfilePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  const [user, setUser] = useState<any>(null)
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  })

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    fetchUser(token)
  }, [router])

  const fetchUser = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!response.ok) {
        if (response.status === 401) {
          router.push('/signin')
          return
        }
        throw new Error('Failed to fetch user')
      }
      const userData = await response.json()
      setUser(userData)
      setFormData({
        firstName: userData.first_name || '',
        lastName: userData.last_name || '',
        email: userData.email || '',
        phone: userData.phone || '',
      })
    } catch (err: any) {
      setError(err.message || 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError('')
    setSuccess(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess(false)

    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          first_name: formData.firstName,
          last_name: formData.lastName,
          phone: formData.phone || null,
        })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to update profile')
      }

      const updatedUser = await response.json()
      setUser(updatedUser)
      localStorage.setItem('user', JSON.stringify(updatedUser))
      setSuccess(true)
      
      // Dispatch storage event to update navigation
      window.dispatchEvent(new Event('storage'))
    } catch (err: any) {
      setError(err.message || 'Failed to update profile')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-2xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link 
            href="/account" 
            className="w-10 h-10 bg-gg-gray-800 rounded-lg flex items-center justify-center text-gg-gray-400 hover:text-white hover:bg-gg-gray-700 transition-colors"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Edit Profile</h1>
            <p className="text-gg-gray-400">Update your personal information</p>
          </div>
        </div>

        {/* Profile Avatar */}
        <div className="card mb-8">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 bg-gradient-to-br from-gg-pink to-gg-pink-dark rounded-full flex items-center justify-center">
              <span className="text-3xl font-bold text-black">
                {formData.firstName?.[0]}{formData.lastName?.[0]}
              </span>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white">
                {formData.firstName} {formData.lastName}
              </h2>
              <p className="text-gg-gray-400">{formData.email}</p>
            </div>
          </div>
        </div>

        {/* Edit Form */}
        <form onSubmit={handleSubmit} className="card">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gg-gray-300 mb-2">
                  First Name
                </label>
                <input
                  type="text"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gg-gray-300 mb-2">
                  Last Name
                </label>
                <input
                  type="text"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gg-gray-300 mb-2">
                Email Address
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                disabled
                className="w-full bg-gg-gray-900/50 border border-gg-gray-700 rounded-lg px-4 py-3 text-gg-gray-500 cursor-not-allowed"
              />
              <p className="text-xs text-gg-gray-500 mt-1">
                Email cannot be changed. Contact support if you need to update it.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gg-gray-300 mb-2">
                Phone Number
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                placeholder="(555) 123-4567"
                className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 focus:border-gg-pink focus:outline-none"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {success && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center gap-2">
                <Check className="text-green-500" size={18} />
                <p className="text-green-400 text-sm">Profile updated successfully!</p>
              </div>
            )}

            <div className="flex gap-4">
              <Link href="/account" className="btn-secondary flex-1 text-center">
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {saving ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Change Password Section */}
        <div className="card mt-8">
          <h3 className="font-semibold text-white mb-2">Change Password</h3>
          <p className="text-gg-gray-400 text-sm mb-4">
            To change your password, use the forgot password feature.
          </p>
          <Link href="/signin" className="text-gg-pink hover:underline text-sm">
            Reset password →
          </Link>
        </div>
      </div>
    </div>
  )
}
