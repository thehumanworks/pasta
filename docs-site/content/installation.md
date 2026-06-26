---
title: Installation
slug: installation
description: Install Pasta, deploy a relay, bootstrap devices, and run isolated local profiles.
nav_order: 3
---

<!-- @human -->
## Install the CLI

**From GitHub (recommended for users):**

```bash
bunx --bun -p github:thehumanworks/pasta pasta --version
bunx --bun github:thehumanworks/pasta#v0.1.0 --version
```

**From a local checkout (developers):**

```bash
git clone https://github.com/thehumanworks/pasta.git
cd pasta
bun install
bun run src/cli.ts --version
alias pasta='bun run src/cli.ts'
```

**Check clipboard support on this machine:**

```bash
pasta doctor
```

`doctor` prints JSON with adapter availability. Exit code `3` means the clipboard adapter is unavailable on this platform/session.

## Deploy your relay

Pasta needs one Cloudflare **Worker**, one **D1** database, one **R2** bucket, and a **Durable Object** namespace. The repo ships `wrangler.jsonc` and SQL migrations.

```bash
wrangler d1 create pasta-registry
wrangler r2 bucket create pasta-blobs
```

Put the D1 database id into `wrangler.jsonc` (replace the placeholder UUID), then:

```bash
wrangler d1 migrations apply DB --remote
wrangler deploy
```

If you use this repo's fnox setup:

```bash
mise exec -- fnox exec -- wrangler d1 migrations apply DB --remote
mise exec -- fnox exec -- wrangler deploy
```

Export the Worker URL:

```bash
export PASTA_ENDPOINT='https://pasta.<your-subdomain>.workers.dev'
```

## Bootstrap the first device

```bash
pasta bootstrap --endpoint "$PASTA_ENDPOINT" --device-name "my-laptop"
```

This generates:

- A new **account** and **routing id** (Durable Object name)
- Device **Ed25519** signing keys and **X25519** wrapping keys
- A **group key** stored only in your OS credential store

Config lands in `~/.pasta/config.json` (or `$PASTA_HOME/config.json`). Secrets never go in that file.

## Local Worker smoke test

Terminal 1:

```bash
wrangler d1 migrations apply DB --local
wrangler dev --local
```

Terminal 2:

```bash
export PASTA_ENDPOINT='http://127.0.0.1:8787'
PASTA_HOME=/tmp/pasta-a pasta bootstrap --endpoint "$PASTA_ENDPOINT" --device-name a
printf 'local smoke\n' | PASTA_HOME=/tmp/pasta-a pasta copy
PASTA_HOME=/tmp/pasta-a pasta paste
```

## Multiple devices on one machine

Use separate `PASTA_HOME` directories to simulate two desktops:

```bash
PASTA_HOME=/tmp/pasta-a pasta bootstrap ...
PASTA_HOME=/tmp/pasta-b pasta pair request --ticket "$TICKET" ...
```

Each profile gets its own config and `Bun.secrets` service namespace.

## Environment variables

| Variable | Effect |
| --- | --- |
| `PASTA_HOME` | Override config/secrets home (default `~/.pasta`) |
| `PASTA_ENDPOINT` | Not auto-read; pass `--endpoint` at bootstrap or set in config |

## Shell integration

```bash
pasta install-shell
# source the printed path in ~/.zshrc or ~/.bashrc
pasta uninstall-shell   # removes snippet
```

<!-- @agent -->
## Install paths (verified)

```bash
bun run src/cli.ts --version
bunx --bun -p file:$PWD pasta --version
bunx --bun -p github:thehumanworks/pasta pasta --version
```

Package bin: `package.json` → `"pasta": "./src/cli.ts"` (Bun shebang, no lifecycle scripts).

## Config & secrets (`src/cli/config.ts`, `src/cli/secret-store.ts`)

- `PASTA_HOME` → config dir; default `~/.pasta`
- `config.json` fields: `endpoint`, `accountId`, `routingId`, `deviceId`, `deviceName`, public keys, `keyVersion`, optional `pendingPairing`, `lastRemotePasteHash`
- Secrets in `Bun.secrets` service `secretServiceForHome(home)`:
  - `groupKey`
  - `signingPrivateKey`
  - `wrappingPrivateKey`
- `requireSecret()` throws with setup guidance if unavailable — **no plaintext fallback**

## Bootstrap implementation (`bootstrap()` in cli.ts)

1. Generate `accountId`, `routingId`, `deviceId`, key material, `groupKey`
2. `POST /v1/accounts/bootstrap` (unsigned)
3. Store secrets + write config

## Wrangler bindings (`wrangler.jsonc`)

- `CLIPBOARD` → `ClipboardSpace` Durable Object
- `DB` → D1 `pasta-registry`
- `BLOBS` → R2 `pasta-blobs`

Replace D1 `database_id` placeholder before remote deploy.

## Deploy checklist

1. `wrangler d1 create` + update jsonc
2. `wrangler r2 bucket create pasta-blobs`
3. `wrangler d1 migrations apply DB --remote`
4. `wrangler deploy` (via fnox if using repo secrets)
5. Device: `pasta bootstrap --endpoint <worker-url>`

## Local multi-device testing

Always isolate with `PASTA_HOME=/tmp/pasta-{a,b}` — shares neither config nor Bun.secrets namespace.
