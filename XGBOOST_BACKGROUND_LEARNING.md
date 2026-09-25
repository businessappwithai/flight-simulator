# XGBoost background best-practice learning

`@wlearn/xgboost` runs only inside `xgboost.worker.ts`; authoritative simulation never waits for training.

Training rows contain numeric situation features, executed semantic action, reward, regret, success, safety override and catastrophic outcome. Sample weights deliberately emphasize failures, safety overrides and catastrophic outcomes so the model learns strong negative boundaries as well as successful practice.

The worker trains `multi:softprob`, persists the resulting WLRN bundle, explicitly disposes superseded WASM models, and returns ranked semantic action probabilities. The model is an advisory candidate source; ExperienceForest negative memory, Dreamer evaluation, SafetySupervisor and deterministic controller remain downstream.

A newly trained model is a candidate. It cannot self-promote. Promotion requires at least 1,000 validation examples, no hard regressions, accuracy at least equal to the baseline, and zero catastrophic false positives.
