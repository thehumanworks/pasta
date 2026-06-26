import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  aadForClip,
  canonicalRequest,
  clipAadHash,
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
  payloadKind: "image" | "file";
  mime: string;
  groupKey: string;
  keyVersion?: number;
  clipId?: string;
  createdAt?: number;
  expiresAt?: number | null;
  nonce?: string;
  metadata?: ClipMetadata;
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
  const bytesInput: Omit<BytesClipEncryptionInput, "payloadKind"> & { payloadKind: "text" | "image" | "file" } = {
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

function encryptInlineClip(input: Omit<BytesClipEncryptionInput, "payloadKind"> & { payloadKind: "text" | "image" | "file" }): EncryptedClip {
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
