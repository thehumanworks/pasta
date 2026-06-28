/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { SELF, runDurableObjectAlarm } from "cloudflare:test";
import { REGISTRY_SCHEMA_SQL } from "../../src/worker/registry-schema";
import {
  decryptClipMetadata,
  decryptBytesClip,
  decryptTextClip,
  encryptBytesClip,
  encryptTextClip,
  generateDeviceKeyMaterial,
  generateGroupKey,
  hashJoinGrantRedeemSecret,
  hashShortCode,
  openJoinGrant,
  sealJoinGrant,
  signCanonicalRequest,
  wrapGroupKey
} from "../../src/shared/crypto";
import { bytesToUtf8, fromBase64Url, randomBase64Url, stableJson, toBase64Url, utf8ToBytes } from "../../src/shared/encoding";
import { LARGE_PAYLOAD_MAX_BYTES, MAX_OPEN_PAIRING_SESSIONS, sha256Base64Url, SIGNATURE_HEADERS, type BootstrapRequest, type SignedRequestParts, type StoredClip } from "../../src/shared/protocol";

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

  it("stores inline image payloads as ciphertext and returns identical decrypted bytes", async () => {
    const device = await bootstrap();
    const groupKey = generateGroupKey();
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const clip = encryptBytesClip({
      accountId: device.accountId,
      routingId: device.routingId,
      originDeviceId: device.deviceId,
      bytes: png,
      payloadKind: "image",
      mime: "image/png",
      groupKey,
      keyVersion: 1
    });
    await expectStatus(await signedFetch(device, "POST", "/v1/clips", clip), 201);
    const latest = await (await signedFetch(device, "GET", "/v1/clips/latest")).json() as { clip: StoredClip };
    expect(latest.clip.payloadKind).toBe("image");
    expect(decryptBytesClip(groupKey, device.accountId, device.routingId, latest.clip)).toEqual(png);
    const dump = await env.CLIPBOARD.getByName(device.routingId).debugDump();
    expect(JSON.stringify(dump)).not.toContain("PNG");
    expect(JSON.stringify(dump)).toContain(clip.ciphertext);
  });

  it("uses clipId routes and preserves monotonic display sequences after delete and retention", async () => {
    const device = await bootstrap();
    const groupKey = generateGroupKey();
    const publishText = async (label: string, expiresAt: number | null = null): Promise<StoredClip> => {
      const clip = encryptTextClip({
        accountId: device.accountId,
        routingId: device.routingId,
        originDeviceId: device.deviceId,
        plaintext: label,
        groupKey,
        keyVersion: 1,
        clipId: `clip_${label}`,
        expiresAt
      });
      const response = await signedFetch(device, "POST", "/v1/clips", clip);
      await expectStatus(response, 201);
      return (await response.json() as { clip: StoredClip }).clip;
    };

    const one = await publishText("one");
    const two = await publishText("two");
    const three = await publishText("three");
    expect([one.seq, two.seq, three.seq]).toEqual([1, 2, 3]);
    await expectStatus(await signedFetch(device, "GET", `/v1/clips/${three.clipId}`), 200);
    const bySeq = await (await signedFetch(device, "GET", `/v1/clips/by-seq/${three.seq}`)).json() as { clip: StoredClip };
    expect(bySeq.clip.clipId).toBe(three.clipId);
    expect((await signedFetch(device, "GET", `/v1/clips/${three.seq}`)).status).toBe(404);

    const deleted = await signedFetch(device, "DELETE", `/v1/clips/${two.clipId}`);
    await expectStatus(deleted, 200);
    expect(await deleted.json()).toMatchObject({ clipId: two.clipId, deleted: 1, deletedObjects: 0 });
    const afterDelete = await (await signedFetch(device, "GET", "/v1/clips/history?limit=10")).json() as { clips: StoredClip[] };
    expect(afterDelete.clips.map((clip) => [clip.clipId, clip.seq])).toEqual([
      [three.clipId, 3],
      [one.clipId, 1]
    ]);
    expect((await signedFetch(device, "GET", `/v1/clips/by-seq/${two.seq}`)).status).toBe(404);

    const cleanupNow = Date.now() + 60_000;
    await publishText("expired", cleanupNow - 1);
    const four = await publishText("four");
    expect(four.seq).toBe(5);
    const retention = await env.CLIPBOARD.getByName(device.routingId).runRetention(cleanupNow);
    expect(retention).toMatchObject({ deletedClips: 1, deletedObjects: 0 });
    const afterRetention = await (await signedFetch(device, "GET", "/v1/clips/history?limit=10")).json() as { clips: StoredClip[] };
    expect(afterRetention.clips.map((clip) => [clip.clipId, clip.seq])).toEqual([
      [four.clipId, 5],
      [three.clipId, 3],
      [one.clipId, 1]
    ]);

    await expectStatus(await signedFetch(device, "DELETE", `/v1/clips/${four.clipId}`), 200);
    const five = await publishText("five");
    expect(five.seq).toBe(6);
  });

  it("uploads and downloads file payloads through R2 with bounded sizes", async () => {
    const device = await bootstrap();
    const groupKey = generateGroupKey();
    const medium = new Uint8Array(64 * 1024).fill(5);
    const clip = encryptBytesClip({
      accountId: device.accountId,
      routingId: device.routingId,
      originDeviceId: device.deviceId,
      bytes: medium,
      payloadKind: "file",
      mime: "application/octet-stream",
      groupKey,
      keyVersion: 1,
      metadata: { name: "report.pdf" }
    });
    const publish = await signedFetch(device, "POST", "/v1/files", clip);
    await expectStatus(publish, 201);
    const stored = await publish.json() as { clip: StoredClip };
    expect(stored.clip.storageKind).toBe("r2");
    expect(stored.clip.r2Key).toContain(`/clips/${stored.clip.clipId}/`);
    const dump = await env.CLIPBOARD.getByName(device.routingId).debugDump();
    expect(JSON.stringify(dump)).not.toContain(clip.ciphertext);
    expect(JSON.stringify(dump)).not.toContain("report.pdf");
    const download = await signedFetch(device, "GET", `/v1/files/${stored.clip.clipId}`);
    await expectStatus(download, 200);
    const body = await download.json() as { clip: StoredClip; ciphertext: string };
    expect(decryptBytesClip(groupKey, device.accountId, device.routingId, { ...body.clip, ciphertext: body.ciphertext })).toEqual(medium);
    expect(decryptClipMetadata(groupKey, device.accountId, device.routingId, body.clip)).toEqual({ name: "report.pdf" });

    const v2Bytes = new Uint8Array(32 * 1024).fill(8);
    const v2Clip = encryptBytesClip({
      accountId: device.accountId,
      routingId: device.routingId,
      originDeviceId: device.deviceId,
      bytes: v2Bytes,
      payloadKind: "file",
      mime: "application/octet-stream",
      groupKey,
      keyVersion: 1,
      metadata: { name: "raw.bin" }
    });
    const v2Envelope = { ...v2Clip, ciphertext: "" };
    const v2Publish = await signedFetch(
      device,
      "POST",
      "/v2/files",
      fromBase64Url(v2Clip.ciphertext),
      { headers: { "content-type": "application/octet-stream", "pasta-file-envelope": toBase64Url(utf8ToBytes(stableJson(v2Envelope))) } }
    );
    await expectStatus(v2Publish, 201);
    const v2Stored = await v2Publish.json() as { clip: StoredClip };
    expect(v2Stored.clip.storageKind).toBe("r2");
    const v2Download = await signedFetch(device, "GET", `/v2/files/${v2Stored.clip.clipId}/content`);
    await expectStatus(v2Download, 200);
    const envelopeHeader = v2Download.headers.get("pasta-file-envelope");
    expect(envelopeHeader).toBeTruthy();
    const v2EnvelopeClip = JSON.parse(bytesToUtf8(fromBase64Url(envelopeHeader!))) as StoredClip;
    expect(v2EnvelopeClip.clipId).toBe(v2Stored.clip.clipId);
    expect(decryptBytesClip(groupKey, device.accountId, device.routingId, { ...v2EnvelopeClip, ciphertext: toBase64Url(new Uint8Array(await v2Download.arrayBuffer())) })).toEqual(v2Bytes);

    const imageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(64 * 1024).fill(7)]);
    const imageClip = encryptBytesClip({
      accountId: device.accountId,
      routingId: device.routingId,
      originDeviceId: device.deviceId,
      bytes: imageBytes,
      payloadKind: "image",
      mime: "image/png",
      groupKey,
      keyVersion: 1
    });
    const imagePublish = await signedFetch(device, "POST", "/v1/files", imageClip);
    await expectStatus(imagePublish, 201);
    const imageStored = await imagePublish.json() as { clip: StoredClip };
    expect(imageStored.clip.payloadKind).toBe("image");
    expect(imageStored.clip.storageKind).toBe("r2");
    expect((await signedFetch(device, "GET", `/v1/files/${imageStored.clip.seq}`)).status).toBe(404);
    const imageDownload = await signedFetch(device, "GET", `/v1/files/${imageStored.clip.clipId}`);
    await expectStatus(imageDownload, 200);
    const imageBody = await imageDownload.json() as { clip: StoredClip; ciphertext: string };
    expect(imageBody.clip.payloadKind).toBe("image");
    expect(decryptBytesClip(groupKey, device.accountId, device.routingId, { ...imageBody.clip, ciphertext: imageBody.ciphertext })).toEqual(imageBytes);
    expect(await env.BLOBS.get(imageStored.clip.r2Key!)).toBeTruthy();
    const deletedImage = await signedFetch(device, "DELETE", `/v1/clips/${imageStored.clip.clipId}`);
    await expectStatus(deletedImage, 200);
    expect(await deletedImage.json()).toMatchObject({ clipId: imageStored.clip.clipId, deleted: 1, deletedObjects: 1 });
    expect(await env.BLOBS.get(imageStored.clip.r2Key!)).toBeNull();
    expect((await signedFetch(device, "GET", `/v1/files/${imageStored.clip.clipId}`)).status).toBe(404);

    const expiredClip = encryptBytesClip({
      accountId: device.accountId,
      routingId: device.routingId,
      originDeviceId: device.deviceId,
      bytes: new Uint8Array([9, 8, 7]),
      payloadKind: "file",
      mime: "application/octet-stream",
      groupKey,
      keyVersion: 1,
      expiresAt: Date.now() - 1
    });
    const expiredPublish = await signedFetch(device, "POST", "/v1/files", expiredClip);
    await expectStatus(expiredPublish, 201);
    const expiredStored = await expiredPublish.json() as { clip: StoredClip };
    expect(expiredStored.clip.r2Key).toBeTruthy();
    expect(await env.BLOBS.get(expiredStored.clip.r2Key!)).toBeTruthy();
    const stub = env.CLIPBOARD.getByName(device.routingId);
    expect(await stub.runRetention(Date.now())).toMatchObject({ deletedClips: 1, deletedObjects: 1 });
    expect(await env.BLOBS.get(expiredStored.clip.r2Key!)).toBeNull();
    expect((await signedFetch(device, "GET", `/v1/files/${expiredStored.clip.clipId}`)).status).toBe(404);
    expect(await stub.runRetention(Date.now())).toMatchObject({ deletedClips: 0, deletedObjects: 0 });
    expect(await env.BLOBS.get(expiredStored.clip.r2Key!)).toBeNull();

    const tooLarge = encryptBytesClip({
      accountId: device.accountId,
      routingId: device.routingId,
      originDeviceId: device.deviceId,
      bytes: new Uint8Array([1]),
      payloadKind: "file",
      mime: "application/octet-stream",
      groupKey,
      keyVersion: 1
    });
    tooLarge.byteLen = LARGE_PAYLOAD_MAX_BYTES + 1;
    tooLarge.aadHash = sha256Base64Url(stableJson({
      accountId: device.accountId,
      routingId: device.routingId,
      clipId: tooLarge.clipId,
      originDeviceId: tooLarge.originDeviceId,
      createdAt: tooLarge.createdAt,
      payloadKind: tooLarge.payloadKind,
      mime: tooLarge.mime,
      byteLen: tooLarge.byteLen,
      keyVersion: tooLarge.keyVersion
    }));
    expect((await signedFetch(device, "POST", "/v1/files", tooLarge)).status).toBe(500);
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

  it("hides revoked devices by default and rejects reactivation through pair approval", async () => {
    const existing = await bootstrap();
    const secondKeys = generateDeviceKeyMaterial();
    const secondDeviceId = `dev_second_${randomBase64Url(6)}`;
    await env.DB.prepare(
      `INSERT INTO devices(
        account_id, device_id, device_name, verify_public_key, wrap_public_key,
        status, created_at, last_seen_at, revoked_at, device_expires_at
      ) VALUES (?, ?, 'second', ?, ?, 'active', ?, NULL, NULL, NULL)`
    )
      .bind(existing.accountId, secondDeviceId, secondKeys.signing.publicKey, secondKeys.wrapping.publicKey, Date.now())
      .run();

    const initial = await (await signedFetch(existing, "GET", "/v1/devices")).json() as { devices: Array<{ deviceId: string; status: string }> };
    expect(initial.devices.some((device) => device.deviceId === secondDeviceId && device.status === "active")).toBe(true);

    await expectStatus(await signedFetch(existing, "POST", `/v1/devices/${secondDeviceId}/revoke`, {}), 200);
    const defaultList = await (await signedFetch(existing, "GET", "/v1/devices")).json() as { devices: Array<{ deviceId: string; status: string }> };
    expect(defaultList.devices.some((device) => device.deviceId === secondDeviceId)).toBe(false);
    const auditList = await (await signedFetch(existing, "GET", "/v1/devices?includeRevoked=true")).json() as { devices: Array<{ deviceId: string; status: string }> };
    expect(auditList.devices.some((device) => device.deviceId === secondDeviceId && device.status === "revoked")).toBe(true);

    const requester = generateDeviceKeyMaterial();
    const shortCodeHash = hashShortCode("REPAIR01", existing.accountId);
    await expectStatus(await SELF.fetch("https://pasta.test/v1/pairing/open", {
      method: "POST",
      body: stableJson({
        sessionId: `pair_reactivation_${randomBase64Url(6)}`,
        accountId: existing.accountId,
        shortCodeHash,
        newDeviceId: secondDeviceId,
        newDeviceName: "reactivation-attempt",
        verifyPublicKey: requester.signing.publicKey,
        wrapPublicKey: requester.wrapping.publicKey,
        expiresAt: Date.now() + 60_000
      })
    }), 201);
    const approval = await signedFetch(existing, "POST", "/v1/pairing/approve", {
      shortCodeHash,
      wrappedGroupKey: "wrapped",
      keyVersion: 1
    });
    expect(approval.status).toBe(409);
    expect(await approval.json()).toMatchObject({ error: "device_exists" });
    const row = await env.DB.prepare("SELECT status, revoked_at FROM devices WHERE account_id = ? AND device_id = ?")
      .bind(existing.accountId, secondDeviceId)
      .first<{ status: string; revoked_at: number | null }>();
    expect(row?.status).toBe("revoked");
    expect(row?.revoked_at).toBeGreaterThan(0);
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

  it("creates and redeems default permanent CI join grants exactly once", async () => {
    const existing = await bootstrap();
    const groupKey = generateGroupKey();
    const redeemSecret = randomBase64Url(32);
    const sealSecret = randomBase64Url(32);
    const grantId = `grant_${randomBase64Url(8)}`;
    const tokenExpiresAt = Date.now() + 10 * 60_000;
    const sealedGroupKey = sealJoinGrant({
      groupKey,
      accountId: existing.accountId,
      grantId,
      sealSecret,
      keyVersion: 1,
      tokenExpiresAt,
      maxUses: 1,
      deviceTtlMs: null
    });
    const create = await signedFetch(existing, "POST", "/v1/pairing/grants", {
      grantId,
      label: "ci",
      redeemSecretHash: hashJoinGrantRedeemSecret(existing.accountId, grantId, redeemSecret),
      sealedGroupKey,
      keyVersion: 1,
      tokenExpiresAt,
      deviceTtlMs: null,
      maxUses: 1
    });
    await expectStatus(create, 201);
    expect(await create.json()).toMatchObject({ grantId, deviceTtlMs: null, maxUses: 1 });
    const storedGrant = await env.DB.prepare("SELECT * FROM pairing_grants WHERE grant_id = ?")
      .bind(grantId)
      .first<Record<string, string | number | null>>();
    expect(storedGrant?.device_ttl_ms).toBeNull();
    expect(String(storedGrant?.sealed_group_key)).not.toContain(groupKey);
    expect(String(storedGrant?.sealed_group_key)).not.toContain(sealSecret);
    expect(JSON.stringify(storedGrant)).not.toContain(redeemSecret);

    const joinedKeys = generateDeviceKeyMaterial();
    const redeem = await SELF.fetch("https://pasta.test/v1/pairing/grants/redeem", {
      method: "POST",
      body: stableJson({
        grantId,
        redeemSecret,
        newDeviceId: "dev_ci",
        newDeviceName: "ci",
        verifyPublicKey: joinedKeys.signing.publicKey,
        wrapPublicKey: joinedKeys.wrapping.publicKey
      })
    });
    await expectStatus(redeem, 200);
    const redeemed = await redeem.json() as { accountId: string; sealedGroupKey: string; deviceExpiresAt: number | null };
    expect(redeemed.sealedGroupKey).toBe(sealedGroupKey);
    expect(redeemed.deviceExpiresAt).toBeNull();
    expect(JSON.stringify(redeemed)).not.toContain(sealSecret);
    expect(openJoinGrant({ sealedGroupKey: redeemed.sealedGroupKey, accountId: redeemed.accountId, grantId, sealSecret })).toBe(groupKey);
    const joined: TestDevice = {
      accountId: existing.accountId,
      routingId: existing.routingId,
      deviceId: "dev_ci",
      verifyPublicKey: joinedKeys.signing.publicKey,
      wrapPublicKey: joinedKeys.wrapping.publicKey,
      signingPrivateKey: joinedKeys.signing.privateKey,
      wrappingPrivateKey: joinedKeys.wrapping.privateKey
    };
    await expectStatus(await signedFetch(joined, "GET", "/v1/devices"), 200);

    const replay = await SELF.fetch("https://pasta.test/v1/pairing/grants/redeem", {
      method: "POST",
      body: stableJson({
        grantId,
        redeemSecret,
        newDeviceId: "dev_ci_replay",
        newDeviceName: "ci-replay",
        verifyPublicKey: generateDeviceKeyMaterial().signing.publicKey,
        wrapPublicKey: generateDeviceKeyMaterial().wrapping.publicKey
      })
    });
    expect(replay.status).toBe(409);
  });

  it("allows only one concurrent redemption for a one-use CI join grant", async () => {
    const existing = await bootstrap();
    const grant = joinGrantPayload(existing, generateGroupKey());
    await expectStatus(await signedFetch(existing, "POST", "/v1/pairing/grants", grant.body), 201);
    const requests = ["dev_race_a", "dev_race_b"].map((deviceId) => {
      const keys = generateDeviceKeyMaterial();
      return SELF.fetch("https://pasta.test/v1/pairing/grants/redeem", {
        method: "POST",
        body: stableJson({
          grantId: grant.grantId,
          redeemSecret: grant.redeemSecret,
          newDeviceId: `${deviceId}_${randomBase64Url(4)}`,
          newDeviceName: deviceId,
          verifyPublicKey: keys.signing.publicKey,
          wrapPublicKey: keys.wrapping.publicKey
        })
      });
    });
    const responses = await Promise.all(requests);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const grantRow = await env.DB.prepare("SELECT use_count FROM pairing_grants WHERE grant_id = ?")
      .bind(grant.grantId)
      .first<{ use_count: number }>();
    expect(grantRow?.use_count).toBe(1);
  });

  it("revokes unused grants and lazily revokes expired CI devices", async () => {
    const existing = await bootstrap();
    const groupKey = generateGroupKey();
    const revokedGrantId = `grant_${randomBase64Url(8)}`;
    const revokedRedeemSecret = randomBase64Url(32);
    const revokedTokenExpiresAt = Date.now() + 10 * 60_000;
    await expectStatus(await signedFetch(existing, "POST", "/v1/pairing/grants", {
      grantId: revokedGrantId,
      redeemSecretHash: hashJoinGrantRedeemSecret(existing.accountId, revokedGrantId, revokedRedeemSecret),
      sealedGroupKey: sealJoinGrant({
        groupKey,
        accountId: existing.accountId,
        grantId: revokedGrantId,
        sealSecret: randomBase64Url(32),
        keyVersion: 1,
        tokenExpiresAt: revokedTokenExpiresAt,
        maxUses: 1,
        deviceTtlMs: null
      }),
      keyVersion: 1,
      tokenExpiresAt: revokedTokenExpiresAt,
      deviceTtlMs: null,
      maxUses: 1
    }), 201);
    await expectStatus(await signedFetch(existing, "POST", `/v1/pairing/grants/${revokedGrantId}/revoke`, {}), 200);
    const revokedRedeem = await SELF.fetch("https://pasta.test/v1/pairing/grants/redeem", {
      method: "POST",
      body: stableJson({
        grantId: revokedGrantId,
        redeemSecret: revokedRedeemSecret,
        newDeviceId: "dev_revoked_grant",
        newDeviceName: "revoked",
        verifyPublicKey: generateDeviceKeyMaterial().signing.publicKey,
        wrapPublicKey: generateDeviceKeyMaterial().wrapping.publicKey
      })
    });
    expect(revokedRedeem.status).toBe(403);
    expect(await revokedRedeem.json()).toMatchObject({ error: "grant_revoked" });

    const expiringGrantId = `grant_${randomBase64Url(8)}`;
    const expiringRedeemSecret = randomBase64Url(32);
    const expiringSealSecret = randomBase64Url(32);
    const expiringTokenExpiresAt = Date.now() + 10 * 60_000;
    const expiringDeviceTtlMs = 24 * 60 * 60 * 1000;
    await expectStatus(await signedFetch(existing, "POST", "/v1/pairing/grants", {
      grantId: expiringGrantId,
      redeemSecretHash: hashJoinGrantRedeemSecret(existing.accountId, expiringGrantId, expiringRedeemSecret),
      sealedGroupKey: sealJoinGrant({
        groupKey,
        accountId: existing.accountId,
        grantId: expiringGrantId,
        sealSecret: expiringSealSecret,
        keyVersion: 1,
        tokenExpiresAt: expiringTokenExpiresAt,
        maxUses: 1,
        deviceTtlMs: expiringDeviceTtlMs
      }),
      keyVersion: 1,
      tokenExpiresAt: expiringTokenExpiresAt,
      deviceTtlMs: expiringDeviceTtlMs,
      maxUses: 1
    }), 201);
    const expiringKeys = generateDeviceKeyMaterial();
    const beforeRedeem = Date.now();
    const expiringRedeem = await SELF.fetch("https://pasta.test/v1/pairing/grants/redeem", {
      method: "POST",
      body: stableJson({
        grantId: expiringGrantId,
        redeemSecret: expiringRedeemSecret,
        newDeviceId: "dev_expiring",
        newDeviceName: "expiring",
        verifyPublicKey: expiringKeys.signing.publicKey,
        wrapPublicKey: expiringKeys.wrapping.publicKey
      })
    });
    await expectStatus(expiringRedeem, 200);
    const expiringBody = await expiringRedeem.json() as { deviceExpiresAt: number };
    expect(expiringBody.deviceExpiresAt).toBeGreaterThanOrEqual(beforeRedeem + expiringDeviceTtlMs);
    expect(expiringBody.deviceExpiresAt).toBeLessThanOrEqual(Date.now() + expiringDeviceTtlMs);

    const expiringDevice: TestDevice = {
      accountId: existing.accountId,
      routingId: existing.routingId,
      deviceId: "dev_expiring",
      verifyPublicKey: expiringKeys.signing.publicKey,
      wrapPublicKey: expiringKeys.wrapping.publicKey,
      signingPrivateKey: expiringKeys.signing.privateKey,
      wrappingPrivateKey: expiringKeys.wrapping.privateKey
    };
    await expectStatus(await signedFetch(expiringDevice, "GET", "/v1/devices"), 200);
    await env.DB.prepare("UPDATE devices SET device_expires_at = ? WHERE account_id = ? AND device_id = ?")
      .bind(Date.now() - 1, existing.accountId, "dev_expiring")
      .run();
    expect((await signedFetch(expiringDevice, "GET", "/v1/devices", undefined, { signature: "bad" })).status).toBe(401);
    const rowAfterBadSignature = await env.DB.prepare("SELECT status, revoked_at FROM devices WHERE account_id = ? AND device_id = ?")
      .bind(existing.accountId, "dev_expiring")
      .first<{ status: string; revoked_at: number | null }>();
    expect(rowAfterBadSignature).toEqual({ status: "active", revoked_at: null });
    const expired = await signedFetch(expiringDevice, "GET", "/v1/devices");
    expect(expired.status).toBe(403);
    expect(await expired.json()).toMatchObject({ error: "expired_device" });
    const row = await env.DB.prepare("SELECT status, revoked_at FROM devices WHERE account_id = ? AND device_id = ?")
      .bind(existing.accountId, "dev_expiring")
      .first<{ status: string; revoked_at: number | null }>();
    expect(row).toMatchObject({ status: "revoked" });
    expect(row?.revoked_at).toBeGreaterThan(0);
  });

  it("rejects duplicate CI grant device ids, expired tokens, and server-side bound violations", async () => {
    const existing = await bootstrap();
    const duplicateGrant = joinGrantPayload(existing, generateGroupKey(), { maxUses: 2 });
    await expectStatus(await signedFetch(existing, "POST", "/v1/pairing/grants", duplicateGrant.body), 201);
    const duplicateKeys = generateDeviceKeyMaterial();
    const duplicate = await SELF.fetch("https://pasta.test/v1/pairing/grants/redeem", {
      method: "POST",
      body: stableJson({
        grantId: duplicateGrant.grantId,
        redeemSecret: duplicateGrant.redeemSecret,
        newDeviceId: existing.deviceId,
        newDeviceName: "should-not-rekey",
        verifyPublicKey: duplicateKeys.signing.publicKey,
        wrapPublicKey: duplicateKeys.wrapping.publicKey
      })
    });
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ error: "device_exists" });
    const unchanged = await env.DB.prepare("SELECT verify_public_key, status FROM devices WHERE account_id = ? AND device_id = ?")
      .bind(existing.accountId, existing.deviceId)
      .first<{ verify_public_key: string; status: string }>();
    expect(unchanged).toEqual({ verify_public_key: existing.verifyPublicKey, status: "active" });
    const afterDuplicate = await env.DB.prepare("SELECT use_count FROM pairing_grants WHERE grant_id = ?")
      .bind(duplicateGrant.grantId)
      .first<{ use_count: number }>();
    expect(afterDuplicate?.use_count).toBe(0);

    const okKeys = generateDeviceKeyMaterial();
    await expectStatus(await SELF.fetch("https://pasta.test/v1/pairing/grants/redeem", {
      method: "POST",
      body: stableJson({
        grantId: duplicateGrant.grantId,
        redeemSecret: duplicateGrant.redeemSecret,
        newDeviceId: "dev_after_duplicate",
        newDeviceName: "ok",
        verifyPublicKey: okKeys.signing.publicKey,
        wrapPublicKey: okKeys.wrapping.publicKey
      })
    }), 200);

    const expiredGrant = joinGrantPayload(existing, generateGroupKey());
    await expectStatus(await signedFetch(existing, "POST", "/v1/pairing/grants", expiredGrant.body), 201);
    await env.DB.prepare("UPDATE pairing_grants SET token_expires_at = ? WHERE grant_id = ?")
      .bind(Date.now() - 1, expiredGrant.grantId)
      .run();
    const expiredRedeem = await SELF.fetch("https://pasta.test/v1/pairing/grants/redeem", {
      method: "POST",
      body: stableJson({
        grantId: expiredGrant.grantId,
        redeemSecret: expiredGrant.redeemSecret,
        newDeviceId: "dev_expired_grant",
        newDeviceName: "expired",
        verifyPublicKey: generateDeviceKeyMaterial().signing.publicKey,
        wrapPublicKey: generateDeviceKeyMaterial().wrapping.publicKey
      })
    });
    expect(expiredRedeem.status).toBe(410);
    expect(await expiredRedeem.json()).toMatchObject({ error: "expired_grant" });

    for (const [patch, error] of [
      [{ tokenExpiresAt: Date.now() + 25 * 60 * 60 * 1000 }, "token_ttl_too_long"],
      [{ deviceTtlMs: 31 * 24 * 60 * 60 * 1000 }, "bad_device_ttl"],
      [{ maxUses: 11 }, "bad_max_uses"]
    ] as Array<[Record<string, number>, string]>) {
      const bad = joinGrantPayload(existing, generateGroupKey(), patch);
      const response = await signedFetch(existing, "POST", "/v1/pairing/grants", bad.body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error });
    }
  });

  it("rate-limits excessive open pairing sessions per account", async () => {
    const existing = await bootstrap();
    for (let index = 0; index < MAX_OPEN_PAIRING_SESSIONS; index += 1) {
      const requester = generateDeviceKeyMaterial();
      const open = await SELF.fetch("https://pasta.test/v1/pairing/open", {
        method: "POST",
        body: stableJson({
          sessionId: `pair_${index}_${randomBase64Url(8)}`,
          accountId: existing.accountId,
          shortCodeHash: hashShortCode(`ABUSE${index}`, existing.accountId),
          newDeviceId: `dev_new_${index}`,
          newDeviceName: `new-${index}`,
          verifyPublicKey: requester.signing.publicKey,
          wrapPublicKey: requester.wrapping.publicKey,
          expiresAt: Date.now() + 60_000
        })
      });
      expect(open.status).toBe(201);
    }

    const blockedRequester = generateDeviceKeyMaterial();
    const blocked = await SELF.fetch("https://pasta.test/v1/pairing/open", {
      method: "POST",
      body: stableJson({
        sessionId: `pair_blocked_${randomBase64Url(8)}`,
        accountId: existing.accountId,
        shortCodeHash: hashShortCode("ABUSE_BLOCKED", existing.accountId),
        newDeviceId: "dev_blocked",
        newDeviceName: "blocked",
        verifyPublicKey: blockedRequester.signing.publicKey,
        wrapPublicKey: blockedRequester.wrapping.publicKey,
        expiresAt: Date.now() + 60_000
      })
    });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: "pairing_rate_limited", limit: MAX_OPEN_PAIRING_SESSIONS });
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

function joinGrantPayload(
  device: TestDevice,
  groupKey: string,
  overrides: Partial<{
    grantId: string;
    redeemSecret: string;
    sealSecret: string;
    tokenExpiresAt: number;
    deviceTtlMs: number | null;
    maxUses: number;
  }> = {}
): {
  grantId: string;
  redeemSecret: string;
  sealSecret: string;
  body: {
    grantId: string;
    redeemSecretHash: string;
    sealedGroupKey: string;
    keyVersion: number;
    tokenExpiresAt: number;
    deviceTtlMs: number | null;
    maxUses: number;
  };
} {
  const grantId = overrides.grantId ?? `grant_${randomBase64Url(8)}`;
  const redeemSecret = overrides.redeemSecret ?? randomBase64Url(32);
  const sealSecret = overrides.sealSecret ?? randomBase64Url(32);
  const tokenExpiresAt = overrides.tokenExpiresAt ?? Date.now() + 10 * 60_000;
  const deviceTtlMs = overrides.deviceTtlMs ?? null;
  const maxUses = overrides.maxUses ?? 1;
  return {
    grantId,
    redeemSecret,
    sealSecret,
    body: {
      grantId,
      redeemSecretHash: hashJoinGrantRedeemSecret(device.accountId, grantId, redeemSecret),
      sealedGroupKey: sealJoinGrant({
        groupKey,
        accountId: device.accountId,
        grantId,
        sealSecret,
        keyVersion: 1,
        tokenExpiresAt,
        maxUses,
        deviceTtlMs
      }),
      keyVersion: 1,
      tokenExpiresAt,
      deviceTtlMs,
      maxUses
    }
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
  overrides: Partial<SignedRequestParts> & { signature?: string; headers?: Record<string, string> } = {}
): Promise<Response> {
  const isBinary = body instanceof Uint8Array;
  const bodyText = body === undefined || isBinary ? "" : stableJson(body);
  const bodyBytes = body === undefined ? new Uint8Array() : isBinary ? body : utf8ToBytes(bodyText);
  const timestamp = overrides.timestamp ?? Date.now();
  const nonce = overrides.nonce ?? randomBase64Url(8);
  const bodyHash = overrides.bodyHash ?? sha256Base64Url(bodyBytes);
  const parts = {
    method,
    pathWithQuery: path,
    timestamp,
    nonce,
    bodyHash
  };
  const headers = new Headers(overrides.headers);
  if (body !== undefined && !isBinary && !headers.has("content-type")) headers.set("content-type", "application/json");
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
    init.body = isBinary ? requestBodyFromBytes(body) : bodyText;
  }
  return SELF.fetch(`https://pasta.test${path}`, init);
}

function requestBodyFromBytes(bytes: Uint8Array): BodyInit {
  const copy = new Uint8Array(bytes);
  return copy.buffer as ArrayBuffer;
}
