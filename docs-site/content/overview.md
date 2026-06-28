---
title: Overview
slug: overview
description: What Pasta is for, what it is not, and the current product shape.
nav_order: 2
---

<!-- @human -->
## What Pasta does

Pasta lets **trusted devices share a clipboard** through an encrypted central relay. When you copy text (or, on supported paths, an image or file) on one device, another device you have paired can pull and decrypt it locally on paste.

The desktop experience is deliberately **terminal-first**: a `pasta` CLI, an optional background daemon that watches your clipboard, and shell aliases for common flows.

The native iOS experience is **keyboard-centered**: the Pasta keyboard inserts text history inside supported text fields, while the app, Share extension, and Shortcuts handle pairing, publishing, and binary handoff. See [Native iOS](/native-ios/) for the exact platform limits.

## Why a central relay?

Many clipboard tools assume P2P, LAN broadcast, or a mesh VPN. Pasta targets environments where those paths fail — corporate firewalls, locked-down laptops, coffee-shop Wi‑Fi. **Outbound HTTPS to a normal Cloudflare Worker** is the only transport.

That choice trades metadata visibility (the relay sees *that* you copied, *when*, and *how big*) for reliability. It does **not** trade away confidentiality of clipboard contents: those are encrypted on your device before upload.

## Core promises

1. **End-to-end encryption** — XChaCha20-Poly1305 with a shared group key wrapped per device at pairing time.
2. **Device-owned auth** — Ed25519 request signatures; no Cloudflare identity products in the MVP.
3. **Pull on paste** — no always-on sync unless you opt into the daemon.
4. **Clean pairing** — short code + QR; no typing long secrets.
5. **Honest recovery** — lose all devices → `reset`; no backdoor recovery.

## Supported surfaces

| Capability | Status |
| --- | --- |
| Text copy / paste / history | Done: all desktop platforms via CLI |
| Daemon auto-publish | Done: text polling |
| Pairing & device revoke | Done |
| macOS PNG image clipboard | Done: `copy --image` / `paste --image` |
| File payloads <= 50 MiB | Done: R2-backed `copy <path>` / `paste` |
| Native iOS text paste | Done by custom keyboard where iOS allows third-party keyboards |
| iOS publish | Done through Share extension, explicit keyboard/app action, or App Intent |
| iOS image/file/directory paste | Handoff only: clipboard/share/app/File Provider paths, not text-field insertion |
| Linux / Windows image clipboard | Documented assumption; not live-smoked here |
| npm / compiled binaries | Fallback paths; GitHub `bunx` is primary |

## What Pasta is not

- Not a password manager, note sync app, or team chat product.
- Not zero-knowledge metadata hiding — timing, sizes, and device IDs are visible to the relay operator.
- Not malware-resistant on a compromised desktop — local plaintext is in the threat model.
- Not multi-tenant SaaS — you deploy (or share) a relay; devices bootstrap their own account.

## A day in the life

**Morning setup:** `pasta daemon` in a tmux pane on your laptop. Copy a snippet in your editor — the daemon publishes ciphertext.

**Afternoon on your workstation:** `pasta paste --clipboard` or a shell alias bound in your terminal. Plaintext never touched Cloudflare.

**New machine:** `pair ticket` → `pair request` → `devices approve` → `pair consume`. Two minutes, no secret hand-typing.

<!-- @agent -->
## System identity

- **Name:** Pasta (`pasta` CLI/bin)
- **Version:** 0.1.15 (`PASTA_VERSION` in `src/shared/protocol.ts`)
- **License:** UNLICENSED (package.json)
- **Public repo:** github:thehumanworks/pasta

## Architecture one-liner

Bun CLI on desktop ↔ HTTPS ↔ Cloudflare Worker ↔ D1 registry + DO per clipboard space + R2 for large blobs.

## Component map

| Component | Path | Responsibility |
| --- | --- | --- |
| CLI | `src/cli.ts` | Commands, orchestration |
| API client | `src/cli/client.ts` | Signed HTTPS to Worker |
| Crypto | `src/shared/crypto.ts` | XChaCha20, Ed25519, X25519 wrap |
| Protocol | `src/shared/protocol.ts` | Types, endpoints, constants |
| Worker router | `src/worker/index.ts` | HTTP API, auth gate |
| ClipboardSpace DO | `src/worker/clipboard-space.ts` | Seq, history, wrapped keys |
| D1 schema | `migrations/0001_registry.sql` | Accounts, devices, pairing |
| iOS UX contract | `docs-site/content/native-ios.md` | Keyboard-first native iOS behavior and constraints |

## State locations

| Data | Where |
| --- | --- |
| Plaintext clipboard | Device RAM / OS clipboard only |
| Group key, device private keys | `$PASTA_HOME/auth.json` local auth cache by default |
| Non-secret config | `$PASTA_HOME/config.json` |
| Ciphertext clips | Durable Object (inline) or R2 (files/large) |
| Device registry, nonces, pairing | D1 |

## Native iOS doc anchor

Human docs: `/native-ios/`

Agent docs: `/agent/native-ios.md`

Treat the iOS docs as the canonical UX contract: keyboard inserts text only, publish is explicit, binary clips use handoff surfaces, and no background clipboard daemon is allowed on iOS.

## GDD status

Goals 01–06 in `docs/goals/` are **done** with recorded evidence per `GOAL.md`. Next work requires a new goal file before scope expansion.

## Out of scope (do not reintroduce)

P2P, LAN discovery, SSH, tailnets, STUN/TURN, WebRTC, Cloudflare Access/OAuth, secrets in config/docs/logs/Cloudflare, secret recovery after total device loss.
