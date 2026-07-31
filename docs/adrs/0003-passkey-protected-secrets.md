# ADR 0003: Passkey-Protected Remote Secrets

## Status

Accepted for the passkey-protected secrets feature.

## Date

2026-07-31

## Context

Users want to park high-sensitivity values (API tokens, passwords, one-time
codes) in the Pasta remote clipboard without making those values readable to
every trusted device that already holds the group key. Ordinary Pasta clips are
encrypted only to the group key, so any paired device can decrypt them.

The product still must keep Cloudflare outside the plaintext boundary: the relay
must never receive secret plaintext, passkeys, or raw group keys.

## Decision

Pasta adds a nested encryption path for named secrets:

1. Derive a 32-byte key from the user passkey with PBKDF2-HMAC-SHA256
   (210000 iterations, random 16-byte salt).
2. Encrypt the secret value with XChaCha20-Poly1305 under that derived key,
   binding AAD `{ purpose: "pasta.passkey-secret.v1", key: <secret-name> }`.
3. Wrap the resulting envelope bytes as an inline clip with
   `payloadKind: "secret"` and MIME `application/vnd.pasta.secret+json`,
   encrypted to the normal Pasta group key with the existing clip AAD rules.
4. Store the secret key path in encrypted clip metadata (`ClipMetadata.name`) so
   trusted devices can list and select secrets without knowing the passkey.

Secret keys are slash-separated paths:

- A bare first segment needs no leading `/`; that is the default root form
  (`KEY`).
- Nested paths use additional segments (`production/tool/KEY`).
- Leading `/`, trailing `/`, empty segments, and `.` / `..` are rejected.

CLI surface:

- `pasta secret set --key KEY|--key production/tool/KEY --passkey PASS [--value VALUE]`
- `pasta secret get --key KEY|--key production/tool/KEY --passkey PASS`
- If `--value` is omitted or present without an argument, `set` reads stdin.

iOS keyboard surface:

- Secret entries are not ordinary one-tap text history inserts.
- Unlocking a secret requires an explicit passkey prompt before insertion.
- Setting a secret requires an explicit key name + passkey and uses the current
  clipboard text as the value only after user action.

Ordinary `paste` and keyboard text-history insert paths reject or skip secret
payloads so nested ciphertext cannot be mistaken for clipboard text.

## Consequences

- Trusted devices with the group key can see that a named secret exists and can
  delete or list it, but cannot recover the value without the passkey.
- Cloudflare still observes payload kind, size, timing, and identifiers, never
  plaintext or passkeys.
- Wrong passkeys fail closed during AEAD open.
- Multiple sets for the same key append history; `get` returns the newest match.
- Worker/DO allowlists must accept `payloadKind: "secret"` for inline publish.
- Local auth storage (`auth.json` / `SecretStore`) remains unrelated; this ADR
  does not change device-key storage.

## Alternatives Considered

- **Group-key-only encryption with a secret MIME**: rejected because any trusted
  device could still decrypt the value.
- **Client-only text envelope without a new payload kind**: rejected because
  ordinary paste/history UX would surface ciphertext or accidentally treat the
  envelope as text.
- **Argon2id / scrypt**: deferred; PBKDF2-HMAC-SHA256 is available with matching
  parameters on Bun (`@noble/hashes`) and Apple platforms (`CommonCrypto`).
- **Cloudflare Access / WebAuthn passkeys as identity**: rejected; Pasta auth
  remains app-owned device keys and signed requests.
