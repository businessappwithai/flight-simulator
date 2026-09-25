# Flight World Control Room

The inspector is a live explainability dashboard, not merely a telemetry viewer. Runtime events can arrive through `flightInspector.showEvent(event)` or browser `postMessage({type:"FLIGHT_RUNTIME_EVENT",event})`.

For every decision it shows requested and executed action, confidence, top alternatives, provider/model, temporal patterns, retrieved experience count, provider disagreement, safety intervention reason, and immediate/+1s/+3s outcomes as they arrive.

Top-level health metrics show total decisions, safety overrides and override rate, mean provider confidence, and elevated provider disagreements. Decision rows visibly flag uncertainty and safety intervention. Clicking any decision reconstructs a concise "why" narrative from recorded evidence rather than inventing an explanation.

The dashboard is deliberately read-only. It cannot alter physics, safety, active models, learned experience, or promotion gates.
