---
goal_id: "pasta-13-ios-app-shell-pairing-history"
title: "Native iOS App Shell Pairing And History"
status: "blocked"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: Native iOS App Shell Pairing And History

## 1. Invariants · the rules that must not break

This file is the only state for this delivery subgoal — if it isn't written here,
it didn't happen. Scope freezes only after user confirmation of §3 and §5.
Tasks and DoD are ticked only with evidence and Confidence ≥ `confidence_floor`.
Scope changes stop execution and surface to the user.

---

## 2. References

- `docs/goals/12-ios-shared-core.md` — prerequisite Swift protocol, crypto, and
  storage layer.
- `docs-site/content/native-ios.md` — containing app responsibilities.
- `docs/protocol.md` — pairing, auth, history, and file endpoint contracts.
- `docs/threat-model.md` — trusted-device and reset model.
- `src/cli.ts` — desktop command semantics to mirror where relevant.

---

## 3. Definition of Done · INVARIANT

- [ ] **DoD-1** — A native Pasta app target builds and runs on iOS Simulator with
  the shared Swift core linked. — *verify by:* Xcode build/run command and
  simulator launch proof.
- [ ] **DoD-2** — The app can pair or join an existing Pasta space as a normal
  trusted device without exposing raw group keys. — *verify by:* simulator or
  device pairing smoke against the existing Worker API or a local test server.
- [ ] **DoD-3** — The app lists decrypted history locally, supports search/filter,
  and presents text, image, file, and directory clips according to metadata
  restrictions. — *verify by:* UI test or simulator proof with seeded clips.
- [ ] **DoD-4** — The app implements explicit clipboard import/export using
  user-intent surfaces and never background-monitors the pasteboard. — *verify
  by:* code review plus simulator proof.
- [ ] **DoD-5** — The app writes cached text history and non-secret state to the
  App Group for the keyboard while keeping secrets in Keychain. — *verify by:*
  unit tests and simulator inspection.

---

## 4. Exit Conditions

- **`DONE`** — the containing app can onboard, pair, browse history, and feed
  safe cached text history to extensions. *(primary)*
- **`BLOCKED-DEP`** — Goal 12 is incomplete or Apple signing entitlements cannot
  be configured locally without developer-account input.
- **`SCOPE-CHANGE`** — app shell work requires backend route changes, new auth,
  secret recovery, or background pasteboard monitoring.
- **`CONFIDENCE-STALL`** — a task cannot reach 90 confidence after two attempts.
- **`BUDGET`** — one implementation pass plus one verification-fix loop is
  exhausted.

---

## 5. Tasks · INVARIANT

### T1 · Create Native App Target And Entitlements · [ ]

**Steps**
- [ ] Add an Xcode workspace/project or generator accepted by the repo.
- [ ] Add the app target, bundle id, App Group, and Keychain access group.
- [ ] Link `PastaCore`.

**Verification Contract**
- *Check:* The app target builds and launches.
- *Method:* XcodeBuildMCP or `xcodebuild` simulator build/run command.
- *Expected:* Simulator launches Pasta without signing, entitlement, or runtime
  crashes.

**Confidence:** 0 / 90 · **Depends on:** Goal 12 · **Closes:** DoD-1

**Evidence (required before tick; append-only)**

---

### T2 · Implement Pairing And Device Trust UI · [ ]

**Steps**
- [ ] Implement first-device bootstrap or join flow appropriate for iOS.
- [ ] Show pairing QR/code and approval state without exposing durable secrets.
- [ ] Store device auth and keys through the Swift core storage layer.

**Verification Contract**
- *Check:* iPhone/simulator can become a trusted Pasta device.
- *Method:* pairing smoke with two clean profiles against local or remote Worker.
- *Expected:* New iOS device can fetch encrypted history after approval.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-2

**Evidence (required before tick; append-only)**

---

### T3 · Build History Browser And Search · [ ]

**Steps**
- [ ] Fetch history with signed requests.
- [ ] Decrypt clips locally and render previews without persistent plaintext.
- [ ] Gate insertability by payload kind and directory MIME.

**Verification Contract**
- *Check:* App displays realistic history without leaking metadata.
- *Method:* UI test or simulator proof with seeded text, image, file, and
  directory clips.
- *Expected:* Text is readable; binary clips use preview/handoff actions.

**Confidence:** 0 / 90 · **Depends on:** T2 · **Closes:** DoD-3

**Evidence (required before tick; append-only)**

---

### T4 · Add Explicit Clipboard Import And Export · [ ]

**Steps**
- [ ] Add user-tapped import from iPhone clipboard.
- [ ] Add copy latest text or selected clip to iPhone clipboard.
- [ ] Keep pasteboard access out of background lifecycle events.

**Verification Contract**
- *Check:* Pasteboard access happens only after user intent.
- *Method:* code review plus simulator proof.
- *Expected:* No background monitor, timer, or lifecycle hook reads
  `UIPasteboard.general`.

**Confidence:** 0 / 90 · **Depends on:** T3 · **Closes:** DoD-4

**Evidence (required before tick; append-only)**

---

### T5 · Populate Extension Cache · [ ]

**Steps**
- [ ] Write cached text history to App Group storage.
- [ ] Include enough metadata for keyboard display and insertability decisions.
- [ ] Exclude secrets and plaintext binary payloads.

**Verification Contract**
- *Check:* Keyboard can later load cached text without Full Access.
- *Method:* unit tests and simulator inspection of App Group state.
- *Expected:* Cache contains non-secret text history records only.

**Confidence:** 0 / 90 · **Depends on:** T3 · **Closes:** DoD-5

**Evidence (required before tick; append-only)**

## 6. Decisions · LIVE (append-only)

- 2026-06-27 - The containing app is not the primary paste-anywhere UX. It owns
  trust, setup, history, and explicit clipboard operations so the keyboard can
  stay small and focused. Scope impact: none.
- 2026-06-27 - Self adversarial review found signing and entitlements are likely
  to block local simulator/device proof. This goal treats missing developer-team
  configuration as a blocker, not a reason to dilute the security model. Scope
  impact: none.

---

## 7. Learnings · LIVE (append-only)

*(none yet)*

---

## 8. Skills · LIVE (append-only)

*(none yet)*
