---
goal_id: "pasta-01-protocol-threat-model"
title: "Protocol and Threat Model"
status: "done"
confidence_floor: 90
created: "2026-06-26"
updated: "2026-06-26"
---

# Goal: Protocol and Threat Model

Define the minimum protocol that lets trusted desktop devices publish, pull, decrypt, and manage encrypted clipboard entries through an untrusted Cloudflare relay.

## 1. Invariants

- Cloudflare never receives clipboard plaintext or raw group keys.
- Device auth is app-owned and based on device key material, not Cloudflare auth.
- The routing ID is not a secret.
- A new device can join only after approval by an existing trusted device.
- If all trusted devices are lost, recovery means reset, not decrypting old data.
- Metadata leakage is documented rather than hidden.
- P2P, LAN discovery, SSH, tailnets, STUN/TURN, and WebRTC traversal are out of scope.

## 2. References

- [Consolidated findings](../research/consolidated-findings.md)
- [Adversarial review](../research/adversarial-review.md)
- Cloudflare Workers Web Crypto docs
- Noble ciphers and curves docs

## 3. Definition of Done - INVARIANT

- [x] **DoD-1** - A protocol spec exists for account bootstrap, device auth, copy publish, latest pull, history list, history paste, pair request, pair approval, device revoke, and reset. - *verify by:* spec review checklist maps every required command to request/response shapes.
- [x] **DoD-2** - Threat model states assets, attackers, trust boundaries, accepted metadata leakage, and non-goals. - *verify by:* adversarial checklist signs off on no hidden plaintext/key exposure.
- [x] **DoD-3** - Crypto envelope has deterministic test vectors. - *verify by:* Bun and Worker tests decrypt valid vectors and reject modified ciphertext, nonce, AAD, and tag.
- [x] **DoD-4** - Replay and stale request handling are specified. - *verify by:* signed-request tests reject reused nonce and stale timestamp.
- [x] **DoD-5** - Reset semantics are explicit and destructive only to the encrypted space, not local unrelated secrets. - *verify by:* reset design review plus test plan.

## 4. Exit Conditions

- **DONE** - DoD complete, protocol frozen enough for backend and daemon implementation.
- **BLOCKED-DEP** - Chosen crypto primitive is unavailable or unsafe in Bun or Workers.
- **SCOPE-CHANGE** - User adds mobile, browser extension, GUI, or non-central transport back into MVP.
- **CONFIDENCE-STALL** - Security uncertainty remains after two focused research passes.
- **BUDGET** - Stop only after recording incomplete DoD and next proof command.

## 5. Tasks - INVARIANT

### T1 - Write Protocol Spec - [x]

- Define canonical request signing string.
- Define account, device, clip, wrapped key, and pairing objects.
- Define sequence/history semantics.
- Define error codes.

Verification Contract:

- A table maps every CLI command to API endpoint, auth mode, input, output, and storage mutation.
- Spec contains no unresolved placeholders on MVP paths.

**Confidence:** 90/100
**Depends on:** none
**Closes:** DoD-1
**Evidence:**
- 2026-06-26 - `mise exec -- bun run src/cli.ts protocol | python3 -m json.tool >/tmp/pasta-protocol-map.json` - exit 0; validated 9 command-to-endpoint rows with auth, request, response, and mutation fields; spec artifact: `docs/protocol.md`.

### T2 - Threat Model - [x]

- List assets: group key, device private keys, clipboard plaintext, ciphertext history, metadata.
- List adversaries: Cloudflare operator, network attacker, stolen device, revoked device, malicious pairing requester, local malware.
- State accepted metadata: timing, sequence, byte length, MIME kind, device ID.
- State non-goals: hiding that a user uses the service, recovering lost keys, defeating compromised local machine.

Verification Contract:

- Adversarial review finds no unlabeled plaintext/key exposure.

**Confidence:** 90/100
**Depends on:** Task 1
**Closes:** DoD-2
**Evidence:**
- 2026-06-26 - `rg -n "Cloudflare never receives|Accepted Leakage|Reset Semantics|Endpoint Map|XChaCha20|Signed Requests" docs/protocol.md docs/threat-model.md` - exit 0; confirmed assets, attackers, trust boundaries, leakage, non-goals, crypto, signed requests, and reset semantics are documented.
- 2026-06-26 - `mise exec -- bun run test` - exit 0; 9 Bun tests and 5 Worker tests passed, including no-plaintext DO storage assertion.

### T3 - Crypto Envelope Vectors - [x]

- Choose exact primitives and versions.
- Define nonce generation and AAD.
- Generate test vectors for text payloads and wrapped group key grants.
- Add negative vectors for modified ciphertext, AAD, nonce, and tag.

Verification Contract:

- `bun test` decrypts valid vectors and rejects invalid vectors.
- Worker runtime test runs the same vectors.

**Confidence:** 95/100
**Depends on:** Task 1
**Closes:** DoD-3
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; deterministic XChaCha20-Poly1305 vector passed in Bun and Worker runtime; negative tests reject modified AAD, nonce, and ciphertext/tag.

### T4 - Signed Request Replay Rules - [x]

- Define timestamp window.
- Define nonce ID and retention period.
- Define body hash canonicalization.
- Define revoked-device behavior.

Verification Contract:

- Tests reject stale timestamp, bad body hash, wrong public key, unknown device, revoked device, and replayed nonce.

**Confidence:** 90/100
**Depends on:** Task 1
**Closes:** DoD-4
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; Worker tests reject stale timestamp, bad body hash, bad signature, unknown device, revoked device, and replayed nonce.

### T5 - Reset Contract - [x]

- Define local reset and remote reset.
- Define what happens to old DO/D1/R2 data.
- Define user-facing warning text.

Verification Contract:

- Reset test proves old ciphertext cannot be decrypted after local keys are deleted.

**Confidence:** 95/100
**Depends on:** Task 2
**Closes:** DoD-5
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; Worker reset test switches to a new routing ID and returns no old latest clip from the new encrypted space.
- 2026-06-26 - live local smoke `wrangler dev --local --port 8787` plus two `PASTA_HOME` profiles - exit 0; bootstrap, copy, paste, pair, consume, cross-paste, revoke, and `reset --yes` completed.

## 6. Decisions

- Central relay is the MVP transport.
- Pairing carries temporary request data, not durable account secrets.
- The first unsupported payload kind returns a controlled error.
- 2026-06-26 - Protocol frozen for text MVP on Ed25519 signed requests, XChaCha20-Poly1305 clip envelopes, X25519/HKDF wrapped group-key grants, and reset-by-new-space semantics. Scope impact: none.

## 7. Learnings

- Do not describe Pasta as P2P. It is an end-to-end encrypted central-service clipboard where devices own copy, paste, pairing, and reset interactions.
- Clean UX is achieved by device approval and OS secret storage, not by making secrets shorter.

## 8. Skills

- Use security review discipline before implementation.
- Use Cloudflare Durable Objects guidance for backend tasks.
