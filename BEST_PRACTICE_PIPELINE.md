# Best-practice learning pipeline

R21 hardens the R20 XGBoost worker into a versioned learning pipeline.

A fixed feature schema prevents training/serving skew. Completed outcomes enter a bounded training buffer that preserves both successful and adverse examples. Training occurs in the XGBoost worker and produces an immutable candidate model. Candidate metadata records the feature schema and dataset identity.

Before promotion, the model operates in shadow mode. Recommendations are recorded but do not control the aircraft. Validation evidence is evaluated by the existing promotion gate. Only an externally accepted candidate becomes ACTIVE; the previous active model becomes RETIRED atomically.

The authoritative path remains: simulation truth -> sensors -> cognition -> candidate fusion -> Dreamer -> negative-memory veto -> SafetySupervisor -> deterministic controller. XGBoost is advisory and cannot bypass safety.
