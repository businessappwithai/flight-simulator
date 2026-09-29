# World data: sources, self-hosting and offline use

The simulator needs three kinds of real-world data. Each has a public default and can be self-hosted; the formats
are standard, so the tools below plug in without code changes.

| Data | Default | Format the simulator reads | URL option |
|---|---|---|---|
| Terrain (DEM) | Mapzen Terrarium on AWS Open Data (`s3.amazonaws.com/elevation-tiles-prod`) | Terrarium PNG, `{z}/{x}/{y}.png` | `&terrain=<template>` |
| Buildings and airport surfaces | OpenFreeMap (OpenMapTiles schema, from OpenStreetMap) | OpenMapTiles vector tiles: `{z}/{x}/{y}` template, TileJSON URL, or a `.pmtiles` archive (HTTP range requests) | `&features=<url>` or `off` |
| Airports and runways | OurAirports (public domain), bundled as `packages/geospatial/data/airports-catalog.json.gz` | compact JSON (see `packages/geospatial/src/catalog.ts`) | — |

Only the `building` and `aeroway` layers are read from vector tiles, at zoom 14. Building heights come from
`render_height` (else `height`, else a default); runways are `aeroway` lines with `class=runway` and a `ref`
such as `07/25`.

## Buildings with Planetiler

[Planetiler](https://github.com/onthegomap/planetiler) builds OpenMapTiles-schema tiles from an OpenStreetMap
extract in minutes; its output is read directly by the simulator.

```bash
# One country or region (Geofabrik extract); --area downloads it. Java 21+.
java -Xmx4g -jar planetiler.jar --download --area=india --output=india.pmtiles
# Serve the archive over HTTP with Range support (any static server that honours Range works, e.g. Caddy or nginx),
# then open the simulator with:
#   ?airport=VOMM&features=https://tiles.example.org/india.pmtiles
```

A `.pmtiles` archive needs no tile server: the simulator reads its directory and tiles with range requests and
caches them. For QA in a container, `.gstack/qa-reports/scripts/terrain-relay.ts --features-dir <dir>` serves local
archives on `http://localhost:3300/features/<name>.pmtiles`.

Planetiler can also write `.mbtiles`; serve those with Martin (below). Overture Maps buildings can be baked into the
same schema instead: `scripts/overture-extract.py` (GeoParquet from Overture's S3 release) then
`scripts/bake-features.ts` (writes a PMTiles archive).

## Serving tiles with Martin

[Martin](https://github.com/maplibre/martin) serves MBTiles, PMTiles and PostGIS as `{z}/{x}/{y}` with a TileJSON
per source:

```bash
martin india.mbtiles          # listens on :3000; TileJSON at http://localhost:3000/india
# ?airport=VOMM&features=http://localhost:3000/india            (TileJSON: the tile template is read from it)
# ?airport=VOMM&features=http://localhost:3000/india/{z}/{x}/{y}
```

Martin sends gzip-compressed tiles; the reader accepts compressed and uncompressed tiles alike. Serve with CORS
enabled when the simulator is on another origin (Martin does by default).

## Terrain

Any Terrarium-encoded PNG tile server works (`height = R·256 + G + B/256 − 32768`). To mirror an area, fetch the
tiles once (e.g. with `terrain-relay.ts`, which caches every tile it relays under `/tmp/terrarium`) and serve the
directory statically as `{z}/{x}/{y}.png`. Physics uses zoom 12; rendering picks coarser or finer zooms by distance and height (`packages/geospatial/src/lod.ts`).

## Airport catalogue

`bun scripts/build-airport-catalog.ts` downloads the OurAirports `airports.csv` and `runways.csv` (or reads local
copies: `bun scripts/build-airport-catalog.ts airports.csv runways.csv`) and rewrites `packages/geospatial/data/airports-catalog.json.gz`: large,
medium and small airports with an open runway of at least 1,500 ft, with runway ends and headings where surveyed.
The build copies it next to `sim.worker.js`; the worker falls back to the bundled 13-airport sample if it cannot load.

## Offline route packs

With a destination set, **Save route for offline** on the start card (`PACK_ROUTE`) fetches every tile the route
needs: the physics terrain (and feature) blocks along the whole route, render terrain in a 30 km corridor and around
both airports. Tiles are kept in the browser's Cache API (HTTPS or localhost only), as is every tile fetched during a
flight, so a packed route flies without a network and with the same checksum. **Clear** removes them.

## 3D Tiles

`&tiles3d=<tileset.json URL>` renders any OGC 3D Tiles tileset (e.g. one exported from Cesium ion or produced with
py3dtiles), `&tiles3dKey=<Google Maps Platform key>` uses Google Photorealistic 3D Tiles (the key must have the Map
Tiles API enabled; Google's attribution appears on the tiles). They are drawn with 3DTilesRendererJS over the
streamed terrain and are not used by physics. `bun scripts/make-test-tileset.ts <dir>` writes a one-box test tileset.

## Determinism

Whatever the source, a flight is reproducible from its manifest: physics reads only the fixed z12 terrain grid and
z14 feature tiles, the clock holds until the tiles around the aircraft are loaded, and the manifest hash (shown as
`manifest` in the status) identifies exactly the data used. A different data source gives a different manifest, and
may give a different checksum; the same source always gives the same flight however fast it answers.
