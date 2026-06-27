---
goal_id: "pasta-12-ios-shared-core"
title: "Native iOS Shared Core"
status: "blocked"
confidence_floor: 90
created: "2026-06-27"
updated: "2026-06-27"
---

# Goal: Native iOS Shared Core

## 1. Invariants · the rules that must not break

This file is the only state for this delivery subgoal — if it isn't written here,
it didn't happen. Scope freezes only after user confirmation of §3 and §5.
Tasks and DoD are ticked only with evidence and Confidence ≥ `confidence_floor`.
Scope changes stop execution and surface to the user.

---

## 2. References

- `docs/goals/11-ios-build-environment.md` — prerequisite workspace scaffold.
- `docs-site/content/native-ios.md` — Swift core requirements and data flow.
- `docs/protocol.md` — signed request, endpoint, and payload contracts.
- `docs/binary-payloads.md` — image, file, and directory payload contract.
- `docs/threat-model.md` — plaintext, metadata, and device trust boundaries.
- `src/shared/protocol.ts` — TypeScript protocol model source of truth.
- `src/shared/crypto.ts` — stable JSON, AAD hash, and encryption reference.
- `src/cli/client.ts` — canonical signed request construction.

---

## 3. Definition of Done · INVARIANT

- [ ] **DoD-1** — Swift golden-vector tests match TypeScript for base64url,
  stable JSON, body hash, AAD hash, canonical request strings, and Ed25519
  request signatures. — *verify by:* `swift test --package-path ios` plus the
  TypeScript vector generator check.
- [ ] **DoD-2** — Swift crypto supports pairing and clip encryption primitives
  used by Pasta: X25519, HKDF-SHA256, XChaCha20-Poly1305, SHA-256, and secure
  random bytes. — *verify by:* Swift unit tests against checked-in vectors.
- [ ] **DoD-3** — Swift models cover `EncryptedClip`, stored clip rows,
  encrypted metadata, file references, pairing requests, and device auth
  responses without adding mobile-only backend fields. — *verify by:* Swift unit
  tests and model fixture decoding.
- [ ] **DoD-4** — Swift HTTP client builds signed Pasta requests for existing
  Worker endpoints and redacts secrets from logs/errors. — *verify by:* unit
  tests for request construction and redaction.
- [ ] **DoD-5** — Keychain access-group and App Group storage abstractions exist
  with tests proving no secret data is stored in `UserDefaults` or app-group
  files. — *verify by:* storage tests and code review.

---

## 4. Exit Conditions

- **`DONE`** — Swift core can authenticate, encrypt/decrypt, model, and store
  Pasta state compatibly with the existing TypeScript implementation. *(primary)*
- **`BLOCKED-DEP`** — Goal 11 is not complete or a required audited Swift crypto
  primitive cannot be selected after one focused research pass.
- **`SCOPE-CHANGE`** — compatibility requires changing Worker routes, AAD,
  ciphertext format, key wrapping, or metadata leakage policy.
- **`CONFIDENCE-STALL`** — a task cannot reach 90 confidence after two attempts.
- **`BUDGET`** — one implementation pass plus one verification-fix loop is
  exhausted.

---

## 5. Tasks · INVARIANT

### T1 · Extract Cross-Language Golden Vectors · [ ]

**Steps**
- [ ] Add or reuse TypeScript vector generation for stable JSON, AAD, signed
  requests, text clips, file clips, metadata, and pairing material.
- [ ] Store vectors without secrets or production device identifiers.
- [ ] Document how to regenerate vectors.

**Verification Contract**
- *Check:* Swift can test against fixed TypeScript truth data.
- *Method:* TypeScript vector generation command plus `git diff -- docs ios test src`
- *Expected:* Deterministic fixtures exist and contain no plaintext secrets beyond
  intentionally fake test values.

**Confidence:** 0 / 90 · **Depends on:** Goal 11 · **Closes:** DoD-1

**Evidence (required before tick; append-only)**

---

### T2 · Choose And Implement Crypto Dependencies · [ ]

**Steps**
- [ ] Confirm which primitives come from CryptoKit/Swift Crypto and which require
  an external audited dependency or tightly scoped implementation.
- [ ] Implement wrappers with zero production logging of key material.
- [ ] Test encryption/decryption, wrapping/unwrapping, and failure paths.

**Verification Contract**
- *Check:* Swift primitives match Pasta vectors and fail closed on bad input.
- *Method:* `swift test --package-path ios`
- *Expected:* Crypto vector tests pass, including tampered ciphertext and metadata.

**Confidence:** 0 / 90 · **Depends on:** T1 · **Closes:** DoD-2

**Evidence (required before tick; append-only)**

---

### T3 · Port Protocol Models And Signed Client · [ ]

**Steps**
- [ ] Add Swift Codable models for current Worker requests/responses.
- [ ] Add canonical request construction and Ed25519 signing.
- [ ] Keep iOS as a normal trusted Pasta device with no mobile-only route forks.

**Verification Contract**
- *Check:* Swift emits the same canonical request bytes and headers as TypeScript.
- *Method:* `swift test --package-path ios`
- *Expected:* Request construction and model fixture tests pass.

**Confidence:** 0 / 90 · **Depends on:** T1, T2 · **Closes:** DoD-1, DoD-3, DoD-4

**Evidence (required before tick; append-only)**

---

### T4 · Add Secure Storage Abstractions · [ ]

**Steps**
- [ ] Add Keychain access-group storage for group key, signing key, and wrapping
  key.
- [ ] Add App Group storage for non-secret config and cached text history.
- [ ] Add tests or fakes proving secrets cannot fall back to app-group files or
  `UserDefaults`.

**Verification Contract**
- *Check:* Storage boundaries match the iOS security contract.
- *Method:* `swift test --package-path ios` plus code review.
- *Expected:* Tests pass and secret APIs have no non-Keychain fallback.

**Confidence:** 0 / 90 · **Depends on:** T2 · **Closes:** DoD-5

**Evidence (required before tick; append-only)**

---

### T5 · Verify Shared Core Against Existing TS Runtime · [ ]

**Steps**
- [ ] Run Swift tests.
- [ ] Run relevant TypeScript tests.
- [ ] Record any incompatibility as a blocker rather than papering over it.

**Verification Contract**
- *Check:* Swift and TypeScript agree on protocol, crypto, and model behavior.
- *Method:* `swift test --package-path ios && mise exec -- bun test`
- *Expected:* Both suites pass with non-zero relevant tests.

**Confidence:** 0 / 90 · **Depends on:** T3, T4 · **Closes:** DoD-1, DoD-2, DoD-3, DoD-4, DoD-5

**Evidence (required before tick; append-only)**

## 6. Decisions · LIVE (append-only)

- 2026-06-27 - iOS shared core must prove byte-for-byte compatibility with the
  existing TypeScript protocol before app or keyboard UI starts. The highest-risk
  footgun is silently inventing a Swift-only ciphertext, AAD, or signing dialect.
  Scope impact: none.
- 2026-06-27 - Self adversarial review found the crypto dependency choice is the
  main unknown, especially XChaCha20-Poly1305 availability in Swift. This goal
  requires an explicit dependency decision before implementation. Scope impact:
  none.

---

## 7. Learnings · LIVE (append-only)

*(none yet)*

---

## 8. Skills · LIVE (append-only)

*(none yet)*
