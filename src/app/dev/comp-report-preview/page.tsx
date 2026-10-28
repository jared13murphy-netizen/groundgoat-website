'use client'

// LOCAL-ONLY preview harness for the Comparable Sales report panel — renders
// the REAL PortalComparablesReportPanel with fixture comps (two tracts and
// one parcel, one without a rating) so the summary block and the cards can
// be checked without WebGL / a signed-in map session. Same pattern as
// /dev/chip-preview.

import { useState } from 'react'
import PortalComparablesReportPanel from '@/components/portal/PortalComparablesReportPanel'
import type { TractSaleData } from '@/components/portal/PortalTractDetail'

const FIXTURE: TractSaleData[] = [
  {
    id: 't1', listingId: 'l1', tractId: 't1', auctionDate: '2026-02-15T18:00:00Z',
    totalAcres: 61.296, tillableAcres: 15.3, companyName: 'Sullivan Auctioneers', sourceUrl: null,
    owner: null, latitude: 40.4, longitude: -90.7, salePrice: 301718, pricePerAcre: 4922,
    county: 'McDonough', state: 'IL', township: 'Macomb', soilRating: 116.9, soilRatingType: 'PI',
    polygonCoordinates: null, saleStatus: 'sold', listingType: 'auction', askingPrice: null,
    pctTillable: 25, pricePerTillableAcre: 19719, pricePerSoilRating: 42.1, landType: 'Farm', landTypes: null, deeds: null,
  } as unknown as TractSaleData,
  {
    id: '1c7e7a7b-7335-5ba7-a863-4f88d63ee9ee', listingId: null, tractId: null, auctionDate: '2020-12-29',
    totalAcres: 17.714, tillableAcres: 1.4, companyName: null, sourceUrl: null,
    owner: 'POTTHOFF AMY K', latitude: 40.3, longitude: -90.6, salePrice: 21904, pricePerAcre: 1237,
    county: 'Schuyler', state: 'IL', township: null, soilRating: 129.0, soilRatingType: 'PI',
    polygonCoordinates: null, saleStatus: 'sold', listingType: null, askingPrice: null,
    pctTillable: 8, pricePerTillableAcre: null, pricePerSoilRating: null, landType: null, landTypes: null, deeds: null,
  } as unknown as TractSaleData,
  {
    id: '1cd58b5c-0939-58bf-9985-f9988af5f3ec', listingId: null, tractId: null, auctionDate: '2020-12-29',
    totalAcres: 76.612, tillableAcres: null, companyName: null, sourceUrl: null,
    owner: 'POTTHOFF AMY K', latitude: 40.3, longitude: -90.6, salePrice: 94733, pricePerAcre: 1237,
    county: 'Schuyler', state: 'IL', township: null, soilRating: null, soilRatingType: null,
    polygonCoordinates: null, saleStatus: 'sold', listingType: null, askingPrice: null,
    pctTillable: null, pricePerTillableAcre: null, pricePerSoilRating: null, landType: null, landTypes: null, deeds: null,
  } as unknown as TractSaleData,
]

export default function CompReportPreview() {
  const [items, setItems] = useState<TractSaleData[]>(FIXTURE)
  return (
    <div className="min-h-screen bg-gg-gray-900">
      <PortalComparablesReportPanel
        subjectInfo={{
          county: 'Hancock', state: 'IL', subject_acres: 80, subject_tillable_acres: 72.4,
          subject_pct_tillable: 90.5, subject_soil_rating: 131.2, subject_soil_rating_type: 'PI',
          subject_township: 'Carthage', subject_land_type: 'Farm', subject_kind: 'tract',
        }}
        reportTracts={items}
        onRemoveTract={(id) => setItems(cur => cur.filter(t => t.id !== id))}
        onClose={() => {}}
        onView3DTerrain={() => {}}
        onViewListing={() => {}}
      />
    </div>
  )
}
