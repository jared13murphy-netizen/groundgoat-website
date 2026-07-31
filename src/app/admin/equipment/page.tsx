'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth, { fetchScraperProxy } from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Tractor,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Pencil,
  Download,
  Trash2,
  Filter
} from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const SCRAPER_PROXY = '/api/scraper-proxy'

interface EquipmentItem {
  id: number
  title: string
  year: number | null
  make: string | null
  model: string | null
  category: string
  sale_price: number | null
  sale_date: string | null
  sale_month: number | null
  sale_year: number | null
  city: string | null
  state: string | null
  lot_number: string | null
  image_url: string | null
  auction_company: string
}

const CATEGORIES = ['Ag Equipment', 'Transportation', 'Construction Equipment', 'Other']
const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
]

export default function EquipmentPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [equipment, setEquipment] = useState<EquipmentItem[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editCategory, setEditCategory] = useState('')
  const [saving, setSaving] = useState(false)

  // Filters
  const [filterCategory, setFilterCategory] = useState<string>('')
  const [filterMonth, setFilterMonth] = useState<number | ''>('')
  const [filterYear, setFilterYear] = useState<number | ''>('')

  const ITEMS_PER_PAGE = 50

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    checkAuth()
  }, [router])

  useEffect(() => {
    if (!loading) {
      fetchEquipment()
    }
  }, [offset, filterCategory, filterMonth, filterYear])

  const checkAuth = async () => {
    try {
      const response = await fetchWithAuth(API_URL + '/api/auth/me')
      if (!response.ok) throw new Error('Not authenticated')
      const userData = await response.json()
      if (userData.account_type !== 'groundgoat_admin') {
        router.push('/account')
        return
      }
      setLoading(false)
      fetchEquipment()
    } catch (err) {
      router.push('/signin')
    }
  }

  const fetchEquipment = async () => {
    try {
      let path = `/api/equipment?limit=${ITEMS_PER_PAGE}&offset=${offset}`
      if (filterCategory) path += `&category=${encodeURIComponent(filterCategory)}`
      if (filterMonth) path += `&sale_month=${filterMonth}`
      if (filterYear) path += `&sale_year=${filterYear}`

      const response = await fetchScraperProxy(path)
      if (response.ok) {
        const data = await response.json()
        setEquipment(data.sales || [])
        setTotalCount(data.total_count || 0)
      }
    } catch (err) {
      console.error('Failed to fetch equipment:', err)
    }
  }

  const startEdit = (item: EquipmentItem) => {
    setEditingId(item.id)
    setEditCategory(item.category)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditCategory('')
  }

  const saveCategory = async (id: number) => {
    setSaving(true)
    try {
      const response = await fetchScraperProxy(`/api/equipment/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: editCategory })
      })

      if (response.ok) {
        setEquipment(prev =>
          prev.map(item =>
            item.id === id ? { ...item, category: editCategory } : item
          )
        )
        setEditingId(null)
      }
    } catch (err) {
      console.error('Failed to update category:', err)
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async (id: number) => {
    if (!confirm('Delete this item?')) return

    try {
      const response = await fetchScraperProxy(`/api/equipment/${id}`, {
        method: 'DELETE'
      })
      if (response.ok) {
        setEquipment(prev => prev.filter(item => item.id !== id))
        setTotalCount(prev => prev - 1)
      }
    } catch (err) {
      console.error('Failed to delete:', err)
    }
  }

  const exportToExcel = async () => {
    try {
      const res = await fetchScraperProxy(`/api/equipment/export`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('content-disposition')
      const match = cd && cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
      a.download = match ? match[1].replace(/['"]/g, '') : 'equipment-export.xlsx'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
    }
  }

  const clearFilters = () => {
    setFilterCategory('')
    setFilterMonth('')
    setFilterYear('')
    setOffset(0)
  }

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE)
  const currentPage = Math.floor(offset / ITEMS_PER_PAGE) + 1

  // Generate year options (last 10 years)
  const currentYear = new Date().getFullYear()
  const yearOptions = Array.from({ length: 10 }, (_, i) => currentYear - i)

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white transition-colors">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white flex items-center gap-3">
                <Tractor className="text-gg-pink" />
                Equipment Manager
              </h1>
              <p className="text-gg-gray-400">View and edit equipment items ({totalCount} total)</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Link
              href="/admin/equipment-scraper"
              className="flex items-center gap-2 bg-gg-pink text-black font-semibold px-4 py-2 rounded-lg hover:bg-gg-pink/90 transition-colors"
            >
              <Tractor size={18} />
              Scraper
            </Link>
            <button
              onClick={exportToExcel}
              className="flex items-center gap-2 bg-gg-gray-800 text-white px-4 py-2 rounded-lg hover:bg-gg-gray-700 transition-colors"
            >
              <Download size={18} />
              Export
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-gg-gray-900 rounded-xl p-4 border border-gg-gray-800 mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-gg-gray-400">
              <Filter size={18} />
              <span className="text-sm font-medium">Filters:</span>
            </div>

            <select
              value={filterCategory}
              onChange={(e) => { setFilterCategory(e.target.value); setOffset(0) }}
              className="bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-gg-pink"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            <select
              value={filterMonth}
              onChange={(e) => { setFilterMonth(e.target.value ? Number(e.target.value) : ''); setOffset(0) }}
              className="bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-gg-pink"
            >
              <option value="">All Months</option>
              {MONTHS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>

            <select
              value={filterYear}
              onChange={(e) => { setFilterYear(e.target.value ? Number(e.target.value) : ''); setOffset(0) }}
              className="bg-gg-gray-800 border border-gg-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-gg-pink"
            >
              <option value="">All Years</option>
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>

            {(filterCategory || filterMonth || filterYear) && (
              <button
                onClick={clearFilters}
                className="text-gg-gray-400 hover:text-white text-sm underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>

        {/* Equipment Table */}
        <div className="bg-gg-gray-900 rounded-xl border border-gg-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gg-gray-800 text-left">
                <tr>
                  <th className="px-4 py-3 text-sm font-medium text-gg-gray-300">Item</th>
                  <th className="px-4 py-3 text-sm font-medium text-gg-gray-300">Year</th>
                  <th className="px-4 py-3 text-sm font-medium text-gg-gray-300">Make</th>
                  <th className="px-4 py-3 text-sm font-medium text-gg-gray-300">Category</th>
                  <th className="px-4 py-3 text-sm font-medium text-gg-gray-300">Sale Price</th>
                  <th className="px-4 py-3 text-sm font-medium text-gg-gray-300">Sale Date</th>
                  <th className="px-4 py-3 text-sm font-medium text-gg-gray-300">Location</th>
                  <th className="px-4 py-3 text-sm font-medium text-gg-gray-300 w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gg-gray-800">
                {equipment.map(item => (
                  <tr key={item.id} className="hover:bg-gg-gray-800/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {item.image_url && (
                          <img
                            src={item.image_url}
                            alt={item.title}
                            className="w-12 h-12 object-cover rounded flex-shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <div className="text-white text-sm font-medium truncate max-w-xs">
                            {item.title}
                          </div>
                          {item.lot_number && (
                            <div className="text-gg-gray-500 text-xs">Lot #{item.lot_number}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gg-pink text-sm">{item.year || '-'}</td>
                    <td className="px-4 py-3 text-white text-sm">{item.make || '-'}</td>
                    <td className="px-4 py-3">
                      {editingId === item.id ? (
                        <div className="flex items-center gap-2">
                          <select
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            className="bg-gg-gray-800 border border-gg-pink rounded px-2 py-1 text-white text-sm focus:outline-none"
                            autoFocus
                          >
                            {CATEGORIES.map(cat => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                          <button
                            onClick={() => saveCategory(item.id)}
                            disabled={saving}
                            className="text-green-400 hover:text-green-300 p-1"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-red-400 hover:text-red-300 p-1"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                          item.category === 'Ag Equipment' ? 'bg-green-500/20 text-green-400' :
                          item.category === 'Transportation' ? 'bg-blue-500/20 text-blue-400' :
                          item.category === 'Construction Equipment' ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-gg-gray-700 text-gg-gray-300'
                        }`}>
                          {item.category}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-green-400 text-sm font-medium">
                      {item.sale_price ? `$${item.sale_price.toLocaleString()}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-gg-gray-300 text-sm">
                      {item.sale_month && item.sale_year
                        ? `${MONTHS.find(m => m.value === item.sale_month)?.label?.slice(0, 3)} ${item.sale_year}`
                        : item.sale_date || '-'}
                    </td>
                    <td className="px-4 py-3 text-gg-gray-400 text-sm">
                      {item.city && item.state ? `${item.city}, ${item.state}` : item.state || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {editingId !== item.id && (
                          <button
                            onClick={() => startEdit(item)}
                            className="text-gg-gray-400 hover:text-gg-pink p-1 transition-colors"
                            title="Edit category"
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteItem(item.id)}
                          className="text-gg-gray-400 hover:text-red-400 p-1 transition-colors"
                          title="Delete item"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {equipment.length === 0 && (
            <div className="p-12 text-center">
              <Tractor size={48} className="mx-auto text-gg-gray-600 mb-4" />
              <h3 className="text-lg font-semibold text-white mb-2">No Equipment Found</h3>
              <p className="text-gg-gray-400">
                {filterCategory || filterMonth || filterYear
                  ? 'No items match your filters.'
                  : 'Run the scraper to fetch equipment auction results.'}
              </p>
            </div>
          )}

          {/* Pagination */}
          {totalCount > ITEMS_PER_PAGE && (
            <div className="px-4 py-3 border-t border-gg-gray-800 flex items-center justify-between">
              <div className="text-sm text-gg-gray-400">
                Showing {offset + 1}-{Math.min(offset + ITEMS_PER_PAGE, totalCount)} of {totalCount}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - ITEMS_PER_PAGE))}
                  disabled={offset === 0}
                  className="p-2 rounded bg-gg-gray-800 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gg-gray-700 transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <span className="text-white text-sm px-3">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setOffset(offset + ITEMS_PER_PAGE)}
                  disabled={offset + ITEMS_PER_PAGE >= totalCount}
                  className="p-2 rounded bg-gg-gray-800 text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gg-gray-700 transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
