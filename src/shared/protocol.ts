import { sha256 } from "@noble/hashes/sha2.js";
import { fromBase64Url, stableJson, toBase64Url, utf8ToBytes } from "./encoding";

export const PASTA_VERSION = "0.1.1";
export const SIGNING_VERSION = "PASTA-SIGN-V1";
export const REQUEST_TOLERANCE_MS = 5 * 60 * 1000;
export const REQUEST_NONCE_TTL_MS = 10 * 60 * 1000;
export const DEFAULT_HISTORY_LIMIT = 20;
export const MAX_HISTORY_LIMIT = 100;
export const TEXT_INLINE_LIMIT_BYTES = 512 * 1024;
export const LARGE_PAYLOAD_INLINE_THRESHOLD_BYTES = 512 * 1024;
export const LARGE_PAYLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const MAX_OPEN_PAIRING_SESSIONS = 5;

export const SIGNATURE_HEADERS = {
  accountId: "pasta-account-id",
  deviceId: "pasta-device-id",
  timestamp: "pasta-timestamp",
  nonce: "pasta-nonce",
  bodyHash: "pasta-body-sha256",
  signature: "pasta-signature"
} as const;

export interface SignedRequestParts {
  method: string;
  pathWithQuery: string;
  timestamp: number;
  nonce: string;
  bodyHash: string;
}

export interface ProtocolEndpoint {
  command: string;
  method: string;
  path: string;
  auth: "none" | "device-signature";
  request: string;
  response: string;
  mutation: string;
}

export const PROTOCOL_ENDPOINTS: ProtocolEndpoint[] = [
  {
    command: "bootstrap",
    method: "POST",
    path: "/v1/accounts/bootstrap",
    auth: "none",
    request: "first device public keys, account_id, routing_id, device metadata",
    response: "registered account/device metadata",
    mutation: "D1 accounts/devices insert"
  },
  {
    command: "copy",
    method: "POST",
    path: "/v1/clips",
    auth: "device-signature",
    request: "encrypted text envelope and metadata",
    response: "assigned sequence and stored clip metadata",
    mutation: "Durable Object clips insert"
  },
  {
    command: "paste",
    method: "GET",
    path: "/v1/clips/latest or /v1/clips/:seq",
    auth: "device-signature",
    request: "empty signed request",
    response: "opaque encrypted envelope and metadata",
    mutation: "D1 device last_seen_at"
  },
  {
    command: "history",
    method: "GET",
    path: "/v1/clips/history",
    auth: "device-signature",
    request: "before/limit query",
    response: "ordered encrypted clip metadata",
    mutation: "D1 device last_seen_at"
  },
  {
    command: "history delete",
    method: "DELETE",
    path: "/v1/clips/:seq",
    auth: "device-signature",
    request: "selected sequence",
    response: "delete count and deleted object count",
    mutation: "Durable Object clip row delete, optional R2 object delete"
  },
  {
    command: "pair",
    method: "POST",
    path: "/v1/pairing/open",
    auth: "none",
    request: "temporary session id, short-code hash, new-device public keys",
    response: "pending pairing session",
    mutation: "D1 pairing_sessions insert"
  },
  {
    command: "devices approve",
    method: "POST",
    path: "/v1/pairing/approve",
    auth: "device-signature",
    request: "short-code hash and wrapped group-key grant",
    response: "new device registered",
    mutation: "D1 devices insert, pairing approval update, DO wrapped_keys insert"
  },
  {
    command: "devices list",
    method: "GET",
    path: "/v1/devices",
    auth: "device-signature",
    request: "empty signed request",
    response: "device metadata without secrets",
    mutation: "D1 device last_seen_at"
  },
  {
    command: "devices revoke",
    method: "POST",
    path: "/v1/devices/:deviceId/revoke",
    auth: "device-signature",
    request: "target device id",
    response: "revocation metadata",
    mutation: "D1 device revoked, DO wrapped key revoked"
  },
  {
    command: "reset",
    method: "POST",
    path: "/v1/reset",
    auth: "device-signature",
    request: "explicit confirmation and new routing id",
    response: "new encrypted space metadata",
    mutation: "D1 account routing_id reset_at update"
  }
];

export type PayloadKind = "text" | "image" | "file";

export interface ClipAad {
  accountId: string;
  routingId: string;
  clipId: string;
  originDeviceId: string;
  createdAt: number;
  payloadKind: PayloadKind;
  mime: string;
  byteLen: number;
  keyVersion: number;
}

export interface EncryptedClip {
  clipId: string;
  originDeviceId: string;
  createdAt: number;
  expiresAt: number | null;
  payloadKind: PayloadKind;
  mime: string;
  byteLen: number;
  keyVersion: number;
  nonce: string;
  aadHash: string;
  ciphertext: string;
  storageKind?: "inline" | "r2";
  payloadId?: string;
  r2Key?: string;
}

export interface StoredClip extends EncryptedClip {
  seq: number;
}

export interface DevicePublicKeys {
  verifyPublicKey: string;
  wrapPublicKey: string;
}

export interface BootstrapRequest extends DevicePublicKeys {
  accountId: string;
  routingId: string;
  deviceId: string;
  deviceName: string;
  createdAt?: number;
}

export interface PairingOpenRequest extends DevicePublicKeys {
  sessionId: string;
  accountId: string;
  shortCodeHash: string;
  newDeviceId: string;
  newDeviceName: string;
  expiresAt: number;
}

export interface PairingApproveRequest {
  shortCodeHash: string;
  wrappedGroupKey: string;
  keyVersion: number;
}

export interface PairingConsumeRequest {
  sessionId: string;
  shortCodeHash: string;
}

export interface DeviceRecord {
  accountId: string;
  deviceId: string;
  deviceName: string;
  verifyPublicKey: string;
  wrapPublicKey: string;
  status: "active" | "revoked";
  createdAt: number;
  lastSeenAt: number | null;
  revokedAt: number | null;
}

export interface ResetRequest {
  confirm: "RESET";
  newRoutingId: string;
}

export function canonicalRequest(parts: SignedRequestParts): string {
  return [
    SIGNING_VERSION,
    parts.method.toUpperCase(),
    parts.pathWithQuery,
    String(parts.timestamp),
    parts.nonce,
    parts.bodyHash
  ].join("\n");
}

export function sha256Base64Url(data: string | Uint8Array): string {
  return toBase64Url(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

export function bodyHashForJson(value: unknown): string {
  return sha256Base64Url(stableJson(value));
}

export function clipAadHash(aad: ClipAad): string {
  return sha256Base64Url(stableJson(aad));
}

export function aadForClip(accountId: string, routingId: string, clip: EncryptedClip): ClipAad {
  return {
    accountId,
    routingId,
    clipId: clip.clipId,
    originDeviceId: clip.originDeviceId,
    createdAt: clip.createdAt,
    payloadKind: clip.payloadKind,
    mime: clip.mime,
    byteLen: clip.byteLen,
    keyVersion: clip.keyVersion
  };
}

export function assertBase64Url(value: string, label: string): void {
  try {
    fromBase64Url(value);
  } catch {
    throw new Error(`${label} must be base64url`);
  }
}

export function clampHistoryLimit(value: string | null): number {
  if (!value) return DEFAULT_HISTORY_LIMIT;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_HISTORY_LIMIT;
  return Math.min(parsed, MAX_HISTORY_LIMIT);
}
