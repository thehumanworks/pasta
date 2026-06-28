---
goal_id: "pasta-19-ios-control-files-history-keyboard-performance"
title: "iOS Control Plane Files, History Delete, And Keyboard Performance"
status: "done"
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
- The alphabetic keyboard must not include Pasta's custom top number row.
  Number keys appear when the user taps the standard `123` mode switch.
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
  improved scores, no removed keyboard functionality, and no Pasta-added
  alphabetic top number row. - *verify by:* committed benchmark/performance
  check, source review, and keyboard build/smoke.
- [x] **DoD-5** - Final release is merged to `main`, pushed to `origin/main`,
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
  now-removed alphabetic number row on each `PastaKeyboardView.body`
  evaluation.
- 2026-06-27 - root cause discovery - KeyboardKit
  `KeyboardInputViewController.textDidChangeAsync` calls autocomplete after text
  changes, while Pasta-owned code also rebuilt the structural KeyboardKit
  layout on SwiftUI body evaluation. Pasta's hot paths were the per-evaluation
  layout generation and per-autocomplete `UITextChecker` plus available
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
  now caches Pasta's structural KeyboardKit layout by keyboard
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
- 2026-06-27 - post-optimization benchmark before number-row follow-up - `swift
  ios/Benchmarks/KeyboardHotPathBenchmark.swift --iterations 40000 --mode both`
  - exit 0; `baseline.layout_rebuild: 289.455 ms`,
  `baseline.autocomplete_new_checker: 4947.205 ms`,
  `optimized.layout_cache: 225.297 ms`,
  `optimized.autocomplete_reused_checker: 1960.100 ms`,
  `baseline.total: 5236.661 ms`, `optimized.total: 2185.396 ms`;
  improvement `3051.264 ms` / `58.267% faster`; checksums matched
  (`254720000` layout, `691434` autocomplete).

### T4A - Remove Alphabetic Top Number Row - [x]

- Remove Pasta's custom `1234567890` row from the alphabetic keyboard layout.
- Keep KeyboardKit's numeric/symbol modes so users still get digits after
  tapping `123`.
- Preserve KeyboardKit toolbar, autocomplete, globe key, input handling, and the
  structural layout cache.

Verification Contract:

- Source inspection shows no Pasta-owned number-row insertion for
  `.alphabetic`.
- Keyboard benchmark and iOS simulator build pass.

**Confidence:** 90/100
**Closes:** DoD-4
**Evidence:**

- 2026-06-27 - implementation - `PastaKeyboardLayoutCache` now caches
  KeyboardKit's generated layout without inserting a Pasta-owned number row
  when `keyboardType == .alphabetic`; number and symbol modes remain generated
  by KeyboardKit.
- 2026-06-27 - follow-up benchmark - `swift
  ios/Benchmarks/KeyboardHotPathBenchmark.swift --iterations 40000 --mode both`
  - exit 0; `baseline.layout_rebuild: 231.427 ms`,
  `baseline.autocomplete_new_checker: 4859.818 ms`,
  `optimized.layout_cache: 183.145 ms`,
  `optimized.autocomplete_reused_checker: 1992.038 ms`,
  `baseline.total: 5091.245 ms`, `optimized.total: 2175.182 ms`;
  improvement `2916.063 ms` / `57.276% faster`; checksums matched
  (`234720000` layout, `691434` autocomplete).
- 2026-06-27 - `swift test --package-path ios` - exit 0; 21 XCTest tests
  executed, 1 gated live-relay smoke skipped without `PASTA_IOS_JOIN_TOKEN`.
- 2026-06-27 - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta
  -configuration Debug -sdk iphonesimulator -destination 'platform=iOS
  Simulator,name=iPhone 17,OS=26.5' -derivedDataPath ios/build/DerivedData
  CODE_SIGNING_ALLOWED=NO build` - exit 0; `PastaKeyboard.appex` compiled and
  embedded in `Pasta.app/PlugIns`.
- 2026-06-27 - `cd docs-site && bun install --frozen-lockfile && bun run build
  -- --base /` - exit 0; existing docs stack built 15 pages after locked docs
  dependency install in the isolated worktree.
- 2026-06-27 - `git diff --check` plus `gdd_status.py --author
  docs/goals/19-ios-control-files-history-keyboard-performance.md` - exit 0;
  goal parsed with 4/5 DoD complete and T5 next.

### T4B - Fix Keyboard Autocomplete Latency Regression - [x]

- Re-check KeyboardKit and Pasta-owned typing hot paths after device-reported
  keypress latency.
- Remove avoidable main-actor autocomplete work from ordinary typing.
- Coalesce stale autocomplete requests without replacing KeyboardKit input
  handling, autocomplete toolbar, globe behavior, or Pasta publish/paste
  actions.
- Keep the fix local to keyboard latency; do not change clipboard privacy or
  Worker/API behavior.

Verification Contract:

- The committed benchmark models the checked-in optimized autocomplete path and
  gates on at least 60% improvement.
- `swift test --package-path ios` and a simulator keyboard build pass.
- Docs record the current root cause, fix, and benchmark numbers.

**Confidence:** 92/100
**Closes:** DoD-4
**Evidence:**

- 2026-06-28 - root-cause readback - KeyboardKit
  `KeyboardInputViewController.performAutocomplete` dispatches service updates
  from the controller, and `KeyboardAction.StandardActionHandler` calls
  `keyboardController?.performAutocomplete()` after key release. Pasta's prior
  service still allowed typing-path autocomplete work to run for ordinary
  keypresses while using system spellchecking/completion work.
- 2026-06-28 - implementation -
  `ios/Keyboard/KeyboardViewController.swift` now debounces autocomplete for
  `24 ms`, cancels stale tasks, and delegates the latest request back through
  KeyboardKit's `autocomplete(_:updating:)` path; `PastaAutocompleteService`
  now uses a bounded pure Swift engine with a precomputed completion prefix
  index instead of `UITextChecker` or `MainActor.run` work on each keypress.
- 2026-06-28 - `swift test --package-path ios` - exit 0; 35 XCTest tests
  executed, 1 gated live-relay smoke skipped without `PASTA_IOS_JOIN_TOKEN`,
  0 failures. New tests cover debounce bounds, bounded autocomplete context,
  ignored corrections, casing, and prefix-indexed local suggestions.
- 2026-06-28 - keyboard hot-path benchmark - `swift
  ios/Benchmarks/KeyboardHotPathBenchmark.swift --iterations 40000 --mode both
  --min-improvement-percent 60` - exit 0; `baseline.layout_rebuild:
  236.300 ms`, `baseline.autocomplete_new_checker: 4635.628 ms`,
  `baseline.autocomplete_eager_stale_and_current: 1864.634 ms`,
  `baseline.layout_single_entry_case_churn: 211.157 ms`,
  `optimized.layout_cache: 144.806 ms`,
  `optimized.autocomplete_bounded_engine: 1903.192 ms`,
  `optimized.autocomplete_debounced_latest: 53.356 ms`,
  `optimized.layout_multientry_case_cache: 145.640 ms`,
  `baseline.total: 6947.720 ms`, `optimized.total: 2246.995 ms`,
  improvement `4700.725 ms` / `67.659% faster`.
- 2026-06-28 - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS
  Simulator' -derivedDataPath ios/build/DerivedDataLatencyFix
  CODE_SIGNING_ALLOWED=NO build` - exit 0; app and embedded
  `PastaKeyboard.appex` compiled with the debounced autocomplete controller.
- 2026-06-28 - `cd docs-site && bun run build -- --base /` - exit 0; built
  16 docs pages after documenting the current latency root cause, fix, and
  benchmark numbers.
- 2026-06-28 - `git diff --check` plus `gdd_status.py --author
  docs/goals/19-ios-control-files-history-keyboard-performance.md` - exit 0;
  goal parsed with 5/5 DoD covered and no authoring violations.

### T5 - Integrate, Release, And Prove Distribution - [x]

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

**Confidence:** 95/100
**Closes:** DoD-5
**Evidence:**

- 2026-06-27 - merge/release integration - feature branches were merged into
  local `main`; `50458ab Merge iOS keyboard number row fix` kept the
  KeyboardKit numeric mode while removing Pasta's alphabetic number row;
  release commit `21ecdce Prepare 0.1.9 release` bumped CLI and iOS versions to
  `0.1.9` and iOS build number to `15`; final evidence commits were pushed to
  `origin/main`.
- 2026-06-27 - `mise exec -- bun run check` - exit 0; Worker types generated,
  30 Bun tests passed, and 14 Vitest Worker tests passed.
- 2026-06-27 - `swift test --package-path ios` - exit 0; 21 XCTest tests
  executed, 1 gated live-relay test skipped without `PASTA_IOS_JOIN_TOKEN`, 0
  failures.
- 2026-06-27 - `cd docs-site && bun run build -- --base /` - exit 0; built
  15 docs pages.
- 2026-06-27 - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS
  Simulator' -derivedDataPath ios/build/DerivedData CODE_SIGNING_ALLOWED=NO
  build` - exit 0; app and embedded keyboard extension compiled.
- 2026-06-27 - integrated keyboard benchmark - `swift
  ios/Benchmarks/KeyboardHotPathBenchmark.swift --iterations 40000 --mode both`
  - exit 0; `baseline.total: 5410.186 ms`, `optimized.total: 2243.177 ms`,
  improvement `3167.009 ms` / `58.538% faster`; checksums matched
  (`234720000` layout, `691434` autocomplete).
- 2026-06-27 - `gh run watch 28301354707 --repo thehumanworks/pasta
  --exit-status` - exit 0; final pushed `main` workflow completed portable
  checks, release asset build, and latest artifact upload.
- 2026-06-27 - release workflow `28301314347` for tag `v0.1.9` - success;
  portable checks, release asset build, artifact upload, and GitHub release
  publish all succeeded.
- 2026-06-27 - `git ls-remote origin refs/heads/main refs/tags/v0.1.9` - exit
  0; tag `v0.1.9` points at release commit `21ecdce`, and `origin/main`
  includes the release and evidence commits.
- 2026-06-27 - `gh release view v0.1.9 --repo thehumanworks/pasta` - exit 0;
  release URL `https://github.com/thehumanworks/pasta/releases/tag/v0.1.9`
  published 9 assets: `checksums.txt` plus 8 platform archives.
- 2026-06-27 - isolated release install proof from a temporary cwd - `mise exec
  github:thehumanworks/pasta@v0.1.9 -- pasta --version` - exit 0; downloaded
  `pasta-v0.1.9-macos-arm64.tar.gz`, verified checksum, attestations, and SLSA
  provenance, extracted the binary, and printed `0.1.9`.
- 2026-06-27 - iOS archive/export/upload - `archive_upload.sh` with
  `SCHEME=Pasta`, `CONFIGURATION=Release`, `DEVELOPMENT_TEAM=54MXM5JG3R`,
  `APP_STORE_CONNECT_API_PRIVATE_KEY_PATH=ios/build/asc/AuthKey.p8`,
  `EXPECT_NO_NON_EXEMPT_ENCRYPTION=1`, and
  `TESTFLIGHT_BETA_GROUP_NAME=internal` - exit 0; produced
  `ios/build/export-0.1.9-15/Pasta.ipa`, uploaded to App Store Connect, and
  completed TestFlight group assignment.
- 2026-06-27 - IPA inspection - `inspect_ipa.sh
  ios/build/export-0.1.9-15/Pasta.ipa` - exit 0; bundle
  `com.thehumanworks.pasta`, version `0.1.9`, build `15`, SDK `iphoneos27.0`,
  `ITSAppUsesNonExemptEncryption=false`, `get-task-allow=false`, and nested
  `com.thehumanworks.pasta.keyboard` appex version `0.1.9`.
- 2026-06-27 - App Store Connect proof - `app_store_connect.py wait-build
  --bundle-id com.thehumanworks.pasta --version 15 --json` - exit 0; app
  `6785005536`, build `8083eab8-6cfd-42a7-b0be-960ab962a4a6`, version `15`,
  `processingState=VALID`, `expired=false`, `usesNonExemptEncryption=false`.
- 2026-06-27 - TestFlight proof - `release-to-testflight` log shows group
  `internal` (`91ffd61d-626c-44e4-ab22-552d858c3d0b`) is an internal group
  with `hasAccessToAllBuilds=True`; build `15` is visible in the group as
  `VALID`.

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
