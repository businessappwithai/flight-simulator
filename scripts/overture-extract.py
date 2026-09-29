#!/usr/bin/env python3
"""Extract Overture Maps features in a lon/lat box straight from the public GeoParquet release on S3.

Reads only each file's footer plus the row groups whose bbox statistics overlap the box (HTTP range requests),
so a city-sized area costs megabytes, not the release's terabytes. Output: GeoJSON FeatureCollection.

  python3 scripts/overture-extract.py buildings 80.10 12.93 80.30 13.10 > chennai-buildings.geojson
  python3 scripts/overture-extract.py infrastructure 80.10 12.93 80.30 13.10 > chennai-infra.geojson

Needs: pip install pyarrow shapely requests. Data: Overture Maps Foundation (buildings: ODbL, includes OSM).
"""
import io, json, re, sys
from concurrent.futures import ThreadPoolExecutor
import pyarrow.parquet as pq, requests
from shapely import wkb
from shapely.geometry import box, mapping

BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com"
RELEASE = "2026-09-23.1"
TYPES = {
    "buildings": ("theme=buildings/type=building", ["id", "geometry", "height", "num_floors", "min_height", "class", "names"]),
    "infrastructure": ("theme=base/type=infrastructure", ["id", "geometry", "subtype", "class", "names", "source_tags"]),
}
session = requests.Session()

class RangeFile(io.RawIOBase):
    """Seekable read-only file over HTTP range requests (what pyarrow needs to read a footer and row groups)."""
    def __init__(self, url):
        self.url, self.pos = url, 0
        self.size = int(session.head(url, timeout=60).headers["Content-Length"])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def read(self, n=-1):
        if n < 0: n = self.size - self.pos
        if n == 0 or self.pos >= self.size: return b""
        end = min(self.size, self.pos + n) - 1
        r = session.get(self.url, headers={"Range": f"bytes={self.pos}-{end}"}, timeout=120)
        r.raise_for_status()
        self.pos += len(r.content)
        return r.content
    def readinto(self, b):
        data = self.read(len(b)); b[:len(data)] = data; return len(data)

def keys(prefix):
    out, token = [], None
    while True:
        q = f"{BUCKET}/?list-type=2&prefix=release/{RELEASE}/{prefix}/" + (f"&continuation-token={requests.utils.quote(token)}" if token else "")
        t = session.get(q, timeout=60).text
        out += re.findall(r"<Key>([^<]+\.parquet)</Key>", t)
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", t)
        if not m: return out
        token = m.group(1)

def row_groups(url, bb):
    f = pq.ParquetFile(RangeFile(url))
    md, names = f.metadata, f.schema_arrow.names
    col = {md.schema.column(i).path: i for i in range(md.num_columns)}
    hits = []
    for g in range(md.num_row_groups):
        rg = md.row_group(g)
        s = {k: rg.column(col[f"bbox.{k}"]).statistics for k in ("xmin", "xmax", "ymin", "ymax")}
        if any(v is None or not v.has_min_max for v in s.values()): hits.append(g); continue
        if s["xmin"].min <= bb[2] and s["xmax"].max >= bb[0] and s["ymin"].min <= bb[3] and s["ymax"].max >= bb[1]: hits.append(g)
    return f, hits

def main():
    kind, *coords = sys.argv[1:]
    bb = [float(c) for c in coords]
    prefix, cols = TYPES[kind]
    files = [f"{BUCKET}/{k}" for k in keys(prefix)]
    with ThreadPoolExecutor(16) as ex:
        scanned = list(ex.map(lambda u: (u, *row_groups(u, bb)), files))
    area, feats = box(*bb), []
    for url, f, groups in scanned:
        if not groups: continue
        have = [c for c in cols if c in f.schema_arrow.names]
        for g in groups:
            t = f.read_row_group(g, columns=have + ["bbox"]).to_pylist()
            for row in t:
                b = row["bbox"]
                if b["xmax"] < bb[0] or b["xmin"] > bb[2] or b["ymax"] < bb[1] or b["ymin"] > bb[3]: continue
                geom = wkb.loads(row["geometry"])
                if not geom.intersects(area): continue
                props = {k: row.get(k) for k in have if k not in ("geometry",)}
                if isinstance(props.get("names"), dict): props["name"] = props["names"].get("primary")
                props.pop("names", None)
                if isinstance(props.get("source_tags"), (list, dict)):
                    tags = dict(props["source_tags"]) if isinstance(props["source_tags"], list) else props["source_tags"]
                    props["ref"] = tags.get("ref")
                props.pop("source_tags", None)
                feats.append({"type": "Feature", "properties": props, "geometry": mapping(geom)})
        print(f"{url.rsplit('/',1)[1][:12]}: {len(groups)} row groups", file=sys.stderr)
    json.dump({"type": "FeatureCollection", "features": feats}, sys.stdout)
    print(f"{len(feats)} features", file=sys.stderr)

if __name__ == "__main__":
    main()
