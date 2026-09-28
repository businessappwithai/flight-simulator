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
