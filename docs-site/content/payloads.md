---
title: Binary Payloads
slug: payloads
description: Images, files, R2 storage, size limits, and retention at v0.1.11.
nav_order: 9
---

<!-- @human -->
## Three payload kinds

| Kind | Commands | Storage |
| --- | --- | --- |
| `text` | `copy`, `paste`, `history` | Inline in Durable Object |
| `image` | `copy --image`, `paste --image` | Inline or R2 encrypted blob |
| `file` | `copy <path>`, `paste [--out <path>]` | R2 encrypted blob |

All kinds are **encrypted on your device** before upload. Cloudflare stores ciphertext and metadata. File basenames are encrypted for trusted devices; local paths and plaintext names are not stored in Worker, DO, or R2 metadata.

## Images

macOS PNG pasteboard support is live:

```bash
pasta copy --image
pasta paste --image
pasta paste --image --out screenshot.png
pasta paste --image --seq 18 --out screenshot.png
```

If the latest clip is text or a non-image file, `paste --image` fails with a clear message instead of guessing.

Linux and Windows image clipboard adapters are documented assumptions until native smoke coverage lands.

## Files

```bash
pasta copy ./notes.txt --mime text/plain
pasta copy --file ./archive.zip --mime application/zip
pasta paste
pasta paste --out ./received.bin
pasta paste --file --seq 21
pasta paste --file --seq 21 --out ./received.zip
```

**Hard cap: 50 MiB.** The CLI rejects larger files before reading them into memory.

Only encrypted basenames are sent for file context. MIME type is stored; local paths and plaintext names are omitted by design. If no basename is available, paste falls back to `output.<ext>`.

## Size thresholds

- **512 KiB** inline threshold — text stays inline; larger binary designs use R2 for files.
- **50 MiB** maximum encrypted payload for the first hardening pass.

Run `pasta payload-plan` for the live JSON contract.

## R2 key format

```
spaces/{routing_id}/clips/{clip_id}/{payload_id}
```

`payload_id` is random base64url — never derived from filename or content hash. `clip_id` is the stable clip identity; `seq` is only a gap-free display number.

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

`copy <path>`:
1. `Bun.file(path)` — reject if size > MAX
2. `encryptBytesClip({ payloadKind: "file", mime, bytes, ... })`
3. `POST /v1/files`

`paste` for file clips:
1. Resolve display seq from history or use `GET /v1/clips/latest`
2. `GET /v1/files/:clipId` → `{ clip, ciphertext }`
3. `decryptStoredBytes` → `Bun.write(out ?? originalName, bytes)`

## Image path

`copy --image`: `clipboard.readImage()` → `publishImage` → `POST /v1/clips` with `payloadKind: "image"`

`paste --image`: accepts `payloadKind: "image"` or image MIME file payloads before decrypt

## Worker file upload sequence

1. Validate signed `EncryptedClip` envelope
2. DO reserves metadata + assigns display seq + clipId-based r2 key
3. Worker writes encrypted bytes to R2 (`env.BLOBS`)
4. R2 failure → rollback DO row
5. Success → retention alarm + 201 `{ clip }`

## Design doc

Full contract: `docs/binary-payloads.md`

## Tests

`test/bun/hardening.test.ts` — size limits, payload kind handling
