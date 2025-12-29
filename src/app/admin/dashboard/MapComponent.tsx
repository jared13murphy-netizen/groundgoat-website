'use client'

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
  totalPrice: number
  listedAcres: number
  soldAcres: number
  tractCount: number
  auctionDate: string
  auctionTime: string
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
  // For "listed" status, use standard medium size
  // Below $8k = small (4-8px), $8k-$12k = medium (8-18px), $12k-$20k+ = large (20-40px)
  const getRadius = (pricePerAcre: number, status: string): number => {
    // Listed listings get a standard medium size
    if (status === 'listed' || status === 'active') {
      return 12
    }
    
    if (pricePerAcre <= 0) return 6
    
    if (pricePerAcre < 8000) {
      // Small range: 4-8px for $0-$8k
      return 4 + (pricePerAcre / 8000) * 4
    } else if (pricePerAcre < 12000) {
      // Medium range: 8-18px for $8k-$12k
      const normalized = (pricePerAcre - 8000) / 4000
      return 8 + normalized * 10
    } else if (pricePerAcre < 20000) {
      // Large range: 18-32px for $12k-$20k
      const normalized = (pricePerAcre - 12000) / 8000
      return 18 + normalized * 14
    } else {
      // Extra large: 32-45px for $20k+
      const normalized = Math.min((pricePerAcre - 20000) / 10000, 1)
      return 32 + normalized * 13
    }
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
        return '#f58cde' // Ground Goat pink for listed/active
    }
  }

  const formatCurrency = (amount: number): string => {
    if (amount >= 1000000) {
      return '$' + (amount / 1000000).toFixed(2) + 'M'
    }
    return '$' + amount.toLocaleString()
  }

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return 'TBD'
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  const formatTime = (timeStr: string): string => {
    if (!timeStr) return ''
    // Handle various time formats
    try {
      const [hours, minutes] = timeStr.split(':')
      const h = parseInt(hours)
      const ampm = h >= 12 ? 'PM' : 'AM'
      const h12 = h % 12 || 12
      return h12 + ':' + minutes + ' ' + ampm
    } catch {
      return timeStr
    }
  }

  // Center map on Midwest
  const center: [number, number] = [41.0, -91.5]

  return (
    <MapContainer
      center={center}
      zoom={6}
      style={{ height: '500px', width: '100%' }}
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
          radius={getRadius(listing.pricePerAcre, listing.status)}
          fillColor={getColor(listing.status)}
          color={getColor(listing.status)}
          weight={1}
          opacity={0.8}
          fillOpacity={0.5}
        >
          <Popup>
            <div className="text-sm min-w-[200px]">
              <p className="font-bold text-gray-900 text-base mb-1">
                {listing.county} County, {listing.state}
              </p>
              <p className="text-gray-600 mb-2">{listing.companyName}</p>
              
              <div className="border-t border-gray-200 pt-2 mt-2 space-y-1">
                {listing.pricePerAcre > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Price/Acre:</span>
                    <span className="font-medium text-gray-900">
                      ${listing.pricePerAcre.toLocaleString()}
                    </span>
                  </div>
                )}
                {listing.totalPrice > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Total Price:</span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(listing.totalPrice)}
                    </span>
                  </div>
                )}
                {listing.listedAcres > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Listed Acres:</span>
                    <span className="text-gray-800">{listing.listedAcres.toFixed(1)}</span>
                  </div>
                )}
                {listing.soldAcres > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Sold Acres:</span>
                    <span className="text-gray-800">{listing.soldAcres.toFixed(1)}</span>
                  </div>
                )}
                {listing.tractCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500"># Tracts:</span>
                    <span className="text-gray-800">{listing.tractCount}</span>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-200 pt-2 mt-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Auction:</span>
                  <span className="text-gray-800">
                    {formatDate(listing.auctionDate)}
                    {listing.auctionTime && ' @ ' + formatTime(listing.auctionTime)}
                  </span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-gray-500">Status:</span>
                  <span className={`font-medium capitalize ${
                    listing.status === 'sold' ? 'text-green-600' :
                    listing.status === 'pending' ? 'text-yellow-600' :
                    listing.status === 'no_sale' ? 'text-red-600' :
                    'text-pink-500'
                  }`}>
                    {listing.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
