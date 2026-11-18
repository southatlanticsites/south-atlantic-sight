"""Statewide streams, ponds and lakes for South Atlantic Sight.

Source: USGS National Hydrography Dataset, high resolution, North Carolina state
download (NHD_H_North_Carolina_State_GDB.zip from prd-tnm.s3.amazonaws.com,
StagedProducts/Hydrography/NHD/State/GDB). USGS stopped updating NHD in 2023; it
is the last release.

Usage:  python3 scripts/build_nc_hydro.py <path to NHD_H_North_Carolina_State_GDB.gdb>

Writes data/hydro/: meta.json plus one file per 0.05-degree cell. Each entry is
[kind, geometry, name]; for lines the geometry is one encoded polyline, for
water areas it is a list of encoded rings (kind >= 10).
"""
import json, math, os, shutil, sys
import geopandas as gpd, pyogrio
from shapely.geometry import box, shape, LineString, Polygon
from shapely.prepared import prep

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'hydro')
CELL, PREC = 0.05, 1e6

LINE_KINDS = ['Perennial stream', 'Intermittent stream', 'Ephemeral stream', 'Stream', 'Canal or ditch', 'River or lake centerline']
AREA_KINDS = {10: 'Pond or lake', 11: 'Reservoir', 12: 'Swamp or marsh', 13: 'River', 14: 'Estuary or sound'}


def line_kind(fcode):
    f = int(fcode or 0)
    return {46006: 0, 46003: 1, 46007: 2, 46000: 3, 55800: 5, 33400: 5}.get(f, 4 if f // 100 == 336 else None)


def area_kind(fcode):
    t = int(fcode or 0) // 100
    return {390: 10, 436: 11, 466: 12, 460: 13, 336: 13, 493: 14}.get(t)


def enc(coords):
    out, plat, plng = [], 0, 0
    for c in coords:
        lng, lat = c[0], c[1]
        la, ln = int(round(lat * PREC)), int(round(lng * PREC))
        for v in (la - plat, ln - plng):
            v = ~(v << 1) if v < 0 else (v << 1)
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plng = la, ln
    return ''.join(out)


def flat(g, want):
    if g is None or g.is_empty:
        return []
    if isinstance(g, want):
        return [g]
    return [p for x in getattr(g, 'geoms', []) for p in flat(x, want)]


cells = {}


def add(geom, kind, name, poly):
    x0, y0, x1, y1 = geom.bounds
    for i in range(math.floor(x0 / CELL), math.floor(x1 / CELL) + 1):
        for j in range(math.floor(y0 / CELL), math.floor(y1 / CELL) + 1):
            bx = box(i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL)
            piece = geom if bx.contains(geom) else geom.intersection(bx)
            key = f'{i}_{j}'
            if poly:
                for p in flat(piece, Polygon):
                    if p.area > 0:
                        rings = [enc(p.exterior.coords)] + [enc(r.coords) for r in p.interiors]
                        cells.setdefault(key, []).append([kind, rings] + ([name] if name else []))
            else:
                for p in flat(piece, LineString):
                    if len(p.coords) >= 2:
                        cells.setdefault(key, []).append([kind, enc(p.coords)] + ([name] if name else []))


def run(gdb, layer, kind_fn, poly, nc):
    n = pyogrio.read_info(gdb, layer=layer)['features']
    step, kept = 150000, 0
    for start in range(0, n, step):
        df = pyogrio.read_dataframe(gdb, layer=layer, columns=['gnis_name', 'fcode'], skip_features=start, max_features=step, force_2d=True)
        df['k'] = df.fcode.map(kind_fn)
        df = df[df.k.notna() & df.geometry.notna()]
        df = df.to_crs(2264)
        df['geometry'] = df.geometry.simplify(4.0 if not poly else 6.0)
        df = df.to_crs(4326)
        df = df[df.geometry.map(nc.intersects)]
        for g, k, nm in zip(df.geometry, df.k, df.gnis_name):
            if g is not None and not g.is_empty:
                add(g, int(k), nm if isinstance(nm, str) else '', poly)
        kept += len(df)
        print(layer, start + step, 'read,', kept, 'kept', flush=True)


def main(gdb):
    outline = json.load(open(os.path.join(HERE, '..', 'data', 'nc_outline.geojson')))
    from shapely.ops import unary_union
    feats = outline['features'] if outline.get('type') == 'FeatureCollection' else [{'geometry': outline}]
    nc = prep(unary_union([shape(f['geometry']).buffer(0) for f in feats]).buffer(0.01))
    run(gdb, 'NHDArea', area_kind, True, nc)
    run(gdb, 'NHDWaterbody', area_kind, True, nc)
    run(gdb, 'NHDFlowline', line_kind, False, nc)
    shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
    total = 0
    for k, v in cells.items():
        v.sort(key=lambda e: -e[0])     # areas first so streams draw on top
        s = json.dumps(v, separators=(',', ':'))
        total += len(s)
        open(os.path.join(OUT, k + '.json'), 'w').write(s)
    meta = dict(cell=CELL, cells=sorted(cells), lineKinds=LINE_KINDS, areaKinds={str(k): v for k, v in AREA_KINDS.items()},
                bounds=[-84.4, 33.8, -75.4, 36.65], source='USGS National Hydrography Dataset (high resolution), North Carolina, last release Dec 2023')
    json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w'), separators=(',', ':'))
    print(len(cells), 'cells,', round(total / 1e6, 1), 'MB')


if __name__ == '__main__':
    main(sys.argv[1])
