---
goal_id: "pasta-02-cloudflare-relay-backend"
title: "Cloudflare Relay Backend"
status: "done"
confidence_floor: 90
created: "2026-06-26"
updated: "2026-06-26"
---

# Goal: Cloudflare Relay Backend

Implement a Cloudflare Worker plus Durable Object relay that authenticates devices, stores encrypted clipboard entries, and returns latest/history without plaintext access.

## 1. Invariants

- Worker verifies signed device requests before invoking Durable Object state changes.
- D1 stores account/device registry and pairing sessions only.
- Durable Object stores encrypted clips and sequence/history state.
- R2 is unused for text MVP and reserved for encrypted blobs later.
- No API logs include clipboard plaintext, raw keys, or full signed secrets.

## 2. References

- [Cloudflare findings](../research/consolidated-findings.md#cloudflare-durable-objects)
- [Durable Object data model](../research/consolidated-findings.md#durable-object-data-model)
- [Protocol goal](01-protocol-and-threat-model.md)

## 3. Definition of Done - INVARIANT

- [x] **DoD-1** - Worker project has current Wrangler config, D1 binding, R2 binding placeholder, and SQLite-backed DO migration. - *verify by:* `wrangler types` and config review.
- [x] **DoD-2** - D1 migrations create registry tables and indexes. - *verify by:* local migration plus schema query.
- [x] **DoD-3** - ClipboardSpace DO initializes SQLite schema and schema version. - *verify by:* Workers Vitest instantiates a named DO and exercises schema through behavior.
- [x] **DoD-4** - Signed device auth works for valid devices and rejects invalid/stale/replayed/revoked requests. - *verify by:* integration tests.
- [x] **DoD-5** - Text publish/latest/history endpoints store and return opaque ciphertext with ordered sequence. - *verify by:* integration tests plus storage inspection.
- [x] **DoD-6** - Pairing storage flow stores wrapped group-key grants and consumes sessions once. - *verify by:* integration tests.
- [x] **DoD-7** - Retention cleanup uses DO alarms idempotently. - *verify by:* `runDurableObjectAlarm` test.

## 4. Exit Conditions

- **DONE** - All backend DoD pass locally and dry-run deploy/type generation succeeds.
- **BLOCKED-DEP** - Cloudflare config, account, or package version prevents local test runtime.
- **SCOPE-CHANGE** - Binary payloads or live WebSockets are required before text endpoints.
- **CONFIDENCE-STALL** - Auth or storage race remains unresolved after focused tests.
- **BUDGET** - Stop with failing command, exact error, and smallest next task.

## 5. Tasks - INVARIANT

### T1 - Scaffold Worker - [x]

- Create Worker TypeScript project.
- Add Durable Object class binding with `new_sqlite_classes`.
- Add D1 binding and R2 binding placeholder.
- Generate types from config.

Verification Contract:

- `wrangler types` exits 0.
- Config includes DO, D1, and R2 bindings.

**Confidence:** 90/100
**Depends on:** Goal 01 protocol names can be placeholders.
**Closes:** DoD-1
**Evidence:**
- 2026-06-26 - `mise exec -- bun run types` - exit 0; `worker-configuration.d.ts` generated for D1 `DB`, R2 `BLOBS`, and SQLite-backed Durable Object `CLIPBOARD`.
- 2026-06-26 - config review `wrangler.jsonc` - contains `d1_databases`, `r2_buckets`, `durable_objects.bindings`, and `migrations.new_sqlite_classes`.

### T2 - D1 Registry Migrations - [x]

- Add `accounts`, `devices`, and `pairing_sessions`.
- Add indexes for `routing_id`, `(account_id, device_id)`, `short_code_hash`, and expiry scans.

Verification Contract:

- `wrangler d1 migrations apply DB --local` exits 0.
- Schema query returns expected tables and indexes.

**Confidence:** 90/100
**Depends on:** Task 1
**Closes:** DoD-2
**Evidence:**
- 2026-06-26 - `mise exec -- wrangler d1 migrations apply DB --local` - exit 0; `0001_registry.sql` applied locally with 9 commands executed successfully.

### T3 - Durable Object Schema - [x]

- Implement `ClipboardSpace`.
- Initialize `clips`, `wrapped_keys`, and `meta`.
- Track schema version through `meta`.

Verification Contract:

- Workers Vitest creates `env.CLIPBOARD.getByName("test")`.
- Publishing a test opaque clip initializes schema and returns seq 1.

**Confidence:** 90/100
**Depends on:** Task 1
**Closes:** DoD-3
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; Worker tests instantiate `env.CLIPBOARD.getByName(...)`, publish a clip, and read sequence/history through DO behavior.

### T4 - Device Auth Middleware - [x]

- Implement canonical request verification.
- Validate D1 device status.
- Store replay nonce or equivalent replay marker with expiry.

Verification Contract:

- Tests cover valid request, stale timestamp, bad body hash, unknown device, revoked device, and replayed nonce.

**Confidence:** 95/100
**Depends on:** Goal 01 Task 4, Task 2
**Closes:** DoD-4
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; signed request tests cover valid request, stale timestamp, bad body hash, bad signature, unknown device, revoked device, and replayed nonce.

### T5 - Text Clip API - [x]

- Implement `POST /v1/clips`.
- Implement `GET /v1/clips/latest`.
- Implement `GET /v1/clips/history`.
- Implement `GET /v1/clips/:seq`.

Verification Contract:

- Publish two encrypted text clips, pull latest, list history, fetch one entry.
- Inspect DO state or behavior to prove no plaintext is stored.

**Confidence:** 90/100
**Depends on:** Tasks 3 and 4
**Closes:** DoD-5
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; Worker publishes encrypted text, returns latest/history, and storage inspection confirms plaintext marker is absent while ciphertext is present.
- 2026-06-26 - live local smoke `wrangler dev --local --port 8787` - exit 0; real HTTP API accepted `POST /v1/clips`, `GET /v1/clips/latest`, and cross-device paste.

### T6 - Pairing Persistence - [x]

- Implement pairing open/request/approve/consume storage.
- Hash short codes at rest.
- Expire sessions.

Verification Contract:

- Approved pairing stores one wrapped key for the new device.
- Expired, replayed, unapproved, and wrong-code flows fail.

**Confidence:** 95/100
**Depends on:** Tasks 2 and 4
**Closes:** DoD-6
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; Worker pairing test opens, approves, stores wrapped group-key grant, consumes once, and rejects replayed consume.
- 2026-06-26 - live local smoke with two `PASTA_HOME` profiles - exit 0; `pair request`, `devices approve`, `pair consume`, and cross-device decrypt/paste completed.

### T7 - Retention Alarm - [x]

- Store expiry metadata.
- Set one next alarm per DO.
- Make cleanup idempotent.

Verification Contract:

- `runDurableObjectAlarm(stub)` deletes expired rows, keeps live rows, and repeated run is harmless.

**Confidence:** 95/100
**Depends on:** Task 5
**Closes:** DoD-7
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; `runDurableObjectAlarm` deletes expired rows and repeated alarm run is harmless.

## 6. Decisions

- Do not implement WebSockets for MVP.
- Do not use R2 for text payloads.
- Do not use SQL `BEGIN`/`COMMIT` manually inside DO SQL paths; use storage transaction APIs where needed.
- 2026-06-26 - Backend stores only opaque encrypted clip payloads in the DO and registry/pairing metadata in D1; R2 binding remains a placeholder for Goal 06. Scope impact: none.

## 7. Learnings

- DO per clipboard space gives strong per-account sequencing without a global bottleneck.
- D1 is the right registry store; DO SQLite is the right per-space clipboard log.

## 8. Skills

- Use Cloudflare Durable Objects, Workers best practices, and wrangler guidance when implementing.
