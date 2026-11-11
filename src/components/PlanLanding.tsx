'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight, Bell, Calendar, Check, ChevronDown, FileText, Folder, History,
  Layers, LineChart, Map as MapIcon, Search, Smartphone, StickyNote, Users,
} from 'lucide-react'
import { PRICING, FREE_LABEL, formatPrice, cycleUnit, type BillingCycle } from '@/config/pricing'
import { PLAN_LANDING, type PlanHighlight } from '@/config/planLanding'
import { PromoVideoSection } from '@/components/PromoVideo'
import type { PlanKey } from '@/config/pricing'

const ICONS: Record<PlanHighlight['icon'], typeof Bell> = {
  bell: Bell, calendar: Calendar, history: History, phone: Smartphone, layers: Layers,
  search: Search, report: FileText, chart: LineChart, users: Users, notes: StickyNote,
  folder: Folder, map: MapIcon,
}

// Ad / referral parameters ride along into signup, so a visitor who came from
// an ad or a referral link keeps that credit when they continue.
const PASS_THROUGH = ['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']

/** The signup link that continues this plan (step 1 = account, then the plan
 *  is already chosen). */
function signupHref(plan: PlanKey, cycle: BillingCycle, extra: string): string {
  const q = new URLSearchParams({ plan })
  if (plan !== 'firm') q.set('cycle', cycle)
  return `/signup?${q.toString()}${extra}`
}

export default function PlanLanding({ plan }: { plan: PlanKey }) {
  const c = PLAN_LANDING[plan]
  const isFirm = plan === 'firm'
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [extra, setExtra] = useState('')
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const keep = new URLSearchParams()
    for (const k of PASS_THROUGH) { const v = sp.get(k); if (v) keep.set(k, v) }
    if (sp.get('cycle') === 'annual') setCycle('annual')
    setExtra(keep.toString() ? `&${keep.toString()}` : '')
  }, [])

  const href = signupHref(plan, cycle, extra)
  const features = PRICING[plan].features

  const price = isFirm
    ? { amount: `$${formatPrice(PRICING.firm.annualBase)}`, unit: 'year', note: `${PRICING.firm.includedUsers} team members included · +$9.99/mo per user after ${PRICING.firm.includedUsers} (up to ${PRICING.firm.maxUsers}), billed annually` }
    : {
        amount: `$${formatPrice(PRICING[plan][cycle].first)}`,
        unit: cycleUnit(cycle) === 'mo' ? 'month' : 'year',
        note: `first state · +$${formatPrice(PRICING[plan][cycle].additional)}/${cycleUnit(cycle)} each additional state (up to 5)`,
      }

  const CTA = ({ big = false }: { big?: boolean }) => (
    <Link href={href} className={`btn-primary inline-flex items-center justify-center gap-2 ${big ? 'text-lg' : ''}`}>
      Get {FREE_LABEL}
      <ArrowRight size={20} />
    </Link>
  )

  return (
    <>
      {/* Hero */}
      <section className="relative mt-20 min-h-[620px] md:min-h-[calc(100vh-80px)] flex items-center overflow-hidden">
        <div className="absolute inset-0">
          <Image src="/hero-explore-map.png" alt="Ground Goat map of farmland parcels" fill priority sizes="100vw" className="object-cover object-center" />
          <div className="absolute inset-0 bg-black/30" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-gg-black" />
        </div>
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 w-full py-16">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-3 mb-6 animate-slide-up">
              <span className="bg-gg-pink text-black text-sm font-bold px-4 py-1.5 rounded-full">{FREE_LABEL}</span>
              <span className="text-gg-pink text-sm font-semibold tracking-wide uppercase">{c.eyebrow}</span>
            </div>
            <h1 className="font-display text-4xl sm:text-5xl md:text-7xl font-bold text-white mb-6 leading-tight animate-slide-up">
              {c.headline}
              <span className="block text-gradient">{c.headlineAccent}</span>
            </h1>
            <p className="text-lg md:text-2xl text-gray-200 mb-8 animate-slide-up delay-100">{c.subhead}</p>
            <div className="flex flex-col sm:flex-row gap-4 animate-slide-up delay-200">
              <CTA big />
              <a href="#watch" className="btn-secondary inline-flex items-center justify-center gap-2 text-lg">Watch the video</a>
            </div>
            <p className="mt-5 text-gg-gray-300 text-sm">
              {price.amount}/{price.unit} after your {FREE_LABEL.toLowerCase()} · Cancel anytime
            </p>
          </div>
        </div>
      </section>

      {/* Company video */}
      <PromoVideoSection />

      {/* What you get */}
      <section className="py-20 md:py-24 bg-gg-gray-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12 md:mb-16">
            <span className="inline-block text-gg-pink text-sm font-semibold tracking-wide uppercase mb-3">{c.audience}</span>
            <h2 className="font-display text-3xl md:text-5xl font-bold text-white">What you get with {c.eyebrow}</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {c.highlights.map(h => {
              const Icon = ICONS[h.icon]
              return (
                <div key={h.title} className="card">
                  <div className="w-12 h-12 rounded-xl bg-gg-pink/10 text-gg-pink flex items-center justify-center mb-5">
                    <Icon size={24} />
                  </div>
                  <h3 className="font-display text-xl font-bold text-white mb-2">{h.title}</h3>
                  <p className="text-gg-gray-400">{h.body}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* Price */}
      <section id="price" className="py-20 md:py-24 bg-gg-black">
        <div className="max-w-xl mx-auto px-4 sm:px-6">
          {!isFirm && (
            <div className="flex justify-center mb-8">
              <div className="inline-flex bg-gg-gray-800 border border-gg-gray-700 rounded-full p-1">
                {(['monthly', 'annual'] as const).map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setCycle(k)}
                    className={`px-6 py-2 rounded-full text-sm font-semibold transition-colors ${cycle === k ? 'bg-gg-pink text-black' : 'text-gg-gray-300 hover:text-white'}`}
                  >
                    {k === 'monthly' ? 'Monthly' : 'Annual'}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="card border-gg-pink glow-pink-sm hover:translate-y-0">
            <span className="inline-block text-gg-pink text-sm font-semibold mb-3">{FREE_LABEL}</span>
            <h2 className="font-display text-3xl font-bold text-white mb-2">{c.eyebrow}</h2>
            <p className="text-gg-gray-400 mb-6">{PRICING[plan].description}</p>
            <div className="mb-1">
              <span className="text-4xl md:text-5xl font-bold text-white">{price.amount}</span>
              <span className="text-gg-gray-400">/{price.unit}</span>
            </div>
            <p className="text-gg-gray-500 text-sm mb-6">{price.note}</p>
            <ul className="space-y-3 mb-8">
              {features.map(f => (
                <li key={f} className="flex items-start gap-2 text-gg-gray-300">
                  <Check className="text-gg-pink mt-0.5 flex-shrink-0" size={18} />
                  {f}
                </li>
              ))}
            </ul>
            <div className="flex flex-col">
              <CTA big />
            </div>
            <p className="text-center text-gg-gray-500 text-sm mt-4">
              Nothing is charged for 30 days · {isFirm || cycle === 'annual' ? 'Billed annually' : 'Billed monthly'} · Cancel anytime
            </p>
          </div>
          <p className="text-center mt-6">
            <Link href="/#pricing" className="text-gg-gray-400 hover:text-gg-pink text-sm transition-colors">Compare all plans</Link>
          </p>
        </div>
      </section>

      {/* Questions */}
      <section className="py-20 md:py-24 bg-gg-gray-900">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white text-center mb-10">Questions</h2>
          <div className="space-y-3">
            {c.faq.map((f, i) => (
              <div key={f.q} className="bg-gg-gray-800 border border-gg-gray-700 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  aria-expanded={openFaq === i}
                  className="w-full flex items-center justify-between gap-4 text-left px-6 py-5 text-white font-semibold"
                >
                  {f.q}
                  <ChevronDown size={20} className={`text-gg-pink flex-shrink-0 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && <p className="px-6 pb-5 text-gg-gray-400">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call */}
      <section className="py-20 md:py-24 bg-gg-black relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] bg-gg-pink/10 rounded-full blur-[150px]" />
        <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-display text-3xl md:text-5xl font-bold text-white mb-4">
            Start with <span className="text-gradient">{FREE_LABEL}</span>
          </h2>
          <p className="text-lg md:text-xl text-gg-gray-400 mb-8">{c.eyebrow} · {price.amount}/{price.unit} after that · Cancel anytime</p>
          <CTA big />
        </div>
      </section>
    </>
  )
}
