'use client'

import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

interface MapListing {
  id: string
  title: string
  county: string
  state: string
  lat: number
  lng: number
  pricePerAcre: number
  totalAcres: number
  companyName: string
  companyId: string
  status: string
}

interface MapComponentProps {
  listings: MapListing[]
  priceRange: { min: number; max: number }
}

export default function MapComponent({ listings, priceRange }: MapComponentProps) {
  // Calculate circle radius based on price per acre
  const getRadius = (pricePerAcre: number): number => {
    if (pricePerAcre <= 0) return 8
    const range = priceRange.max - priceRange.min
    if (range === 0) return 15
    const normalized = (pricePerAcre - priceRange.min) / range
    return 8 + normalized * 22 // 8-30px radius
  }

  // Get color based on status
  const getColor = (status: string): string => {
    switch (status) {
      case 'sold':
        return '#22c55e' // green
      case 'pending':
        return '#eab308' // yellow
      case 'no_sale':
        return '#ef4444' // red
      default:
        return '#3b82f6' // blue for listed/active
    }
  }

  // Center map on Midwest
  const center: [number, number] = [41.0, -91.5]

  return (
    <MapContainer
      center={center}
      zoom={6}
      style={{ height: '600px', width: '100%' }}
      className="rounded-xl"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {listings.map((listing) => (
        <CircleMarker
          key={listing.id}
          center={[listing.lat, listing.lng]}
          radius={getRadius(listing.pricePerAcre)}
          fillColor={getColor(listing.status)}
          color={getColor(listing.status)}
          weight={2}
          opacity={0.8}
          fillOpacity={0.5}
        >
          <Popup>
            <div className="text-sm">
              <p className="font-bold text-gray-900">{listing.county} County, {listing.state}</p>
              <p className="text-gray-600">{listing.companyName}</p>
              {listing.pricePerAcre > 0 && (
                <p className="text-gray-800 font-medium">
                  ${listing.pricePerAcre.toLocaleString()}/acre
                </p>
              )}
              {listing.totalAcres > 0 && (
                <p className="text-gray-600">{listing.totalAcres.toFixed(1)} acres</p>
              )}
              <p className="text-gray-500 capitalize">{listing.status}</p>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
