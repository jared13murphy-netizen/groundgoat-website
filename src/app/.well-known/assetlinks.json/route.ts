import { NextResponse } from 'next/server'

// Android App Links verification file for /go share links (see
// src/app/go/page.tsx). Must be served at exactly this path, over HTTPS,
// with Content-Type application/json.
//
// Two fingerprints are served (2026-09-09):
//   1. Google Play's app-signing key (37:25:...) — read from Play Console → App signing →
//      Digital Asset Links JSON. Every build installed from Google Play is signed with this.
//   2. Our upload key (03:54:...) — used for AABs we upload and for local release builds.
// ANDROID_RELEASE_SHA256 (comma-separated) overrides both if it is ever set.
const ANDROID_SHA256_LIST = (process.env.ANDROID_RELEASE_SHA256 || '37:25:55:F8:DE:C7:D0:88:B9:D2:56:C6:83:D8:3F:25:53:A7:C2:AE:1E:5A:EC:4E:A8:7C:72:6A:3E:FE:6F:21,03:54:88:DD:38:AD:69:47:38:1B:D0:36:2E:51:25:5F:23:97:11:1A:A8:B9:15:A6:24:1E:DC:A3:F4:C7:3B:BF').split(',').map((s) => s.trim()).filter(Boolean)
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
