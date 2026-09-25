# Flight World Control Room

The inspector is a live explainability dashboard, not merely a telemetry viewer. Runtime events can arrive through `flightInspector.showEvent(event)` or browser `postMessage({type:"FLIGHT_RUNTIME_EVENT",event})`.

For every decision it shows requested and executed action, confidence, top alternatives, provider/model, temporal patterns, retrieved experience count, provider disagreement, safety intervention reason, and immediate/+1s/+3s outcomes as they arrive.

Top-level health metrics show total decisions, safety overrides and override rate, mean provider confidence, and elevated provider disagreements. Decision rows visibly flag uncertainty and safety intervention. Clicking any decision reconstructs a concise "why" narrative from recorded evidence rather than inventing an explanation.

The dashboard is deliberately read-only. It cannot alter physics, safety, active models, learned experience, or promotion gates.

## Decision evidence (R25+)

Every `DecisionFrame` emitted by the runtime carries `evidence` (see `DecisionEvidence` in `@flight/protocol`):
provider model, all ranked alternatives, temporal strategy and patterns, situation fingerprint, retrieved
experience records, each shadow provider's top choice or error, provider disagreement and, when configured,
advisor results (`bestPractice` = XGBoost outcome model, `worldModel` = Dreamer). Advisors run in parallel
with a timeout, never choose the intent, and record `ERROR`/`TIMEOUT` instead of disappearing. An advisor
that is not configured is omitted and the Why panel says "not configured"; nothing is inferred.

Measured outcomes are attached back to the pilot's memory (feeding outcome-aware temporal strategies) and,
at the 3 s horizon, stored in the experience repository so later similar situations retrieve them.
