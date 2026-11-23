// Comp-report row for a saved tract (Map It), built from the panel's detail
// record. Row id is `cm:<id>` — the same key the map's saved-tract layer
// reads from reportIds — and `savedId` makes the report builders send
// { source: "saved", cm_id }.

import type { SavedTractDetail } from '@/lib/configurableMapping'
import type { TractSaleData } from '@/components/portal/PortalTractDetail'
import { savedTractFigures, parcelRowFields } from '@/lib/parcelFigures'
import { tractPriceMode } from '@/lib/priceDisplay'

export function savedReportId(id: string): string {
  return `cm:${id}`
}

export function buildSavedReportRow(d: SavedTractDetail): TractSaleData {
  // Figures from the ONE helper (src/lib/parcelFigures.ts): the server's
  // `figures`, or the old-API numbers — never computed here.
  const fig = savedTractFigures(d)
  const fields = parcelRowFields(fig, tractPriceMode({ total_acres: fig.acres, land_types: fig.landTypes }))
  return {
    id: savedReportId(d.id),
    savedId: d.id,
    llUuid: null,
    listingId: null,
    tractId: null,
    auctionDate: null,
    ...fields,
    companyName: null,
    owner: null,
    latitude: d.centroid?.lat ?? null,
    longitude: d.centroid?.lng ?? null,
    county: d.county || '',
    state: d.state || '',
    township: null,
    saleStatus: 'saved',
  } as TractSaleData
}
