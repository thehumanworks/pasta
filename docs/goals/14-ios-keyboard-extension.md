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

- [ ] **DoD-1** — A keyboard extension target builds in Xcode Cloud, installs,
  and appears as a selectable iOS keyboard when a runnable artifact is available.
  — *verify by:* Xcode Cloud build evidence plus simulator/device install and
  keyboard selection proof when available.
- [ ] **DoD-2** — Normal typing, delete, return, space, shift/case, punctuation
  access, and non-duplicated input-mode switching are usable enough that Pasta
  is not a one-button keyboard. — *verify by:* simulator/manual keyboard smoke.
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
- **`BLOCKED-DEP`** — Goal 13 is incomplete, Xcode Cloud cannot build the
  keyboard target, or keyboard entitlement/signing setup cannot proceed.
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
- [ ] Ensure the target is included in the Xcode Cloud workflow.
- [ ] Implement basic keyboard layout and text document proxy interactions.
- [ ] Avoid duplicate globe/input-mode controls while preserving normal typing.

**Verification Contract**
- *Check:* Keyboard target builds in Xcode Cloud and installs/types when a
  runnable artifact is available.
- *Method:* Xcode Cloud build evidence plus simulator/device keyboard smoke.
- *Expected:* Xcode Cloud builds the keyboard target; user can type ordinary text
  and no duplicate Pasta globe key appears in behavioral smoke.

**Confidence:** 0 / 90 · **Depends on:** Goal 13 · **Closes:** DoD-1, DoD-2

**Evidence (required before tick; append-only)**

- 2026-06-27 - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO build` - exit 0; keyboard extension target compiled into `Pasta.app/PlugIns/PastaKeyboard.appex`.
- 2026-06-27 - `xcrun simctl spawn A5C6DC5D-CB65-4409-9CA8-3B0CD6709FE3 pluginkit -m -p com.apple.keyboard-service | rg 'com.thehumanworks.pasta.keyboard'` - exit 0; PluginKit registered `com.thehumanworks.pasta.keyboard(0.1.7)` after simulator install.
- 2026-06-27 - feedback fix - pass by code review; `KeyboardViewController` now uses a 291pt default portrait keyboard height, four key rows, wider space bar, and no manual `next`/globe key path. `rg -n "advanceToNextInputMode|next|🌐|globe" ios/Keyboard/KeyboardViewController.swift` returns no matches.
- 2026-06-27 - feedback fix - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO build` - exit 0 after replacing the manual key grid with KeyboardKit 9.9.1; `Pasta.app/PlugIns/PastaKeyboard.appex` built and PluginKit registered the extension.
- 2026-06-27 - feedback fix - pass by code review; KeyboardKit now owns keyboard layout, sizing, alphabetic/numeric/symbolic modes, callouts, and key action handling, while Pasta removes `nextKeyboard` from the generated layout to avoid a duplicate visible input-mode switch.
- 2026-06-27 - action shelf contrast fix - pass by code review against attached feedback screenshot; `PastaKeyboardToolbar` now uses explicit high-contrast black text/icons on opaque white chips, a solid shelf background, chip borders, and `.allowsHitTesting` instead of disabled opacity for live action gating.
- 2026-06-27 - action shelf contrast fix - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO build` - exit 0; simulator install/launch plus `pluginkit -m -p com.apple.keyboard-service | rg 'com.thehumanworks.pasta.keyboard'` - exit 0 with `com.thehumanworks.pasta.keyboard(0.1.7)`.
- 2026-06-27 - action shelf contrast fix - `swift test --package-path ios` - exit 0 with 14 tests passed and 1 live relay test skipped; `mise exec -- bun run test` - exit 0 with 30 Bun tests and 13 Vitest tests passed; `git diff --check` - exit 0.
- 2026-06-27 - TestFlight build 5 - archive/export/upload passed; `inspect_ipa.sh ios/build/export-local/Pasta.ipa` confirmed `CFBundleVersion=5`, `ITSAppUsesNonExemptEncryption=false`, distribution profile, `get-task-allow=false`, and embedded `PastaKeyboard.appex`; App Store Connect build `d181b674-ce20-4413-aa5a-8881e13037c9` is `VALID` and internal beta group `internal` has access.
- 2026-06-27 - top bar removal fix - pass by code review against attached feedback screenshot; `KeyboardView` now renders `PastaKeyboardToolbar` directly and pins `autocompleteToolbarStyle` to the same 36pt shelf height, removing the nested 44pt `Keyboard.Toolbar` container that painted a separate strip above the action buttons.
- 2026-06-27 - top bar removal fix - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO build` - exit 0; simulator install/launch plus `pluginkit -m -p com.apple.keyboard-service | rg 'com.thehumanworks.pasta.keyboard'` - exit 0 with `com.thehumanworks.pasta.keyboard(0.1.7)`.
- 2026-06-27 - top bar removal fix - `swift test --package-path ios` - exit 0 with 14 tests passed and 1 live relay test skipped; `mise exec -- bun run test` - exit 0 with 30 Bun tests and 13 Vitest tests passed; `git diff --check` - exit 0.
- 2026-06-27 - TestFlight build 6 - archive/export/upload passed; `inspect_ipa.sh ios/build/export-local/Pasta.ipa` confirmed `CFBundleVersion=6`, `ITSAppUsesNonExemptEncryption=false`, distribution profile, `get-task-allow=false`, and embedded `PastaKeyboard.appex`; App Store Connect build `24127bd0-4625-4e17-97ef-ce8451a32369` is `VALID` and internal beta group `internal` has access.
- 2026-06-27 - native chrome/case fix - pass by code review against attached TestFlight screenshot and KeyboardKit 9.9.1 sources; `PastaKeyboardToolbar` is now a sibling above `KeyboardView`, KeyboardKit receives `toolbar: EmptyView()`, `.autocompleteToolbarStyle(height: 0, padding: 0)`, `.keyboardInputToolbarDisplayMode(.none)`, and a native keyboard background so there is no separate autocomplete/toolbar host strip above the action buttons.
- 2026-06-27 - native chrome/case fix - pass by code review; `PastaKeyboardView` observes `KeyboardContext`, injects a layout generated from the current context through `PastaKeyboardLayoutService`, removes only `.nextKeyboard`, and rebuilds `KeyboardView` identity when case, keyboard type, orientation, screen size, or device class changes so lower/upper case and `123`/symbol rows track KeyboardKit state.
- 2026-06-27 - native chrome/case fix - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO build` - exit 0; simulator install/launch plus `pluginkit -m -p com.apple.keyboard-service | rg 'com.thehumanworks.pasta.keyboard'` - exit 0 with `com.thehumanworks.pasta.keyboard(0.1.7)`.
- 2026-06-27 - native chrome/case fix - `swift test --package-path ios` - exit 0 with 14 tests passed and 1 live relay test skipped; `PASTA_IOS_JOIN_TOKEN=<redacted> swift test --package-path ios --filter PastaCoreLiveRelayTests` - exit 0 with live join/publish/history passed; `mise exec -- bun run test` - exit 0 with 30 Bun tests and 13 Vitest tests passed; `cd docs-site && bun run build -- --base /pasta/` - exit 0 with 15 pages built; `git diff --check` - exit 0.
- 2026-06-27 - TestFlight build 7 - archive/export/upload passed; `inspect_ipa.sh ios/build/export-local/Pasta.ipa` confirmed `CFBundleVersion=7`, `ITSAppUsesNonExemptEncryption=false`, distribution profile, `get-task-allow=false`, and embedded `PastaKeyboard.appex`; App Store Connect build `36db846e-287b-4996-ae1d-c01c26ade0f0` is `VALID` and internal beta group `internal` has access.
- 2026-06-27 - Grammarly-style action shelf fix - pass by visual comparison against attached Pasta and Grammarly screenshots; `PastaKeyboardToolbar` now uses a 48pt native suggestion-row height, full-height action/clip hit targets, plain text segments with subtle separators, pressed-only background feedback, and no vertical `.clipped()` so labels are not blurred, cramped, or cut off beside the stock key rows.
- 2026-06-27 - Grammarly-style action shelf fix - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO build` - exit 0; simulator install/launch plus `pluginkit -m -p com.apple.keyboard-service | rg 'com.thehumanworks.pasta.keyboard'` - exit 0 with `com.thehumanworks.pasta.keyboard(0.1.7)`.
- 2026-06-27 - Grammarly-style action shelf fix - `swift test --package-path ios` - exit 0 with 14 tests passed and 1 live relay test skipped; `mise exec -- bun run test` - exit 0 with 30 Bun tests and 13 Vitest tests passed; `cd docs-site && bun run build -- --base /pasta/` - exit 0 with 15 pages built; `git diff --check` - exit 0; `gdd_status.py docs/goals/14-ios-keyboard-extension.md` - pass.
- 2026-06-27 - TestFlight build 8 - archive/export/upload passed; `inspect_ipa.sh ios/build/export-local/Pasta.ipa` confirmed `CFBundleVersion=8`, `ITSAppUsesNonExemptEncryption=false`, distribution profile, `get-task-allow=false`, and embedded `PastaKeyboard.appex`; App Store Connect build `05246339-72ad-4189-ab42-7ba8fad527df` is `VALID` and internal beta group `internal` has access.

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

- 2026-06-27 - code review - pass; standard-access path loads cached `PastaKeyboardClip` records from App Group storage and inserts selected text through `textDocumentProxy.insertText`; live network and pasteboard paths are separate buttons.

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

- 2026-06-27 - `rg -n "UIPasteboard|Timer|scenePhase|NotificationCenter|background|pasteboard|hasFullAccess" ios/App ios/Keyboard` - exit 0; keyboard pasteboard read is only in `publishClipboardText()` after a user-tapped Publish action, and `liveContext()` requires `hasFullAccess`.

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
- 2026-06-27 - User feedback corrected the keyboard chrome contract: Pasta must
  not add a duplicate visible globe key when iOS already presents the input-mode
  switch control. Scope impact: keyboard layout and docs wording.
- 2026-06-27 - User preference corrected the implementation contract: use
  libraries for keyboard structure where feasible. Pasta now uses KeyboardKit
  for stock keyboard rendering and keeps only Pasta-specific toolbar/privacy
  behavior in app code. Scope impact: keyboard implementation dependency.
- 2026-06-27 - User screenshot corrected the toolbar chrome contract: Pasta
  action buttons must remain high-contrast and opaque over iOS keyboard chrome,
  with no disabled-opacity blur for normal states. Scope impact: keyboard
  toolbar styling and docs wording.
- 2026-06-27 - User screenshot corrected the toolbar container contract: Pasta
  action buttons should not sit under a separate visible top strip. Scope impact:
  toolbar composition only.
- 2026-06-27 - User feedback corrected the native typing contract: KeyboardKit
  remains authoritative for shift/case, lowercase labels/actions,
  number/symbol modes, delete, return, space, and callouts; Pasta code only adds
  the action shelf and removes duplicate input-mode switching. Scope impact:
  keyboard layout observation and docs wording.
- 2026-06-27 - User comparison against Grammarly corrected the shelf style
  contract: the action shelf should feel like a native suggestion row, not a
  short clipped chip rail. Scope impact: toolbar presentation only.

---

## 7. Learnings · LIVE (append-only)

- 2026-06-27 - KeyboardKit's `KeyboardView` `toolbar:` parameter is the
  autocomplete toolbar host, not a neutral product-action shelf. If Pasta places
  action controls there, KeyboardKit and the custom keyboard host can still paint
  extra toolbar/safe-area chrome above the controls. Render Pasta's strip as a
  sibling above `KeyboardView`, pass `EmptyView()` to KeyboardKit's toolbar, and
  set `autocompleteToolbarStyle(height: 0, padding: 0)` plus
  `keyboardInputToolbarDisplayMode(.none)`.
- 2026-06-27 - KeyboardKit layouts are context snapshots. If a wrapper computes
  a layout once and does not observe `KeyboardContext`, shift/case and
  `123`/symbol transitions can leave stale key rows on screen. Observe
  `KeyboardContext` and rebuild the KeyboardKit view identity for case, type,
  orientation, screen-size, and device-class changes.
- 2026-06-27 - SwiftUI previews are useful for toolbar contrast, but they do not
  prove keyboard-extension chrome. The top strip regression only showed in the
  hosted keyboard surface, so final proof must include simulator/device
  extension install plus TestFlight readback when the user reports device
  screenshots.
- 2026-06-27 - Grammarly-style third-party keyboards use a taller native
  suggestion-row treatment: centered text/action segments, subtle dividers, and
  full-height hit targets. Avoid a 36pt clipped chip row because it makes labels
  look cramped and visually detached from stock iOS keys.

---

## 8. Skills · LIVE (append-only)

*(none yet)*
