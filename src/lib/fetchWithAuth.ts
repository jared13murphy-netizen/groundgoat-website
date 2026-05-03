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

  try {
    const response = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
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
    // Network error / DNS / fetch threw — also transient, NOT a logout.
    console.warn('Token refresh network error — keeping tokens, will retry:', error)
    return { kind: 'transient' }
  }
}

let cachedRefreshPromise: Promise<RefreshResult> | null = null

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('auth_token')

  const headers = new Headers(options.headers || {})
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response = await fetch(url, { ...options, headers })

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
      response = await fetch(url, { ...options, headers })
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
