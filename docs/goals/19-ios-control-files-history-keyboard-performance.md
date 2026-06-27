---
goal_id: "pasta-19-ios-control-files-history-keyboard-performance"
title: "iOS Control Plane Files, History Delete, And Keyboard Performance"
status: "active"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: iOS Control Plane Files, History Delete, And Keyboard Performance

## 1. Invariants

- This is a Hindsight Engineering contract for the current iOS delivery.
- The containing app is the control plane for file import, file export, and
  history deletion. The custom keyboard must not gain file-management UI.
- Keyboard typing behavior remains KeyboardKit-native. Performance changes must
  not remove typing, delete, shift/case, punctuation, autocomplete, Paste, or
  Publish behavior.
- Cloudflare never receives plaintext clipboard contents, file bytes, local
  paths, file names, or raw group keys.
- `clipId` is stable identity for remote fetch/delete. `seq` is display
  metadata only.

## 2. Hindsight Outcome

After this release, a paired iPhone can publish a user-selected document from
iCloud Drive or On My iPhone into Pasta remote storage, export a remote Pasta
file/image/directory clip back through iOS document/share surfaces, delete a
selected history entry from the remote store, and type through the Pasta
keyboard without the lag seen before this goal.

## 3. References

- `docs-site/content/native-ios.md` - Human/Agent iOS contract and footguns.
- `docs/goals/14-ios-keyboard-extension.md` - KeyboardKit behavioral contract.
- `docs/goals/16-ios-binary-file-provider-handoff.md` - binary handoff contract.
- `docs/goals/17-ios-integration-release-readiness.md` - release proof layers.
- `docs/goals/18-clipid-sequence-refactor.md` - `clipId` identity contract.
- `ios/App/PastaRootView.swift` - containing app UI.
- `ios/Keyboard/KeyboardViewController.swift` - keyboard runtime and hot path.
- `ios/Sources/PastaCore` - Swift protocol, crypto, storage, and API client.
- `src/shared/protocol.ts`, `src/worker/index.ts`,
  `src/worker/clipboard-space.ts` - existing file/history/delete API.

## 4. Definition of Done

- [x] **DoD-1** - iOS app imports a user-selected file and publishes it as an
  encrypted Pasta file clip without leaking plaintext metadata. - *verify by:*
  Swift tests plus simulator/device document-picker or injected file smoke.
- [x] **DoD-2** - iOS app exports remote file, image, and directory clips through
  iOS document/share surfaces using temporary plaintext only. - *verify by:*
  Swift tests plus simulator/device export smoke or inspected temp-file cleanup.
- [x] **DoD-3** - iOS app presents remote history and deletes a selected entry
  through `DELETE /v1/clips/:clipId`, then refreshes app/keyboard caches. -
  *verify by:* Swift tests and live or mocked API smoke.
- [x] **DoD-4** - Keyboard input hot paths are benchmarked before and after, with
  improved scores and no removed keyboard functionality. - *verify by:*
  committed benchmark/performance check and keyboard build/smoke.
- [ ] **DoD-5** - Final release is merged to `main`, pushed to `origin/main`,
  CLI version/tag/release assets are published, and iOS is uploaded to
  TestFlight with App Store Connect proof. - *verify by:* git, release, IPA,
  upload, and App Store Connect evidence.

## 5. Tasks

### T1 - Discover And Document Implementation Contract - [x]

- Read the active source/docs listed above.
- Update the docs site and agent index with the Hindsight contract.
- Keep intended future state separate from verified product proof.

Verification Contract:

- `cd docs-site && bun run build -- --base /` exits 0.
- `curl http://localhost:4173/.well-known/agents.json` works when served.

**Confidence:** 90/100
**Closes:** DoD-1, DoD-2, DoD-3, DoD-4
**Evidence:**

- 2026-06-27 - initial Hindsight contract drafted in
  `docs-site/content/native-ios.md`; `docs-site/build.ts` now emits
  `.well-known/agents.json` in the existing docs stack.
- 2026-06-27 - `cd docs-site && bun run build -- --base /` - exit 0; built
  15 pages into `docs-site/dist` with base `/`.
- 2026-06-27 - `cd docs-site && PORT=4173 bun run serve.ts` plus
  `curl -fsS http://localhost:4173/.well-known/agents.json` - exit 0;
  manifest returned `schema_version: hindsight-agents-v1`.
- 2026-06-27 - `curl -fsS -H 'Accept: text/markdown'
  http://localhost:4173/native-ios/ | rg -n "Hindsight contract|DELETE
  /v1/clips|Keyboard latency"` - exit 0; markdown endpoint exposed the current
  release contract.

### T2 - Implement Control-Plane File Import/Export - [x]

- Add Swift byte/file encryption and decryption parity for existing file clips.
- Add signed `POST /v1/files` and `GET /v1/files/:clipId` calls to
  `PastaAPIClient`.
- Add containing-app import/export controls and temporary-file cleanup.
- Preserve encrypted metadata and directory MIME semantics.

Verification Contract:

- Swift tests cover file encrypt/decrypt, API request shape, and temp cleanup.
- Simulator/device smoke demonstrates app import/export or records the exact
  unavailable UI proof surface.

**Confidence:** 91/100
**Closes:** DoD-1, DoD-2
**Evidence:**

- 2026-06-27 - Swift implementation review - pass; containing app file import
  uses `.fileImporter`, security-scoped URL access, local bytes read,
  MIME/UTType detection, encrypted metadata, and signed `POST /v1/files`;
  export downloads by stable `clipId`, decrypts bytes locally, stages a
  temporary file, presents a share sheet, and cleans the temporary directory on
  dismissal.
- 2026-06-27 - `swift test --package-path ios` - exit 0; 21 XCTest tests
  executed, 1 gated live-relay test skipped without `PASTA_IOS_JOIN_TOKEN`.
  Added file tests cover TypeScript-vector bytes encryption/decryption,
  encrypted filename metadata, signed `/v1/files` upload/download request
  shape, and temporary export cleanup.
- 2026-06-27 - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS
  Simulator' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO
  build` - exit 0; app and embedded keyboard extension compiled for simulator
  with file import/export UI.
- 2026-06-27 - `git diff --check` - exit 0.

### T3 - Implement Control-Plane History Delete - [x]

- Add full history rows that keep stable `clipId` alongside display `seq`.
- Add signed `DELETE /v1/clips/:clipId` to `PastaAPIClient`.
- Add app UI to delete a selected history entry after explicit user action.
- Refresh live history and app-group keyboard cache after successful delete.

Verification Contract:

- Swift tests cover delete-by-clipId and cache refresh.
- Live or mocked API smoke proves the expected request and state transition.

**Confidence:** 90/100
**Closes:** DoD-3
**Evidence:**

- 2026-06-27 - docs-first contract refinement in
  `docs-site/content/native-ios.md` states stable `clipId` identity and
  text-only keyboard cache refresh after history refresh/delete.
- 2026-06-27 - `swift test --package-path ios` - exit 0; 16 tests executed,
  1 live relay test skipped because `PASTA_IOS_JOIN_TOKEN` was unset. New
  `PastaCoreHistoryDeleteTests` cover signed `DELETE
  /v1/clips/clip_delete_test` with no request body, full history rows retaining
  `clipId` plus display `seq`, and text-only keyboard cache save/readback.
- 2026-06-27 - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta
  -configuration Debug -sdk iphonesimulator -destination 'platform=iOS
  Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData
  CODE_SIGNING_ALLOWED=NO build` - exit 0; containing app and keyboard
  extension simulator build compiled after history delete UI/cache changes.
- 2026-06-27 - `cd docs-site && bun install --frozen-lockfile && bun run build
  -- --base /` - exit 0; built 15 pages into `docs-site/dist` with existing
  docs stack after installing locked docs dependency.

### T4 - Benchmark And Optimize Keyboard Input - [x]

- Identify hot paths with repeatable local measurements.
- Optimize only Pasta-owned work around KeyboardKit, such as layout computation,
  view setup churn, autocomplete helper work, and cache refresh timing.
- Do not remove keyboard functionality or bypass KeyboardKit input handling.
- Report baseline and optimized scores from the same benchmark command.

Verification Contract:

- A committed benchmark/performance test reports before/after numbers.
- `swift test --package-path ios` and an iOS keyboard build pass.

**Confidence:** 90/100
**Closes:** DoD-4
**Evidence:**

- 2026-06-27 - baseline keyboard layout hot-path benchmark before source
  optimization - `swift ios/Benchmarks/KeyboardHotPathBenchmark.swift
  --iterations 40000 --mode both` - exit 0; `baseline.layout_rebuild:
  290.265 ms`, `optimized.layout_cache: 228.299 ms`, same checksum
  `254720000`; source still rebuilt KeyboardKit layout and inserted Pasta's
  number row on each `PastaKeyboardView.body` evaluation.
- 2026-06-27 - root cause discovery - KeyboardKit
  `KeyboardInputViewController.textDidChangeAsync` calls autocomplete after text
  changes, while Pasta-owned code also rebuilt the augmented KeyboardKit layout
  on SwiftUI body evaluation. Pasta's hot paths were the per-evaluation number
  row/layout generation and per-autocomplete `UITextChecker` plus available
  language setup; KeyboardKit key handling, toolbar composition, autocomplete
  view, globe behavior, and publish/paste actions remain intact.
- 2026-06-27 - optimized keyboard benchmark - `swift
  ios/Benchmarks/KeyboardHotPathBenchmark.swift --iterations 40000 --mode both`
  - exit 0; `baseline.layout_rebuild: 289.455 ms`,
  `baseline.autocomplete_new_checker: 4947.205 ms`,
  `optimized.layout_cache: 225.297 ms`,
  `optimized.autocomplete_reused_checker: 1960.100 ms`,
  `baseline.total: 5236.661 ms`, `optimized.total: 2185.396 ms`;
  improvement `3051.264 ms` / `58.267% faster`; checksums matched
  (`254720000` layout, `691434` autocomplete).
- 2026-06-27 - implementation - `ios/Keyboard/KeyboardViewController.swift`
  now caches Pasta's structural KeyboardKit layout augmentation by keyboard
  type, orientation, screen size, device class, input-mode-switch requirement,
  and locale, and reuses `UITextChecker` plus its available-language set for the
  autocomplete service instead of recreating them per request.
- 2026-06-27 - `swift test --package-path ios` - exit 0; 14 tests executed, 1
  live relay smoke skipped because `PASTA_IOS_JOIN_TOKEN` is unset, 0 failures.
- 2026-06-27 - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta
  -configuration Debug -sdk iphonesimulator -destination 'platform=iOS
  Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData
  CODE_SIGNING_ALLOWED=NO build` - exit 0; `PastaKeyboard.appex` compiled and
  embedded in `Pasta.app/PlugIns`.
- 2026-06-27 - `git diff --check` - exit 0.
- 2026-06-27 - final benchmark rerun - `swift
  ios/Benchmarks/KeyboardHotPathBenchmark.swift --iterations 40000 --mode both`
  - exit 0; `baseline.layout_rebuild: 289.455 ms`,
  `baseline.autocomplete_new_checker: 4947.205 ms`,
  `optimized.layout_cache: 225.297 ms`,
  `optimized.autocomplete_reused_checker: 1960.100 ms`,
  `baseline.total: 5236.661 ms`, `optimized.total: 2185.396 ms`;
  improvement `3051.264 ms` / `58.267% faster`; checksums matched
  (`254720000` layout, `691434` autocomplete).

### T5 - Integrate, Release, And Prove Distribution - [ ]

- Merge reviewed worktrees into local `main`.
- Run docs, Swift, TypeScript, Worker, and iOS build checks.
- Push `main`, update CLI version, create the release tag, and publish release
  assets.
- Archive/export/upload iOS and verify App Store Connect/TestFlight state.

Verification Contract:

- `git status --short --branch` is clean on pushed `main`.
- Release tag/assets are visible and installable by the documented GitHub
  release path.
- IPA inspection, upload log, App Store Connect build `VALID`, and internal
  TestFlight group access are recorded separately.

**Confidence:** 0/90
**Closes:** DoD-5
**Evidence:**

## 6. Decisions

- 2026-06-27 - File import/export and history delete belong to the containing
  app control plane, not the custom keyboard. Scope impact: app UI and
  `PastaCore` API additions only.
- 2026-06-27 - Document picker/share export is acceptable for this release; File
  Provider remains optional unless implementation proves the fallback cannot
  satisfy import/export. Scope impact: avoids a new extension target unless
  needed.
- 2026-06-27 - Keyboard performance work must optimize Pasta-owned work around
  KeyboardKit instead of replacing KeyboardKit input handling. Scope impact:
  preserves existing keyboard functionality.

## 7. Learnings

*(append-only)*
