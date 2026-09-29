# Architecture invariants

1. Simulation truth is deterministic and independent of rendering and AI.
2. Three.js is a renderer, never the authoritative physics engine.
3. Decision engines emit semantic intents, never raw actuator values.
4. Safety executes after AI selection and before the deterministic controller.
5. Requested and executed intents are recorded separately.
6. Jev and Open-Jev are interchangeable DecisionEngine plugins.
7. Physics never waits for a decision provider.
8. Temporal memory is a bounded in-memory ring; persistent experience is separate.
9. Dreamer/world models predict consequences but never define actual outcomes.
10. Counterfactual outcomes are verified by restoring an authoritative simulation snapshot.
11. Every experiment freezes simulator, controller, safety, reward, scenario and seed versions.
12. Learned skills require offline validation, shadow evaluation and regression before activation.
13. React, React Three Fiber and Three.js exist only at the presentation boundary (see below).

## Presentation boundary (enforced)

```
packages/                     ← deterministic core: simulation, world, sensors, controller, safety,
  simulation  world  sensors     cognition, experience, world-model, runtime, protocol …
  controller  safety  …          NO React / React DOM / React Three Fiber / Three.js / apps

apps/
  simulator/     React + React Three Fiber + Three.js   (3D view, HUD, touch yoke)
    src/sim.worker.ts          ← the only simulator file that runs the simulation
  control-room/  React                                   (dashboard, replay, "Why?" side card)
```

Dependency rule:

```
simulation ──────X──────> React
simulation ──────X──────> R3F
simulation ──────X──────> Three.js

R3F / React UI ─────────> @flight/protocol snapshots & telemetry
                              ↑
Simulation Worker ────────────┘   (runs simulation, controller, sensors; never imports the renderer)
```

`bun run audit:deps` (`scripts/dependency-audit.ts`, run in CI) fails the build when:

- any file under `packages/` imports — or any `packages/*/package.json` declares — `react`, `react-dom`,
  `@react-three/*`, `three` (or their `@types`), or imports from `apps/`;
- any non-worker source in `apps/simulator` or `apps/control-room` imports an `@flight/*` package other than
  `@flight/protocol`, or reaches into `packages/` by path;
- a `*.worker.ts` imports the renderer.

`tests/dependency-boundary.test.ts` proves each rule catches violations. Consequence: the renderer can be
replaced (another engine, native, headless) without touching the AI pilot, physics, learning, replay or the
world model; the only contract a UI sees is `@flight/protocol` (`WorldSnapshot`, `SimCommand`/`SimEvent`,
`RuntimeEvent`, `DecisionFrame` + `DecisionEvidence`, `DecisionTrace`).

Networking, when added, is a purpose-built transport for the same protocol messages. Scene-graph/VR
frameworks (A-Frame, Networked A-Frame, "Matrix-world" style engines) are deliberately not part of the core.

## Planet-scale world (`packages/geospatial`)

Flight World can place a flight anywhere on Earth without loading the planet:

```
Mapzen Terrarium DEM · Overture/OSM (PMTiles) · OurAirports
        │ TileSource.load(tile, AbortSignal)
        ▼
WorldStreamer ── planTiles(position, velocity, route, AGL) ── LOD rings + prediction (30/60/120 s ahead)
        │   priority: current 100 · +30 s 90 · +60 s 70 · +120 s 65 · destination 60 · route 50 · in range 40 · behind 5
        ▼
LRU byte cache (wanted tiles refreshed low→high priority, so tiles behind and unwanted tiles are evicted first)
        │
        ├─▶ rendering (worker → page as meshes in the FloatingOrigin frame; never authoritative)
        └─▶ extractSimulationTile ─▶ SimulationWorld (z12, decimetre grid, obstacle boxes, runways)
                                          │ manifest = sorted tile keys + SHA-256, recorded with the flight
                                          ▼
                                   geoSituation → physics, sensors, safety, Jev / XGBoost / Dreamer
```

Invariants:

- **Two worlds.** The streamer is asynchronous and only feeds rendering. Deterministic consumers read
  `SimulationWorld`, whose queries depend only on which tiles it holds (never load order), and return `null` where
  data is missing instead of guessing. A replay rebuilds the world from the recorded manifest (`missingFrom`).
- **Floating origin.** Authoritative positions are WGS84 doubles. Three.js only sees `FloatingOrigin.toLocal`
  (x east, y up, z −north), re-centred every 5 km, so float32 vertices stay centimetre-precise anywhere on Earth.
- **LOD follows the flight, not the camera.** Ring detail drops with height above ground (no buildings above
  1,500 m AGL, no roads above 3,000 m) and ring radii stretch with ground speed; a turn sharper than 15° aborts
  in-flight loads that are now behind.
- **Attribution travels with the data** (`DATA_SOURCES`, `attributionFor`): Mapzen's composite DEM sources, ODbL for
  Overture buildings and OSM, public-domain OurAirports.

### Real-world flights in the simulator

`SET_WORLD {airport, runway}` makes the worker create a `GeoWorld`: the simulator's flat local frame (x right, y up,
z along the runway) is anchored to the real runway threshold with `AnchorFrame`. The mission, controller and learning
are unchanged. Three things differ:

- **Ground.** `DeterministicSimulation.setGround(geo.ground)`; the airfield (3.2 km) stays flat at y = 0 and blends
  into real terrain (including Earth curvature) beyond it, where terrain contact is a crash. Without `setGround`
  every existing checksum is unchanged.
- **Hold for terrain.** Before each `STEP` the worker asks `ensureAround(x, z)`; while any z12 tile in the 3×3 block
  under the aircraft is missing it publishes `geo.holding` and does not advance. Every tick therefore sees complete,
  deterministic terrain: the same flight gives the same checksum on a fast or a slow network (tested with a jittery
  local tile server in `tests/simulator-worker.test.ts`).
- **Rendering.** A `WorldStreamer` (LOD rings, prediction) loads Terrarium tiles; loaded tiles not hidden by loaded
  children become `TerrainPatch` meshes (`TERRAIN` events, transferred buffers). Coarser tiles sit slightly lower so
  finer ones draw on top. Vertices are float32 offsets from a per-tile centre kept in the mesh position, so three.js
  combines them with the camera in double precision (the floating origin). The page uses a logarithmic depth buffer
  and a far plane of 1,200 km.

### Buildings and airport surfaces (Phases 2 and 3)

`SET_WORLD` also takes `featuresUrl`: OpenMapTiles-schema vector tiles — OpenFreeMap by default (free, no key, from
OpenStreetMap), any `{z}/{x}/{y}.pbf` server or TileJSON, or a PMTiles archive read with HTTP range requests
(`scripts/overture-extract.py` + `scripts/bake-features.ts` bake one from Overture/OSM). Only the `building` and
`aeroway` layers are read (`packages/geospatial`: `mvt.ts`, `pmtiles.ts`, `vector.ts`).

- **Surveyed runway.** Before the flight, `GeoWorld.prepare` looks up the runway centreline whose `ref` names the
  chosen end (e.g. `07/25`) and anchors on its real threshold and heading (`surveyedRunwayAnchor`); without data it
  keeps the OurAirports-synthesized runway. The status reports `surveyed`.
- **Physics.** `FeatureWorld` holds z14 tiles of quantised building footprints (grid-indexed) and runway centreline
  segments, with a SHA-256 manifest folded into the flight's manifest. `ground(x, z)` = terrain + the roof of the
  building there (flying into one is terrain contact, i.e. a crash); `landable(x, z)` is true on real runways away
  from the home airfield, so `DeterministicSimulation.setGround(ground, landable)` treats a gentle touchdown there as
  a landing. The worker holds the clock until the 3×3 z14 feature tiles around the aircraft are loaded, exactly as
  for terrain. The flat 3.2 km airfield keeps no real buildings, so the mission is unchanged.
- **Rendering.** Buildings stream within 5 km (`layerMaxDistanceM`), airport surfaces within 15 km, as
  `FeaturePatch` meshes (`FEATURES` events): extruded footprints, runway/taxiway strips with centreline dashes,
  aprons, and runway edge lights.
- **Source unavailable.** Decided once before the flight: every feature tile is then empty and the runway stays
  synthesized; the badge says "buildings unavailable" and the manifest records it.

### Flying between two airports

`SET_WORLD {airport, runway, destination, destinationRunway?}` plans a cross-country flight. Airports come from the
bundled OurAirports catalogue (`packages/geospatial/data/airports-catalog.json.gz`, ~27k fixed-wing airports with
surveyed runway ends where OurAirports has them; rebuilt with `bun scripts/build-airport-catalog.ts`), which the
worker loads in the background and searches for `FIND_AIRPORTS` (ICAO, IATA, name, city). `SET_WORLD` waits for it,
so the airports a flight sees never change mid-flight; the worker processes commands strictly in order.

- **Before the clock starts** (`GeoWorld.prepare`): the destination runway end is chosen (the one named, else the
  longest runway's end most aligned with the inbound bearing), surveyed from vector features when available, its
  elevation read from the DEM, and a great-circle route planned through a final-approach fix 12 km out on the
  extended centreline. Nothing the route autopilot decides depends on data loaded after this point, except the
  terrain the hold rule guarantees.
- **Route autopilot.** `GeoWorld.routeTarget(world)` is a pure function of the snapshot: take-off, climb and cruise
  towards a carrot 6 km ahead on the route at `max(min(cruise, 3° profile), terrain + 450 m)`, where the terrain is
  the highest point in a 2 km corridor ahead as far as the loaded 3×3 tiles reach; then intercept the centreline,
  fly the 3° glide path, flare and roll out. `steerTo` (`@flight/controller`) turns the target into controls, the
  same control law as the mission autopilot. Arrival (on a destination runway, below 8 m/s) completes the flight.
- **Re-anchoring.** Once the aircraft is 25 km from the local origin the worker calls `maybeRebase`: a new
  `AnchorFrame` under the aircraft, aircraft and entity states transformed exactly through WGS84 (position,
  velocity, heading, pitch), `frameEpoch` + 1. Local coordinates stay small and "up" stays level on flights of any
  length. The home airfield keeps its place on Earth (`status.home` tells the page where to draw it); after the first
  re-anchoring it is ordinary landable ground. `RESET` returns to the frame on the home runway. The decision is taken
  from the state alone, so re-anchoring is as deterministic as the rest of the flight.
- **Hold within a batch.** The worker checks `ensureAround` every tick (cached per tile), so a batch stops where the
  aircraft crosses into a tile whose neighbours are not loaded yet; fast and slow networks give the same checksum
  (`tests/geo-route.test.ts`).
- **Landable anywhere.** Every open catalogue runway is landable (`catalogRunwayAt`), with or without buildings data.
  On real terrain a touchdown no longer carries the sink rate into the next tick, so sloping runways can be rolled to
  a stop; the flat airfield (and every procedural checksum) is unchanged.
- **Page.** Search on the start card (From / To), `?to=VOBL&toRunway=09L`, a dashed route line and a green
  destination beacon, route distance / ETA / phase in the badge, a route-following moving map, and ×16 / ×32 time
  acceleration. Trails and maps restart when `frameEpoch` changes; terrain and feature meshes are re-sent under a new
  epoch. The chase and orbit cameras stay above terrain and in front of hillsides and buildings (BVH ray queries with
  three-mesh-bvh, presentation only). Instruments show true heading and altitude above mean sea level.

### Offline route packs, GeoTelemetry and 3D Tiles

- **Offline route pack.** The worker fetches tiles through `cachingFetch` over the browser's Cache API
  (`cacheApiStore`), so every tile it receives is kept (Range requests keyed by range, for PMTiles). `PACK_ROUTE`
  fetches ahead of time everything the route will need (`routePackTiles`: the 3×3 z12 terrain and, with features,
  3×3 z14 feature tiles along the whole route — what the hold rule will ask for — plus render terrain in a corridor
  and around both airports) and reports `ROUTE_PACK` progress; `CLEAR_TILE_CACHE` forgets it. The same bytes come
  back offline, so an offline flight has the online flight's checksum (`tests/geo-offline.test.ts`).
- **GeoTelemetry.** `GeoWorld.streamSample` describes the physics world around the aircraft (tiles held, tiles still
  missing in the 3×3 blocks, clock holds and time held), the render streamer (wanted, queued, in flight, loaded,
  failed, aborted, cache entries/MB/evictions/hit rate, p50/p95 tile latency) and destination readiness. The worker
  records a sample every 10 s of flight and at each re-anchoring as `WORLD_STREAM` runtime events in the flight
  trace; the Control Room's **World stream** card shows the latest one with trends. Observation only.
- **3D Tiles.** `?tiles3d=<tileset.json>` or `?tiles3dKey=<Google Maps key>` (Photorealistic 3D Tiles) adds an OGC
  3D Tiles layer rendered by NASA-AMMOS 3DTilesRendererJS. `status.frame.ecefToThree` (the exact inverse of the
  anchor frame, as a matrix) places the ECEF tiles on the local frame, again after each re-anchoring;
  `&tiles3dOffset=<m>` lifts them (geoid vs ellipsoid heights). Render only: physics never reads 3D Tiles.
  `scripts/make-test-tileset.ts` writes a one-box tileset for testing without a key.
