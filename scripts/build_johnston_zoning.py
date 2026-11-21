"""Johnston County zoning (county and towns) for South Atlantic Sight.

Downloads the county's official shapefiles (updated daily on johnstonnc.gov/gis2, "Download GIS Data")
and writes data/joco/zoning.geojson. Run weekly by .github/workflows/data.yml.

Usage:  python3 scripts/build_johnston_zoning.py [folder with already-extracted shapefiles]

Each feature has z (district code) and j (jurisdiction: the county, or the town whose city limits or
ETJ it sits in). Overlay districts (IHI, municipal transition, highway corridor) have o (overlay name).
"""
import io, json, os, sys, tempfile, urllib.request, zipfile
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'joco', 'zoning.geojson')
BASE = 'https://www.johnstonnc.gov/files/gis/files/'
FILES = {'county': 'CountyZoning', 'town': 'TownZoning', 'limits': 'CityLimits', 'etj': 'ETJ',
         'ihi': 'IHI_overlay', 'mtd': 'MunicipalTransitionDistricts', 'hco': 'WM_GB_HCO_Overlay'}


def load(folder):
    out = {}
    for k, name in FILES.items():
        d = os.path.join(folder, name)
        if not os.path.isdir(d):
            os.makedirs(d, exist_ok=True)
            req = urllib.request.Request(BASE + name + '.zip', headers={'User-Agent': 'south-atlantic-sight data refresh'})
            zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=180).read())).extractall(d)
        shp = [f for f in os.listdir(d) if f.lower().endswith('.shp')][0]
        g = gpd.read_file(os.path.join(d, shp))
        if g.crs is None:
            g = g.set_crs(2264)
        out[k] = g.to_crs(2264)
    return out


def rnd(c):
    return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]


def feats(g, props_fn):
    g = g[g.geometry.notna() & ~g.geometry.is_empty].copy()
    g['geometry'] = g.geometry.buffer(0).simplify(5)
    g = g.to_crs(4326)
    out = []
    for _, r in g.iterrows():
        p = props_fn(r)
        if not p or r.geometry.is_empty:
            continue
        geom = json.loads(gpd.GeoSeries([r.geometry]).to_json())['features'][0]['geometry']
        geom['coordinates'] = rnd(geom['coordinates'])
        out.append({'type': 'Feature', 'properties': p, 'geometry': geom})
    return out


def main(folder):
    d = load(folder)
    # Name each town district by the city limits or ETJ that holds its interior point.
    places = gpd.GeoDataFrame(
        {'name': list(d['limits'].TAG.astype(str)) + list(d['etj'].ETJ_NAME.astype(str))},
        geometry=list(d['limits'].geometry) + list(d['etj'].geometry), crs=2264)
    town = d['town'].copy()
    pts = town.copy(); pts['geometry'] = town.geometry.representative_point()
    j = gpd.sjoin(pts, places, how='left', predicate='within')
    town['j'] = j.groupby(level=0)['name'].first().reindex(town.index).replace({'Wilsons Mills': "Wilson's Mills"})
    # Clayton publishes its own live zoning service, which the map already uses.
    town = town[town.j != 'Clayton']
    out = []
    out += feats(d['county'], lambda r: {'z': str(r.ZONING).strip(), 'j': 'Johnston County'} if isinstance(r.ZONING, str) and r.ZONING.strip() else None)
    out += feats(town, lambda r: {'z': str(r.TAG).strip(), 'j': (r.j if isinstance(r.j, str) else 'Town') } if isinstance(r.TAG, str) and r.TAG.strip() else None)
    out += feats(d['ihi'], lambda r: {'o': 'IHI overlay (Interstate Highway Interchange)'})
    out += feats(d['mtd'], lambda r: {'o': 'Municipal transition district' + (' (' + r.NAME + ')' if isinstance(r.NAME, str) and r.NAME.lower() != 'mtd' else '')})
    out += feats(d['hco'], lambda r: {'o': 'Highway corridor overlay (' + str(r.ZONING) + ')'})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'type': 'FeatureCollection', 'features': out}, open(OUT, 'w'), separators=(',', ':'))
    print(len(out), 'features,', os.path.getsize(OUT) // 1000, 'KB')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp())
