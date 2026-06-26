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

The wrapped group key is unwrapped locally and stored in `Bun.secrets`. Pending pairing state is cleared.

## Manage devices

```bash
pasta devices list
pasta devices revoke dev_example
```

Revoked devices cannot sign requests, publish, pull, or approve new pairings.

## Security properties

- Short codes expire (10-minute window in the CLI flow).
- Codes are **hashed with account context** before server storage.
- Consume is **one-time** — the grant cannot be replayed.
- Malicious pairing requests still need approval from a live trusted device.

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

## Test coverage

Pairing flows covered in `test/worker/backend.test.ts` and CLI mocks in `test/bun/cli.test.ts`.
