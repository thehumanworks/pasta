# Pasta

Pasta is a desktop-first, terminal-first clipboard project. It auto-publishes copied text from one trusted desktop and lets another trusted desktop pull the latest encrypted entry on paste.

Pasta is intentionally central-service based. P2P, LAN discovery, SSH, tailnets, STUN/TURN, and WebRTC traversal are out of scope because the target environment includes firewall-constrained systems where those paths can be blocked. The supported architecture is device-initiated HTTPS to a Cloudflare Worker plus one Durable Object per clipboard space.

## Planning State

- Delivery plan: `GOAL.md`
- Execution runbook: `docs/ORCHESTRATION.md`
- Goal files: `docs/goals/`
- Research pack: `docs/research/`

## MVP Shape

- CLI name: `pasta`
- Desktop only: macOS, Linux, Windows
- First payload: text
- Backend: Cloudflare Workers, Durable Objects, D1, later R2 for encrypted blobs
- Local secrets: OS credential store via `Bun.secrets`
- Pairing: temporary QR/short code plus approval from an existing trusted device
- Recovery: if all trusted devices are lost, reset the encrypted clipboard space

## Resume Work

Start with:

```bash
git status --short --branch
python3 "$HOME/.agents/skills/goal-driven-development/scripts/gdd_status.py" docs/goals/06-binary-payloads-and-hardening.md
```

Then follow `GOAL.md` and `docs/ORCHESTRATION.md`. Goals 01-05 are currently
checkpointed as done; Goal 06 is the active remaining goal.

## Local Development

```bash
bun install
bun run types
bun test test/bun
bun run test:worker
```

Run the CLI locally:

```bash
bun run src/cli.ts --version
bun run src/cli.ts doctor
```

The Worker uses `wrangler.jsonc`, D1 migrations in `migrations/`, and a SQLite-backed Durable Object named `ClipboardSpace`.
