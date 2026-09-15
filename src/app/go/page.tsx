'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

// Same gate /access itself uses (src/app/access/page.tsx ALLOWED_ROLES) —
// only these account types have an Explore map on the website at all.
// Individual mobile subscribers ('individual' etc.) don't get a web Explore
// map today, so they fall through to the "get the app" page below even when
// signed in — that's correct, not a bug: there's nowhere on groundgoat.com
// to send them yet.
const ALLOWED_ROLES = ['groundgoat_admin', 'groundgoat_sales', 'firm_admin', 'firm_user']

// The app's real custom URL scheme, per ios/GroundGoat/Info.plist
// CFBundleURLTypes (NOT the Expo OTA scheme "exp+ground-goat-mobile", and
// NOT app.json — this app.json has no top-level "scheme" key at all right
// now, so Linking.createURL()-style deep links aren't wired up on the RN
// side yet either). Bundle/package id: com.landresult.landresult (iOS) /
// com.groundgoat.app (Android).
const APP_SCHEME = 'com.landresult.landresult'

const APP_STORE_URL = 'https://apps.apple.com/us/app/ground-goat/id6753321116'
// Not yet known to be live — see Footer.tsx ("Android isn't published yet").
// Task-supplied fallback; swap for the real Play listing once it exists.
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.groundgoat.app'

function buildAppSchemeUrl(params: URLSearchParams): string {
  return `${APP_SCHEME}://go?${params.toString()}`
}

function GoPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [checking, setChecking] = useState(true)
  const [showGetApp, setShowGetApp] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function run() {
      const lat = searchParams.get('lat')
      const lng = searchParams.get('lng')
      const z = searchParams.get('z')
      const pin = searchParams.get('pin')
      const area = searchParams.get('area')

      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
      if (!token || !lat || !lng) {
        if (!cancelled) { setShowGetApp(true); setChecking(false) }
        return
      }

      try {
        const response = await fetchWithAuth(`${API_URL}/api/auth/me`)
        if (!response.ok) throw new Error('not authenticated')
        const userData = await response.json()
        if (!ALLOWED_ROLES.includes(userData.account_type)) throw new Error('not entitled')

        // Signed in + entitled: hand off to the Explore map. /access reads
        // focusLat/focusLng/focusZoom (see PinCardSheet.js's existing share
        // link) — z maps onto focusZoom, pin/area pass through unchanged so
        // /access can drop a pin marker or draw the shared area.
        const qs = new URLSearchParams()
        qs.set('focusLat', lat)
        qs.set('focusLng', lng)
        if (z) qs.set('focusZoom', z)
        if (area) qs.set('area', area)
        else if (pin) qs.set('pin', pin)

        if (!cancelled) router.replace(`/access?${qs.toString()}`)
      } catch {
        if (!cancelled) { setShowGetApp(true); setChecking(false) }
      }
    }

    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (checking) {
    return (
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gg-pink border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!showGetApp) return null

  const appSchemeParams = new URLSearchParams()
  ;['lat', 'lng', 'z', 'pin', 'area'].forEach((key) => {
    const v = searchParams.get(key)
    if (v) appSchemeParams.set(key, v)
  })
  const appDeepLink = buildAppSchemeUrl(appSchemeParams)

  return (
    <div className="min-h-screen bg-gg-black flex items-center justify-center px-6 py-16">
      <div className="max-w-sm w-full mx-auto text-center">
        <Link href="/" className="inline-block mb-8">
          <Image src="/logo.png" alt="Ground Goat" width={150} height={50} className="h-12 w-auto mx-auto" />
        </Link>

        <h1 className="font-display text-2xl font-bold text-white mb-3">
          Someone shared a spot on Ground Goat with you
        </h1>
        <p className="text-gg-gray-400 mb-8">
          Get the app to see it on the map.
        </p>

        <div className="flex flex-col gap-3 mb-6">
          <a
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-gg-gray-800 hover:bg-gg-gray-700 transition-colors px-4 py-3 rounded-lg border border-gg-gray-700"
          >
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.71 19.5C17.88 20.74 17 21.95 15.66 21.97C14.32 22 13.89 21.18 12.37 21.18C10.84 21.18 10.37 21.95 9.1 22C7.79 22.05 6.8 20.68 5.96 19.47C4.25 17 2.94 12.45 4.7 9.39C5.57 7.87 7.13 6.91 8.82 6.88C10.1 6.86 11.32 7.75 12.11 7.75C12.89 7.75 14.37 6.68 15.92 6.84C16.57 6.87 18.39 7.1 19.56 8.82C19.47 8.88 17.39 10.1 17.41 12.63C17.44 15.65 20.06 16.66 20.09 16.67C20.06 16.74 19.67 18.11 18.71 19.5ZM13 3.5C13.73 2.67 14.94 2.04 15.94 2C16.07 3.17 15.6 4.35 14.9 5.19C14.21 6.04 13.07 6.7 11.95 6.61C11.8 5.46 12.36 4.26 13 3.5Z"/>
            </svg>
            <span className="text-sm font-medium text-white">Download on the App Store</span>
          </a>

          <a
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-gg-gray-800 hover:bg-gg-gray-700 transition-colors px-4 py-3 rounded-lg border border-gg-gray-700"
          >
            <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/>
            </svg>
            <span className="text-sm font-medium text-white">Get it on Google Play</span>
          </a>
        </div>

        <a
          href={appDeepLink}
          className="block text-gg-pink hover:underline text-sm font-medium mb-8"
        >
          Already have the app? Open in the app
        </a>

        <p className="text-gg-gray-500 text-sm">
          Already signed in?{' '}
          <Link href="/signin" className="text-gg-pink hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  )
}

export default function GoPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gg-pink border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <GoPageInner />
    </Suspense>
  )
}
