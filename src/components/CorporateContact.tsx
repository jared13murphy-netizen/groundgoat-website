'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, X } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// Corporate plans (owner 11/16): firms over 10 users message us from the
// Management Firm page and the homepage pricing card. The server mails
// info@groundgoat.com and checks the range against the same list.
const USER_RANGES = ['11-25 users', '26-50 users', '51-100 users', '101-250 users', '250+ users']

const EMPTY = { first_name: '', last_name: '', email: '', firm_name: '', phone: '', user_range: '' }

// Inputs are white with a light gray border, even on a dark panel (owner rule).
const INPUT = 'w-full h-11 rounded-lg bg-white border border-gray-300 px-3 text-black placeholder-gray-400 focus:outline-none focus:border-gg-pink'

/** "Corporate plans for more than 10 users? Contact us" — opens the panel. */
export function CorporatePlansLink({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <p className={`text-sm text-gg-gray-400 ${className}`}>
        Corporate plans for more than 10 users?{' '}
        <button type="button" onClick={() => setOpen(true)} className="text-gg-pink font-semibold hover:underline">
          Contact us
        </button>
      </p>
      {/* Portal: the pricing cards move on hover, which would trap a fixed panel inside the card. */}
      {open && createPortal(<CorporateContactPanel onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function CorporateContactPanel({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState(EMPTY)
  const [website, setWebsite] = useState('') // honeypot
  const [formToken, setFormToken] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  // Same anti-spam token as the contact page, fetched when the panel opens.
  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/contact/form-token`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.token) setFormToken(d.token) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const complete = Object.values(form).every(v => v.trim()) && /\S+@\S+\.\S+/.test(form.email)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!complete || sending) return
    setSending(true)
    setError('')
    try {
      const r = await fetch(`${API_URL}/api/contact/corporate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, website, form_token: formToken }),
      })
      if (!r.ok) {
        let detail = ''
        try { detail = (await r.json())?.detail || '' } catch { /* non-JSON */ }
        throw new Error(r.status === 400 && typeof detail === 'string' && detail ? detail : 'Could not send. Please try again, or email info@groundgoat.com.')
      }
      setSent(true)
    } catch (err: any) {
      setError(err.message || 'Could not send. Please try again, or email info@groundgoat.com.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="corp-title"
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-gg-gray-900 border border-white/10 p-6 text-left"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-2">
          <h2 id="corp-title" className="font-display text-2xl font-bold text-white">Corporate Plans</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="w-9 h-9 rounded-full bg-gg-gray-800 text-white flex items-center justify-center hover:bg-gg-gray-700">
            <X size={18} />
          </button>
        </div>

        {sent ? (
          <div className="py-8 text-center">
            <CheckCircle className="mx-auto text-gg-pink mb-3" size={40} />
            <p className="text-white text-lg font-semibold mb-1">Thanks, we got your message.</p>
            <p className="text-gg-gray-400 mb-6">We will be in touch soon about a plan for your team.</p>
            <button type="button" onClick={onClose} className="h-11 px-6 rounded-xl bg-[#E4E4E7] text-black font-semibold">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-gg-gray-400 text-sm">For organizations with more than 10 users. Tell us about your team and we will get back to you.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block text-sm text-gg-gray-300">First name
                <input className={`${INPUT} mt-1`} value={form.first_name} onChange={set('first_name')} autoComplete="given-name" required />
              </label>
              <label className="block text-sm text-gg-gray-300">Last name
                <input className={`${INPUT} mt-1`} value={form.last_name} onChange={set('last_name')} autoComplete="family-name" required />
              </label>
            </div>
            <label className="block text-sm text-gg-gray-300">Email address
              <input type="email" className={`${INPUT} mt-1`} value={form.email} onChange={set('email')} autoComplete="email" required />
            </label>
            <label className="block text-sm text-gg-gray-300">Management firm name
              <input className={`${INPUT} mt-1`} value={form.firm_name} onChange={set('firm_name')} autoComplete="organization" required />
            </label>
            <label className="block text-sm text-gg-gray-300">Phone number
              <input type="tel" className={`${INPUT} mt-1`} value={form.phone} onChange={set('phone')} autoComplete="tel" required />
            </label>
            <label className="block text-sm text-gg-gray-300">Number of users
              <select className={`${INPUT} mt-1 appearance-none pr-10 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23555%22 stroke-width=%222.2%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_12px_center]`} value={form.user_range} onChange={set('user_range')} required>
                <option value="" disabled>Choose a range</option>
                {USER_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            {/* Honeypot: hidden from people, filled by bots. */}
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} className="hidden" aria-hidden="true" />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 h-12 rounded-xl bg-[#E4E4E7] text-black font-semibold">Cancel</button>
              <button type="submit" disabled={!complete || sending} className="flex-1 h-12 rounded-xl bg-gg-pink text-black font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                {sending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
