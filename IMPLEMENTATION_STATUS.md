# Implementation status

## Implemented foundation
Deterministic simulation clock and PRNG; snapshot/restore/checksum; semantic decision-engine abstraction; scripted/Open-Jev adapter foundation; primary/shadow comparison; temporal memory strategies; experience fingerprints and SQLite schema; counterfactual branching; reward/regret primitives; research orchestration; skills and curriculum; procedural world; runtime sensors/controller/safety; observable telemetry; Three.js and Inspector shells; immutable pilot registry; CI and replay/provenance checks.

## Deliberately external / adapter boundaries
TypeSafe Jev native API adapter requires the exact configured service API.
Dreamer training implementation remains an external process behind `WorldModel` / HTTP adapter.
Three.js is presentation only; it never owns authoritative physics.

## Required local verification
This generated repository must be verified on a Bun-equipped machine with `bun install`, `bun test`, and `bun run audit`. The artifact-generation environment did not execute Bun.
