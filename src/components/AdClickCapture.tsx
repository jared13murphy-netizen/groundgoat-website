'use client'

/**
 * Keeps the Google Ads click id (gclid / gbraid / wbraid) a visitor arrived
 * with, so sign-up can send it to the backend for conversion matching
 * (src/lib/googleTags.ts → captureAdClick / adClickForSignup), and the
 * first-touch source (src/lib/firstTouch.ts) for the Command Center.
 */

import { useEffect } from 'react'
import { captureAdClick } from '@/lib/googleTags'
import { captureFirstTouch } from '@/lib/firstTouch'

export default function AdClickCapture() {
  useEffect(() => {
    captureAdClick()
    // Where the visitor first came from (Command Center ads by platform).
    captureFirstTouch(null, window.location.search, document.referrer, window.location.hostname)
  }, [])
  return null
}
