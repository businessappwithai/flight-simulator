# @flight/geospatial

Planet-scale world streaming for Flight World. Pure TypeScript, no renderer dependency: it runs in Bun and in the
simulator's Web Worker. See `ARCHITECTURE.md` → *Planet-scale world* for the design and invariants.

| Module | What it does |
|---|---|
| `geodesy` | WGS84 geodetic ⇄ ECEF ⇄ ENU, great-circle distance/bearing/destination, along/cross-track |
| `floating-origin` | Moving local frame for the renderer (x east, y up, z −north), rebased every 5 km |
| `tiles` | Web-Mercator tile maths, `tilesInRadius` (antimeridian- and pole-safe) |
| `lod` | Detail rings driven by AGL and ground speed, capped near the horizon |
| `prefetch` | `predictPath` (along the route or the track) and `planTiles`: the prioritised, deterministic wanted set |
| `cache` / `streamer` | LRU byte cache and `WorldStreamer` (concurrency, overzoom, abort on sharp turns) |
| `terrain` | Terrarium DEM decode, `TerrainTile.sample`, `terrainMesh`, a small PNG decoder, `terrariumSource` |
| `airports` | OurAirports CSV parser, `AirportIndex` (codes, nearest, alternates), runway geometry, airport detail tiers |
| `route` | `GreatCircleRoute` and `planAirportRoute` (climb / cruise / 3° descent) |
| `sim-world` | Deterministic `SimulationWorld` (z12 decimetre grid, obstacles, runways, manifest + SHA-256) |
| `situation` | `geoSituation`: terrain clearance, terrain ahead, mountains ahead, runway/obstacle, alternates, route |
| `attribution` | Data-source licences and the credits to display |

```bash
bun run geo:flight VOMM VIDP          # offline, synthetic terrain
bun run geo:flight VOMM VOBL --live   # real Mapzen Terrarium tiles (s3.amazonaws.com/elevation-tiles-prod)
bun test tests/geospatial.test.ts
```

`data/ourairports-sample/` is a small hand-assembled sample in OurAirports' format; point `GEO_AIRPORTS` and
`GEO_RUNWAYS` at the full public-domain CSVs for worldwide coverage.

Not in this package yet: adapters for Overture buildings / OSM aeroways from PMTiles, 3D Tiles
(NASA 3DTilesRendererJS) in the R3F view, and wiring the streamer into `sim.worker.ts`. They plug in as
`TileSource`s and `SimEvent`s without changing the interfaces here.
