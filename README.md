# flight-world

Deterministic TypeScript/Bun flight-world research simulator foundation.

Implemented foundation:
- fixed 120 Hz simulation clock
- serializable SplitMix64 PRNG
- deterministic game-flight aircraft model
- moving obstacle + checkpoint/return scenario
- scripted autopilot baseline
- immutable world snapshots
- event recorder and replayable control stream
- SHA-256 state checksums
- DecisionEngine plugin contract
- ScriptedDecisionEngine
- Open-Jev `/v1/systemone` adapter
- 256-entry temporal ring buffer
- headless benchmark CLI
- deterministic replay tests

Run:

```bash
bun install
bun test
bun run benchmark          # reference autopilot over 100 seed-varied scenarios
bun run simulator          # 3D simulator at http://localhost:3200 (bun apps/simulator/serve.ts)
bun run simulator:build    # static build in dist/simulator (host anywhere; worker ships as sim.worker.js)
bun run research           # R-series research CLI
```

## 3D simulator (apps/simulator)

A desktop-flight-sim style view of the deterministic simulation, built with React + React Three Fiber + Three.js;
the physics runs in a Web Worker and the page only renders `@flight/protocol` snapshots and sends pilot commands.
React/R3F/Three.js are confined to `apps/` — see *Presentation boundary* in ARCHITECTURE.md (enforced in CI).
Laid out for iPad and larger (portrait and landscape) with an on-screen yoke on touch devices; also usable on phones.

Control Room (React): `bun run control-room` → http://localhost:3100 — replay recorded JSONL telemetry, step or
play it, and inspect each decision in the "Why?" card.

- Scenery generated in code: atmospheric sky and sun, haze, patchwork farmland, forests, farms, a lake and river,
  hills and snow-capped mountains beyond the flying area (the physics ground is flat inside it, so nothing you see
  contradicts the collision model), clouds, and an airfield with a marked runway 18/36, taxiway, apron, hangars,
  tower, windsock and edge lights.
- Procedural high-wing aircraft whose ailerons, elevator, rudder and propeller follow the controls the simulation
  actually applied; nav, strobe and beacon lights. The obstacle is a hot-air balloon of the simulated radius;
  the checkpoint is an air-race gate that turns green once passed.
- Cameras: chase, cockpit (panel and windshield), free orbit (drag), tower. Six-pack instruments (airspeed,
  attitude, altimeter, turn coordinator, heading, vertical speed), a north-up moving map and a data readout.
- Pilots: the reference autopilot (takes off, flies the gate, pattern, glide path, lands) or manual intents from the
  keyboard or an on-screen pad on touch devices. Time acceleration ×0.5–×8, pause, restart, new seeded scenario.
- URL options: `?seed=7&scenario=seeded&pilot=manual&camera=cockpit&rate=2&quality=low&hud=0`. Invalid values
  fall back to defaults. Adaptive quality drops shadows, then resolution, when the frame rate stays low.
- Keys: `A` autopilot · `W/S/←/→/Q/E/Shift/X` manual · `C`,`1`–`4` cameras · `P`/Space pause · `+`/`-` rate ·
  `R` restart · `N` new scenario · `I` instruments · `H` help.

The simulation shown is the same deterministic simulation used for benchmarks: `tests/simulator-worker.test.ts`
checks that a mission flown through the worker ends with exactly the checksum of a direct headless run.

The AI layer never emits raw control surfaces. The deterministic controller owns low-level controls.

## Added in continuation

- shadow decision manager and provider comparison
- temporal strategies: none/previous/sequence/outcome-aware/shuffled
- experience repository contract + SQLite schema
- counterfactual snapshot branching
- world-model interface and no-op adapter
- immutable pilot/experiment manifests

## R3 research layer
Situation fingerprints, Bun SQLite experience persistence, provider×memory experiment matrix, entropy/calibration metrics, and failure clustering added.

## R4/R5 continuation
Added multi-horizon evaluation primitives, regret, counterfactual triggers, persistent experiment runs,
deterministic promotion policy, world-model JSONL dataset export, shadow prediction evaluation,
skill lifecycle gates, and deterministic scenario mutation primitives.

## R6 autonomous research orchestration
Added paired-seed research plans, candidate summaries/promotion decisions, failure-family extraction, deterministic scenario minimization, content-addressed artifacts, constrained research prioritization, and standard component ablations.

## R7 integrated runtime
Added sensors, semantic-intent controller, safety supervisor, CognitivePilot, integrated deterministic FlightRuntime, Three.js renderer skeleton, and Flight Inspector timeline model.

## R8 observable learning loop
Added runtime event bus, multi-horizon outcome tracker, requested/executed safety telemetry, provider disagreement scoring, Dreamer transition collector, JSONL telemetry recorder, inspector bridge, observable runtime, and browser inspector shell.

## R9 learning and world layer
Added selective experience consolidation, semantic-intent counterfactual replay, HTTP world-model adapter, skill sequence mining, deterministic procedural obstacle generation, and richer inspector evidence UI.

## R10 validation and curriculum
Added executable skill state machines, skill promotion validation, C0-C11 curriculum progression, world-model error/trust maps, automatic regression-suite construction, renderer synchronization boundary, and repository invariant audit.

## R11 hardening and rich-world search
Added deterministic terrain/weather/traffic/fictional-game-hazard generation, generic hill search for provider-disagreement/world-model-error/skill-boundary objectives, failure delta minimization, experiment-manifest CLI, dependency-boundary audit, and full verification command.
Run `bun run verify` on a Bun-equipped machine.

## R11 rich-world and adversarial research
Added deterministic terrain/weather/traffic/fictional game hazards, provider-disagreement/world-model-error/skill-boundary scenario objectives, ddmin failure reduction, research CLI manifests, benchmark reports, and immutable versioned pilot registry.

## R12 release hardening
Added decision-engine circuit-breaker/fallback, seed-level dataset splits, replay verification, experiment provenance, GitHub Actions CI, release checklist, implementation-status documentation, and final static architecture audits.

## R13 integration closure
Added explicit Jev/Open-Jev transport plugins, Zod scenario-boundary validation, local-run documentation, stronger CI typecheck/audits, and host-verification documentation.

## R14 composition and operations
Added validated top-level configuration, composition boot plans, evidence-gated world-model authority, skill provenance requirements, golden regression corpus, structured decision traces, and operations guidance.

## R15 browser runtime and inspector
Added worker-safe simulation messages, browser SimulationWorkerClient, simulation worker loop, replay timeline controls/model, benchmark comparison model, and a richer inspector shell.

## R16 consistency and runtime hardening
Added repository-wide static import/boundary validation, decision time budgets, telemetry JSONL round-tripping, canonical experiment hashing, runtime world invariants, and a combined verification command.

## R17 release candidate machinery
Added centralized release promotion gates, deterministic/shardable benchmark seed corpora, cryptographically-addressed release manifests, inspector state aggregation, and a one-command local release-check script.

## R18 evidence and performance closure
Added immutable promotion-evidence archives, deterministic benchmark run IDs, runtime subsystem performance budgets, portable Inspector bundles, and repository content-hash release snapshots.

## R19 quality-weighted experience forest
Replaced long-term chronological decision memory with a quality-weighted branching ExperienceForest while retaining the short DecisionQueue as working memory. Good decisions grow continuation subtrees; bad/catastrophic decisions are removed from candidate generation but retained as compact negative memory. Added a pluggable FastTreeIndex boundary and candidate fusion across provider, tree index and experience forest.

## R20 XGBoost background best-practice learner
Added `@wlearn/xgboost` 0.2.x as a dedicated Worker-based multiclass best-practice learner with outcome-sensitive sample weighting, model save/load/disposal, ranked semantic-action probabilities, and validation-gated promotion. Training never runs on the authoritative simulation thread.

## R21 hardened best-practice pipeline
Added a versioned fixed XGBoost feature schema, bounded balanced training reservoir, immutable candidate/active model registry, shadow evaluation, and atomic active-model retirement/promotion metadata. This prevents training-serving skew and keeps background learning outside the authoritative simulation path.

## R22 real-time explainability dashboard
Rebuilt the Inspector as a read-only Flight World Control Room with live decisions, requested-vs-executed actions, confidence and alternatives, temporal/experience evidence, provider disagreement, safety reasons, outcome horizons, aggregate safety/confidence metrics, raw evidence inspection, postMessage telemetry ingestion, pause/resume rendering, and telemetry health checks.

## R23 side-card control room
Moved decision explainability into a persistent right-side card. It follows the latest decision in real time, supports pinning historical decisions and resuming live follow, and keeps alternatives, evidence, safety intervention and outcomes visible alongside the main Three.js world. Detailed timeline/learning/safety/raw diagnostics now live below the world in tabs.

## R24 dashboard robustness and diagnostics
Hardened the live dashboard against the canonical DecisionFrame schema, added bounded telemetry retention and JSONL export, operational alerts for safety-override rate/confidence/provider disagreement, and portable diagnostic snapshots for replay and bug reports.

## R25 replay, watchdog and API audit
Added JSONL telemetry replay in the Control Room, step/play/pause replay controls, watchdog findings for missing outcome attribution and override storms, explanation-integrity checks, and a second static API audit for relative TypeScript imports.
