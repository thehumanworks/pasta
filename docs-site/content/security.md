---
title: Security
slug: security
description: Threat model, trust boundaries, and what Pasta does not protect against.
nav_order: 10
---

<!-- @human -->
## What we protect

| Asset | Protection |
| --- | --- |
| Clipboard plaintext | Encrypted before upload; decrypted only on device |
| Group key | `$PASTA_HOME/auth.json` by default; wrapped for pairing |
| Device private keys | `$PASTA_HOME/auth.json` by default |
| Request integrity | Ed25519 signatures + body hash |
| Replay attacks | Timestamp window + nonce store |
| Unauthorized pairing | Requires trusted device approval |
| Noninteractive registration | Trusted-device join grants with short token TTL and expiring device lease |

## Trust boundaries

**Your device** is the only place plaintext and raw group keys exist during normal operation.

**Cloudflare** verifies signatures and stores ciphertext plus metadata. Operators could learn timing, sizes, and identifiers — not clipboard contents.

## Accepted non-goals

- Local malware on a trusted desktop
- Metadata hiding from the relay
- Secret recovery after total device loss
- Mobile / browser / GUI surfaces

## Local secrets

Pasta keeps device auth in `$PASTA_HOME/auth.json` with `0600` permissions by default. OS credential storage is disabled unless you opt in with `$PASTA_HOME/settings.json` or an environment variable such as `PASTA_AUTH_STORE=keychain`. This keeps SSH and other noninteractive terminals working without sending secrets to the relay or storing them in `config.json`.

## CI and sandbox tokens

Join tokens are CI secrets. They are not short codes and should not be copied into logs. A token defaults to a 10-minute redemption window and one use. The device created by redemption defaults to a 24-hour lease, which is useful for Modal sandboxes and other temporary environments.

Cloudflare stores a redemption verifier and sealed group-key grant. It never receives the seal secret needed to decrypt that grant. Once the joined device's lease expires, signed requests trigger real revocation and fail before any clipboard operation.

## Reset

`pasta reset --yes` rotates keys and routing id. Old ciphertext becomes undecryptable.

<!-- @agent -->
## Threat model source

`docs/threat-model.md`

## Protections

| Control | Location |
| --- | --- |
| Payload encryption | `shared/crypto.ts` |
| Request signing | `cli/client.ts`, Worker auth |
| Nonce replay | D1 nonces |
| Pairing hash | `hashShortCode` |
| Join grant seal | `sealJoinGrant` / `openJoinGrant` |
| Revocation | D1 + DO |

## Join grant controls

- Token TTL default 10 minutes, max 24 hours.
- Device TTL default 24 hours, max 30 days.
- `uses` default 1, max 10.
- Worker never receives `sealSecret`.
- Device expiry is enforced in Worker auth and converted to revoked state.

## Do not implement

Cloudflare Access/OAuth, P2P fallback, secrets in config/docs/logs/Cloudflare.
