import { NextResponse } from 'next/server'

// Android App Links verification file for /go share links (see
// src/app/go/page.tsx). Must be served at exactly this path, over HTTPS,
// with Content-Type application/json.
//
// SHA-256 FINGERPRINT: could not be determined in this session —
// `eas credentials --platform android` needs an interactive terminal (same
// "stdin is not readable" error as the iOS lookup) and no local Android
// signing key/keystore was found on this machine. Set the
// ANDROID_RELEASE_SHA256 env var on Railway (from `eas credentials -p
// android` → your build credentials → SHA256 Fingerprint, or the Play
// Console's App signing page — colon-separated hex, e.g.
// "14:6D:E9:83:...") — until then this serves a clearly-invalid
// placeholder so App Links verification fails closed rather than silently
// mis-associating.
const ANDROID_SHA256 = process.env.ANDROID_RELEASE_SHA256 || 'REPLACE_WITH_ANDROID_RELEASE_SHA256_FINGERPRINT'
const PACKAGE_NAME = 'com.groundgoat.app'

export async function GET() {
  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: PACKAGE_NAME,
        sha256_cert_fingerprints: [ANDROID_SHA256],
      },
    },
  ]

  return NextResponse.json(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
