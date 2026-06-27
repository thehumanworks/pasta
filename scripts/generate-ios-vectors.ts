import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { generateSigningKeyPair, generateWrappingKeyPair, signCanonicalRequest, encryptTextClip, wrapGroupKey } from "../src/shared/crypto";
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
  }
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(vectors, null, 2) + "\n");
