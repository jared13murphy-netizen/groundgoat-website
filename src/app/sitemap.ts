import type { MetadataRoute } from 'next'

// sitemap.xml (Search Console 11/15). Public pages only; signed-in and admin
// pages are kept out (see robots.ts). Sandbox lists nothing.
const IS_SANDBOX = process.env.NEXT_PUBLIC_IS_SANDBOX === 'true'
const BASE = 'https://www.groundgoat.com'

const PUBLIC_PATHS = [
  '/',
  '/basic-state',
  '/premium-state',
  '/management-firm',
  '/image-gallery',
  '/contact',
  '/privacy',
  '/terms',
  '/signup',
]

export default function sitemap(): MetadataRoute.Sitemap {
  if (IS_SANDBOX) return []
  return PUBLIC_PATHS.map((path) => ({ url: path === '/' ? BASE : `${BASE}${path}` }))
}
