---
goal_id: "pasta-07-unified-copy-paste-ux"
title: "Unified Copy/Paste UX"
status: "done"
confidence_floor: 90
created: "2026-06-26"
updated: "2026-06-26"
---

# Goal: Unified Copy/Paste UX

Make binary payloads usable through the primary `copy` and `paste` commands while preserving the encrypted transport and avoiding compatibility-only command clutter.

## 1. Invariants

- Text, image, and file payloads remain encrypted locally before upload.
- Cloudflare never receives clipboard plaintext, local paths, filenames, or raw group keys.
- Compatibility-only binary commands are removed in favor of the unified `copy` and `paste` surface.
- macOS image clipboard support uses native PNG pasteboard data.
- Linux and Windows binary clipboard behavior remains a documented platform assumption for this environment.

## 2. Definition of Done - INVARIANT

- [x] **DoD-1** - `pasta copy [path]` detects PNG image paths and file paths safely. - *verify by:* CLI regression tests.
- [x] **DoD-2** - `pasta paste` routes text to stdout/clipboard, image clips to the OS clipboard or `--out`, and file clips to `--out`. - *verify by:* CLI regression tests.
- [x] **DoD-3** - Compatibility-only binary commands are removed; unified `copy` and `paste` cover their useful behavior. - *verify by:* CLI regression tests.
- [x] **DoD-4** - Command help includes concrete usage examples. - *verify by:* CLI help tests.
- [x] **DoD-5** - macOS PNG clipboard read/write avoids AppleScript data coercion failures. - *verify by:* macOS adapter smoke or direct adapter test.

## 3. Exit Conditions

- **DONE** - Unified commands are implemented, documented, and verified.
- **BLOCKED-DEP** - macOS pasteboard APIs cannot be exercised or CLI tests cannot run.
- **SCOPE-CHANGE** - Full Linux/Windows image clipboard implementation or non-PNG image clipboard conversion is required.

## 4. Tasks - INVARIANT

### T1 - State and UX Contract - [x]

- Identify current explicit-command behavior and failure mode.
- Define unified command semantics.

Verification Contract:

- Contract is reflected in tests and README examples.

**Confidence:** 94/100
**Depends on:** Goal 06
**Closes:** DoD-1, DoD-2, DoD-3, DoD-4
**Evidence:**
- 2026-06-26 - Source review - `copy-image <path>` previously ignored the path and read the OS clipboard; `copy-image --help` lacked examples; file copy/paste lived behind `send-file`/`paste-file`. Unified contract chosen: `copy [path]`, `copy --path <path>`, `copy --image`, `copy --file`, and payload-kind-aware `paste`, with legacy commands removed after the no-compatibility follow-up.
- 2026-06-26 - README examples updated - pass; image/file sections now prefer `pasta copy ./Downloads/unlimit.png`, `pasta copy --file ./archive.zip`, `pasta paste`, and `pasta paste --out ./received.bin`; design docs now describe R2-backed image payloads for large PNGs.

### T2 - Unified Copy Routing - [x]

- Add `copy [path]`, `copy --path <path>`, `copy --image`, and `copy --file` routing.
- Remove `copy-image` and `send-file`.

Verification Contract:

- Tests prove image paths publish image payloads, normal file paths publish file payloads, and removed commands are rejected.

**Confidence:** 94/100
**Depends on:** T1
**Closes:** DoD-1, DoD-3
**Evidence:**
- 2026-06-26 - `mise exec -- bun test test/bun/cli.test.ts` - exit 0; 11 tests passed, including unified path copy regression where `pasta copy <png>` publishes an image payload, `pasta copy --path <png>` publishes an image payload, `pasta copy <file>` publishes a file payload, removed compatibility commands return usage as unknown commands, invalid `copy --image <fake.png>` is rejected, and large PNGs use R2-backed image storage.
- 2026-06-26 - `mise exec -- bunx vitest run test/worker/backend.test.ts --pool=workers` - exit 0; 8 Worker tests passed, including R2 upload/download for `payloadKind: "image"`.
- 2026-06-26 - `mise exec -- bunx tsc --noEmit` - exit 0; unified copy routing helpers and MIME/path detection compile.

### T3 - Unified Paste Routing - [x]

- Add payload-kind aware `paste` routing.
- Remove `paste-image` and `paste-file`.

Verification Contract:

- Tests prove image payloads write the clipboard by default, `--out` writes bytes, text preserves stdout/clipboard behavior, and files require or honor `--out`.

**Confidence:** 94/100
**Depends on:** T1
**Closes:** DoD-2, DoD-3
**Evidence:**
- 2026-06-26 - `mise exec -- bun test test/bun/cli.test.ts` - exit 0; 11 tests passed, including `pasta paste` writing latest image bytes to the clipboard adapter by default, `pasta paste --image --out` writing image bytes to disk, `pasta paste --out` writing latest file bytes to disk, `pasta paste --file --seq <n> --out` writing file bytes to disk, and file paste without `--out` returning usage before object download.
- 2026-06-26 - Command surface regression - pass; `copy-image`, `paste-image`, `send-file`, and `paste-file` are rejected as unknown commands while `paste --file --seq <n> --out` preserves the direct `/v1/files/:seq` path.

### T4 - Help and Docs - [x]

- Add examples to command-level help.
- Update README examples to prefer unified commands.

Verification Contract:

- Help tests check representative commands contain `Examples:`.

**Confidence:** 93/100
**Depends on:** T1
**Closes:** DoD-4
**Evidence:**
- 2026-06-26 - `mise exec -- bun test test/bun/cli.test.ts` - exit 0; command-level help tests assert `Examples:` and representative concrete examples for bootstrap, copy, paste, history, daemon, pair, devices, doctor, reset, install-shell, uninstall-shell, protocol, and payload-plan, and confirm removed commands have no help surface.
- 2026-06-26 - `git diff --check` - exit 0; README/help edits have no whitespace errors.

### T5 - macOS PNG Clipboard Adapter - [x]

- Replace AppleScript PNG coercion with direct AppKit pasteboard PNG data access.
- Preserve unsupported-platform boundaries.

Verification Contract:

- macOS adapter smoke proves identical PNG bytes can be written and read.

**Confidence:** 94/100
**Depends on:** T1
**Closes:** DoD-5
**Evidence:**
- 2026-06-26 - `mise exec -- bun run smoke:macos-image` - exit 0; output `macos-image-ok 68`, proving identical PNG bytes through the AppKit `public.png` pasteboard path with a committed rerunnable smoke command.
- 2026-06-26 - `mise exec -- bun run test` - exit 0; 17 Bun tests and 8 Worker tests passed after replacing AppleScript PNG coercion.

## 5. Decisions

- 2026-06-26 - The primary UX should be `copy` and `paste`; explicit binary commands are removed rather than kept for compatibility. Scope impact: none.
- 2026-06-26 - macOS PNG clipboard read/write should use AppKit pasteboard `public.png` data through JXA instead of AppleScript `PNGf` coercion, because the coercion path produced `-1700` for user image-copy workflows. Scope impact: none.
- 2026-06-26 - Only valid PNG bytes are treated as clipboard image payloads. Non-PNG image extensions are file payloads in auto mode, and explicit `--image` rejects invalid PNG bytes. Scope impact: none.
