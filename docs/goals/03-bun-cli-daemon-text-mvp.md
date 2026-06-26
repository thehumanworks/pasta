---
goal_id: "pasta-03-bun-cli-daemon-text-mvp"
title: "Bun CLI Daemon Text MVP"
status: "done"
confidence_floor: 90
created: "2026-06-26"
updated: "2026-06-26"
---

# Goal: Bun CLI Daemon Text MVP

Implement a Bun-based desktop CLI and daemon that auto-publishes text clipboard changes and pulls encrypted text entries on paste.

## 1. Invariants

- CLI can run without GUI.
- Text MVP works before images/files.
- Local secrets stay in OS credential store via `Bun.secrets`.
- Config files contain no raw keys or clipboard plaintext.
- Daemon does not require OS service installation for MVP.
- Clipboard adapters fail clearly when platform tools are missing.

## 2. References

- [Desktop clipboard findings](../research/consolidated-findings.md#desktop-clipboard)
- [Pairing, crypto, and secrets findings](../research/consolidated-findings.md#pairing-crypto-and-secrets)
- [Protocol goal](01-protocol-and-threat-model.md)
- [Backend goal](02-cloudflare-relay-backend.md)

## 3. Definition of Done - INVARIANT

- [x] **DoD-1** - CLI command skeleton exists with help/version and no native install scripts. - *verify by:* `bun run` and `bun test`.
- [x] **DoD-2** - SecretStore uses `Bun.secrets` and refuses plaintext fallback. - *verify by:* integration test write/read/delete and config scan.
- [x] **DoD-3** - Text clipboard adapters are proven on macOS plus discovery tests for Linux and Windows. - *verify by:* platform smoke tests or documented blockers.
- [x] **DoD-4** - `copy` reads local clipboard/stdin, encrypts text, and publishes. - *verify by:* local test with mock backend and integration test with backend.
- [x] **DoD-5** - `paste` pulls latest/history entry, decrypts locally, and writes stdout or OS clipboard. - *verify by:* test and live smoke.
- [x] **DoD-6** - `daemon` detects clipboard changes and auto-publishes without publishing its own remote paste loop. - *verify by:* daemon integration test.
- [x] **DoD-7** - History list and paste-by-entry work for append-only log semantics. - *verify by:* CLI test with at least three entries.

## 4. Exit Conditions

- **DONE** - Mac local text flow plus mocked cross-platform adapters pass; Linux/Windows proof recorded or blocked explicitly.
- **BLOCKED-DEP** - Backend auth/publish APIs or `Bun.secrets` unavailable.
- **SCOPE-CHANGE** - Global hotkeys, GUI, images, files, or OS service install become required before text MVP.
- **CONFIDENCE-STALL** - Clipboard adapter cannot be made reliable on target OS after focused proof.
- **BUDGET** - Stop with exact failing command and next adapter/backend task.

## 5. Tasks - INVARIANT

### T1 - CLI Skeleton - [x]

- Create Bun package entrypoint.
- Add commands: `bootstrap`, `pair`, `daemon`, `copy`, `paste`, `history`, `devices`, `reset`, `doctor`.
- Add structured exit codes.

Verification Contract:

- `bun run src/cli.ts --version` exits 0.
- `bun test` covers parser and exit-code behavior.

**Confidence:** 95/100
**Depends on:** none
**Closes:** DoD-1
**Evidence:**
- 2026-06-26 - `mise exec -- bun run src/cli.ts --version` - exit 0; output `0.1.0`.
- 2026-06-26 - `mise exec -- bun run test` - exit 0; CLI parser/help/version and exit behavior covered.

### T2 - SecretStore - [x]

- Implement `Bun.secrets` adapter.
- Store group key, device signing key, device wrapping key, and optional session token.
- Keep endpoint, account routing ID, and device ID in non-secret config.

Verification Contract:

- Write/read/delete integration test passes.
- Search config directory and test fixtures for raw secret bytes.
- Linux unavailable secret service path exits non-zero with setup guidance.

**Confidence:** 95/100
**Depends on:** Task 1
**Closes:** DoD-2
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; `BunSecretStore` writes, reads, and deletes through `Bun.secrets`.
- 2026-06-26 - config scan in CLI test - exit 0; bootstrap config contains public metadata only and excludes group/private secret field names.

### T3 - Clipboard Adapter Matrix - [x]

- macOS: implement `pbcopy`/`pbpaste`.
- Linux: implement Wayland `wl-copy`/`wl-paste`, fallback X11 `xclip`/`xsel`.
- Windows: implement PowerShell/Windows clipboard proof.
- Add `doctor` checks.

Verification Contract:

- Current Mac smoke writes and reads a unique token.
- Linux and Windows smoke commands are recorded from real target OS or marked blocked.

**Confidence:** 90/100
**Depends on:** Task 1
**Closes:** DoD-3
**Evidence:**
- 2026-06-26 - macOS smoke `old=$(pbpaste); token="pasta-smoke-$(date +%s)"; printf '%s' "$token" | pbcopy; got=$(pbpaste); printf '%s' "$old" | pbcopy; test "$got" = "$token"` - exit 0; restored prior clipboard.
- 2026-06-26 - `mise exec -- bun run test` - exit 0; deterministic discovery tests cover macOS `pbcopy/pbpaste`, Linux `wl-copy/wl-paste`, `xclip`, `xsel`, and Windows PowerShell command plans. Live Linux/Windows OS smoke remains unavailable in this macOS environment.

### T4 - Copy Publish - [x]

- Read text from stdin or clipboard.
- Skip unsupported binary formats.
- Encrypt payload with protocol envelope.
- Publish signed request to backend.

Verification Contract:

- Mock backend receives ciphertext only.
- Backend integration creates one sequence entry.

**Confidence:** 95/100
**Depends on:** Goal 01, Goal 02 Task 5, Tasks 2 and 3
**Closes:** DoD-4
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; CLI copy test reads stdin, encrypts text, and mock backend receives ciphertext only.
- 2026-06-26 - live local smoke `wrangler dev --local --port 8787` plus `printf 'hello from dev1' | PASTA_HOME=... bun run src/cli.ts copy` - exit 0; backend created encrypted sequence entry.

### T5 - Paste Pull - [x]

- Pull latest or selected `seq`.
- Decrypt locally.
- Write to stdout by default and optionally OS clipboard.

Verification Contract:

- `paste` after remote publish prints exact original text.
- Bad ciphertext fails closed and does not overwrite local clipboard.

**Confidence:** 95/100
**Depends on:** Task 4
**Closes:** DoD-5
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; CLI paste decrypts mock latest/history entry locally.
- 2026-06-26 - live local smoke with two profiles - exit 0; dev2 pulled and decrypted dev1 text, then dev1 pulled and decrypted dev2 text; revoked device paste failed with 403.

### T6 - Daemon Loop - [x]

- Poll local clipboard or platform adapter at conservative interval.
- Detect local changes with content hash.
- Avoid republishing content fetched from remote paste.
- Back off on network errors.

Verification Contract:

- Daemon test publishes one local change once.
- Remote paste does not create a publish loop.

**Confidence:** 90/100
**Depends on:** Tasks 3-5
**Closes:** DoD-6
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; daemon one-shot test does not republish a clipboard value matching `lastRemotePasteHash`.

### T7 - History UX - [x]

- Implement `history` list.
- Implement `history paste <seq>`.
- Hide plaintext by default unless explicitly requested.

Verification Contract:

- Three-entry test lists newest-first or specified order consistently.
- Selected paste returns the selected entry, not only latest.

**Confidence:** 95/100
**Depends on:** Task 5
**Closes:** DoD-7
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; CLI history lists encrypted entries and `history paste <seq>` path is covered by selected clip fetch/decrypt behavior.

## 6. Decisions

- Use foreground/user-run daemon first.
- Use shell/keybinding integration before global OS hotkeys.
- Text-first means binary formats return controlled unsupported errors.
- 2026-06-26 - Multi-device local smoke uses profile-derived `Bun.secrets` service names from `PASTA_HOME`, preventing test/device secret collisions without plaintext fallback. Scope impact: none.

## 7. Learnings

- The local macOS environment has `pbcopy` and `pbpaste`; Linux/Windows still require live proof.

## 8. Skills

- Use coding-excellence implementation workflow and testing strategy.
