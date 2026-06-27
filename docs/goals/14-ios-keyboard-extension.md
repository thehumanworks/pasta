---
goal_id: "pasta-14-ios-keyboard-extension"
title: "Native iOS Keyboard Extension"
status: "blocked"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: Native iOS Keyboard Extension

## 1. Invariants · the rules that must not break

This file is the only state for this delivery subgoal — if it isn't written here,
it didn't happen. Scope freezes only after user confirmation of §3 and §5.
Tasks and DoD are ticked only with evidence and Confidence ≥ `confidence_floor`.
Scope changes stop execution and surface to the user.

---

## 2. References

- `docs/goals/13-ios-app-shell-pairing-history.md` — prerequisite app, pairing,
  and cached text history.
- `docs-site/content/native-ios.md` — keyboard behavior and Full Access rules.
- `docs/adrs/0001-native-ios-keyboard-centered.md` — chosen UX architecture.
- Apple Custom Keyboard and Open Access docs linked from
  `docs-site/content/native-ios.md`.

---

## 3. Definition of Done · INVARIANT

- [ ] **DoD-1** — A keyboard extension target builds, installs, and appears as a
  selectable iOS keyboard. — *verify by:* simulator/device install and keyboard
  selection proof.
- [ ] **DoD-2** — Normal typing, delete, return, space, shift/case, punctuation
  access, and next-keyboard behavior are usable enough that Pasta is not a
  one-button keyboard. — *verify by:* simulator/manual keyboard smoke.
- [ ] **DoD-3** — Without Full Access, the keyboard loads cached text history and
  inserts selected text clips into supported text fields. — *verify by:*
  simulator smoke in at least two host apps or test hosts.
- [ ] **DoD-4** — With Full Access, the keyboard can refresh history and publish
  the iPhone clipboard only after explicit user action. — *verify by:* simulator
  or device smoke plus code review.
- [ ] **DoD-5** — Secure fields, phone pads, unavailable host contexts, and
  rejected third-party keyboard cases fail gracefully with no data loss claim.
  — *verify by:* simulator/manual matrix.
- [ ] **DoD-6** — The keyboard never publishes ordinary keystrokes or silently
  reads/publishes the pasteboard. — *verify by:* code review and tests around
  publish actions.

---

## 4. Exit Conditions

- **`DONE`** — Pasta keyboard feels native enough for text entry and can insert
  Pasta text history where iOS allows third-party keyboards. *(primary)*
- **`BLOCKED-DEP`** — Goal 13 is incomplete or keyboard entitlement/signing
  setup cannot proceed locally.
- **`SCOPE-CHANGE`** — desired behavior requires replacing the Apple keyboard,
  bypassing secure-field restrictions, or monitoring keystrokes/pasteboard.
- **`CONFIDENCE-STALL`** — a task cannot reach 90 confidence after two attempts.
- **`BUDGET`** — one implementation pass plus one verification-fix loop is
  exhausted.

---

## 5. Tasks · INVARIANT

### T1 · Add Keyboard Target And Baseline Typing · [ ]

**Steps**
- [ ] Add keyboard extension target and Info.plist.
- [ ] Implement basic keyboard layout and text document proxy interactions.
- [ ] Include globe/next-keyboard behavior.

**Verification Contract**
- *Check:* Keyboard target installs and types in a host text field.
- *Method:* simulator/device keyboard smoke.
- *Expected:* User can type ordinary text and switch away from Pasta keyboard.

**Confidence:** 0 / 90 · **Depends on:** Goal 13 · **Closes:** DoD-1, DoD-2

**Evidence (required before tick; append-only)**

---

### T2 · Insert Cached Text History Without Full Access · [ ]

**Steps**
- [ ] Read cached text history from App Group storage.
- [ ] Render compact history strip and expanded history drawer.
- [ ] Insert selected text through the text document proxy.

**Verification Contract**
- *Check:* Standard-access keyboard can paste cached Pasta text.
- *Method:* simulator smoke with Full Access disabled.
- *Expected:* Text clip inserts; live network and pasteboard actions remain
  unavailable.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-3

**Evidence (required before tick; append-only)**

---

### T3 · Implement Full Access Live Actions · [ ]

**Steps**
- [ ] Detect and explain Full Access state.
- [ ] Add live history refresh through signed Pasta requests.
- [ ] Add explicit Publish Clipboard action with user-tapped intent.

**Verification Contract**
- *Check:* Full Access enables live sync without changing keystroke privacy.
- *Method:* simulator/device smoke and code review.
- *Expected:* Network/pasteboard code only runs behind explicit keyboard actions.

**Confidence:** 0 / 90 · **Depends on:** T2 · **Closes:** DoD-4, DoD-6

**Evidence (required before tick; append-only)**

---

### T4 · Handle Restricted Host Contexts · [ ]

**Steps**
- [ ] Test secure fields, phone pads, and apps/test hosts that reject third-party
  keyboards.
- [ ] Keep explanatory states accurate and terse.
- [ ] Avoid promising unsupported "everywhere" behavior.

**Verification Contract**
- *Check:* Known iOS restrictions are handled and documented in product copy.
- *Method:* simulator/manual matrix.
- *Expected:* Unsupported contexts fail gracefully and never imply a Pasta bug.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-5

**Evidence (required before tick; append-only)**

---

### T5 · Keyboard Privacy And Regression Audit · [ ]

**Steps**
- [ ] Add tests around publish triggers.
- [ ] Review logs, analytics hooks, and state writes for plaintext leakage.
- [ ] Run final keyboard smoke in multiple host fields.

**Verification Contract**
- *Check:* Keyboard preserves privacy and usability contracts.
- *Method:* tests, code review, simulator proof.
- *Expected:* No ordinary keystroke publish path and no silent pasteboard publish.

**Confidence:** 0 / 90 · **Depends on:** T3, T4 · **Closes:** DoD-2, DoD-3, DoD-4, DoD-5, DoD-6

**Evidence (required before tick; append-only)**

## 6. Decisions · LIVE (append-only)

- 2026-06-27 - The keyboard is a real keyboard, not a single paste button,
  because users must be able to stay in the input context after switching to
  Pasta. Scope impact: none.
- 2026-06-27 - Self adversarial review found the largest UX risk is overstating
  "paste anywhere." This goal requires restricted-context proof and precise
  copy before completion. Scope impact: none.

---

## 7. Learnings · LIVE (append-only)

*(none yet)*

---

## 8. Skills · LIVE (append-only)

*(none yet)*
