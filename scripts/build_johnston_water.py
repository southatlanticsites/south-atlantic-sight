"""Johnston County Public Utilities water mains -> data/joco/water (grid cells, like the sewer layer).

Downloads WaterLines.zip from johnstonnc.gov/gis2 (updated daily) unless a folder with the extracted
shapefile is given. Run weekly by .github/workflows/data.yml.
Usage:  python3 scripts/build_johnston_water.py [folder]
"""
import importlib.util, io, os, sys, tempfile, urllib.request, zipfile
import geopandas as gpd

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('bj', os.path.join(HERE, 'build_johnston.py'))
bj = importlib.util.module_from_spec(spec); spec.loader.exec_module(bj)


def main(folder):
    shp = [os.path.join(d, f) for d, _, fs in os.walk(folder) for f in fs if f.lower() == 'waterlines.shp']
    if not shp:
        req = urllib.request.Request('https://www.johnstonnc.gov/files/gis/files/WaterLines.zip', headers={'User-Agent': 'south-atlantic-sight data refresh'})
        zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=180).read())).extractall(folder)
        shp = [os.path.join(d, f) for d, _, fs in os.walk(folder) for f in fs if f.lower() == 'waterlines.shp']
    g = gpd.read_file(shp[0])
    g = g.set_crs(2264, allow_override=True) if g.crs is None else g.to_crs(2264)
    g = g[(g.Status.isna()) | (g.Status == 'Active')]
    props, index = [], {}

    def code(r):
        key = ('Water main',
               int(r.Diameter) if r.Diameter == r.Diameter and r.Diameter and r.Diameter > 0 else None,
               r.MATERIAL if isinstance(r.MATERIAL, str) else None,
               int(r.Year_Insta) if r.Year_Insta == r.Year_Insta and r.Year_Insta and r.Year_Insta > 1900 else None,
               r.Pipe_ID if isinstance(r.Pipe_ID, str) else None)
        if key not in index:
            index[key] = len(props); props.append(list(key))
        return index[key]
    bj.grid('water', g, code, 0.04, 1.0, {'fields': ['Type', 'Diameter (in)', 'Material', 'Year installed', 'Pipe ID'], 'props': props})


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp())
