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

Use KeyboardKit as the native iOS keyboard rendering and layout engine. Pasta
keeps only its product-specific toolbar, clip insertion actions, Full Access
gates, and layout policy that removes the `nextKeyboard` action when iOS already
presents input-mode switching.

KeyboardKit is pinned through XcodeGen as an exact Swift Package dependency.

## Consequences

Pasta relies on a maintained keyboard framework for native-like alphabetic,
numeric, symbolic, callout, sizing, and action behavior instead of manually
creating every key row.

The dependency must be kept pinned and verified by Xcode app/extension builds.
Pasta-specific code still owns privacy-sensitive behavior: no ordinary keystroke
publishing, no silent pasteboard read, and no plaintext secret storage.

## Alternatives Considered

- **Manual UIKit key grid**: rejected after feedback because it made Pasta
  responsible for too much stock-keyboard behavior and sizing.
- **A paste-only keyboard**: rejected because Pasta must remain usable after the
  user switches into it.
- **Embedding the Apple keyboard**: impossible through public iOS APIs; a custom
  keyboard extension owns its UI.
