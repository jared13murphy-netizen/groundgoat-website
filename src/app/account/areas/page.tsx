'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { Suspense } from 'react'

function AreasRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    // Preserve query params (e.g. ?from=app) when redirecting
    const params = searchParams.toString()
    router.replace(`/account/subscription${params ? `?${params}` : ''}`)
  }, [router, searchParams])

  return (
    <div className="min-h-screen bg-gg-black flex items-center justify-center">
      <Loader2 size={32} className="animate-spin text-gg-pink" />
    </div>
  )
}

export default function MyAreasPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gg-black flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-gg-pink" />
      </div>
    }>
      <AreasRedirect />
    </Suspense>
  )
}
