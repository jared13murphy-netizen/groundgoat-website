'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Loader2, Mountain } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'

const API_URL = 'https://practical-serenity-production.up.railway.app'

export interface TractSaleData {
  id: string
  listingId?: string | null
  tractId?: string | null
  auctionDate?: string | null
  totalAcres?: number | null
  tillableAcres?: number | null
  companyName?: string | null
  salePrice?: number | null
  pricePerAcre?: number | null
  county: string
  state: string
  township?: string | null
  soilRating?: number | null
  polygonCoordinates?: [number, number][] | null
  saleStatus?: string | null
  listingType?: string | null
  pctTillable?: number | null
  pricePerTillableAcre?: number | null
  pricePerSoilRating?: number | null
}

interface SoilData {
  map_units: any[]
  avg_slope?: number
}

interface ElevationData {
  min_ft: number
  max_ft: number
  relief_ft: number
  avg_slope_pct: number
}

interface NeighborParcel {
  geometry: [number, number][]
  owner: string
  acres: number | null
  apn: string
  source: string
}

interface PortalTractDetailProps {
  tract: TractSaleData
  onBack: () => void
  onViewListing?: (listingId: string) => void
  onView3DTerrain?: (tractId: string, tractName: string) => void
  onToggleReport?: (tract: TractSaleData) => void
  isInReport?: boolean
  onShowNeighbors?: (parcels: NeighborParcel[] | null) => void
}

function formatCurrency(value?: number | null): string {
  if (!value) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

function formatAcres(acres?: number | null): string {
  if (!acres) return '—'
  return acres.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' ac'
}

function formatDate(dateString?: string | null): string {
  if (!dateString) return '—'
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

function formatTime(dateString?: string | null): string {
  if (!dateString) return ''
  const date = new Date(dateString)
  const hours = date.getUTCHours()
  const mins = date.getUTCMinutes()
  // Skip midnight (00:00) — means no time was set
  if (hours === 0 && mins === 0) return ''
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const h12 = hours % 12 || 12
  return `${h12}:${String(mins).padStart(2, '0')} ${ampm}`
}

function formatDateWithTime(dateString?: string | null): string {
  const d = formatDate(dateString)
  const t = formatTime(dateString)
  if (d === '—') return '—'
  return t ? `${d} at ${t}` : d
}

function getStatusLabel(status?: string | null): string {
  switch (status?.toLowerCase()) {
    case 'sold': return 'Sold'
    case 'listed': case 'active': return 'Listed'
    case 'live': case 'pending': return 'Live'
    case 'no_sale': return 'No Sale'
    default: return status || '—'
  }
}

const STATUS_COLORS: Record<string, string> = {
  sold: 'bg-green-500/15 text-green-400 border-green-500/30',
  listed: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  active: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  live: 'bg-red-500/15 text-red-400 border-red-500/30',
  pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  no_sale: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

export default function PortalTractDetail({ tract, onBack, onViewListing, onView3DTerrain, onToggleReport, isInReport, onShowNeighbors }: PortalTractDetailProps) {
  const [soilData, setSoilData] = useState<SoilData | null>(null)
  const [elevationData, setElevationData] = useState<ElevationData | null>(null)
  const [soilLoading, setSoilLoading] = useState(false)
  const [neighborsLoading, setNeighborsLoading] = useState(false)
  const [neighborsLoaded, setNeighborsLoaded] = useState(false)
  const [neighborCount, setNeighborCount] = useState(0)

  const hasBoundaries = !!(tract.polygonCoordinates && tract.polygonCoordinates.length > 0)

  useEffect(() => {
    if (!tract.tractId || !hasBoundaries) return
    setSoilData(null)
    setElevationData(null)
    setSoilLoading(true)

    Promise.all([
      fetchWithAuth(`${API_URL}/api/tracts/${tract.tractId}/soil-data`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchWithAuth(`${API_URL}/api/tracts/${tract.tractId}/elevation`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([soil, elevation]) => {
      if (soil) {
        setSoilData({
          map_units: soil.soil_map_units || [],
          avg_slope: soil.elevation_stats?.avg_slope_pct,
        })
      }
      if (elevation?.elevation_stats) {
        setElevationData({
          min_ft: elevation.elevation_stats.min_ft,
          max_ft: elevation.elevation_stats.max_ft,
          relief_ft: elevation.elevation_stats.relief_ft,
          avg_slope_pct: elevation.elevation_stats.avg_slope_pct,
        })
      }
      setSoilLoading(false)
    })
  }, [tract.tractId])

  // Clear neighbors when tract changes or component unmounts
  useEffect(() => {
    setNeighborsLoaded(false)
    setNeighborCount(0)
    onShowNeighbors?.(null)
    return () => { onShowNeighbors?.(null) }
  }, [tract.tractId])

  const handleShowNeighbors = async () => {
    if (!tract.tractId || neighborsLoading) return
    if (neighborsLoaded) {
      // Toggle off
      onShowNeighbors?.(null)
      setNeighborsLoaded(false)
      setNeighborCount(0)
      return
    }
    setNeighborsLoading(true)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${tract.tractId}/neighbors`)
      if (res.ok) {
        const data = await res.json()
        const parcels = data.neighbors || []
        onShowNeighbors?.(parcels)
        setNeighborCount(parcels.length)
        setNeighborsLoaded(true)
      }
    } catch (e) {
      console.error('Failed to fetch neighbors', e)
    }
    setNeighborsLoading(false)
  }

  const statusKey = tract.saleStatus?.toLowerCase() || ''

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-gg-gray-400 hover:text-white transition group"
      >
        <ArrowLeft size={16} className="group-hover:-translate-x-0.5 transition-transform" />
        Back
      </button>

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold">Tract Sale</h2>
        <p className="text-xs text-gg-gray-400 mt-0.5">{tract.county}, {tract.state}</p>
      </div>

      {/* Status badge */}
      <div className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[statusKey] || 'bg-gray-500/15 text-gray-400 border-gray-500/30'}`}>
        {getStatusLabel(tract.saleStatus)}
      </div>

      {/* Price/Acre highlight */}
      {tract.pricePerAcre ? (
        <div className="bg-gg-pink/10 rounded-xl p-4 border border-gg-pink/20">
          <div className="text-[10px] text-gg-pink uppercase tracking-wider font-semibold">Price / Acre</div>
          <div className="text-2xl font-bold text-gg-pink mt-1">{formatCurrency(tract.pricePerAcre)}/ac</div>
        </div>
      ) : null}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
          <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">Acres</div>
          <div className="text-lg font-bold mt-1">{formatAcres(tract.totalAcres)}</div>
        </div>
        {tract.salePrice ? (
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
            <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">Sale Price</div>
            <div className="text-lg font-bold mt-1">{formatCurrency(tract.salePrice)}</div>
          </div>
        ) : null}
        {tract.tillableAcres ? (
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
            <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">Tillable</div>
            <div className="text-lg font-bold mt-1">{formatAcres(tract.tillableAcres)}</div>
          </div>
        ) : null}
        {tract.soilRating ? (
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
            <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">Soil Rating</div>
            <div className="text-lg font-bold mt-1">{tract.soilRating}</div>
          </div>
        ) : null}
      </div>

      {/* Detail Rows */}
      <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
        <DetailRow label="Date" value={formatDateWithTime(tract.auctionDate)} />
        {tract.companyName && <DetailRow label="Listing Company" value={tract.companyName} />}
        <DetailRow label="County" value={tract.county || '—'} />
        <DetailRow label="State" value={tract.state || '—'} />
        <DetailRow label="Township" value={tract.township || '—'} />
        {tract.pctTillable ? (
          <DetailRow label="% Tillable" value={`${Math.round(tract.pctTillable)}%`} />
        ) : null}
        {tract.tillableAcres && tract.pricePerAcre && tract.totalAcres ? (
          <DetailRow
            label="$/Tillable Acre"
            value={formatCurrency((tract.pricePerAcre * tract.totalAcres) / tract.tillableAcres) + '/ac'}
            highlight
          />
        ) : null}
        {tract.soilRating && tract.pricePerAcre ? (
          <DetailRow
            label="$/Soil Rating"
            value={formatCurrency(tract.pricePerAcre / tract.soilRating)}
          />
        ) : null}
      </div>

      {/* Soil & Elevation Data (only if tract has boundaries) */}
      {hasBoundaries && soilLoading && (
        <div className="flex items-center gap-2 text-sm text-gg-gray-400 py-2">
          <Loader2 className="animate-spin" size={14} />
          Loading soil & land data...
        </div>
      )}

      {hasBoundaries && !soilLoading && (soilData || elevationData) && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gg-gray-300 uppercase tracking-wider">Soil & Land Data</h3>

          {elevationData && (
            <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
              <DetailRow
                label="Elevation"
                value={`${Math.round(elevationData.min_ft)} – ${Math.round(elevationData.max_ft)} ft${elevationData.relief_ft > 0 ? ` (${Math.round(elevationData.relief_ft)} ft relief)` : ''}`}
              />
              {elevationData.avg_slope_pct != null && (
                <DetailRow label="Avg Slope" value={`${elevationData.avg_slope_pct}%`} />
              )}
            </div>
          )}

          {soilData?.map_units && soilData.map_units.length > 0 && (
            <div className="bg-white/[0.03] rounded-xl border border-white/5 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-white/5">
                <span className="text-xs font-semibold text-gg-gray-300">Soil Map Units</span>
              </div>
              {soilData.map_units.map((unit: any, idx: number) => (
                <div key={idx} className={`px-4 py-3 ${idx > 0 ? 'border-t border-white/5' : ''}`}>
                  <div className="text-sm font-medium">{unit.name || unit.musym || 'Unknown'}</div>
                  <div className="flex gap-3 mt-1">
                    {unit.nccpi != null && <span className="text-xs text-gg-gray-300">NCCPI: {unit.nccpi}</span>}
                    {unit.drainage_class && <span className="text-xs text-gg-gray-300">{unit.drainage_class}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action Buttons — sticky at bottom */}
      <div className="flex gap-2 pt-3 pb-2 sticky bottom-0 bg-gg-gray-900/95 backdrop-blur-sm border-t border-white/5 -mx-5 px-5 mt-4">
        {/* 3D Map (only if tract has boundaries) */}
        {hasBoundaries && tract.tractId && onView3DTerrain && (
          <button
            onClick={() => onView3DTerrain(tract.tractId!, `${tract.county}, ${tract.state}`)}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-gg-pink text-white font-semibold rounded-xl hover:bg-gg-pink/80 transition text-xs"
          >
            <Mountain size={14} />
            3D Map
          </button>
        )}

        {/* Show Neighbors — hidden from users, still wired up for testing */}
        {/* TODO: Re-enable once backend/scraper connection is verified
        {hasBoundaries && tract.tractId && onShowNeighbors && (
          <button
            onClick={handleShowNeighbors}
            disabled={neighborsLoading}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-medium transition text-xs border ${
              neighborsLoaded
                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
            }`}
          >
            {neighborsLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : neighborsLoaded ? (
              `Hide (${neighborCount})`
            ) : (
              'Neighbors'
            )}
          </button>
        )}
        */}

        {/* Add to Report */}
        {onToggleReport && (
          <button
            onClick={() => onToggleReport(tract)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-medium transition text-xs border ${
              isInReport
                ? 'bg-gg-pink/10 text-gg-pink border-gg-pink/30'
                : 'bg-white/5 text-white border-white/10 hover:bg-white/10'
            }`}
          >
            {isInReport ? '− Report' : '+ Report'}
          </button>
        )}

        {/* View Listing (only if has listing company) */}
        {tract.listingId && tract.companyName && onViewListing && (
          <button
            onClick={() => onViewListing(tract.listingId!)}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-white/5 border border-white/10 text-white font-medium rounded-xl hover:bg-white/10 transition text-xs"
          >
            View Listing
          </button>
        )}
      </div>
    </motion.div>
  )
}

function DetailRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-xs text-gg-gray-300">{label}</span>
      <span className={`text-sm font-medium ${highlight ? 'text-gg-pink' : ''}`}>{value}</span>
    </div>
  )
}