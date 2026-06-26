---
goal_id: "pasta-06-binary-payloads-hardening"
title: "Binary Payloads and Hardening"
status: "active"
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

- [ ] **DoD-1** - Payload design chooses inline threshold, R2 object naming, and finalize semantics. - *verify by:* design review.
- [ ] **DoD-2** - Image clipboard capture/paste works on supported OSes or is explicitly scoped. - *verify by:* OS smoke matrix.
- [ ] **DoD-3** - File payload upload/download works for bounded file sizes. - *verify by:* integration tests.
- [ ] **DoD-4** - Retention cleanup deletes R2 objects and DO rows idempotently. - *verify by:* alarm test.
- [ ] **DoD-5** - Observability logs contain no plaintext, raw keys, or full file names if considered sensitive. - *verify by:* log scan test.

## 4. Exit Conditions

- **DONE** - Binary payloads work within declared size/platform limits and cleanup is proven.
- **BLOCKED-DEP** - Text MVP, R2 binding, or platform binary clipboard APIs incomplete.
- **SCOPE-CHANGE** - Mobile share sheets, GUI previews, or arbitrary huge files are required.
- **CONFIDENCE-STALL** - Streaming/chunking design cannot satisfy Worker limits.
- **BUDGET** - Stop with boundary test failure and next design choice.

## 5. Tasks - INVARIANT

### T1 - Large Payload Design - [ ]

- Decide inline ciphertext threshold.
- Decide R2 key format.
- Decide upload-first vs pending/finalize state transition.
- Decide max sizes by plan.

Verification Contract:

- Design review covers Worker body limits, DO limits, R2 object lifecycle, and failure recovery.

**Confidence:** 80/100
**Depends on:** Goals 01-05
**Closes:** DoD-1
**Evidence:**
- none yet

### T2 - Image Clipboard - [ ]

- Research and implement image read/write per OS.
- Preserve MIME type.
- Encrypt image bytes client-side.

Verification Contract:

- Supported OS smoke copies an image on one device and pastes identical bytes on another.

**Confidence:** 60/100
**Depends on:** Task 1
**Closes:** DoD-2
**Evidence:**
- none yet

### T3 - File Payload - [ ]

- Add explicit file send/paste command.
- Encrypt bytes locally.
- Upload/download via R2 path.

Verification Contract:

- Test transfers small, medium, and over-limit files with controlled outcomes.

**Confidence:** 70/100
**Depends on:** Task 1
**Closes:** DoD-3
**Evidence:**
- none yet

### T4 - Retention Cleanup - [ ]

- Track R2 object keys per clip.
- Delete expired R2 objects and DO metadata.
- Retry cleanup safely.

Verification Contract:

- Alarm test deletes expired objects and rows.
- Repeat alarm run is harmless.

**Confidence:** 75/100
**Depends on:** Tasks 1 and 3
**Closes:** DoD-4
**Evidence:**
- none yet

### T5 - Hardening Pass - [ ]

- Audit logs and errors.
- Add rate limits or abuse controls.
- Add metrics without sensitive values.
- Add backup/export only if it preserves E2E rules.

Verification Contract:

- Automated scan over logs/test outputs finds no plaintext markers or raw keys.
- Abuse tests reject excessive pairing attempts.

**Confidence:** 80/100
**Depends on:** Tasks 1-4
**Closes:** DoD-5
**Evidence:**
- none yet

## 6. Decisions

- This goal remains blocked until text MVP is complete.
- Binary support is opt-in; unsupported binary clipboard content must fail clearly before this goal lands.
- 2026-06-26 - Goals 01-05 are checkpointed done, including public GitHub `bunx` proof, so binary payload hardening is unblocked for design work. Scope impact: none.

## 7. Learnings

- R2 belongs behind the MVP, not in front of it.

## 8. Skills

- Use Cloudflare Workers best practices and coding-excellence hardening guidance.
