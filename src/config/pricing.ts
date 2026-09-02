// Canonical Ground Goat pricing. Single source of truth for the website.
//
// All plans are billed ANNUALLY. The Monthly/Annual toggle in the UI is
// display-only: "monthly" simply shows the annual price divided by 12. The
// billing_cycle sent to the backend is always 'annual' for these plans.

export const PRICING = {
  basic_state: {
    name: 'Basic State',
    annualPerState: 99,
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
    annualPerState: 500,
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
      'Configurable Mapping available as a per-user add-on',
    ],
    // Sold per user, per year, on top of the plan — a firm admin turns it
    // on for whichever users need it from the team page. Not offered at
    // signup because it is priced per user and no users exist yet.
    configurableMappingAnnualPerUser: 595,
    trialDays: 30,
    trialLabel: '30-day free trial',
  },
} as const

export type PlanKey = keyof typeof PRICING

export const SALES_CONTACT_EMAIL = 'info@groundgoat.com'

// Display-only conversion. Billing is always annual; "monthly" = annual / 12.
export function displayPrice(annual: number, cycle: 'monthly' | 'annual'): number {
  return cycle === 'annual' ? annual : annual / 12
}

// Format a number as a price string, trimming the cents when whole.
export function formatPrice(amount: number): string {
  return Number.isInteger(amount) ? amount.toString() : amount.toFixed(2)
}

export function displayPriceLabel(annual: number, cycle: 'monthly' | 'annual'): string {
  return formatPrice(displayPrice(annual, cycle))
}
