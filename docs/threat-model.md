# Pasta Threat Model

## Assets

- Clipboard plaintext.
- Group key.
- Device signing private key.
- Device wrapping private key.
- Wrapped group-key grants.
- Join grant tokens and sealed group-key grants.
- Ciphertext history.
- Account, routing, device, timing, display sequence, MIME, and byte-length metadata.

## Trust Boundaries

- Device boundary: plaintext and raw group keys exist only locally.
- Worker boundary: verifies signatures, routes requests, and reads/writes D1 registry rows.
- Durable Object boundary: stores encrypted clip history, stable clip ids, display sequences, and wrapped-key grants.
- D1 boundary: stores registry, device public keys, request nonces, pairing session metadata, join-grant verifiers, and device expiry metadata.
- R2 boundary: reserved for future encrypted blobs only.

## Attackers

- Cloudflare operator or compromised relay storage.
- Network attacker.
- Malicious pairing requester.
- Stolen CI join token.
- Revoked device.
- Expired sandbox device.
- Stolen but not-yet-revoked device.
- Local malware or compromised local account.

## Protections

- Clipboard payloads are encrypted before upload.
- The relay receives ciphertext and metadata, not plaintext.
- Device requests require Ed25519 signatures and registered active device state.
- Request replay is blocked by timestamp window plus per-device nonce storage.
- Pairing requires existing-device approval and X25519-wrapped group-key grants.
- Pairing short codes are stored hashed, expire, and can be consumed once.
- Noninteractive join grants require signed trusted-device creation, high-entropy token redemption, short token TTL, use limits, and token-sealed group-key grants that Cloudflare cannot decrypt.
- Devices created by join grants can carry `device_expires_at`; auth converts expiry into revoked state and rejects the request before clipboard operations.
- Revoked devices cannot publish, pull, approve, or receive new wrapped keys.

## Accepted Leakage

The relay can observe account IDs, routing IDs, device IDs, timing, IP-level request information, sequence counts, MIME kind, payload byte length, expiry metadata, and which device originated a clip. This MVP does not attempt to hide that a user uses Pasta or when encrypted clipboard events occur.

## Non-Goals

- Defeating malware on a trusted local desktop.
- Recovering lost group keys.
- Hiding usage metadata from the relay.
- Mobile approval, browser extension sync, GUI previews, or global OS hotkeys.
- P2P, LAN discovery, SSH, tailnets, STUN/TURN, WebRTC traversal, or fallback transports.

## Reset Semantics

If all trusted devices are lost, recovery is reset. Reset creates a new group key and routing id; old ciphertext becomes unrecoverable. The command requires explicit confirmation and warns the user before changing the encrypted space.
