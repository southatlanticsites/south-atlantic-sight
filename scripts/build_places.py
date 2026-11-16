#!/usr/bin/env python3
"""Build data/nc_places.json (NC towns + counties with a center point) and
data/nc_outline.geojson. Used by the news pipeline to place headlines and by
the brand pipeline to keep only North Carolina locations.

Sources: NCDOT municipal boundaries service, Census cartographic boundary file.
"""
import json, os, subprocess, tempfile, urllib.parse, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CITY = "https://gis11.services.ncdot.gov/arcgis/rest/services/NCDOT_CityBdy_Poly/MapServer/0/query"
COUNTY = "https://gis11.services.ncdot.gov/arcgis/rest/services/NCDOT_CountyBdy_Poly/MapServer/0/query"
CB = "https://www2.census.gov/geo/tiger/GENZ2024/shp/cb_2024_us_state_500k.zip"


def get(url, params):
    req = urllib.request.Request(url + "?" + urllib.parse.urlencode(params), headers={"User-Agent": "sas-sight"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def center(rings):
    # area-weighted centroid of the largest ring
    best, out = 0, None
    for ring in rings:
        a = cx = cy = 0.0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
            f = x1 * y2 - x2 * y1
            a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
        if abs(a) > best and a != 0:
            best, out = abs(a), (cy / (3 * a), cx / (3 * a))
    return out


def layer(url, fields):
    rows, offset = [], 0
    while True:
        d = get(url, {"where": "1=1", "outFields": fields, "outSR": 4326, "returnGeometry": "true",
                      "maxAllowableOffset": 0.002, "geometryPrecision": 5, "f": "json",
                      "resultOffset": offset, "resultRecordCount": 500})
        feats = d.get("features", [])
        rows += feats
        if len(feats) < 500:
            return rows
        offset += 500


def main():
    places = {}
    for f in layer(CITY, "MunicipalBoundaryName,CountyName1,PopulationEstimate"):
        a = f["attributes"]; c = center(f.get("geometry", {}).get("rings", []))
        name = (a.get("MunicipalBoundaryName") or "").strip().title()
        if not name or not c:
            continue
        pop = a.get("PopulationEstimate") or 0
        if name not in places or pop > places[name]["pop"]:
            places[name] = {"name": name, "county": (a.get("CountyName1") or "").title(), "lat": round(c[0], 5),
                            "lng": round(c[1], 5), "pop": pop, "type": "town"}
    counties = {}
    first = get(COUNTY, {"where": "1=1", "outFields": "*", "returnGeometry": "false", "resultRecordCount": 1, "f": "json"})
    keys = list(first["features"][0]["attributes"].keys())
    namekey = next(k for k in keys if "name" in k.lower())
    for f in layer(COUNTY, namekey):
        c = center(f.get("geometry", {}).get("rings", []))
        name = (f["attributes"].get(namekey) or "").strip().title()
        if name and c:
            counties[name + " County"] = {"name": name + " County", "county": name, "lat": round(c[0], 5),
                                         "lng": round(c[1], 5), "pop": 0, "type": "county"}
    out = sorted(places.values(), key=lambda p: -p["pop"]) + sorted(counties.values(), key=lambda p: p["name"])
    json.dump(out, open(os.path.join(ROOT, "data", "nc_places.json"), "w"), separators=(",", ":"))
    print("towns", len(places), "counties", len(counties))

    tmp = tempfile.mkdtemp()
    z = os.path.join(tmp, "st.zip")
    urllib.request.urlretrieve(CB, z)
    zipfile.ZipFile(z).extractall(tmp)
    shp = [os.path.join(tmp, n) for n in os.listdir(tmp) if n.endswith(".shp")][0]
    subprocess.run(["npx", "--yes", "mapshaper", shp, "-filter", "STUSPS=='NC'", "-simplify", "dp", "6%",
                    "-filter-fields", "NAME", "-o", "precision=0.0001", "format=geojson",
                    os.path.join(ROOT, "data", "nc_outline.geojson")], check=True)


if __name__ == "__main__":
    main()
