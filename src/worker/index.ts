import { ClipboardSpace, type Actor, type Env } from "./clipboard-space";
import {
  REQUEST_NONCE_TTL_MS,
  REQUEST_TOLERANCE_MS,
  SIGNATURE_HEADERS,
  aadForClip,
  assertBase64Url,
  clampHistoryLimit,
  JOIN_GRANT_DEVICE_TTL_MAX_MS,
  JOIN_GRANT_MAX_USES,
  JOIN_GRANT_TOKEN_TTL_MAX_MS,
  LARGE_PAYLOAD_MAX_BYTES,
  MAX_OPEN_PAIRING_SESSIONS,
  sha256Base64Url,
  TEXT_INLINE_LIMIT_BYTES,
  type BootstrapRequest,
  type DeviceRecord,
  type EncryptedClip,
  type PairingApproveRequest,
  type PairingConsumeRequest,
  type PairingGrantCreateRequest,
  type PairingGrantRedeemRequest,
  type PairingOpenRequest,
  type ResetRequest
} from "../shared/protocol";
import { bytesToUtf8, fromBase64Url, randomBase64Url, stableJson, toBase64Url, utf8ToBytes } from "../shared/encoding";
import { hashJoinGrantRedeemSecret, verifyCanonicalRequest } from "../shared/crypto";

export { ClipboardSpace };

interface DeviceRow {
  account_id: string;
  device_id: string;
  device_name: string;
  verify_public_key: string;
  wrap_public_key: string;
  status: "active" | "revoked";
  created_at: number;
  last_seen_at: number | null;
  revoked_at: number | null;
  device_expires_at: number | null;
  routing_id: string;
}

interface AccountRow {
  account_id: string;
  routing_id: string;
  created_at: number;
  reset_at: number | null;
}

interface AuthContext extends Actor {
  device: DeviceRow;
  bodyText: string;
  bodyBytes: Uint8Array;
  url: URL;
}

interface RequestBody {
  text: string;
  bytes: Uint8Array;
}

const LAST_SEEN_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const NONCE_CLEANUP_INTERVAL_MS = 60 * 1000;
let nextNonceCleanupAt = 0;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_error";
      return json({ error: "internal_error", message }, 500);
    }
  }
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const body = await readRequestBody(request);
  const bodyText = body.text;

  if (request.method === "POST" && url.pathname === "/v1/accounts/bootstrap") {
    return bootstrap(env, parseJson<BootstrapRequest>(bodyText));
  }
  if (request.method === "POST" && url.pathname === "/v1/pairing/open") {
    return pairingOpen(env, parseJson<PairingOpenRequest>(bodyText));
  }
  if (request.method === "POST" && url.pathname === "/v1/pairing/consume") {
    return pairingConsume(env, parseJson<PairingConsumeRequest>(bodyText));
  }
  if (request.method === "POST" && url.pathname === "/v1/pairing/grants/redeem") {
    return pairingGrantRedeem(env, parseJson<PairingGrantRedeemRequest>(bodyText));
  }

  const auth = await authenticate(request, env, url, body);
  if (auth instanceof Response) return auth;

  if (request.method === "POST" && url.pathname === "/v1/clips") {
    return publishClip(env, auth, parseJson<EncryptedClip>(bodyText));
  }
  if (request.method === "POST" && url.pathname === "/v1/files") {
    return publishFile(env, auth, parseJson<EncryptedClip>(bodyText));
  }
  if (request.method === "POST" && url.pathname === "/v2/files") {
    return publishFileV2(env, auth, parseFileEnvelope(request), body.bytes);
  }
  const fileContentMatch = url.pathname.match(/^\/v2\/files\/([^/]+)\/content$/u);
  if (request.method === "GET" && fileContentMatch?.[1]) {
    return getFileV2(env, auth, decodeURIComponent(fileContentMatch[1]));
  }
  const fileMatch = url.pathname.match(/^\/v1\/files\/([^/]+)$/u);
  if (request.method === "GET" && fileMatch?.[1]) {
    return getFile(env, auth, decodeURIComponent(fileMatch[1]));
  }
  if (request.method === "GET" && url.pathname === "/v1/clips/latest") {
    const latest = await space(env, auth).getLatest(actorOf(auth));
    return json({ clip: latest });
  }
  if (request.method === "GET" && url.pathname === "/v1/clips/history") {
    const limit = clampHistoryLimit(url.searchParams.get("limit"));
    const beforeClipId = url.searchParams.get("before");
    const history = await space(env, auth).listHistory(actorOf(auth), limit, beforeClipId);
    return json({ clips: history });
  }
  const seqMatch = url.pathname.match(/^\/v1\/clips\/by-seq\/([1-9][0-9]*)$/u);
  if (request.method === "GET" && seqMatch?.[1]) {
    const clip = await space(env, auth).getClipBySeq(actorOf(auth), Number.parseInt(seqMatch[1], 10));
    return clip ? json({ clip }) : json({ error: "not_found" }, 404);
  }
  const clipMatch = url.pathname.match(/^\/v1\/clips\/([^/]+)$/u);
  if (request.method === "DELETE" && clipMatch?.[1]) {
    const clipId = decodeURIComponent(clipMatch[1]);
    const result = await space(env, auth).deleteHistoryClip(actorOf(auth), clipId);
    return json({ clipId, ...result });
  }
  if (request.method === "GET" && clipMatch?.[1]) {
    const clip = await space(env, auth).getClip(actorOf(auth), decodeURIComponent(clipMatch[1]));
    return clip ? json({ clip }) : json({ error: "not_found" }, 404);
  }
  if (request.method === "GET" && url.pathname === "/v1/devices") {
    const includeRevoked = parseBooleanQuery(url.searchParams.get("includeRevoked"));
    const devices = await env.DB.prepare(
      `SELECT account_id AS accountId, device_id AS deviceId, device_name AS deviceName,
              verify_public_key AS verifyPublicKey, wrap_public_key AS wrapPublicKey,
              status, created_at AS createdAt, last_seen_at AS lastSeenAt, revoked_at AS revokedAt,
              device_expires_at AS deviceExpiresAt
       FROM devices
       WHERE account_id = ? AND (? = 1 OR status = 'active')
       ORDER BY created_at ASC`
    )
      .bind(auth.accountId, includeRevoked ? 1 : 0)
      .all<DeviceRecord>();
    return json({ devices: devices.results.map(deviceFromD1) });
  }
  if (request.method === "POST" && url.pathname === "/v1/pairing/grants") {
    return pairingGrantCreate(env, auth, parseJson<PairingGrantCreateRequest>(bodyText));
  }
  const grantRevokeMatch = url.pathname.match(/^\/v1\/pairing\/grants\/([^/]+)\/revoke$/u);
  if (request.method === "POST" && grantRevokeMatch?.[1]) {
    return pairingGrantRevoke(env, auth, decodeURIComponent(grantRevokeMatch[1]));
  }
  const revokeMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/revoke$/u);
  if (request.method === "POST" && revokeMatch?.[1]) {
    return revokeDevice(env, auth, decodeURIComponent(revokeMatch[1]));
  }
  if (request.method === "GET" && url.pathname === "/v1/pairing/pending") {
    return pairingPending(env, auth, url.searchParams.get("shortCodeHash"));
  }
  if (request.method === "POST" && url.pathname === "/v1/pairing/approve") {
    return pairingApprove(env, auth, parseJson<PairingApproveRequest>(bodyText));
  }
  if (request.method === "POST" && url.pathname === "/v1/reset") {
    return resetSpace(env, auth, parseJson<ResetRequest>(bodyText));
  }
  return json({ error: "not_found" }, 404);
}

async function readRequestBody(request: Request): Promise<RequestBody> {
  if (request.method === "GET" || request.method === "HEAD") {
    return { text: "", bytes: new Uint8Array() };
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  const isBinaryFileUpload = request.method === "POST" && new URL(request.url).pathname === "/v2/files";
  return {
    text: isBinaryFileUpload ? "" : bytesToUtf8(bytes),
    bytes
  };
}

async function bootstrap(env: Env, body: BootstrapRequest): Promise<Response> {
  requireString(body.accountId, "accountId");
  requireString(body.routingId, "routingId");
  requireString(body.deviceId, "deviceId");
  requireString(body.deviceName, "deviceName");
  assertBase64Url(body.verifyPublicKey, "verifyPublicKey");
  assertBase64Url(body.wrapPublicKey, "wrapPublicKey");
  const now = body.createdAt ?? Date.now();
  await env.DB.prepare("INSERT INTO accounts(account_id, routing_id, created_at) VALUES (?, ?, ?)")
    .bind(body.accountId, body.routingId, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO devices(
      account_id, device_id, device_name, verify_public_key, wrap_public_key, status, created_at, last_seen_at, device_expires_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL)`
  )
    .bind(body.accountId, body.deviceId, body.deviceName, body.verifyPublicKey, body.wrapPublicKey, now, now)
    .run();
  await env.CLIPBOARD.getByName(body.routingId).initSpace();
  return json({ accountId: body.accountId, routingId: body.routingId, deviceId: body.deviceId, createdAt: now }, 201);
}

async function publishClip(env: Env, auth: AuthContext, clip: EncryptedClip): Promise<Response> {
  validateClip(auth, clip);
  const stored = await space(env, auth).publishClip(actorOf(auth), clip);
  return json({ clip: stored }, 201);
}

async function publishFile(env: Env, auth: AuthContext, clip: EncryptedClip): Promise<Response> {
  validateFileClip(auth, clip);
  const encryptedBytes = fromBase64Url(clip.ciphertext);
  const actor = actorOf(auth);
  const stored = await space(env, auth).publishR2Clip(actor, { ...clip, ciphertext: "" }, `payload_${randomBase64Url(12)}`);
  if (!stored.r2Key) throw new Error("missing R2 key");
  try {
    await env.BLOBS.put(stored.r2Key, encryptedBytes, {
      httpMetadata: {
        contentType: "application/octet-stream"
      },
      customMetadata: {
        clipId: stored.clipId,
        payloadKind: stored.payloadKind,
        mime: stored.mime
      }
    });
  } catch (error) {
    await space(env, auth).deleteClip(actor, stored.clipId);
    throw error;
  }
  if (stored.expiresAt !== null) {
    await space(env, auth).scheduleRetention();
  }
  return json({ clip: stored }, 201);
}

async function publishFileV2(env: Env, auth: AuthContext, clip: EncryptedClip, encryptedBytes: Uint8Array): Promise<Response> {
  validateFileClipEnvelope(auth, clip);
  if (encryptedBytes.length === 0) return json({ error: "empty_file_body" }, 400);
  if (encryptedBytes.length > LARGE_PAYLOAD_MAX_BYTES + 16) return json({ error: "file_payload_too_large" }, 413);
  if (encryptedBytes.length !== clip.byteLen + 16) return json({ error: "file_payload_size_mismatch" }, 400);
  const actor = actorOf(auth);
  const stored = await space(env, auth).publishR2Clip(actor, { ...clip, ciphertext: "" }, `payload_${randomBase64Url(12)}`);
  if (!stored.r2Key) throw new Error("missing R2 key");
  try {
    await env.BLOBS.put(stored.r2Key, encryptedBytes, {
      httpMetadata: {
        contentType: "application/octet-stream"
      },
      customMetadata: {
        clipId: stored.clipId,
        payloadKind: stored.payloadKind,
        mime: stored.mime,
        transport: "v2-raw"
      }
    });
  } catch (error) {
    await space(env, auth).deleteClip(actor, stored.clipId);
    throw error;
  }
  if (stored.expiresAt !== null) {
    await space(env, auth).scheduleRetention();
  }
  return json({ clip: stored }, 201);
}

async function getFileV2(env: Env, auth: AuthContext, clipId: string): Promise<Response> {
  const clip = await space(env, auth).getClip(actorOf(auth), clipId);
  if (!clip || !clip.r2Key) return json({ error: "not_found" }, 404);
  const object = await env.BLOBS.get(clip.r2Key);
  if (!object) return json({ error: "blob_missing" }, 404);
  return new Response(object.body, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/octet-stream",
      "pasta-file-envelope": toBase64Url(utf8ToBytes(stableJson(clip)))
    }
  });
}

async function getFile(env: Env, auth: AuthContext, clipId: string): Promise<Response> {
  const clip = await space(env, auth).getClip(actorOf(auth), clipId);
  if (!clip || !clip.r2Key) return json({ error: "not_found" }, 404);
  const object = await env.BLOBS.get(clip.r2Key);
  if (!object) return json({ error: "blob_missing" }, 404);
  const ciphertext = toBase64Url(new Uint8Array(await object.arrayBuffer()));
  return json({ clip, ciphertext });
}

async function pairingOpen(env: Env, body: PairingOpenRequest): Promise<Response> {
  requireString(body.sessionId, "sessionId");
  requireString(body.accountId, "accountId");
  requireString(body.shortCodeHash, "shortCodeHash");
  requireString(body.newDeviceId, "newDeviceId");
  requireString(body.newDeviceName, "newDeviceName");
  assertBase64Url(body.verifyPublicKey, "verifyPublicKey");
  assertBase64Url(body.wrapPublicKey, "wrapPublicKey");
  const account = await getAccount(env, body.accountId);
  if (!account) return json({ error: "unknown_account" }, 404);
  const now = Date.now();
  if (body.expiresAt <= now) return json({ error: "expired_pairing" }, 400);
  const openSessions = await env.DB.prepare(
    `SELECT COUNT(*) AS open_count
     FROM pairing_sessions
     WHERE account_id = ? AND consumed_at IS NULL AND expires_at > ?`
  )
    .bind(body.accountId, now)
    .first<{ open_count: number }>();
  if ((openSessions?.open_count ?? 0) >= MAX_OPEN_PAIRING_SESSIONS) {
    return json({ error: "pairing_rate_limited", limit: MAX_OPEN_PAIRING_SESSIONS }, 429);
  }
  await env.DB.prepare(
    `INSERT INTO pairing_sessions(
      session_id, account_id, short_code_hash, new_device_id, new_device_name,
      new_device_pubkeys_json, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      body.sessionId,
      body.accountId,
      body.shortCodeHash,
      body.newDeviceId,
      body.newDeviceName,
      stableJson({ verifyPublicKey: body.verifyPublicKey, wrapPublicKey: body.wrapPublicKey }),
      body.expiresAt
    )
    .run();
  return json({ sessionId: body.sessionId, accountId: body.accountId, routingId: account.routing_id, expiresAt: body.expiresAt }, 201);
}

async function pairingPending(env: Env, auth: AuthContext, shortCodeHash: string | null): Promise<Response> {
  if (!shortCodeHash) return json({ error: "missing_short_code_hash" }, 400);
  const session = await env.DB.prepare(
    `SELECT session_id, account_id, short_code_hash, new_device_id, new_device_name,
            new_device_pubkeys_json, expires_at, approved_at, consumed_at
     FROM pairing_sessions
     WHERE account_id = ? AND short_code_hash = ? LIMIT 1`
  )
    .bind(auth.accountId, shortCodeHash)
    .first<Record<string, unknown>>();
  if (!session) return json({ error: "not_found" }, 404);
  return json({ session });
}

async function pairingApprove(env: Env, auth: AuthContext, body: PairingApproveRequest): Promise<Response> {
  requireString(body.shortCodeHash, "shortCodeHash");
  requireString(body.wrappedGroupKey, "wrappedGroupKey");
  const session = await env.DB.prepare(
    `SELECT * FROM pairing_sessions
     WHERE account_id = ? AND short_code_hash = ? AND consumed_at IS NULL LIMIT 1`
  )
    .bind(auth.accountId, body.shortCodeHash)
    .first<Record<string, string | number | null>>();
  if (!session) return json({ error: "not_found" }, 404);
  if (Number(session.expires_at) <= Date.now()) return json({ error: "expired_pairing" }, 410);
  const pubkeys = JSON.parse(String(session.new_device_pubkeys_json)) as { verifyPublicKey: string; wrapPublicKey: string };
  const now = Date.now();
  const existingDevice = await env.DB.prepare("SELECT 1 FROM devices WHERE account_id = ? AND device_id = ? LIMIT 1")
    .bind(auth.accountId, session.new_device_id)
    .first();
  if (existingDevice) return json({ error: "device_exists" }, 409);
  await env.DB.prepare(
    `INSERT INTO devices(
      account_id, device_id, device_name, verify_public_key, wrap_public_key, status, created_at, device_expires_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, NULL)`
  )
    .bind(auth.accountId, session.new_device_id, session.new_device_name, pubkeys.verifyPublicKey, pubkeys.wrapPublicKey, now)
    .run();
  await env.DB.prepare(
    `UPDATE pairing_sessions
     SET wrapped_group_key = ?, key_version = ?, approved_at = ?, approver_device_id = ?
     WHERE session_id = ?`
  )
    .bind(body.wrappedGroupKey, body.keyVersion, now, auth.deviceId, session.session_id)
    .run();
  await space(env, auth).storeWrappedKey(actorOf(auth), {
    deviceId: String(session.new_device_id),
    keyVersion: body.keyVersion,
    wrappedGroupKey: body.wrappedGroupKey,
    createdAt: now
  });
  return json({ deviceId: session.new_device_id, approvedAt: now });
}

async function pairingConsume(env: Env, body: PairingConsumeRequest): Promise<Response> {
  requireString(body.sessionId, "sessionId");
  requireString(body.shortCodeHash, "shortCodeHash");
  const session = await env.DB.prepare(
    `SELECT p.*, a.routing_id FROM pairing_sessions p
     JOIN accounts a ON a.account_id = p.account_id
     WHERE p.session_id = ? AND p.short_code_hash = ? LIMIT 1`
  )
    .bind(body.sessionId, body.shortCodeHash)
    .first<Record<string, string | number | null>>();
  if (!session) return json({ error: "not_found" }, 404);
  if (session.consumed_at !== null) return json({ error: "pairing_consumed" }, 409);
  if (session.approved_at === null || session.wrapped_group_key === null) return json({ error: "pairing_not_approved" }, 409);
  if (Number(session.expires_at) <= Date.now()) return json({ error: "expired_pairing" }, 410);
  const now = Date.now();
  await env.DB.prepare("UPDATE pairing_sessions SET consumed_at = ? WHERE session_id = ?").bind(now, body.sessionId).run();
  return json({
    accountId: session.account_id,
    routingId: session.routing_id,
    deviceId: session.new_device_id,
    wrappedGroupKey: session.wrapped_group_key,
    keyVersion: session.key_version,
    consumedAt: now
  });
}

async function pairingGrantCreate(env: Env, auth: AuthContext, body: PairingGrantCreateRequest): Promise<Response> {
  requireString(body.grantId, "grantId");
  requireString(body.redeemSecretHash, "redeemSecretHash");
  requireString(body.sealedGroupKey, "sealedGroupKey");
  if (body.label !== undefined && typeof body.label !== "string") throw new Error("label must be string");
  assertBase64Url(body.redeemSecretHash, "redeemSecretHash");
  if (!Number.isSafeInteger(body.keyVersion) || body.keyVersion < 1) return json({ error: "bad_key_version" }, 400);
  const boundsError = validateJoinGrantBounds(body.tokenExpiresAt, body.deviceTtlMs, body.maxUses);
  if (boundsError) return json({ error: boundsError }, 400);
  const now = Date.now();
  if (body.tokenExpiresAt <= now) return json({ error: "expired_grant" }, 400);
  await env.DB.prepare(
    `INSERT INTO pairing_grants(
      grant_id, account_id, label, redeem_secret_hash, sealed_group_key, key_version,
      token_expires_at, device_ttl_ms, max_uses, use_count, created_by_device_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(
      body.grantId,
      auth.accountId,
      body.label ?? null,
      body.redeemSecretHash,
      body.sealedGroupKey,
      body.keyVersion,
      body.tokenExpiresAt,
      body.deviceTtlMs,
      body.maxUses,
      auth.deviceId,
      now
    )
    .run();
  return json({
    grantId: body.grantId,
    tokenExpiresAt: body.tokenExpiresAt,
    deviceTtlMs: body.deviceTtlMs,
    maxUses: body.maxUses,
    createdAt: now
  }, 201);
}

async function pairingGrantRedeem(env: Env, body: PairingGrantRedeemRequest): Promise<Response> {
  requireString(body.grantId, "grantId");
  requireString(body.redeemSecret, "redeemSecret");
  requireString(body.newDeviceId, "newDeviceId");
  requireString(body.newDeviceName, "newDeviceName");
  assertBase64Url(body.redeemSecret, "redeemSecret");
  assertBase64Url(body.verifyPublicKey, "verifyPublicKey");
  assertBase64Url(body.wrapPublicKey, "wrapPublicKey");
  const grant = await env.DB.prepare(
    `SELECT g.*, a.routing_id FROM pairing_grants g
     JOIN accounts a ON a.account_id = g.account_id
     WHERE g.grant_id = ? LIMIT 1`
  )
    .bind(body.grantId)
    .first<Record<string, string | number | null>>();
  if (!grant) return json({ error: "not_found" }, 404);
  const now = Date.now();
  if (grant.revoked_at !== null) return json({ error: "grant_revoked" }, 403);
  if (Number(grant.token_expires_at) <= now) return json({ error: "expired_grant" }, 410);
  if (Number(grant.use_count) >= Number(grant.max_uses)) return json({ error: "grant_consumed" }, 409);
  const expectedHash = String(grant.redeem_secret_hash);
  const actualHash = hashJoinGrantRedeemSecret(String(grant.account_id), body.grantId, body.redeemSecret);
  if (!constantTimeEqual(expectedHash, actualHash)) return json({ error: "bad_grant" }, 401);
  const existingDevice = await env.DB.prepare("SELECT 1 FROM devices WHERE account_id = ? AND device_id = ? LIMIT 1")
    .bind(grant.account_id, body.newDeviceId)
    .first();
  if (existingDevice) return json({ error: "device_exists" }, 409);

  const deviceTtl = grant.device_ttl_ms === null ? null : Number(grant.device_ttl_ms);
  const deviceExpiresAt = deviceTtl === null ? null : now + deviceTtl;
  const updated = await env.DB.prepare(
    `UPDATE pairing_grants
     SET use_count = use_count + 1, last_redeemed_at = ?
     WHERE grant_id = ? AND revoked_at IS NULL AND token_expires_at > ? AND use_count < max_uses`
  )
    .bind(now, body.grantId, now)
    .run();
  if ((updated.meta?.changes ?? 0) === 0) return json({ error: "grant_consumed" }, 409);

  await env.DB.prepare(
    `INSERT INTO devices(
      account_id, device_id, device_name, verify_public_key, wrap_public_key,
      status, created_at, last_seen_at, revoked_at, device_expires_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?)`
  )
    .bind(grant.account_id, body.newDeviceId, body.newDeviceName, body.verifyPublicKey, body.wrapPublicKey, now, deviceExpiresAt)
    .run();

  return json({
    accountId: grant.account_id,
    routingId: grant.routing_id,
    deviceId: body.newDeviceId,
    sealedGroupKey: grant.sealed_group_key,
    keyVersion: grant.key_version,
    tokenExpiresAt: grant.token_expires_at,
    deviceTtlMs: grant.device_ttl_ms,
    deviceExpiresAt,
    maxUses: grant.max_uses,
    redeemedAt: now
  });
}

async function pairingGrantRevoke(env: Env, auth: AuthContext, grantId: string): Promise<Response> {
  const now = Date.now();
  await env.DB.prepare("UPDATE pairing_grants SET revoked_at = ? WHERE account_id = ? AND grant_id = ? AND revoked_at IS NULL")
    .bind(now, auth.accountId, grantId)
    .run();
  return json({ grantId, revokedAt: now });
}

async function revokeDevice(env: Env, auth: AuthContext, deviceId: string): Promise<Response> {
  const now = Date.now();
  await env.DB.prepare("UPDATE devices SET status = 'revoked', revoked_at = ? WHERE account_id = ? AND device_id = ?")
    .bind(now, auth.accountId, deviceId)
    .run();
  await space(env, auth).revokeDevice(actorOf(auth), deviceId, now);
  return json({ deviceId, revokedAt: now });
}

async function resetSpace(env: Env, auth: AuthContext, body: ResetRequest): Promise<Response> {
  if (body.confirm !== "RESET") return json({ error: "reset_confirmation_required" }, 400);
  requireString(body.newRoutingId, "newRoutingId");
  const now = Date.now();
  await env.DB.prepare("UPDATE accounts SET routing_id = ?, reset_at = ? WHERE account_id = ?")
    .bind(body.newRoutingId, now, auth.accountId)
    .run();
  await env.CLIPBOARD.getByName(body.newRoutingId).initSpace();
  return json({ accountId: auth.accountId, routingId: body.newRoutingId, resetAt: now });
}

async function authenticate(request: Request, env: Env, url: URL, body: RequestBody): Promise<AuthContext | Response> {
  const accountId = request.headers.get(SIGNATURE_HEADERS.accountId);
  const deviceId = request.headers.get(SIGNATURE_HEADERS.deviceId);
  const timestampText = request.headers.get(SIGNATURE_HEADERS.timestamp);
  const nonce = request.headers.get(SIGNATURE_HEADERS.nonce);
  const bodyHash = request.headers.get(SIGNATURE_HEADERS.bodyHash);
  const signature = request.headers.get(SIGNATURE_HEADERS.signature);
  if (!accountId || !deviceId || !timestampText || !nonce || !bodyHash || !signature) {
    return json({ error: "missing_signature_headers" }, 401);
  }
  const timestamp = Number.parseInt(timestampText, 10);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > REQUEST_TOLERANCE_MS) {
    return json({ error: "stale_request" }, 401);
  }
  const actualBodyHash = sha256Base64Url(body.bytes);
  if (actualBodyHash !== bodyHash) {
    return json({ error: "bad_body_hash" }, 401);
  }
  const device = await env.DB.prepare(
    `SELECT d.*, a.routing_id FROM devices d
     JOIN accounts a ON a.account_id = d.account_id
     WHERE d.account_id = ? AND d.device_id = ? LIMIT 1`
  )
    .bind(accountId, deviceId)
    .first<DeviceRow>();
  if (!device) return json({ error: "unknown_device" }, 401);
  if (device.status !== "active") return json({ error: "revoked_device" }, 403);
  const ok = verifyCanonicalRequest(
    {
      method: request.method,
      pathWithQuery: `${url.pathname}${url.search}`,
      timestamp,
      nonce,
      bodyHash
    },
    signature,
    device.verify_public_key
  );
  if (!ok) return json({ error: "bad_signature" }, 401);
  const replay = await rememberNonce(env, accountId, deviceId, nonce);
  if (!replay) return json({ error: "replayed_nonce" }, 409);
  const now = Date.now();
  if (device.device_expires_at !== null && Number(device.device_expires_at) <= now) {
    await env.DB.prepare("UPDATE devices SET status = 'revoked', revoked_at = ? WHERE account_id = ? AND device_id = ?")
      .bind(now, accountId, deviceId)
      .run();
    await env.CLIPBOARD.getByName(device.routing_id).revokeDevice({ accountId, deviceId, routingId: device.routing_id }, deviceId, now);
    return json({ error: "expired_device" }, 403);
  }
  if (shouldUpdateLastSeen(device.last_seen_at, now)) {
    await env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE account_id = ? AND device_id = ?")
      .bind(now, accountId, deviceId)
      .run();
  }
  return {
    accountId,
    deviceId,
    routingId: device.routing_id,
    device,
    bodyText: body.text,
    bodyBytes: body.bytes,
    url
  };
}

async function rememberNonce(env: Env, accountId: string, deviceId: string, nonce: string): Promise<boolean> {
  const now = Date.now();
  if (now >= nextNonceCleanupAt) {
    nextNonceCleanupAt = now + NONCE_CLEANUP_INTERVAL_MS;
    await env.DB.prepare("DELETE FROM request_nonces WHERE expires_at <= ?").bind(now).run();
  }
  try {
    await env.DB.prepare("INSERT INTO request_nonces(account_id, device_id, nonce, expires_at) VALUES (?, ?, ?, ?)")
      .bind(accountId, deviceId, nonce, now + REQUEST_NONCE_TTL_MS)
      .run();
    return true;
  } catch {
    return false;
  }
}

function shouldUpdateLastSeen(lastSeenAt: number | null, now: number): boolean {
  return lastSeenAt === null || now - Number(lastSeenAt) >= LAST_SEEN_UPDATE_INTERVAL_MS;
}

function validateClip(auth: AuthContext, clip: EncryptedClip): void {
  requireString(clip.clipId, "clipId");
  requireClipId(clip.clipId);
  requireString(clip.originDeviceId, "originDeviceId");
  requireString(clip.mime, "mime");
  requireString(clip.nonce, "nonce");
  requireString(clip.aadHash, "aadHash");
  requireString(clip.ciphertext, "ciphertext");
  validateClipMetadata(clip);
  if (clip.originDeviceId !== auth.deviceId) throw new Error("origin device mismatch");
  if (clip.payloadKind !== "text" && clip.payloadKind !== "image") throw new Error("unsupported payload kind");
  if (clip.payloadKind === "text" && clip.mime !== "text/plain; charset=utf-8") throw new Error("bad text MIME");
  if (clip.payloadKind === "image" && !clip.mime.startsWith("image/")) throw new Error("bad image MIME");
  if (clip.byteLen < 0 || clip.byteLen > TEXT_INLINE_LIMIT_BYTES) throw new Error("clip too large for inline payload");
  const aad = aadForClip(auth.accountId, auth.routingId, clip);
  if (clip.aadHash !== sha256Base64Url(stableJson(aad))) throw new Error("bad AAD hash");
}

function validateFileClip(auth: AuthContext, clip: EncryptedClip): void {
  requireString(clip.clipId, "clipId");
  requireClipId(clip.clipId);
  requireString(clip.originDeviceId, "originDeviceId");
  requireString(clip.mime, "mime");
  requireString(clip.nonce, "nonce");
  requireString(clip.aadHash, "aadHash");
  requireString(clip.ciphertext, "ciphertext");
  validateClipMetadata(clip);
  if (clip.originDeviceId !== auth.deviceId) throw new Error("origin device mismatch");
  if (clip.payloadKind !== "file" && clip.payloadKind !== "image") throw new Error("unsupported payload kind");
  if (clip.payloadKind === "image" && !clip.mime.startsWith("image/")) throw new Error("bad image MIME");
  if (clip.byteLen < 0 || clip.byteLen > LARGE_PAYLOAD_MAX_BYTES) throw new Error("file payload too large");
  const aad = aadForClip(auth.accountId, auth.routingId, clip);
  if (clip.aadHash !== sha256Base64Url(stableJson(aad))) throw new Error("bad AAD hash");
}

function validateFileClipEnvelope(auth: AuthContext, clip: EncryptedClip): void {
  requireString(clip.clipId, "clipId");
  requireClipId(clip.clipId);
  requireString(clip.originDeviceId, "originDeviceId");
  requireString(clip.mime, "mime");
  requireString(clip.nonce, "nonce");
  requireString(clip.aadHash, "aadHash");
  validateClipMetadata(clip);
  if (clip.ciphertext !== "") throw new Error("file envelope must not include ciphertext");
  if (clip.originDeviceId !== auth.deviceId) throw new Error("origin device mismatch");
  if (clip.payloadKind !== "file" && clip.payloadKind !== "image") throw new Error("unsupported payload kind");
  if (clip.payloadKind === "image" && !clip.mime.startsWith("image/")) throw new Error("bad image MIME");
  if (clip.byteLen < 0 || clip.byteLen > LARGE_PAYLOAD_MAX_BYTES) throw new Error("file payload too large");
  const aad = aadForClip(auth.accountId, auth.routingId, clip);
  if (clip.aadHash !== sha256Base64Url(stableJson(aad))) throw new Error("bad AAD hash");
}

function space(env: Env, auth: Actor): DurableObjectStub<ClipboardSpace> {
  return env.CLIPBOARD.getByName(auth.routingId);
}

function validateClipMetadata(clip: EncryptedClip): void {
  if (!clip.metadata) return;
  requireString(clip.metadata.nonce, "metadata.nonce");
  requireString(clip.metadata.ciphertext, "metadata.ciphertext");
  assertBase64Url(clip.metadata.nonce, "metadata.nonce");
  assertBase64Url(clip.metadata.ciphertext, "metadata.ciphertext");
}

function actorOf(auth: AuthContext): Actor {
  return {
    accountId: auth.accountId,
    deviceId: auth.deviceId,
    routingId: auth.routingId
  };
}

async function getAccount(env: Env, accountId: string): Promise<AccountRow | null> {
  return await env.DB.prepare("SELECT * FROM accounts WHERE account_id = ? LIMIT 1").bind(accountId).first<AccountRow>();
}

function parseFileEnvelope(request: Request): EncryptedClip {
  const encoded = request.headers.get("pasta-file-envelope");
  if (!encoded) throw new Error("pasta-file-envelope is required");
  return JSON.parse(bytesToUtf8(fromBase64Url(encoded))) as EncryptedClip;
}

function parseJson<T>(bodyText: string): T {
  if (!bodyText) return {} as T;
  return JSON.parse(bodyText) as T;
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
}

function requireClipId(value: string): void {
  if (!/^clip_[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error("clipId must be clip_ base64url");
  }
}

function validateJoinGrantBounds(tokenExpiresAt: number, deviceTtlMs: number | null, maxUses: number): string | null {
  const now = Date.now();
  if (!Number.isSafeInteger(tokenExpiresAt)) return "bad_token_expiry";
  if (tokenExpiresAt - now > JOIN_GRANT_TOKEN_TTL_MAX_MS) return "token_ttl_too_long";
  if (deviceTtlMs !== null && (!Number.isSafeInteger(deviceTtlMs) || deviceTtlMs <= 0 || deviceTtlMs > JOIN_GRANT_DEVICE_TTL_MAX_MS)) {
    return "bad_device_ttl";
  }
  if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > JOIN_GRANT_MAX_USES) {
    return "bad_max_uses";
  }
  return null;
}

function parseBooleanQuery(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function deviceFromD1(row: DeviceRecord): DeviceRecord {
  return {
    accountId: row.accountId,
    deviceId: row.deviceId,
    deviceName: row.deviceName,
    verifyPublicKey: row.verifyPublicKey,
    wrapPublicKey: row.wrapPublicKey,
    status: row.status,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    deviceExpiresAt: row.deviceExpiresAt ?? null
  };
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}
