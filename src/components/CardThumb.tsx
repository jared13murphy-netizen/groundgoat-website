'use client'

// The saved comp-card thumbnail (owner 2026-10-27): aerial with the
// boundary in pink and the tillable ground in green, pre-rendered by the
// backend and served from the CDN. `/api/card-image/{kind}/{id}` redirects
// to the file when it exists and returns 404 (after queueing a render)
// when it does not — so the card shows the image when there is one and
// nothing at all otherwise. No request ever waits on a render.

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

interface Props {
  kind: 'tract' | 'parcel'
  id: string | null | undefined
  size?: number
  className?: string
}

export default function CardThumb({ kind, id, size = 72, className = '' }: Props) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [kind, id])
  if (!id || failed) return null
  return (
    <img
      src={`${API_URL}/api/card-image/${kind}/${encodeURIComponent(id)}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`rounded-lg object-cover shrink-0 border border-white/10 bg-black/40 ${className}`}
      style={{ width: size, height: size }}
    />
  )
}
