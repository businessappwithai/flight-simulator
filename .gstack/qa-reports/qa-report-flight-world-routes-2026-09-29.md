# QA Report: Flight World — two-airport flights, offline packs, GeoTelemetry, 3D Tiles

| | |
|---|---|
| **Date** | 2026-09-29 |
| **Branch** | `claude/flight-world-r25-replay-watchdog-t02u23` |
| **Target** | `bun apps/simulator/serve.ts` on :3200 (simulator + `/control-room/`) |
| **Driver** | Playwright + Chromium/SwiftShader (~1–2 fps, so ×32 runs at about ×3 of real time) |
| **Data** | Terrarium via `terrain-relay.ts`; features off; a one-box 3D Tiles tileset from `scripts/make-test-tileset.ts` served with CORS |
| **Scripts** | `.gstack/qa-reports/scripts/route-qa.mjs`, `route-qa-2.mjs`, `tiles3d-qa.mjs` |
| **Screenshots** | `screenshots/route-0929/` |

## What was tested

| Flow | Result |
|---|---|
| Search "chennai" on the start card: VOMM (MAA) and VOTX listed; **To** disabled until a real departure is chosen | pass (`route-a-search.png`) |
| **From** VOMM, then search "arakkonam" → **To** VOAR: route chip "To VOAR runway 24 · INS Rajali… · 54 km", URL `airport=VOMM&to=VOAR`, route line and green destination beacon | pass (`route-a-ready.png`) |
| Autopilot at ×32: TAKEOFF → CLIMB → CRUISE → DESCENT → FINAL → FLARE → ROLLOUT, re-anchored twice (frames 1, 2), landed on VOAR 06/24, mission COMPLETE, no console errors | pass (`route-b-*.png`) |
| Arrival banner | failed first (ISSUE-004), fixed: "Arrived at VOAR · runway 06/24 · INS Rajali / Arakkonam Naval Air Station · 12 min 23 s" (`route-f-arrived.png`) |
| **Save route for offline**: 53 tiles in 2 s, "369 kept in this browser" | pass (`route-f-pack.png`) |
| Flight trace carries 77 `WORLD_STREAM` samples; loaded in the Control Room, the **World stream** card shows frame, physics tiles, missing tiles, holds, render queue, loads, cache, p50/p95 latency, destination readiness, manifest | pass (`route-g-control-room.png`) |
| `?tiles3d=<tileset.json>`: tileset and GLB requested; the 120 m magenta block stands on the ground on the runway 07 centreline 1.5 km out, where it was placed in ECEF | pass (`route-e-tiles3d.png`) |
| `?airport=ZZZZ` (ISSUE-003) | fixed: error shown, URL cleaned to `?quality=low&seed=1&scenario=default`, procedural airfield and scenery (`route-c-bad-airport.png`) |
| `?airport=VOMM&to=ZZZZ` | failed first (ISSUE-005), fixed: "unknown destination ZZZZ", departure VOMM kept, URL keeps `airport=VOMM` |
| Manual flight into the ground 5 km out (ISSUE-002) | fixed: "Flew into terrain" (`route-h-crash.png`) |

## Issues

- **ISSUE-002** (from the previous report) — crash banner now names the cause: "Crashed into a building", "Flew into
  terrain", "Crashed: touchdown too hard", "Crashed: wing struck the ground (too much bank)" (`GeoStatus.surface`).
- **ISSUE-003** (from the previous report) — a SET_WORLD the worker rejects (`ERROR.command`) resets the page to what
  the worker is actually flying; the worker now builds the new world before tearing down the old one.
- **ISSUE-004** — the generic "Landed on runway … throttle up to take off again" toast replaced the arrival banner.
  Fixed: no touchdown toast at the destination.
- **ISSUE-005** — an unknown destination also dropped a valid departure airport. Fixed: only the destination is
  cleared and the world is re-sent without it.

## Notes

- The minimap's north arrow and the instruments now use true north / MSL in the real world (they showed the local
  frame's heading and height above the runway before).
- Software rendering limits the sim rate to ~×3 in this container; real GPUs reach ×32.
