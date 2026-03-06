'use client'

import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ComparablesMap.css'
import { TILE_URL, TILE_ATTRIBUTION, GLYPH_URL } from './mapConstants'
import { countyCentroids } from '@/data/countyCentroids'

interface ComparablePin {
  id: string
  county: string
  state: string
  latitude?: number | null
  longitude?: number | null
  price_per_acre?: number | null
  total_acres?: number | null
  tract_number?: number | null
  company_name?: string | null
  auction_date?: string | null
  is_same_county?: boolean
}

interface StateSale {
  id: string
  latitude: number | null
  longitude: number | null
  price_per_acre: number | null
  total_acres: number | null
  sale_price: number | null
  county: string
  state: string
  township: string | null
  auction_date: string | null
  company_name: string | null
}

interface SaleDetail {
  auctionDate?: string | null
  totalAcres?: number | null
  companyName?: string | null
  salePrice?: number | null
  pricePerAcre?: number | null
  county: string
  state: string
  township?: string | null
  isComparable: boolean
}

interface ComparablesMapProps {
  comparables: ComparablePin[]
  stateSales?: StateSale[]
  subjectCounty: string
  subjectState: string
  subjectLatitude?: number | null
  subjectLongitude?: number | null
  subjectAcres?: number | null
  height?: string
}

function getCountyCentroid(county: string, state: string): [number, number] | null {
  const key = `${county}, ${state}`
  return countyCentroids[key] || null
}

function hashCode(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i)
    hash |= 0
  }
  return hash
}

function getOffsetForId(id: string): { latOffset: number; lngOffset: number } {
  const h = hashCode(id)
  const angle = (Math.abs(h) % 360) * (Math.PI / 180)
  const distance = 0.01 + (Math.abs(h % 100) / 100) * 0.02
  return {
    latOffset: Math.cos(angle) * distance,
    lngOffset: Math.sin(angle) * distance,
  }
}

function formatCurrency(amount: number | null | undefined): string {
  if (!amount) return '—'
  return '$' + Math.round(amount).toLocaleString('en-US')
}

function formatAcres(acres: number | null | undefined): string {
  if (!acres) return '—'
  return acres.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function ComparablesMap({
  comparables,
  stateSales = [],
  subjectCounty,
  subjectState,
  subjectLatitude,
  subjectLongitude,
  subjectAcres,
  height = '500px',
}: ComparablesMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)

  useEffect(() => {
    if (!mapContainerRef.current) return

    // Determine subject pin coordinates
    let subjectLng: number
    let subjectLat: number

    if (subjectLatitude && subjectLongitude) {
      subjectLat = subjectLatitude
      subjectLng = subjectLongitude
    } else {
      const centroid = getCountyCentroid(subjectCounty, subjectState)
      if (centroid) {
        [subjectLat, subjectLng] = centroid
      } else {
        // Fallback to midwest center
        subjectLat = 40.0
        subjectLng = -89.5
      }
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [TILE_URL],
            tileSize: 256,
            attribution: TILE_ATTRIBUTION,
          },
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
        glyphs: GLYPH_URL,
      },
      center: [subjectLng, subjectLat],
      zoom: 9,
      maxZoom: 16,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('load', () => {
      // Add county boundaries
      map.addSource('counties', {
        type: 'geojson',
        data: '/data/us-counties.json',
      })
      map.addLayer({
        id: 'county-borders',
        type: 'line',
        source: 'counties',
        paint: {
          'line-color': '#888888',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.1, 5, 0.3, 7, 0.6, 10, 1.0],
          'line-opacity': 0.35,
        },
      })

      // Add state boundaries (bolder than counties)
      map.addSource('states', {
        type: 'geojson',
        data: '/data/us-states.json',
      })
      map.addLayer({
        id: 'state-borders',
        type: 'line',
        source: 'states',
        paint: {
          'line-color': '#bbbbbb',
          'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 5, 1.5, 7, 2.0, 10, 2.5],
          'line-opacity': 0.6,
        },
      })

      // Add county name labels
      map.addLayer({
        id: 'county-labels',
        type: 'symbol',
        source: 'counties',
        minzoom: 7,
        layout: {
          'text-field': ['get', 'NAME'],
          'text-font': ['Open Sans Regular'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 7, 10, 10, 14],
          'text-anchor': 'center',
          'text-max-width': 8,
        },
        paint: {
          'text-color': '#555555',
          'text-halo-color': '#ffffff',
          'text-halo-width': 1.5,
          'text-opacity': 0.75,
        },
      })

      // Collect all coordinates for bounds fitting
      const allCoords: [number, number][] = [[subjectLng, subjectLat]]

      // Create state sales markers first (non-bold, rendered behind comparables)
      const comparableIds = new Set(comparables.map(c => c.id))
      for (const sale of stateSales) {
        if (comparableIds.has(sale.id) || !sale.latitude || !sale.longitude) continue

        const el = createMarkerElement(
          false,
          sale.price_per_acre || null,
          sale.total_acres || null,
          false // non-bold
        )

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([sale.longitude, sale.latitude])
          .addTo(map)

        // Click to open modal
        el.addEventListener('click', () => {
          if (popupRef.current) popupRef.current.remove()
          setSelectedSale({
            auctionDate: sale.auction_date,
            totalAcres: sale.total_acres,
            companyName: sale.company_name,
            salePrice: sale.sale_price,
            pricePerAcre: sale.price_per_acre,
            county: sale.county,
            state: sale.state,
            township: sale.township,
            isComparable: false,
          })
        })

        markersRef.current.push(marker)
      }

      // Create comparable markers (bold, rendered on top of state sales)
      for (const comp of comparables) {
        let lng: number
        let lat: number

        if (comp.latitude && comp.longitude) {
          lat = comp.latitude
          lng = comp.longitude
        } else {
          const centroid = getCountyCentroid(comp.county, comp.state)
          if (centroid) {
            const offset = getOffsetForId(comp.id)
            lat = centroid[0] + offset.latOffset
            lng = centroid[1] + offset.lngOffset
          } else {
            continue // Skip if no coordinates available
          }
        }

        allCoords.push([lng, lat])

        const el = createMarkerElement(
          false,
          comp.price_per_acre || null,
          comp.total_acres || null,
          true // bold
        )

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map)

        // Click to open modal
        el.addEventListener('click', () => {
          if (popupRef.current) popupRef.current.remove()
          setSelectedSale({
            auctionDate: comp.auction_date,
            totalAcres: comp.total_acres,
            companyName: comp.company_name,
            salePrice: null, // comparables don't have sale_price from scoring endpoint
            pricePerAcre: comp.price_per_acre,
            county: comp.county,
            state: comp.state,
            township: null,
            isComparable: true,
          })
        })

        markersRef.current.push(marker)
      }

      // Create subject marker last so it renders on top of comparable pins
      const subjectEl = createMarkerElement(
        true,
        null,
        subjectAcres || null,
        true
      )
      const subjectMarker = new maplibregl.Marker({ element: subjectEl })
        .setLngLat([subjectLng, subjectLat])
        .addTo(map)
      markersRef.current.push(subjectMarker)

      // Fit to bounds if we have multiple points
      if (allCoords.length > 1) {
        const bounds = new maplibregl.LngLatBounds()
        for (const coord of allCoords) {
          bounds.extend(coord as [number, number])
        }
        map.fitBounds(bounds, { padding: 60, maxZoom: 12 })
      }
    })

    return () => {
      markersRef.current.forEach(m => m.remove())
      markersRef.current = []
      if (popupRef.current) popupRef.current.remove()
      map.remove()
      mapRef.current = null
    }
  }, [comparables, stateSales, subjectCounty, subjectState, subjectLatitude, subjectLongitude, subjectAcres])

  return (
    <div className="comparables-map-container" style={{ height }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="sale-modal-overlay" onClick={() => setSelectedSale(null)}>
          <div className="sale-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="sale-modal-header">
              <h3 className="sale-modal-title">
                {selectedSale.isComparable ? 'Comparable Sale' : 'Tract Sale'}
              </h3>
              <button className="sale-modal-close" onClick={() => setSelectedSale(null)}>✕</button>
            </div>
            <div className="sale-modal-body">
              <div className="sale-modal-row">
                <span className="sale-modal-label">Date Sold</span>
                <span className="sale-modal-value">{formatDate(selectedSale.auctionDate)}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Sold Acres</span>
                <span className="sale-modal-value">
                  {selectedSale.totalAcres ? formatAcres(selectedSale.totalAcres) + ' ac' : '—'}
                </span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Listing Company</span>
                <span className="sale-modal-value">{selectedSale.companyName || '—'}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Total Sale Price</span>
                <span className="sale-modal-value">{formatCurrency(selectedSale.salePrice)}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Price/Acre</span>
                <span className="sale-modal-value">
                  {selectedSale.pricePerAcre ? formatCurrency(selectedSale.pricePerAcre) + '/ac' : '—'}
                </span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">County</span>
                <span className="sale-modal-value">{selectedSale.county || '—'}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">State</span>
                <span className="sale-modal-value">{selectedSale.state || '—'}</span>
              </div>
              <div className="sale-modal-row" style={{ borderBottom: 'none' }}>
                <span className="sale-modal-label">Township</span>
                <span className="sale-modal-value">{selectedSale.township || '—'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function createMarkerElement(
  isSubject: boolean,
  pricePerAcre: number | null,
  acres: number | null,
  bold: boolean = true
): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'

  // Label above pin
  const label = document.createElement('div')
  label.className = `comp-marker-label${isSubject ? ' subject' : ''}`

  if (isSubject) {
    const priceEl = document.createElement('div')
    priceEl.className = 'comp-marker-price'
    priceEl.style.color = '#F58CDE'
    priceEl.textContent = 'Subject Tract'
    label.appendChild(priceEl)
    if (acres) {
      const acresEl = document.createElement('div')
      acresEl.className = 'comp-marker-acres'
      acresEl.textContent = `${formatAcres(acres)} ac`
      label.appendChild(acresEl)
    }
  } else {
    if (pricePerAcre) {
      const priceEl = document.createElement('div')
      priceEl.className = 'comp-marker-price'
      if (!bold) priceEl.style.fontWeight = '400'
      priceEl.textContent = `${formatCurrency(pricePerAcre)}/ac`
      label.appendChild(priceEl)
    }
    if (acres) {
      const acresEl = document.createElement('div')
      acresEl.className = 'comp-marker-acres'
      if (!bold) acresEl.style.fontWeight = '400'
      acresEl.textContent = `${formatAcres(acres)} ac`
      label.appendChild(acresEl)
    }
  }

  container.appendChild(label)

  // Pin dot
  const pin = document.createElement('div')
  pin.className = `comp-marker-pin ${isSubject ? 'subject' : 'comparable'}`
  container.appendChild(pin)

  return container
}
