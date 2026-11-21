#!/usr/bin/env python3
"""Build data/brands.json: NC locations of the retail brands SAS tracks.

Sources, in order:
1. All The Places (alltheplaces.xyz), a public CC0 dataset collected weekly from each brand's
   own store locator. A brand's feed sometimes fails for a week (McDonald's, Bojangles and BJ's
   did in Nov 2026), so if the newest run comes back short we walk back through recent runs and
   use the most recent complete one.
2. OpenStreetMap (Overpass API, ODbL) fills stores All The Places misses, and covers brands it has
   no feed for (Harris Teeter) or no coordinates for (7 Brew). OSM points within 150 m of an
   All The Places point of the same brand are treated as duplicates.
If a source is unreachable, that brand keeps last week's points from that source.
"""
import json, math, os, re, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "brands.json")
HISTORY = "https://data.alltheplaces.xyz/runs/history.json"
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter"]

# label: (category, All The Places spider or None, OSM brand tag values)
BRANDS = {
    "Scooter's Coffee": ("Coffee", "scooters_coffee_us", ["Scooter's Coffee"]),
    "Starbucks": ("Coffee", "starbucks_us", ["Starbucks"]),
    "Dunkin'": ("Coffee", "dunkin_us", ["Dunkin'", "Dunkin' Donuts"]),
    "Dutch Bros": ("Coffee", "dutch_bros", ["Dutch Bros. Coffee", "Dutch Bros"]),
    "7 Brew": ("Coffee", "7_brew_us", ["7 Brew", "7 Brew Coffee"]),   # feed has no coordinates: geocoded from its store URLs
    "Biggby Coffee": ("Coffee", "biggby_coffee_us", ["Biggby Coffee"]),
    "Caribou Coffee": ("Coffee", "caribou_coffee_us", ["Caribou Coffee"]),
    "Culver's": ("QSR", "culvers_us", ["Culver's"]),
    "Chick-fil-A": ("QSR", "chick_fil_a", ["Chick-fil-A"]),
    "Bojangles": ("QSR", "bojangles", ["Bojangles", "Bojangles'"]),
    "Zaxby's": ("QSR", "zaxbys_us", ["Zaxby's"]),
    "Raising Cane's": ("QSR", "raising_canes_us", ["Raising Cane's"]),
    "Whataburger": ("QSR", "whataburger", ["Whataburger"]),
    "Wendy's": ("QSR", "wendys", ["Wendy's"]),
    "McDonald's": ("QSR", "mcdonalds", ["McDonald's"]),
    "Chipotle": ("QSR", "chipotle", ["Chipotle"]),
    "CAVA": ("QSR", "cava_us", ["CAVA"]),
    "Tropical Smoothie Cafe": ("QSR", "tropical_smoothie_cafe_us", ["Tropical Smoothie Cafe", "Tropical Smoothie Café"]),
    "Lidl": ("Grocery", "lidl", ["Lidl"]),
    "ALDI": ("Grocery", "aldi_sud_us", ["Aldi", "ALDI"]),
    "Publix": ("Grocery", "publix_us", ["Publix"]),
    "Food Lion": ("Grocery", "food_lion_us", ["Food Lion"]),
    "Harris Teeter": ("Grocery", None, ["Harris Teeter"]),             # no All The Places feed
    "Wegmans": ("Grocery", "wegmans_us", ["Wegmans"]),
    "Whole Foods": ("Grocery", "whole_foods", ["Whole Foods Market"]),
    "Trader Joe's": ("Grocery", "trader_joes_us", ["Trader Joe's"]),
    "Lowes Foods": ("Grocery", "lowes_foods", ["Lowes Foods"]),
    "Walmart": ("Big box", "walmart_us", ["Walmart", "Walmart Supercenter", "Walmart Neighborhood Market"]),
    "Target": ("Big box", "target_us", ["Target"]),
    "Costco": ("Big box", "costco_ca_gb_us", ["Costco"]),
    "Sam's Club": ("Big box", "sams_club", ["Sam's Club"]),
    "BJ's": ("Big box", "bjs_wholesale", ["BJ's Wholesale Club", "BJ's"]),
    "Wawa": ("Convenience", "wawa", ["Wawa"]),
    "Sheetz": ("Convenience", "sheetz", ["Sheetz"]),
    "Royal Farms": ("Convenience", "royal_farms", ["Royal Farms"]),
    "QuikTrip": ("Convenience", "quiktrip_us", ["QuikTrip"]),
    "Circle K": ("Convenience", "circle_k", ["Circle K"]),
    "Primrose Schools": ("Childcare", "primrose_school_us", ["Primrose School"]),
    "The Goddard School": ("Childcare", "goddard_school_us", ["The Goddard School", "Goddard School"]),
}
# OSM shop/amenity values that count as the store itself (skips a Walmart's fuel station, a Harris Teeter pharmacy, etc.)
OSM_KINDS = {"shop": {"supermarket", "department_store", "wholesale", "convenience", "coffee", "variety_store", "general"},
             "amenity": {"fast_food", "cafe", "restaurant", "kindergarten", "childcare", "school"}}
FUEL_OK = {"Convenience"}   # a gas station only counts as the store for convenience brands (not a Costco or Harris Teeter fuel center)
GEOCACHE = os.path.join(ROOT, "data", "geocode_cache.json")
BBOX = (33.75, -84.4, 36.6, -75.4)   # S, W, N, E


def get(url, data=None, timeout=300):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "south-atlantic-sight/1.0 (weekly brand refresh)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def in_poly(lat, lng, polys):
    for poly in polys:
        inside, ring = False, poly[0]
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]; xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        if inside:
            return True
    return False


def dist_m(a, b):
    dy = (a[0] - b[0]) * 111320
    dx = (a[1] - b[1]) * 111320 * math.cos(math.radians(a[0]))
    return math.hypot(dx, dy)


def geocode(addr, cache):
    """Google geocode with a cache kept in the repo, so each address is looked up once."""
    if addr in cache:
        return cache[addr]
    key = os.environ.get("GOOGLE_GEOCODING_KEY")
    if not key:
        return None
    try:
        d = json.loads(get("https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode({"address": addr, "key": key}), timeout=30))
        r = d.get("results") or []
        hit = None
        if r and r[0].get("geometry", {}).get("location_type") in ("ROOFTOP", "RANGE_INTERPOLATED", "GEOMETRIC_CENTER"):
            loc = r[0]["geometry"]["location"]; hit = [loc["lat"], loc["lng"]]
        cache[addr] = hit
        return hit
    except Exception:
        return None


def slug_address(p):
    """'https://locations.7brew.com/nc/fayetteville/3307-bragg-blvd' -> ('3307 Bragg Blvd', 'Fayetteville')."""
    m = re.search(r"/nc/([a-z0-9-]+)/([a-z0-9-]+)", p.get("ref") or p.get("website") or "")
    if not m:
        return None
    city = m.group(1).replace("-", " ").title()
    street = re.sub(r"^\d+-(?=\d)", "", m.group(2)).replace("-", " ").title()
    return street, city


def atp_nc(run, spider, polys, cache=None):
    """NC rows from one All The Places run, or None if the file can't be read."""
    url = "https://alltheplaces-data.openaddresses.io/runs/%s/output/%s.geojson" % (run, spider)
    try:
        raw = get(url).decode("utf-8", "replace")
    except Exception:
        return None
    try:
        feats = json.loads(raw).get("features", []) if raw.strip() else []
    except ValueError:
        feats = []
        for line in raw.splitlines():
            line = line.strip().rstrip(",")
            if line.startswith('{"type":"Feature"') or line.startswith('{"type": "Feature"'):
                try:
                    feats.append(json.loads(line))
                except ValueError:
                    pass
    rows, seen = [], set()
    for f in feats:
        geom = f.get("geometry") or {}
        p = f.get("properties", {})
        if geom.get("type") != "Point":
            sa = slug_address(p) if cache is not None else None
            hit = geocode("%s, %s, NC" % sa, cache) if sa else None
            if not hit:
                continue
            lat, lng = hit
            p = dict(p, **{"addr:street_address": sa[0], "addr:city": sa[1], "addr:state": "NC"})
            geom = {"type": "Point", "coordinates": [lng, lat]}
        lng, lat = geom["coordinates"][:2]
        if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lng <= BBOX[3]):
            continue
        st = (p.get("addr:state") or "").strip().upper()
        if st and st not in ("NC", "NORTH CAROLINA"):
            continue
        if not in_poly(lat, lng, polys):
            continue
        key = (round(lat, 3), round(lng, 3))   # locators list a store, its pharmacy, fuel etc. separately
        if key in seen:
            continue
        seen.add(key)
        addr = p.get("addr:street_address") or p.get("addr:full") or " ".join(
            x for x in (p.get("addr:housenumber"), p.get("addr:street")) if x)
        rows.append({"lat": round(lat, 5), "lng": round(lng, 5), "a": re.sub(r"\s+", " ", addr or "").strip(),
                     "t": p.get("addr:city") or "", "s": "atp"})
    return rows


OSM_FAILS = [0]   # consecutive failures; after 3 we stop asking Overpass this run


def osm_nc(names, polys, fuel_ok=False):
    """NC rows from OpenStreetMap for these brand tag values, or None if Overpass is unreachable."""
    if OSM_FAILS[0] >= 3:
        return None
    rx = "|".join(re.escape(n) for n in names)
    q = '[out:json][timeout:60];nwr["brand"~"^(%s)$"](%s,%s,%s,%s);out tags center;' % ((rx,) + BBOX)
    for attempt in range(2):
        for ep in OVERPASS:
            try:
                d = json.loads(get(ep, data=urllib.parse.urlencode({"data": q}).encode(), timeout=75))
            except Exception:
                continue
            OSM_FAILS[0] = 0
            rows = []
            for e in d.get("elements", []):
                t = e.get("tags", {})
                kind_ok = any(t.get(k) in v for k, v in OSM_KINDS.items()) or (fuel_ok and t.get("amenity") == "fuel")
                if not kind_ok:
                    continue
                c = e.get("center") or e
                lat, lng = c.get("lat"), c.get("lon")
                if lat is None or not in_poly(lat, lng, polys):
                    continue
                if (t.get("addr:state") or "NC").upper() not in ("NC", "NORTH CAROLINA"):
                    continue
                addr = " ".join(x for x in (t.get("addr:housenumber"), t.get("addr:street")) if x)
                if any(dist_m((lat, lng), (r["lat"], r["lng"])) < 150 for r in rows):
                    continue   # same store mapped twice (building and point)
                rows.append({"lat": round(lat, 5), "lng": round(lng, 5), "a": addr, "t": t.get("addr:city") or "", "s": "osm"})
            return rows
        time.sleep(10)
    OSM_FAILS[0] += 1
    return None


def main():
    runs = [r["run_id"] for r in json.loads(get(HISTORY))][::-1][:8]   # newest first
    g = json.load(open(os.path.join(ROOT, "data", "nc_outline.geojson")))["features"][0]["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    cache = json.load(open(GEOCACHE)) if os.path.exists(GEOCACHE) else {}
    prev = {}
    if os.path.exists(OUT):
        for r in json.load(open(OUT)).get("locations", []):
            prev.setdefault((r["b"], r.get("s", "atp")), []).append(r)
    out, report = [], []
    for label, (cat, spider, osm_names) in BRANDS.items():
        base = len(prev.get((label, "atp"), []))
        atp, used = [], "-"
        if spider:
            best = None
            for run in runs:
                rows = atp_nc(run, spider, polys, cache)
                if rows is None:
                    continue
                if best is None or len(rows) > len(best[1]):
                    best = (run, rows)
                # Accept the newest run that isn't clearly short of what we published before.
                if rows and len(rows) >= 0.8 * base:
                    best = (run, rows)
                    break
            if best and best[1]:
                used, atp = best[0], best[1]
            elif base:
                used, atp = "kept last week", prev[(label, "atp")]
        osm = osm_nc(osm_names, polys, cat in FUEL_OK)
        osm_note = "ok"
        if osm is None:
            osm, osm_note = prev.get((label, "osm"), []), "unreachable, kept last week"
        extra = [o for o in osm if not any(dist_m((o["lat"], o["lng"]), (a["lat"], a["lng"])) < 150 for a in atp)]
        for r in atp + extra:
            out.append(dict(r, b=label, c=cat))
        report.append((label, len(atp), used, len(extra), osm_note))
        print("%-24s ATP %4d (%s)  +OSM %3d (%s)" % report[-1], flush=True)
        time.sleep(2)
    json.dump(cache, open(GEOCACHE, "w"), indent=0, sort_keys=True)
    out.sort(key=lambda r: (r["c"], r["b"], r["t"]))
    json.dump({"source": "All The Places (newest complete run per brand) + OpenStreetMap; built " + time.strftime("%Y-%m-%d"),
               "report": [{"brand": b, "atp": n, "run": u, "osm_added": m, "osm": s} for b, n, u, m, s in report],
               "locations": out}, open(OUT, "w"), separators=(",", ":"))
    print("total", len(out))


if __name__ == "__main__":
    main()
