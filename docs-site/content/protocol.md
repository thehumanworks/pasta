---
title: Protocol & Crypto
slug: protocol
description: Wire format, signing, encryption, and API endpoints for Pasta v0.1.5.
nav_order: 6
---

<!-- @human -->
## Version

Protocol version aligns with **`pasta 0.1.5`**. Run `pasta protocol` for the live endpoint map from your installed CLI.

## Identifiers

| Id | Purpose |
| --- | --- |
| `account_id` | Stable account row in D1 |
| `routing_id` | Selects Durable Object instance (not secret) |
| `device_id` | Per-device registry entry |
| `clip_id` | Client-generated opaque clip id |
| `seq` | DO-assigned append-only sequence |

## Encryption

**Clipboard payloads:** XChaCha20-Poly1305 with a 32-byte group key and 24-byte nonce.

**Additional authenticated data (AAD)** is canonical JSON binding ciphertext to account, routing, clip metadata, payload kind, MIME, byte length, and key version. The server stores an `aadHash`; clients must match.

**Device request signing:** Ed25519 over a canonical five-line string prefixed with `PASTA-SIGN-V1`.

**Pairing grants:** X25519 ECDH → HKDF-SHA256 → XChaCha20-Poly1305 wrapped group key for the new device.

**Join grants:** A trusted device seals the group key with a token-derived seal key for noninteractive registration. The Worker stores the sealed grant and a redemption verifier, but never sees the raw group key or the seal secret.

**Short codes:** User-visible codes are hashed with account context before storage; raw codes never persist server-side.

## Signed request headers

| Header | Content |
| --- | --- |
| `pasta-account-id` | Account |
| `pasta-device-id` | Device |
| `pasta-timestamp` | Unix ms |
| `pasta-nonce` | Random nonce |
| `pasta-body-sha256` | Base64url SHA-256 of body |
| `pasta-signature` | Ed25519 signature |

Canonical signed string:

```text
PASTA-SIGN-V1
<METHOD>
<PATH_WITH_QUERY>
<TIMESTAMP_MS>
<NONCE>
<BODY_SHA256_BASE64URL>
```

The Worker rejects requests outside a **5-minute** timestamp window, with bad body hashes, unknown/revoked devices, invalid signatures, or replayed nonces.

## Endpoint summary

| Operation | Method / Path | Auth |
| --- | --- | --- |
| Bootstrap | `POST /v1/accounts/bootstrap` | None |
| Publish clip | `POST /v1/clips` | Signed |
| Latest / by seq | `GET /v1/clips/latest`, `/v1/clips/:seq` | Signed |
| History | `GET /v1/clips/history` | Signed |
| Open pairing | `POST /v1/pairing/open` | None |
| Approve pairing | `POST /v1/pairing/approve` | Signed |
| Consume pairing | `POST /v1/pairing/consume` | None |
| Create join grant | `POST /v1/pairing/grants` | Signed |
| Redeem join grant | `POST /v1/pairing/grants/redeem` | Grant proof |
| Revoke join grant | `POST /v1/pairing/grants/:id/revoke` | Signed |
| List devices | `GET /v1/devices` | Signed |
| Revoke device | `POST /v1/devices/:id/revoke` | Signed |
| Reset space | `POST /v1/reset` | Signed |
| Upload file | `POST /v1/files` | Signed |
| Download file | `GET /v1/files/:seq` | Signed |

## Reset semantics

`POST /v1/reset` with `{ confirm: "RESET", newRoutingId }` rotates the encrypted space. Old ciphertext may remain until retention cleanup but is unreachable under the new routing id and undecryptable without the old group key.

## Noninteractive join grants

Join grants are for CI and sandbox devices. A trusted device creates a high-entropy token with two clocks:

- Token TTL: default 10 minutes, maximum 24 hours. Controls redemption.
- Device TTL: default none, maximum 30 days when set. Controls optional automatic revocation of the joined device.

When a device TTL is set, the joined device's expiry is calculated at redemption time. Worker auth treats `device_expires_at` as real revocation: once expired, the next valid signed request marks the device row revoked and is rejected before clipboard operations run. Without a device TTL, `device_expires_at` is null and the joined device remains trusted until explicit revocation.

<!-- @agent -->
## Source of truth

- Types & constants: `src/shared/protocol.ts`
- Crypto primitives: `src/shared/crypto.ts`
- Human spec mirror: `docs/protocol.md`

## Key constants

```typescript
PASTA_VERSION = "0.1.5"
SIGNING_VERSION = "PASTA-SIGN-V1"
REQUEST_TOLERANCE_MS = 5 * 60 * 1000
REQUEST_NONCE_TTL_MS = 10 * 60 * 1000
TEXT_INLINE_LIMIT_BYTES = 512 * 1024
LARGE_PAYLOAD_MAX_BYTES = 50 * 1024 * 1024
MAX_OPEN_PAIRING_SESSIONS = 5
JOIN_GRANT_TOKEN_TTL_MS = 10 * 60 * 1000
JOIN_GRANT_TOKEN_TTL_MAX_MS = 24 * 60 * 60 * 1000
JOIN_GRANT_DEVICE_TTL_MS = null
JOIN_GRANT_DEVICE_TTL_MAX_MS = 30 * 24 * 60 * 60 * 1000
JOIN_GRANT_MAX_USES = 10
DEFAULT_HISTORY_LIMIT = 20
MAX_HISTORY_LIMIT = 100
```

## EncryptedClip shape

Fields: `clipId`, `originDeviceId`, `createdAt`, `expiresAt`, `payloadKind` (`text`|`image`|`file`), `mime`, `byteLen`, `keyVersion`, `nonce`, `aadHash`, `ciphertext`, optional `storageKind`, `payloadId`, `r2Key`.

`StoredClip` adds `seq`.

## AAD construction

`aadForClip(accountId, routingId, clip)` → stable JSON → `clipAadHash()`.

Decrypt must verify AAD hash before releasing plaintext.

## Crypto functions (shared/crypto.ts)

| Function | Use |
| --- | --- |
| `generateDeviceKeyMaterial()` | Ed25519 + X25519 keypairs |
| `generateGroupKey()` | 32-byte symmetric key |
| `encryptTextClip` / `encryptBytesClip` | Publish |
| `decryptTextClip` / `decryptBytesClip` | Pull |
| `wrapGroupKey` / `unwrapGroupKey` | Pairing |
| `makeShortCode` / `hashShortCode` | Pairing UX |
| `createJoinGrantToken` / `parseJoinGrantToken` | CI join token envelope |
| `sealJoinGrant` / `openJoinGrant` | Token-sealed group key |

Noble libraries: `@noble/ciphers`, `@noble/curves`, `@noble/hashes`.

## Join grant request types

`PairingGrantCreateRequest`:

```typescript
interface PairingGrantCreateRequest {
  grantId: string;
  label?: string;
  redeemSecretHash: string;
  sealedGroupKey: string;
  keyVersion: number;
  tokenExpiresAt: number;
  deviceTtlMs: number | null;
  maxUses: number;
}
```

`PairingGrantRedeemRequest`:

```typescript
interface PairingGrantRedeemRequest extends DevicePublicKeys {
  grantId: string;
  redeemSecret: string;
  newDeviceId: string;
  newDeviceName: string;
}
```

`PairingGrantRedeemResponse` includes `accountId`, `routingId`, `deviceId`, `sealedGroupKey`, `keyVersion`, `tokenExpiresAt`, nullable `deviceTtlMs`, nullable `deviceExpiresAt`, `maxUses`, and `redeemedAt`.

Worker redemption must atomically check expiry/use count/hash and insert the device with `device_expires_at = NULL` when `device_ttl_ms` is null, otherwise `now + device_ttl_ms`.

## Canonical request helper

`canonicalRequest({ method, pathWithQuery, timestamp, nonce, bodyHash })` — must match client and Worker byte-for-byte.

## Verification

Deterministic crypto vectors: `test/bun/crypto.test.ts`
Worker auth integration: `test/worker/backend.test.ts`
