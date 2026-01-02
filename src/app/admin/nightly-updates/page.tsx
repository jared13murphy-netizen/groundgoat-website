'use client'

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Clock,
  DollarSign,
  ArrowRightLeft,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Loader2,
  TrendingDown,
  Ban,
  Play
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Change {
  field: string
  old_value: string
  new_value: string
  requires_review?: boolean
}

interface UpdateItem {
  listing_id: string
  county: string
  state: string
  source_url: string
  changes: Change[]
  confidence: string
  evidence: string
  updated_at: string
}

interface ErrorItem {
  listing_id: string
  county: string
  state: string
  source_url: string
  error: string
}

interface Report {
  id: string
  run_time: string
  total_checked: number
  total_updated: number
  price_changes: number
  status_to_pending: number
  status_to_sold: number
  listings_removed: number
  errors: number
  updates: UpdateItem[]
  errors_list: ErrorItem[]
  created_at: string
}

export default function NightlyUpdatesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [reports, setReports] = useState<Report[]>([])
  const [selectedReport, setSelectedReport] = useState<Report | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) {
      router.push('/signin')
      return
    }
    fetchReports()
  }, [router])

  const fetchReports = async () => {
    setLoading(true)
    try {
      const response = await fetchWithAuth(API_URL + '/api/admin/private-treaty-update-reports')

      if (response.ok) {
        const data = await response.json()
        setReports(data)
        if (data.length > 0) {
          setSelectedReport(data[0])
        }
      }
    } catch (err) {
      console.error('Failed to fetch reports:', err)
    } finally {
      setLoading(false)
    }
  }

  const runNightlyMonitor = async () => {
    setRunning(true)
    try {
      const response = await fetchWithAuth(API_URL + '/api/admin/run-nightly-monitor', {
        method: 'POST'
      })

      if (response.ok) {
        // Refresh reports after successful run
        await fetchReports()
      } else {
        const error = await response.json()
        alert(`Failed to run monitor: ${error.detail || 'Unknown error'}`)
      }
    } catch (err: any) {
      console.error('Failed to run nightly monitor:', err)
      alert(`Failed to run nightly monitor: ${err?.message || 'Network error or timeout'}`)
    } finally {
      setRunning(false)
    }
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  const getChangeIcon = (field: string, change: Change) => {
    if (change.requires_review) {
      return <AlertTriangle size={16} className="text-yellow-400" />
    }
    if (field === 'asking_price') {
      return <DollarSign size={16} className="text-blue-400" />
    }
    if (field === 'status') {
      if (change.new_value === 'sold') {
        return <CheckCircle size={16} className="text-green-400" />
      }
      if (change.new_value === 'pending') {
        return <Clock size={16} className="text-yellow-400" />
      }
    }
    return <ArrowRightLeft size={16} className="text-gg-gray-400" />
  }

  const formatChange = (change: Change) => {
    if (change.field === 'asking_price') {
      const oldPrice = parseFloat(change.old_value)
      const newPrice = parseFloat(change.new_value)
      const diff = newPrice - oldPrice
      const pctChange = ((diff / oldPrice) * 100).toFixed(1)
      const isDecrease = diff < 0

      return (
        <div className="flex items-center gap-2">
          <span className="text-gg-gray-400">${oldPrice.toLocaleString()}</span>
          <span className="text-gg-gray-500">→</span>
          <span className={isDecrease ? 'text-red-400' : 'text-green-400'}>
            ${newPrice.toLocaleString()}
          </span>
          <span className={`text-xs ${isDecrease ? 'text-red-400' : 'text-green-400'}`}>
            ({isDecrease ? '' : '+'}{pctChange}%)
          </span>
        </div>
      )
    }

    if (change.field === 'status') {
      return (
        <div className="flex items-center gap-2">
          <span className="text-gg-gray-400 capitalize">{change.old_value}</span>
          <span className="text-gg-gray-500">→</span>
          <span className={
            change.new_value === 'sold' ? 'text-green-400' :
            change.new_value === 'pending' ? 'text-yellow-400' :
            change.requires_review ? 'text-yellow-400' :
            'text-white'
          }>
            {change.requires_review ? 'REMOVED (needs review)' : change.new_value}
          </span>
        </div>
      )
    }

    return (
      <div className="flex items-center gap-2">
        <span className="text-gg-gray-400">{change.old_value}</span>
        <span className="text-gg-gray-500">→</span>
        <span className="text-white">{change.new_value}</span>
      </div>
    )
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
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white transition-colors">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-3xl font-bold text-white">Nightly Updates</h1>
              <p className="text-gg-gray-400">Private treaty price & status monitoring</p>
            </div>
          </div>
          <button
            onClick={runNightlyMonitor}
            disabled={running}
            className="flex items-center gap-2 bg-gg-pink text-black font-semibold px-4 py-2 rounded-lg hover:bg-gg-pink/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {running ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                Running...
              </>
            ) : (
              <>
                <Play size={18} />
                Run Now
              </>
            )}
          </button>
        </div>

        {reports.length === 0 ? (
          <div className="bg-gg-gray-900 rounded-xl p-12 text-center border border-gg-gray-800">
            <Clock size={48} className="mx-auto text-gg-gray-600 mb-4" />
            <h2 className="text-xl font-semibold text-white mb-2">No Reports Yet</h2>
            <p className="text-gg-gray-400">
              The nightly monitor runs at 3:00 AM CST. Reports will appear here after the first run.
            </p>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Reports List */}
            <div className="lg:col-span-1">
              <div className="bg-gg-gray-900 rounded-xl p-4 border border-gg-gray-800">
                <h3 className="font-semibold text-white mb-4">Report History</h3>
                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {reports.map((report) => (
                    <button
                      key={report.id}
                      onClick={() => setSelectedReport(report)}
                      className={`w-full text-left p-3 rounded-lg transition-colors ${
                        selectedReport?.id === report.id
                          ? 'bg-gg-pink/20 border border-gg-pink/50'
                          : 'bg-gg-gray-800 hover:bg-gg-gray-700 border border-transparent'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-white font-medium text-sm">
                          {formatDate(report.run_time)}
                        </span>
                        {report.total_updated > 0 && (
                          <span className="text-xs bg-gg-pink/20 text-gg-pink px-2 py-0.5 rounded-full">
                            {report.total_updated} updated
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gg-gray-400">
                        <span>{report.total_checked} checked</span>
                        {report.price_changes > 0 && (
                          <span className="text-blue-400">{report.price_changes} price</span>
                        )}
                        {report.status_to_sold > 0 && (
                          <span className="text-green-400">{report.status_to_sold} sold</span>
                        )}
                        {report.listings_removed > 0 && (
                          <span className="text-yellow-400">{report.listings_removed} removed</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Report Details */}
            <div className="lg:col-span-2">
              {selectedReport && (
                <div className="space-y-6">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gg-gray-900 rounded-xl p-4 border border-gg-gray-800">
                      <div className="text-2xl font-bold text-white">{selectedReport.total_checked}</div>
                      <div className="text-sm text-gg-gray-400">Listings Checked</div>
                    </div>
                    <div className="bg-gg-gray-900 rounded-xl p-4 border border-blue-500/30">
                      <div className="text-2xl font-bold text-blue-400">{selectedReport.price_changes}</div>
                      <div className="text-sm text-gg-gray-400">Price Changes</div>
                    </div>
                    <div className="bg-gg-gray-900 rounded-xl p-4 border border-green-500/30">
                      <div className="text-2xl font-bold text-green-400">
                        {selectedReport.status_to_pending + selectedReport.status_to_sold}
                      </div>
                      <div className="text-sm text-gg-gray-400">Status Changes</div>
                    </div>
                    <div className="bg-gg-gray-900 rounded-xl p-4 border border-yellow-500/30">
                      <div className="text-2xl font-bold text-yellow-400">{selectedReport.listings_removed}</div>
                      <div className="text-sm text-gg-gray-400">Removed (Review)</div>
                    </div>
                  </div>

                  {/* Updates List */}
                  {selectedReport.updates.length > 0 ? (
                    <div className="bg-gg-gray-900 rounded-xl p-6 border border-gg-gray-800">
                      <h3 className="font-semibold text-white mb-4">
                        Updates Made ({selectedReport.updates.length})
                      </h3>
                      <div className="space-y-4">
                        {selectedReport.updates.map((item, idx) => (
                          <div
                            key={idx}
                            className={`bg-gg-gray-800 rounded-lg p-4 border ${
                              item.changes.some(c => c.requires_review)
                                ? 'border-yellow-500/50'
                                : 'border-gg-gray-700'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h4 className="text-white font-medium">
                                  {item.county} County, {item.state}
                                </h4>
                                <div className="flex items-center gap-2 mt-1">
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                                    item.confidence === 'high'
                                      ? 'bg-green-500/20 text-green-400'
                                      : item.confidence === 'medium'
                                        ? 'bg-yellow-500/20 text-yellow-400'
                                        : 'bg-red-500/20 text-red-400'
                                  }`}>
                                    {item.confidence} confidence
                                  </span>
                                </div>
                              </div>
                              <a
                                href={item.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gg-gray-400 hover:text-gg-pink transition-colors"
                              >
                                <ExternalLink size={18} />
                              </a>
                            </div>

                            <div className="space-y-2">
                              {item.changes.map((change, cidx) => (
                                <div key={cidx} className="flex items-center gap-3">
                                  {getChangeIcon(change.field, change)}
                                  <span className="text-sm text-gg-gray-400 capitalize w-24">
                                    {change.field.replace('_', ' ')}:
                                  </span>
                                  {formatChange(change)}
                                </div>
                              ))}
                            </div>

                            {item.evidence && (
                              <p className="text-gg-gray-500 text-sm mt-3 italic">
                                &quot;{item.evidence}&quot;
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="bg-gg-gray-900 rounded-xl p-8 text-center border border-gg-gray-800">
                      <CheckCircle size={32} className="mx-auto text-green-400 mb-3" />
                      <h3 className="text-lg font-semibold text-white mb-1">No Updates Needed</h3>
                      <p className="text-gg-gray-400 text-sm">
                        All {selectedReport.total_checked} listings checked - no changes detected.
                      </p>
                    </div>
                  )}

                  {/* Errors */}
                  {selectedReport.errors_list && selectedReport.errors_list.length > 0 && (
                    <div className="bg-gg-gray-900 rounded-xl p-6 border border-red-500/30">
                      <h3 className="font-semibold text-red-400 mb-4">
                        Errors ({selectedReport.errors_list.length})
                      </h3>
                      <div className="space-y-3">
                        {selectedReport.errors_list.map((item, idx) => (
                          <div key={idx} className="bg-gg-gray-800 rounded-lg p-3 flex items-center justify-between">
                            <div>
                              <span className="text-white text-sm">
                                {item.county} County, {item.state}
                              </span>
                              <p className="text-red-400 text-xs mt-1">{item.error}</p>
                            </div>
                            <a
                              href={item.source_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gg-gray-400 hover:text-gg-pink"
                            >
                              <ExternalLink size={16} />
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
