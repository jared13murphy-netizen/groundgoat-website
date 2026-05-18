'use client'

// Force dynamic rendering so admin won't be stuck on a stale HTML
// pointing at an old JS bundle hash (same workaround as the
// missing-boundaries page — Next.js statically renders /comparables/map
// at build time otherwise, with a 1-year s-maxage edge cache).
export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import MapComparablesView from '@/components/map/MapComparablesView'

function MapComparablesPage() {
  const params = useSearchParams()
  const router = useRouter()
  const tractId = params.get('tractId')

  if (!tractId) {
    return (
      <div style={{ padding: 40, color: '#fff', background: '#0a0a0c', minHeight: '100vh' }}>
        <h1 style={{ color: '#fff' }}>Find Comparables</h1>
        <p style={{ color: '#ccc' }}>
          No tract selected. Open this page from the Explore map by tapping a
          pin and clicking <strong>Find Comparables</strong>.
        </p>
      </div>
    )
  }

  return (
    // Sits ABOVE the global GroundGoat nav (which has its own
    // fixed/sticky position at z-index ~50). Without z-index:100 the
    // Back-button row would be hidden under the global nav.
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      display: 'flex', flexDirection: 'column', background: '#0a0a0c',
    }}>
      {/* Slim top bar — back button + title */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(20px)',
        zIndex: 5,
      }}>
        <button
          onClick={() => router.back()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            color: '#fff', padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
          }}
        >
          <ArrowLeft size={16} /> Back
        </button>
        <h1 style={{ margin: 0, fontSize: 18, color: '#fff' }}>Find Comparables</h1>
      </div>
      <div style={{ flex: 1, position: 'relative' }}>
        <MapComparablesView subjectTractId={tractId} />
      </div>
    </div>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: '#ccc' }}>Loading…</div>}>
      <MapComparablesPage />
    </Suspense>
  )
}
