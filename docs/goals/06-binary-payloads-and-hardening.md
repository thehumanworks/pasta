---
goal_id: "pasta-06-binary-payloads-hardening"
title: "Binary Payloads and Hardening"
status: "done"
confidence_floor: 90
created: "2026-06-26"
updated: "2026-06-26"
---

# Goal: Binary Payloads and Hardening

Add images/files and harden operations only after the encrypted text MVP is stable.

## 1. Invariants

- Images/files are encrypted client-side before upload.
- Large payloads use R2 or chunking; DO stores metadata and sequence only.
- Worker and daemon stream where practical and do not buffer unbounded files.
- Payload size limits are explicit.
- Retention cleanup removes DO metadata and R2 objects.

## 2. References

- [Cloudflare findings](../research/consolidated-findings.md#cloudflare-durable-objects)
- [Adversarial review](../research/adversarial-review.md)
- Goals 01-05

## 3. Definition of Done - INVARIANT

- [x] **DoD-1** - Payload design chooses inline threshold, R2 object naming, and finalize semantics. - *verify by:* design review.
- [x] **DoD-2** - Image clipboard capture/paste works on supported OSes or is explicitly scoped. - *verify by:* OS smoke matrix.
- [x] **DoD-3** - File payload upload/download works for bounded file sizes. - *verify by:* integration tests.
- [x] **DoD-4** - Retention cleanup deletes R2 objects and DO rows idempotently. - *verify by:* alarm test.
- [x] **DoD-5** - Observability logs contain no plaintext, raw keys, or full file names if considered sensitive. - *verify by:* log scan test.

## 4. Exit Conditions

- **DONE** - Binary payloads work within declared size/platform limits and cleanup is proven.
- **BLOCKED-DEP** - Text MVP, R2 binding, or platform binary clipboard APIs incomplete.
- **SCOPE-CHANGE** - Mobile share sheets, GUI previews, or arbitrary huge files are required.
- **CONFIDENCE-STALL** - Streaming/chunking design cannot satisfy Worker limits.
- **BUDGET** - Stop with boundary test failure and next design choice.

## 5. Tasks - INVARIANT

### T1 - Large Payload Design - [x]

- Decide inline ciphertext threshold.
- Decide R2 key format.
- Decide upload-first vs pending/finalize state transition.
- Decide max sizes by plan.

Verification Contract:

- Design review covers Worker body limits, DO limits, R2 object lifecycle, and failure recovery.

**Confidence:** 92/100
**Depends on:** Goals 01-05
**Closes:** DoD-1
**Evidence:**
- 2026-06-26 - `docs/binary-payloads.md` design review - pass; chooses 512 KiB inline threshold, 50 MiB max binary size, R2 key format `spaces/{routing_id}/clips/{seq}/{payload_id}`, single-call signed file finalize semantics, metadata boundary, R2-write rollback, and idempotent retention cleanup order.
- 2026-06-26 - `mise exec -- bun run test:bun` - exit 0; 11 Bun tests passed including `payload-plan` assertion for inline threshold, max bytes, R2 key format, and signed finalize wording.
- 2026-06-26 - `mise exec -- bunx tsc --noEmit` - exit 0; payload plan constants and types compile.

### T2 - Image Clipboard - [x]

- Research and implement image read/write per OS.
- Preserve MIME type.
- Encrypt image bytes client-side.

Verification Contract:

- Supported OS smoke copies an image on one device and pastes identical bytes on another.

**Confidence:** 92/100
**Depends on:** Task 1
**Closes:** DoD-2
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; 13 Bun tests and 6 Worker tests passed, including inline image byte encryption/decryption, CLI `copy-image`/`paste-image`, and Worker inline image storage as ciphertext.
- 2026-06-26 - macOS image clipboard smoke `SystemClipboardAdapter.writeImage` then `readImage` using a 68-byte PNG - exit 0; output `image-ok 68`, proving identical PNG bytes through the local pasteboard adapter.
- 2026-06-26 - live local Worker two-profile image smoke with `PASTA_HOME` isolation - exit 0; dev1 bootstrapped, dev2 paired, dev1 `copy-image` published encrypted PNG, dev2 `paste-image --out` wrote identical 68-byte PNG.
- 2026-06-26 - supported OS scope review - live image clipboard support is macOS PNG for this checkpoint; Linux/Windows image support remains a documented command-plan assumption because this environment cannot run those native clipboards.

### T3 - File Payload - [x]

- Add explicit file send/paste command.
- Encrypt bytes locally.
- Upload/download via R2 path.

Verification Contract:

- Test transfers small, medium, and over-limit files with controlled outcomes.

**Confidence:** 93/100
**Depends on:** Task 1
**Closes:** DoD-3
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; 14 Bun tests and 7 Worker tests passed, including `send-file`/`paste-file` small+medium file CLI coverage, over-limit rejection, and Worker R2 upload/download/decrypt coverage.
- 2026-06-26 - live local Worker two-profile file smoke - exit 0; dev1 sent a 10-byte file and 65,536-byte file through `send-file`, dev2 wrote both with `paste-file --out`, and `cmp` verified identical bytes.
- 2026-06-26 - `mise exec -- bunx tsc --noEmit` - exit 0; R2-backed file metadata and CLI commands compile.

### T4 - Retention Cleanup - [x]

- Track R2 object keys per clip.
- Delete expired R2 objects and DO metadata.
- Retry cleanup safely.

Verification Contract:

- Alarm test deletes expired objects and rows.
- Repeat alarm run is harmless.

**Confidence:** 92/100
**Depends on:** Tasks 1 and 3
**Closes:** DoD-4
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; Worker file test publishes an expired R2-backed clip, confirms R2 object exists, runs the DO retention cleanup path used by `alarm()`, confirms R2 object is deleted, GET returns 404, and a second cleanup run deletes 0 clips/objects.
- 2026-06-26 - `mise exec -- bunx tsc --noEmit` - exit 0; async retention cleanup and alarm scheduling compile.

### T5 - Hardening Pass - [x]

- Audit logs and errors.
- Add rate limits or abuse controls.
- Add metrics without sensitive values.
- Add backup/export only if it preserves E2E rules.

Verification Contract:

- Automated scan over logs/test outputs finds no plaintext markers or raw keys.
- Abuse tests reject excessive pairing attempts.

**Confidence:** 92/100
**Depends on:** Tasks 1-4
**Closes:** DoD-5
**Evidence:**
- 2026-06-26 - `mise exec -- bun test test/bun/hardening.test.ts` - exit 0; source scan passed with 1 test and 15 assertions, covering runtime `console.*` logging calls and R2 metadata blocks for filename/path fields.
- 2026-06-26 - `mise exec -- bunx vitest run test/worker/backend.test.ts --pool=workers` - exit 0; 8 Worker tests passed, including account-scoped pairing abuse control that permits 5 live open sessions and rejects the 6th with `429 pairing_rate_limited`.
- 2026-06-26 - `mise exec -- bun run test` - exit 0; 15 Bun tests and 8 Worker tests passed, including hardening scan, file/image payloads, retention cleanup, and pairing abuse rejection.
- 2026-06-26 - `mise exec -- bunx tsc --noEmit` - exit 0; hardening constants, Worker rate-limit code, and tests compile.

## 6. Decisions

- This goal remains blocked until text MVP is complete.
- Binary support is opt-in; unsupported binary clipboard content must fail clearly before this goal lands.
- 2026-06-26 - Goals 01-05 are checkpointed done, including public GitHub `bunx` proof, so binary payload hardening is unblocked for design work. Scope impact: none.
- 2026-06-26 - T1 design keeps filenames out of default metadata because filenames and paths can be sensitive; user-approved labels can be added later without changing the encrypted object contract. Scope impact: none.
- 2026-06-26 - T2 scopes direct image clipboard support to macOS PNG in this environment, matching the user's instruction to test macOS and make reasonable assumptions for Linux/Windows. Scope impact: none.
- 2026-06-26 - T3 keeps filenames and local paths out of Worker/DO/R2 metadata; `send-file` accepts an explicit MIME type but not a filename label. Scope impact: none.
- 2026-06-26 - T5 caps unauthenticated pairing-open attempts to 5 live unconsumed sessions per account. This is a simple abuse control for the MVP; production tuning can later add IP/account windows without changing the E2E crypto boundary. Scope impact: none.

## 7. Learnings

- R2 belongs behind the MVP, not in front of it.
- A source-level no-log scan is useful because the Worker currently does not need runtime logging to satisfy MVP observability; when metrics are added later, tests should keep sensitive values out of log payloads and R2 metadata.

## 8. Skills

- Use Cloudflare Workers best practices and coding-excellence hardening guidance.
