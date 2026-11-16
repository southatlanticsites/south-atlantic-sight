#!/usr/bin/env python3
"""Build data/brands.json: NC locations of the retail brands SAS tracks.

Source: All The Places (alltheplaces.xyz), a public CC0 dataset collected from
each brand's own store locator. Refreshed roughly weekly upstream.
"""
import json, os, re, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LATEST = "https://data.alltheplaces.xyz/runs/latest.json"

# spider -> (category, display name override or None)
SPIDERS = {
    "scooters_coffee_us": ("Coffee", "Scooter's Coffee"), "starbucks_us": ("Coffee", "Starbucks"),
    "dunkin_us": ("Coffee", "Dunkin'"), "dutch_bros": ("Coffee", "Dutch Bros"), "7_brew_us": ("Coffee", "7 Brew"),
    "biggby_coffee_us": ("Coffee", "Biggby Coffee"), "caribou_coffee_us": ("Coffee", "Caribou Coffee"),
    "culvers_us": ("QSR", "Culver's"), "chick_fil_a": ("QSR", "Chick-fil-A"), "bojangles": ("QSR", "Bojangles"),
    "zaxbys_us": ("QSR", "Zaxby's"), "raising_canes_us": ("QSR", "Raising Cane's"), "whataburger": ("QSR", "Whataburger"),
    "wendys": ("QSR", "Wendy's"), "mcdonalds": ("QSR", "McDonald's"), "chipotle": ("QSR", "Chipotle"),
    "cava_us": ("QSR", "CAVA"), "tropical_smoothie_cafe_us": ("QSR", "Tropical Smoothie Cafe"),
    "lidl": ("Grocery", "Lidl"), "aldi_sud_us": ("Grocery", "ALDI"), "publix_us": ("Grocery", "Publix"),
    "food_lion_us": ("Grocery", "Food Lion"), "wegmans_us": ("Grocery", "Wegmans"),
    "whole_foods": ("Grocery", "Whole Foods"), "trader_joes_us": ("Grocery", "Trader Joe's"),
    "lowes_foods": ("Grocery", "Lowes Foods"), "kroger_us": ("Grocery", None),
    "walmart_us": ("Big box", "Walmart"), "target_us": ("Big box", "Target"), "costco_ca_gb_us": ("Big box", "Costco"),
    "sams_club": ("Big box", "Sam's Club"), "bjs_wholesale": ("Big box", "BJ's"),
    "wawa": ("Convenience", "Wawa"), "sheetz": ("Convenience", "Sheetz"), "royal_farms": ("Convenience", "Royal Farms"),
    "quiktrip_us": ("Convenience", "QuikTrip"), "circle_k": ("Convenience", "Circle K"),
    "primrose_school_us": ("Childcare", "Primrose Schools"), "goddard_school_us": ("Childcare", "The Goddard School"),
}
BBOX = (33.75, -84.4, 36.6, -75.4)   # S, W, N, E


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "sas-sight"})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def in_poly(lat, lng, polys):
    for poly in polys:
        inside = False
        ring = poly[0]
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]; xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        if inside:
            return True
    return False


def main():
    run = json.loads(get(LATEST))["run_id"]
    base = "https://alltheplaces-data.openaddresses.io/runs/%s/output/" % run
    g = json.load(open(os.path.join(ROOT, "data", "nc_outline.geojson")))["features"][0]["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    out, counts, seen = [], {}, set()
    for spider, (cat, label) in SPIDERS.items():
        try:
            raw = get(base + spider + ".geojson").decode("utf-8", "replace")
        except Exception as e:
            print("skip", spider, str(e)[:80]); continue
        n = 0
        for line in raw.splitlines():
            line = line.strip().rstrip(",")
            if not line.startswith('{"type":"Feature"') and not line.startswith('{"type": "Feature"'):
                continue
            try:
                f = json.loads(line)
            except ValueError:
                continue
            geom = f.get("geometry") or {}
            if geom.get("type") != "Point":
                continue
            lng, lat = geom["coordinates"][:2]
            if not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lng <= BBOX[3]):
                continue
            p = f.get("properties", {})
            st = (p.get("addr:state") or "").strip().upper()
            if st and st not in ("NC", "NORTH CAROLINA"):
                continue
            if not in_poly(lat, lng, polys):
                continue
            brand = label or p.get("brand") or p.get("name") or spider
            key = (brand, round(lat, 3), round(lng, 3))   # locators list a store, its pharmacy, fuel etc. separately
            if key in seen:
                continue
            seen.add(key)
            addr = p.get("addr:street_address") or p.get("addr:full") or " ".join(
                x for x in (p.get("addr:housenumber"), p.get("addr:street")) if x)
            out.append({"b": brand, "c": cat, "lat": round(lat, 5), "lng": round(lng, 5),
                        "a": re.sub(r"\s+", " ", addr or "").strip(), "t": p.get("addr:city") or ""})
            n += 1
        counts[brand if label else spider] = n
        print(spider, n, flush=True)
    out.sort(key=lambda r: (r["c"], r["b"], r["t"]))
    json.dump({"source": "All The Places run " + run, "locations": out},
              open(os.path.join(ROOT, "data", "brands.json"), "w"), separators=(",", ":"))
    print("total", len(out))


if __name__ == "__main__":
    main()
