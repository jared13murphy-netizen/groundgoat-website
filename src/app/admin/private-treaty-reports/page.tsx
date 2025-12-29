'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { 
  ArrowLeft, 
  Clock, 
  AlertTriangle, 
  CheckCircle, 
  XCircle,
  ExternalLink,
  Loader2,
  RefreshCw
} from 'lucide-react'

const API_URL = 'https://practical-serenity-production.up.railway.app'
const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

interface ReportItem {
  listing_id: string
  title: string
  county: string
  state: string
  url: string
  detected_status: string
  confidence: string
  evidence: string
}

interface Report {
  id: string
  run_time: string
  total_checked: number
  needs_update_count: number
  needs_update: ReportItem[]
  created_at: string
}

export default function PrivateTreatyReportsPage() {
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
    fetchReports(token)
  }, [router])

  const fetchReports = async (token: string) => {
    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/api/admin/private-treaty-reports`, {
        headers: { 'Authorization': `Bearer ${token}` },
      })

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

  const runCheckNow = async () => {
    setRunning(true)
    try {
      const response = await fetch(`${SCRAPER_URL}/api/cron/private-treaty-check`, {
        method: 'POST',
      })
      
      if (response.ok) {
        // Wait a moment then refresh reports
        setTimeout(() => {
          const token = localStorage.getItem('auth_token')
          if (token) fetchReports(token)
        }, 2000)
      }
    } catch (err) {
      console.error('Failed to run check:', err)
    } finally {
      setRunning(false)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'SOLD':
        return <CheckCircle className="text-green-500" size={20} />
      case 'PENDING':
        return <Clock className="text-yellow-500" size={20} />
      case 'REMOVED':
      case 'FETCH_ERROR':
        return <XCircle className="text-red-500" size={20} />
      default:
        return <AlertTriangle className="text-orange-500" size={20} />
    }
  }

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      'SOLD': 'bg-green-500/20 text-green-400 border-green-500/30',
      'PENDING': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      'REMOVED': 'bg-red-500/20 text-red-400 border-red-500/30',
      'FETCH_ERROR': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    }
    return colors[status] || 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
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
            <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white">
              <ArrowLeft size={24} />
            </Link>
            <div>
              <h1 className="font-display text-4xl font-bold text-white">Private Treaty Reports</h1>
              <p className="text-gg-gray-400">Daily status checks for private treaty listings</p>
            </div>
          </div>
          <button
            onClick={runCheckNow}
            disabled={running}
            className="flex items-center gap-2 px-4 py-2 bg-gg-pink hover:bg-gg-pink-dark text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {running ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <RefreshCw size={18} />
            )}
            {running ? 'Running...' : 'Run Check Now'}
          </button>
        </div>

        {reports.length === 0 ? (
          <div className="card text-center py-12">
            <Clock className="mx-auto text-gg-gray-500 mb-4" size={48} />
            <h3 className="text-xl font-semibold text-white mb-2">No Reports Yet</h3>
            <p className="text-gg-gray-400 mb-6">
              Run a status check to generate your first report
            </p>
            <button
              onClick={runCheckNow}
              disabled={running}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gg-pink hover:bg-gg-pink-dark text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {running ? <Loader2 className="animate-spin" size={18} /> : <RefreshCw size={18} />}
              {running ? 'Running...' : 'Run First Check'}
            </button>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Report List */}
            <div className="lg:col-span-1">
              <div className="card">
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
                        <span className="text-white text-sm font-medium">
                          {formatDate(report.run_time)}
                        </span>
                        {report.needs_update_count > 0 && (
                          <span className="bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full">
                            {report.needs_update_count} updates
                          </span>
                        )}
                      </div>
                      <div className="text-gg-gray-400 text-xs">
                        Checked {report.total_checked} listings
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Report Details */}
            <div className="lg:col-span-2">
              {selectedReport && (
                <div className="card">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="font-semibold text-white text-lg">
                        Report: {formatDate(selectedReport.run_time)}
                      </h3>
                      <p className="text-gg-gray-400 text-sm">
                        {selectedReport.total_checked} listings checked • {selectedReport.needs_update_count} need attention
                      </p>
                    </div>
                  </div>

                  {selectedReport.needs_update_count === 0 ? (
                    <div className="text-center py-8">
                      <CheckCircle className="mx-auto text-green-500 mb-4" size={48} />
                      <h4 className="text-lg font-semibold text-white mb-2">All Clear!</h4>
                      <p className="text-gg-gray-400">
                        No listings need updates from this check
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedReport.needs_update.map((item, index) => (
                        <div
                          key={index}
                          className="bg-gg-gray-800 rounded-lg p-4 border border-gg-gray-700"
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-3">
                              {getStatusIcon(item.detected_status)}
                              <div>
                                <h4 className="text-white font-medium">
                                  {item.county} County, {item.state}
                                </h4>
                                <span className={`inline-block mt-1 text-xs px-2 py-0.5 rounded border ${getStatusBadge(item.detected_status)}`}>
                                  {item.detected_status} • {item.confidence} confidence
                                </span>
                              </div>
                            </div>
                            
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gg-pink hover:text-gg-pink-light"
                            >
                              <ExternalLink size={18} />
                            </a>
                          </div>
                          
                          {item.evidence && (
                            <p className="text-gg-gray-400 text-sm mb-3">
                              <span className="text-gg-gray-500">Evidence:</span> {item.evidence}
                            </p>
                          )}
                          
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-gg-gray-500">
                              ID: {item.listing_id}
                            </span>
                            <Link
                              href={`/admin/listings?id=${item.listing_id}`}
                              className="text-gg-pink hover:underline"
                            >
                              Edit Listing →
                            </Link>
                          </div>
                        </div>
                      ))}
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
