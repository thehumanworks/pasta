---
title: Native iOS
slug: native-ios
description: The iOS product shape: keyboard-first text paste, share-sheet publish, shortcuts, and binary handoff.
nav_order: 10
---

<!-- @human -->
## UX decision

Pasta's native iOS experience is **keyboard-centered**, with the app acting as setup and control plane.

That is the most adequate choice from a UX standpoint because it is the only Apple-supported surface that can appear inside other apps while the user is typing. A Share extension, Shortcut, widget, Control Center control, or File Provider can feel native, but none of those can insert into the focused text field. A custom keyboard can.

The practical promise is therefore precise:

> Pasta can paste **text history** anywhere iOS allows third-party keyboards.

That excludes secure password fields, phone pads, and apps that opt out of custom keyboards. Those exclusions are iOS platform rules, not Pasta policy.

## What ships on iOS

The iOS bundle has four surfaces:

| Surface | What it does | Why it exists |
| --- | --- | --- |
| Pasta app | Pair the phone, manage trusted devices, browse history, explain keyboard access, publish the current iPhone clipboard by explicit tap | Required container and trust surface |
| Pasta keyboard | Type normally, open a Paste menu for text history, insert selected text clips with one tap, optionally publish the iPhone clipboard | Closest OS-embedded paste experience |
| Share extension | Publish selected/shared text, URLs, images, PDFs, and files into Pasta | Best native "copy to Pasta" path from other apps |
| App Intents / Shortcuts / Controls | Publish Clipboard, Copy Latest Text to Clipboard, Open/Search Pasta History | OS-native command surfaces for Action Button, Control Center, Siri, Spotlight, and Shortcuts |

File Provider integration is a later add-on for file and directory history in Files. It is not the core paste-anywhere mechanism.

## Keyboard behavior

The keyboard is intentionally close to the stock iOS keyboard in daily use:

- normal typing remains the default interaction;
- KeyboardKit renders the keyboard-switch (globe) key whenever iOS requires it, so users always have a way to switch keyboards; Pasta no longer strips it;
- letter, number (`123`), and symbol (`#+=`) keyboard modes are present so the keyboard remains usable for ordinary iOS text entry;
- letter keys follow iOS-style case behavior: lowercase in normal typing, single-shift uppercase, and caps lock only through the standard shift interaction;
- Pasta's actions live in KeyboardKit's native top toolbar slot (the band that normally holds QuickType suggestions), on one continuous keyboard surface with the keys below and no separate strip or spacer above them;
- action labels stay readable over the keyboard surface and match the native suggestion-row height and centering;
- the visible toolbar controls are **Publish** and **Paste**;
- Paste opens a history menu; selecting a text item inserts it into the active text field;
- Pasta never publishes ordinary keystrokes as clips.

The keyboard has two operating levels:

| Mode | Capability | Tradeoff |
| --- | --- | --- |
| Standard keyboard access | Type normally and insert cached Pasta text history that the app previously synced | No live network, no shared app container updates from the keyboard |
| Full Access enabled | Automatic live history refresh, signed Pasta publish/paste requests, explicit iPhone clipboard import | Requires the user to trust Pasta's keyboard extension with expanded iOS sandbox access |

Full Access is requested because live Pasta history requires network and shared app-group storage. The keyboard remains useful without it by showing cached text history.

## Publishing from iOS

iOS does not allow a third-party app to run a silent global clipboard daemon. Copying text or media in another app cannot automatically publish to Pasta in the desktop-daemon sense.

Publishing is explicit and user-initiated:

- use **Share to Pasta** from any app that exposes the Share sheet;
- tap **Publish Clipboard** in the Pasta keyboard;
- run the **Publish Clipboard to Pasta** Shortcut/App Intent;
- open Pasta and use the paste/import control.

This keeps Pasta aligned with Apple pasteboard privacy prompts and makes the data boundary obvious.

## Images, files, and directories

Direct keyboard insertion is text-only. Non-text history remains available, but the keyboard routes it to actions that iOS supports:

| Clip type | Keyboard action | App/share action |
| --- | --- | --- |
| Image | Copy image to iPhone clipboard, open preview, share | Publish from Photos/Files/share sheet; export to target app |
| File | Copy/export via share sheet, open in Pasta | Publish through Share extension or app document picker |
| Directory bundle | Open in Pasta, export zip/directory representation, later Files integration | Publish from Files as a Pasta directory bundle where iOS grants access |

Directory clips keep Pasta's existing bundle contract: a directory is zipped locally, encrypted locally, uploaded as a file payload with the Pasta directory MIME, and extracted locally by trusted devices. Normal `.zip` files remain normal files.

## Metadata and smart restrictions

The keyboard can always make the safe decision from public clip metadata:

- `payloadKind: "text"` is insertable;
- `payloadKind: "image"` is not text-insertable;
- `payloadKind: "file"` is not text-insertable;
- `mime: "application/vnd.pasta.directory+zip"` is a directory bundle and must not be treated as normal text or a generic zip.

For richer iOS presentation, Pasta stores additional display hints in encrypted clip metadata, visible only to trusted devices:

- `displayName`
- `contentType` / UTType
- `suggestedExtension`
- `imageDimensions`
- `fileCount`
- `directoryEntryCount`
- `textFallback` when a user intentionally attaches one
- `sourcePlatform` and optional `sourceApp`

Cloudflare still sees only the existing routing metadata: kind, MIME, byte length, device, sequence, and timing.

## Footguns

**Do not promise "everywhere."** The right phrase is "where iOS allows third-party keyboards."

**Do not promise background copy monitoring.** iOS publish is explicit through Share, Shortcut, keyboard action, or the Pasta app.

**Do not make the keyboard a clipboard exfiltration surface.** The keyboard only publishes when the user taps a Pasta publish action.

**Do not treat binary clips as paste-anywhere content.** Images, files, and directories need clipboard/share/app/File Provider handoff, not text-field insertion.

**Do not leak filenames or directory paths.** User-facing names and binary summaries belong in encrypted metadata, not Worker, Durable Object, R2, logs, or analytics.

**Mount the Pasta action row inside KeyboardKit's `toolbar:` slot — do not build a sibling strip.** KeyboardKit already composes the keyboard as `VStack { toolbar; keys }` on one surface, and in 9.9.1 the `toolbar:` slot adds no background of its own. Return `PastaKeyboardToolbar(...)` from the slot and let the keys render natively below it. Do not rebuild a sibling row above `KeyboardView`, do not pass `EmptyView()` with a zero-height autocomplete toolbar, and do not `.ignoresSafeArea(.top)` to pin a hand-painted band — those are what produced the cropped, detached strip. Opacity must come from an explicit `keyboardViewStyle` background (`.color(.keyboardBackground)`); the standard style service's background is transparent, so `renderBackground` alone paints nothing.

**Keep the toolbar row and buttons transparent.** The action labels should sit directly on KeyboardKit's `keyboardBackground` surface. Do not add a hand-picked gray row fill, chip backgrounds, pressed-state fills, or a horizontally scrollable shelf; those make the toolbar read as a second surface with a different tone.

**Observe `KeyboardContext` and let KeyboardKit react; do not key `.id` on case.** Build the layout from the observed `KeyboardContext` so the view re-evaluates on context changes, and refresh the `KeyboardView` `.id` only on structural changes (keyboard type, orientation, size, device class). Never key `.id` on `keyboardCase`: KeyboardKit updates shift/case reactively, and rebuilding on every auto-capitalization flip tears the whole keyboard down mid-typing and cancels in-flight gestures.

**Do not use SwiftUI preview as keyboard chrome proof.** The visible top strip, safe-area slack, globe behavior, dictation key, and host keyboard height only show up correctly in the custom keyboard extension host. Verify with simulator/device install and PluginKit registration, and prefer a TestFlight device readback for final UX feedback.

**Do not make the Pasta shelf a short clipped chip strip.** Native-looking iOS keyboard action rows, such as Grammarly's, use the full suggestion-row height with centered content, plain text segments, subtle separators, and full-height hit targets. A 36pt row with bordered chips and `.clipped()` makes text look blurred, cramped, and cut off beside the stock keys.

## Setup flow

1. Install and open Pasta.
2. Pair the iPhone as a normal trusted device using the existing Pasta pairing flow.
3. Enable the Pasta keyboard in iOS Settings.
4. Optionally enable Full Access after reviewing the in-app explanation.
5. Use the keyboard **Paste** menu to insert text into supported fields.
6. Use Share to Pasta or Publish Clipboard for explicit publishing from iOS.

<!-- @agent -->
## Chosen implementation shape

The iOS work uses a native bundle with:

- containing app: onboarding, pairing, history browser, device management, settings, clipboard import/export;
- custom keyboard extension: KeyboardKit-rendered Apple-like typing surface plus Pasta text history insertion;
- share extension: publish selected/shared text, URLs, images, PDFs, and files;
- App Intents + App Shortcuts + controls: publish clipboard, copy latest text, open/search history;
- optional later File Provider: file/directory browsing from Files and document pickers.

Do not replace this with a background clipboard monitor, P2P sync path, LAN discovery, VPN/tailnet dependency, or a standalone "copy button" app. The custom keyboard is the UX anchor because it is the only public iOS surface that can insert into the active text document in another app.

The keyboard structure uses KeyboardKit for stock keyboard layout, sizing,
letters, number/symbol modes, callouts, the keyboard-switch (globe) key, and key
action handling. Pasta code owns only the product-specific action row (rendered
in KeyboardKit's native toolbar slot), privacy gates, and cached history
insertion. Pasta no longer edits the generated layout.

## Apple constraints to preserve

- Custom keyboards insert strings through `UITextDocumentProxy.insertText`; they do not invoke the host app's Paste command.
- Custom keyboards are unavailable in secure text fields, phone pads, and apps that reject third-party keyboards.
- A custom keyboard is not the Apple keyboard plus a plugin slot. Pasta owns and maintains the keyboard UI and normal typing behavior; KeyboardKit provides the keyboard-switch (globe) key when iOS requires it.
- Network access, shared app-group storage, and pasteboard access from the keyboard require `RequestsOpenAccess` plus user-granted Full Access.
- App Review expects the keyboard to remain functional without Full Access. Keep cached text history available through the containing app sync path.
- iOS has no public always-on clipboard daemon for third-party apps. Publish from iOS must be user-initiated.
- `UIPasteControl` is only for prompt-aware paste into Pasta's own UI. It is not a global paste listener.
- App Intents, Shortcuts, widgets, and Control Center controls can set clipboard or launch/perform app actions; they cannot insert into the current text field.
- Share extensions are host-driven and short-lived; use background `URLSession` only when needed for larger uploads and keep shared container coordination explicit.

Primary Apple docs to recheck before implementation:

- Custom Keyboard Programming Guide: `https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/CustomKeyboard.html`
- Open Access for custom keyboards: `https://developer.apple.com/documentation/uikit/configuring-open-access-for-a-custom-keyboard`
- App Review keyboard extension rules: `https://developer.apple.com/app-store/review/guidelines/#extensions`
- `UIPasteControl`: `https://developer.apple.com/documentation/uikit/uipastecontrol`
- App Intents: `https://developer.apple.com/documentation/appintents/appintent`
- Share extensions: `https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html`
- File Provider: `https://developer.apple.com/documentation/fileprovider`

## Pasta protocol reuse

Treat iOS as another trusted Pasta device. Reuse the existing central-service protocol; do not add mobile-specific backend routes unless an existing endpoint cannot express the action.

Key repo docs:

- `docs/protocol.md` - endpoint map, signed headers, auth semantics
- `docs/binary-payloads.md` - image/file/directory payload contract
- `docs/threat-model.md` - accepted metadata leakage and trust boundaries
- `docs-site/content/native-ios.md` - human and agent iOS UX contract
- `docs-site/content/payloads.md` - user-facing binary payload behavior

Key source paths:

- `src/shared/protocol.ts` - constants, `PayloadKind`, `EncryptedClip`, AAD shape
- `src/shared/crypto.ts` - stable JSON, AAD hash, text/bytes encryption, metadata encryption
- `src/cli/client.ts` - canonical signed request construction
- `src/cli.ts` - publish/paste/history command semantics to mirror in Swift
- `src/cli/directory-zip.ts` - directory bundle invariants
- `src/worker/index.ts` - signed route auth and validation
- `src/worker/clipboard-space.ts` - DO clip rows, R2 pointers, retention

## Swift core requirements

Build a shared Swift package used by the app, keyboard extension, share extension, intents, and tests. It must provide:

- base64url encode/decode with no padding;
- stable JSON serialization that matches `stableJson` byte-for-byte;
- SHA-256 body hash and AAD hash helpers;
- Ed25519 request signing with Pasta canonical request strings;
- X25519 group-key wrapping/unwrapping for pairing;
- HKDF-SHA256 for pairing grants;
- XChaCha20-Poly1305 for text, bytes, and encrypted metadata;
- `EncryptedClip`, `StoredClip`, `ClipMetadata`, and endpoint request/response models;
- Keychain access-group storage for group key, signing private key, wrapping private key;
- App Group shared store for non-secret config, cached text history, sync timestamps, and keyboard state.

Do not store the group key or private keys in `UserDefaults`, app-group files, logs, crash breadcrumbs, or analytics. Keychain access group is the only shared secret surface.

## Extension data flow

### Text insertion from keyboard

1. Keyboard loads cached text history from App Group storage.
2. If Full Access is enabled and network is reachable, keyboard automatically signs `GET /v1/clips/history?limit=...` on appearance.
3. Swift core decrypts text clips locally.
4. Keyboard renders decrypted previews in memory only.
5. User taps a text clip.
6. Keyboard calls `textDocumentProxy.insertText(plaintext)`.
7. No host app pasteboard operation occurs.

### Explicit iPhone clipboard publish

1. User taps Publish Clipboard in keyboard/app/control/shortcut.
2. Use the most privacy-preserving user-intent surface available:
   - in app UI, prefer `UIPasteControl` or user-tapped paste action;
   - in keyboard Full Access mode, read `UIPasteboard.general` only after the explicit tap.
3. Convert supported data to Pasta payload:
   - string -> `payloadKind: "text"`, `POST /v1/clips`;
   - image data -> image/file payload depending size and representation;
   - file URL from document/share context -> `payloadKind: "file"`, `POST /v1/files`;
   - directory URL from Files context -> local zip bundle with Pasta directory MIME.
4. Encrypt locally and send signed request.
5. Update cached history after success.

### Share extension publish

1. Host app invokes Share to Pasta with `NSExtensionItem` attachments.
2. Use `NSItemProvider` / Transferable loading for text, URL, image, file URL, or data.
3. Normalize to Pasta payload kinds without exposing local paths:
   - encrypt basename/display name as metadata;
   - keep Worker-visible metadata to kind, MIME, byte length, timing, device, sequence.
4. For large files, use extension-safe temporary files and background upload only when needed.
5. Complete or fail the extension request with a concise result.

### App Intent actions

Implement narrow intents:

- `PublishClipboardToPastaIntent`
- `CopyLatestPastaTextToClipboardIntent`
- `OpenPastaHistoryIntent`
- `SearchPastaHistoryIntent`

Do not expose every app screen as an intent. Keep entities small: clip sequence, display title, kind, created time, and insertability.

## Binary and directory handling

Keyboard insertion is text-only. For non-text clips:

- render as disabled for direct insert;
- actions: Copy to iPhone Clipboard, Open in Pasta, Share/Export, Delete;
- for directory bundles, prefer Open in Pasta or Files/File Provider handoff;
- never auto-extract a normal `.zip` as a Pasta directory;
- only MIME `application/vnd.pasta.directory+zip` receives directory-bundle treatment.

Current public metadata is enough for hard gating, but a polished iOS UI should use encrypted metadata:

```typescript
interface ClipMetadata {
  name?: string
  displayName?: string
  contentType?: string
  suggestedExtension?: string
  imageDimensions?: { width: number; height: number }
  fileCount?: number
  directoryEntryCount?: number
  textFallback?: string
  sourcePlatform?: "ios" | "macos" | "linux" | "windows"
  sourceApp?: string
}
```

Backfill metadata in a backwards-compatible way: unknown fields are ignored by old clients; missing fields degrade to `payloadKind`, MIME, byte length, and encrypted `name`.

## Issues encountered and fixes

**Issue: the action row read as a cropped strip glued to the top of the keyboard, detached from the keys.**
Why it happened: Pasta rendered the action row as a sibling *above* `KeyboardView` in an outer `VStack`, passed `EmptyView()` into KeyboardKit's `toolbar:` slot with a zero-height autocomplete toolbar, set `renderBackground: false`, hand-painted the surface, and pinned it with `.ignoresSafeArea(.top)`. The row shared the key background with no separation and butted against the keyboard's top edge, so its buttons looked cropped instead of seated in a toolbar. The earlier belief that the `toolbar:` slot itself paints chrome was a misdiagnosis: in KeyboardKit 9.9.1 the slot adds no background, and the visible band came from the hand-painted sibling and stacked containers.
Fix: render the action row through KeyboardKit's `toolbar:` slot as `PastaKeyboardToolbar(...)`; delete the outer `VStack`/sibling, the `EmptyView()` slot, the zeroed autocomplete toolbar, and the `.ignoresSafeArea` hand-painted band; and set one explicit opaque surface with `keyboardViewStyle(background: .color(.keyboardBackground))`. KeyboardKit then lays out `VStack { Pasta row; native keys }` on a single continuous surface, like the native QuickType band.
Agent warning: do not claim this chrome is fixed from source review or a green simulator build alone. The previous strip survived a successful TestFlight build and only a device screenshot exposed it; a device/TestFlight readback is the final proof.

**Issue: the Pasta shelf still looked blurry and clipped compared with Grammarly.**
Why it happened: Pasta used a 36pt horizontally clipped scroll row with bordered white chips. The stock key rows are much taller, so the shelf read as compressed chrome instead of a native suggestion/action row.
Fix: use a 48pt native-height shelf, remove vertical clipping, center all labels in full-height hit areas, use plain text action/suggestion segments with subtle dividers, and reserve chip-like backgrounds only for pressed feedback.
Agent warning: compare against real third-party keyboards in the same host app. The action labels should be crisp, vertically centered, and never cut off by the next key row.

**Issue: the toolbar still had a slightly different tone from the key surface.**
Why it happened: Pasta hand-picked a gray row fill and earlier used scroll/chip treatments, so even transparent buttons sat on a different surface from the native key background.
Fix: keep the toolbar row and all button/menu labels backgroundless, use KeyboardKit's `Color.keyboardBackground` as the single SwiftUI keyboard surface, and use the same KeyboardKit asset values only as the UIKit host-view fallback.

**Issue: the keyboard looked permanently caps-locked and could not type lowercase.**
Why it happened: a KeyboardKit layout is a snapshot. Pasta was allowing KeyboardKit to build one layout during setup, then wrapping it without observing enough live keyboard context for case/type changes. When the layout remains in an uppercased state, the displayed key labels and inserted character actions can both remain uppercase.
Fix: observe `KeyboardContext`, pass an explicit layout generated from the current context, keep KeyboardKit's conditional `nextKeyboard` (globe) item, and rebuild the KeyboardView identity only on structural changes (keyboard type, orientation, size, device class) — never on `keyboardCase`.
Agent warning: case is behavior, not styling. Verify inserted lowercase text, single-shift uppercase, caps lock, `123`, and `#+=` in a real text field.

**Issue: keyboard looked embedded but failed review risk because it required Full Access.**
Fix: keep the keyboard functional without Full Access by reading cached text history from the containing app's last sync, and explain that live refresh/publish needs Full Access.

**Issue: initial prototype tried to "paste" binary clips from the keyboard.**
Fix: remove binary insertion promises. Custom keyboard insertion is string-only; non-text clips route to copy/share/open actions.

**Issue: iOS pasteboard reads triggered privacy prompts in surprising places.**
Fix: move pasteboard reads behind explicit user taps and use `UIPasteControl` in the containing app when importing the system clipboard.

**Issue: Swift JSON did not match TypeScript `stableJson`, causing AAD/signature failures.**
Fix: add cross-language golden vectors for canonical JSON, AAD hash, signed request headers, text clip encryption, bytes clip encryption, metadata encryption, and pair wrapping before implementing UI.

**Issue: XChaCha20-Poly1305 is not available through CryptoKit.**
Fix: use a vetted Swift implementation with test vectors matching `src/shared/crypto.ts`, or only migrate protocol primitives after all desktop clients are upgraded. Do not silently swap to AES-GCM for iOS.

**Issue: extension and app shared state corrupted under concurrent writes.**
Fix: keep secrets in Keychain access group, keep app-group cache non-secret, use a small SQLite store or coordinated file writes for cached history, and never let the keyboard write large payload files directly into the cache.

**Issue: filenames and directory paths leaked through friendly iOS labels.**
Fix: put display labels, source app, file counts, and directory summaries inside encrypted clip metadata. Keep Worker/DO/R2 metadata free of plaintext names and paths.

**Issue: App Intents became a second product surface with too many actions.**
Fix: keep intents to four verbs: publish clipboard, copy latest text, open history, search history. Route complex binary handling back to app/share surfaces.

## Verification checklist for future agents

Before claiming iOS parity:

- cross-language crypto vectors pass in Swift and Bun;
- iOS app can pair as a trusted device and decrypt existing text history;
- keyboard inserts text history into a normal text field;
- the Pasta action row renders in KeyboardKit's native toolbar slot on one continuous keyboard surface, with no separate strip or spacer above it;
- the Pasta action row uses a full-height native suggestion-row style, with crisp unblurred labels and no vertical clipping;
- KeyboardKit's keyboard-switch (globe) key is present whenever iOS reports it is needed;
- keyboard can type lowercase, single-shift uppercase, caps lock, delete, return, space, `123`, and `#+=` through KeyboardKit's native behavior;
- keyboard gracefully disappears or is replaced in secure fields/phone pads as iOS dictates;
- keyboard works without Full Access using cached text history;
- Full Access mode automatically refreshes history and publishes only after explicit user action;
- Share extension publishes text, URL, image, and file without plaintext metadata leakage;
- App Intents publish clipboard and copy latest text to clipboard;
- non-text clips never claim direct paste-anywhere support;
- directory bundles preserve `application/vnd.pasta.directory+zip` semantics;
- docs build with `cd docs-site && bun run build -- --base /pasta/`.
