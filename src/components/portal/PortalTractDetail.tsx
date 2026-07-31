'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Loader2, Mountain, BarChart3, FileText, Mail, Download, Check } from 'lucide-react'
import fetchWithAuth from '@/lib/fetchWithAuth'
import { formatAcres } from '@/lib/format'
import { formatAuctionDate } from '@/lib/auctionTime'
import GroundTruthPanel from './GroundTruthPanel'
import NdviPanel from './NdviPanel'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

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
  askingPrice?: number | null
  pctTillable?: number | null
  pricePerTillableAcre?: number | null
  pricePerSoilRating?: number | null
  landType?: string | null
  landTypes?: string[] | null
  // Recorded county-recorder deed(s) folded into this tract on the comp
  // map because a Regrid parcel-sale-dot's centroid sits inside the
  // tract's own polygon — see ExploreMap.tsx's recomputeCoincidentDeeds /
  // RecordedDeed (same shape, kept as a separate type here to match this
  // file's existing pattern of a standalone TractSaleData vs SaleDetail).
  deeds?: RecordedDeed[]
}

export interface RecordedDeed {
  ll_uuid: string
  saleprice: number | null
  saledate: string | null
  acres: number | null
  owner: string | null
  ownerLoading: boolean
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
  soil_rating?: number | null
  tillable_acres?: number | null
  sale_price?: number | null
  sale_date?: string | null
  last_transfer_date?: string | null
  assessed_value_total?: number | null
  assessed_value_land?: number | null
  assessed_value_improvement?: number | null
  assessed_value_ag?: number | null
  annual_tax?: number | null
  use_code?: string | null
  use_description?: string | null
  zoning?: string | null
}

interface PortalTractDetailProps {
  tract: TractSaleData
  onBack: () => void
  onViewListing?: (listingId: string) => void
  onView3DTerrain?: (tractId: string, tractName: string) => void
  onToggleReport?: (tract: TractSaleData) => void
  isInReport?: boolean
  onShowNeighbors?: (parcels: NeighborParcel[] | null) => void
  onNeighborsLoadingChange?: (loading: boolean) => void
  showNeighborsButton?: boolean
  /** Same callback the listing detail panel uses — when set, a "Find
      Comparables" button shows in the tract detail and triggers the
      comparables flow with this tract as the subject. */
  onFindComparables?: (tractId: string, county: string, state: string) => void
}

function formatCurrency(value?: number | null): string {
  if (!value) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
}

// Date/time rendering now delegates to lib/auctionTime which converts from
// UTC to the auction's LOCAL timezone (based on the tract's state) and adds
// a tz label like "CDT" so viewers in any timezone see the right clock time.

// Recorded-deed sale dates are plain YYYY-MM-DD county-recorder dates (no
// timezone attached, unlike an auction datetime) — format as MM/DD/YYYY
// directly instead of going through formatAuctionDate's tz conversion.
function formatDeedDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const [, y, mo, d] = m
  return `${mo}/${d}/${y}`
}

function getStatusLabel(status?: string | null): string {
  switch (status?.toLowerCase()) {
    case 'sold': return 'Sold'
    case 'auction': return 'Auction'
    case 'listed': case 'active': return 'Listed'
    case 'live': case 'pending': return 'Live'
    case 'no_sale': return 'No Sale'
    default: return status || '—'
  }
}

const STATUS_COLORS: Record<string, string> = {
  sold: 'bg-green-500/15 text-green-400 border-green-500/30',
  auction: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  listed: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  active: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  live: 'bg-red-500/15 text-red-400 border-red-500/30',
  pending: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  no_sale: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
}

export default function PortalTractDetail({ tract, onBack, onViewListing, onView3DTerrain, onToggleReport, isInReport, onShowNeighbors, onNeighborsLoadingChange, showNeighborsButton = false, onFindComparables }: PortalTractDetailProps) {
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
    onNeighborsLoadingChange?.(true)
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
    onNeighborsLoadingChange?.(false)
  }

  const statusKey = tract.saleStatus?.toLowerCase() || ''

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      {/* The pane title, back button, and "<County> County, <ST>"
          subtitle are now rendered by the slide-out shell in
          /access/page.tsx — not here. This keeps the in-pane content
          consistent with how the Listing Detail / Comp Report panes
          are laid out (single header bar at the top of the pane). */}

      {/* Status + land-type badges. Multi-badge: every land_type the
          tract qualifies for shows up — a 50/50 farm-and-trees parcel
          shows BOTH Farm and Recreational. */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${STATUS_COLORS[statusKey] || 'bg-gray-500/15 text-gray-400 border-gray-500/30'}`}>
          {getStatusLabel(tract.saleStatus)}
        </div>
        {(() => {
          const types = (tract.landTypes && tract.landTypes.length > 0)
            ? Array.from(new Set([
                ...(tract.landType ? [tract.landType] : []),
                ...tract.landTypes,
              ]))
            : (tract.landType ? [tract.landType] : [])
          return types.map(lt => (
            <span key={lt} className="inline-flex px-3 py-1 rounded-full text-xs font-semibold border bg-gg-pink/15 text-gg-pink border-gg-pink/30">
              {lt}
            </span>
          ))
        })()}
      </div>

      {/* Tract satellite image with pink boundary overlay. Only renders
          when the tract has polygon_coordinates (so we know there's a
          rendered thumbnail in tracts.image_base64). 480-wide JPEG via
          the existing /api/tracts/{id}/image resize endpoint. */}
      {hasBoundaries && (tract.tractId || tract.id) && (
        <div className="rounded-xl overflow-hidden border border-white/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${API_URL}/api/tracts/${tract.tractId || tract.id}/image?w=600&q=80`}
            alt="Tract satellite view with boundary outline"
            className="w-full h-auto block bg-gg-gray-900"
            loading="lazy"
          />
        </div>
      )}

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
          <div className="text-lg font-bold mt-1">{tract.totalAcres != null ? `${formatAcres(tract.totalAcres)} ac` : '—'}</div>
        </div>
        {(() => {
          const isPT = (tract.listingType || '').toLowerCase() === 'private_treaty'
          if (tract.salePrice) {
            return (
              <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">Sale Price</div>
                <div className="text-lg font-bold mt-1">{formatCurrency(tract.salePrice)}</div>
              </div>
            )
          }
          if (isPT && tract.askingPrice) {
            return (
              <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
                <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">Asking Price</div>
                <div className="text-lg font-bold mt-1">{formatCurrency(tract.askingPrice)}</div>
              </div>
            )
          }
          return null
        })()}
        {tract.tillableAcres ? (
          <div className="bg-white/[0.03] rounded-xl p-4 border border-white/5">
            <div className="text-[10px] text-gg-gray-300 uppercase tracking-wider">Tillable</div>
            <div className="text-lg font-bold mt-1">{formatAcres(tract.tillableAcres)} ac</div>
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
      {(() => {
        const isPrivateTreaty = (tract.listingType || '').toLowerCase() === 'private_treaty'
        const askingPpa = isPrivateTreaty && tract.askingPrice && tract.totalAcres
          ? tract.askingPrice / tract.totalAcres
          : null
        return (
          <div className="bg-white/[0.03] rounded-xl border border-white/5 divide-y divide-white/5">
            {/* Date — always show when we have one, regardless of PT vs
                auction or whether a listing company is attached. The
                label is "Sale Date" when the tract has been sold (the
                auction_datetime IS the sale date for closed auctions),
                otherwise "Auction Date". */}
            {tract.auctionDate && (
              <DetailRow
                label={(tract.saleStatus || '').toLowerCase() === 'sold' ? 'Sale Date' : 'Auction Date'}
                value={formatAuctionDate(tract.auctionDate, tract.state)}
              />
            )}
            {/* Price rows — labels reflect the tract's sale_status:
                  sold     → "Sold Price"          + "Sold Price/Acre"
                  no_sale  → "Final Bid Price"     + "Final Bid Price/Acre"
                  PT       → "Listing Total Price" + "Listing Price/Acre" */}
            {(() => {
              const status = (tract.saleStatus || '').toLowerCase()
              const ppa = (val: number) => tract.totalAcres ? val / tract.totalAcres : null

              if (status === 'sold' && tract.salePrice) {
                const p = ppa(tract.salePrice)
                return (
                  <>
                    <DetailRow label="Sold Price" value={formatCurrency(tract.salePrice)} highlight />
                    {p != null ? (
                      <DetailRow label="Sold Price/Acre" value={formatCurrency(p) + '/ac'} highlight />
                    ) : null}
                  </>
                )
              }
              if (status === 'no_sale' && tract.salePrice) {
                const p = ppa(tract.salePrice)
                return (
                  <>
                    <DetailRow label="Final Bid Price" value={formatCurrency(tract.salePrice)} highlight />
                    {p != null ? (
                      <DetailRow label="Final Bid Price/Acre" value={formatCurrency(p) + '/ac'} highlight />
                    ) : null}
                  </>
                )
              }
              if (isPrivateTreaty && tract.askingPrice) {
                return (
                  <>
                    <DetailRow label="Listing Total Price" value={formatCurrency(tract.askingPrice)} highlight />
                    {askingPpa ? (
                      <DetailRow label="Listing Price/Acre" value={formatCurrency(askingPpa) + '/ac'} highlight />
                    ) : null}
                  </>
                )
              }
              return null
            })()}
            {tract.companyName && <DetailRow label="Listing Company" value={tract.companyName} />}
            <DetailRow label="County" value={tract.county || '—'} />
            <DetailRow label="State" value={tract.state || '—'} />
            <DetailRow label="Township" value={tract.township || '—'} />
            {tract.pctTillable ? (
              <DetailRow label="% Tillable" value={`${Math.round(tract.pctTillable)}%`} />
            ) : null}
            {/* $/tillable acre — use askingPpa for PT, else pricePerAcre */}
            {tract.tillableAcres && tract.totalAcres && (askingPpa || tract.pricePerAcre) ? (
              <DetailRow
                label="$/Tillable Acre"
                value={formatCurrency(((askingPpa || tract.pricePerAcre || 0) * tract.totalAcres) / tract.tillableAcres) + '/ac'}
                highlight
              />
            ) : null}
            {tract.soilRating && (askingPpa || tract.pricePerAcre) ? (
              <DetailRow
                label="$/Soil Rating"
                value={formatCurrency((askingPpa || tract.pricePerAcre || 0) / tract.soilRating)}
              />
            ) : null}
          </div>
        )
      })()}

      {/* Recorded Deeds — comp-map coincident-dot collapse (see
          ExploreMap.tsx recomputeCoincidentDeeds). A Regrid parcel
          sale-dot that sits inside THIS tract's polygon gets folded here
          instead of showing as its own dot on the map. Deliberately
          styled amber/"County Record", never pink/gg-pink, so this
          county-recorder $/acre can never be mistaken for the tract's
          own auction sold price/acre above. Omitted entirely when the
          tract has no coincident deed. */}
      {tract.deeds && tract.deeds.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-gg-gray-300 uppercase tracking-wider flex items-center gap-1.5">
            <FileText size={14} className="text-amber-400" />
            Recorded Deed{tract.deeds.length > 1 ? 's' : ''} on This Parcel
          </h3>
          <div className="bg-amber-500/[0.06] rounded-xl border border-amber-500/20 divide-y divide-amber-500/10">
            {tract.deeds.map((deed) => {
              const pricePerAcre = deed.saleprice && deed.acres
                ? Math.round(deed.saleprice / deed.acres)
                : null
              const dateStr = formatDeedDate(deed.saledate)
              return (
                <div key={deed.ll_uuid} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    {deed.owner ? (
                      <span className="text-sm font-bold text-white truncate">{deed.owner}</span>
                    ) : deed.ownerLoading ? (
                      <span className="inline-block h-3.5 w-28 rounded bg-white/10 animate-pulse" />
                    ) : (
                      <span className="text-sm font-bold text-gg-gray-400">Owner unknown</span>
                    )}
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-amber-400 border border-amber-500/30 rounded-full px-2 py-0.5">
                      County Record
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-gg-gray-300">
                    {deed.acres != null && <span>{formatAcres(deed.acres)} ac</span>}
                    {pricePerAcre != null && (
                      <span className="text-amber-400 font-medium">
                        {formatCurrency(pricePerAcre)}/ac <span className="text-gg-gray-400 font-normal">(recorded)</span>
                      </span>
                    )}
                    {dateStr && <span>{dateStr}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

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

      {/* Ground Truth — USDA NASS county yields, cash rent, state landvalue.
          Panel quietly hides when the tract has no resolved state/county or
          when no NASS data exists (e.g. non-ag-belt states), so it doesn't
          clutter detail views for outliers. */}
      {tract.tractId && <GroundTruthPanel tractId={tract.tractId} />}

      {/* NDVI — Sentinel-2 vegetation health time series, multi-year overlay.
          Panel hides when no observations exist yet (e.g. backfill hasn't
          processed this tract). */}
      {tract.tractId && <NdviPanel tractId={tract.tractId} />}

      {/* Action buttons are rendered OUTSIDE this component, as a
          separate footer in the slide-out pane (see <TractDetailActionBar/>
          and /access/page.tsx). Lifting them out is the only way to
          truly pin them to the pane bottom — `sticky bottom-0` inside
          the scrollable area can't escape the parent's py-4 padding. */}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────
// TractDetailActionBar — rendered by the slide-out pane as a footer
// below the scrollable content. Pinned to the pane bottom; a gradient
// overlay above the buttons lets scrolling content fade out behind it.
// ─────────────────────────────────────────────────────────────────────
export interface TractDetailActionBarProps {
  tract: TractSaleData
  onView3DTerrain?: (tractId: string, tractName: string) => void
  onToggleReport?: (tract: TractSaleData) => void
  isInReport?: boolean
  onViewListing?: (listingId: string) => void
  onFindComparables?: (tractId: string, county: string, state: string) => void
}

export function TractDetailActionBar({
  tract,
  onView3DTerrain,
  onToggleReport,
  isInReport,
  onViewListing,
  onFindComparables,
}: TractDetailActionBarProps) {
  const hasBoundaries = !!(tract.polygonCoordinates && tract.polygonCoordinates.length > 0)

  // "Email me this report" / "Download report" — single-tract PDF, separate
  // from the multi-tract comparables report (PortalComparablesReportPanel).
  // Backend contract: POST /api/tracts/{tract_id}/report/email|pdf, no body,
  // auth header only (fetchWithAuth attaches it). 403 = not entitled,
  // 400 = no email on account.
  const [emailStatus, setEmailStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [emailMessage, setEmailMessage] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  // Reset transient send/download state when the user switches tracts —
  // the action bar's component instance persists across tract selections
  // (the slide-out pane doesn't remount), so a stale "Sent!" from the
  // previous tract must not carry over.
  const reportTractId = tract.tractId || tract.id
  useEffect(() => {
    setEmailStatus('idle')
    setEmailMessage(null)
    setDownloading(false)
    setDownloadError(null)
  }, [reportTractId])

  const parseErrorMessage = async (res: Response): Promise<string> => {
    if (res.status === 403) return 'Not available for your account'
    if (res.status === 400) {
      try {
        const body = await res.json()
        return body?.detail || body?.message || 'No email on file for your account'
      } catch {
        return 'No email on file for your account'
      }
    }
    return 'Something went wrong — try again'
  }

  const handleEmailReport = async () => {
    setEmailStatus('sending')
    setEmailMessage(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${reportTractId}/report/email`, {
        method: 'POST',
      })
      if (!res.ok) {
        setEmailStatus('error')
        setEmailMessage(await parseErrorMessage(res))
        return
      }
      const data = await res.json()
      setEmailStatus('sent')
      setEmailMessage(data?.message || 'Sent!')
    } catch (e) {
      console.error('Tract report email error:', e)
      setEmailStatus('error')
      setEmailMessage('Something went wrong — try again')
    }
  }

  const handleDownloadReport = async () => {
    setDownloading(true)
    setDownloadError(null)
    try {
      const res = await fetchWithAuth(`${API_URL}/api/tracts/${reportTractId}/report/pdf`, {
        method: 'POST',
      })
      if (!res.ok) {
        setDownloadError(await parseErrorMessage(res))
        return
      }
      const blob = await res.blob()
      const dispo = res.headers.get('Content-Disposition') || ''
      const match = dispo.match(/filename="?([^";]+)"?/i)
      const filename = match?.[1] || 'tract-report.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('Tract report download error:', e)
      setDownloadError('Something went wrong — try again')
    } finally {
      setDownloading(false)
    }
  }

  return (
    // shrink-0 keeps the row at its natural height; the parent scroll
    // area (flex-1) absorbs the remaining space. The ::before overlay
    // (a 40px tall transparent→black gradient anchored to this bar's
    // top edge) bleeds UP into the scroll area so its bottom content
    // fades out behind the buttons instead of getting hard-clipped.
    <div className="shrink-0 relative bg-black">
      <div className="absolute -top-10 left-0 right-0 h-10 pointer-events-none bg-gradient-to-b from-transparent to-black" />
      <div className="flex gap-2 px-5 py-4">
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

        {/* Find Comparables — same callback the listing detail panel
            uses; here it lets the user pick THIS tract as the subject
            for a comparables search. */}
        {onFindComparables && (
          <button
            onClick={() => onFindComparables(tract.id, tract.county, tract.state)}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 bg-gg-pink/10 text-gg-pink border border-gg-pink/30 rounded-xl hover:bg-gg-pink/20 transition text-xs font-medium"
          >
            <BarChart3 size={14} />
            Find Comps
          </button>
        )}
      </div>

      {/* Single-tract PDF report — separate row from the buttons above
          (which can already run to 4-wide at 480px; a 2nd row keeps
          these legible instead of cramming 6 into one). */}
      <div className="flex gap-2 px-5 pb-4">
        <button
          onClick={handleDownloadReport}
          disabled={downloading}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-medium transition text-xs border ${
            downloading
              ? 'bg-white/5 border-white/10 text-white/60 cursor-wait'
              : 'bg-white/5 border-white/10 text-white hover:bg-white/10'
          }`}
        >
          {downloading ? (
            <><Loader2 size={14} className="animate-spin" /> Building PDF...</>
          ) : (
            <><Download size={14} /> Download report</>
          )}
        </button>
        <button
          onClick={handleEmailReport}
          disabled={emailStatus === 'sending' || emailStatus === 'sent'}
          className={`flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl font-semibold transition text-xs ${
            emailStatus === 'sent'
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : emailStatus === 'sending'
                ? 'bg-gg-pink/50 text-white/70 cursor-wait'
                : 'bg-gg-pink text-white hover:bg-gg-pink/80'
          }`}
        >
          {emailStatus === 'sent' ? (
            <><Check size={14} /> Sent!</>
          ) : emailStatus === 'sending' ? (
            <><Loader2 size={14} className="animate-spin" /> Sending...</>
          ) : (
            <><Mail size={14} /> Email me this report</>
          )}
        </button>
      </div>

      {/* Inline status — success shows the backend's "Sent to you@email.com"
          message; failures show the parsed error (403/400/other). */}
      {(emailStatus === 'sent' || emailStatus === 'error' || downloadError) && (
        <div className="px-5 pb-4 -mt-2">
          {emailStatus === 'sent' && emailMessage && (
            <p className="text-[11px] text-green-400">{emailMessage}</p>
          )}
          {emailStatus === 'error' && emailMessage && (
            <p className="text-[11px] text-red-400">{emailMessage}</p>
          )}
          {downloadError && (
            <p className="text-[11px] text-red-400">{downloadError}</p>
          )}
        </div>
      )}
    </div>
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