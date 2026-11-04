// Rebuild a saved report's rows from its recipe (owner 2026-11-03). Every row
// is re-read live: listing tracts come resolved from the API, parcels go
// through buildParcelReportRow (the one parcel record), saved tracts through
// their detail endpoint — the same builders the panels use when a row is
// added by hand, so a reopened report is byte-identical to a fresh one.
import { buildParcelReportRow } from '@/lib/parcelReportRow'
import { buildSavedReportRow } from '@/lib/savedTractRow'
import { getSavedTractDetail, type SavedReportRow } from '@/lib/configurableMapping'
import type { TractSaleData } from '@/components/portal/PortalTractDetail'

export function tractRowFromApi(t: any): TractSaleData {
  const isPT = (t.listing_type || '').toLowerCase() === 'private_treaty'
  const isPending = (t.sale_status || '').toLowerCase() === 'pending'
  const ppa = (isPT || isPending) && t.asking_price && t.total_acres ? t.asking_price / t.total_acres : (t.price_per_acre ?? null)
  return {
    id: String(t.id),
    listingId: t.listing_id ?? null,
    tractId: String(t.id),
    auctionDate: t.auction_date ?? null,
    totalAcres: t.total_acres ?? null,
    tillableAcres: t.tillable_acres ?? null,
    pctTillable: t.pct_tillable ?? null,
    soilRating: t.soil_rating ?? null,
    soilRatingType: t.soil_rating_type ?? null,
    companyName: t.company_name ?? null,
    latitude: t.latitude ?? null,
    longitude: t.longitude ?? null,
    salePrice: t.sale_price ?? null,
    pricePerAcre: ppa,
    pricePerTillableAcre: t.price_per_tillable_acre ?? null,
    pricePerSoilRating: t.price_per_soil_rating ?? null,
    county: t.county || '',
    state: t.state || '',
    township: t.township ?? null,
    saleStatus: t.sale_status ?? null,
    listingType: t.listing_type ?? null,
    askingPrice: t.asking_price ?? null,
    polygonCoordinates: t.polygon_coordinates ?? null,
  } as TractSaleData
}

export async function rebuildSavedReportRows(report: SavedReportRow, tracts: any[]): Promise<TractSaleData[]> {
  const byId = new Map<string, any>((tracts || []).map((t) => [String(t.id), t]))
  const built = await Promise.all((report.items || []).map(async (it): Promise<TractSaleData | null> => {
    try {
      let row: TractSaleData | null = null
      if (it.source === 'saved' && it.cm_id) {
        row = buildSavedReportRow(await getSavedTractDetail(it.cm_id))
      } else if (it.source === 'parcel') {
        row = await buildParcelReportRow({ ll_uuid: it.ll_uuid || null, lat: it.latitude ?? null, lng: it.longitude ?? null, tileProps: null })
      } else if (it.tract_id && byId.has(String(it.tract_id))) {
        row = tractRowFromApi(byId.get(String(it.tract_id)))
      }
      if (row && it.notes) row = { ...row, notes: it.notes }
      return row
    } catch {
      return null
    }
  }))
  return built.filter((r): r is TractSaleData => !!r)
}
