'use client'

/**
 * Boundary-draw redirect page.
 *
 * The standalone boundary-draw-tract editor was missing key features
 * the admin needs: scale-to-target-acres (Align), tillable polygon
 * draw + align, soil rating entry + calculation. Rather than
 * duplicate those onto a second page, this route now redirects to
 * /admin/missing-boundaries with the tract's listing already filtered
 * in and the tract card auto-scrolled / highlighted. Admins get the
 * full workflow there — Redraw / Delete / Undo / Align / Draw Tillable
 * / Align Tillable / Soil Rating / Approve.
 *
 * Per user 2026-05-19n: "I need the ability to Align after I draw the
 * tract, then also draw the tillable polygon and align it, and then
 * enter soil rating as well as see calculated soil rating. So it
 * needs to work just like the missing-boundaries screen."
 */
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

const SCRAPER_URL = 'https://ground-goat-scraper-production.up.railway.app'

export default function BoundaryDrawTractRedirect() {
  const params = useParams()
  const router = useRouter()
  const tractId = String(params.tractId)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function go() {
      try {
        const res = await fetch(`${SCRAPER_URL}/api/admin/tracts/${tractId}/details`)
        const body = await res.json()
        if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`)
        if (cancelled) return
        const listingId = body?.tract?.listing_id ?? body?.listing_id
        if (!listingId) {
          setError('Tract has no listing — cannot open the editor.')
          return
        }
        const qs = new URLSearchParams()
        qs.set('listing_id', listingId)
        qs.set('focus_tract', tractId)
        router.replace(`/admin/missing-boundaries?${qs.toString()}`)
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e))
      }
    }
    go()
    return () => { cancelled = true }
  }, [tractId, router])

  return (
    <div className="min-h-screen bg-gg-gray-950 text-white flex flex-col items-center justify-center gap-3 p-8">
      {error ? (
        <>
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => router.push('/admin/missing-boundaries')}
            className="text-gg-pink underline"
          >
            Back to missing boundaries
          </button>
        </>
      ) : (
        <>
          <Loader2 className="animate-spin" size={28} />
          <p className="text-gg-gray-300 text-sm">Opening tract editor…</p>
        </>
      )}
    </div>
  )
}
