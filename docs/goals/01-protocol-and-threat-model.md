---
goal_id: "pasta-01-protocol-threat-model"
title: "Protocol and Threat Model"
status: "active"
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

- [ ] **DoD-1** - A protocol spec exists for account bootstrap, device auth, copy publish, latest pull, history list, history paste, pair request, pair approval, device revoke, and reset. - *verify by:* spec review checklist maps every required command to request/response shapes.
- [ ] **DoD-2** - Threat model states assets, attackers, trust boundaries, accepted metadata leakage, and non-goals. - *verify by:* adversarial checklist signs off on no hidden plaintext/key exposure.
- [ ] **DoD-3** - Crypto envelope has deterministic test vectors. - *verify by:* Bun and Worker tests decrypt valid vectors and reject modified ciphertext, nonce, AAD, and tag.
- [ ] **DoD-4** - Replay and stale request handling are specified. - *verify by:* signed-request tests reject reused nonce and stale timestamp.
- [ ] **DoD-5** - Reset semantics are explicit and destructive only to the encrypted space, not local unrelated secrets. - *verify by:* reset design review plus test plan.

## 4. Exit Conditions

- **DONE** - DoD complete, protocol frozen enough for backend and daemon implementation.
- **BLOCKED-DEP** - Chosen crypto primitive is unavailable or unsafe in Bun or Workers.
- **SCOPE-CHANGE** - User adds mobile, browser extension, GUI, or non-central transport back into MVP.
- **CONFIDENCE-STALL** - Security uncertainty remains after two focused research passes.
- **BUDGET** - Stop only after recording incomplete DoD and next proof command.

## 5. Tasks - INVARIANT

### T1 - Write Protocol Spec - [ ]

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
- none yet

### T2 - Threat Model - [ ]

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
- none yet

### T3 - Crypto Envelope Vectors - [ ]

- Choose exact primitives and versions.
- Define nonce generation and AAD.
- Generate test vectors for text payloads and wrapped group key grants.
- Add negative vectors for modified ciphertext, AAD, nonce, and tag.

Verification Contract:

- `bun test` decrypts valid vectors and rejects invalid vectors.
- Worker runtime test runs the same vectors.

**Confidence:** 85/100
**Depends on:** Task 1
**Closes:** DoD-3
**Evidence:**
- none yet

### T4 - Signed Request Replay Rules - [ ]

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
- none yet

### T5 - Reset Contract - [ ]

- Define local reset and remote reset.
- Define what happens to old DO/D1/R2 data.
- Define user-facing warning text.

Verification Contract:

- Reset test proves old ciphertext cannot be decrypted after local keys are deleted.

**Confidence:** 85/100
**Depends on:** Task 2
**Closes:** DoD-5
**Evidence:**
- none yet

## 6. Decisions

- Central relay is the MVP transport.
- Pairing carries temporary request data, not durable account secrets.
- The first unsupported payload kind returns a controlled error.

## 7. Learnings

- Do not describe Pasta as P2P. It is an end-to-end encrypted central-service clipboard where devices own copy, paste, pairing, and reset interactions.
- Clean UX is achieved by device approval and OS secret storage, not by making secrets shorter.

## 8. Skills

- Use security review discipline before implementation.
- Use Cloudflare Durable Objects guidance for backend tasks.
