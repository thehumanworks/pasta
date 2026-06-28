# Pasta Protocol Spec

Version: `pasta 0.1.10`

Pasta uses a central HTTPS relay only. Devices encrypt clipboard payloads locally, sign every authenticated request with an app-owned Ed25519 device key, and route state to one Cloudflare Durable Object per encrypted clipboard space. The relay never receives clipboard plaintext or raw group keys.

## Identifiers

- `account_id`: stable account registry key stored in D1.
- `routing_id`: internal Durable Object routing name. It is not secret and is not an auth boundary.
- `device_id`: device-scoped identifier registered under an account.
- `clip_id`: client-generated opaque clip identifier. This is the stable identity for clip/file routes, Durable Object rows, R2 keys, and client caches.
- `seq`: gap-free display metadata assigned by the Durable Object. It is always `1..N`, higher means newer, and remaining rows are renumbered after delete or retention cleanup.

## Crypto

- Device request signing: Ed25519 over the canonical request string.
- Clipboard payloads: XChaCha20-Poly1305 with a 32-byte group key and 24-byte nonce.
- Pairing grants: X25519 shared secret, HKDF-SHA256, XChaCha20-Poly1305 wrapped group key.
- Join grants: a trusted device seals the group key with a token-derived seal key for CI/sandbox registration; the relay stores only sealed grant data and a redemption verifier.
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
| `copy` | `POST /v1/clips` or `POST /v1/files` | device signature | encrypted text envelope, image/file bytes, or client-zipped directory bundle | clip metadata with display `seq` | Durable Object `clips`, optional R2 object |
| `paste` | `GET /v1/clips/latest` or `/v1/clips/:clipId` | device signature | empty signed request | encrypted clip | D1 `last_seen_at` |
| `history` | `GET /v1/clips/history` | device signature | `before` clipId, `limit` query | encrypted clip list with display `seq` | D1 `last_seen_at` |
| `history delete` | `DELETE /v1/clips/:clipId` | device signature | selected clip id | delete count and deleted object count | DO clip row delete, optional R2 object delete |
| `pair request` | `POST /v1/pairing/open` | none | temporary session, short-code hash, new-device public keys | pending session | D1 `pairing_sessions` |
| `devices approve` | `POST /v1/pairing/approve` | device signature | short-code hash, wrapped group-key grant | approved new device | D1 `devices`, D1 pairing row, DO `wrapped_keys` |
| `pair consume` | `POST /v1/pairing/consume` | none | session id and short-code hash | wrapped group key once | D1 `consumed_at` |
| `pair grant create` | `POST /v1/pairing/grants` | device signature | grant id, redemption verifier, sealed group-key grant, token TTL, optional device TTL, use limit | stored join grant | D1 `pairing_grants` |
| `pair join` | `POST /v1/pairing/grants/redeem` | grant proof | grant id, redeem secret, new-device public keys | registered leased device plus sealed group-key grant | D1 `devices`, D1 grant use count |
| `pair grant revoke` | `POST /v1/pairing/grants/:grantId/revoke` | device signature | grant id | unused grant revoked | D1 `revoked_at` |
| `devices list` | `GET /v1/devices` | device signature | optional `includeRevoked=true` query | active device metadata by default; revoked rows only when requested | D1 `last_seen_at` |
| `devices revoke` | `POST /v1/devices/:deviceId/revoke` | device signature | target device | revocation metadata | D1 revoked status, DO wrapped-key revocation |
| `reset` | `POST /v1/reset` | device signature | `confirm: RESET`, new routing id | new encrypted space metadata | D1 `routing_id`, `reset_at` |

## Noninteractive Join Grants

Join grants let an existing trusted device approve a future CI or sandbox device without an interactive short-code step. The trusted device creates a high-entropy token and sends the relay only:

- `grant_id`
- account-scoped `redeem_secret_hash`
- sealed group-key grant
- `token_expires_at`
- optional `device_ttl_ms`
- `max_uses`
- optional label

The token contains independent `redeem_secret` and `seal_secret` values. `pair join` sends only the redeem secret to the Worker. The seal secret stays local and decrypts the sealed group-key grant after redemption.

Defaults:

- Token TTL: 10 minutes.
- Device TTL: none.
- Uses: 1.

Server bounds:

- Token TTL max: 24 hours.
- Device TTL max when set: 30 days.
- Uses max: 10.

By default, a joined device has `device_expires_at = NULL` and remains trusted until explicit revocation. When the grant creator sets a device TTL, it starts at redemption time and the joined device receives `device_expires_at = redeemed_at + device_ttl_ms`. Worker auth treats that field as real revocation: after expiry, the next valid signed request marks the device revoked, records `revoked_at`, revokes any active DO wrapped-key row, and rejects before copy, paste, history, approval, grant creation, or reset logic runs.

`GET /v1/devices` returns active devices only unless `includeRevoked=true` is supplied. Revoked devices are retained as server-side audit rows, but they are not reactivated. Pair approval and join-grant redemption reject any new device request whose `device_id` already exists; regaining access requires a fresh pairing request with a fresh device id.

## Reset

Reset creates a new encrypted space and local group key. Old remote ciphertext may remain until retention cleanup, but it is no longer reachable through the new `routing_id` and cannot be decrypted after local keys are deleted. Reset does not delete unrelated local secrets.

## Clip Schema Replacement

The current Durable Object clip schema is a clean replacement: `clip_id` is the primary key, `seq` is mutable display metadata, and old numeric clip/file URL shapes are not supported. Deploying this schema to an existing space drops the old clip table, so existing remote history becomes empty. Old R2 objects may remain as unreachable ciphertext until operator cleanup, but no plaintext or raw keys are exposed.
