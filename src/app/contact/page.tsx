'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Send, CheckCircle } from 'lucide-react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export default function ContactPage() {
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  // Anti-spam. The endpoint is public, and it was being harvested — 15
  // machine-generated submissions in one morning (owner, 2026-08-05).
  //
  // The token is issued by the API when this page loads and is required to
  // post. It proves the submission came from someone who actually opened
  // the page: a bot hitting /api/contact directly never gets one and cannot
  // forge one. The server also reads the token's issue time, so a
  // submission arriving within 3s of load is treated as automated.
  const [formToken, setFormToken] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch(`${API_URL}/api/contact/form-token`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d?.token) setFormToken(d.token) })
      .catch(() => { /* submit surfaces the real error; don't block page load */ })
    return () => { cancelled = true }
  }, [])

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: '',
    // Honeypot. Hidden from real users, so anything here means a bot filled
    // in every field it found. Named "website" to look worth filling.
    website: '',
  })

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value })
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.name.trim() || !formData.email.trim() || !formData.subject.trim() || !formData.message.trim()) {
      setError('Please fill in all fields')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch(`${API_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...formData, form_token: formToken }),
      })
      if (!response.ok) {
        // 400 = expired/missing token: a tab left open, or a page cached
        // from before this shipped. Surface the server's wording so the
        // person knows a refresh fixes it, rather than a generic failure
        // that reads like their message vanished.
        let detail = ''
        try { detail = (await response.json())?.detail || '' } catch { /* non-JSON body */ }
        throw new Error(response.status === 400 && detail ? detail : 'Failed to send message')
      }
      setSubmitted(true)
    } catch (err: any) {
      setError(
        err?.message && err.message !== 'Failed to send message'
          ? err.message
          : 'Failed to send message. Please try again or email us directly at jmurphy@groundgoat.com'
      )
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center pt-24 pb-12">
        <div className="max-w-md w-full mx-auto px-6 text-center">
          <div className="card">
            <CheckCircle className="text-gg-pink mx-auto mb-4" size={64} />
            <h1 className="font-display text-2xl font-bold text-white mb-4">
              Message Sent!
            </h1>
            <p className="text-gg-gray-400 mb-8">
              Thank you for reaching out. We'll get back to you as soon as possible.
            </p>
            <Link href="/" className="btn-primary inline-block">
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gg-black pt-24 pb-12">
      <div className="max-w-6xl mx-auto px-6">
        {/* Header */}
        <div className="text-center mb-16">
          <h1 className="font-display text-4xl md:text-5xl font-bold text-white mb-4">
            Get in Touch
          </h1>
          <p className="text-xl text-gg-gray-400 max-w-2xl mx-auto">
            Have a question or need help? We're here for you.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-12">
          {/* Contact Info */}
          <div className="lg:col-span-1">
            <div className="space-y-8">
              <div>
                <h2 className="font-display text-2xl font-bold text-white mb-6">
                  Contact Information
                </h2>
                <p className="text-gg-gray-400">
                  Fill out the form and we'll respond as soon as we can.
                </p>
              </div>
            </div>
          </div>

          {/* Contact Form */}
          <div className="lg:col-span-2">
            <form onSubmit={handleSubmit} className="card">
              {/* Honeypot. Hidden with absolute positioning rather than
                  `display:none` or `hidden` — some bots skip fields that are
                  obviously hidden, but happily fill one that is merely off
                  screen. tabIndex={-1} keeps keyboard users from ever landing
                  on it, aria-hidden keeps screen readers from announcing it,
                  and autoComplete="off" stops browsers offering to fill it.
                  A real person can neither see nor reach this input, so any
                  value in it means the submission was automated. */}
              <div aria-hidden="true" className="absolute left-[-9999px] top-auto w-px h-px overflow-hidden">
                <label htmlFor="website">Website</label>
                <input
                  type="text"
                  id="website"
                  name="website"
                  value={formData.website}
                  onChange={handleInputChange}
                  tabIndex={-1}
                  autoComplete="off"
                />
              </div>

              <div className="space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">Name</label>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={handleInputChange}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500"
                      placeholder="John Doe"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gg-gray-300 mb-2">Email</label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleInputChange}
                      className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500"
                      placeholder="john@example.com"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gg-gray-300 mb-2">Subject</label>
                  <select
                    name="subject"
                    value={formData.subject}
                    onChange={handleInputChange}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white"
                    required
                  >
                    <option value="">Select a topic</option>
                    <option value="General Inquiry">General Inquiry</option>
                    <option value="Subscription Help">Subscription Help</option>
                    <option value="Technical Support">Technical Support</option>
                    <option value="Billing Question">Billing Question</option>
                    <option value="Feature Request">Feature Request</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gg-gray-300 mb-2">Message</label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleInputChange}
                    rows={6}
                    className="w-full bg-gg-gray-900 border border-gg-gray-700 rounded-lg px-4 py-3 text-white placeholder-gg-gray-500 resize-none"
                    placeholder="How can we help you?"
                    required
                  />
                </div>

                {error && (
                  <p className="text-red-400 text-sm">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="btn-primary flex items-center justify-center gap-2"
                >
                  {loading ? 'Sending...' : 'Send Message'}
                  <Send size={20} />
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
