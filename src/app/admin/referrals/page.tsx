'use client'

// Referral payouts (owner 2026-09-30). Subscribers earn a share (default
// 35%, per-person up to 50%) of money Ground Goat actually receives from
// people who signed up through their code — first year only, never during a
// trial. This page is the money trail: who referred whom, what was
// collected, what was earned, what has been paid, and the per-person rate.

import { useState, useEffect, useCallback } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, DollarSign, Users, RefreshCw, Check, ChevronDown, ChevronUp } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.groundgoat.com'

interface Referrer {
  user_id: string
  email: string
  name: string
  referral_code: string
  rate: number
  rate_is_override: boolean
  payouts_enabled: boolean
  referred_count: number
  paying_count: number
  gross_collected: number
  earned: number
  paid_out: number
  payout_pending: number
  unpaid: number
}

interface Payout {
  id: string
  referrer_id: string
  email: string
  name: string
  period_start: string
  period_end: string
  total: number
  earnings_count: number
  status: string
  paid_at: string | null
  paid_method: string | null
  paid_reference: string | null
  notes: string | null
}

interface Detail {
  referred: { user_id: string; email: string; name: string; signed_up_at: string; first_paid_at: string | null; gross_collected: number; earned: number; status: string }[]
  earnings: { id: string; source: string; charge_id: string; charged_at: string; gross: number; rate: number; earning: number; status: string; note: string | null }[]
  payouts: Payout[]
}

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const pct = (r: number) => `${Math.round((r || 0) * 100)}%`

export default function AdminReferralsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<{ default_rate: number; first_year_only: boolean; apple_net_factor: number } | null>(null)
  const [referrers, setReferrers] = useState<Referrer[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, Detail>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rateDraft, setRateDraft] = useState<Record<string, string>>({})
  const [defaultDraft, setDefaultDraft] = useState('')
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Referrer[] | null>(null)
  const [searching, setSearching] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const me = await fetchWithAuth(`${API_URL}/api/auth/me`).then(r => r.json())
      if (me.account_type !== 'groundgoat_admin') { router.push('/account'); return }
      const [ov, po] = await Promise.all([
        fetchWithAuth(`${API_URL}/api/admin/referrals/overview`).then(r => r.json()),
        fetchWithAuth(`${API_URL}/api/admin/referrals-payouts`).then(r => r.json()),
      ])
      setSettings(ov.settings)
      setDefaultDraft(String(Math.round(ov.settings.default_rate * 100)))
      setReferrers(ov.referrers || [])
      setPayouts(po.payouts || [])
    } catch (e) {
      setError('Could not load referral data')
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => { load() }, [load])

  const search = async () => {
    const q = query.trim()
    if (q.length < 2) { setFound(null); return }
    setSearching(true)
    try {
      const out = await fetchWithAuth(`${API_URL}/api/admin/referrals/lookup?q=${encodeURIComponent(q)}`).then(r => r.json())
      setFound(out.referrers || [])
    } catch {
      setError('Search failed')
    } finally {
      setSearching(false)
    }
  }

  const toggle = async (id: string) => {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    if (!detail[id]) {
      const d = await fetchWithAuth(`${API_URL}/api/admin/referrals/${id}`).then(r => r.json())
      setDetail(prev => ({ ...prev, [id]: d }))
    }
  }

  const saveRate = async (r: Referrer) => {
    const raw = rateDraft[r.user_id]
    if (raw === undefined) return
    setBusy(r.user_id)
    try {
      const body = raw.trim() === '' ? { rate: null } : { rate: Number(raw) / 100 }
      const resp = await fetchWithAuth(`${API_URL}/api/admin/referrals/${r.user_id}/rate`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); setError(j.detail || 'Rate not saved'); return }
      setRateDraft(prev => { const n = { ...prev }; delete n[r.user_id]; return n })
      await load()
      if (found) await search()
    } finally { setBusy(null) }
  }

  const togglePayouts = async (r: Referrer) => {
    setBusy(r.user_id)
    try {
      await fetchWithAuth(`${API_URL}/api/admin/referrals/${r.user_id}/rate`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payouts_enabled: !r.payouts_enabled }),
      })
      await load()
      if (found) await search()
    } finally { setBusy(null) }
  }

  const saveDefault = async () => {
    setBusy('default')
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/admin/referrals-settings`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_rate: Number(defaultDraft) / 100 }),
      })
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); setError(j.detail || 'Default not saved'); return }
      await load()
    } finally { setBusy(null) }
  }

  const runPayouts = async () => {
    setBusy('run')
    try {
      const out = await fetchWithAuth(`${API_URL}/api/admin/referrals-payouts/run`, { method: 'POST' }).then(r => r.json())
      setError(out.created?.length ? null : 'Nothing new to bundle (no earnings before this month, or already bundled)')
      await load()
    } finally { setBusy(null) }
  }

  const syncStripe = async () => {
    setBusy('sync')
    try {
      const out = await fetchWithAuth(`${API_URL}/api/admin/referrals-sync`, { method: 'POST' }).then(r => r.json())
      setError(out.errors?.length ? `Stripe check finished with ${out.errors.length} error(s): ${out.errors[0]}` : null)
      setDetail({})
      await load()
    } catch {
      setError('Stripe check failed')
    } finally { setBusy(null) }
  }

  const markPaid = async (p: Payout) => {
    const method = window.prompt(`How was ${p.name || p.email} paid ${money(p.total)}? (check, venmo, stripe, other)`)
    if (!method) return
    const reference = window.prompt('Reference (check number, transaction id) — optional') || null
    setBusy(p.id)
    try {
      const resp = await fetchWithAuth(`${API_URL}/api/admin/referrals-payouts/${p.id}/mark-paid`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, reference }),
      })
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); setError(j.detail || 'Not marked paid'); return }
      setDetail({})
      await load()
    } finally { setBusy(null) }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 className="animate-spin text-gg-pink" size={32} />
      </div>
    )
  }

  const pending = payouts.filter(p => p.status === 'pending')
  const totals = referrers.reduce((a, r) => ({
    gross: a.gross + r.gross_collected, earned: a.earned + r.earned, paid: a.paid + r.paid_out, owed: a.owed + r.payout_pending + r.unpaid,
  }), { gross: 0, earned: 0, paid: 0, owed: 0 })

  const ReferrerTable = ({ rows }: { rows: Referrer[] }) => (
      <table className="w-full text-sm">
        <thead><tr className="text-gg-gray-400 text-left border-b border-gg-gray-800">
          <th className="pb-3">Referrer</th><th className="pb-3">Code</th><th className="pb-3 text-right">Signed up</th><th className="pb-3 text-right">Paying</th>
          <th className="pb-3 text-right">Collected</th><th className="pb-3 text-right">Earned</th><th className="pb-3 text-right">Paid</th><th className="pb-3 text-right">Owed</th>
          <th className="pb-3 text-right">Rate</th><th className="pb-3"></th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <>
              <tr key={r.user_id} className="border-b border-gg-gray-800/60">
                <td className="py-3 text-white">{r.name || r.email}<div className="text-gg-gray-500 text-xs">{r.email}{!r.payouts_enabled && <span className="ml-2 text-red-400">payouts off</span>}</div></td>
                <td className="py-3 font-mono text-gg-gray-300">{r.referral_code}</td>
                <td className="py-3 text-right text-gg-gray-300">{r.referred_count}</td>
                <td className="py-3 text-right text-gg-gray-300">{r.paying_count}</td>
                <td className="py-3 text-right text-gg-gray-300">{money(r.gross_collected)}</td>
                <td className="py-3 text-right text-white">{money(r.earned)}</td>
                <td className="py-3 text-right text-gg-gray-300">{money(r.paid_out)}</td>
                <td className="py-3 text-right text-white font-semibold">{money(r.payout_pending + r.unpaid)}</td>
                <td className="py-3 text-right">
                  <div className="inline-flex items-center gap-1">
                    <input
                      value={rateDraft[r.user_id] ?? (r.rate_is_override ? String(Math.round(r.rate * 100)) : '')}
                      placeholder={String(Math.round(r.rate * 100))}
                      onChange={e => setRateDraft(prev => ({ ...prev, [r.user_id]: e.target.value }))}
                      inputMode="numeric" title="Per-person rate. Blank = program default."
                      className="w-14 bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1 text-white text-right"
                    />
                    <span className="text-gg-gray-400">%</span>
                    {rateDraft[r.user_id] !== undefined && (
                      <button onClick={() => saveRate(r)} disabled={busy === r.user_id} className="text-gg-pink text-xs ml-1">Save</button>
                    )}
                  </div>
                </td>
                <td className="py-3 text-right whitespace-nowrap">
                  <button onClick={() => togglePayouts(r)} disabled={busy === r.user_id} className="text-gg-gray-400 hover:text-white text-xs mr-3">
                    {r.payouts_enabled ? 'Turn off' : 'Turn on'}
                  </button>
                  <button onClick={() => toggle(r.user_id)} className="text-gg-gray-400 hover:text-white inline-flex items-center">
                    {open === r.user_id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                </td>
              </tr>
              {open === r.user_id && (
                <tr key={`${r.user_id}-d`} className="bg-gg-gray-900/60">
                  <td colSpan={10} className="p-4">
                    {!detail[r.user_id] ? <Loader2 className="animate-spin text-gg-pink" size={18} /> : (
                      <div className="grid md:grid-cols-2 gap-6">
                        <div>
                          <p className="text-gg-gray-400 text-xs uppercase tracking-wide mb-2">People they referred</p>
                          {detail[r.user_id].referred.length === 0 ? <p className="text-gg-gray-500 text-sm">None yet</p> : (
                            <ul className="space-y-1">
                              {detail[r.user_id].referred.map(u => (
                                <li key={u.user_id} className="flex justify-between text-sm">
                                  <span className="text-white">{u.name || u.email}<span className="text-gg-gray-500 ml-2 text-xs">{u.status.replace('_', ' ')}</span></span>
                                  <span className="text-gg-gray-300">{money(u.gross_collected)} → <span className="text-white">{money(u.earned)}</span></span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <p className="text-gg-gray-400 text-xs uppercase tracking-wide mb-2">Charges received</p>
                          {detail[r.user_id].earnings.length === 0 ? <p className="text-gg-gray-500 text-sm">No paid charges yet</p> : (
                            <ul className="space-y-1 max-h-64 overflow-y-auto">
                              {detail[r.user_id].earnings.map(e => (
                                <li key={e.id} className="flex justify-between text-sm">
                                  <span className="text-gg-gray-300">{e.charged_at.slice(0, 10)} <span className="font-mono text-xs text-gg-gray-500">{e.charge_id}</span></span>
                                  <span className={e.status === 'reversed' ? 'line-through text-gg-gray-500' : 'text-white'}>
                                    {money(e.gross)} × {pct(e.rate)} = {money(e.earning)} <span className="text-gg-gray-500 text-xs">{chargeStatus(e.status)}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
  )

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-6xl mx-auto px-6">
        <Link href="/admin/dashboard" className="inline-flex items-center gap-2 text-gg-gray-400 hover:text-white mb-6">
          <ArrowLeft size={16} /> Admin Dashboard
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-display text-4xl font-bold text-white">Referrals</h1>
            <p className="text-gg-gray-400 mt-1">Who referred whom, what we collected, and what they are owed. Charges are checked against Stripe nightly. First year only, paid monthly.</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={syncStripe} disabled={busy === 'sync'} className="btn-secondary inline-flex items-center gap-2 text-sm" title="Pull every referred person's paid invoices from Stripe. Also runs nightly.">
              <RefreshCw size={14} className={busy === 'sync' ? 'animate-spin' : ''} /> Check Stripe now
            </button>
            <button onClick={runPayouts} disabled={busy === 'run'} className="btn-secondary inline-flex items-center gap-2 text-sm">
              <RefreshCw size={14} className={busy === 'run' ? 'animate-spin' : ''} /> Bundle last month into payouts
            </button>
          </div>
        </div>

        {error && <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm">{error}</div>}

        {/* Settings + totals */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
          <div className="card">
            <p className="text-gg-gray-400 text-sm">Default rate</p>
            <div className="flex items-center gap-2 mt-1">
              <input value={defaultDraft} onChange={e => setDefaultDraft(e.target.value)} inputMode="numeric"
                     className="w-16 bg-gg-gray-800 border border-gg-gray-700 rounded px-2 py-1 text-white" />
              <span className="text-white">%</span>
              <button onClick={saveDefault} disabled={busy === 'default' || String(Math.round((settings?.default_rate || 0) * 100)) === defaultDraft}
                      className="text-gg-pink text-sm disabled:opacity-40">Save</button>
            </div>
            <p className="text-gg-gray-500 text-xs mt-1">Apple net factor {settings ? pct(settings.apple_net_factor) : ''}</p>
          </div>
          <Stat label="Collected from referrals" value={money(totals.gross)} />
          <Stat label="Earned by referrers" value={money(totals.earned)} />
          <Stat label="Paid out" value={money(totals.paid)} />
          <Stat label="Owed (pending + not yet bundled)" value={money(totals.owed)} highlight />
        </div>

        {/* Pending payouts */}
        <h2 className="text-xl font-semibold text-white mb-3 flex items-center gap-2"><DollarSign size={18} className="text-gg-pink" /> Payouts to send ({pending.length})</h2>
        <div className="card mb-8 overflow-x-auto">
          {pending.length === 0 ? (
            <p className="text-gg-gray-400 text-sm">No pending payouts. The monthly job runs on the 1st.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-gg-gray-400 text-left border-b border-gg-gray-800">
                <th className="pb-3">Referrer</th><th className="pb-3">Period</th><th className="pb-3 text-right">Charges</th><th className="pb-3 text-right">Amount</th><th className="pb-3"></th>
              </tr></thead>
              <tbody>
                {pending.map(p => (
                  <tr key={p.id} className="border-b border-gg-gray-800/60">
                    <td className="py-3 text-white">{p.name || p.email}<div className="text-gg-gray-500 text-xs">{p.email}</div></td>
                    <td className="py-3 text-gg-gray-300">{p.period_start} → {p.period_end}</td>
                    <td className="py-3 text-right text-gg-gray-300">{p.earnings_count}</td>
                    <td className="py-3 text-right text-white font-semibold">{money(p.total)}</td>
                    <td className="py-3 text-right">
                      <button onClick={() => markPaid(p)} disabled={busy === p.id} className="btn-primary inline-flex items-center gap-1 text-xs py-1.5">
                        <Check size={12} /> Mark paid
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Find a subscriber */}
        <div className="card mb-6">
          <p className="text-gg-gray-400 text-xs uppercase tracking-wide mb-2">Find a subscriber</p>
          <form onSubmit={e => { e.preventDefault(); search() }} className="flex gap-2">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Name, email, or referral code"
              className="flex-1 bg-gg-gray-800 border border-gg-gray-700 rounded px-3 py-2 text-white"
            />
            <button type="submit" disabled={searching} className="btn-secondary">{searching ? 'Searching…' : 'Search'}</button>
            {found && <button type="button" onClick={() => { setFound(null); setQuery('') }} className="text-gg-gray-400 hover:text-white text-sm">Clear</button>}
          </form>
          <p className="text-gg-gray-500 text-xs mt-2">Anyone can be looked up here, even before their first referral. Set a rate to keep them in the list below.</p>
          {found && (
            <div className="mt-4 overflow-x-auto">
              {found.length === 0 ? <p className="text-gg-gray-400 text-sm">No one matched.</p> : (
                <ReferrerTable rows={found} />
              )}
            </div>
          )}
        </div>

        {/* Referrers */}
        <h2 className="text-xl font-semibold text-white mb-3 flex items-center gap-2"><Users size={18} className="text-gg-pink" /> Referrers ({referrers.length})</h2>
        <div className="card overflow-x-auto">
          {referrers.length === 0 ? (
            <p className="text-gg-gray-400 text-sm">Nobody has referred anyone yet.</p>
          ) : (
            <ReferrerTable rows={referrers} />
          )}
        </div>

        {/* Payout history */}
        {payouts.some(p => p.status !== 'pending') && (
          <>
            <h2 className="text-xl font-semibold text-white mt-8 mb-3">Payout history</h2>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-gg-gray-400 text-left border-b border-gg-gray-800">
                  <th className="pb-3">Referrer</th><th className="pb-3">Period</th><th className="pb-3 text-right">Amount</th><th className="pb-3">Paid</th><th className="pb-3">Method / ref</th>
                </tr></thead>
                <tbody>
                  {payouts.filter(p => p.status !== 'pending').map(p => (
                    <tr key={p.id} className="border-b border-gg-gray-800/60">
                      <td className="py-3 text-white">{p.name || p.email}</td>
                      <td className="py-3 text-gg-gray-300">{p.period_start} → {p.period_end}</td>
                      <td className="py-3 text-right text-white">{money(p.total)}</td>
                      <td className="py-3 text-gg-gray-300">{p.paid_at ? p.paid_at.slice(0, 10) : p.status}</td>
                      <td className="py-3 text-gg-gray-300">{p.paid_method}{p.paid_reference ? ` · ${p.paid_reference}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function chargeStatus(s: string) {
  if (s === 'pre_program') return 'before program (not owed)'
  if (s === 'outside_first_year') return 'after first year (not owed)'
  if (s === 'payout_pending') return 'in a payout'
  return s
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="card">
      <p className="text-gg-gray-400 text-sm">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${highlight ? 'text-gg-pink' : 'text-white'}`}>{value}</p>
    </div>
  )
}
