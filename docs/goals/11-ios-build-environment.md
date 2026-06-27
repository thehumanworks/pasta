---
goal_id: "pasta-11-ios-build-environment"
title: "Native iOS Build Environment"
status: "active"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: Native iOS Build Environment

## 1. Invariants · the rules that must not break

This file is the only state for this delivery subgoal — if it isn't written here,
it didn't happen. The full procedure lives in the **goal-driven-development**
skill; these rules hold even if that skill isn't loaded:

- **Scope is frozen after user confirms DoD + Tasks.** Until then, §3 and §5 may
  be edited freely. After confirm, the only permitted edits are: tick checkboxes,
  update Confidence, append Evidence, append to live sections (§6/§7/§8), and
  update frontmatter `status`/`updated`.
- **Never tick below the floor.** A task is ticked done only at Confidence ≥
  `confidence_floor`.
- **Scope change is an exit, not a decision.** If scope must change, record the
  proposal in §6 and fire `SCOPE-CHANGE`.
- **Live sections are append-only.** Log each decision (§6) and learning (§7) at
  the moment it happens.

---

## 2. References

- User request — define goals and set up the environment to build native iOS in
  full from the documented UX.
- `docs-site/content/native-ios.md` — human and agent iOS UX contract.
- `docs/adrs/0001-native-ios-keyboard-centered.md` — accepted iOS architecture
  decision.
- `AGENTS.md` — central-service, encryption, GDD, toolchain, and delivery rules.
- `GOAL.md` — root goal order and fresh-session handoff.
- `docs/ORCHESTRATION.md` — execution loop and active-goal pointer.
- `ios/Package.swift` — native SwiftPM workspace seed.

---

## 3. Definition of Done · INVARIANT

Each item is atomic, tagged with a stable id that Tasks reference via
**Closes:**, and carries a concrete `verify by:`.

- [ ] **DoD-1** — A buildable native iOS Swift workspace seed exists under
  `ios/` with a shared `PastaCore` package and tests. — *verify by:*
  `swift build --package-path ios && swift test --package-path ios`
- [ ] **DoD-2** — The future bundle target plan is documented for app, keyboard
  extension, share extension, App Intents, App Group, Keychain access group, and
  optional File Provider. — *verify by:* review `ios/README.md` and this goal.
- [ ] **DoD-3** — Native iOS goals 11-17 are present, dependency ordered,
  validator-clean, and referenced from root handoff docs. — *verify by:*
  `python3 "$HOME/.agents/skills/goal-driven-development/scripts/gdd_status.py" --author docs/goals/11-ios-build-environment.md` plus the same command for goals 12-17.
- [ ] **DoD-4** — The keyboard-centered architecture decision is recorded as a
  durable ADR with alternatives and footguns. — *verify by:* review
  `docs/adrs/0001-native-ios-keyboard-centered.md`.
- [ ] **DoD-5** — Local Apple toolchain availability and the Xcode Cloud build
  authority rule are recorded before app or extension target implementation
  starts. — *verify by:* rerun and record `swift --version`,
  `xcodebuild -version`, `xcrun simctl list runtimes`, and review
  `ios/README.md`.

---

## 4. Exit Conditions

- **`DONE`** — iOS workspace scaffold, root handoff, ADR, and goal stack are
  verified and ready for implementation scope confirmation. *(primary)*
- **`BLOCKED-DEP`** — Swift tooling is missing, cannot build a minimal package
  after one direct repair attempt, or future Xcode Cloud configuration cannot be
  located when app/extension targets begin.
- **`SCOPE-CHANGE`** — setup requires introducing a new package manager, changing
  the central-service protocol, or committing developer-account secrets.
- **`CONFIDENCE-STALL`** — a task cannot reach 90 confidence after two honest
  attempts.
- **`BUDGET`** — one setup pass plus one verification-fix loop is exhausted.

---

## 5. Tasks · INVARIANT

Ordered, dependency-aware units of work that together satisfy the DoD. Tick the
trailing `[ ]` only when the Verification Contract passes and Confidence ≥ floor.

---

### T1 · Confirm Native Toolchain And Surfaces · [ ]

**Steps**
- [ ] Check Swift, Xcode, and iOS simulator runtimes.
- [ ] Record that local Xcode is non-authoritative for app/extension builds
  because the host is macOS 27 beta 2.
- [ ] Confirm no existing native iOS workspace is being overwritten.
- [ ] Reconcile the documented UX surfaces with the future target plan.

**Verification Contract**
- *Check:* Local toolchain and target surfaces are known before implementation.
- *Method:* `swift --version && xcodebuild -version && xcrun simctl list runtimes`
- *Expected:* Commands exit 0 for local discovery; `ios/README.md` states that
  Xcode Cloud is authoritative for app/extension build, test, archive, and
  release proof.

**Confidence:** 0 / 90 · **Depends on:** none · **Closes:** DoD-2, DoD-5

**Evidence (required before tick; append-only)**

---

### T2 · Scaffold Shared Swift Package · [ ]

**Steps**
- [ ] Add `ios/Package.swift`.
- [ ] Add a minimal `PastaCore` target for shared constants and surface modeling.
- [ ] Add tests proving text clips are insertable and binary/directory clips use
  handoff.

**Verification Contract**
- *Check:* The iOS core scaffold builds and tests locally.
- *Method:* `swift build --package-path ios && swift test --package-path ios`
- *Expected:* Both commands exit 0.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-1

**Evidence (required before tick; append-only)**

---

### T3 · Author Native iOS Goal Stack · [ ]

**Steps**
- [ ] Add goals 11-17 for environment, Swift core, app shell, keyboard, publish
  surfaces, binary handoff, and integration readiness.
- [ ] Update `GOAL.md` and `docs/ORCHESTRATION.md` so a fresh agent starts at the
  native iOS expansion.
- [ ] Keep downstream goals blocked until prerequisite goals provide evidence.

**Verification Contract**
- *Check:* All new goal docs pass author validation.
- *Method:* run `gdd_status.py --author` on goals 11-17.
- *Expected:* No author issues that would block user scope confirmation.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-3

**Evidence (required before tick; append-only)**

---

### T4 · Record Durable Architecture Decision · [ ]

**Steps**
- [ ] Add an ADR for the keyboard-centered iOS UX.
- [ ] List the rejected alternatives and Apple constraint footguns.
- [ ] Cross-link the ADR from setup documentation.

**Verification Contract**
- *Check:* Future agents have a durable architecture decision outside transient
  chat context.
- *Method:* review `docs/adrs/0001-native-ios-keyboard-centered.md` and
  `ios/README.md`.
- *Expected:* The ADR names the chosen UX, consequences, and alternatives.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-4

**Evidence (required before tick; append-only)**

---

### T5 · Verify Setup Slice · [ ]

**Steps**
- [ ] Run Swift build and tests.
- [ ] Run GDD validation for the new goal stack.
- [ ] Run diff hygiene before committing.

**Verification Contract**
- *Check:* Setup is buildable, author-valid, and clean.
- *Method:* `swift test --package-path ios && git diff --check`
- *Expected:* Commands exit 0; GDD status reports a valid active Goal 11 and
  blocked downstream goals.

**Confidence:** 0 / 90 · **Depends on:** T2, T3, T4 · **Closes:** DoD-1, DoD-3

**Evidence (required before tick; append-only)**

## 6. Decisions · LIVE (append-only)

- 2026-06-27 - Native iOS implementation starts with a SwiftPM shared core
  package before an Xcode app workspace. This keeps protocol/crypto tests
  runnable locally while leaving app and extension targets to the app-shell and
  keyboard goals. Scope impact: none.
- 2026-06-27 - Self adversarial review found the main risk was letting
  environment setup imply that iOS feature scope is already frozen. Tasks remain
  unchecked and evidence-free until the user confirms DoD + Tasks for execution.
  Scope impact: none.
- 2026-06-27 - User clarified the development host is macOS 27 beta 2, so local
  Xcode app/extension builds are not authoritative. Future app, extension,
  archive, and release proof must come from Xcode Cloud; local SwiftPM remains
  acceptable for shared core tests. Scope impact: none.

---

## 7. Learnings · LIVE (append-only)

*(none yet)*

---

## 8. Skills · LIVE (append-only)

*(none yet)*
