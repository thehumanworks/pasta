# Binary Payload Design

Binary payload support is behind the text MVP. Text clips remain inline in the Durable Object. Images and files are encrypted client-side before upload; Cloudflare stores only ciphertext and metadata.

## Chosen Boundaries

- Inline ciphertext threshold: 512 KiB. Text stays inline; binary payloads above this threshold use R2.
- Max binary payload size: 50 MiB for the first hardening pass.
- R2 key format: `spaces/{routing_id}/clips/{seq}/{payload_id}` where `payload_id` is random base64url and never derived from a filename, MIME type, or plaintext hash.
- Sequence allocation: the Durable Object allocates `seq` for each accepted R2-backed image or file payload and derives the R2 key from that sequence plus a random `payload_id`.
- Finalize semantics: the first implementation uses one signed Worker request for bounded R2-backed payloads. The Worker validates the encrypted envelope, reserves metadata in the Durable Object, writes encrypted bytes to R2, rolls back the metadata row if the R2 write fails, schedules retention after a successful R2 write, and only then returns `201`.
- MIME and original filename handling: MIME type is stored; filenames are omitted by default or replaced by user-approved labels because names can be sensitive.

## Metadata Contract

Durable Object rows store:

- `seq`, `clip_id`, origin device, timestamps, expiry, payload kind, MIME, ciphertext byte length, key version, nonce, AAD hash.
- `storage_kind`: `inline` or `r2`.
- `r2_key`, `payload_id`, and `uploaded_at` for R2-backed payloads.
- No plaintext, raw group keys, full original filenames, local paths, or user names.

R2 objects store encrypted bytes only. Object metadata may include content length, MIME, and clip id, but must not include plaintext names or paths.

## API Shape

1. `POST /v1/files` accepts a normal signed device request containing an `EncryptedClip` with `payloadKind: "file"` or `payloadKind: "image"` and base64url encrypted bytes in `ciphertext`.
2. The Worker validates the 50 MiB max, AAD hash, origin device, MIME, and ciphertext encoding before touching storage.
3. The Durable Object reserves metadata, assigns `seq`, and returns an R2 key in the form `spaces/{routing_id}/clips/{seq}/{payload_id}`.
4. The Worker writes encrypted bytes to R2 using that key. R2 custom metadata is limited to clip id, payload kind, and MIME.
5. If the R2 write fails, the Worker deletes the reserved DO row and returns failure. If it succeeds, the Worker schedules retention and returns `{ clip }` with metadata only.
6. `GET /v1/files/:seq` is signed, reads metadata from the Durable Object, downloads encrypted bytes from R2, and returns `{ clip, ciphertext }` for local decryption.

## Limits And Recovery

Design targets current Cloudflare platform constraints conservatively:

- Keep Workers request bodies below the account-plan request body limit; the first binary pass caps encrypted payloads at 50 MiB.
- Keep Durable Object SQLite rows metadata-only so DO storage is not used for large bytes.
- R2 supports objects far larger than Pasta's first-pass 50 MiB cap, so the product cap is the user-facing limit.

Reference sources:

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- Cloudflare R2 limits: https://developers.cloudflare.com/r2/platform/limits/

Failure cases:

- Validation fails before storage: no DO row or R2 object is created.
- R2 write fails after metadata reservation: the Worker deletes the reserved DO row before returning failure.
- Client crashes after server `201`: history/latest can still retrieve metadata and `paste --out` can download the encrypted object.
- Cleanup retries are idempotent: missing R2 object plus expired DO row is success.

## Retention

Retention alarms delete expired DO metadata and associated R2 objects. The alarm order is:

1. Query expired finalized rows and expired pending rows.
2. Delete associated R2 objects if `r2_key` is present.
3. Delete DO rows.
4. Repeat safely when the same alarm runs again.

## Current MVP Behavior

Image clipboard support is implemented for macOS PNG pasteboard data through the primary `copy` and `paste` commands. Small PNG payloads stay inline; large PNG payloads use the R2-backed image path while preserving `payloadKind: "image"`. Linux and Windows image clipboard support remains a command-plan assumption in this environment until a native runner is available.

File payload support is implemented through the primary `copy` and `paste --out` commands. The CLI rejects files above 50 MiB before reading them into memory, encrypts bytes locally, sends encrypted bytes to the Worker, and the Worker stores them in R2 under the DO-assigned key. File payloads require `--out` on paste.

Unsupported binary clipboard content outside the implemented PNG image path fails with a controlled unsupported-payload result. Text support does not depend on R2. Goal 06 adds binary support behind platform-scoped clipboard adapters, and Goal 07 makes `copy`/`paste` the primary UX.

## Design Review Result

Pass for Goal 06 Task 1 once implementation follows this contract: the design chooses the inline threshold, R2 key format, finalize semantics, max size, metadata boundary, and failure recovery path. Later tasks must still prove OS image handling, file transfer, retention deletion, and log hygiene.
