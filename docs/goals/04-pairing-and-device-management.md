---
goal_id: "pasta-04-pairing-device-management"
title: "Pairing and Device Management"
status: "done"
confidence_floor: 90
created: "2026-06-26"
updated: "2026-06-26"
---

# Goal: Pairing and Device Management

Make device onboarding clean enough that users do not manually carry long IDs or durable secrets, while preserving end-to-end encryption and revocation.

## 1. Invariants

- Pairing requires an existing trusted device unless this is the first bootstrap device.
- Pairing code/QR is temporary and insufficient by itself without approval.
- Noninteractive join grants are temporary, high-entropy, and created only by an existing trusted device.
- Join-grant devices are permanent by default, and optional device TTL expiry becomes real revocation, not just display metadata.
- Durable account IDs and routing IDs are hidden from normal UX.
- Existing devices wrap group keys for new devices; the relay never sees raw group keys.
- Revoked devices cannot publish, pull, approve, or receive new wrapped keys.

## 2. References

- [Pairing, crypto, and secrets findings](../research/consolidated-findings.md#pairing-crypto-and-secrets)
- [Protocol goal](01-protocol-and-threat-model.md)
- [Backend goal](02-cloudflare-relay-backend.md)
- [CLI goal](03-bun-cli-daemon-text-mvp.md)

## 3. Definition of Done - INVARIANT

- [x] **DoD-1** - First-device bootstrap creates account metadata, device keys, and group key without external auth. - *verify by:* bootstrap integration test.
- [x] **DoD-2** - New-device pairing via short code and terminal QR works without manual durable secret entry. - *verify by:* two-device local test.
- [x] **DoD-3** - Existing-device approval signs request and stores wrapped group key for the new device. - *verify by:* backend and CLI integration test.
- [x] **DoD-4** - Device list/revoke works. - *verify by:* revoked device requests fail.
- [x] **DoD-5** - Reset creates a new encrypted space and clearly warns that old history is unrecoverable. - *verify by:* reset test.

## 4. Exit Conditions

- **DONE** - Two clean devices can pair and exchange encrypted text; revoked device fails; reset is proven.
- **BLOCKED-DEP** - Protocol or backend pairing endpoints incomplete.
- **SCOPE-CHANGE** - User requires password-based account recovery or mobile approval.
- **CONFIDENCE-STALL** - Pairing race/replay behavior cannot be proven.
- **BUDGET** - Stop with exact failing pairing step.

## 5. Tasks - INVARIANT

### T1 - Bootstrap First Device - [x]

- Generate account ID and internal routing ID.
- Generate group key and device signing/wrapping keys.
- Register first device as trusted.
- Store secrets locally.

Verification Contract:

- `bootstrap` creates one account and one active device.
- Config contains no raw private key or group key.

**Confidence:** 95/100
**Depends on:** Goals 01-03
**Closes:** DoD-1
**Evidence:**
- 2026-06-26 - live local smoke `PASTA_HOME=dev1 bun run src/cli.ts bootstrap --endpoint http://localhost:8787 --device-name dev1` - exit 0; first device bootstrapped without external auth.
- 2026-06-26 - `mise exec -- bun run test` - exit 0; CLI bootstrap test stores group/signing/wrapping private keys in SecretStore and public metadata in config.

### T2 - Pair Request UX - [x]

- New device creates ephemeral pairing request.
- Display short code and terminal QR.
- QR includes temporary pairing session data, not durable secrets.

Verification Contract:

- `pair` prints scannable terminal QR and short code.
- Decoded QR payload contains no raw group key or device private key.

**Confidence:** 95/100
**Depends on:** Task 1
**Closes:** DoD-2
**Evidence:**
- 2026-06-26 - live local smoke `pair ticket` plus `pair request --ticket ... --device-name dev2` - exit 0; request printed short code and terminal QR without manual durable account secret entry.

### T3 - Pair Approval - [x]

- Existing device fetches pending request or accepts short code.
- User sees device name/fingerprint.
- Existing device signs approval and wraps group key for new device.

Verification Contract:

- New device consumes wrapped key once and can decrypt future clips.
- Replay/expired/wrong-code attempts fail.

**Confidence:** 95/100
**Depends on:** Task 2 and Goal 02 Task 6
**Closes:** DoD-3
**Evidence:**
- 2026-06-26 - `mise exec -- bun run test` - exit 0; Worker pairing test approves wrapped group-key grant and consumes it once.
- 2026-06-26 - live local smoke `devices approve <code>` then `pair consume` - exit 0; new device decrypted existing latest clip and cross-device paste worked.

### T4 - Device List and Revoke - [x]

- Implement `devices list`.
- Implement `devices revoke <device>`.
- Backend marks revoked and rejects future requests.

Verification Contract:

- Revoked device cannot publish, pull, approve, or renew wrapped keys.

**Confidence:** 95/100
**Depends on:** Task 3
**Closes:** DoD-4
**Evidence:**
- 2026-06-26 - live local smoke `devices revoke <dev2>` - exit 0; subsequent dev2 `paste` failed and Worker log returned `GET /v1/clips/latest 403 Forbidden`.
- 2026-06-26 - `mise exec -- bun run test` - exit 0; Worker tests reject revoked device requests.

### T5 - Reset Flow - [x]

- Implement local reset and remote reset.
- Require explicit confirmation.
- Start a new encrypted space.

Verification Contract:

- Old ciphertext remains unreadable.
- New bootstrap/pairing can proceed after reset.

**Confidence:** 95/100
**Depends on:** Tasks 1-4
**Closes:** DoD-5
**Evidence:**
- 2026-06-26 - live local smoke `PASTA_HOME=dev1 bun run src/cli.ts reset --yes` - exit 0; new encrypted space created after explicit confirmation.
- 2026-06-26 - `mise exec -- bun run test` - exit 0; Worker reset test returns no old latest clip from the new routing ID.

## 6. Decisions

- No recovery phrase in MVP.
- No Cloudflare auth in MVP.
- No manual long ID entry in normal UX.
- 2026-06-26 - Pairing UX carries temporary ticket/code/QR material only; existing device approval wraps the group key and the relay never receives raw group keys. Scope impact: none.
- 2026-06-27 - CI/sandbox pairing uses trusted-device join grants instead of Cloudflare auth or copied local auth files. Token TTL gates redemption; optional device TTL gates actual device trust and becomes revocation at auth time. Scope impact: extends pairing without changing central-service or E2E encryption boundaries.

## 7. Learnings

- Good UX here is approval ceremony plus local secret storage, not simplifying cryptography.
- Noninteractive UX needs separate clocks: a short token TTL for setup safety and an optional device TTL for sandbox lifetime. Modal-style 24-hour devices are handled with `--device-ttl 24h` without a scheduler because auth lazily revokes expired devices.

## 8. Skills

- Use security review and product UX judgment before changing pairing flow.
