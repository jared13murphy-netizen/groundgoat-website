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
// Optional (owner 11/16): everything above is required, the message is not.

// Light gray panel with dark text (owner 11/16); inputs stay white with a light gray border.
const INPUT = 'w-full h-11 rounded-lg bg-white border border-[#D4D4D8] px-3 text-black placeholder-[#71717A] focus:outline-none focus:border-[#E879C9]'
const LABEL = 'block text-sm font-medium text-[#3F3F46]'
const HINT = 'mt-1 text-[13px] font-normal text-[#B91C1C]'

// A US phone number: 10 digits, or 11 with a leading 1 (same rule as the server).
const phoneOk = (v: string) => { const d = v.replace(/\D/g, ''); return d.length === 10 || (d.length === 11 && d[0] === '1') }
const emailShapeOk = (v: string) => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(v.trim())

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
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [formToken, setFormToken] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  // Fields the person has left: only then do we show "this isn't right yet".
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  // Server check that the email's domain accepts mail: 'checking' | 'ok' | 'bad'.
  const [emailCheck, setEmailCheck] = useState<'idle' | 'checking' | 'ok' | 'bad'>('idle')

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

  useEffect(() => {
    const email = form.email.trim()
    if (!emailShapeOk(email)) { setEmailCheck('idle'); return }
    setEmailCheck('checking')
    let cancelled = false
    const t = setTimeout(() => {
      fetch(`${API_URL}/api/contact/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
        .then(r => (r.ok ? r.json() : { valid: true })) // our trouble never blocks them; the server re-checks on send
        .then(d => { if (!cancelled) setEmailCheck(d?.valid === false ? 'bad' : 'ok') })
        .catch(() => { if (!cancelled) setEmailCheck('ok') })
    }, 500)
    return () => { cancelled = true; clearTimeout(t) }
  }, [form.email])

  const leave = (k: string) => () => setTouched(t => ({ ...t, [k]: true }))
  const emailBad = !emailShapeOk(form.email) || emailCheck === 'bad'
  const phoneBad = !phoneOk(form.phone)

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const complete = Object.values(form).every(v => v.trim()) && !phoneBad && emailShapeOk(form.email) && emailCheck === 'ok'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!complete || sending) return
    setSending(true)
    setError('')
    try {
      const r = await fetch(`${API_URL}/api/contact/corporate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, message, website, form_token: formToken }),
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
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-[#F4F4F5] p-6 text-left text-[#18181B] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <p className="text-xs font-bold tracking-[0.1em] uppercase text-[#A21C7A] mb-1">Corporate plans · more than 10 users</p>
            <h2 id="corp-title" className="font-display text-2xl font-bold text-[#18181B]">Let&rsquo;s build your team&rsquo;s plan</h2>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="w-9 h-9 flex-shrink-0 rounded-full bg-[#E4E4E7] text-[#18181B] flex items-center justify-center hover:bg-[#D4D4D8]">
            <X size={18} />
          </button>
        </div>

        {sent ? (
          <div className="py-8 text-center">
            <CheckCircle className="mx-auto text-gg-pink mb-3" size={40} />
            <p className="text-[#18181B] text-lg font-semibold mb-1">Thank you, {form.first_name.trim()}!</p>
            <p className="text-[#3F3F46] mb-6">We are excited to hear about {form.firm_name.trim()} and will be in touch with you personally very soon. We just sent a note to {form.email.trim()} with a look at everything your team gets.</p>
            <button type="button" onClick={onClose} className="h-11 px-6 rounded-xl bg-[#D4D4D8] text-black font-semibold hover:bg-[#C4C4CA]">Close</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-[#3F3F46] text-[15px] leading-relaxed">Tell us a little about your team, and we will be in touch to show you what Ground Goat can do for your firm.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className={LABEL}>First name
                <input className={`${INPUT} mt-1`} value={form.first_name} onChange={set('first_name')} autoComplete="given-name" required />
              </label>
              <label className={LABEL}>Last name
                <input className={`${INPUT} mt-1`} value={form.last_name} onChange={set('last_name')} autoComplete="family-name" required />
              </label>
            </div>
            <label className={LABEL}>Email address
              <input type="email" className={`${INPUT} mt-1`} value={form.email} onChange={set('email')} onBlur={leave('email')} autoComplete="email" required aria-invalid={touched.email && emailBad} />
              {touched.email && form.email.trim() && emailBad && emailCheck !== 'checking' && (
                <p className={HINT}>Please enter a real email address.</p>
              )}
            </label>
            <label className={LABEL}>Management firm name
              <input className={`${INPUT} mt-1`} value={form.firm_name} onChange={set('firm_name')} autoComplete="organization" required />
            </label>
            <label className={LABEL}>Phone number
              <input type="tel" className={`${INPUT} mt-1`} value={form.phone} onChange={set('phone')} onBlur={leave('phone')} autoComplete="tel" required aria-invalid={touched.phone && phoneBad} />
              {touched.phone && form.phone.trim() && phoneBad && (
                <p className={HINT}>Please enter a 10-digit phone number.</p>
              )}
            </label>
            <label className={LABEL}>Estimated number of users
              <select className={`${INPUT} mt-1 appearance-none pr-10 bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23555%22 stroke-width=%222.2%22><path d=%22M6 9l6 6 6-6%22/></svg>')] bg-no-repeat bg-[right_12px_center]`} value={form.user_range} onChange={set('user_range')} required>
                <option value="" disabled>Choose a range</option>
                {USER_RANGES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className={LABEL}>Message <span className="font-normal text-[#71717A]">(optional)</span>
              <textarea
                className="w-full mt-1 min-h-[96px] rounded-lg bg-white border border-[#D4D4D8] px-3 py-2 text-black placeholder-[#71717A] focus:outline-none focus:border-[#E879C9]"
                value={message}
                onChange={e => setMessage(e.target.value)}
                maxLength={5000}
                placeholder="Tell us about your team, the states you work in, or anything you would like us to know."
              />
            </label>
            {/* Honeypot: hidden from people, filled by bots. */}
            <input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={e => setWebsite(e.target.value)} className="hidden" aria-hidden="true" />
            {error && <p className="text-[#B91C1C] text-sm">{error}</p>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 h-12 rounded-xl bg-[#D4D4D8] text-black font-semibold hover:bg-[#C4C4CA]">Cancel</button>
              <button type="submit" disabled={!complete || sending} className="flex-1 h-12 rounded-xl bg-gg-pink text-black font-bold disabled:opacity-50 disabled:cursor-not-allowed">
                {sending ? 'Sending…' : 'Send Message'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
