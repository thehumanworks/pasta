---
goal_id: "pasta-15-ios-publish-surfaces"
title: "Native iOS Publish Surfaces"
status: "blocked"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: Native iOS Publish Surfaces

## 1. Invariants · the rules that must not break

This file is the only state for this delivery subgoal — if it isn't written here,
it didn't happen. Scope freezes only after user confirmation of §3 and §5.
Tasks and DoD are ticked only with evidence and Confidence ≥ `confidence_floor`.
Scope changes stop execution and surface to the user.

---

## 2. References

- `docs/goals/13-ios-app-shell-pairing-history.md` — prerequisite app and shared
  state.
- `docs/goals/14-ios-keyboard-extension.md` — prerequisite keyboard UX and
  explicit Publish Clipboard action.
- `docs-site/content/native-ios.md` — publish and App Intent data flows.
- Apple Share Extension and App Intents docs linked from
  `docs-site/content/native-ios.md`.
- `docs/protocol.md` and `docs/binary-payloads.md` — existing Pasta publish
  routes and payload handling.

---

## 3. Definition of Done · INVARIANT

- [ ] **DoD-1** — Share to Pasta publishes text and URLs from host apps through
  existing encrypted clip routes. — *verify by:* simulator/device Share
  extension smoke.
- [ ] **DoD-2** — Share to Pasta publishes images, PDFs, and files through the
  existing encrypted file payload routes without leaking local paths or filenames
  in Worker-visible metadata. — *verify by:* Share extension smoke plus API/log
  inspection.
- [ ] **DoD-3** — App Intents expose only narrow command surfaces: Publish
  Clipboard, Copy Latest Text to Clipboard, Open History, and Search History.
  — *verify by:* Shortcuts/App Intents invocation proof.
- [ ] **DoD-4** — Publish actions consistently require user intent and do not
  introduce background clipboard monitoring. — *verify by:* code review and
  simulator proof.
- [ ] **DoD-5** — Extension upload handling uses extension-safe temporary files,
  bounded memory, and background session behavior only when required. — *verify
  by:* large-file simulator smoke and code review.

---

## 4. Exit Conditions

- **`DONE`** — iOS can publish from native Share and system command surfaces
  without changing Pasta's protocol or privacy boundary. *(primary)*
- **`BLOCKED-DEP`** — Goals 13 or 14 are incomplete, or extension signing cannot
  proceed locally.
- **`SCOPE-CHANGE`** — publish requires new backend routes, silent monitoring, or
  wider metadata disclosure.
- **`CONFIDENCE-STALL`** — a task cannot reach 90 confidence after two attempts.
- **`BUDGET`** — one implementation pass plus one verification-fix loop is
  exhausted.

---

## 5. Tasks · INVARIANT

### T1 · Implement Share Extension For Text And URLs · [ ]

**Steps**
- [ ] Add Share extension target and activation rules.
- [ ] Load `NSExtensionItem` text and URL attachments.
- [ ] Encrypt and publish through existing text clip flow.

**Verification Contract**
- *Check:* Share sheet can publish text and URLs to Pasta.
- *Method:* simulator/device Share extension smoke.
- *Expected:* Shared text/URL appears in Pasta history and desktop clients can
  paste it.

**Confidence:** 0 / 90 · **Depends on:** Goal 13 · **Closes:** DoD-1, DoD-4

**Evidence (required before tick; append-only)**

---

### T2 · Implement Share Extension For Images And Files · [ ]

**Steps**
- [ ] Load image, PDF, file URL, and data attachments through `NSItemProvider`.
- [ ] Normalize payload kind, MIME/UTType, size, and encrypted display metadata.
- [ ] Use temporary files or background upload for larger payloads as needed.

**Verification Contract**
- *Check:* Binary shares publish without leaking local names or paths.
- *Method:* simulator/device Share extension smoke plus Worker-visible metadata
  inspection.
- *Expected:* History contains encrypted file payloads; Worker-visible metadata
  stays within existing contract.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-2, DoD-5

**Evidence (required before tick; append-only)**

---

### T3 · Add App Intents And Shortcuts · [ ]

**Steps**
- [ ] Implement Publish Clipboard intent.
- [ ] Implement Copy Latest Text to Clipboard intent.
- [ ] Implement Open History and Search History intents.
- [ ] Keep entities small and non-secret.

**Verification Contract**
- *Check:* System surfaces can run narrow Pasta commands.
- *Method:* Shortcuts/App Intents simulator or device invocation proof.
- *Expected:* Intents work and do not expose decrypted clip content outside user
  intent.

**Confidence:** 0 / 90 · **Depends on:** Goal 13 · **Closes:** DoD-3, DoD-4

**Evidence (required before tick; append-only)**

---

### T4 · Align Keyboard Publish With Shared Publish Core · [ ]

**Steps**
- [ ] Route keyboard Publish Clipboard through the same explicit publish service.
- [ ] Gate pasteboard access on Full Access and explicit tap.
- [ ] Share success/error states across app, keyboard, and intents where possible.

**Verification Contract**
- *Check:* Publish behavior is consistent across iOS surfaces.
- *Method:* unit tests and simulator smoke.
- *Expected:* No surface has a silent pasteboard read or publish path.

**Confidence:** 0 / 90 · **Depends on:** Goal 14, T3 · **Closes:** DoD-4

**Evidence (required before tick; append-only)**

---

### T5 · Verify Publish Privacy Boundary · [ ]

**Steps**
- [ ] Run unit tests for attachment normalization and metadata encryption.
- [ ] Inspect Worker-visible request payloads for each share type.
- [ ] Run desktop paste/history smoke for iOS-published clips.

**Verification Contract**
- *Check:* Published iOS clips are usable cross-device and preserve encryption
  boundaries.
- *Method:* simulator/device smoke plus desktop client verification.
- *Expected:* Desktop can paste iOS-published clips; Worker never sees plaintext
  content, names, or directory paths.

**Confidence:** 0 / 90 · **Depends on:** T2, T4 · **Closes:** DoD-1, DoD-2, DoD-3, DoD-4, DoD-5

**Evidence (required before tick; append-only)**

## 6. Decisions · LIVE (append-only)

- 2026-06-27 - Share extension and App Intents are publish/command surfaces, not
  replacements for the keyboard-centered paste UX. Scope impact: none.
- 2026-06-27 - Self adversarial review found the main product risk is accidental
  reintroduction of desktop-style auto-publish on iOS. This goal requires
  explicit user-intent proof for every publish surface. Scope impact: none.

---

## 7. Learnings · LIVE (append-only)

*(none yet)*

---

## 8. Skills · LIVE (append-only)

*(none yet)*
