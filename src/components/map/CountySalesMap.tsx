'use client'

import { useRef, useEffect, useState, useMemo, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './CountySalesMap.css'
import { TILE_URL, TILE_ATTRIBUTION, GLYPH_URL } from './mapConstants'
import { STATE_FIPS_TO_ABBR, STATE_ABBR_TO_FIPS } from '@/data/stateFips'

// Deterministic color palette for companies
export const COMPANY_COLORS = [
  '#f58cde', '#2563EB', '#16A34A', '#F59E0B', '#8B5CF6',
  '#EC4899', '#06B6D4', '#EF4444', '#10B981', '#F97316',
  '#6366F1', '#14B8A6', '#E11D48', '#84CC16', '#A855F7',
  '#0EA5E9', '#D946EF', '#22C55E', '#FB923C', '#3B82F6',
]

interface CompanyData {
  company_id: string
  acres_sold: number
  sale_amount: number
  listing_count: number
}

interface CountyData {
  county: string
  state: string
  total_acres_sold: number
  total_sale_amount: number
  companies: Record<string, CompanyData>
}

export interface CountySalesData {
  counties: Record<string, CountyData>
  companies: { id: string; name: string }[]
}

interface CountySalesMapProps {
  data: CountySalesData | null
  loading: boolean
  onCountyClick: (county: string, state: string) => void
  height?: string
}

function formatAcres(acres: number): string {
  if (acres >= 1000) return (acres / 1000).toFixed(1) + 'K'
  return acres.toFixed(0)
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) return '$' + (amount / 1000000).toFixed(1) + 'M'
  if (amount >= 1000) return '$' + (amount / 1000).toFixed(0) + 'K'
  return '$' + Math.round(amount).toLocaleString()
}

export default function CountySalesMap({
  data, loading, onCountyClick, height = '600px'
}: CountySalesMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)

  // Build company color map from data
  const companyColorMap = useMemo(() => {
    const map = new Map<string, string>()
    if (data?.companies) {
      data.companies.forEach((comp, i) => {
        map.set(comp.name, COMPANY_COLORS[i % COMPANY_COLORS.length])
      })
    }
    return map
  }, [data?.companies])

  // Build a lookup from "NAME,FIPS" key -> county data for hover popups
  const countyLookup = useMemo(() => {
    const lookup = new Map<string, { countyData: CountyData; dominantCompany: string; color: string }>()
    if (!data) return lookup

    for (const [, countyData] of Object.entries(data.counties)) {
      const stateFips = STATE_ABBR_TO_FIPS[countyData.state]
      if (!stateFips) continue

      let dominantCompany = ''
      let maxAcres = 0
      for (const [compName, compData] of Object.entries(countyData.companies)) {
        if (compData.acres_sold > maxAcres) {
          maxAcres = compData.acres_sold
          dominantCompany = compName
        }
      }

      const color = companyColorMap.get(dominantCompany) || '#888888'
      const key = countyData.county + ',' + stateFips
      lookup.set(key, { countyData, dominantCompany, color })
    }

    return lookup
  }, [data, companyColorMap])

  // Initialize map (once)
  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
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
          { id: 'osm-tiles', type: 'raster', source: 'osm' },
        ],
        glyphs: GLYPH_URL,
      },
      center: [-96, 39],
      zoom: 4,
      maxZoom: 12,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      // Add county boundaries GeoJSON source
      map.addSource('counties', {
        type: 'geojson',
        data: '/data/us-counties.json',
      })

      // County fill layer
      map.addLayer({
        id: 'county-fill',
        type: 'fill',
        source: 'counties',
        paint: {
          'fill-color': '#888888',
          'fill-opacity': 0,
        },
      })

      // County border layer
      map.addLayer({
        id: 'county-borders',
        type: 'line',
        source: 'counties',
        paint: {
          'line-color': '#555555',
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            3, 0.1,
            5, 0.2,
            7, 0.5,
            10, 1,
          ],
          'line-opacity': 0.4,
        },
      })

      // County name labels (visible at higher zoom)
      map.addLayer({
        id: 'county-labels',
        type: 'symbol',
        source: 'counties',
        minzoom: 7,
        layout: {
          'text-field': ['get', 'NAME'],
          'text-font': ['Open Sans Regular'],
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            7, 10,
            10, 14,
          ],
          'text-anchor': 'center',
          'text-max-width': 8,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
          'text-opacity': 0.85,
        },
      })

      mapRef.current = map
      setMapLoaded(true)
    })

    // Hover cursor
    map.on('mouseenter', 'county-fill', () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'county-fill', () => {
      map.getCanvas().style.cursor = ''
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
    })

    return () => {
      if (popupRef.current) {
        popupRef.current.remove()
        popupRef.current = null
      }
      map.remove()
      mapRef.current = null
      setMapLoaded(false)
    }
  }, [])

  // Click handler (uses ref to get latest callback)
  const onCountyClickRef = useRef(onCountyClick)
  onCountyClickRef.current = onCountyClick

  const countyLookupRef = useRef(countyLookup)
  countyLookupRef.current = countyLookup

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handleClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const feature = e.features[0]
      const countyName = feature.properties?.NAME
      const stateFips = feature.properties?.STATE
      const stateAbbr = STATE_FIPS_TO_ABBR[stateFips] || ''
      if (countyName && stateAbbr) {
        onCountyClickRef.current(countyName, stateAbbr)
      }
    }

    const handleMouseMove = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features?.length) return
      const feature = e.features[0]
      const countyName = feature.properties?.NAME
      const stateFips = feature.properties?.STATE
      if (!countyName || !stateFips) return

      const key = countyName + ',' + stateFips
      const info = countyLookupRef.current.get(key)
      const stateAbbr = STATE_FIPS_TO_ABBR[stateFips] || ''

      let html = `<div class="county-popup-title">${countyName} County, ${stateAbbr}</div>`

      if (info) {
        html += `
          <div class="county-popup-row">
            <span class="county-popup-label">Acres Sold</span>
            <span class="county-popup-value">${formatAcres(info.countyData.total_acres_sold)}</span>
          </div>
          <div class="county-popup-row">
            <span class="county-popup-label">Total Sales</span>
            <span class="county-popup-value">${formatCurrency(info.countyData.total_sale_amount)}</span>
          </div>
          <div class="county-popup-row">
            <span class="county-popup-label">Companies</span>
            <span class="county-popup-value">${Object.keys(info.countyData.companies).length}</span>
          </div>
          <div class="county-popup-company">
            <div class="county-popup-dot" style="background:${info.color}"></div>
            <span class="county-popup-company-name">${info.dominantCompany}</span>
          </div>
        `
      } else {
        html += `<div class="county-popup-row"><span class="county-popup-label">No sales data</span></div>`
      }

      if (popupRef.current) {
        popupRef.current.setLngLat(e.lngLat).setHTML(html)
      } else {
        popupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          className: 'county-popup',
          offset: 10,
        })
          .setLngLat(e.lngLat)
          .setHTML(html)
          .addTo(map)
      }
    }

    map.on('click', 'county-fill', handleClick)
    map.on('mousemove', 'county-fill', handleMouseMove)

    return () => {
      map.off('click', 'county-fill', handleClick)
      map.off('mousemove', 'county-fill', handleMouseMove)
    }
  }, [mapLoaded])

  // Update county fill colors when data changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded || !data) return

    const matchColorEntries: (string | any)[] = []
    const matchOpacityEntries: (string | number | any)[] = []

    for (const [, countyData] of Object.entries(data.counties)) {
      const stateFips = STATE_ABBR_TO_FIPS[countyData.state]
      if (!stateFips) continue

      // Find dominant company (most acres sold)
      let dominantCompany = ''
      let maxAcres = 0
      for (const [compName, compData] of Object.entries(countyData.companies)) {
        if (compData.acres_sold > maxAcres) {
          maxAcres = compData.acres_sold
          dominantCompany = compName
        }
      }

      const color = companyColorMap.get(dominantCompany) || '#888888'
      const concatKey = countyData.county + ',' + stateFips

      matchColorEntries.push(concatKey, color)
      matchOpacityEntries.push(concatKey, 0.4)
    }

    if (matchColorEntries.length > 0) {
      map.setPaintProperty('county-fill', 'fill-color', [
        'match',
        ['concat', ['get', 'NAME'], ',', ['get', 'STATE']],
        ...matchColorEntries,
        'rgba(0,0,0,0)',
      ] as any)
      map.setPaintProperty('county-fill', 'fill-opacity', [
        'match',
        ['concat', ['get', 'NAME'], ',', ['get', 'STATE']],
        ...matchOpacityEntries,
        0,
      ] as any)
    } else {
      map.setPaintProperty('county-fill', 'fill-opacity', 0)
    }
  }, [mapLoaded, data, companyColorMap])

  return (
    <div className="relative">
      {loading && (
        <div className="absolute inset-0 bg-gg-gray-800/80 z-10 flex items-center justify-center rounded-xl">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gg-pink border-t-transparent" />
        </div>
      )}
      <div ref={containerRef} className="county-map-container" style={{ height }} />
    </div>
  )
}
