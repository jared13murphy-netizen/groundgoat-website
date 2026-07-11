'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Save, Loader2, Trash2, ExternalLink, Plus, X } from 'lucide-react'
import DeleteCompanyModal, { DeleteCompanyOption } from '@/components/admin/DeleteCompanyModal'

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
  auction_list_url: string
  private_treaty_list_url: string
  created_at: string
}

interface PrivateTreatyUrl {
  id: number
  url: string
  label: string | null
  listing_company_id: string
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
    auction_list_url: '',
    private_treaty_list_url: '',
  })

  // Private treaty URLs (multi-URL management)
  const [ptUrls, setPtUrls] = useState<PrivateTreatyUrl[]>([])
  const [newPtUrl, setNewPtUrl] = useState('')
  const [newPtLabel, setNewPtLabel] = useState('')
  const [addingPtUrl, setAddingPtUrl] = useState(false)

  // Delete / reassign — this screen doesn't pre-fetch listing counts like
  // the companies list does, so it discovers "has referencing listings"
  // from the backend's 409 on plain delete, then lazily fetches the other
  // companies to populate the shared reassign-picker modal.
  const [companies, setCompanies] = useState<DeleteCompanyOption[]>([])
  const [companyToDelete, setCompanyToDelete] = useState<DeleteCompanyOption | null>(null)
  const [reassignTo, setReassignTo] = useState('')
  const [deleting, setDeleting] = useState(false)

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
          auction_list_url: data.auction_list_url || '',
          private_treaty_list_url: data.private_treaty_list_url || '',
        })

        // Fetch private treaty URLs
        await fetchPtUrls(token)
      } else {
        setError('Company not found')
      }
    } catch (err) {
      setError('Failed to fetch company')
    } finally {
      setLoading(false)
    }
  }

  const fetchPtUrls = async (token?: string) => {
    const t = token || localStorage.getItem('auth_token')
    try {
      const response = await fetch(`${API_URL}/api/companies/${companyId}/private-treaty-urls`, {
        headers: { 'Authorization': `Bearer ${t}` },
      })
      if (response.ok) {
        const data = await response.json()
        setPtUrls(data)
      }
    } catch (err) {
      console.error('Failed to fetch PT URLs:', err)
    }
  }

  const handleAddPtUrl = async () => {
    if (!newPtUrl.trim()) return
    setAddingPtUrl(true)
    const token = localStorage.getItem('auth_token')
    try {
      const response = await fetch(`${API_URL}/api/companies/${companyId}/private-treaty-urls`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: newPtUrl.trim(), label: newPtLabel.trim() || null }),
      })
      if (response.ok) {
        setNewPtUrl('')
        setNewPtLabel('')
        await fetchPtUrls()
      } else {
        const data = await response.json()
        setError(data.detail || 'Failed to add URL')
      }
    } catch (err) {
      setError('Failed to add URL')
    } finally {
      setAddingPtUrl(false)
    }
  }

  const handleDeletePtUrl = async (urlId: number) => {
    const token = localStorage.getItem('auth_token')
    try {
      const response = await fetch(`${API_URL}/api/companies/${companyId}/private-treaty-urls/${urlId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      if (response.ok) {
        await fetchPtUrls()
      }
    } catch (err) {
      setError('Failed to delete URL')
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
      // Include URL fields even if empty to allow clearing them
      updateData.auction_list_url = formData.auction_list_url || null
      updateData.private_treaty_list_url = formData.private_treaty_list_url || null

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

  const handleDeleteClick = () => {
    if (!company) return
    if (!confirm(`Delete ${company.name}? If it has listings you'll be asked to reassign them first.`)) return
    performDelete()
  }

  // Companies with referencing listings can't just be deleted — the backend
  // 409s (DELETE /api/companies/{id} requires reassign_to). Zero-listing
  // companies delete on the first try; a 409 means we lazily fetch the
  // other companies and open the shared reassign-picker modal instead of
  // dead-ending on a generic error (same flow as /admin/companies).
  const performDelete = async (reassignToId?: string) => {
    if (!company) return
    setDeleting(true)
    setError('')
    const token = localStorage.getItem('auth_token')

    try {
      const url = reassignToId
        ? `${API_URL}/api/companies/${companyId}?reassign_to=${reassignToId}`
        : `${API_URL}/api/companies/${companyId}`
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      })

      if (response.ok) {
        router.push('/admin/companies')
        return
      }

      if (response.status === 409) {
        if (companies.length === 0) {
          const listResponse = await fetch(`${API_URL}/api/companies`, {
            headers: { 'Authorization': `Bearer ${token}` },
          })
          if (listResponse.ok) {
            setCompanies(await listResponse.json())
          }
        }
        setReassignTo('')
        setCompanyToDelete({ id: company.id, name: company.name })
      } else {
        setError('Failed to delete company')
      }
    } catch (err) {
      setError('Failed to delete company')
    } finally {
      setDeleting(false)
    }
  }

  const confirmReassignAndDelete = () => {
    if (!companyToDelete || !reassignTo) return
    performDelete(reassignTo)
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
              onClick={handleDeleteClick}
              disabled={deleting}
              className="flex items-center gap-2 px-4 py-2 bg-red-500/20 text-red-400 rounded-lg hover:bg-red-500/30 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
              Delete
            </button>
          </div>
        </div>

        {/* Delete Company Modal — shared with /admin/companies (list) so
            the two delete/reassign flows can't drift out of sync. */}
        {companyToDelete && (
          <DeleteCompanyModal
            companyToDelete={companyToDelete}
            companies={companies}
            reassignTo={reassignTo}
            onReassignToChange={setReassignTo}
            onCancel={() => setCompanyToDelete(null)}
            onConfirm={confirmReassignAndDelete}
            deleting={deleting}
          />
        )}

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

          {/* Listing URLs */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Listing Page URLs</h2>
            <p className="text-gg-gray-400 text-sm mb-4">
              URLs to the company's pages showing their upcoming auctions or current listings
            </p>
            <div className="grid grid-cols-1 gap-4">
              <div>
                <label className="block text-gg-gray-400 text-sm mb-1">Auction Listings URL</label>
                <input
                  type="url"
                  name="auction_list_url"
                  value={formData.auction_list_url}
                  onChange={handleChange}
                  placeholder="https://example.com/auctions"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                />
                <p className="text-gg-gray-500 text-xs mt-1">URL to the company's upcoming auctions page</p>
              </div>
            </div>
          </div>

          {/* Private Treaty URLs (Multi-URL) */}
          <div className="card">
            <h2 className="text-xl font-semibold text-white mb-4">Private Treaty Listing URLs</h2>
            <p className="text-gg-gray-400 text-sm mb-4">
              Add one or more URLs to the company&apos;s private treaty listing pages. Some companies separate listings by category.
            </p>

            {/* Existing URLs */}
            {ptUrls.length > 0 && (
              <div className="space-y-2 mb-4">
                {ptUrls.map(ptUrl => (
                  <div key={ptUrl.id} className="flex items-center gap-3 bg-gg-gray-800 rounded-lg px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <a
                        href={ptUrl.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gg-pink hover:underline text-sm truncate block"
                      >
                        {ptUrl.url}
                      </a>
                      {ptUrl.label && (
                        <span className="text-gg-gray-500 text-xs">{ptUrl.label}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeletePtUrl(ptUrl.id)}
                      className="text-red-400 hover:text-red-300 flex-shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {ptUrls.length === 0 && (
              <p className="text-gg-gray-500 text-sm mb-4">No private treaty URLs configured yet.</p>
            )}

            {/* Add new URL */}
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="block text-gg-gray-400 text-xs mb-1">URL</label>
                <input
                  type="url"
                  value={newPtUrl}
                  onChange={(e) => setNewPtUrl(e.target.value)}
                  placeholder="https://example.com/private-treaty-listings"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
              <div className="w-40">
                <label className="block text-gg-gray-400 text-xs mb-1">Label (optional)</label>
                <input
                  type="text"
                  value={newPtLabel}
                  onChange={(e) => setNewPtLabel(e.target.value)}
                  placeholder="e.g. Farm Land"
                  className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm"
                />
              </div>
              <button
                type="button"
                onClick={handleAddPtUrl}
                disabled={addingPtUrl || !newPtUrl.trim()}
                className="flex items-center gap-1 px-4 py-2 bg-gg-pink text-white rounded-lg text-sm hover:bg-gg-pink/80 disabled:opacity-50"
              >
                {addingPtUrl ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
                Add
              </button>
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
