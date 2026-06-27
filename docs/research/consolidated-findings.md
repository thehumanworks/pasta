# Consolidated Research Findings

Research date: 2026-06-26

## Transport

Observed: P2P is no longer a product or architecture consideration. Firewall-constrained systems can block Tailscale, UDP traversal, LAN discovery, STUN/TURN/WebRTC paths, and SSH-style access, so those paths are out of scope rather than fallback options.

Decision: use a central HTTPS relay on Cloudflare Workers with one Durable Object per clipboard space. This is not "device sync" in the background-replication sense; each device owns the interaction. Copy publishes ciphertext. Paste pulls latest or selected history. Pairing approval wraps keys for the requesting device.

Inference: this has better odds under Zscaler-style policies because outbound HTTPS to a normal public API is more likely to pass than peer connectivity, tailnet control planes, or traversal protocols. It is still not unblockable; enterprises can block any host.

## Cloudflare Durable Objects

Sources:

- [Cloudflare Durable Objects overview](https://developers.cloudflare.com/durable-objects/)
- [Rules of Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [SQLite-backed Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Durable Object alarms](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/#alarms-api)
- [Durable Objects changelog](https://developers.cloudflare.com/changelog/product/durable-objects/)
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Workers request limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)

Findings:

- Use native Workers plus Durable Objects, not the beta Actors layer, for this MVP.
- Use SQLite-backed Durable Objects and `new_sqlite_classes`; Cloudflare recommends SQLite for new DO namespaces.
- Put one Durable Object behind each clipboard space/account. Avoid a single global DO.
- Route with `env.CLIPBOARD.getByName(routingId)`. The `routing_id` is necessary internally, but it is not a secret and should never be an auth boundary.
- Use D1 for account/device registry and pairing-session lookup. Use the DO's local SQLite storage for encrypted clipboard sequence/history.
- Use R2 only for encrypted large payloads later. DO key/value limits around 2 MB and Worker body limits make text-first the correct MVP.
- WebSockets are optional for live notifications; paste-pull works without them. If added, use hibernatable WebSockets and persist attachment state because memory resets during hibernation.
- Use DO alarms for retention cleanup. Alarm handlers must be idempotent.

Suggested backend shape:

```text
desktop daemon
  -> Worker HTTPS API
  -> signed device auth + D1 registry lookup
  -> Durable Object RPC by routing_id
  -> DO SQLite encrypted clips/history
  -> R2 encrypted blobs later
```

## Durable Object Data Model

D1 registry:

```sql
accounts(
  account_id TEXT PRIMARY KEY,
  routing_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  reset_at INTEGER
);

devices(
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  verify_public_key TEXT NOT NULL,
  wrap_public_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  PRIMARY KEY(account_id, device_id)
);

pairing_sessions(
  session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  short_code_hash TEXT UNIQUE,
  new_device_id TEXT NOT NULL,
  new_device_pubkeys_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_at INTEGER,
  consumed_at INTEGER
);
```

DO SQLite:

```sql
clips(
  clip_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  origin_device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  payload_kind TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_len INTEGER NOT NULL,
  inline_ciphertext BLOB,
  r2_key TEXT,
  nonce TEXT NOT NULL,
  aad_hash TEXT NOT NULL
);

wrapped_keys(
  device_id TEXT PRIMARY KEY,
  key_version INTEGER NOT NULL,
  wrapped_group_key BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

meta(
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

Core Worker endpoints:

- `POST /v1/accounts/bootstrap`
- `POST /v1/pairing/open`
- `POST /v1/pairing/request`
- `POST /v1/pairing/approve`
- `POST /v1/clips`
- `GET /v1/clips/latest`
- `GET /v1/clips/history?before=&limit=`
- `GET /v1/clips/:clipId`
- `GET /v1/devices`
- `POST /v1/devices/:deviceId/revoke`
- Optional `GET /v1/events`

Core DO RPC:

- `initIfNeeded()`
- `publishClip(actor, encryptedClip)`
- `getLatest(actor, afterSeq?)`
- `listHistory(actor, limit, beforeSeq?)`
- `getClip(actor, seq)`
- `storeWrappedKey(actor, grant)`
- `revokeDevice(actor, deviceId)`
- `cleanupExpired(now)`

## Pairing, Crypto, and Secrets

Sources:

- [Bun.secrets](https://bun.com/docs/runtime/secrets)
- [`qrcode` npm package](https://www.npmjs.com/package/qrcode)
- [`@noble/ciphers`](https://www.npmjs.com/package/%40noble/ciphers)
- [`@noble/curves`](https://www.npmjs.com/package/%40noble/curves)
- [Cure53 noble crypto audit report](https://cure53.de/audit-report_noble-crypto-libs.pdf)

Findings:

- Use `Bun.secrets` for local secret storage. It uses macOS Keychain Services, Linux libsecret, and Windows Credential Manager.
- Store small secrets only: group key, device signing private key, device wrapping private key, optional session token. Store non-secret config separately.
- `qrcode` is acceptable for terminal QR output. It supports `QRCode.toString(text, { type: "terminal" })` and avoids a GUI requirement.
- `@noble/ciphers` and `@noble/curves` are stable, audited, pure JS packages suitable for Bun and Workers. Use with explicit test vectors and acknowledge JS side-channel limitations.
- Candidate primitives:
  - Ed25519 device request signatures.
  - X25519 device-to-device wrapping for onboarding.
  - XChaCha20-Poly1305 or AES-GCM for clipboard payload encryption.
- Cloudflare Web Crypto is available, but Workers Web Crypto support does not cleanly cover every desired primitive. Prefer one audited JS crypto path shared by daemon and Worker unless a later threat model chooses native/provider-specific crypto.

Clean UX:

- First device runs `pasta bootstrap`, creates account routing metadata, creates group key and device keys, stores secrets locally.
- New device runs `pasta pair`, gets a short code and terminal QR with ephemeral public keys plus pairing session ID.
- Existing device runs `pasta devices approve <code>` or selects pending request; it wraps the group key to the new device and signs the approval.
- User never types a durable account ID or durable high-entropy secret. The only carried value is temporary pairing material.
- If all devices are gone, `pasta reset` creates a new encrypted space; old ciphertext is unrecoverable.

## Bun Distribution

Sources:

- [Bun bunx docs](https://bun.com/docs/pm/bunx)
- [Bun Git dependency docs](https://bun.com/docs/guides/install/add-git)
- [Bun lifecycle scripts](https://bun.com/docs/pm/lifecycle)
- [Bun standalone executables](https://bun.com/docs/bundler/executables)
- [npm `package.json` bin](https://docs.npmjs.com/cli/v10/configuring-npm/package-json/#bin)

Findings:

- `bunx` is documented for package executables exposed through `package.json#bin`.
- Bun supports GitHub package specs such as `github:owner/repo` for dependencies.
- Subagent tests on Bun 1.4.0-canary showed `bunx github:<repo>` and `bunx -p github:<repo> <bin>` attempt GitHub tarball resolution. This proves parsing/resolution, not end-to-end execution for this repo.
- GitHub `bunx` must be treated as a smoke-tested distribution target, not assumed done.
- Avoid lifecycle scripts in the GitHub path. Bun restricts arbitrary lifecycle scripts unless dependencies are trusted, so commit a runnable `#!/usr/bin/env bun` bin entry.
- Keep native dependencies out of the MVP path. They make GitHub `bunx` and cross-arch distribution fragile.

Recommended package shape:

```json
{
  "name": "pasta",
  "type": "module",
  "bin": {
    "pasta": "./src/cli.ts"
  },
  "trustedDependencies": []
}
```

Commands to verify after a public repo exists:

```bash
bunx --bun github:thehumanworks/pasta --version
bunx --bun -p github:thehumanworks/pasta pasta --version
bunx --bun github:thehumanworks/pasta#v0.1.0 --version
bunx --bun @thehumanworks/pasta --version
```

## Desktop Clipboard

Observed locally on macOS:

```bash
command -v pbcopy pbpaste wl-copy wl-paste xclip xsel powershell.exe pwsh
```

Only `/usr/bin/pbcopy` and `/usr/bin/pbpaste` were present on the current Mac.

Implementation direction:

- macOS text MVP: shell out to `pbcopy` and `pbpaste`.
- Linux text MVP: prefer Wayland `wl-copy`/`wl-paste`, fallback to X11 `xclip`/`xsel`, and fail clearly if no clipboard tool exists.
- Windows text MVP: use PowerShell/Windows clipboard commands from Bun subprocesses; direct proof still required.
- Global OS hotkeys should not be MVP. Provide shell integration and explicit commands first:
  - `pasta daemon`
  - `pasta copy`
  - `pasta paste`
  - `pasta history`
  - `pasta history paste <seq>`

## Subagent Status

- Bun distribution lane completed and supplied usable findings.
- Cloudflare backend lane stalled, but its nested Durable Object research completed and was incorporated.
- Desktop clipboard and pairing/crypto lanes stalled. Direct research filled the immediate gaps, and remaining uncertainty is captured as verification tasks in the goals.
