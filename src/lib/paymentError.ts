/**
 * Payment-step errors (owner 11/23): a customer must never see a raw or
 * "internal" error while paying. Messages written for the customer (e.g.
 * "This email is already registered") are thrown as CustomerMessage and
 * shown as-is; anything else (network drop, server fault, unexpected reply)
 * shows PAYMENT_ERROR_MESSAGE, and is reported so the owner is emailed.
 */
export const PAYMENT_ERROR_MESSAGE =
  "We're sorry — something went wrong on our end while setting up your payment. " +
  "Our team has been notified and is fixing it right away. Please try again in a " +
  "few minutes, or email info@groundgoat.com and we'll get you set up personally."

export class CustomerMessage extends Error {}

const LOOKS_INTERNAL = /internal|server error|failed to fetch|load failed|network|unexpected token|json|undefined|null/i

export function paymentErrorText(err: unknown): string {
  if (err instanceof CustomerMessage && err.message && !LOOKS_INTERNAL.test(err.message)) {
    return err.message
  }
  return PAYMENT_ERROR_MESSAGE
}

/** Tell the backend (which emails the owner). Never throws. */
export function reportPaymentError(apiUrl: string, token: string | null, err: unknown): void {
  if (err instanceof CustomerMessage || !token) return
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  fetch(`${apiUrl}/api/signup-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ step: 'stripe_checkout', status: 'error', source: 'website', error_message: detail.slice(0, 480) }),
  }).catch(() => {})
}
