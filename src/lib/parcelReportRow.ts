// Build a comp-report row for a Regrid parcel from its id or a click point,
// exactly the way the Land Detail panel's "+ Report" button does (same
// fetches, same deriveParcelDetail precedence, same row fields). Used by
// drag-to-report (owner 2026-10-27), where the user never opened the panel.

import fetchWithAuth from '@/lib/fetchWithAuth'
import { deriveParcelDetail } from '@/components/map/parcelDetailFields'
import type { TractSaleData } from '@/components/portal/PortalTractDetail'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://practical-serenity-production.up.railway.app'

export interface ParcelRowInput {
  ll_uuid?: string | null
  lat?: number | null
  lng?: number | null
  /** tile feature properties, if the drag started on a parcel fill */
  tileProps?: Record<string, any> | null
  /** the row id the map keys parcels by (ll_uuid, else tile path, else click point) */
  reportId?: string | null
}

export async function buildParcelReportRow(input: ParcelRowInput): Promise<TractSaleData | null> {
  const { ll_uuid, lat, lng, tileProps } = input
  const qs = new URLSearchParams()
  if (ll_uuid) qs.set('ll_uuid', ll_uuid)
  else if (lat != null && lng != null) { qs.set('lat', String(lat)); qs.set('lng', String(lng)) }
  if (!qs.toString()) return null

  const [regridRes, enrich] = await Promise.all([
    fetchWithAuth(`${API_URL}/api/regrid/parcel?${qs.toString()}`).catch(() => null),
    ll_uuid
      ? fetchWithAuth(`${API_URL}/api/parcel-enrichment/by-uuid?ll_uuid=${encodeURIComponent(ll_uuid)}`)
          .then(r => (r.ok ? r.json() : null)).catch(() => null)
      : Promise.resolve(null),
  ])
  let parcel: any = null
  if (regridRes?.ok) {
    const body = await regridRes.json()
    parcel = body?.parcel || null
  }
  if (!parcel && !tileProps) return null

  const derived = deriveParcelDetail(parcel, tileProps ?? {}, enrich)
  const resolvedUuid: string | null = ll_uuid || parcel?.ll_uuid || null
  const id = input.reportId || resolvedUuid
    || (tileProps?.path as string | undefined)
    || (lat != null && lng != null ? `parcel:${lng.toFixed(6)},${lat.toFixed(6)}` : null)
  if (!id) return null
  const validSalePrice = typeof derived.saleprice === 'number' && derived.saleprice > 0
  const saledate = (parcel?.saledate ?? tileProps?.saledate) as string | undefined

  return {
    id,
    llUuid: resolvedUuid,
    listingId: null,
    tractId: null,
    auctionDate: typeof saledate === 'string' ? saledate.slice(0, 10) : null,
    totalAcres: derived.gisacre,
    tillableAcres: derived.tillableAcres,
    soilRating: derived.soilRating,
    soilRatingType: derived.soilRatingType,
    pctTillable: derived.pctTillable,
    companyName: null,
    owner: derived.owner && derived.owner !== 'Unknown' ? derived.owner : null,
    latitude: lat ?? parcel?.lat ?? null,
    longitude: lng ?? parcel?.lon ?? null,
    salePrice: validSalePrice ? derived.saleprice : null,
    pricePerAcre: derived.ppa,
    county: derived.county,
    state: derived.state,
    township: derived.township || null,
    saleStatus: 'sold',
  } as TractSaleData
}
