'use client'

import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import './ComparablesMap.css'
import './TractMap.css'
import type { ApiMapTract, MapTractsResponse } from './exploreMapTypes'
import {
  buildExplorePolygonGeoJSON,
  buildExploreStateAggregates,
} from './exploreMapTransform'
import {
  MAP_CENTER,
  MAP_INITIAL_ZOOM,
  TILE_URL,
  TILE_ATTRIBUTION,
  GLYPH_URL,
  ZOOM_TIER_1_MAX,
  STATUS_COLORS,
} from './mapConstants'
import fetchWithAuth from '@/lib/fetchWithAuth'
import Tract3DModal from '@/components/Tract3DModal'
import { countyCentroids } from '@/data/countyCentroids'
import { STATE_ABBR } from './mapConstants'

const API_URL = 'https://practical-serenity-production.up.railway.app'

// Pin colors by sale status (matching mobile app)
const PIN_COLORS: Record<string, string> = {
  sold: '#22c55e',
  listed: '#3b82f6',
  active: '#3b82f6',
  live: '#f59e0b',
  pending: '#f59e0b',
  no_sale: '#6b7280',
}
const DEFAULT_PIN_COLOR = '#3b82f6' // Blue for NULL/unknown status (= listed)

function getStatusPinColor(status: string | null): string {
  if (!status) return DEFAULT_PIN_COLOR
  return PIN_COLORS[status.toLowerCase()] || DEFAULT_PIN_COLOR
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

export interface SaleDetail {
  id: string
  listingId?: string | null
  tractId?: string | null
  auctionDate?: string | null
  totalAcres?: number | null
  tillableAcres?: number | null
  companyName?: string | null
  salePrice?: number | null
  pricePerAcre?: number | null
  county: string
  state: string
  township?: string | null
  soilRating?: number | null
  polygonCoordinates?: [number, number][] | null
  saleStatus?: string | null
  listingType?: string | null
  pctTillable?: number | null
  pricePerTillableAcre?: number | null
  pricePerSoilRating?: number | null
}

interface FilterState {
  dateRange: string
  stateFilter: string
  countyFilters: string[]
  townshipFilter: string
  soilRatingMin: string
  soilRatingMax: string
  acreageMin: string
  acreageMax: string
  pctTillableMin: string
  pctTillableMax: string
  statuses: string[]
}

const INITIAL_FILTERS: FilterState = {
  dateRange: 'all',
  stateFilter: '',
  countyFilters: [],
  townshipFilter: '',
  soilRatingMin: '',
  soilRatingMax: '',
  acreageMin: '',
  acreageMax: '',
  pctTillableMin: '',
  pctTillableMax: '',
  statuses: [],
}

const STATE_CHIPS = ['IL', 'IA', 'MO', 'MN', 'NE', 'IN', 'SD', 'ND']

const COUNTIES_BY_STATE: Record<string, string[]> = {"IL":["Adams","Alexander","Bond","Boone","Brown","Bureau","Calhoun","Carroll","Cass","Champaign","Christian","Clark","Clay","Clinton","Coles","Cook","Crawford","Cumberland","DeKalb","DeWitt","Douglas","DuPage","Edgar","Edwards","Effingham","Fayette","Ford","Franklin","Fulton","Gallatin","Greene","Grundy","Hamilton","Hancock","Hardin","Henderson","Henry","Iroquois","Jackson","Jasper","Jefferson","Jersey","Jo Daviess","Johnson","Kane","Kankakee","Kendall","Knox","La Salle","LaSalle","Lake","Lawrence","Lee","Livingston","Logan","Macon","Macoupin","Madison","Marion","Marshall","Mason","Massac","McDonough","McHenry","McLean","Menard","Mercer","Monroe","Montgomery","Morgan","Moultrie","Ogle","Peoria","Perry","Piatt","Pike","Pope","Pulaski","Putnam","Randolph","Richland","Rock Island","Saline","Sangamon","Schuyler","Scott","Shelby","St. Clair","Stark","Stephenson","Tazewell","Union","Vermilion","Wabash","Warren","Washington","Wayne","White","Whiteside","Will","Williamson","Winnebago","Woodford"],"IA":["Adair","Adams","Allamakee","Appanoose","Audubon","Benton","Black Hawk","Boone","Bremer","Buchanan","Buena Vista","Butler","Calhoun","Carroll","Cass","Cedar","Cerro Gordo","Cherokee","Chickasaw","Clarke","Clay","Clayton","Clinton","Crawford","Dallas","Davis","Decatur","Delaware","Des Moines","Dickinson","Dubuque","Emmet","Fayette","Floyd","Franklin","Fremont","Greene","Grundy","Guthrie","Hamilton","Hancock","Hardin","Harrison","Henry","Howard","Humboldt","Ida","Iowa","Jackson","Jasper","Jefferson","Johnson","Jones","Keokuk","Kossuth","Lee","Linn","Louisa","Lucas","Lyon","Madison","Mahaska","Marion","Marshall","Mills","Mitchell","Monona","Monroe","Montgomery","Muscatine","O'Brien","Osceola","Page","Palo Alto","Plymouth","Pocahontas","Polk","Pottawattamie","Poweshiek","Ringgold","Sac","Scott","Shelby","Sioux","Story","Tama","Taylor","Union","Van Buren","Wapello","Warren","Washington","Wayne","Webster","Winnebago","Winneshiek","Woodbury","Worth","Wright"],"MO":["Adair","Andrew","Atchison","Audrain","Barry","Barton","Bates","Benton","Bollinger","Boone","Buchanan","Butler","Caldwell","Callaway","Camden","Cape Girardeau","Carroll","Carter","Cass","Cedar","Chariton","Christian","Clark","Clay","Clinton","Cole","Cooper","Crawford","Dade","Dallas","Daviess","DeKalb","Dent","Douglas","Dunklin","Franklin","Gasconade","Gentry","Greene","Grundy","Harrison","Henry","Hickory","Holt","Howard","Howell","Iron","Jackson","Jasper","Jefferson","Johnson","Knox","Laclede","Lafayette","Lawrence","Lewis","Lincoln","Linn","Livingston","Macon","Madison","Maries","Marion","McDonald","Mercer","Miller","Mississippi","Moniteau","Monroe","Montgomery","Morgan","New Madrid","Newton","Nodaway","Oregon","Osage","Ozark","Pemiscot","Perry","Pettis","Phelps","Pike","Platte","Polk","Pulaski","Putnam","Ralls","Randolph","Ray","Reynolds","Ripley","Saline","Schuyler","Scotland","Scott","Shannon","Shelby","St. Charles","St. Clair","St. Francois","St. Louis","St. Louis City","Ste. Genevieve","Stoddard","Stone","Sullivan","Taney","Texas","Vernon","Warren","Washington","Wayne","Webster","Worth","Wright"],"MN":["Aitkin","Anoka","Becker","Beltrami","Benton","Big Stone","Blue Earth","Brown","Carlton","Carver","Cass","Chippewa","Chisago","Clay","Clearwater","Cook","Cottonwood","Crow Wing","Dakota","Dodge","Douglas","Faribault","Fillmore","Freeborn","Goodhue","Grant","Hennepin","Houston","Hubbard","Isanti","Itasca","Jackson","Kanabec","Kandiyohi","Kittson","Koochiching","Lac qui Parle","Lake","Lake of the Woods","Le Sueur","Lincoln","Lyon","Mahnomen","Marshall","Martin","McLeod","Meeker","Mille Lacs","Morrison","Mower","Murray","Nicollet","Nobles","Norman","Olmsted","Otter Tail","Pennington","Pine","Pipestone","Polk","Pope","Ramsey","Red Lake","Redwood","Renville","Rice","Rock","Roseau","Scott","Sherburne","Sibley","St. Louis","Stearns","Steele","Stevens","Swift","Todd","Traverse","Wabasha","Wadena","Waseca","Washington","Watonwan","Wilkin","Winona","Wright","Yellow Medicine"],"NE":["Adams","Antelope","Arthur","Banner","Blaine","Boone","Box Butte","Boyd","Brown","Buffalo","Burt","Butler","Cass","Cedar","Chase","Cherry","Cheyenne","Clay","Colfax","Cuming","Custer","Dakota","Dawes","Dawson","Deuel","Dixon","Dodge","Douglas","Dundy","Fillmore","Franklin","Frontier","Furnas","Gage","Garden","Garfield","Gosper","Grant","Greeley","Hall","Hamilton","Harlan","Hayes","Hitchcock","Holt","Hooker","Howard","Jefferson","Johnson","Kearney","Keith","Keya Paha","Kimball","Knox","Lancaster","Lincoln","Logan","Loup","Madison","McPherson","Merrick","Morrill","Nance","Nemaha","Nuckolls","Otoe","Pawnee","Perkins","Phelps","Pierce","Platte","Polk","Red Willow","Richardson","Rock","Saline","Sarpy","Saunders","Scotts Bluff","Seward","Sheridan","Sherman","Sioux","Stanton","Thayer","Thomas","Thurston","Valley","Washington","Wayne","Webster","Wheeler","York"],"IN":["Adams","Allen","Bartholomew","Benton","Blackford","Boone","Brown","Carroll","Cass","Clark","Clay","Clinton","Crawford","Daviess","DeKalb","Dearborn","Decatur","Delaware","Dubois","Elkhart","Fayette","Floyd","Fountain","Franklin","Fulton","Gibson","Grant","Greene","Hamilton","Hancock","Harrison","Hendricks","Henry","Howard","Huntington","Jackson","Jasper","Jay","Jefferson","Jennings","Johnson","Knox","Kosciusko","LaGrange","LaPorte","Lake","Lawrence","Logansport","Madison","Marion","Marshall","Martin","Miami","Monroe","Montgomery","Morgan","Newton","Noble","Ohio","Orange","Owen","Parke","Perry","Pike","Porter","Posey","Pulaski","Putnam","Randolph","Ripley","Rush","Scott","Shelby","Spencer","St. Joseph","Starke","Steuben","Sullivan","Switzerland","Tippecanoe","Tipton","Union","Vanderburgh","Vermillion","Vigo","Wabash","Warren","Warrick","Washington","Wayne","Wells","White","Whitley"],"SD":["Beadle","Brookings","Brown","Clark","Clay","Codington","Davison","Day","Deuel","Grant","Hamlin","Hanson","Hughes","Hutchinson","Kingsbury","Lake","Lincoln","McCook","Miner","Minnehaha","Moody","Roberts","Sanborn","Spink","Turner","Union","Yankton"],"ND":["Barnes","Cass","Grand Forks","Richland","Stutsman","Traill","Walsh"]}

function buildFilterParams(filters: FilterState) {
  const params: Record<string, string> = {}
  if (filters.dateRange === 'upcoming') {
    params.date_from = new Date().toISOString().split('T')[0]
  } else if (filters.dateRange !== 'all') {
    const months = filters.dateRange === '6months' ? 6 : filters.dateRange === '1year' ? 12 : 24
    const cutoff = new Date()
    cutoff.setMonth(cutoff.getMonth() - months)
    params.date_from = cutoff.toISOString().split('T')[0]
  }
  if (filters.statuses?.length > 0) params.sale_status = filters.statuses.flatMap(s => s.split(',')).join(',')
  if (filters.stateFilter) params.state_abbr = filters.stateFilter
  if (filters.countyFilters?.length > 0) params.county_name = filters.countyFilters.join(',')
  if (filters.townshipFilter) params.township = filters.townshipFilter
  if (filters.soilRatingMin) params.soil_rating_min = filters.soilRatingMin
  if (filters.soilRatingMax) params.soil_rating_max = filters.soilRatingMax
  if (filters.acreageMin) params.acreage_min = filters.acreageMin
  if (filters.acreageMax) params.acreage_max = filters.acreageMax
  if (filters.pctTillableMin) params.pct_tillable_min = filters.pctTillableMin
  if (filters.pctTillableMax) params.pct_tillable_max = filters.pctTillableMax
  return params
}

interface ExploreMapProps {
  height?: string
  homeState?: string
  homeCounty?: string
  portalMode?: boolean
  externalFilterOpen?: boolean
  onFilterOpenChange?: (open: boolean) => void
  onViewListing?: (listingId: string) => void
  onTractSelected?: (tract: SaleDetail) => void
  onToggleReport?: (tract: SaleDetail) => void
  onView3DTerrain?: (tractId: string, tractName: string) => void
  isInReport?: (tractId: string) => boolean
  reportIds?: Set<string>
  onFiltersApplied?: (filters: { stateFilter: string; countyFilters: string[] }) => void
  zoomToLocation?: { lat: number; lng: number; zoom: number } | null
  subjectTractId?: string | null
  subjectTractLocation?: { lat: number; lng: number } | null
  resetFiltersSignal?: number
}

export default function ExploreMap({ height = 'calc(100vh - 220px)', homeState, homeCounty, portalMode = false, externalFilterOpen, onFilterOpenChange, onViewListing, onTractSelected, onToggleReport, onView3DTerrain, isInReport, reportIds, onFiltersApplied, zoomToLocation, subjectTractId, subjectTractLocation, resetFiltersSignal }: ExploreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const stateMarkersRef = useRef<maplibregl.Marker[]>([])
  const tractMarkersRef = useRef<maplibregl.Marker[]>([])
  const tractMarkerElementsRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadedCellsRef = useRef<Set<string>>(new Set())
  const tractMapRef = useRef<Map<string, ApiMapTract>>(new Map())
  const subjectTractIdRef = useRef<string | null>(null)
  subjectTractIdRef.current = subjectTractId || null

  const [tracts, setTracts] = useState<ApiMapTract[]>([])
  const [currentZoom, setCurrentZoom] = useState(MAP_INITIAL_ZOOM)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null)
  const [show3DViewer, setShow3DViewer] = useState(false)
  const [soilData, setSoilData] = useState<{ map_units: any[]; avg_slope?: number } | null>(null)
  const [elevationData, setElevationData] = useState<{ min_ft: number; max_ft: number; relief_ft: number; avg_slope_pct: number } | null>(null)
  const [soilLoading, setSoilLoading] = useState(false)

  // Filter state
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS)
  const [filterOpen, setFilterOpenInternal] = useState(false)
  const filtersRef = useRef<FilterState>(INITIAL_FILTERS)

  // Sync external filter open state (portal mode)
  useEffect(() => {
    if (externalFilterOpen !== undefined) {
      setFilterOpenInternal(externalFilterOpen)
    }
  }, [externalFilterOpen])

  // Reset filters from parent (e.g. when launching Find Comparables)
  useEffect(() => {
    if (resetFiltersSignal && resetFiltersSignal > 0) {
      setFilters(INITIAL_FILTERS)
      filtersRef.current = INITIAL_FILTERS
      loadedCellsRef.current = new Set()
      tractMapRef.current = new Map()
      setTracts([])
      tractMarkersRef.current.forEach(m => m.remove())
      tractMarkersRef.current = []
      stateMarkersRef.current.forEach(m => m.remove())
      stateMarkersRef.current = []
      // Refetch tracts for current viewport
      const map = mapRef.current
      if (map) {
        setTimeout(() => {
          const bounds = map.getBounds()
          const south = bounds.getSouth()
          const north = bounds.getNorth()
          const west = bounds.getWest()
          const east = bounds.getEast()
          const cellSize = 0.5
          const startLat = Math.floor(south * 2) / 2
          const startLng = Math.floor(west * 2) / 2
          for (let lat = startLat; lat < north; lat += cellSize) {
            for (let lng = startLng; lng < east; lng += cellSize) {
              loadTractsForBounds({
                min_lat: Math.max(lat, south),
                max_lat: Math.min(lat + cellSize, north),
                min_lng: Math.max(lng, west),
                max_lng: Math.min(lng + cellSize, east),
              })
            }
          }
        }, 100)
      }
    }
  }, [resetFiltersSignal])

  // Zoom to location from parent (portal mode)
  useEffect(() => {
    if (zoomToLocation && mapRef.current) {
      mapRef.current.flyTo({
        center: [zoomToLocation.lng, zoomToLocation.lat],
        zoom: zoomToLocation.zoom,
        duration: 1500,
      })
    }
  }, [zoomToLocation])

  const setFilterOpen = (open: boolean) => {
    setFilterOpenInternal(open)
    onFilterOpenChange?.(open)
  }

  // Selection / report state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selectedTracts, setSelectedTracts] = useState<SaleDetail[]>([])
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  // Fetch soil & elevation data when a tract is selected
  useEffect(() => {
    if (!selectedSale?.tractId) return
    setSoilData(null)
    setElevationData(null)
    setSoilLoading(true)

    Promise.all([
      fetchWithAuth(`${API_URL}/api/tracts/${selectedSale.tractId}/soil-data`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetchWithAuth(`${API_URL}/api/tracts/${selectedSale.tractId}/elevation`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([soil, elevation]) => {
      if (soil) {
        setSoilData({
          map_units: soil.soil_map_units || [],
          avg_slope: soil.elevation_stats?.avg_slope_pct,
        })
      }
      if (elevation?.elevation_stats) {
        setElevationData({
          min_ft: elevation.elevation_stats.min_ft,
          max_ft: elevation.elevation_stats.max_ft,
          relief_ft: elevation.elevation_stats.relief_ft,
          avg_slope_pct: elevation.elevation_stats.avg_slope_pct,
        })
      }
      setSoilLoading(false)
    })
  }, [selectedSale?.tractId])

  const toggleSelection = (tract: SaleDetail) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(tract.id)) {
        next.delete(tract.id)
        setSelectedTracts(prev => prev.filter(t => t.id !== tract.id))
      } else {
        next.add(tract.id)
        setSelectedTracts(prev => [...prev, tract])
      }
      return next
    })
  }

  const handleEmailReport = async () => {
    setSendingEmail(true)
    try {
      const comparables = selectedTracts.map(t => ({
        county: t.county,
        state: t.state,
        tract_number: '—',
        total_acres: t.totalAcres?.toString() || '—',
        tillable_acres: t.tillableAcres?.toString() || null,
        pct_tillable: t.pctTillable?.toString() || null,
        soil_rating: t.soilRating?.toString() || null,
        price_per_acre: t.pricePerAcre?.toString() || null,
        price_per_tillable_acre: t.pricePerTillableAcre?.toString() || null,
        price_per_soil_rating: t.pricePerSoilRating?.toString() || null,
        sale_price: t.salePrice?.toString() || null,
        auction_datetime: t.auctionDate || null,
        company_name: t.companyName || null,
      }))
      const resp = await fetchWithAuth(`${API_URL}/api/comparables/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comparables }),
      })
      if (resp.ok) {
        setEmailSent(true)
        setTimeout(() => setEmailSent(false), 3000)
      }
    } catch (err) {
      console.error('Failed to email report:', err)
    } finally {
      setSendingEmail(false)
    }
  }

  const applyFilters = () => {
    filtersRef.current = filters
    // Clear cached data so it refetches with new filters
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    setTracts([])
    // Remove existing markers
    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []
    stateMarkersRef.current.forEach(m => m.remove())
    stateMarkersRef.current = []
    // Refetch current viewport
    const map = mapRef.current
    if (map) {
      const bounds = map.getBounds()
      loadTractsForBounds({
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lng: bounds.getWest(),
        max_lng: bounds.getEast(),
      })
    }
    setFilterOpen(false)
    onFiltersApplied?.({ stateFilter: filters.stateFilter, countyFilters: filters.countyFilters })
  }

  const resetFilters = () => {
    setFilters(INITIAL_FILTERS)
    filtersRef.current = INITIAL_FILTERS
    // Clear cached data so it refetches without filters
    loadedCellsRef.current = new Set()
    tractMapRef.current = new Map()
    setTracts([])
    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []
    stateMarkersRef.current.forEach(m => m.remove())
    stateMarkersRef.current = []
    const map = mapRef.current
    if (map) {
      const bounds = map.getBounds()
      loadTractsForBounds({
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lng: bounds.getWest(),
        max_lng: bounds.getEast(),
      })
    }
    setFilterOpen(false)
    onFiltersApplied?.({ stateFilter: '', countyFilters: [] })
  }

  const hasActiveFilters = filters.dateRange !== 'all' || filters.stateFilter !== '' ||
    filters.townshipFilter !== '' ||
    filters.soilRatingMin !== '' || filters.soilRatingMax !== '' ||
    filters.acreageMin !== '' || filters.acreageMax !== '' ||
    filters.pctTillableMin !== '' || filters.pctTillableMax !== '' ||
    filters.statuses.length > 0

  const polygonGeoJSON = useMemo(() => buildExplorePolygonGeoJSON(tracts), [tracts])
  const stateAggregates = useMemo(() => buildExploreStateAggregates(tracts), [tracts])

  // Load tracts for a bounding box
  const loadTractsForBounds = useCallback(async (bounds: {
    min_lat: number; max_lat: number; min_lng: number; max_lng: number
  }) => {
    const { min_lat, max_lat, min_lng, max_lng } = bounds

    // Use precise bounds rounded to 0.5 degrees for cache keys
    const r = (v: number) => Math.round(v * 2) / 2
    const gridKey = `${r(min_lat)},${r(min_lng)},${r(max_lat)},${r(max_lng)}`
    if (loadedCellsRef.current.has(gridKey)) return
    loadedCellsRef.current.add(gridKey)

    try {
      setLoading(true)
      const filterParams = buildFilterParams(filtersRef.current)
      // In comparables mode, only show sold tracts
      if (subjectTractIdRef.current && !filterParams.sale_status) {
        filterParams.sale_status = 'sold'
      }
      const extraParams = Object.entries(filterParams).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')
      const url = `${API_URL}/api/map/tracts?min_lat=${min_lat}&max_lat=${max_lat}&min_lng=${min_lng}&max_lng=${max_lng}&limit=1000${extraParams ? '&' + extraParams : ''}`
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data: MapTractsResponse = await response.json()
        if (data.tracts) {
          const isUpcomingFilter = filtersRef.current.dateRange === 'upcoming'
          const now = new Date()
          data.tracts.forEach(t => {
            if (isUpcomingFilter) {
              // Upcoming: show tracts that are NOT sold, pending, or no_sale
              const postSaleStatuses = ['sold', 'pending', 'no_sale']
              if (!t.sale_status || !postSaleStatuses.includes(t.sale_status)) {
                tractMapRef.current.set(t.id, t)
              }
            } else {
              // Show tracts with a sale_status, OR listed/live auctions (null sale_status but have listing_status or future date)
              const isListed = t.listing_status === 'listed' || t.listing_status === 'live'
              const hasFutureAuction = t.auction_date && new Date(t.auction_date) >= now
              if (t.sale_status || isListed || hasFutureAuction) {
                tractMapRef.current.set(t.id, t)
              }
            }
          })
          setTracts(Array.from(tractMapRef.current.values()))
        }
      }
    } catch (err) {
      console.error('Failed to load map tracts:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // Handle map move — debounced viewport loading with sub-cell splitting
  const handleMoveEnd = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    debounceTimerRef.current = setTimeout(() => {
      const map = mapRef.current
      if (!map) return
      const bounds = map.getBounds()
      const south = bounds.getSouth()
      const north = bounds.getNorth()
      const west = bounds.getWest()
      const east = bounds.getEast()

      // Split viewport into 0.5 degree cells (~35 miles) and load each
      const cellSize = 0.5
      const startLat = Math.floor(south * 2) / 2
      const startLng = Math.floor(west * 2) / 2
      for (let lat = startLat; lat < north; lat += cellSize) {
        for (let lng = startLng; lng < east; lng += cellSize) {
          loadTractsForBounds({
            min_lat: Math.max(lat, south),
            max_lat: Math.min(lat + cellSize, north),
            min_lng: Math.max(lng, west),
            max_lng: Math.min(lng + cellSize, east),
          })
        }
      }
    }, 500)
  }, [loadTractsForBounds])

  // Calculate initial center from home county
  const initialCenter = useMemo((): [number, number] => {
    if (homeState && homeCounty) {
      const stateAbbr = STATE_ABBR[homeState] || homeState
      const key = `${homeCounty}, ${stateAbbr}`
      const centroid = countyCentroids[key]
      if (centroid) {
        return [centroid[1], centroid[0]] // [lng, lat] — countyCentroids stores [lat, lng]
      }
    }
    return MAP_CENTER
  }, [homeState, homeCounty])

  const initialZoom = homeState && homeCounty ? 9 : MAP_INITIAL_ZOOM

  // Initialize map
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
      center: initialCenter,
      zoom: initialZoom,
      maxZoom: 18,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      mapRef.current = map
      setMapLoaded(true)

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

      // State boundaries
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

      // County name labels
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

      // Initial load
      const bounds = map.getBounds()
      loadTractsForBounds({
        min_lat: bounds.getSouth(),
        max_lat: bounds.getNorth(),
        min_lng: bounds.getWest(),
        max_lng: bounds.getEast(),
      })
    })

    map.on('zoom', () => {
      setCurrentZoom(map.getZoom())
    })

    map.on('moveend', handleMoveEnd)

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
      map.remove()
      mapRef.current = null
      setMapLoaded(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Add/update polygon source
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    const polySource = map.getSource('tract-polygons') as maplibregl.GeoJSONSource
    if (polySource) {
      polySource.setData(polygonGeoJSON)
    } else {
      map.addSource('tract-polygons', {
        type: 'geojson',
        data: polygonGeoJSON,
      })
      map.addLayer({
        id: 'tract-polygon-fill',
        type: 'fill',
        source: 'tract-polygons',
        paint: {
          'fill-color': '#E91E8C',
          'fill-opacity': 0.08,
        },
      })
      map.addLayer({
        id: 'tract-polygon-line',
        type: 'line',
        source: 'tract-polygons',
        paint: {
          'line-color': '#E91E8C',
          'line-width': 2,
          'line-opacity': 0.8,
        },
      })
    }
  }, [mapLoaded, polygonGeoJSON])

  // Create/update HTML markers for tracts
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    // Remove old tract markers
    tractMarkersRef.current.forEach(m => m.remove())
    tractMarkersRef.current = []
    tractMarkerElementsRef.current.clear()

    // Helper: polygon centroid
    const getPolygonCentroid = (coords: [number, number][]): [number, number] | null => {
      if (!coords || coords.length < 3) return null
      let sumLng = 0, sumLat = 0
      for (const [lng, lat] of coords) {
        sumLng += lng
        sumLat += lat
      }
      return [sumLng / coords.length, sumLat / coords.length]
    }

    // Track co-located tracts for offset spacing
    const coordCounts: Record<string, number> = {}

    for (const tract of tracts) {
      // Get marker position
      let markerLng = tract.longitude
      let markerLat = tract.latitude
      if (tract.polygon_coordinates && tract.polygon_coordinates.length > 2) {
        const centroid = getPolygonCentroid(tract.polygon_coordinates)
        if (centroid) {
          markerLng = centroid[0]
          markerLat = centroid[1]
        }
      }
      if (!markerLat || !markerLng) continue

      // Offset co-located tracts so they don't stack
      const coordKey = `${markerLat.toFixed(4)},${markerLng.toFixed(4)}`
      const index = coordCounts[coordKey] || 0
      coordCounts[coordKey] = index + 1
      if (index > 0) {
        const offset = 0.003
        const angle = index * (2 * Math.PI / 6)
        markerLng += offset * Math.cos(angle)
        markerLat += offset * Math.sin(angle)
      }

      const el = createMarkerElement(
        tract.price_per_acre,
        tract.total_acres,
        tract.sale_status,
        tract.listing_status
      )

      // Click to open modal or slide-out (portal mode)
      el.addEventListener('click', () => {
        const saleData: SaleDetail = {
          id: tract.id,
          listingId: tract.listing_id,
          tractId: tract.id,
          auctionDate: tract.auction_date,
          totalAcres: tract.total_acres,
          tillableAcres: tract.tillable_acres,
          companyName: tract.company_name,
          salePrice: tract.sale_price,
          pricePerAcre: tract.price_per_acre,
          county: tract.county,
          state: tract.state,
          township: tract.township,
          soilRating: tract.soil_rating,
          polygonCoordinates: tract.polygon_coordinates,
          saleStatus: tract.sale_status,
          listingType: tract.listing_type,
          pctTillable: tract.pct_tillable,
          pricePerTillableAcre: tract.price_per_tillable_acre,
          pricePerSoilRating: tract.price_per_soil_rating,
        }
        if (portalMode && onTractSelected) {
          onTractSelected(saleData)
        } else {
          setSelectedSale(saleData)
        }
      })

      // Store element ref for highlight updates
      el.dataset.tractId = tract.id
      tractMarkerElementsRef.current.set(tract.id, el)

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([markerLng, markerLat])
        .addTo(map)

      tractMarkersRef.current.push(marker)
    }
  }, [mapLoaded, tracts])

  // Highlight report-selected markers in portal mode
  useEffect(() => {
    if (!portalMode || !reportIds) return
    tractMarkerElementsRef.current.forEach((el, tractId) => {
      const pin = el.querySelector('.comp-marker-pin') as HTMLDivElement | null
      if (!pin) return
      if (reportIds.has(tractId)) {
        el.style.zIndex = '10'
        pin.style.boxShadow = '0 0 0 3px #E91E8C, 0 0 12px 2px rgba(233,30,140,0.6)'
        pin.style.border = '2px solid #E91E8C'
      } else {
        el.style.zIndex = ''
        pin.style.boxShadow = ''
        pin.style.border = ''
      }
    })
  }, [portalMode, reportIds])

  // Create dedicated subject tract marker in comparables mode
  const subjectMarkerRef = useRef<maplibregl.Marker | null>(null)
  useEffect(() => {
    const map = mapRef.current
    // Remove previous subject marker
    if (subjectMarkerRef.current) {
      subjectMarkerRef.current.remove()
      subjectMarkerRef.current = null
    }
    if (!portalMode || !subjectTractLocation || !map) return

    // Create a prominent subject tract marker
    const el = document.createElement('div')
    el.style.display = 'flex'
    el.style.flexDirection = 'column'
    el.style.alignItems = 'center'
    el.style.zIndex = '50'

    // Label
    const label = document.createElement('div')
    label.textContent = 'SUBJECT TRACT'
    label.style.cssText = `
      background: rgba(245,140,222,0.2);
      border: 2px solid #F58CDE;
      color: #F58CDE;
      font-size: 11px;
      font-weight: 800;
      padding: 3px 10px;
      border-radius: 6px;
      margin-bottom: 4px;
      white-space: nowrap;
      letter-spacing: 0.5px;
      text-shadow: 0 1px 3px rgba(0,0,0,0.5);
      backdrop-filter: blur(4px);
    `
    el.appendChild(label)

    // Pin with pulsing ring
    const pinContainer = document.createElement('div')
    pinContainer.style.cssText = 'position: relative; width: 24px; height: 24px;'

    // Pulsing ring
    const ring = document.createElement('div')
    ring.style.cssText = `
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid #F58CDE;
      animation: subjectPulse 2s ease-out infinite;
    `
    pinContainer.appendChild(ring)

    // Second ring (delayed)
    const ring2 = document.createElement('div')
    ring2.style.cssText = `
      position: absolute;
      inset: -8px;
      border-radius: 50%;
      border: 2px solid #F58CDE;
      animation: subjectPulse 2s ease-out 1s infinite;
    `
    pinContainer.appendChild(ring2)

    // Main pin
    const pin = document.createElement('div')
    pin.style.cssText = `
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #F58CDE;
      border: 3px solid #fff;
      box-shadow: 0 0 0 4px rgba(245,140,222,0.4), 0 0 20px 6px rgba(245,140,222,0.5);
      position: relative;
      z-index: 1;
    `
    pinContainer.appendChild(pin)
    el.appendChild(pinContainer)

    // Add CSS animation if not already present
    if (!document.getElementById('subject-pulse-style')) {
      const style = document.createElement('style')
      style.id = 'subject-pulse-style'
      style.textContent = `
        @keyframes subjectPulse {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `
      document.head.appendChild(style)
    }

    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([subjectTractLocation.lng, subjectTractLocation.lat])
      .addTo(map)

    subjectMarkerRef.current = marker

    return () => {
      marker.remove()
      subjectMarkerRef.current = null
    }
  }, [portalMode, subjectTractLocation])

  // Manage state card markers
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapLoaded) return

    stateMarkersRef.current.forEach(m => m.remove())
    stateMarkersRef.current = []

    for (const agg of stateAggregates) {
      const el = document.createElement('div')
      el.innerHTML = `
        <div class="state-card">
          <div class="state-card-name">${agg.state}</div>
          <div class="state-card-count">${agg.count} tract${agg.count !== 1 ? 's' : ''}</div>
        </div>
      `
      el.addEventListener('click', () => {
        map.fitBounds(agg.bounds, { padding: 50, duration: 1000 })
      })

      const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([agg.centerLng, agg.centerLat])
        .addTo(map)

      stateMarkersRef.current.push(marker)
    }

    updateStateCardVisibility(map.getZoom())
  }, [mapLoaded, stateAggregates])

  // Toggle state card visibility on zoom
  useEffect(() => {
    updateStateCardVisibility(currentZoom)
  }, [currentZoom])

  function updateStateCardVisibility(zoom: number) {
    const visible = zoom <= ZOOM_TIER_1_MAX
    stateMarkersRef.current.forEach(m => {
      m.getElement().style.display = visible ? 'block' : 'none'
    })
  }

  const getStatusLabel = (status: string | null | undefined) => {
    if (!status) return 'Unknown'
    switch (status.toLowerCase()) {
      case 'sold': return 'Sold'
      case 'listed': return 'Listed'
      case 'active': return 'Active'
      case 'pending': return 'Pending'
      case 'no_sale': return 'No Sale'
      case 'live': return 'Live'
      default: return status
    }
  }

  return (
    <div className="comparables-map-container" style={{ height }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Loading indicator */}
      {loading && (
        <div style={{
          position: 'absolute',
          top: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(4px)',
          color: '#fff',
          fontSize: 13,
          padding: '8px 16px',
          borderRadius: 9999,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <div style={{
            width: 16,
            height: 16,
            border: '2px solid rgba(255,255,255,0.3)',
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin 1s linear infinite',
          }} />
          Loading tracts...
        </div>
      )}

      {/* Filter Button */}
      <button
        onClick={() => setFilterOpen(!filterOpen)}
        style={{
          position: 'absolute',
          top: portalMode ? 70 : 120,
          right: 10,
          zIndex: 10,
          width: 36,
          height: 36,
          borderRadius: 6,
          border: 'none',
          backgroundColor: hasActiveFilters ? '#E91E8C' : 'rgba(0,0,0,0.75)',
          color: '#fff',
          fontSize: 18,
          cursor: 'pointer',
          display: portalMode ? 'none' : 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
        }}
        title="Filters"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
        </svg>
      </button>

      {/* Filter Panel */}
      {filterOpen && (
        <div style={{
          position: portalMode ? 'fixed' : 'absolute',
          top: 0,
          right: 0,
          width: portalMode ? 480 : 320,
          height: '100%',
          backgroundColor: '#111',
          zIndex: portalMode ? 450 : 100,
          overflowY: 'auto',
          boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
          }}>
            <span style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>Filters</span>
            <button
              onClick={() => setFilterOpen(false)}
              style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 22, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>

          <div style={{ padding: '16px 20px', flex: 1, overflowY: 'auto' }}>
            {/* Date Range */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Status</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
                {[
                  { label: 'Listed', value: 'active' },
                  { label: 'Live', value: 'live,pending' },
                  { label: 'Sold', value: 'sold' },
                ].map(opt => {
                  const isActive = filters.statuses.includes(opt.value)
                  return (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setFilters(f => ({
                          ...f,
                          statuses: isActive
                            ? f.statuses.filter(s => s !== opt.value)
                            : [...f.statuses, opt.value]
                        }))
                      }}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 20,
                        border: `1px solid ${isActive ? '#E91E8C' : 'rgba(255,255,255,0.2)'}`,
                        backgroundColor: isActive ? 'rgba(233,30,140,0.2)' : 'transparent',
                        color: isActive ? '#E91E8C' : '#BBBBBB',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
              <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Date Range</div>
              {[
                { label: 'Upcoming', value: 'upcoming' },
                { label: 'Last 6 months', value: '6months' },
                { label: 'Last 1 year', value: '1year' },
                { label: 'Last 2 years', value: '2years' },
                { label: 'All time', value: 'all' },
              ].map(opt => (
                <div
                  key={opt.value}
                  onClick={() => setFilters(f => ({ ...f, dateRange: opt.value }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', cursor: 'pointer',
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%',
                    border: `2px solid ${filters.dateRange === opt.value ? '#E91E8C' : 'rgba(255,255,255,0.3)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {filters.dateRange === opt.value && (
                      <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: '#E91E8C' }} />
                    )}
                  </div>
                  <span style={{ color: '#BBBBBB', fontSize: 14 }}>{opt.label}</span>
                </div>
              ))}
            </div>

            {/* State Filter */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>State</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {STATE_CHIPS.map(st => {
                  const activeStates = filters.stateFilter ? filters.stateFilter.split(',') : []
                  const isActive = activeStates.includes(st)
                  return (
                    <button
                      key={st}
                      onClick={() => {
                        setFilters(f => {
                          const current = f.stateFilter ? f.stateFilter.split(',') : []
                          const next = isActive ? current.filter(s => s !== st) : [...current, st]
                          return { ...f, stateFilter: next.join(','), countyFilters: [] }
                        })
                      }}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 20,
                        border: `1px solid ${isActive ? '#E91E8C' : 'rgba(255,255,255,0.2)'}`,
                        backgroundColor: isActive ? 'rgba(233,30,140,0.2)' : 'transparent',
                        color: isActive ? '#E91E8C' : '#BBBBBB',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {st}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* County Filter (when state selected) */}
            {filters.stateFilter && (() => {
              const activeStates = filters.stateFilter.split(',').filter(Boolean)
              if (activeStates.length !== 1) return null
              const counties = COUNTIES_BY_STATE[activeStates[0]] || []
              if (counties.length === 0) return null
              return (
                <div style={{ marginBottom: 24 }}>
                  <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                    County{filters.countyFilters.length > 0 ? ` (${filters.countyFilters.length} selected)` : ''}
                  </div>
                  <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: 8 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {counties.map(county => {
                        const isActive = filters.countyFilters.includes(county)
                        return (
                          <button
                            key={county}
                            onClick={() => {
                              setFilters(f => ({
                                ...f,
                                countyFilters: isActive
                                  ? f.countyFilters.filter(c => c !== county)
                                  : [...f.countyFilters, county]
                              }))
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 14,
                              border: `1px solid ${isActive ? '#E91E8C' : 'rgba(255,255,255,0.15)'}`,
                              backgroundColor: isActive ? 'rgba(233,30,140,0.2)' : 'transparent',
                              color: isActive ? '#E91E8C' : '#BBBBBB',
                              fontSize: 12,
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            {county}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Township */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>Township</div>
              <input
                type="text"
                placeholder="e.g. Rockford, Bath"
                value={filters.townshipFilter}
                onChange={e => setFilters(f => ({ ...f, townshipFilter: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.15)',
                  backgroundColor: 'rgba(255,255,255,0.05)',
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>

            {/* Range filters */}
            {[
              { label: 'Soil Rating', minKey: 'soilRatingMin' as keyof FilterState, maxKey: 'soilRatingMax' as keyof FilterState },
              { label: 'Acreage', minKey: 'acreageMin' as keyof FilterState, maxKey: 'acreageMax' as keyof FilterState },
              { label: '% Tillable', minKey: 'pctTillableMin' as keyof FilterState, maxKey: 'pctTillableMax' as keyof FilterState },
            ].map(({ label, minKey, maxKey }) => (
              <div key={label} style={{ marginBottom: 20 }}>
                <div style={{ color: '#CCCCCC', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>{label}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="number"
                    placeholder="Min"
                    value={filters[minKey]}
                    onChange={e => setFilters(f => ({ ...f, [minKey]: e.target.value }))}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.15)',
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      color: '#fff', fontSize: 14, outline: 'none',
                    }}
                  />
                  <span style={{ color: '#999999', fontSize: 13 }}>to</span>
                  <input
                    type="number"
                    placeholder="Max"
                    value={filters[maxKey]}
                    onChange={e => setFilters(f => ({ ...f, [maxKey]: e.target.value }))}
                    style={{
                      flex: 1, padding: '8px 12px', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.15)',
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      color: '#fff', fontSize: 14, outline: 'none',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{
            padding: '16px 20px',
            borderTop: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            gap: 10,
          }}>
            <button
              onClick={resetFilters}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)',
                backgroundColor: 'transparent',
                color: '#BBBBBB',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reset
            </button>
            <button
              onClick={applyFilters}
              style={{
                flex: 1, padding: '12px 0', borderRadius: 10,
                border: 'none',
                backgroundColor: '#E91E8C',
                color: '#fff',
                fontSize: 14, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Tract count */}
      {!portalMode && (
        <div style={{
          position: 'absolute',
          bottom: 16,
          right: 16,
          zIndex: 10,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(4px)',
          color: 'rgba(255,255,255,0.7)',
          fontSize: 12,
          padding: '6px 12px',
          borderRadius: 9999,
        }}>
          {tracts.length.toLocaleString()} tracts
        </div>
      )}

      {/* Legend */}
      <div style={{
        position: 'absolute',
        bottom: 16,
        left: 16,
        zIndex: 10,
        background: 'rgba(0,0,0,0.8)',
        backdropFilter: 'blur(4px)',
        borderRadius: 8,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}>
        {[
          { label: 'Sold', color: '#22c55e' },
          { label: 'Listed', color: '#3b82f6' },
          { label: 'Live', color: '#f59e0b' },
          { label: 'No Sale', color: '#6b7280' },
        ].map(({ label, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: color,
              border: '1.5px solid #fff',
              display: 'inline-block',
            }} />
            <span style={{ color: '#fff', fontSize: 11, fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Sale Detail Modal — same as ComparablesMap */}
      {selectedSale && (
        <div className="sale-modal-overlay" onClick={() => setSelectedSale(null)}>
          <div className="sale-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="sale-modal-header">
              <h3 className="sale-modal-title">Tract Sale</h3>
              <button className="sale-modal-close" onClick={() => setSelectedSale(null)}>✕</button>
            </div>
            <div className="sale-modal-body">
              <div className="sale-modal-row">
                <span className="sale-modal-label">Status</span>
                <span className="sale-modal-value">{getStatusLabel(selectedSale.saleStatus)}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Date</span>
                <span className="sale-modal-value">{formatDate(selectedSale.auctionDate)}</span>
              </div>
              <div className="sale-modal-row">
                <span className="sale-modal-label">Acres</span>
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
              {selectedSale.salePrice ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Total Sale Price</span>
                  <span className="sale-modal-value">{formatCurrency(selectedSale.salePrice)}</span>
                </div>
              ) : null}
              {selectedSale.pricePerAcre ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Price/Acre</span>
                  <span className="sale-modal-value">{formatCurrency(selectedSale.pricePerAcre)}/ac</span>
                </div>
              ) : null}
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
                <span className="sale-modal-value">{selectedSale.township || '—'}</span>
              </div>
              {selectedSale.tillableAcres ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">Tillable Acres</span>
                  <span className="sale-modal-value">{formatAcres(selectedSale.tillableAcres)} ac</span>
                </div>
              ) : null}
              {selectedSale.tillableAcres && selectedSale.pricePerAcre && selectedSale.totalAcres ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">$/Tillable Acre</span>
                  <span className="sale-modal-value">{formatCurrency((selectedSale.pricePerAcre * selectedSale.totalAcres) / selectedSale.tillableAcres)}/ac</span>
                </div>
              ) : null}
              {selectedSale.soilRating && selectedSale.pricePerAcre ? (
                <div className="sale-modal-row">
                  <span className="sale-modal-label">$/Soil Rating</span>
                  <span className="sale-modal-value">{formatCurrency(selectedSale.pricePerAcre / selectedSale.soilRating)}</span>
                </div>
              ) : null}

              {/* Soil & Land Data Section */}
              {soilLoading && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0' }}>
                  <div style={{
                    width: 16, height: 16,
                    border: '2px solid #e0e0e0', borderTopColor: '#E91E8C',
                    borderRadius: '50%', animation: 'spin 1s linear infinite',
                  }} />
                  <span style={{ color: '#999', fontSize: 13 }}>Loading soil & land data...</span>
                </div>
              )}
              {!soilLoading && (soilData || elevationData) && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color: '#1a1a1a', fontSize: 16, fontWeight: 700, marginBottom: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
                    Soil & Land Data
                  </div>
                  {elevationData && elevationData.min_ft != null && (
                    <div className="sale-modal-row">
                      <span className="sale-modal-label">Elevation</span>
                      <span className="sale-modal-value">
                        {Math.round(elevationData.min_ft)} - {Math.round(elevationData.max_ft)} ft
                        {elevationData.relief_ft > 0 ? ` (${Math.round(elevationData.relief_ft)} ft relief)` : ''}
                      </span>
                    </div>
                  )}
                  {elevationData?.avg_slope_pct != null && (
                    <div className="sale-modal-row">
                      <span className="sale-modal-label">Avg Slope</span>
                      <span className="sale-modal-value">{elevationData.avg_slope_pct}%</span>
                    </div>
                  )}
                  {soilData?.map_units && soilData.map_units.length > 0 && (
                    soilData.map_units.map((unit: any, idx: number) => (
                      <div key={idx} style={{ padding: '10px 0', borderBottom: '1px solid #eee' }}>
                        <div style={{ color: '#1a1a1a', fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                          {unit.name || unit.musym || 'Unknown'}
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          {unit.nccpi != null && <span style={{ color: '#999', fontSize: 12 }}>NCCPI: {unit.nccpi}</span>}
                          {unit.drainage_class && <span style={{ color: '#999', fontSize: 12 }}>{unit.drainage_class}</span>}
                        </div>
                      </div>
                    ))
                  )}
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

            {/* View Listing */}
            {selectedSale.listingId && (
              portalMode && onViewListing ? (
                <button
                  className="sale-modal-action-btn"
                  style={{ marginBottom: '8px' }}
                  onClick={() => {
                    onViewListing(selectedSale.listingId!)
                    setSelectedSale(null)
                  }}
                >
                  View Listing →
                </button>
              ) : (
                <a
                  href={`/listings/${selectedSale.listingId}`}
                  className="sale-modal-action-btn"
                  style={{ textDecoration: 'none', marginBottom: '8px' }}
                >
                  View Listing →
                </a>
              )
            )}

            {/* Add to Report */}
            <button
              className="sale-modal-action-btn"
              style={{
                backgroundColor: selectedIds.has(selectedSale.id) ? 'rgba(233,30,140,0.08)' : 'rgba(0,0,0,0.05)',
                color: selectedIds.has(selectedSale.id) ? '#E91E8C' : '#333',
                border: selectedIds.has(selectedSale.id) ? '1px solid #E91E8C' : '1px solid rgba(0,0,0,0.15)',
                marginBottom: '16px',
              }}
              onClick={() => {
                toggleSelection(selectedSale)
                setSelectedSale(null)
              }}
            >
              {selectedIds.has(selectedSale.id) ? '− Remove from Report' : '+ Add to Report'}
            </button>
          </div>
        </div>
      )}

      {/* Floating Report Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: 12,
          backgroundColor: '#E91E8C', borderRadius: 30, padding: '12px 24px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', zIndex: 200, cursor: 'pointer',
        }}>
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
            {selectedIds.size} Selected
          </span>
          <button
            onClick={() => {
              const reportData = {
                comparables: selectedTracts.map(t => ({
                  id: t.id,
                  county: t.county,
                  state: t.state,
                  total_acres: t.totalAcres,
                  tillable_acres: t.tillableAcres,
                  soil_rating: t.soilRating,
                  price_per_acre: t.pricePerAcre,
                  sale_price: t.salePrice,
                  auction_date: t.auctionDate,
                  company_name: t.companyName,
                })),
              }
              sessionStorage.setItem('exploreReport', JSON.stringify(reportData))
              window.location.href = '/listings/report'
            }}
            style={{
              background: 'rgba(255,255,255,0.2)', border: 'none', borderRadius: 20,
              padding: '8px 16px', color: '#fff', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Create Report
          </button>
          <button
            onClick={() => { setSelectedIds(new Set()); setSelectedTracts([]) }}
            style={{
              background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)',
              cursor: 'pointer', fontSize: 18,
            }}
          >
            ✕
          </button>
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
  status: string | null,
  listingStatus?: string | null,
): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'comp-marker'
  const isLive = listingStatus === 'live'

  const label = document.createElement('div')
  label.className = 'comp-marker-label'

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

  // Pulsing ring for live auctions
  if (isLive) {
    const pulseRing = document.createElement('div')
    pulseRing.style.cssText = `
      position: absolute;
      bottom: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 2px solid #EF4444;
      animation: livePulse 1.5s ease-out infinite;
    `
    container.appendChild(pulseRing)
    container.style.position = 'relative'

    // Add CSS animation if not already present
    if (!document.getElementById('live-pulse-style')) {
      const style = document.createElement('style')
      style.id = 'live-pulse-style'
      style.textContent = `
        @keyframes livePulse {
          0% { transform: translateX(-50%) scale(1); opacity: 0.8; }
          100% { transform: translateX(-50%) scale(2.5); opacity: 0; }
        }
      `
      document.head.appendChild(style)
    }
  }

  const pin = document.createElement('div')
  pin.className = 'comp-marker-pin comparable'
  pin.style.backgroundColor = isLive ? '#EF4444' : getStatusPinColor(status)
  container.appendChild(pin)

  return container
}
