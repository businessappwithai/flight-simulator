# QA Report: Flight World on GitHub Pages — manual flight between two airports, by button clicks

| | |
|---|---|
| **Date** | 2026-09-29 |
| **Branch** | `claude/flight-world-r25-replay-watchdog-t02u23` |
| **Target** | The Pages build (`bun run simulator:build` + Control Room) served under `/flight-simulator/` exactly as Pages serves it. The deployed Pages host is blocked by this container's egress policy, so the same build was served locally. |
| **Driver** | Playwright + Chromium/SwiftShader on a touch viewport (1180×820, so the on-screen yoke shows), **no Jev key** (autopilot locked). Everything is clicked: airport search, From/To, **Start (manual)**, **+** for sim rate, and the pad's ▲ ▼ ◀ ▶ ■ held down and released like a thumb. |
| **Data** | Terrain: Mapzen Terrarium (AWS). Buildings/runways: OpenFreeMap is blocked here, so a PMTiles archive in the same OpenMapTiles schema was baked from Overture Maps along the route (`scripts/overture-extract.py` + `scripts/bake-features.ts`: 777,842 buildings, 277 z14 tiles, 9.8 MB) and passed with `&features=`. |
| **Scripts** | `scripts/manual-qa.mjs` (full flight), `scripts/sea-look-qa.mjs` (coast), `scripts/pad-descend-qa.mjs` (pad buttons) |
| **Screenshots** | `screenshots/manual-0929/` (`run3/`, `run4/`, `run6/` are flight attempts; `sea-01-coast-ahead.png`, `pad-descend.png`) |
| **Scope** | Manual flying only, by button clicks (as asked). The autopilot was not tested. |

## Health

| Category | Before | After |
|---|---|---|
| Console | 100 (no errors) | 100 |
| Functional (plan and fly a route by hand) | 70 | 85 |
| Visual (sea, land, mountains, buildings) | 35 | 90 |
| UX | 80 | 80 |
| **Overall** | **66** | **86** |

## What was tested

| Flow | Result |
|---|---|
| Start card: type "chennai", pick **From** VOMM; type "arakkonam", pick **To** VOAR → "To VOAR runway 24 · INS Rajali / Arakkonam Naval Air Station · 54 km"; route line and destination beacon drawn | pass (`run3/manual-01-search-from.png`, `run3/manual-02-route-planned.png`) |
| Autopilot without a Jev key: **Start on autopilot** locked, "The autopilot needs a Jev key. Manual flying always works." | pass |
| **Start (manual)**, hold ▲: take-off roll, lift-off, climb | pass |
| Buildings along the flight path (Chennai suburbs, 200–1,400 ft) | failed first (ISSUE-007, ISSUE-008), fixed (`run3/manual-04-buildings.png`, `run3/manual-05-cruise.png`) |
| Sea, fields and mountains visible and in colour | failed first (ISSUE-009, ISSUE-010), fixed (`sea-01-coast-ahead.png`: Bay of Bengal east of VOMM) |
| ◀ ▶ turn at a fixed bank and hold height; ▼ descends at −4.0 m/s (−790 fpm); releasing holds height (never below 30 m) | pass (`pad-descend-qa.mjs`) |
| Re-anchoring on the way (frames move under the aircraft every 25 km), terrain streaming, destination beacon and runway visible on final | pass (`run4/manual-06-final.png`, `run4/manual-07-short-final.png`) |
| Hand-flown approach and landing at VOAR 24 by holding pad buttons | **not landed** by the scripted pilot, see [Landing](#landing) |
| Console errors during every flight | none |

## Issues

- **ISSUE-007 (high, fixed): no buildings in the flight path above ~900 m AGL.** The LOD planner asked for feature tiles at
  the terrain ring's zoom (z12/z13 higher up), but vector sources only serve buildings and aeroways at z14, so those
  requests were dropped; buildings also stopped at 1,500 m AGL. Features are now always requested at z14, around the
  aircraft and ahead of it, up to 3,000 m AGL, plus the destination's runway tiles on approach. Fix `c2b1c30`, test
  `2d84f38` (`tests/geospatial.regression-1.test.ts`).
- **ISSUE-008 (high, fixed): one failed feature tile switched buildings off for the whole flight.** The runway survey
  loaded the tiles around the airport with `Promise.all`, so any single failure marked buildings and airport surfaces
  "unavailable". Tiles now load individually; the survey uses what arrived. Fix `7f2bb29`, test `12f7bd3`
  (`tests/geo-world.regression-2.test.ts`).
- **ISSUE-009 (high, fixed): the sea, fields and mountains were washed out.** Terrain and feature colours are sRGB bytes
  but were handed to three.js as linear, so every surface drifted towards pale grey and the sea was hard to tell from
  land. They are now converted to linear. Fix `900b4c0`, test `0e60d6e` (`tests/vertex-colors.regression-1.test.ts`).
- **ISSUE-011 (medium, fixed): one failed tile threw away the destination's surveyed runway.** The destination survey
  had the same `Promise.all` as ISSUE-008, so a flaky tile made the route aim at the catalogue's runway position. Fix
  `3e6cdd8`, test `2e4aa8f` (`tests/geo-world.regression-4.test.ts`).
- **ISSUE-010 (medium, fixed): white dotted lines across the ground.** Neighbouring terrain tiles (different zooms, or
  float32 rounding) never meet exactly, and the sky showed through the cracks. Each tile now hangs an outward-facing
  skirt below its edges. Fix `504ebf6`, test `a533f21` (`tests/geo-world.regression-3.test.ts`).

## Landing

Seven hand-flown attempts, every one by holding pad buttons (logs: `logs/manual-0929-run*.log`):

| Attempt | Over VOAR 24 threshold | Result |
|---|---|---|
| 3 (`run3/`) | 400 m high, on centreline | went around by accident, flew into terrain beyond |
| 4 (`run4/`) | touched down 136 m past the threshold, wings level, −4 m/s, **64 m left** of centreline | "Flew into terrain" (off the 47 m pavement) |
| 6 (`run6/`) | 19 m high, 57 m left, on the glide path all the way down | "Flew into terrain" (off the pavement) |
| 7 | on centreline (±15 m), 100 m high | overshot |

**Not landed.** Everything a landing depends on was checked separately and works: the pad flies what it says
(▼ −4.0 m/s, ◀ ▶ fixed bank holding height, ■ slows to ~31 m/s; `pad-descend-qa.mjs`), the HUD's distance and
bearing point at VOAR's surveyed threshold (3.6 m from the paved centreline, checked against the Overture runway
line), the approach and the runway are visible from 9 km out, and a wings-level touchdown at −4 m/s is under the
8 m/s limit. What failed is the scripted thumb-pilot: at 0–2 rendered frames per second each press lasts several
simulated seconds, and since turns hold height it could fly the centreline or the glide path, not both at once. A
person on a real GPU at ×1 gets feedback 60 times a second. Not claimed as passing until someone lands it by hand.

## Findings not fixed here

- **The route autopilot is hard-coded.** `routeTarget` + `steerTo` fly the route when the autopilot is on; that is
  the opposite of "the autopilot is only decisions, Jev and learning". Not touched in this pass (manual-only QA).
  Proposal: let the decision engine choose the intent from the route state (distance, bearing, glide path are
  already in the observation's world status), with the learning book scoring route intents the same way it scores
  landings; remove `steerTo` from the worker once the engine flies routes.
- **Lakes and rivers are not drawn.** Water comes only from the DEM (sea level), so the coast shows but reservoirs such
  as Chembarambakkam do not. OpenMapTiles has a `water` layer the reader could mesh like airport surfaces.
- **Search by old city names.** "bangalore" finds VOBG but not VOBL, which OurAirports lists under "Bengaluru"; the
  bundled catalogue drops OurAirports' `keywords` column, which carries such names.
- **HUD labels on a route flight.** The badge keeps "VOMM 07" and the chips "SCENARIO moving-obstacle-001" /
  "MISSION RETURN" on a real-world flight; they describe the procedural scenario, not the route.
- **Pages host and OpenFreeMap are blocked from this container** (egress policy), so neither was reached from here;
  both work in a normal browser. Buildings in this QA came from an Overture archive in the same schema.

## Notes

- Software rendering runs the view at 0–2 fps, and ×32 gives about ×2–10 real time. That is too coarse for fine
  button work on final, so the script slows the sim to ×4 for the approach (**−** three times), as a person would.
