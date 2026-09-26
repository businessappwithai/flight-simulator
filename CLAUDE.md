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
bun run simulator                     # 3D simulator, http://localhost:3200 (apps/simulator/serve.ts --port N)
bun run simulator:build               # static build → dist/simulator (page + sim.worker.js)
bun run control-room                  # decision replay dashboard, http://localhost:3100
bun run benchmark                     # reference autopilot over seed-varied scenarios
```

CI (`.github/workflows/ci.yml`) runs `bun install`, `typecheck`, `bun test`, `audit`, `audit:deps`.

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
- **Low-confidence fallback.** `CognitivePilot` (packages/cognition) asks the primary engine and the XGBoost
  best-practice advisor in parallel. If the engine's top candidate is below `minProviderConfidence` (default 0.5,
  also `decision.minProviderConfidence` in `@flight/config`) and the model answered, the model's top-ranked intent
  decides; the frame's `provider` is then the model's source and `evidence.selection` records why.
- **Presentation boundary (enforced by `bun run audit:deps`, tested in `tests/dependency-boundary.test.ts`).**
  `packages/*` may not import React, R3F, Three.js or `apps/`. UI code in `apps/simulator` and
  `apps/control-room` may import only `@flight/protocol`. Only `*.worker.ts` files may use the core packages.
  So new simulator behaviour that needs core logic goes in a package, runs in `apps/simulator/src/sim.worker.ts`,
  and reaches the page as a `SimCommand`/`SimEvent` added to `packages/protocol/src/worker.ts`.
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
- URL options (also used by QA): `?seed=7&scenario=seeded&pilot=manual&camera=cockpit&rate=2&quality=low&hud=0`.
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
