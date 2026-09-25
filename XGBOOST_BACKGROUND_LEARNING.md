# XGBoost background best-practice learning

`@wlearn/xgboost` runs only inside `xgboost.worker.ts`; authoritative simulation never waits for training.

The model is an **outcome model**: it estimates P(good outcome | situation, action). Each training row is the numeric situation features plus a one-hot of the executed action; the label is 1 only when the action succeeded without a safety override or catastrophe. Failures therefore keep their action with label 0, so they teach the model what to avoid instead of being imitated.

Sample weights (`trainingWeight`) deliberately emphasize failures, safety overrides and catastrophic outcomes so the model learns strong negative boundaries. They are applied with `DMatrix.setWeight` (the high-level `XGBModel.fit` in `@wlearn/xgboost` 0.2 silently ignores weights, so the worker drives `Booster` directly).

The worker trains `binary:logistic`, serializes requests (a prediction can never see a half-trained model), persists UBJ bytes (`xgb-ubj-outcome-v1`), explicitly disposes superseded WASM boosters, and at inference scores every action for the same situation and returns them ranked by P(good outcome). `XGBoostBestPracticeClient` is promise-based; every call settles on reply, worker error, timeout, crash or dispose. Covered by `tests/best-practice-outcome.test.ts` against the real WASM. The model is an advisory candidate source; ExperienceForest negative memory, Dreamer evaluation, SafetySupervisor and deterministic controller remain downstream.

A newly trained model is a candidate. It cannot self-promote. Promotion requires at least 1,000 validation examples, no hard regressions, accuracy at least equal to the baseline, and zero catastrophic false positives.
