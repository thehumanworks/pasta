import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { pbkdf2 } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  aadForClip,
  canonicalRequest,
  clipAadHash,
  PASSKEY_SECRET_KEY_BYTES,
  PASSKEY_SECRET_PBKDF2_ITERATIONS,
  PASSKEY_SECRET_SALT_BYTES,
  SECRET_MIME,
  type ClipAad,
  type ClipMetadata,
  type EncryptedClip,
  type EncryptedClipMetadata,
  type SignedRequestParts
} from "./protocol";
import {
  bytesToUtf8,
  fromBase64Url,
  randomBase64Url,
  randomBytes,
  stableJson,
  toBase64Url,
  utf8ToBytes
} from "./encoding";

export interface KeyPair {
  privateKey: string;
  publicKey: string;
}

export interface DeviceKeyMaterial {
  signing: KeyPair;
  wrapping: KeyPair;
}

export interface JoinGrantToken {
  endpoint: string;
  accountId: string;
  grantId: string;
  redeemSecret: string;
  sealSecret: string;
}

export interface JoinGrantSealAad {
  accountId: string;
  grantId: string;
  keyVersion: number;
  tokenExpiresAt: number;
  maxUses: number;
  deviceTtlMs: number | null;
}

export interface ClipEncryptionInput {
  accountId: string;
  routingId: string;
  originDeviceId: string;
  plaintext: string;
  groupKey: string;
  keyVersion?: number;
  clipId?: string;
  createdAt?: number;
  expiresAt?: number | null;
  nonce?: string;
  metadata?: ClipMetadata;
}

export interface BytesClipEncryptionInput {
  accountId: string;
  routingId: string;
  originDeviceId: string;
  bytes: Uint8Array;
  payloadKind: "image" | "file" | "secret";
  mime: string;
  groupKey: string;
  keyVersion?: number;
  clipId?: string;
  createdAt?: number;
  expiresAt?: number | null;
  nonce?: string;
  metadata?: ClipMetadata;
}

export interface PasskeySecretKdfParams {
  name: "pbkdf2-sha256";
  iterations: number;
  salt: string;
  dkLen: number;
}

export interface PasskeySecretEnvelope {
  v: 1;
  alg: "PBKDF2-SHA256-XChaCha20-Poly1305";
  key: string;
  kdf: PasskeySecretKdfParams;
  nonce: string;
  ciphertext: string;
}

export interface PasskeySecretEncryptionInput {
  accountId: string;
  routingId: string;
  originDeviceId: string;
  key: string;
  passkey: string;
  value: string;
  groupKey: string;
  keyVersion?: number;
  clipId?: string;
  createdAt?: number;
  expiresAt?: number | null;
  nonce?: string;
  salt?: string;
  passkeyNonce?: string;
}

export function generateGroupKey(): string {
  return toBase64Url(randomBytes(32));
}

export function generateSigningKeyPair(seed?: Uint8Array): KeyPair {
  const pair = seed ? ed25519.keygen(seed) : ed25519.keygen();
  return {
    privateKey: toBase64Url(pair.secretKey),
    publicKey: toBase64Url(pair.publicKey)
  };
}

export function generateWrappingKeyPair(seed?: Uint8Array): KeyPair {
  const pair = seed ? x25519.keygen(seed) : x25519.keygen();
  return {
    privateKey: toBase64Url(pair.secretKey),
    publicKey: toBase64Url(pair.publicKey)
  };
}

export function generateDeviceKeyMaterial(): DeviceKeyMaterial {
  return {
    signing: generateSigningKeyPair(),
    wrapping: generateWrappingKeyPair()
  };
}

export function signCanonicalRequest(parts: SignedRequestParts, privateKey: string): string {
  const signature = ed25519.sign(utf8ToBytes(canonicalRequest(parts)), fromBase64Url(privateKey));
  return toBase64Url(signature);
}

export function verifyCanonicalRequest(parts: SignedRequestParts, signature: string, publicKey: string): boolean {
  try {
    return ed25519.verify(
      fromBase64Url(signature),
      utf8ToBytes(canonicalRequest(parts)),
      fromBase64Url(publicKey)
    );
  } catch {
    return false;
  }
}

export function encryptTextClip(input: ClipEncryptionInput): EncryptedClip {
  const bytesInput: Omit<BytesClipEncryptionInput, "payloadKind"> & { payloadKind: "text" | "image" | "file" | "secret" } = {
    accountId: input.accountId,
    routingId: input.routingId,
    originDeviceId: input.originDeviceId,
    bytes: utf8ToBytes(input.plaintext),
    payloadKind: "text",
    mime: "text/plain; charset=utf-8",
    groupKey: input.groupKey
  };
  if (input.keyVersion !== undefined) bytesInput.keyVersion = input.keyVersion;
  if (input.clipId !== undefined) bytesInput.clipId = input.clipId;
  if (input.createdAt !== undefined) bytesInput.createdAt = input.createdAt;
  if (input.expiresAt !== undefined) bytesInput.expiresAt = input.expiresAt;
  if (input.nonce !== undefined) bytesInput.nonce = input.nonce;
  if (input.metadata !== undefined) bytesInput.metadata = input.metadata;
  return encryptInlineClip(bytesInput);
}

export function encryptBytesClip(input: BytesClipEncryptionInput): EncryptedClip {
  return encryptInlineClip(input);
}

export function encryptPasskeySecretClip(input: PasskeySecretEncryptionInput): EncryptedClip {
  const key = normalizeSecretKey(input.key);
  const passkey = requireNonEmpty(input.passkey, "passkey");
  const value = input.value;
  const sealInput: { key: string; passkey: string; value: string; salt?: string; nonce?: string } = {
    key,
    passkey,
    value
  };
  if (input.salt !== undefined) sealInput.salt = input.salt;
  if (input.passkeyNonce !== undefined) sealInput.nonce = input.passkeyNonce;
  const envelope = sealPasskeySecret(sealInput);
  const bytesInput: BytesClipEncryptionInput = {
    accountId: input.accountId,
    routingId: input.routingId,
    originDeviceId: input.originDeviceId,
    bytes: utf8ToBytes(stableJson(envelope)),
    payloadKind: "secret",
    mime: SECRET_MIME,
    groupKey: input.groupKey,
    metadata: { name: key }
  };
  if (input.keyVersion !== undefined) bytesInput.keyVersion = input.keyVersion;
  if (input.clipId !== undefined) bytesInput.clipId = input.clipId;
  if (input.createdAt !== undefined) bytesInput.createdAt = input.createdAt;
  if (input.expiresAt !== undefined) bytesInput.expiresAt = input.expiresAt;
  if (input.nonce !== undefined) bytesInput.nonce = input.nonce;
  return encryptInlineClip(bytesInput);
}

export function decryptPasskeySecretClip(
  groupKey: string,
  accountId: string,
  routingId: string,
  clip: EncryptedClip,
  passkey: string
): string {
  if (clip.payloadKind !== "secret") {
    throw new Error(`unsupported payload kind: ${clip.payloadKind}`);
  }
  const envelopeBytes = decryptBytesClip(groupKey, accountId, routingId, clip);
  const envelope = parsePasskeySecretEnvelope(bytesToUtf8(envelopeBytes));
  return openPasskeySecret(envelope, passkey);
}

export function sealPasskeySecret(input: {
  key: string;
  passkey: string;
  value: string;
  salt?: string;
  nonce?: string;
}): PasskeySecretEnvelope {
  const key = normalizeSecretKey(input.key);
  const passkey = requireNonEmpty(input.passkey, "passkey");
  const salt = input.salt ? fromBase64Url(input.salt) : randomBytes(PASSKEY_SECRET_SALT_BYTES);
  if (salt.length !== PASSKEY_SECRET_SALT_BYTES) {
    throw new Error(`passkey salt must be ${PASSKEY_SECRET_SALT_BYTES} bytes`);
  }
  const nonce = input.nonce ? fromBase64Url(input.nonce) : randomBytes(24);
  if (nonce.length !== 24) throw new Error("passkey nonce must be 24 bytes");
  const derived = derivePasskeySecretKey(passkey, salt);
  const aad = utf8ToBytes(stableJson(passkeySecretAad(key)));
  const cipher = xchacha20poly1305(derived, nonce, aad);
  return {
    v: 1,
    alg: "PBKDF2-SHA256-XChaCha20-Poly1305",
    key,
    kdf: {
      name: "pbkdf2-sha256",
      iterations: PASSKEY_SECRET_PBKDF2_ITERATIONS,
      salt: toBase64Url(salt),
      dkLen: PASSKEY_SECRET_KEY_BYTES
    },
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(cipher.encrypt(utf8ToBytes(input.value)))
  };
}

export function openPasskeySecret(envelope: PasskeySecretEnvelope, passkey: string): string {
  if (envelope.v !== 1) throw new Error("unsupported passkey secret version");
  if (envelope.alg !== "PBKDF2-SHA256-XChaCha20-Poly1305") throw new Error("unsupported passkey secret algorithm");
  if (envelope.kdf.name !== "pbkdf2-sha256") throw new Error("unsupported passkey secret KDF");
  if (envelope.kdf.iterations !== PASSKEY_SECRET_PBKDF2_ITERATIONS) {
    throw new Error("unsupported passkey secret KDF iterations");
  }
  if (envelope.kdf.dkLen !== PASSKEY_SECRET_KEY_BYTES) throw new Error("unsupported passkey secret key length");
  const key = normalizeSecretKey(envelope.key);
  const derived = derivePasskeySecretKey(requireNonEmpty(passkey, "passkey"), fromBase64Url(envelope.kdf.salt));
  const aad = utf8ToBytes(stableJson(passkeySecretAad(key)));
  const cipher = xchacha20poly1305(derived, fromBase64Url(envelope.nonce), aad);
  return bytesToUtf8(cipher.decrypt(fromBase64Url(envelope.ciphertext)));
}

export function parsePasskeySecretEnvelope(raw: string): PasskeySecretEnvelope {
  const parsed = JSON.parse(raw) as PasskeySecretEnvelope;
  if (parsed.v !== 1 || typeof parsed.key !== "string" || typeof parsed.ciphertext !== "string") {
    throw new Error("invalid passkey secret envelope");
  }
  return parsed;
}

function encryptInlineClip(input: Omit<BytesClipEncryptionInput, "payloadKind"> & { payloadKind: "text" | "image" | "file" | "secret" }): EncryptedClip {
  const clip: EncryptedClip = {
    clipId: input.clipId ?? `clip_${randomBase64Url(16)}`,
    originDeviceId: input.originDeviceId,
    createdAt: input.createdAt ?? Date.now(),
    expiresAt: input.expiresAt ?? null,
    payloadKind: input.payloadKind,
    mime: input.mime,
    byteLen: input.bytes.length,
    keyVersion: input.keyVersion ?? 1,
    nonce: input.nonce ?? toBase64Url(randomBytes(24)),
    aadHash: "",
    ciphertext: ""
  };
  const aad = aadForClip(input.accountId, input.routingId, clip);
  const aadBytes = utf8ToBytes(stableJson(aad));
  const cipher = xchacha20poly1305(fromBase64Url(input.groupKey), fromBase64Url(clip.nonce), aadBytes);
  clip.ciphertext = toBase64Url(cipher.encrypt(input.bytes));
  clip.aadHash = clipAadHash(aad);
  if (input.metadata) {
    clip.metadata = encryptClipMetadata(input.groupKey, input.accountId, input.routingId, clip, input.metadata);
  }
  return clip;
}

export function decryptClipMetadata(groupKey: string, accountId: string, routingId: string, clip: EncryptedClip): ClipMetadata | null {
  if (!clip.metadata) return null;
  const cipher = xchacha20poly1305(
    fromBase64Url(groupKey),
    fromBase64Url(clip.metadata.nonce),
    metadataAadBytes(accountId, routingId, clip)
  );
  const parsed = JSON.parse(bytesToUtf8(cipher.decrypt(fromBase64Url(clip.metadata.ciphertext)))) as ClipMetadata;
  const name = typeof parsed.name === "string" ? parsed.name : undefined;
  return name ? { name } : {};
}

export function decryptTextClip(groupKey: string, accountId: string, routingId: string, clip: EncryptedClip): string {
  if (clip.payloadKind !== "text") {
    throw new Error(`unsupported payload kind: ${clip.payloadKind}`);
  }
  const aad = aadForClip(accountId, routingId, clip);
  const expectedAadHash = clipAadHash(aad);
  if (expectedAadHash !== clip.aadHash) {
    throw new Error("clip AAD hash mismatch");
  }
  const cipher = xchacha20poly1305(fromBase64Url(groupKey), fromBase64Url(clip.nonce), utf8ToBytes(stableJson(aad)));
  return bytesToUtf8(cipher.decrypt(fromBase64Url(clip.ciphertext)));
}

export function decryptBytesClip(groupKey: string, accountId: string, routingId: string, clip: EncryptedClip): Uint8Array {
  const aad = aadForClip(accountId, routingId, clip);
  const expectedAadHash = clipAadHash(aad);
  if (expectedAadHash !== clip.aadHash) {
    throw new Error("clip AAD hash mismatch");
  }
  const cipher = xchacha20poly1305(fromBase64Url(groupKey), fromBase64Url(clip.nonce), utf8ToBytes(stableJson(aad)));
  return cipher.decrypt(fromBase64Url(clip.ciphertext));
}

export function wrapGroupKey(params: {
  groupKey: string;
  senderPrivateKey: string;
  senderPublicKey: string;
  recipientPublicKey: string;
  nonce?: string;
}): string {
  const nonce = params.nonce ? fromBase64Url(params.nonce) : randomBytes(24);
  const key = deriveWrapKey(params.senderPrivateKey, params.senderPublicKey, params.recipientPublicKey);
  const cipher = xchacha20poly1305(key, nonce, utf8ToBytes("pasta.group-key-wrap.v1"));
  return stableJson({
    v: 1,
    alg: "X25519-HKDF-SHA256-XChaCha20-Poly1305",
    senderWrapPublicKey: params.senderPublicKey,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(cipher.encrypt(fromBase64Url(params.groupKey)))
  });
}

export function unwrapGroupKey(params: {
  wrappedGroupKey: string;
  recipientPrivateKey: string;
  recipientPublicKey: string;
}): string {
  const parsed = JSON.parse(params.wrappedGroupKey) as {
    senderWrapPublicKey: string;
    nonce: string;
    ciphertext: string;
  };
  const key = deriveWrapKey(params.recipientPrivateKey, params.recipientPublicKey, parsed.senderWrapPublicKey);
  const cipher = xchacha20poly1305(key, fromBase64Url(parsed.nonce), utf8ToBytes("pasta.group-key-wrap.v1"));
  return toBase64Url(cipher.decrypt(fromBase64Url(parsed.ciphertext)));
}

export function hashShortCode(code: string, accountId: string): string {
  return toBase64Url(sha256(utf8ToBytes(`pasta-short-code-v1\0${accountId}\0${code.trim().toUpperCase()}`)));
}

export function createJoinGrantToken(input: JoinGrantToken): string {
  return [
    "pasta_join_v1",
    toBase64Url(utf8ToBytes(input.endpoint)),
    input.accountId,
    input.grantId,
    input.redeemSecret,
    input.sealSecret
  ].join(".");
}

export function parseJoinGrantToken(token: string): JoinGrantToken {
  const [version, endpointText, accountId, grantId, redeemSecret, sealSecret, ...extra] = token.split(".");
  if (version !== "pasta_join_v1" || !endpointText || !accountId || !grantId || !redeemSecret || !sealSecret || extra.length > 0) {
    throw new Error("invalid join token");
  }
  assertSecretBytes(redeemSecret, "redeemSecret");
  assertSecretBytes(sealSecret, "sealSecret");
  return {
    endpoint: bytesToUtf8(fromBase64Url(endpointText)),
    accountId,
    grantId,
    redeemSecret,
    sealSecret
  };
}

export function hashJoinGrantRedeemSecret(accountId: string, grantId: string, redeemSecret: string): string {
  return toBase64Url(sha256(utf8ToBytes(`pasta-join-redeem-v1\0${accountId}\0${grantId}\0${redeemSecret}`)));
}

export function sealJoinGrant(params: {
  groupKey: string;
  accountId: string;
  grantId: string;
  sealSecret: string;
  keyVersion: number;
  tokenExpiresAt: number;
  maxUses: number;
  deviceTtlMs: number | null;
  nonce?: string;
}): string {
  const nonce = params.nonce ? fromBase64Url(params.nonce) : randomBytes(24);
  const aad = joinGrantSealAad(params);
  const cipher = xchacha20poly1305(deriveJoinGrantSealKey(params.accountId, params.grantId, params.sealSecret), nonce, joinGrantAad(aad));
  return stableJson({
    v: 1,
    alg: "HKDF-SHA256-XChaCha20-Poly1305",
    aad,
    nonce: toBase64Url(nonce),
    ciphertext: toBase64Url(cipher.encrypt(fromBase64Url(params.groupKey)))
  });
}

export function openJoinGrant(params: {
  sealedGroupKey: string;
  accountId: string;
  grantId: string;
  sealSecret: string;
}): string {
  const parsed = JSON.parse(params.sealedGroupKey) as {
    v: number;
    aad: JoinGrantSealAad;
    nonce: string;
    ciphertext: string;
  };
  if (parsed.v !== 1) throw new Error("unsupported join grant");
  if (parsed.aad.accountId !== params.accountId || parsed.aad.grantId !== params.grantId) {
    throw new Error("join grant AAD mismatch");
  }
  const cipher = xchacha20poly1305(deriveJoinGrantSealKey(params.accountId, params.grantId, params.sealSecret), fromBase64Url(parsed.nonce), joinGrantAad(parsed.aad));
  return toBase64Url(cipher.decrypt(fromBase64Url(parsed.ciphertext)));
}

export function makeShortCode(bytes = 4): string {
  return toBase64Url(randomBytes(bytes)).replace(/[^A-Z0-9]/giu, "").slice(0, 8).toUpperCase().padEnd(8, "X");
}

export function aadForPlaintextClip(input: Omit<ClipAad, "byteLen"> & { plaintext: string }): ClipAad {
  return {
    accountId: input.accountId,
    routingId: input.routingId,
    clipId: input.clipId,
    originDeviceId: input.originDeviceId,
    createdAt: input.createdAt,
    payloadKind: input.payloadKind,
    mime: input.mime,
    byteLen: utf8ToBytes(input.plaintext).length,
    keyVersion: input.keyVersion
  };
}

function deriveWrapKey(privateKey: string, ownPublicKey: string, peerPublicKey: string): Uint8Array {
  const ownPublic = fromBase64Url(ownPublicKey);
  const peerPublic = fromBase64Url(peerPublicKey);
  const [first, second] = toBase64Url(ownPublic) < toBase64Url(peerPublic) ? [ownPublic, peerPublic] : [peerPublic, ownPublic];
  const sharedSecret = x25519.getSharedSecret(fromBase64Url(privateKey), peerPublic);
  return hkdf(
    sha256,
    sharedSecret,
    utf8ToBytes("pasta.wrap.salt.v1"),
    new Uint8Array([...utf8ToBytes("pasta.wrap.info.v1"), ...first, ...second]),
    32
  );
}

function deriveJoinGrantSealKey(accountId: string, grantId: string, sealSecret: string): Uint8Array {
  return hkdf(
    sha256,
    fromBase64Url(sealSecret),
    utf8ToBytes(`pasta-join-seal-salt-v1\0${accountId}\0${grantId}`),
    utf8ToBytes("pasta-join-seal-v1"),
    32
  );
}

function joinGrantSealAad(input: JoinGrantSealAad): JoinGrantSealAad {
  return {
    accountId: input.accountId,
    grantId: input.grantId,
    keyVersion: input.keyVersion,
    deviceTtlMs: input.deviceTtlMs,
    tokenExpiresAt: input.tokenExpiresAt,
    maxUses: input.maxUses
  };
}

function joinGrantAad(input: {
  accountId: string;
  grantId: string;
  keyVersion: number;
  tokenExpiresAt: number;
  maxUses: number;
  deviceTtlMs: number | null;
}): Uint8Array {
  return utf8ToBytes(stableJson({
    accountId: input.accountId,
    grantId: input.grantId,
    keyVersion: input.keyVersion,
    deviceTtlMs: input.deviceTtlMs,
    tokenExpiresAt: input.tokenExpiresAt,
    maxUses: input.maxUses
  }));
}

function assertSecretBytes(value: string, label: string): void {
  if (fromBase64Url(value).length !== 32) {
    throw new Error(`${label} must be 32 bytes`);
  }
}

function derivePasskeySecretKey(passkey: string, salt: Uint8Array): Uint8Array {
  return pbkdf2(sha256, utf8ToBytes(passkey), salt, {
    c: PASSKEY_SECRET_PBKDF2_ITERATIONS,
    dkLen: PASSKEY_SECRET_KEY_BYTES
  });
}

function passkeySecretAad(key: string): { purpose: string; key: string } {
  return {
    purpose: "pasta.passkey-secret.v1",
    key
  };
}

function normalizeSecretKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new Error("secret key is required");
  if (normalized.length > 256) throw new Error("secret key is too long");
  return normalized;
}

function requireNonEmpty(value: string, label: string): string {
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function encryptClipMetadata(
  groupKey: string,
  accountId: string,
  routingId: string,
  clip: EncryptedClip,
  metadata: ClipMetadata
): EncryptedClipMetadata {
  const nonce = toBase64Url(randomBytes(24));
  const cipher = xchacha20poly1305(fromBase64Url(groupKey), fromBase64Url(nonce), metadataAadBytes(accountId, routingId, clip));
  return {
    nonce,
    ciphertext: toBase64Url(cipher.encrypt(utf8ToBytes(stableJson(metadata))))
  };
}

function metadataAadBytes(accountId: string, routingId: string, clip: EncryptedClip): Uint8Array {
  return utf8ToBytes(stableJson({
    purpose: "pasta.clip-metadata.v1",
    clip: aadForClip(accountId, routingId, clip)
  }));
}
