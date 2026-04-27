'use client'

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { fetchWithAuth } from '@/lib/fetchWithAuth'
import { ArrowLeft, Loader2, Save, Check, AlertTriangle } from 'lucide-react'
import dynamic from 'next/dynamic'

// MapboxDraw + maplibre touch the window object; client-only.
const BoundaryDrawingMap = dynamic(
  () => import('@/components/BoundaryDrawingMap'),
  { ssr: false, loading: () => <div className="h-[600px] bg-gg-gray-800 rounded-lg" /> }
)

const API_URL = 'https://practical-serenity-production.up.railway.app'

interface Tract {
  id: string
  listing_id: string
  tract_number: number
  total_acres: number | null
  latitude: number | null
  longitude: number | null
  polygon_coordinates: number[][] | null
  county_name?: string
  state_abbr?: string
  boundary_source?: string | null
}

export default function DrawTractBoundaryPage() {
  const router = useRouter()
  const params = useParams()
  const tractId = params.id as string

  const [tract, setTract] = useState<Tract | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  // Live polygon state from the drawer
  const [polygon, setPolygon] = useState<number[][] | null>(null)
  const [computedAcres, setComputedAcres] = useState<number | null>(null)

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null
    if (!token) {
      router.push('/signin')
      return
    }
    ;(async () => {
      try {
        // Auth check
        const me = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!me.ok) throw new Error('Not authenticated')
        const user = await me.json()
        if (user.account_type !== 'groundgoat_admin') {
          router.push('/account')
          return
        }
        // Load tract
        const r = await fetchWithAuth(`${API_URL}/api/tracts/${tractId}`)
        if (!r.ok) throw new Error(`Failed to load tract: ${r.status}`)
        const data = await r.json()
        setTract(data)
      } catch (e: any) {
        setError(e.message || 'Failed to load tract')
      } finally {
        setLoading(false)
      }
    })()
  }, [router, tractId])

  const handleSave = async () => {
    if (!polygon || polygon.length < 3) {
      setError('Draw a polygon with at least 3 points before saving.')
      return
    }
    setError(null)
    setSavedAt(null)
    setSaving(true)
    try {
      const r = await fetchWithAuth(
        `${API_URL}/api/admin/tracts/${tractId}/boundary-draw`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ polygon }),
        }
      )
      if (!r.ok) {
        const txt = await r.text()
        throw new Error(`HTTP ${r.status}: ${txt}`)
      }
      const data = await r.json()
      setSavedAt(new Date().toISOString())
      // Refresh tract data
      const r2 = await fetchWithAuth(`${API_URL}/api/tracts/${tractId}`)
      if (r2.ok) setTract(await r2.json())
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gg-gray-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-white" />
      </div>
    )
  }

  if (!tract) {
    return (
      <div className="min-h-screen bg-gg-gray-950 flex items-center justify-center text-white">
        Tract not found.
      </div>
    )
  }

  // Center map on existing tract location, or fall back to county-ish defaults
  const initialLat = Number(tract.latitude) || 41.5
  const initialLng = Number(tract.longitude) || -90
  const listedAcres = tract.total_acres ? Number(tract.total_acres) : null
  const acresMatch =
    computedAcres !== null && listedAcres !== null && listedAcres > 0
      ? Math.abs(computedAcres - listedAcres) / listedAcres <= 0.1
      : null

  return (
    <div className="min-h-screen bg-gg-gray-950">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <Link
          href={`/admin/tracts/${tractId}`}
          className="inline-flex items-center gap-2 text-gg-gray-400 hover:text-white mb-4"
        >
          <ArrowLeft size={18} /> Back to tract
        </Link>

        <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">Draw boundary — Tract {tract.tract_number}</h1>
            <p className="text-gg-gray-400 mt-1">
              Click to add vertices, double-click to close the polygon. Drag vertices to adjust.
              {tract.boundary_source === 'manual' && (
                <span className="ml-2 text-gg-pink">Already manually drawn.</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-gg-gray-400">Listed acres</div>
              <div className="text-white font-semibold">
                {listedAcres ? listedAcres.toFixed(2) : '—'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-gg-gray-400">Drawn acres</div>
              <div
                className={`font-semibold ${
                  acresMatch === null
                    ? 'text-white'
                    : acresMatch
                    ? 'text-green-400'
                    : 'text-red-400'
                }`}
              >
                {computedAcres !== null ? computedAcres.toFixed(2) : '—'}
                {acresMatch === false && (
                  <AlertTriangle size={14} className="inline ml-1 -mt-1" />
                )}
              </div>
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !polygon}
              className="inline-flex items-center gap-2 px-4 py-2 bg-gg-pink text-white rounded-lg disabled:opacity-50"
            >
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              Save boundary
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-2 mb-4 text-sm">
            {error}
          </div>
        )}
        {savedAt && !error && (
          <div className="bg-green-500/10 border border-green-500/30 text-green-300 rounded-lg px-4 py-2 mb-4 text-sm flex items-center gap-2">
            <Check size={16} /> Saved. Re-enrichment (soil, crop, elevation) will run on the next cron pass.
          </div>
        )}

        <BoundaryDrawingMap
          initialLat={initialLat}
          initialLng={initialLng}
          initialPolygon={tract.polygon_coordinates}
          onPolygonChange={(p, a) => {
            setPolygon(p)
            setComputedAcres(a)
          }}
        />

        <div className="mt-4 text-sm text-gg-gray-400">
          Tip: zoom in close before drawing for accuracy. Polygon vertices are stored as
          [longitude, latitude] WGS-84 pairs and used to recompute soil ratings, crop history, and elevation.
        </div>
      </div>
    </div>
  )
}
