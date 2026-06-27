import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createJoinGrantToken,
  encryptBytesClip,
  encryptTextClip,
  generateSigningKeyPair,
  generateWrappingKeyPair,
  openJoinGrant,
  sealJoinGrant,
  signCanonicalRequest,
  wrapGroupKey
} from "../src/shared/crypto";
import { sha256Base64Url, type SignedRequestParts } from "../src/shared/protocol";
import { stableJson, toBase64Url } from "../src/shared/encoding";

const outPath = "ios/Tests/PastaCoreTests/Fixtures/pasta-core-vectors.json";

const signingSeed = new Uint8Array(32).fill(7);
const signing = generateSigningKeyPair(signingSeed);
const body = {
  clipId: "clip_vector",
  nested: {
    z: 3,
    a: true
  },
  items: ["pasta", 42, null]
};
const bodyText = stableJson(body);
const signedRequest: SignedRequestParts = {
  method: "post",
  pathWithQuery: "/v1/clips/history?limit=2",
  timestamp: 1782475200000,
  nonce: "nonce_vector",
  bodyHash: sha256Base64Url(bodyText)
};
const groupKey = toBase64Url(new Uint8Array(32).fill(9));
const senderWrap = generateWrappingKeyPair(new Uint8Array(32).fill(1));
const recipientWrap = generateWrappingKeyPair(new Uint8Array(32).fill(2));
const joinGrant = {
  endpoint: "https://relay.example",
  accountId: "acct_ci",
  grantId: "grant_ci",
  redeemSecret: toBase64Url(new Uint8Array(32).fill(5)),
  sealSecret: toBase64Url(new Uint8Array(32).fill(6))
};
const sealedJoinGrant = sealJoinGrant({
  groupKey,
  accountId: joinGrant.accountId,
  grantId: joinGrant.grantId,
  sealSecret: joinGrant.sealSecret,
  keyVersion: 1,
  tokenExpiresAt: 1782475200000,
  maxUses: 1,
  deviceTtlMs: null,
  nonce: toBase64Url(new Uint8Array(24).fill(7))
});
const clip = encryptTextClip({
  accountId: "acct_vector",
  routingId: "space_vector",
  originDeviceId: "dev_vector",
  plaintext: "Hello from Pasta iOS",
  groupKey,
  keyVersion: 1,
  clipId: "clip_vector_text",
  createdAt: 1782475200000,
  expiresAt: null,
  nonce: toBase64Url(new Uint8Array(24).fill(3))
});
const bytesClip = encryptBytesClip({
  accountId: "acct_vector",
  routingId: "space_vector",
  originDeviceId: "dev_vector",
  bytes: new Uint8Array([80, 65, 83, 84, 65, 0, 1, 2, 255]),
  payloadKind: "file",
  mime: "application/octet-stream",
  groupKey,
  keyVersion: 1,
  clipId: "clip_vector_file",
  createdAt: 1782475200001,
  expiresAt: null,
  nonce: toBase64Url(new Uint8Array(24).fill(8))
});

const vectors = {
  base64Url: {
    bytes: [0, 1, 2, 253, 254, 255],
    encoded: toBase64Url(new Uint8Array([0, 1, 2, 253, 254, 255]))
  },
  stableJson: {
    value: body,
    encoded: bodyText,
    sha256: sha256Base64Url(bodyText)
  },
  signedRequest: {
    parts: signedRequest,
    canonical: [
      "PASTA-SIGN-V1",
      "POST",
      "/v1/clips/history?limit=2",
      "1782475200000",
      "nonce_vector",
      signedRequest.bodyHash
    ].join("\n"),
    privateKey: signing.privateKey,
    publicKey: signing.publicKey,
    signature: signCanonicalRequest(signedRequest, signing.privateKey)
  },
  textClip: {
    accountId: "acct_vector",
    routingId: "space_vector",
    groupKey,
    plaintext: "Hello from Pasta iOS",
    clip
  },
  bytesClip: {
    accountId: "acct_vector",
    routingId: "space_vector",
    groupKey,
    bytes: [80, 65, 83, 84, 65, 0, 1, 2, 255],
    clip: bytesClip
  },
  wrappedGroupKey: {
    groupKey,
    senderPrivateKey: senderWrap.privateKey,
    senderPublicKey: senderWrap.publicKey,
    recipientPrivateKey: recipientWrap.privateKey,
    recipientPublicKey: recipientWrap.publicKey,
    nonce: toBase64Url(new Uint8Array(24).fill(4)),
    wrapped: wrapGroupKey({
      groupKey,
      senderPrivateKey: senderWrap.privateKey,
      senderPublicKey: senderWrap.publicKey,
      recipientPublicKey: recipientWrap.publicKey,
      nonce: toBase64Url(new Uint8Array(24).fill(4))
    })
  },
  joinGrant: {
    ...joinGrant,
    groupKey,
    token: createJoinGrantToken(joinGrant),
    sealedGroupKey: sealedJoinGrant,
    openedGroupKey: openJoinGrant({
      sealedGroupKey: sealedJoinGrant,
      accountId: joinGrant.accountId,
      grantId: joinGrant.grantId,
      sealSecret: joinGrant.sealSecret
    })
  }
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(vectors, null, 2) + "\n");
