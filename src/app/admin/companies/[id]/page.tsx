'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, Trash2, ExternalLink } from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Company {
  id: string
  name: string
  website: string
  address: string
  city: string
  state: string
  zip: string
  phone: string
  email: string
  logo_url: string
  created_at: string
}

export default function EditCompanyPage() {
  const router = useRouter()
  const params = useParams()
  const companyId = params.id as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [company, setCompany] = useState<Company | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [formData, setFormData] = useState({
    name: '',
    website: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    phone: '',
    email: '',
    logo_url: '',
  })

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth(token)
  }, [router, companyId])

  const checkAuth = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/auth/me`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (!response.ok) throw new Error('Not authenticated')

      const userData = await response.json()
      
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }

      await fetchCompany(token)
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchCompany = async (token: string) => {
    try {
      const response = await fetch(`${API_URL}/api/companies/${companyId}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        const data = await response.json()
        setCompany(data)
        
        setFormData({
          name: data.name || '',
          website: data.website || '',
          address: data.address || '',
          city: data.city || '',
          state: data.state || '',
          zip: data.zip || '',
          phone: data.phone || '',
          email: data.email || '',
          logo_url: data.logo_url || '',
        })
      } else {
        setError('Company not found')
      }
    } catch (err) {
      setError('Failed to fetch company')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')

    const token = localStorage.getItem('auth_token')

    try {
      const updateData: any = {}
      
      if (formData.name) updateData.name = formData.name
      if (formData.website) updateData.website = formData.website
      if (formData.address) updateData.address = formData.address
      if (formData.city) updateData.city = formData.city
      if (formData.state) updateData.state = formData.state
      if (formData.zip) updateData.zip = formData.zip
      if (formData.phone) updateData.phone = formData.phone
      if (formData.email) updateData.email = formData.email
      if (formData.logo_url) updateData.logo_url = formData.logo_url

      const response = await fetch(`${API_URL}/api/companies/${companyId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData),
      })

      if (response.ok) {
        setSuccess('Company updated successfully!')
        setTimeout(() => setSuccess(''), 3000)
      } else {
        const data = await response.json()
        setError(data.detail || 'Failed to update company')
      }
    } catch (err) {
      setError('Failed to update company')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this company? This will affect all associated listings.')) return

    const token = localStorage.getItem('auth_token')

    try {
      const response = await fetch(`${API_URL}/api/companies/${companyId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        router.push('/admin/companies')
      } else {
        setError('Failed to delete company')
      }
    } catch (err) {
      setError('Failed to delete company')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  if (!company) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-center">
          <p className="text-white text-xl mb-4">Company not found</p>
          <Link href="/admin/companies" className="text-gg-pink hover:underline">
            Back to Companies
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-4xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/companies" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Edit Company</h1>
              <p className="text-gg-gray-400">{company.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-4 py-2 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700"
              >
                <ExternalLink size={16} />
                Website
              </a>
            )}
            <button
              onClick={handleDelete}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30"
            >
              <Trash2 size={16} />
              Delete
            </button>
          </div>
        </div>

        {/* Messages */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 p-4 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400">
            {success}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Company Information</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-gg-gray-400 text-sm mb-1">Company Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                  required
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Website</label>
                <input
                  type="url"
                  name="website"
                  value={formData.website}
                  onChange={handleChange}
                  placeholder="https://example.com"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Email</label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Phone</label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Logo URL</label>
                <input
                  type="url"
                  name="logo_url"
                  value={formData.logo_url}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
            </div>
            {formData.logo_url && (
              <div className="mt-4">
                <p className="text-gg-gray-400 text-sm mb-2">Logo Preview:</p>
                <img 
                  src={formData.logo_url} 
                  alt="Company logo" 
                  className="h-16 object-contain bg-white rounded-lg p-2"
                />
              </div>
            )}
          </div>

          {/* Address */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Address</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="block text-gg-gray-400 text-sm mb-1">Street Address</label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">City</label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">State</label>
                <input
                  type="text"
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">ZIP Code</label>
                <input
                  type="text"
                  name="zip"
                  value={formData.zip}
                  onChange={handleChange}
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
              </div>
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-4">
            <Link
              href="/admin/companies"
              className="px-6 py-3 bg-gg-gray-800 text-white rounded-lg hover:bg-gg-gray-700"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 px-6 py-3 bg-gg-pink text-white rounded-lg hover:bg-gg-pink/80 disabled:opacity-50"
            >
              {saving ? (
                <>
                  <Loader2 className="animate-spin" size={16} />
                  Saving...
                </>
              ) : (
                <>
                  <Save size={16} />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
