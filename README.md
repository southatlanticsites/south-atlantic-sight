# South Atlantic Sight

Client-facing North Carolina site map for South Atlantic Sites. Public data only.
Live at https://southatlanticsites.github.io/south-atlantic-sight/

## How it works

- A static site (no build step) on GitHub Pages using the Google Maps JavaScript API.
- State, federal and local layers are read live from each agency's public map service,
  so nothing here needs updating when they publish new data.
- A few layers are prepared ahead of time into `data/` by the scripts in `scripts/`,
  which the "Refresh map data" GitHub Action runs on a schedule.

| Layer | Source | Refresh |
|---|---|---|
| Parcels | NC OneMap statewide parcels | live |
| NCDOT planned projects, active construction, city limits | NCDOT | live |
| Traffic counts (AADT) | NCDOT | live |
| Zoning | Wake County (all towns), Durham, Greensboro, Charlotte-Mecklenburg | live |
| Development cases | Wake County, Durham | live |
| Flood zones | NC Floodplain Mapping Program (state effective flood maps) | live |
| Wetlands | US Fish and Wildlife NWI | live |
| Schools, water and sewer areas, aerial photos | NC OneMap | live |
| Fire and EMS stations | USGS National Map | live |
| Opportunity Zones, transmission lines | HUD, HIFLD | live |
| SAS listings | the existing sas-property-map page | live |
| Demographics | Census ACS 5-year block groups, aged with county growth factors | `build_demographics.py`, yearly |
| Brand locations | All The Places | `build_brands.py`, weekly |
| Property news | Google News and Business NC headlines | `build_news.py`, daily |

## Adding a layer

Add one entry to `js/layers.js`. Any public ArcGIS MapServer works with `type: 'arcgis'`.

## Planned schools and fire stations

Add entries to `data/planned_facilities.json`; the layer appears once the file has any:

```json
[{ "kind": "school", "name": "New elementary (E-50)", "status": "Opens 2028", "lat": 35.7, "lng": -78.8, "source": "https://..." }]
```

## Settings

`js/config.js` holds the Google Maps browser key (restrict it by referrer in Google Cloud),
the start view and the default layers. To geocode street addresses in news headlines with
Google instead of the Census geocoder, add a repository secret named `GOOGLE_GEOCODING_KEY`.

## Not in this repo

Nothing confidential belongs here. GitHub Pages is public: broker-only and vault layers
need a real sign-in backend and must not be added to this site.
