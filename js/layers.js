// Layer registry for South Atlantic Sight (client-facing, public data only).
// To add a layer, add one entry here. Types:
//   arcgis   - a public ArcGIS MapServer drawn by its own server (one image per view) with click lookup
//   image    - an ArcGIS ImageServer (aerial photos)
//   features - a hosted feature layer drawn in the browser
//   custom   - built in app.js (listings, news, brands, demographics, school zones)
//   grid     - local line data cut into grid cells under data/ (scripts/build_johnston.py), drawn as canvas tiles
(function () {
  const NC1 = 'https://services.nconemap.gov/secure/rest/services/';
  const NCEL = NC1 + 'Elevation/';
  const DOT = 'https://gis11.services.ncdot.gov/arcgis/rest/services/';
  const WAKE = 'https://maps.wakegov.com/arcgis/rest/services/';
  const DURHAM = 'https://webgis2.durhamnc.gov/server/rest/services/PublicServices/';
  const GSO = 'https://gis.greensboro-nc.gov/arcgis/rest/services/';
  const MECK = 'https://meckgis.mecklenburgcountync.gov/server/rest/services/';

  const STIP = [['TIP', 'Project ID'], ['Route', 'Route'], ['Description', 'Description'], ['Category', 'Funding category'], ['RightOfWayYear', 'Right-of-way year'], ['ConstructionYear', 'Construction year'], ['ProjectCost', 'Estimated cost'], ['Counties', 'Counties'], ['COMMENT', 'Notes']];

  window.SIGHT_GROUPS = ['Property', 'Market', 'Transportation', 'Planning and zoning', 'Environment', 'Community', 'Utilities', 'Imagery'];

  window.SIGHT_LAYERS = [
    // ---------- Property
    { id: 'listings', group: 'Property', name: 'South Atlantic Sites listings', type: 'custom', swatch: '#C9A249',
      note: 'Current SAS listings with flyers.' },
    { id: 'parcels', group: 'Property', name: 'Parcels', type: 'arcgis', swatch: 'line:#E6399B',
      url: NC1 + 'NC1Map_Parcels/MapServer', layers: [1], minZoom: 14, opacity: 0.95,
      note: 'NC OneMap statewide parcels, compiled from all 100 counties. Zoom in to see lines; click a parcel for details. County update dates vary.',
      identify: [{ layer: 1, title: 'Parcel', geometry: true, tol: 1, kind: 'parcel' }] },

    // ---------- Market
    { id: 'demographics', group: 'Market', name: 'Demographics', type: 'custom', swatch: '#3F7CAC',
      note: 'Census block groups, aged to 2025 with county growth factors. Click anywhere for 1, 3 and 5 mile totals.' },
    { id: 'brands', group: 'Market', name: 'Retail brand locations', type: 'custom', swatch: '#B4532A',
      note: 'Coffee, QSR, grocery, big box, convenience and childcare brands. Mainly from each brand\'s store locator (All The Places, newest complete weekly run), with OpenStreetMap (© OpenStreetMap contributors) filling stores the locators miss and brands with no locator feed, such as Harris Teeter and 7 Brew. Refreshed every Monday; click a dot for its source.' },
    { id: 'news', group: 'Market', name: 'Property news', type: 'custom', swatch: '#7A4EA3',
      note: 'Recent NC commercial real estate headlines. Filter by category in the News tab.' },

    // ---------- Transportation
    { id: 'aadt', group: 'Transportation', name: 'Traffic counts (AADT)', type: 'features', swatch: '#1F2937', minZoom: 12,
      url: 'https://services.arcgis.com/NuWFvHYDMVmmxMeM/ArcGIS/rest/services/NCDOT_AADT_Traffic_Segmentation/FeatureServer/0',
      kind: 'aadt', note: 'NCDOT average daily traffic at count stations (vehicles per day, most recent year on file). Zoom in to see counts.' },
    { id: 'stip', group: 'Transportation', name: 'NCDOT planned projects (STIP)', type: 'arcgis', swatch: 'line:#D9480F',
      url: DOT + 'NCDOT_STIP/MapServer', layers: [0, 1],
      note: 'NCDOT 2026-2035 State Transportation Improvement Program. Click a project for schedule and cost.',
      identify: [
        { layer: 1, title: 'NCDOT planned project', tol: 6, pick: STIP },
        { layer: 0, title: 'NCDOT planned project', tol: 8, pick: STIP }] },
    { id: 'construction', group: 'Transportation', name: 'NCDOT active construction', type: 'arcgis', swatch: 'line:#B91C1C',
      url: DOT + 'NCDOT_RoadProjects/NCDOT_ActiveConstructionProjects/MapServer', layers: [0, 1],
      note: 'Road projects NCDOT has under contract now.',
      identify: [{ layer: 1, title: 'Active road project', tol: 6 }, { layer: 0, title: 'Active road project', tol: 8 }] },

    // ---------- Planning and zoning
    { id: 'citylimits', group: 'Planning and zoning', name: 'City and town limits', type: 'arcgis', swatch: 'line:#6D28D9',
      url: DOT + 'NCDOT_CityBdy_Poly/MapServer', layers: [0], opacity: 0.55,
      note: 'Municipal boundaries from NCDOT (Powell Bill maps). Recent annexations may lag.',
      identify: [{ layer: 0, title: 'Municipality', tol: 1, pick: [['MunicipalBoundaryName', 'Municipality'], ['CountyName1', 'County'], ['PopulationEstimate', 'Population estimate'], ['PopulationEstimateYear', 'Estimate year']] }] },
    { id: 'etj-wake', group: 'Planning and zoning', name: 'Planning jurisdictions and ETJ (Wake County)', type: 'arcgis', swatch: 'line:#0E7490',
      url: WAKE + 'Jurisdictions/Jurisdictions/MapServer', layers: [1], opacity: 0.6,
      note: 'Which town or county has planning authority, including ETJ areas. Wake County only; no statewide ETJ map is published.',
      identify: [{ layer: 1, title: 'Planning jurisdiction', tol: 1 }] },
    { id: 'zoning', group: 'Planning and zoning', name: 'Zoning', type: 'custom', swatch: '#D9A441', minZoom: 11,
      note: 'Zoning from city and county map services.' },
    { id: 'pipeline-wake', group: 'Planning and zoning', name: 'Development cases: Wake County', type: 'arcgis', swatch: '#BE185D', minZoom: 10,
      url: WAKE + 'Planning/Wake_County_Development/MapServer', layers: [0], opacity: 0.7,
      note: 'Subdivision and development applications filed with Wake County (unincorporated areas).',
      identify: [{ layer: 0, title: 'Development case (Wake County)', tol: 2, pick: [['CASENUMBER', 'Case'], ['WORK_CLASS', 'Type'], ['APPLICATIONDATE', 'Filed'], ['DESCRIPTION', 'Description'], ['PLAN_STATUS', 'Status'], ['SUBDIVISION_NAME', 'Subdivision'], ['PROPOSED_NO_LOTS', 'Proposed lots'], ['NUMBER_OF_ACRES', 'Acres']] }] },
    { id: 'pipeline-durham', group: 'Planning and zoning', name: 'Development cases: Durham', type: 'arcgis', swatch: '#BE185D', minZoom: 10,
      url: DURHAM + 'Planning/MapServer', layers: [19], opacity: 0.7,
      note: 'Rezonings, site plans and other cases filed with Durham City-County Planning.',
      identify: [{ layer: 19, title: 'Development case (Durham)', tol: 2, pick: [['A_NUMBER', 'Case'], ['A_TYPE', 'Type'], ['A_PROJECT_NAME', 'Project'], ['A_DESCRIPTION', 'Description'], ['A_STATUS', 'Status'], ['A_DATE', 'Filed'], ['A_CASE_PLANNER', 'Planner']] }] },
    { id: 'oz', group: 'Planning and zoning', name: 'Opportunity Zones', type: 'features', swatch: '#15803D', minZoom: 8,
      url: 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Opportunity_Zones/FeatureServer/13',
      where: "STUSAB='NC'", kind: 'polygon', style: { fill: '#15803D', stroke: '#166534' },
      title: 'Opportunity Zone', pick: [['GEOID10', 'Census tract']], note: 'Federal Qualified Opportunity Zone census tracts (HUD).' },

    // ---------- Environment
    { id: 'flood', group: 'Environment', name: 'Flood zones', type: 'arcgis', swatch: '#3B82F6', minZoom: 12,
      url: 'https://spartagis.ncem.org/arcgis/rest/services/Public/FRIS_FloodZones/MapServer', layers: [2], opacity: 0.6,
      note: 'North Carolina\'s effective flood maps (NC Floodplain Mapping Program, the state partner that produces FEMA\'s maps here). A screening view, not a flood determination.',
      identify: [{ layer: 2, title: 'Flood zone', tol: 1, pick: [['ZONE_LID_VALUE', 'Zone'], ['ZONESUB_LID_VALUE', 'Description'], ['SFHA_TF', 'In the 100-year floodplain'], ['STATIC_BFE', 'Base flood elevation (ft)']] }] },
    { id: 'wetlands', group: 'Environment', name: 'Wetlands (National Wetlands Inventory)', type: 'arcgis', swatch: '#0F766E', minZoom: 12,
      url: 'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer', layers: [0], opacity: 0.65,
      note: 'US Fish and Wildlife mapped wetlands. Indicative only; a delineation is needed for any site.',
      identify: [{ layer: 0, title: 'Mapped wetland', tol: 1 }] },

    { id: 'hydro', group: 'Environment', name: 'Streams, ponds and lakes', type: 'grid', render: 'hydro', grid: 'data/hydro', swatch: 'line:#2563EB', minZoom: 12, reach: 0.01,
      note: 'Statewide USGS National Hydrography Dataset, high resolution (the last USGS release, 2023). Solid lines are perennial streams, dashed are intermittent, dotted are ephemeral; ponds, lakes, rivers and swamps are shaded. Click a spot for the nearest stream or water body, its name and the distance.' },
    { id: 'contours', group: 'Environment', name: 'Topography (contours and ground elevation)', type: 'image', png: true, swatch: 'line:#1F2937', minZoom: 13, opacity: 0.6, z: 8, elev: true,
      url: NCEL + 'DEM03_Contours2_raster/ImageServer', byZoom: [[15, NCEL + 'DEM03_Contours2_raster/ImageServer'], [13, NCEL + 'DEM03_Contours20_raster/ImageServer']],
      note: 'Statewide contours from North Carolina\'s LiDAR elevation program (bare ground, 3-foot grid, flown county by county; flight years vary). 20-foot lines at zoom 13-14, 2-foot lines from zoom 15. Click any spot for its ground elevation. Sites graded after the county\'s flight will differ; a survey governs.' },

    // ---------- Community
    { id: 'schools', group: 'Community', name: 'Public schools', type: 'arcgis', swatch: 'dot:#1D4ED8',
      url: NC1 + 'NC1Map_Education/MapServer', layers: [3], minZoom: 9,
      identify: [{ layer: 3, title: 'Public school', tol: 10, pick: [['school_nam', 'School'], ['phys_addr', 'Address'], ['phys_city', 'City'], ['sch_type', 'Type'], ['bgn_grade', 'Lowest grade'], ['end_grade', 'Highest grade'], ['url_addres', 'Website']] }] },
    { id: 'fire', group: 'Community', name: 'Fire and EMS stations', type: 'arcgis', swatch: 'dot:#DC2626',
      url: 'https://carto.nationalmap.gov/arcgis/rest/services/structures/MapServer', layers: [51], minZoom: 10,
      note: 'USGS National Map structures.',
      identify: [{ layer: 51, title: 'Fire or EMS station', tol: 10, pick: [['name', 'Station'], ['address', 'Address'], ['city', 'City']] }] },
    { id: 'jc-schoolzones', group: 'Community', name: 'School attendance zones: Johnston County', type: 'custom', swatch: 'line:#1E3A8A', minZoom: 9,
      note: 'Johnston County Public Schools elementary, middle and high school zones, from the county GIS site. Pick a level below; click any spot in the county for all three assigned schools.' },
    { id: 'planned', group: 'Community', name: 'Planned schools and fire stations', type: 'custom', swatch: 'dot:#F59E0B', hideWhenEmpty: true,
      note: 'New facilities from school board and city capital plans.' },

    // ---------- Utilities
    { id: 'transmission', group: 'Utilities', name: 'Electric transmission lines', type: 'features', swatch: 'line:#7C2D12', minZoom: 10,
      url: 'https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0',
      kind: 'line', style: { stroke: '#7C2D12', weight: 2 }, title: 'Transmission line', pick: [['OWNER', 'Owner'], ['VOLTAGE', 'Voltage (kV)'], ['VOLT_CLASS', 'Voltage class'], ['TYPE', 'Type'], ['STATUS', 'Status'], ['SUB_1', 'From substation'], ['SUB_2', 'To substation']],
      note: 'Federal HIFLD transmission lines. Positions are approximate.' },
    { id: 'sewer', group: 'Utilities', name: 'Sewer lines', type: 'custom', swatch: 'line:#15803D', minZoom: 11,
      note: 'Public sewer mains from 24 utilities: Raleigh Water (Raleigh, Garner, Wake Forest, Knightdale, Wendell, Zebulon, Rolesville), Cary/Morrisville, Apex, Holly Springs, OWASA (Chapel Hill, Carrboro), Mebane, Johnston County, Smithfield, Sanford, Dunn, South Granville (Butner, Creedmoor), Rocky Mount, Asheboro and Randolph County towns, Davidson County, Rockingham County, Eden Southern Pines, Brunswick County, Harnett Regional Water, Angier, Lillington, Onslow (ONWASA) and Kure Beach. Around Fayetteville, where PWC publishes no pipes, the shaded green area is the PWC sewer service area from a 2020 Cumberland County map. Green is gravity sewer, orange is force main; thicker lines are larger pipes. Pipes show from zoom 14 (Johnston County from 11). Click any spot for the nearest public sewer line, its size and the distance. Durham, Greensboro, Burlington, High Point, Clayton, Fayetteville PWC, CFPUA (Wilmington) and several other utilities do not publish their sewer maps.' },
    { id: 'watersewer', group: 'Utilities', name: 'Public water and sewer service areas (2004)', type: 'arcgis', swatch: '#0284C7',
      url: NC1 + 'NC1Map_Water_Sewer_2004/MapServer', layers: [2, 4], opacity: 0.45, minZoom: 9,
      note: 'The only statewide service-area map, last compiled in 2004. Use as a starting point and confirm with the utility.',
      identify: [{ layer: 2, title: 'Public sewer system (2004)', tol: 1, pick: [['sssyname', 'System'], ['wapcs', 'County']] },
                 { layer: 4, title: 'Public water system (2004)', tol: 1, pick: [['wasyname', 'System'], ['wapcs', 'County']] }] },

    // ---------- Imagery
    { id: 'ortho', group: 'Imagery', name: 'NC aerial photos (latest state flight)', type: 'image', swatch: '#4B5563', minZoom: 12,
      url: NC1 + 'Imagery/Orthoimagery_Latest/ImageServer',
      note: 'North Carolina\'s own high-resolution aerials, often newer than the Google satellite view.' }
  ];
})();
