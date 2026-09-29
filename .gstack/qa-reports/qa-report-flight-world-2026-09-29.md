# QA Report: Flight World — gstack /qa (diff-aware, PR #7)

| | |
|---|---|
| **Date** | 2026-09-29 |
| **Branch** | `claude/flight-world-r25-replay-watchdog-t02u23` (PR #7: buildings, surveyed runways, landable airports) |
| **Mode / tier** | Diff-aware, Standard (fix critical, high, medium) |
| **Target** | `bun apps/simulator/serve.ts` on :3200 (simulator + `/control-room/`) |
| **Driver** | Playwright + Chromium/SwiftShader (gstack's own browser could not bootstrap in this container; CLAUDE.md "Browser QA") |
| **Data** | Terrarium via `terrain-relay.ts`; buildings/aeroways from Overture 2026-09-23.1 baked to PMTiles; default sources (AWS, OpenFreeMap) as a real user hits them — unreachable from this container's browser, which exercises the failure path |
| **Script** | `.gstack/qa-reports/scripts/qa-2026-09-29.mjs` |
| **Screenshots** | `screenshots/qa-0929/` |

## Health score: 98 → 99

| Category | Baseline | Final | Notes |
|---|---|---|---|
| Console | 100 | 100 | No errors except the intended messages for rejected URL parameters |
| Functional | 100 | 100 | Anchoring, runway switch, buildings, crash into buildings, fallback, procedural return all work |
| UX | 97 | 97 | ISSUE-003 (deferred) |
| Visual | 100 | 100 | Desktop and phone layouts clean; no overflow or overlap |
| Content | 89 | 97 | ISSUE-001 fixed; ISSUE-002 deferred |
| Links, Performance, Accessibility | not scored | not scored | SPA without links; software GPU (~1 fps); no accessibility audit run |

Score over tested weights (0.65). Provisional: Links, Performance and Accessibility untested.

## What was tested

| Flow | Result |
|---|---|
| Default page: start card, 14 airports in the picker, help mentions the real world | pass |
| Picker → VNKT with the default data sources (unreachable here): flight still starts over a flat world; badge says "flat (terrain unavailable)", "buildings unavailable" | pass (message was wrong: ISSUE-001, fixed) |
| VOMM 07 with relay terrain + baked features: surveyed runway 68.9°, 73k physics buildings, meshes shown | pass |
| Runway picker 07 → 25: re-anchored at 248.9°, URL updated, runways 12/30 offered | pass |
| Manual low pass to the Chennai buildings 5 km out, then descending into them: FAILED, "Crashed on landing or impact" | pass (copy: ISSUE-002) |
| Back to the procedural airfield after a real-world flight: geo off, terrain cleared, URL cleaned | pass |
| Bad URL options (`airport=ZZZZ`, `runway=99`, `features=javascript:…`, bad terrain template): clear error box, procedural airfield | pass (ISSUE-003) |
| Phone 390×844 anchored with buildings, parked and flying: no overflow, badge/pad/dock do not overlap | pass |
| Control Room loads, no console errors | pass |

## Issues

### ISSUE-001 — Terrain failure reported as "one tile treated as sea level" (Content, medium) — fixed, verified
- **Repro:** open `?airport=VNKT` where the terrain host is unreachable. Start card: "Terrain tile 12/3020/1720 unavailable; treated as sea level." while the whole world is flat. Evidence: `qa-b-vnkt-defaults.png`.
- **Cause:** after `prepare()` gave up, physics tiles that were still retrying treated the world as READY-but-missing-a-tile, overwrote the explanation and added sea-level tiles.
- **Fix:** `18391ab` (`packages/geospatial/src/geo-world.ts`): a tile failure before READY is rethrown and leaves the world-level explanation alone.
- **After:** "Real terrain unavailable (Failed to fetch); flying over a flat world." (`issue-001-after.png`).
- **Regression test:** `5ecb206` `tests/geo-world.regression-1.test.ts` (fails without the fix, passes with it).

### ISSUE-002 — Flying into a building says "Crashed on landing or impact" (Content, low) — deferred
Accurate but generic; in the real world it could name the cause (terrain or building). Evidence: `qa-e-crash.png`.

### ISSUE-003 — A rejected `?airport=` stays in the URL and switches the scenery to real-world mode (UX, low) — deferred
`?airport=ZZZZ` shows "Simulation: unknown airport ZZZZ" and the procedural runway, but the store keeps the airport, so the URL keeps `airport=ZZZZ` and the procedural hills are hidden (real-world scenery mode) with no real terrain.

## Summary
QA found 3 issues, fixed 1 (verified), deferred 2 low. Health score 98 → 99.
