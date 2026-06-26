---
title: Quick Start
slug: quick-start
description: One-page overview — what Pasta is, how it works, and the fastest path to a working clipboard relay.
nav_order: 1
---

<!-- @human -->
## The thirty-second version

**Pasta** is an encrypted clipboard relay for your own trusted desktops. Copy on one machine, paste on another — but the Cloudflare relay only ever sees ciphertext. No P2P, no LAN tricks, no tailnets: just outbound HTTPS that works through firewalls.

```
Device A  ──encrypt──▶  Cloudflare Worker  ──ciphertext──▶  Device B
   ▲                           │                                │
   └── local plaintext ────────┴── never leaves your devices ──┘
```

## What you need

| Piece | Role |
| --- | --- |
| **Bun** | Runs the `pasta` CLI and daemon |
| **A relay** | One Cloudflare Worker + D1 + R2 (yours or a shared team deployment) |
| **Two desktops** | macOS, Linux, or Windows — terminal-first |

## Fastest happy path

**1. Run Pasta without cloning**

```bash
bunx --bun -p github:thehumanworks/pasta pasta --version
```

**2. Point at your relay**

```bash
export PASTA_ENDPOINT='https://pasta.<your-subdomain>.workers.dev'
```

**3. Bootstrap the first device**

```bash
pasta bootstrap --endpoint "$PASTA_ENDPOINT" --device-name "macbook"
pasta doctor
```

**4. Pair a second device**

On device A: `pasta pair ticket` → scan or copy the ticket.

On device B:

```bash
pasta pair request --ticket 'pasta://pair?...' --device-name "workstation"
```

Back on A: `pasta devices approve <short-code>`

On B: `pasta pair consume`

**5. Copy and paste**

```bash
# Device A
printf 'hello from A\n' | pasta copy

# Device B
pasta paste
pasta paste --clipboard   # into OS clipboard
```

**6. Optional: auto-publish with the daemon**

```bash
pasta daemon              # polls clipboard every 750ms
```

## Mental model

- **Your devices** hold plaintext and the group encryption key (in the local Pasta secret store).
- **The relay** stores ciphertext, sequence numbers, and pairing metadata — never plaintext.
- **Paste is pull-based** — nothing syncs continuously unless you run the daemon on the publishing side.
- **Lost all devices?** Run `pasta reset --yes` from any remaining trusted device. Old history becomes unreadable. There is no secret recovery.

## Where to go next

- [Installation](/installation/) — relay deployment, local dev, `PASTA_HOME` profiles
- [CLI Reference](/cli-reference/) — every command and flag
- [Architecture](/architecture/) — Worker, Durable Object, D1, R2

<!-- @agent -->
## Product summary

Pasta v0.1.0 — terminal-first encrypted clipboard relay. Central Cloudflare Worker transport only. Devices encrypt locally; relay stores ciphertext.

## Repository layout

```
src/cli.ts           CLI entry (bin: pasta)
src/cli/*            client, daemon, clipboard, secrets, shell
src/shared/*         crypto, protocol types, encoding
src/worker/*         Worker + ClipboardSpace Durable Object
docs/goals/*         GDD goal files (01-06 done)
docs-site/           this documentation site
```

## Non-negotiable boundaries (from AGENTS.md)

- NO P2P, LAN, SSH, tailnets, STUN/TURN, WebRTC
- NO Cloudflare Access/OAuth for MVP auth — Ed25519 device signatures
- NO plaintext on relay; NO raw group keys on relay
- Text MVP first; images (macOS PNG) and files (50 MiB R2) via explicit commands

## Execution entry for repo work

1. Read `AGENTS.md`, `GOAL.md`, `docs/ORCHESTRATION.md`
2. Active goals in `docs/goals/` — all 01-06 checkpointed done
3. Verify: `mise exec -- bun run test`, `mise exec -- bunx tsc --noEmit`
4. Secrets: `mise exec -- fnox exec -- <cmd>` for Cloudflare deploy

## Minimal command graph

```
bootstrap → pair(ticket|request|consume) + devices(approve)
copy → POST ciphertext
paste|history → GET ciphertext → local decrypt
daemon → poll local clipboard → copy on change
reset --yes → new routing_id + group key
```

## Machine-readable docs

- Markdown: `GET /agent/{slug}.md` with `Accept: text/markdown`
- JSON envelope: `GET /api/{slug}.json` with `Accept: application/json`
- Manifest: `GET /.well-known/pasta-docs.json`

## Quick verification commands

```bash
bunx --bun -p github:thehumanworks/pasta pasta --version   # expect 0.1.0
pasta protocol                                              # PROTOCOL_ENDPOINTS JSON
pasta payload-plan                                          # R2 thresholds
pasta doctor                                                # clipboard adapter probe
```

## Exit codes (src/cli/exit-codes.ts)

| Code | Name |
| --- | --- |
| 0 | ok |
| 2 | usage |
| 3 | unavailable |
| 4 | auth |
| 5 | network |
| 6 | unsupported |
| 70 | internal |
