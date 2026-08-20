'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Mail, Download, Loader2 } from 'lucide-react'
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import reportJobFetch from '@/lib/reportJobs'
import { formatAcres, toNum } from '@/lib/format'
import { computeCompAverages } from '@/lib/compAverages'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

interface Comparable {
  id: string
  county: string
  state: string
  total_acres: number | null
  tillable_acres: number | null
  soil_rating: number | null
  price_per_acre: number | null
  sale_price: number | null
  auction_date: string | null
  company_name: string | null
  image_url?: string | null
}

function fmt(n: number | null | undefined): string {
  if (!n) return '—'
  return '$' + Math.round(n).toLocaleString()
}

function fmtNum(n: number | null | undefined, decimals = 1): string {
  if (!n) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ComparablesReportPage({ params }: { params: { id: string } }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [comparables, setComparables] = useState<Comparable[]>([])
  const [subject, setSubject] = useState<any>(null)
  const [sending, setSending] = useState(false)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    // Read from sessionStorage (set by comparables page)
    const stored = sessionStorage.getItem('comparablesReport')
    if (stored) {
      try {
        const data = JSON.parse(stored)
        if (data.subject) {
          const s = data.subject
          setSubject({
            ...s.tract,
            county: s.listing?.county,
            state: s.listing?.state,
            company_name: s.listing?.company_name,
            auction_datetime: s.listing?.auction_datetime,
          })
        }
        if (data.comparables) {
          setComparables(data.comparables)
        }
      } catch (e) {
        console.error('Failed to parse report data:', e)
      }
      return
    }

    // Fallback: fetch from API if no sessionStorage data
    const tractId = searchParams.get('tractId')
    if (!tractId) return

    fetchWithAuth(`${API_URL}/api/listings/${params.id}`).then(res => res.json()).then(data => {
      const tract = data.tracts?.find((t: any) => t.id === tractId)
      if (tract) {
        setSubject({ ...tract, county: data.county, state: data.state, company_name: data.company_name, auction_datetime: data.auction_datetime })
      }
    })
  }, [params.id, searchParams])

  // Calculate averages. Note: avgTillable averages tillable acreage across
  // every comp that reports it — it must NOT be filtered by price, since
  // tillable acreage is independent of whether we have a sale price. The
  // three price-per-X averages are acre-weighted (SUM(sale_price)/SUM(denominator))
  // per the owner rule — see compAverages.ts.
  const withSoil = comparables.filter(c => c.soil_rating && c.price_per_acre)
  const withTillable = comparables.filter(c => c.tillable_acres)
  const withAcres = comparables.filter(c => c.total_acres)

  const avgAcres = withAcres.length ? withAcres.reduce((s, c) => s + (toNum(c.total_acres) ?? 0), 0) / withAcres.length : null
  const avgTillable = withTillable.length ? withTillable.reduce((s, c) => s + (toNum(c.tillable_acres) ?? 0), 0) / withTillable.length : null
  const avgSoilRating = withSoil.length ? withSoil.reduce((s, c) => s + (toNum(c.soil_rating) ?? 0), 0) / withSoil.length : null

  const { avgPricePerAcre, avgPricePerTillable, avgPricePerSoil } = computeCompAverages(comparables)

  // Build the request body shared by the email + download endpoints.
  const buildReportBody = () => ({
    listing_id: params.id,
    tract_id: subject?.id || null,
    subject_county: subject?.county || null,
    subject_state: subject?.state || null,
    subject_acres: subject?.total_acres ? String(subject.total_acres) : null,
    subject_tillable_pct: subject?.tillable_acres && subject?.total_acres
      ? String(Math.round((subject.tillable_acres / subject.total_acres) * 100)) + '%'
      : null,
    subject_soil_rating: subject?.soil_rating ? String(subject.soil_rating) : null,
    subject_auction_date: subject?.auction_datetime || null,
    subject_company: subject?.company_name || null,
    comparables: comparables.map(c => ({
      tract_id: c.id,
      county: c.county || '',
      state: c.state || '',
      total_acres: c.total_acres,
      tillable_acres: c.tillable_acres,
      pct_tillable: c.tillable_acres && c.total_acres ? Math.round((c.tillable_acres / c.total_acres) * 100) : null,
      soil_rating: c.soil_rating,
      price_per_acre: c.price_per_acre,
      price_per_tillable_acre: c.tillable_acres && c.total_acres && c.price_per_acre && c.tillable_acres > 0
        ? (c.price_per_acre * c.total_acres) / c.tillable_acres : null,
      price_per_soil_rating: c.soil_rating && c.price_per_acre && c.soil_rating > 0
        ? c.price_per_acre / c.soil_rating : null,
      sale_price: c.sale_price,
      auction_date: c.auction_date,
      company_name: c.company_name,
    })),
  })

  const handleEmail = async () => {
    setSending(true)
    try {
      const res = await reportJobFetch('comparables', 'email', buildReportBody())
      if (!res.ok) {
        const errText = await res.text()
        console.error('Email API error:', res.status, errText)
        alert(`Failed to send email: ${res.status}`)
      } else {
        alert('Report sent to your email!')
      }
    } catch (e) {
      console.error('Email error:', e)
      alert('Failed to send email: ' + (e instanceof Error ? e.message : 'unknown error'))
    }
    setSending(false)
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await reportJobFetch('comparables', 'download', buildReportBody())
      if (!res.ok) {
        alert(`Failed to generate PDF: ${res.status}`)
        return
      }
      const blob = await res.blob()
      const dispo = res.headers.get('Content-Disposition') || ''
      const match = dispo.match(/filename="?([^";]+)"?/i)
      const filename = match?.[1] || 'ground-goat-comp-report.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Download error:', e)
      alert('Failed to generate PDF: ' + (e instanceof Error ? e.message : 'unknown error'))
    }
    setDownloading(false)
  }

  return (
    <div className="min-h-screen bg-gg-black text-white pt-28">
      <div className="max-w-3xl mx-auto px-4 pb-12">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => router.back()} className="text-gray-400 hover:text-white">
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-display font-bold">Comp Report</h1>
        </div>

        {/* Subject Tract */}
        {subject && (
          <div className="bg-gg-gray-900 rounded-xl p-4 mb-6 border-l-4 border-gg-pink">
            <p className="text-sm text-gray-400 mb-1">Subject Tract</p>
            <h2 className="text-xl font-bold">{subject.county}, {subject.state}</h2>
            <div className="flex gap-6 mt-2 text-sm">
              <div><span className="text-lg font-bold">{formatAcres(subject.total_acres)}</span><br /><span className="text-gray-400">Acres</span></div>
              <div><span className="text-lg font-bold">{subject.tillable_acres && subject.total_acres ? Math.round((subject.tillable_acres / subject.total_acres) * 100) + '%' : '—'}</span><br /><span className="text-gray-400">Tillable</span></div>
              <div><span className="text-lg font-bold">{fmtNum(subject.soil_rating)}</span><br /><span className="text-gray-400">Soil Rating</span></div>
            </div>
            {subject.auction_datetime && (
              <p className="text-sm text-gray-400 mt-2">{fmtDate(subject.auction_datetime)} · {subject.company_name}</p>
            )}
          </div>
        )}

        {/* Summary */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold mb-3">
            Summary <span className="text-sm font-normal text-gg-pink ml-2">{comparables.length} sales</span>
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Avg $/Acre</p>
              <p className="text-xl font-bold text-gg-pink">{fmt(avgPricePerAcre)}</p>
            </div>
            <div className="bg-gg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Avg $/Tillable Acre</p>
              <p className="text-xl font-bold text-gg-pink">{fmt(avgPricePerTillable)}</p>
            </div>
            <div className="bg-gg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Avg $/Soil Rating</p>
              <p className="text-xl font-bold text-gg-pink">{fmt(avgPricePerSoil)}</p>
            </div>
            <div className="bg-gg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Avg Acres</p>
              <p className="text-xl font-bold">{formatAcres(avgAcres)}</p>
            </div>
            <div className="bg-gg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Avg Tillable Acres</p>
              <p className="text-xl font-bold">{formatAcres(avgTillable)}</p>
            </div>
            <div className="bg-gg-gray-900 rounded-lg p-3">
              <p className="text-xs text-gray-400 uppercase">Avg Soil Rating</p>
              <p className="text-xl font-bold">{fmtNum(avgSoilRating)}</p>
            </div>
          </div>
        </div>

        {/* Comparable Sales */}
        <h3 className="text-lg font-semibold mb-3">Comparable Sales</h3>
        <div className="space-y-3 mb-6">
          {comparables.map(c => {
            const pctTillable = c.tillable_acres && c.total_acres ? Math.round((c.tillable_acres / c.total_acres) * 100) : null
            const pricePerTillable = c.tillable_acres && c.total_acres && c.price_per_acre
              ? (c.price_per_acre * c.total_acres) / c.tillable_acres : null
            const pricePerSoil = c.soil_rating && c.price_per_acre ? c.price_per_acre / c.soil_rating : null

            return (
              <div key={c.id} className="bg-gg-gray-900 rounded-xl p-4">
                <div className="flex gap-3">
                  {c.image_url && (
                    <img
                      src={c.image_url}
                      alt=""
                      className="w-20 h-20 rounded-lg object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex-1">
                    <h4 className="font-semibold">{c.county}, {c.state}</h4>
                    <p className="text-sm text-gg-pink">{fmtDate(c.auction_date)}</p>
                    <p className="text-sm text-gray-400">{c.company_name}</p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 mt-3 text-center text-sm">
                  <div><span className="font-bold">{formatAcres(c.total_acres)}</span><br /><span className="text-xs text-gray-400">Acres</span></div>
                  <div><span className="font-bold">{fmt(c.price_per_acre)}</span><br /><span className="text-xs text-gray-400">$/Acre</span></div>
                  <div><span className="font-bold">{pctTillable ? pctTillable + '%' : '—'}</span><br /><span className="text-xs text-gray-400">% Tillable</span></div>
                  <div><span className="font-bold">{fmtNum(c.soil_rating)}</span><br /><span className="text-xs text-gray-400">Soil Rating</span></div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-center text-sm">
                  <div><span className="font-bold">{fmt(pricePerTillable)}</span><br /><span className="text-xs text-gray-400">$/Till. Acre</span></div>
                  <div><span className="font-bold">{fmt(pricePerSoil)}</span><br /><span className="text-xs text-gray-400">$/Soil Rating</span></div>
                  <div><span className="font-bold">{fmt(c.sale_price)}</span><br /><span className="text-xs text-gray-400">Sale Price</span></div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Action buttons. Download is web-only; Email works for both web
            and mobile and produces the same PDF attachment. */}
        <div className="flex gap-3">
          <button
            onClick={handleDownload}
            disabled={downloading || sending}
            className="flex-1 py-3 rounded-xl bg-white/10 border border-white/15 text-white font-semibold flex items-center justify-center gap-2 hover:bg-white/15 disabled:opacity-50"
          >
            {downloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            {downloading ? 'Building PDF...' : 'Download PDF'}
          </button>
          <button
            onClick={handleEmail}
            disabled={sending || downloading}
            className="flex-1 py-3 rounded-xl bg-gg-pink text-white font-semibold flex items-center justify-center gap-2 hover:bg-gg-pink/90 disabled:opacity-50"
          >
            <Mail size={18} />
            {sending ? 'Sending...' : 'Email Report'}
          </button>
        </div>
      </div>
    </div>
  )
}
