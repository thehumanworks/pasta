---
goal_id: "pasta-20-passkey-protected-secrets"
title: "Passkey-Protected Secrets"
status: "active"
confidence_floor: 90
created: "2026-07-31"
updated: "2026-07-31"
---

# Goal: Passkey-Protected Secrets

## 1. Invariants · the rules that must not break

This file is the only state for this delivery subgoal — if it isn't written here,
it didn't happen. The full procedure (boot loop, confidence rubric, logging cadence) lives in the
**goal-driven-development** skill; these rules hold even if that skill isn't loaded:

- **Scope is frozen after user confirms DoD + Tasks.** Until then, §3 and §5 may be
  edited freely. After confirm, the only permitted edits are: tick checkboxes (Task
  **and** DoD), update Confidence, append Evidence, append to the live sections
  (§6/§7/§8), and update frontmatter `status`/`updated` — never add, remove, reword,
  split, or merge a DoD item or Task, and never rewrite or delete a live-section entry.
- **Never tick below the floor.** A task is ticked done only at Confidence ≥
  `confidence_floor`. If you cannot reach it, leave it unticked and fire `CONFIDENCE-STALL`.
- **Scope change is an exit, not a decision.** If scope must change, record the
  proposal in §6 and fire `SCOPE-CHANGE` — stop and surface it to the user.
- **Live sections are append-only.** Log each decision (§6) and learning (§7) at
  the moment it happens — before ticking the task it came from. Never delete entries.
- Cloudflare never receives secret plaintext, passkeys, or raw group keys.
- Passkey-protected secret values remain undecryptable with the group key alone.
- Ordinary `copy`/`paste`/keyboard text history must not insert secret plaintext
  without an explicit passkey unlock.

---

## 2. References

- User change request — `pasta secret set --key KEY --passkey <pass> [--value]` and
  matching `get`; bare/`--value` with no argument reads stdin; CLI + iOS keyboard;
  tests, ADR, public docs.
- `src/shared/crypto.ts`, `src/shared/protocol.ts` — clip encryption and payload kinds.
- `src/cli.ts` — command dispatch, help, publish/history helpers.
- `src/worker/index.ts`, `src/worker/clipboard-space.ts` — Worker/DO payload allowlists.
- `ios/Sources/PastaCore/`, `ios/Keyboard/KeyboardViewController.swift` — iOS crypto and keyboard paste UX.
- `docs/adrs/` — ADR format for lasting protocol decisions.
- `docs-site/content/cli-reference.md`, `README.md`, `docs/protocol.md`, `docs-site/content/security.md`,
  `docs-site/content/native-ios.md` — public docs.

---

## 3. Definition of Done · INVARIANT

- [x] **DoD-1** — Nested passkey encryption encrypts/decrypts secret values; wrong passkeys fail; group-key-only decryption cannot recover the value. — *verify by:* `mise exec -- bun test test/bun/crypto.test.ts`
- [x] **DoD-2** — Worker accepts inline `payloadKind: "secret"` clips and stores ciphertext only. — *verify by:* `mise exec -- bunx vitest run test/worker/backend.test.ts --pool=workers`
- [x] **DoD-3** — `pasta secret set` / `pasta secret get` work with `--key`, `--passkey`, and stdin when `--value` has no argument; help documents the commands. — *verify by:* `mise exec -- bun test test/bun/cli.test.ts`
- [x] **DoD-4** — iOS PastaCore can encrypt/decrypt passkey secrets and the keyboard can set/get secrets with an explicit passkey prompt before insertion. — *verify by:* Swift package tests and keyboard source review (`swift test --package-path ios` when Swift is available)
- [x] **DoD-5** — ADR plus public docs describe the double-encryption contract, CLI, and iOS keyboard UX. — *verify by:* docs review plus `cd docs-site && bun run build -- --base /`
- [x] **DoD-6** — TypeScript compiles; Worker changes are deployed with a non-leaking remote smoke when remote deploy is available. — *verify by:* `mise exec -- bunx tsc --noEmit` and deploy/smoke evidence or recorded blocker

---

## 4. Exit Conditions

- **`DONE`** — all §3 items ticked and all §5 tasks are at or above the confidence floor.
- **`BLOCKED-DEP`** — required toolchain, Cloudflare credentials, or Swift verification is unavailable after one direct retry.
- **`SCOPE-CHANGE`** — work requires P2P, Cloudflare auth products, secret recovery, or non-passkey identity.
- **`CONFIDENCE-STALL`** — a task cannot reach 90 confidence after two honest implementation attempts.
- **`BUDGET`** — one focused implementation pass plus one verification-fix loop is exhausted without passing tests.

---

## 5. Tasks · INVARIANT

### T1 · Contract, ADR, And Docs · [x]

**Steps**
- [x] Record ADR for nested passkey secret encryption and `payloadKind: "secret"`.
- [x] Update protocol, security, CLI reference, README, and native-iOS docs.
- [x] Link this goal from `GOAL.md`.

**Verification Contract**
- *Check:* Docs and ADR state double encryption, Worker-visible leakage limits, CLI flags, stdin `--value`, and keyboard passkey unlock.
- *Method:* docs review + `cd docs-site && bun run build -- --base /`
- *Expected:* Build succeeds; docs mention `pasta secret set/get` and iOS keyboard secret UX.
- *BDD scenarios covered:* User stores a named secret with a passkey; another device retrieves it only with that passkey.

**Confidence:** 95 / 90 · **Depends on:** none · **Closes:** DoD-5

**Evidence (required before tick; append-only)**
- 2026-07-31 - `cd docs-site && bun run build -- --base /` - exit 0; built 16 pages including cli-reference/security/protocol/native-ios updates; ADR `docs/adrs/0003-passkey-protected-secrets.md` records nested encryption contract.

---

### T2 · Shared Crypto And Worker Allowlist · [x]

**Steps**
- [x] Add passkey KDF + nested envelope helpers in shared crypto.
- [x] Add `payloadKind: "secret"` and secret MIME to the protocol.
- [x] Allow inline secret clips in Worker and Durable Object validators.
- [x] Cover wrong-passkey and no-plaintext-storage cases in tests.

**Verification Contract**
- *Check:* Crypto and Worker tests prove nested encryption and allowlisting.
- *Method:* `mise exec -- bun test test/bun/crypto.test.ts && mise exec -- bunx vitest run test/worker/backend.test.ts --pool=workers`
- *Expected:* Tests pass; dump/storage asserts exclude plaintext secret values and passkeys.
- *BDD scenarios covered:* Wrong passkey fails; Cloudflare stores only ciphertext.

**Confidence:** 94 / 90 · **Depends on:** T1 · **Closes:** DoD-1, DoD-2

**Evidence (required before tick; append-only)**
- 2026-07-31 - `bun test test/bun/crypto.test.ts` - exit 0; passkey secret round-trip and wrong-passkey rejection covered.
- 2026-07-31 - `bunx vitest run test/worker/backend.test.ts --pool=workers` - exit 0; 15 passed including secret clip publish with dump excluding plaintext/passkey.

---

### T3 · CLI Secret Set/Get · [x]

**Steps**
- [x] Add `secret set` / `secret get` command dispatch, help, and history rendering.
- [x] Read stdin when `--value` is omitted or has no argument.
- [x] Scan history for matching encrypted secret key metadata and unlock with passkey.
- [x] Reject ordinary paste/history-paste of secret payloads without passkey unlock.

**Verification Contract**
- *Check:* CLI tests cover set via stdin and explicit `--value`, get with correct/wrong passkey, and help text.
- *Method:* `mise exec -- bun test test/bun/cli.test.ts`
- *Expected:* Focused secret tests pass; help includes examples.
- *BDD scenarios covered:* `printf 'x' | pasta secret set --key K --passkey P --value`; `pasta secret get --key K --passkey P`.

**Confidence:** 94 / 90 · **Depends on:** T2 · **Closes:** DoD-3

**Evidence (required before tick; append-only)**
- 2026-07-31 - `bun test test/bun/cli.test.ts` - exit 0; secret set/get stdin and `--value`, wrong passkey exit 4, paste rejection exit 6, help examples covered.

---

### T4 · iOS Core And Keyboard · [x]

**Steps**
- [x] Port passkey secret encrypt/decrypt and secret payload handling to PastaCore.
- [x] Exclude unlocked secret values from ordinary keyboard text history insertion.
- [x] Add keyboard secret set/get UX that prompts for passkey before insert/publish.
- [x] Add Swift tests for nested encrypt/decrypt parity.

**Verification Contract**
- *Check:* Swift tests cover nested secret crypto; keyboard source has explicit passkey prompt paths.
- *Method:* `swift test --package-path ios` when available; otherwise source review evidence.
- *Expected:* Secret values are not inserted without passkey; set publishes nested ciphertext.
- *BDD scenarios covered:* Keyboard unlocks a named secret with passkey and inserts plaintext; set uses clipboard value plus passkey.

**Confidence:** 91 / 90 · **Depends on:** T2 · **Closes:** DoD-4

**Evidence (required before tick; append-only)**
- 2026-07-31 - Source review: `PastaCrypto.encryptPasskeySecretClip` / `decryptPasskeySecretClip`, keyboard `promptUnlockSecret` / `promptSetSecretFromClipboard`, secrets excluded from `keyboardClip` insert path; Swift unit test `testPasskeySecretRoundTripRejectsWrongPasskey` added. Host lacks Swift toolchain for `swift test --package-path ios` in this environment.
- 2026-07-31 - Device defect and fix: the shipped `UIAlertController` passkey prompt could never work in a keyboard extension (alerts are unavailable to `com.apple.keyboard-service`, a keyboard may draw only inside its primary view, and an in-extension `UITextField` invalidates the host `textDocumentProxy`), so the key menu's Set action did nothing and the keyboard stopped responding. Replaced with an in-toolbar prompt fed by `KeyboardContext.textInputProxy`, added `PastaSecretPrompt` plus `PastaSecretPromptTests` (8 cases: two-step set, unlock-only passkey, masking, return-key submit, per-field backspace, whitespace/invalid path rejection, empty passkey, bounded fields), and cached secret key paths in the app group so the menu is populated on cold launch.
- 2026-07-31 - `swift test --package-path ios` - exit 0; 51 tests executed, 1 gated live-relay smoke skipped without `PASTA_IOS_JOIN_TOKEN`, 0 failures.
- 2026-07-31 - `xcodebuild -project ios/Pasta.xcodeproj -scheme Pasta -configuration Debug -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath ios/build/DerivedDataSecretPrompt CODE_SIGNING_ALLOWED=NO build` - exit 0; app plus `PastaKeyboard.appex` compile with the in-keyboard prompt.
- 2026-07-31 - Adversarial review of the prompt found two `textInputProxy` routing defects around KeyboardKit's globe button (host-document passkey leak during the 0.5s detach window; reattached proxy swallowing all typing after a cancel). Fixed by observing `$textInputProxy` and forwarding to `originalTextDocumentProxy` with no active prompt; `swift test --package-path ios` and the signed-off simulator-SDK `xcodebuild` are green after the fix.

---

### T5 · Verify, Deploy, Checkpoint · [x]

**Steps**
- [x] Run TypeScript compile and focused test suites.
- [x] Deploy Worker and run non-leaking remote smoke when credentials allow.
- [x] Record evidence and mark DoD/tasks complete.

**Verification Contract**
- *Check:* Compile/tests pass; deploy/smoke recorded or blocker stated.
- *Method:* `mise exec -- bunx tsc --noEmit` plus deploy/smoke commands when available
- *Expected:* Green local verification; remote path updated for secret payload kind.
- *BDD scenarios covered:* End-to-end secret set/get against deployed relay when possible.

**Confidence:** 93 / 90 · **Depends on:** T3, T4 · **Closes:** DoD-6

**Evidence (required before tick; append-only)**
- 2026-07-31 - `bunx tsc --noEmit` - exit 0; focused bun/vitest suites green before deploy.
- 2026-07-31 - `mise exec -- fnox exec -- wrangler deploy` - blocked: Doppler returned `Invalid Auth token` for `CLOUDFLARE_API_KEY` / account secrets, so Wrangler had no usable Cloudflare credentials in this environment. Local Worker tests already cover the secret allowlist path.
- 2026-07-31 - `mise exec -- fnox exec -- wrangler deploy` - exit 0 on the local host after merge; deployed `pasta.nothuman.work`, Version ID `2ef527e3-d712-4745-a1ee-7253f535c351`.
- 2026-07-31 - non-leaking remote smoke against `https://pasta.nothuman.work` with the real profile - `secret set` published `payloadKind: "secret"` (`byteLen` 248, inline), `secret get` returned a byte-identical value with exit 0, wrong passkey exited 4, `paste` refused the latest secret clip with exit 6 and the redirect-to-`secret get` message, and both smoke clips were deleted afterwards (`deleted: 1` each). No secret value, key, or passkey was printed.

---

## 6. Decisions · append-only

- 2026-07-31 - Use nested encryption: passkey-derived key protects the secret value; group-key AEAD wraps that envelope as `payloadKind: "secret"` so Cloudflare and passkey-less trusted devices cannot read the value. Secret name lives in encrypted clip metadata for local listing.
- 2026-07-31 - KDF is PBKDF2-HMAC-SHA256 (210000 iterations, 16-byte salt, 32-byte key) for portable Bun/Worker and Swift CommonCrypto parity.
- 2026-07-31 - Secret `--key` values are slash-separated paths. A bare first segment needs no leading `/` (`KEY`); nested keys use more segments (`production/tool/KEY`). Leading `/`, empty segments, and `.`/`..` are rejected.
- 2026-07-31 - iOS passkey entry happens inside the keyboard's toolbar band with input routed through `KeyboardContext.textInputProxy`, not through UIKit modals or an in-extension text field. Autocomplete is disabled while the prompt is open, and unlocked values are inserted through `originalTextDocumentProxy`.
- 2026-07-31 - The app-group keyboard cache may store secret key paths and clip ids (no values, no passkeys) so the key menu is usable before the first network refresh.

---

## 7. Learnings · append-only

- 2026-07-31 - DoD-4 was ticked on source review of a passkey prompt that iOS can never run. A keyboard extension cannot present `UIAlertController` and cannot host `UITextField`/`UITextView` without invalidating the host `textDocumentProxy`, so the prompt silently failed and the keyboard stopped typing. Keyboard-extension UX claims need a device readback, not source review, exactly as the chrome rules in `AGENTS.md` already required for layout.
- 2026-07-31 - KeyboardKit resolves every insert and delete through `KeyboardContext.textDocumentProxy`, which prefers `textInputProxy`. That single hook is enough to capture Pasta-owned input while leaving the native keys, gestures, layout, and keyboard height untouched.
- 2026-07-31 - `textInputProxy` is not exclusively Pasta's: KeyboardKit's globe button detaches it on touch and restores it 0.5s later. Adversarial review caught two consequences of ignoring that — passkey characters could reach the host document during the window while the prompt was still visible, and a prompt cancelled inside the window left a reattached proxy that swallowed all typing. Fix is to observe `$textInputProxy`, cancel on detach, drop a reattached proxy with no active prompt, and always forward to `originalTextDocumentProxy` when no prompt is collecting input.

---

## 8. Autonomous Progress Log

### 2026-07-31
- Created goal from user request for CLI + iOS keyboard passkey-protected secrets.
- Implemented nested PBKDF2 + XChaCha20 secret clips, Worker allowlist, CLI secret set/get, iOS PastaCore/keyboard UX, ADR 0003, and public docs.
- Local verification green except Swift host toolchain.
- Remote deploy blocked by invalid Doppler auth for Cloudflare secrets; DoD-6 left unticked pending credential fix + deploy/smoke.
- Steer: secret keys are path-like (`KEY` or `production/tool/KEY`); first segment needs no leading `/`.
- Merged the feature to `main`, deployed the Worker, and ran the non-leaking remote smoke; DoD-6 and T5 now ticked with evidence.
- Device report: the keyboard key menu's Set action did nothing and the keyboard froze. Root cause was the `UIAlertController` passkey prompt, which iOS never allows in a keyboard extension. Replaced it with an in-toolbar prompt fed by `textInputProxy`, cached secret key paths for cold launch, and recorded the constraint in `AGENTS.md`, ADR 0003, and `docs-site/content/native-ios.md`.
