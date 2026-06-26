---
title: CLI Reference
slug: cli-reference
description: Every pasta command, flags, and exit codes at v0.1.0.
nav_order: 4
---

<!-- @human -->
## Global

```bash
pasta --help
pasta --version
```

## Setup & health

| Command | Description |
| --- | --- |
| `bootstrap --endpoint <url> [--device-name <name>]` | First device: create account, keys, register relay |
| `doctor` | JSON probe of clipboard adapter availability |
| `protocol` | Dump `PROTOCOL_ENDPOINTS` as JSON |
| `payload-plan` | Inline/R2 thresholds and key format |

## Pairing & devices

| Command | Description |
| --- | --- |
| `pair ticket` | Print `pasta://pair?...` URL + terminal QR |
| `pair request --ticket <url> [--device-name <name>]` | Open pairing session; prints short code + QR |
| `pair consume` | Finish pairing after approval; unwrap group key |
| `devices list` | Tab-separated device id, status, name |
| `devices approve <code>` | Trusted device approves pending pair |
| `devices revoke <deviceId>` | Revoke a device |

Pairing ticket contains **endpoint, account, routing** — not the group key.

## Text clipboard

| Command | Description |
| --- | --- |
| `copy` | Stdin if piped, else OS clipboard → encrypt → publish |
| `paste [--clipboard] [--seq <n>]` | Pull latest or seq; stdout or OS clipboard |
| `history [--show]` | List local text previews and file names; `--show` decrypts full text locally |
| `history paste <seq> [--clipboard]` | Paste specific history entry |

## Images (macOS PNG)

| Command | Description |
| --- | --- |
| `copy --image` | OS clipboard PNG → encrypt → publish |
| `paste --image [--seq <n>] [--out <path>]` | Decrypt to clipboard or file |

Fails cleanly if latest clip is not image-like.

## Files (R2, ≤ 50 MiB)

| Command | Description |
| --- | --- |
| `copy <path> [--mime <type>]` | Encrypt file and basename → R2-backed publish |
| `paste [--seq <n>] [--out <path>]` | Download, decrypt, write original basename or chosen path |

## Daemon

| Command | Description |
| --- | --- |
| `daemon [--once] [--dry-run] [--interval-ms <n>]` | Poll clipboard; publish on text change |

Default interval: **750 ms**. Skips republishing text just pulled via `paste --clipboard` (uses `lastRemotePasteHash` in config).

## Recovery & shell

| Command | Description |
| --- | --- |
| `reset --yes` | New group key + routing id; old history unreachable |
| `install-shell [--command <path>]` | Write reversible shell snippet |
| `uninstall-shell` | Remove snippet |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 2 | Usage error |
| 3 | Unavailable (no clip, no pending pair, clipboard down) |
| 4 | Auth failure |
| 5 | Network failure |
| 6 | Unsupported payload |
| 70 | Internal error |

<!-- @agent -->
## Command dispatch (`runCli` in `src/cli.ts`)

argv[0] routes to handlers. Inject deps via `CliDeps`: `io`, `paths`, `secrets`, `clipboard`, `clientFactory`.

## API mapping (command → HTTP)

| CLI | Method / Path | Auth |
| --- | --- | --- |
| `bootstrap` | `POST /v1/accounts/bootstrap` | none |
| `copy` text/clipboard image | `POST /v1/clips` | signed |
| `copy <path>` file/image path | `POST /v1/files` | signed |
| `paste`, `history` | `GET /v1/clips/*` | signed |
| `paste` file payload | `GET /v1/files/:seq` | signed |
| `pair request` | `POST /v1/pairing/open` | none |
| `devices approve` | `POST /v1/pairing/approve` | signed |
| `pair consume` | `POST /v1/pairing/consume` | none |
| `devices list` | `GET /v1/devices` | signed |
| `devices revoke` | `POST /v1/devices/:id/revoke` | signed |
| `reset` | `POST /v1/reset` | signed |

Full table: `PROTOCOL_ENDPOINTS` in `src/shared/protocol.ts` or `pasta protocol`.

## Publish pipeline

```
plaintext → encryptTextClip|encryptBytesClip (shared/crypto.ts)
         → client.request POST
         → StoredClip with seq
```

## Pull pipeline

```
GET latest|seq → StoredClip → decryptTextClip|decryptBytesClip
              → stdout | clipboard.write*
```

## Pairing state machine

1. `pair request` → writes `pendingPairing` in config, stores device private keys (not group key)
2. `devices approve` on trusted device → `wrapGroupKey` for new device's wrap pubkey
3. `pair consume` → `unwrapGroupKey`, store group key, clear `pendingPairing`

Short code: `makeShortCode()` → `hashShortCode(code, accountId)` stored server-side.

## Daemon (`src/cli/daemon.ts`)

`runDaemonLoop(clipboard, publishFn, getLastRemoteHash, { intervalMs, once, dryRun })` returns JSON result on stdout.

## Testing hooks

Tests inject `CliDeps` with mock `ApiClient`, `SecretStore`, `ClipboardAdapter`. See `test/bun/cli.test.ts`.

## Constants

- `LARGE_PAYLOAD_MAX_BYTES` = 50 MiB
- `LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES` = 512 KiB
- `REQUEST_TOLERANCE_MS` = 5 min
- History default limit 20, max 100
