---
title: Agent Handbook
slug: agent-handbook
description: Machine-oriented guide for coding agents working on the Pasta repository.
nav_order: 13
---

<!-- @human -->
## Programmatic doc access

```bash
curl -H "Accept: text/markdown" \
  https://thehumanworks.github.io/pasta/agent/quick-start.md

curl https://thehumanworks.github.io/pasta/.well-known/pasta-docs.json
```

Browser: add `?audience=agent` or toggle **Agent** in the header.

<!-- @agent -->
## Bootstrap order

1. AGENTS.md → GOAL.md → docs/ORCHESTRATION.md
2. gdd_status.py on active goal
3. git status; smallest verified slice

## Hard constraints

Central HTTPS relay only. No plaintext on Cloudflare. bun only. fnox for wrangler secrets.

## Verify before done

```bash
mise exec -- bun run test && mise exec -- bunx tsc --noEmit
```

## Key paths

CLI: src/cli.ts | Worker: src/worker/ | Crypto: src/shared/crypto.ts | Protocol: src/shared/protocol.ts

## Machine docs

/agent/{slug}.md — markdown | /api/{slug}.json — JSON body field
