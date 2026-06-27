# Pasta Native iOS Workspace

This directory is the native iOS build workspace seed. It starts as a SwiftPM
package for shared core code because the app, keyboard extension, share
extension, App Intents, and future File Provider work all need the same protocol,
crypto, model, and storage layer.

## Current Scaffold

- `Package.swift` defines the `PastaCore` library and `PastaCoreTests`.
- `Sources/PastaCore` contains bootstrap constants and surface modeling.
- `Tests/PastaCoreTests` proves the scaffold compiles and encodes the current
  UX contract: text clips are insertable from the keyboard; binary and directory
  clips require handoff.

## Commands

```bash
swift build --package-path ios
swift test --package-path ios
```

The package supports iOS 17+ for app/extension targets and macOS 14+ for local
unit tests. App Intents, Controls, and newer iOS surfaces must be guarded with
availability checks when the Xcode project lands.

## Build Authority

Local SwiftPM commands are useful for `PastaCore` unit tests and fast protocol
work. They are not authoritative proof for the eventual iOS app, keyboard
extension, share extension, App Intents extension, archives, or release builds.

The current development host runs macOS 27 beta 2, so native Xcode app/extension
build proof must come from Xcode Cloud. Local simulator or physical-device runs
can still be useful behavioral smoke when they are possible, but future goals
should treat Xcode Cloud build/test/archive evidence as the source of truth for
Xcode target compatibility.

## Target Plan

Future implementation should add an Xcode workspace or project that embeds this
package in these bundle targets:

- Pasta app: pairing, device management, history browser, settings, and explicit
  clipboard import/export.
- Pasta keyboard extension: Apple-like typing surface, cached text history, text
  insertion, optional Full Access live refresh, and explicit Publish Clipboard.
- Pasta share extension: host-driven publish for text, URLs, images, PDFs,
  files, and directory URLs granted by Files.
- App Intents extension: narrow actions for publish clipboard, copy latest text,
  open history, and search history.
- File Provider extension if the binary handoff goal confirms it is worth the
  added review and maintenance cost.

## Shared-State Rules

- Store private keys and group keys in a Keychain access group only.
- Store non-secret configuration, cached text history, sync timestamps, and
  keyboard state in the App Group container.
- Do not store group keys, signing private keys, wrapping private keys, plaintext
  clips, filenames, directory paths, or decrypted previews in `UserDefaults`,
  app-group files, logs, crash breadcrumbs, or analytics.
- Keep the keyboard useful without Full Access by loading app-synced cached text
  history.
- Treat Full Access as permission for live sync and explicit clipboard publish,
  not as permission to publish keystrokes or silently monitor the pasteboard.

## Source Of Truth

- `docs-site/content/native-ios.md` - human and agent iOS UX contract.
- `docs/adrs/0001-native-ios-keyboard-centered.md` - accepted architecture
  decision.
- `docs/goals/11-ios-build-environment.md` through
  `docs/goals/17-ios-integration-release-readiness.md` - GDD delivery stack.
