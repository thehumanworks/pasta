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

- [ ] **DoD-1** — A native Pasta app target builds in Xcode Cloud with the shared
  Swift core linked, and launches on simulator/device when a runnable artifact is
  available. — *verify by:* Xcode Cloud build evidence plus simulator/device
  launch proof when available.
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
- **`BLOCKED-DEP`** — Goal 12 is incomplete, Xcode Cloud cannot be configured
  without Apple Developer input, or signing entitlements cannot be configured
  without developer-account input.
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
- [ ] Configure the project so Xcode Cloud can build the app target.
- [ ] Add the app target, bundle id, App Group, and Keychain access group.
- [ ] Link `PastaCore`.

**Verification Contract**
- *Check:* The app target builds and launches.
- *Method:* Xcode Cloud build/test evidence plus local simulator/device launch
  proof when possible.
- *Expected:* Xcode Cloud builds the Pasta app target; simulator/device launch
  proof is recorded separately from build authority.

**Confidence:** 0 / 90 · **Depends on:** Goal 12 · **Closes:** DoD-1

**Evidence (required before tick; append-only)**

- 2026-06-27 - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO build` - exit 0; local simulator build compiles app, keyboard extension, and `PastaCore` linkage for build 3 sources.
- 2026-06-27 - `xcrun simctl install A5C6DC5D-CB65-4409-9CA8-3B0CD6709FE3 ios/build/DerivedData/Build/Products/Debug-iphonesimulator/Pasta.app && xcrun simctl launch ... com.thehumanworks.pasta` - exit 0; app launched with pid 49273, and screenshot saved to `ios/build/screenshots/pasta-app-feedback-fix.png`.
- 2026-06-27 - `EXPECT_NO_NON_EXEMPT_ENCRYPTION=1 /Users/mish/.agents/skills/apple-developer/scripts/inspect_ipa.sh ios/build/export-local/Pasta.ipa` - exit 0; build 3 IPA has bundle id `com.thehumanworks.pasta`, version `0.1.7`, build `3`, app icon, keyboard appex, and no non-exempt encryption flag.

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

- 2026-06-27 - `PASTA_IOS_JOIN_TOKEN="join token <redacted>" swift test --package-path ios --filter PastaCoreLiveRelayTests/testLiveRelayJoinPublishAndHistoryWhenTokenProvided` - exit 0; Swift core accepted a CLI-style pasted token, redeemed it against the real relay, published encrypted text, fetched it from history, and the smoke device was then revoked with `pasta devices revoke`.
- 2026-06-27 - feedback fix - pass by code review; `PastaRootView` now shows join progress/errors inline, `PastaCrypto.parseJoinGrantTokenFromUserInput` extracts tokens from CLI/JSON paste text, and `PastaAppModel.join()` keeps successful pairing even if immediate history refresh fails. Physical tap-through on an iPhone remains unproven in this run.
- 2026-06-27 - feedback fix - `mise exec -- bun run src/cli.ts pair grant create --json` generated a one-use grant, then `PASTA_IOS_JOIN_TOKEN="join token <redacted>" swift test --package-path ios --filter PastaCoreLiveRelayTests/testLiveRelayJoinPublishAndHistoryWhenTokenProvided` exited 0; Swift redeemed the shell-generated token against the real relay, published/fetched history, and the smoke device was revoked.

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

- 2026-06-27 - `rg -n "UIPasteboard|Timer|scenePhase|NotificationCenter|background|pasteboard|hasFullAccess" ios/App ios/Keyboard` - exit 0; pasteboard reads/writes are only in user-tapped app import/export and keyboard publish paths, with keyboard live actions gated by `hasFullAccess`.

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

- 2026-06-27 - build 3 IPA entitlement inspection with `/usr/bin/codesign -d --entitlements :-` - exit 0; app and keyboard both include `group.com.thehumanworks.pasta`, `54MXM5JG3R.com.thehumanworks.pasta`, and `get-task-allow=false`.

## 6. Decisions · LIVE (append-only)

- 2026-06-27 - The containing app is not the primary paste-anywhere UX. It owns
  trust, setup, history, and explicit clipboard operations so the keyboard can
  stay small and focused. Scope impact: none.
- 2026-06-27 - Self adversarial review found signing and entitlements are likely
  to block Xcode Cloud or device proof. This goal treats missing developer-team
  configuration as a blocker, not a reason to dilute the security model. Scope
  impact: none.
- 2026-06-27 - User feedback found pasted join tokens did not work from the app
  surface. Join now accepts raw tokens embedded in CLI or JSON text, and a
  successful join no longer depends on immediate history refresh. Scope impact:
  app-shell join UX only.
- 2026-06-27 - User-reported `cryptoFailed` was reproduced with a fresh shell
  generated grant. Root cause was Swift join-grant AAD re-encoding omitting
  explicit JSON null for `deviceTtlMs`, while TypeScript seals it as null. Scope
  impact: Swift join-grant crypto compatibility only.

---

## 7. Learnings · LIVE (append-only)

*(none yet)*

---

## 8. Skills · LIVE (append-only)

*(none yet)*
