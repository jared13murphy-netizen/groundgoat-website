'use client'

// Admin → Invoices (owner 2026-10-22): "send an invoice to a customer to pay
// via ACH or credit card through Stripe." The form creates a Stripe invoice
// through the backend (POST /api/admin/invoices), Stripe emails the customer
// a hosted page that accepts a card or an ACH bank debit, and the list below
// tracks every invoice we have sent with its live status from Stripe
// webhooks. Admin-only (groundgoat_admin), same guard as the other admin pages.

import { useState, useEffect, useCallback } from 'react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, FileText, Plus, Trash2, Send, Ban, ExternalLink, Loader2, CreditCard, Landmark } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

interface Firm { id: string; name: string; email: string | null; has_stripe_customer: boolean }
interface Item { description: string; quantity: number; unit_amount: string }
interface Invoice {
  id: string
  stripe_invoice_id: string
  customer_name: string
  customer_email: string
  firm_id: string | null
  description: string | null
  line_items: { description: string; quantity: number; unit_amount_cents: number }[]
  amount: number
  amount_paid: number | null
  status: string
  hosted_invoice_url: string | null
  invoice_pdf: string | null
  paid_at: string | null
  paid_via: string | null
  payment_methods: string[]
  days_until_due: number
  created_at: string
}

const money = (n: number) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const STATUS_STYLE: Record<string, string> = {
  paid: 'bg-green-900/40 text-green-300 border-green-700',
  open: 'bg-yellow-900/40 text-yellow-300 border-yellow-700',
  draft: 'bg-gg-gray-800 text-gg-gray-300 border-gg-gray-600',
  void: 'bg-gg-gray-800 text-gg-gray-400 border-gg-gray-700 line-through',
  uncollectible: 'bg-red-900/40 text-red-300 border-red-700',
}

export default function AdminInvoicesPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [firms, setFirms] = useState<Firm[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Form state
  const [firmId, setFirmId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [description, setDescription] = useState('')
  const [items, setItems] = useState<Item[]>([{ description: '', quantity: 1, unit_amount: '' }])
  const [daysUntilDue, setDaysUntilDue] = useState(30)
  const [allowCard, setAllowCard] = useState(true)
  const [allowAch, setAllowAch] = useState(true)
  const [sending, setSending] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    const [f, i] = await Promise.all([
      fetchWithAuth(`${API_URL}/api/admin/invoices/firms`).then(r => (r.ok ? r.json() : { firms: [] })),
      fetchWithAuth(`${API_URL}/api/admin/invoices`).then(r => (r.ok ? r.json() : { invoices: [] })),
    ])
    setFirms(f.firms || [])
    setInvoices(i.invoices || [])
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('auth_token')
    if (!token) { router.push('/signin'); return }
    ;(async () => {
      try {
        const me = await fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
        if (!me.ok) { router.push('/signin'); return }
        const user = await me.json()
        if (user.account_type !== 'groundgoat_admin') { router.push('/account'); return }
        await loadAll()
      } catch {
        router.push('/signin')
      } finally {
        setLoading(false)
      }
    })()
  }, [router, loadAll])

  // Picking a firm fills name + email from the firm record; both stay editable.
  const onPickFirm = (id: string) => {
    setFirmId(id)
    const f = firms.find(x => x.id === id)
    if (f) {
      setCustomerName(f.name || '')
      setCustomerEmail(f.email || '')
    }
  }

  const total = items.reduce((s, it) => s + (parseFloat(it.unit_amount) || 0) * (it.quantity || 0), 0)
  // Owner 10/22 typed a description, saw the "2500.00" placeholder in the
  // amount box, read Total $0.00 and concluded the form was fake. Nothing had
  // been sent because nothing could be: say exactly what is missing and keep
  // the buttons off until the invoice is real.
  const missing = (() => {
    if (!customerName.trim()) return 'Enter the customer name.'
    if (!customerEmail.includes('@')) return 'Enter the customer email.'
    const live = items.filter(it => it.description.trim() || it.unit_amount)
    if (live.length === 0) return 'Add a line item with a description and an amount.'
    for (const it of live) {
      if (!it.description.trim()) return 'Every line item needs a description.'
      if (!(parseFloat(it.unit_amount) > 0)) return `Enter the dollar amount for "${it.description.trim()}".`
    }
    if (!allowCard && !allowAch) return 'Allow at least one payment method.'
    return null
  })()

  const updateItem = (idx: number, patch: Partial<Item>) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  const submit = async (send: boolean) => {
    setError(null); setNotice(null)
    if (!customerName.trim() || !customerEmail.includes('@')) { setError('Customer name and a valid email are required.'); return }
    if (!allowCard && !allowAch) { setError('Allow at least one payment method.'); return }
    const clean = items.filter(it => it.description.trim() || it.unit_amount)
    if (clean.length === 0) { setError('Add at least one line item.'); return }
    for (const it of clean) {
      if (!it.description.trim()) { setError('Every line item needs a description.'); return }
      if (!(parseFloat(it.unit_amount) > 0)) { setError(`"${it.description}" needs an amount.`); return }
    }
    setSending(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customerName.trim(),
          customer_email: customerEmail.trim(),
          firm_id: firmId || null,
          description: description.trim() || null,
          items: clean.map(it => ({ description: it.description.trim(), quantity: it.quantity || 1, unit_amount: parseFloat(it.unit_amount) })),
          days_until_due: daysUntilDue,
          payment_methods: [...(allowCard ? ['card'] : []), ...(allowAch ? ['us_bank_account'] : [])],
          send,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.detail || `Request failed (${res.status})`); return }
      setNotice(send
        ? `Invoice ${body.invoice.stripe_invoice_id} for ${money(body.invoice.amount)} created in Stripe and emailed to ${customerEmail.trim()}. It is listed below with View and Stripe links.`
        : `Draft ${body.invoice.stripe_invoice_id} for ${money(body.invoice.amount)} created in Stripe (not emailed). It is listed below.`)
      setItems([{ description: '', quantity: 1, unit_amount: '' }])
      setDescription('')
      await loadAll()
    } catch (e: any) {
      setError(e?.message || 'Request failed')
    } finally {
      setSending(false)
    }
  }

  const act = async (inv: Invoice, action: 'resend' | 'void') => {
    if (action === 'void' && !window.confirm(`Void the ${money(inv.amount)} invoice to ${inv.customer_name}? The customer will no longer be able to pay it.`)) return
    setBusyId(inv.id); setError(null); setNotice(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/admin/invoices/${inv.id}/${action}`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(body.detail || `Request failed (${res.status})`); return }
      setNotice(action === 'resend' ? `Invoice re-sent to ${inv.customer_email}.` : 'Invoice voided.')
      await loadAll()
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard" className="text-gg-gray-400 hover:text-white"><ArrowLeft size={24} /></Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-white">Invoices</h1>
            <p className="text-gg-gray-400">Send a Stripe invoice a customer can pay by card or ACH bank debit</p>
          </div>
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-700 bg-red-900/30 px-4 py-3 text-red-200">{error}</div>}
        {notice && <div className="mb-4 rounded-lg border border-green-700 bg-green-900/30 px-4 py-3 text-green-200">{notice}</div>}

        {/* New invoice */}
        <div className="card mb-8">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2"><FileText size={20} className="text-gg-pink" /> New invoice</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <label className="block">
              <span className="text-sm text-gg-gray-400">Firm (optional)</span>
              <select value={firmId} onChange={e => onPickFirm(e.target.value)}
                className="mt-1 w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white">
                <option value="">— not a firm / new customer —</option>
                {firms.map(f => <option key={f.id} value={f.id}>{f.name}{f.has_stripe_customer ? '' : ' (no Stripe customer yet)'}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-gg-gray-400">Customer name</span>
              <input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="First National Bank"
                className="mt-1 w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white" />
            </label>
            <label className="block">
              <span className="text-sm text-gg-gray-400">Customer email (the invoice goes here)</span>
              <input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} placeholder="ap@bank.com" type="email"
                className="mt-1 w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white" />
            </label>
          </div>

          <div className="mb-2 text-sm text-gg-gray-400">Line items</div>
          <div className="space-y-2 mb-3">
            {items.map((it, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <input value={it.description} onChange={e => updateItem(idx, { description: e.target.value })}
                  placeholder="Description" className="col-span-12 md:col-span-7 bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white placeholder:text-gg-gray-600" />
                <input value={it.quantity} min={1} type="number" onChange={e => updateItem(idx, { quantity: Math.max(1, parseInt(e.target.value || '1', 10)) })}
                  className="col-span-4 md:col-span-1 bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-3 py-2 text-white" aria-label="Quantity" />
                <div className="col-span-6 md:col-span-3 relative">
                  <span className="absolute left-3 top-2 text-gg-gray-500">$</span>
                  <input value={it.unit_amount} inputMode="decimal" onChange={e => updateItem(idx, { unit_amount: e.target.value.replace(/[^0-9.]/g, '') })}
                    placeholder="0.00" className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg pl-7 pr-3 py-2 text-white placeholder:text-gg-gray-600" aria-label="Unit amount" />
                </div>
                <button type="button" onClick={() => setItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev)}
                  className="col-span-2 md:col-span-1 text-gg-gray-500 hover:text-red-400 flex justify-center" aria-label="Remove line"><Trash2 size={18} /></button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setItems(prev => [...prev, { description: '', quantity: 1, unit_amount: '' }])}
            className="text-gg-pink hover:text-white text-sm flex items-center gap-1 mb-4"><Plus size={16} /> Add line</button>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <label className="block md:col-span-2">
              <span className="text-sm text-gg-gray-400">Memo on the invoice (optional)</span>
              <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Ground Goat subscription for 2027"
                className="mt-1 w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white" />
            </label>
            <label className="block">
              <span className="text-sm text-gg-gray-400">Due in (days)</span>
              <input type="number" min={1} max={180} value={daysUntilDue} onChange={e => setDaysUntilDue(Math.min(180, Math.max(1, parseInt(e.target.value || '30', 10))))}
                className="mt-1 w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-2 text-white" />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-6 mb-6">
            <span className="text-sm text-gg-gray-400">Customer may pay by</span>
            <label className="flex items-center gap-2 text-white"><input type="checkbox" checked={allowCard} onChange={e => setAllowCard(e.target.checked)} /> <CreditCard size={16} /> Card (2.9% + 30¢)</label>
            <label className="flex items-center gap-2 text-white"><input type="checkbox" checked={allowAch} onChange={e => setAllowAch(e.target.checked)} /> <Landmark size={16} /> ACH bank debit (0.8%, max $5)</label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-white text-lg">Total <span className="font-bold">{money(total)}</span></div>
              {missing && <div className="text-sm text-yellow-400 mt-1">{missing}</div>}
            </div>
            <div className="flex gap-3">
              <button type="button" disabled={sending || !!missing} onClick={() => submit(false)}
                className="px-5 py-2 rounded-lg bg-gg-gray-800 text-gg-gray-200 hover:text-white disabled:opacity-50">Save as draft</button>
              <button type="button" disabled={sending || !!missing} onClick={() => submit(true)}
                className="px-6 py-2 rounded-lg bg-gg-pink text-white font-semibold hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} Send invoice
              </button>
            </div>
          </div>
        </div>

        {/* Sent invoices */}
        <div className="card">
          <h2 className="text-xl font-semibold text-white mb-4">Sent invoices</h2>
          {invoices.length === 0 ? (
            <p className="text-gg-gray-400">No invoices yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-gg-gray-400 text-sm border-b border-gg-gray-700">
                    <th className="pb-3">Sent</th>
                    <th className="pb-3">Customer</th>
                    <th className="pb-3">Memo</th>
                    <th className="pb-3 text-right">Amount</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3">Paid</th>
                    <th className="pb-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id} className="border-b border-gg-gray-800 text-white align-top">
                      <td className="py-3 whitespace-nowrap text-gg-gray-300">{new Date(inv.created_at).toLocaleDateString()}</td>
                      <td className="py-3">
                        <div className="font-semibold">{inv.customer_name}</div>
                        <div className="text-sm text-gg-gray-400">{inv.customer_email}</div>
                      </td>
                      <td className="py-3 text-gg-gray-300 max-w-xs">
                        {inv.description || inv.line_items?.map(l => l.description).join(', ')}
                      </td>
                      <td className="py-3 text-right font-semibold whitespace-nowrap">{money(inv.amount)}</td>
                      <td className="py-3">
                        <span className={`inline-block rounded-full border px-3 py-0.5 text-sm ${STATUS_STYLE[inv.status] || STATUS_STYLE.draft}`}>{inv.status}</span>
                      </td>
                      <td className="py-3 text-sm text-gg-gray-300 whitespace-nowrap">
                        {inv.paid_at ? `${new Date(inv.paid_at).toLocaleDateString()}${inv.paid_via ? ` · ${inv.paid_via === 'us_bank_account' ? 'ACH' : inv.paid_via}` : ''}` : '—'}
                      </td>
                      <td className="py-3 text-right whitespace-nowrap">
                        <a href={`https://dashboard.stripe.com/invoices/${inv.stripe_invoice_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gg-gray-300 hover:text-white mr-3"><ExternalLink size={14} /> Stripe</a>
                        {inv.hosted_invoice_url && (
                          <a href={inv.hosted_invoice_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gg-pink hover:text-white mr-3"><ExternalLink size={14} /> View</a>
                        )}
                        {['open', 'draft'].includes(inv.status) && (
                          <>
                            <button disabled={busyId === inv.id} onClick={() => act(inv, 'resend')} className="inline-flex items-center gap-1 text-gg-gray-300 hover:text-white mr-3 disabled:opacity-50"><Send size={14} /> Re-send</button>
                            <button disabled={busyId === inv.id} onClick={() => act(inv, 'void')} className="inline-flex items-center gap-1 text-gg-gray-400 hover:text-red-400 disabled:opacity-50"><Ban size={14} /> Void</button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
