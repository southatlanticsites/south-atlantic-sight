#!/usr/bin/env python3
"""Build data/news.json: NC commercial real estate headlines, tagged and placed on the map.

Only the headline, source name, date and link are stored; readers click through
to the publisher for the story.

Placement: a street address in the headline is geocoded (Google Geocoding API if
the GOOGLE_GEOCODING_KEY environment variable is set, otherwise the free US Census
geocoder). Otherwise the headline is placed at the center of the NC town or county
it names and marked approximate. Headlines naming no NC place are kept unplaced.
"""
import datetime as dt, email.utils, html, json, os, re, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "news.json")
KEEP_DAYS, MAX_ITEMS = 120, 800
GKEY = os.environ.get("GOOGLE_GEOCODING_KEY", "")

GNEWS = "https://news.google.com/rss/search?hl=en-US&gl=US&ceid=US:en&q="
QUERIES = [
    '"North Carolina" "shopping center"', '"North Carolina" retail development planned',
    '"North Carolina" rezoning approved', '"North Carolina" "mixed-use" development',
    '"North Carolina" grocery store opening OR planned', '"North Carolina" Publix OR Lidl OR Aldi OR Wegmans OR "Harris Teeter" OR "Food Lion" OR "Lowes Foods" new store',
    '"North Carolina" coffee OR "drive-thru" new location opening', '"North Carolina" restaurant chain new location',
    '"North Carolina" industrial park OR warehouse OR "distribution center"', '"North Carolina" "data center" proposed OR approved',
    '"North Carolina" office building sold OR lease OR headquarters', '"North Carolina" apartments OR townhomes OR subdivision approved OR proposed',
    '"North Carolina" acres sold OR purchased development', '"North Carolina" hotel OR "self-storage" OR "car wash" proposed OR planned',
    'Raleigh development rezoning', 'Durham development rezoning', 'Charlotte development rezoning', 'Greensboro OR "Winston-Salem" development rezoning',
    'Wilmington NC development rezoning', 'Fayetteville NC development', 'Asheville development rezoning', 'Cary OR Apex OR "Wake Forest" OR "Holly Springs" OR "Fuquay-Varina" development',
    'Johnston County OR Clayton OR Garner OR Knightdale development', 'Chatham County OR Pittsboro OR Mebane OR Burlington NC development',
]
FEEDS = [("Business North Carolina", "https://businessnc.com/feed/")]

SECTORS = [   # first match wins as the main category
    ("Retail", r"shopping center|retail|grocery|grocer|supermarket|restaurant|coffee|drive[- ]thru|store\b|stores\b|mall\b|outparcel|food hall|brewery|dealership|car wash|convenience|gas station|publix|lidl|aldi|wegmans|harris teeter|food lion|lowes foods|trader joe|whole foods|target\b|walmart|costco|sheetz|wawa|buc-ee|chick-fil-a|starbucks|dutch bros|7 brew|scooter's|culver's|bojangles|cook out|whataburger"),
    ("Industrial", r"industrial|warehouse|distribution center|logistics|manufactur|factory|plant\b|data center|megasite|flex space|cold storage|spec building|self[- ]storage"),
    ("Office", r"office|headquarters|\bhq\b|coworking|life science|lab space|medical office|campus"),
    ("Housing", r"apartment|multifamily|multi-family|townhome|townhouse|subdivision|housing|homes\b|residential|condo|senior living|student housing|build-to-rent|homebuilder|affordable"),
    ("Mixed-use", r"mixed[- ]use|town center|redevelop|master[- ]plan"),
    ("Land", r"\bacres?\b|rezon|annex|land sale|land deal|site plan|tract\b|parcel"),
]
TAGS = {
    "Coffee": r"coffee|starbucks|dutch bros|7 brew|scooter's|dunkin|caribou|biggby|black rifle|cafe\b|café",
    "QSR": r"drive[- ]thru|fast[- ]food|quick[- ]service|chick-fil-a|culver's|bojangles|cook out|whataburger|raising cane|zaxby|mcdonald|wendy's|taco bell|chipotle|cava\b|popeyes|shake shack|in-n-out|freddy's|slim chickens",
    "Grocery": r"grocery|grocer|supermarket|publix|lidl|aldi|wegmans|harris teeter|food lion|lowes foods|trader joe|whole foods|sprouts|kroger|costco|sam's club",
    "Restaurant": r"restaurant|eatery|steakhouse|taproom|brewery|food hall|bar\b|pizzeria",
    "Convenience": r"convenience|gas station|sheetz|wawa|buc-ee|royal farms|quiktrip|circle k|travel center",
    "Big box": r"target\b|walmart|costco|home depot|lowe's|big[- ]box|ikea|bass pro|scheels",
    "Fitness": r"gym\b|fitness|pickleball|climbing|sauna|sweathouz",
    "Childcare": r"daycare|day care|childcare|child care|preschool|primrose|goddard",
    "Car wash": r"car wash", "Self-storage": r"self[- ]storage|storage facility",
    "Data center": r"data center", "Hotel": r"hotel|resort|hospitality",
    "Medical": r"medical|hospital|clinic|urgent care|health campus",
    "Rezoning": r"rezon|annex|planning board|town council|commissioners (approve|vote|reject)",
    "Sale": r"\bsold\b|sells\b|acquire|acquisition|purchas|buys\b|bought",
    "Lease": r"\blease[sd]?\b|leasing|tenant|signs on",
}
RELEVANT = re.compile("|".join(p for _, p in SECTORS) + r"|development|developer|construction|groundbreaking|breaks ground", re.I)
EXCLUDE = re.compile(r"shot\b|shooting|stabb|killed|dies\b|dead\b|murder|arrest|robber|crash|wreck|fire destroys|police|sheriff|suspect|obituar|recall|lawsuit over|football|basketball|playoff|weather|hurricane|tornado|election|stock price|earnings|black friday|holiday hours|sandwich|menu item|thanksgiving hours|recipe|coupon", re.I)
AMBIGUOUS = {"Washington", "Columbia", "Jackson", "Aurora", "Columbus", "Troy", "Dallas", "Denver", "Cleveland", "Princeton",
             "Marion", "Franklin", "Clinton", "Jefferson", "Madison", "Lincoln", "Union", "Wilson", "Lee", "Wayne", "Orange",
             "Macon", "Davie", "Graham", "Mitchell", "Warren", "Vance", "Polk", "Hoke", "Ashe", "Dare", "Person", "Bath",
             "Star", "Bethel", "Stem", "Liberty", "Seven Springs", "Spring Lake", "Lake Park", "Centerville", "Newport",
             "Salem", "Oxford", "Lexington", "Concord", "Monroe", "Jacksonville", "Greenville", "Burlington", "Kingston",
             "Wake", "Moore", "Stokes", "Burke", "Lenoir", "Nash", "Pitt", "Surry", "Swain", "Yancey", "Gates", "Hyde",
             "Bladen", "Duplin", "Craven", "Harnett", "Sampson", "Rowan", "Stanly", "Anson", "Avery", "Clay", "Cary", "Garland",
             "Clayton", "Apex", "Stanley", "Stanfield", "Norwood", "Richlands", "Belmont", "Mount Holly", "Mount Airy", "Mount Olive", "Chocowinity",
             "Kure Beach", "Hertford", "Windsor", "Plymouth", "Sparta", "Bolton", "Milton", "Dover", "Trenton", "Vass", "Ansonville",
             "Fairview", "Fairmont", "Fremont", "Middlesex", "Spencer", "Landis", "China Grove", "Granite Falls", "Rhodhiss",
             "Kingstown", "Lansing", "Havelock", "Tryon", "Saluda", "Highlands", "Cashiers", "Forest City", "Red Oak", "Pine Level"}
OTHER_STATE = re.compile(r"\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Wisconsin|Wyoming)\b|,\s?(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b|S\.C\.|Va\.|Tenn\.|Ga\.")
NC_HINT = re.compile(r"\bN\.?C\.?\b|North Carolina|Triangle|Triad|Piedmont|Outer Banks|Carolina\b", re.I)
ADDR = re.compile(r"\b(\d{2,5}\s+(?:[NSEW]\.?\s+)?(?:[A-Z][A-Za-z0-9.'-]*\s+){1,4}(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Hwy|Highway|Pkwy|Parkway|Ln|Lane|Way|Ct|Court|Pl|Place)\b\.?)")


def get(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; SAS-Sight/1.0)"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def parse(xml, default_source=None):
    out = []
    try:
        root = ET.fromstring(xml)
    except ET.ParseError:
        return out
    for it in root.iter("item"):
        title = html.unescape((it.findtext("title") or "").strip())
        link = (it.findtext("link") or "").strip()
        src = it.findtext("source") or default_source or ""
        if src and title.endswith(" - " + src):
            title = title[: -len(" - " + src)].strip()
        try:
            d = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "").date().isoformat()
        except Exception:
            d = dt.date.today().isoformat()
        if title and link:
            out.append({"t": title, "s": src, "u": link, "d": d})
    return out


def classify(title):
    cat = next((name for name, pat in SECTORS if re.search(pat, title, re.I)), None)
    tags = [name for name, pat in TAGS.items() if re.search(pat, title, re.I)]
    return cat, tags


def find_place(title, places):
    hint = bool(NC_HINT.search(title))
    best = None
    for p in places:                                   # ordered by population, counties last
        name = p["name"]
        if not re.search(r"(?<![A-Za-z])" + re.escape(name) + r"(?![A-Za-z])", title):
            continue
        base = name.replace(" County", "")
        if p["type"] == "town" and base in AMBIGUOUS and not hint:
            continue
        if p["type"] == "county" or best is None:
            if best is None or (p["type"] == "town"):
                best = p
        if best and best["type"] == "town":
            break
    return best


def geocode(addr, town):
    q = "%s, %s, NC" % (addr, town)
    try:
        if GKEY:
            d = json.loads(get("https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode(
                {"address": q, "components": "administrative_area:NC|country:US", "key": GKEY})))
            if d.get("status") == "OK":
                loc = d["results"][0]["geometry"]["location"]
                return round(loc["lat"], 5), round(loc["lng"], 5)
        else:
            d = json.loads(get("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?" + urllib.parse.urlencode(
                {"address": q, "benchmark": "Public_AR_Current", "format": "json"})))
            m = d.get("result", {}).get("addressMatches", [])
            if m:
                return round(m[0]["coordinates"]["y"], 5), round(m[0]["coordinates"]["x"], 5)
    except Exception as e:
        print("geocode failed", q, str(e)[:60])
    return None


def main():
    places = json.load(open(os.path.join(ROOT, "data", "nc_places.json")))
    old = []
    if os.path.exists(OUT):
        try:
            old = json.load(open(OUT)).get("items", [])
        except ValueError:
            old = []
    known = {i["u"] for i in old} | {i["t"].lower() for i in old}
    fresh = []
    for q in QUERIES:
        try:
            fresh += parse(get(GNEWS + urllib.parse.quote(q + " when:21d")))
        except Exception as e:
            print("query failed", q, str(e)[:80])
        time.sleep(1.0)
    for name, url in FEEDS:
        try:
            fresh += parse(get(url), name)
        except Exception as e:
            print("feed failed", name, str(e)[:80])
    added = 0
    for it in fresh:
        if it["u"] in known or it["t"].lower() in known:
            continue
        known.add(it["u"]); known.add(it["t"].lower())
        if EXCLUDE.search(it["t"]) or not RELEVANT.search(it["t"]):
            continue
        if OTHER_STATE.search(it["t"]) and not NC_HINT.search(it["t"]):
            continue                                    # headline is about another state
        cat, tags = classify(it["t"])
        if not cat:
            continue
        place = find_place(it["t"], places)
        if not place and not NC_HINT.search(it["t"]):
            continue                                    # not clearly about North Carolina
        it.update({"cat": cat, "tags": tags})
        if place:
            it.update({"place": place["name"], "lat": place["lat"], "lng": place["lng"], "approx": True})
            m = ADDR.search(it["t"])
            if m and place["type"] == "town":
                pt = geocode(m.group(1), place["name"])
                if pt:
                    it.update({"lat": pt[0], "lng": pt[1], "approx": False, "addr": m.group(1)})
        old.append(it); added += 1
    cutoff = (dt.date.today() - dt.timedelta(days=KEEP_DAYS)).isoformat()
    items = sorted((i for i in old if i["d"] >= cutoff), key=lambda i: i["d"], reverse=True)[:MAX_ITEMS]
    json.dump({"updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "items": items}, open(OUT, "w"),
              separators=(",", ":"), ensure_ascii=False)
    print("fetched", len(fresh), "added", added, "total", len(items), "placed", sum(1 for i in items if "lat" in i))


if __name__ == "__main__":
    main()
