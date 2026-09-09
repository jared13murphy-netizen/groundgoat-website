import { NextResponse } from 'next/server'

// iOS Universal Links association file for /go share links (see
// src/app/go/page.tsx). Must be served at exactly this path, over HTTPS,
// with Content-Type application/json and NO redirects — a static file
// under public/ risks the wrong content-type/extension handling, so this
// is a route handler instead.
//
// TEAM ID: could not be determined from the mobile repo in this session —
// there's no DEVELOPMENT_TEAM in ios/GroundGoat.xcodeproj/project.pbxproj,
// no .mobileprovision for com.landresult.landresult on this machine (only
// unrelated com.eventergo.eventer profiles were found under
// ~/Library/MobileDevice/Provisioning Profiles), and `eas credentials
// --platform ios` needs an interactive terminal (it errors immediately in
// this non-interactive shell: "Input is required, but stdin is not
// readable"). Set the APPLE_TEAM_ID env var on Railway (Apple Developer
// account → Membership → Team ID, 10 alphanumeric chars) — until then this
// serves a clearly-invalid placeholder that will fail Apple's association
// check, so Universal Links won't silently misbehave, they just won't
// activate.
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID || 'REPLACE_WITH_APPLE_TEAM_ID'
const BUNDLE_ID = 'com.landresult.landresult'

export async function GET() {
  const body = {
    applinks: {
      apps: [],
      details: [
        {
          appID: `${APPLE_TEAM_ID}.${BUNDLE_ID}`,
          paths: ['/go', '/go?*'],
        },
      ],
    },
  }

  return NextResponse.json(body, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
