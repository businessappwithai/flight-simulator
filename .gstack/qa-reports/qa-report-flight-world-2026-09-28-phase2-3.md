# QA Report: Flight World — Buildings and landable airports (Phases 2 and 3)

| | |
|---|---|
| **Date** | 2026-09-28 |
| **Branch** | `claude/flight-world-r25-replay-watchdog-t02u23` |
| **Scope** | Real buildings (physics and rendering), surveyed runways, landable real runways, airport surfaces, PMTiles / vector-tile pipeline |
| **Data** | Overture Maps 2026-09-23.1 GeoParquet (S3) → `scripts/overture-extract.py` → `scripts/bake-features.ts` → PMTiles served by `terrain-relay.ts --features-dir` |

## Data access in this environment

The egress policy of the QA container blocks `tiles.openfreemap.org` and Overture's PMTiles hosts, so the default
source (OpenFreeMap, which end users' browsers reach directly) could not be exercised here. Real data was taken from
Overture's GeoParquet release on S3 (reachable) and baked into the same OpenMapTiles schema the app reads, so every
code path after the HTTP request is the one used in production.

| Area | Extract | Baked archive |
|---|---|---|
| Chennai (VOMM), 10 × 9 km | 167,345 buildings in 56 s; runways 07/25 and 12/30, taxiways, aprons | 25 z14 tiles, 2.1 MB |
| Kathmandu (VNKT), 10 × 9 km | 250,619 features | 3.6 MB |

## Correctness checks against reference implementations

- PMTiles: 20,000 random `zxyToTileId` values equal the official `pmtiles` package; the official reader decodes
  archives written here (with and without leaf directories) tile for tile.
- MVT: tiles encoded here decode identically with `@mapbox/vector-tile` (properties incl. 64-bit and negative
  integers, polygon holes, lines beyond the tile edge, points).
- Surveyed runways vs published lengths: VOMM 07/25 = 3,658 m (12,001 ft published), 12/30 = 2,887 m (9,482 ft).
  The synthesized 12/30 threshold had been ~1.2 km off; surveyed headings 68.9° / 117.8° replace 72° / 121°.
  VNKT 02 surveyed at 21.95° (sample file said 16°).

## Browser QA (`scripts/geo-features-qa.mjs`)

| Check | Result |
|---|---|
| VOMM 07 anchored on the surveyed runway (68.92°) | pass |
| Physics buildings loaded around the aircraft (73,013 at start, 100,547 in flight) | pass |
| Building and airport meshes streamed | pass |
| Badge reports buildings and "surveyed runway" | pass |
| Autopilot mission lands at VOMM among real buildings | pass |
| `features=off`: terrain only, no buildings | pass |
| Kathmandu: 121,220 buildings, surveyed runway 02 | pass |
| No console errors | pass |

Screenshots: `screenshots/features/`.

## Tests

`tests/geo-features.test.ts` (11) and a worker test in `tests/simulator-worker.test.ts`: codec and archive
round-trips, OpenMapTiles parsing and default heights, triangulation and point-in-polygon, surveyed anchor from the
real VOMM centreline, building crash vs landing on a far real runway vs crash on open ground, identical checksums and
feature manifests under jittery tile latency, unreachable source fallback, mesh output, and the real worker flying the
anchored mission with a surveyed runway and streamed features (checksum equal to the procedural run).

## Found and fixed during this work

| Issue | Fix |
|---|---|
| Ring area had the wrong sign for MVT's surveyor's formula (real exteriors would read as holes) | Spec formula; codec cross-checked |
| Ear clipping picked the wrong orientation (concave footprints over-filled) | Signed shoelace area; test on an L-shaped footprint |
| Feature meshes never flushed when only a features listener was set | Flush when either listener exists |

## Known limits

- OpenFreeMap (default source) is untested from this container (blocked by egress policy); the parser follows the
  OpenMapTiles schema used by OpenFreeMap (`building.render_height`, `aeroway.class/ref`).
- Buildings without height data get 1–4 storeys, fixed per building id; roofs are flat and courtyards are roofed.
- No real buildings inside the flat 3.2 km airfield, so physics and visuals stay consistent with the procedural field.
