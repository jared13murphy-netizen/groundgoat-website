'use client'

/**
 * /configure-map — Configurable Mapping's drawing screen.
 *
 * Gated server-side too (every /api/mapping route calls
 * require_configurable_mapping); this check only decides what the
 * browser renders, so a curious URL never shows a broken map.
 */
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fetchMappingAccess } from '@/lib/configurableMapping'

const ConfigureMap = dynamic(() => import('@/components/mapping/ConfigureMap'), { ssr: false })

export default function ConfigureMapPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => { fetchMappingAccess().then(setAllowed) }, [])

  if (allowed === null) {
    return <Shell><p style={{ opacity: 0.6 }}>Loading…</p></Shell>
  }
  if (!allowed) {
    return (
      <Shell>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Configurable Mapping</h1>
        <p style={{ opacity: 0.7, maxWidth: 420, lineHeight: 1.6 }}>
          Configurable Mapping isn&apos;t enabled on your account. It lets you draw your own
          boundaries on a parcel, classify the ground inside it, and build reports from
          what you draw.
        </p>
        <Link href="/access" style={{ color: '#93c5fd', marginTop: 16, display: 'inline-block' }}>
          Back to the map
        </Link>
      </Shell>
    )
  }
  return <ConfigureMap />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: '#0f1520', color: '#e5e7eb',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 24, textAlign: 'center',
    }}>{children}</div>
  )
}
