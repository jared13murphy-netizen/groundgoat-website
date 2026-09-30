'use client'

// Share Ground Goat (owner 2026-09-30): every subscriber's referral code as a
// QR + link, and what they have earned from people who signed up through it.

import { useState, useEffect } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, Copy, Check, Share2 } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.groundgoat.com'

interface Earnings {
  rate: number
  totals: { earned: number; paid_out: number; payout_pending: number; not_yet_bundled: number }
  referred: { user_id: string; name: string; email: string; signed_up_at: string; first_paid_at: string | null; earned: number; status: string }[]
  payouts: { id: string; period_start: string; period_end: string; total: number; status: string; paid_at: string | null; paid_method: string | null }[]
}

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function AccountReferralsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [link, setLink] = useState<{ referral_code: string; referral_url: string; qr_code_url: string } | null>(null)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const me = await fetchWithAuth(`${API_URL}/api/auth/me`)
        if (!me.ok) { router.push('/signin'); return }
        const [l, e] = await Promise.all([
          fetchWithAuth(`${API_URL}/api/referral/my-link`).then(r => r.json()),
          fetchWithAuth(`${API_URL}/api/referral/my-earnings`).then(r => r.ok ? r.json() : null),
        ])
        setLink(l)
        setEarnings(e)
      } finally {
        setLoading(false)
      }
    })()
  }, [router])

  const copy = async () => {
    if (!link) return
    try { await navigator.clipboard.writeText(link.referral_url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }

  const share = async () => {
    if (!link) return
    const data = { title: 'Ground Goat', text: 'Land auctions and sale results, all in one place. Sign up here:', url: link.referral_url }
    if (navigator.share) { try { await navigator.share(data) } catch {} } else { copy() }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  const rate = earnings ? Math.round(earnings.rate * 100) : 35

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-3xl mx-auto px-6">
        <Link href="/account" className="inline-flex items-center gap-2 text-gg-gray-400 hover:text-white mb-6">
          <ArrowLeft size={16} /> Account
        </Link>
        <h1 className="font-display text-4xl font-bold text-white mb-2">Share Ground Goat</h1>
        <p className="text-gg-gray-400 mb-8">
          When someone signs up through your code and pays for a subscription, you earn {rate}% of what they pay for their first year, sent to you monthly.
        </p>

        {link && (
          <div className="card mb-6 flex flex-col md:flex-row items-center gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={link.qr_code_url} alt="Your referral QR code" className="w-44 h-44 rounded-lg bg-white p-2" />
            <div className="flex-1 w-full">
              <p className="text-gg-gray-400 text-sm">Your code</p>
              <p className="font-mono text-2xl text-white mb-3">{link.referral_code}</p>
              <p className="text-gg-gray-400 text-sm">Your link</p>
              <p className="text-white break-all mb-4">{link.referral_url}</p>
              <div className="flex gap-3">
                <button onClick={copy} className="btn-secondary inline-flex items-center gap-2 text-sm">
                  {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy link'}
                </button>
                <button onClick={share} className="btn-primary inline-flex items-center gap-2 text-sm">
                  <Share2 size={14} /> Share
                </button>
              </div>
            </div>
          </div>
        )}

        {earnings && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Stat label="Earned so far" value={money(earnings.totals.earned)} />
              <Stat label="Paid to you" value={money(earnings.totals.paid_out)} />
              <Stat label="Coming this month" value={money(earnings.totals.payout_pending)} highlight />
              <Stat label="Building up" value={money(earnings.totals.not_yet_bundled)} />
            </div>

            <h2 className="text-xl font-semibold text-white mb-3">People you referred ({earnings.referred.length})</h2>
            <div className="card mb-6">
              {earnings.referred.length === 0 ? (
                <p className="text-gg-gray-400 text-sm">Nobody yet. Share your link or show your QR code.</p>
              ) : (
                <ul className="divide-y divide-gg-gray-800">
                  {earnings.referred.map(u => (
                    <li key={u.user_id} className="py-3 flex justify-between items-center">
                      <div>
                        <p className="text-white">{u.name || u.email}</p>
                        <p className="text-gg-gray-500 text-xs">Signed up {u.signed_up_at?.slice(0, 10)} · {u.status.replace('_', ' ')}</p>
                      </div>
                      <p className="text-white font-semibold">{money(u.earned)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {earnings.payouts.length > 0 && (
              <>
                <h2 className="text-xl font-semibold text-white mb-3">Payouts</h2>
                <div className="card">
                  <ul className="divide-y divide-gg-gray-800">
                    {earnings.payouts.map(p => (
                      <li key={p.id} className="py-3 flex justify-between items-center text-sm">
                        <span className="text-gg-gray-300">{p.period_start} → {p.period_end}</span>
                        <span className="text-white">{money(p.total)} <span className="text-gg-gray-500 text-xs ml-2">{p.status === 'paid' ? `paid ${p.paid_at?.slice(0, 10)}${p.paid_method ? ` by ${p.paid_method}` : ''}` : 'on its way'}</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="card">
      <p className="text-gg-gray-400 text-sm">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${highlight ? 'text-gg-pink' : 'text-white'}`}>{value}</p>
    </div>
  )
}
