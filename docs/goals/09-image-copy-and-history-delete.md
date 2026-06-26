---
goal_id: "pasta-09-image-copy-and-history-delete"
title: "Image Copy Reliability and History Delete"
status: "done"
confidence_floor: 90
created: "2026-06-26"
updated: "2026-06-26"
---

# Goal: Image Copy Reliability and History Delete

Fix large PNG image publishing through the deployed Worker and add a trusted-device command to delete a selected history entry.

## 1. Invariants

- Clipboard payload bytes remain encrypted locally before upload.
- Cloudflare never receives clipboard plaintext, local paths, filenames, or raw group keys.
- The primary image/file UX stays on `copy`, `paste`, and `history`; removed legacy binary commands stay removed.
- macOS is the only live OS smoke target in this environment.

## 2. Definition of Done - INVARIANT

- [x] **DoD-1** - Large PNG image copy succeeds against the deployed custom-domain Worker. - *verify by:* macOS remote smoke with a PNG above the inline threshold.
- [x] **DoD-2** - Image-like R2 payloads can paste as images even when stored with `payloadKind: "file"` and `mime: image/*`. - *verify by:* CLI regression test.
- [x] **DoD-3** - A trusted device can delete one selected history entry and its R2 object when present. - *verify by:* CLI and Worker regression tests.
- [x] **DoD-4** - Help and README examples document history deletion. - *verify by:* CLI help test and docs review.

## 3. Exit Conditions

- **DONE** - Local tests pass, deployed Worker accepts large PNG image copy, and history deletion is documented.
- **BLOCKED-DEP** - Cloudflare deploy credentials or the custom domain are unavailable.
- **SCOPE-CHANGE** - User requires full Linux/Windows image clipboard smoke or undelete/recovery semantics.

## 4. Tasks - INVARIANT

### T1 - Diagnose and Patch Image Routing - [x]

- Reproduce large PNG image-copy failure against `https://pasta.nothuman.work`.
- Preserve image routing in the current CLI and make paste tolerant of image MIME on file payloads.
- Deploy the Worker if the remote `/v1/files` image path is stale.

Verification Contract:

- `mise exec -- bun test test/bun/cli.test.ts` exits 0.
- Remote macOS smoke copies a PNG above `LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES`.

**Confidence:** 94/100
**Depends on:** none
**Closes:** DoD-1, DoD-2
**Evidence:**
- 2026-06-26 - remote large PNG repro before deploy - exit 70; `pasta copy` against `https://pasta.nothuman.work` returned `internal_error` for a 524289-byte PNG while a large non-image file copied successfully, isolating the stale remote image `/v1/files` path.
- 2026-06-26 - `mise exec -- bun test test/bun/cli.test.ts` - exit 0; 11 tests passed, including large PNG R2 image copy/paste and image-MIME file payload paste routing.
- 2026-06-26 - `mise exec -- fnox exec -- wrangler deploy` - exit 0; deployed Worker `pasta` to `pasta.nothuman.work`, version `72ff32d6-7dc1-4336-809a-7e859e4e714f`.
- 2026-06-26 - remote macOS large PNG smoke against `https://pasta.nothuman.work` - exit 0; output `published image` and `remote-large-image-ok 524289`.
- 2026-06-26 - `mise exec -- bun test test/bun/cli.test.ts` after path-route follow-up - exit 0; 11 tests passed, including auto PNG path and `--image <path>` publishing through the reliable MIME-bearing file payload path while still printing `published image`.
- 2026-06-26 - remote macOS auto path smoke against `https://pasta.nothuman.work` - exit 0; output `published image` and `auto-path-image-ok 524289`.
- 2026-06-26 - remote macOS `--image <path>` smoke against `https://pasta.nothuman.work` - exit 0; output `published image` and `flag-path-image-ok 524289`.
- 2026-06-26 - installed global CLI `pasta copy --image <path>` smoke against `https://pasta.nothuman.work` - exit 0; output `published image` and `global-flag-image-ok 524289`.

### T2 - Add History Delete - [x]

- Add authenticated `DELETE /v1/clips/:seq`.
- Delete the DO row and any referenced R2 object.
- Add `pasta history delete <seq>`.

Verification Contract:

- `mise exec -- bun test test/bun/cli.test.ts` exits 0.
- `mise exec -- bunx vitest run test/worker/backend.test.ts --pool=workers` exits 0.

**Confidence:** 94/100
**Depends on:** none
**Closes:** DoD-3
**Evidence:**
- 2026-06-26 - `mise exec -- bun test test/bun/cli.test.ts` - exit 0; 11 tests passed, including `pasta history delete <seq>` CLI behavior.
- 2026-06-26 - `mise exec -- bunx vitest run test/worker/backend.test.ts --pool=workers` - exit 0; 8 Worker tests passed, including `DELETE /v1/clips/:seq` deleting a selected R2-backed image row and object.
- 2026-06-26 - remote history delete smoke against `https://pasta.nothuman.work` - exit 0; output `deleted 1` and `remote-history-delete-ok 1`.

### T3 - Docs and Checkpoint - [x]

- Update README/help/protocol examples.
- Run GDD status.

Verification Contract:

- `python3 "$HOME/.agents/skills/goal-driven-development/scripts/gdd_status.py" docs/goals/09-image-copy-and-history-delete.md` exits 0 and reports done eligibility.

**Confidence:** 93/100
**Depends on:** T1, T2
**Closes:** DoD-4
**Evidence:**
- 2026-06-26 - README/help/protocol review - pass; `pasta history delete 12` is documented in README, `pasta history delete 7` appears in command help examples, and `DELETE /v1/clips/:seq` is in the protocol map.
- 2026-06-26 - `mise exec -- bun run test` - exit 0; 17 Bun tests and 8 Worker tests passed after image copy and history delete changes.
- 2026-06-26 - `mise exec -- bunx tsc --noEmit` - exit 0; CLI, protocol, and Worker changes typecheck.
- 2026-06-26 - `mise exec -- bun run test` after path-route follow-up - exit 0; 17 Bun tests and 8 Worker tests passed.
- 2026-06-26 - `mise exec -- bunx tsc --noEmit` after path-route follow-up - exit 0; CLI path image routing typechecks.
- 2026-06-26 - `mise exec -- bun run smoke:macos-image` - exit 0; output `macos-image-ok 68`.
- 2026-06-26 - `git diff --check` - exit 0; no whitespace errors.
- 2026-06-26 - `python3 "$HOME/.agents/skills/goal-driven-development/scripts/gdd_status.py" docs/goals/09-image-copy-and-history-delete.md` - exit 0; `DONE true`, 4/4 DoD complete, no coverage or invariant violations.

## 5. Decisions

- 2026-06-26 - Deleting history is account-space scoped for any active trusted device. This matches reset authority and avoids owner-only deletion surprises across paired devices. Scope impact: none.
- 2026-06-26 - Path-based PNG image copy uses the MIME-bearing file payload upload path, matching the known-good `copy --file <path> --mime image/png` behavior while paste routes `image/*` back to image handling. OS clipboard image copy can keep the inline image path. Scope impact: none.

## 6. Learnings
