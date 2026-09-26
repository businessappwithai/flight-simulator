# QA Report: Flight World simulator — runway start, Jev key, browser learning

| Field | Value |
|-------|-------|
| **Date** | 2026-09-26 |
| **URL** | http://localhost:3200 (`bun apps/simulator/serve.ts`) |
| **Branch** | claude/gstack-qa-skill-test-gbr1um |
| **Feature commit** | a06f0b4 |
| **Tier** | Exhaustive |
| **Scope** | New runway start mode, Jev key panel (add/remove), autopilot gating, localStorage learning (persist, reload, clear & restart), manual and touch flight regression |
| **Driver** | Chromium with SwiftShader WebGL through Playwright (`scripts/jev-learning-qa.mjs`, the same launch as earlier QA runs here). gstack `$B` was used for orientation; at ~1 fps software rendering its clicks time out. |
| **Viewports** | 1280×720 desktop, 390×844 phone (touch), 820×1180 iPad portrait (touch) |
| **Screenshots** | `screenshots/jev/` (13) |

## Health Score: 97 → 100 (tested categories only)

| Category | Baseline | Final |
|----------|---------:|------:|
| Console | 100 | 100 |
| Visual | 92 | 100 |
| Functional | 100 | 100 |
| UX | 89 | 100 |
| Content | 100 | 100 |
| Accessibility | 100 | 100 |

Links and Performance were not scored: the app is a single page, and software WebGL makes frame-rate numbers meaningless here.

## Summary

| Severity | Count |
|----------|------:|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 1 |
| **Total** | **3** (all fixed and verified) |

QA script result: **48/48 checks pass** after the fixes (22/27 on the first run, before the script's own timing and selector mistakes were corrected).

## Issues

### ISSUE-001: Jev & learning panel covered four top-bar buttons — medium, visual — fixed `d1499de`

The panel sat at a fixed `top: 48px`, but the top bar wraps to two or three rows with the window width. At 1280×720 the panel covered **Autopilot, Jev & learning, Camera and Pause** (`01-first-visit` before the fix). The bar now publishes its measured bottom edge as `--top-h`, and the panel sits below it. Verified by an `elementFromPoint` check on every top-bar button at every viewport.

### ISSUE-002: Unreadable saved learning was reset silently; the loaded insight never showed — low, UX — fixed `260c540`, test `44ab497`

Saved learning that is not valid JSON was removed, but the warning toast was shown inside the store's constructor and immediately cleared by the first `restart()`. Moving the load after that restart then showed a second defect: a parked aircraft never steps, so the worker never published the learned insight. The worker now publishes after `LOAD_LEARNING`. Regression test `tests/learning-load.regression-1.test.ts` fails without the fix.

### ISSUE-003: On touch screens the yoke covered the runway Start card — medium, UX — fixed `13c77a6`

On a 390×844 phone the on-screen yoke sat on top of **Start (manual)**, so the tap timed out. The yoke now appears once the flight has started; while parked, Start offers the same action. Verified: Start is tappable on phone and iPad, then the yoke appears and flies the aircraft.

## Verified behaviour (48 checks)

- **Runway start:** the aircraft waits on runway 18 at tick 0 after load, reload, Restart, New scenario and Clear learning. The clock starts on **Start (manual)**, **Start on autopilot**, any flight key, or the touch yoke.
- **Autopilot gating:** without a key, Start on autopilot, the Autopilot button and the `A` key all leave the pilot MANUAL and parked, with the message "Add a Jev key to use the autopilot". `?pilot=autopilot` is ignored without a key and honoured with one; either way the aircraft waits on the runway.
- **Jev key:** typing in the key box never flies the aircraft or fires shortcuts. Keys with spaces, keys under 8 characters and blank keys are rejected with a message, and nothing is stored. A saved key shows masked (`••••3456`) with **Remove**, is kept in `localStorage["flightWorld.jevKey"]`, and survives a reload. Saving a key does not start the flight.
- **Removing the key mid-flight** switches the autopilot off, hands control back to the pilot, keeps the flight going, deletes the stored key, and pauses learning. Already-learned data is kept.
- **Learning:** an autopilot flight to landing records 1 flight, 1 landing and 15 experiences. It is saved to `localStorage["flightWorld.learning.v1"]` and restored after a reload, and the panel shows the best known action for the current situation ("autopilot takeoff · landed 100% of 1").
- **Clear learning & restart** needs a second click within 4 s, then wipes storage and the panel and puts the aircraft back on the runway. Corrupt or tampered saved data is rejected, removed, and reported.
- **Manual flight regression:** without a key, holding `W` starts the take-off roll and climbs above 10 m. The touch yoke flies the aircraft on phone and iPad. The panel closes.
- **Console:** no application errors (SwiftShader "GPU stall" driver warnings excluded).

## Not tested

- The key is not sent to any Jev service: this repository defines no TypeSafe Jev API (see LOCAL_RUN.md), so the key gates the autopilot and learning locally.
- Real GPU performance and frame rate.

> QA found 3 issues, fixed 3, health score 97 → 100.
