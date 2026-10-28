'use client'

// The saved report-card thumbnail (owner 2026-10-27, final rule): every
// parcel that can be put on a report has its card RENDERED AND SAVED ahead
// of time (scripts/render_card_images.py on the jobs box); the panel only
// ever shows a saved image. One request, no retries, no waiting: if the
// image is not already there, the card shows nothing.

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
