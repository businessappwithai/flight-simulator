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
