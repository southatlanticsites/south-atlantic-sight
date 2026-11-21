"""Copy a jurisdiction's public zoning layer into data/ so the map doesn't depend on its server.

Used where a city's server can't be reached from many networks (Greensboro, Nov 2026: its servers
time out from ordinary home and office connections). Run weekly by .github/workflows/data.yml.

Usage:  python3 scripts/build_arcgis_zoning.py            (builds every entry in JOBS)
Writes data/zoning/<slug>.geojson with properties z (district code), d (district name), j (jurisdiction).
"""
import json, os, sys, time, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, '..', 'data', 'zoning')
JOBS = {
    'greensboro': {
        'url': 'https://gis.greensboro-nc.gov/arcgis/rest/services/Planning/Zoning_MS/MapServer/7',
        'code': 'ZONINGDISTRICT', 'name': 'ZONINGDISTRICTTITLE', 'jurisdiction': 'Greensboro',
    },
}


def get(url, params):
    q = url + '?' + urllib.parse.urlencode(dict(params, f='json'))
    for attempt in range(4):
        try:
            req = urllib.request.Request(q, headers={'User-Agent': 'Mozilla/5.0 (south-atlantic-sight weekly refresh)'})
            return json.load(urllib.request.urlopen(req, timeout=120))
        except Exception as e:
            err = e
            time.sleep(10 * (attempt + 1))
    raise err


def rings_to_geojson(rings):
    # ArcGIS rings: outer rings clockwise, holes counter-clockwise. Group holes under the outer ring before them.
    def area(r):
        return sum((r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]) for i in range(len(r) - 1)) / 2
    polys = []
    for r in rings:
        r = [[round(x, 5), round(y, 5)] for x, y in r]
        if area(r) <= 0 or not polys:
            polys.append([r])
        else:
            polys[-1].append(r)
    return {'type': 'MultiPolygon', 'coordinates': polys} if len(polys) > 1 else {'type': 'Polygon', 'coordinates': polys[0]}


def build(slug, job):
    ids = get(job['url'] + '/query', {'where': '1=1', 'returnIdsOnly': 'true'})['objectIds']
    ids.sort()
    feats = []
    for i in range(0, len(ids), 200):
        d = get(job['url'] + '/query', {'objectIds': ','.join(map(str, ids[i:i + 200])), 'outFields': job['code'] + ',' + job['name'],
                                        'outSR': 4326, 'returnGeometry': 'true', 'maxAllowableOffset': 0.00002, 'geometryPrecision': 6})
        for f in d.get('features', []):
            g = f.get('geometry') or {}
            if not g.get('rings'):
                continue
            a = f.get('attributes', {})
            code = (a.get(job['code']) or '').strip()
            if not code:
                continue
            feats.append({'type': 'Feature', 'geometry': rings_to_geojson(g['rings']),
                          'properties': {'z': code, 'd': (a.get(job['name']) or '').strip(), 'j': job['jurisdiction']}})
    if len(feats) < 0.9 * len(ids):
        sys.exit('%s: only %d of %d features came back; keeping the previous file' % (slug, len(feats), len(ids)))
    os.makedirs(OUTDIR, exist_ok=True)
    out = os.path.join(OUTDIR, slug + '.geojson')
    json.dump({'type': 'FeatureCollection', 'source': job['url'], 'built': time.strftime('%Y-%m-%d'), 'features': feats},
              open(out, 'w'), separators=(',', ':'))
    print(slug, len(feats), 'features', os.path.getsize(out) // 1000, 'KB')


if __name__ == '__main__':
    for slug, job in JOBS.items():
        build(slug, job)
