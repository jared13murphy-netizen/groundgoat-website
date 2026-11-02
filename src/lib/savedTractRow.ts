// Comp-report row for a saved tract (Map It), built from the panel's detail
// record. Row id is `cm:<id>` — the same key the map's saved-tract layer
// reads from reportIds — and `savedId` makes the report builders send
// { source: "saved", cm_id }.

import type { SavedTractDetail } from '@/lib/configurableMapping'
import type { TractSaleData } from '@/components/portal/PortalTractDetail'

export function savedReportId(id: string): string {
  return `cm:${id}`
}

export function buildSavedReportRow(d: SavedTractDetail): TractSaleData {
  const acres = typeof d.acres === 'number' ? d.acres : null
  const tillable = typeof d.tillable_acres === 'number' ? d.tillable_acres : null
  return {
    id: savedReportId(d.id),
    savedId: d.id,
    llUuid: null,
    listingId: null,
    tractId: null,
    auctionDate: null,
    totalAcres: acres,
    tillableAcres: tillable,
    soilRating: d.soil?.rating ?? null,
    soilRatingType: d.soil?.rating_type ?? null,
    pctTillable: acres && tillable != null ? (tillable / acres) * 100 : null,
    companyName: null,
    owner: null,
    latitude: d.centroid?.lat ?? null,
    longitude: d.centroid?.lng ?? null,
    salePrice: null,
    pricePerAcre: null,
    county: d.county || '',
    state: d.state || '',
    township: null,
    saleStatus: 'saved',
  } as TractSaleData
}
