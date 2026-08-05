'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ArrowLeft, Mail } from 'lucide-react'
import { fetchWithAuth } from '@/lib/fetchWithAuth'
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

export default function ExploreReportPage() {
  const router = useRouter()
  const [comparables, setComparables] = useState<Comparable[]>([])
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const stored = sessionStorage.getItem('exploreReport')
    if (stored) {
      try {
        const data = JSON.parse(stored)
        if (data.comparables) {
          setComparables(data.comparables)
        }
      } catch (e) {
        console.error('Failed to parse report data:', e)
      }
    }
  }, [])

  // Calculate averages. The three price-per-X averages are acre-weighted
  // (SUM(sale_price)/SUM(denominator)) per the owner rule — see compAverages.ts.
  const withSoil = comparables.filter(c => c.soil_rating && c.price_per_acre)
  const withTillable = comparables.filter(c => c.tillable_acres && c.total_acres && c.price_per_acre)
  const withAcres = comparables.filter(c => c.total_acres)

  const avgAcres = withAcres.length ? withAcres.reduce((s, c) => s + (toNum(c.total_acres) ?? 0), 0) / withAcres.length : null
  const avgTillable = withTillable.length ? withTillable.reduce((s, c) => s + (toNum(c.tillable_acres) ?? 0), 0) / withTillable.length : null
  const avgSoilRating = withSoil.length ? withSoil.reduce((s, c) => s + (toNum(c.soil_rating) ?? 0), 0) / withSoil.length : null

  const { avgPricePerAcre, avgPricePerTillable, avgPricePerSoil } = computeCompAverages(comparables)

  const handleEmail = async () => {
    setSending(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/comparables/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comparables: comparables.map(c => ({
            county: c.county || '',
            state: c.state || '',
            total_acres: c.total_acres,
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
        }),
      })
      if (!res.ok) {
        alert('Failed to send email')
      } else {
        setSent(true)
      }
    } catch (e) {
      console.error('Email error:', e)
      alert('Failed to send email')
    }
    setSending(false)
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
        <h3 className="text-lg font-semibold mb-3">Selected Sales</h3>
        <div className="space-y-3 mb-6">
          {comparables.map(c => {
            const pctTillable = c.tillable_acres && c.total_acres ? Math.round((c.tillable_acres / c.total_acres) * 100) : null
            const pricePerTillable = c.tillable_acres && c.total_acres && c.price_per_acre
              ? (c.price_per_acre * c.total_acres) / c.tillable_acres : null
            const pricePerSoil = c.soil_rating && c.price_per_acre ? c.price_per_acre / c.soil_rating : null

            return (
              <div key={c.id} className="bg-gg-gray-900 rounded-xl p-4">
                <div className="flex-1">
                  <h4 className="font-semibold">{c.county}, {c.state}</h4>
                  <p className="text-sm text-gg-pink">{fmtDate(c.auction_date)}</p>
                  {c.company_name && <p className="text-sm text-gray-400">{c.company_name}</p>}
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

        {/* Email button */}
        <button
          onClick={handleEmail}
          disabled={sending || sent}
          className="w-full py-3 rounded-xl bg-gg-pink text-white font-semibold flex items-center justify-center gap-2 hover:bg-gg-pink/90 disabled:opacity-50"
        >
          <Mail size={18} />
          {sent ? '✓ Report Sent!' : sending ? 'Sending...' : 'Email Report'}
        </button>
      </div>
    </div>
  )
}
