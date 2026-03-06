'use client'

import { useRef, useEffect } from 'react'
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

interface ComparablesMapProps {
  comparables: ComparablePin[]
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

      // Create subject marker
      const subjectEl = createMarkerElement(
        true,
        null,
        subjectAcres || null
      )
      const subjectMarker = new maplibregl.Marker({ element: subjectEl })
        .setLngLat([subjectLng, subjectLat])
        .addTo(map)
      markersRef.current.push(subjectMarker)

      // Create comparable markers
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
          comp.total_acres || null
        )

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map)

        // Click popup
        el.addEventListener('click', () => {
          if (popupRef.current) popupRef.current.remove()

          const popup = new maplibregl.Popup({
            offset: 25,
            className: 'comp-popup',
            closeButton: true,
            maxWidth: '280px',
          })
            .setLngLat([lng, lat])
            .setHTML(buildPopupHTML(comp))
            .addTo(map)

          popupRef.current = popup
        })

        markersRef.current.push(marker)
      }

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
  }, [comparables, subjectCounty, subjectState, subjectLatitude, subjectLongitude, subjectAcres])

  return (
    <div className="comparables-map-container" style={{ height }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}

function createMarkerElement(
  isSubject: boolean,
  pricePerAcre: number | null,
  acres: number | null
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
      priceEl.textContent = `${formatCurrency(pricePerAcre)}/ac`
      label.appendChild(priceEl)
    }
    if (acres) {
      const acresEl = document.createElement('div')
      acresEl.className = 'comp-marker-acres'
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

function buildPopupHTML(comp: ComparablePin): string {
  const county = `${comp.county} County, ${comp.state}`
  const lines: string[] = [
    `<div class="comp-popup-title">${county}</div>`,
  ]

  if (comp.tract_number) {
    lines.push(`<div class="comp-popup-stat"><span class="comp-popup-stat-label">Tract</span><span class="comp-popup-stat-value">${comp.tract_number}</span></div>`)
  }
  if (comp.total_acres) {
    lines.push(`<div class="comp-popup-stat"><span class="comp-popup-stat-label">Acres</span><span class="comp-popup-stat-value">${formatAcres(comp.total_acres)}</span></div>`)
  }
  if (comp.price_per_acre) {
    lines.push(`<div class="comp-popup-stat"><span class="comp-popup-stat-label">$/Acre</span><span class="comp-popup-stat-value">${formatCurrency(comp.price_per_acre)}</span></div>`)
  }
  if (comp.auction_date) {
    lines.push(`<div class="comp-popup-stat"><span class="comp-popup-stat-label">Sale Date</span><span class="comp-popup-stat-value">${formatDate(comp.auction_date)}</span></div>`)
  }
  if (comp.company_name) {
    lines.push(`<div class="comp-popup-stat"><span class="comp-popup-stat-label">Company</span><span class="comp-popup-stat-value">${comp.company_name}</span></div>`)
  }
  if (comp.is_same_county) {
    lines.push(`<div style="margin-top: 6px; padding: 2px 8px; background: rgba(245,140,222,0.2); border-radius: 4px; text-align: center; font-size: 11px; color: #F58CDE; font-weight: 600;">Same County</div>`)
  }

  return lines.join('')
}
