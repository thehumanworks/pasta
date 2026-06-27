import { describe, expect, it } from "bun:test";
import {
  createJoinGrantToken,
  decryptBytesClip,
  decryptTextClip,
  encryptBytesClip,
  encryptTextClip,
  generateSigningKeyPair,
  generateWrappingKeyPair,
  hashJoinGrantRedeemSecret,
  openJoinGrant,
  parseJoinGrantToken,
  sealJoinGrant,
  signCanonicalRequest,
  unwrapGroupKey,
  verifyCanonicalRequest,
  wrapGroupKey
} from "../../src/shared/crypto";
import { fromBase64Url, toBase64Url } from "../../src/shared/encoding";
import { sha256Base64Url, type SignedRequestParts } from "../../src/shared/protocol";

describe("protocol crypto", () => {
  it("matches the deterministic text envelope vector and rejects tampering", () => {
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

    expect(clip.aadHash).toBe("3dZSKCw-X-tdwikqBoAUjGkr9hTVK6uQ5rnFECsh7TM");
    expect(clip.ciphertext).toBe("8p1wvUjO0R4SpwOyW4eRXdPKUfmcRf30mbf0");
    expect(decryptTextClip(key, "acct_vector", "space_vector", clip)).toBe("hello pasta");

    expect(() => decryptTextClip(key, "acct_vector", "wrong_space", clip)).toThrow("AAD");
    expect(() => decryptTextClip(key, "acct_vector", "space_vector", { ...clip, nonce: toBase64Url(new Uint8Array(24)) })).toThrow();
    const ciphertext = fromBase64Url(clip.ciphertext);
    ciphertext[0] = ciphertext[0]! ^ 1;
    expect(() => decryptTextClip(key, "acct_vector", "space_vector", { ...clip, ciphertext: toBase64Url(ciphertext) })).toThrow();
  });

  it("signs canonical requests and rejects altered fields", () => {
    const keys = generateSigningKeyPair(new Uint8Array(32).fill(7));
    const parts: SignedRequestParts = {
      method: "POST",
      pathWithQuery: "/v1/clips",
      timestamp: 1782475200000,
      nonce: "nonce",
      bodyHash: sha256Base64Url("{}")
    };
    const signature = signCanonicalRequest(parts, keys.privateKey);
    expect(verifyCanonicalRequest(parts, signature, keys.publicKey)).toBe(true);
    expect(verifyCanonicalRequest({ ...parts, pathWithQuery: "/v1/devices" }, signature, keys.publicKey)).toBe(false);
  });

  it("encrypts and decrypts inline image bytes without plaintext leakage", () => {
    const key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const clip = encryptBytesClip({
      accountId: "acct_img",
      routingId: "space_img",
      originDeviceId: "dev_img",
      bytes,
      payloadKind: "image",
      mime: "image/png",
      groupKey: key,
      clipId: "clip_img",
      createdAt: 1782475200000,
      nonce: "GBcWFRQTEhEQDw4NDAsKCQgHBgUEAwIB"
    });
    expect(clip.payloadKind).toBe("image");
    expect(clip.ciphertext).not.toContain("PNG");
    expect(decryptBytesClip(key, "acct_img", "space_img", clip)).toEqual(bytes);
  });

  it("wraps a group key for a new device without exposing the raw key", () => {
    const sender = generateWrappingKeyPair(new Uint8Array(32).fill(1));
    const recipient = generateWrappingKeyPair(new Uint8Array(32).fill(2));
    const groupKey = toBase64Url(new Uint8Array(32).fill(9));
    const wrapped = wrapGroupKey({
      groupKey,
      senderPrivateKey: sender.privateKey,
      senderPublicKey: sender.publicKey,
      recipientPublicKey: recipient.publicKey,
      nonce: toBase64Url(new Uint8Array(24).fill(3))
    });
    expect(wrapped).not.toContain(groupKey);
    expect(unwrapGroupKey({ wrappedGroupKey: wrapped, recipientPrivateKey: recipient.privateKey, recipientPublicKey: recipient.publicKey })).toBe(groupKey);
  });

  it("creates, seals, opens, and rejects tampered CI join grants", () => {
    const groupKey = toBase64Url(new Uint8Array(32).fill(4));
    const redeemSecret = toBase64Url(new Uint8Array(32).fill(5));
    const sealSecret = toBase64Url(new Uint8Array(32).fill(6));
    const token = createJoinGrantToken({
      endpoint: "https://relay.example",
      accountId: "acct_ci",
      grantId: "grant_ci",
      redeemSecret,
      sealSecret
    });
    expect(parseJoinGrantToken(token)).toEqual({
      endpoint: "https://relay.example",
      accountId: "acct_ci",
      grantId: "grant_ci",
      redeemSecret,
      sealSecret
    });
    expect(hashJoinGrantRedeemSecret("acct_ci", "grant_ci", redeemSecret)).toBe("7LijF_pz-QgUdWq3B_rnYFsbrO29ksbRnjsoxiU3MoI");

    const sealed = sealJoinGrant({
      groupKey,
      accountId: "acct_ci",
      grantId: "grant_ci",
      sealSecret,
      keyVersion: 1,
      tokenExpiresAt: 1782475200000,
      maxUses: 1,
      deviceTtlMs: null,
      nonce: toBase64Url(new Uint8Array(24).fill(7))
    });
    expect(sealed).not.toContain(groupKey);
    expect(sealed).not.toContain(sealSecret);
    expect(openJoinGrant({ sealedGroupKey: sealed, accountId: "acct_ci", grantId: "grant_ci", sealSecret })).toBe(groupKey);

    const wrongSecret = toBase64Url(new Uint8Array(32).fill(8));
    expect(() => openJoinGrant({ sealedGroupKey: sealed, accountId: "acct_ci", grantId: "grant_ci", sealSecret: wrongSecret })).toThrow();
    expect(() => openJoinGrant({ sealedGroupKey: sealed, accountId: "acct_ci", grantId: "grant_other", sealSecret })).toThrow("AAD");

    const tampered = JSON.parse(sealed) as { aad: { maxUses: number } };
    tampered.aad.maxUses = 2;
    expect(() => openJoinGrant({
      sealedGroupKey: JSON.stringify(tampered),
      accountId: "acct_ci",
      grantId: "grant_ci",
      sealSecret
    })).toThrow();
  });
});
