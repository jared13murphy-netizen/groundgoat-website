'use client'

/**
 * Keeps the Google Ads click id (gclid / gbraid / wbraid) a visitor arrived
 * with, so sign-up can send it to the backend for conversion matching
 * (src/lib/googleTags.ts → captureAdClick / adClickForSignup).
 */

import { useEffect } from 'react'
import { captureAdClick } from '@/lib/googleTags'

export default function AdClickCapture() {
  useEffect(() => {
    captureAdClick()
  }, [])
  return null
}
