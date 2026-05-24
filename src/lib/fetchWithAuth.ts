const API_URL = 'https://practical-serenity-production.up.railway.app'

// Outcome of a refresh attempt:
//   ok        — got a new access token
//   expired   — refresh token was rejected (401) by the backend; the user
//               really IS signed out and we should clear state.
//   transient — network blip or backend 5xx; KEEP the tokens, retry later.
//
// The original implementation collapsed `expired` and `transient` into the
// same path, so any backend hiccup (502 during deploy, network blip, slow
// response) wiped the user's tokens and bounced them to /signin. That was
// the root cause of the "logged out for no reason" reports.
type RefreshResult =
  | { kind: 'ok'; token: string }
  | { kind: 'expired' }
  | { kind: 'transient' }

async function refreshAccessToken(): Promise<RefreshResult> {
  const refreshToken = localStorage.getItem('refresh_token')
  if (!refreshToken) return { kind: 'expired' }

  // HARD TIMEOUT on the refresh fetch — CRITICAL for app-wide reliability.
  // Per user 2026-05-24 incident: when the backend was slow during a
  // scraper OOM, this fetch hung indefinitely. `cachedRefreshPromise`
  // below only clears in its `.finally()` — which never fires while the
  // promise is pending. Every subsequent fetchWithAuth that hit a 401
  // then awaited the dead promise forever, freezing the entire app
  // (staging page stuck on "Loading...", Ignore button spinners eternal,
  // etc). This timeout closes the cascade vector: we ALWAYS settle
  // within 10s, the finally clears the cache, the app stays responsive.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: controller.signal,
    })

    if (response.ok) {
      const data = await response.json()
      localStorage.setItem('auth_token', data.access_token)
      if (data.refresh_token) {
        localStorage.setItem('refresh_token', data.refresh_token)
      }
      return { kind: 'ok', token: data.access_token }
    }

    // Critical distinction:
    //   401 = the refresh token itself is invalid/expired → really signed out
    //   anything else (502, 503, 504, network error) = transient. KEEP the
    //   tokens. Otherwise every backend hiccup wipes the session and forces
    //   a re-login.
    if (response.status === 401) {
      localStorage.removeItem('auth_token')
      localStorage.removeItem('refresh_token')
      localStorage.removeItem('user')
      return { kind: 'expired' }
    }
    console.warn(`Token refresh got HTTP ${response.status} — keeping tokens, will retry on next request`)
    return { kind: 'transient' }
  } catch (error) {
    // AbortError (10s timeout) or any other fetch failure (network error,
    // DNS, etc.) — all treated as transient so we DON'T wipe the user's
    // tokens. The promise still SETTLES here, which is the whole point —
    // the outer .finally() can now clear cachedRefreshPromise and the
    // next request gets a fresh refresh attempt instead of awaiting a
    // dead promise.
    const isAbort = (error as Error)?.name === 'AbortError'
    console.warn(
      isAbort
        ? 'Token refresh hit 10s timeout — keeping tokens, will retry on next request'
        : `Token refresh network error — keeping tokens, will retry: ${error}`
    )
    return { kind: 'transient' }
  } finally {
    clearTimeout(timeoutId)
  }
}

let cachedRefreshPromise: Promise<RefreshResult> | null = null

// Hard timeout on every fetchWithAuth call. Per user 2026-05-24
// incident #2: PT staging spinner stuck forever on refresh. checkAuth
// or fetchStagingListings was hanging silently — no error logged, no
// timeout, never reaching the .finally() that turns the spinner off.
// Native `fetch` will wait indefinitely for the response body if the
// server/network drops mid-stream (or under flaky CORS conditions),
// and the `setLoading(false)` in the caller never runs.
//
// 20s is generous for every endpoint we have (the slowest, the
// staging-list join, returns in 1-2s in practice). Anything beyond
// 20s is a stuck request and we want to fail-fast so the caller's
// `finally` can clear the spinner and show a Retry button.
const DEFAULT_TIMEOUT_MS = 20_000

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  // Respect a caller-supplied AbortSignal — only stack our own
  // timeout on top if none is provided.
  if (init.signal) {
    return fetch(url, init)
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('auth_token')

  const headers = new Headers(options.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response = await fetchWithTimeout(url, { ...options, headers }, DEFAULT_TIMEOUT_MS)

  // Only attempt refresh on 401 (token actually rejected). 502/503/504 are
  // backend transients — we surface them to the caller so the UI can show
  // a retry / spinner instead of bouncing to /signin.
  if (response.status === 401 && localStorage.getItem('refresh_token')) {
    // De-dupe simultaneous refreshes via a shared promise.
    if (!cachedRefreshPromise) {
      cachedRefreshPromise = refreshAccessToken().finally(() => {
        cachedRefreshPromise = null
      })
    }
    const result = await cachedRefreshPromise

    if (result.kind === 'ok') {
      headers.set('Authorization', `Bearer ${result.token}`)
      response = await fetchWithTimeout(url, { ...options, headers }, DEFAULT_TIMEOUT_MS)
    } else if (result.kind === 'expired') {
      // Genuinely signed out. Skip redirect when we're already on /signin
      // so we don't create a redirect loop.
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/signin')) {
        window.location.href = '/signin'
      }
    }
    // result.kind === 'transient' → return the original 401 response. We
    // DO NOT wipe tokens or redirect; the caller surfaces the error.
  }

  return response
}

export default fetchWithAuth
