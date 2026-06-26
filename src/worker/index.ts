import { ClipboardSpace, type Actor, type Env } from "./clipboard-space";
import {
  REQUEST_NONCE_TTL_MS,
  REQUEST_TOLERANCE_MS,
  SIGNATURE_HEADERS,
  aadForClip,
  assertBase64Url,
  clampHistoryLimit,
  sha256Base64Url,
  TEXT_INLINE_LIMIT_BYTES,
  type BootstrapRequest,
  type DeviceRecord,
  type EncryptedClip,
  type PairingApproveRequest,
  type PairingConsumeRequest,
  type PairingOpenRequest,
  type ResetRequest
} from "../shared/protocol";
import { stableJson } from "../shared/encoding";
import { verifyCanonicalRequest } from "../shared/crypto";

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
  url: URL;
}

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
  const bodyText = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();

  if (request.method === "POST" && url.pathname === "/v1/accounts/bootstrap") {
    return bootstrap(env, parseJson<BootstrapRequest>(bodyText));
  }
  if (request.method === "POST" && url.pathname === "/v1/pairing/open") {
    return pairingOpen(env, parseJson<PairingOpenRequest>(bodyText));
  }
  if (request.method === "POST" && url.pathname === "/v1/pairing/consume") {
    return pairingConsume(env, parseJson<PairingConsumeRequest>(bodyText));
  }

  const auth = await authenticate(request, env, url, bodyText);
  if (auth instanceof Response) return auth;

  if (request.method === "POST" && url.pathname === "/v1/clips") {
    return publishClip(env, auth, parseJson<EncryptedClip>(bodyText));
  }
  if (request.method === "GET" && url.pathname === "/v1/clips/latest") {
    const latest = await space(env, auth).getLatest(actorOf(auth));
    return json({ clip: latest });
  }
  if (request.method === "GET" && url.pathname === "/v1/clips/history") {
    const limit = clampHistoryLimit(url.searchParams.get("limit"));
    const before = url.searchParams.get("before");
    const beforeSeq = before ? Number.parseInt(before, 10) : null;
    const history = await space(env, auth).listHistory(actorOf(auth), limit, Number.isSafeInteger(beforeSeq) ? beforeSeq : null);
    return json({ clips: history });
  }
  const clipMatch = url.pathname.match(/^\/v1\/clips\/(\d+)$/u);
  if (request.method === "GET" && clipMatch?.[1]) {
    const clip = await space(env, auth).getClip(actorOf(auth), Number.parseInt(clipMatch[1], 10));
    return clip ? json({ clip }) : json({ error: "not_found" }, 404);
  }
  if (request.method === "GET" && url.pathname === "/v1/devices") {
    const devices = await env.DB.prepare(
      `SELECT account_id AS accountId, device_id AS deviceId, device_name AS deviceName,
              verify_public_key AS verifyPublicKey, wrap_public_key AS wrapPublicKey,
              status, created_at AS createdAt, last_seen_at AS lastSeenAt, revoked_at AS revokedAt
       FROM devices WHERE account_id = ? ORDER BY created_at ASC`
    )
      .bind(auth.accountId)
      .all<DeviceRecord>();
    return json({ devices: devices.results.map(deviceFromD1) });
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
      account_id, device_id, device_name, verify_public_key, wrap_public_key, status, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
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
  if (body.expiresAt <= Date.now()) return json({ error: "expired_pairing" }, 400);
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
  await env.DB.prepare(
    `INSERT INTO devices(
      account_id, device_id, device_name, verify_public_key, wrap_public_key, status, created_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?)
    ON CONFLICT(account_id, device_id) DO UPDATE SET
      device_name = excluded.device_name,
      verify_public_key = excluded.verify_public_key,
      wrap_public_key = excluded.wrap_public_key,
      status = 'active',
      revoked_at = NULL`
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

async function authenticate(request: Request, env: Env, url: URL, bodyText: string): Promise<AuthContext | Response> {
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
  const actualBodyHash = sha256Base64Url(bodyText);
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
  await env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE account_id = ? AND device_id = ?")
    .bind(Date.now(), accountId, deviceId)
    .run();
  return {
    accountId,
    deviceId,
    routingId: device.routing_id,
    device,
    bodyText,
    url
  };
}

async function rememberNonce(env: Env, accountId: string, deviceId: string, nonce: string): Promise<boolean> {
  await env.DB.prepare("DELETE FROM request_nonces WHERE expires_at <= ?").bind(Date.now()).run();
  try {
    await env.DB.prepare("INSERT INTO request_nonces(account_id, device_id, nonce, expires_at) VALUES (?, ?, ?, ?)")
      .bind(accountId, deviceId, nonce, Date.now() + REQUEST_NONCE_TTL_MS)
      .run();
    return true;
  } catch {
    return false;
  }
}

function validateClip(auth: AuthContext, clip: EncryptedClip): void {
  requireString(clip.clipId, "clipId");
  requireString(clip.originDeviceId, "originDeviceId");
  requireString(clip.mime, "mime");
  requireString(clip.nonce, "nonce");
  requireString(clip.aadHash, "aadHash");
  requireString(clip.ciphertext, "ciphertext");
  if (clip.originDeviceId !== auth.deviceId) throw new Error("origin device mismatch");
  if (clip.payloadKind !== "text") throw new Error("unsupported payload kind");
  if (clip.byteLen < 0 || clip.byteLen > TEXT_INLINE_LIMIT_BYTES) throw new Error("clip too large for text MVP");
  const aad = aadForClip(auth.accountId, auth.routingId, clip);
  if (clip.aadHash !== sha256Base64Url(stableJson(aad))) throw new Error("bad AAD hash");
}

function space(env: Env, auth: Actor): DurableObjectStub<ClipboardSpace> {
  return env.CLIPBOARD.getByName(auth.routingId);
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

function parseJson<T>(bodyText: string): T {
  if (!bodyText) return {} as T;
  return JSON.parse(bodyText) as T;
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
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
    revokedAt: row.revokedAt
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
