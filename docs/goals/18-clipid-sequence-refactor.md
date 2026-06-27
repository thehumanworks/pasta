---
goal_id: "pasta-18-clipid-sequence-refactor"
title: "ClipId Identity And Gap-Free Sequence Metadata"
status: "active"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: Make `clipId` the stable clip identity and keep `seq` gap-free display metadata.

## 1. Invariants

- `clipId` is the canonical identity for Worker routes, Durable Object rows, R2 keys, and client lookups.
- `seq` is display metadata only: contiguous `1..N`, higher means newer, and it is renumbered after deletes and retention cleanup.
- No backwards compatibility: old numeric clip/file routes, old R2 key shape, and incremental clip-table migration shims are removed.
- Privacy stays unchanged: Worker, Durable Object, R2, docs, tests, and logs must not expose clipboard plaintext or raw group keys.
- This goal changes only the clipboard relay/history surface: text/image/file history, delete, paste-by-reference, CLI selected-sequence UX, and iOS keyboard history identity.

---

## 2. References

- User task — requests `clipId` as stable identity, `seq` as gap-free display metadata, no backwards compatibility, tests, deploy, commit, and push.
- `src/worker/clipboard-space.ts` — Durable Object clip schema, publish/list/get/delete, R2 key reservation, retention cleanup.
- `src/worker/index.ts` — HTTP route shape and clip/file API path identity.
- `src/shared/protocol.ts` — public endpoint metadata and shared clip types.
- `src/cli.ts` — user-facing `--seq` and `history delete <seq>` resolution.
- `test/worker/backend.test.ts` — Worker route/schema/R2/delete/retention coverage.
- `test/bun/cli.test.ts` — CLI selected-sequence and payload-plan coverage.
- `ios/Sources/PastaCore/` and `ios/Keyboard/KeyboardViewController.swift` — iOS clip model, API history client, keyboard cache identity.
- `docs/protocol.md`, `docs/binary-payloads.md`, `docs-site/content/` — public docs that must stop describing numeric API identity.

---

## 3. Definition of Done

- [x] **DoD-1** — Worker storage/API uses `clipId` as the only stable clip identifier; `seq` stays contiguous after delete and retention cleanup. — *verify by:* `mise exec -- bunx vitest run test/worker/backend.test.ts --pool=workers`
- [x] **DoD-2** — CLI keeps sequence-based UX while resolving display `seq` to `clipId` before clip/file/delete API calls. — *verify by:* `mise exec -- bun test test/bun/cli.test.ts`
- [x] **DoD-3** — Swift/iOS models and history UI identify cached clips by `clipId`, not `seq`. — *verify by:* `swift test --package-path ios`
- [x] **DoD-4** — Protocol and payload documentation describe the no-compat schema replacement, clipId routes, clipId R2 keys, and empty-history deployment implication. — *verify by:* docs review plus `cd docs-site && bun run build -- --base /pasta/`
- [x] **DoD-5** — Changed Worker is deployed and a non-leaking remote smoke proves current remote API behavior. — *verify by:* `mise exec -- fnox exec -- wrangler deploy` plus signed CLI smoke against `https://pasta.nothuman.work`
- [ ] **DoD-6** — Verified changes are committed on `main` and pushed to `origin/main`. — *verify by:* `git status --short --branch` after `git push origin main`

---

## 4. Exit Conditions

- **`DONE`** — all §3 items ticked and all §5 tasks are at or above the confidence floor.
- **`BLOCKED-DEP`** — Cloudflare credentials, network, or device-local build tooling required for the named verification is unavailable after one direct retry.
- **`SCOPE-CHANGE`** — implementation cannot satisfy the user request without supporting old route/schema/R2 layouts or changing non-clipboard product architecture.
- **`CONFIDENCE-STALL`** — a task cannot reach confidence floor after three targeted fix-and-verify loops.

---

## 5. Tasks

### T1 · Inventory and contract · [x]

**Steps**
- [x] Locate every `seq`, `sequence`, `clipId`, `/v1/clips`, `/v1/files`, and R2 key usage across Worker, CLI, tests, docs, and iOS.
- [x] Confirm the smallest design that removes stable-identity coupling without reintroducing compatibility paths.

**Verification Contract**
- *Check:* All affected surfaces are known before edits.
- *Method:* `rg -n "\\bseq\\b|sequence|clipId|/v1/clips|/v1/files" src test docs docs-site ios --glob '!ios/build/**'`
- *Expected:* Search output inspected and referenced by subsequent tasks.
- *BDD scenarios covered:* existing numeric-route coupling is found; iOS `ForEach(id: \.sequence)` is found; old R2 key docs are found.

**Confidence:** 95 / 90 · **Depends on:** none · **Closes:** none

**Evidence**
- 2026-06-27 - `rg -n "\bseq\b|sequence|clipId|/v1/clips|/v1/files|clips/\$|files/\$" src test docs docs-site ios --glob '!ios/build/**'` - exit 0; identified Worker schema/routes, CLI selected-seq calls, R2 docs/tests, and iOS sequence identity references before edits.

### T2 · Worker schema, routes, and storage · [x]

**Steps**
- [x] Replace the clip table schema with `clip_id` primary identity and mutable unique `seq`.
- [x] Remove incremental `addColumnIfMissing` migration shims and bump destructive `schema_version`.
- [x] Route `GET/DELETE /v1/clips/:clipId` and `GET /v1/files/:clipId`; remove numeric route handling.
- [x] Generate R2 keys from `clipId` and renumber `seq` after delete, R2 rollback, and retention cleanup.
- [x] Add Worker tests for clipId routes, old numeric-route rejection, R2 key shape, and gap-free renumbering.

**Verification Contract**
- *Check:* Worker behavior matches the new identity and sequence semantics.
- *Method:* `mise exec -- bunx vitest run test/worker/backend.test.ts --pool=workers`
- *Expected:* Exit 0 with Worker tests covering clipId API paths and gap-free sequence after delete/retention.
- *BDD scenarios covered:* delete middle clip renumbers history; R2 file download uses clipId; old numeric routes no longer work; retention cleanup leaves contiguous visible seq.

**Confidence:** 95 / 90 · **Depends on:** T1 · **Closes:** DoD-1

**Evidence**
- 2026-06-27 - `mise exec -- bunx vitest run test/worker/backend.test.ts --pool=workers` - exit 0; 14 Worker tests passed, including clipId clip/file routes, numeric route 404, clipId R2 key shape, and gap-free sequence after delete and retention cleanup.

### T3 · CLI and iOS client identity · [x]

**Steps**
- [x] Resolve CLI `--seq`, `history paste <seq>`, and `history delete <seq>` by fetching history and using the selected row's `clipId` in API paths.
- [x] Update CLI file payload calls and payload-plan output for clipId R2 keys.
- [x] Update iOS keyboard cache identity and publish/history cache merging to use `clipId`.
- [x] Add or update Bun and Swift tests for the changed client behavior.

**Verification Contract**
- *Check:* Clients keep user-facing display sequence UX without calling numeric clip/file routes, and iOS cache identity is stable across renumbering.
- *Method:* `mise exec -- bun test test/bun/cli.test.ts && swift test --package-path ios`
- *Expected:* Exit 0; CLI mocks reject old numeric API assumptions and Swift tests assert clipId identity.
- *BDD scenarios covered:* selected file paste resolves seq to clipId before file API; delete resolves seq to clipId; keyboard duplicate filtering survives sequence renumbering.

**Confidence:** 95 / 90 · **Depends on:** T2 · **Closes:** DoD-2, DoD-3

**Evidence**
- 2026-06-27 - `mise exec -- bun test test/bun/cli.test.ts` - exit 0; 15 tests passed, with mocks requiring selected `--seq` paste/delete to resolve through history and call clipId clip/file routes.
- 2026-06-27 - `swift test --package-path ios` - exit 0; 14 tests passed, 1 live relay test skipped because `PASTA_IOS_JOIN_TOKEN` was unset; storage test asserts keyboard cache persists `clipId`.

### T4 · Docs and protocol contract · [x]

**Steps**
- [x] Update shared protocol endpoint metadata and public protocol/payload/docs-site pages.
- [x] Document that deployment replaces the clip table schema and existing history is empty afterward.
- [x] Build the docs site.

**Verification Contract**
- *Check:* Docs no longer describe numeric API identity or sequence-based R2 keys.
- *Method:* `rg -n "/v1/clips/:seq|/v1/files/:seq|clips/\\{seq\\}|sequence-based R2" docs docs-site src/shared/protocol.ts && cd docs-site && bun run build -- --base /pasta/`
- *Expected:* No stale numeric path/key references remain except historical goal evidence, and docs build exits 0.
- *BDD scenarios covered:* API docs show `clipId` paths; docs explain `seq` as display metadata; deploy note warns history is reset.

**Confidence:** 95 / 90 · **Depends on:** T3 · **Closes:** DoD-4

**Evidence**
- 2026-06-27 - `rg -n '/v1/clips/:seq|/v1/files/:seq|clips/\{seq\}|\{seq\}/\{payload_id\}|Latest / by seq|append-only sequence|sequence-based R2' src docs docs-site README.md --glob '!docs/goals/**'` - exit 1; no stale live numeric clip/file path or seq-key references remained.
- 2026-06-27 - `cd docs-site && bun run build -- --base /pasta/` - exit 0; built 15 pages to `docs-site/dist`.

### T5 · Final verification, deploy, review, commit, push · [ ]

**Steps**
- [x] Run broader project checks for TypeScript/Bun/Worker and Swift.
- [x] Deploy Worker with secret injection and run a non-leaking remote smoke against `https://pasta.nothuman.work`.
- [ ] Run an internal review-panel simulation for correctness, architecture, idiomaticity, tests, security/reliability, and performance.
- [ ] Commit and push the verified change.

**Verification Contract**
- *Check:* The verified implementation is live remotely and published to `origin/main`.
- *Method:* `mise exec -- bun run check && swift test --package-path ios && mise exec -- fnox exec -- wrangler deploy && git push origin main`
- *Expected:* Exit 0 for relevant checks/deploy/push; remote smoke proves clipId routes and sequence renumbering.
- *BDD scenarios covered:* remote publish/list/delete/list sequence after delete; no plaintext smoke values printed; final worktree contains only intended changes.

**Confidence:** 80 / 90 · **Depends on:** T4 · **Closes:** DoD-5, DoD-6

**Evidence**
- 2026-06-27 - `mise exec -- bun run check` - exit 0; generated Worker types, 30 Bun tests passed, and 14 Worker tests passed.
- 2026-06-27 - `swift test --package-path ios` - exit 0; 14 tests passed, 1 live relay test skipped because `PASTA_IOS_JOIN_TOKEN` was unset.
- 2026-06-27 - `mise exec -- fnox exec -- wrangler deploy` - exit 0; deployed `pasta.nothuman.work`, Version ID `53b7ae5b-888f-4db6-9ac4-520172220639`.
- 2026-06-27 - remote signed CLI smoke against `https://pasta.nothuman.work` with a temporary `PASTA_HOME` - exit 0; published three tiny file payloads, deleted display seq 2, verified remaining history first-column sequence `2,1`, pasted by `--seq 2` through the new clipId file route, deleted remaining smoke history, and removed the temp local profile.

---

## 6. Decisions

- 2026-06-27 — Treat the user-provided task as the confirmed execution contract for this goal because it explicitly defines the API/schema/client/docs/deploy outcomes, no-compatibility constraint, and delivery requirements. Scope impact: none.

---

## 7. Learnings

*(none yet)*

---

## 8. Skills

*(none yet)*
