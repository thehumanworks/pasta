# ADR 0001: Native iOS Uses A Keyboard-Centered UX

## Status

Accepted for the native iOS expansion.

## Date

2026-06-27

## Context

Pasta needs to let an iPhone user paste from Pasta history while they are already
inside another iOS app. iOS does not provide a public API for a third-party app
to monitor the global clipboard in the background or to inject content into
another app's focused text field from a normal app, widget, shortcut, control, or
share extension.

The current human and agent contract lives in
`docs-site/content/native-ios.md`.

## Decision

Pasta's native iOS product uses a custom keyboard as the primary paste-anywhere
surface for text history. The containing app is the setup, pairing, history,
settings, and trust surface. A Share extension publishes selected content from
other apps. App Intents and Shortcuts expose narrow command surfaces. Binary,
file, and directory clips use clipboard, share, app, document picker, and later
File Provider handoff rather than direct text-field insertion.

The implementation must preserve these constraints:

- the keyboard inserts only text through the active text document proxy;
- the keyboard remains useful without Full Access by reading cached text history;
- live refresh, network, shared app-group reads, and clipboard import require
  explicit Full Access and user intent;
- iOS publish is explicit, never a silent background clipboard daemon;
- non-text clips are never represented as insertable text unless the user
  intentionally supplied a text fallback;
- encrypted metadata can improve presentation, but Worker-visible metadata must
  remain limited to the existing Pasta protocol boundary.

## Consequences

The UX is the closest Apple-supported option to feeling embedded in the OS, but
it is not literally the Apple keyboard and it cannot run in secure text fields,
phone pads, or apps that reject third-party keyboards.

The engineering work must include normal typing behavior, non-duplicated
input-mode switching, keyboard privacy copy, Full Access education, App Group
cache coordination, and Keychain access-group storage. It also needs simulator
and physical-device proof, because extension behavior and pasteboard privacy
prompts are not fully proven by unit tests.

## Alternatives Considered

- **Standalone app only**: rejected because it cannot insert into other apps.
- **Share extension only**: useful for publish, rejected as the primary paste UX
  because it is host-driven and cannot insert into focused text fields.
- **Shortcuts, widgets, and controls only**: useful commands, rejected as the
  primary paste UX because they cannot type into the current field.
- **Background clipboard daemon**: rejected because iOS does not allow the
  desktop-style silent global clipboard monitor Pasta uses on desktop.
- **File Provider first**: useful later for file and directory history, rejected
  as the core paste-anywhere mechanism because it is file-oriented rather than a
  text insertion surface.
