'use client'

// The saved comp-card thumbnail (owner 2026-10-27): aerial with the
// boundary in pink and the tillable ground in green, pre-rendered by the
// backend and served from the CDN. `/api/card-image/{kind}/{id}` redirects
// to the file when it exists and returns 404 (after queueing a render)
// when it does not. Cards are pre-rendered for every tract and every
// recent sale, so the image is normally there on first paint; for a card
// that is not, a placeholder holds the spot and the image is re-asked for
// every 2.5 s for ~25 s, so it fills in on its own without a reload. No
// request ever waits on a render.

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'
const RETRY_MS = 2500
const MAX_TRIES = 10

interface Props {
  kind: 'tract' | 'parcel'
  id: string | null | undefined
  size?: number
  className?: string
}

export default function CardThumb({ kind, id, size = 72, className = '' }: Props) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<'loading' | 'ok' | 'gone'>('loading')

  useEffect(() => { setAttempt(0); setState('loading') }, [kind, id])

  useEffect(() => {
    if (state !== 'loading' || attempt === 0) return
    if (attempt >= MAX_TRIES) { setState('gone'); return }
    const t = setTimeout(() => setAttempt(a => a + 1), RETRY_MS)
    return () => clearTimeout(t)
  }, [attempt, state])

  if (!id || state === 'gone') return null
  const src = `${API_URL}/api/card-image/${kind}/${encodeURIComponent(id)}${attempt ? `?r=${attempt}` : ''}`
  return (
    <div
      className={`relative rounded-lg overflow-hidden shrink-0 border border-white/10 bg-white/[0.04] ${className}`}
      style={{ width: size, height: size }}
    >
      <img
        key={src}
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onLoad={() => setState('ok')}
        onError={() => { if (attempt === 0) setAttempt(1) }}
        className="w-full h-full object-cover"
        style={{ opacity: state === 'ok' ? 1 : 0, transition: 'opacity 200ms' }}
      />
    </div>
  )
}
