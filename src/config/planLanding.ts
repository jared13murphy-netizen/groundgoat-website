// Landing pages, one per subscription level (owner 11/11). These are the
// pages we advertise and the pages the homepage pricing cards open. Prices
// and feature lists come from pricing.ts so there is one source; this file
// only holds each page's words.
//
// Copy rules (owner): benefits, not tutorials; never "Explore map"; the
// 30-day free period is "30 Days Free", never "trial".

import type { PlanKey } from './pricing'

export interface PlanHighlight {
  icon: 'bell' | 'calendar' | 'history' | 'phone' | 'layers' | 'search' | 'report' | 'chart' | 'users' | 'notes' | 'folder' | 'map'
  title: string
  body: string
  /** Product screenshot for this benefit (public/landing/…). */
  image?: string
  /** 'browser' = desktop screenshot in a window frame, 'phone' = app screenshot. */
  frame?: 'browser' | 'phone' | 'doc'
  alt?: string
}

export interface PlanLandingContent {
  plan: PlanKey
  slug: string
  pageTitle: string
  metaDescription: string
  eyebrow: string
  headline: string
  headlineAccent: string
  subhead: string
  audience: string
  highlights: PlanHighlight[]
  faq: { q: string; a: string }[]
}

const COMMON_FAQ = [
  { q: 'When am I charged?', a: 'Not for 30 days. Your first charge comes when your 30 days free end, and you can cancel any time before then.' },
  { q: 'Can I cancel?', a: 'Yes, any time from your account. You keep access until the end of the period you have paid for.' },
]

export const PLAN_LANDING: Record<PlanKey, PlanLandingContent> = {
  basic_state: {
    plan: 'basic_state',
    slug: 'basic-state',
    pageTitle: 'Basic State | Ground Goat',
    metaDescription: 'Every land auction and sale in your state, with alerts the moment new ground is listed. 30 days free.',
    eyebrow: 'Basic State',
    headline: 'Every land sale in your state,',
    headlineAccent: 'the moment it posts.',
    subhead: 'Upcoming auctions, sale results and years of history for every county in your state, in one place, with alerts when new ground comes up.',
    audience: 'For farmers and land investors watching their state',
    highlights: [
      { icon: 'calendar', title: 'Every upcoming auction', body: 'See every land auction in your state on one map: where it is, who is selling it, and a countdown to sale day.', image: '/landing/basic-auctions.jpg', alt: 'Upcoming land auctions on the Ground Goat map' },
      { icon: 'history', title: 'What land really sold for', body: 'Sale results with price per acre the day they post, plus years of history, so you know the market before you bid.', image: '/landing/basic-results.jpg', alt: 'Recent auction results with price per acre' },
      { icon: 'map', title: 'Every detail in one tap', body: 'Acres, tillable acres, soil rating, the boundary on aerial imagery and the auction company, for every tract.', image: '/landing/basic-detail.jpg', alt: 'Auction detail with acres, tillable acres and price per acre' },
      { icon: 'bell', title: 'In your pocket, with alerts', body: 'The Ground Goat app goes with you to the sale, the field and the bank, and tells you when new ground is listed.', image: '/landing/basic-app.jpg', frame: 'phone', alt: 'Ground Goat app showing upcoming auctions' },
    ],
    faq: [
      ...COMMON_FAQ,
      { q: 'Can I add more states?', a: 'Yes. Choose up to 5 states. Each state after your first is half price.' },
    ],
  },
  premium_state: {
    plan: 'premium_state',
    slug: 'premium-state',
    pageTitle: 'Premium State | Ground Goat',
    metaDescription: 'Soil ratings, comparable sales reports and AI land search for every acre in your state. 30 days free.',
    eyebrow: 'Premium State',
    headline: 'Know what the ground is worth',
    headlineAccent: 'before you bid.',
    subhead: 'Everything in Basic State, plus soil ratings, tillable acres, comparable sales reports and Goat Search, so you can price any farm in minutes.',
    audience: 'For data-driven buyers, sellers and land professionals',
    highlights: [
      { icon: 'layers', title: 'Soil and tillable acres for any parcel', body: 'Tap any parcel to see its owner, tillable acres, soil rating and crops planted, with soil maps and map layers on top.', image: '/landing/premium-soils.jpg', alt: 'Soil map with parcel details: tillable acres, soil rating and crops planted' },
      { icon: 'chart', title: 'Comparable sales in minutes', body: 'Pick nearby sales on the map. Totals and averages for price per acre, per tillable acre and per soil point build as you go.', image: '/landing/premium-comps.jpg', alt: 'Comparable sales report with averages' },
      { icon: 'report', title: 'A Land Report you can hand to anyone', body: 'Download or email a professional PDF with maps, soils, sale details and your notes.', image: '/landing/premium-land-report.jpg', frame: 'doc', alt: 'Ground Goat Land Report PDF' },
      { icon: 'search', title: 'Goat Search', body: 'Ask in plain English, like "How many acres are going to auction in Nebraska this month?", and get the answer.', image: '/landing/premium-goat-search.jpg', alt: 'Goat Search answering a question about upcoming auctions' },
    ],
    faq: [
      ...COMMON_FAQ,
      { q: 'Can I add more states?', a: 'Yes. Choose up to 5 states. Each state after your first is half price.' },
      { q: 'Is the app included?', a: 'Yes. Your subscription works on the website and in the Ground Goat app.' },
    ],
  },
  firm: {
    plan: 'firm',
    slug: 'management-firm',
    pageTitle: 'Management Firm | Ground Goat',
    metaDescription: 'Ground Goat for your whole team: every state, comparable sales reports, shared projects and notes. 30 days free.',
    eyebrow: 'Management Firm',
    headline: 'One subscription',
    headlineAccent: 'for your whole team.',
    subhead: 'Every state and county, comparable sales reports, saved projects and shared notes, built for farm managers, lenders and appraisers.',
    audience: 'For farm management, lending and appraisal teams',
    highlights: [
      { icon: 'map', title: 'Unlimited states and counties', body: 'Your whole team sees every auction, sale and parcel, in every state we cover.', image: '/landing/firm-map.jpg', alt: 'Ground Goat map across the Midwest' },
      { icon: 'folder', title: 'Saved projects, shared', body: 'Save a report as a project: the subject farm, its comparable sales and the report, together on the map and shared with your team.', image: '/landing/firm-projects.jpg', alt: 'Saved project with its farms and Land Report' },
      { icon: 'notes', title: 'Notes your whole team can see', body: 'Dated notes on every parcel and tract: field visits, harvest, loan reviews. Visible to your firm and printed on your reports.', image: '/landing/firm-notes.jpg', alt: 'Dated team notes on a parcel' },
      { icon: 'users', title: '3 team members included', body: 'Add up to 10 people and manage them yourself. Everyone works from the same data.', image: '/landing/firm-team.jpg', alt: 'Team management page' },
    ],
    faq: [
      ...COMMON_FAQ,
      { q: 'How many people can use it?', a: '3 team members are included. Add more, up to 10, for $9.99 a month each, billed annually.' },
      { q: 'Can we pay by invoice or ACH?', a: 'Yes. Firms can pay by card or bank transfer (ACH).' },
    ],
  },
}

export const PLAN_LANDING_PATH: Record<PlanKey, string> = {
  basic_state: `/${PLAN_LANDING.basic_state.slug}`,
  premium_state: `/${PLAN_LANDING.premium_state.slug}`,
  firm: `/${PLAN_LANDING.firm.slug}`,
}
