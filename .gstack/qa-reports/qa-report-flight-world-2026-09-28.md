# QA Report: Flight World — Real-world flights (Phase 1)

| | |
|---|---|
| **Date** | 2026-09-28 |
| **Branch** | `claude/flight-world-r25-replay-watchdog-t02u23` (PR #6) |
| **Scope** | `@flight/geospatial` wired into the simulator: anchoring to a real runway, real terrain for physics and rendering, airport markers, world picker |
| **Tooling** | Playwright + Chromium/SwiftShader (`scripts/geo-qa.mjs`), local Terrarium relay (`scripts/terrain-relay.ts`) fetching real Mapzen tiles from AWS |

## What was tested

`node .gstack/qa-reports/scripts/geo-qa.mjs` (dev server on :3200, relay on :3300) — **all checks pass**, no console errors:

| Check | Result |
|---|---|
| `?airport=VOMM&runway=07`: anchored, terrain ready, 40+ patches, aircraft at 12.99°N 80.17°E | pass |
| Runway elevation taken from the DEM (Chennai 14 m) | pass |
| Start card names the real runway; attribution visible | pass |
| Autopilot climbs over real terrain and lands at VOMM | pass |
| World picker → procedural airfield: geo off, terrain cleared, URL drops `airport` | pass |
| World picker → VNKT: Kathmandu valley elevation 1,318 m from the DEM (airport ≈ 1,338 m), URL keeps `airport` | pass |
| Autopilot mission lands at Kathmandu with the Himalayan foothills around the valley | pass |
| VABB on a 390×844 phone: no horizontal overflow | pass |

Determinism is covered by tests rather than the browser: `tests/simulator-worker.test.ts` flies the worker anchored at
VOMM 07 against a local tile server with 0 ms and with random 5–45 ms latency. Both give the same checksum, the
same tick and the same terrain manifest, equal to the procedural airfield's reference run (the airfield is flat).

## Found and fixed during QA

| Issue | Fix |
|---|---|
| Terrain faces were wound downwards (three.js x is mirrored) | Winding flipped; test asserts face normals point up |
| Attribution overlapped the position badge at 1280 px | Attribution moved to a single line at the bottom edge (full text in the tooltip) |
| On phones the position badge covered the start card's title | Badge hidden while parked on phones and compacted in flight |
| The world picker made the start card overlap the Jev panel on phones (Pages smoke test) | Intro sentence hidden on phones; smoke test 16/16 |
| A beacon stood on the airport being flown from | Beacons only for other airports |
| A hostile `terrain=` server could declare a huge PNG and exhaust worker memory | PNG decoder refuses images larger than 4096×4096 |

## Screenshots

`screenshots/geo/`: `geo-1-vomm-parked`, `geo-2-vomm-climb-orbit`, `geo-3-vomm-landed`, `geo-4a-vnkt-climb-chase`,
`geo-4-vnkt-orbit`, `geo-5-vnkt-cockpit`, `geo-6-vabb-phone`.

## Known limits (Phase 1)

- Airports come from a bundled 13-airport OurAirports-format sample (approximate positions; runway thresholds
  synthesized from heading and length). Loading the full OurAirports CSVs is a data change, not a code change.
- No buildings, roads, water polygons or airport surfaces yet (Phase 2/3: Overture/OSM PMTiles).
- Beyond the flat 3.2 km airfield, physics terrain is the z12 DEM (~38 m source pixels, 100 m grid).
