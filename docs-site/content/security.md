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
| Revocation | D1 + DO |

## Do not implement

Cloudflare Access/OAuth, P2P fallback, secrets in config/docs/logs/Cloudflare.
