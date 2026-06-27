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

Native iOS is keyboard-centered, not daemon-centered. Read `/agent/native-ios.md` before touching any iOS, app-extension, keyboard, App Intents, Share extension, File Provider, or clipboard-paste docs. Do not implement or document iOS background clipboard monitoring, binary paste-anywhere, or P2P/mobile-specific transport.

## Verify before done

```bash
mise exec -- bun run test && mise exec -- bunx tsc --noEmit
```

## Key paths

CLI: src/cli.ts | Worker: src/worker/ | Crypto: src/shared/crypto.ts | Protocol: src/shared/protocol.ts

Native iOS contract: docs-site/content/native-ios.md | Agent markdown: /agent/native-ios.md

## Machine docs

/agent/{slug}.md — markdown | /api/{slug}.json — JSON body field
