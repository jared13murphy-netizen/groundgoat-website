'use client'

import { useRef, useEffect, useState } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ComparablesMap.css'
import { TILE_URL, TILE_ATTRIBUTION, GLYPH_URL, LABEL_TILE_URL } from './mapConstants'
import { countyCentroids } from '@/data/countyCentroids'
import { normalizeTownship } from '../../utils/normalizeTownship'
import Tract3DModal from '@/components/Tract3DModal'
import { addRegridLayer, fetchRegridConfig, type RegridConfig } from './regridLayer'

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
  tract_id?: string | null
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
  polygon_coordinates?: number[][] | null
  tillable_acres?: number | null
  soil_rating?: number | null
  source_url?: string | null
}

interface SaleDetail {
  id: string
  tractId?: string | null
  auctionDate?: string | null
  totalAcres?: number | null
  companyName?: string | null
  salePrice?: number | null
  pricePerAcre?: number | null
  county: string
  state: string
  township?: string | null
  tillableAcres?: number | null
  soilRating?: number | null
  polygonCoordinates?: number[][] | null
  sourceUrl?: string | null
}

interface ComparablesMapProps {
  comparables: ComparablePin[]
  stateSales?: StateSale[]
  subjectCounty: string
  subjectState: string
  subjectLatitude?: number | null
  subjectLongitude?: number | null
  subjectAcres?: number | null
  subjectPolygon?: number[][] | null
  height?: string
  selectedIds?: Set<string>
  toggleSelection?: (item: any) => void
  visibleIds?: Set<string>
}

function getCountyCentroid(county: string, state: string): [number, number] | null {
  const key = `${county}, ${state}`
  return countyCentroids[key] || null
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
  subjectPolygon,
  height = '500px',
  selectedIds = new Set<string>(),
  toggleSelection,
  visibleIds,
}: ComparablesMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const markerElementsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [show3DViewer, setShow3DViewer] = useState(false)
  const [regridConfig, setRegridConfig] = useState<RegridConfig | null>(null)
  // Tracks when the map's `load` event has fired so we can mount the
  // Regrid layer after the basemap is ready (separate from the main
  // map-build useEffect which is concerned with comp markers + tract
  // polygons).
  const [mapReady, setMapReady] = useState(false)

  // Fetch Regrid tile-URL config once on mount.
  useEffect(() => {
    let cancelled = false
    fetchRegridConfig().then(cfg => {
      if (!cancelled && cfg) setRegridConfig(cfg)
    })
    return () => { cancelled = true }
  }, [])

  // Mount the Regrid vector-tile layer once both the map and the
  // config are ready. Cleanup on unmount.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady || !regridConfig) return
    // Tract polygons paint ON TOP of Regrid so the auction / sold
    // outlines remain visible.
    const cleanup = addRegridLayer(map, regridConfig, {
      beforeId: 'tract-polygon-fill',
      minZoom: 14,
    })
    return cleanup
  }, [mapReady, regridConfig])

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
          'city-labels': {
            type: 'raster',
            tiles: [LABEL_TILE_URL],
            tileSize: 256,
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
          {
            id: 'city-label-tiles',
            type: 'raster',
            source: 'city-labels',
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
      setMapReady(true)
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

      // Add tract polygon boundaries (filtered by visibleIds when provided)
      const polygonFeatures: any[] = []
      for (const sale of stateSales) {
        if (visibleIds && !visibleIds.has(String(sale.id)) && !visibleIds.has(String(sale.tract_id))) continue
        if (sale.polygon_coordinates && sale.polygon_coordinates.length > 2) {
          polygonFeatures.push({
            type: 'Feature',
            properties: { id: sale.id },
            geometry: {
              type: 'Polygon',
              coordinates: [sale.polygon_coordinates],
            },
          })
        }
      }

      // Add subject tract polygon
      if (subjectPolygon && subjectPolygon.length > 2) {
        polygonFeatures.push({
          type: 'Feature',
          properties: { id: 'subject', isSubject: true },
          geometry: {
            type: 'Polygon',
            coordinates: [subjectPolygon],
          },
        })
      }

      if (polygonFeatures.length > 0) {
        map.addSource('tract-polygons', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: polygonFeatures },
        })
        map.addLayer({
          id: 'tract-polygon-fill',
          type: 'fill',
          source: 'tract-polygons',
          paint: {
            'fill-color': '#E91E8C',
            // Bumped 0.08 → 0.20 for visibility against Regrid parcels
            'fill-opacity': 0.20,
          },
        })
        map.addLayer({
          id: 'tract-polygon-line',
          type: 'line',
          source: 'tract-polygons',
          paint: {
            'line-color': '#E91E8C',
            'line-width': ['case', ['==', ['get', 'isSubject'], true], 4, 3],
            'line-opacity': 1.0,
          },
        })
        // Push tract polygon layers to top after Regrid loads (Regrid
        // uses beforeId='tract-polygon-fill' on init, but if Regrid
        // attached first that no-ops; this fixes either ordering).
        if (map.getLayer('regrid-parcels-fill')) {
          map.moveLayer('tract-polygon-fill')
          map.moveLayer('tract-polygon-line')
        }
      }

      // Bounds: fit to comparable pins + subject (not all state sales)
      const comparableIds = new Set(comparables.map(c => String(c.id)))
      const allCoords: [number, number][] = [[subjectLng, subjectLat]]

      // Helper: calculate polygon centroid
      const getPolygonCentroid = (coords: number[][]): [number, number] | null => {
        if (!coords || coords.length < 3) return null
        let sumLng = 0, sumLat = 0
        for (const [lng, lat] of coords) {
          sumLng += lng
          sumLat += lat
        }
        return [sumLng / coords.length, sumLat / coords.length]
      }

      // Create markers for sold tracts with boundaries only
      // When visibleIds is provided, only show tracts in that set
      markerElementsRef.current.clear()
      for (const sale of stateSales) {
        // Skip tracts not in visible set (when filtering is active)
        if (visibleIds && !visibleIds.has(String(sale.id)) && !visibleIds.has(String(sale.tract_id))) continue
        // Skip tracts without boundary data
        if (!sale.polygon_coordinates || !Array.isArray(sale.polygon_coordinates) || sale.polygon_coordinates.length < 3) continue

        // Use polygon centroid for marker placement
        let markerLng = sale.longitude
        let markerLat = sale.latitude
        const centroid = getPolygonCentroid(sale.polygon_coordinates)
        if (centroid) {
          markerLng = centroid[0]
          markerLat = centroid[1]
        }
        if (!markerLat || !markerLng) continue

        const el = createMarkerElement(
          sale.price_per_acre || null,
          sale.total_acres || null,
          selectedIds.has(String(sale.id))
        )
        markerElementsRef.current.set(String(sale.id), el)

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([markerLng, markerLat])
          .addTo(map)

        // Track comparable coords for bounds fitting
        if (comparableIds.has(String(sale.id))) {
          allCoords.push([markerLng, markerLat])
        }

        // Click to open modal
        el.addEventListener('click', () => {
          setSelectedSale({
            id: sale.id,
            tractId: sale.tract_id || sale.id,
            auctionDate: sale.auction_date,
            totalAcres: sale.total_acres,
            companyName: sale.company_name,
            salePrice: sale.sale_price,
            pricePerAcre: sale.price_per_acre,
            county: sale.county,
            state: sale.state,
            township: sale.township,
            tillableAcres: sale.tillable_acres,
            soilRating: sale.soil_rating,
            polygonCoordinates: sale.polygon_coordinates,
            sourceUrl: sale.source_url,
          })
        })

        markersRef.current.push(marker)
      }

      // Create subject marker last so it renders on top
      const subjectEl = createSubjectMarkerElement(subjectAcres || null)
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
      map.remove()
      mapRef.current = null
    }
  }, [comparables, stateSales, subjectCounty, subjectState, subjectLatitude, subjectLongitude, subjectAcres, subjectPolygon, visibleIds])

  // Update marker styles when selectedIds changes (without recreating map)
  useEffect(() => {
    markerElementsRef.current.forEach((el, id) => {
      const label = el.querySelector('.comp-marker-label') as HTMLElement
      const pin = el.querySelector('.comp-marker-pin') as HTMLElement
      if (!label || !pin) return
      if (selectedIds.has(id)) {
        label.classList.add('selected')
        pin.classList.add('selected')
      } else {
        label.classList.remove('selected')
        pin.classList.remove('selected')
      }
    })
  }, [selectedIds])

  return (
    <div className="comparables-map-container" style={{ height }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="sale-modal-overlay" onClick={() => setSelectedSale(null)}>
          <div className="sale-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="sale-modal-header">
              <h3 className="sale-modal-title">Tract Sale</h3>
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
              {selectedSale.companyName && (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Listing Company</span>
                  <span className="sale-modal-value">{selectedSale.companyName}</span>
                </div>
              )}
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
              <div className="sale-modal-row">
                <span className="sale-modal-label">Township</span>
                <span className="sale-modal-value">{normalizeTownship(selectedSale.township) || '—'}</span>
              </div>
              {selectedSale.tillableAcres && (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Tillable Acres</span>
                  <span className="sale-modal-value">{formatAcres(selectedSale.tillableAcres)} ac</span>
                </div>
              )}
              {selectedSale.tillableAcres && selectedSale.pricePerAcre && selectedSale.totalAcres && (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">$/Tillable Acre</span>
                  <span className="sale-modal-value">{formatCurrency((selectedSale.pricePerAcre * selectedSale.totalAcres) / selectedSale.tillableAcres)}/ac</span>
                </div>
              )}
              {selectedSale.soilRating && selectedSale.pricePerAcre && (
                <div className="sale-modal-row" style={{ borderBottom: 'none' }}>
                  <span className="sale-modal-label">$/Soil Rating</span>
                  <span className="sale-modal-value">{formatCurrency(selectedSale.pricePerAcre / selectedSale.soilRating)}</span>
                </div>
              )}
            </div>

            {/* View 3D Terrain */}
            {selectedSale.polygonCoordinates && selectedSale.polygonCoordinates.length > 2 ? (
              <button
                className="sale-modal-action-btn"
                style={{ backgroundColor: '#E91E8C', color: '#fff', marginBottom: '8px' }}
                onClick={() => setShow3DViewer(true)}
              >
                🏔 View 3D Terrain
              </button>
            ) : (
              <div style={{ textAlign: 'center', padding: '12px 20px', color: '#999', fontSize: 13, fontStyle: 'italic' }}>
                No map boundaries available
              </div>
            )}

            {/* View Details (external link to source) */}
            {selectedSale.companyName && selectedSale.sourceUrl && (
              <button
                className="sale-modal-action-btn"
                style={{
                  backgroundColor: 'transparent',
                  color: '#E91E8C',
                  border: '1px solid #E91E8C',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
                onClick={() => window.open(selectedSale.sourceUrl!, '_blank')}
              >
                View Details
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            )}

            {/* Add / Remove from email list */}
            {toggleSelection && (() => {
              const isInList = selectedIds.has(selectedSale.id)
              return (
                <button
                  className={`sale-modal-action-btn ${isInList ? 'remove' : ''}`}
                  onClick={() => {
                    toggleSelection({ id: selectedSale.id })
                    setSelectedSale(null)
                  }}
                >
                  {isInList ? '− Remove from Report' : '+ Add to Report'}
                </button>
              )
            })()}
          </div>
        </div>
      )}

      {/* 3D Terrain Viewer */}
      <Tract3DModal
        tractId={selectedSale?.tractId || selectedSale?.id || ''}
        tractName={`${selectedSale?.county || ''}, ${selectedSale?.state || ''}`}
        isOpen={show3DViewer}
        onClose={() => setShow3DViewer(false)}
      />
    </div>
  )
}

function createMarkerElement(
  pricePerAcre: number | null,
  acres: number | null,
  isSelected: boolean = false
): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'

  const label = document.createElement('div')
  label.className = `comp-marker-label${isSelected ? ' selected' : ''}`

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

  container.appendChild(label)

  const pin = document.createElement('div')
  pin.className = `comp-marker-pin comparable${isSelected ? ' selected' : ''}`
  container.appendChild(pin)

  return container
}

function createSubjectMarkerElement(acres: number | null): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'

  const label = document.createElement('div')
  label.className = 'comp-marker-label subject'

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

  container.appendChild(label)

  const pin = document.createElement('div')
  pin.className = 'comp-marker-pin subject'
  container.appendChild(pin)

  return container
}
