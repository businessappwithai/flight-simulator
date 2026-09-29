# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Bun 1.x workspace (`apps/*`, `packages/*`); packages resolve through `tsconfig.json` `paths` (add an entry for any
new `@flight/*` package or subpath export).

```bash
bun install
bun test                              # all tests (tests/*.test.ts)
bun test tests/learning.test.ts       # one file
bun test -t "worker autopilot lands"  # tests whose name matches
bun run typecheck                     # tsc --noEmit
bun run audit                         # no Math.random in deterministic packages
bun run audit:deps                    # presentation/core dependency boundary (see Architecture)
python3 scripts/static-check.py       # static import/API audit
bun run verify:all                    # everything CI-equivalent in one go
bun run simulator                     # 3D simulator, http://localhost:3200 (+ Control Room at /control-room/, as on Pages)
bun run simulator:build               # static build → dist/simulator (page + sim.worker.js)
bun run control-room                  # decision replay dashboard, http://localhost:3100
bun run benchmark                     # reference autopilot over seed-varied scenarios
bun run geo:flight VOMM VIDP [--live]  # fly a great-circle route through the geospatial streamer (--live: real DEM tiles)
```

CI (`.github/workflows/ci.yml`) runs `bun install`, `typecheck`, `bun test`, `audit`, `audit:deps`.
`.github/workflows/pages.yml` builds the simulator plus the Control Room (`/control-room/`, Learning Lab at
`#lab`) and is the only Pages deployer (Pages source: GitHub Actions); a second deploying workflow would race it.

## Architecture

The authoritative invariants are in `ARCHITECTURE.md`; the ones that shape everyday changes:

- **Deterministic core.** `packages/simulation` is a fixed 120 Hz, seeded (SplitMix64) simulation with SHA-256
  state checksums. Tests compare checksums bit for bit (e.g. `tests/simulator-worker.test.ts` flies the worker and
  a direct headless run and expects the same checksum). Anything that changes the controls applied, their order,
  or the PRNG breaks those tests; features that only *observe* a flight (telemetry, learning) must not feed back.
- **Semantic intents, not surfaces.** Pilots and decision engines choose a `PilotIntent`
  (`HOLD`, `CLIMB`, `TURN_LEFT`…); `packages/controller` (`IntentController`, and the stateless
  `autopilotControls`) turns intents into control surfaces. Safety sits between cognition and the controller.
- **Decision engines are plugins.** `packages/decision-core` defines `DecisionEngine`; Jev (`decision-jev`) and
  Open-Jev (`decision-open-jev`) are interchangeable transports. No TypeSafe Jev API contract is bound in this
  repo (see `LOCAL_RUN.md`).
- **The autopilot is Jev and learning, never a built-in flyer.** With the autopilot on, the worker asks the copilot
  (`Copilot.decide`: Jev, and the XGBoost model learned from finished flights when Jev is unsure or unreachable) for a
  `PilotIntent` every `decisionTicks(intent)` (½ s, ⅛ s after a turn) and flies it through `IntentController`, as it
  flies a person's buttons. The clock holds while a decision is pending, so a flight is reproducible from its decisions.
  No key → no autopilot; no answer and nothing learned → `AUTOPILOT_OFF`, the person has the aircraft. Pilots decide from
  the observation's `objective`: the flight plan (`GeoWorld.routeObjective` to a destination, `circuitObjective` for the
  home circuit). `autopilotControls`/`steerTo` in `@flight/controller` are a reference baseline for benchmarks only.
  Tests and the Pages smoke use a stand-in Jev service (`tests/fixtures/jev-stand-in.mjs`, page option `&jevUrl=`).
- **Low-confidence fallback.** `CognitivePilot` (packages/cognition) asks the primary engine and the XGBoost
  best-practice advisor in parallel. If the engine's top candidate is below `minProviderConfidence` (default 0.5,
  also `decision.minProviderConfidence` in `@flight/config`) and the model answered, the model's top-ranked intent
  decides; the frame's `provider` is then the model's source and `evidence.selection` records why.
- **Presentation boundary (enforced by `bun run audit:deps`, tested in `tests/dependency-boundary.test.ts`).**
  `packages/*` may not import React, R3F, Three.js or `apps/`. UI code in `apps/simulator` and
  `apps/control-room` may import only `@flight/protocol`. Only `*.worker.ts` files may use the core packages.
  So new simulator behaviour that needs core logic goes in a package, runs in `apps/simulator/src/sim.worker.ts`,
  and reaches the page as a `SimCommand`/`SimEvent` added to `packages/protocol/src/worker.ts`.
- **Real-world flights (`SET_WORLD`).** The worker's `GeoWorld` anchors the flat local frame to a real runway.
  Physics reads terrain through `DeterministicSimulation.setGround` (flat within 3.2 km of the runway), and the
  worker holds the clock until every z12 terrain tile under the aircraft is loaded, so an anchored flight's checksum
  does not depend on network timing. Terrain meshes reach the page as `TERRAIN` events (tile patches with a
  double-precision centre). Buildings and airport surfaces come from OpenMapTiles vector tiles (OpenFreeMap by
  default, or a PMTiles archive baked with `scripts/overture-extract.py` + `scripts/bake-features.ts`): they raise the
  physics ground (buildings), make real runways landable, and place the anchor on the surveyed runway. Browser QA:
  `.gstack/qa-reports/scripts/geo-qa.mjs` and `geo-features-qa.mjs` with `terrain-relay.ts --features-dir`.
- **Planet-scale geography (`packages/geospatial`).** Authoritative positions are WGS84 doubles; the renderer gets
  coordinates relative to a `FloatingOrigin` that re-centres every 5 km. `WorldStreamer` (async, timing-dependent)
  feeds rendering only. Physics, sensors and the AI read the deterministic `SimulationWorld` (fixed z12 tiles,
  decimetre elevations, obstacle boxes, runways) whose manifest of tile hashes is recorded for replay.
- **Two-airport flights.** With a destination, `GeoWorld` plans the route (great circle, 3° final from a fix 12 km out;
  `routeObjective`) and the worker re-anchors the local frame under the aircraft every 25 km (`maybeRebase`, `frameEpoch`); the page
  moves the home airfield (`geo.home`) and restarts trails/maps on a new epoch. Airports come from the bundled
  OurAirports catalogue (`packages/geospatial/data/airports-catalog.json.gz`, served next to `sim.worker.js`).
  Tiles go through a Cache API–backed `cachingFetch` (offline route packs: `PACK_ROUTE`; the page's app-shell service
  worker `src/app-shell.sw.ts` registers on HTTPS or `?sw=1`); GeoTelemetry samples (`WORLD_STREAM`) ride in flight
  traces and go live to Control Room tabs over the `flight-world-runtime` BroadcastChannel; `&tiles3d=` or a stored
  Google key add a 3D Tiles render layer. Tests that need three.js import it from `apps/simulator/node_modules` (see
  `tests/camera-clearance.test.ts`).
- `@flight/experience`'s index re-exports the Bun SQLite store, which cannot load in a browser worker; import
  browser-safe pieces through subpath exports (e.g. `@flight/experience/fingerprint`).

### 3D simulator (`apps/simulator`)

- `sim.worker.ts` owns the simulation, controller, sensors and learning recorder. The page (`sim-store.ts`) only
  sends commands and asks for ticks with paced `STEP` messages; it renders the `WORLD` snapshots it gets back.
- `SimStore` is the single presentation state (created in `main.tsx`, outside React). The HUD reads a throttled
  (~10 Hz) snapshot via `useSyncExternalStore`; 3D components read `store.latest` every frame.
- Every flight starts parked on runway 18: the store sends no `STEP` until `start()` (Start button, a flight
  input, or engaging the autopilot). While parked the worker publishes only in reply to commands, so any worker
  state the page needs then must `publish()` from its command handler.
- The Jev key (`localStorage["flightWorld.jevKey"]`) gates the autopilot and learning; manual flight always works.
  Learning (`packages/learning`) is a JSON book of `situationFingerprint|action` → landings/crashes, persisted by
  the store in `localStorage["flightWorld.learning.v1"]` and validated with `parseBook` on load.
- URL options (also used by QA): `?seed=7&scenario=seeded&pilot=manual&camera=cockpit&rate=2&quality=low&hud=0`;
  real world: `&airport=VNKT&runway=02` (`&terrain=<Terrarium URL template>`, `&features=<vector tiles / .pmtiles URL | off>`),
  cross-country `&to=VOBL&toRunway=09L`.
  `globalThis.flightSim` exposes read-only `world`, `pilot`, `camera`, `fps`, `paused`, `checksum` for automation.

## Browser QA

QA reports, scripts and screenshots are committed under `.gstack/qa-reports/` (gstack tooling may add `.gstack/`
to `.gitignore` and a self-ignoring `.gstack/.gitignore`; keep the root rule out and `git add -f` the reports).
In headless containers the R3F view renders at ~1 fps with the default headless shell, so gstack `$B` clicks time
out. Drive the simulator with Playwright and SwiftShader, as the scripts in `.gstack/qa-reports/scripts/` do:
`executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"`,
`args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]`,
and wait for UI state rather than sleeping (the HUD updates at ~10 Hz and screenshots take seconds).

## gstack

This project uses [gstack](https://github.com/garrytan/gstack) for agent workflows.

Install it once per machine:

```sh
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
cd ~/.claude/skills/gstack && ./setup
```

Setup requires [bun](https://bun.sh). Run `/gstack-upgrade` to stay current.

### Web browsing

Use the `/browse` skill from gstack for **all** web browsing — opening pages,
reading them, clicking through flows, taking screenshots, checking console errors.

**Never** use the `mcp__claude-in-chrome__*` tools.

### Available skills

| Skill | Skill | Skill |
| --- | --- | --- |
| `/office-hours` | `/plan-ceo-review` | `/plan-eng-review` |
| `/plan-design-review` | `/design-consultation` | `/design-shotgun` |
| `/design-html` | `/review` | `/ship` |
| `/land-and-deploy` | `/canary` | `/benchmark` |
| `/browse` | `/connect-chrome` | `/qa` |
| `/qa-only` | `/design-review` | `/scrape` |
| `/setup-browser-cookies` | `/setup-deploy` | `/setup-gbrain` |
| `/retro` | `/investigate` | `/document-release` |
| `/document-generate` | `/codex` | `/cso` |
| `/autoplan` | `/plan-devex-review` | `/devex-review` |
| `/careful` | `/freeze` | `/guard` |
| `/unfreeze` | `/gstack-upgrade` | `/learn` |
