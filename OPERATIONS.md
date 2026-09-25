# Operations

## Immutable inputs
Pin simulator, controller, safety, reward, provider/model, world-model dataset/model, pilot manifest, and scenario seeds for every release experiment.

## Authority progression
Decision providers may run primary or shadow. Dreamer begins in SHADOW. `allowedAuthority` requires evidence before ADVISORY/ACTIVE. Skill candidates progress through offline/counterfactual/shadow gates before ACTIVE.

## Failure handling
Provider timeout/failure falls back through `ResilientDecisionEngine`. Safety remains downstream of cognition. Simulator truth is never supplied by a learned model.

## Reproducibility
Every research result should include provenance, pilot ID, scenario ID/seed and checksums. Promote minimized failures into `GoldenCorpus`/regression suites.
