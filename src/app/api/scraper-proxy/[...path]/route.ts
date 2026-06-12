import { NextRequest, NextResponse } from 'next/server'

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  'https://practical-serenity-production.up.railway.app'

const SCRAPER_URL =
  process.env.SCRAPER_URL ||
  'https://ground-goat-scraper-production.up.railway.app'

const SCRAPER_SECRET = process.env.SCRAPER_SECRET || ''

/**
 * Verify the incoming request carries a valid GG admin token.
 * We forward the Authorization header to the backend /api/auth/me and
 * confirm the returned user has account_type === 'groundgoat_admin'.
 * Returns the token string if valid, null otherwise.
 */
async function verifyAdmin(req: NextRequest): Promise<string | null> {
  const authHeader = req.headers.get('authorization') || ''
  if (!authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  if (!token) return null

  try {
    const meRes = await fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!meRes.ok) return null
    const user = await meRes.json()
    if (user?.account_type !== 'groundgoat_admin') return null
    return token
  } catch {
    return null
  }
}

async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  // Auth gate — must be a GG admin.
  const token = await verifyAdmin(req)
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
    upstreamRes = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body: body as BodyInit | undefined,
      // Do not follow redirects blindly — let the scraper's response pass through.
      redirect: 'follow',
    })
  } catch (err) {
    console.error('[scraper-proxy] upstream fetch failed:', err)
    return NextResponse.json({ error: 'Scraper unreachable' }, { status: 502 })
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
