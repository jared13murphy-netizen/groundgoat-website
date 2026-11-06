// Canonical Ground Goat pricing. Single source of truth for the website.
// Mirrors the backend list (plan_pricing.py, GET /api/pricing).
//
// Owner 2026-11-06: Basic State and Premium State are billed MONTHLY or
// ANNUALLY (the person chooses) — a first-state price plus a lower price for
// each additional state, 1-5 states. Annual is exactly 12 x monthly (no
// annual discount). 30-day free trial on every plan. Management Firm is
// unchanged (annual).

export type BillingCycle = 'monthly' | 'annual'

export const MAX_STATES = 5

export const PRICING = {
  basic_state: {
    name: 'Basic State',
    // first state / each additional state
    monthly: { first: 5, additional: 2.5 },
    annual: { first: 60, additional: 30 },
    description: 'For active land investors',
    features: [
      'Full state coverage (all counties)',
      'Upcoming land sale alerts',
      'Sale results access',
      'Historical data access',
      'Priority notifications',
      'Mobile app access',
    ],
    trialDays: 30,
    trialLabel: '30-day free trial',
  },
  premium_state: {
    name: 'Premium State',
    monthly: { first: 39, additional: 19.5 },
    annual: { first: 468, additional: 234 },
    description: 'For data-driven land professionals',
    features: [
      'Everything in Basic State',
      'Goat Search — AI land search in plain English',
      'Interactive map with soil & elevation data',
      'Comparable sales reports',
      'Advanced land analytics',
    ],
    trialDays: 30,
    trialLabel: '30-day free trial',
  },
  firm: {
    name: 'Management Firm',
    annualBase: 2400,
    annualPerAdditionalUser: 119.88, // $9.99/mo, billed annually
    includedUsers: 3,
    maxUsers: 10,
    description: 'For teams and professionals',
    features: [
      'Unlimited states & counties',
      'Goat Search — AI land search in plain English',
      'Up to 3 team members included',
      'Desktop access with advanced maps',
      'County & township analytics',
      'Comparable sales reports',
      'Priority support',
    ],
    trialDays: 30,
    trialLabel: '30-day free trial',
  },
} as const

export type PlanKey = keyof typeof PRICING

export const SALES_CONTACT_EMAIL = 'info@groundgoat.com'

export type StatePlanKey = 'basic_state' | 'premium_state'

// Whole price per cycle for this many states: first state + each additional.
export function planTotal(plan: StatePlanKey, cycle: BillingCycle, states: number): number {
  if (states < 1) return 0
  const p = PRICING[plan][cycle]
  return Math.round((p.first + p.additional * (states - 1)) * 100) / 100
}

// Price of one more state on top of what the person already has.
export function additionalStatePrice(plan: StatePlanKey, cycle: BillingCycle): number {
  return PRICING[plan][cycle].additional
}

export function cycleUnit(cycle: BillingCycle): string {
  return cycle === 'monthly' ? 'mo' : 'yr'
}

// Format a number as a price string, trimming the cents when whole.
export function formatPrice(amount: number): string {
  return Number.isInteger(amount) ? amount.toLocaleString('en-US') : amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
