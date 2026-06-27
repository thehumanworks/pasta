---
title: Pairing & Devices
slug: pairing
description: How trusted devices join a clipboard space without typing long secrets.
nav_order: 7
---

<!-- @human -->
## Goals

Pairing should feel like approving a login — not like exchanging a PGP key on a phone call. Pasta uses:

- A **pairing ticket** (QR or URL) that carries endpoint + account + routing — never the group key
- A **short code** the new device displays
- **Approval** from an existing trusted device that wraps the group key
- A **join grant** for CI and sandbox devices that cannot wait for interactive approval

## First device (bootstrap)

```bash
pasta bootstrap --endpoint "$PASTA_ENDPOINT" --device-name "macbook"
```

This device already has the group key. No pairing needed.

## Add a second device

**Step 1 — Existing device prints a ticket**

```bash
pasta pair ticket
```

Output includes a `pasta://pair?endpoint=...&account=...&routing=...` URL and a terminal QR code.

**Step 2 — New device opens a pairing request**

```bash
pasta pair request --ticket 'pasta://pair?...' --device-name "workstation"
```

The new device generates its own signing/wrapping keys, opens a server-side pairing session, and displays:

- An **8-character short code** (e.g. `ABC12345`)
- A QR for `pasta://approve?code=...&session=...`

**Step 3 — Existing device approves**

```bash
pasta devices approve ABC12345
```

Behind the scenes, the trusted device wraps the group key for the newcomer's X25519 public key.

**Step 4 — New device consumes the grant**

```bash
pasta pair consume
```

The wrapped group key is unwrapped locally and stored in the local Pasta auth cache. Pending pairing state is cleared.

## Manage devices

```bash
pasta devices list
pasta devices list --include-revoked
pasta devices revoke dev_example
```

Revoked devices are hidden from the default list. `--include-revoked` shows retained revoked rows for audit/governance. Revoked devices cannot sign requests, publish, pull, approve new pairings, or be reactivated under the same device id; a returning machine must pair again as a fresh device.

## Noninteractive CI and sandbox devices

For Modal, CI, and other temporary noninteractive environments, create a join grant from an already trusted device:

```bash
pasta pair grant create --token-ttl 10m --uses 1 --json
```

Store the returned `joinToken` as a CI secret. Inside the sandbox:

```bash
pasta pair join --token "$PASTA_JOIN_TOKEN" --device-name "modal-${MODAL_TASK_ID:-sandbox}"
```

Token TTL and device TTL are separate. The token defaults to a 10-minute redemption window. The joined device has no revocation TTL by default and remains trusted until explicit revocation. Add `--device-ttl 24h` when the sandbox should auto-revoke after a Modal-style lifetime. Device expiry starts when the token is redeemed, so a queued job does not lose runtime just because the token was minted a few minutes earlier.

See [CI & Sandbox Pairing](/ci-pairing/) for the full Human and Agent contract.

## Security properties

- Short codes expire (10-minute window in the CLI flow).
- Codes are **hashed with account context** before server storage.
- Consume is **one-time** — the grant cannot be replayed.
- Malicious pairing requests still need approval from a live trusted device.
- Join grants are high-entropy, expiring, use-limited tokens created by a trusted device.
- Devices created through join grants can carry `device_expires_at` and are revoked after the lease when `--device-ttl` is set.

## Recovery

If you lose every trusted device, **there is no recovery**. From any remaining trusted device:

```bash
pasta reset --yes
```

This starts a fresh encrypted space. Re-pair all devices.

<!-- @agent -->
## Pairing ticket format

`pasta://pair?endpoint=<url>&account=<acct>&routing=<space>`

Parsed by `parsePairTicket()` in cli.ts. Does NOT contain group key material.

## pair request flow (cli.ts `pairCommand`)

1. Generate `deviceId`, `generateDeviceKeyMaterial()`, `makeShortCode()`, `hashShortCode(code, accountId)`
2. `sessionId = pair_${randomBase64Url(16)}`, `expiresAt = now + 10min`
3. Write config with `pendingPairing` block (includes `shortCodeHash`, keys, endpoint)
4. `POST /v1/pairing/open` with `PairingOpenRequest` (unsigned)
5. Store signing/wrapping **private** keys in secrets — NOT group key yet
6. Print code + QR for `pasta://approve?code=...&session=...`

## devices approve flow

1. `hashShortCode(code, config.accountId)`
2. `GET /v1/pairing/pending?shortCodeHash=...` (signed)
3. Parse newcomer's `wrapPublicKey` from session JSON
4. `wrapGroupKey({ groupKey, senderPrivateKey, senderPublicKey, recipientPublicKey })`
5. `POST /v1/pairing/approve` with wrapped key + keyVersion

## pair consume flow

1. Requires `config.pendingPairing`
2. `POST /v1/pairing/consume` with sessionId + shortCodeHash (unsigned)
3. Response: `wrappedGroupKey`, `accountId`, `routingId`, `deviceId`, `keyVersion`
4. `unwrapGroupKey()` → store `groupKey`, delete `pendingPairing`

## Server-side tables (D1)

See `migrations/0001_registry.sql`: `pairing_sessions`, `devices`, `accounts`.

## DO wrapped keys

Approved devices get wrapped key rows in ClipboardSpace DO for audit/revocation.

## Limits

`MAX_OPEN_PAIRING_SESSIONS = 5` per account (protocol.ts).

Join grant defaults: token TTL 10 minutes, no device TTL, uses 1. Server-side maximums: token TTL 24 hours, device TTL 30 days when set, uses 10.

## Noninteractive grant flow

See `/agent/ci-pairing.md` for the full contract. Summary:

1. Trusted device runs `pair grant create`; CLI generates independent `redeemSecret` and `sealSecret`.
2. Trusted device seals group key with a `sealSecret`-derived key and sends only `redeemSecretHash`, sealed grant, TTLs, and use limit to `POST /v1/pairing/grants`.
3. Automation runs `pair join --token`; CLI sends `redeemSecret` and new device public keys to `POST /v1/pairing/grants/redeem`.
4. Worker validates expiry/use count/hash, inserts active device with `device_expires_at = NULL` by default or `now + deviceTtlMs` when `--device-ttl` is set, and returns the sealed group key.
5. CLI decrypts with local `sealSecret`, stores normal auth, and never sends `sealSecret` to Cloudflare.

Joined devices with `device_expires_at` are lazily revoked in Worker auth after expiry before any signed operation succeeds.

## Test coverage

Pairing flows covered in `test/worker/backend.test.ts` and CLI mocks in `test/bun/cli.test.ts`.
