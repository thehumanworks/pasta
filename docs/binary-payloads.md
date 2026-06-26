# Binary Payload Design

Binary payload support is behind the text MVP. Text clips remain inline in the Durable Object. Images and files use client-side encryption before upload and store only metadata in the Durable Object.

## Chosen Boundaries

- Inline ciphertext threshold: 512 KiB.
- Max binary payload size: 50 MiB for the first hardening pass.
- R2 key format: `spaces/{routing_id}/clips/{seq}/{payload_id}`.
- Finalize semantics: upload encrypted R2 object first, then signed finalize records DO metadata. Failed finalize leaves an orphan encrypted object eligible for cleanup.
- MIME and original filename handling: MIME type is stored; filenames should be omitted by default or replaced by user-approved labels because names can be sensitive.

## Worker Limits And Recovery

The Worker must stream where practical and avoid buffering unbounded files. The Durable Object stores sequence, size, MIME, nonce, AAD hash, R2 key, and retention metadata. Retention alarms delete DO metadata and encrypted R2 objects idempotently.

## Current MVP Behavior

Unsupported binary clipboard content fails with a controlled unsupported-payload result. Text support does not depend on R2.

