---
goal_id: "pasta-17-ios-integration-release-readiness"
title: "Native iOS Integration And Release Readiness"
status: "blocked"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: Native iOS Integration And Release Readiness

## 1. Invariants · the rules that must not break

This file is the only state for this delivery subgoal — if it isn't written here,
it didn't happen. Scope freezes only after user confirmation of §3 and §5.
Tasks and DoD are ticked only with evidence and Confidence ≥ `confidence_floor`.
Scope changes stop execution and surface to the user.

---

## 2. References

- `docs/goals/11-ios-build-environment.md` through
  `docs/goals/16-ios-binary-file-provider-handoff.md` — prerequisite native iOS
  delivery goals.
- `docs-site/content/native-ios.md` — iOS human and agent contract.
- `docs/threat-model.md` — privacy, metadata, and device trust boundaries.
- `AGENTS.md` — deploy, verification, and delivery rules.
- App Store Review keyboard extension rules linked from
  `docs-site/content/native-ios.md`.

---

## 3. Definition of Done · INVARIANT

- [ ] **DoD-1** — iOS and desktop can pair, publish, history-sync, and paste text
  end to end against the real Pasta relay without server-side plaintext. — *verify
  by:* remote smoke with redacted logs.
- [ ] **DoD-2** — Keyboard, app, share extension, App Intents, and binary handoff
  flows are proven on simulator and at least one physical iPhone when available.
  — *verify by:* recorded manual/device matrix.
- [ ] **DoD-3** — Tests cover Swift core, app services, extension services,
  TypeScript compatibility, and any backend compatibility changes. — *verify by:*
  `swift test --package-path ios` and `mise exec -- bun test`.
- [ ] **DoD-4** — App Review/privacy copy accurately explains keyboard Full
  Access, pasteboard use, encrypted sync, metadata, and unsupported contexts.
  — *verify by:* docs/app metadata review.
- [ ] **DoD-5** — Release path is documented and, if credentials are available,
  internal TestFlight or equivalent distribution proof exists. — *verify by:*
  archive/export/TestFlight evidence or an explicit credential blocker.

---

## 4. Exit Conditions

- **`DONE`** — native iOS is integrated, verified, documented, and ready for
  internal distribution or explicit external-signing handoff. *(primary)*
- **`BLOCKED-DEP`** — any prerequisite iOS goal is incomplete, or Apple Developer
  credentials/devices are unavailable for required release proof.
- **`SCOPE-CHANGE`** — release readiness requires changing Pasta's privacy,
  transport, or encryption contract.
- **`CONFIDENCE-STALL`** — a task cannot reach 90 confidence after two attempts.
- **`BUDGET`** — one integration pass plus one verification-fix loop is exhausted.

---

## 5. Tasks · INVARIANT

### T1 · Run End-To-End Text Sync Matrix · [ ]

**Steps**
- [ ] Pair iOS with an existing trusted desktop.
- [ ] Publish text from desktop and insert it from the iOS keyboard.
- [ ] Publish text from iOS and paste it on desktop.

**Verification Contract**
- *Check:* Core cross-device text workflow works against the real relay.
- *Method:* remote smoke with redacted evidence.
- *Expected:* Both directions work; server-visible data remains encrypted.

**Confidence:** 0 / 90 · **Depends on:** Goals 11-16 · **Closes:** DoD-1

**Evidence (required before tick; append-only)**

---

### T2 · Run iOS Surface Matrix · [ ]

**Steps**
- [ ] Verify app onboarding/history/settings.
- [ ] Verify keyboard standard access and Full Access modes.
- [ ] Verify Share extension, App Intents, and binary handoff.
- [ ] Include physical-device proof when available.

**Verification Contract**
- *Check:* All native iOS surfaces work outside unit tests.
- *Method:* simulator and physical-device matrix.
- *Expected:* Each surface has pass/fail evidence and known limitations.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-2

**Evidence (required before tick; append-only)**

---

### T3 · Run Full Test And Compatibility Suite · [ ]

**Steps**
- [ ] Run Swift package/app tests.
- [ ] Run TypeScript/Bun tests.
- [ ] Run any backend smoke needed for compatibility.

**Verification Contract**
- *Check:* Native iOS did not regress existing Pasta behavior.
- *Method:* `swift test --package-path ios && mise exec -- bun test`
- *Expected:* Suites pass and execute relevant tests; zero-test success is not
  accepted.

**Confidence:** 0 / 90 · **Depends on:** T2 · **Closes:** DoD-3

**Evidence (required before tick; append-only)**

---

### T4 · Prepare App Review And Privacy Copy · [ ]

**Steps**
- [ ] Document Full Access purpose and non-Full-Access behavior.
- [ ] Document explicit pasteboard use and no background monitoring.
- [ ] Document unsupported secure fields/phone pads/app opt-outs.
- [ ] Update public docs if product copy changed during implementation.

**Verification Contract**
- *Check:* Review and user-facing copy match shipped behavior.
- *Method:* docs/app metadata review.
- *Expected:* Copy is precise and does not promise unsupported behavior.

**Confidence:** 0 / 90 · **Depends on:** T2 · **Closes:** DoD-4

**Evidence (required before tick; append-only)**

---

### T5 · Prove Or Block Release Distribution · [ ]

**Steps**
- [ ] Archive/export the iOS app if signing credentials are available.
- [ ] Upload to internal TestFlight or document the exact missing credential.
- [ ] Record release evidence separately from local build/test evidence.

**Verification Contract**
- *Check:* Distribution path is either proven or explicitly blocked.
- *Method:* Xcode archive/export/TestFlight proof or credential blocker note.
- *Expected:* Internal distribution is available, or the blocker is concrete and
  actionable.

**Confidence:** 0 / 90 · **Depends on:** T3, T4 · **Closes:** DoD-5

**Evidence (required before tick; append-only)**

## 6. Decisions · LIVE (append-only)

- 2026-06-27 - Release readiness is a separate goal because simulator build
  success, physical-device extension behavior, remote relay proof, and
  TestFlight distribution are different proof layers. Scope impact: none.
- 2026-06-27 - Self adversarial review found the main risk is claiming iOS done
  from unit tests. This goal requires simulator/device and real-relay proof before
  completion. Scope impact: none.

---

## 7. Learnings · LIVE (append-only)

*(none yet)*

---

## 8. Skills · LIVE (append-only)

*(none yet)*
