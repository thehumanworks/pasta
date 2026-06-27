# Pasta Agent Instructions

These project-local instructions apply to this repository.

## Product Boundary

- The app name is **Pasta**. CLI/package references should use `pasta`.
- Transport is central-service only: Cloudflare Worker over HTTPS plus one Durable Object per clipboard space.
- P2P, LAN discovery, SSH, tailnets, STUN/TURN, and WebRTC traversal are out of scope. Do not reintroduce them as a fallback or future MVP path.
- Devices own interactions: copy publishes ciphertext, paste pulls latest/history, pairing approval wraps keys, reset starts a new encrypted space.
- Cloudflare must never receive clipboard plaintext or raw group keys.
- Cloudflare auth products are not part of MVP auth. Use app-owned device keys and signed requests.

## Execution Entry Point

- Read `GOAL.md`.
- Read `docs/ORCHESTRATION.md`.
- Work the goal files in `docs/goals/` using the local GDD workflow.
- Before changing a goal, run `gdd_status.py` on it and preserve its DoD/task coverage.
- Record evidence in the task's `Evidence` block before marking any task or DoD complete.

## Toolchain And Secrets

- Use `mise` as the tool manager. Prefer repo-configured tools through `mise exec -- <command>` when a tool is not already on `PATH`.
- Use `bun` as the TypeScript runtime and package manager. Prefer `bun install`, `bun run`, `bun test`, and `bunx --bun`; do not introduce npm, yarn, pnpm, or their lockfiles unless explicitly requested.
- Use `fnox` for secrets. Run secret-gated commands as `mise exec -- fnox exec -- <command>` so secrets are injected from `fnox.toml`.
- `fnox` is already configured to fetch `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_KEY`, and `CLOUDFLARE_ACCOUNT_EMAIL` from Doppler. Do not replace this with `.env` files or hardcoded credentials.
- Never print, commit, or paste secret values. Secret checks should prove names/configuration, not reveal values.

## Scope Discipline

- Text MVP comes before images/files.
- Shell/keybinding integration comes before global OS hotkeys or OS services.
- Keep implementation changes narrow to the active goal.
- Do not store secrets in config files, logs, fixtures, or docs.

## Delivery

- Every task in this repository ends with the verified changes committed on `main` and pushed to `origin/main` unless the user explicitly asks not to publish.
- Before committing, run the strongest practical verification for the touched surface and include any blocker in the final response.
- If a task changes Worker routes, Durable Object behavior, D1 schema, migrations, or documented remote API behavior, publishing code or creating a tag is not enough. Apply required remote D1 migrations with `mise exec -- fnox exec -- wrangler d1 migrations apply DB --remote`, deploy with `mise exec -- fnox exec -- wrangler deploy`, and run a non-leaking remote smoke against `https://pasta.nothuman.work` for the changed path unless the user explicitly says not to deploy. Record the migration/deploy/smoke evidence before finalizing.
