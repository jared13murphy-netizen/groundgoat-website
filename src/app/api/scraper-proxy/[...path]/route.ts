import { NextRequest, NextResponse } from 'next/server'

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://practical-serenity-production.up.railway.app'

const SCRAPER_URL =
  process.env.SCRAPER_URL ||
  'https://ground-goat-scraper-production.up.railway.app'

const SCRAPER_SECRET = process.env.SCRAPER_SECRET || ''

// Auth check should be quick; the scraper call is async (returns a job_id
// immediately) so it should also be quick. Without these caps a hung upstream
// made the function hang until the platform killed it with NO response, which
// the browser surfaced as a bare, useless "Failed to fetch".
const AUTH_TIMEOUT_MS = 12_000
const UPSTREAM_TIMEOUT_MS = 90_000

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Verify the incoming request carries a valid GG admin token.
 * We forward the Authorization header to the backend /api/auth/me and
 * confirm the returned user has account_type === 'groundgoat_admin'.
 * Returns the token string if valid, null otherwise.
 */
type AuthResult =
  | { ok: true; token: string }
  | { ok: false; status: number; error: string }

async function verifyAdmin(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Not signed in (no auth token).' }
  const token = authHeader.slice(7)
  if (!token) return { ok: false, status: 401, error: 'Not signed in (empty auth token).' }

  try {
    const meRes = await fetchWithTimeout(
      `${API_URL}/api/auth/me`,
      { headers: { Authorization: `Bearer ${token}` } },
      AUTH_TIMEOUT_MS,
    )
    if (!meRes.ok) return { ok: false, status: 401, error: 'Session expired or invalid — sign in again.' }
    const user = await meRes.json()
    if (user?.account_type !== 'groundgoat_admin') return { ok: false, status: 403, error: 'Admin access required.' }
    return { ok: true, token }
  } catch (err: unknown) {
    const isTimeout = (err as { name?: string })?.name === 'AbortError'
    return {
      ok: false,
      status: 503,
      error: isTimeout
        ? 'Auth check timed out — the backend is slow/unreachable. Try again.'
        : 'Auth check failed — the backend is unreachable. Try again.',
    }
  }
}

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Auth gate — must be a GG admin.
  const auth = await verifyAdmin(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  // Reconstruct the scraper path from the catch-all segments.
  const { path } = await params
  const scraperPath = path.join('/')

  // Preserve query string.
  const search = req.nextUrl.search
  const targetUrl = `${SCRAPER_URL}/${scraperPath}${search}`

  // Forward relevant headers, stripping hop-by-hop and host.
  const forwardHeaders: Record<string, string> = {
    'X-Cron-Secret': SCRAPER_SECRET,
  }
  const contentType = req.headers.get('content-type')
  if (contentType) forwardHeaders['Content-Type'] = contentType

  // Read body for methods that carry one.
  const method = req.method.toUpperCase()
  const hasBody = method !== 'GET' && method !== 'HEAD'
  const body = hasBody ? await req.arrayBuffer() : undefined

  let upstreamRes: Response
  try {
    upstreamRes = await fetchWithTimeout(
      targetUrl,
      {
        method,
        headers: forwardHeaders,
        body: body as BodyInit | undefined,
        // Do not follow redirects blindly — let the scraper's response pass through.
        redirect: 'follow',
      },
      UPSTREAM_TIMEOUT_MS,
    )
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === 'AbortError') {
      return NextResponse.json(
        {
          error: `Scraper timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s — the site may be slow or blocking. The job may still be finishing; hit Refresh, or check the scraper logs.`,
        },
        { status: 504 },
      )
    }
    console.error('[scraper-proxy] upstream fetch failed:', err)
    return NextResponse.json(
      { error: `Scraper unreachable: ${(err as { message?: string })?.message || 'network error'}` },
      { status: 502 },
    )
  }

  // Stream the response back.
  const responseHeaders = new Headers()
  const passthroughHeaders = [
    'content-type',
    'cache-control',
    'x-request-id',
    'x-correlation-id',
  ]
  for (const h of passthroughHeaders) {
    const v = upstreamRes.headers.get(h)
    if (v) responseHeaders.set(h, v)
  }

  const responseBody = await upstreamRes.arrayBuffer()
  return new NextResponse(responseBody, {
    status: upstreamRes.status,
    headers: responseHeaders,
  })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
