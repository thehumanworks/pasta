# ADR 0002: Native iOS Keyboard Rendering Uses KeyboardKit

## Status

Accepted for the native iOS expansion.

## Date

2026-06-27

## Context

Pasta's keyboard must remain usable as an ordinary iOS keyboard, including
letters, number and symbol modes, shift, delete, return, space, callouts, sizing,
and input-mode behavior. A hand-built key grid made this easy to prototype but
left too much keyboard structure, sizing, and mode switching in Pasta-specific
code.

The crypto layer already uses libraries for protocol primitives: CryptoKit for
SHA-256, X25519, and HKDF, SwiftSodium/libsodium for Ed25519 and
XChaCha20-Poly1305, and @noble packages on the TypeScript side.

## Decision

Use KeyboardKit as the native iOS keyboard rendering and layout engine. Pasta is
purely additive: KeyboardKit owns the keys, input handling, sizing, modes,
callouts, and the keyboard-switch (globe) key, while Pasta keeps only its
product-specific action row, clip insertion actions, and Full Access gates. The
action row renders inside KeyboardKit's native `toolbar:` slot (the band that
normally holds QuickType suggestions); Pasta does not edit the generated layout
and does not stack its own chrome around `KeyboardView`. The row is a fixed
native-height `Publish` plus `Paste` menu surface; live history refresh happens
automatically when Full Access and pairing state allow it.

KeyboardKit is pinned through XcodeGen as an exact Swift Package dependency.

## Consequences

Pasta relies on a maintained keyboard framework for native-like alphabetic,
numeric, symbolic, callout, sizing, and action behavior instead of manually
creating every key row.

The dependency must be kept pinned and verified by Xcode app/extension builds.
Pasta-specific code still owns privacy-sensitive behavior: no ordinary keystroke
publishing, no silent pasteboard read, and no plaintext secret storage.

Pasta's action row is mounted directly inside KeyboardKit's `toolbar:` slot. In
KeyboardKit 9.9.1 that slot adds no background of its own; the framework already
composes the keyboard as `VStack { toolbar; keys }` and paints one surface behind
both. An earlier revision wrongly concluded the slot itself painted a strip and
moved the row to a sibling above `KeyboardView` with a zero-height toolbar,
`renderBackground: false`, a hand-painted background, and
`.ignoresSafeArea(.top)`. That stack is what produced the cropped, detached
strip. Later attempts also showed that a hand-picked row fill, chip background,
or horizontally scrollable shelf creates a visible tone mismatch. The corrected
rule: use the slot, keep the Pasta row/buttons transparent, delete the sibling/
zeroed-toolbar/ignoresSafeArea workarounds, and supply opacity with an explicit
`keyboardViewStyle(background: .color(.keyboardBackground))` because the standard
style service's background is transparent.

KeyboardKit layouts are generated from a `KeyboardContext` snapshot. Pasta
observes that context so its view re-evaluates, and refreshes the `KeyboardView`
`.id` only on structural changes (keyboard type, orientation, screen size, device
class). It does not key `.id` on `keyboardCase`: KeyboardKit handles shift/case
reactively, and rebuilding on every auto-capitalization flip would tear the
keyboard down mid-typing and cancel in-flight gestures.

The visual result of this composition is only fully proven on a real device or
TestFlight build; goal-14 records that this defect class survived a green
simulator build and was exposed only by a device screenshot.

## Alternatives Considered

- **Manual UIKit key grid**: rejected after feedback because it made Pasta
  responsible for too much stock-keyboard behavior and sizing.
- **A paste-only keyboard**: rejected because Pasta must remain usable after the
  user switches into it.
- **Embedding the Apple keyboard**: impossible through public iOS APIs; a custom
  keyboard extension owns its UI.
