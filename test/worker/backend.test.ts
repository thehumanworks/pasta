/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, runDurableObjectAlarm } from "cloudflare:test";
import { REGISTRY_SCHEMA_SQL } from "../../src/worker/registry-schema";
import {
  decryptTextClip,
  encryptTextClip,
  generateDeviceKeyMaterial,
  generateGroupKey,
  hashShortCode,
  signCanonicalRequest,
  wrapGroupKey
} from "../../src/shared/crypto";
import { randomBase64Url, stableJson } from "../../src/shared/encoding";
import { sha256Base64Url, SIGNATURE_HEADERS, type BootstrapRequest, type SignedRequestParts } from "../../src/shared/protocol";

describe("Worker backend", () => {
  beforeEach(async () => {
    for (const statement of REGISTRY_SCHEMA_SQL.split(";").map((part) => part.trim()).filter(Boolean)) {
      await env.DB.prepare(statement).run();
    }
  });

  it("decrypts the deterministic crypto vector and rejects tampering in Worker runtime", () => {
    const key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    const clip = encryptTextClip({
      accountId: "acct_vector",
      routingId: "space_vector",
      originDeviceId: "dev_vector",
      plaintext: "hello pasta",
      groupKey: key,
      keyVersion: 1,
      clipId: "clip_vector",
      createdAt: 1782475200000,
      nonce: "GBcWFRQTEhEQDw4NDAsKCQgHBgUEAwIB"
    });
    expect(clip.ciphertext).toBe("8p1wvUjO0R4SpwOyW4eRXdPKUfmcRf30mbf0");
    expect(decryptTextClip(key, "acct_vector", "space_vector", clip)).toBe("hello pasta");
    expect(() => decryptTextClip(key, "acct_vector", "space_vector", { ...clip, aadHash: "bad" })).toThrow();
  });

  it("bootstraps, authenticates signed publish/latest/history, and stores only ciphertext", async () => {
    const device = await bootstrap();
    const groupKey = generateGroupKey();
    const clip = encryptTextClip({
      accountId: device.accountId,
      routingId: device.routingId,
      originDeviceId: device.deviceId,
      plaintext: "plain text should not be stored",
      groupKey,
      keyVersion: 1
    });
    const publish = await signedFetch(device, "POST", "/v1/clips", clip);
    await expectStatus(publish, 201);
    const latest = await (await signedFetch(device, "GET", "/v1/clips/latest")).json() as { clip: { seq: number; ciphertext: string } };
    expect(latest.clip.seq).toBe(1);
    const history = await (await signedFetch(device, "GET", "/v1/clips/history?limit=10")).json() as { clips: unknown[] };
    expect(history.clips).toHaveLength(1);
    const dump = await env.CLIPBOARD.getByName(device.routingId).debugDump();
    expect(JSON.stringify(dump)).not.toContain("plain text should not be stored");
    expect(JSON.stringify(dump)).toContain(clip.ciphertext);
  });

  it("rejects stale, bad-hash, unknown, revoked, and replayed requests", async () => {
    const device = await bootstrap();
    const ok = await signedFetch(device, "GET", "/v1/devices", undefined, { nonce: "fixed" });
    await expectStatus(ok, 200);
    const replay = await signedFetch(device, "GET", "/v1/devices", undefined, { nonce: "fixed" });
    expect(replay.status).toBe(409);
    expect((await signedFetch(device, "GET", "/v1/devices", undefined, { timestamp: Date.now() - 999_999 })).status).toBe(401);
    expect((await signedFetch(device, "GET", "/v1/devices", undefined, { bodyHash: sha256Base64Url("wrong") })).status).toBe(401);
    expect((await signedFetch(device, "GET", "/v1/devices", undefined, { signature: "bad" })).status).toBe(401);
    const unknown = { ...device, deviceId: "unknown" };
    expect((await signedFetch(unknown, "GET", "/v1/devices")).status).toBe(401);
    const revoke = await signedFetch(device, "POST", `/v1/devices/${device.deviceId}/revoke`, {});
    await expectStatus(revoke, 200);
    expect((await signedFetch(device, "GET", "/v1/devices")).status).toBe(403);
  });

  it("approves and consumes pairing exactly once", async () => {
    const existing = await bootstrap();
    const groupKey = generateGroupKey();
    const requester = generateDeviceKeyMaterial();
    const shortCodeHash = hashShortCode("ABC12345", existing.accountId);
    const sessionId = `pair_${randomBase64Url(8)}`;
    const open = await SELF.fetch("https://pasta.test/v1/pairing/open", {
      method: "POST",
      body: stableJson({
        sessionId,
        accountId: existing.accountId,
        shortCodeHash,
        newDeviceId: "dev_new",
        newDeviceName: "new",
        verifyPublicKey: requester.signing.publicKey,
        wrapPublicKey: requester.wrapping.publicKey,
        expiresAt: Date.now() + 60_000
      })
    });
    expect(open.status).toBe(201);
    const pending = await signedFetch(existing, "GET", `/v1/pairing/pending?shortCodeHash=${encodeURIComponent(shortCodeHash)}`);
    expect(pending.status).toBe(200);
    const wrappedGroupKey = wrapGroupKey({
      groupKey,
      senderPrivateKey: existing.wrappingPrivateKey,
      senderPublicKey: existing.wrapPublicKey,
      recipientPublicKey: requester.wrapping.publicKey
    });
    await expectStatus(await signedFetch(existing, "POST", "/v1/pairing/approve", { shortCodeHash, wrappedGroupKey, keyVersion: 1 }), 200);
    const consume = await SELF.fetch("https://pasta.test/v1/pairing/consume", {
      method: "POST",
      body: stableJson({ sessionId, shortCodeHash })
    });
    expect(consume.status).toBe(200);
    expect((await consume.json() as { wrappedGroupKey: string }).wrappedGroupKey).toBe(wrappedGroupKey);
    const replay = await SELF.fetch("https://pasta.test/v1/pairing/consume", {
      method: "POST",
      body: stableJson({ sessionId, shortCodeHash })
    });
    expect(replay.status).toBe(409);
  });

  it("resets to a new encrypted space and runs retention alarms idempotently", async () => {
    const device = await bootstrap();
    const oldStub = env.CLIPBOARD.getByName(device.routingId);
    const groupKey = generateGroupKey();
    const expired = encryptTextClip({
      accountId: device.accountId,
      routingId: device.routingId,
      originDeviceId: device.deviceId,
      plaintext: "expired",
      groupKey,
      expiresAt: Date.now() - 1
    });
    await expectStatus(await signedFetch(device, "POST", "/v1/clips", expired), 201);
    await runDurableObjectAlarm(oldStub);
    expect((await oldStub.debugDump()).clips).toHaveLength(0);
    expect((await runDurableObjectAlarm(oldStub))).toBe(false);

    const freshRoutingId = `space_${randomBase64Url(8)}`;
    const reset = await signedFetch(device, "POST", "/v1/reset", { confirm: "RESET", newRoutingId: freshRoutingId });
    expect(reset.status).toBe(200);
    const latest = await signedFetch({ ...device, routingId: freshRoutingId }, "GET", "/v1/clips/latest");
    expect(latest.status).toBe(200);
    expect((await latest.json() as { clip: null }).clip).toBeNull();
  });
});

interface TestDevice {
  accountId: string;
  routingId: string;
  deviceId: string;
  verifyPublicKey: string;
  wrapPublicKey: string;
  signingPrivateKey: string;
  wrappingPrivateKey: string;
}

async function bootstrap(): Promise<TestDevice> {
  const keys = generateDeviceKeyMaterial();
  const body: BootstrapRequest = {
    accountId: `acct_${randomBase64Url(8)}`,
    routingId: `space_${randomBase64Url(8)}`,
    deviceId: `dev_${randomBase64Url(8)}`,
    deviceName: "test-device",
    verifyPublicKey: keys.signing.publicKey,
    wrapPublicKey: keys.wrapping.publicKey
  };
  const response = await SELF.fetch("https://pasta.test/v1/accounts/bootstrap", {
    method: "POST",
    body: stableJson(body)
  });
  await expectStatus(response, 201);
  return {
    ...body,
    signingPrivateKey: keys.signing.privateKey,
    wrappingPrivateKey: keys.wrapping.privateKey
  };
}

async function expectStatus(response: Response, status: number): Promise<void> {
  if (response.status !== status) {
    throw new Error(`expected ${status}, got ${response.status}: ${await response.text()}`);
  }
  expect(response.status).toBe(status);
}

async function signedFetch(
  device: TestDevice,
  method: string,
  path: string,
  body?: unknown,
  overrides: Partial<SignedRequestParts> & { signature?: string } = {}
): Promise<Response> {
  const bodyText = body === undefined ? "" : stableJson(body);
  const timestamp = overrides.timestamp ?? Date.now();
  const nonce = overrides.nonce ?? randomBase64Url(8);
  const bodyHash = overrides.bodyHash ?? sha256Base64Url(bodyText);
  const parts = {
    method,
    pathWithQuery: path,
    timestamp,
    nonce,
    bodyHash
  };
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  headers.set(SIGNATURE_HEADERS.accountId, device.accountId);
  headers.set(SIGNATURE_HEADERS.deviceId, device.deviceId);
  headers.set(SIGNATURE_HEADERS.timestamp, String(timestamp));
  headers.set(SIGNATURE_HEADERS.nonce, nonce);
  headers.set(SIGNATURE_HEADERS.bodyHash, bodyHash);
  headers.set(SIGNATURE_HEADERS.signature, overrides.signature ?? signCanonicalRequest(parts, device.signingPrivateKey));
  const init: RequestInit = {
    method,
    headers
  };
  if (body !== undefined) {
    init.body = bodyText;
  }
  return SELF.fetch(`https://pasta.test${path}`, init);
}
