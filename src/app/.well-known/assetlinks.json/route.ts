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
// Upload-key fingerprint read from the signed 2.1.4 AAB (2026-09-09). Google Play re-signs with its
// own app-signing key: add that certificate's SHA-256 (Play Console → App integrity) via
// ANDROID_RELEASE_SHA256 as a comma-separated list; both are served.
const ANDROID_SHA256_LIST = (process.env.ANDROID_RELEASE_SHA256 || '03:54:88:DD:38:AD:69:47:38:1B:D0:36:2E:51:25:5F:23:97:11:1A:A8:B9:15:A6:24:1E:DC:A3:F4:C7:3B:BF').split(',').map((s) => s.trim()).filter(Boolean)
const PACKAGE_NAME = 'com.groundgoat.app'

export async function GET() {
  const body = [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: PACKAGE_NAME,
        sha256_cert_fingerprints: ANDROID_SHA256_LIST,
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
