---
title: Deploy Relay
slug: deploy-relay
description: Cloudflare Worker, D1, R2, and Durable Object setup for your Pasta relay.
nav_order: 11
---

<!-- @human -->
## Resources

| Resource | Purpose |
| --- | --- |
| D1 `pasta-registry` | Accounts, devices, pairing, nonces |
| DO `ClipboardSpace` | Clip sequence, history, wrapped keys |
| R2 `pasta-blobs` | Encrypted files |

## Deploy

```bash
wrangler d1 create pasta-registry
wrangler r2 bucket create pasta-blobs
# update database_id in wrangler.jsonc
wrangler d1 migrations apply DB --remote
wrangler deploy
```

With fnox: `mise exec -- fnox exec -- wrangler deploy`

## Local dev

```bash
wrangler d1 migrations apply DB --local
wrangler dev --local
```

<!-- @agent -->
## Worker: `src/worker/index.ts`
## DO: `src/worker/clipboard-space.ts`
## Schema: `migrations/0001_registry.sql`
## Config: `wrangler.jsonc` — replace D1 placeholder UUID before remote deploy
## Tests: `bun run test:worker`
