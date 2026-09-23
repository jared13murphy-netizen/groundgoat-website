import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

/** The firm's report identity (name + logo). Backed by /api/firms/branding,
 *  which any firm admin may use — no mapping add-on needed — and which
 *  writes the same two columns the report PDFs read. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithAuth(`${API_URL}${path}`, init)
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try { const body = await res.json(); if (body?.detail) detail = String(body.detail) } catch { /* keep default */ }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}

export function getFirmBranding() {
  return j<{ name: string | null; has_logo: boolean }>('/api/firms/branding')
}

export function setFirmBranding(patch: { name?: string; logo_base64?: string }) {
  return j<{ ok: true }>('/api/firms/branding', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** Current logo as a blob URL (the endpoint needs the bearer token, so a
 *  plain <img src> can't fetch it). Null when there is none. Caller
 *  revokes the URL when done. */
export async function fetchFirmLogoUrl(cacheBust?: number): Promise<string | null> {
  try {
    const qs = cacheBust ? `?v=${cacheBust}` : ''
    const res = await fetchWithAuth(`${API_URL}/api/firms/branding/logo${qs}`)
    if (!res.ok) return null
    return URL.createObjectURL(await res.blob())
  } catch {
    return null
  }
}

/** Read an image file the user picked as a data URL, enforcing the same
 *  2 MB / PNG-or-JPEG rules the API applies. */
export function readLogoFile(file: File): Promise<string> {
  if (file.size > MAX_LOGO_BYTES) {
    return Promise.reject(new Error('That logo is too big — please use an image under 2 MB.'))
  }
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    return Promise.reject(new Error('Logos must be a PNG or JPEG image.'))
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}
