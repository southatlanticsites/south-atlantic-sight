#!/usr/bin/env python3
"""Build the demographics layer for South Atlantic Sight.

Method (same as the Lidl grocery map):
  * US Census ACS 5-year block groups (keyless table-based summary files).
  * Aged to the estimate year with a county growth factor:
        factor = Census county population estimate (latest vintage)
                 / ACS county population
    Population, households and the income-bracket counts are multiplied by it.
  * Median household income is aged with CPI.

Outputs
  data/bgpts.json             one row per block group, used for ring statistics
                              [lat, lon, land_sq_mi, pop, households, 16 income bins, factor]
  data/demographics_bg.geojson  simplified polygons for the shaded map

Usage: python3 scripts/build_demographics.py   (needs `npx mapshaper` for the polygons)
"""
import csv, io, json, os, subprocess, sys, tempfile, urllib.request, zipfile

STATE = "37"                       # North Carolina
ACS_YEAR = 2024                    # ACS 2020-2024 5-year
EST_YEAR = 2025                    # year the numbers are aged to
PEP_URL = "https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv"
PEP_COL = "POPESTIMATE2025"
CPI_FACTOR = 1.027                 # income aging, CPI +2.7%
SF = "https://www2.census.gov/programs-surveys/acs/summary_file/%d/table-based-SF/data/5YRData/acsdt5y%d-%s.dat"
CB = "https://www2.census.gov/geo/tiger/GENZ%d/shp/cb_%d_%s_bg_500k.zip" % (ACS_YEAR, ACS_YEAR, STATE)
TABLES = ["b01003", "b11001", "b19001", "b19013", "b01002", "b25001", "b25003"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.environ.get("SIGHT_CACHE", os.path.join(tempfile.gettempdir(), "sight-cache"))
SQM_PER_SQMI = 2589988.110336


def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        print("downloading", url, flush=True)
        req = urllib.request.Request(url, headers={"User-Agent": "south-atlantic-sight-build"})
        with urllib.request.urlopen(req, timeout=300) as r, open(path + ".part", "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        os.replace(path + ".part", path)
    return path


def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x < -1000 else x      # ACS uses large negatives for "not available"


def load_table(t):
    """Return {geoid: {column: value}} for NC block groups and counties."""
    path = fetch(SF % (ACS_YEAR, ACS_YEAR, t), "acs%d-%s.dat" % (ACS_YEAR, t))
    out = {}
    pre_bg, pre_co = "1500000US" + STATE, "0500000US" + STATE
    with open(path, encoding="utf-8", errors="replace") as f:
        header = f.readline().rstrip("\n").split("|")
        for line in f:
            if not (line.startswith(pre_bg) or line.startswith(pre_co)):
                continue
            parts = line.rstrip("\n").split("|")
            out[parts[0]] = dict(zip(header[1:], parts[1:]))
    return out


def main():
    T = {t: load_table(t) for t in TABLES}
    U = lambda t: t.upper()

    # county growth factors
    acs_county = {g[9:]: num(v[U("b01003") + "_E001"]) for g, v in T["b01003"].items() if g.startswith("05")}
    pep, names = {}, {}
    with open(fetch(PEP_URL, "pep.csv"), encoding="latin-1") as f:
        for row in csv.DictReader(f):
            if row["STATE"] == STATE and row["COUNTY"] != "000":
                fips = row["STATE"] + row["COUNTY"]
                pep[fips] = float(row[PEP_COL])
                names[fips] = row["CTYNAME"].replace(" County", "")
    factor = {c: (pep[c] / acs_county[c] if acs_county.get(c) else 1.0) for c in pep}

    # block-group geometry -> simplified GeoJSON with an interior point and land area
    zpath = fetch(CB, "cb_bg.zip")
    work = os.path.join(CACHE, "cb")
    os.makedirs(work, exist_ok=True)
    with zipfile.ZipFile(zpath) as z:
        z.extractall(work)
    shp = [os.path.join(work, n) for n in os.listdir(work) if n.endswith(".shp")][0]
    raw = os.path.join(CACHE, "bg_simplified.geojson")
    subprocess.run(["npx", "--yes", "mapshaper", shp,
                    "-each", "lat=this.innerY, lon=this.innerX",
                    "-simplify", "dp", "12%", "keep-shapes",
                    "-filter-fields", "GEOID,ALAND,lat,lon",
                    "-o", "precision=0.00001", "format=geojson", raw], check=True)
    geo = json.load(open(raw))

    pts, feats = [], []
    for ft in geo["features"]:
        p = ft["properties"]
        gid = p["GEOID"]
        key = "1500000US" + gid
        if key not in T["b01003"]:
            continue
        county = gid[:5]
        fa = factor.get(county, 1.0)
        pop = num(T["b01003"][key]["B01003_E001"]) or 0
        hh = num(T["b11001"][key]["B11001_E001"]) or 0
        bins = [num(T["b19001"][key]["B19001_E%03d" % i]) or 0 for i in range(2, 18)]
        mhi = num(T["b19013"][key]["B19013_E001"])
        age = num(T["b01002"][key]["B01002_E001"])
        units = num(T["b25001"][key]["B25001_E001"]) or 0
        occ = num(T["b25003"][key]["B25003_E001"]) or 0
        own = num(T["b25003"][key]["B25003_E002"]) or 0
        land = (p.get("ALAND") or 0) / SQM_PER_SQMI
        pts.append([round(p["lat"], 5), round(p["lon"], 5), round(land, 4), int(pop), int(hh)]
                   + [int(b) for b in bins] + [round(fa, 4)])
        ft["properties"] = {
            "g": gid,
            "c": names.get(county, ""),
            "p": round(pop * fa),                                   # population, aged
            "h": round(hh * fa),                                    # households, aged
            "i": round(mhi * CPI_FACTOR) if mhi else None,          # median household income, aged
            "a": age,                                               # median age
            "d": round(pop * fa / land) if land > 0.001 else None,  # people per sq mi
            "o": round(100 * own / occ) if occ else None,           # owner-occupied %
            "u": round(units * fa),                                 # housing units, aged
            "gr": round((fa - 1) * 100, 1),                         # county growth since ACS, %
        }
        feats.append(ft)

    meta = {"acs": "%d-%d" % (ACS_YEAR - 4, ACS_YEAR), "est_year": EST_YEAR, "cpi": CPI_FACTOR,
            "block_groups": len(feats), "pep": PEP_COL}
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    json.dump({"meta": meta, "rows": pts}, open(os.path.join(ROOT, "data", "bgpts.json"), "w"), separators=(",", ":"))
    json.dump({"type": "FeatureCollection", "meta": meta, "features": feats},
              open(os.path.join(ROOT, "data", "demographics_bg.geojson"), "w"), separators=(",", ":"))
    print("block groups:", len(feats), "| state pop ACS:", sum(r[3] for r in pts),
          "| aged:", round(sum(r[3] * r[-1] for r in pts)))
    for c in ("37001", "37183", "37063", "37119"):
        print(" ", names[c], "factor", round(factor[c], 4))


if __name__ == "__main__":
    sys.exit(main())
