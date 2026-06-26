# Pasta Documentation Site

Static documentation with dual **Human** and **Agent** views, built with Bun and [marked](https://marked.js.org/).

## Develop locally

```bash
cd docs-site
bun install
bun run build -- --base /
bun run serve.ts
```

Open http://localhost:4173

For GitHub Pages project-site paths, build with `--base /pasta/`.

## Content format

Each page lives in `content/{slug}.md`:

```markdown
---
title: Page Title
slug: page-slug
description: One-line summary
nav_order: 1
---

<!-- @human -->
Markdown for humans...

<!-- @agent -->
Markdown for coding agents...
```

## Agent API

| Resource | URL |
| --- | --- |
| Raw markdown | `/agent/{slug}.md` |
| JSON envelope | `/api/{slug}.json` |
| Manifest | `/.well-known/pasta-docs.json` |

Local dev server (`serve.ts`) honors `Accept: text/markdown` on page URLs. On GitHub Pages, fetch `/agent/{slug}.md` directly.

## Deploy

Pushes to `main` that touch `docs-site/` trigger `.github/workflows/docs.yml`, publishing `docs-site/dist` to GitHub Pages at https://thehumanworks.github.io/pasta/
