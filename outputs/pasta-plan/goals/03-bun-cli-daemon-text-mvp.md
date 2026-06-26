---
goal_id: "pasta-03-bun-cli-daemon-text-mvp"
title: "Bun CLI Daemon Text MVP"
status: "blocked"
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

- [ ] **DoD-1** - CLI command skeleton exists with help/version and no native install scripts. - *verify by:* `bun run` and `bun test`.
- [ ] **DoD-2** - SecretStore uses `Bun.secrets` and refuses plaintext fallback. - *verify by:* integration test write/read/delete and config scan.
- [ ] **DoD-3** - Text clipboard adapters are proven on macOS plus discovery tests for Linux and Windows. - *verify by:* platform smoke tests or documented blockers.
- [ ] **DoD-4** - `copy` reads local clipboard/stdin, encrypts text, and publishes. - *verify by:* local test with mock backend and integration test with backend.
- [ ] **DoD-5** - `paste` pulls latest/history entry, decrypts locally, and writes stdout or OS clipboard. - *verify by:* test and live smoke.
- [ ] **DoD-6** - `daemon` detects clipboard changes and auto-publishes without publishing its own remote paste loop. - *verify by:* daemon integration test.
- [ ] **DoD-7** - History list and paste-by-entry work for append-only log semantics. - *verify by:* CLI test with at least three entries.

## 4. Exit Conditions

- **DONE** - Mac local text flow plus mocked cross-platform adapters pass; Linux/Windows proof recorded or blocked explicitly.
- **BLOCKED-DEP** - Backend auth/publish APIs or `Bun.secrets` unavailable.
- **SCOPE-CHANGE** - Global hotkeys, GUI, images, files, or OS service install become required before text MVP.
- **CONFIDENCE-STALL** - Clipboard adapter cannot be made reliable on target OS after focused proof.
- **BUDGET** - Stop with exact failing command and next adapter/backend task.

## 5. Tasks - INVARIANT

### T1 - CLI Skeleton - [ ]

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
- none yet

### T2 - SecretStore - [ ]

- Implement `Bun.secrets` adapter.
- Store group key, device signing key, device wrapping key, and optional session token.
- Keep endpoint, account routing ID, and device ID in non-secret config.

Verification Contract:

- Write/read/delete integration test passes.
- Search config directory and test fixtures for raw secret bytes.
- Linux unavailable secret service path exits non-zero with setup guidance.

**Confidence:** 85/100
**Depends on:** Task 1
**Closes:** DoD-2
**Evidence:**
- none yet

### T3 - Clipboard Adapter Matrix - [ ]

- macOS: implement `pbcopy`/`pbpaste`.
- Linux: implement Wayland `wl-copy`/`wl-paste`, fallback X11 `xclip`/`xsel`.
- Windows: implement PowerShell/Windows clipboard proof.
- Add `doctor` checks.

Verification Contract:

- Current Mac smoke writes and reads a unique token.
- Linux and Windows smoke commands are recorded from real target OS or marked blocked.

**Confidence:** 75/100
**Depends on:** Task 1
**Closes:** DoD-3
**Evidence:**
- none yet

### T4 - Copy Publish - [ ]

- Read text from stdin or clipboard.
- Skip unsupported binary formats.
- Encrypt payload with protocol envelope.
- Publish signed request to backend.

Verification Contract:

- Mock backend receives ciphertext only.
- Backend integration creates one sequence entry.

**Confidence:** 85/100
**Depends on:** Goal 01, Goal 02 Task 5, Tasks 2 and 3
**Closes:** DoD-4
**Evidence:**
- none yet

### T5 - Paste Pull - [ ]

- Pull latest or selected `seq`.
- Decrypt locally.
- Write to stdout by default and optionally OS clipboard.

Verification Contract:

- `paste` after remote publish prints exact original text.
- Bad ciphertext fails closed and does not overwrite local clipboard.

**Confidence:** 85/100
**Depends on:** Task 4
**Closes:** DoD-5
**Evidence:**
- none yet

### T6 - Daemon Loop - [ ]

- Poll local clipboard or platform adapter at conservative interval.
- Detect local changes with content hash.
- Avoid republishing content fetched from remote paste.
- Back off on network errors.

Verification Contract:

- Daemon test publishes one local change once.
- Remote paste does not create a publish loop.

**Confidence:** 80/100
**Depends on:** Tasks 3-5
**Closes:** DoD-6
**Evidence:**
- none yet

### T7 - History UX - [ ]

- Implement `history` list.
- Implement `history paste <seq>`.
- Hide plaintext by default unless explicitly requested.

Verification Contract:

- Three-entry test lists newest-first or specified order consistently.
- Selected paste returns the selected entry, not only latest.

**Confidence:** 85/100
**Depends on:** Task 5
**Closes:** DoD-7
**Evidence:**
- none yet

## 6. Decisions

- Use foreground/user-run daemon first.
- Use shell/keybinding integration before global OS hotkeys.
- Text-first means binary formats return controlled unsupported errors.

## 7. Learnings

- The local macOS environment has `pbcopy` and `pbpaste`; Linux/Windows still require live proof.

## 8. Skills

- Use coding-excellence implementation workflow and testing strategy.

