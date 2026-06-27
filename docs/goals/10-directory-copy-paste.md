---
goal_id: "pasta-10-directory-copy-paste"
title: "Directory Copy Paste"
status: "done"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: Directory Copy Paste

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

---

## 2. References

Everything the agent needs before/while working. Each entry is `path-or-url — why it matters`.

- User change request — `pasta copy <directory>` should bundle the directory as a zip; `pasta paste` on another machine should unzip and save the directory.
- `src/cli.ts` — current unified copy/paste routing, file payload encryption, metadata handling, and help text.
- `test/bun/cli.test.ts` — CLI regression tests for path copy/paste, encrypted metadata, and bounded binary payloads.
- `README.md` — user-facing examples for image/file payloads.
- `docs/binary-payloads.md` — binary transport contract and metadata boundary.

---

## 3. Definition of Done · INVARIANT

Each item is **atomic** (one verifiable assertion per checkbox), tagged with a
stable id that Tasks reference via **Closes:**, and carries a concrete `verify by:`.

Tick a `DoD-N` box only when its own `verify by:` has been run and passed (not merely
because a closing Task is ticked). Log the command and its outcome as an Evidence bullet
under the Task that **Closes:** it. DONE requires every DoD box ticked.

- [x] **DoD-1** — `pasta copy <directory>` publishes an encrypted zip-backed file payload without leaking local paths or plaintext names to Worker-visible metadata. — *verify by:* `mise exec -- bun test test/bun/cli.test.ts`
- [x] **DoD-2** — `pasta paste` recognizes Pasta directory bundles, unzips them locally, and saves the directory to its original basename by default or to `--out <dir>` when provided. — *verify by:* `mise exec -- bun test test/bun/cli.test.ts`
- [x] **DoD-3** — User-facing docs describe directory copy/paste semantics, limits, and metadata boundaries. — *verify by:* docs review.
- [x] **DoD-4** — CLI help describes directory copy/paste examples. — *verify by:* CLI help test.
- [x] **DoD-5** — The TypeScript surface compiles after directory bundle changes. — *verify by:* `mise exec -- bunx tsc --noEmit`

---

## 4. Exit Conditions

The goal terminates when **any** condition holds. On exit, state which fired —
explicitly — in the response to the user. Specialize the bracketed values for this goal.

- **`DONE`** — directory path copy, unzip-on-paste, docs, CLI tests, and typecheck are complete. *(primary)*
- **`BLOCKED-DEP`** — Bun file APIs or local archive implementation cannot safely create/read zip bytes after one direct retry.
- **`SCOPE-CHANGE`** — work requires changing Worker routes, raising the 50 MiB payload limit, preserving POSIX permissions/symlinks, or adding non-directory archive management commands.
- **`CONFIDENCE-STALL`** — a task cannot reach 90 confidence after two honest implementation attempts.
- **`BUDGET`** — one focused implementation pass plus one verification-fix loop is exhausted without passing tests.

---

## 5. Tasks · INVARIANT

Ordered, dependency-aware units of work that together satisfy the DoD. Tick the
trailing `[ ]` only when the Verification Contract passes and Confidence ≥ floor.

---

### T1 · Document Directory Bundle Contract · [x]

**Steps**
- [x] Add README examples for copying a directory path and pasting it as a directory.
- [x] Update binary payload design docs to define Pasta directory zip bundles, limits, and metadata boundaries.
- [x] Update protocol/user-facing route wording only where needed; avoid implying a Worker API change.

**Verification Contract**
- *Check:* Directory copy/paste behavior is documented before implementation.
- *Method:* `git diff -- README.md docs/binary-payloads.md docs/protocol.md GOAL.md docs/goals/10-directory-copy-paste.md`
- *Expected:* Diff states copy bundles a directory as zip, paste extracts it locally, plaintext paths remain out of Worker-visible metadata, and no new transport is introduced.
- *BDD scenarios covered:* User copies a directory path; another trusted device pastes and gets a saved directory.

**Confidence:** 93 / 90 · **Depends on:** none · **Closes:** DoD-3

**Evidence (required before tick; append-only)**
- 2026-06-27 - `git diff -- README.md docs/binary-payloads.md docs/protocol.md GOAL.md docs/goals/10-directory-copy-paste.md` - exit 0; diff documents `pasta copy <directory>` as local zip bundling, `pasta paste` as local extraction, relative-only archive paths, normal `.zip` files remaining file payloads, and no new Worker transport.

---

### T2 · Implement Directory Zip Copy · [x]

**Steps**
- [x] Detect directory paths in `copy [path]`.
- [x] Build a bounded zip archive locally from regular files/directories under the selected directory.
- [x] Publish the bundle through the existing encrypted file payload path with a directory-bundle MIME and encrypted basename metadata.

**Verification Contract**
- *Check:* Copying a directory creates an encrypted file payload whose decrypted bytes are a zip archive and whose Worker-visible fields contain no local path or plaintext directory/file names.
- *Method:* `mise exec -- bun test test/bun/cli.test.ts`
- *Expected:* CLI test passes and covers directory copy payload shape.
- *BDD scenarios covered:* User runs `pasta copy ./project-dir` on one device.

**Confidence:** 94 / 90 · **Depends on:** T1 · **Closes:** DoD-1

**Evidence (required before tick; append-only)**
- 2026-06-27 - `mise exec -- bun test test/bun/cli.test.ts` - exit 0; 15 tests passed, including directory path copy publishing a `file` payload with Pasta directory-bundle MIME, decrypted payload zip magic `PK\x03\x04`, encrypted basename metadata, and no Worker-visible local path or plaintext directory/file names.

---

### T3 · Implement Directory Unzip Paste · [x]

**Steps**
- [x] Detect Pasta directory bundles on paste.
- [x] Extract zip contents locally with path traversal protection.
- [x] Save to the original directory basename by default and honor `--out <dir>`.

**Verification Contract**
- *Check:* Pasting a directory bundle recreates nested files and empty directories at the expected output location.
- *Method:* `mise exec -- bun test test/bun/cli.test.ts`
- *Expected:* CLI test passes and covers default output plus `--out` extraction.
- *BDD scenarios covered:* Different trusted device runs `pasta paste` and receives the directory; user chooses `pasta paste --out ./received-dir`.

**Confidence:** 94 / 90 · **Depends on:** T2 · **Closes:** DoD-2

**Evidence (required before tick; append-only)**
- 2026-06-27 - `mise exec -- bun test test/bun/cli.test.ts` - exit 0; 15 tests passed, including default paste extracting `project-folder` with nested file and empty directory, `paste --out ./received-project`, and `paste --file --seq <n> --out ./received-project-seq`.

---

### T4 · Verify And Checkpoint · [x]

**Steps**
- [x] Run focused CLI regression tests.
- [x] Run TypeScript typecheck.
- [x] Run GDD status and final diff hygiene.

**Verification Contract**
- *Check:* Directory support is verified by tests, typecheck, and GDD status.
- *Method:* `mise exec -- bun test test/bun/cli.test.ts && mise exec -- bunx tsc --noEmit && python3 "$HOME/.agents/skills/goal-driven-development/scripts/gdd_status.py" docs/goals/10-directory-copy-paste.md && git diff --check`
- *Expected:* All commands exit 0, with the goal done-eligible after evidence is recorded.
- *BDD scenarios covered:* Regression suite covers documented directory copy/paste behavior and existing image/file routing.

**Confidence:** 94 / 90 · **Depends on:** T3 · **Closes:** DoD-4, DoD-5

**Evidence (required before tick; append-only)**
- 2026-06-27 - `mise exec -- bun test test/bun/cli.test.ts` - exit 0; 15 tests passed, including CLI help examples for `pasta copy ./project-folder` and `pasta paste --out ./received-project`.
- 2026-06-27 - `mise exec -- bunx tsc --noEmit` - exit 0; directory zip module and CLI routing typecheck.
- 2026-06-27 - `mise exec -- bun run test` - exit 0; 30 Bun tests and 13 Worker tests passed.
- 2026-06-27 - `git diff --check` - exit 0; no whitespace errors.
- 2026-06-27 - `python3 "$HOME/.agents/skills/goal-driven-development/scripts/gdd_status.py" docs/goals/10-directory-copy-paste.md` - exit 0; `DONE true`, 5/5 DoD complete, no coverage or invariant violations.
- 2026-06-27 - external zip smoke `zipDirectory(...)` then `unzip -t bundle.zip` - exit 0; system unzip reported nested directory and file OK with no compressed data errors.
- 2026-06-27 - final rerun `mise exec -- bunx tsc --noEmit` - exit 0; no TypeScript errors after help/docs wording update.
- 2026-06-27 - final rerun `mise exec -- bun run test` - exit 0; 30 Bun tests and 13 Worker tests passed after help/docs wording update.
- 2026-06-27 - final rerun `git diff --check` - exit 0; no whitespace errors after help/docs wording update.

## 6. Decisions · LIVE (append-only)

Meaningful choices/concessions needing visibility. Scope impact must be `none`.

- 2026-06-27 - Directory support reuses the existing encrypted file payload and `/v1/files` path. The client locally zips on copy and locally unzips on paste, so Cloudflare continues to store only encrypted bytes plus MIME/size metadata. Scope impact: none.
- 2026-06-27 - Directory bundles use a Pasta-specific zip MIME instead of treating every `.zip` file as a directory. Normal zip files remain file payloads; only client-created directory bundles auto-extract on paste. Scope impact: none.
- 2026-06-27 - The directory archive stores paths relative to the selected directory root. Paste recreates the directory at the encrypted basename by default, or at `--out <dir>` when provided. Scope impact: none.
- 2026-06-27 - Self adversarial review found the main risk was conflating docs review with CLI help proof. The goal was split so user docs, CLI help, tests, and typecheck have separate DoD coverage before implementation. Scope impact: none.

---

## 7. Learnings · LIVE (append-only)

Flash cards: trigger → wrong action → revision → correct action, with impact `1–5`.
When an attempt failed and the fix is not yet known, log the **open form** —
trigger → wrong action → *(open: revision/correct not yet found)* → pointer to the raw
failure (log path or commit) — still impact-tagged, so a dead-end is recorded before a
fresh context re-treads it.

*(none yet)*

---

## 8. Skills · LIVE (append-only)

Reusable workflows created via the **skill-creator** skill while working this goal.

*(none yet)*
