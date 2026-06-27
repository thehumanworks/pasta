---
title: CI & Sandbox Pairing
slug: ci-pairing
description: Noninteractive device registration with expiring join tokens and auto-revoked sandbox devices.
nav_order: 8
---

<!-- @human -->
## What this is for

CI jobs, Modal sandboxes, remote builders, and short-lived automation cannot stop and wait for a human to approve an 8-character pairing code. Pasta supports this with a **join grant** created ahead of time by an already trusted device.

A join grant is a high-entropy, single-purpose secret. It lets one automation environment register itself as a normal Pasta device without an interactive approval step. The new device still gets its own signing key, wrapping key, local auth cache, and device record. The difference is that approval happened when the trusted device created the grant.

This is the right flow for:

- Modal sandboxes that live up to 24 hours
- CI jobs that need clipboard access during a test or release run
- Disposable remote environments where browser/QR approval is not available
- Headless setup where `$PASTA_HOME/auth.json` should be created from an injected secret

Use normal `pair request` / `devices approve` / `pair consume` for laptops and other long-lived human devices.

## The two clocks

Join grants have two separate time limits.

| Clock | Default | What it controls |
| --- | --- | --- |
| Token TTL | 10 minutes | How long the join token can be redeemed |
| Device TTL | 24 hours | How long the registered automation device remains trusted |

The token TTL is intentionally short. It is only the setup window for the CI secret. You can override it when the queue or sandbox startup time is longer:

```bash
pasta pair grant create --token-ttl 30m --device-ttl 24h --json
```

The device TTL starts when the token is redeemed, not when it is created. If a Modal sandbox redeems a grant at 14:05 with `--device-ttl 24h`, the resulting device is revoked around 14:05 the next day.

## Create a token from a trusted device

On an already paired device:

```bash
pasta pair grant create \
  --token-ttl 10m \
  --device-ttl 24h \
  --uses 1 \
  --label modal-smoke \
  --json
```

The command prints JSON containing a `joinToken`. Store that value in the CI or Modal secret store, for example as `PASTA_JOIN_TOKEN`. The token is sensitive. It does not contain the raw group key, but it can unlock a sealed group-key grant during the redemption window.

Recommended settings:

- Keep `--uses 1` unless you intentionally want one grant to register several sandboxes.
- Keep `--token-ttl` close to expected queue time. Use `10m` by default, `30m` for slow queues, and avoid long windows.
- Use `--device-ttl 24h` for Modal because Modal sandboxes can live for a day.
- Use shorter device TTLs for jobs that are known to finish quickly, such as `--device-ttl 2h`.

## Join inside CI or a sandbox

Inside the noninteractive environment:

```bash
export PASTA_HOME="${RUNNER_TEMP:-/tmp}/pasta"
pasta pair join --token "$PASTA_JOIN_TOKEN" --device-name "modal-${MODAL_TASK_ID:-sandbox}"
```

`pair join` generates fresh device keys, redeems the token, decrypts the sealed group-key grant locally, writes `$PASTA_HOME/config.json`, and writes `$PASTA_HOME/auth.json` with owner-only permissions.

After that, the sandbox uses normal commands:

```bash
printf 'hello from CI\n' | pasta copy
pasta paste
pasta history
```

When the device TTL expires, the Worker revokes the sandbox device. Expired devices cannot publish, pull, approve pairings, or create additional grants. You do not need a cleanup job for the security boundary.

## What happens on expiry

Device expiry is real revocation. On the first valid signed request after `device_expires_at`, the Worker marks the device as revoked, records `revoked_at`, removes the active wrapped-key record when present, and rejects the request with an auth error.

This lazy revocation keeps the system simple: there is no scheduled cleanup worker to trust. A sandbox that goes silent after expiry is still no longer usable, because the next request is rejected before any clipboard operation runs.

## Security model

The join token is stronger than a short code and should be handled like a CI deployment secret.

- The trusted device creates the grant and signs the grant creation request.
- Cloudflare stores only grant metadata, a redemption verifier, and a sealed group-key grant.
- Cloudflare never receives the raw group key or the seal secret needed to decrypt the sealed grant.
- Redemption is bounded by token expiry, use count, and account.
- The device created by redemption is bounded by `device_expires_at` and is automatically revoked at expiry.
- If a join token leaks before redemption, revoke the grant or let the short token TTL expire.
- If a joined sandbox may have leaked local auth after redemption, revoke the device.
- If the group key may have leaked, reset the encrypted space.

## Failure cases

| Case | Result |
| --- | --- |
| Token expired | `pair join` fails; create a new grant |
| Token already used | Redemption fails with a consumed-grant error |
| Device TTL expired | Signed requests fail and the device is revoked |
| Grant revoked before use | Redemption fails |
| CI logs the token | Revoke the grant if unused; revoke the device if already redeemed |

<!-- @agent -->
## Contract

Noninteractive pairing is implemented as a signed trusted-device grant plus unauthenticated token redemption. It is not a Cloudflare auth product, not OAuth, and not a second account system.

Primary commands:

```bash
pasta pair grant create [--token-ttl <duration>] [--device-ttl <duration>] [--uses <n>] [--label <text>] [--json]
pasta pair grant revoke <grantId>
pasta pair join --token <joinToken> [--device-name <name>]
```

Defaults:

- `--token-ttl 10m`
- `--device-ttl 24h`
- `--uses 1`

Server-side bounds:

- Token TTL must be positive and no greater than 24 hours.
- Device TTL must be positive and no greater than 30 days.
- Uses must be at least 1 and no greater than 10.
- Permanent devices are intentionally not created through join grants. Use the interactive pairing flow for long-lived human devices.

Durations accept `s`, `m`, `h`, and `d` suffixes and are converted to milliseconds before request construction.

## Token format

Join tokens are opaque to users but structured for the CLI:

```text
pasta_join_v1.<endpoint-b64>.<account-id>.<grant-id>.<redeem-secret>.<seal-secret>
```

Rules:

- `redeem-secret` and `seal-secret` are independent 32-byte base64url random values.
- The CLI sends `redeem-secret` only to `/v1/pairing/grants/redeem`.
- The CLI never sends `seal-secret` to the Worker.
- The trusted device never sends either secret during grant creation; it sends only `redeemSecretHash`.
- The token must be redacted in logs and never written to config.

Hash:

```text
redeemSecretHash = SHA256("pasta-join-redeem-v1\0" + accountId + "\0" + grantId + "\0" + redeemSecret)
```

Seal key:

```text
sealKey = HKDF-SHA256(sealSecret, salt = accountId || grantId, info = "pasta-join-seal-v1")
```

The sealed grant uses XChaCha20-Poly1305 with AAD:

```json
{
  "accountId": "acct_...",
  "grantId": "grant_...",
  "keyVersion": 1,
  "deviceTtlMs": 86400000,
  "tokenExpiresAt": 1782475200000,
  "maxUses": 1
}
```

Plaintext is the base64url group key bytes. Cloudflare stores `sealedGroupKey` as opaque JSON with `v`, `alg`, `nonce`, and `ciphertext`.

## D1 schema

`devices` includes:

```sql
device_expires_at INTEGER
```

`pairing_grants` includes:

```sql
grant_id TEXT PRIMARY KEY,
account_id TEXT NOT NULL,
label TEXT,
redeem_secret_hash TEXT NOT NULL UNIQUE,
sealed_group_key TEXT NOT NULL,
key_version INTEGER NOT NULL,
token_expires_at INTEGER NOT NULL,
device_ttl_ms INTEGER NOT NULL,
max_uses INTEGER NOT NULL,
use_count INTEGER NOT NULL DEFAULT 0,
created_by_device_id TEXT NOT NULL,
created_at INTEGER NOT NULL,
revoked_at INTEGER,
last_redeemed_at INTEGER
```

Indexes:

```sql
CREATE INDEX idx_pairing_grants_account_expiry ON pairing_grants(account_id, token_expires_at);
CREATE INDEX idx_devices_account_expiry ON devices(account_id, device_expires_at);
```

## API

Create grant, signed by an active trusted device:

```http
POST /v1/pairing/grants
```

Request:

```json
{
  "grantId": "grant_...",
  "label": "modal-smoke",
  "redeemSecretHash": "base64url...",
  "sealedGroupKey": "{\"v\":1,...}",
  "keyVersion": 1,
  "tokenExpiresAt": 1782475200000,
  "deviceTtlMs": 86400000,
  "maxUses": 1
}
```

Mutation: insert `pairing_grants` row scoped to `auth.accountId` and `auth.deviceId`.

Redeem grant, unsigned except for the grant proof:

```http
POST /v1/pairing/grants/redeem
```

Request:

```json
{
  "grantId": "grant_...",
  "redeemSecret": "base64url...",
  "newDeviceId": "dev_...",
  "newDeviceName": "modal-...",
  "verifyPublicKey": "base64url...",
  "wrapPublicKey": "base64url..."
}
```

Server steps:

1. Lookup grant by `grantId`.
2. Reject if `revoked_at` is set, `token_expires_at <= now`, or `use_count >= max_uses`.
3. Compute `redeemSecretHash` and constant-time compare.
4. Insert active device with `device_expires_at = now + device_ttl_ms`.
5. Increment `use_count`, set `last_redeemed_at`.
6. Return account/routing/device metadata and `sealedGroupKey`.

Response:

```json
{
  "accountId": "acct_...",
  "routingId": "space_...",
  "deviceId": "dev_...",
  "sealedGroupKey": "{\"v\":1,...}",
  "keyVersion": 1,
  "deviceExpiresAt": 1782561600000,
  "redeemedAt": 1782475200000
}
```

Grant revoke:

```http
POST /v1/pairing/grants/:grantId/revoke
```

Signed. Sets `revoked_at`; does not revoke already joined devices. Use `devices revoke` for joined devices.

## CLI join flow

1. Parse token; reject malformed or unsupported version.
2. Generate `deviceId` and `generateDeviceKeyMaterial()`.
3. `POST /v1/pairing/grants/redeem` with `grantId`, `redeemSecret`, device name, and public keys.
4. Derive `sealKey` from local `sealSecret`; decrypt `sealedGroupKey`.
5. Write normal `PastaConfig` with `deviceExpiresAt` and no `pendingPairing`.
6. Store `groupKey`, signing private key, and wrapping private key in `SecretStore`.
7. Print joined device id and expiry; never print token material.

Config extension:

```typescript
interface PastaConfig {
  deviceExpiresAt?: number;
}
```

## Auth expiry

Worker auth must check `device_expires_at` during signed authentication before dispatching any operation handler:

1. Load device row.
2. If `status !== "active"`, reject as revoked.
3. Verify timestamp, body hash, signature, and nonce using the registered device key.
4. If `device_expires_at !== null && device_expires_at <= now`, update device row to `status = 'revoked'`, set `revoked_at = now`, call `ClipboardSpace.revokeDevice()`, and reject with `expired_device`.
5. Dispatch only non-expired devices to copy, paste, history, approve, grant-create, revoke, or reset handlers.

This makes expiry a real revocation while avoiding a scheduler dependency.

## Tests

Required coverage:

- grant create uses defaults `10m`, `24h`, `1` and enforces server maxes
- token redemption registers a device with `device_expires_at = redeemedAt + deviceTtlMs`
- Worker never receives `sealSecret` and cannot decrypt `sealedGroupKey`
- redeemed device can copy/paste before expiry
- token cannot be reused after `maxUses`
- expired token cannot redeem
- expired device is marked revoked and rejected on first signed request after expiry
- grant revoke blocks unused token without affecting already redeemed devices
