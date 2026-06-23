# Ground Goat — Map Redesign Spec (Tract-Level with Progressive Detail)

## Overview

Redesign the dashboard map from listing-level county pins to a **tract-level progressive disclosure map** with three zoom tiers and three data-resolution tiers.

---

## Current State

- Map shows one marker per listing, placed at the county centroid
- No polygon rendering, no tract-level detail
- Map library: **[FILL IN — Mapbox GL JS / Google Maps / Leaflet?]**

## Target State

The map renders individual **tracts** (not listings) with visual fidelity based on available data, and progressively reveals more detail as the user zooms in.

---

## Data Resolution Tiers (Per Tract)

Each tract is rendered using the **best available data**, in this priority:

| Priority | Data Available | Rendering |
|----------|---------------|-----------|
| 1 (Best) | Polygon coordinates from Land ID | Filled polygon on map |
| 2 | Latitude/Longitude (no polygon) | Pin marker at exact location |
| 3 (Fallback) | County + State only | Pin marker at county centroid |

### Data Requirements

The API endpoint serving map data must return tracts with these fields:

```json
{
  "tract_id": "uuid",
  "listing_id": "uuid",
  "tract_number": "1",
  "acres": 80.5,
  "county": "McLean",
  "state": "IL",
  "status": "upcoming",        // upcoming | live | sold | closed
  "auction_date": "2026-03-15",
  "listing_title": "160 Acres McLean County",
  "auction_company": "Sullivan Auctioneers",
  
  // Data resolution fields (check in priority order)
  "polygon": [[lat, lng], ...] | null,   // GeoJSON-style coordinates
  "latitude": 40.5142 | null,
  "longitude": -88.9906 | null,
  
  // Fallback (always present)
  "county_centroid_lat": 40.4907,
  "county_centroid_lng": -88.8487
}
```

**IMPORTANT:** Confirm the actual column names and table structure in the DB. The tracts table may store polygon data differently (e.g., as a JSON column, PostGIS geometry, or a separate related table from Land ID results). Adjust the API response mapping accordingly.

---

## Zoom Level Behavior

### Tier 1 — Zoomed Out (Multi-State View) — Zoom ≤ ~7

**Display:** Custom styled cards/badges per state showing tract counts.

```
┌─────────────┐
│  Illinois    │
│  247 tracts  │
└─────────────┘
```

- Aggregate tract counts by state
- Cards are clickable → zooms to that state
- No individual markers or polygons rendered
- Cards should show the state name and count
- Style: Clean card with Ground Goat brand colors, subtle shadow
- Consider color-coding or a small bar showing status breakdown (e.g., 180 upcoming / 42 live / 25 sold)

### Tier 2 — Mid Zoom (State Level) — Zoom ~7–11

**Display:** Clustered markers with tract counts, grouped by county or geographic proximity.

```
     (42)        (18)
      ●           ●
   McLean      Tazewell
```

- Use marker clustering (e.g., Supercluster for Mapbox, MarkerClusterer for Google Maps)
- Cluster markers show count number
- Clicking a cluster zooms in further
- Still no polygons rendered (performance)
- Individual pins may start appearing at the edges of this zoom range for isolated tracts

### Tier 3 — Zoomed In (County/Local Level) — Zoom ≥ ~11

**Display:** Full detail — polygons, pins, and fallback pins.

- **Polygons** rendered for tracts that have coordinate boundaries
- **Pins** at exact lat/lng for tracts without polygons
- **County fallback pins** (different style — maybe hollow/outlined) for tracts with only county data
- All interactive — click to see tract details

---

## Polygon & Marker Styling

### Polygon Colors by Status

| Status | Fill Color | Border Color | Fill Opacity |
|--------|-----------|--------------|-------------|
| Upcoming | `#2563EB` (blue) | `#1D4ED8` | 0.25 |
| Live/Active | `#16A34A` (green) | `#15803D` | 0.30 |
| Sold | `#DC2626` (red) | `#B91C1C` | 0.20 |
| Closed/Cancelled | `#6B7280` (gray) | `#4B5563` | 0.15 |

- Border width: 2px
- On hover: increase fill opacity to 0.45, show tooltip with tract summary
- On click: open detail panel/popup

### Pin Markers

- **Lat/lng pins**: Solid circle with status color, small dot
- **County fallback pins**: Outlined/hollow circle (to visually indicate lower precision), slightly transparent
- Both should use the same status color scheme as polygons

### Visual Hierarchy

Polygons are the most prominent, lat/lng pins are medium, county fallback pins are the most subtle. This naturally communicates data quality to the user.

---

## Click/Interaction Behavior

### Tract Click (Polygon or Pin)

Show a popup/card with:
- Tract number and acres
- Parent listing title (linked)
- Auction company
- Auction date
- Status badge
- "View Listing →" link

### Cluster Click

Zoom in to expand the cluster.

### State Card Click (Tier 1)

Zoom to fit that state's bounds.

---

## API Endpoint

### `GET /api/map/tracts`

Returns all tracts with map data for the authenticated user's subscribed areas.

**Query params:**
- `bounds` (optional) — `sw_lat,sw_lng,ne_lat,ne_lng` for viewport filtering
- `zoom` (optional) — current zoom level, so the backend can return aggregated data for low zooms

**Response varies by zoom:**

- **Zoom ≤ 7:** Return `{ state_counts: [{ state: "IL", count: 247, centroid: [lat, lng] }, ...] }`
- **Zoom 7–11:** Return `{ clusters: [...] }` or let the frontend cluster from tract points
- **Zoom ≥ 11:** Return full tract data with polygons

**Performance consideration:** For zoom ≥ 11, only return tracts within the current viewport bounds. Don't send all polygons at once.

### Alternative: Frontend-Only Approach

Load all tract **points** (lat/lng + county centroid, no polygons) on initial load. Let the frontend handle clustering via Supercluster or similar. Only fetch polygon data when zoomed in past threshold, filtered by viewport bounds. This reduces API calls but requires careful memory management.

**Recommendation:** Hybrid approach — load all points upfront for clustering, lazy-load polygons on zoom. This gives snappy clustering with on-demand polygon detail.

---

## Migration / Backward Compatibility

- The existing listing-level map can remain functional during development
- New map can be built as a separate component and swapped in when ready
- Ensure the map respects subscription filters (user only sees tracts in their subscribed counties/states)

---

## Database Checklist (Verify Before Starting)

Run these queries to understand current data coverage:

```sql
-- Total tracts
SELECT COUNT(*) FROM tracts;

-- Tracts with polygon data
SELECT COUNT(*) FROM tracts WHERE polygon IS NOT NULL;

-- Tracts with lat/lng but no polygon
SELECT COUNT(*) FROM tracts 
WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND polygon IS NULL;

-- Tracts with only county/state (no coords at all)
SELECT COUNT(*) FROM tracts 
WHERE latitude IS NULL AND longitude IS NULL AND polygon IS NULL;

-- Polygon data format check (see what the data actually looks like)
SELECT id, polygon FROM tracts WHERE polygon IS NOT NULL LIMIT 3;
```

**Adjust column names as needed** — the polygon data might be stored as:
- A JSON/JSONB column with coordinate arrays
- A text field with serialized coordinates
- In a separate `tract_polygons` or `land_id_results` table
- As PostGIS geometry type

---

## Tech Decisions to Make

1. **Map library** — Stick with current library or switch? Mapbox GL JS is excellent for polygon rendering + clustering. If currently using Google Maps, it also supports polygons and clustering well.
2. **Clustering library** — Supercluster (works with any map lib), or built-in clustering from map provider
3. **State-level cards** — Custom overlay markers or a separate UI layer on top of the map
4. **Polygon data format** — GeoJSON is the standard. If Land ID returns data in another format, convert to GeoJSON on ingest.

---

## Implementation Order (Suggested)

1. **Audit DB** — Run the queries above, understand current data shape
2. **API endpoint** — Build `/api/map/tracts` with viewport filtering and zoom-aware responses
3. **Map component** — Build new `TractMap` component alongside existing map
4. **Tier 3 first** — Get polygons + pins rendering at zoomed-in level
5. **Tier 2** — Add clustering for mid-zoom
6. **Tier 1** — Add state-level aggregate cards for zoomed-out view
7. **Styling & interaction** — Polish colors, hover states, popups
8. **Performance testing** — Test with realistic data volumes
9. **Swap in** — Replace old map with new component
10. **Subscription filtering** — Ensure users only see tracts in subscribed areas

---

## CC Command Notes

This spec is designed to be fed to Claude Code in chunks. Start with:

```
# Step 1: Audit the database
Open the ground-goat-backend repo. Connect to the main Postgres database and run queries to understand:
1. The tracts table schema (column names, types)
2. How polygon data is stored (which table, what format)
3. Count of tracts with polygons vs lat/lng vs county-only
4. What the actual polygon data looks like (sample 3 rows)

Print results clearly so we can update the map spec.
```

Then proceed step by step through the implementation order above.
