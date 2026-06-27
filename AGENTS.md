# Pasta Agent Instructions

These project-local instructions apply to this repository.

## Product Boundary

- The app name is **Pasta**. CLI/package references should use `pasta`.
- Transport is central-service only: Cloudflare Worker over HTTPS plus one Durable Object per clipboard space.
- P2P, LAN discovery, SSH, tailnets, STUN/TURN, and WebRTC traversal are out of scope. Do not reintroduce them as a fallback or future MVP path.
- Devices own interactions: copy publishes ciphertext, paste pulls latest/history, pairing approval wraps keys, reset starts a new encrypted space.
- Cloudflare must never receive clipboard plaintext or raw group keys.
- Cloudflare auth products are not part of MVP auth. Use app-owned device keys and signed requests.

## Execution Entry Point

- Read `GOAL.md`.
- Read `docs/ORCHESTRATION.md`.
- Work the goal files in `docs/goals/` using the local GDD workflow.
- Before changing a goal, run `gdd_status.py` on it and preserve its DoD/task coverage.
- Record evidence in the task's `Evidence` block before marking any task or DoD complete.

## Toolchain And Secrets

- Use `mise` as the tool manager. Prefer repo-configured tools through `mise exec -- <command>` when a tool is not already on `PATH`.
- Use `bun` as the TypeScript runtime and package manager. Prefer `bun install`, `bun run`, `bun test`, and `bunx --bun`; do not introduce npm, yarn, pnpm, or their lockfiles unless explicitly requested.
- Use `fnox` for secrets. Run secret-gated commands as `mise exec -- fnox exec -- <command>` so secrets are injected from `fnox.toml`.
- `fnox` is already configured to fetch `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`, and `CLOUDFLARE_ACCOUNT_EMAIL` from Doppler. Do not replace this with `.env` files or hardcoded credentials.
- Never print, commit, or paste secret values. Secret checks should prove names/configuration, not reveal values.

## Scope Discipline

- Text MVP comes before images/files.
- Shell/keybinding integration comes before global OS hotkeys or OS services.
- Keep implementation changes narrow to the active goal.
- Do not store secrets in config files, logs, fixtures, or docs.

## iOS Custom Keyboard (KeyboardKit)

The Pasta keyboard is **additive**: KeyboardKit owns the keys and all input
handling; Pasta only adds a top action row (refresh, publish, pull-history,
paste/insert). Keep the keys and input as native as possible. The recurring bug
here has been turning the action row into a bolt-on strip glued to the keyboard's
top edge — do not repeat it. Source of truth: `ios/Keyboard/KeyboardViewController.swift`,
ADR `docs/adrs/0002-keyboardkit-keyboard-rendering.md`, and
`docs-site/content/native-ios.md`.

Working pattern:

- Put the Pasta row in KeyboardKit's **native `toolbar:` slot**:
  `toolbar: { _ in Keyboard.Toolbar { PastaKeyboardToolbar(...) } }`. KeyboardKit
  already composes the keyboard as `VStack { toolbar; keys }` on one surface — the
  slot is the native QuickType band, and in 9.9.1 it paints no background of its own.
- Set one explicit opaque surface:
  `.keyboardViewStyle(.init(background: .color(.keyboardBackground)))`. Do **not**
  rely on `renderBackground` for opacity — the standard style service's background
  is transparent (`Keyboard.Background.standard` has all layers nil), so
  `renderBackground` alone paints nothing.
- Do **not**: render the row as a sibling above `KeyboardView`; pass `EmptyView()`
  into the slot with a zero-height autocomplete toolbar; use `.ignoresSafeArea(.top)`;
  or hand-paint a background behind a sibling band. That stack is exactly what
  produces the cropped, detached strip.
- Let KeyboardKit own the layout. Do **not** strip `.nextKeyboard`; on iPhone the
  standard layout adds the globe only when `needsInputModeSwitchKey` is true, and on
  iPad it adds it unconditionally — either way, removing it strands the user with no
  keyboard switch (a HIG / App Review risk).
- Observe `KeyboardContext` so the view re-evaluates; key `KeyboardView`'s `.id`
  only on structural changes (keyboard type, orientation, size, device class).
  **Never** key `.id` on `keyboardCase` — it tears the keyboard down on every
  auto-capitalization flip mid-typing and cancels in-flight gestures.
- Privacy stays intact: never publish ordinary keystrokes; read the pasteboard
  only behind an explicit user-tapped action.

Proof: a green `xcodebuild` simulator build and PluginKit registration prove it
**compiles and installs**, not that the chrome looks right. Keyboard-extension
chrome (top strip, safe area, globe, height) only renders correctly in the real
extension host — the last strip survived a green simulator build and a TestFlight
build and was caught only by a device screenshot. Require a device/TestFlight
screenshot before claiming the visual is fixed. When unsure, read the pinned
KeyboardKit sources in-repo (`ios/build/DerivedData/SourcePackages/checkouts/KeyboardKit/`,
especially `_Keyboard/KeyboardView.swift`, `_Keyboard/Views/Keyboard+Toolbar.swift`,
and `Demo/Keyboard/DemoKeyboardView.swift`).

## Delivery

- Every task in this repository ends with the verified changes committed on `main` and pushed to `origin/main` unless the user explicitly asks not to publish.
- Before committing, run the strongest practical verification for the touched surface and include any blocker in the final response.
- If a task changes Worker routes, Durable Object behavior, D1 schema, migrations, or documented remote API behavior, publishing code or creating a tag is not enough. Apply required remote D1 migrations with `mise exec -- fnox exec -- wrangler d1 migrations apply DB --remote`, deploy with `mise exec -- fnox exec -- wrangler deploy`, and run a non-leaking remote smoke against `https://pasta.nothuman.work` for the changed path unless the user explicitly says not to deploy. Record the migration/deploy/smoke evidence before finalizing.
