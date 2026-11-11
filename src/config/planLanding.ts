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
      { icon: 'bell', title: 'Never miss a sale', body: 'Get notified when new land auctions are listed in the areas you care about.' },
      { icon: 'calendar', title: 'Every upcoming auction', body: 'See what is selling, where and when, across every county in your state.' },
      { icon: 'history', title: 'What land really sold for', body: 'Sale results and historical sales so you know the market before you bid.' },
      { icon: 'phone', title: 'In your pocket', body: 'The Ground Goat app goes with you to the sale, the field and the bank.' },
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
      { icon: 'layers', title: 'Soil and tillable acres', body: 'See the soil rating and tillable acres for any parcel, plus elevation and map layers.' },
      { icon: 'report', title: 'Comparable sales reports', body: 'Build a professional Land Report from nearby sales and download or email it as a PDF.' },
      { icon: 'search', title: 'Goat Search', body: 'Ask in plain English, like "80+ acre farms sold in Adams County this year", and get the answer.' },
      { icon: 'chart', title: 'Advanced land analytics', body: 'Price per acre, per tillable acre and per soil point, side by side.' },
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
      { icon: 'map', title: 'Unlimited states and counties', body: 'Your whole team sees every auction, sale and parcel, nationwide.' },
      { icon: 'users', title: '3 team members included', body: 'Add up to 10 people. Everyone works from the same data.' },
      { icon: 'folder', title: 'Saved projects, shared', body: 'Save reports as projects and share them with your teammates.' },
      { icon: 'notes', title: 'Notes your team can see', body: 'Dated notes on every parcel and tract, visible to your firm and printed on your reports.' },
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
