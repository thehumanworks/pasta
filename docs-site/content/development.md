---
title: Development
slug: development
description: Hacking on Pasta — tests, tooling, goals workflow, and contribution paths.
nav_order: 12
---

<!-- @human -->
## Checks

```bash
bun install
mise exec -- bun run test
mise exec -- bunx tsc --noEmit
```

## Local CLI

```bash
alias pasta='bun run src/cli.ts'
```

## Goals

Read `AGENTS.md`, `GOAL.md`, `docs/ORCHESTRATION.md`. Goals 01–06 done.

## Docs site

```bash
cd docs-site && bun install && bun run build && bun run serve.ts
```

<!-- @agent -->
## Toolchain: bun + mise + fnox (see AGENTS.md)
## Tests: test/bun/*, test/worker/backend.test.ts
## GDD: gdd_status.py before goal edits; record Evidence
## Docs build: `cd docs-site && bun run build -- --base /pasta/`
