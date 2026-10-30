'use client'

// The card thumbnail for a tract or parcel on a report card (owner
// 2026-10-29: back, and it must load within a second). One request to
// /api/card-image/{kind}/{id}: a 302 to the saved CDN image when one
// exists, otherwise the API renders it inline (~0.3-0.7 s measured) and
// saves it for next time. Hidden until it has loaded; hidden for good if
// there is no boundary to draw (404).

import { useEffect, useState } from 'react'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

interface Props {
  kind: 'tract' | 'parcel'
  id: string | null | undefined
  size?: number
  className?: string
}

export default function CardThumb({ kind, id, size = 72, className = '' }: Props) {
  const [ok, setOk] = useState(false)
  useEffect(() => { setOk(false) }, [kind, id])
  if (!id) return null
  return (
    <img
      src={`${API_URL}/api/card-image/${kind}/${encodeURIComponent(id)}`}
      alt=""
      width={size}
      height={size}
      onLoad={() => setOk(true)}
      onError={() => setOk(false)}
      className={`rounded-lg object-cover shrink-0 border border-white/10 bg-black/40 ${className}`}
      style={{ width: size, height: size, display: ok ? 'block' : 'none' }}
    />
  )
}
