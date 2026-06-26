---
title: Binary Payloads
slug: payloads
description: Images, files, R2 storage, size limits, and retention at v0.1.0.
nav_order: 9
---

<!-- @human -->
## Three payload kinds

| Kind | Commands | Storage |
| --- | --- | --- |
| `text` | `copy`, `paste`, `history` | Inline in Durable Object |
| `image` | `copy-image`, `paste-image` | Inline (PNG on macOS) |
| `file` | `send-file`, `paste-file` | R2 encrypted blob |

All kinds are **encrypted on your device** before upload. Cloudflare stores ciphertext and metadata — never filenames, local paths, or plaintext.

## Images

macOS PNG pasteboard support is live:

```bash
pasta copy-image
pasta paste-image
pasta paste-image --out screenshot.png
pasta paste-image --seq 18 --out screenshot.png
```

If the latest clip is text or a file, `paste-image` fails with a clear message instead of guessing.

Linux and Windows image clipboard adapters are documented assumptions until native smoke coverage lands.

## Files

```bash
pasta send-file ./notes.txt --mime text/plain
pasta send-file ./archive.zip --mime application/zip
pasta paste-file --out ./received.bin
pasta paste-file --seq 21 --out ./received.zip
```

**Hard cap: 50 MiB.** The CLI rejects larger files before reading them into memory.

Filenames and paths are **not** sent to the relay. MIME type is stored; original names are omitted by design.

## Size thresholds

- **512 KiB** inline threshold — text stays inline; larger binary designs use R2 for files.
- **50 MiB** maximum encrypted payload for the first hardening pass.

Run `pasta payload-plan` for the live JSON contract.

## R2 key format

```
spaces/{routing_id}/clips/{seq}/{payload_id}
```

`payload_id` is random base64url — never derived from filename or content hash.

## Retention

Expired clips trigger Durable Object alarms that delete DO metadata and associated R2 objects. Cleanup is idempotent.

## Inspect limits programmatically

```bash
pasta payload-plan
```

<!-- @agent -->
## Constants (protocol.ts)

```typescript
LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES = 512 * 1024
LARGE_PAYLOAD_MAX_BYTES = 50 * 1024 * 1024
```

## CLI file path (cli.ts)

`send-file`:
1. `Bun.file(path)` — reject if size > MAX
2. `encryptBytesClip({ payloadKind: "file", mime, bytes, ... })`
3. `POST /v1/files`

`paste-file`:
1. Resolve seq from arg or `GET /v1/clips/latest`
2. `GET /v1/files/:seq` → `{ clip, ciphertext }`
3. `decryptStoredBytes` → `Bun.write(out, bytes)`

## Image path

`copy-image`: `clipboard.readImage()` → `publishImage` → `POST /v1/clips` with `payloadKind: "image"`

`paste-image`: checks `response.clip.payloadKind === "image"` before decrypt

## Worker file upload sequence

1. Validate signed `EncryptedClip` envelope
2. DO reserves metadata + assigns seq + r2 key
3. Worker writes encrypted bytes to R2 (`env.BLOBS`)
4. R2 failure → rollback DO row
5. Success → retention alarm + 201 `{ clip }`

## Design doc

Full contract: `docs/binary-payloads.md`

## Tests

`test/bun/hardening.test.ts` — size limits, payload kind handling
