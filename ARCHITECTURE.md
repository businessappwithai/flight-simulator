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
