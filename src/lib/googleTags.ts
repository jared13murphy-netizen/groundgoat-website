/**
 * Google Tag Manager — TEDDYco Media Google Search ads (launch 11/23/2026).
 *
 * The container (GTM-M6FXC226) is installed with Google's official snippets in
 * src/components/GoogleTagManager.tsx. Everything Google-side (the Google Ads
 * conversion tag, any GA4 tag) is configured INSIDE the container and listens
 * for the dataLayer events this file pushes:
 *
 *   sign_up   — a new account was just created on /signup (the 30-day free
 *               trial sign-up). Same spot as Meta's CompleteRegistration.
 *   start_trial — Stripe Checkout finished as a 30-day free trial (card on
 *               file, $0 today). The true "trial started" moment; sign_up fires
 *               earlier, before the card step, so some sign_ups never start one.
 *   purchase  — Stripe Checkout finished AND collected money now. Value,
 *               currency and transaction_id (the Stripe Checkout session id)
 *               come from our backend, which reads them from Stripe
 *               (GET /api/subscriptions/checkout-result). A free trial ($0
 *               today) is NOT a purchase and never pushes this.
 *
 * Google Ads purchase conversion for the container's tag:
 *   Conversion ID AW-18571440294, label 6XddCOKw4bsdEKbhxpdF
 *   Trigger: Custom Event "purchase"; value / currency / transaction id from
 *   Data Layer Variables ecommerce.value / ecommerce.currency /
 *   ecommerce.transaction_id.
 *
 * Off on the sandbox site so test sign-ups and test payments never count.
 */

export const GTM_ID = 'GTM-M6FXC226'
export const GOOGLE_ADS_PURCHASE_SEND_TO = 'AW-18571440294/6XddCOKw4bsdEKbhxpdF'

export const GOOGLE_TAGS_ENABLED = process.env.NEXT_PUBLIC_IS_SANDBOX !== 'true'

declare global {
  interface Window {
    dataLayer?: Record<string, unknown>[]
  }
}

function push(event: Record<string, unknown>) {
  if (!GOOGLE_TAGS_ENABLED || typeof window === 'undefined') return
  window.dataLayer = window.dataLayer || []
  window.dataLayer.push(event)
}

/** Call only after /api/auth/register succeeded (a brand-new account). */
export function trackGoogleSignUp() {
  try {
    push({ event: 'sign_up', method: 'email' })
  } catch {
    // Tracking must never break sign-up.
  }
}

export type CheckoutResult = {
  session_id: string
  paid: boolean
  free_trial?: boolean
  value: number
  currency: string
}

const sentKey = (id: string) => `gg_purchase_sent_${id}`

function onceFor(key: string): boolean {
  try {
    if (localStorage.getItem(key)) return false
    localStorage.setItem(key, '1')
  } catch {
    // Storage blocked: count it (Google dedupes purchases on transaction_id).
  }
  return true
}

/** Route the backend's checkout facts to the right event (or none). */
export function trackCheckoutResult(result: CheckoutResult) {
  if (result?.paid) return trackGooglePurchase(result)
  if (result?.free_trial && result.session_id) {
    try {
      if (onceFor(`gg_trial_sent_${result.session_id}`)) {
        push({ event: 'start_trial', checkout_id: result.session_id })
      }
    } catch {
      // Tracking must never break the account page.
    }
  }
  return false
}

/**
 * Push `purchase` once per Stripe Checkout session, and only when Stripe says
 * money was collected. Refreshing the success page does not count it twice
 * (localStorage guard here, transaction_id dedupe on Google's side).
 */
export function trackGooglePurchase(result: CheckoutResult): boolean {
  try {
    if (!result?.paid || !(result.value > 0) || !result.session_id) return false
    if (!onceFor(sentKey(result.session_id))) return false
    push({ ecommerce: null }) // Google's guidance: clear the previous ecommerce object
    push({
      event: 'purchase',
      ecommerce: {
        transaction_id: result.session_id,
        value: result.value,
        currency: result.currency || 'USD',
      },
    })
    return true
  } catch {
    // Tracking must never break the account page.
    return false
  }
}
