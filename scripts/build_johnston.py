"""Build the Johnston County layers from the county GIS downloads.

Usage:  python3 scripts/build_johnston.py <folder with the extracted shapefiles>

Expects Sewer.shp, jchydro.shp, 2ft_contours_NCDOT.shp, elementary.shp, middle.shp
and high.shp somewhere under that folder. Writes to data/joco/.

Line layers (sewer, streams, contours) are cut into a grid of small files so the
browser only fetches the cells in view. Each line is stored as a Google encoded
polyline (precision 1e-6) with a short property code.
"""
import json, math, os, shutil, sys
import geopandas as gpd
from shapely.geometry import box, LineString, MultiLineString
from shapely.ops import unary_union

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'joco')
PREC = 1e6


def find(root, name):
    for d, _, fs in os.walk(root):
        for f in fs:
            if f.lower() == name.lower():
                return os.path.join(d, f)
    sys.exit('missing ' + name)


def enc(coords):
    out, plat, plng = [], 0, 0
    for lng, lat in coords:
        la, ln = int(round(lat * PREC)), int(round(lng * PREC))
        for v in (la - plat, ln - plng):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plng = la, ln
    return ''.join(out)


def parts(g):
    if g is None or g.is_empty:
        return []
    if isinstance(g, LineString):
        return [g]
    if isinstance(g, MultiLineString):
        return list(g.geoms)
    return [p for x in getattr(g, 'geoms', []) for p in parts(x)]


def grid(name, gdf, code, cell, simplify_ft, extra_meta):
    """gdf in state plane feet; code(row) -> short property value."""
    d = os.path.join(OUT, name)
    shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    gdf['geometry'] = gdf.geometry.simplify(simplify_ft, preserve_topology=False)
    gdf = gdf.to_crs(4326)
    cells = {}
    for _, r in gdf.iterrows():
        g, c = r.geometry, code(r)
        if c is None:
            continue
        x0, y0, x1, y1 = g.bounds
        for i in range(math.floor(x0 / cell), math.floor(x1 / cell) + 1):
            for j in range(math.floor(y0 / cell), math.floor(y1 / cell) + 1):
                bx = box(i * cell, j * cell, (i + 1) * cell, (j + 1) * cell)
                piece = g if bx.contains(g) else g.intersection(bx)
                for p in parts(piece):
                    if len(p.coords) >= 2:
                        cells.setdefault(f'{i}_{j}', []).append([c, enc(p.coords)])
    total = 0
    for k, v in cells.items():
        s = json.dumps(v, separators=(',', ':'))
        total += len(s)
        open(os.path.join(d, k + '.json'), 'w').write(s)
    meta = dict(cell=cell, cells=sorted(cells), bounds=[round(x, 5) for x in gdf.total_bounds])
    meta.update(extra_meta)
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), separators=(',', ':'))
    print(f'{name}: {len(gdf)} lines, {len(cells)} cells, {total / 1e6:.1f} MB')


def hydro_kind(code):
    c = (code if isinstance(code, str) else '').strip(" '").lower()
    if c == 'nr': return 'Neuse River'
    if c == 'lr': return 'Little River'
    if any(s in c for s in ('pond', 'lake', 'lagoon')) or c in ('pone', 'sp'): return 'Pond or lake'
    if any(s in c for s in ('swp', 'swamp', 'pocosin', 'pososin')): return 'Swamp or pocosin'
    return 'Stream'


def main(root):
    os.makedirs(OUT, exist_ok=True)

    # Sewer: keep only what helps a site decision.
    s = gpd.read_file(find(root, 'Sewer.shp'))
    s = s.set_crs(2264, allow_override=True)
    props, index = [], {}

    def scode(r):
        t = r.TYPE if isinstance(r.TYPE, str) else 'Unknown'
        key = (
            {'Pressure': 'Force main (pressure)', 'Gravity': 'Gravity sewer'}.get(t, t),
            int(r.Diameter) if r.Diameter and r.Diameter == r.Diameter and r.Diameter > 0 else None,
            r.MATERIAL if isinstance(r.MATERIAL, str) else None,
            int(r.Year_Insta) if r.Year_Insta and r.Year_Insta == r.Year_Insta and r.Year_Insta > 1900 else None,
            r.Pipe_ID if isinstance(r.Pipe_ID, str) else None,
        )
        if key not in index:
            index[key] = len(props); props.append(list(key))
        return index[key]
    grid('sewer', s, scode, 0.04, 1.0, {'fields': ['Type', 'Diameter (in)', 'Material', 'Year installed', 'Pipe ID'], 'props': props})

    h = gpd.read_file(find(root, 'jchydro.shp')).set_crs(2264, allow_override=True)
    kinds = ['Stream', 'Pond or lake', 'Swamp or pocosin', 'Neuse River', 'Little River']
    grid('hydro', h, lambda r: kinds.index(hydro_kind(r.HYDRO_CODE)), 0.03, 3.0, {'kinds': kinds})

    # Contours: values at or below 0 ft are errors in the source (the county's low point is ~90 ft).
    t = gpd.read_file(find(root, '2ft_contours_NCDOT.shp'), columns=['Z_FEET']).set_crs(2264, allow_override=True)
    t = t[(t.Z_FEET > 0) & (t.Z_FEET % 2 == 0)]
    grid('contours', t, lambda r: int(r.Z_FEET), 0.01, 1.5, {})

    feats = []
    for lvl, fn in (('Elementary', 'elementary.shp'), ('Middle', 'middle.shp'), ('High', 'high.shp')):
        z = gpd.read_file(find(root, fn)).set_crs(2264, allow_override=True)
        z['geometry'] = z.geometry.buffer(0).simplify(10)
        z = z.to_crs(4326)
        for _, r in z.iterrows():
            gj = json.loads(gpd.GeoSeries([r.geometry]).to_json())['features'][0]['geometry']
            def rnd(c):
                return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 5), round(c[1], 5)]
            gj['coordinates'] = rnd(gj['coordinates'])
            feats.append({'type': 'Feature', 'properties': {'l': lvl, 'n': r.DIST_NAME.strip()}, 'geometry': gj})
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(OUT, 'school_zones.geojson'), 'w'), separators=(',', ':'))
    print('school zones:', len(feats), os.path.getsize(os.path.join(OUT, 'school_zones.geojson')) // 1000, 'KB')


if __name__ == '__main__':
    main(sys.argv[1])
