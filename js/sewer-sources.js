// Public sewer pipe layers, one entry per utility layer. Found through the public ArcGIS catalog and the
// utilities' own servers, each tested (Nov 2026). Johnston County Public Utilities is self-hosted (data/joco/sewer).
// n utility, u layer, k g=gravity / f=force main, b bounding box, w filter, f field names: d diameter, m material, y year/date, o owner
// Not public (login required) when checked: Durham, Burlington, Greenville/Pitt, Fuquay-Varina, Spring Lake.
// No public pipe map: Cape Fear Public Utility Authority (Wilmington, New Hanover), Fayetteville PWC (maps on request), Pender County.
// Not found as public services: Greensboro, High Point, Clayton, Graham, Reidsville, Roxboro, Benson, Hillsborough, Winston-Salem.
window.SIGHT_SEWER = [
  { n: 'Raleigh Water (Raleigh, Garner, Wake Forest, Knightdale, Wendell, Zebulon, Rolesville)', u: 'https://maps.raleighnc.gov/arcgis/rest/services/PublicUtility/SewerExternal/MapServer/3', k: 'g', b: [-78.83, 35.63, -78.25, 36.03], f: { d: 'DIAMETER', m: 'MATERIAL', y: 'INSTALLDATE' } },
  { n: 'Raleigh Water (Raleigh, Garner, Wake Forest, Knightdale, Wendell, Zebulon, Rolesville)', u: 'https://maps.raleighnc.gov/arcgis/rest/services/PublicUtility/SewerExternal/MapServer/2', k: 'f', b: [-78.82, 35.63, -78.28, 36.01], f: { d: 'DIAMETER', m: 'MATERIAL', y: 'INSTALLDATE' } },
  { n: 'Town of Cary (Cary, Morrisville, Wake RTP)', u: 'https://services2.arcgis.com/l4TwMwwoiuEVRPw9/arcgis/rest/services/GravityMainsAGOL_View/FeatureServer/1', k: 'g', b: [-78.96, 35.64, -78.72, 35.91], w: "STATUS = 'Existing'", f: { d: 'DIAMETER', y: 'INSTALLDATE' } },
  { n: 'Town of Apex', u: 'https://gis.apexnc.org/server/rest/services/Operational/Apex_SewerSystem/MapServer/13', k: 'g', b: [-78.97, 35.66, -78.79, 35.79], f: { d: 'DIAMETER', m: 'MATERIAL', y: 'INSTALL_YR' } },
  { n: 'Town of Apex', u: 'https://gis.apexnc.org/server/rest/services/Operational/Apex_SewerSystem/MapServer/14', k: 'f', b: [-78.97, 35.66, -78.72, 35.78], f: { d: 'DIAMETER', m: 'MATERIAL', y: 'INSTALL_YR' } },
  { n: 'Town of Holly Springs (2022 map)', u: 'https://services1.arcgis.com/b6kciy3dYoQmo0t3/arcgis/rest/services/HS_Sewer_Map_2022b/FeatureServer/5', k: 'g', b: [-78.91, 35.6, -78.76, 35.69], f: { d: 'Size_', m: 'Material' } },
  { n: 'Orange County utilities map', u: 'https://gis.orangecountync.gov/arcgis/rest/services/AGOL/Utilities/MapServer/2', k: 'g', b: [-79.36, 35.85, -78.98, 36.14], f: { d: 'Pipe_Size', o: 'Utility_Co', t: 'Type' } },
  { n: 'Town of Smithfield', u: 'https://services3.arcgis.com/xKbvijdNdEqtlvpl/arcgis/rest/services/Smithfield_Water_Map__Public_WFL1/FeatureServer/56', k: 'g', b: [-78.42, 35.46, -78.29, 35.55], f: { d: 'SSPIDIAM', m: 'SSPIMATR' } },
  { n: 'Town of Smithfield', u: 'https://services3.arcgis.com/xKbvijdNdEqtlvpl/arcgis/rest/services/Smithfield_Water_Map__Public_WFL1/FeatureServer/62', k: 'f', b: [-78.42, 35.46, -78.29, 35.55], f: { d: 'SSPIDIAM', m: 'SSPIMATR' } },
  { n: 'City of Sanford', u: 'https://services7.arcgis.com/LUfTdS74clzPPde3/arcgis/rest/services/Sanford_Utilities/FeatureServer/29', k: 'g', b: [-79.25, 35.41, -79.03, 35.62], w: "LIFECYCLE IS NULL OR LIFECYCLE <> 'Abandoned'", f: { d: 'DIAMETER', m: 'MATERIAL', y: 'SSPICSTR' } },
  { n: 'City of Sanford', u: 'https://services7.arcgis.com/LUfTdS74clzPPde3/arcgis/rest/services/Sanford_Utilities/FeatureServer/30', k: 'f', b: [-79.33, 35.38, -79.03, 35.61], w: "LIFECYCLE IS NULL OR LIFECYCLE <> 'Abandoned'", f: { d: 'DIAMETER', m: 'MATERIAL', y: 'SSPICSTR' } },
  { n: 'City of Dunn', u: 'https://services1.arcgis.com/j5cFsePuF8tFVKEF/arcgis/rest/services/Sanitary_Sewer/FeatureServer/2', k: 'g', b: [-78.66, 35.27, -78.57, 35.35], f: {} },
  { n: 'South Granville Water and Sewer Authority (Butner, Creedmoor, Stem)', u: 'https://services7.arcgis.com/bKZo2XWGZ9iRhr3T/arcgis/rest/services/SGWASA_GIS_PUBLIC_VIEW/FeatureServer/5', k: 'g', b: [-78.81, 36.07, -78.56, 36.23], f: { d: 'PIPE_DIA', m: 'PIPE_MAT', o: 'System' } },
  { n: 'City of Rocky Mount', u: 'https://services.arcgis.com/4MdqIsNzxG7xyTvf/arcgis/rest/services/Sewer_Lines/FeatureServer/16', k: 'g', b: [-77.91, 35.87, -77.7, 36.11], w: "STATUS IS NULL OR STATUS NOT IN ('ABN', 'OS')", f: { d: 'DIAMETER', m: 'MATERIAL' } },
  { n: 'City of Asheboro', u: 'https://services8.arcgis.com/9QE58QTmzLaWSc9H/arcgis/rest/services/Asheboro_AGOL_Utilities/FeatureServer/18', k: 'g', b: [-79.92, 35.6, -79.73, 35.8], f: { d: 'DIAMETER', m: 'MATERIAL' } },
  { n: 'City of Asheboro', u: 'https://services8.arcgis.com/9QE58QTmzLaWSc9H/arcgis/rest/services/Asheboro_AGOL_Utilities/FeatureServer/15', k: 'f', b: [-79.92, 35.6, -79.73, 35.8], f: { d: 'DIAMETER', m: 'MATERIAL' } },
  { n: 'Randolph County utilities map', u: 'https://services3.arcgis.com/P4svYWrn4xHobm3O/arcgis/rest/services/Sewer_Lines/FeatureServer/0', k: 'g', b: [-80.06, 35.52, -79.54, 35.95], w: "PROVIDER IS NULL OR PROVIDER <> 'ASHEBORO'", f: { o: 'PROVIDER' } },
  { n: 'Davidson County', u: 'https://webgis.co.davidson.nc.us/arcgis/rest/services/webGIS/CountySewer_webGIS/MapServer/4', k: 'g', b: [-80.43, 35.77, -80.15, 36.01], f: { d: 'diameter' } },
  { n: 'Davidson County', u: 'https://webgis.co.davidson.nc.us/arcgis/rest/services/webGIS/CountySewer_webGIS/MapServer/5', k: 'f', b: [-80.43, 35.77, -80.15, 36.01], f: { d: 'diameter' } },
  { n: 'Rockingham County', u: 'https://services2.arcgis.com/6ceReeeoWYqSyV5I/arcgis/rest/services/Utilities/FeatureServer/5', k: 'g', b: [-79.96, 36.25, -79.72, 36.48], f: { d: 'DIAMETER', m: 'MATERIAL' } },
  { n: 'Rockingham County', u: 'https://services2.arcgis.com/6ceReeeoWYqSyV5I/arcgis/rest/services/Utilities/FeatureServer/3', k: 'f', b: [-79.97, 36.25, -79.72, 36.48], f: { d: 'DIAMETER', m: 'MATERIAL' } },
  { n: 'City of Eden', u: 'https://services3.arcgis.com/e3NxHWC9V2lElNX2/arcgis/rest/services/Eden_Utility_Map_WFL1/FeatureServer/10', k: 'g', b: [-79.81, 36.46, -79.66, 36.55], f: { d: 'pipe_size', m: 'pipe_mater' } },
  { n: 'City of Eden', u: 'https://services3.arcgis.com/e3NxHWC9V2lElNX2/arcgis/rest/services/Eden_Utility_Map_WFL1/FeatureServer/36', k: 'f', b: [-79.8, 36.46, -79.62, 36.55], f: { d: 'line_size', m: 'material' } },
  { n: 'Town of Southern Pines', u: 'https://services9.arcgis.com/AtyX8cqqHxBiQIog/arcgis/rest/services/SewerLayers_WFL1/FeatureServer/88', k: 'g', b: [-79.45, 35.13, -79.36, 35.26], f: { d: 'DIAMETER', m: 'MATERIAL', y: 'DATE_CONST' } },
  { n: 'Town of Southern Pines', u: 'https://services9.arcgis.com/AtyX8cqqHxBiQIog/arcgis/rest/services/SewerLayers_WFL1/FeatureServer/89', k: 'f', b: [-79.45, 35.13, -79.36, 35.26], f: { d: 'DIAMETER', m: 'MATERIAL', y: 'DATE_CONST' } },
  { n: 'Brunswick County Public Utilities (county sewer map by Timmons Group)', u: 'https://services.arcgis.com/4fG3YBzBoefRGq66/arcgis/rest/services/Brunswick_County_NC_Sewer_Map/FeatureServer/3', k: 'g', b: [-78.62, 33.86, -77.98, 34.35], w: "use_d IN ('GRAVITY', 'FM', 'PRESSURE', 'VACUUM')", f: { d: 'size_d', m: 'mat_d', y: 'INSTALLDATE', t: 'use_d' } },
  { n: 'Harnett Regional Water', u: 'https://gis.harnett.org/arcgis/rest/services/Public_Utilities/PU_Master_Sewer/MapServer/11', k: 'g', b: [-79.12, 35.21, -78.64, 35.56], f: { d: 'Diameter', m: 'Material' } },
  { n: 'Harnett Regional Water', u: 'https://gis.harnett.org/arcgis/rest/services/Public_Utilities/PU_Master_Sewer/MapServer/13', k: 'f', b: [-79.12, 35.18, -78.64, 35.56], w: "Status IS NULL OR Status <> 'Abandoned'", f: { d: 'Diameter', m: 'Material', y: 'YearConstructed' } },
  { n: 'Town of Angier (Harnett County map)', u: 'https://gis.harnett.org/arcgis/rest/services/Public_Utilities/PU_General/MapServer/9', k: 'g', b: [-78.78, 35.45, -78.71, 35.55], f: { d: 'DIAMETER' } },
  { n: 'Town of Angier (Harnett County map)', u: 'https://gis.harnett.org/arcgis/rest/services/Public_Utilities/PU_General/MapServer/10', k: 'f', b: [-78.8, 35.44, -78.69, 35.56], f: {} },
  { n: 'Town of Lillington (Harnett County map)', u: 'https://gis.harnett.org/arcgis/rest/services/Public_Utilities/PU_General/MapServer/12', k: 'g', b: [-78.86, 35.33, -78.77, 35.47], f: { d: 'DIAMETER', m: 'MATERIAL' } },
  { n: 'Onslow Water and Sewer Authority (ONWASA)', u: 'https://services.arcgis.com/rbxWvGybg6v0euvX/arcgis/rest/services/Collections_AGOL/FeatureServer/12', k: 'g', b: [-77.62, 34.44, -77.1, 34.92], f: { d: 'DIAMETER', m: 'MATERIAL', y: 'INSTALLDATE' } },
  { n: 'Onslow Water and Sewer Authority (ONWASA)', u: 'https://services.arcgis.com/rbxWvGybg6v0euvX/arcgis/rest/services/Collections_AGOL/FeatureServer/14', k: 'f', b: [-77.62, 34.44, -77.1, 34.92], f: { d: 'DIAMETER', m: 'MATERIAL', y: 'INSTALLDATE' } },
  { n: 'Town of Kure Beach', u: 'https://services5.arcgis.com/FZXMbeNU6M1BTHki/arcgis/rest/services/Sewer_Line/FeatureServer/0', k: 'g', b: [-77.92, 33.98, -77.9, 34.01], f: { d: 'DIAMETER', t: 'Type' } }
];

// Sewer service areas, used where a utility publishes no pipes. Drawn lightly; a click says whether the spot is inside.
window.SIGHT_SEWER_AREAS = [
  { n: 'Fayetteville PWC sewer service area', src: 'Cumberland County map, last edited Sept 2020', u: 'https://services1.arcgis.com/ssJTvu2LI9qRE1oE/arcgis/rest/services/Sewer_Service_Area/FeatureServer/0', b: [-78.94, 34.9, -78.74, 35.18] }
];
