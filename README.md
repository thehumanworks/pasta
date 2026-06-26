# Pasta

Pasta is a desktop-first, terminal-first encrypted clipboard relay for trusted devices. A copy on one desktop publishes ciphertext to a Cloudflare Worker; another trusted desktop pulls the latest encrypted entry on paste and decrypts locally.

Pasta is intentionally central-service based. P2P, LAN discovery, SSH, tailnets, STUN/TURN, and WebRTC traversal are out of scope because the target environment includes firewall-constrained systems where those paths can be blocked. The supported architecture is device-initiated HTTPS to a Cloudflare Worker plus one Durable Object per clipboard space.

## What It Supports

- Text clipboard copy, paste, history, and daemon polling.
- Pairing with a short code or terminal QR, approved by an existing device.
- Device listing, revocation, and encrypted-space reset.
- macOS PNG image clipboard copy/paste through explicit image commands.
- Bounded file payloads up to 50 MiB through the R2-backed API path.
- Local secrets stored with `Bun.secrets`; plaintext fallback is intentionally disabled.

## Run It

Run directly from the public GitHub package:

```bash
bunx --bun -p github:thehumanworks/pasta pasta --version
bunx --bun -p github:thehumanworks/pasta pasta doctor
```

Run the tagged release:

```bash
bunx --bun github:thehumanworks/pasta#v0.1.0 --version
```

Use a local checkout while developing:

```bash
git clone git@github.com:thehumanworks/pasta.git
cd pasta
bun install
bun run src/cli.ts --version
bun run src/cli.ts doctor
```

For the examples below, `pasta` means either the package command or the local command:

```bash
alias pasta='bun run src/cli.ts'
```

## Deploy A Relay

Pasta needs one Cloudflare Worker, one D1 database, one R2 bucket, and one Durable Object namespace. The repo includes `wrangler.jsonc`, `migrations/`, and the Worker entrypoint.

Create the Cloudflare resources:

```bash
wrangler d1 create pasta-registry
wrangler r2 bucket create pasta-blobs
```

Put the returned D1 database id into `wrangler.jsonc` in place of the placeholder `00000000-0000-0000-0000-000000000000`, then apply the registry migration and deploy:

```bash
wrangler d1 migrations apply DB --remote
wrangler deploy
```

If you use this repo's secret setup, run Cloudflare commands through `fnox`:

```bash
mise exec -- fnox exec -- wrangler d1 migrations apply DB --remote
mise exec -- fnox exec -- wrangler deploy
```

Use the deployed Worker URL as the endpoint in the device examples:

```bash
export PASTA_ENDPOINT='https://pasta.<your-subdomain>.workers.dev'
```

## First Device

Bootstrap the first trusted desktop:

```bash
pasta bootstrap --endpoint "$PASTA_ENDPOINT" --device-name "macbook"
```

Check local clipboard support:

```bash
pasta doctor
```

See the device record:

```bash
pasta devices list
```

Print a pairing ticket for another desktop:

```bash
pasta pair ticket
```

The ticket contains endpoint and account routing data, not the group key.

## Pair A Second Device

On the existing trusted device, print the ticket:

```bash
pasta pair ticket
```

On the new device, request pairing with that ticket:

```bash
pasta pair request --ticket 'pasta://pair?endpoint=...&account=...&routing=...' --device-name "workstation"
```

The new device prints a short code. On the existing trusted device, approve it:

```bash
pasta devices approve ABC12345
```

Back on the new device, consume the approved grant:

```bash
pasta pair consume
```

List trusted devices from either side:

```bash
pasta devices list
```

Revoke a device:

```bash
pasta devices revoke dev_example
```

## Text Clipboard Examples

Publish piped text:

```bash
printf 'hello from device A\n' | pasta copy
```

Publish the current OS text clipboard:

```bash
pasta copy
```

Pull the latest text to stdout:

```bash
pasta paste
```

Pull the latest text into the local OS clipboard:

```bash
pasta paste --clipboard
```

Paste a specific sequence:

```bash
pasta paste --seq 12
```

List encrypted history metadata:

```bash
pasta history
```

Show decrypted history text locally:

```bash
pasta history --show
```

Paste a selected history entry:

```bash
pasta history paste 12
pasta history paste 12 --clipboard
```

## Daemon Examples

Run one clipboard poll without publishing:

```bash
pasta daemon --dry-run
```

Run one real poll and publish if local clipboard text changed:

```bash
pasta daemon --once
```

Poll continuously every 750 ms:

```bash
pasta daemon
```

Use a slower polling interval:

```bash
pasta daemon --interval-ms 2000
```

The daemon skips republishing text that was just pulled from the remote clipboard through `pasta paste --clipboard`.

## Image Examples

Image clipboard support is live for macOS PNG pasteboard data. Linux and Windows image clipboard support are documented platform assumptions for now.

Publish the current macOS PNG clipboard image:

```bash
pasta copy-image
```

Pull the latest image into the OS clipboard:

```bash
pasta paste-image
```

Write the latest image to a file:

```bash
pasta paste-image --out latest.png
```

Paste a specific image sequence:

```bash
pasta paste-image --seq 18 --out screenshot.png
```

If the latest clip is text or file data, `paste-image` fails cleanly instead of guessing.

## File Examples

File payloads are encrypted locally, stored in R2 as encrypted bytes, and omit local paths and filenames from Worker/DO/R2 metadata.

Send a small file:

```bash
pasta send-file ./notes.txt --mime text/plain
```

Send a binary file:

```bash
pasta send-file ./archive.zip --mime application/zip
```

Paste the latest file to a new path:

```bash
pasta paste-file --out ./received.bin
```

Paste a specific file sequence:

```bash
pasta paste-file --seq 21 --out ./received.zip
```

The CLI rejects files above 50 MiB before reading them into memory:

```bash
pasta send-file ./large.iso
```

## Shell Integration

Install a reversible shell snippet:

```bash
pasta install-shell
```

Then source the printed file path. The snippet adds short aliases for common copy, paste, and history workflows.

Remove the shell snippet:

```bash
pasta uninstall-shell
```

Use a custom command path in the generated snippet:

```bash
pasta install-shell --command "$PWD/src/cli.ts"
```

## Recovery And Reset

If all trusted devices are lost, there is no secret recovery path. Reset the encrypted clipboard space from a trusted device:

```bash
pasta reset --yes
```

Reset creates a new group key and routing id. Old encrypted history becomes unrecoverable.

## Isolated Local Profiles

Use `PASTA_HOME` to keep multiple local test devices separate on one machine:

```bash
PASTA_HOME=/tmp/pasta-a pasta bootstrap --endpoint "$PASTA_ENDPOINT" --device-name a
PASTA_HOME=/tmp/pasta-b pasta pair request --ticket "$TICKET" --device-name b
```

Pasta stores non-secret config in `$PASTA_HOME/config.json` and secrets in a `Bun.secrets` service derived from that home path.

## Local Worker Smoke

Run a local Worker:

```bash
wrangler d1 migrations apply DB --local
wrangler dev --local
```

In another shell:

```bash
export PASTA_ENDPOINT='http://127.0.0.1:8787'
PASTA_HOME=/tmp/pasta-a pasta bootstrap --endpoint "$PASTA_ENDPOINT" --device-name a
printf 'local smoke\n' | PASTA_HOME=/tmp/pasta-a pasta copy
PASTA_HOME=/tmp/pasta-a pasta paste
```

## Development

Install dependencies:

```bash
bun install
```

Run checks:

```bash
mise exec -- bun run test
mise exec -- bunx tsc --noEmit
git diff --check
```

Run separated suites:

```bash
bun test test/bun
bun run test:worker
```

Generate Worker types:

```bash
bun run types
```

Inspect package contents:

```bash
bun run pack:list
```

## Project Docs

- Delivery plan: `GOAL.md`
- Execution runbook: `docs/ORCHESTRATION.md`
- Protocol: `docs/protocol.md`
- Threat model: `docs/threat-model.md`
- Distribution notes: `docs/distribution.md`
- Binary payload design: `docs/binary-payloads.md`
- Goal files: `docs/goals/`

All current GDD goals are checkpointed as done.
