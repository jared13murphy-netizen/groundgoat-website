'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight, Bell, Calendar, Check, FileText, Folder, History,
  Layers, LineChart, Map as MapIcon, Search, Smartphone, StickyNote, Users,
} from 'lucide-react'
import { PRICING, FREE_LABEL, formatPrice, cycleUnit, type BillingCycle } from '@/config/pricing'
import { PLAN_LANDING, type PlanHighlight } from '@/config/planLanding'
import { CorporatePlansLink } from '@/components/CorporateContact'
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

/** A product screenshot in a clean device frame: a browser window for the
 *  website, a phone for the app. */
function Shot({ src, alt, frame }: { src: string; alt: string; frame: 'browser' | 'phone' | 'doc' }) {
  if (frame === 'doc') {
    return (
      <div className="relative mx-auto max-w-md">
        <div className="absolute -inset-10 bg-gg-pink/10 rounded-full blur-[80px]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className="relative w-full block rounded-md shadow-2xl ring-1 ring-white/10 rotate-[-1.5deg]" />
      </div>
    )
  }
  if (frame === 'phone') {
    return (
      <div className="relative mx-auto w-[260px] sm:w-[300px]">
        <div className="absolute -inset-10 bg-gg-pink/10 rounded-full blur-[80px]" />
        <div className="relative rounded-[2.6rem] border border-white/15 bg-black p-2.5 shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} loading="lazy" className="w-full rounded-[2.1rem] block" />
        </div>
      </div>
    )
  }
  return (
    <div className="relative">
      <div className="absolute -inset-8 bg-gg-pink/10 rounded-[3rem] blur-[80px]" />
      <div className="relative rounded-2xl border border-white/10 bg-gg-gray-800 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 h-9 bg-gg-gray-800 border-b border-white/5">
          <span className="w-3 h-3 rounded-full bg-white/15" />
          <span className="w-3 h-3 rounded-full bg-white/15" />
          <span className="w-3 h-3 rounded-full bg-white/15" />
          <span className="ml-3 flex-1 max-w-xs h-5 rounded-md bg-black/40 text-[11px] leading-5 text-gg-gray-400 px-3 truncate">groundgoat.com</span>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" className="w-full block" />
      </div>
    </div>
  )
}

export default function PlanLanding({ plan }: { plan: PlanKey }) {
  const c = PLAN_LANDING[plan]
  const isFirm = plan === 'firm'
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [extra, setExtra] = useState('')

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const keep = new URLSearchParams()
    for (const k of PASS_THROUGH) { const v = sp.get(k); if (v) keep.set(k, v) }
    if (sp.get('cycle') === 'annual') setCycle('annual')
    setExtra(keep.toString() ? `&${keep.toString()}` : '')
  }, [])

  // Phone: the cards slide sideways; the dots follow the card in view.
  const cardsRef = useRef<HTMLDivElement>(null)
  const [cardIdx, setCardIdx] = useState(0)
  const onCardsScroll = () => {
    const el = cardsRef.current
    const first = el?.firstElementChild as HTMLElement | null
    if (!el || !first) return
    setCardIdx(Math.round(el.scrollLeft / (first.offsetWidth + 12)))
  }

  const href = signupHref(plan, cycle, extra)
  const features = [...PRICING[plan].features, ...(c.extraFeatures || [])]

  const price = isFirm
    ? { amount: `$${formatPrice(PRICING.firm.annualBase)}`, unit: 'year', note: `${PRICING.firm.includedUsers} team members included · +$9.99/mo per user after ${PRICING.firm.includedUsers} (up to ${PRICING.firm.maxUsers}), billed annually` }
    : {
        amount: `$${formatPrice(PRICING[plan][cycle].first)}`,
        unit: cycleUnit(cycle) === 'mo' ? 'month' : 'year',
        note: `first state · +$${formatPrice(PRICING[plan][cycle].additional)}/${cycleUnit(cycle)} each additional state (up to 5)`,
      }

  const CTA = ({ big = false }: { big?: boolean }) => (
    <Link href={href} className={`btn-primary inline-flex items-center justify-center gap-2 ${big ? 'text-lg' : ''}`}>
      Start Subscription
      <ArrowRight size={20} />
    </Link>
  )

  return (
    <>
      {/* Top (owner 11/16, option 5): the plan, its price, and a card per
          benefit; a card scrolls down to that benefit. */}
      <section className="relative mt-20 pt-12 md:pt-16 pb-12 md:pb-20 bg-gg-black overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 text-center">
          <p className="text-gg-pink text-sm font-bold tracking-[0.1em] uppercase mb-4">{c.eyebrow} Plan</p>
          <h1 className="font-display text-[34px] leading-tight sm:text-5xl md:text-6xl font-bold text-white max-w-4xl mx-auto mb-4">
            {c.topHeadline}
          </h1>
          <p className="text-base md:text-xl text-gg-gray-300">
            <b className="text-white">{FREE_LABEL}</b>, then {isFirm
              ? `${price.amount} a year with ${PRICING.firm.includedUsers} team members`
              : `${price.amount} a ${price.unit} for your first state`}. Cancel anytime.
          </p>
          {c.appOnly && (
            <p className="mt-3 inline-flex items-center gap-2 text-gg-gray-300 text-sm">
              <Smartphone size={16} className="text-gg-pink" /> In the Ground Goat app for iPhone and Android
            </p>
          )}
        </div>
        <div
          ref={cardsRef}
          onScroll={onCardsScroll}
          className={`mt-8 md:mt-10 max-w-7xl mx-auto px-4 sm:px-6 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 sm:scroll-px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:gap-4 md:overflow-visible md:grid-cols-2 ${c.highlights.length === 5 ? 'lg:grid-cols-5' : 'lg:grid-cols-4'}`}
        >
          {c.highlights.map((h, i) => (
            <a
              key={h.title}
              href={`#benefit-${i}`}
              className="group flex-[0_0_78%] sm:flex-[0_0_300px] md:flex-auto snap-start bg-gg-gray-900 border border-white/10 hover:border-gg-pink/60 rounded-2xl overflow-hidden flex flex-col text-left transition-colors"
            >
              {h.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={h.image} alt={h.alt || h.card.title} className="w-full h-44 md:h-48 object-cover object-left-top" />
              )}
              <span className="px-4 pt-4 text-[17px] font-bold text-white">{h.card.title}</span>
              <span className="px-4 pt-1 text-sm leading-snug text-gg-gray-400 flex-grow">{h.card.body}</span>
              <span className="px-4 pt-2 pb-4 text-sm font-semibold text-gg-pink">See more ↓</span>
            </a>
          ))}
        </div>
        <div className="mt-4 flex justify-center gap-1.5 md:hidden" aria-hidden="true">
          {c.highlights.map((h, i) => (
            <span key={h.title} className={`h-1.5 rounded-full transition-all ${i === cardIdx ? 'w-5 bg-gg-pink' : 'w-1.5 bg-gg-gray-600'}`} />
          ))}
        </div>
        <p className="mt-6 px-4 text-center text-sm md:text-base text-gg-gray-400">{c.plusLine}</p>
      </section>

      {/* Company video */}
      <PromoVideoSection />

      {/* What you get: each benefit beside a real screenshot of it */}
      <section className="py-20 md:py-28 bg-gg-gray-900 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14 md:mb-20">
            <h2 className="font-display text-3xl md:text-5xl font-bold text-white">What you get with {c.eyebrow}</h2>
          </div>
          <div className="space-y-20 md:space-y-28">
            {c.highlights.map((h, i) => {
              const Icon = ICONS[h.icon]
              const flip = i % 2 === 1
              return (
                <div key={h.title} id={`benefit-${i}`} className="scroll-mt-28 grid lg:grid-cols-12 gap-8 lg:gap-14 items-center">
                  <div className={`lg:col-span-4 ${flip ? 'lg:order-2' : ''}`}>
                    <div className="w-12 h-12 rounded-xl bg-gg-pink/10 text-gg-pink flex items-center justify-center mb-5">
                      <Icon size={24} />
                    </div>
                    <h3 className="font-display text-2xl md:text-4xl font-bold text-white mb-4">{h.title}</h3>
                    <p className="text-lg text-gg-gray-300 leading-relaxed">{h.body}</p>
                  </div>
                  <div className={`lg:col-span-8 ${flip ? 'lg:order-1' : ''}`}>
                    {h.image && <Shot src={h.image} alt={h.alt || h.title} frame={h.frame || 'browser'} />}
                  </div>
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
          {isFirm && <CorporatePlansLink className="text-center mt-6" />}
          <p className="text-center mt-6">
            <a href="/#pricing" className="text-gg-gray-400 hover:text-gg-pink text-sm transition-colors">Compare all plans</a>
          </p>
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

      {/* Always on screen while scrolling (owner 11/16). The spacer keeps it off the footer. */}
      <div className="h-24" aria-hidden="true" />
      <div className="fixed inset-x-0 bottom-0 z-40 bg-gg-pink">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 md:py-4 pb-[max(12px,env(safe-area-inset-bottom))] flex items-center justify-between md:justify-center gap-4 md:gap-7">
          <span className="text-black text-sm md:text-lg font-semibold leading-snug">
            {c.eyebrow}<span className="hidden md:inline"> · </span><br className="md:hidden" />
            {FREE_LABEL.toLowerCase()}<span className="hidden md:inline">, then {price.amount}/{price.unit}</span>
          </span>
          <Link href={href} className="h-12 md:h-[52px] px-5 md:px-7 rounded-xl bg-black text-white text-base md:text-[17px] font-bold inline-flex items-center hover:bg-gg-gray-800 transition-colors">
            Start Subscription
          </Link>
        </div>
      </div>
    </>
  )
}
