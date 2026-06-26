# Pasta Protocol Spec

Version: `pasta 0.1.2`

Pasta uses a central HTTPS relay only. Devices encrypt clipboard payloads locally, sign every authenticated request with an app-owned Ed25519 device key, and route state to one Cloudflare Durable Object per encrypted clipboard space. The relay never receives clipboard plaintext or raw group keys.

## Identifiers

- `account_id`: stable account registry key stored in D1.
- `routing_id`: internal Durable Object routing name. It is not secret and is not an auth boundary.
- `device_id`: device-scoped identifier registered under an account.
- `clip_id`: client-generated opaque clip identifier.
- `seq`: Durable Object assigned append-only sequence number.

## Crypto

- Device request signing: Ed25519 over the canonical request string.
- Clipboard payloads: XChaCha20-Poly1305 with a 32-byte group key and 24-byte nonce.
- Pairing grants: X25519 shared secret, HKDF-SHA256, XChaCha20-Poly1305 wrapped group key.
- Short codes: temporary user-visible codes hashed with account context before storage.

AAD for text clips is canonical JSON:

```json
{
  "accountId": "acct_...",
  "routingId": "space_...",
  "clipId": "clip_...",
  "originDeviceId": "dev_...",
  "createdAt": 1782475200000,
  "payloadKind": "text",
  "mime": "text/plain; charset=utf-8",
  "byteLen": 11,
  "keyVersion": 1
}
```

## Signed Requests

Authenticated requests carry:

- `pasta-account-id`
- `pasta-device-id`
- `pasta-timestamp`
- `pasta-nonce`
- `pasta-body-sha256`
- `pasta-signature`

Canonical string:

```text
PASTA-SIGN-V1
<METHOD>
<PATH_WITH_QUERY>
<TIMESTAMP_MS>
<NONCE>
<BODY_SHA256_BASE64URL>
```

The Worker rejects stale timestamps outside five minutes, bad body hashes, unknown devices, revoked devices, invalid signatures, and replayed nonces.

## Endpoint Map

| CLI command | Method/path | Auth | Request | Response | Mutation |
| --- | --- | --- | --- | --- | --- |
| `bootstrap` | `POST /v1/accounts/bootstrap` | none | first-device public keys, account/routing/device metadata | registered account/device | D1 `accounts`, `devices` |
| `copy` | `POST /v1/clips` | device signature | encrypted text envelope | assigned `seq` and clip metadata | Durable Object `clips` |
| `paste` | `GET /v1/clips/latest` or `/v1/clips/:seq` | device signature | empty signed request | encrypted clip | D1 `last_seen_at` |
| `history` | `GET /v1/clips/history` | device signature | `before`, `limit` query | encrypted clip list | D1 `last_seen_at` |
| `history delete` | `DELETE /v1/clips/:seq` | device signature | selected sequence | delete count and deleted object count | DO clip row delete, optional R2 object delete |
| `pair request` | `POST /v1/pairing/open` | none | temporary session, short-code hash, new-device public keys | pending session | D1 `pairing_sessions` |
| `devices approve` | `POST /v1/pairing/approve` | device signature | short-code hash, wrapped group-key grant | approved new device | D1 `devices`, D1 pairing row, DO `wrapped_keys` |
| `pair consume` | `POST /v1/pairing/consume` | none | session id and short-code hash | wrapped group key once | D1 `consumed_at` |
| `devices list` | `GET /v1/devices` | device signature | empty signed request | device metadata only | D1 `last_seen_at` |
| `devices revoke` | `POST /v1/devices/:deviceId/revoke` | device signature | target device | revocation metadata | D1 revoked status, DO wrapped-key revocation |
| `reset` | `POST /v1/reset` | device signature | `confirm: RESET`, new routing id | new encrypted space metadata | D1 `routing_id`, `reset_at` |

## Reset

Reset creates a new encrypted space and local group key. Old remote ciphertext may remain until retention cleanup, but it is no longer reachable through the new `routing_id` and cannot be decrypted after local keys are deleted. Reset does not delete unrelated local secrets.
